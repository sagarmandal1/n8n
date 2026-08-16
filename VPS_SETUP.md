# Production Setup — Client VPS + n8n

Deploying WaFastAPI (WhatsApp API + n8n automation) onto a client's own VPS.

Two services run side by side:

| Service | Runs as | Port | Purpose |
|---|---|---|---|
| `whatsapp-api` | PM2 (Node) | 3002 | WhatsApp session, MongoDB, OCR, order matching, delivery |
| `n8n` + PostgreSQL | Docker Compose | 5678 | Workflows, DeepSeek AI agent, customer chat memory |

Both sit behind nginx with TLS. **The API refuses any webhook URL that is not
public HTTPS** (`lib/webhookSecurity.js`), so a real certificate is required —
there is no way to run this on plain HTTP.

---

## 1. Server requirements

- Ubuntu 22.04 or 24.04, **4 GB RAM minimum** (OCR + Whisper are memory-hungry; 8 GB if voice notes are used)
- 40 GB disk — received media accumulates under `public/received_media/`
- A domain with two records pointing at the VPS, e.g.
  `api.example.com` → whatsapp-api, `n8n.example.com` → n8n

---

## 2. Base packages

```bash
sudo apt update && sudo apt upgrade -y

# Node 24 + PM2
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# MongoDB 7
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb.gpg
echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod

# Docker (for n8n)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in

# nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

### OCR and voice toolchain

The document pipeline shells out to these. **Missing any of them silently
degrades matching** — PDF text extraction fails, or Bangla OCR returns nothing.

```bash
sudo apt install -y poppler-utils tesseract-ocr tesseract-ocr-ben tesseract-ocr-eng
sudo apt install -y python3 python3-pip python3-venv
pip3 install --break-system-packages numpy pillow

# verify — 'ben' must appear
pdftotext -v && pdftoppm -v && tesseract --list-langs
```

---

## 3. whatsapp-api

```bash
sudo mkdir -p /var/www && cd /var/www
# copy the project here (git clone, scp or rsync)
cd /var/www/whatsapp-api
npm install --omit=dev
```

### Environment

```bash
cp .env.example .env
```

```ini
PORT=3002
BASE_URL=https://api.example.com
JWT_SECRET=<openssl rand -hex 32>
JWT_EXPIRE=1d
MONGO_WA_API_DB=mongodb://wa_user:<password>@127.0.0.1:27017/wa-api?authSource=admin
WEBHOOK_SECRET=<openssl rand -hex 32>
```

Create the database user first:

```bash
mongosh --eval 'db.getSiblingDB("admin").createUser({user:"wa_user",pwd:"<password>",roles:[{role:"readWrite",db:"wa-api"}]})'
```

Then enable auth in `/etc/mongod.conf` (`security.authorization: enabled`) and
`sudo systemctl restart mongod`. **Do not leave MongoDB open without auth** — it
holds customer NIDs, birth-registration numbers and phone numbers.

### Vendor list

`vendors.txt` decides who is a vendor. Everyone not listed is treated as a
customer. It is read live — edits apply within seconds, no restart.

```
Vendor Name, 8801700000000
Karim Traders | 01712345678
8801912345678
```

Name, then mobile. Comma, pipe, colon or tab all work; `01…` and `8801…` are
both accepted. Lines starting with `#` are comments.

> This matters more than it looks. A vendor who is missing from this file has
> their returned files treated as *customer* data, which creates a phantom order
> under the vendor's own number and blocks every later delivery from them.

### Start

```bash
pm2 start server.js --name whatsapp-api
pm2 save && pm2 startup   # run the command it prints
```

### Voice notes (optional)

Only needed if customers send voice messages.

```bash
cd /var/www/whatsapp-api
python3 -m venv .venv-voice
./.venv-voice/bin/pip install faster-whisper
pm2 start ecosystem.voice.config.cjs && pm2 save
```

---

## 4. n8n + PostgreSQL

```bash
cd /var/www/n8n
cp .env.example .env
```

