# WhatsApp Web + n8n Automation — Developer Requirement

## ১. Project-এর উদ্দেশ্য

এটি WhatsApp Web/Baileys ভিত্তিক automation system। এটি **Meta WhatsApp Cloud API project নয়**।

Seller WhatsApp Web-এ file পাঠাবে। System সেই file সঠিক customer-এর order-এর সঙ্গে মিলিয়ে customer-এর WhatsApp-এ পাঠাবে।

## ২. প্রধান অংশ

- `whatsapp-api`: Node.js/Express API, Baileys WhatsApp Web session, MongoDB, OCR, order matching ও delivery logic।
- `n8n`: Webhook workflow, automation ও বিভিন্ন integration।
- MongoDB: WhatsApp message, session, order ও delivery audit সংরক্ষণ।
- PostgreSQL: n8n workflow ও execution data।

## ৩. প্রয়োজনীয় কাজের ধাপ

১. Customer-এর order থেকে phone, নাম, জন্মতারিখ ও application তথ্য সংরক্ষণ করতে হবে।
২. নির্দিষ্ট seller group বা seller chat-এ order/task পাঠাতে হবে।
৩. Seller image অথবা PDF result পাঠাবে।
৪. OCR বা matching শুরু করার আগে incoming WhatsApp message ও media database-এ save করতে হবে।
৫. PDF হলে আগে সরাসরি text extract করতে হবে; প্রয়োজন হলে OCR fallback ব্যবহার করতে হবে।
৬. OCR-এ বাংলা ও ইংরেজি mixed text এবং monitor/screen photo support থাকতে হবে।
৭. Name, DOB, Application ID, Birth Registration Number, বাবা/মায়ের নাম বা address—কমপক্ষে দুইটি independent তথ্য দিয়ে match করতে হবে।
৮. যাচাই করা application/birth-registration number filename থাকলে PDF filename দিয়ে match করা যাবে।
৯. একটিমাত্র clear match হলে file customer-কে পাঠাতে হবে।
১০. Match না হলে বা একাধিক match হলে automatic delivery করা যাবে না; manual review audit তৈরি করতে হবে।
১১. `DELIVERED`, `NO_MATCH`, `AMBIGUOUS` ও processing error সংরক্ষণ করতে হবে।

## ৪. Seller ও group-এর নিয়ম

- শুধু configured seller-দের file delivery logic-এ নেওয়া যাবে।
- Connected account লিখতে পারে—এমন group-ই writable group হিসেবে দেখাতে হবে।
- Community বা announcement-only group delivery target করা যাবে না।
- Seller group message এবং personal seller message আলাদাভাবে match করতে হবে।
- অন্য customer বা অন্য chat-এর message দিয়ে match করা যাবে না।

## ৫. Session ও reliability

- একটি WhatsApp session-এর জন্য একসঙ্গে শুধু একটি Baileys socket চলবে।
- PM2 বা container restart-এর আগে পুরোনো socket graceful ভাবে বন্ধ করতে হবে।
- Reconnect-এর সময় message event হারানো যাবে না।
- OCR বা n8n processing-এর আগে message database-এ save করতে হবে।
- Temporary webhook failure হলে backoff retry থাকতে হবে।
- Temporary network/decryption error হলে WhatsApp auth file নিজে থেকে delete করা যাবে না।
- Session status দেখাতে হবে: `CONNECTED`, `RECONNECTING`, `DISCONNECTED`, `QR_READY`, `LOGGED_OUT`।

## ৬. n8n-এর নিয়ম

- Production webhook active থাকতে হবে এবং HTTP 2xx response দিতে হবে।
- Webhook secret/header credential WhatsApp API-এর secret-এর সঙ্গে মিলতে হবে।
- Session ID ও message ID দিয়ে duplicate event আটকাতে হবে।
- Failed execution দেখা ও retry করা যাবে এমন ব্যবস্থা থাকতে হবে।
- Incoming message save করার জন্য শুধু n8n-এর ওপর নির্ভর করা যাবে না; WhatsApp API আগে message save করবে।

## ৭. Security

- `.env`, API key, password, webhook secret, database dump বা WhatsApp session কখনো commit/share করা যাবে না।
- Public endpoint-এ HTTPS ব্যবহার করতে হবে।
- Webhook signature/secret verify করতে হবে।
- Dashboard ও API authentication দিয়ে protect করতে হবে।
- Ambiguous match হলে কখনো automatic delivery করা যাবে না।
- Customer document private রাখতে হবে এবং media directory protect করতে হবে।

## ৮. Setup

১. দুই project-এ `.env.example` কপি করে `.env` তৈরি করতে হবে।
২. MongoDB, PostgreSQL, n8n encryption key, API credential ও webhook secret বসাতে হবে।
৩. `whatsapp-api`-এর dependency install করতে হবে।
৪. Docker Compose দিয়ে n8n ও PostgreSQL চালাতে হবে।
৫. দেওয়া workflow JSON n8n-এ import করে credential recreate করতে হবে।
৬. PM2 দিয়ে WhatsApp API চালিয়ে WhatsApp Web session link করতে হবে।

## ৯. কাজ গ্রহণের শর্ত

- Seller image পাঠানোর সঙ্গে সঙ্গে API database-এ message দেখা যাবে।
- পরিষ্কার বাংলা/ইংরেজি image OCR হবে, অথবা review-এর জন্য সঠিকভাবে flag হবে।
- Exact verified filename থাকা PDF OCR ছাড়াই match হবে।
- Unique seller result একবারই সঠিক customer-এর কাছে যাবে।
- No-match বা ambiguous result ভুল customer-এর কাছে যাবে না।
- API restart করলে duplicate WhatsApp session তৈরি হবে না।
- n8n unavailable হলেও WhatsApp message database থেকে হারাবে না।
- Delivery audit-এ সম্পূর্ণ decision ও reason দেখা যাবে।

## ১০. Testing checklist

- Seller personal chat-এর image
- Seller group-এর image
- শুধু বাংলা text-এর image
- শুধু ইংরেজি text-এর image
- Moiré-সহ monitor/screen photo
- Matching filename-সহ PDF
- Duplicate webhook event
- n8n সাময়িক বন্ধ থাকা অবস্থায় message
- WhatsApp reconnect/restart
- Ambiguous match ও no-match case
