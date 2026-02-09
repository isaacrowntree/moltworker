# Monitoring System v2 — Architecture & Implementation Plan

Complete redesign of clawdwatch + moltworker monitoring, using Cloudflare's full platform.

## Goals

1. **Dynamic check config** — add/edit/delete checks without redeploying
2. **Unlimited history** — query any time range (15m to 90 days)
3. **Incident tracking** — automatic incident records on state transitions
4. **Configurable alerts** — per-check notification rules, escalation, maintenance windows
5. **Config as code** — CLI to push/pull config between local files and live system
6. **Moltbot as config interface** — tell the agent "add monitoring for example.com" via chat
7. **Advanced checks** — browser checks, multi-step, multi-region

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Config Sources                               │
│                                                                     │
│  "Add monitoring for example.com"                                   │
│       │                                                             │
│       ▼                                                             │
│  Moltbot Agent (chat) ────────→ Worker Monitoring API               │
│  (openclaw skill)                    ↑                              │
│                                      │                              │
│  monitoring.config.ts ──→ npx clawdwatch push                       │
│  (version controlled)                                               │
│                                                                     │
│  Dashboard (read-only) ← Worker Monitoring API                      │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     D1: monitoring_db                                │
│                                                                     │
│  ┌─────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ checks  │  │ incidents  │  │ alert_rules│  │ maintenance_     │  │
│  │ (config)│  │ (auto-log) │  │ (per-check)│  │ windows          │  │
│  └─────────┘  └───────────┘  └────────────┘  └──────────────────┘  │
│  ┌──────────────┐                                                   │
│  │ check_groups │                                                   │
│  └──────────────┘                                                   │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ reads config
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Worker: scheduled() every 5 min                        │
│                                                                     │
│  1. Load check configs from D1                                      │
│  2. Filter out disabled checks + active maintenance windows         │
│  3. Execute checks (fetch with assertions + retries)                │
│  4. Write results to:                                               │
│     ├─ R2 state.json — current status only (no history)             │
│     └─ Analytics Engine — every data point (90-day retention)       │
│  5. Compute state transitions → create incidents in D1              │
│  6. Alert pipeline: check rules in D1, dispatch via onAlert         │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────┐       ┌──────────────────────────────────────┐
│  R2: state.json      │       │  Analytics Engine: monitoring_ae     │
│  (hot state only)    │       │                                      │
│  - status per check  │       │  index1: check_id                    │
│  - consecutive fails │       │  blob1:  check_name                  │
│  - last check/error  │       │  blob2:  status (healthy/unhealthy)  │
│  - response time     │       │  blob3:  error message               │
│  - NO history array  │       │  blob4:  region                      │
│                      │       │  double1: response_time_ms           │
│  Used for:           │       │  double2: status_code                │
│  - Fast status reads │       │                                      │
│  - Alert state       │       │  Used for:                           │
│    machine input     │       │  - History queries (any time range)  │
│                      │       │  - Uptime calculations               │
│                      │       │  - p50/p95/p99 response times        │
│                      │       │  - Trend analysis                    │
└──────────────────────┘       └──────────────────────────────────────┘
```

## Storage Design

### D1 Schema

```sql
CREATE TABLE checks (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'api',  -- api | browser | multi-step
  url               TEXT NOT NULL,
  method            TEXT DEFAULT 'GET',
  headers           TEXT,                          -- JSON object
  body              TEXT,                          -- request body for POST
  assertions        TEXT,                          -- JSON array of Assertion
  retry_count       INTEGER DEFAULT 0,
  retry_delay_ms    INTEGER DEFAULT 300,
  timeout_ms        INTEGER DEFAULT 10000,
  failure_threshold INTEGER DEFAULT 2,
  tags              TEXT DEFAULT '[]',             -- JSON array of strings
  group_id          TEXT REFERENCES check_groups(id),
  regions           TEXT DEFAULT '["default"]',    -- JSON array of region hints
  enabled           INTEGER DEFAULT 1,             -- 0 = paused
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE check_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id    TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                       -- degraded | unhealthy
  started_at  TEXT NOT NULL,
  resolved_at TEXT,                                -- NULL = ongoing
  duration_s  INTEGER,                             -- computed on resolve
  trigger_error TEXT                                -- error that caused the incident
);
CREATE INDEX idx_incidents_check ON incidents(check_id, started_at);
CREATE INDEX idx_incidents_open ON incidents(resolved_at) WHERE resolved_at IS NULL;

