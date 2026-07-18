-- ═══════════════════════════════════════════════════════════
-- MIGRATION REGISTRY (public) — tracks which migration versions
-- exist. Per-user application progress is tracked by
-- public.users.schema_version. This table is the catalog of the
-- highest migration version the codebase knows about.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
