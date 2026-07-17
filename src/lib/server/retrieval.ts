import type { ChunkSearchResult, RetrievalMode } from "../types";
import { parseTags } from "./document-mappers";
import type { PrismaTransactionLike } from "./db";
import { appendOwnerFilterSql, appendRetrievalFilterSql, getAppliedRetrievalFilters, tagJsonSelect } from "./retrieval-filters";
import { addSqlParameter } from "./sql";
import { serializeVectorForPgvector } from "./vector-utils";
import {
  buildTextPreview,
  clampSearchLimit,
  MAX_SEARCH_LIMIT,
  searchChunks,
  type SearchChunksInput
} from "./search-index";

export const HYBRID_RRF_K = 60;
export const HYBRID_RANKING_FORMULA = `score = sum(1 / (${HYBRID_RRF_K} + rank)) over keyword and semantic ranks`;

export type QueryEmbeddingService = {
  model: string;
  dimensions?: number;
  embedTexts(texts: string[]): Promise<number[][]>;
};

type SemanticRow = {
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
  dimensions: number;
  similarity: number;
};

export async function retrieveChunks(
  db: PrismaTransactionLike,
  input: SearchChunksInput,
  options: {
    mode: RetrievalMode;
    embeddingService?: QueryEmbeddingService;
  }
) {
  if (options.mode === "keyword") {
    return searchChunks(db, input);
  }

  if (!options.embeddingService) {
    throw new Error("An embedding service is required for semantic or hybrid retrieval.");
  }

  if (options.mode === "semantic") {
    return searchSemanticChunks(db, input, options.embeddingService);
  }

  return searchHybridChunks(db, input, options.embeddingService);
}

export async function searchSemanticChunks(
  db: PrismaTransactionLike,
  input: SearchChunksInput,
  embeddingService: QueryEmbeddingService
) {
  const queryEmbedding = (await embeddingService.embedTexts([input.query]))[0];

  if (!queryEmbedding) {
    return [];
  }

  const dimensions = embeddingService.dimensions ?? queryEmbedding.length;
  const queryVector = serializeVectorForPgvector(queryEmbedding, dimensions);
  const rows = await getStoredSemanticRows(db, input, embeddingService.model, dimensions, queryVector);
  const rankedRows = rows
    .sort(compareSemanticMatches)
    .slice(0, clampSearchLimit(input.limit));

  return rankedRows.map((row, index) => mapSemanticRow(row, Number(row.similarity), index + 1));
}

export async function searchHybridChunks(
  db: PrismaTransactionLike,
  input: SearchChunksInput,
  embeddingService: QueryEmbeddingService
) {
  const limit = clampSearchLimit(input.limit);
  const candidateLimit = Math.min(limit * 4, MAX_SEARCH_LIMIT);
  const [keywordResults, semanticResults] = await Promise.all([
    searchChunks(db, {
      ...input,
      limit: candidateLimit
    }),
    searchSemanticChunks(
      db,
      {
        ...input,
        limit: candidateLimit
      },
      embeddingService
    )
  ]);
  const merged = new Map<
    string,
    {
      keyword?: ChunkSearchResult;
      semantic?: ChunkSearchResult;
    }
  >();

  for (const result of keywordResults) {
    merged.set(result.chunkId, {
      ...merged.get(result.chunkId),
      keyword: result
    });
  }

  for (const result of semanticResults) {
    merged.set(result.chunkId, {
      ...merged.get(result.chunkId),
      semantic: result
    });
  }

  return Array.from(merged.values())
    .map((entry) => {
      const base = entry.keyword ?? entry.semantic;

      if (!base) {
        throw new Error("Hybrid retrieval found an empty result entry.");
      }

      const keywordRank = entry.keyword?.ranking.keywordRank;
      const semanticRank = entry.semantic?.ranking.semanticRank;
      const finalScore = reciprocalRankScore(keywordRank) + reciprocalRankScore(semanticRank);

      return {
        base,
        keywordRank,
        keywordScore: entry.keyword?.ranking.keywordScore,
        semanticRank,
        semanticSimilarity: entry.semantic?.ranking.semanticSimilarity,
        finalScore
      };
    })
    .sort(compareHybridMatches)
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry.base,
      score: entry.finalScore,
      rank: index + 1,
      ranking: {
        mode: "hybrid" as const,
        finalRank: index + 1,
        finalScore: entry.finalScore,
        keywordRank: entry.keywordRank,
        keywordScore: entry.keywordScore,
        semanticRank: entry.semanticRank,
        semanticSimilarity: entry.semanticSimilarity
      }
    }));
}

