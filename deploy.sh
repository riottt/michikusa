#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
REGION="${REGION:-asia-northeast1}"
REPOSITORY="${ARTIFACT_REPOSITORY:-michikusa}"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"
WEB_SERVICE="${WEB_SERVICE:-michikusa-web}"
AGENT_SERVICE="${AGENT_SERVICE:-michikusa-agent}"
WEB_SA="${WEB_SERVICE_ACCOUNT:-michikusa-web@${PROJECT_ID}.iam.gserviceaccount.com}"
AGENT_SA="${AGENT_SERVICE_ACCOUNT:-michikusa-agent@${PROJECT_ID}.iam.gserviceaccount.com}"
MAPS_BROWSER_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}"
BROWSER_MAPS_KEY_SECRET="${BROWSER_MAPS_KEY_SECRET:-michikusa-maps-browser-key}"
if [[ -z "$MAPS_BROWSER_KEY" ]] && gcloud secrets describe "$BROWSER_MAPS_KEY_SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  MAPS_BROWSER_KEY="$(gcloud secrets versions access latest --secret "$BROWSER_MAPS_KEY_SECRET" --project "$PROJECT_ID")"
fi
if [[ -z "$MAPS_BROWSER_KEY" ]]; then
  echo "Missing browser Maps key. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or create Secret Manager secret: $BROWSER_MAPS_KEY_SECRET" >&2
  exit 1
fi
# A map ID is optional for the standard Maps JavaScript map.  Do not inject the
# development-only DEMO_MAP_ID into production builds when no real map ID exists.
MAP_ID="${NEXT_PUBLIC_GOOGLE_MAP_ID-}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
# Cost guard defaults. Keep production at zero idle instances and one instance
# per service unless an explicit deployment override is supplied.
MAX_INSTANCES="${MAX_INSTANCES:-1}"
WEB_CONCURRENCY="${WEB_CONCURRENCY:-20}"
AGENT_CONCURRENCY="${AGENT_CONCURRENCY:-4}"

required_secrets=(
  michikusa-agent-shared-secret
  "$BROWSER_MAPS_KEY_SECRET"
  michikusa-maps-server-key
  michikusa-token-encryption-key
  michikusa-turso-url
  michikusa-turso-token
)
for secret in "${required_secrets[@]}"; do
  if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Missing Secret Manager secret: $secret" >&2
    echo "Create it as described in docs/GOOGLE_CLOUD_SETUP.md." >&2
    exit 1
  fi
done

OAUTH_CLIENT_ID_PRESENT=false
OAUTH_CLIENT_SECRET_PRESENT=false
if gcloud secrets describe michikusa-oauth-client-id --project "$PROJECT_ID" >/dev/null 2>&1; then
  OAUTH_CLIENT_ID_PRESENT=true
fi
if gcloud secrets describe michikusa-oauth-client-secret --project "$PROJECT_ID" >/dev/null 2>&1; then
  OAUTH_CLIENT_SECRET_PRESENT=true
fi
if [[ "$OAUTH_CLIENT_ID_PRESENT" != "$OAUTH_CLIENT_SECRET_PRESENT" ]]; then
  echo "Calendar OAuth requires both michikusa-oauth-client-id and michikusa-oauth-client-secret." >&2
  exit 1
fi
OAUTH_CONFIGURED="$OAUTH_CLIENT_ID_PRESENT"

gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com aiplatform.googleapis.com apikeys.googleapis.com \
  places.googleapis.com routes.googleapis.com maps-backend.googleapis.com calendar-json.googleapis.com \
  --project "$PROJECT_ID"

if ! gcloud artifacts repositories describe "$REPOSITORY" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" --repository-format docker --location "$REGION" --project "$PROJECT_ID"
fi

for sa_name in michikusa-web michikusa-agent; do
  if ! gcloud iam service-accounts describe "${sa_name}@${PROJECT_ID}.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$sa_name" --project "$PROJECT_ID" --display-name "$sa_name"
  fi
done

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${AGENT_SA}" --role roles/aiplatform.user >/dev/null

