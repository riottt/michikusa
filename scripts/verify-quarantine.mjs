import { spawnSync } from "node:child_process";
import process from "node:process";

import {
  DUPLICATE_AGENT_SERVICE_ACCOUNT,
  DUPLICATE_BROWSER_KEY,
  DUPLICATE_PROJECT_ID,
  DUPLICATE_REGION,
  DUPLICATE_SERVER_KEY,
  projectedArray,
  projectedObject,
  validateQuarantineSnapshot
} from "./quarantine-contracts.mjs";

const cloudRunServices = ["michikusa-web", "michikusa-agent"];

function gcloudJson(args, label) {
  const result = spawnSync("gcloud", args, {
    encoding: "utf8",
    env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} read failed`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function publicStatus(url, label) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    return response.status;
  } catch {
    throw new Error(`${label} public endpoint probe failed`);
  }
}

async function readCloudRunService(name) {
  const service = projectedObject(gcloudJson(
    [
      "run",
      "services",
      "describe",
      name,
      `--project=${DUPLICATE_PROJECT_ID}`,
      `--region=${DUPLICATE_REGION}`,
      "--format=json(metadata.annotations,spec.template.spec.serviceAccountName,status.latestReadyRevisionName,status.url)"
    ],
    `${name} service`
  ));
  const revisionName = service.status?.latestReadyRevisionName;
  if (!revisionName) throw new Error(`${name} latest revision is missing`);
  const revision = projectedObject(gcloudJson(
    [
      "run",
      "revisions",
      "describe",
      revisionName,
      `--project=${DUPLICATE_PROJECT_ID}`,
      `--region=${DUPLICATE_REGION}`,
      "--format=json(metadata.annotations)"
    ],
    `${name} revision`
  ));
  const iam = projectedObject(gcloudJson(
    [
      "run",
      "services",
      "get-iam-policy",
      name,
      `--project=${DUPLICATE_PROJECT_ID}`,
      `--region=${DUPLICATE_REGION}`,
      "--format=json(bindings)"
    ],
    `${name} IAM`
  ));
  const url = service.status?.url;
  if (typeof url !== "string") throw new Error(`${name} public URL is missing`);
  return {
    name,
    serviceAccountName: service.spec?.template?.spec?.serviceAccountName,
    serviceAnnotations: service.metadata?.annotations ?? {},
    revisionAnnotations: revision.metadata?.annotations ?? {},
    iamBindings: projectedArray(iam.bindings),
    publicUrl: url,
    publicStatus: await publicStatus(url, name)
  };
}

async function collectSnapshot() {
  const project = projectedObject(gcloudJson(
    ["projects", "describe", DUPLICATE_PROJECT_ID, "--format=json(projectId,projectNumber)"],
    "project identity"
  ));
  const projectIam = projectedObject(gcloudJson(
    ["projects", "get-iam-policy", DUPLICATE_PROJECT_ID, "--format=json(bindings)"],
    "project IAM"
  ));
  const enabledServiceRecords = projectedArray(gcloudJson(
    [
      "services",
      "list",
      "--enabled",
      `--project=${DUPLICATE_PROJECT_ID}`,
      "--format=json(config.name)"
    ],
    "enabled services"
  ));
  const browserKey = projectedObject(gcloudJson(
    [
      "services",
      "api-keys",
      "describe",
      DUPLICATE_BROWSER_KEY,
      `--project=${DUPLICATE_PROJECT_ID}`,
      "--format=json(name,restrictions)"
    ],
    "browser key restrictions"
  ));
  const serverKey = projectedObject(gcloudJson(
    [
      "services",
      "api-keys",
      "describe",
      DUPLICATE_SERVER_KEY,
      `--project=${DUPLICATE_PROJECT_ID}`,
      "--format=json(name,restrictions)"
    ],
    "server key restrictions"
  ));
  const cloudRun = await Promise.all(cloudRunServices.map(readCloudRunService));
  const agentService = cloudRun.find((service) => service.name === "michikusa-agent");

  return {
    project,
    region: DUPLICATE_REGION,
    agentServiceAccount: agentService?.serviceAccountName ?? DUPLICATE_AGENT_SERVICE_ACCOUNT,
    projectIamBindings: projectedArray(projectIam.bindings),
    enabledServices: enabledServiceRecords.map((record) => record.config?.name).filter(Boolean),
    browserKey,
    serverKey,
    cloudRun
  };
}

try {
  const failures = validateQuarantineSnapshot(await collectSnapshot());
  if (failures.length) {
    console.error(`Duplicate quarantine verification failed (${failures.length}):`);
    failures.forEach((item) => console.error(`- ${item.code}: ${item.message}`));
    process.exitCode = 1;
  } else {
    console.log("Duplicate quarantine verified: billing APIs disabled, credentials unusable, IAM closed, scale bounded, public endpoints denied.");
  }
} catch (error) {
  console.error(`Duplicate quarantine verification could not complete: ${error.message}`);
  process.exitCode = 2;
}