export function resolveSearchMode({
  requestedMode,
  semanticAvailable
}: {
  requestedMode: RetrievalMode | null;
  semanticAvailable: boolean;
}) {
  return requestedMode ?? (semanticAvailable ? "hybrid" : "keyword");
}

export function getRankingFormula(mode: RetrievalMode) {
  if (mode === "hybrid") {
    return HYBRID_RANKING_FORMULA;
  }

  if (mode === "semantic") {
    return "score = 1 - (stored_chunk_embedding <=> query_embedding)";
  }

  return "score = ts_rank_cd(to_tsvector(DocumentChunk.text), websearch_to_tsquery(query))";
}

async function getStoredSemanticRows(
  db: PrismaTransactionLike,
  input: SearchChunksInput,
  model: string,
  dimensions: number,
  queryVector: string
) {
  const filters: string[] = [];
  const parameters: unknown[] = [];
  const modelParameter = addSqlParameter(parameters, model);
  const queryVectorParameter = addSqlParameter(parameters, queryVector);
  const dimensionsParameter = addSqlParameter(parameters, dimensions);
  const appliedFilters = getAppliedRetrievalFilters(input);

  filters.push(`embedding."embeddingModel" = ${modelParameter}`);
  filters.push(`embedding."dimensions" = ${dimensionsParameter}`);
  filters.push(`document."uploadStatus" = 'READY'`);
  appendOwnerFilterSql(filters, parameters, input.ownerId);
  appendRetrievalFilterSql(filters, parameters, appliedFilters);
  const limitParameter = addSqlParameter(parameters, clampSearchLimit(input.limit));

  return db.$queryRawUnsafe<SemanticRow[]>(
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
        embedding."dimensions" AS "dimensions",
        (1 - (embedding."vector" <=> ${queryVectorParameter}::vector))::double precision AS "similarity"
      FROM "DocumentChunkEmbedding" AS embedding
      INNER JOIN "DocumentChunk" AS chunk
        ON chunk."id" = embedding."chunkId"
      INNER JOIN "StudyDocument" AS document
        ON document."id" = chunk."documentId"
      WHERE ${filters.join(" AND ")}
      ORDER BY embedding."vector" <=> ${queryVectorParameter}::vector ASC,
        chunk."documentId" ASC,
        chunk."pageNumber" ASC,
        chunk."chunkIndex" ASC,
        chunk."id" ASC
      LIMIT ${limitParameter}
    `,
    ...parameters
  );
}

function mapSemanticRow(row: SemanticRow, similarity: number, rank: number): ChunkSearchResult {
  return {
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
    score: similarity,
    rank,
    ranking: {
      mode: "semantic",
      finalRank: rank,
      finalScore: similarity,
      semanticRank: rank,
      semanticSimilarity: similarity
    },
    citation: {
      id: row.chunkId,
      fileName: row.originalFileName,
      pageNumber: Number(row.pageNumber),
      chunkIndex: Number(row.chunkIndex),
      sourceChunk: row.text
    }
  };
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

function reciprocalRankScore(rank: number | undefined) {
  return rank ? 1 / (HYBRID_RRF_K + rank) : 0;
}

function compareSemanticMatches(
  left: SemanticRow,
  right: SemanticRow
) {
  return (
    Number(right.similarity) - Number(left.similarity) ||
    left.documentId.localeCompare(right.documentId) ||
    Number(left.pageNumber) - Number(right.pageNumber) ||
    Number(left.chunkIndex) - Number(right.chunkIndex) ||
    left.chunkId.localeCompare(right.chunkId)
  );
}

function compareHybridMatches(
  left: {
    base: ChunkSearchResult;
    finalScore: number;
    keywordRank?: number;
    semanticRank?: number;
    semanticSimilarity?: number;
  },
  right: {
    base: ChunkSearchResult;
    finalScore: number;
    keywordRank?: number;
    semanticRank?: number;
    semanticSimilarity?: number;
  }
) {
  return (
    right.finalScore - left.finalScore ||
    compareOptionalRank(left.keywordRank, right.keywordRank) ||
    compareOptionalRank(left.semanticRank, right.semanticRank) ||
    (right.semanticSimilarity ?? Number.NEGATIVE_INFINITY) - (left.semanticSimilarity ?? Number.NEGATIVE_INFINITY) ||
    left.base.documentId.localeCompare(right.base.documentId) ||
    left.base.pageNumber - right.base.pageNumber ||
    left.base.chunkIndex - right.base.chunkIndex ||
    left.base.chunkId.localeCompare(right.base.chunkId)
  );
}

function compareOptionalRank(left: number | undefined, right: number | undefined) {
  return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
}
