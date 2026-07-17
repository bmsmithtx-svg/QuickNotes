import { chunkPageText } from "@/lib/chunking";

import { getEmbeddingRuntimeConfig, type EmbeddingRuntimeConfig } from "./embedding-config";
import { createOpenAIEmbeddingService } from "./embedding-service";
import { syncChunkEmbeddings, type EmbeddingSyncResult } from "./embedding-sync";
import { getPrisma, type PrismaClientLike, type PrismaTransactionLike } from "./db";
import { normalizeTagsInput, replaceDocumentTags, type MetadataTagTransaction, type NormalizedTag } from "./metadata";
import { extractPdfTextByPage } from "./pdf-extraction";
import { ensureChunkSearchIndex, syncDocumentSearchIndex, type SearchIndexChunk } from "./search-index";
import { getDocumentStorageForRecord, sha256Hex, type DocumentStorageAdapter } from "./storage";

export const DOCUMENT_UPLOAD_STATUS = {
  UPLOADING: "UPLOADING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  FAILED: "FAILED",
  DELETING: "DELETING"
} as const;

export type DocumentUploadStatus = (typeof DOCUMENT_UPLOAD_STATUS)[keyof typeof DOCUMENT_UPLOAD_STATUS];

export type DocumentLifecycleStage =
  | "storage_upload"
  | "storage_read"
  | "checksum"
  | "pdf_extract"
  | "database_write"
  | "embedding"
  | "storage_delete"
  | "database_delete"
  | "processing";

export type StoredDocumentRecord = {
  id: string;
  ownerId: string;
  originalFileName: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string;
  tags: string;
  uploadStatus: string;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
  contentSha256: string | null;
};

export type DocumentProcessingResult = {
  documentId: string;
  pageCount: number;
  chunkCount: number;
  status: DocumentUploadStatus;
  embeddingStatus: "skipped_missing_api_key" | "complete";
  embeddingResult?: EmbeddingSyncResult;
};

export type DocumentDeletionResult = {
  documentId: string;
  status: "deleted" | "missing";
  storage?: "deleted" | "already_missing";
};

type ProcessStoredDocumentInput = {
  prisma?: PrismaClientLike;
  storage?: DocumentStorageAdapter;
  documentId: string;
  ownerId?: string;
  tags?: NormalizedTag[];
  extractPdf?: typeof extractPdfTextByPage;
  embeddingConfig?: EmbeddingRuntimeConfig;
};

type DeleteStoredDocumentInput = {
  prisma?: PrismaClientLike;
  storage?: DocumentStorageAdapter;
  documentId: string;
  ownerId?: string;
};

export class DocumentLifecycleError extends Error {
  stage: DocumentLifecycleStage;

  constructor(stage: DocumentLifecycleStage, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentLifecycleError";
    this.stage = stage;
  }
}

export function toDocumentUploadStatus(status: string): DocumentUploadStatus {
  const normalized = status.trim().toUpperCase();

  if (
    normalized === DOCUMENT_UPLOAD_STATUS.UPLOADING ||
    normalized === DOCUMENT_UPLOAD_STATUS.PROCESSING ||
    normalized === DOCUMENT_UPLOAD_STATUS.READY ||
    normalized === DOCUMENT_UPLOAD_STATUS.FAILED ||
    normalized === DOCUMENT_UPLOAD_STATUS.DELETING
  ) {
    return normalized;
  }

  if (status === "uploaded") {
    return DOCUMENT_UPLOAD_STATUS.UPLOADING;
  }

  return DOCUMENT_UPLOAD_STATUS.FAILED;
}

export function isDocumentReady(status: string) {
  return toDocumentUploadStatus(status) === DOCUMENT_UPLOAD_STATUS.READY;
}

export async function deleteStoredDocument(input: DeleteStoredDocumentInput): Promise<DocumentDeletionResult> {
  const prisma = input.prisma ?? (await getPrisma());
  const document = await findStoredDocument(prisma, input.documentId, input.ownerId);

  if (!document) {
    return {
      documentId: input.documentId,
      status: "missing"
    };
  }

  if (toDocumentUploadStatus(document.uploadStatus) !== DOCUMENT_UPLOAD_STATUS.DELETING) {
    try {
      await prisma.studyDocument.update({
        where: {
          id: document.id
        },
        data: {
          uploadStatus: DOCUMENT_UPLOAD_STATUS.DELETING,
          deleteRequestedAt: new Date(),
          failureStage: null,
          failureReason: null
        }
      });
    } catch (error) {
      await markDocumentDeletingFailure(prisma, document.id, "database_delete", error);
      throw new DocumentLifecycleError("database_delete", sanitizeFailureMessage(error), {
        cause: error
      });
    }
  }

  const storage = input.storage ?? getDocumentStorageForRecord(document);
  let storageDelete: { deleted: boolean; missing: boolean };

  try {
    storageDelete = await storage.deleteObject(document.storageObjectKey);
  } catch (error) {
    await markDocumentDeletingFailure(prisma, document.id, "storage_delete", error);
    throw new DocumentLifecycleError("storage_delete", sanitizeFailureMessage(error), {
      cause: error
    });
  }

  try {
    if (!prisma.studyDocument.delete) {
      throw new Error("Prisma delete operation is unavailable.");
    }

    await prisma.studyDocument.delete({
      where: {
        id: document.id
      }
    });
  } catch (error) {
    await markDocumentDeletingFailure(prisma, document.id, "database_delete", error);
    throw new DocumentLifecycleError("database_delete", sanitizeFailureMessage(error), {
      cause: error
    });
  }

  return {
    documentId: document.id,
    status: "deleted",
    storage: storageDelete.missing ? "already_missing" : "deleted"
  };
}

