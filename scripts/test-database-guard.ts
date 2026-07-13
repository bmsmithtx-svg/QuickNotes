import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { assertIntegrationTestDatabaseIsIsolated } from "./db-safety";
import { loadScriptEnv } from "./script-env";

loadScriptEnv();
assertIntegrationTestDatabaseIsIsolated(process.env);

const integrationTests = findIntegrationTests("src");

if (integrationTests.length === 0) {
  console.log("No integration test files found after database isolation guard.");
} else {
  console.log(`Database isolation guard passed for ${integrationTests.length} integration test file(s).`);
}

function findIntegrationTests(directory: string): string[] {
  const matches: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      matches.push(...findIntegrationTests(path));
    } else if (/\.integration\.test\.ts$/.test(entry)) {
      matches.push(path);
    }
  }

  return matches;
}
