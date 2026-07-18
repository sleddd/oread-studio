# Oread Studio — Build Specification

You are building **Oread Studio**, a writing application for fiction and
nonfiction authors. Users build "worlds" (JSON documents containing all
settings, entities, structure, and memory for a work), write manuscripts
chapter by chapter, and interact with AI in five distinct modes — including
chatting in-character with any character in the world. A UI prototype is
provided in `prototype-and-design/`; match its structure and fill in what's
missing per this spec.

The architectural decisions below are FINAL. Do not substitute alternatives,
do not suggest shared multi-tenant tables, do not re-litigate. Build what is
specified.

---

## Settled Decisions (authoritative — refine everything below to match)

These were decided in session with the user after the updated prototype landed.
Where they conflict with older wording further down, THESE win.

1. **One world open at a time.** The interface loads exactly one active world;
   "Switch World" tears it down and loads another (sequential, never
   concurrent). One in-memory world doc ⇒ one writer ⇒ **no concurrency, no
   optimistic version check, no merge logic** anywhere.
2. **Three-level content model:** world → **named manuscripts** → **chapters**.
   A world has many named manuscripts (e.g. "The Corner of Sweet & Nothing", a
   Novel); each manuscript has many chapters (the prose). `format` is a
   **per-manuscript** property. This DIVERGES from the original `manuscripts
   (world_id, chapter_id)` SQL and is implemented via migration (see DB section).
3. **World persistence is explicit only.** The world document is written on the
   **Save World** button + discrete events (accept suggestion, AI writeback
   commit) — **never on a keystroke or a timer**. The debounced autosave applies
   to **manuscript/chapter prose only** (a plain TEXT column), which is the only
   frequent writer in the system. Chats persist only on explicit **Save Chat**.
   Switch World must flush any pending prose autosave before loading the new world.
4. **World storage is a `WorldStore` interface with two backends**, both storing
   the identical single JSON world document: a **file** backend
   (`./data/worlds/*.json`, solo/dev) and a **Postgres** schema-per-user backend
   (hosting). **Default boot = Postgres**; the file backend is used only when an
   env var opts in (`OREAD_STORAGE=local`). Export "world.json" stays first-class
   in both.
5. **Snapshots are deltas.** Routine pre-AI `world_snapshots` store a JSON-Patch
   diff from the prior snapshot; a full snapshot is taken occasionally (every N /
   on demand / pre-migration). Restore = full + replay deltas. Keeps history
   cheap; invisible to the user; no data-model change.

---

## Stack

- **Backend:** Node.js (Fastify preferred, Express acceptable). No Python.
- **Database:** PostgreSQL (remote, supplied via `DATABASE_URL`). Schema-per-user isolation.
- **Hosting:** Render web service + Render Postgres. Migrations run in the
  pre-deploy command.
- **Frontend:** Match the provided prototype. Client state management for
  unsaved chat (never sent to server until explicit save).

---

## Database Architecture — SCHEMA-PER-USER (non-negotiable)

Each user gets their own Postgres schema (namespace) containing their own
physical tables. No shared user-data tables. No user_id columns in user
tables — ownership IS the namespace.

**public schema (auth only):**
- `users`: id (uuid), email (unique), name, password_hash (argon2id),
  totp_secret, totp_enabled, schema_name (unique, format 'u_' + uuid hex),
  schema_version (int, for per-user migration tracking), created_at,
  last_login_at
- `sessions`: id, user_id FK, token_hash (store hash, never raw token),
  created_at, expires_at, last_seen_at

**Per-user schema (created at signup via a provisioning function):**
- `credentials`: id, provider (anthropic|openai|bedrock|cloudflare|local),
  label (unique), ciphertext, iv, auth_tag, wrapped_dek, dek_iv,
  master_key_ver, created_at, last_used_at
- `worlds`: id, name, data (JSONB — full world document), schema_version,
  created_at, updated_at. GIN index on data->'world'->'memory'.
- `world_snapshots`: id, world_id FK cascade, data (JSONB), reason
  (manual|pre_ai_write|pre_migration|autosnapshot), created_at
