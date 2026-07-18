# Handoff: OREAD Studio — Connected Writing Workspace

## Overview
OREAD Studio is a single-screen writing application that fuses three things a fiction/long-form writer normally juggles across separate tools:

1. **A navigable world model** (characters, setting, lore, structure, memory) built from a JSON schema.
2. **A writing canvas** with a per-document format selector (Novel, Short Story, Screenplay, Poetry, Chat/RP, Essay).
3. **A character-aware AI "Studio" chat** on the right that is not just a chatbot — it is a co-writing surface with five operating **modes** (Discuss, Co-write, Draft, Edit, Critique), each with its own configuration and its own output contract.

The signature idea is "breaking the fourth wall": the writer can select any character from their cast (or an omniscient Narrator) and talk to them / write with them while composing the manuscript. The AI's behavior changes structurally per mode — from pure conversation (writes nothing) to full drafting, targeted redline edits, and non-destructive critique.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype that demonstrates the intended look, layout, copy, and interaction model. **They are not production code to copy directly.**

The prototype is authored in a small in-house HTML component runtime ("DC" — a `.dc.html` file with an inline template and a `class Component` logic block, loaded via `support.js`). **Do not port that runtime.** The task is to **recreate this design in the target codebase's existing environment** — React, Vue, Svelte, SwiftUI, etc. — using its established component patterns, state management, and styling system. If no environment exists yet, choose the most appropriate modern framework (React + TypeScript is a safe default for a web app of this shape) and implement there.

Read the `.dc.html` for exact values (colors, spacing, copy, mode logic). Treat its `renderVals()` method as the view-model spec and its `state` as the state spec.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and interactions are all specified and intentional. Recreate the UI pixel-accurately using the codebase's own primitives. The one deliberately mocked part is the AI itself: replies are canned (see *State Management → AI integration*). Everything else — layout, states, accept/reject flows, format-driven typography, the settings panel, mode actions — is the real intended product behavior.

---

## Layout (global)

Full-viewport (`100vh`), dark, non-scrolling shell. Vertical flex: a fixed header on top, then a horizontal 3-column body that fills the rest.

```
┌───────────────────────────────────────────────────────────────┐
│ HEADER  ● OREAD  | World name     Switch… · Settings · ⋯        │  ~57px
├──────────────┬──────────────────────────────┬──────────────────┤
│ LEFT NAV     │ CENTER (canvas OR world)     │ RIGHT — Studio   │
│ 290px fixed  │ flex:1, min-width:0          │ 392px fixed      │
│              │                              │ (collapses to    │
│ Manuscript/  │ Writing canvas               │  44px rail)      │
│ World tabs   │  — or —                      │                  │
│ + tree       │ World-node detail editor     │ Character + mode │
│              │                              │ + messages       │
└──────────────┴──────────────────────────────┴──────────────────┘
```

- **Left column:** `width:290px; flex:0 0 auto; border-right:1px solid #1c2020; background:#101313`. Vertical flex, `min-height:0` so its inner list scrolls.
- **Center column:** `flex:1 1 auto; min-width:0; background:#0d0f0f`. Renders EITHER the write view or the world-detail view (never both).
- **Right column:** `width:392px; flex:0 0 auto; border-left:1px solid #1c2020; background:#101313`. Collapsible to a 44px vertical rail.

### Responsive behavior
- Desktop-first; the design targets wide viewports but must not break in the ~900–1100px range.
- **Both column header rows use `flex-wrap:wrap`.** The center write-header's title block is `min-width:180px; flex:1 1 auto`; the Format+word-count group is `flex:0 0 auto` and wraps onto a second line when the center column is narrow. This is required — with both side panels open the center can be ~240px wide and the header must not overlap itself.
- The right chat can be collapsed to reclaim width (toggle button in the chat header; a 44px rail brings it back).

---

## Screens / Views

