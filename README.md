# Devin Remediation

An event-driven, Dockerized prototype that uses **Devin** as the sole execution
primitive for vulnerability remediation. Open GitHub Issues labeled `security`
are ingested, each one is turned into a remediation task, and Devin is invoked
programmatically to open a real pull request against the target repo. A small
React control plane shows runs, tasks, PRs, and live activity.

## What it is

```
GitHub Issue (labeled `security`) ─► Task ─► Devin ─► PR ─► Observability
```

- **Ingestion:** open issues on the target repo filtered by label (`security`
  by default, configurable via `ISSUE_LABEL`). A human (or another system)
  creates the issue; this service handles dedupe and hand-off to Devin.
- **Triggers (three, all feed the same dispatcher):**
  1. **Manual** — `POST /api/run` (or the *Trigger Run* button in the UI).
  2. **Cron** — scheduled `POST /api/run` every 5 min (`CRON_ENABLED=true`).
  3. **Webhook** — `POST /api/webhooks/github` for near-real-time ingestion
     of `issues.labeled` events. Opt-in via `GITHUB_WEBHOOK_SECRET`.
- **Task:** one row per issue, keyed by issue number. Dedupe is idempotent —
  re-triggering never double-queues.
- **Devin:** `POST https://api.devin.ai/v1/sessions` with a structured
  remediation prompt built from the issue title/body.
- **PR:** opened by Devin during its session (it gets `GITHUB_TOKEN` as a
  session secret). The poller extracts the PR URL from the Devin response.
- **Observability:** SQLite + Express + React dashboard, polled every 5s.

## Architecture

```
              ┌─────────────────────────┐
              │  React UI (frontend)    │
              │  polls /api/* every 5s  │
              └────────────┬────────────┘
                           │
                           ▼
   ┌─────────────────────────────────────────────────┐
   │  Express backend                                │
   │  ├─ POST /api/run                (manual)       │
   │  ├─ POST /api/webhooks/github    (real-time)    │
   │  ├─ cron (*/5 * * * *)           (safety net)   │
   │  ├─ GET  /api/runs /tasks /metrics /events      │
   │  ├─ GET/PUT /api/settings  (encrypted, SQLite)  │
   │  ├─ github client (list open labeled issues)    │
   │  ├─ orchestrator (ingest, dispatch, lifecycle)  │
   │  ├─ devin client (createSession, getSession)    │
   │  └─ poller (15s, transitions in-flight Devin)   │
   └────────────┬─────────────────────┬──────────────┘
                │                     │
                ▼                     ▼
        ┌──────────────┐       ┌─────────────────┐
        │  SQLite DB   │       │  Devin API      │
        │  (Prisma)    │       │  v1/sessions    │
        └──────────────┘       └─────────────────┘
                                       │
                                       ▼
                                ┌──────────────┐
                                │  GitHub PR   │
                                │ (Devin opens)│
                                └──────────────┘
```

## Task lifecycle

```
queued ─► devin_running ─► pr_opened ─► completed
   │           │              │
   └─────┬─────┴──────────────┘
         ▼
      failed (with failure_reason)
```

Tasks land in `queued` immediately after ingestion. A dispatcher (running on
each poller tick) keeps at most `MAX_CONCURRENT_DEVIN_SESSIONS` (default **2**)
in flight; the rest stay `queued` until a slot frees up.

## Run it

### Prerequisites

- Docker + Docker Compose
- A `DEVIN_API_KEY` (personal `apk_user_*` or service `apk_*`)
- A `GITHUB_TOKEN` with write access to the target repo (passed to Devin as a
  session secret so it can open the PR)
- A `TARGET_REPO_URL` — a GitHub repo you control (Devin will clone and open
  PRs against it)

### Steps

```bash
cp .env.example .env
# edit .env: set DEVIN_API_KEY, GITHUB_TOKEN, TARGET_REPO_URL
docker compose up --build
```

Open the dashboard:

- UI:    http://localhost:4000
- API:   http://localhost:4000/api/health

> You can also set the three required values from the **Settings** page in the
> UI — they're stored encrypted in SQLite. DB values take precedence over env.

### Trigger a run manually

```bash
curl -X POST http://localhost:4000/api/run
```

…or click **Trigger Run** in the dashboard. The cron also fires every 5 minutes.

### Watch what Devin does

- The **Tasks** table shows each finding, the issue number, the Devin session
  link (`https://app.devin.ai/sessions/...`), and the PR link once it appears.
- The **Activity Feed** is the live log: `run_started`, `issues_checked`,
  `issue_queued` (or `issue_queued_via_webhook`), `devin_invoked`,
  `pr_opened`, `task_completed`, `task_failed`, `run_completed`.
- The **Overview** tiles roll up totals + success rate + PRs opened.

## Simulate the workflow

If you don't have Devin/GitHub credentials handy and just want to see the
control plane move:

1. `docker compose up --build` with a `.env` that has the three required
   values **blank**.
2. `curl -X POST http://localhost:4000/api/run`.
3. Open http://localhost:4000 and watch the Activity Feed — the run starts,
   logs a clean failure event ("missing credentials" / "no issues found"),
   and rolls up. The failure path is part of the demo.

If you do have credentials:

