import { access } from "node:fs/promises";
import path from "node:path";

import {
  HarnessError,
  assertArtifactProvenance,
  assertNoSecrets,
  assertSafeSlug,
  response,
  validateImplementation,
  validatePlan,
  validateReceipt,
  validateReview,
  validateState,
} from "./contracts.mjs";
import { checkHarnessInstallation } from "./health.mjs";
import { loadHarnessConfig, validateAgainstSchema } from "./schema.mjs";
import {
  persistArtifact,
  readJson,
  readRepositoryArtifact,
  readState,
  stateFile,
  withTaskLock,
  writeJsonAtomic,
} from "./store.mjs";
import { runVerification } from "./verifier.mjs";

const defaultRepoRoot = path.resolve(import.meta.dirname, "../..");
const commands = ["init", "plan", "verify", "implement", "review", "reopen", "status", "resume", "check"];
const mutatingCommands = new Set(["init", "plan", "verify", "implement", "review", "reopen"]);
const stages = ["red", "green", "final"];

function parseArguments(arguments_) {
  const normalized = arguments_[0] === "--resume" ? ["resume", ...arguments_.slice(1)] : arguments_;
  const [command, slug, ...rest] = normalized;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new HarnessError(`Unexpected argument: ${token}`, { exitCode: 2 });
    const name = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new HarnessError(`Option --${name} requires a value.`, { exitCode: 2 });
    options[name] = value;
    index += 1;
  }
  return { command, slug, options };
}

function requireOption(options, name) {
  if (!options[name]) throw new HarnessError(`Missing required option --${name}.`, { exitCode: 2 });
  return options[name];
}

function event(state, action, now, summary) {
  const timestamp = now();
  return {
    ...state,
    updated_at: timestamp,
    history: [...state.history, { at: timestamp, action, summary, iteration: state.iteration }],
  };
}

function nextActionsFor(state) {
  if (state.phase === "plan") return [`Create a plan artifact in .codex/harness/inbox, then run: npm run harness -- plan ${state.slug} --artifact <file>`];
  if (state.phase === "implementation") {
    const stage = stages[state.implementation.receipts.length];
    if (stage) return [`Run an allowlisted ${stage} receipt: npm run harness -- verify ${state.slug} --stage ${stage} --command <name>`];
    return [`Create implementation evidence from the three receipts, then run: npm run harness -- implement ${state.slug} --artifact <file>`];
  }
  if (state.phase === "review" && state.review.status === "changes_requested") return [`Run: npm run harness -- reopen ${state.slug}`];
  if (state.phase === "review") return [`Review with a different declared actor_id, then run: npm run harness -- review ${state.slug} --artifact <file>`];
  return ["Task is complete; start a new slug for additional work."];
}

function stateResponse(summary, state, repoRoot, additionalArtifacts = []) {
  const artifacts = [
    path.relative(repoRoot, stateFile(repoRoot, state.slug)),
    ...additionalArtifacts,
    ...[state.plan.artifact, state.implementation.artifact, state.review.artifact].filter(Boolean),
    ...state.implementation.receipts,
  ];
  return response("success", summary, {
    nextActions: nextActionsFor(state),
    artifacts: [...new Set(artifacts)],
    state,
  });
}

async function validateAndWriteState(repoRoot, state) {
  await validateAgainstSchema(repoRoot, "state", state);
  validateState(state);
  await writeJsonAtomic(repoRoot, stateFile(repoRoot, state.slug), state);
}

async function initialize(repoRoot, slug, goal, now) {
  const filePath = stateFile(repoRoot, slug);
  let exists = true;
  try { await access(filePath); } catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
  if (exists) throw new HarnessError(`Task ${slug} already exists.`, { nextActions: [`Run: npm run harness -- --resume ${slug}`] });
  const timestamp = now();
  const state = {
    version: 1,
    slug,
    goal,
    phase: "plan",
    completed: false,
    iteration: 1,
    created_at: timestamp,
    updated_at: timestamp,
    plan: { status: "pending", artifact: null, actor_id: null },
    implementation: { status: "blocked", artifact: null, actor_id: null, receipts: [], receipt_signatures: [] },
    review: { status: "blocked", artifact: null, actor_id: null },
    history: [{ at: timestamp, action: "init", summary: "Harness task initialized.", iteration: 1 }],
  };
  await validateAndWriteState(repoRoot, state);
  return stateResponse(`Initialized harness task ${slug}.`, state, repoRoot);
}