CREATE TABLE alert_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id    TEXT REFERENCES checks(id) ON DELETE CASCADE,  -- NULL = all checks
  group_id    TEXT REFERENCES check_groups(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                       -- gateway | webhook | (future: slack, telegram, email)
  config      TEXT NOT NULL DEFAULT '{}',          -- JSON channel config
  on_failure  INTEGER DEFAULT 1,
  on_recovery INTEGER DEFAULT 1,
  enabled     INTEGER DEFAULT 1
);

CREATE TABLE maintenance_windows (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id         TEXT REFERENCES checks(id) ON DELETE CASCADE,
  group_id         TEXT REFERENCES check_groups(id) ON DELETE CASCADE,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT NOT NULL,
  reason           TEXT,
  suppress_alerts  INTEGER DEFAULT 1,
  skip_checks      INTEGER DEFAULT 0               -- 1 = don't run checks at all
);
```

### Analytics Engine Data Points

Written on every check execution:

```typescript
env.MONITORING_AE.writeDataPoint({
  indexes: [checkId],
  blobs: [
    checkName,                // blob1
    status,                   // blob2: healthy | degraded | unhealthy
    error ?? '',              // blob3
    region,                   // blob4: default | apac | enam | weur
    checkType,                // blob5: api | browser | multi-step
  ],
  doubles: [
    responseTimeMs,           // double1
    statusCode ?? 0,          // double2
  ],
});
```

Query examples:

```sql
-- 30-day uptime for a check
SELECT
  SUM(IF(blob2 = 'healthy', 1, 0)) * 100.0 / COUNT() as uptime_pct,
  AVG(double1) as avg_ms,
  quantileWeighted(double1)(0.95) as p95_ms,
  quantileWeighted(double1)(0.99) as p99_ms
FROM monitoring_ae
WHERE index1 = 'campermate-website'
  AND timestamp > NOW() - INTERVAL '30' DAY

-- History entries for dashboard (replace R2 history array)
SELECT
  toStartOfInterval(timestamp, INTERVAL '5' MINUTE) as ts,
  blob2 as status,
  double1 as response_time_ms,
  blob3 as error
FROM monitoring_ae
WHERE index1 = 'campermate-website'
  AND timestamp > NOW() - INTERVAL '24' HOUR
ORDER BY ts
```

### R2 State (Simplified)

No more history array. State is just current status for alert state machine:

```typescript
interface MonitoringState {
  checks: Record<string, {
    status: CheckStatus;
    consecutiveFailures: number;
    lastCheck: string | null;
    lastSuccess: string | null;
    lastError: string | null;
    responseTimeMs: number | null;
  }>;
  lastRun: string | null;
}
```

## clawdwatch v2 API

### createMonitor

```typescript
import { createMonitor } from 'clawdwatch';

const monitor = createMonitor<MoltbotEnv>({
  storage: {
    getD1: (env) => env.MONITORING_DB,
    getR2: (env) => env.MOLTBOT_BUCKET,
    getAnalyticsEngine: (env) => env.MONITORING_AE,
  },
  defaults: {
    stateKey: 'monitoring/state.json',
    failureThreshold: 2,
    timeoutMs: 10_000,
    userAgent: 'clawdwatch/2.0',
  },
  resolveUrl: (url, env) => {
    // Replace {{WORKER_URL}} and any other env placeholders
    return url.replace('{{WORKER_URL}}', env.WORKER_URL ?? 'http://localhost:8787');
  },
  onAlert: async (alert, env) => {
    // Called after alert rules are evaluated
    // alert.channel tells you where to send
  },
});
```

### Monitor Object

```typescript
interface ClawdWatch<TEnv> {
  /** Hono sub-app: dashboard + admin API + config API */
  app: Hono;

  /** Run all enabled checks. Call from scheduled(). */
  runChecks: (env: TEnv) => Promise<void>;

