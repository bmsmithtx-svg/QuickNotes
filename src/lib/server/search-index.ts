import type { ChunkSearchResult } from "../types";
import type { PrismaTransactionLike } from "./db";
import { parseTags } from "./document-mappers";

export type SearchIndexChunk = {
  id: string;
  documentId: string;
  text: string;
};

export type SearchChunksInput = {
  query: string;
  documentId?: string;
  className?: string;
  topic?: string;
  tag?: string;
  limit?: number;
};

type SearchRow = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName: string;
  className: string | null;
  topic: string | null;
  tags: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
};

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;
const MAX_FTS_TERMS = 12;
const PREVIEW_LENGTH = 320;

export async function ensureChunkSearchIndex(db: PrismaTransactionLike) {
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS "DocumentChunkSearch" USING fts5(
      "chunkId" UNINDEXED,
      "documentId" UNINDEXED,
      "text",
      tokenize = 'unicode61'
    )
  `);

  await db.$executeRawUnsafe(`
    INSERT INTO "DocumentChunkSearch" ("chunkId", "documentId", "text")
    SELECT chunk."id", chunk."documentId", chunk."text"
    FROM "DocumentChunk" AS chunk
    WHERE NOT EXISTS (
      SELECT 1
      FROM "DocumentChunkSearch"
      WHERE "DocumentChunkSearch"."chunkId" = chunk."id"
    )
  `);
}

export async function syncDocumentSearchIndex(
  db: PrismaTransactionLike,
  documentId: string,
  chunks: SearchIndexChunk[]
) {
  await db.$executeRawUnsafe(`DELETE FROM "DocumentChunkSearch" WHERE "documentId" = ?`, documentId);

  for (const chunk of chunks) {
    await db.$executeRawUnsafe(
      `INSERT INTO "DocumentChunkSearch" ("chunkId", "documentId", "text") VALUES (?, ?, ?)`,
      chunk.id,
      chunk.documentId,
      chunk.text
    );
  }
}

export async function rebuildChunkSearchIndex(db: PrismaTransactionLike) {
  await ensureChunkSearchIndex(db);
  await db.$executeRawUnsafe(`DELETE FROM "DocumentChunkSearch"`);

  const chunks = (await db.documentChunk.findMany({
    select: {
      id: true,
      documentId: true,
      text: true
    },
    orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }, { chunkIndex: "asc" }]
  })) as SearchIndexChunk[];

  for (const chunk of chunks) {
    await db.$executeRawUnsafe(
      `INSERT INTO "DocumentChunkSearch" ("chunkId", "documentId", "text") VALUES (?, ?, ?)`,
      chunk.id,
      chunk.documentId,
      chunk.text
    );
  }

  return {
    indexedChunkCount: chunks.length
  };
}

export async function searchChunks(db: PrismaTransactionLike, input: SearchChunksInput) {
  const normalizedQuery = normalizeFtsQuery(input.query);

  if (!normalizedQuery) {
    return [];
  }

  await ensureChunkSearchIndex(db);

  const filters: string[] = [];
  const parameters: unknown[] = [normalizedQuery];

  if (input.documentId) {
    filters.push(`document."id" = ?`);
    parameters.push(input.documentId);
  }

  if (input.className) {
    filters.push(`document."className" = ?`);
    parameters.push(input.className);
  }

  if (input.topic) {
    filters.push(`document."topic" = ?`);
    parameters.push(input.topic);
  }

  if (input.tag) {
    filters.push(`document."tags" LIKE ? ESCAPE '\\'`);
    parameters.push(`%"${escapeLikePattern(input.tag)}"%`);
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
  const limit = clampSearchLimit(input.limit);
  parameters.push(limit);

  const rows = await db.$queryRawUnsafe<SearchRow[]>(
    `
      SELECT
        chunk."id" AS "chunkId",
        chunk."documentId" AS "documentId",
        document."title" AS "documentTitle",
        document."originalFileName" AS "originalFileName",
        document."className" AS "className",
        document."topic" AS "topic",
        document."tags" AS "tags",
        chunk."pageNumber" AS "pageNumber",
        chunk."chunkIndex" AS "chunkIndex",
        chunk."text" AS "text",
        (-1.0 * bm25("DocumentChunkSearch")) AS "score"
      FROM "DocumentChunkSearch"
      INNER JOIN "DocumentChunk" AS chunk
        ON chunk."id" = "DocumentChunkSearch"."chunkId"
      INNER JOIN "StudyDocument" AS document
        ON document."id" = chunk."documentId"
      WHERE "DocumentChunkSearch" MATCH ?
      ${whereClause}
      ORDER BY bm25("DocumentChunkSearch") ASC, chunk."documentId" ASC, chunk."pageNumber" ASC, chunk."chunkIndex" ASC, chunk."id" ASC
      LIMIT ?
    `,
    ...parameters
  );

  return mapSearchRows(rows);
}

export function normalizeFtsQuery(query: string) {
  const terms = query
    .normalize("NFKC")
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.toLowerCase())
    .filter(Boolean);

  if (!terms?.length) {
    return null;
  }

  return Array.from(new Set(terms))
    .slice(0, MAX_FTS_TERMS)
    .map((term) => `"${term.replace(/"/g, "\"\"")}"`)
    .join(" ");
}

function mapSearchRows(rows: SearchRow[]): ChunkSearchResult[] {
  return rows.map((row, index) => ({
    chunkId: row.chunkId,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    originalFileName: row.originalFileName,
    className: row.className,
    topic: row.topic,
    tags: parseTags(row.tags),
    pageNumber: Number(row.pageNumber),
    chunkIndex: Number(row.chunkIndex),
    textPreview: buildTextPreview(row.text),
    score: Number(row.score),
    rank: index + 1,
    ranking: {
      mode: "keyword",
      finalRank: index + 1,
      finalScore: Number(row.score),
      keywordRank: index + 1,
      keywordScore: Number(row.score)
    },
    citation: {
      id: row.chunkId,
      fileName: row.originalFileName,
      pageNumber: Number(row.pageNumber),
      chunkIndex: Number(row.chunkIndex),
      sourceChunk: row.text
    }
  }));
}

export function buildTextPreview(text: string) {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (normalizedText.length <= PREVIEW_LENGTH) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, PREVIEW_LENGTH - 1).trimEnd()}...`;
}

export function clampSearchLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT), 1), MAX_SEARCH_LIMIT);
}

export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
