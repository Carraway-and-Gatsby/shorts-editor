-- M4: 사용자 계정 (F-42)

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 잡의 계정 귀속. 익명 잡은 NULL이며 로그인/가입 시 현재 세션의 잡이 병합된다.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs (user_id, created_at DESC);
