#!/usr/bin/env node

import { runInspectorCli } from "./adapters/cli/index.js";

const result = await runInspectorCli({
  argv: process.argv.slice(2),
});

process.exitCode = result.exitCode;
