import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaTransactionLike } from "./db";
import { backfillChunkEmbeddings, type ChunkForEmbedding, type StoredEmbeddingRow } from "./embedding-sync";

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

describe("embedding backfill", () => {
  it("is idempotent and skips unchanged chunk/model pairs", async () => {
    const chunks = [
      { id: "chunk_1", text: "alpha notes" },
      { id: "chunk_2", text: "beta notes" }
    ];
    const db = createEmbeddingDb(chunks);
    const embeddingService = createFakeEmbeddingService("model-a");

    const first = await backfillChunkEmbeddings(db, embeddingService);
    const second = await backfillChunkEmbeddings(db, embeddingService);

    assert.deepEqual(first, {
      processed: 2,
      skipped: 0,
      succeeded: 2,
      failed: 0,
      model: "model-a",
      errorMessage: undefined
    });
    assert.equal(second.processed, 2);
    assert.equal(second.skipped, 2);
    assert.equal(second.succeeded, 0);
    assert.equal(second.failed, 0);
    assert.equal(embeddingService.callCount, 1);
  });

  it("re-embeds when the chunk text hash changes", async () => {
    const chunks = [{ id: "chunk_1", text: "alpha notes" }];
    const db = createEmbeddingDb(chunks);
    const embeddingService = createFakeEmbeddingService("model-a");

    await backfillChunkEmbeddings(db, embeddingService);
    chunks[0] = { id: "chunk_1", text: "alpha notes revised" };

    const changed = await backfillChunkEmbeddings(db, embeddingService);

    assert.equal(changed.skipped, 0);
    assert.equal(changed.succeeded, 1);
    assert.equal(embeddingService.callCount, 2);
  });

  it("re-embeds when the configured model changes", async () => {
    const chunks = [{ id: "chunk_1", text: "alpha notes" }];
    const db = createEmbeddingDb(chunks);

    await backfillChunkEmbeddings(db, createFakeEmbeddingService("model-a"));
    const modelB = createFakeEmbeddingService("model-b");
    const changed = await backfillChunkEmbeddings(db, modelB);

    assert.equal(changed.skipped, 0);
    assert.equal(changed.succeeded, 1);
    assert.equal(modelB.callCount, 1);
    assert.equal(db.embeddings.get("chunk_1")?.embeddingModel, "model-b");
  });

  it("rebuilds all embeddings when explicitly requested", async () => {
    const chunks = [{ id: "chunk_1", text: "alpha notes" }];
    const db = createEmbeddingDb(chunks);
    const embeddingService = createFakeEmbeddingService("model-a");

    await backfillChunkEmbeddings(db, embeddingService);
    const rebuilt = await backfillChunkEmbeddings(db, embeddingService, { mode: "all" });

    assert.equal(rebuilt.skipped, 0);
    assert.equal(rebuilt.succeeded, 1);
    assert.equal(embeddingService.callCount, 2);
  });

  it("fails clearly when a vector does not match the configured dimensions", async () => {
    const chunks = [{ id: "chunk_1", text: "alpha notes" }];
    const db = createEmbeddingDb(chunks);
    const embeddingService = createFakeEmbeddingService("model-a", 3);

    const result = await backfillChunkEmbeddings(db, embeddingService);

    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 1);
    assert.match(result.errorMessage ?? "", /Embedding dimensions mismatch: expected 3, got 2/);
  });
});

function createFakeEmbeddingService(model: string, dimensions = 2) {
  return {
    model,
    dimensions,
    callCount: 0,
    async embedTexts(texts: string[]) {
      this.callCount += 1;

      return texts.map((text) => (text.includes("alpha") ? [1, 0] : [0, 1]));
    }
  };
}

function createEmbeddingDb(chunks: ChunkForEmbedding[]) {
  const embeddings = new Map<string, StoredEmbeddingRow>();
  const db: PrismaTransactionLike & { embeddings: Map<string, StoredEmbeddingRow> } = {
    embeddings,
    studyDocument: delegate,
    documentPage: delegate,
    documentChunk: {
      ...delegate,
      findMany: async () => chunks
    },
    $executeRawUnsafe: async (query, ...values) => {
      if (query.includes('INSERT INTO "DocumentChunkEmbedding"')) {
        const chunkId = values[1] as string;
        const embeddingModel = values[2] as string;
        const dimensions = values[3] as number;
        const contentHash = values[5] as string;

        embeddings.set(chunkId, {
          chunkId,
          embeddingModel,
          dimensions,
          contentHash
        });
      }

      return 0;
    },
    $queryRawUnsafe: async <Result = unknown>(query: string) => {
      if (query.includes('"DocumentChunkEmbedding"')) {
        return Array.from(embeddings.values()) as Result;
      }

      return [] as Result;
    }
  };

  return db;
}
