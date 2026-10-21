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
  // Match records: every player gets a row, and "you" is found by joining with my_ids, so
  // confirming an ID re-labels every match without a recompute. No foreign keys: a write deletes
  // a match's child rows itself.
  `
  CREATE TABLE matches (
    guid               TEXT PRIMARY KEY,
    started_at         INTEGER NOT NULL,
    ended_at           INTEGER NOT NULL,
    playlist_id        INTEGER, -- raw id; names come from the playlist map at read time
    arena              TEXT,
    end_kind           TEXT NOT NULL CHECK (end_kind IN ('completed', 'early_end', 'left', 'orphaned')),
    closed_via         TEXT NOT NULL CHECK (closed_via IN ('destroyed', 'timeout', 'restart', 'superseded')),
    joined_in_progress INTEGER NOT NULL,
    overtime           INTEGER NOT NULL,
    score_team0        INTEGER,
    score_team1        INTEGER,
    winner_team_num    INTEGER,
    winner_source      TEXT CHECK (winner_source IN ('match_ended', 'decided')),
    mvp_key            TEXT,
    mvp_source         TEXT CHECK (mvp_source IN ('statfeed', 'inferred')),
    camera_primary_id  TEXT,
    check_flags        TEXT NOT NULL -- JSON array of failed check ids
  );
  CREATE INDEX matches_started_at ON matches (started_at);
  CREATE TABLE match_players (
    match_guid    TEXT NOT NULL,
    player_key    TEXT NOT NULL, -- PrimaryId, or bot:<Name>
    primary_id    TEXT NOT NULL,
    name          TEXT NOT NULL,
    is_bot        INTEGER NOT NULL,
    team_num      INTEGER,
    teams_seen    INTEGER NOT NULL, -- bit 1 << TeamNum per team the player was on
    present_at_end INTEGER NOT NULL,
    score         INTEGER NOT NULL,
    goals         INTEGER NOT NULL,
    shots         INTEGER NOT NULL,
    assists       INTEGER NOT NULL,
    saves         INTEGER NOT NULL,
    touches       INTEGER NOT NULL,
    demos         INTEGER NOT NULL,
    PRIMARY KEY (match_guid, player_key)
  );
  CREATE INDEX match_players_primary_id ON match_players (primary_id);
  CREATE TABLE match_player_statfeed (
    match_guid TEXT NOT NULL,
    player_key TEXT NOT NULL,
    event_name TEXT NOT NULL,
    count      INTEGER NOT NULL,
    PRIMARY KEY (match_guid, player_key, event_name)
  );
  `,
  // Extras: null on a row recorded before this means "not computed" until recompute. Time stats
  // are ms beside car_ms (the time with car state), so shares aggregate across matches.
  `
  ALTER TABLE match_players ADD COLUMN hardest_shot_kmh REAL;
  ALTER TABLE match_players ADD COLUMN woodwork_hits INTEGER;
  ALTER TABLE match_players ADD COLUMN aerial_touches INTEGER;
  ALTER TABLE match_players ADD COLUMN car_ms INTEGER; -- null for a player without car state (opponents)
  ALTER TABLE match_players ADD COLUMN boost_avg REAL;
  ALTER TABLE match_players ADD COLUMN supersonic_ms INTEGER;
  ALTER TABLE match_players ADD COLUMN empty_boost_ms INTEGER;
  CREATE TABLE match_goals (
    match_guid   TEXT NOT NULL,
    idx          INTEGER NOT NULL, -- order in the match
    team_num     INTEGER NOT NULL, -- the scoring team
    scorer_key   TEXT NOT NULL,
    assister_key TEXT,
    toucher_key  TEXT,             -- whose touch the dot sits at; null for an own goal
    x REAL, y REAL, z REAL,        -- ball at that touch, raw field coords; null for an own goal
    distance     REAL,             -- uu to the centre of the goal attacked
    speed_kmh    REAL,
    deflected    INTEGER NOT NULL,
    aerial       INTEGER NOT NULL,
    own_goal     INTEGER NOT NULL,
    PRIMARY KEY (match_guid, idx)
  );
  `,
  // Per-match rule versions, so records computed under older rules can be told apart.
  `
  ALTER TABLE matches ADD COLUMN rule_versions TEXT; -- JSON {ruleId: version} of the rules it was computed under; null before this
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
  // What retention decided for each match past the window: thinned (with the dense outputs its
  // thinned events can't give back) or kept whole as exempt.
  `
  CREATE TABLE retention_matches (
    match_guid    TEXT PRIMARY KEY,
    status        TEXT NOT NULL CHECK (status IN ('thinned', 'exempt')),
    decided_at    INTEGER NOT NULL,
    rule_versions TEXT NOT NULL, -- JSON RECORDED_RULE_VERSIONS when decided
    flags         TEXT,          -- exempt: JSON check ids that kept it whole
    outputs       TEXT,          -- thinned: JSON {cameraKey, players: {key: {column: value}}, denseRules}
    states_before INTEGER,
    states_after  INTEGER
  );
  -- No query filters on ts; the index only slows inserts.
  DROP INDEX events_ts;
  `,
];