export async function processStoredDocument(input: ProcessStoredDocumentInput): Promise<DocumentProcessingResult> {
  const prisma = input.prisma ?? (await getPrisma());
  const extractPdf = input.extractPdf ?? extractPdfTextByPage;
  const document = await findStoredDocument(prisma, input.documentId, input.ownerId);

  if (!document) {
    throw new DocumentLifecycleError("processing", "Document not found.");
  }

  const storage = input.storage ?? getDocumentStorageForRecord(document);

  await prisma.studyDocument.update({
    where: {
      id: document.id
    },
    data: {
      uploadStatus: DOCUMENT_UPLOAD_STATUS.PROCESSING,
      failureStage: null,
      failureReason: null,
      failedAt: null,
      processingStartedAt: new Date(),
      processingCompletedAt: null,
      processingAttemptCount: {
        increment: 1
      }
    }
  });

  try {
    const buffer = await withFailureStage("storage_read", async () => {
      return readStoredSourcePdf(storage, document.storageObjectKey);
    });

    await withFailureStage("checksum", async () => {
      validateStoredSource(document, buffer);
    });

    const extractedPdf = await withFailureStage("pdf_extract", () => extractPdf(buffer));
    const pageRows = extractedPdf.pages.map((page) => ({
      documentId: document.id,
      pageNumber: page.pageNumber,
      text: page.text
    }));
    const chunkRows = extractedPdf.pages.flatMap((page) =>
      chunkPageText({
        documentId: document.id,
        pageNumber: page.pageNumber,
        text: page.text
      })
    );
    let searchableChunks: SearchIndexChunk[] = [];

    await withFailureStage("database_write", async () => {
      await ensureChunkSearchIndex(prisma);

      await prisma.$transaction(async (transaction) => {
        await deleteDerivedRows(transaction, document.id);
        await replaceDocumentTags(
          transaction as unknown as MetadataTagTransaction,
          document.id,
          document.ownerId,
          input.tags ?? parseStoredTags(document.tags)
        );

        if (pageRows.length > 0) {
          await transaction.documentPage.createMany({
            data: pageRows
          });
        }

        if (chunkRows.length > 0) {
          await transaction.documentChunk.createMany({
            data: chunkRows
          });
        }

        searchableChunks = (await transaction.documentChunk.findMany({
          where: {
            documentId: document.id
          },
          select: {
            id: true,
            documentId: true,
            text: true
          }
        })) as SearchIndexChunk[];

        await syncDocumentSearchIndex(transaction, document.id, searchableChunks);
      });
    });

    const embeddingOutcome = await withFailureStage("embedding", () =>
      syncUploadedDocumentEmbeddings(prisma, document.id, searchableChunks, input.embeddingConfig)
    );

    await prisma.studyDocument.update({
      where: {
        id: document.id
      },
      data: {
        uploadStatus: DOCUMENT_UPLOAD_STATUS.READY,
        pageCount: extractedPdf.pageCount,
        failureStage: null,
        failureReason: null,
        failedAt: null,
        processingCompletedAt: new Date()
      }
    });

    return {
      documentId: document.id,
      pageCount: extractedPdf.pageCount,
      chunkCount: chunkRows.length,
      status: DOCUMENT_UPLOAD_STATUS.READY,
      embeddingStatus: embeddingOutcome.embeddingStatus,
      embeddingResult: embeddingOutcome.result
    };
  } catch (error) {
    await cleanupAfterProcessingFailure(prisma, document.id);
    await markDocumentFailed(prisma, document.id, getLifecycleStage(error), error);
    throw error;
  }
}

async function readStoredSourcePdf(storage: DocumentStorageAdapter, storageObjectKey: string) {
  try {
    return await storage.readPdf(storageObjectKey);
  } catch (error) {
    if (isStorageObjectMissingError(error)) {
      throw new Error("Stored source PDF is missing.", {
        cause: error
      });
    }

    throw error;
  }
}

export async function markDocumentFailed(
  prisma: PrismaClientLike,
  documentId: string,
  failureStage: DocumentLifecycleStage,
  error: unknown
) {
  try {
    await prisma.studyDocument.update({
      where: {
        id: documentId
      },
      data: {
        uploadStatus: DOCUMENT_UPLOAD_STATUS.FAILED,
        failureStage,
        failureReason: sanitizeFailureMessage(error),
        failedAt: new Date()
      }
    });
  } catch {
    // Keep public API errors safe even if failure-state persistence also fails.
  }
}

