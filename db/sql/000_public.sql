-- ═══════════════════════════════════════════════════════════
-- PUBLIC SCHEMA — auth only. Nothing user-owned lives here.
-- ═══════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,                 -- argon2id
  totp_secret    TEXT,
  totp_enabled   BOOLEAN NOT NULL DEFAULT false,
  schema_name    TEXT UNIQUE NOT NULL,          -- 'u_7f3a...' — their namespace
  schema_version INTEGER NOT NULL DEFAULT 1,    -- per-user migration tracking
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash     TEXT UNIQUE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON public.sessions(user_id);
