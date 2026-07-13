export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingRuntimeConfig = {
  apiKey: string | null;
  model: string;
  dimensions: number;
};

type EnvLike = Record<string, string | undefined>;

export class MissingOpenAiApiKeyError extends Error {
  code = "missing_openai_api_key" as const;

  constructor() {
    super(
      "OPENAI_API_KEY is required for embedding generation and semantic search. Add it to your local environment or use keyword search."
    );
    this.name = "MissingOpenAiApiKeyError";
  }
}

export function getEmbeddingRuntimeConfig(env: EnvLike = process.env): EmbeddingRuntimeConfig {
  return {
    apiKey: normalizeEnvValue(env.OPENAI_API_KEY),
    model: normalizeEnvValue(env.OPENAI_EMBEDDING_MODEL) ?? DEFAULT_OPENAI_EMBEDDING_MODEL,
    dimensions: parseEmbeddingDimensions(env.OPENAI_EMBEDDING_DIMENSIONS)
  };
}

export function requireEmbeddingRuntimeConfig(env: EnvLike = process.env) {
  const config = getEmbeddingRuntimeConfig(env);

  if (!config.apiKey) {
    throw new MissingOpenAiApiKeyError();
  }

  return {
    apiKey: config.apiKey,
    model: config.model,
    dimensions: config.dimensions
  };
}

export function isMissingOpenAiApiKeyError(error: unknown): error is MissingOpenAiApiKeyError {
  return error instanceof MissingOpenAiApiKeyError;
}

function normalizeEnvValue(value: string | undefined) {
  const normalized = value?.trim();

  return normalized || null;
}

function parseEmbeddingDimensions(value: string | undefined) {
  const normalized = normalizeEnvValue(value);

  if (!normalized) {
    return DEFAULT_OPENAI_EMBEDDING_DIMENSIONS;
  }

  const dimensions = Number.parseInt(normalized, 10);

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("OPENAI_EMBEDDING_DIMENSIONS must be a positive integer.");
  }

  return dimensions;
}
