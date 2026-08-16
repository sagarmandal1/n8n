# 🔗 Webhook System - Quick Reference Card

## 📋 URLs & Commands

```bash
# Node.js Server
npm run dev                           # Start dev server
# Access: http://localhost:3002

# PHP Server (Local Testing)
php -S localhost:8080                # Start PHP server
# Access: http://localhost:8080/webhook_receiver.php

# MongoDB
# Must be running on localhost:27017

# Production
https://your-domain.com/webhook/webhook.php
```

---

## 🔑 Configuration

| Environment | Key | Value |
|---|---|---|
| Node.js | `WEBHOOK_SECRET` | `my_super_secret_key_123` |
| PHP | `$SECRET` | `my_super_secret_key_123` |
| **MUST MATCH!** | | |

---

## 📡 Webhook Setup

```
Dashboard → Sessions → Your Session → 🔗 Webhook Button
       ↓
Enter webhook URL
       ↓
Click Save
       ↓
Status: Webhook Configured ✅
```

---

## 🧪 Testing

### Quick Test Methods:
1. **webhook.site** - https://webhook.site
2. **Local PHP** - http://localhost:8080/webhook_receiver.php
3. **ngrok** - https://abc123.ngrok.io/webhook
4. **Production** - https://your-domain.com/webhook/webhook.php

### Test Event:
```
Send/Receive WhatsApp message → Event fires → Check dashboard
```

---

## 📊 Dashboard Stats

| Stat | Meaning |
|------|---------|
| Total Events | All webhooks sent since start |
| Last Hour | Webhooks from last 60 minutes |
| Users | Unique user IDs |
| Sessions | Unique session IDs |

---

## 🔍 Filtering

```
Filter by User ID:  [Input user ID...] → Shows only that user's events
Filter by Session:  [Input session ID...] → Shows only that session's events
Filter by Event:    [message.received] → Shows only that event type
```

Common Event Types:
- `message.received`
- `message.sent`
- `session.connected`
- `session.disconnected`
- `session.reconnecting`
- `session.logged_out`

---

## 🔐 Security Headers

```
POST /webhook HTTP/1.1
Content-Type: application/json
X-Webhook-Secret: my_super_secret_key_123
X-Webhook-Signature: base64_encoded_string

{
  "event": "message.received",
  "data": { ... }
}
```

---

## 📝 Webhook Payload Structure

```json
{
  "event": "message.received",              // Event type
  "timestamp": "2024-03-26T12:34:56.789Z",  // ISO datetime
  "sessionId": "6980c78c1c8fd1355d9c03c8",  // Session ID
  "userId": "6980c78c1c8fd1355d9c03c7",     // User ID
  "signature": "base64_string",              // Signature
  "data": {                                  // Event-specific data
    "from": "1234567890",
    "message": "Hello!",
    "type": "text"
  }
}
```

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| `401 Unauthorized` | Check secret matches |
| `No events` | Check session is Connected |
| `Webhook URL invalid` | Use HTTPS or HTTP |
| `Timeout error` | Webhook takes >10s |
| `404 Not Found` | PHP file not accessible |

---

## 📁 Key Files

```
whatsapp-api/
├── .env                         ← Configuration
├── server.js                    ← Main server
├── lib/webhookDispatcher.js     ← Webhook engine
├── lib/whatsapp.js              ← Event listeners
├── webhook_receiver.php         ← PHP receiver
└── WEBHOOK_*.md                 ← Documentation
```

---

## 🚀 Common Tasks

### View Live Webhooks
```
Open: http://localhost:8080/webhook_receiver.php
```

### Filter by User
```
Enter User ID in filter box → Click Apply
```

### Change Secret Key
```
1. Update .env (Node.js)
2. Update webhook_receiver.php line 12 (PHP)
3. Restart both servers
```

### Export Logs
```
Download webhook_log.json file directly
```

---

## 📞 Support Links

- **Node.js Docs**: `WEBHOOK_DOCUMENTATION.md`
- **PHP Docs**: `PHP_WEBHOOK_README.md`
- **Setup Guide**: `WEBHOOK_MULTIUSER_SETUP.md`
- **বাংলা Guide**: `WEBHOOK_QUICK_START_BN.md`

---

## ✅ Deployment Checklist

- [ ] Change WEBHOOK_SECRET in production
- [ ] Use HTTPS for webhook URL
- [ ] Set proper file permissions
- [ ] Test webhook before going live
- [ ] Add authentication to dashboard
- [ ] Set up log rotation
- [ ] Configure monitoring
- [ ] Document for team

---

## 💡 Pro Tips

1. Use webhook.site for quick testing
2. Keep WEBHOOK_SECRET strong & unique
3. Monitor webhook failures regularly
4. Use filters instead of scrolling
5. Backup webhook_log.json regularly
6. Add custom processing logic in PHP
7. Test different event types

---

## 🎯 Performance

| Metric | Value |
|--------|-------|
| Max Events Logged | 100 (auto-rotates) |
| Event Processing Time | <100ms |
| Retry Attempts | 3 |
| Timeout | 10 seconds |
| Dashboard Refresh | Every 2 seconds |

---

## 📱 Multi-User Support

```
7 Users × 2 Sessions each = 14 Total Sessions

Dashboard shows:
- All 14 sessions' events
- Stats for all combined
- Filter by specific user
- Filter by specific session
- Filter by event type

✅ One dashboard for entire system!
```

---

## 🔄 Webhook Flow Diagram

```
WhatsApp Event
    ↓
webhookDispatcher.js
    ├─ Validates URL
    ├─ Creates payload
    ├─ Generates signature
    ├─ Adds headers
    └─ Sends with retry logic
    ↓
webhook_receiver.php
    ├─ Receives POST
    ├─ Verifies signature
    ├─ Parses JSON
    ├─ Stores to file
    └─ Returns 200 OK
    ↓
webhook_log.json
    ├─ Last 100 events
    ├─ Timestamp
    └─ Full payload
    ↓
Dashboard
    ├─ Real-time display
    ├─ Statistics
    ├─ Filtering
    └─ Live refresh
```

---

## 🎓 Learning Path

1. **Start**: Read WEBHOOK_MULTIUSER_SETUP.md
2. **Setup**: Configure Node.js + PHP
3. **Test**: Use webhook.site
4. **Monitor**: View dashboard
5. **Filter**: Try filters by user/session
6. **Deploy**: Move to production
7. **Scale**: Add more users

---

**Last Updated:** 2024-03-26  
**Version:** 1.0 (Complete)  
**Status:** ✅ Production Ready