agent_secrets=(michikusa-agent-shared-secret michikusa-maps-server-key)
web_secrets=(
  michikusa-agent-shared-secret
  michikusa-token-encryption-key
  michikusa-turso-url
  michikusa-turso-token
)
if [[ "$OAUTH_CONFIGURED" == "true" ]]; then
  web_secrets+=(michikusa-oauth-client-id michikusa-oauth-client-secret)
fi
for secret in "${agent_secrets[@]}"; do
  gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" \
    --member "serviceAccount:${AGENT_SA}" --role roles/secretmanager.secretAccessor >/dev/null
done

WEB_SECRET_BINDINGS="AGENT_SHARED_SECRET=michikusa-agent-shared-secret:latest,TOKEN_ENCRYPTION_KEY=michikusa-token-encryption-key:latest,TURSO_DATABASE_URL=michikusa-turso-url:latest,TURSO_AUTH_TOKEN=michikusa-turso-token:latest"
if [[ "$OAUTH_CONFIGURED" == "true" ]]; then
  WEB_SECRET_BINDINGS+=",GOOGLE_OAUTH_CLIENT_ID=michikusa-oauth-client-id:latest,GOOGLE_OAUTH_CLIENT_SECRET=michikusa-oauth-client-secret:latest"
fi
for secret in "${web_secrets[@]}"; do
  gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" \
    --member "serviceAccount:${WEB_SA}" --role roles/secretmanager.secretAccessor >/dev/null
done

gcloud builds submit --project "$PROJECT_ID" --config cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_TAG=${TAG},_NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${MAPS_BROWSER_KEY},_NEXT_PUBLIC_GOOGLE_MAP_ID=${MAP_ID}"

gcloud run deploy "$AGENT_SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --image "${IMAGE_BASE}/michikusa-agent:${TAG}" \
  --service-account "$AGENT_SA" \
  --no-allow-unauthenticated \
  --memory 1Gi --cpu 1 --timeout 120 --concurrency "${AGENT_CONCURRENCY}" --min-instances 0 --max-instances "${MAX_INSTANCES}" \
  --set-env-vars "DEMO_MODE=false,GOOGLE_GENAI_USE_ENTERPRISE=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${AGENT_PLATFORM_LOCATION:-global},GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.5-flash}" \
  --set-secrets "AGENT_SHARED_SECRET=michikusa-agent-shared-secret:latest,GOOGLE_MAPS_SERVER_API_KEY=michikusa-maps-server-key:latest"

AGENT_URL="$(gcloud run services describe "$AGENT_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
gcloud run services add-iam-policy-binding "$AGENT_SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:${WEB_SA}" --role roles/run.invoker >/dev/null

gcloud run deploy "$WEB_SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --image "${IMAGE_BASE}/michikusa-web:${TAG}" \
  --service-account "$WEB_SA" \
  --allow-unauthenticated \
  --memory 768Mi --cpu 1 --timeout 120 --concurrency "${WEB_CONCURRENCY}" --min-instances 0 --max-instances "${MAX_INSTANCES}" \
  --set-env-vars "DEMO_MODE=false,AGENT_SERVICE_URL=${AGENT_URL},AGENT_SERVICE_AUDIENCE=${AGENT_URL}" \
  --set-secrets "$WEB_SECRET_BINDINGS"

WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
gcloud run services update "$WEB_SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "NEXT_PUBLIC_APP_URL=${WEB_URL},GOOGLE_OAUTH_REDIRECT_URI=${WEB_URL}/api/calendar/callback" >/dev/null

printf '\nMICHIKUSA deployed\nWeb:   %s\nAgent: %s (private)\n' "$WEB_URL" "$AGENT_URL"
if [[ "$OAUTH_CONFIGURED" == "true" ]]; then
  printf 'Add this redirect URI to the Google OAuth client:\n%s/api/calendar/callback\n' "$WEB_URL"
else
  printf 'Calendar OAuth is not configured. Live planning works; Calendar stays visibly disconnected.\n'
fi
