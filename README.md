# BLINKO//OS v2

Single-user, text-only capture and decision-routing system. Telegram is the native input surface; `web/` is a desktop-first PC War Room. Every record is one atomic **capture** routed into six buckets: `idea`, `memory`, `reminder`, `question`, `reference`, `noise`.

Zero LLMs, zero external inference APIs, zero semantic/vector layers. Routing, tagging, scoring, linking suggestions, search, TTL expiry and reminders all run locally in SQLite + TypeScript. Every rule, custom field, extractor template and system parameter lives in SQLite and is editable from the panel.

## Quick start

```sh
cp .env.example .env
# fill BOT_TOKEN and OWNER_TELEGRAM_ID
pnpm install
pnpm dev            # server :3000 + Vite :5173
```

Production: `pnpm build && pnpm start`. Send `/web` to the bot, then open the link or paste the 8-character code into the login gate.

Existing `./data/app.db` databases upgrade automatically on startup: captures, tags, edges, reminders, saved views and auth tokens are preserved; legacy decision heads migrate into custom fields and legacy Jev tables are dropped.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | runtime mode |
| `DB_PATH` | `./data/app.db` | SQLite file (`:memory:` for tests) |
| `PUBLIC_URL` | `http://localhost:3000` | magic-link base and cookie `Secure` decision |
| `OWNER_TIMEZONE` | `Asia/Tehran` | due dates, recurrence, digest time |
| `BOT_TOKEN` / `OWNER_TELEGRAM_ID` | required | single-owner Telegram transport |
| `BOT_MODE` | `polling` | `polling` or `webhook` (+ `WEBHOOK_*`) |
| `SESSION_SECRET` | random in dev | required in production |
| `DEV_AUTH_BYPASS` | off | rejected in production |

The in-app settings table additionally owns `owner_timezone`, `burst_window_sec`, `stub_max_chars`, `stale_days`, `trash_retention_days`, `default_reminder_hours`, `digest_enabled`, `digest_time`, `obsidian_vault`, `obsidian_folder`, and `inline_syntax_enabled`.

## Inline syntax

`i:` / `idea:`, `m:` / `mem:`, `q:`, `r:` / `ref:`, `n:` / `noise:`, `!rem` / `remind` route a note. `++ <text>` appends to the last capture, `^ <text>` links to it, `!pin` pins, `!ttl 15m|2h|3d` sets expiry, and `!every day 8am`, `!every mon,thu 9am`, `!every 6h` schedule recurrence. Custom-field shorthands come from the database: `!L3`, `!act`, `!fals:no`, `!dom:infra`, `@leverage:3`. Unicode hashtags (`#انرژی`, `#work`) work in both scripts.

## Query DSL

`b:idea`, `-b:noise`, `status:active`, `#tag`, `-#tag`, `is:pinned`, `is:triaged`, `is:trash`, `mode:auto`, `has:url|due|links|ttl|fields|tags`, `due:overdue|today|week`, `len<25`, `age>14d`, `leverage>=2`, `domain:infra`, plus bare FTS5 words. Sorts: `relevance`, `recent`, `updated`, `due`, `length`, `field:<name>`. Persian/Arabic spelling variants and digits are normalized for search only; stored content is untouched.

## API

All `/api/*` routes except `/api/health` require the session cookie.

```text
GET/POST /api/captures                 list (q, sort, limit) / create
POST     /api/captures/batch           split a multi-note dump into atomic captures
POST     /api/captures/merge           stitch captures, union tags/fields, repoint edges
GET      /api/captures/:id/related     local FTS5 + tag-overlap suggestions
POST     /api/captures/:id/reminder/action   done|snooze1|snooze4|tomorrow|week|kill
POST     /api/captures/:id/restore     restore from soft trash
DELETE   /api/captures/:id?permanent=true
GET      /api/triage                   inbox, bursts, stubs, stale
GET      /api/agenda
GET/POST/PATCH/DELETE /api/fields|rules|extractors
POST     /api/rules/test|/api/rules/sweep/preview|/api/rules/sweep/run
POST     /api/extract                  compile an extractor template (+ token estimate)
POST     /api/patch/preview|/api/patch/apply   external-AI JSON round trip
GET/PATCH /api/settings
POST     /api/system/maintenance       rebuild_fts|vacuum|empty_trash|run_ttl
POST     /api/import/json              idempotent backup restore
GET      /api/export?format=json|md&includeTrash=true
GET      /api/events                   SSE: capture.*, reminder.updated, telemetry.updated
```

## PC War Room

- `[1] Stream` — Query DSL, dynamic field columns, 1-click extract, bulk actions, burst grouping, soft trash.
- `[2] Agenda & Matrix` — reminder actions with recurrence badges and a draggable 2D field matrix.
- `[3] Triage` — Inbox, Bursts, Stubs, Stale with keyboard flow and AI patch import.
- `[4] Studio` — Rules Engine (builder + simulator + retroactive sweeps), Custom Fields, AI Extractors, System Config & Maintenance.
- `⌘K` search · `⌘M` manual capture · `⌘E` extract.

## Schema highlights

`captures` (with `triaged`, `expires_at`, `expire_action`, `deleted_at`), `captures_fts`, `tags`/`capture_tags`, `telegram_messages`, `capture_edges`, `reminders` (with `recurrence`), `custom_fields`/`capture_fields`, `rules`, `extractor_templates`, `saved_views`, `app_settings`, `auth_tokens`. SQLite WAL, explicit FTS sync, bounded cache/mmap and no model runtime keep RSS low for Raspberry Pi deployments.

## Verification

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