export async function markDocumentDeletingFailure(
  prisma: PrismaClientLike,
  documentId: string,
  failureStage: DocumentLifecycleStage,
  error: unknown
) {
  try {
    await prisma.studyDocument.update({
      where: {
        id: documentId
      },
      data: {
        uploadStatus: DOCUMENT_UPLOAD_STATUS.DELETING,
        failureStage,
        failureReason: sanitizeFailureMessage(error)
      }
    });
  } catch {
    // Keep public deletion errors safe even if diagnostic persistence fails.
  }
}

export function sanitizeFailureMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "Document processing failed.";
  const secrets = [
    process.env.OPENAI_API_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
  ].filter((value): value is string => Boolean(value));
  let message = rawMessage.replace(/\s+/g, " ").trim() || "Document processing failed.";

  for (const secret of secrets) {
    if (secret) {
      message = message.split(secret).join("[redacted]");
    }
  }

  return message.replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]").slice(0, 500);
}

async function findStoredDocument(prisma: PrismaClientLike, documentId: string, ownerId?: string) {
  const args = {
    where: ownerId
      ? {
          id: documentId,
          ownerId
        }
      : {
          id: documentId
        },
    select: {
      id: true,
      ownerId: true,
      originalFileName: true,
      storedFileName: true,
      fileSize: true,
      mimeType: true,
      tags: true,
      uploadStatus: true,
      storageProvider: true,
      storageBucket: true,
      storageObjectKey: true,
      contentSha256: true
    }
  };

  if (ownerId) {
    return (await prisma.studyDocument.findFirst?.(args)) as StoredDocumentRecord | null;
  }

  return (await prisma.studyDocument.findUnique(args)) as StoredDocumentRecord | null;
}

async function syncUploadedDocumentEmbeddings(
  prisma: PrismaClientLike,
  documentId: string,
  chunks: SearchIndexChunk[],
  embeddingConfig?: EmbeddingRuntimeConfig
): Promise<{
  embeddingStatus: "skipped_missing_api_key" | "complete";
  result?: EmbeddingSyncResult;
}> {
  const config = embeddingConfig ?? getEmbeddingRuntimeConfig();

  if (chunks.length === 0) {
    return {
      embeddingStatus: "complete"
    };
  }

  if (!config.apiKey) {
    return {
      embeddingStatus: "skipped_missing_api_key"
    };
  }

  const embeddingService = createOpenAIEmbeddingService({
    apiKey: config.apiKey,
    model: config.model,
    dimensions: config.dimensions
  });
  const result = await syncChunkEmbeddings(prisma, chunks, embeddingService, {
    mode: "stale"
  });

  if (result.failed > 0) {
    const embeddingError =
      result.errorMessage ??
      `Embedding generation failed for ${result.failed} chunk(s). Run npm run storage:retry -- ${documentId} after fixing the embedding configuration.`;

    throw new DocumentLifecycleError("embedding", embeddingError);
  }

  return {
    embeddingStatus: "complete",
    result
  };
}

function validateStoredSource(document: StoredDocumentRecord, buffer: Buffer) {
  if (document.fileSize !== buffer.byteLength) {
    throw new Error("Stored source PDF size does not match the document record.");
  }

  if (document.contentSha256 && document.contentSha256 !== sha256Hex(buffer)) {
    throw new Error("Stored source PDF checksum does not match the document record.");
  }
}

function isStorageObjectMissingError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message === "missing" || error.message.includes("Storage object is missing") || hasErrorCode(error, "ENOENT");
}

function hasErrorCode(error: Error, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function cleanupAfterProcessingFailure(prisma: PrismaClientLike, documentId: string) {
  try {
    await prisma.$transaction(async (transaction) => {
      await deleteDerivedRows(transaction, documentId);
    });
  } catch {
    // Preserve the original processing failure as the public error.
  }
}

async function deleteDerivedRows(transaction: PrismaTransactionLike, documentId: string) {
  await transaction.documentChunk.deleteMany?.({
    where: {
      documentId
    }
  });
  await transaction.documentPage.deleteMany?.({
    where: {
      documentId
    }
  });
}

function parseStoredTags(tags: string) {
  try {
    const parsed = JSON.parse(tags);

    if (Array.isArray(parsed)) {
      return normalizeTagsInput(parsed);
    }
  } catch {
    return [];
  }

  return [];
}

async function withFailureStage<T>(stage: DocumentLifecycleStage, action: () => Promise<T> | T) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DocumentLifecycleError) {
      throw error;
    }

    throw new DocumentLifecycleError(stage, sanitizeFailureMessage(error), {
      cause: error
    });
  }
}

function getLifecycleStage(error: unknown): DocumentLifecycleStage {
  if (error instanceof DocumentLifecycleError) {
    return error.stage;
  }

  return "processing";
}
