# BLINKO//OS

Single-user, text-only capture and decision-routing system. Telegram is the native input surface; `web/` is a desktop-first PC War Room. Every record is one atomic **capture** routed into six buckets: `idea`, `memory`, `reminder`, `question`, `reference`, `noise`.

The system has no local inference stack, no vector layer, no decay engine, no second LLM, and no force graph. Search is local SQLite FTS5 through a deterministic Query DSL. The only external model is **TypeSafe Jev via OpenRouter System One** (`typesafe/jev-1.14`).

## Architecture

```text
Telegram text / reactions / inline query ─┐
PC War Room dual-mode capture modal ──────┼─→ deterministic parser ─→ SQLite (WAL) + FTS5
                                          │        │                    │
                                          │        └─ one batched Jev ───┤
                                          │           (auto mode only)  │
                                          └──────────────────────────────┴─→ SSE → PC War Room
```

- **Auto mode:** hashtags, due dates (Asia/Tehran), URL Readability, and bucket prefixes are parsed deterministically. When `jev_mode=auto` and the budget firewall allows it, all active decision heads are evaluated in **one** Jev call. A bucket prefix always wins over Jev's bucket prediction.
- **Manual mode:** zero Jev calls. The user sets content, bucket, status, pin, tags, reminder, URL metadata, every decision head, manual links, raw `meta`, and `createdAt`.
- **Edit anything:** the Inspector can patch every capture field, clear individual decisions, add/remove hydrated edges, re-fetch URL metadata, edit timestamps, and validate raw `meta` JSON.
- **Search:** multi-column FTS5 (`content`, tags, URL title/excerpt) with `bm25` weighting and `<mark>` snippets. No semantic or cosine layer.
- **Auth:** `/web` issues a 60-second single-use magic link and 8-character code. A 30-day `HttpOnly`, `SameSite=Lax` session cookie is used by the panel (`Secure` only over HTTPS).
- **Transport:** Telegram polling or webhook, reminder poller, and SSE live updates.

## Quick start

```sh
cp .env.example .env
# fill BOT_TOKEN, OWNER_TELEGRAM_ID, OPENROUTER_API_KEY
pnpm install
pnpm dev            # server :3000 + Vite :5173
```

Production:

```sh
pnpm build
pnpm start
```

Send `/web` to the bot, then open the link or paste the code into the login gate.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:3000` | Magic-link base and cookie `Secure` decision |
| `OWNER_TIMEZONE` | `Asia/Tehran` | chrono-node + reminder formatting |
| `JEV_MODEL` | `typesafe/jev-1.14` | OpenRouter System One model |
| `JEV_DAILY_CALL_CAP` | `30` | hard call stop |
| `JEV_DAILY_USD_CAP` | `0.25` | hard daily spend stop |
| `JEV_MONTHLY_USD_CAP` | `3.00` | hard monthly spend stop |
| `SESSION_SECRET` | auto in dev | required in production |
| `DEV_AUTH_BYPASS` | off | rejected in production |

## Capture prefixes

`!m` / `!raw` bypass Jev entirely and open a manual capture path. `!rem`, `remind`, `mem:`, `idea:`, `q:`, and `ref:` set bucket hints. `#hashtags`, dates, and URLs are parsed in both modes. URL reads are SSRF-guarded with a 5-second timeout and 500 KB cap.

## Query DSL

Search is deterministic and local:

| Token | Meaning |
| --- | --- |
| `b:idea` / `-b:noise` | include / exclude bucket |
| `status:active` / `-status:archived` | include / exclude status (`all` disables the filter) |
| `#tag` / `-#tag` | include / exclude tag |
| `is:pinned` / `-is:pinned` | pinned filter |
| `mode:auto` / `mode:manual` | capture mode |
| `has:url` / `has:due` / `has:links` | presence filters |
| `due:overdue` / `due:today` / `due:week` | reminder windows |
| `leverage>=2`, `actionable:yes`, `entropy>0.55` | decision filters |
| bare words | FTS5 prefix terms with weighted `bm25` ranking |

Example: `b:idea leverage>=2 #work -#draft`.

## PC War Room

- `[1] Stream` — query bar, saved views, sort by any active head, real hydrated columns, shift-click multi-select, bulk actions, and `j/k`, `space`, `p`, `r`, `x`, `e` keys.
- `[2] Agenda & Matrix` — overdue/today/upcoming/snoozed reminders and a static 2D SVG decision matrix. No physics simulation.
- `[3] Review` — uncertain Jev decisions and unclassified captures, with `1–6` bucket hotkeys and immediate queue advancement.
- `[4] Jev Lab` — auto/off firewall, head studio with full config, targeted sweeps with token-based USD previews, and a pure Jev playground.
- `⌘K` — command palette. `⌘M` — manual capture. The right Inspector is ~420px and edits every field.

## API

All `/api/*` routes except `/api/health` require the session cookie (or non-production `DEV_AUTH_BYPASS`).

```text
GET    /api/health                         public
GET    /api/events                         SSE: connected, capture.*, edge.updated, reminder.updated, telemetry.updated, sweep.progress
GET    /api/captures                       q, bucket, status, tag, sort, order, limit, offset
POST   /api/captures                       { mode: 'auto' | 'manual', ... }
POST   /api/captures/bulk                  ids + bucket/status/isPinned/addTags/removeTags/delete/runJev
GET    /api/captures/:id                   hydrated detail with edges and reminder
PATCH  /api/captures/:id                   edit literally any field
DELETE /api/captures/:id
POST   /api/captures/:id/override
DELETE /api/captures/:id/decisions/:headId
POST   /api/captures/:id/jev               optional { headIds }
POST   /api/captures/:id/fetch-url
POST   /api/captures/:id/edges             DELETE with the same body
GET    /api/review
GET    /api/agenda
GET/POST/PATCH/DELETE /api/heads
POST   /api/heads/:id/sweep/preview|run
POST   /api/heads/test
GET/POST/PATCH/DELETE /api/views
GET    /api/telemetry
PATCH  /api/settings                       only { jev_mode: 'auto' | 'off' }
GET    /api/export?format=json|md
```

## Schema highlights

`captures`, `captures_fts` (multi-column FTS5, service-layer sync), `tags`/`capture_tags`, `telegram_messages`, `capture_edges`, `reminders`, `decision_heads`, `capture_decisions` (one authoritative row per capture/head), `jev_usage`, `saved_views`, `app_settings`, `auth_tokens`. The four seeded heads are `bucket` (choice), `leverage` (score 0–3), `actionable` (noul), and `falsifiable` (noul). The default saved views are `High Leverage`, `Actionable Open`, and `Unread Links`.

## Verification

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
