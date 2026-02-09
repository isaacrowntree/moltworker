---
name: monitoring
description: Manage synthetic monitoring checks for moltworker services via the clawdwatch API. Use for creating, updating, deleting, and querying monitoring checks and incidents. Checks run every 5 minutes with results stored in Analytics Engine (90-day retention).
---

# Monitoring

Manage synthetic monitoring checks for moltworker services via the clawdwatch API.

Checks run every 5 minutes. Results are stored in Analytics Engine (90-day retention).
Alerts fire when checks transition to unhealthy (after consecutive failure threshold).

## Environment

- `MONITORING_API_KEY` — Shared secret for the monitoring API
- `WORKER_URL` — Base URL of the moltworker (e.g., https://moltbot-sandbox.example.workers.dev)

## Authentication

All API calls use query param auth: `?secret=${MONITORING_API_KEY}`

```bash
BASE="${WORKER_URL}/monitoring/api"
SECRET="?secret=${MONITORING_API_KEY}"
```

## API Reference

### Status

```bash
# Overall status (all checks with current state)
curl -s "${BASE}/status${SECRET}" | jq
```

Returns: `{ overall, checks: [{id, name, status, responseTimeMs, ...}], lastRun }`

### Check Management

```bash
# List all checks
curl -s "${BASE}/checks${SECRET}" | jq

# Get single check
curl -s "${BASE}/checks/<check-id>${SECRET}" | jq

# Create a check (id, name, url required)
curl -s -X POST "${BASE}/checks${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "new-check",
    "name": "New Check",
    "type": "api",
    "url": "https://example.com",
    "assertions": [{"type": "statusCode", "operator": "is", "value": 200}],
    "tags": ["production"]
  }' | jq

# Update a check (partial — only include fields to change)
curl -s -X PUT "${BASE}/checks/<check-id>${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"timeout_ms": 5000}' | jq

# Delete a check
curl -s -X DELETE "${BASE}/checks/<check-id>${SECRET}" | jq

# Enable/disable a check
curl -s -X POST "${BASE}/checks/<check-id>/toggle${SECRET}" | jq

# Run a check immediately (returns result)
curl -s -X POST "${BASE}/checks/<check-id>/run${SECRET}" | jq
```

### Incidents

```bash
# List incidents (auto-created on state transitions)
curl -s "${BASE}/incidents${SECRET}" | jq

# Filter by check and status
curl -s "${BASE}/incidents${SECRET}&check_id=<check-id>&status=open&limit=20" | jq
```

Query params: `check_id`, `status` (open|resolved), `limit`

### Alert Rules (read-only)

```bash
# List configured alert rules
curl -s "${BASE}/alert-rules${SECRET}" | jq
```

Alert rules are configured in D1 directly or via config sync. The API currently only supports reading them.

### Bulk Config (export/import)

```bash
# Export full config (checks + alert rules)
curl -s "${BASE}/config${SECRET}" | jq

# Import checks (declarative sync — deletes checks not in array, upserts the rest)
curl -s -X PUT "${BASE}/config${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"checks": [
    {"id": "my-check", "name": "My Check", "url": "https://example.com", "type": "api"}
  ]}' | jq
```

Note: PUT `/api/config` only syncs checks. Alert rules in the GET export response are read-only.

## Check Configuration

Every check has these fields:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | — | Unique identifier (lowercase, hyphens, e.g., `campermate-website`) |
| `name` | string | Yes | — | Human-readable name (e.g., "Campermate Website") |
| `type` | string | No | `api` | `api` (HTTP check) or `browser` (headless Chrome) |
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

```json
{ "type": "statusCode", "operator": "is", "value": 200 }
{ "type": "statusCode", "operator": "isNot", "value": 500 }
```

Operators: `is`, `isNot`

#### Response Time

```json
{ "type": "responseTime", "operator": "lessThan", "value": 2000 }
```

Operators: `lessThan`. Value in milliseconds.

#### Header

```json
{ "type": "header", "name": "content-type", "operator": "contains", "value": "application/json" }
```

Operators: `is`, `isNot`, `contains`, `notContains`, `matches` (regex)

#### Body

```json
{ "type": "body", "operator": "contains", "value": "\"status\":\"ok\"" }
```

Operators: `contains`, `notContains`, `matches` (regex)

## Example Check Configs

**Simple health check:**
```json
{
  "id": "my-api-health",
  "name": "My API Health",
  "type": "api",
  "url": "https://api.example.com/health",
  "tags": ["production", "api"]
}
```

**API with assertions:**
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

**Self-referencing check (monitoring the worker itself):**
```json
{
  "id": "worker-health",
  "name": "Worker Health",
  "type": "api",
  "url": "{{WORKER_URL}}/sandbox-health",
  "tags": ["infrastructure"]
}
```
