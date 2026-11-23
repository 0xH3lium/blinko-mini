# BLINKO//OS

Single-user, text-only epistemic capture and decision-routing system. Telegram is the native input surface; `web/` is a desktop-first PC War Room. Every record is one atomic **capture** routed into six buckets: `idea`, `memory`, `reminder`, `question`, `reference`, `noise`.

No images. No voice. No notes-vs-blinks split. No Mini App. No media storage. Hard 400 MB container RAM ceiling.

## Architecture

```text
Telegram text / reactions / inline query
        │
        ▼
Layer 0 deterministic  ── hashtags, chrono-node (Asia/Tehran), URL Readability (SSRF-guarded), SimHash, 12 lexical features
        │
Layer 1 local probes   ── concurrency-1 q8 ONNX MiniLM embeddings + online logistic / ridge probes + kNN cold start
        │
Layer 2 Jev            ── OpenRouter System One, batched heads, daily/monthly USD + call firewall
        │
        ▼
SQLite (WAL) + RAM VectorIndex + SSE events → PC War Room
```

- **Emissions:** confident captures get one native emoji reaction. High-entropy routing gets inline bucket buttons. Collisions get paradox controls. Reminders get due-time cards.
- **Physics:** `E(t) = E × exp(-λ × days)`; `λ` comes from the `half_life` head. Pinned, memory, and paradox-locked captures are immune. Hourly sublimation below `sublimate_energy`.
- **Cost:** `gated` mode spends $0 until a probe is cold/uncertain or the `0.68..0.91` cosine collision band fires. `bootstrap` collects labels then auto-flips to gated. `off` is strict local-only.
- **Auth:** `/web` in Telegram issues a 60-second single-use magic link and 8-character code. The panel gets an `HttpOnly`, `SameSite=Lax`, 30-day session cookie (`Secure` only when `PUBLIC_URL` is HTTPS).

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

Docker (400 MB limit, Node heap capped at 220 MB):

```sh
docker compose up -d --build
```

Send `/web` to the bot, then open the link or paste the code into the login gate.

## Environment

See [`.env.example`](./.env.example). Important defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:3000` | Magic-link base and cookie `Secure` decision |
| `OWNER_TIMEZONE` | `Asia/Tehran` | chrono-node + reminder formatting |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | q8 384-d ONNX model cached in `./data/models` |
| `JEV_MODEL` | `jev-1.13` | OpenRouter routes to `typesafe/jev-1.13` |
| `JEV_DAILY_CALL_CAP` | `30` | hard call stop |
| `JEV_DAILY_USD_CAP` | `0.25` | hard daily spend stop |
| `JEV_MONTHLY_USD_CAP` | `3.00` | hard monthly spend stop |
| `SESSION_SECRET` | auto in dev | required in production |
| `DEV_AUTH_BYPASS` | off | rejected in production |

## Bot protocol

- Plain text → capture. Prefixes: `!rem`, `remind`, `mem:`, `idea:`.
- `#hashtags` and URLs are extracted; URLs are fetched with a 5s timeout, 500 KB cap, and private-address rejection, then parsed with Readability.
- Reactions: `📌` pin, `🔥` boost, `✅` resolve, `👎`/`💩` delete, `⚡` force Jev.
- Commands: `/start`, `/help`, `/web`, `/remind`, `/collide`, `/budget`, `/jevmode`, `/heads`.
- Inline recall: `@yourbot <query>` searches FTS5 + cosine and returns citable captures.
- Edits sync content, embedding, and the parsed reminder.

## PC War Room

- `[1] Stream` — dense keyboard-driven table (`j/k`, `space`, `p`, `r`, `x`, `e`).
- `[2] Topology` — Canvas2D `d3-force` graph, energy radius, pulsing paradox edges, heatmap by bucket or any head, decay simulation.
- `[3] Triage` — uncertain / paradox / zombie / expiring arena; `1–6` reclassifies and trains the bucket probe.
- `[4] Jev Lab` — mode, thresholds, head CRUD, cost-previewed targeted sweeps, local-vs-Jev playground, RAM/cost/distillation telemetry.
- `⌘K` / `/` — hybrid search + actions. Right Inspector has markdown rendering, decision probability bars, one-click human overrides (weight 2.5), edges, reminder and raw physics.

## API

All `/api/*` routes except `/api/health` require the session cookie (or non-production `DEV_AUTH_BYPASS`).

```text
GET    /api/health
GET    /api/events                 SSE: capture.created/updated/deleted, edge.created, reminder.updated, telemetry.updated, sweep.progress
GET    /api/captures               bucket, status, tag, q, paradoxOnly, minResonance, minEnergy/maxEnergy, headFilters, sort, limit, offset
POST   /api/captures               same pipeline as Telegram
GET    /api/captures/:id           detail + decisions + edges + reminder + effective energy
PATCH  /api/captures/:id           content, bucket, status, pin, tags, reminderDueAt
DELETE /api/captures/:id
POST   /api/captures/:id/override  human decision, trains Layer-1
POST   /api/captures/:id/jev       force fresh Jev pass
GET    /api/triage
GET    /api/graph
GET    /api/heads                  POST /api/heads, PATCH/DELETE /api/heads/:id
POST   /api/heads/:id/sweep/preview|run
POST   /api/heads/test
GET    /api/telemetry
PATCH  /api/settings
```

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm ram-check     # real q8 ONNX, 30 sentences, SQLite, prints RSS
```

The RAM check passes at roughly **130–150 MB RSS**, leaving headroom under the 400 MB container ceiling and the 320 MB verification gate.

## Schema highlights

`captures`, `captures_fts` (FTS5 + sync triggers), `tags`/`capture_tags`, `telegram_messages`, `capture_edges`, `reminders`, `decision_heads`, `capture_decisions`, `jev_usage`, `app_settings`, `auth_tokens`. Four system heads are seeded idempotently: `bucket` (choice), `leverage` (score 0–3), `half_life` (score 0–3), `falsifiable` (noul).
