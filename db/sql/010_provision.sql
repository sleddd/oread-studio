-- ═══════════════════════════════════════════════════════════
-- USER SCHEMA PROVISIONING — runs once at signup, inside the
-- signup transaction. Creates the user's isolated tables inside
-- their own namespace. Everything they own lives here, credentials
-- included. No user_id columns — ownership IS the namespace.
--
-- IMPORTANT: this provisioner must always reflect the CURRENT shape.
-- When a migration changes a table, update this function too so new
-- signups get the current shape directly (and bump PROVISION_SHAPE_VERSION
-- in the runner so schema_version starts correct).
--
-- Reconciled 3-level content model (Settled Decision #2):
--   world → manuscripts (named, hold `format`) → chapters (prose).
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.provision_user_schema(p_schema TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE format('CREATE SCHEMA %I', p_schema);

  -- ── CREDENTIALS — envelope-encrypted provider keys ──
  EXECUTE format($t$
    CREATE TABLE %I.credentials (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider       TEXT NOT NULL CHECK (provider IN
                       ('anthropic','openai','bedrock','cloudflare','local')),
      label          TEXT NOT NULL UNIQUE,
      ciphertext     BYTEA NOT NULL,
      iv             BYTEA NOT NULL,
      auth_tag       BYTEA NOT NULL,
      wrapped_dek    BYTEA NOT NULL,
      dek_iv         BYTEA NOT NULL,
      master_key_ver INTEGER NOT NULL DEFAULT 1,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at   TIMESTAMPTZ
    )$t$, p_schema);

  -- ── WORLDS — the JSONB document is source of truth ──
  EXECUTE format($t$
    CREATE TABLE %I.worlds (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT NOT NULL,
      data           JSONB NOT NULL,
      schema_version TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )$t$, p_schema);

  EXECUTE format(
    'CREATE INDEX ON %I.worlds USING GIN ((data->''world''->''memory''))',
    p_schema);

  -- ── WORLD SNAPSHOTS — delta-first safety net (Settled Decision #5) ──
  EXECUTE format($t$
    CREATE TABLE %I.world_snapshots (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      world_id   UUID NOT NULL REFERENCES %I.worlds(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full','delta')),
      data       JSONB NOT NULL,
      reason     TEXT NOT NULL CHECK (reason IN
                   ('manual','pre_ai_write','pre_migration','autosnapshot')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )$t$, p_schema, p_schema);

  EXECUTE format(
    'CREATE INDEX ON %I.world_snapshots (world_id, created_at DESC)',
    p_schema);

  -- ── MANUSCRIPTS — named grouping; format lives here ──
  EXECUTE format($t$
    CREATE TABLE %I.manuscripts (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      world_id   UUID NOT NULL REFERENCES %I.worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT 'Untitled Manuscript',
      format     TEXT NOT NULL DEFAULT 'novel' CHECK (format IN
                   ('novel','short','screenplay','poetry','chat','essay')),
      "order"    INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )$t$, p_schema, p_schema);

  EXECUTE format(
    'CREATE INDEX ON %I.manuscripts (world_id, "order")', p_schema);

  -- ── CHAPTERS — one row per chapter, the autosaving prose ──
  EXECUTE format($t$
    CREATE TABLE %I.chapters (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      world_id      UUID NOT NULL REFERENCES %I.worlds(id) ON DELETE CASCADE,
      manuscript_id UUID NOT NULL REFERENCES %I.manuscripts(id) ON DELETE CASCADE,
      chapter_id    TEXT NOT NULL,
      content       TEXT NOT NULL DEFAULT '',
      word_count    INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'outline' CHECK (status IN
                      ('outline','drafting','revised','final')),
      "order"       INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (manuscript_id, chapter_id)
    )$t$, p_schema, p_schema, p_schema);

  EXECUTE format(
    'CREATE INDEX ON %I.chapters (manuscript_id, "order")', p_schema);

  -- ── CHAPTER REVISIONS — pre-AI + autosave history ──
  EXECUTE format($t$
    CREATE TABLE %I.chapter_revisions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chapter_id  UUID NOT NULL REFERENCES %I.chapters(id) ON DELETE CASCADE,
      content     TEXT NOT NULL,
      word_count  INTEGER NOT NULL,
      reason      TEXT NOT NULL CHECK (reason IN
                    ('autosave','pre_ai_edit','pre_ai_draft','manual')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )$t$, p_schema, p_schema);

  EXECUTE format(
    'CREATE INDEX ON %I.chapter_revisions (chapter_id, created_at DESC)',
    p_schema);

  -- ── CHATS — only explicitly saved ──
  EXECUTE format($t$
    CREATE TABLE %I.chats (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      world_id     UUID NOT NULL REFERENCES %I.worlds(id) ON DELETE CASCADE,
      title        TEXT,
      mode         TEXT NOT NULL CHECK (mode IN
                     ('cowrite','draft','edit','critique','discuss','character')),
      character_id TEXT,
      messages     JSONB NOT NULL,
      distilled    BOOLEAN NOT NULL DEFAULT false,
      saved_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )$t$, p_schema, p_schema);

  EXECUTE format(
    'CREATE INDEX ON %I.chats (world_id, saved_at DESC)', p_schema);
END;
$$ LANGUAGE plpgsql;