async function loadArtifact(repoRoot, artifactPath, schemaName) {
  const { document } = await readRepositoryArtifact(repoRoot, artifactPath, `${schemaName} artifact`);
  await validateAgainstSchema(repoRoot, schemaName, document);
  assertNoSecrets(document);
  return document;
}

async function acceptPlan(repoRoot, slug, artifactPath, now) {
  const state = await readState(repoRoot, slug);
  if (state.phase !== "plan" || state.plan.status !== "pending") throw new HarnessError("Plan can only be accepted while plan status is pending.", { nextActions: nextActionsFor(state) });
  const document = validatePlan(await loadArtifact(repoRoot, artifactPath, "plan"));
  assertArtifactProvenance(document, { role: "planner", slug, iteration: state.iteration });
  const storedArtifact = await persistArtifact(repoRoot, slug, "plan", document);
  const updated = event({ ...state, phase: "implementation", plan: { status: "ready", artifact: storedArtifact, actor_id: document.actor_id } }, "plan_ready", now, document.summary);
  await validateAndWriteState(repoRoot, updated);
  return stateResponse("Plan accepted; TDD verification is now allowed.", updated, repoRoot);
}

async function verify(repoRoot, slug, stage, commandName, now, signingKey) {
  const state = await readState(repoRoot, slug);
  const config = await loadHarnessConfig(repoRoot);
  const { receipt, receiptPath } = await runVerification(repoRoot, state, stage, commandName, config, now, signingKey);
  const updated = event({
    ...state,
    implementation: {
      ...state.implementation,
      receipts: [...state.implementation.receipts, receiptPath],
      receipt_signatures: [...state.implementation.receipt_signatures, receipt.signature],
    },
  }, `verify_${stage}`, now, `${stage} verification receipt recorded.`);
  await validateAndWriteState(repoRoot, updated);
  return stateResponse(`${stage} verification receipt recorded.`, updated, repoRoot, [receiptPath]);
}

async function assertReceiptEvidence(repoRoot, state, verification, signingKey) {
  if (state.implementation.receipts.length !== 3) throw new HarnessError("Implementation requires red, green, and final harness receipts.");
  for (let index = 0; index < stages.length; index += 1) {
    const receiptPath = state.implementation.receipts[index];
    const receipt = validateReceipt(await readJson(path.join(repoRoot, receiptPath), "Verification receipt"), signingKey);
    const evidence = verification[index];
    const matches = evidence.stage === receipt.stage
      && evidence.command === receipt.command
      && evidence.receipt === receiptPath
      && evidence.exit_code === receipt.exit_code
      && evidence.output_sha256 === receipt.output_sha256
      && evidence.receipt_signature === receipt.signature
      && state.implementation.receipt_signatures[index] === receipt.signature
      && receipt.task_slug === state.slug
      && receipt.iteration === state.iteration;
    if (!matches) throw new HarnessError(`Implementation evidence does not match the ${stages[index]} receipt.`);
  }
}

async function acceptImplementation(repoRoot, slug, artifactPath, now, signingKey) {
  const state = await readState(repoRoot, slug);
  if (state.plan.status !== "ready" || state.phase !== "implementation" || state.implementation.status !== "blocked") throw new HarnessError("Implementation is blocked until a ready plan exists or requested changes are reopened.", { nextActions: nextActionsFor(state) });
  const document = validateImplementation(await loadArtifact(repoRoot, artifactPath, "implementation"));
  assertArtifactProvenance(document, { role: "implementer", slug, iteration: state.iteration });
  await assertReceiptEvidence(repoRoot, state, document.verification, signingKey);
  const storedArtifact = await persistArtifact(repoRoot, slug, `implementation-${state.iteration}`, document);
  const updated = event({
    ...state,
    phase: "review",
    implementation: { ...state.implementation, status: "success", artifact: storedArtifact, actor_id: document.actor_id },
    review: { status: "blocked", artifact: null, actor_id: null },
  }, "implementation_success", now, document.summary);
  await validateAndWriteState(repoRoot, updated);
  return stateResponse("Implementation evidence accepted; review is now allowed.", updated, repoRoot);
}

