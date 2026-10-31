CREATE TABLE IF NOT EXISTS global_metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_pv INTEGER NOT NULL DEFAULT 0,
  total_uv INTEGER NOT NULL DEFAULT 0,
  filtered_bots INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO global_metrics (id, total_pv, total_uv, filtered_bots) VALUES (1, 0, 0, 0);

CREATE TABLE IF NOT EXISTS unique_visitors (
  visitor_hash TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL,
  lng REAL,
  visits INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS country_stats (
  country TEXT PRIMARY KEY,
  pv INTEGER NOT NULL DEFAULT 0,
  uv INTEGER NOT NULL DEFAULT 0,
  last_city TEXT NOT NULL,
  lat REAL,
  lng REAL
);

CREATE TABLE IF NOT EXISTS city_nodes (
  city_key TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  pv INTEGER NOT NULL DEFAULT 0,
  last_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS page_stats (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pv INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  visitor_hash TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT,
  colo TEXT NOT NULL,
  asn TEXT,
  lat REAL,
  lng REAL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  referrer TEXT NOT NULL,
  is_new_uv INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  pv INTEGER NOT NULL DEFAULT 0,
  uv INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_logs_ts ON access_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON unique_visitors(last_seen DESC);
