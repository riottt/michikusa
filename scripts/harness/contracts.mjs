import { createHmac, timingSafeEqual } from "node:crypto";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isStringArray = (value) => Array.isArray(value) && value.every(isNonEmptyString);
const isNonEmptyStringArray = (value) => isStringArray(value) && value.length > 0;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b(?:TURSO_AUTH_TOKEN|GOOGLE_CLIENT_SECRET|API_KEY)\s*[:=]\s*\S+/i,
];

export class HarnessError extends Error {
  constructor(summary, { exitCode = 1, nextActions = [], artifacts = [] } = {}) {
    super(summary);
    this.name = "HarnessError";
    this.exitCode = exitCode;
    this.nextActions = nextActions;
    this.artifacts = artifacts;
  }
}

export function response(status, summary, { nextActions = [], artifacts = [], ...extra } = {}) {
  return {
    status,
    summary,
    next_actions: nextActions,
    artifacts,
    ...extra,
  };
}

function requireFields(document, fields, label) {
  if (!isObject(document)) {
    throw new HarnessError(`${label} artifact must be a JSON object.`);
  }
  const missing = fields.filter((field) => document[field] === undefined);
  if (missing.length > 0) {
    throw new HarnessError(`${label} artifact is missing required fields: ${missing.join(", ")}.`, {
      nextActions: [`Update the ${label.toLowerCase()} artifact to match its JSON schema.`],
    });
  }
}

export function validatePlan(document) {
  requireFields(document, ["version", "status", "summary", "steps", "risks", "acceptance_criteria"], "Plan");
  const validSteps = Array.isArray(document.steps)
    && document.steps.length > 0
    && document.steps.every((step) => isObject(step)
      && isNonEmptyString(step.id)
      && isNonEmptyString(step.description)
      && isNonEmptyString(step.verification));
  if (document.version !== 1 || document.status !== "ready" || !isNonEmptyString(document.summary)
    || !validSteps || !isStringArray(document.risks) || !isNonEmptyStringArray(document.acceptance_criteria)) {
    throw new HarnessError("Plan artifact does not satisfy the plan contract.", {
      nextActions: ["Provide a ready plan with steps, risks, and acceptance criteria."],
    });
  }
  return document;
}

export function assertArtifactProvenance(document, { role, slug, iteration }) {
  if (document.role !== role || document.task_slug !== slug || document.iteration !== iteration) {
    throw new HarnessError(`Artifact provenance does not match ${role}, task ${slug}, iteration ${iteration}.`, {
      nextActions: ["Regenerate the artifact with the declared role, task_slug, and current iteration."],
    });
  }
}

export function assertNoSecrets(document) {
  const serialized = JSON.stringify(document);
  if (secretPatterns.some((pattern) => pattern.test(serialized))) {
    throw new HarnessError("Artifact appears to contain a secret or sensitive credential value.", {
      nextActions: ["Remove the credential, rotate it if exposed, and reference only a secret name."],
    });
  }
}

export function validateImplementation(document) {
  requireFields(document, ["version", "status", "summary", "changes", "verification", "artifacts"], "Implementation");
  const validVerification = Array.isArray(document.verification) && document.verification.length === 3;
  if (document.version !== 1 || document.status !== "success" || !isNonEmptyString(document.summary)
    || !isNonEmptyStringArray(document.changes) || !validVerification || !isStringArray(document.artifacts)) {
    throw new HarnessError("Implementation artifact does not prove a successful implementation.", {
      nextActions: ["Run the required verification and record only passed commands before retrying."],
    });
  }
  return document;
}

export function validateReview(document) {
  requireFields(document, ["version", "status", "summary", "findings", "verification", "next_actions"], "Review");
  const validFindings = Array.isArray(document.findings) && document.findings.every((finding) => isObject(finding)
    && ["critical", "high", "medium", "low"].includes(finding.severity)
    && isNonEmptyString(finding.summary)
    && isNonEmptyString(finding.recommendation));
  if (document.version !== 1 || !["approved", "changes_requested"].includes(document.status)
    || !isNonEmptyString(document.summary) || !validFindings
    || !isNonEmptyStringArray(document.verification) || !Array.isArray(document.next_actions)
    || !document.next_actions.every(isNonEmptyString)) {
    throw new HarnessError("Review artifact does not satisfy the review contract.", {
      nextActions: ["Provide an approved or changes_requested review with findings and verification."],
    });
  }
  if (document.status === "approved" && document.findings.some((finding) => ["critical", "high"].includes(finding.severity))) {
    throw new HarnessError("A review with critical or high findings cannot be approved.", {
      nextActions: ["Request changes or remove findings only after they are verified as resolved."],
    });
  }
  if (document.status === "changes_requested" && document.findings.length === 0) {
    throw new HarnessError("A changes_requested review must include at least one finding.");
  }
  return document;
}

