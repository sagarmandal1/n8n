# WhatsApp Web + n8n Developer Handoff

This project uses WhatsApp Web/Baileys, not the Meta WhatsApp Cloud API.

## Included

- WhatsApp API source and OCR/matching logic
- n8n Docker configuration
- Current workflow exports for auto-dispatch and WhatsApp Express handling
- Setup and upgrade scripts

## Required before running

1. Copy `.env.example` to `.env` in each project and fill in real values.
2. Install Node dependencies in `whatsapp-api`.
3. Start MongoDB and n8n/Postgres.
4. Import the workflow JSON files into n8n and recreate credentials by name.
5. Link the WhatsApp Web session from the WhatsApp API dashboard.
6. Set the session webhook URL to the n8n production webhook and use the same webhook secret.

Never share `.env`, WhatsApp session files, database dumps, media, or API keys.
