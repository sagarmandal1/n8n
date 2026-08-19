# WaFastAPI — Project Details

WhatsApp automation for Bangladeshi government-document services: birth
registration, NID, e-TIN and trade licence.

A customer sends their details over WhatsApp. The office forwards the job to a
vendor. The vendor returns a finished certificate. The system reads that file,
works out whose it is, and sends it to that person — without a human deciding
each time.

The whole design follows from one asymmetry: **a file in the review queue costs
someone two minutes; a file sent to the wrong person exposes a stranger's
national ID number and cannot be recalled.** Every rule below resolves in favour
of the first outcome.

---

## 1. Runtime architecture

| Process | Runs as | Port | Purpose |
|---|---|---|---|
| `whatsapp-api` | PM2 (Node 24) | 3012 | WhatsApp session, OCR orchestration, matching, delivery |
| `wafastapi-easyocr` | PM2 (Python) | 4014 | Bangla + English EasyOCR fallback service |
| voice transcription | PM2 (Python) | 4012 | Faster-Whisper for voice notes |
| captcha/OCR helper | Python | 4004 | Second-opinion OCR for images |
| `n8n` + PostgreSQL | Docker Compose | 5678 | Workflows, DeepSeek AI agent, chat memory |
| MongoDB | systemd | 27017 | All application data |

WhatsApp is reached through **Baileys** (`@whiskeysockets/baileys` 7.0.0-rc.9) —
the WhatsApp Web protocol, not the Meta Cloud API. There is no per-message fee
and no template approval, but the account is a real linked device: it can be
logged out, and session state in `sessions/` must survive every deploy.

Production VPS: `/root/n8n` (git repo root), `/root/n8n/whatsapp-api` (app).

---

## 2. Repository layout

```
whatsapp-api/
├── server.js                     Express app, route registration, cron startup
├── lib/
│   ├── whatsapp.js               message intake, scope gate, delivery chain
│   ├── dynamicOrderDelivery.js   order parsing, normalisation, match cascade
│   ├── vendorList.js             per-tenant vendor registry
│   ├── webhookSecurity.js        SSRF protection for outbound webhooks
│   └── signcopy/
│       ├── documentProcessor.js  image/PDF/audio extraction orchestration
│       ├── local_ocr.py          multi-variant Tesseract engine
│       ├── easyocr_service.py    EasyOCR FastAPI service
│       └── googleLensOcr.js      Google Lens OCR (test route only)
├── models/                       28 Mongoose models
├── controllers/                  13 controllers
├── routers/                      15 routers
├── views/                        dashboard HTML
└── tests/                        node --test suites
```

---

## 3. The workflow

```
customer ──1──▶ CEO ──2──▶ vendor ──3──▶ CEO / vendor group ──4──▶ customer
                                                     │
                                                     └──▶ review group
```

1. **Customer sends details** — text, photo, screenshot, PDF or voice note. OCR
   extracts the fields; an order is written to MongoDB.
2. **CEO forwards to a vendor.** The forward records `assignedVendor` on the
   matching order, so the returned file can be resolved by assignment rather
   than by content alone. This is what keeps deliveries correct once hundreds of
   customers share common names.
3. **Vendor returns the finished file** — in the CEO's direct chat or the
   configured vendor group. Both behave identically.
4. **The system matches and delivers**, or routes the file to the review group
   with a reason.

### Scope

Only this workflow is automated. In scope: **any direct chat**, and the **one
vendor group configured on the session**. Every other group is ignored before
OCR runs — no extraction, no matching, no delivery, no duplicate check, no
review-group copy.

The check runs before OCR rather than at the delivery gate for a specific
reason: an unmatched file gets *forwarded* to the review group, so a lax scope
would not merely waste OCR — it would copy documents out of one chat and into
another.

> With no vendor group configured, group traffic is ignored entirely and the
> reason is logged once per group. Set the vendor group in the dashboard to
> enable group delivery.

---

## 4. Reading the file

OCR runs on the document's **contents**. Filenames are deliberately ignored:
vendors name files arbitrarily, and an auto-generated name like
`1786808990797_b8f5fc41.jpeg` is a long digit run that can contain a customer's
application number by coincidence. `filenameExact` is hard-wired to `false`.