### 1. Header (persistent)
- **Purpose:** identity + world switching + global actions.
- **Layout:** `space-between`, `padding:16px 26px`, bottom border `#1c2020`.
- **Left cluster:** an 8px accent dot with a glow (`box-shadow:0 0 10px accent`), the wordmark **OREAD** (`font-weight:600; font-size:19px; letter-spacing:0.36em; color:#f3f5f4`), a 1px `#262b2b` divider, then the **World picker** — a button showing the current world name + a `▼` caret.
- **World picker dropdown:** opens below-left, `width:280px`, same surface styling as the settings popover. Uppercase "Worlds" caption, then one row per world (status dot, name, "N manuscript(s)" meta; active row tinted `rgba(46,157,157,0.14)`), then a dashed **"+ New world"** action (accent). Selecting a world loads its first manuscript + first chapter and its format. New world seeds an "Untitled World" with one empty "Untitled Manuscript" / "Chapter One" and switches to it.
- **Right nav:** just the **Settings** button (the earlier "Switch Chat" / "Switch Model" / `⋯` placeholders were removed — chat character and model are chosen in the Studio panel and Session view respectively).
- A full-screen transparent overlay (`z-index:55`) closes any open picker/popover on outside click.

### 1a. Settings popover
- Opens below the Settings button, anchored right. `width:300px; background:#141818; border:1px solid #262b2b; border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,0.55); padding:16px 16px 18px; z-index:60`. Entrance animation `om-up` (see tokens). A full-screen transparent overlay (`position:fixed; inset:0; z-index:55`) closes it on outside click.
- **These are end-user controls (app state), not just build-time config.** Three groups, each with an uppercase label (`11px; letter-spacing:0.14em; #6d7473; 700`):
  - **Accent** — 4 swatches (54×44, `border-radius:9px`), colors below. Active swatch shows a white ✓ and a double ring (`box-shadow:0 0 0 2px #141818, 0 0 0 4px <hex>`).
  - **Prose typeface** — segmented control (Serif / Sans / Monospace) in a `#0f1212` track with `#1c2121` border, `border-radius:10px; padding:4px`. Active segment: `background:accent; color:#04201f`.
  - **Writing format** — a `<select>` mirroring the canvas format selector.

### 2. Left — Navigator
- **Tabs:** "Manuscript" and "World", each `flex:1; padding:8px 10px; border-radius:9px; 13.5px; 600`. Active tab: `background:rgba(46,157,157,0.14); color:accent`. Inactive: transparent, `#6d7473`.
- **Manuscript picker** (top of Manuscript tab): a button card (`#131717; border:1px solid #1e2323; border-radius:10px`) with an uppercase "Manuscript" caption + the current manuscript name + `▼`. Opens a dropdown listing manuscripts in the current world (name + "<format> · N chapters", active tinted) plus a dashed **"+ New manuscript"**. Manuscripts belong to a world; switching manuscripts loads its first chapter + its saved format.
- **Chapters list:** an uppercase "Chapters" caption, then chapter cards. Each card (`padding:12px; border-radius:10px`) shows title (`14.5px; 600`), a right-aligned status chip (`10.5px; uppercase; 600` — "Drafting" is accent-colored, others `#6d7473`), and a meta line ("POV · Name", `12.5px; #6d7473`). Active card: `background:rgba(46,157,157,0.14); border:1px solid #234140`. Inactive: `background:#131717; border:1px solid transparent`. Below the list: a dashed **"+ New chapter"** button that appends an "Untitled Chapter" to the current manuscript and opens it.
- **World tab:** collapsible tree. Six sections (Premise, Setting, Entities, Structure, Memory, Session). Each section header is a button: a rotating `▶` caret (`transform:rotate(90deg)` when expanded, `transition:transform .15s`), an uppercase label (`12.5px; letter-spacing:0.1em; #9aa19f; 600`), and a right-aligned count pill (`#181c1c; border-radius:20px; padding:1px 8px`). Expanded sections list items: a 5px status dot (accent if selected, else `#333a3a`), the label (ellipsis-truncated), and a right-aligned type tag (`10.5px; #4f5655`). Selected item: `background:rgba(46,157,157,0.14)`.
- **Footer:** "All changes saved" (`12px; #5f6664`) + a "Save as World" outline button.

