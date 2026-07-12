#!/usr/bin/env node
import { runHarness } from "./harness/core.mjs";

const { exitCode } = await runHarness(process.argv.slice(2));
process.exitCode = exitCode;