### Images

`local_ocr.py` builds up to 14 variants of the page and runs each at PSM 6 and
11, keeping whichever yields the most real characters:

| Group | Variants |
|---|---|
| Whole page | `plain` (untouched grayscale), `gray` (median → unsharp → autocontrast) |
| Binarised | `threshold` — 8 horizontal bands, per-band percentile, so a shadow on one part of the page cannot erase text elsewhere |
| Soft | for thin Bengali strokes |
| Channels | `red`, `green`, `blue` — one channel is often far cleaner than combined grayscale on monitor photos |
| Crops | 3 field bands + 2 focused English-name regions |

`plain` is yielded first and wins ties, because the denoise chain measurably
*hurts* clean digital scans — the same page reads `1994-03-11` plain and
`1994-63-11` processed.

Competing readings are then collapsed by letter skeleton: one `DOB: 1994-03-11`
arriving as `-63-`, `-93-`, `-83-` and `-@3-` becomes one date instead of four
contradictory ones.

A second independent OCR service always runs and its lines are merged.

### PDFs

Cheap first, heavy only on failure:

| Stage | Method | Accept if |
|---|---|---|
| 1 | `pdftotext -layout` | ≥ 20 chars |
| 2 | `pdftoppm -r 300` + one Tesseract pass | ≥ 10 chars |
| 3 | `extractPdfTextDeep` — render + multi-variant local engine + EasyOCR | runs only after matching already failed |

`-r 300` is deliberate: pdftoppm defaults to 150, which misread digits on clean
pages (`0` came back as `@` or `6`). 400 was no better and cost more.

Stage 3 uses **fast mode**, and not only for speed. A rendered page arrives at
native 300-dpi size where full mode preserves every bit of scan-line noise;
measured on a degraded certificate it spent 94 s and returned unusable text,
while fast mode read the same page in 2 s. Downsampling is itself a denoiser
here, so the cheaper path is also the more accurate one.

### Photos sent "as a file"

Sent to dodge WhatsApp's compression, these arrive as a `documentMessage`
carrying an image mimetype. They are OCR'd as images and delivered back as
documents, so they stay uncompressed.

### Two-engine conflict guard

When the second pass runs, its date-of-birth candidates are compared against the
first pass. **If the two engines disagree, auto-delivery is refused.** Two
engines disagreeing on a date of birth is evidence of danger, not more evidence.

---

## 5. Dates and names

Dates are stored as `DD/MM/YYYY` strings. Both numeric (`22/09/2001`,
`2001-09-22`, Bangla digits) and written forms (`19 June 1998`,
`২২ সেপ্টেম্বর ২০০১`) are parsed, and the result is calendar-validated
(1900–2100, real days per month).

**Labelled dates win.** A certificate carries Date of Registration, Date of
Issuance and Date of Death alongside the date of birth, and a whole-text scan
returns whichever appears first — on a Bangladeshi birth certificate, normally
the registration date. `extractLabeledDob()` reads the value attached to a birth
label first, at all three call sites; the generic scan remains a fallback for
documents whose label OCR did not survive.

Names are extracted label-first too, recognising English, Bangla and mixed
labels (`Name (English)`, `নাম বাংলা`, `আবেদনকারীর নাম`), with honorifics
(`MD`, `MST`, `মোঃ`, `মোছাঃ`) preserved as part of the name.

---

## 6. Matching

Every open order is scored against the extracted text:

```
score = matchedFields × 100
      + 20   verified application ID
      + 10   birth-registration number
      + 50   this vendor was assigned this order
      - 1000 order already DELIVERED
```

The −1000 keeps completed orders searchable without ever outranking open work:
a delivered order only surfaces when nothing else matches, which is exactly the
revision case.

Candidates are then resolved through a cascade of match modes, strongest first:

| Mode | Evidence |
|---|---|
| `NAME_DOB` | full name + full date of birth |
| `FIRST_NAME_DAY_MONTH` | first name + day/month (tolerates a year discrepancy) |
| `LAST_NAME_DAY_MONTH` | last name + day/month |
| `UNIQUE_OPEN_NAME` | a recognisable name matching exactly one open customer |
| `PARTIAL_NAME_DOB`, `UNIQUE_*_FALLBACK` | conservative fallbacks, uniqueness required |