  /** Public status handler (minimal data, no auth needed) */
  statusHandler: (c: Context) => Promise<Response>;
}
```

### Admin API Routes (provided by monitor.app)

All mounted under `/monitoring` (protected by CF Access in moltworker):

```
Dashboard:
  GET  /                              Embedded React dashboard

Status & History:
  GET  /api/status                    Full status (R2 state + AE history)
  GET  /api/history/:checkId          Query AE for check history
       ?range=1h|6h|12h|24h|7d|30d

Check Config (CRUD):
  GET    /api/checks                  List all checks from D1
  POST   /api/checks                  Create check
  GET    /api/checks/:id              Get single check
  PUT    /api/checks/:id              Update check
  DELETE /api/checks/:id              Delete check
  POST   /api/checks/:id/toggle       Enable/disable check

Bulk Config (for CLI):
  GET    /api/config                  Export full config (checks + rules + windows)
  PUT    /api/config                  Import/replace full config (declarative sync)

Incidents:
  GET    /api/incidents               List incidents
       ?check_id=X&status=open|resolved&limit=50

Alert Rules:
  GET    /api/alert-rules             List rules
  POST   /api/alert-rules             Create rule
  PUT    /api/alert-rules/:id         Update rule
  DELETE /api/alert-rules/:id         Delete rule

Maintenance Windows:
  GET    /api/maintenance             List windows
  POST   /api/maintenance             Create window
  DELETE /api/maintenance/:id         Delete window

Actions:
  POST   /api/checks/:id/run         Run a single check immediately
