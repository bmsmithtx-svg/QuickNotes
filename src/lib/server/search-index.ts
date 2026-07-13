import type { ChunkSearchResult } from "../types";
import type { PrismaTransactionLike } from "./db";
import { parseTags } from "./document-mappers";
import { appendRetrievalFilterSql, getAppliedRetrievalFilters, tagJsonSelect } from "./retrieval-filters";
import type { RetrievalFilters } from "../types";
import { addSqlParameter, addSqlParameterList } from "./sql";

export type SearchIndexChunk = {
  id: string;
  documentId: string;
  text: string;
};

export type SearchChunksInput = {
  query: string;
  documentId?: string;
  documentIds?: string[];
  className?: string;
  topic?: string;
  tag?: string;
  filters?: RetrievalFilters;
  limit?: number;
};

type SearchRow = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName: string;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: Date | string | null;
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
  void db;
}

export async function syncDocumentSearchIndex(
  db: PrismaTransactionLike,
  documentId: string,
  chunks: SearchIndexChunk[]
) {
  void db;
  void documentId;
  void chunks;
}

export async function rebuildChunkSearchIndex(db: PrismaTransactionLike) {
  const chunks = (await db.documentChunk.findMany({
    select: {
      id: true
    }
  })) as SearchIndexChunk[];

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
  const parameters: unknown[] = [];
  const queryParameter = addSqlParameter(parameters, normalizedQuery);
  const appliedFilters = getAppliedRetrievalFilters(input);

  appendRetrievalFilterSql(filters, parameters, appliedFilters);

  const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
  const limit = clampSearchLimit(input.limit);
  const limitParameter = addSqlParameter(parameters, limit);

  const rows = await db.$queryRawUnsafe<SearchRow[]>(
    `
      SELECT
        chunk."id" AS "chunkId",
        chunk."documentId" AS "documentId",
        document."title" AS "documentTitle",
        document."originalFileName" AS "originalFileName",
        document."className" AS "className",
        document."topic" AS "topic",
        document."source" AS "source",
        document."documentDate" AS "documentDate",
        ${tagJsonSelect("document")} AS "tags",
        chunk."pageNumber" AS "pageNumber",
        chunk."chunkIndex" AS "chunkIndex",
        chunk."text" AS "text",
        ts_rank_cd(to_tsvector('english', chunk."text"), websearch_to_tsquery('english', ${queryParameter})) AS "score"
      FROM "DocumentChunk" AS chunk
      INNER JOIN "StudyDocument" AS document
        ON document."id" = chunk."documentId"
      WHERE to_tsvector('english', chunk."text") @@ websearch_to_tsquery('english', ${queryParameter})
      ${whereClause}
      ORDER BY "score" DESC, chunk."documentId" ASC, chunk."pageNumber" ASC, chunk."chunkIndex" ASC, chunk."id" ASC
      LIMIT ${limitParameter}
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
    source: row.source,
    documentDate: formatRowDate(row.documentDate),
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

export function getDocumentFilterIds(input: Pick<SearchChunksInput, "documentId" | "documentIds">) {
  const ids = new Set<string>();

  if (input.documentId?.trim()) {
    ids.add(input.documentId.trim());
  }

  for (const documentId of input.documentIds ?? []) {
    const normalized = documentId.trim();

    if (normalized) {
      ids.add(normalized);
    }
  }

  return Array.from(ids).sort();
}

export function appendDocumentIdFilter(
  filters: string[],
  parameters: unknown[],
  input: Pick<SearchChunksInput, "documentId" | "documentIds">
) {
  const documentIds = getDocumentFilterIds(input);

  if (documentIds.length === 0) {
    return;
  }

  if (documentIds.length === 1) {
    filters.push(`document."id" = ${addSqlParameter(parameters, documentIds[0])}`);
    return;
  }

  filters.push(`document."id" IN (${addSqlParameterList(parameters, documentIds)})`);
}

function formatRowDate(value: Date | string | null) {
  if (!value) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}
