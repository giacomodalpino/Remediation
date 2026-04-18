# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Dockerized prototype that wires Devin into a vulnerability remediation loop:
`trigger (manual / cron / webhook) → issue payload → queued task → Devin → PR → poller → completed`.
The whole point is that **Devin is the execution primitive** — there is no
manual "fix" path. Don't add one.

Ingestion is **open GitHub Issues labeled `security`** (configurable via
`ISSUE_LABEL`) on the target repo. A human (or another system) creates the
issue; this service receives it through one of three triggers, dedupes by
issue number, and hands each new one to Devin:

1. **Manual** — `POST /api/run` (or the Trigger Run button). Polls all open
   labeled issues in one shot. Used for demos.
2. **Cron** — scheduled `POST /api/run` every 5 min (controlled by
   `CRON_ENABLED`). Safety-net polling.
3. **Webhook** — `POST /api/webhooks/github` receives a single
   `issues.labeled` event from GitHub in near-real-time. Opt-in via
   `GITHUB_WEBHOOK_SECRET`. See webhook setup below.

All three feed the same dispatcher and Devin flow. The earlier pip-audit
scanner is gone — issues are the source of truth now.

It's a prototype. README explicitly calls out: no auth, no retries, no queue
durability, no real CVSS enrichment, no tests. Match that bar — don't bolt on
production-grade plumbing unless asked.

## Run / dev commands

```bash
# Backend (from backend/)
DATABASE_URL="file:../data/app.db" npm install
DATABASE_URL="file:../data/app.db" npx prisma db push --skip-generate --accept-data-loss
DATABASE_URL="file:../data/app.db" node src/index.js          # serves API on :4000

# Frontend (from frontend/)
npm install
npm run dev                                                    # Vite on :5173, proxies /api → :4000

# Full stack via Docker (from project root, requires .env)
docker compose up --build                                      # http://localhost:4000

# Wipe data (servers must be stopped)
rm -rf backend/data && cd backend && \
  DATABASE_URL="file:../data/app.db" npx prisma db push --skip-generate --accept-data-loss

# Trigger a run manually
curl -X POST http://localhost:4000/api/run
```

There are no tests and no lint config. Sanity-check edits with:

```bash
cd backend && DATABASE_URL="file:../data/app.db" \
  node -e "Promise.all([import('./src/services/orchestrator.js'),import('./src/services/poller.js'),import('./src/routes/runs.js'),import('./src/cron.js')]).then(()=>console.log('ok'))"
```

## Required env / settings

`DEVIN_API_KEY`, `GITHUB_TOKEN`, `TARGET_REPO_URL` are required for an
end-to-end run. All three can be set via env vars **or** entered in the
Settings page (stored encrypted in SQLite, DB takes precedence over env).
`ISSUE_LABEL` (default `security`) filters which issues are candidates.
`GITHUB_WEBHOOK_SECRET` is optional — only needed if you want to receive
GitHub webhooks. Without it, `POST /api/webhooks/github` returns 503.
Without auth/target, a run starts and logs a clean failure event — that's
intentional, the failure path is part of the demo.

## Webhook setup (optional, opt-in)

The webhook path at `POST /api/webhooks/github` is fully implemented but
off by default. To enable for a real (non-localhost-demo) environment:

```bash
# 1. Generate a secret
openssl rand -hex 32

# 2. Add to the backend env (launch.json, .env, docker-compose, etc.):
GITHUB_WEBHOOK_SECRET=<that hex>

# 3. Expose the backend to the public internet:
ngrok http 4000    # or cloudflared tunnel --url http://localhost:4000

# 4. On GitHub: repo → Settings → Webhooks → Add webhook
#    Payload URL:   https://<ngrok>/api/webhooks/github
#    Content type:  application/json
#    Secret:        <same hex as step 2>
#    Events:        Issues (only)
```

After that, labeling any issue with `security` fires a webhook and a task
lands on the dashboard within ~1 second. The route verifies
`X-Hub-Signature-256` via HMAC-SHA256 + `timingSafeEqual`, filters to
`issues.labeled` + the configured label, and is idempotent by issue
number — GitHub's redeliveries are safe. See `routes/webhooks.js`.

## Architecture (the big picture)

### Lifecycle
```
queued → devin_running → pr_opened → completed
   │           │             │
   └─────┬─────┴─────────────┘
         ▼
       failed (with failure_reason)
```

There is no `detected` state. Findings land directly in `queued`.

### Where the work actually happens

- **`backend/src/services/github.js`** — `fetchOpenLabeledIssues()` hits
  `GET /repos/{owner}/{repo}/issues?state=open&labels={ISSUE_LABEL}` with
  the configured GitHub token, filters out PRs (the /issues endpoint also
  returns them), and parses `owner/repo` out of `targetRepoUrl`.
  `parseIssueTitle()` matches the canonical title format
  `Bump <pkg> from <old> to <new>` — when it matches, the structured fix
  hint is injected into Devin's prompt; when it doesn't, the issue body
  alone drives remediation. This service handles the **poll** ingestion
  path. The webhook path does not use it — GitHub pushes the issue
  payload directly.

