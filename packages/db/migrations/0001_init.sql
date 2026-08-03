-- M1 스키마: 세션, 업로드 세션, 잡, 컴포지션 리비전, 출력물
-- docs/07-data-model.md 참조.

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  filename text NOT NULL,
  size_bytes bigint NOT NULL,
  mime_type text NOT NULL,
  chunk_size integer NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active | completed | canceled
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  status text NOT NULL,
  stage text,
  progress integer NOT NULL DEFAULT 0,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_ext text NOT NULL,
  source_meta jsonb,
  current_revision integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  internal_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_session_idx ON jobs (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS composition_revisions (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  composition jsonb NOT NULL,
  created_by text NOT NULL DEFAULT 'auto', -- auto | user
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, revision)
);

CREATE TABLE IF NOT EXISTS outputs (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  storage_key text NOT NULL,
  thumbnail_key text,
  duration double precision,
  width integer,
  height integer,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (job_id, revision)
);
