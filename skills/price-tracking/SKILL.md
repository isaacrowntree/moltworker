---
name: price-tracking
description: Track prices from any source (e-commerce, crypto, stocks, travel) with alerts and historical data via the PriceWatch API. Use for creating, updating, and querying price trackers. Trackers run on cron (every 5 minutes) with configurable intervals per tracker.
---

# Price Tracking

Track prices from any source over time, with alerts on thresholds and historical data.

Trackers run on cron (every 5 minutes). Each tracker has its own `interval_mins` setting
controlling how often it actually checks (minimum 5 minutes, default 60 minutes).
Results are stored in D1 (48h hot window) and Analytics Engine (90-day retention).

## Environment

- `PRICEWATCH_API_KEY` or `MONITORING_API_KEY` — Shared secret for the price tracking API
- `WORKER_URL` — Base URL of the moltworker (e.g., https://moltbot-sandbox.example.workers.dev)

## Authentication

All API calls use query param auth: `?secret=${PRICEWATCH_API_KEY}`

```bash
BASE="${WORKER_URL}/prices/api"
SECRET="?secret=${PRICEWATCH_API_KEY}"
```

If `PRICEWATCH_API_KEY` is not set, falls back to `MONITORING_API_KEY`.

## API Reference

### Status

```bash
# Full status with history for dashboard
curl -s "${BASE}/status${SECRET}" | jq
```

Returns: `{ summary: { totalTrackers, activeAlerts, avgSavings }, trackers: [...], lastRun }`

### Tracker Management

```bash
# List all trackers
curl -s "${BASE}/trackers${SECRET}" | jq

# Get single tracker
curl -s "${BASE}/trackers/<tracker-id>${SECRET}" | jq

# Create a tracker (id, name, url, extract required)
curl -s -X POST "${BASE}/trackers${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "btc-nzd",
    "name": "Bitcoin NZD",
    "type": "api",
    "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=nzd",
    "extract": {"strategy": "jsonPath", "path": "$.bitcoin.nzd"},
    "currency": "NZD",
    "interval_mins": 15,
    "alert_below": 80000,
    "alert_above": 120000,
    "tags": ["crypto"]
  }' | jq

# Update a tracker (partial — only include fields to change)
curl -s -X PUT "${BASE}/trackers/<tracker-id>${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"alert_below": 75000}' | jq

# Delete a tracker
curl -s -X DELETE "${BASE}/trackers/<tracker-id>${SECRET}" | jq

# Enable/disable a tracker
curl -s -X POST "${BASE}/trackers/<tracker-id>/toggle${SECRET}" | jq

# Fetch price now (immediate check, returns result)
curl -s -X POST "${BASE}/trackers/<tracker-id>/check${SECRET}" | jq

# Reset baseline price (resets low/high/baseline to current)
curl -s -X POST "${BASE}/trackers/<tracker-id>/reset-baseline${SECRET}" | jq

# Get 24h price history
curl -s "${BASE}/trackers/<tracker-id>/history${SECRET}" | jq
```

### Alert Events

```bash
# List recent alert events
curl -s "${BASE}/alerts${SECRET}" | jq

# Filter by tracker
curl -s "${BASE}/alerts${SECRET}&tracker_id=<tracker-id>&limit=20" | jq
```

### Bulk Config (export/import)

```bash
# Export all trackers
curl -s "${BASE}/config${SECRET}" | jq

# Import trackers (declarative sync — deletes trackers not in array, upserts the rest)
curl -s -X PUT "${BASE}/config${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"trackers": [...]}' | jq
```

### Forecast

```bash
# Get forecast data (history + state for Claude analysis)
curl -s -X POST "${BASE}/forecast/<tracker-id>${SECRET}" | jq
```

Returns tracker info, current state, and 24h history. Post this data to `/api/price-forecast`
on the agent gateway for Claude to analyze trends and make predictions.

## Tracker Configuration

Every tracker has these fields:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | — | Unique identifier (lowercase, hyphens) |
| `name` | string | Yes | — | Human-readable name |
| `type` | string | No | `api` | `api` (HTTP fetch) or `browser` (headless Chrome via CDP) |
| `url` | string | Yes | — | URL to fetch price from |
| `method` | string | No | `GET` | HTTP method |
| `headers` | object | No | `{}` | Custom request headers |
| `body` | string | No | `null` | Request body (for POST) |
| `extract` | object | Yes | — | How to extract the price (see below) |
| `currency` | string | No | `NZD` | Currency code for display |
| `interval_mins` | number | No | `60` | How often to check (min 5) |
| `alert_below` | number | No | `null` | Alert when price drops below this |
| `alert_above` | number | No | `null` | Alert when price rises above this |
| `alert_pct_drop` | number | No | `null` | Alert on % drop from baseline |
| `alert_pct_rise` | number | No | `null` | Alert on % rise from baseline |
| `tags` | array | No | `[]` | Tags for grouping |
| `enabled` | boolean | No | `true` | Whether the tracker runs |

### Extraction Strategies

The `extract` field defines how to extract the price from the response:

#### JSON Path (for APIs)
```json
{"strategy": "jsonPath", "path": "$.data.price"}
{"strategy": "jsonPath", "path": "$.market_data.current_price.nzd"}
{"strategy": "jsonPath", "path": "$.bitcoin.nzd"}
```

Path syntax: `$.field`, `$.nested.field`, `$.array[0].field`.
The extracted value is parsed as a number (currency symbols and commas stripped).

#### CSS Selector (for web pages, requires `type: "browser"`)
```json
{"strategy": "selector", "selector": "#price-value"}
{"strategy": "selector", "selector": ".product-price span", "attribute": "textContent"}
```

Uses headless Chrome to load the page and extract text from the matched element.
Default attribute is `textContent`.

#### JS Expression (for web pages, requires `type: "browser"`)
```json
{"strategy": "evaluate", "expression": "document.querySelector('.price').innerText"}
```

Runs arbitrary JS in the page context to extract the price.

## Alert Types

| Type | Trigger | Description |
|------|---------|-------------|
| `drop_below` | `price < alert_below` | Price dropped below absolute threshold |
| `rise_above` | `price > alert_above` | Price rose above absolute threshold |
| `pct_drop` | `% drop > alert_pct_drop` | Price dropped by % from baseline |
| `pct_rise` | `% rise > alert_pct_rise` | Price rose by % from baseline |
| `error` | Fetch failed | Price check failed |
| `recovery` | Was error, now succeeded | Price check recovered |

Multiple alerts can fire simultaneously (e.g., a price drop can trigger both `drop_below` and `pct_drop`).

The baseline price is set on the first reading and can be reset via the API.

## Example Tracker Configs

**Crypto (CoinGecko):**
```json
{
  "id": "btc-nzd",
  "name": "Bitcoin NZD",
  "type": "api",
  "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=nzd",
  "extract": {"strategy": "jsonPath", "path": "$.bitcoin.nzd"},
  "currency": "NZD",
  "interval_mins": 15,
  "alert_pct_drop": 10,
  "alert_pct_rise": 10,
  "tags": ["crypto"]
}
```

**Stock API:**
```json
{
  "id": "aapl-stock",
  "name": "Apple Stock",
  "type": "api",
  "url": "https://api.example.com/v1/quote/AAPL",
  "headers": {"Authorization": "Bearer YOUR_API_KEY"},
  "extract": {"strategy": "jsonPath", "path": "$.price"},
  "currency": "USD",
  "interval_mins": 30,
  "alert_below": 150,
  "alert_above": 250,
  "tags": ["stocks"]
}
```

**E-commerce (browser extraction):**
```json
{
  "id": "product-deal",
  "name": "Awesome Product",
  "type": "browser",
  "url": "https://www.example.com/product/12345",
  "extract": {"strategy": "selector", "selector": ".price-now"},
  "currency": "NZD",
  "interval_mins": 60,
  "alert_below": 50,
  "tags": ["shopping"]
}
```

**Exchange rate:**
```json
{
  "id": "nzd-usd",
  "name": "NZD/USD Exchange Rate",
  "type": "api",
  "url": "https://open.er-api.com/v6/latest/NZD",
  "extract": {"strategy": "jsonPath", "path": "$.rates.USD"},
  "currency": "USD",
  "interval_mins": 60,
  "alert_below": 0.55,
  "alert_above": 0.65,
  "tags": ["forex"]
}
```

## Forecasting

To request a price forecast:

1. Call `POST /api/forecast/<tracker-id>` to get historical data
2. The response includes tracker info, current state, and 24h price history
3. Analyze the data for trends, seasonality, and patterns
4. Provide insights like:
   - Current trend direction (rising/falling/stable)
   - Rate of change
   - Comparison to baseline
   - Estimated time to reach alert thresholds (if set)
   - Best time to buy/sell based on historical patterns
