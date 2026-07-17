import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_UPLOAD_STATUS,
  deleteStoredDocument,
  processStoredDocument,
  sanitizeFailureMessage
} from "./document-lifecycle";
import { sha256Hex, type DocumentStorageAdapter } from "./storage";

const pdfBuffer = Buffer.from("%PDF-1.7\nfake lifecycle pdf\n");

describe("document lifecycle processing", () => {
  it("processes a stored PDF and marks the document ready", async () => {
    const state = createLifecycleState();
    const storage = createMemoryStorage(pdfBuffer);

    const result = await processStoredDocument({
      prisma: state.prisma,
      storage,
      documentId: state.document.id,
      extractPdf: async () => ({
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            text: "Mitochondria make ATP for the cell."
          }
        ]
      }),
      embeddingConfig: {
        apiKey: null,
        model: "text-embedding-3-small",
        dimensions: 1536
      }
    });

    assert.equal(result.status, DOCUMENT_UPLOAD_STATUS.READY);
    assert.equal(result.embeddingStatus, "skipped_missing_api_key");
    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.READY);
    assert.equal(state.document.pageCount, 1);
    assert.equal(state.document.processingAttemptCount, 1);
    assert.equal(state.pages.length, 1);
    assert.equal(state.chunks.length, 1);
    assert.equal(state.tags.length, 1);
  });

  it("clears previous derived rows before retrying so chunks are not duplicated", async () => {
    const state = createLifecycleState();
    const storage = createMemoryStorage(pdfBuffer);
    const input = {
      prisma: state.prisma,
      storage,
      documentId: state.document.id,
      extractPdf: async () => ({
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            text: "Retry-safe processing stores exactly one chunk."
          }
        ]
      }),
      embeddingConfig: {
        apiKey: null,
        model: "text-embedding-3-small",
        dimensions: 1536
      }
    };

    await processStoredDocument(input);
    await processStoredDocument(input);

    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.READY);
    assert.equal(state.document.processingAttemptCount, 2);
    assert.equal(state.pages.length, 1);
    assert.equal(state.chunks.length, 1);
  });

  it("marks processing failures as failed and removes partial derived rows", async () => {
    const state = createLifecycleState({
      pages: [{ documentId: "doc_1", pageNumber: 1, text: "old page" }],
      chunks: [{ id: "old_chunk", documentId: "doc_1", pageNumber: 1, chunkIndex: 0, text: "old chunk" }]
    });
    const storage = createMemoryStorage(pdfBuffer);

    await assert.rejects(
      () =>
        processStoredDocument({
          prisma: state.prisma,
          storage,
          documentId: state.document.id,
          extractPdf: async () => {
            throw new Error("pdf parser failed");
          },
          embeddingConfig: {
            apiKey: null,
            model: "text-embedding-3-small",
            dimensions: 1536
          }
        }),
      /pdf parser failed/
    );

    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.FAILED);
    assert.equal(state.document.failureStage, "pdf_extract");
    assert.equal(state.pages.length, 0);
    assert.equal(state.chunks.length, 0);
  });

  it("reports missing storage objects as retry-eligible failures", async () => {
    const state = createLifecycleState();
    const storage = createMemoryStorage(null);

    await assert.rejects(
      () =>
        processStoredDocument({
          prisma: state.prisma,
          storage,
          documentId: state.document.id,
          embeddingConfig: {
            apiKey: null,
            model: "text-embedding-3-small",
            dimensions: 1536
          }
        }),
      /Stored source PDF is missing/
    );

    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.FAILED);
    assert.equal(state.document.failureStage, "storage_read");
  });

  it("fails fast when stored source checksums do not match", async () => {
    const state = createLifecycleState({
      document: {
        contentSha256: sha256Hex(Buffer.from("different"))
      }
    });
    const storage = createMemoryStorage(pdfBuffer);

    await assert.rejects(
      () =>
        processStoredDocument({
          prisma: state.prisma,
          storage,
          documentId: state.document.id,
          embeddingConfig: {
            apiKey: null,
            model: "text-embedding-3-small",
            dimensions: 1536
          }
        }),
      /checksum/
    );

    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.FAILED);
    assert.equal(state.document.failureStage, "checksum");
  });

  it("redacts secrets from persisted failure messages", () => {
    const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-service-role-token";

    assert.equal(
      sanitizeFailureMessage(new Error("request failed with secret-service-role-token")),
      "request failed with [redacted]"
    );

    if (previousSecret === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
    }
  });

  it("deletes storage and then cascades the database document", async () => {
    const state = createLifecycleState({
      document: {
        uploadStatus: DOCUMENT_UPLOAD_STATUS.READY
      }
    });
    const storage = createMemoryStorage(pdfBuffer);
    const result = await deleteStoredDocument({
      prisma: state.prisma,
      storage,
      documentId: state.document.id
    });

    assert.deepEqual(result, {
      documentId: state.document.id,
      status: "deleted",
      storage: "deleted"
    });
    assert.equal(state.deleted, true);
  });

  it("treats repeated deletion after database removal as already missing", async () => {
    const state = createLifecycleState();

    await deleteStoredDocument({
      prisma: state.prisma,
      storage: createMemoryStorage(pdfBuffer),
      documentId: state.document.id
    });

    assert.deepEqual(
      await deleteStoredDocument({
        prisma: state.prisma,
        storage: createMemoryStorage(pdfBuffer),
        documentId: state.document.id
      }),
      {
        documentId: state.document.id,
        status: "missing"
      }
    );
  });

  it("continues deletion when the storage object is already missing", async () => {
    const state = createLifecycleState();
    const result = await deleteStoredDocument({
      prisma: state.prisma,
      storage: createMemoryStorage(null),
      documentId: state.document.id
    });

    assert.equal(result.status, "deleted");
    assert.equal(result.storage, "already_missing");
    assert.equal(state.deleted, true);
  });

  it("leaves the document in DELETING when storage deletion fails", async () => {
    const state = createLifecycleState();

    await assert.rejects(
      () =>
        deleteStoredDocument({
          prisma: state.prisma,
          storage: createFailingDeleteStorage("storage is unavailable"),
          documentId: state.document.id
        }),
      /storage is unavailable/
    );

    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.DELETING);
    assert.equal(state.document.failureStage, "storage_delete");
    assert.equal(state.deleted, false);
  });

  it("keeps DELETING diagnostics when database deletion fails after storage deletion", async () => {
    const state = createLifecycleState({
      deleteFails: true
    });

    await assert.rejects(
      () =>
        deleteStoredDocument({
          prisma: state.prisma,
          storage: createMemoryStorage(pdfBuffer),
          documentId: state.document.id
        }),
      /database delete failed/
    );

    assert.equal(state.document.uploadStatus, DOCUMENT_UPLOAD_STATUS.DELETING);
    assert.equal(state.document.failureStage, "database_delete");
    assert.equal(state.deleted, false);
  });
});

