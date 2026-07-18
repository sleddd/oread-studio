-- ═══════════════════════════════════════════════════════════
-- MIGRATION 001 — baseline / 3-level content model.
--
-- Migrations are IDEMPOTENT plpgsql functions taking a schema name.
-- The runner loops every public.users.schema_name, applies each
-- pending migration in a savepoint, and bumps that user's
-- schema_version. Restartable: re-running applies only what's missing.
--
-- This baseline reconciles the original per-chapter `manuscripts` table
-- into the 3-level model (manuscripts named grouping + chapters prose).
-- On a freshly-provisioned schema (current provisioner) every step is a
-- safe no-op. On an OLD schema (original SQL: manuscripts(world_id,
-- chapter_id)) it performs the corrective restructure.
--
-- schema_version AFTER this migration = 1.
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.migrate_001(p_schema TEXT)
RETURNS void AS $$
DECLARE
  has_old_manuscripts BOOLEAN;
  has_chapters        BOOLEAN;
BEGIN
  -- Ensure world_snapshots.kind exists (delta support) — idempotent.
  EXECUTE format(
    'ALTER TABLE %I.world_snapshots ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT ''full''',
    p_schema);
  -- Add the CHECK for kind if missing (guarded).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = p_schema AND table_name = 'world_snapshots'
      AND column_name = 'kind'
  ) THEN
    -- best-effort; ignore if a matching check already governs it
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.world_snapshots ADD CONSTRAINT world_snapshots_kind_chk CHECK (kind IN (''full'',''delta''))',
        p_schema);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;

  -- Detect current shape.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = p_schema AND table_name = 'manuscripts'
      AND column_name = 'chapter_id'
  ) INTO has_old_manuscripts;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = p_schema AND table_name = 'chapters'
  ) INTO has_chapters;

  -- If the new provisioner already ran, `chapters` exists and the old
  -- per-chapter manuscripts table does not — nothing to restructure.
  IF has_chapters AND NOT has_old_manuscripts THEN
    RETURN;
  END IF;

  -- ── Corrective restructure for OLD schemas ──
  IF has_old_manuscripts THEN
    -- 1. Rename the old per-chapter table out of the way.
    EXECUTE format('ALTER TABLE %I.manuscripts RENAME TO chapters_legacy', p_schema);
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = p_schema AND table_name = 'manuscript_revisions') THEN
      EXECUTE format('ALTER TABLE %I.manuscript_revisions RENAME TO chapter_revisions_legacy', p_schema);
    END IF;

    -- 2. Create the new named-manuscripts table.
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
    EXECUTE format('CREATE INDEX ON %I.manuscripts (world_id, "order")', p_schema);

    -- 3. Seed one manuscript per world to hold the legacy chapters.
    EXECUTE format($t$
      INSERT INTO %I.manuscripts (world_id, name, format, "order")
      SELECT DISTINCT world_id, 'Manuscript', 'novel', 0 FROM %I.chapters_legacy
    $t$, p_schema, p_schema);

    -- 4. Create the new chapters table.
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
    EXECUTE format('CREATE INDEX ON %I.chapters (manuscript_id, "order")', p_schema);

    -- 5. Migrate legacy chapter rows into the new table under their world's manuscript.
    EXECUTE format($t$
      INSERT INTO %I.chapters (world_id, manuscript_id, chapter_id, content, word_count, status, "order", created_at, updated_at)
      SELECT cl.world_id, m.id, cl.chapter_id, cl.content, cl.word_count, cl.status, 0, cl.created_at, cl.updated_at
      FROM %I.chapters_legacy cl
      JOIN %I.manuscripts m ON m.world_id = cl.world_id
    $t$, p_schema, p_schema, p_schema);

    -- 6. Chapter revisions table + migrate legacy revisions if present.
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
    EXECUTE format('CREATE INDEX ON %I.chapter_revisions (chapter_id, created_at DESC)', p_schema);

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = p_schema AND table_name = 'chapter_revisions_legacy') THEN
      -- Map legacy revisions (keyed by old manuscript_id == old chapter row id)
      -- to the new chapter rows via chapter_id text match.
      EXECUTE format($t$
        INSERT INTO %I.chapter_revisions (chapter_id, content, word_count, reason, created_at)
        SELECT c.id, rl.content, rl.word_count, rl.reason, rl.created_at
        FROM %I.chapter_revisions_legacy rl
        JOIN %I.chapters_legacy cl ON cl.id = rl.manuscript_id
        JOIN %I.chapters c ON c.chapter_id = cl.chapter_id AND c.world_id = cl.world_id
      $t$, p_schema, p_schema, p_schema, p_schema);
      EXECUTE format('DROP TABLE %I.chapter_revisions_legacy', p_schema);
    END IF;

    -- 7. Drop the legacy chapters table.
    EXECUTE format('DROP TABLE %I.chapters_legacy', p_schema);

  ELSIF NOT has_chapters THEN
    -- No manuscripts at all yet (partial schema) — create the fresh 3-level tables.
    EXECUTE format($t$
      CREATE TABLE IF NOT EXISTS %I.manuscripts (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        world_id   UUID NOT NULL REFERENCES %I.worlds(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT 'Untitled Manuscript',
        format     TEXT NOT NULL DEFAULT 'novel' CHECK (format IN
                     ('novel','short','screenplay','poetry','chat','essay')),
        "order"    INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )$t$, p_schema, p_schema);
    EXECUTE format($t$
      CREATE TABLE IF NOT EXISTS %I.chapters (
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
    EXECUTE format($t$
      CREATE TABLE IF NOT EXISTS %I.chapter_revisions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chapter_id  UUID NOT NULL REFERENCES %I.chapters(id) ON DELETE CASCADE,
        content     TEXT NOT NULL,
        word_count  INTEGER NOT NULL,
        reason      TEXT NOT NULL CHECK (reason IN
                      ('autosave','pre_ai_edit','pre_ai_draft','manual')),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )$t$, p_schema, p_schema);
  END IF;
END;
$$ LANGUAGE plpgsql;
