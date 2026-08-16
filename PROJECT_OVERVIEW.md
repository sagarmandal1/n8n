# WaFastAPI — Project Overview & Local Status

_Last updated: 2026-08-15_

---

## 1. What this project is

A **WhatsApp automation platform for Bangladeshi government-document services** —
birth registration, NID, e-TIN, trade licence and similar. It is built on
**WhatsApp Web via Baileys**, not the Meta WhatsApp Cloud API.

Two things run side by side:

| Part | Role |
|---|---|
| `whatsapp-api/` | Node.js + Express + MongoDB. Owns the WhatsApp session, stores every message, runs OCR, matches documents to orders, and exposes the dashboard and REST API. |
| `n8n/` | Dockerised n8n + PostgreSQL. Owns the automation workflows, the AI customer agent, and per-customer chat memory. |

### The business flow

```
customer orders a service on WhatsApp
        │
        ▼
task goes to a seller chat / seller group
        │
        ▼
seller replies with the finished document (image or PDF)
        │
        ▼
OCR extracts the text  ──►  matched against pending orders
        │
        ├─ exactly one clear match ──► deliver the file to that customer
        └─ no match / ambiguous ────► human review queue, never auto-delivered
```

### The safety rule that governs everything

A document is only auto-delivered when **at least two independent fields**
agree — name, date of birth, application ID, birth-registration number,
father's or mother's name, address — or when a PDF filename carries a verified
application number. One clear match delivers. No match, ambiguity, or a tie in
match score sends it to review with a `DELIVERED` / `NO_MATCH` / `AMBIGUOUS`
audit record. **Delivering a document to the wrong customer is the worst
possible outcome**, so every ambiguous case is designed to fail closed.

---

## 2. Architecture

```
WhatsApp phone
      │  Baileys socket
      ▼
whatsapp-api (:3002) ──────► MongoDB      messages, sessions, orders, audits
      │                                    (saved BEFORE any processing)
      │  webhook, HMAC-signed
      ▼
cloudflared tunnel (HTTPS) ──► n8n (:5678)
      │
      ├─► "WhatsApp Express - n8n Auto Reply"   ingestion + reply
      │        │
      │        ├─► DeepSeek agent workflow      AI reply generation
      │        ├─► PostgreSQL                   per-customer chat memory
      │        └─► back to whatsapp-api         send the reply
      │
      └─► "DeepSeek Advanced Customer Agent"    intents, personas, entities
```

**Why the tunnel exists.** `lib/webhookSecurity.js` refuses any webhook URL that
is not public HTTPS, and rejects every private IP and `localhost`. That is
deliberate SSRF protection. Locally it means n8n needs a public HTTPS address,
which cloudflared provides.

### Key subsystems in `whatsapp-api/`

- **`lib/whatsapp.js`** (~1400 lines) — Baileys socket lifecycle, reconnects,
  inbound message handling, LID resolution, auto-reply hooks.
- **`lib/signcopy/`** — the OCR and voice pipeline. `local_ocr.py` (Pillow +
  numpy preprocessing, then Tesseract `eng+ben`), `local_voice.py`
  (Faster-Whisper, fully local — no external transcription API).
- **`lib/dynamicOrderDelivery.js`** — order parsing and the two-field matching
  and scoring rules.
- **`lib/webhookDispatcher.js`** — signed webhook delivery with retry and a
  `WebhookDelivery` audit record per event.
- **27 Mongoose models** — it is a multi-tenant SaaS: users, subscriptions,
  coupons, recharges, bKash payments, transactions, audit logs.

---

## 3. Current local status

**The auto-reply loop is working end to end.** A real WhatsApp message produces
a real AI-generated Bangla reply.

| Metric | Value |
|---|---|
| WhatsApp session | `CONNECTED` |
| Messages | 15 sent / 18 received |
| Webhook deliveries | 33, all `delivered` |
| n8n executions | 45 (43 successful) |
| Chat memory rows | 28 |
| Agent services configured | 7 |
| Dynamic orders | 2 |
| Agent audits | 15 |

