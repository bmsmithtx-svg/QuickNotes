import { NextResponse } from "next/server";

import { getEmbeddingRuntimeConfig } from "@/lib/server/embedding-config";
import { EmbeddingServiceError, createOpenAIEmbeddingService } from "@/lib/server/embedding-service";
import { hasStoredEmbeddings } from "@/lib/server/embedding-sync";
import { getPrisma } from "@/lib/server/db";
import { normalizeRetrievalFilters } from "@/lib/server/metadata";
import { searchChunks, type SearchChunksInput } from "@/lib/server/search-index";
import { getRankingFormula, resolveSearchMode, retrieveChunks } from "@/lib/server/retrieval";
import type {
  AppliedRetrievalFilters,
  ChunkSearchResult,
  RetrievalFilters,
  RetrievalMode,
  SearchModeAvailability,
  SearchResponse
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = getTextParameter(url, "q");

  if (!query) {
    return NextResponse.json({ error: "Search query parameter q is required." }, { status: 400 });
  }

  let filters: AppliedRetrievalFilters;

  try {
    filters = normalizeRetrievalFilters(parseSearchFilters(url));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid filters."
      },
      { status: 400 }
    );
  }

  const input: SearchChunksInput = {
    query,
    filters,
    limit: getIntegerParameter(url, "limit")
  };
  const requestedMode = getSearchModeParameter(url);

  if (requestedMode === "invalid") {
    return NextResponse.json({ error: "Search mode must be keyword, semantic, or hybrid." }, { status: 400 });
  }

  const prisma = await getPrisma();
  const embeddingConfig = getEmbeddingRuntimeConfig();
  const semantic = await getSemanticAvailability(prisma, embeddingConfig);
  const actualMode = resolveSearchMode({
    requestedMode,
    semanticAvailable: semantic.semanticAvailable
  });

  if (requestedMode && requestedMode !== "keyword" && !semantic.semanticAvailable) {
    return NextResponse.json(
      {
        error:
          semantic.reason === "missing_api_key"
            ? "Server AI configuration is required for semantic and hybrid search. Use keyword search or update server configuration."
            : `No embeddings are stored for ${semantic.model}. Run npm run embeddings:backfill before semantic or hybrid search.`,
        requestedMode,
        mode: "keyword",
        actualMode: "keyword",
        semantic
      },
      {
        status: semantic.reason === "missing_api_key" ? 503 : 409
      }
    );
  }

  const embeddingService =
    actualMode === "keyword" || !embeddingConfig.apiKey
      ? undefined
      : createOpenAIEmbeddingService({
          apiKey: embeddingConfig.apiKey,
          model: embeddingConfig.model,
          dimensions: embeddingConfig.dimensions
        });
  let results: ChunkSearchResult[];

  try {
    results =
      actualMode === "keyword"
        ? await searchChunks(prisma, input)
        : await retrieveChunks(prisma, input, {
            mode: actualMode,
            embeddingService
          });
  } catch (error) {
    if (error instanceof EmbeddingServiceError) {
      return NextResponse.json(
        {
          error: getPublicEmbeddingErrorMessage(error),
          requestedMode: requestedMode ?? "auto",
          mode: actualMode,
          actualMode,
          semantic
        },
        { status: error.code === "rate_limit" ? 429 : 502 }
      );
    }

    throw error;
  }

  const response: SearchResponse = {
    query,
    requestedMode: requestedMode ?? "auto",
    mode: actualMode,
    actualMode,
    semantic,
    resultCount: results.length,
    ranking: {
      formula: getRankingFormula(actualMode),
      rrfK: actualMode === "hybrid" ? 60 : undefined
    },
    filters,
    results
  };

  return NextResponse.json(response);
}

function getPublicEmbeddingErrorMessage(error: EmbeddingServiceError) {
  if (error.code === "missing_api_key") {
    return "Server AI configuration is required for semantic and hybrid search.";
  }

  if (error.code === "authentication") {
    return "The AI provider rejected the embedding request. Check server AI credentials and billing access.";
  }

  return error.message;
}

async function getSemanticAvailability(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  config: ReturnType<typeof getEmbeddingRuntimeConfig>
): Promise<SearchModeAvailability> {
  if (!config.apiKey) {
    return {
      semanticAvailable: false,
      reason: "missing_api_key",
      model: config.model
    };
  }

  try {
    const hasEmbeddings = await hasStoredEmbeddings(prisma, config.model, config.dimensions);

    return {
      semanticAvailable: hasEmbeddings,
      reason: hasEmbeddings ? undefined : "missing_embeddings",
      model: config.model
    };
  } catch {
    return {
      semanticAvailable: false,
      reason: "missing_embeddings",
      model: config.model
    };
  }
}

function getTextParameter(url: URL, name: string) {
  const value = url.searchParams.get(name)?.trim();

  return value || null;
}

function getIntegerParameter(url: URL, name: string) {
  const value = url.searchParams.get(name);

  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function getSearchModeParameter(url: URL): RetrievalMode | null | "invalid" {
  const value = getTextParameter(url, "mode");

  if (!value) {
    return null;
  }

  if (value === "keyword" || value === "semantic" || value === "hybrid") {
    return value;
  }

  return "invalid";
}

function parseSearchFilters(url: URL): RetrievalFilters {
  return {
    documentIds: collectTextParameters(url, ["documentId", "documentIds"]),
    classNames: collectTextParameters(url, ["className", "classNames", "class"]),
    topics: collectTextParameters(url, ["topic", "topics"]),
    sources: collectTextParameters(url, ["source", "sources"]),
    tags: collectTextParameters(url, ["tag", "tags"]),
    documentDateFrom: getTextParameter(url, "documentDateFrom") ?? getTextParameter(url, "dateFrom") ?? undefined,
    documentDateTo: getTextParameter(url, "documentDateTo") ?? getTextParameter(url, "dateTo") ?? undefined
  };
}

function collectTextParameters(url: URL, names: string[]) {
  const values: string[] = [];

  for (const name of names) {
    for (const value of url.searchParams.getAll(name)) {
      values.push(...splitMultiValue(value));
    }
  }

  return values;
}

function splitMultiValue(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
