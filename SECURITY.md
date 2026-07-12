# Security

Do not report vulnerabilities in a public issue. Contact the repository owner privately.

## Secrets

The repository contains no production credentials. Use Secret Manager for Cloud Run and keep only `.env.example` under version control. Browser Maps keys must be restricted by HTTP referrer, enabled APIs, and quota. Gemini, Turso, OAuth client secrets, and the agent shared secret must never use a `NEXT_PUBLIC_` prefix.

## Location and calendar data

MICHIKUSA stores only the data required to render a route and its memory card. Shared cards omit exact home coordinates. Calendar OAuth tokens are encrypted before persistence, and the app requests calendar free/busy plus access to the calendar it creates for MICHIKUSA.