### Final safety filter

| Filter | Rule |
|---|---|
| Gender | both sides state a gender and they differ → rejected |
| Date | both sides state a DOB and they differ → rejected |
| Identity | name, *or* application ID, *or* birth-registration number, *or* DOB + gender |
| Evidence | at least **two independent fields** |

The DOB + gender route exists because names frequently cannot match across
scripts — customers write in Bangla, certificates are issued in English, and OCR
mangles the Bangla half of a bilingual page:

```
stored from the customer:   মেহেদী রহমান
OCR read from the vendor:   মে হেদী রহেমোন     ← space inserted, letters wrong
```

A date of birth is the same number in both scripts.

Application ID, registration number, vendor assignment, parents' names and
address are **supporting** evidence — none of them identifies a customer alone.
A substring match only counts at 4+ characters; without that floor a
one-character name read from OCR noise matches every document it meets.

---

## 7. Delivery decision

First match wins:

| # | Condition | Outcome | File goes to |
|---|---|---|---|
| 1 | Vendor addressed the file to another vendor | `VENDOR_TO_VENDOR` | nobody (manual) |
| 2 | Two or more **different customers** tie | `AMBIGUOUS` | review group |
| 3 | Identical file already delivered, no revision marker | `DUPLICATE` | review group |
| 4 | Matched order already `DELIVERED`, no marker | `REVISION_PENDING` | review group |
| 5 | Recipient is not a dialable number | `NO_MATCH` | review group |
| 6 | One clear match, sender ≠ that customer | **`DELIVERED`** | **the customer** |
| 7 | Sender *is* the matched customer | `SOURCE_IS_CUSTOMER` | review group |
| 8 | Nothing matched after retry | `NO_MATCH` | review group |
| — | Processing error | `ERROR` | review group |

Several orders belonging to the **same** customer are not ambiguous — the
recipient is identical either way. Only a tie across *different* customers
blocks.

### Timing

**15 s hold before sending**, after which the match is re-checked against the
database. A correction the customer sends in that window is respected rather
than overtaken.

**15 s retry before giving up.** Customer details often arrive moments after the
vendor's file; declaring no-match immediately would push deliverable work into
the review queue.

---

## 8. Duplicates and revisions

Delivered files are fingerprinted by **SHA-256 of their bytes**, recorded per
customer (`session + customerPhone + fileHash`, unique). Content is the only
stable identity — the same document arrives as `41k.pdf`, `final.pdf`, or a
timestamp. An edited file hashes differently, so a genuine revision is never
mistaken for a duplicate.

A vendor marks corrected work **"Revision" / "Revision Done"** (also `রিভিশন`,
`সংশোধন`), read from what the vendor *writes* — caption or quoted text — never
from the document's own content.

| Vendor resends | Result |
|---|---|
| Identical file, no marker | `DUPLICATE` → review |
| Identical file, marked | **delivered** |
| Different file against a delivered order, no marker | `REVISION_PENDING` → review |
| Different file, marked | **delivered** |

A revision still passes every identity check. The marker only widens *which*
orders may be searched.

---

## 9. Identity handling

**LID resolution.** WhatsApp increasingly addresses contacts by a privacy
identifier (`@lid`) instead of a phone number. An unresolved LID is not a phone
number: keying an order to one produces a record that can never be delivered —
the send goes to `<lid>@s.whatsapp.net`, reports success, and reaches nobody.
Length cannot distinguish them (a LID is 15 digits, a valid MSISDN length), so
the JID itself is used. Mappings are persisted per session and backfilled across
`Message`, `DynamicOrder` and `AgentAudit`.

**Vendors** are configured per tenant *and* per session, from the dashboard. A
number not listed is treated as a customer — which matters more than it looks: a
missing vendor's files create a phantom order under their own number, and every
later delivery from them is refused as `SOURCE_IS_CUSTOMER`.

**Duplicate identities.** The system never holds two records with the same name
and date of birth — a vendor file matching both would tie forever and never
deliver. Within one customer, an earlier reading of the same person is replaced;
across customers, only an exact name + DOB duplicate is.

---

## 10. Data model

