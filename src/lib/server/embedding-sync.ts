import { randomUUID } from "node:crypto";

import type { PrismaTransactionLike } from "./db";
import { hashEmbeddingContent } from "./embedding-hash";
import type { EmbeddingService } from "./embedding-service";
import { EmbeddingServiceError } from "./embedding-service";
import { addSqlParameter, addSqlParameterList } from "./sql";
import { serializeVectorForPgvector } from "./vector-utils";

export type ChunkForEmbedding = {
  id: string;
  text: string;
};

export type EmbeddingSyncMode = "stale" | "missing" | "all";

export type EmbeddingSyncResult = {
  processed: number;
  skipped: number;
  succeeded: number;
  failed: number;
  model: string;
  errorMessage?: string;
};

export type StoredEmbeddingRow = {
  chunkId: string;
  embeddingModel: string;
  dimensions: number;
  contentHash: string;
};

export async function syncChunkEmbeddings(
  db: PrismaTransactionLike,
  chunks: ChunkForEmbedding[],
  embeddingService: Pick<EmbeddingService, "embedTexts" | "model" | "dimensions">,
  options: {
    mode?: EmbeddingSyncMode;
  } = {}
): Promise<EmbeddingSyncResult> {
  const mode = options.mode ?? "stale";
  const existingRows = await getEmbeddingRowsByChunkIds(
    db,
    chunks.map((chunk) => chunk.id)
  );
  const existingByChunkId = new Map(existingRows.map((row) => [row.chunkId, row]));
  const pending: Array<ChunkForEmbedding & { contentHash: string }> = [];
  let skipped = 0;

  for (const chunk of chunks) {
    const existing = existingByChunkId.get(chunk.id);
    const contentHash = hashEmbeddingContent(chunk.text);

    if (mode === "missing" && existing) {
      skipped += 1;
      continue;
    }

    if (
      mode === "stale" &&
      existing &&
      existing.embeddingModel === embeddingService.model &&
      existing.contentHash === contentHash
    ) {
      skipped += 1;
      continue;
    }

    pending.push({
      ...chunk,
      contentHash
    });
  }

  if (pending.length === 0) {
    return {
      processed: chunks.length,
      skipped,
      succeeded: 0,
      failed: 0,
      model: embeddingService.model
    };
  }

  let vectors: number[][];

  try {
    vectors = await embeddingService.embedTexts(pending.map((chunk) => chunk.text));
  } catch (error) {
    return {
      processed: chunks.length,
      skipped,
      succeeded: 0,
      failed: pending.length,
      model: embeddingService.model,
      errorMessage: safeEmbeddingErrorMessage(error)
    };
  }

  let succeeded = 0;
  let failed = 0;
  let errorMessage: string | undefined;

  for (const [index, chunk] of pending.entries()) {
    const vector = vectors[index];

    try {
      await upsertChunkEmbedding(db, {
        chunkId: chunk.id,
        model: embeddingService.model,
        dimensions: embeddingService.dimensions,
        contentHash: chunk.contentHash,
        vector
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      errorMessage = error instanceof Error ? error.message : "Embedding persistence failed.";
    }
  }

  return {
    processed: chunks.length,
    skipped,
    succeeded,
    failed,
    model: embeddingService.model,
    errorMessage
  };
}

export async function backfillChunkEmbeddings(
  db: PrismaTransactionLike,
  embeddingService: Pick<EmbeddingService, "embedTexts" | "model" | "dimensions">,
  options: {
    mode?: EmbeddingSyncMode;
    documentId?: string;
  } = {}
) {
  const where = options.documentId ? { documentId: options.documentId } : undefined;
  const chunks = (await db.documentChunk.findMany({
    where,
    select: {
      id: true,
      text: true
    },
    orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }, { chunkIndex: "asc" }]
  })) as ChunkForEmbedding[];

  return syncChunkEmbeddings(db, chunks, embeddingService, {
    mode: options.mode ?? "stale"
  });
}

export async function getEmbeddingRowsByChunkIds(db: PrismaTransactionLike, chunkIds: string[]) {
  if (chunkIds.length === 0) {
    return [];
  }

  const parameters: unknown[] = [];
  const placeholders = addSqlParameterList(parameters, chunkIds);

  return db.$queryRawUnsafe<StoredEmbeddingRow[]>(
    `
      SELECT
        "chunkId" AS "chunkId",
        "embeddingModel" AS "embeddingModel",
        "dimensions" AS "dimensions",
        "contentHash" AS "contentHash"
      FROM "DocumentChunkEmbedding"
      WHERE "chunkId" IN (${placeholders})
    `,
    ...parameters
  );
}

export async function hasStoredEmbeddings(db: PrismaTransactionLike, model: string, dimensions?: number) {
  const parameters: unknown[] = [];
  const modelParameter = addSqlParameter(parameters, model);
  const dimensionsFilter = dimensions
    ? ` AND "dimensions" = ${addSqlParameter(parameters, dimensions)}`
    : "";
  const rows = await db.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `SELECT COUNT(*) AS "count" FROM "DocumentChunkEmbedding" WHERE "embeddingModel" = ${modelParameter}${dimensionsFilter}`,
    ...parameters
  );
  const count = rows[0]?.count ?? 0;

  return Number(count) > 0;
}

async function upsertChunkEmbedding(
  db: PrismaTransactionLike,
  input: {
    chunkId: string;
    model: string;
    dimensions?: number;
    contentHash: string;
    vector: number[];
  }
) {
  const dimensions = input.dimensions ?? input.vector.length;
  const vector = serializeVectorForPgvector(input.vector, dimensions);

  await db.$executeRawUnsafe(
    `
      INSERT INTO "DocumentChunkEmbedding" (
        "id",
        "chunkId",
        "embeddingModel",
        "dimensions",
        "vector",
        "contentHash",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5::vector, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT("chunkId") DO UPDATE SET
        "embeddingModel" = excluded."embeddingModel",
        "dimensions" = excluded."dimensions",
        "vector" = excluded."vector",
        "contentHash" = excluded."contentHash",
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    randomUUID(),
    input.chunkId,
    input.model,
    dimensions,
    vector,
    input.contentHash
  );
}

function safeEmbeddingErrorMessage(error: unknown) {
  if (error instanceof EmbeddingServiceError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Embedding generation failed.";
}
