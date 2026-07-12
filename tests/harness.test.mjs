import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runHarness } from "../scripts/harness/core.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fixturesDirectory = path.join(import.meta.dirname, "fixtures", "harness");
const signingKey = "test-only-".repeat(4);

async function createRepository() {
  const repository = await mkdtemp(path.join(os.tmpdir(), "michikusa-harness-"));
  const harnessDirectory = path.join(repository, ".codex", "harness");
  await mkdir(path.join(harnessDirectory, "runtime"), { recursive: true });
  await mkdir(path.join(harnessDirectory, "inbox"), { recursive: true });
  await cp(path.join(repositoryRoot, ".codex", "harness", "schemas"), path.join(harnessDirectory, "schemas"), { recursive: true });
  await cp(path.join(repositoryRoot, ".codex", "agents"), path.join(repository, ".codex", "agents"), { recursive: true });
  await cp(path.join(repositoryRoot, ".codex", "skills"), path.join(repository, ".codex", "skills"), { recursive: true });
  await cp(path.join(repositoryRoot, ".codex", "config.toml"), path.join(repository, ".codex", "config.toml"));
  await writeFile(path.join(harnessDirectory, "config.json"), `${JSON.stringify({
    version: 1,
    runtime_directory: ".codex/harness/runtime",
    logs_directory: ".codex/harness/logs",
    automatic_agent_execution: false,
    roles: { plan: "planner", implementation: "implementer", review: "reviewer" },
    schemas: {
      plan: ".codex/harness/schemas/plan.schema.json",
      implementation: ".codex/harness/schemas/implementation.schema.json",
      review: ".codex/harness/schemas/review.schema.json",
      state: ".codex/harness/schemas/state.schema.json",
    },
    verification_commands: {
      "fixture-pass": { executable: process.execPath, args: ["-e", "process.stdout.write('ok')"] },
      "fixture-fail": { executable: process.execPath, args: ["-e", "process.stderr.write('expected red'); process.exit(3)"] },
    },
    output_contract: ["status", "summary", "next_actions", "artifacts"],
  }, null, 2)}\n`, "utf8");
  return repository;
}

async function writeArtifact(repository, fixtureName, { taskSlug, actorId, iteration = 1, verification } = {}) {
  const document = JSON.parse(await readFile(path.join(fixturesDirectory, fixtureName), "utf8"));
  const artifact = {
    ...document,
    task_slug: taskSlug ?? document.task_slug,
    actor_id: actorId ?? document.actor_id,
    iteration,
    ...(verification ? { verification } : {}),
  };
  const target = path.join(repository, ".codex", "harness", "inbox", `${taskSlug}-${fixtureName}`);
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return path.relative(repository, target);
}

async function invoke(repository, arguments_, options = {}) {
  const output = [];
  const result = await runHarness(arguments_, {
    repoRoot: repository,
    now: () => "2026-07-12T00:00:00.000Z",
    signingKey: Object.hasOwn(options, "signingKey") ? options.signingKey : signingKey,
    write: (line) => output.push(JSON.parse(line)),
  });
  return { ...result, output };
}

async function initializePlannedTask(repository, slug) {
  const plan = await writeArtifact(repository, "plan.valid.json", { taskSlug: slug, actorId: "planner-one" });
  assert.equal((await invoke(repository, ["init", slug, "--goal", `Deliver ${slug}`])).exitCode, 0);
  assert.equal((await invoke(repository, ["plan", slug, "--artifact", plan])).exitCode, 0);
}

async function recordTddReceipts(repository, slug) {
  const receipts = [];
  for (const [stage, command] of [["red", "fixture-fail"], ["green", "fixture-pass"], ["final", "fixture-pass"]]) {
    const result = await invoke(repository, ["verify", slug, "--stage", stage, "--command", command]);
    assert.equal(result.exitCode, 0, `${stage} receipt should be accepted`);
    const receiptPath = result.output[0].artifacts.find((artifact) => artifact.includes("receipts"));
    const receipt = JSON.parse(await readFile(path.join(repository, receiptPath), "utf8"));
    receipts.push({
      stage: receipt.stage,
      command: receipt.command,
      receipt: receiptPath,
      exit_code: receipt.exit_code,
      output_sha256: receipt.output_sha256,
      receipt_signature: receipt.signature,
    });
  }
  return receipts;
}

async function acceptImplementation(repository, slug, actorId = "implementer-one") {
  const verification = await recordTddReceipts(repository, slug);
  const artifact = await writeArtifact(repository, "implementation.valid.json", {
    taskSlug: slug,
    actorId,
    verification,
  });
  const result = await invoke(repository, ["implement", slug, "--artifact", artifact]);
  assert.equal(result.exitCode, 0);
  return { verification, artifact };
}

test("rejects unsafe task slugs", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const result = await invoke(repository, ["init", "../escape", "--goal", "bad"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.output[0].summary, /slug/i);
});

