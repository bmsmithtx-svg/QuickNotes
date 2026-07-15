import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const allowedDeleteManyFiles = new Set([
  "scripts/check-db-safety.ts",
  "src/lib/server/document-lifecycle.ts",
  "src/lib/server/document-lifecycle.test.ts",
  "src/lib/server/metadata.ts",
  "src/lib/server/metadata.test.ts"
]);

const violations: string[] = [];
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (/prisma\s+migrate\s+reset/.test(command) && !command.includes("scripts/prisma-safe.ts")) {
    violations.push(`package.json script ${name} runs prisma migrate reset without scripts/prisma-safe.ts`);
  }

  if (/prisma\s+db\s+push\b.*--(?:force-reset|accept-data-loss)/.test(command) && !command.includes("scripts/prisma-safe.ts")) {
    violations.push(`package.json script ${name} runs destructive prisma db push without scripts/prisma-safe.ts`);
  }
}

for (const file of collectSourceFiles(["scripts", "src"])) {
  const content = readFileSync(file, "utf8");

  if ((content.includes(".deleteMany") || content.includes("deleteMany:")) && !allowedDeleteManyFiles.has(file)) {
    violations.push(`${file} contains deleteMany outside the reviewed allowlist`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Database safety scan passed.");

function collectSourceFiles(roots: string[]) {
  const files: string[] = [];

  for (const root of roots) {
    for (const entry of readdirSync(root)) {
      const path = join(root, entry);
      const stat = statSync(path);

      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".next") {
          continue;
        }

        files.push(...collectSourceFiles([path]));
      } else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry)) {
        files.push(path);
      }
    }
  }

  return files;
}
