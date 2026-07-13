import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaTransactionLike } from "./db";
import { hashEmbeddingContent } from "./embedding-hash";
import { validateEmbeddingStore } from "./embedding-validation";

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

describe("embedding store validation", () => {
  it("reports counts and embedding integrity problems", async () => {
    const db = createValidationDb({
      chunks: [
        row("chunk_ok", "ATP text", {
          embeddingId: "embedding_ok",
          embeddingModel: "model-a",
          dimensions: 2,
          vectorDimensions: 2,
          contentHash: hashEmbeddingContent("ATP text")
        }),
        row("chunk_missing", "Missing text", null),
        row("chunk_stale", "Changed text", {
          embeddingId: "embedding_stale",
          embeddingModel: "model-a",
          dimensions: 2,
          vectorDimensions: 2,
          contentHash: hashEmbeddingContent("Old text")
        }),
        row("chunk_wrong_dimensions", "Wrong dimensions", {
          embeddingId: "embedding_wrong_dimensions",
          embeddingModel: "model-a",
          dimensions: 3,
          vectorDimensions: 3,
          contentHash: hashEmbeddingContent("Wrong dimensions")
        })
      ],
      duplicates: [
        {
          documentId: "doc_1",
          pageNumber: 1,
          chunkIndex: 1,
          count: 2
        }
      ]
    });

    const report = await validateEmbeddingStore(db, {
      model: "model-a",
      dimensions: 2
    });

    assert.equal(report.ok, false);
    assert.equal(report.documentCount, 1);
    assert.equal(report.pageCount, 2);
    assert.equal(report.chunkCount, 4);
    assert.equal(report.embeddingCount, 3);
    assert.deepEqual(report.missingEmbeddings, ["chunk_missing"]);
    assert.deepEqual(report.staleEmbeddings, ["chunk_stale"]);
    assert.deepEqual(report.invalidDimensionVectors, [
      {
        chunkId: "chunk_wrong_dimensions",
        storedDimensions: 3,
        vectorDimensions: 3
      }
    ]);
    assert.deepEqual(report.duplicateChunks, [
      {
        documentId: "doc_1",
        pageNumber: 1,
        chunkIndex: 1,
        count: 2
      }
    ]);
  });

  it("passes when every chunk has a fresh embedding with valid dimensions", async () => {
    const db = createValidationDb({
      chunks: [
        row("chunk_ok", "ATP text", {
          embeddingId: "embedding_ok",
          embeddingModel: "model-a",
          dimensions: 2,
          vectorDimensions: 2,
          contentHash: hashEmbeddingContent("ATP text")
        })
      ],
      duplicates: []
    });

    const report = await validateEmbeddingStore(db, {
      model: "model-a",
      dimensions: 2
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.missingEmbeddings, []);
    assert.deepEqual(report.staleEmbeddings, []);
    assert.deepEqual(report.invalidDimensionVectors, []);
    assert.deepEqual(report.duplicateChunks, []);
  });
});

function createValidationDb({
  chunks,
  duplicates
}: {
  chunks: ValidationRow[];
  duplicates: Array<{
    documentId: string;
    pageNumber: number;
    chunkIndex: number;
    count: number;
  }>;
}): PrismaTransactionLike {
  return {
    studyDocument: delegate,
    documentPage: delegate,
    documentChunk: delegate,
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <Result = unknown>(query: string) => {
      if (query.includes('COUNT(*) FROM "StudyDocument"')) {
        return [
          {
            documentCount: 1,
            pageCount: 2,
            chunkCount: chunks.length,
            embeddingCount: chunks.filter((chunk) => chunk.embeddingId).length
          }
        ] as Result;
      }

      if (query.includes("vector_dims")) {
        return chunks as Result;
      }

      if (query.includes("HAVING COUNT(*) > 1")) {
        return duplicates as Result;
      }

      return [] as Result;
    }
  };
}

type ValidationRow = {
  chunkId: string;
  text: string;
  embeddingId: string | null;
  embeddingModel: string | null;
  dimensions: number | null;
  vectorDimensions: number | null;
  contentHash: string | null;
};

function row(
  chunkId: string,
  text: string,
  embedding: Omit<ValidationRow, "chunkId" | "text"> | null
): ValidationRow {
  return {
    chunkId,
    text,
    embeddingId: embedding?.embeddingId ?? null,
    embeddingModel: embedding?.embeddingModel ?? null,
    dimensions: embedding?.dimensions ?? null,
    vectorDimensions: embedding?.vectorDimensions ?? null,
    contentHash: embedding?.contentHash ?? null
  };
}