function createLifecycleState(
  overrides: {
    document?: Partial<LifecycleDocument>;
    pages?: Array<Record<string, unknown>>;
    chunks?: Array<Record<string, unknown>>;
    deleteFails?: boolean;
  } = {}
) {
  const document: LifecycleDocument = {
    id: "doc_1",
    ownerId: "11111111-1111-4111-8111-111111111111",
    originalFileName: "source.pdf",
    storedFileName: "documents/source.pdf",
    fileSize: pdfBuffer.byteLength,
    mimeType: "application/pdf",
    tags: JSON.stringify(["Biology"]),
    uploadStatus: DOCUMENT_UPLOAD_STATUS.UPLOADING,
    pageCount: null,
    failureStage: null,
    failureReason: null,
    processingAttemptCount: 0,
    storageProvider: "local",
    storageBucket: "local",
    storageObjectKey: "documents/source.pdf",
    contentSha256: sha256Hex(pdfBuffer),
    ...overrides.document
  };
  const pages = [...(overrides.pages ?? [])];
  const chunks = [...(overrides.chunks ?? [])];
  const tags: Array<{ id: string; ownerId: string; name: string; normalizedName: string }> = [];
  const documentTags: Array<{ documentId: string; tagId: string }> = [];
  let deleted = false;
  const prisma: any = {
    studyDocument: {
      findUnique: async () => (deleted ? null : document),
      update: async (args: { data: Record<string, unknown> }) => {
        applyUpdate(document, args.data);
        return document;
      },
      create: async () => document,
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      delete: async () => {
        if (overrides.deleteFails) {
          throw new Error("database delete failed");
        }

        deleted = true;
        return document;
      }
    },
    documentPage: {
      findUnique: async () => null,
      findMany: async () => pages,
      create: async () => ({}),
      update: async () => ({}),
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        pages.push(...args.data.map((page, index) => ({ id: `page_${index + 1}`, ...page })));
        return { count: args.data.length };
      },
      deleteMany: async (args: { where: { documentId: string } }) => {
        removeWhere(pages, (page) => page.documentId === args.where.documentId);
        return { count: 0 };
      }
    },
    documentChunk: {
      findUnique: async () => null,
      findMany: async () =>
        chunks.map((chunk) => ({
          id: chunk.id,
          documentId: chunk.documentId,
          text: chunk.text
        })),
      create: async () => ({}),
      update: async () => ({}),
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        chunks.push(...args.data.map((chunk, index) => ({ id: `chunk_${index + 1}`, ...chunk })));
        return { count: args.data.length };
      },
      deleteMany: async (args: { where: { documentId: string } }) => {
        removeWhere(chunks, (chunk) => chunk.documentId === args.where.documentId);
        return { count: 0 };
      }
    },
    tag: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      createMany: async () => ({ count: 0 }),
      upsert: async (args: { create: { ownerId: string; name: string; normalizedName: string } }) => {
        const existing = tags.find(
          (tag) => tag.ownerId === args.create.ownerId && tag.normalizedName === args.create.normalizedName
        );

        if (existing) {
          return existing;
        }

        const tag = {
          id: `tag_${tags.length + 1}`,
          ownerId: args.create.ownerId,
          name: args.create.name,
          normalizedName: args.create.normalizedName
        };
        tags.push(tag);

        return tag;
      }
    },
    documentTag: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async (args: { data: { documentId: string; tagId: string } }) => {
        documentTags.push(args.data);
        return args.data;
      },
      update: async () => ({}),
      createMany: async () => ({ count: 0 }),
      deleteMany: async (args: { where: { documentId: string } }) => {
        removeWhere(documentTags, (tag) => tag.documentId === args.where.documentId);
        return { count: 0 };
      }
    },
    $transaction: async <Result>(callback: (transaction: typeof prisma) => Promise<Result>) => callback(prisma),
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <Result = unknown>() => [] as Result
  };

  return {
    document,
    pages,
    chunks,
    tags,
    documentTags,
    prisma,
    get deleted() {
      return deleted;
    }
  };
}

