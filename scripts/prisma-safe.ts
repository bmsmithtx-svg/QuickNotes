import { spawn } from "node:child_process";

import { assertDatabaseAllowsDestructiveAction, getDestructivePrismaAction } from "./db-safety";
import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";

loadScriptEnv();

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: tsx scripts/prisma-safe.ts <prisma command>");
  process.exit(1);
}

requireDatabaseScriptConfig();

const destructiveAction = getDestructivePrismaAction(args);

if (destructiveAction) {
  assertDatabaseAllowsDestructiveAction(process.env, destructiveAction);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["prisma", ...args], {
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`prisma ${args.join(" ")} exited from signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
