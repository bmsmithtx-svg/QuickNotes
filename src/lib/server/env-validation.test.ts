import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EnvironmentValidationError, validateProductionEnvironment } from "./env-validation";

describe("production environment validation", () => {
  it("accepts explicit Supabase production persistence configuration", () => {
    const config = validateProductionEnvironment(createProductionEnv());

    assert.equal(config.storageProvider, "supabase");
    assert.equal(config.openAiApiKeyConfigured, true);
    assert.equal(config.embeddingDimensions, 1536);
    assert.equal(config.chatModel, "gpt-5-mini");
  });

  it("reports missing required production variables together", () => {
    assert.throws(
      () => validateProductionEnvironment({}),
      (error) =>
        error instanceof EnvironmentValidationError &&
        error.issues.some((issue) => issue.includes("DATABASE_URL")) &&
        error.issues.some((issue) => issue.includes("SUPABASE_SERVICE_ROLE_KEY")) &&
        error.issues.some((issue) => issue.includes("OPENAI_API_KEY"))
    );
  });

  it("rejects local databases and local filesystem storage for production", () => {
    assert.throws(
      () =>
        validateProductionEnvironment(
          createProductionEnv({
            DATABASE_URL: "postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public",
            DIRECT_URL: "postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public",
            QUICKNOTES_STORAGE_PROVIDER: "local"
          })
        ),
      (error) =>
        error instanceof EnvironmentValidationError &&
        error.issues.some((issue) => issue.includes("DATABASE_URL must not point at localhost")) &&
        error.issues.some((issue) => issue.includes("QUICKNOTES_STORAGE_PROVIDER"))
    );
  });

  it("rejects service-role exposure and invalid embedding dimensions", () => {
    assert.throws(
      () =>
        validateProductionEnvironment(
          createProductionEnv({
            NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked",
            OPENAI_EMBEDDING_DIMENSIONS: "not-a-number"
          })
        ),
      (error) =>
        error instanceof EnvironmentValidationError &&
        error.issues.some((issue) => issue.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")) &&
        error.issues.some((issue) => issue.includes("OPENAI_EMBEDDING_DIMENSIONS"))
    );
  });
});

function createProductionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL:
      "postgresql://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?schema=public",
    DIRECT_URL:
      "postgresql://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?schema=public",
    OPENAI_API_KEY: "sk-test",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    OPENAI_EMBEDDING_DIMENSIONS: "1536",
    OPENAI_CHAT_MODEL: "gpt-5-mini",
    QUICKNOTES_STORAGE_PROVIDER: "supabase",
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    SUPABASE_STORAGE_BUCKET: "quicknotes-pdfs",
    ...overrides
  };
}