type LifecycleDocument = {
  id: string;
  ownerId: string;
  originalFileName: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string;
  tags: string;
  uploadStatus: string;
  pageCount: number | null;
  failureStage: string | null;
  failureReason: string | null;
  processingAttemptCount: number;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
  contentSha256: string | null;
};

function createMemoryStorage(body: Buffer | null): DocumentStorageAdapter {
  return {
    provider: "local",
    bucket: "local",
    uploadPdf: async () => {
      throw new Error("not used");
    },
    readPdf: async () => {
      if (!body) {
        throw new Error("missing");
      }

      return body;
    },
    exists: async () => Boolean(body),
    createSignedUrl: async () => null,
    deleteObject: async () => ({ deleted: Boolean(body), missing: !body }),
    listObjects: async () => []
  };
}

function createFailingDeleteStorage(message: string): DocumentStorageAdapter {
  return {
    provider: "local",
    bucket: "local",
    uploadPdf: async () => {
      throw new Error("not used");
    },
    readPdf: async () => pdfBuffer,
    exists: async () => true,
    createSignedUrl: async () => null,
    deleteObject: async () => {
      throw new Error(message);
    },
    listObjects: async () => []
  };
}

function applyUpdate(document: LifecycleDocument, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (key === "processingAttemptCount" && isIncrement(value)) {
      document.processingAttemptCount += value.increment;
      continue;
    }

    (document as unknown as Record<string, unknown>)[key] = value;
  }
}

function isIncrement(value: unknown): value is { increment: number } {
  return typeof value === "object" && value !== null && "increment" in value && typeof value.increment === "number";
}

function removeWhere(values: Array<Record<string, unknown>>, predicate: (value: Record<string, unknown>) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      values.splice(index, 1);
    }
  }
}