### 3. Center — Write view
- **Header row** (wraps — see Responsive):
  - **Title block:** kicker "Chapter · <status>" (`11px; uppercase; letter-spacing:0.14em; #5f6664; 600`), then doc title in **Newsreader** serif (`23px; 500; #eef0ef`, ellipsis, nowrap).
  - **Right group:** a **Format** `<select>` (`background:#16191a; border:1px solid #262b2b; border-radius:8px; 14px; 600; padding:7px 12px`) with a small uppercase "Format" caption above it; a 1px `#1e2222` divider; a right-aligned word count (`15px; 700; #cfd3d1`) with "words" caption.
- **Editor area:** centered column, `padding:44px 34px 120px`, scrollable. A single full-width `<textarea>` (transparent, borderless, no resize, `min-height:60vh`). **Its typography is driven by the current format + prose-typeface setting** — see *Format-driven typography*.

### 4. Center — World-detail view
Replaces the write view when a world node is selected.
- **Header row** (wraps): a "‹ Manuscript" back button, a `/` separator, breadcrumb text; on the right a "Discuss this →" button (`13px; 600; color:accent; border:1px solid #22403f`) that switches the chat to Discuss mode and auto-asks about the node.
- **Body** (`max-width:820px`, centered):
  - **Node header:** optional 118×118 portrait placeholder (diagonal-hatch background `repeating-linear-gradient(135deg,#171b1b,#171b1b 7px,#141818 7px,#141818 14px); border:1px solid #242929; border-radius:14px`, with the word "portrait"). Then kicker (accent, uppercase), title (**Newsreader** `34px; 500; #f1f3f2`), subtitle (`15px; #8b918f`).
  - **Field groups:** each has an uppercase heading with a bottom border (`#1a1e1e`), then fields. A field = a label (`12.5px; 600; #7d8382`) + one of:
    - **read-only** value box: `#121616; border:1px solid #1c2121; border-radius:10px; padding:12px 14px; white-space:pre-wrap; #c9cdcb`.
    - **editable long**: `<textarea>` (`min-height:88px; resize:vertical`), `#121616; border:1px solid #232929`, focus border → accent.
    - **editable short**: single-line `<input>`, same styling.

### 5. Right — Studio chat
- **Header:** "STUDIO" caption + a collapse chevron. Below: a row of **cast avatars** (38px circles) + the active character's name (`14.5px; 700`) and role (`12px; #6d7473`). Active avatar: `background:accent; color:#04201f; box-shadow:0 0 0 2px #101313, 0 0 0 4px accent`. Inactive: `#1a1f1f; #8b918f; border:1.5px solid #2a3030`.
- **Mode pills:** 5 segments in a `#0f1212` track (`border:1px solid #1c2121; border-radius:11px; padding:4px`). Active: `background:accent; color:#04201f`. Below the pills: a one-line mode hint (`12.5px; #7d8382`), then **mode-config chips** — small `<select>`s in `#141818` pills (`border:1px solid #1e2323; border-radius:8px`) with a grey label and an accent-colored value. The set of chips changes per mode (see *Modes*).
- **Messages** (scrolls, `gap:16px`):
  - **User bubble:** right-aligned, `background:accent; color:#04201f; border-radius:16px 16px 4px 16px; padding:11px 15px; 14.5px; 500`, timestamp beneath.
  - **Assistant prose/plain bubble:** left-aligned. Avatar (22px) + char name + time header. Bubble `background:#1a1f1f; border:1px solid #232929; border-radius:4px 16px 16px 16px; padding:13px 16px; white-space:pre-wrap`. Prose replies use **Newsreader** serif at `15.5px`; plain chat replies use Manrope `14.5px`. Prose bubbles get two action buttons below: **Insert into manuscript** (accent fill) and **Copy** (outline).
  - **Suggestion card** (Edit/Critique output): full-width `background:#14181a; border:1px solid #233332; border-radius:12px`. Header strip (`#111617`, bottom border `#1c2626`) with a type tag (color-coded, see below) + a monospace anchor string (e.g. "Ch 1 · ¶3"). Body: optional struck-through original (**Newsreader** `13.5px; #8b918f; line-through` in `#5a3535`), optional proposed text (**Newsreader** `14.5px; #e6e9e7; border-left:2px solid accent; padding-left:11px`), then an italic rationale (`12.5px; #7d8382`). Footer: **Accept/Apply redline** (accent fill) + **Reject** (outline) while `pending`; once resolved, a status label ("✓ Accepted" in accent, or "Rejected" in grey).
  - **Thinking indicator:** avatar + a bubble with three dots animating via `om-dot`.
