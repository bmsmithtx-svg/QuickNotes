import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getEmbeddingRuntimeConfig, requireEmbeddingRuntimeConfig } from "./embedding-config";
import type { PrismaTransactionLike } from "./db";
import { resolveSearchMode, searchHybridChunks, searchSemanticChunks } from "./retrieval";

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

type FakeRow = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName: string;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: string | null;
  tags: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
};

function createDb({
  keywordRows = [],
  semanticRows = [],
  seenQueries = []
}: {
  keywordRows?: Array<FakeRow & { score: number }>;
  semanticRows?: Array<FakeRow & { dimensions: number; similarity: number }>;
  seenQueries?: Array<{ query: string; values: unknown[] }>;
}): PrismaTransactionLike {
  return {
    studyDocument: delegate,
    documentPage: delegate,
    documentChunk: delegate,
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <Result = unknown>(query: string, ...values: unknown[]) => {
      seenQueries.push({ query, values });

      if (query.includes("DocumentChunkEmbedding")) {
        return semanticRows as Result;
      }

      return keywordRows as Result;
    }
  };
}

const embeddingService = {
  model: "test-embedding",
  dimensions: 2,
  embedTexts: async () => [[1, 0]]
};

describe("semantic retrieval", () => {
  it("ranks chunks by cosine similarity and preserves citation metadata", async () => {
    const db = createDb({
      semanticRows: [
        semanticRow("chunk_b", "doc_1", 1, 2, [0, 1], "Irrelevant plant cell text."),
        semanticRow("chunk_a", "doc_1", 1, 1, [1, 0], "Mitochondria make ATP."),
        semanticRow("chunk_c", "doc_1", 2, 1, [1, 0], "ATP is stored and used.")
      ]
    });

    const results = await searchSemanticChunks(db, { query: "ATP", limit: 3 }, embeddingService);

    assert.deepEqual(results.map((result) => result.chunkId), ["chunk_a", "chunk_c", "chunk_b"]);
    assert.equal(results[0].ranking.semanticRank, 1);
    assert.equal(results[0].ranking.semanticSimilarity, 1);
    assert.equal(results[0].documentId, "doc_1");
    assert.equal(results[0].originalFileName, "notes.pdf");
    assert.equal(results[0].pageNumber, 1);
    assert.equal(results[0].chunkIndex, 1);
    assert.deepEqual(results[0].citation, {
      id: "chunk_a",
      fileName: "notes.pdf",
      pageNumber: 1,
      chunkIndex: 1,
      sourceChunk: "Mitochondria make ATP."
    });
  });

  it("uses pgvector SQL for database-side semantic ranking", async () => {
    const seenQueries: Array<{ query: string; values: unknown[] }> = [];
    const db = createDb({
      seenQueries,
      semanticRows: [semanticRow("chunk_a", "doc_1", 1, 1, [1, 0], "Mitochondria make ATP.")]
    });

    await searchSemanticChunks(db, { query: "ATP", limit: 3 }, embeddingService);

    const semanticQuery = seenQueries.find((query) => query.query.includes("DocumentChunkEmbedding"));

    assert.ok(semanticQuery);
    assert.match(semanticQuery.query, /embedding\."vector" <=> \$2::vector/);
    assert.match(semanticQuery.query, /embedding\."dimensions" = \$3/);
    assert.match(semanticQuery.query, /LIMIT \$4/);
    assert.deepEqual(semanticQuery.values, ["test-embedding", "[1,0]", 2, 3]);
  });

  it("applies shared metadata filters before semantic ranking", async () => {
    const seenQueries: Array<{ query: string; values: unknown[] }> = [];
    const db = createDb({
      seenQueries,
      semanticRows: [semanticRow("chunk_a", "doc_1", 1, 1, [1, 0], "Mitochondria make ATP.")]
    });

    await searchSemanticChunks(
      db,
      {
        query: "ATP",
        filters: {
          classNames: ["Biology"],
          topics: ["cells"],
          tags: ["Exam"],
          documentDateFrom: "2026-07-01",
          documentDateTo: "2026-07-31"
        },
        limit: 3
      },
      embeddingService
    );

    const semanticQuery = seenQueries.find((query) => query.query.includes("DocumentChunkEmbedding"));

    assert.ok(semanticQuery);
    assert.match(semanticQuery.query, /"document"\."className" = \$4/);
    assert.match(semanticQuery.query, /"filterTag"\."normalizedName" IN \(\$8\)/);
    assert.deepEqual(semanticQuery.values.slice(0, 6), [
      "test-embedding",
      "[1,0]",
      2,
      "Biology",
      "cells",
      "2026-07-01"
    ]);
    assert.equal(semanticQuery.values.at(-2), "exam");
  });
});

