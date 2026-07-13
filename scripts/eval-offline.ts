import { loadScriptEnv } from "./script-env";
import {
  STRICT_THRESHOLDS,
  createFixtureAnswerClient,
  loadFixtureSet,
  printEvalReport,
  runRagEvaluation
} from "./rag-eval";

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Offline RAG evaluation failed.");
  process.exitCode = 1;
});

async function main() {
  const fixture = loadFixtureSet();
  const report = await runRagEvaluation({
    fixture,
    cases: fixture.cases,
    model: "offline-fixture-model",
    answerClient: createFixtureAnswerClient(fixture),
    thresholds: STRICT_THRESHOLDS
  });

  printEvalReport(report);

  if (!report.passed) {
    process.exitCode = 1;
  }
}
