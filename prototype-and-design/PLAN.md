# Oread Studio — Build Plan

> A copy of this plan will also be written to `prototype-and-design/PLAN.md` the moment we exit plan mode (plan-mode rules currently restrict edits to this file only).

## Context

We are building **Oread Studio**, a full writing application (not just the frontend) per `SPEC.md`. Authors build "worlds" (a single JSONB document holding premise, setting, entities, structure, and memory), write manuscripts chapter-by-chapter, and interact with AI in five modes (Discuss, Co-write, Draft, Edit, Critique), including chatting **in-character** with any character in the world.

The defining architectural constraint is **schema-per-user Postgres isolation** — every user gets their own namespace of physical tables; there are no shared user-data tables and no `user_id` columns. The user has supplied finalized SQL (public schema + `provision_user_schema` provisioner + `withUserSchema` request pattern) and will provide a **remote `DATABASE_URL`** (no local Docker/Postgres). A high-fidelity HTML prototype exists in `prototype-and-design/` and is the source of truth for the frontend look, copy, state model, and interactions.

Repo currently contains only `prototype-and-design/` (prototype HTML, README, support.js) and `.claude/`. `SPEC.md` and `db/sql/000_public.sql` were written this session before plan mode. Node 26 / npm 11 available; no `psql`/`pg_dump` on PATH; Docker installed but not required (remote DB).

### Goals / non-negotiables (from SPEC + user)
- Schema-per-user isolation; provisioning inside the signup transaction; `withUserSchema` sets/resets `search_path`.
- Migration runner built **early** — idempotent plpgsql functions per schema, loops all users, bumps `schema_version`, restartable; provisioner updated alongside every migration.
- Envelope encryption for credentials (per-user DEK, AES-256-GCM, master key from env, `master_key_ver` for rotation). Never log/cache plaintext.
- Chats are **client-state until explicitly saved**; **chapter prose** autosaves (debounced) with a **revision snapshot BEFORE any AI-applied change**; the **world document persists on explicit Save only** (never keystroke/timer); world snapshots (deltas) before AI-initiated world mutations.
- Server-side mode-permission enforcement (critique modifies nothing; edit invents no plot; draft never contradicts canon; character chat respects `state.knowledge`).
- World documents validated against a JSON Schema on load and save.
- Frontend must be **modular, reusable client-side code — not a monolith** (explicit user requirement).
- Required tests: schema isolation, migration idempotency/restartability, mode-permission enforcement, encryption round-trip, revision-before-AI-write guarantee.

## Proposed repo layout (npm workspaces monorepo)

```
oread-studio/               (folder to be renamed from oread-frontend by user)
  SPEC.md                   ✓ written
  CLAUDE.md                 standing rules → points at SPEC.md + db/sql
  package.json              workspaces: [packages/*, apps/*]
  .env.example              DATABASE_URL, MASTER_KEY_V1, SESSION_* , provider keys
  db/sql/
    000_public.sql          ✓ written (public: users, sessions)
    010_provision.sql       provision_user_schema(p_schema) — authoritative per-user DDL
    migrations/00x_*.sql     idempotent plpgsql migration fns (one per change)
  packages/
    shared/                 TS types + Zod/JSON-Schema for the world document; mode configs; suggestion shape. Consumed by BOTH server and web.
  apps/
    server/                 Fastify + node-postgres
      src/
        db/       pool, withUserSchema, bootstrap, migration-runner
        auth/     signup, login, sessions, TOTP, argon2, rate-limit
        storage/  worlds, manuscripts(+revisions), chats, snapshots CRUD
        world/    JSON Schema validation, default world factory
        crypto/   envelope encryption (DEK wrap/unwrap, AES-256-GCM)
        ai/       provider adapters (anthropic/openai/bedrock/cloudflare/local), context-assembly, mode-permissions
        routes/   REST endpoints (+ streaming), export
        test/     the required suites
    web/                    Vite + React + TypeScript recreation of the prototype
      src/
        theme/    design tokens (colors, radii, fonts), accent CSS var, keyframes
        components/  Header, SettingsPopover, Navigator(Chapters/WorldTree), WriteView, WorldDetail, StudioChat(Cast, ModePills, ModeConfig, Messages{UserBubble, ProseBubble, SuggestionCard, Thinking}, Composer), Toast
        state/    world/session/chat stores (chat unsaved buffer; manuscript autosave queue with retry)
        api/      typed client (AIClient, StorageClient) — real endpoints, mockable
        formats/  format-driven typography table
        data/     the prototype's seed world (Sweet Nothings) as a real world.json for dev
```

## Build order (mirrors SPEC §Build Order)