Verified sample reply, generated live:

> ঢাকা সিটিতে নতুন জন্ম নিবন্ধন ১ দিনেই করা যায়। খরচ জন্মসালের ওপর নির্ভর করে,
> তাই শিশুর নাম ও জন্ম তারিখ জানালে সঠিক ফি এবং প্রয়োজনীয় কাগজপত্র জানিয়ে দিতে পারব।

Configured services: `DHAKA_NEW_BIRTH`, `DHAKA_BIRTH_CORRECTION`,
`CTG_NEW_BIRTH`, `CTG_BIRTH_CORRECTION`, `NID`, `ETIN`, `TRADE_LICENSE`.

### Workflow state

| Workflow | Active | Note |
|---|---|---|
| WhatsApp Express - n8n Auto Reply | ✅ | ingestion + reply |
| DeepSeek Advanced Customer Agent | ✅ | AI replies |
| Smart Seller-to-Customer Auto Dispatcher | ❌ | archived in production, keep off |

> ⚠️ **Auto-reply is ON with no whitelist.** The linked account replies
> automatically to anyone who messages it. To stop instantly, set
> `autoReplyEnabled: false` in the `Check Reply Mode` node and save — it takes
> effect immediately, no restart needed.

---

## 4. Bugs found and fixed

All are **local edits only** and are **not yet in production**. Several would
affect production identically.

### Application code

| # | File | Defect | Impact |
|---|---|---|---|
| 1 | `lib/whatsapp.js:374` | Reconnect timer never checked whether the session still existed | A deleted session respawned its socket **forever**; one immortal loop per delete, surviving until restart |
| 2 | `views/sessions.html` | QR fetched once, never refreshed | QR expires after ~20s, so scanning silently failed with a `408`; now refreshes every 15s |
| 3 | `lib/whatsapp.js:216` | No `keepAliveIntervalMs`, no `defaultQueryTimeoutMs` | An idle socket made sends block for the full 60s default — one measured at **60,476 ms** |
| 4 | `lib/signcopy/local_ocr.py:88` | **Python syntax error** (16-space indent) | The file could not be parsed. **Image OCR had never worked at all** |
| 5 | `lib/signcopy/local_ocr.py` | Losing OCR variants appended unless byte-identical | Each misreading survived as a separate "fact" — one date became four conflicting dates |
| 6 | `lib/signcopy/documentProcessor.js:42` | `pdftoppm` had no `-r`, defaulting to 150 dpi | Digit misreads; 300 dpi is correct, now pinned |
| 7 | `lib/signcopy/local_ocr.py` | 2400 px cap downscaled the 300-dpi page right back | Undid fix #6; cap raised to 3500 |
| 8 | `lib/signcopy/local_ocr.py` | No **unprocessed** image was ever an OCR candidate | All variants were tuned for photos of monitors, degrading clean scans; a `plain` variant now runs first |
| 9 | `lib/whatsapp.js` | LID senders unresolvable when `remoteJidAlt`/`participantAlt` absent | Modern WhatsApp addresses chats by **LID**, not phone. Sender stayed a bare LID, so the agent refused to answer, memory bucketed under a non-phone id, and order matching by `customerPhone` could never hit. Now falls back to Baileys' `signalRepository.lidMapping.getPNForLID()` with backfill |

### n8n workflow (`WhatsApp Express - n8n Auto Reply`)

| # | Defect | Impact |
|---|---|---|
| 10 | `Auto Reply Enabled?` had **v1 parameters under `typeVersion: 2`** | The node could not read its own condition and always took the false branch |
| 11 | **Both** IF branches pointed at `Prepare Received Learning Memory`; `Call DeepSeek Agent` was **orphaned** | The reply chain existed but was unreachable — as shipped, this workflow **could never reply**, whatever the flag said |
| 12 | `Check Reply Mode` **replaced** the item payload instead of merging | `customer_id`, `message` and media fields were discarded, so the agent received an empty `customer_id` and answered with its `missing_customer_id` guard |

### Missing database migration

