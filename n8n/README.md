# n8n DeepSeek Advanced Customer Agent

Domain: https://n8n.wafastapi.com  
Install path: `/var/www/n8n`

## Production runtime

- n8n version: `2.34.6`
- Database: PostgreSQL 16 with persistent Docker volume
- JavaScript এবং native Python Code node দুটিই matching-version `n8nio/runners:2.34.6` external sidecar-এ isolatedভাবে চলে।
- Active workflows: `WhatsApp Express - n8n Auto Reply` এবং `DeepSeek Advanced Customer Agent`।
- পুরোনো hard-coded `Smart Seller-to-Customer Auto Dispatcher` archived; dynamic order/file delivery `/var/www/whatsapp-api`-এর database-driven pipeline থেকে চলে।
- Pre-upgrade validated backup: `/var/www/n8n/backups/pre-2.34.6-20260814T1924/`
- Completed agent-suite backup (PostgreSQL + MongoDB + code, checksum validated): `/var/www/n8n/backups/post-agent-suite-20260814T183226Z/`

এই workflow বাংলা, Banglish ও English customer support message handle করে। সহজ প্রশ্ন rule-based response দিয়ে API খরচ কমায় এবং জটিল প্রশ্ন DeepSeek AI-কে পাঠায়।

## নিরাপদ customer memory

- প্রতিটি request-এ `customer_id` অথবা `from` হিসেবে unique phone number আবশ্যক।
- বাংলাদেশের local `01...` number স্বয়ংক্রিয়ভাবে `8801...` format-এ normalize হয়।
- Memory session key: `whatsapp:<session-id>:<normalized-number>` for forwarded WaFastAPI sessions; direct bridge requests use `whatsapp:<normalized-number>`
- Memory PostgreSQL-এর `deepseek_customer_chat_memory` table-এ persist হয়।
- Number না থাকলে AI ও memory দুটোই block হয়; message text কখনো session key হিসেবে ব্যবহৃত হয় না।
- Native WhatsApp Cloud API payload-এর `entry[].changes[].value.messages[].from` ও text format সমর্থিত।

## Production webhook

```text
POST https://n8n.wafastapi.com/webhook/deepseek-chat
Content-Type: application/json
```

## WhatsApp Express integration

`whatsapp-express` uses the WaFastAPI server's dedicated authenticated ingestion workflow:

```text
POST https://n8n.wafastapi.com/webhook/whatsapp-express-events
```

- Workflow: `WhatsApp Express - n8n Auto Reply` (currently learning-only)
- Workflow ID: `whatsappExpressN8nReply`
- `message.received` customer context intake করে এবং one-to-one `message.sent` নিরাপদ parameterized PostgreSQL write দিয়ে customer memory-তে সংরক্ষণ করে; status ও connection events acknowledged হয়ে ignore হয়।
- Acknowledges immediately, deduplicates message IDs for 24 hours and updates the DeepSeek context while Human Review Mode is active.
- Inbound webhook and outbound API credentials are encrypted in n8n.
- The active WaFastAPI session is `699be30cec09c1ef7c877faa`; the old QR bridge is disabled.

সাধারণ payload:

```json
{
  "customer_id": "8801712345678",
  "message": "আমার অর্ডার কোথায়?",
  "message_id": "unique-message-id"
}
```

Test:

```bash
curl -X POST https://n8n.wafastapi.com/webhook/deepseek-chat \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":"8801712345678","message":"Bangla te hello bolo","message_id":"test-1"}'
```

## Workflow features

- Session + customer-number isolation এবং 15-interaction persistent AI context window; WaFastAPI database থেকে সর্বশেষ 20টি customer-specific message live context হিসেবে পাওয়া যায়
- **Multi-Intent Classification**: `sales_inquiry`, `document_verification`, `order_logistics`, `general_inquiry`, `greeting`, `sensitive_handoff`, `security_review`
- **Dynamic Specialist Personas**: এআই কাস্টমারের প্রয়োজন বুঝে স্বয়ংক্রিয়ভাবে `sales_specialist`, `document_specialist`, `logistics_specialist` বা `general_support` পার্সোনা গ্রহণ করে
- **Entity Extraction**: NID, e-TIN, Trade License, Passport, bKash, Nagad, TrxID স্বয়ংক্রিয়ভাবে এক্সট্র্যাক্ট করে
- **Sentiment Analysis**: কাস্টমারের মনোভাব (`positive`, `neutral`, `negative`) বিশ্লেষণ করে সহানুভূতিশীল টোন অ্যাডাপ্ট করে
- প্রতিটি customer-এর inbound ও outbound chat আলাদা history হিসেবে CRM-এ persist হয়; অন্য customer-এর history AI context-এ পাঠানো হয় না
- Connected normal WhatsApp থেকে manually পাঠানো one-to-one message-ও outbound history হিসেবে পড়া ও সংরক্ষণ হয়; এগুলো কখনো auto-reply trigger করে না
- Default mode হলো Human Review Mode: message পড়বে ও memory-তে রাখবে, কিন্তু আপনার অনুমতি ছাড়া কোনো customer-কে automated reply দেবে না
- WaFastAPI REST API-এর সঙ্গে inbound webhook এবং outbound text/file delivery integration
- Per-customer business/CRM context; confirmed quote, payment ও work status-aware AI reply
- Greeting, price, delivery ও order-ID clarification-এর free routing (zero AI token cost)
- Refund, fraud, legal, medical, payment dispute ও prompt-injection human handoff
- Persistent human-handoff queue ও dashboard থেকে Resolve/Reopen
- Dashboard handoff queue থেকে admin custom WhatsApp reply
- Restart-এর পরেও duplicate WhatsApp message protection
- 2,000-character input limit
- AI timeout/retry এবং human-handoff fallback
- Calculator tool
- সর্বোচ্চ 300-320 character সম্পূর্ণ ও প্রাকৃতিক WhatsApp reply (sentence boundary-aware truncation)
- Structured JSON response: `success`, `reply`, `confidence`, `used_deepseek`, `handoff`, `intent`, `specialist_persona`, `sentiment`, `entities`, `reason`, `tags`, `customer_ref`, `message_id`