```ini
N8N_HOST=n8n.example.com
N8N_EDITOR_BASE_URL=https://n8n.example.com
N8N_WEBHOOK_URL=https://n8n.example.com/
GENERIC_TIMEZONE=Asia/Dhaka
N8N_ENCRYPTION_KEY=<openssl rand -hex 24>
POSTGRES_USER=n8n
POSTGRES_PASSWORD=<openssl rand -hex 16>
POSTGRES_DB=n8n
DEEPSEEK_API_KEY=<provider key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

A second file `.runner.env` is required by the compose file:

```ini
N8N_RUNNERS_AUTH_TOKEN=<openssl rand -hex 32>
```

```bash
docker compose up -d
docker compose ps        # all four services must report healthy
```

> **Keep `N8N_ENCRYPTION_KEY` safe.** n8n encrypts every stored credential with
> it. Lose it and all credentials must be recreated by hand.

### Required database migration

The workflow writes chat memory with a raw parameterised `INSERT`, **not** n8n's
chat-memory node, so nothing creates this table. Without it the first execution
fails with `relation "deepseek_customer_chat_memory" does not exist`.

```bash
docker compose exec -T postgres psql -U n8n -d n8n <<'SQL'
CREATE TABLE IF NOT EXISTS deepseek_customer_chat_memory (
  id         SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  message    JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dccm_session_recent
  ON deepseek_customer_chat_memory (session_id, id DESC);
SQL
```

### Import the workflows

```bash
docker compose exec -T n8n n8n import:workflow --input=/files/whatsappExpressN8nReply-current.json
docker compose exec -T n8n n8n import:workflow --input=/files/deepseekChatStarter-current.json
```

Do **not** import `auto-dispatch-live.json` — the Smart Seller dispatcher is
archived and sends files directly to customers.

### Credentials

n8n strips credentials on export, so recreate these in the editor. The names
must match exactly or the nodes will not bind:

| Name | Type | Value |
|---|---|---|
| `WhatsApp Express - Webhook Secret` | Header Auth | header `X-Webhook-Secret`, value = `WEBHOOK_SECRET` from the API `.env` |
| `WhatsApp Express - Reply API` | Header Auth | header `x-api-key`, value = the session's API key (see §6) |
| `Postgres Memory - WhatsApp Agent` | Postgres | host `postgres`, port 5432, db/user `n8n`, password from `.env` |
| `DeepSeek API - WhatsApp Agent` | DeepSeek | provider API key |

Then point the workflow HTTP nodes at the API host. Five nodes carry a URL:

```
WhatsApp Express  → Send WhatsApp Reply             /api/whatsapp/send/text
DeepSeek Agent    → Live CRM, Order, OCR, Payment   /api/agent/analyze
DeepSeek Agent    → Audit AI Decision               /api/agent/audit
DeepSeek Agent    → Audit Fast Decision             /api/agent/audit
(Smart dispatcher → leave inactive)
```

Verify none still point elsewhere:

```bash
docker compose exec -T postgres psql -U n8n -d n8n -t -c \
  "select name, (nodes::text like '%wafastapi.com%') from workflow_entity;"   -- all must be f
```

---

## 5. nginx + TLS

```nginx
server {
    server_name api.example.com;
    client_max_body_size 64M;          # customer documents

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    server_name n8n.example.com;

    location / {
        proxy_pass http://127.0.0.1:5678;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_buffering    off;          # webhooks and SSE stream
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.example.com -d n8n.example.com
```

> If you add HTTP Basic Auth in front of n8n, **exempt any path an external
> client must reach** (`/webhook/`, `/mcp-server/`) with `auth_basic off;`.
> nginx consumes the `Authorization` header, so a Bearer token never reaches
> n8n and every call returns 401.

### Firewall

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

MongoDB (27017), Postgres and n8n (5678) must **not** be exposed publicly — the
compose file binds n8n to `127.0.0.1` already.

---

## 6. Link WhatsApp and connect the pieces

1. Open `https://api.example.com`, register, and log in.
2. **Grant a subscription.** Session creation returns
   `403 No active subscription` without one. If no payment gateway is
   configured, set it directly:

   ```bash
   mongosh wa-api --eval '
   db.users.updateOne({username:"<user>"}, {$set:{
     subscription:{id:"enterprise",startDate:new Date(),endDate:new Date(Date.now()+365*864e5),autoRenew:false,status:"active"},
     fwSubscription:{id:"fwbot_30",startDate:new Date(),endDate:new Date(Date.now()+365*864e5),status:"active"}
   }})'
   ```

3. **New Session** → scan the QR within ~20 seconds, on the account that will
   act as the CEO.
4. Read the session API key and put it in the `WhatsApp Express - Reply API`
   credential:

   ```bash
   mongosh wa-api --eval 'db.sessions.find({},{apiKey:1}).forEach(s=>print(s.apiKey))'
   ```

5. **Set the webhook** to `https://n8n.example.com/webhook/whatsapp-express-events`
   from the dashboard. Leave the per-session secret unset so it falls back to
   `WEBHOOK_SECRET` and matches the n8n credential.
6. **Configure the unmatched-file group.** Create a WhatsApp group (e.g.
   "Unmatched customer"), then:

   ```bash
   mongosh wa-api --eval 'db.sessions.updateMany({},{$set:{
     undeliveredEnabled:true, undeliveredTarget:"<groupid>@g.us"}})'
   ```

   Find the group id via `GET /api/whatsapp/get/groups` with the session key.

7. Restart n8n, then activate **only** `WhatsApp Express - n8n Auto Reply` and
   `DeepSeek Advanced Customer Agent`.

### Auto-reply is off by default

`Check Reply Mode` ships with `autoReplyEnabled: false` (Human Review Mode) —
messages are read and remembered but no customer receives an automated reply.
Set it to `true` only when the client is ready for the bot to speak to real
customers. It takes effect immediately when saved in the editor.

---

## 7. Verify

```bash
curl -s https://api.example.com/ -o /dev/null -w '%{http_code}\n'          # 200
curl -s https://n8n.example.com/healthz                                    # {"status":"ok"}

# webhook must reject without the secret and accept with it
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://n8n.example.com/webhook/whatsapp-express-events -d '{}'           # 403
```

Then send a real message and confirm an execution appears in n8n, plus a row in
`deepseek_customer_chat_memory`.

**End-to-end test:** a customer sends their details → order created; the CEO
forwards them to a vendor → assignment recorded; the vendor returns the file →
matched on name + DOB + gender → delivered. A file that matches nothing lands in
the Unmatched group.

---

## 8. Backups

```bash
mongodump --uri="$MONGO_WA_API_DB" --out=/var/backups/mongo-$(date +%F)
cd /var/www/n8n && docker compose exec -T postgres pg_dump -U n8n n8n > /var/backups/n8n-$(date +%F).sql
cp /var/www/n8n/.env /var/backups/n8n-env-$(date +%F)     # holds the encryption key
tar czf /var/backups/wa-auth-$(date +%F).tgz /var/www/whatsapp-api/sessions
```

`sessions/` holds the WhatsApp auth state — losing it means re-scanning the QR.

---

## 9. Operating notes

**Never commit or share** `.env`, API keys, webhook secrets, the n8n encryption
key, database dumps, `sessions/`, or anything under `public/received_media/`.
Customer documents contain NID, e-TIN and birth-registration numbers.

| Symptom | Cause |
|---|---|
| `403 No active subscription` | user has no plan — see §6 step 2 |
| QR never connects, `408` | code expired; it refreshes every 15s, scan promptly |
| `Webhook URL must use HTTPS` | working as designed — a public certificate is required |
| n8n returns 404 on the webhook | workflow inactive, or n8n not restarted after a CLI change |
| n8n rejects deliveries with 403 | `X-Webhook-Secret` does not match `WEBHOOK_SECRET` |
| Vendor files never deliver | vendor missing from `vendors.txt` |
| PDF text extraction fails | `poppler-utils` not installed |
| Bangla OCR returns nothing | `tesseract-ocr-ben` not installed |

Logs: `pm2 logs whatsapp-api`, and `docker compose logs -f n8n`.

### Known limits

- OCR on photographs of screens is unreliable, particularly for digits. Matching
  weights the name and application number above the date of birth for that
  reason, but some legitimate files will still land in the Unmatched group.
- A vendor-to-vendor handoff is only detected when the message @mentions or
  replies to the other vendor. A file posted in a shared group with no such
  signal is treated as a normal return.
- Two customers sharing a name **and** a date of birth are treated as one
  person: the older record is replaced. With common names this can eventually
  misfire, so watch the `[Order] duplicate identity` log lines.
