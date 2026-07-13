import { loadEnvConfig } from "@next/env";

let loaded = false;

export function loadScriptEnv(projectDir = process.cwd()) {
  if (loaded) {
    return;
  }

  loadEnvConfig(projectDir);
  loaded = true;
}