describe("hybrid retrieval", () => {
  it("deduplicates chunks and combines keyword and semantic ranks with RRF", async () => {
    const db = createDb({
      keywordRows: [
        keywordRow("chunk_b", 1, 2, 9),
        keywordRow("chunk_a", 1, 1, 8)
      ],
      semanticRows: [
        semanticRow("chunk_a", "doc_1", 1, 1, [1, 0], "Mitochondria make ATP."),
        semanticRow("chunk_c", "doc_1", 2, 1, [1, 0], "ATP is stored and used."),
        semanticRow("chunk_b", "doc_1", 1, 2, [0, 1], "Keyword-only ATP mention.")
      ]
    });

    const results = await searchHybridChunks(db, { query: "ATP", limit: 3 }, embeddingService);

    assert.deepEqual(results.map((result) => result.chunkId), ["chunk_a", "chunk_b", "chunk_c"]);
    assert.equal(new Set(results.map((result) => result.chunkId)).size, results.length);
    assert.equal(results[0].ranking.keywordRank, 2);
    assert.equal(results[0].ranking.keywordScore, 8);
    assert.equal(results[0].ranking.semanticRank, 1);
    assert.equal(results[0].ranking.semanticSimilarity, 1);
    assert.equal(results[0].ranking.mode, "hybrid");
    assert.equal(results[0].rank, 1);
    assert.equal(results[0].score, results[0].ranking.finalScore);
  });

  it("uses deterministic ordering when final RRF scores tie", async () => {
    const db = createDb({
      keywordRows: [keywordRow("chunk_keyword", 1, 1, 4)],
      semanticRows: [semanticRow("chunk_semantic", "doc_1", 1, 2, [1, 0], "Semantic only match.")]
    });

    const results = await searchHybridChunks(db, { query: "ATP", limit: 2 }, embeddingService);

    assert.deepEqual(results.map((result) => result.chunkId), ["chunk_keyword", "chunk_semantic"]);
    assert.equal(results[0].ranking.finalScore, results[1].ranking.finalScore);
  });

  it("passes the same filters into keyword and semantic retrieval for hybrid search", async () => {
    const seenQueries: Array<{ query: string; values: unknown[] }> = [];
    const db = createDb({
      seenQueries,
      keywordRows: [keywordRow("chunk_a", 1, 1, 8)],
      semanticRows: [semanticRow("chunk_a", "doc_1", 1, 1, [1, 0], "Mitochondria make ATP.")]
    });

    await searchHybridChunks(
      db,
      {
        query: "ATP",
        filters: {
          documentIds: ["doc_1"],
          sources: ["Course notes"],
          tags: ["exam"]
        },
        limit: 2
      },
      embeddingService
    );

    const retrievalQueries = seenQueries.filter((query) => query.query.includes("StudyDocument"));

    assert.equal(retrievalQueries.length, 2);

    for (const query of retrievalQueries) {
      assert.match(query.query, /"document"\."id" = \$\d+/);
      assert.match(query.query, /"document"\."source" = \$\d+/);
      assert.match(query.query, /"filterTag"\."normalizedName" IN \(\$\d+\)/);
      assert.ok(query.values.includes("doc_1"));
      assert.ok(query.values.includes("Course notes"));
      assert.ok(query.values.includes("exam"));
    }
  });
});

describe("search mode availability", () => {
  it("defaults to keyword when semantic retrieval is unavailable", () => {
    assert.equal(resolveSearchMode({ requestedMode: null, semanticAvailable: false }), "keyword");
    assert.equal(resolveSearchMode({ requestedMode: null, semanticAvailable: true }), "hybrid");
  });

  it("reports missing API key without requiring network access", () => {
    assert.deepEqual(getEmbeddingRuntimeConfig({}), {
      apiKey: null,
      model: "text-embedding-3-small",
      dimensions: 1536
    });
    assert.throws(() => requireEmbeddingRuntimeConfig({}), /OPENAI_API_KEY is required/);
  });
});

function keywordRow(chunkId: string, pageNumber: number, chunkIndex: number, score: number): FakeRow & { score: number } {
  return {
    ...baseRow(chunkId, pageNumber, chunkIndex, `${chunkId} keyword text.`),
    score
  };
}

function semanticRow(
  chunkId: string,
  documentId: string,
  pageNumber: number,
  chunkIndex: number,
  vector: number[],
  text: string
): FakeRow & { dimensions: number; similarity: number } {
  return {
    ...baseRow(chunkId, pageNumber, chunkIndex, text, documentId),
    dimensions: vector.length,
    similarity: vector[0] ?? 0
  };
}

function baseRow(chunkId: string, pageNumber: number, chunkIndex: number, text: string, documentId = "doc_1"): FakeRow {
  return {
    chunkId,
    documentId,
    documentTitle: "Cell Energy Notes",
    originalFileName: "notes.pdf",
    className: "Biology",
    topic: "cells",
    source: "Course notes",
    documentDate: null,
    tags: '["exam"]',
    pageNumber,
    chunkIndex,
    text
  };
}