- **Composer:**
  - **Mode action button** (present in every mode except Discuss): full-width accent button with an icon + label, and a sub-caption beneath. This is the one-click "just do it" trigger — e.g. Draft shows **"✎ Write the full draft of <chapter>"** with "from outline · ~800 words". Labels/subs are derived from the current mode config (see *Modes*).
  - **Text input:** `<textarea>` (2 rows) in a `#141818` box (`border:1px solid #232929; border-radius:14px`), focus-within border → accent. Footer row: "<char> · <mode>" caption + a **Send** button. Enter sends; Shift+Enter newline. The composer is optional refinement when a mode action exists.

### 6. Toast
Fixed, bottom-center. `background:#1a1f1f; border:1px solid #2a3332; #e9ecea; 13.5px; 500; padding:11px 18px; border-radius:11px; box-shadow:0 12px 40px rgba(0,0,0,0.5)`. Auto-dismiss ~2.2s. Entrance `om-up`.

---

## Modes (the core behavioral spec)

The chat has five modes. Each maps to a config object and an output contract. This mirrors the user's `session.modeConfig` schema.

| Mode | Config chips (key → options) | Output | One-click action button | Action sub-caption |
|---|---|---|---|---|
| **Discuss** | focus → plot-problem / character / research / theme | Plain chat bubble. **Writes nothing.** | *(none)* | — |
| **Co-write** | turn → sentence/paragraph/beat/scene · you are → author/character/director | Prose bubble, insertable | ▸ "Take the next turn" | "<role> hands off · one <turn>" |
| **Draft** | from → outline/beats/priorDraft · length → ~300/~800/~1600/~2200 | Prose bubble, insertable | ✎ "Write the full draft of <chapter>" | "from <material> · <length> words" |
| **Edit** | level → line/structural/developmental · as → redline/diff/clean | **Suggestion card** with original→proposed. Accept = **Apply redline** (appends proposed to manuscript). | ⇄ "Redline my latest lines" | "<level> edit · as <format>" |
| **Critique** | lens → pacing/voice/continuity/argument · depth → margin-notes/full-report | **Suggestion card**, may propose lines but **applies nothing** (Accept just marks accepted). | ◎ "Run the critique" | "<lens> lens · <depth>" |

Suggestion `type` → color coding (tag text / tag background):
- `rewrite`, `voice` → amber `#e0b25a` / `rgba(224,178,90,0.14)`
- `cut`, `flag`, `continuity` → rose `#d1617f` / `rgba(209,97,127,0.14)`
- `expand`, `argument` → green `#6fbf73` / `rgba(111,191,115,0.14)`
- `pacing` → periwinkle `#8a9bf0` / `rgba(138,155,240,0.14)`

