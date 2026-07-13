import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";
import { getEmbeddingRuntimeConfig } from "../src/lib/server/embedding-config";
import { getPrisma } from "../src/lib/server/db";
import { validateEmbeddingStore } from "../src/lib/server/embedding-validation";

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database/vector validation failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();

  const config = getEmbeddingRuntimeConfig();
  const prisma = await getPrisma();

  try {
    const report = await validateEmbeddingStore(prisma, {
      model: config.model,
      dimensions: config.dimensions
    });

    console.log(JSON.stringify(report, null, 2));

    if (!report.ok) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect?.();
  }
}