- **`backend/src/routes/webhooks.js`** — `POST /api/webhooks/github`.
  HMAC-SHA256 signature check (`timingSafeEqual`), then filter: only
  `X-GitHub-Event: issues` + `action: labeled` + `label.name === ISSUE_LABEL`
  get through. Non-matching events return `200` no-op so GitHub doesn't
  retry. Matching events call `orchestrator.ingestIssueFromWebhook()` which
  is the same dedupe-then-queue logic the poll path uses, just scoped to a
  single issue. Returns `503` if `GITHUB_WEBHOOK_SECRET` is unset (the route
  exists but is opt-in per environment).

- **`backend/src/services/orchestrator.js`** — owns the lifecycle. Two public
  entrypoints:
  - `startRemediationRun()`: creates the run row + `run_started` event
    **synchronously**, returns the runId, then fires `executeRun(runId)` in
    the background. `POST /api/run` and the cron both use this; nothing should
    block the HTTP response on the fetch.
  - `dispatchQueued()`: the throttle. Counts in-flight (`devin_running` +
    `pr_opened`), pulls oldest queued tasks up to
    `MAX_CONCURRENT_DEVIN_SESSIONS - inFlight` (default 2, clamped 1–10),
    invokes Devin. Module-level `dispatchInFlight` lock prevents double-invoke.

  Idempotency: `executeRun` skips issues whose `issueNumber` already has a
  `RemediationTask`, so polling the same label repeatedly never double-queues.
  Tasks store the full issue payload as `findingJson` so the dispatcher can
  rebuild the Devin prompt later without re-hitting GitHub.

- **`backend/src/services/poller.js`** — `setInterval` (15s, configurable via
  `POLL_INTERVAL_MS`). Each tick:
  1. For every `devin_running` / `pr_opened` task, `getSession()`, run
     `extractPrUrl()` over the response, transition states.
  2. Call `dispatchQueued()` to refill freed slots.

  Single-flight via `inFlight` flag — ticks never overlap.

- **`backend/src/services/devin.js`** — thin wrapper over the v1 API
  (`POST /v1/sessions`, `GET /v1/sessions/{id}`). The v1 API is used (not v3)
  because it doesn't need `org_id` and is sufficient. **`extractPrUrl()` is
  intentionally defensive**: probes known fields (`pull_request.url`,
  `pr_url`, `output.pr_url`, `structured_output.pr_url`), then falls back to
  recursively walking every string in the response and regex-matching for
  `https://github.com/.../pull/N`. The Devin response shape isn't fully
  documented publicly — don't tighten this without confirming the schema.
  `isTerminalStatus()` checks `status_enum` / `status` / `state` /
  `session_status` against `finished|stopped|expired|completed|blocked|archived|failed`.

### State transition rules

All terminal transitions go through `markTaskPrOpened`, `markTaskCompleted`,
`markTaskFailed` in `orchestrator.js`. Each of them calls `rollupRun(runId)`
which recomputes `tasksCompleted` / `tasksFailed` and sets
`RemediationRun.completedAt` only when *all* tasks for the run are terminal.
Don't update task status inline elsewhere — the run rollup will drift.

### Devin → PR contract

The control plane calls GitHub **only for reading issues** (`github.js`).
PR creation stays with Devin — we never write to GitHub from this service.
Devin opens the PR itself during its session using `GITHUB_TOKEN` passed
as a `session_secret`, includes `Fixes #N` in the body so the issue
auto-closes on merge, and the poller scrapes the PR URL from the session
response. If Devin doesn't open a PR before its session hits a terminal
state, `markTaskFailed` runs with reason
`"Devin session ended without producing a PR URL"`.

### SQLite path quirk

`DATABASE_URL=file:../data/app.db` is intentional. Prisma resolves `file:`
URLs **relative to the schema file**, not cwd. `backend/prisma/schema.prisma`
+ `../data/app.db` → `backend/data/app.db`, which matches the docker-compose
volume mount (`./data:/app/backend/data`) and the Dockerfile's `mkdir -p ./data`.
Don't "simplify" to `file:./data/app.db` — that lands the file at
`backend/prisma/data/app.db` and silently breaks volume persistence.

### Frontend

Plain Vite + React 18, no router, no UI library, single file `App.jsx` plus
four components. Polls `/api/metrics`, `/api/tasks`, `/api/runs`, `/api/events`
every 5s in parallel from a single `setInterval`. Don't introduce a state
library or query client — the polling pattern is part of the "5-minute to
understand" goal.

Status pill classes use the literal status string with underscores
(`pill--devin_running`, `pill--pr_opened`); CSS in `styles.css` matches.
Adding a new status means adding a CSS rule.

## Things to avoid

- Adding a "Fix with Devin" button or any manual invoke endpoint. Devin must
  be triggered automatically.
- Switching to the Devin v3 API for the sake of it — v1 is sufficient and
  needs no `org_id`.
- Adding retries / queues for the Devin poll loop. The poller + dispatch
  loop is the whole orchestration layer. (The GitHub issues webhook is
  already implemented — see `routes/webhooks.js` and the Webhook setup
  section above. Adding a second webhook for anything else probably needs
  a conversation first.)
- Writing to GitHub from the control plane (creating issues, commenting,
  merging). Devin owns all GitHub writes via the session secret.
- Re-introducing the pip-audit scanner as a parallel ingestion path. Issues
  are the single source of truth now.