Suggestion object shape (matches the user's spec):
```json
{ "id": "sug_014", "target": "ch_002", "anchor": { "start": 1204, "end": 1388 },
  "type": "rewrite|cut|expand|flag|continuity-error",
  "original": "string", "proposed": "string|null",
  "rationale": "one line", "status": "pending|accepted|rejected" }
```

---

## Format-driven typography (canvas editor)
The Format selector changes how the manuscript textarea renders. Prose formats also respect the Settings → prose-typeface choice.

| Format | Font | Size | Line-height | Column width |
|---|---|---|---|---|
| Novel / Short Story / Essay | prose typeface (Serif = Newsreader, Sans = Manrope, Mono = Courier New) | 18.5px | 1.75 | 700px |
| Poetry | prose typeface | 18.5px | 1.75 | 560px |
| Screenplay | Courier New (forced mono) | 16px | 1.7 | 640px |
| Chat / RP | Manrope (forced sans) | 16px | 1.65 | 640px |

Each format also sets a placeholder (e.g. Screenplay → "INT. BEANSTALK COFFEE — MORNING").

---

## Interactions & Behavior
- **Nav tab switch** (Manuscript/World) toggles the left list; selecting a chapter opens it in the write view; selecting a world node opens the detail view.
- **"Discuss this →"** on a world node: sets mode = Discuss and auto-sends "Tell me about <node>." to the active character.
- **Send flow:** push user bubble → show thinking indicator → after ~850ms push the assistant reply (prose bubble or suggestion card depending on mode). Messages auto-scroll to bottom (`requestAnimationFrame`, set `scrollTop = scrollHeight` — do **not** use `scrollIntoView`).
- **Mode action button:** injects the mode's canned prompt as if typed, then runs the Send flow.
- **Insert into manuscript:** appends the prose (with a blank line) to the current doc, returns to write view, toast "Inserted into the manuscript".
- **Accept (Edit):** appends `proposed` to the manuscript, marks card accepted, toast "Applied to the manuscript". **Accept (Critique):** marks accepted only. **Reject:** marks rejected. Resolved cards replace the buttons with a status label.
- **Copy:** `navigator.clipboard.writeText`, toast "Copied".
- **Settings:** accent instantly re-themes via a CSS variable `--accent` on `:root`; typeface + format re-render the editor.
- **Chat collapse:** hides the 392px panel, shows a 44px vertical rail with rotated "STUDIO" text.
- **Working controls:** world/manuscript/chapter switching + creation are all functional. **Placeholder control** remaining: "Save as World" fires a "this control is for show" toast in the prototype — wire to real persistence in production.
- **Hover states:** most buttons lighten text/border on hover; accent-filled buttons use `filter:brightness(1.1–1.12)`.

## State Management
State variables (from the prototype's `state`):
- `navMode`: "outline" | "world" — left tab.
- `view`: "write" | "world" — center view.
- `selectedNode`: string | null — active world node key.
- `currentWorld`: world id; `currentMs`: manuscript id; `currentDoc`: chapter id — the active path through the model.
- `worldPickerOpen`, `msPickerOpen`, `settingsOpen`: dropdown/popover visibility.
- `format`: one of the 6 format keys (mirrors the current manuscript's saved format; `setFormat` writes back to the manuscript).
- `accent`: hex string; `proseTypeface`: "Serif"|"Sans"|"Monospace"; `settingsOpen`: bool.
- `character`: "jamie" | "sam" | "noor" | "narrator".
- `mode`: "discuss" | "cowrite" | "draft" | "edit" | "critique".
- `cfg`: per-mode config object (the chip values above).
- `msgs`: array of message objects (`role`, `kind`, text/suggestion, `status`, `time`).
- `input`, `thinking`, `toast`, `edits` (per-field world edits keyed by node:group:field).
- **Data model** (`this.WORLDS` + `this.worldOrder`): a map of worlds, each `{ name, detail, msOrder, manuscripts }`; each manuscript `{ name, format, order, chapters }`; each chapter `{ title, status, pov, text }`. Chapter text lives on the chapter object (edited in place). `detail:true` marks the fully-authored sample world (Sweet Nothings); newly created worlds start with an empty world model and show "Nothing here yet" empty states in the World tab. In production this is your persisted document store (worlds → manuscripts → chapters + the JSON world model).

### AI integration (the real work in production)
In the prototype, replies are **canned** per mode+character. In production, replace the `replyFor()`/timeout with a real model call behind a **provider abstraction** — the app must support multiple backends selectable by the user (the header "Switch Model" control + Session → Model panel):
- **Anthropic**, **OpenAI**, **Cloudflare AI**, and **AWS Bedrock** as hosted providers.
- **Self-hosted / local Ollama** for users who run the app standalone on their own machine (no external API key required).
- Abstract behind one interface (`generate({provider, model, messages, system, temperature})`) so the mode contracts and prompt assembly are provider-agnostic; only the transport/auth differs per provider. Persist the chosen provider + model in session state.
- Send the world context (canon-first), the selected character's definition/voice, the active mode + config, and the relevant manuscript span.
- **Enforce the mode contract:** Discuss returns conversation only; Draft/Co-write return prose; Edit returns a suggestion with `original`/`proposed` anchored to real char offsets; Critique returns suggestions but the client must never auto-apply them. Enforce server-side for hosted providers; for local Ollama, enforce/parse client-side.
- The `anchor` should be real character offsets (or paragraph IDs) into the target document so Accept can apply a precise splice rather than an append.

## Design Tokens

**Colors**
- Canvas / darkest bg: `#0d0f0f`
- Panel bg: `#101313`
- Elevated surfaces: `#141818`, `#16191a`, `#1a1f1f`
- Field bg: `#121616`, `#0f1212`
- Borders: `#1c2020` (structural), `#232929` / `#262b2b` (controls), `#16191a` / `#1a1e1e` (header rules)
- Text: primary `#e9ecea` / `#eef0ef`; secondary `#aeb4b2` / `#cfd3d1`; muted `#8b918f` / `#7d8382`; faint `#6d7473` / `#5f6664` / `#4f5655`
- **Accent (themeable, default teal): `#2e9d9d`.** Options: teal `#2e9d9d`, amber `#c9922e`, violet `#8a6df0`, rose `#d1617f`. On-accent text: `#04201f`.
- Accent tint (selected rows/tabs): `rgba(46,157,157,0.14)`
- Suggestion accents: amber `#e0b25a`, rose `#d1617f`, green `#6fbf73`, periwinkle `#8a9bf0`

**Typography**
- UI font: **Manrope** (400/500/600/700/800).
- Prose/serif font: **Newsreader** (opsz 6–72, weights 400/500/600, italics).
- Mono: Courier New.
- Common sizes: kicker 11px/uppercase/letter-spacing 0.14em; body 14.5px; titles 19–34px; captions 10.5–12.5px.

**Radius:** 7–8px (chips/segments), 9–11px (buttons/cards), 12–14px (panels/composer), 16px (bubbles, one corner 4px), 50% (avatars/dots).

**Spacing:** panel padding 12–16px; content padding 34px horizontal, 38–44px top; gaps 4–26px.

**Shadows:** popover `0 18px 50px rgba(0,0,0,0.55)`; toast `0 12px 40px rgba(0,0,0,0.5)`; active avatar/swatch double-ring via layered `box-shadow`.

**Animations (keyframes):**
- `om-up`: fade+rise 8px, ~0.16–0.22s ease (popover, toast).
- `om-dot`: typing dots, 1.2s infinite, 0/0.2/0.4s staggered.
- `om-blink`: opacity pulse (available, used for carets/cursors).
- Caret rotate + tab/pill transitions: 0.12–0.15s.

## Assets
- **Fonts:** Google Fonts — Manrope + Newsreader (swap for the codebase's equivalents or self-host).
- **Icons:** none as image assets — the prototype uses text glyphs (▶ ‹ › ✓ ✎ ▸ ⇄ ◎ ···) and CSS shapes. Replace with the codebase's icon set.
- **Portrait placeholder:** pure CSS diagonal-hatch — swap for real character images (`world.character.image`) when available.
- No raster/SVG image files are bundled.

## Files
- `OREAD Studio.dc.html` — the complete prototype (template + logic). Read it for exact values and the full canned copy/data. The `state` block = state spec; `renderVals()` = view-model spec; `replyFor()` = the mock AI to replace.
- `support.js` — the prototype's runtime. **Reference only; do not port.**
