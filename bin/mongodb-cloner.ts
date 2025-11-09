#!/usr/bin/env node

import "dotenv/config";

import { runCli } from "../src/index.js";

async function main() {
  const args = process.argv.slice(2);
  const skipIndexes = args.includes("--skip-indexes");
  const xronoxMode = args.includes("--xronox");
  await runCli({ skipIndexes, xronoxMode });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
