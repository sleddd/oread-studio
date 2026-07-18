# Oread Studio

A connected writing workspace for fiction and nonfiction authors. Build
"worlds" (a single JSON document holding premise, setting, entities, structure,
and memory), write manuscripts chapter-by-chapter, and work with AI in five
modes — including chatting **in-character** with any character in your cast.

See [SPEC.md](SPEC.md) for the authoritative build spec and its **Settled
Decisions**, and [prototype-and-design/](prototype-and-design/) for the design
source of truth.

## Monorepo layout

```
packages/shared     TS types + world JSON Schema + format specs (shared by server & web)
apps/server         Fastify + node-postgres — auth, storage, credentials, AI, export
apps/web            Vite + React + TS — the workspace UI (modular, not a monolith)
db/sql              Public schema, provisioner (3-level model), migration functions
```

## Architecture highlights

- **Schema-per-user Postgres isolation.** `public` holds only `users` +
  `sessions`; every user gets their own namespace of tables, created by
  `provision_user_schema()` inside the signup transaction. Requests run via
  `withUserSchema` (sets/resets `search_path`; validates the schema name).
- **Content model:** world → named **manuscripts** (hold `format`) → **chapters**
  (the prose). One world open at a time.
- **Save cadence:** the world persists only on explicit **Save World** (+ discrete
  events); chapter prose is the only debounced-autosave writer; chats save only on
  **Save Chat**.
- **Storage backends:** one `WorldStore` interface, two impls — Postgres (default)
  and file (`OREAD_STORAGE=local`). Identical JSON document either way.
- **Envelope encryption** (AES-256-GCM) for provider credentials + TOTP secrets;
  master-key versioning for rotation.
- **AI:** provider adapters for Anthropic, OpenAI, Cloudflare, Bedrock, and local
  (Ollama), behind one interface; per-mode context assembly with a token budget;
  server-side mode-contract enforcement; a deterministic mock fallback when no
  credential is configured.
- **Snapshots** are JSON-Patch deltas (+ occasional full). A **revision snapshot is
  taken before any AI-applied change** to prose.

## Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, MASTER_KEY_V1, SESSION_SECRET
```

Generate secrets:

```bash
openssl rand -base64 32   # MASTER_KEY_V1
openssl rand -base64 48   # SESSION_SECRET
```

## Database

`db:bootstrap` / `db:migrate` are the ONLY commands that run DDL — they are
opt-in and never run implicitly.

```bash
npm run db:bootstrap      # install public schema + provisioner + migration fns
npm run db:migrate        # apply pending migrations across all user schemas (idempotent, restartable)
```

The migration runner loops `public.users.schema_name`, applies each pending
idempotent plpgsql migration in its own transaction, bumps `schema_version`,
and is restartable. Run it in Render's pre-deploy command.

## Develop

```bash
npm run dev:server        # Fastify on :8080
npm run dev:web           # Vite on :5173 (proxies /api → :8080)
```

## Test

```bash
npm test                  # all workspaces
```

DB-integration tests (schema isolation, migration idempotency/restartability)
**skip** when `DATABASE_URL` is unset. To run them against a scratch database:

```bash
DATABASE_URL=postgres://… npm --workspace @oread/server test
```

## Storage modes

- Default: **Postgres** (schema-per-user).
- `OREAD_STORAGE=local`: worlds live as `./data/worlds/<id>/world.json` — one
  cat-able file per world, for single-user / offline use. (Auth still uses
  Postgres.)
