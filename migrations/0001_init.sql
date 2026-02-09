-- clawdwatch v2: monitoring config, incidents, alerts, maintenance
-- Applied to D1 database: moltworker-monitoring

-- Check groups for organizing checks
CREATE TABLE check_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

-- Monitoring check definitions
CREATE TABLE checks (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'api',
  url               TEXT NOT NULL,
  method            TEXT DEFAULT 'GET',
  headers           TEXT DEFAULT '{}',
  body              TEXT,
  assertions        TEXT DEFAULT '[{"type":"statusCode","operator":"is","value":200}]',
  retry_count       INTEGER DEFAULT 0,
  retry_delay_ms    INTEGER DEFAULT 300,
  timeout_ms        INTEGER DEFAULT 10000,
  failure_threshold INTEGER DEFAULT 2,
  tags              TEXT DEFAULT '[]',
  group_id          TEXT REFERENCES check_groups(id) ON DELETE SET NULL,
  regions           TEXT DEFAULT '["default"]',
  enabled           INTEGER DEFAULT 1,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Incidents: auto-created on state transitions (healthy → unhealthy)
CREATE TABLE incidents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id      TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  resolved_at   TEXT,
  duration_s    INTEGER,
  trigger_error TEXT
);

CREATE INDEX idx_incidents_check ON incidents(check_id, started_at);
CREATE INDEX idx_incidents_open ON incidents(resolved_at) WHERE resolved_at IS NULL;

-- Alert rules: per-check or global notification config
CREATE TABLE alert_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id    TEXT REFERENCES checks(id) ON DELETE CASCADE,
  group_id    TEXT REFERENCES check_groups(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',
  on_failure  INTEGER DEFAULT 1,
  on_recovery INTEGER DEFAULT 1,
  enabled     INTEGER DEFAULT 1
);

-- Maintenance windows: suppress alerts during planned downtime
CREATE TABLE maintenance_windows (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id        TEXT REFERENCES checks(id) ON DELETE CASCADE,
  group_id        TEXT REFERENCES check_groups(id) ON DELETE CASCADE,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  reason          TEXT,
  suppress_alerts INTEGER DEFAULT 1,
  skip_checks     INTEGER DEFAULT 0
);

-- Seed: initial checks (migrated from static config in monitor.ts)
INSERT INTO checks (id, name, type, url, tags) VALUES
  ('campermate-website', 'Campermate Website', 'api', 'https://www.campermate.com', '["production"]'),
  ('sandbox-health', 'Moltworker Health', 'api', '{{WORKER_URL}}/sandbox-health', '["infrastructure"]');

-- Seed: default alert rule (POST to moltbot gateway for all checks)
INSERT INTO alert_rules (channel, config) VALUES
  ('gateway', '{}');