1. **Foundation** — `packages/shared` types; server DB layer: pool, `withUserSchema`, bootstrap (runs `000_public.sql`), `010_provision.sql`, **migration runner** (loops `public.users.schema_name`, applies pending idempotent fns, bumps `schema_version`, restartable). CLI: `npm run db:bootstrap`, `db:migrate`.
2. **Auth** — signup (argon2id, provisions schema in one txn per user-supplied `createUser`), login, session cookies (httpOnly/secure, token hashed at rest), optional TOTP (encrypted secret), rate limiting on auth routes.
3. **Storage** — `withUserSchema` CRUD for worlds, manuscripts (+revisions with reasons), chats, snapshots. Bare table names, no prefixes.
4. **World validation** — JSON Schema file + validator invoked on load/save; default-world factory seeded from the prototype's Sweet Nothings data.
5. **Credentials** — envelope encryption module (round-trippable, versioned master key), CRUD, provider adapter interface + 5 implementations.
6. **Context assembly + permissions** — per-mode contextRecipe reader pulling from world JSONB + manuscripts within a token budget (most-important-first truncation); server-side mode-permission gate.
7. **AI endpoints** — one per mode, streaming responses; edit/critique return structured suggestion objects; revision snapshot written BEFORE any AI-applied manuscript change; world snapshot before AI world mutations.
8. **Chat save + distillation** — explicit save persists transcript; cheap-model distillation pass appends memory events, sets `distilled=true`, restartable.
9. **Frontend** — modular React recreation of the prototype (pixel-faithful to tokens/copy), wired to the typed API client; chat stays client-state with a Save Chat button; manuscript autosave queue with retry.
10. **Export** — first-class world.json export (credentialId pointers left dangling, never key material) + full-schema export path (`pg_dump --schema`).

## Key implementation notes
- **DB access safety:** I will NOT run any destructive/DDL command against your remote `DATABASE_URL` without explicit confirmation. Bootstrap/migrate are opt-in CLI commands you run (or approve) yourself. Tests that need a DB skip cleanly when `DATABASE_URL` is unset.
- **AI adapters** are real interfaces but default to a deterministic mock (the prototype's canned replies live behind the same `AIClient` seam) so the app runs end-to-end without provider keys; swapping to real providers is config-only.
- **Frontend fidelity:** exact tokens, fonts (Manrope + Newsreader), the `--accent` CSS variable re-theme, format-driven editor typography, the five modes with their config chips + one-click action buttons, suggestion accept/reject flows, and the `scrollTop = scrollHeight` (not `scrollIntoView`) auto-scroll — all reproduced.
- **`character` chat mode:** your SQL `chats.mode` CHECK includes `'character'`; I'll treat character chat as a discuss-variant carrying `character_id`, consistent with both SPEC and SQL.

## Verification
- `npm run db:bootstrap` then `db:migrate` against a scratch DB you provide → confirm public tables + a provisioned user schema + `schema_version` bump.
- Test suites (run without needing external providers): schema isolation (user A cannot reach user B's tables via any endpoint), migration idempotency + restartability, mode-permission enforcement, encryption round-trip, revision-before-AI-write guarantee.
- `apps/web` dev server → visual diff against the prototype for each view (Write, World-detail, all five chat modes, settings popover, toast, collapsed rail); exercise accept/reject, insert-into-manuscript, format switching, accent re-theme.
- End-to-end smoke with the mock AI adapter, then a single real Anthropic call once a credential is added.

## Decisions (confirmed with user)

### Post-prototype-update decisions (these supersede any older wording above)
1. **One world open at a time** — Switch World swaps it (sequential). One in-memory doc, one writer: **no version check, no merge logic**.
2. **Three-level content model:** world → **named manuscripts** (hold `format`) → **chapters** (prose rows). Diverges from the original `manuscripts(world_id, chapter_id)` SQL; implemented via migration + updated provisioner. Tables: `manuscripts` (id, world_id, name, format, order, ts), `chapters` (id, world_id, manuscript_id, chapter_id, content TEXT, word_count, status, order, ts; UNIQUE(manuscript_id, chapter_id)), `chapter_revisions` (FK chapters).
3. **World persistence explicit only** — Save World + discrete events; chapter prose is the only debounced-autosave writer; chat saves on explicit Save Chat; Switch World flushes pending prose autosave first.
4. **`WorldStore` = two backends** (file solo / Postgres hosting), identical JSON. **Default boot = Postgres**; file backend opt-in via `OREAD_STORAGE=local`.
5. **Delta snapshots** (JSON-Patch + occasional full) for the pre-AI/pre-migration safety net.
6. **New prototype surfaces to build:** header World picker + "+ New world"; left Manuscript picker + "+ New manuscript"; functional "+ New chapter"; empty-world ("Nothing here yet") states; header right-nav reduced to Settings only.

### Original decisions
- **Frontend framework:** React + TypeScript + Vite.
- **AI providers:** all four adapters (Anthropic, OpenAI, Bedrock, Cloudflare) plus `local` are built to genuinely work behind one `ProviderAdapter` interface. A deterministic mock is only a fallback used when no credential is configured, so the app still runs end-to-end before keys are added — it is not the default path.
- **Sequencing:** build all 10 steps in one continuous pass; user reviews the finished repo. (Foundation still built first within that pass, since later steps depend on it.)

## Guardrails during the pass
- No destructive/DDL commands run against the remote `DATABASE_URL` without explicit confirmation; `db:bootstrap`/`db:migrate` are opt-in CLI commands.
- DB-dependent tests skip cleanly when `DATABASE_URL` is unset; the encryption/permission/validation suites run with no DB.
- After the build, a copy of this plan is written to `prototype-and-design/PLAN.md` as requested.
