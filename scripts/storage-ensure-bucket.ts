import { ensureConfiguredStorage } from "../src/lib/server/storage";
import { loadScriptEnv } from "./script-env";

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Storage bucket check failed.");
  process.exitCode = 1;
});

async function main() {
  const result = await ensureConfiguredStorage();

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