test("enforces plan, receipt-backed implementation, independent review, and completion gates", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "route-quality";
  await initializePlannedTask(repository, slug);

  const premature = await writeArtifact(repository, "implementation.valid.json", { taskSlug: slug, actorId: "implementer-one" });
  assert.equal((await invoke(repository, ["implement", slug, "--artifact", premature])).exitCode, 1);

  await acceptImplementation(repository, slug);
  const sameActorReview = await writeArtifact(repository, "review.approved.json", { taskSlug: slug, actorId: "implementer-one" });
  const rejected = await invoke(repository, ["review", slug, "--artifact", sameActorReview]);
  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.output[0].summary, /actor|independent|provenance/i);

  const review = await writeArtifact(repository, "review.approved.json", { taskSlug: slug, actorId: "reviewer-one" });
  assert.equal((await invoke(repository, ["review", slug, "--artifact", review])).exitCode, 0);
  const status = await invoke(repository, ["status", slug]);
  assert.equal(status.output[0].state.phase, "complete");
  assert.equal(status.output[0].state.review.actor_id, "reviewer-one");
});

test("verify runs allowlisted commands and enforces stage outcomes", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "receipt-contract";
  await initializePlannedTask(repository, slug);

  assert.equal((await invoke(repository, ["verify", slug, "--stage", "red", "--command", "echo hacked"])).exitCode, 1);
  assert.equal((await invoke(repository, ["verify", slug, "--stage", "red", "--command", "fixture-pass"])).exitCode, 1);
  const verification = await recordTddReceipts(repository, slug);
  assert.deepEqual(verification.map((item) => item.exit_code), [3, 0, 0]);
  assert.ok(verification.every((item) => /^[a-f0-9]{64}$/.test(item.output_sha256)));
  const receiptFiles = await readdir(path.join(repository, ".codex", "harness", "runtime", slug, "receipts", "1"));
  assert.deepEqual(receiptFiles.sort(), ["final.json", "green.json", "red.json"]);
});

test("rejects implementation evidence that does not match receipts", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "receipt-drift";
  await initializePlannedTask(repository, slug);
  const verification = await recordTddReceipts(repository, slug);
  verification[1] = { ...verification[1], output_sha256: "0".repeat(64) };
  const artifact = await writeArtifact(repository, "implementation.valid.json", { taskSlug: slug, actorId: "implementer-one", verification });
  const result = await invoke(repository, ["implement", slug, "--artifact", artifact]);
  assert.equal(result.exitCode, 1);
  assert.match(result.output[0].summary, /receipt|evidence/i);
});

test("rejects tampered receipts even when implementation evidence is changed to match", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "signed-receipt";
  await initializePlannedTask(repository, slug);
  const verification = await recordTddReceipts(repository, slug);
  const greenPath = path.join(repository, verification[1].receipt);
  const green = JSON.parse(await readFile(greenPath, "utf8"));
  const forgedHash = "a".repeat(64);
  await writeFile(greenPath, JSON.stringify({ ...green, output_sha256: forgedHash }), "utf8");
  verification[1] = { ...verification[1], output_sha256: forgedHash };
  const artifact = await writeArtifact(repository, "implementation.valid.json", {
    taskSlug: slug,
    actorId: "implementer-one",
    verification,
  });
  const result = await invoke(repository, ["implement", slug, "--artifact", artifact]);
  assert.equal(result.exitCode, 1);
  assert.match(result.output[0].summary, /signature|authentic|receipt/i);
});

test("fails closed when receipt signing key is unavailable", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "missing-signing-key";
  await initializePlannedTask(repository, slug);
  const result = await invoke(repository, ["verify", slug, "--stage", "red", "--command", "fixture-fail"], { signingKey: null });
  assert.equal(result.exitCode, 1);
  assert.match(result.output[0].summary, /signing key|key/i);
});

test("requires an explicit reopen after changes are requested", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "agent-copy";
  await initializePlannedTask(repository, slug);
  await acceptImplementation(repository, slug);
  const review = await writeArtifact(repository, "review.changes-requested.json", { taskSlug: slug, actorId: "reviewer-one" });
  assert.equal((await invoke(repository, ["review", slug, "--artifact", review])).exitCode, 0);
  assert.equal((await invoke(repository, ["verify", slug, "--stage", "red", "--command", "fixture-fail"])).exitCode, 1);
  const reopened = await invoke(repository, ["reopen", slug]);
  assert.equal(reopened.output[0].state.iteration, 2);
  assert.equal(reopened.output[0].state.implementation.receipts.length, 0);
});

test("Ajv rejects additional fields and artifact secret values", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "strict-schema";
  await invoke(repository, ["init", slug, "--goal", "Reject drift"]);
  const planPath = await writeArtifact(repository, "plan.valid.json", { taskSlug: slug, actorId: "planner-one" });
  const absolutePlan = path.join(repository, planPath);
  const plan = JSON.parse(await readFile(absolutePlan, "utf8"));
  await writeFile(absolutePlan, JSON.stringify({ ...plan, unexpected: true }), "utf8");
  assert.equal((await invoke(repository, ["plan", slug, "--artifact", planPath])).exitCode, 1);

  plan.summary = `Leaked ${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnopqrstuvwxyz1234567890"].join(".")}`;
  await writeFile(absolutePlan, JSON.stringify(plan), "utf8");
  const secret = await invoke(repository, ["plan", slug, "--artifact", planPath]);
  assert.equal(secret.exitCode, 1);
  assert.match(secret.output[0].summary, /secret|sensitive/i);
});

