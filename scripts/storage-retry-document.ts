import { processStoredDocument } from "../src/lib/server/document-lifecycle";
import { getPrisma } from "../src/lib/server/db";
import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Document retry failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();

  const documentId = process.argv[2]?.trim();

  if (!documentId) {
    throw new Error("Usage: npm run storage:retry -- <documentId>");
  }

  const prisma = await getPrisma();
  const result = await processStoredDocument({
    prisma,
    documentId
  });

  await prisma.$disconnect?.();

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result
      },
      null,
      2
    )
  );
}
