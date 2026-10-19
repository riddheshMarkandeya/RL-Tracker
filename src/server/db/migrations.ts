// Schema migrations, one SQL string per version: index + 1 = the version it brings the DB to.
// Append only; never edit a migration that has shipped.
// Timestamps are UTC epoch ms (INTEGER); calendar dates are local `YYYY-MM-DD` (TEXT).

export const trackerMigrations: readonly string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL -- JSON
  );
  CREATE TABLE seasons (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    start_date TEXT NOT NULL UNIQUE
  );
  INSERT INTO seasons (name, start_date) VALUES
    ('S22', '2026-03-11'),
    ('S23', '2026-06-09'),
    ('S24', '2026-09-23');
  -- pending: a guess waiting for "That's me" / "Not me"; rejected: never ask about it again.
  CREATE TABLE my_ids (
    primary_id TEXT PRIMARY KEY,
    name       TEXT,
    status     TEXT NOT NULL CHECK (status IN ('confirmed', 'pending', 'rejected')),
    added_at   INTEGER NOT NULL
  );
  -- Manual "start new session" markers.
  CREATE TABLE session_breaks (
    at INTEGER PRIMARY KEY
  );
  `,
];

export const rawMigrations: readonly string[] = [
  `
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    match_guid TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    ts         INTEGER NOT NULL,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL, -- JSON
    UNIQUE (match_guid, seq)
  );
  CREATE INDEX events_ts ON events (ts);
  `,
];