```

## Moltbot Integration (Primary Config Interface)

Moltbot — the AI agent running in the sandbox — is the primary interface for managing monitoring config. No dedicated UI needed; you just chat.

### How It Works

1. Worker exposes monitoring CRUD API at `/monitoring/api/*` (CF Access protected)
2. API also accepts `Authorization: Bearer <MONITORING_API_KEY>` for programmatic access
3. Moltbot gets an **openclaw skill** (`monitoring`) with scripts that call the API
4. Worker passes `MONITORING_API_KEY` and `WORKER_URL` to the container as env vars
5. Moltbot's skill scripts use these to call the worker's API from inside the container

### Skill Structure

```
skills/monitoring/
├── SKILL.md           # Full reference for the agent: schema, assertions, examples
└── scripts/
    └── monitoring.sh  # Wraps curl calls to the worker monitoring API
```

### Container Setup

Two new env vars passed to the container via `buildEnvVars()` in `src/gateway/env.ts`:

| Worker Secret | Container Env Var | Purpose |
|---|---|---|
| `MONITORING_API_KEY` | `MONITORING_API_KEY` | Bearer token for monitoring API |
| `WORKER_URL` | `WORKER_URL` | Already passed — public worker URL |

The monitoring.sh script uses these:
```bash
MONITORING_API="${WORKER_URL}/monitoring/api"
AUTH_HEADER="Authorization: Bearer ${MONITORING_API_KEY}"
```

### SKILL.md (Complete Agent Reference)

This is the full SKILL.md that goes into the container. It's designed to be a complete reference
so the agent knows exactly what's possible — like Datadog's check configuration UI but as docs.

```markdown
# Monitoring

Manage synthetic monitoring checks for moltworker services via the clawdwatch API.

Checks run every 5 minutes. Results are stored in Analytics Engine (90-day retention).
Alerts fire when checks transition to unhealthy (after consecutive failure threshold).

## Environment

- `MONITORING_API_KEY` — Bearer token for the monitoring API
- `WORKER_URL` — Base URL of the moltworker (e.g., https://moltbot-sandbox.example.workers.dev)

The API base is `${WORKER_URL}/monitoring/api`.

## Check Configuration

Every check has these fields:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | — | Unique identifier (lowercase, hyphens, e.g., `campermate-website`) |
| `name` | string | Yes | — | Human-readable name (e.g., "Campermate Website") |
| `type` | string | Yes | — | `api` (HTTP check) or `browser` (headless Chrome) |
| `url` | string | Yes | — | URL to check. Use `{{WORKER_URL}}` for self-referencing |
| `method` | string | No | `GET` | HTTP method: GET, POST, PUT, DELETE, HEAD, OPTIONS |
| `headers` | object | No | `{}` | Custom request headers as key-value pairs |
| `body` | string | No | `null` | Request body (for POST/PUT) |
| `assertions` | array | No | `[status is 200]` | Array of assertions (see below) |
| `timeout_ms` | number | No | `10000` | Request timeout in milliseconds |
| `retry_count` | number | No | `0` | Number of retries on failure |
| `retry_delay_ms` | number | No | `300` | Delay between retries in milliseconds |
| `failure_threshold` | number | No | `2` | Consecutive failures before alerting |
| `tags` | array | No | `[]` | Tags for grouping (e.g., `["production", "api"]`) |
| `enabled` | boolean | No | `true` | Whether the check runs |

### Assertions

Assertions define what "healthy" means. If no assertions are specified, the default is
`status code is 200`. Multiple assertions can be combined — ALL must pass.

#### Status Code

Check the HTTP response status code.

```json
{ "type": "statusCode", "operator": "is", "value": 200 }
{ "type": "statusCode", "operator": "isNot", "value": 500 }
```

Operators: `is`, `isNot`
Value: any HTTP status code (200, 201, 301, 404, 500, etc.)

#### Response Time

Check that the response completes within a time limit.

```json
{ "type": "responseTime", "operator": "lessThan", "value": 2000 }
```

Operators: `lessThan`
Value: milliseconds

#### Header

Check a specific response header value.

```json
{ "type": "header", "name": "content-type", "operator": "contains", "value": "application/json" }
{ "type": "header", "name": "x-cache", "operator": "is", "value": "HIT" }
```

Operators: `is`, `isNot`, `contains`, `notContains`, `matches` (regex)
Name: header name (case-insensitive)

#### Body

Check the response body content (first 64KB).

```json
{ "type": "body", "operator": "contains", "value": "\"status\":\"ok\"" }
{ "type": "body", "operator": "notContains", "value": "error" }
{ "type": "body", "operator": "matches", "value": "\"version\":\"\\d+\\.\\d+\"" }
```

Operators: `contains`, `notContains`, `matches` (regex)

### Example Check Configs

**Simple health check** (just check status 200):
```json
{
  "id": "my-api-health",
  "name": "My API Health",
  "type": "api",
  "url": "https://api.example.com/health",
  "tags": ["production", "api"]
}
```

**API with assertions** (status + response time + body):
```json
{
  "id": "campermate-api",
  "name": "Campermate API",
  "type": "api",
  "url": "https://api.campermate.com/v2/status",
  "method": "GET",
  "headers": { "Accept": "application/json" },
  "assertions": [
    { "type": "statusCode", "operator": "is", "value": 200 },
    { "type": "responseTime", "operator": "lessThan", "value": 3000 },
    { "type": "body", "operator": "contains", "value": "\"healthy\"" },
    { "type": "header", "name": "content-type", "operator": "contains", "value": "json" }
  ],
  "timeout_ms": 5000,
  "retry_count": 1,
  "failure_threshold": 3,
  "tags": ["production", "api"]
}
```

**POST endpoint check**:
```json
{
  "id": "webhook-endpoint",
  "name": "Webhook Endpoint",
  "type": "api",
  "url": "https://api.example.com/webhook/test",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": "{\"test\": true}",
  "assertions": [
    { "type": "statusCode", "operator": "is", "value": 202 }
  ],
  "tags": ["production"]
}
```

**Self-referencing check** (monitoring the worker itself):
```json
{
  "id": "worker-health",
  "name": "Worker Health",
  "type": "api",
  "url": "{{WORKER_URL}}/sandbox-health",
  "tags": ["infrastructure"]
}
```

## Scripts

### monitoring.sh

All commands output JSON. Use jq for formatting.

#### Check Management

```bash
# List all checks
monitoring.sh checks list

# Get single check
monitoring.sh checks get <check-id>

# Create a check (pass JSON body via stdin or --data)
monitoring.sh checks create --data '{
  "id": "new-check",
  "name": "New Check",
  "type": "api",
  "url": "https://example.com",
  "assertions": [{"type": "statusCode", "operator": "is", "value": 200}],
  "tags": ["production"]
}'

# Update a check (partial update — only include fields to change)
monitoring.sh checks update <check-id> --data '{
  "timeout_ms": 5000,
  "assertions": [
    {"type": "statusCode", "operator": "is", "value": 200},
    {"type": "responseTime", "operator": "lessThan", "value": 2000}
  ]
}'

# Delete a check
monitoring.sh checks delete <check-id>

# Enable/disable a check
monitoring.sh checks toggle <check-id>

# Run a check immediately (returns result)
monitoring.sh checks run <check-id>
```

#### Status & History

```bash
# Overall status (all checks)
monitoring.sh status

# Check history (from Analytics Engine)
monitoring.sh history <check-id> [--range 1h|6h|12h|24h|7d|30d]
```

#### Incidents

```bash
# List incidents
monitoring.sh incidents [--check <check-id>] [--status open|resolved] [--limit 20]
```

#### Alert Rules

```bash
# List alert rules
monitoring.sh alerts list

# Create alert rule (fires for all checks by default)
monitoring.sh alerts create --data '{
  "channel": "gateway",
  "on_failure": true,
  "on_recovery": true
}'

# Create alert rule for specific check
monitoring.sh alerts create --data '{
  "check_id": "campermate-website",
  "channel": "gateway",
  "on_failure": true,
  "on_recovery": true
}'

# Delete alert rule
monitoring.sh alerts delete <rule-id>
```

#### Maintenance Windows

```bash
# Schedule maintenance window
monitoring.sh maintenance create --data '{
  "check_id": "campermate-website",
  "starts_at": "2026-03-15T02:00:00Z",
  "ends_at": "2026-03-15T04:00:00Z",
  "reason": "Scheduled deployment",
  "suppress_alerts": true
}'

# List active/upcoming maintenance windows
monitoring.sh maintenance list

# Delete maintenance window
monitoring.sh maintenance delete <window-id>
```

#### Bulk Config (export/import)

```bash
# Export full config as JSON (checks + rules + windows)
monitoring.sh config export

# Import config (declarative — syncs D1 to match)
monitoring.sh config import --data '{ "checks": [...], "alertRules": [...] }'
```
```

### Example Conversations

```
User: "Add monitoring for the staging API at staging.example.com"
Agent: → monitoring.sh checks create --data '{"id":"staging-api","name":"Staging API",
         "type":"api","url":"https://staging.example.com/health","tags":["staging"]}'
       "Done — added 'Staging API' check. It'll run on the next monitoring cycle
        (within 5 minutes). Default assertion: status code 200."

User: "Make it also check that the response is under 2 seconds and contains 'ok'"
Agent: → monitoring.sh checks update staging-api --data '{"assertions":[
         {"type":"statusCode","operator":"is","value":200},
         {"type":"responseTime","operator":"lessThan","value":2000},
         {"type":"body","operator":"contains","value":"ok"}]}'
       "Updated. Now checking: status 200, response < 2s, body contains 'ok'."

User: "Pause monitoring for campermate-website, we're deploying"
Agent: → monitoring.sh maintenance create --data '{"check_id":"campermate-website",
         "starts_at":"2026-02-09T02:00:00Z","ends_at":"2026-02-09T03:00:00Z",
         "reason":"Deployment","suppress_alerts":true}'
       "Created a 1-hour maintenance window. Alerts are suppressed until 3:00 AM."

User: "What's the uptime for the last week?"
Agent: → monitoring.sh status
       → monitoring.sh history campermate-website --range 7d
       "Campermate Website: 99.86% uptime (7d), avg 234ms, p95 892ms.
        Moltworker Health: 100% uptime (7d), avg 45ms."

User: "Show me the monitoring config"
Agent: → monitoring.sh config export
       *shows full JSON config with all checks, assertions, alert rules*
```

### Dashboard Stays Read-Only

The React SPA at `/_admin/monitoring` is purely for viewing:
- Status overview (cards + table)
- Check detail pages (history, response times, incidents)
- Incident timeline

All config changes flow through moltbot (chat) or CLI (terminal).

## CLI Tool

Part of the clawdwatch package: `npx clawdwatch <command>`.

### Config File Format

```typescript
// clawdwatch.config.ts
import { defineConfig } from 'clawdwatch/config';

export default defineConfig({
  checks: [
    {
      id: 'campermate-website',
      name: 'Campermate Website',
      type: 'api',
      url: 'https://www.campermate.com',
      tags: ['production'],
    },
    {
      id: 'sandbox-health',
      name: 'Moltworker Health',
      type: 'api',
      url: '{{WORKER_URL}}/sandbox-health',
      tags: ['infrastructure'],
    },
  ],
  alertRules: [
    {
      channel: 'gateway',  // POST to moltbot agent
      onFailure: true,
      onRecovery: true,
    },
  ],
});
```

### CLI Commands

```bash
# Push local config to live system (declarative — syncs to match file)
npx clawdwatch push [--config clawdwatch.config.ts] [--url https://worker.dev]

# Pull live config to local file
npx clawdwatch pull [--config clawdwatch.config.ts] [--url https://worker.dev]

# Show current status
npx clawdwatch status [--url https://worker.dev]

# List checks
npx clawdwatch checks [--url https://worker.dev]

# Run a check immediately
npx clawdwatch run <check-id> [--url https://worker.dev]

# Diff local config vs live
npx clawdwatch diff [--config clawdwatch.config.ts] [--url https://worker.dev]
```

### Authentication

CLI authenticates to the worker API using one of:
1. **CF Access Service Token** — `--client-id` + `--client-secret` (or env vars `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`)
2. **API Key** — `CLAWDWATCH_API_KEY` env var, checked by the worker as an alternative to CF Access JWT

The worker's monitoring API routes accept either a valid CF Access JWT cookie OR an `Authorization: Bearer <api-key>` header. The API key is stored as a worker secret (`MONITORING_API_KEY`).

## Dashboard Changes (React SPA)

### MonitoringPage (Overview)

Stays mostly as-is (card + table views). Changes:
- Fetch history from AE instead of R2 history array
- Add "Add Check" button → opens check editor modal
- Table view gains an "Enabled" column + toggle

### CheckDetailPage (Detail)

- Time range selector gains 7d and 30d options (fetches from AE)
- "Edit Check" button → check editor
- "Run Now" button → POST /api/checks/:id/run
- "Pause/Resume" toggle
- Incident timeline section (from D1)

### New Pages/Components

- **CheckEditorModal** — form for creating/editing checks (name, url, type, assertions, tags, retry, threshold)
- **AlertRulesPage** — manage notification rules
- **MaintenancePage** — schedule maintenance windows
- **IncidentsPage** — incident timeline with duration, affected checks, resolution

## wrangler.jsonc Changes

```jsonc
{
  // ... existing config ...

  // Add D1 database
  "d1_databases": [
    {
      "binding": "MONITORING_DB",
      "database_name": "moltworker-monitoring",
      "database_id": "<created-via-wrangler>"
    }
  ],

  // Add Analytics Engine
  "analytics_engine_datasets": [
    {
      "binding": "MONITORING_AE",
      "dataset": "monitoring_checks"
    }
  ]
}
```

## MoltbotEnv Changes

```typescript
interface MoltbotEnv {
  // ... existing ...
  MONITORING_DB: D1Database;
  MONITORING_AE: AnalyticsEngineDataset;
  MONITORING_API_KEY?: string;  // For CLI/API auth
}
```

## Implementation Phases

### Phase 1: Storage Foundation

**Goal:** D1 + Analytics Engine wired in, checks loaded from D1, results dual-written.

Tasks:
1. Create D1 database (`wrangler d1 create moltworker-monitoring`)
2. Write D1 migration SQL (all tables)
3. Add D1 + AE bindings to `wrangler.jsonc` and `MoltbotEnv`
4. Redesign clawdwatch:
   - New `storage` option replacing `getR2Bucket`
   - Orchestrator loads checks from D1 (not static array)
   - Orchestrator writes results to AE
   - State.ts simplified (no history in R2)
   - Routes read history from AE via SQL API
   - Alert engine creates incidents in D1
5. Seed D1 with current 2 checks on first run (migration seed)
6. Update `src/monitor.ts` to use new API
7. Update `src/index.ts` to pass new bindings
8. Update client `api.ts` types (history now comes from AE)
9. Update dashboard to handle new response shape
10. Tests for new orchestrator, state, routes

### Phase 2: Config API + Moltbot Skill

**Goal:** CRUD API for checks, moltbot skill for managing config via chat.

Tasks:
1. Add config CRUD routes to clawdwatch (checks, alert rules, maintenance windows)
2. Add bulk config export/import endpoints (`GET/PUT /api/config`)
3. Add `MONITORING_API_KEY` bearer token auth as alternative to CF Access
4. Pass `MONITORING_API_KEY` + `WORKER_URL` to container env
5. Create openclaw monitoring skill (`skills/monitoring/`)
6. Skill script: `monitoring.sh` wrapping curl calls to the API
7. Skill SKILL.md describing capabilities for the agent
8. Test skill end-to-end: add check via chat → shows in dashboard

### Phase 3: CLI Tool

**Goal:** Push/pull config between local files and live system for version control.

Tasks:
1. Build CLI tool in clawdwatch (`src/cli/`)
2. Config file format + `defineConfig` helper
3. `push` command (read local file, PUT /api/config)
4. `pull` command (GET /api/config, write local file)
5. `status`, `checks`, `run`, `diff` commands
6. Create `clawdwatch.config.ts` in moltworker repo
7. Add CLI bin entry to clawdwatch package.json

### Phase 4: History & Incidents

**Goal:** Query AE for arbitrary time ranges, auto-track incidents.

Tasks:
1. AE query endpoint in clawdwatch routes (`/api/history/:checkId?range=7d`)
2. Update CheckDetailPage time range selector (add 7d, 30d)
3. Incident auto-creation in orchestrator on state transitions
4. Incident auto-resolution on recovery
5. Incidents API endpoint
6. Incident timeline component on CheckDetailPage
7. Dedicated IncidentsPage listing all incidents
8. Uptime report calculations from AE (p50/p95/p99)

### Phase 5: Alert Rules + Maintenance Windows

**Goal:** Configure where alerts go per check, schedule downtime.

Tasks:
1. Alert rules CRUD API + UI page
2. Orchestrator reads alert rules from D1 before dispatching
3. Alert dispatch to multiple channels based on rules
4. Maintenance windows CRUD API + UI page
5. Orchestrator checks maintenance windows before alerting
6. `skip_checks` option to not run checks during maintenance
7. Visual indicator on dashboard during maintenance

### Phase 6: Advanced Checks

**Goal:** Browser checks, multi-region, multi-step.

Tasks:
1. Browser check runner using `BROWSER` binding (Puppeteer)
2. Multi-step check type using Cloudflare Workflows
3. Multi-region using Durable Objects with location hints
4. Region column in AE data points
5. Per-region status display in dashboard
6. Check editor support for new types

### Phase 7: Public Status Page

**Goal:** Public-facing status page.

Tasks:
1. Status page route (no auth)
2. Component-level status with uptime history
3. Active incidents display
4. Scheduled maintenance display
5. RSS/Atom feed for status updates
6. Embeddable status badge (SVG)

## Migration Path (v1 → v2)

1. Deploy with D1 + AE bindings added to wrangler
2. First run: clawdwatch detects empty D1, seeds from migration SQL
3. Seed script inserts current 2 checks into D1 `checks` table
4. Existing R2 state.json is read; history entries are NOT migrated (AE starts fresh, R2 history is dropped)
5. R2 state.json gets overwritten on next check run with simplified format (no history)
6. Dashboard works immediately — just shows less history until AE accumulates data
7. Old `src/monitoring/` directory already deleted (done in v1 migration)

## Cost (All Free Tier)

| Service | Free Tier | Our Usage (2 checks, 5min interval) |
|---------|-----------|-------------------------------------|
| D1 | 5M rows read, 100K writes/month | ~17K reads, ~9K writes/month |
| Analytics Engine | 10M events/month | ~8,640 events/month |
| R2 | 10M reads, 1M writes/month | ~17K reads, ~8,640 writes/month |
| KV (if needed) | 100K reads/day | N/A initially |

Everything fits comfortably in free tiers, even at 20+ checks.
