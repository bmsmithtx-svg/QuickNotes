export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini";

export type AnswerRuntimeConfig = {
  apiKey: string | null;
  model: string;
};

type EnvLike = Record<string, string | undefined>;

export class MissingOpenAiChatApiKeyError extends Error {
  code = "missing_openai_api_key" as const;

  constructor() {
    super("OPENAI_API_KEY is required for answer generation.");
    this.name = "MissingOpenAiChatApiKeyError";
  }
}

export function getAnswerRuntimeConfig(env: EnvLike = process.env): AnswerRuntimeConfig {
  return {
    apiKey: normalizeEnvValue(env.OPENAI_API_KEY),
    model: normalizeEnvValue(env.OPENAI_CHAT_MODEL) ?? DEFAULT_OPENAI_CHAT_MODEL
  };
}

export function requireAnswerRuntimeConfig(env: EnvLike = process.env) {
  const config = getAnswerRuntimeConfig(env);

  if (!config.apiKey) {
    throw new MissingOpenAiChatApiKeyError();
  }

  return {
    apiKey: config.apiKey,
    model: config.model
  };
}

function normalizeEnvValue(value: string | undefined) {
  const normalized = value?.trim();

  return normalized || null;
}
