export type ProductionEnvironmentConfig = {
  databaseUrl: string;
  directUrl: string;
  openAiApiKeyConfigured: true;
  embeddingModel: string;
  embeddingDimensions: number;
  chatModel: string;
  storageProvider: "supabase";
  supabaseUrl: string;
  supabaseStorageBucket: string;
};

export class EnvironmentValidationError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(`Production environment is invalid: ${issues.join(" ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

type EnvLike = Record<string, string | undefined>;

const REQUIRED_PRODUCTION_ENV = [
  "DATABASE_URL",
  "DIRECT_URL",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "OPENAI_EMBEDDING_DIMENSIONS",
  "OPENAI_CHAT_MODEL",
  "QUICKNOTES_STORAGE_PROVIDER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET"
] as const;

export function validateProductionEnvironment(env: EnvLike = process.env): ProductionEnvironmentConfig {
  const issues: string[] = [];

  for (const name of REQUIRED_PRODUCTION_ENV) {
    if (!normalizeEnvValue(env[name])) {
      issues.push(`${name} is required.`);
    }
  }

  if (normalizeEnvValue(env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY)) {
    issues.push("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must not be set.");
  }

  const databaseUrl = normalizeEnvValue(env.DATABASE_URL);
  const directUrl = normalizeEnvValue(env.DIRECT_URL);
  const supabaseUrl = normalizeEnvValue(env.SUPABASE_URL);
  const storageProvider = normalizeEnvValue(env.QUICKNOTES_STORAGE_PROVIDER)?.toLowerCase();
  const embeddingDimensionsValue = normalizeEnvValue(env.OPENAI_EMBEDDING_DIMENSIONS);
  const embeddingDimensions = parsePositiveInteger(embeddingDimensionsValue);

  if (databaseUrl) {
    validatePostgresUrl("DATABASE_URL", databaseUrl, {
      requireSupabase: true,
      requirePooler: true
    }, issues);
  }

  if (directUrl) {
    validatePostgresUrl("DIRECT_URL", directUrl, {
      requireSupabase: true,
      requirePooler: false
    }, issues);
  }

  if (supabaseUrl) {
    validateSupabaseProjectUrl(supabaseUrl, issues);
  }

  if (storageProvider && storageProvider !== "supabase") {
    issues.push('QUICKNOTES_STORAGE_PROVIDER must be "supabase" for production.');
  }

  if (embeddingDimensionsValue && !embeddingDimensions) {
    issues.push("OPENAI_EMBEDDING_DIMENSIONS must be a positive integer.");
  }

  if (issues.length > 0) {
    throw new EnvironmentValidationError(issues);
  }

  return {
    databaseUrl: databaseUrl as string,
    directUrl: directUrl as string,
    openAiApiKeyConfigured: true,
    embeddingModel: normalizeEnvValue(env.OPENAI_EMBEDDING_MODEL) as string,
    embeddingDimensions: embeddingDimensions as number,
    chatModel: normalizeEnvValue(env.OPENAI_CHAT_MODEL) as string,
    storageProvider: "supabase",
    supabaseUrl: normalizeEnvValue(env.SUPABASE_URL) as string,
    supabaseStorageBucket: normalizeEnvValue(env.SUPABASE_STORAGE_BUCKET) as string
  };
}

function validatePostgresUrl(
  name: string,
  value: string,
  options: {
    requireSupabase: boolean;
    requirePooler: boolean;
  },
  issues: string[]
) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    issues.push(`${name} must be a valid PostgreSQL URL.`);
    return;
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    issues.push(`${name} must use the postgresql:// protocol.`);
  }

  if (isLocalHost(url.hostname)) {
    issues.push(`${name} must not point at localhost for production.`);
  }

  if (options.requireSupabase && !url.hostname.includes("supabase")) {
    issues.push(`${name} must point at Supabase PostgreSQL for production.`);
  }

  if (options.requirePooler && url.hostname.includes("supabase") && url.port !== "6543") {
    issues.push("DATABASE_URL must use the Supabase transaction pooler on port 6543 for production runtime traffic.");
  }
}

function validateSupabaseProjectUrl(value: string, issues: string[]) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    issues.push("SUPABASE_URL must be a valid URL.");
    return;
  }

  if (url.protocol !== "https:") {
    issues.push("SUPABASE_URL must use https://.");
  }

  if (!url.hostname.includes("supabase")) {
    issues.push("SUPABASE_URL must point at a Supabase project.");
  }
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEnvValue(value: string | undefined) {
  const normalized = value?.trim();

  return normalized || null;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
