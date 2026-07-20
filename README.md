<div align="center">

# Oread Studio

**A connected home for the story only you can write.**

Oread is a writing studio where your world and your words live in one place — and
where an AI collaborator who actually *knows your book* sits beside you as you
write. Not a blank box with a chatbot bolted on. A studio that remembers your
characters, protects your canon, and never puts a word on the page you didn't
choose.

*For novelists, screenwriters, poets, essayists, worldbuilders, and roleplayers.*

</div>

---

<img width="1365" height="716" alt="Screenshot 2026-07-17 at 10 56 11 PM" src="https://github.com/user-attachments/assets/2c2da630-fca9-4ca9-932c-98f7a4872dfa" />
<img width="1391" height="736" alt="Screenshot 2026-07-17 at 10 55 50 PM" src="https://github.com/user-attachments/assets/7ec0dffd-b965-40e9-a2ff-76ef08008c54" />

---

## Why Oread

Most AI writing tools forget everything the moment you close the tab, invent
plot you never agreed to, and overwrite your voice with theirs. Oread is built
on the opposite instincts:

- **It remembers.** Every world holds your premise, setting, characters,
  structure, and the running memory of what you've decided — so the AI answers
  from *your* story, not a generic one.
- **You stay the author.** Nothing reaches your manuscript unless you accept it.
  The AI proposes; you dispose.
- **Your canon is law.** Established facts are treated as immutable truth. The AI
  is told, on every request, not to contradict them.
- **Your work is yours.** Your world exports as a single clean file you can keep,
  move, or walk away with. No lock-in.

## What you can do

**Build a world.** Give your story a home: its premise and themes, the setting
and its rules, a full cast of characters (with backstories, voices, wants, and
wounds), your chapter structure, and a living memory of every decision you've
made. It's the series bible you always meant to keep — except this one talks
back.

**Write, chapter by chapter.** A clean, focused editor that dresses itself for
the job — novel, short story, screenplay, poetry, essay, or chat/RP — each with
its own typography and rhythm. Your prose autosaves as you type, and **Save
Draft** commits it the instant you want the reassurance.

**Work with AI in five modes** — each with a clear contract about what it's
allowed to do:

| Mode | What it does |
|---|---|
| **Discuss** | Talk it through with character. Nothing gets written — pure thinking partner. |
| **Co-write** | Trade turns inside a scene. Insert what lands, ignore what doesn't. |
| **Draft** | A full pass from your outline. Review, then insert. |
| **Edit** | Rewrites your text as redlines. Accept or reject each one. |
| **Critique** | Margin notes and proposed lines. Applies *nothing* — safe to ask anything. |

**Chat in character.** Talk to anyone in your cast, in their own voice — and
they only know what your story says they know. Ask your antagonist why she did
it. Interview your narrator. Pressure-test a character before you commit them to
the page.

**Let the AI do research.** In Discuss and Draft, flip on **Research** and the AI
can look up real places, history, and science on the live web to ground a scene
or a nonfiction argument — and it cites its sources.

**Never lose a version.** Before the AI changes a single line of your prose,
Oread quietly snapshots what was there. You can always see what came before.

## Your words stay yours

- **Explicit saves, no surprises.** Your world saves when you say *Save World*.
  Chats are yours to keep or discard — nothing is stored until you *Save Chat*.
- **Private by design.** Each writer's work lives in its own isolated space in
  the database — no shared tables, no mixing.
- **Encrypted keys.** If you bring your own AI provider key, it's encrypted at
  rest and never written into your world file — only a private pointer is.
- **Take it with you.** Export any world as a single JSON file, anytime.

## Bring your own AI (or none)

Oread works with the AI you choose — Anthropic (Claude), OpenAI, Amazon Bedrock,
Cloudflare, or a local model via Ollama. Add a provider key once, pick a model
for your world, and you're writing. No key yet? The studio still runs end to end
so you can explore before you commit.

---

<details>
<summary><strong>For developers</strong> — architecture, setup, and contributing</summary>

<br>

A connected writing workspace for fiction and nonfiction authors. Build "worlds"
(a single JSON document holding premise, setting, entities, structure, and
memory), write manuscripts chapter-by-chapter, and work with AI in five modes —
including chatting in-character with any character in the cast.

See [SPEC.md](SPEC.md) for the authoritative build spec and its **Settled
Decisions**, and [prototype-and-design/](prototype-and-design/) for the design
source of truth.

### Monorepo layout

```
packages/shared     TS types + world JSON Schema + format specs (shared by server & web)
apps/server         Fastify + node-postgres — auth, storage, credentials, AI, export
apps/web            Vite + React + TS — the workspace UI (modular, not a monolith)
db/sql              Public schema, provisioner (3-level model), migration functions
```

### Architecture highlights

- **Schema-per-user Postgres isolation.** `public` holds only `users` +
  `sessions`; every user gets their own namespace of tables, created by
  `provision_user_schema()` inside the signup transaction. Requests run via
  `withUserSchema` (sets/resets `search_path`; validates the schema name).
- **Content model:** world → named **manuscripts** (hold `format`) → **chapters**
  (the prose). One world open at a time.
- **Save cadence:** the world persists only on explicit **Save World** (+ discrete
  events); chapter prose is the only debounced-autosave writer (also flushable via
  **Save Draft**); chats save only on **Save Chat**.
- **Storage backends:** one `WorldStore` interface, two impls — Postgres (default)
  and file (`OREAD_STORAGE=local`). Identical JSON document either way.
- **Envelope encryption** (AES-256-GCM) for provider credentials + TOTP secrets;
  master-key versioning for rotation.
- **AI:** provider adapters for Anthropic, OpenAI, Cloudflare, Bedrock, and local
  (Ollama), behind one interface; per-mode context assembly with a token budget;
  server-side mode-contract enforcement; native web search in Discuss/Draft; a
  deterministic mock fallback when no credential is configured.
- **Snapshots** are JSON-Patch deltas (+ occasional full). A **revision snapshot is
  taken before any AI-applied change** to prose.

### Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, MASTER_KEY_V1, SESSION_SECRET
```

Generate secrets:

```bash
openssl rand -base64 32   # MASTER_KEY_V1
openssl rand -base64 48   # SESSION_SECRET
```

Optional: `SIGNUP_WHITELIST=a@x.com,b@y.com` restricts who can register (leave
unset for open signup).

### Database

`db:bootstrap` / `db:migrate` are the ONLY commands that run DDL — they are
opt-in and never run implicitly.

```bash
npm run db:bootstrap      # install public schema + provisioner + migration fns
npm run db:migrate        # apply pending migrations across all user schemas (idempotent, restartable)
```

The migration runner loops `public.users.schema_name`, applies each pending
idempotent plpgsql migration in its own transaction, bumps `schema_version`,
and is restartable. Run it in Render's pre-deploy command.

### Develop

```bash
npm run dev:server        # Fastify on :8080
npm run dev:web           # Vite on :5173 (proxies /api → :8080)
```

### Test

```bash
npm test                  # all workspaces
```

DB-integration tests (schema isolation, migration idempotency/restartability)
**skip** when `DATABASE_URL` is unset. To run them against a scratch database:

```bash
DATABASE_URL=postgres://… npm --workspace @oread/server test
```

### Storage modes

- Default: **Postgres** (schema-per-user).
- `OREAD_STORAGE=local`: worlds live as `./data/worlds/<id>/world.json` — one
  cat-able file per world, for single-user / offline use. (Auth still uses
  Postgres.)

</details>

Copyright 2025/2026 Claudette Raynor. This software is provided for non-commercial, personal, and educational use only.
