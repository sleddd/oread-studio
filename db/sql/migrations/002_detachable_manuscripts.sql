-- ═══════════════════════════════════════════════════════════
-- MIGRATION 002 — detachable manuscripts.
--
-- manuscripts.world_id and chapters.world_id become NULLABLE, and the
-- world FK changes from ON DELETE CASCADE to ON DELETE SET NULL, so deleting
-- a world DETACHES its manuscripts (they survive, world_id → null) instead of
-- cascading them away. A manuscript can also be reassigned to another world.
--
-- Idempotent: safe to re-run. schema_version AFTER this migration = 2.
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.migrate_002(p_schema TEXT)
RETURNS void AS $$
DECLARE
  fk RECORD;
BEGIN
  -- manuscripts.world_id → nullable
  EXECUTE format('ALTER TABLE %I.manuscripts ALTER COLUMN world_id DROP NOT NULL', p_schema);
  -- chapters.world_id → nullable
  EXECUTE format('ALTER TABLE %I.chapters ALTER COLUMN world_id DROP NOT NULL', p_schema);

  -- Rewrite the world FK on manuscripts to ON DELETE SET NULL.
  FOR fk IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = p_schema AND tc.table_name = 'manuscripts'
      AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'world_id'
  LOOP
    EXECUTE format('ALTER TABLE %I.manuscripts DROP CONSTRAINT %I', p_schema, fk.constraint_name);
  END LOOP;
  EXECUTE format(
    'ALTER TABLE %I.manuscripts ADD CONSTRAINT manuscripts_world_id_fkey
       FOREIGN KEY (world_id) REFERENCES %I.worlds(id) ON DELETE SET NULL',
    p_schema, p_schema);

  -- Rewrite the world FK on chapters to ON DELETE SET NULL.
  FOR fk IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = p_schema AND tc.table_name = 'chapters'
      AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'world_id'
  LOOP
    EXECUTE format('ALTER TABLE %I.chapters DROP CONSTRAINT %I', p_schema, fk.constraint_name);
  END LOOP;
  EXECUTE format(
    'ALTER TABLE %I.chapters ADD CONSTRAINT chapters_world_id_fkey
       FOREIGN KEY (world_id) REFERENCES %I.worlds(id) ON DELETE SET NULL',
    p_schema, p_schema);
END;
$$ LANGUAGE plpgsql;