1. Create an issue on `TARGET_REPO_URL` with the `security` label. Canonical
   title format is `Bump <pkg> from <old> to <new>` (e.g. `Bump requests from
   2.19.0 to 2.31.0`) — when the title matches, a structured fix hint is
   injected into Devin's prompt. Free-form titles work too; the body drives
   remediation in that case.
2. `curl -X POST http://localhost:4000/api/run` (or wait for cron).
3. A task appears in `queued`, transitions to `devin_running` within seconds,
   and to `pr_opened` once Devin opens the PR (typically a few minutes). The
   PR body includes `Fixes #N` so merging the PR auto-closes the issue.

## Webhook setup (optional)

The webhook path at `POST /api/webhooks/github` is fully implemented but
off by default. To enable for a non-localhost environment:

```bash
# 1. Generate a secret
openssl rand -hex 32

# 2. Add to .env
GITHUB_WEBHOOK_SECRET=<that hex>

# 3. Expose the backend publicly
ngrok http 4000    # or: cloudflared tunnel --url http://localhost:4000

# 4. On GitHub: repo → Settings → Webhooks → Add webhook
#    Payload URL:   https://<ngrok>/api/webhooks/github
#    Content type:  application/json
#    Secret:        <same hex as step 2>
#    Events:        Issues (only)
```

After that, labeling any issue with `security` fires a webhook and a task
lands on the dashboard within ~1 second. The route verifies
`X-Hub-Signature-256` via HMAC-SHA256 + `timingSafeEqual`, filters to
`issues.labeled` + the configured label, and is idempotent by issue number.
Without `GITHUB_WEBHOOK_SECRET` the endpoint returns `503`.

## API

| Method | Path                     | Description                                    |
|--------|--------------------------|------------------------------------------------|
| POST   | `/api/run`               | Trigger a remediation run (polls open issues)  |
| POST   | `/api/webhooks/github`   | GitHub webhook endpoint (opt-in, HMAC-signed)  |
| GET    | `/api/runs`              | List recent runs (50)                          |
| GET    | `/api/tasks`             | List recent tasks (200), `?status=` optional   |
| GET    | `/api/metrics`           | Counts + success rate + PRs opened             |
| GET    | `/api/events`            | Activity feed (100 newest)                     |
| GET    | `/api/settings`          | Public (non-secret) settings                   |
| PUT    | `/api/settings`          | Update `targetRepoUrl`, `devinApiKey`, `githubToken` |
| GET    | `/api/health`            | `{ ok: true }`                                 |

## Configuration

All via env (`.env`). The three required values can also be set via the
Settings page (stored encrypted in SQLite; DB takes precedence over env).

| Var                             | Default               | Notes                                                                       |
|---------------------------------|-----------------------|-----------------------------------------------------------------------------|
| `DEVIN_API_KEY`                 | —                     | Required.                                                                   |
| `GITHUB_TOKEN`                  | —                     | Required. Passed to Devin as a `session_secret`.                            |
| `TARGET_REPO_URL`               | —                     | Required. HTTPS GitHub URL Devin operates on.                               |
| `ISSUE_LABEL`                   | `security`            | Which label to watch for.                                                   |
| `GITHUB_WEBHOOK_SECRET`         | —                     | Optional. Enables `POST /api/webhooks/github`.                              |
| `PORT`                          | `4000`                |                                                                             |
| `DATABASE_URL`                  | `file:../data/app.db` | Resolved relative to `backend/prisma/`; file lives at `backend/data/app.db`.|
| `MAX_CONCURRENT_DEVIN_SESSIONS` | `2`                   | How many Devin sessions run at once. Excess tasks stay `queued`.            |
| `CRON_ENABLED`                  | `true`                | Set to `false` to disable scheduled runs.                                   |
| `CRON_SCHEDULE`                 | `*/5 * * * *`         | Standard 5-field cron.                                                      |
| `POLL_INTERVAL_MS`              | `15000`               | How often we poll in-flight Devin sessions.                                 |

## Persistence

`docker-compose.yml` mounts `./data:/app/backend/data`, so the SQLite DB and
encrypted settings key survive `docker compose down` / `up`. To wipe state:

```bash
docker compose down
rm -rf data
docker compose up --build
```

## Limitations (this is a prototype)

- The Devin v1 session response shape is not fully documented publicly. We probe
  several known fields for the PR URL and fall back to a regex scan over every
  string in the response. Works for the common case; not bulletproof.
- PR creation is delegated to Devin (the control plane never calls the GitHub
  write API). If Devin doesn't open a PR before its session hits a terminal
  state, the task ends in `failed` with a reason.
- One worker, no retries, no queue durability — `setInterval` polling is enough
  for a demo. Don't run this in production.
- No auth on the API. Fine for localhost / demo; not for anything else.

## Layout

```
backend/    Express + Prisma + SQLite
  prisma/schema.prisma
  src/index.js                  bootstrap
  src/cron.js                   node-cron
  src/services/github.js        list open labeled issues
  src/services/devin.js         v1 client + PR-URL extractor
  src/services/orchestrator.js  run + task lifecycle, dispatcher
  src/services/poller.js        Devin session polling, state transitions
  src/services/settings.js      DB-backed settings w/ env fallback
  src/services/secrets.js       encryption for stored credentials
  src/services/eventLog.js      activity_events writer
  src/routes/*.js               API (runs, tasks, metrics, events, settings, webhooks)
frontend/   Vite + React 18, plain CSS
Dockerfile, docker-compose.yml, .env.example
```
