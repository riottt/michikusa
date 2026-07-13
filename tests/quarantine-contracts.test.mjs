import assert from "node:assert/strict";
import test from "node:test";

import {
  DUPLICATE_PROJECT_ID,
  DUPLICATE_PROJECT_NUMBER,
  DUPLICATE_REGION,
  projectedArray,
  projectedObject,
  validateQuarantineSnapshot
} from "../scripts/quarantine-contracts.mjs";

const agentServiceAccount = "michikusa-agent@michikusa-hackathon-20260712.iam.gserviceaccount.com";

function passingSnapshot() {
  const service = (name, url) => ({
    name,
    serviceAnnotations: { "run.googleapis.com/maxScale": "1" },
    revisionAnnotations: { "autoscaling.knative.dev/maxScale": "1" },
    iamBindings: [],
    publicUrl: url,
    publicStatus: 403
  });

  return {
    project: { projectId: DUPLICATE_PROJECT_ID, projectNumber: DUPLICATE_PROJECT_NUMBER },
    region: DUPLICATE_REGION,
    agentServiceAccount,
    projectIamBindings: [],
    enabledServices: ["apikeys.googleapis.com", "run.googleapis.com"],
    browserKey: {
      name: `projects/${DUPLICATE_PROJECT_NUMBER}/locations/global/keys/michikusa-browser-v2`,
      restrictions: {
        apiTargets: [{ service: "maps-backend.googleapis.com" }],
        browserKeyRestrictions: { allowedReferrers: ["https://disabled.invalid/*"] }
      }
    },
    serverKey: {
      name: `projects/${DUPLICATE_PROJECT_NUMBER}/locations/global/keys/michikusa-server-v2`,
      restrictions: {
        apiTargets: [
          { service: "places.googleapis.com" },
          { service: "routes.googleapis.com" }
        ],
        serverKeyRestrictions: { allowedIps: ["192.0.2.1/32"] }
      }
    },
    cloudRun: [
      service("michikusa-web", "https://michikusa-web-ap2prbrn6q-an.a.run.app"),
      service("michikusa-agent", "https://michikusa-agent-ap2prbrn6q-an.a.run.app")
    ]
  };
}

test("accepts the complete reversible duplicate quarantine contract", () => {
  assert.deepEqual(validateQuarantineSnapshot(passingSnapshot()), []);
});

test("normalizes null projected gcloud objects and arrays without inventing state", () => {
  assert.deepEqual(projectedObject(null), {});
  assert.deepEqual(projectedObject({ bindings: [] }), { bindings: [] });
  assert.deepEqual(projectedArray(null), []);
  assert.deepEqual(projectedArray([{ config: { name: "run.googleapis.com" } }]), [
    { config: { name: "run.googleapis.com" } }
  ]);
});

test("reports exactly the current high-risk Vertex, billable API, and server-key gaps", () => {
  const snapshot = passingSnapshot();
  snapshot.projectIamBindings = [
    { role: "roles/aiplatform.user", members: [`serviceAccount:${agentServiceAccount}`] }
  ];
  snapshot.enabledServices.push(
    "aiplatform.googleapis.com",
    "maps-backend.googleapis.com",
    "places.googleapis.com",
    "routes.googleapis.com"
  );
  delete snapshot.serverKey.restrictions.serverKeyRestrictions;

  assert.deepEqual(
    validateQuarantineSnapshot(snapshot).map((failure) => failure.code),
    ["VERTEX_ROLE_PRESENT", "BILLABLE_SERVICES_ENABLED", "SERVER_KEY_ALLOWED_IPS"]
  );
});

test("rejects wrong project/region, key restrictions, invokers, scale, and public status", () => {
  const snapshot = passingSnapshot();
  snapshot.project.projectId = "wrong-project";
  snapshot.region = "us-central1";
  snapshot.browserKey.restrictions.browserKeyRestrictions.allowedReferrers = ["https://example.com/*"];
  snapshot.browserKey.restrictions.apiTargets = [{ service: "places.googleapis.com" }];
  snapshot.serverKey.restrictions.apiTargets = [{ service: "routes.googleapis.com" }];
  snapshot.cloudRun[0].iamBindings = [{ role: "roles/run.invoker", members: ["allUsers"] }];
  snapshot.cloudRun[0].serviceAnnotations["run.googleapis.com/maxScale"] = "2";
  snapshot.cloudRun[1].revisionAnnotations["autoscaling.knative.dev/minScale"] = "1";
  snapshot.cloudRun[1].publicStatus = 200;

  assert.deepEqual(
    validateQuarantineSnapshot(snapshot).map((failure) => failure.code),
    [
      "PROJECT_ID",
      "REGION",
      "BROWSER_KEY_REFERRERS",
      "BROWSER_KEY_API_TARGETS",
      "SERVER_KEY_API_TARGETS",
      "RUN_INVOKER_BINDING",
      "SERVICE_SCALE",
      "REVISION_SCALE",
      "PUBLIC_HTTP_STATUS"
    ]
  );
});