## Live operations intelligence

- প্রতিটি AI response-এর আগে authenticated WaFastAPI analyzer থেকে customer/seller role, live order status, recent history, CRM profile, service requirements, OCR match ও payment state load হয়। AI tool call সফল হওয়ার উপর এই তথ্য নির্ভর করে না।
- Application ID না থাকলেও name, DOB, father, mother, address বা birth-registration number-এর যেকোনো 2টি independent field একটিমাত্র pending order-এর সঙ্গে মিললে delivery অনুমোদিত হয়। একই score-এর একাধিক order, no-match বা conflict হলে auto-delivery বন্ধ রেখে review queue-তে পাঠানো হয়।
- Service name, requirements, price text এবং delivery time `AgentService` collection-এ dynamicভাবে থাকে; authenticated API দিয়ে update করা যায়।
- Payment শুধু internal ledger record বা supported bKash payment-status response `VERIFIED` দিলে confirmed হয়। শুধু TrxID format কখনো payment confirmation নয়।
- `AgentAudit` ও `AgentCustomerProfile` collections-এ context lookup, document match, payment check, delivery decision, AI response, voice result এবং processing error persist হয়।
- n8n error workflow: `DeepSeek Agent - Error Audit & Review Queue` (`deepseekAgentErrorAudit`)।

## WhatsApp attachment/OCR intake

- WaFastAPI saves newly received media under `/var/www/whatsapp-api/public/received_media/` and sends the media URL, MIME type and filename to n8n.
- PDF text is extracted with `pdftotext`; scanned PDF pages are rendered with `pdftoppm` and processed by Tesseract.
- Images use a bounded local OCR pipeline: Python/Pillow preprocessing with multiple variants, then Tesseract `eng+ben`; the internal captcha service is a localhost fallback. Bounded OCR text is included in both the webhook metadata and the agent's current message context. Screen photos with heavy moiré may still need a clearer/original document photo and human verification.
- Media-only messages without extractable text are still logged। Audio/voice note local Faster-Whisper (`base`, CPU/int8) দিয়ে transcribe হয়; persistent localhost-only `whatsapp-voice` PM2 service এবং one-shot fallback দুটোই আছে। কোনো external transcription API key লাগে না।
- Normal text 2,000 characters পর্যন্ত এবং OCR/voice/media context 12,000 characters পর্যন্ত customer-isolated learning memory-তে রাখা হয়। Human Review Mode-এ inbound message memory-তে যায়, কিন্তু automated reply পাঠানো হয় না।
- WaFastAPI webhook delivery is enabled for the selected linked session. Existing WhatsApp history is not automatically replayed by n8n; any backfill must be explicitly implemented and remains human-review only.

History backfill is human-review only and is not part of the active WaFastAPI→n8n message path. Customer context remains isolated by WhatsApp number/session.

Authenticated WaFastAPI agent endpoints (selected session API key required):

```text
POST /api/agent/analyze
POST /api/agent/context
POST /api/agent/document/match
POST /api/agent/payment/verify
GET  /api/agent/services
PUT  /api/agent/services/:code
POST /api/agent/audit
GET  /api/agent/review-queue
```

## Legacy QR bridge

- The old local Baileys QR bridge and `wa-bridge.service` are disabled and are not used by the active n8n flow.
- WhatsApp is now handled by the WaFastAPI project at `https://wafastapi.com`.
- Source: `/var/www/wa-bridge/server.js`
- CRM data: `/var/www/wa-bridge/data/crm.json`
- Session data: `/var/www/wa-bridge/auth` (`700` directory, `600` files)
- Bridge localhost-only `127.0.0.1:8002`-এ চলে এবং nginx dashboard-এ Basic Auth প্রয়োগ করে।
- Auto reply-তে cooldown, random delay, global/per-customer volume limit, backlog ignore, link guard এবং safety auto-pause আছে।
- বর্তমান cap: 25/hour, global 200/rolling 24 hours, এবং 20/customer/rolling 24 hours। Automated cap শেষ হলেও admin handoff reply পাঠাতে পারবেন।

## Deployment

```bash
docker compose exec -T n8n n8n import:workflow \
  --input=/files/deepseek-chat-workflow.json \
  --projectId=yYS1uaZbNGDw3HVU

docker compose exec -T n8n n8n publish:workflow --id=deepseekChatStarter
docker compose up -d
```

Main workflow: `/var/www/n8n/local-files/deepseek-chat-workflow.json`

Rollback workflow: `/var/www/n8n/local-files/deepseekChatStarter-before-customer-isolation-20260727.json`

Credentials are encrypted by n8n. The Postgres memory credential uses a dedicated limited-permission database role.