async function acceptReview(repoRoot, slug, artifactPath, now) {
  const state = await readState(repoRoot, slug);
  if (state.implementation.status !== "success" || state.phase !== "review" || state.review.status !== "blocked") throw new HarnessError("Review is blocked until implementation succeeds.", { nextActions: nextActionsFor(state) });
  const document = validateReview(await loadArtifact(repoRoot, artifactPath, "review"));
  assertArtifactProvenance(document, { role: "reviewer", slug, iteration: state.iteration });
  if (document.actor_id === state.implementation.actor_id) {
    throw new HarnessError("Declared reviewer actor_id must differ from the implementation actor_id.", {
      nextActions: ["Use a separately declared reviewer actor. This is provenance metadata, not cryptographic identity proof."],
    });
  }
  const storedArtifact = await persistArtifact(repoRoot, slug, `review-${state.iteration}`, document);
  const approved = document.status === "approved";
  const updated = event({
    ...state,
    phase: approved ? "complete" : "review",
    completed: approved,
    review: { status: document.status, artifact: storedArtifact, actor_id: document.actor_id },
  }, approved ? "review_approved" : "changes_requested", now, document.summary);
  await validateAndWriteState(repoRoot, updated);
  return stateResponse(approved ? "Review approved; task is complete." : "Review requested changes; explicit reopen is required.", updated, repoRoot);
}

async function reopen(repoRoot, slug, now) {
  const state = await readState(repoRoot, slug);
  if (state.phase !== "review" || state.review.status !== "changes_requested") throw new HarnessError("Only a changes_requested review can be reopened.", { nextActions: nextActionsFor(state) });
  const nextIteration = state.iteration + 1;
  const updated = event({
    ...state,
    phase: "implementation",
    completed: false,
    iteration: nextIteration,
    implementation: { status: "blocked", artifact: null, actor_id: null, receipts: [], receipt_signatures: [] },
    review: { status: "blocked", artifact: null, actor_id: null },
  }, "reopen_implementation", now, "Requested changes returned to implementation.");
  await validateAndWriteState(repoRoot, updated);
  return stateResponse("Task reopened for another implementation iteration.", updated, repoRoot);
}

async function check(repoRoot, slug) {
  await checkHarnessInstallation(repoRoot);
  const state = await readState(repoRoot, slug);
  return stateResponse(`Task ${slug}, config, schemas, roles, and skill are valid.`, state, repoRoot);
}

async function dispatch({ command, slug, options }, context) {
  if (!command || command === "help" || command === "--help") return response("success", "MICHIKUSA delivery harness", { nextActions: [`Use ${commands.join(", ")}.`], artifacts: ["docs/HARNESS.md"] });
  if (!commands.includes(command)) throw new HarnessError(`Unknown harness command: ${command}`, { exitCode: 2 });
  assertSafeSlug(slug);
  const operation = async () => {
    if (command === "init") return initialize(context.repoRoot, slug, requireOption(options, "goal"), context.now);
    if (command === "plan") return acceptPlan(context.repoRoot, slug, requireOption(options, "artifact"), context.now);
    if (command === "verify") return verify(context.repoRoot, slug, requireOption(options, "stage"), requireOption(options, "command"), context.now, context.signingKey);
    if (command === "implement") return acceptImplementation(context.repoRoot, slug, requireOption(options, "artifact"), context.now, context.signingKey);
    if (command === "review") return acceptReview(context.repoRoot, slug, requireOption(options, "artifact"), context.now);
    if (command === "reopen") return reopen(context.repoRoot, slug, context.now);
    if (command === "check") return check(context.repoRoot, slug);
    const state = await readState(context.repoRoot, slug);
    return stateResponse(command === "resume" ? `Resume ${slug} at the ${state.phase} phase.` : `Status for ${slug}.`, state, context.repoRoot);
  };
  return mutatingCommands.has(command) ? withTaskLock(context.repoRoot, slug, operation) : operation();
}

export async function runHarness(arguments_, options = {}) {
  const context = {
    repoRoot: options.repoRoot ?? defaultRepoRoot,
    now: options.now ?? (() => new Date().toISOString()),
    write: options.write ?? ((line) => process.stdout.write(`${line}\n`)),
    signingKey: Object.hasOwn(options, "signingKey") ? options.signingKey : process.env.MICHIKUSA_HARNESS_SIGNING_KEY,
  };
  try {
    const result = await dispatch(parseArguments(arguments_), context);
    context.write(JSON.stringify(result));
    return { exitCode: 0, result };
  } catch (error) {
    const harnessError = error instanceof HarnessError ? error : new HarnessError(error instanceof Error ? error.message : "Unknown harness error.");
    const result = response("error", harnessError.message, {
      nextActions: harnessError.nextActions.length > 0 ? harnessError.nextActions : ["Run status or check, correct the cause, then retry."],
      artifacts: harnessError.artifacts,
    });
    context.write(JSON.stringify(result));
    return { exitCode: harnessError.exitCode, result };
  }
}
