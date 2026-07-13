// @ts-nocheck
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { chunkPageText } from "@/lib/chunking";
import { getEmbeddingRuntimeConfig } from "@/lib/server/embedding-config";
import { createOpenAIEmbeddingService } from "@/lib/server/embedding-service";
import { syncChunkEmbeddings, type EmbeddingSyncResult } from "@/lib/server/embedding-sync";
import { getPrisma } from "@/lib/server/db";
import {
  normalizeTagsInput,
  parseDateOnly,
  replaceDocumentTags,
  serializeNormalizedTags,
  type MetadataTagTransaction
} from "@/lib/server/metadata";
import { extractPdfTextByPage } from "@/lib/server/pdf-extraction";
import { ensureChunkSearchIndex, syncDocumentSearchIndex, type SearchIndexChunk } from "@/lib/server/search-index";
import { ensureLocalStorage, getStoredPdfPath } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  let documentId: string | null = null;

  try {
    const prisma = await getPrisma();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "The uploaded PDF is empty." }, { status: 400 });
    }

    if (file.size > MAX_PDF_UPLOAD_BYTES) {
      return NextResponse.json({ error: "PDF uploads are limited to 25 MB for local development." }, { status: 413 });
    }

    const originalFileName = sanitizeOriginalFileName(file.name);

    if (!isPdfLike(file, originalFileName)) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!hasPdfHeader(buffer)) {
      return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 415 });
    }

    const metadata = parseUploadMetadata(formData);

    if (!metadata.ok) {
      return NextResponse.json({ error: metadata.error }, { status: 400 });
    }

    await ensureLocalStorage();

    const storedFileName = `${randomUUID()}.pdf`;
    await writeFile(getStoredPdfPath(storedFileName), buffer);

    const document = (await prisma.studyDocument.create({
      data: {
        originalFileName,
        storedFileName,
        fileSize: file.size,
        mimeType: file.type || "application/pdf",
        title: getTextField(formData, "title") || titleFromFileName(originalFileName),
        className: metadata.value.className,
        topic: metadata.value.topic,
        source: metadata.value.source,
        documentDate: metadata.value.documentDate,
        tags: serializeNormalizedTags(metadata.value.tags),
        uploadStatus: "uploaded"
      }
    })) as { id: string };
    documentId = document.id;

    await prisma.studyDocument.update({
      where: {
        id: document.id
      },
      data: {
        uploadStatus: "processing",
        failureReason: null
      }
    });

    const extractedPdf = await extractPdfTextByPage(buffer);
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

    await ensureChunkSearchIndex(prisma);

    await prisma.$transaction(async (transaction) => {
      await replaceDocumentTags(transaction as MetadataTagTransaction, document.id, metadata.value.tags);

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

      await transaction.studyDocument.update({
        where: {
          id: document.id
        },
        data: {
          uploadStatus: "ready",
          pageCount: extractedPdf.pageCount,
          failureReason: null
        }
      });
    });
    const embeddingOutcome = await syncUploadedDocumentEmbeddings(prisma, document.id, searchableChunks);

    return NextResponse.json(
      {
        documentId: document.id,
        originalFileName,
        pageCount: extractedPdf.pageCount,
        chunkCount: chunkRows.length,
        status: "ready",
        embeddingStatus: embeddingOutcome.embeddingStatus,
        embeddingError: embeddingOutcome.embeddingError
      },
      { status: 201 }
    );
  } catch {
    if (documentId) {
      await markDocumentFailed(documentId);
    }

    return NextResponse.json(
      {
        documentId,
        error: "PDF processing failed.",
        status: "failed"
      },
      { status: 500 }
    );
  }
}

async function syncUploadedDocumentEmbeddings(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  documentId: string,
  chunks: SearchIndexChunk[]
): Promise<{
  embeddingStatus: "skipped_missing_api_key" | "complete" | "failed";
  embeddingError?: string;
  result?: EmbeddingSyncResult;
}> {
  const config = getEmbeddingRuntimeConfig();

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
      "Embedding generation failed after PDF extraction. Run npm run embeddings:backfill after fixing the embedding configuration.";

    await prisma.studyDocument.update({
      where: {
        id: documentId
      },
      data: {
        uploadStatus: "ready",
        failureReason: `PDF extraction succeeded, but embedding generation failed for ${result.failed} chunk(s). ${embeddingError}`
      }
    });

    return {
      embeddingStatus: "failed",
      embeddingError,
      result
    };
  }

  return {
    embeddingStatus: "complete",
    result
  };
}

async function markDocumentFailed(documentId: string) {
  try {
    const prisma = await getPrisma();

    await prisma.studyDocument.update({
      where: {
        id: documentId
      },
      data: {
        uploadStatus: "failed",
        failureReason: "PDF processing failed."
      }
    });
  } catch {
    // Keep the public upload error safe even if failure-state persistence also fails.
  }
}

function sanitizeOriginalFileName(fileName: string) {
  const baseName = fileName.split(/[/\\]/).pop() || "document.pdf";
  const safeName = path.basename(baseName).replace(/[^\w .()-]+/g, "_").trim();

  return safeName || "document.pdf";
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled PDF";
}

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseUploadMetadata(formData: FormData):
  | {
      ok: true;
      value: {
        className: string | null;
        topic: string | null;
        source: string | null;
        documentDate: Date | null;
        tags: ReturnType<typeof normalizeTagsInput>;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  try {
    return {
      ok: true,
      value: {
        className: getTextField(formData, "className"),
        topic: getTextField(formData, "topic"),
        source: getTextField(formData, "source"),
        documentDate: parseDateOnly(getTextField(formData, "documentDate"), "documentDate"),
        tags: normalizeTagsInput(splitTagsField(getTextField(formData, "tags") ?? ""))
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid metadata."
    };
  }
}

function splitTagsField(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isPdfLike(file: File, originalFileName: string) {
  const mimeType = file.type.toLowerCase();

  return originalFileName.toLowerCase().endsWith(".pdf") && (!mimeType || mimeType === "application/pdf");
}

function hasPdfHeader(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}
