-- Lost Temple D1 schema (PORTING.md §6). Applied with:
--   npx wrangler d1 execute losttemple --local  --file schema.sql
--   npx wrangler d1 execute losttemple --remote --file schema.sql
-- The bootstrap-era throwaway meta table is dropped and recreated.

DROP TABLE IF EXISTS meta;

-- Island mapping/metadata. One row per servable island number.
CREATE TABLE IF NOT EXISTS islands (
  num        INTEGER PRIMARY KEY,   -- public island number (what the client asks for)
  kind       TEXT    NOT NULL CHECK (kind IN ('level','legacy','daily','tutorial')),
  seed       INTEGER,               -- actual gen seed; NULL when comm is stored
  difficulty INTEGER NOT NULL,
  route      TEXT,                  -- CommRoute JSON, NULL if absent (predefined maps)
  comm       TEXT,                  -- full CommIsland JSON (dailies/tutorials); NULL when regenerable
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (seed IS NOT NULL OR comm IS NOT NULL)
);

-- Random pick support: contiguous per-level pool index -> number.
-- WITHOUT ROWID: the composite PK is the clustered index (one row write per
-- insert instead of table+autoindex, halving the D1 write quota cost).
CREATE TABLE IF NOT EXISTS pool (
  level INTEGER NOT NULL,
  k     INTEGER NOT NULL,           -- 0..count-1, dense
  num   INTEGER NOT NULL REFERENCES islands(num),
  PRIMARY KEY (level, k)
) WITHOUT ROWID;

-- Without this, every DELETE/REPLACE against islands(num) forces D1's
-- foreign-key check to full-scan pool (no index on the child FK column) to
-- see if any pool row still references the deleted num - even for rows
-- (e.g. dailies) that pool never references at all. This is what blew the
-- free-tier daily row-read cap from a handful of INSERT OR REPLACE batches
-- into islands: 84 rows replaced x ~30k pool rows scanned per row.
CREATE INDEX IF NOT EXISTS idx_pool_num ON pool(num);

-- Straight port of the Kotlin score table (S§10). Same semantics/clamping.
CREATE TABLE IF NOT EXISTS score_counts (
  game  INTEGER NOT NULL,
  score INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, score)
);

-- Odds and ends: daily seed counters per level, pool counts, schema version.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,           -- 'daily_counter_1'..'daily_counter_6',
  value TEXT NOT NULL               -- 'pool_count_1'.., 'schema_version'
);

-- Cron backstop alerts (PORTING.md §5.4): free tier alerts, never generates.
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT
);

INSERT INTO meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
