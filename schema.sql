-- World Cup 2026 Predictor — PostgreSQL schema
-- Run once:  psql "$DATABASE_URL" -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT NOT NULL,
  username_lower     TEXT UNIQUE NOT NULL,
  total_points       INTEGER NOT NULL DEFAULT 0,
  avatar             TEXT,
  champion_pick      TEXT,
  champion_flag      TEXT,
  champion_bonus     INTEGER NOT NULL DEFAULT 0,
  champion_picked_at TIMESTAMPTZ,
  api_token          TEXT,
  last_rank          INTEGER,
  last_points        INTEGER,
  pin                TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_points_idx ON users (total_points DESC);
CREATE INDEX IF NOT EXISTS users_token_idx  ON users (api_token);

CREATE TABLE IF NOT EXISTS matches (
  id              BIGSERIAL PRIMARY KEY,
  external_id     TEXT UNIQUE,
  team_a          TEXT NOT NULL,
  team_b          TEXT NOT NULL,
  flag_a          TEXT,
  flag_b          TEXT,
  kickoff_time    TIMESTAMPTZ NOT NULL,
  actual_score_a  INTEGER,
  actual_score_b  INTEGER,
  live_score_a    INTEGER,
  live_score_b    INTEGER,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  grp             TEXT
);
CREATE INDEX IF NOT EXISTS matches_kickoff_idx ON matches (kickoff_time);

CREATE TABLE IF NOT EXISTS predictions (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id          BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  predicted_score_a INTEGER NOT NULL,
  predicted_score_b INTEGER NOT NULL,
  points_earned     INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);
CREATE INDEX IF NOT EXISTS predictions_match_idx ON predictions (match_id);
CREATE INDEX IF NOT EXISTS predictions_user_idx  ON predictions (user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB
);

CREATE TABLE IF NOT EXISTS announcements (
  id         BIGSERIAL PRIMARY KEY,
  message    TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS polls (
  id         BIGSERIAL PRIMARY KEY,
  question   TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice  BOOLEAN NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