test("rejects artifact paths whose real path is outside the repository", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "path-boundary";
  await invoke(repository, ["init", slug, "--goal", "Stay inside"]);
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "outside-artifact-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outsidePath = path.join(outsideDirectory, "plan.json");
  const validPlan = JSON.parse(await readFile(path.join(fixturesDirectory, "plan.valid.json"), "utf8"));
  await writeFile(outsidePath, JSON.stringify({ ...validPlan, task_slug: slug, actor_id: "planner-one", iteration: 1 }), "utf8");
  const linkPath = path.join(repository, ".codex", "harness", "inbox", "outside-link.json");
  await symlink(outsidePath, linkPath);

  assert.equal((await invoke(repository, ["plan", slug, "--artifact", path.relative(repository, outsidePath)])).exitCode, 1);
  assert.equal((await invoke(repository, ["plan", slug, "--artifact", path.relative(repository, linkPath)])).exitCode, 1);
});

test("rejects runtime and task directory symlinks before writing", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const outside = await mkdtemp(path.join(os.tmpdir(), "harness-write-escape-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const runtime = path.join(repository, ".codex", "harness", "runtime");
  await rm(runtime, { recursive: true, force: true });
  await symlink(outside, runtime);
  assert.equal((await invoke(repository, ["init", "runtime-escape", "--goal", "reject"])).exitCode, 1);
  await assert.rejects(readFile(path.join(outside, "runtime-escape", "state.json"), "utf8"));

  await rm(runtime);
  await mkdir(runtime);
  await symlink(outside, path.join(runtime, "task-escape"));
  assert.equal((await invoke(repository, ["init", "task-escape", "--goal", "reject"])).exitCode, 1);
  await assert.rejects(readFile(path.join(outside, "state.json"), "utf8"));
});

test("check validates config, schemas, roles, skill, and runtime alignment", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "harness-health";
  await invoke(repository, ["init", slug, "--goal", "Check harness"]);
  assert.equal((await invoke(repository, ["check", slug])).exitCode, 0);

  const reviewerPath = path.join(repository, ".codex", "agents", "reviewer.toml");
  const reviewer = await readFile(reviewerPath, "utf8");
  await rm(reviewerPath);
  assert.equal((await invoke(repository, ["check", slug])).exitCode, 1);
  await writeFile(reviewerPath, reviewer, "utf8");

  const stateSchemaPath = path.join(repository, ".codex", "harness", "schemas", "state.schema.json");
  const stateSchema = await readFile(stateSchemaPath, "utf8");
  await writeFile(stateSchemaPath, "{broken", "utf8");
  assert.equal((await invoke(repository, ["check", slug])).exitCode, 1);
  await writeFile(stateSchemaPath, stateSchema, "utf8");

  const configPath = path.join(repository, ".codex", "harness", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, JSON.stringify({ ...config, roles: { ...config.roles, review: "wrong" } }), "utf8");
  assert.equal((await invoke(repository, ["check", slug])).exitCode, 1);
});

test("check rejects syntactically invalid TOML even when required substrings remain", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const slug = "toml-syntax";
  await invoke(repository, ["init", slug, "--goal", "Parse TOML"]);
  const configPath = path.join(repository, ".codex", "config.toml");
  const original = await readFile(configPath, "utf8");
  await writeFile(configPath, `${original}\n[[[\n`, "utf8");
  const result = await invoke(repository, ["check", slug]);
  assert.equal(result.exitCode, 1);
  assert.match(result.output[0].summary, /toml|config/i);
});

test("resume reports the next safe action and state writes are atomic", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  await invoke(repository, ["init", "resume-demo", "--goal", "Resume safely"]);
  const result = await invoke(repository, ["--resume", "resume-demo"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.output[0].next_actions[0], /plan/i);
  const directory = path.join(repository, ".codex", "harness", "runtime", "resume-demo");
  assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".tmp")), []);
});

test("rejects corrupted state and an existing task lock", async (t) => {
  const repository = await createRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  await invoke(repository, ["init", "safe-state", "--goal", "Stay safe"]);
  const directory = path.join(repository, ".codex", "harness", "runtime", "safe-state");
  const statePath = path.join(directory, "state.json");
  await writeFile(statePath, "{broken", "utf8");
  assert.equal((await invoke(repository, ["status", "safe-state"])).exitCode, 1);
  await rm(statePath);
  await writeFile(path.join(directory, ".lock"), "locked", "utf8");
  const locked = await invoke(repository, ["plan", "safe-state", "--artifact", "missing.json"]);
  assert.equal(locked.exitCode, 1);
  assert.match(locked.output[0].summary, /lock|running/i);
});