- `manuscripts`: id, world_id FK cascade, name, format
  (novel|short|screenplay|poetry|chat|essay), order (int), created_at,
  updated_at. The named grouping; `format` lives here (per-manuscript).
  *(Reconciled from the original per-chapter `manuscripts` table — see Settled
  Decision #2. Implemented via migration; the provisioner is updated to match.)*
- `chapters`: id, world_id FK cascade, manuscript_id FK cascade, chapter_id
  (text, matches world.structure chapter ids), content (text), word_count,
  status (outline|drafting|revised|final), order (int), timestamps.
  UNIQUE(manuscript_id, chapter_id). This is the autosaving prose (TEXT).
- `chapter_revisions`: id, chapter_id FK cascade (the chapters.id uuid),
  content, word_count, reason (autosave|pre_ai_edit|pre_ai_draft|manual),
  created_at. Pre-AI + autosave revision history.
- `chats`: id, world_id FK cascade, title, mode, character_id (nullable),
  messages (JSONB array), distilled (bool default false), saved_at

**Provisioning:** plpgsql function `provision_user_schema(p_schema)` using
`format(%I)` throughout, called inside the signup transaction. See
`db/sql/` for the authoritative DDL.

**Request pattern:** after session auth, `SET search_path TO "<schema_name>"`
on the checked-out connection (schema_name is server-generated, never user
input); reset search_path to public before releasing to the pool. Route code
queries bare table names — no schema prefixes.

**Migration runner (build this early, it is load-bearing):** migrations are
idempotent plpgsql functions taking a schema name. Runner loops all
public.users.schema_name values, applies pending migrations, bumps each
user's schema_version, is restartable on failure. The provisioning function
must be updated alongside every migration so new signups get current shape.
Runner executes in Render's pre-deploy command.

---

## World Document (JSONB `worlds.data`)

Top-level: `world` containing:
- **identity:** id, name, version, mode (fiction|nonfiction|roleplay|hybrid),
  created, lastModified
- **premise:** logline, synopsis, themes[], genre[], tone, thesis (nonfiction)
- **setting:** lore, timePeriod, locations[] (id, name, description,
  significance, tags), rules[] (id, statement, implications, canBreak)
- **entities:**
  - characters[]: id, name, role, definition{backstory, traits, voice,
    knowledgeSkills, desires, wounds, contradiction}, state{location, status,
    emotionalState, knowledge[], inventory[]}, arc{startingPoint, trajectory,
    endpoint}
  - relationships[]: id, between[2], type, description, tension, history[memRefs]
  - factions[]: id, name, description, goals, members[], tags[]
  - concepts[]: id, name, definition, sources[], relatedConcepts[],
    authorPosition   (nonfiction backbone)
  - sources[]: id, citation, keyClaims[], notes, reliability
- **structure:** chapters[] (id, order, title, status, summary, purpose,
  povCharacter, sceneIds[], wordCount — content lives in manuscripts table,
  NOT here), scenes[] (id, chapterId, location, charactersPresent[], summary,
  beats[], timelinePosition), timeline[] (id, when, event, revealedIn)
- **memory (three layers + decisions):**
  - events[]: id, timestamp, type (plot|character-development|worldbuilding|
    decision|retcon|research-finding), summary (one line), detail, entities[],
    chapterContext, supersedes (retcon pointer — never delete), importance 1–5
  - canon[]: id, fact, establishedBy[], immutable
  - openThreads[]: id, description, plantedIn, mustResolveBy, status
    (open|resolved|abandoned), resolvedIn
  - decisions[]: id, decision, reasoning, date
- **suggestions[]** (Track Changes semantics): id, target, anchor{start,end},
  type (rewrite|cut|expand|flag|continuity-error), original, proposed,
  rationale, status (pending|accepted|rejected), createdIn
- **session:**
  - mode default: cowrite|draft|edit|critique|discuss (character chat is a
    discuss variant with a characterId)
  - modeConfigs keyed BY MODE, each with its own credentialId reference and
    model settings — NEVER raw API keys in the world document, only
    credentialId pointers
  - modeConfig details: cowrite{turnScope, userRole, handoffRule,
    canAdvancePlot, maxTurnLength}, draft{target, fromMaterial, lengthTarget,
    canInventDetails, canAlterCanon:false}, edit{target, editLevel,
    constraints, outputFormat}, critique{target, lenses, depth,
    suggestRewrites}, discuss{focus, mayProposeCanon}
  - memoryWriteback table: cowrite→events; draft→events+chapterStatus;
    edit→decisions-if-structural; critique→nothing; discuss→decisions+
    canon-with-user-confirmation
  - contextRecipes per mode (priority-ordered):
    cowrite: recentScenesVerbatim:2, characterStates:present, openThreads,
      canon, styleNotes
    draft: targetOutlineBeats, canon, adjacentChapterSummaries,
      characterDefinitions:present, styleNotes
    edit: targetTextFull, styleNotes, bannedWords, canon:minimal
    critique: targetTextFull, canon, openThreads, timeline,
      characterStates:present
    discuss: premise, canonSummary, openThreads, recentEvents:high-importance
  - narratorVoice, hardRules[], styleNotes, linguisticFilters{bannedWords,
    bannedPhrases}

Validate world documents against a JSON Schema file on load and save; fail
loudly on malformed documents.

---

## AI Integration

- Providers: Anthropic API, OpenAI, AWS Bedrock, Cloudflare Workers AI.
  Provider adapter interface with one implementation each; all calls
  server-side.
- Per-mode model resolution: session.modeConfigs[mode].credentialId →
  decrypt credential → call provider.
- Context assembly engine: reads the mode's contextRecipe, pulls from world
  JSONB (canon, threads, events by importance, entity states) and
  manuscripts table (target text, recent scenes), assembles the prompt
  within a token budget, most-important-first truncation.
- Mode permissions enforced server-side: critique may not modify text;
  edit may not invent plot; draft may not contradict canon (include canon
  in system prompt with explicit instruction); character chat speaks only
  as that character using definition.voice, and respects state.knowledge —
  the character does not know things not in their knowledge array.
- Suggestions from critique/edit come back as structured objects (the
  suggestions schema above), applied only on user acceptance.
- Chat distillation: when a chat is saved, run a distillation pass (cheap
  model) extracting memory events from the transcript, append to
  world.memory.events, set chats.distilled = true. Restartable.

---

## Credentials & Security

- Envelope encryption: per-user DEK wraps each credential; DEKs wrapped by
  a master key from environment (Render env group). AES-256-GCM. Decrypt
  in memory at request time only; never log, never cache plaintext.
- master_key_ver supports rotation without bulk re-encryption.
- World export must produce a portable world.json with credentialId
  references left as dangling pointers — never embedded key material.
- Sessions: httpOnly secure cookies, token hashed at rest, TOTP optional
  (encrypted secret, same discipline as credentials).
- Rate limiting on auth endpoints. Argon2id for passwords.

---

## Behavior Rules

- **Chats are client-state until explicitly saved.** No autosave of chat.
  No server persistence of unsaved conversation. Save Chat button is in the
  prototype UI.
- **World document persists on explicit action only** (Save World button +
  discrete events) — never on keystroke or timer (Settled Decision #3).
- **Chapter-prose autosave:** debounced 2–3s idle, writes the `chapters.content`
  TEXT column. This is the ONLY autosaving writer. Snapshot to
  `chapter_revisions` BEFORE any AI-applied change (reason pre_ai_edit /
  pre_ai_draft) — these are kept forever. Autosave revisions on a rolling
  interval, pruned after 30 days.
- **World snapshots** before any AI-initiated world mutation and before
  migrations — stored as JSON-Patch **deltas** (+ occasional full), per
  Settled Decision #5.
- **Default storage backend is Postgres**; the file backend
  (`./data/worlds/*.json`) is opt-in via `OREAD_STORAGE=local` (Settled
  Decision #4).
- Client-side write buffering with retry — deploys on Render Postgres are
  zero-downtime, but the autosave queue must survive transient failures.
- Export: per-user full export = their schema (pg_dump --schema) plus
  world.json files; make the world.json export a first-class UI action.

---

## Build Order

1. Postgres bootstrap: public schema, provisioning function, migration
   runner with schema_version tracking
2. Auth: signup (provisions schema in-transaction), login, sessions, TOTP
3. Storage layer: withUserSchema connection pattern, CRUD for worlds,
   manuscripts (+revisions), chats, snapshots
4. World JSON Schema validation
5. Credentials: envelope encryption module, CRUD, provider adapters
6. Context assembly engine + mode permission enforcement
7. AI endpoints per mode, streaming responses, suggestion objects
8. Chat save + distillation pass
9. Frontend wiring to the prototype
10. Export (world.json + full data)

Write tests for: schema isolation (user A cannot reach user B's tables via
any endpoint), migration runner idempotency and restartability, mode
permission enforcement, encryption round-trip, and the revision-before-AI-
write guarantee.