`deepseek_customer_chat_memory` **did not exist**. The workflow writes with a raw
parameterised `INSERT`, not n8n's chat-memory node, so nothing auto-creates it —
the first executions failed with `relation … does not exist`. Any fresh
environment needs it:

```sql
CREATE TABLE IF NOT EXISTS deepseek_customer_chat_memory (
  id         SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  message    JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dccm_session_recent
  ON deepseek_customer_chat_memory (session_id, id DESC);
```

---

## 5. Known issues and risks

**OCR digit accuracy.** On a clean 200-dpi render the date `1994-03-11` was read
as `-63-`, `-93-`, `-83-` and `-@3-`. After the DPI and downscale fixes the same
page reads perfectly, but **real screen photos remain noisy** — a genuine birth
certificate photo produced heavily garbled output (`liza RY`, `Op pees 18]`)
while reading the letterhead correctly. Alphanumeric IDs survived every failure
mode; dates broke under all of them. **Weight application and birth-registration
numbers above OCR'd dates** in the two-field rule.

**Local machine is the production path.** Closing the laptop, sleeping it, or
stopping `node server.js` takes the bot offline mid-conversation.

**The tunnel URL is ephemeral.** A `trycloudflare.com` URL is tied to one
process. If cloudflared restarts you get a **new** URL and `session.webhookUrl`
still points at the dead one — ingestion breaks silently.

**The SaaS paywall blocks new users.** Session creation returns
`403 No active subscription` unless the user has a plan. There is no local
payment gateway, so plans must be granted directly in Mongo.

**Voice notes are not usable yet.** `.venv-voice` is missing, so Faster-Whisper
transcription will fail.

---

## 6. Running it locally

### Prerequisites

```bash
brew install poppler tesseract-lang numpy cloudflared
```

Node 24+, Docker Desktop, and Python 3 with Pillow and numpy.

### Start

```bash
# 1. infrastructure — always pass BOTH compose files
cd n8n
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

# 2. API
cd ../whatsapp-api
node server.js > /tmp/wa-api.log 2>&1 &

# 3. public HTTPS for n8n (must be 5678, not 3002)
nohup cloudflared tunnel --url http://localhost:5678 > /tmp/cloudflared.log 2>&1 &
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log | head -1
```

Then set `session.webhookUrl` to `https://<tunnel>/webhook/whatsapp-express-events`.

The local compose overlay exists because the production file forces
`N8N_PROTOCOL: https`, whose secure-only cookie breaks login over plain
`http://localhost`. The overlay also adds MongoDB and leaves Postgres
unpublished to avoid a port clash.

### Useful checks

```bash
# session + message state
docker exec n8n-mongo-1 mongosh --quiet --eval \
  'db=db.getSiblingDB("wa-api"); db.sessions.find({},{status:1,webhookUrl:1}).forEach(printjson)'

# n8n executions
docker compose -f docker-compose.yml -f docker-compose.local.yml \
  exec -T postgres psql -U n8n -d n8n -c "select id,status from execution_entity order by id desc limit 5;"

# no workflow points at production
docker compose -f docker-compose.yml -f docker-compose.local.yml \
  exec -T postgres psql -U n8n -d n8n -t -c \
  "select name,(nodes::text like '%wafastapi.com%') from workflow_entity;"   -- all must be f
```

### Stop

```bash
pkill -f 'node server.js'
pkill -f 'cloudflared tunnel'
cd n8n && docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

---

## 7. Not yet verified

- **Document matching end to end.** `agentaudits` is populating, but a seller
  document has not been traced through OCR → match → delivery to a customer.
- **Ambiguous and no-match handling.** The most safety-critical paths have not
  been exercised with real data.
- **Voice notes.** Blocked on `.venv-voice`.
- **Nothing is in production.** All twelve fixes are local edits.

### Security reminders

Never commit or share `.env`, API keys, webhook secrets, WhatsApp session files,
database dumps, or customer media. Customer documents contain NID, e-TIN and
birth-registration numbers. Keep the media directory protected and always use
HTTPS on public endpoints.
