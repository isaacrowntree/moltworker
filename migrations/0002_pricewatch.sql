-- pricewatch: price tracker definitions, readings, and alert events
-- Applied to D1 database: moltworker-monitoring

-- Price tracker definitions
CREATE TABLE price_trackers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'api',
  url            TEXT NOT NULL,
  method         TEXT DEFAULT 'GET',
  headers        TEXT DEFAULT '{}',
  body           TEXT,
  extract        TEXT NOT NULL,
  currency       TEXT DEFAULT 'NZD',
  interval_mins  INTEGER DEFAULT 60,
  alert_below    REAL,
  alert_above    REAL,
  alert_pct_drop REAL,
  alert_pct_rise REAL,
  tags           TEXT DEFAULT '[]',
  group_id       TEXT,
  enabled        INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- Price readings (48h hot window, pruned like check_results)
CREATE TABLE price_readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tracker_id  TEXT NOT NULL REFERENCES price_trackers(id) ON DELETE CASCADE,
  price       REAL NOT NULL,
  currency    TEXT NOT NULL,
  raw_text    TEXT,
  source_url  TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_readings_tracker_time ON price_readings(tracker_id, created_at);

-- Price alert events (triggered events log)
CREATE TABLE price_alert_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tracker_id  TEXT NOT NULL REFERENCES price_trackers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  price       REAL,
  threshold   REAL,
  message     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
