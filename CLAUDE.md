# Oread Studio — standing rules for Claude Code

Read [SPEC.md](SPEC.md) first — it is the authoritative build spec, and its
**Settled Decisions** section at the top wins over any older wording. The design
prototype and handoff live in [prototype-and-design/](prototype-and-design/):
`OREAD Studio.dc.html` is the view/state/copy source of truth, `README.md` the
narrative handoff. Do **not** port the `.dc.html` runtime — recreate it in React.

## Architecture at a glance
- **Monorepo** (npm workspaces): `packages/shared` (TS types + world JSON Schema,
  shared by server and web), `apps/server` (Fastify + node-postgres),
  `apps/web` (Vite + React + TS).
- **Schema-per-user Postgres.** No shared user-data tables, no `user_id` columns —
  ownership is the namespace. `public` holds only `users` + `sessions`. Per-user
  schema is created by `provision_user_schema(p_schema)` in the signup txn.
- **Request pattern:** `withUserSchema(pool, schemaName, fn)` sets
  `search_path` to the user's schema, runs `fn(client)` with bare table names,
  resets to `public` before releasing. `schema_name` is server-generated, never
  user input.
- **Migration runner** loops `public.users.schema_name`, applies idempotent
  plpgsql migration fns, bumps `schema_version`, restartable. Update the
  provisioner alongside every migration so new signups get current shape.

## Non-negotiables (see SPEC Settled Decisions)
- One world open at a time; Switch World swaps it. One writer — **no version
  check, no merge logic**.
- Content model is 3 levels: **world → named manuscripts (hold `format`) →
  chapters (prose rows)**. This diverges from the original SQL and is applied via
  migration `db/sql/migrations/`.
- **World persists on explicit Save only** (+ discrete events). **Chapter prose**
  is the only debounced-autosave writer (TEXT column). **Chat** persists only on
  explicit Save Chat.
- **`WorldStore` interface, two backends** — Postgres (default) and file
  (`OREAD_STORAGE=local`). Identical JSON document either way.
- **Snapshots are JSON-Patch deltas** (+ occasional full).
- **Envelope encryption** for credentials (per-user DEK, AES-256-GCM, master key
  from env, `master_key_ver` for rotation). Never log or cache plaintext.
- **Mode contracts enforced server-side:** critique modifies nothing; edit
  invents no plot; draft never contradicts canon; character chat respects
  `state.knowledge`.
- A **revision snapshot is written BEFORE any AI-applied change** to prose.

## Safety
- **Never run destructive/DDL commands against the remote `DATABASE_URL` without
  explicit user confirmation.** `db:bootstrap` / `db:migrate` are opt-in.
- DB-dependent tests skip cleanly when `DATABASE_URL` is unset.

## Commands
- `npm run dev:server` / `npm run dev:web` — dev servers
- `npm run db:bootstrap` — create public schema + install provisioner/migrations
- `npm run db:migrate` — run pending migrations across all user schemas
- `npm run typecheck` / `npm test` — across workspaces
