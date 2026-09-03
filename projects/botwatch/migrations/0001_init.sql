-- BotWatch v1 schema (docs/cto/adr-botwatch-v1-architecture.md, Decision 2)
-- Single-tenant per Worker/D1 database. site_id exists for future-proofing
-- (so a v2 multi-tenant migration isn't a schema migration too) but v1 code
-- derives it from env.SITE_ID, not a tenant switcher.

CREATE TABLE IF NOT EXISTS requests_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,            -- unix epoch millis
  site_id       TEXT NOT NULL,
  bot_name      TEXT NOT NULL,
  path          TEXT NOT NULL,
  action_taken  TEXT NOT NULL CHECK (action_taken IN ('allow', 'throttle', 'block'))
);

CREATE INDEX IF NOT EXISTS idx_requests_log_site_ts
  ON requests_log (site_id, ts);

CREATE INDEX IF NOT EXISTS idx_requests_log_site_bot_ts
  ON requests_log (site_id, bot_name, ts);

CREATE TABLE IF NOT EXISTS bot_rules (
  site_id     TEXT NOT NULL,
  bot_name    TEXT NOT NULL,
  -- 'throttle' is a valid schema value now so v1.1 doesn't need a migration,
  -- but the Worker only implements allow/block in v1 (Decision 3).
  action      TEXT NOT NULL DEFAULT 'allow' CHECK (action IN ('allow', 'throttle', 'block')),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (site_id, bot_name)
);
