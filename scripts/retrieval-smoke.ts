import type { PrismaTransactionLike } from "../src/lib/server/db";
import { searchHybridChunks, searchSemanticChunks } from "../src/lib/server/retrieval";

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

const semanticRows = [
  row("chunk_a", 1, 1, [1, 0], "Mitochondria make ATP."),
  row("chunk_b", 1, 2, [0, 1], "Photosynthesis stores glucose."),
  row("chunk_c", 2, 1, [1, 0], "ATP powers cell processes.")
];

const keywordRows = [
  keywordRow("chunk_b", 1, 2, 8),
  keywordRow("chunk_a", 1, 1, 7)
];

const db: PrismaTransactionLike = {
  studyDocument: delegate,
  documentPage: delegate,
  documentChunk: delegate,
  $executeRawUnsafe: async () => 0,
  $queryRawUnsafe: async <Result = unknown>(query: string) => {
    if (query.includes("DocumentChunkEmbedding")) {
      return semanticRows as Result;
    }

    return keywordRows as Result;
  }
};

const embeddingService = {
  model: "deterministic-smoke",
  embedTexts: async () => [[1, 0]]
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Retrieval smoke test failed.");
  process.exitCode = 1;
});

async function main() {
  const semantic = await searchSemanticChunks(db, { query: "ATP", limit: 3 }, embeddingService);
  const hybrid = await searchHybridChunks(db, { query: "ATP", limit: 3 }, embeddingService);

  console.log(
    JSON.stringify(
      {
        semantic: semantic.map((result) => ({
          chunkId: result.chunkId,
          rank: result.rank,
          similarity: result.ranking.semanticSimilarity
        })),
        hybrid: hybrid.map((result) => ({
          chunkId: result.chunkId,
          finalRank: result.ranking.finalRank,
          finalScore: result.ranking.finalScore,
          keywordRank: result.ranking.keywordRank ?? null,
          semanticRank: result.ranking.semanticRank ?? null
        }))
      },
      null,
      2
    )
  );
}

function keywordRow(chunkId: string, pageNumber: number, chunkIndex: number, score: number) {
  return {
    ...row(chunkId, pageNumber, chunkIndex, [0, 1], `${chunkId} keyword text.`),
    score
  };
}

function row(chunkId: string, pageNumber: number, chunkIndex: number, vector: number[], text: string) {
  return {
    chunkId,
    documentId: "doc_1",
    documentTitle: "Cell Energy Notes",
    originalFileName: "notes.pdf",
    className: "Biology",
    topic: "cells",
    tags: '["exam"]',
    pageNumber,
    chunkIndex,
    text,
    dimensions: vector.length,
    vectorJson: JSON.stringify(vector)
  };
}