| Collection | Holds |
|---|---|
| `DynamicOrder` | one customer order: names, DOB, gender, parents, address, IDs, status, assigned vendor, revision counters |
| `DeliveredFile` | SHA-256 of every file delivered, per customer |
| `LidMap` | persistent LID → phone, session-scoped |
| `Message` | every message in and out |
| `AgentAudit` | every delivery decision with outcome, confidence, matched fields and reason |
| `Session` | WhatsApp session, API key, vendor numbers, vendor group, review target |

Plus subscriptions, campaigns, templates, bKash transactions and the SignCopy
sub-app — 28 models in total.

Order status: `PENDING` → `DELIVERED`, with `REVISION` and `MANUAL_REVIEW`.

---

## 11. Configuration

Read from `whatsapp-api/.env` (never committed; `.gitignore` covers `.env`,
`sessions/`, `public/received_media/` and `vendors.txt`):

```
PORT  BASE_URL  NODE_ENV
JWT_SECRET  JWT_EXPIRE
MONGO_WA_API_DB
WEBHOOK_SECRET  N8N_WEBHOOK_URL  N8N_WEBHOOK_SECRET  N8N_INTERNAL_SECRET
SMTP_HOST  SMTP_PORT  SMTP_SECURE  SMTP_USER  SMTP_PASS  SMTP_FROM
LOCAL_WHISPER_MODEL  GOOGLE_LENS_DEBUG_PORT
```

Outbound webhooks are checked by `webhookSecurity.js`, which rejects any URL
that is not public HTTPS — so a real certificate is required and the system
cannot be pointed at an internal address.

Per-session settings live in the dashboard: vendor numbers, vendor group,
review/unmatched group, AI settings, forwarding.

---

## 12. Deployment

Push to `main` → GitHub Actions → SSH → deploy.

```
abort if tracked files are modified on the server
fetch / switch main / pull --ff-only        (abort if not fast-forwardable)
require .env
npm ci                                       (only if package.json changed)
node --check on whatsapp.js, dynamicOrderDelivery.js, server.js
pm2 restart whatsapp-api
pm2 restart wafastapi-easyocr                (only if its own code changed)
verify pm2 online + HTTP on 3012
pm2 save
```

No `reset --hard`, no `clean`, no `restart all`. Untracked production state —
`.env`, `sessions/`, `received_media/`, `vendors.txt` — is invisible to the pull
and survives every deploy. A failed health check rolls back and says so.

See `.github/workflows/deploy-wafastapi.yml`.

---

## 13. Tests

```bash
cd whatsapp-api && npm test
```

`tests/labeledDob.test.js` — labelled dates beat registration/issuance dates;
both scripts and both date forms; calendar rejection; the label-distance bound;
the unlabelled fallback.

`tests/workflowScope.test.js` — direct chats allowed; the configured vendor
group allowed; every other group ignored; the review group never reprocessed,
even if someone configures it as the vendor group.

`tests/webhookSecurity.test.js` — public/private IP classification, insecure URL
rejection, credential redaction in logs.

---

## 14. Known gaps

**Vendor caption is still part of identity evidence.** Matching runs on
`ocrText + caption`, so a vendor typing a customer's name alongside an unrelated
file can influence identity. The revision marker is already read separately, so
splitting the two is a smaller change than it looks. This is the next planned
safety change.

**Scanned-PDF OCR reads the first 3 pages** (2 in the deep pass). Fine for
certificates; later pages of a long document contribute nothing.

**Badly degraded scans are not rescued.** The deep pass improves matters but a
heavily noisy certificate still ends in `NO_MATCH` → review. That is the correct
fail-closed outcome, not a bug, but it is not a recovery mechanism.

**Batches are processed sequentially**, each with its own 15 s hold. Five files
arriving together take 75 s+ before the last is delivered.

**Audit confidence can under-report** — a successful delivery may be logged with
lower confidence than a later recomputation of the same match. Reporting
quality only; the delivery itself is unaffected.

**Housekeeping:** `server.js` calls `setDbVendors()` with a pre-scoping
signature, so the startup preload is a no-op (it self-heals via the per-session
refresh); two divergent copies of `easyocr_service.py` exist with a hardcoded
VPS path; five `.before-*` backup files are tracked in git.