export function validateState(state) {
  requireFields(state, ["version", "slug", "goal", "phase", "completed", "plan", "implementation", "review", "history"], "State");
  const valid = state.version === 1
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.slug)
    && isNonEmptyString(state.goal)
    && ["plan", "implementation", "review", "complete"].includes(state.phase)
    && typeof state.completed === "boolean"
    && ["pending", "ready"].includes(state.plan?.status)
    && ["blocked", "success"].includes(state.implementation?.status)
    && ["blocked", "approved", "changes_requested"].includes(state.review?.status)
    && Number.isInteger(state.iteration)
    && state.iteration > 0
    && Array.isArray(state.implementation?.receipts)
    && Array.isArray(state.implementation?.receipt_signatures)
    && Array.isArray(state.history);
  if (!valid) {
    throw new HarnessError("State file is invalid or corrupted.", {
      nextActions: ["Restore the state from version control or initialize a new task with a different slug."],
    });
  }
  const validPhase = (state.phase === "plan"
      && state.plan.status === "pending"
      && state.plan.actor_id === null
      && state.implementation.status === "blocked"
      && state.implementation.actor_id === null
      && state.implementation.receipts.length === 0
      && state.implementation.receipt_signatures.length === 0
      && state.review.status === "blocked"
      && state.review.actor_id === null
      && !state.completed)
    || (state.phase === "implementation"
      && state.plan.status === "ready"
      && isNonEmptyString(state.plan.actor_id)
      && state.implementation.status === "blocked"
      && state.implementation.actor_id === null
      && state.implementation.receipts.length === state.implementation.receipt_signatures.length
      && state.review.status === "blocked"
      && state.review.actor_id === null
      && !state.completed)
    || (state.phase === "review"
      && state.plan.status === "ready"
      && state.implementation.status === "success"
      && isNonEmptyString(state.implementation.actor_id)
      && state.implementation.receipts.length === 3
      && state.implementation.receipt_signatures.length === 3
      && ["blocked", "changes_requested"].includes(state.review.status)
      && (state.review.status === "blocked" ? state.review.actor_id === null : isNonEmptyString(state.review.actor_id))
      && !state.completed)
    || (state.phase === "complete"
      && state.plan.status === "ready"
      && state.implementation.status === "success"
      && isNonEmptyString(state.implementation.actor_id)
      && state.implementation.receipts.length === 3
      && state.implementation.receipt_signatures.length === 3
      && state.review.status === "approved"
      && isNonEmptyString(state.review.actor_id)
      && state.completed);
  if (!validPhase) {
    throw new HarnessError("State file violates a phase transition invariant.");
  }
  return state;
}

export function assertSafeSlug(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new HarnessError("Task slug must use lowercase letters, numbers, and single hyphens only.", {
      exitCode: 2,
      nextActions: ["Choose a slug such as map-interaction-fix."],
    });
  }
}

export function assertSigningKey(signingKey) {
  if (typeof signingKey !== "string" || Buffer.byteLength(signingKey) < 32) {
    throw new HarnessError("MICHIKUSA harness signing key is missing or shorter than 32 bytes.", {
      nextActions: ["Have the trusted orchestrator set MICHIKUSA_HARNESS_SIGNING_KEY; do not disclose it to the implementer role."],
    });
  }
  return signingKey;
}

function canonicalReceipt(receipt) {
  return JSON.stringify({
    version: receipt.version,
    task_slug: receipt.task_slug,
    iteration: receipt.iteration,
    stage: receipt.stage,
    command: receipt.command,
    timestamp: receipt.timestamp,
    exit_code: receipt.exit_code,
    output_sha256: receipt.output_sha256,
  });
}

export function signReceipt(receipt, signingKey) {
  const key = assertSigningKey(signingKey);
  return {
    ...receipt,
    signature: createHmac("sha256", key).update(canonicalReceipt(receipt)).digest("hex"),
  };
}

export function validateReceipt(receipt, signingKey) {
  const keys = Object.keys(receipt).sort();
  const expectedKeys = ["command", "exit_code", "iteration", "output_sha256", "signature", "stage", "task_slug", "timestamp", "version"].sort();
  const valid = JSON.stringify(keys) === JSON.stringify(expectedKeys)
    && receipt.version === 1
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(receipt.task_slug)
    && Number.isInteger(receipt.iteration)
    && receipt.iteration > 0
    && ["red", "green", "final"].includes(receipt.stage)
    && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(receipt.command)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.timestamp)
    && Number.isInteger(receipt.exit_code)
    && /^[a-f0-9]{64}$/.test(receipt.output_sha256)
    && /^[a-f0-9]{64}$/.test(receipt.signature);
  if (!valid) throw new HarnessError("Verification receipt is invalid or corrupted.");
  const key = assertSigningKey(signingKey);
  const expected = createHmac("sha256", key).update(canonicalReceipt(receipt)).digest();
  const actual = Buffer.from(receipt.signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new HarnessError("Verification receipt signature is invalid; receipt authenticity cannot be established.", {
      nextActions: ["Discard the tampered receipt and rerun the allowlisted verification with the trusted orchestrator."],
    });
  }
  return receipt;
}
