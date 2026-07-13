import { loadScriptEnv } from "./script-env";
import { MissingOpenAiApiKeyError, requireEmbeddingRuntimeConfig } from "../src/lib/server/embedding-config";
import { createOpenAIEmbeddingService } from "../src/lib/server/embedding-service";
import { backfillChunkEmbeddings, type EmbeddingSyncMode } from "../src/lib/server/embedding-sync";
import { getPrisma } from "../src/lib/server/db";

loadScriptEnv();

type CliOptions = {
  mode: EmbeddingSyncMode;
  documentId?: string;
};

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = requireEmbeddingRuntimeConfig();
  const prisma = await getPrisma();
  try {
    const embeddingService = createOpenAIEmbeddingService({
      apiKey: config.apiKey,
      model: config.model
    });
    const result = await backfillChunkEmbeddings(prisma, embeddingService, options);

    console.log(
      JSON.stringify(
        {
          mode: options.mode,
          documentId: options.documentId ?? null,
          processed: result.processed,
          skipped: result.skipped,
          succeeded: result.succeeded,
          failed: result.failed,
          model: result.model,
          errorMessage: result.errorMessage ?? null
        },
        null,
        2
      )
    );

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect?.();
  }
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    mode: "stale"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--all") {
      options.mode = "all";
    } else if (arg === "--missing") {
      options.mode = "missing";
    } else if (arg === "--stale") {
      options.mode = "stale";
    } else if (arg === "--documentId") {
      const documentId = args[index + 1]?.trim();

      if (!documentId) {
        throw new Error("--documentId requires a value.");
      }

      options.documentId = documentId;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

main().catch((error: unknown) => {
  if (error instanceof MissingOpenAiApiKeyError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error(error instanceof Error ? error.message : "Embedding backfill failed.");
  process.exitCode = 1;
});
