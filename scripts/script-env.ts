import { loadEnvConfig } from "@next/env";

let loaded = false;

export function loadScriptEnv(projectDir = process.cwd()) {
  if (loaded) {
    return;
  }

  loadEnvConfig(projectDir);
  loaded = true;
}

export function requireDatabaseScriptConfig(env: NodeJS.ProcessEnv = process.env) {
  const missing = ["DATABASE_URL", "DIRECT_URL"].filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`${missing.join(" and ")} must be configured before running database scripts.`);
  }
}
