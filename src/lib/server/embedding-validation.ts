import type { PrismaTransactionLike } from "./db";
import { hashEmbeddingContent } from "./embedding-hash";

export type EmbeddingValidationConfig = {
  model: string;
  dimensions: number;
};

export type EmbeddingValidationReport = {
  ok: boolean;
  model: string;
  dimensions: number;
  documentCount: number;
  pageCount: number;
  chunkCount: number;
  embeddingCount: number;
  missingEmbeddings: string[];
  staleEmbeddings: string[];
  invalidDimensionVectors: Array<{
    chunkId: string;
    storedDimensions: number | null;
    vectorDimensions: number | null;
  }>;
  duplicateChunks: Array<{
    documentId: string;
    pageNumber: number;
    chunkIndex: number;
    count: number;
  }>;
};

type CountRow = {
  documentCount: number | bigint;
  pageCount: number | bigint;
  chunkCount: number | bigint;
  embeddingCount: number | bigint;
};

type ChunkEmbeddingValidationRow = {
  chunkId: string;
  text: string;
  embeddingId: string | null;
  embeddingModel: string | null;
  dimensions: number | bigint | null;
  vectorDimensions: number | bigint | null;
  contentHash: string | null;
};

type DuplicateChunkRow = {
  documentId: string;
  pageNumber: number | bigint;
  chunkIndex: number | bigint;
  count: number | bigint;
};

export async function validateEmbeddingStore(
  db: PrismaTransactionLike,
  config: EmbeddingValidationConfig
): Promise<EmbeddingValidationReport> {
  const [counts, rows, duplicateRows] = await Promise.all([
    getCounts(db),
    getChunkEmbeddingRows(db),
    getDuplicateChunks(db)
  ]);
  const missingEmbeddings: string[] = [];
  const staleEmbeddings: string[] = [];
  const invalidDimensionVectors: EmbeddingValidationReport["invalidDimensionVectors"] = [];

  for (const row of rows) {
    if (!row.embeddingId) {
      missingEmbeddings.push(row.chunkId);
      continue;
    }

    const storedDimensions = nullableNumber(row.dimensions);
    const vectorDimensions = nullableNumber(row.vectorDimensions);

    if (row.embeddingModel !== config.model || row.contentHash !== hashEmbeddingContent(row.text)) {
      staleEmbeddings.push(row.chunkId);
    }

    if (storedDimensions !== config.dimensions || vectorDimensions !== config.dimensions) {
      invalidDimensionVectors.push({
        chunkId: row.chunkId,
        storedDimensions,
        vectorDimensions
      });
    }
  }

  const duplicateChunks = duplicateRows.map((row) => ({
    documentId: row.documentId,
    pageNumber: Number(row.pageNumber),
    chunkIndex: Number(row.chunkIndex),
    count: Number(row.count)
  }));

  return {
    ok:
      missingEmbeddings.length === 0 &&
      staleEmbeddings.length === 0 &&
      invalidDimensionVectors.length === 0 &&
      duplicateChunks.length === 0,
    model: config.model,
    dimensions: config.dimensions,
    documentCount: Number(counts.documentCount),
    pageCount: Number(counts.pageCount),
    chunkCount: Number(counts.chunkCount),
    embeddingCount: Number(counts.embeddingCount),
    missingEmbeddings,
    staleEmbeddings,
    invalidDimensionVectors,
    duplicateChunks
  };
}

async function getCounts(db: PrismaTransactionLike) {
  const rows = await db.$queryRawUnsafe<CountRow[]>(`
    SELECT
      (SELECT COUNT(*) FROM "StudyDocument") AS "documentCount",
      (SELECT COUNT(*) FROM "DocumentPage") AS "pageCount",
      (SELECT COUNT(*) FROM "DocumentChunk") AS "chunkCount",
      (SELECT COUNT(*) FROM "DocumentChunkEmbedding") AS "embeddingCount"
  `);

  return (
    rows[0] ?? {
      documentCount: 0,
      pageCount: 0,
      chunkCount: 0,
      embeddingCount: 0
    }
  );
}

async function getChunkEmbeddingRows(db: PrismaTransactionLike) {
  return db.$queryRawUnsafe<ChunkEmbeddingValidationRow[]>(`
    SELECT
      chunk."id" AS "chunkId",
      chunk."text" AS "text",
      embedding."id" AS "embeddingId",
      embedding."embeddingModel" AS "embeddingModel",
      embedding."dimensions" AS "dimensions",
      CASE
        WHEN embedding."id" IS NULL THEN NULL
        ELSE vector_dims(embedding."vector")
      END AS "vectorDimensions",
      embedding."contentHash" AS "contentHash"
    FROM "DocumentChunk" AS chunk
    LEFT JOIN "DocumentChunkEmbedding" AS embedding
      ON embedding."chunkId" = chunk."id"
    ORDER BY chunk."documentId" ASC, chunk."pageNumber" ASC, chunk."chunkIndex" ASC, chunk."id" ASC
  `);
}

async function getDuplicateChunks(db: PrismaTransactionLike) {
  return db.$queryRawUnsafe<DuplicateChunkRow[]>(`
    SELECT
      "documentId" AS "documentId",
      "pageNumber" AS "pageNumber",
      "chunkIndex" AS "chunkIndex",
      COUNT(*) AS "count"
    FROM "DocumentChunk"
    GROUP BY "documentId", "pageNumber", "chunkIndex"
    HAVING COUNT(*) > 1
    ORDER BY "documentId" ASC, "pageNumber" ASC, "chunkIndex" ASC
  `);
}

function nullableNumber(value: number | bigint | null) {
  return value === null ? null : Number(value);
}
