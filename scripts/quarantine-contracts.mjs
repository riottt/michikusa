export const DUPLICATE_PROJECT_ID = "michikusa-hackathon-20260712";
export const DUPLICATE_PROJECT_NUMBER = "663148281269";
export const DUPLICATE_REGION = "asia-northeast1";

export const DUPLICATE_BROWSER_KEY = `projects/${DUPLICATE_PROJECT_NUMBER}/locations/global/keys/michikusa-browser-v2`;
export const DUPLICATE_SERVER_KEY = `projects/${DUPLICATE_PROJECT_NUMBER}/locations/global/keys/michikusa-server-v2`;
export const DUPLICATE_AGENT_SERVICE_ACCOUNT = `${"michikusa-agent"}@${DUPLICATE_PROJECT_ID}.iam.gserviceaccount.com`;

export const BILLABLE_SERVICES = [
  "aiplatform.googleapis.com",
  "maps-backend.googleapis.com",
  "places.googleapis.com",
  "routes.googleapis.com"
];

const expectedServices = [
  { name: "michikusa-web", url: "https://michikusa-web-ap2prbrn6q-an.a.run.app" },
  { name: "michikusa-agent", url: "https://michikusa-agent-ap2prbrn6q-an.a.run.app" }
];

export function projectedObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function projectedArray(value) {
  return Array.isArray(value) ? value : [];
}

function sameSet(actual, expected) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function apiTargets(key) {
  const restrictions = projectedObject(projectedObject(key).restrictions);
  return projectedArray(restrictions.apiTargets)
    .map((target) => projectedObject(target).service)
    .filter(Boolean)
    .sort();
}

function scale(annotations, prefix) {
  const values = projectedObject(annotations);
  const min = Number(values[`${prefix}/minScale`] ?? 0);
  const max = Number(values[`${prefix}/maxScale`]);
  return { min, max };
}

function failure(code, message) {
  return { code, message };
}

export function validateQuarantineSnapshot(snapshot) {
  snapshot = projectedObject(snapshot);
  const failures = [];
  const project = projectedObject(snapshot.project);

  if (project.projectId !== DUPLICATE_PROJECT_ID) {
    failures.push(failure("PROJECT_ID", "Duplicate project id does not match the locked target."));
  }
  if (String(project.projectNumber ?? "") !== DUPLICATE_PROJECT_NUMBER) {
    failures.push(failure("PROJECT_NUMBER", "Duplicate project number does not match the locked target."));
  }
  if (snapshot.region !== DUPLICATE_REGION) {
    failures.push(failure("REGION", "Cloud Run region does not match the locked target."));
  }
  if (snapshot.agentServiceAccount !== DUPLICATE_AGENT_SERVICE_ACCOUNT) {
    failures.push(failure("AGENT_SERVICE_ACCOUNT", "Duplicate Agent service account is unexpected."));
  }

  const vertexMember = `serviceAccount:${snapshot.agentServiceAccount}`;
  const vertexRolePresent = projectedArray(snapshot.projectIamBindings).some(
    (rawBinding) => {
      const binding = projectedObject(rawBinding);
      return binding.role === "roles/aiplatform.user" && projectedArray(binding.members).includes(vertexMember);
    }
  );
  if (vertexRolePresent) {
    failures.push(failure("VERTEX_ROLE_PRESENT", "Duplicate Agent still has Vertex AI invocation permission."));
  }

  const enabledBillable = BILLABLE_SERVICES.filter((service) =>
    projectedArray(snapshot.enabledServices).includes(service)
  );
  if (enabledBillable.length) {
    failures.push(
      failure("BILLABLE_SERVICES_ENABLED", `Billable services still enabled: ${enabledBillable.join(", ")}`)
    );
  }

  if (snapshot.browserKey?.name !== DUPLICATE_BROWSER_KEY) {
    failures.push(failure("BROWSER_KEY_RESOURCE", "Browser key resource does not match the locked key id."));
  }
  const browserKey = projectedObject(snapshot.browserKey);
  const browserRestrictions = projectedObject(browserKey.restrictions);
  const browserKeyRestrictions = projectedObject(browserRestrictions.browserKeyRestrictions);
  const allowedReferrers = projectedArray(browserKeyRestrictions.allowedReferrers);
  if (!sameSet(allowedReferrers, ["https://disabled.invalid/*"])) {
    failures.push(failure("BROWSER_KEY_REFERRERS", "Browser key referrers are not disabled.invalid only."));
  }
  if (!sameSet(apiTargets(snapshot.browserKey), ["maps-backend.googleapis.com"])) {
    failures.push(failure("BROWSER_KEY_API_TARGETS", "Browser key is not restricted to Maps JavaScript API only."));
  }

  if (snapshot.serverKey?.name !== DUPLICATE_SERVER_KEY) {
    failures.push(failure("SERVER_KEY_RESOURCE", "Server key resource does not match the locked key id."));
  }
  if (!sameSet(apiTargets(snapshot.serverKey), ["places.googleapis.com", "routes.googleapis.com"])) {
    failures.push(failure("SERVER_KEY_API_TARGETS", "Server key is not restricted to Places and Routes only."));
  }
  const serverKey = projectedObject(snapshot.serverKey);
  const serverRestrictions = projectedObject(serverKey.restrictions);
  const serverKeyRestrictions = projectedObject(serverRestrictions.serverKeyRestrictions);
  const allowedIps = projectedArray(serverKeyRestrictions.allowedIps);
  if (!sameSet(allowedIps, ["192.0.2.1/32"])) {
    failures.push(failure("SERVER_KEY_ALLOWED_IPS", "Server key is not locked to the documentation-only IP."));
  }

  for (const expected of expectedServices) {
    const service = projectedArray(snapshot.cloudRun)
      .map(projectedObject)
      .find((candidate) => candidate.name === expected.name);
    if (!service) {
      failures.push(failure("CLOUD_RUN_SERVICE", `Missing duplicate Cloud Run service: ${expected.name}.`));
      continue;
    }
    if (projectedArray(service.iamBindings).some((binding) => projectedObject(binding).role === "roles/run.invoker")) {
      failures.push(failure("RUN_INVOKER_BINDING", `${expected.name} still has a roles/run.invoker binding.`));
    }
    const serviceScale = scale(service.serviceAnnotations, "run.googleapis.com");
    if (serviceScale.min !== 0 || serviceScale.max !== 1) {
      failures.push(failure("SERVICE_SCALE", `${expected.name} service scale is not min 0 / max 1.`));
    }
    const revisionScale = scale(service.revisionAnnotations, "autoscaling.knative.dev");
    if (revisionScale.min !== 0 || revisionScale.max !== 1) {
      failures.push(failure("REVISION_SCALE", `${expected.name} revision scale is not min 0 / max 1.`));
    }
    if (service.publicUrl !== expected.url) {
      failures.push(failure("PUBLIC_URL", `${expected.name} public URL does not match the locked endpoint.`));
    }
    if (service.publicStatus !== 403) {
      failures.push(failure("PUBLIC_HTTP_STATUS", `${expected.name} public endpoint did not return HTTP 403.`));
    }
  }

  return failures;
}
