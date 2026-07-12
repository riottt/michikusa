import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import { HarnessError, assertSigningKey, signReceipt, validateReceipt } from "./contracts.mjs";
import { persistReceipt, readJson } from "./store.mjs";

const stages = ["red", "green", "final"];

async function execute(repoRoot, specification) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const child = spawn(specification.executable, specification.args, {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => hash.update(chunk));
    child.stderr.on("data", (chunk) => hash.update(chunk));
    child.on("error", (error) => reject(new HarnessError(`Verification command could not start: ${error.message}`)));
    child.on("close", (code, signal) => resolve({
      exitCode: Number.isInteger(code) ? code : 128,
      signal,
      outputSha256: hash.digest("hex"),
    }));
  });
}

export async function runVerification(repoRoot, state, stage, commandName, config, now, signingKey) {
  assertSigningKey(signingKey);
  if (state.phase !== "implementation" || state.plan.status !== "ready" || state.implementation.status !== "blocked") {
    throw new HarnessError("Verification is only allowed during an open implementation phase.", {
      nextActions: [state.review.status === "changes_requested" ? `Run: npm run harness -- reopen ${state.slug}` : "Complete the plan before verification."],
    });
  }
  const stageIndex = stages.indexOf(stage);
  if (stageIndex === -1) {
    throw new HarnessError("Verification stage must be red, green, or final.", { exitCode: 2 });
  }
  if (state.implementation.receipts.length !== stageIndex) {
    throw new HarnessError(`Verification stage ${stage} is out of order.`, {
      nextActions: [`Run the ${stages[state.implementation.receipts.length] ?? "required"} stage next.`],
    });
  }
  for (const receiptPath of state.implementation.receipts) {
    validateReceipt(await readJson(path.join(repoRoot, receiptPath), "Verification receipt"), signingKey);
  }
  const specification = config.verification_commands[commandName];
  if (!specification) {
    throw new HarnessError(`Verification command is not allowlisted: ${commandName}`, {
      nextActions: ["Choose a command name from .codex/harness/config.json; arbitrary shell input is not accepted."],
    });
  }
  const result = await execute(repoRoot, specification);
  const expected = stage === "red" ? result.exitCode !== 0 : result.exitCode === 0;
  if (!expected) {
    throw new HarnessError(`${stage} verification produced unexpected exit code ${result.exitCode}.`, {
      nextActions: [stage === "red" ? "Make the new regression test fail for the intended reason, then rerun red." : "Fix the implementation or verification failure, then rerun this stage."],
    });
  }
  const receipt = signReceipt({
    version: 1,
    task_slug: state.slug,
    iteration: state.iteration,
    stage,
    command: commandName,
    timestamp: now(),
    exit_code: result.exitCode,
    output_sha256: result.outputSha256,
  }, signingKey);
  validateReceipt(receipt, signingKey);
  const receiptPath = await persistReceipt(repoRoot, state.slug, state.iteration, stage, receipt);
  return { receipt, receiptPath };
}
