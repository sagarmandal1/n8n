# 🔗 PHP Webhook Receiver - Multi-User Setup Guide

## Overview

This is a **professional PHP webhook receiver** designed for the WhatsApp API. It's specifically optimized for **multi-user environments** where different users have different WhatsApp sessions and need to track their webhook events independently.

## Features

✅ **Multi-User Support** - Track webhooks for multiple users simultaneously  
✅ **Real-Time Dashboard** - Live webhook event logging with auto-refresh  
✅ **Advanced Filtering** - Filter by User ID, Session ID, or Event type  
✅ **Signature Verification** - Secure webhook validation  
✅ **Last 100 Events** - Automatic log rotation for storage efficiency  
✅ **Beautiful UI** - Dark theme with responsive design  
✅ **Statistics** - Live stats for total events, unique users, sessions  

---

## File: `webhook_receiver.php`

### Prerequisites

- PHP 7.4+ (Tested on PHP 8+)
- File write permissions on the server
- HTTPS accessible URL (required for webhook delivery)
- Matching WEBHOOK_SECRET between Node.js and PHP

---

## Installation & Setup

### Step 1: Upload PHP File

Upload `webhook_receiver.php` to your web server:

```bash
# Example: Upload to https://your-domain.com/webhook/webhook.php
scp webhook_receiver.php user@server:/var/www/html/webhook/
```

### Step 2: Configure Secret Key

**In Node.js (`server.js` or `.env`):**
```javascript
// Option 1: Environment variable
process.env.WEBHOOK_SECRET = "my_super_secret_key_123"

// Option 2: In .env file
WEBHOOK_SECRET=my_super_secret_key_123
```

**In PHP (inside `webhook_receiver.php`):**
```php
// Line 12 - Change this to match Node.js secret!
$SECRET = getenv('WEBHOOK_SECRET') ?: 'my_super_secret_key_123';
```

Make sure **both have the same secret key**!

### Step 3: Set Webhook in Your Session

Go to WhatsApp API website (http://localhost:3002):

1. Navigate to **Sessions** page
2. Find your session → Click **🔗 Webhook** button
3. Enter webhook URL:
   ```
   https://your-domain.com/webhook/webhook.php
   ```
4. Click **Save** ✅

---

## Usage

### View Live Logs Dashboard

Open in browser:
```
https://your-domain.com/webhook/webhook.php
```

You'll see:
- 📊 **Statistics Panel**
  - Total Events: Count of all webhook events
  - Last Hour: Events in the last 60 minutes
  - Users: Unique user IDs
  - Sessions: Unique session IDs

- 🔍 **Filter Section** (Multi-user support!)
  - Filter by User ID
  - Filter by Session ID
  - Filter by Event Type
  - Click "Apply" to filter

- 📝 **Live Logs**
  - Each log shows:
    - Time of event
    - Event type (message.received, session.connected, etc.)
    - User ID (first 12 chars)
    - Session ID (first 12 chars)
    - Full JSON payload

---

## Webhook Events

### When Webhook Fires

The PHP receiver will log webhooks for:

| Event | Description |
|-------|-------------|
| `message.received` | WhatsApp message received |
| `message.sent` | Message sent via API |
| `session.connected` | Session connection successful |
| `session.disconnected` | Session lost connection |
| `session.qr_ready` | QR code generated |
| `session.reconnecting` | Auto-reconnection attempt |
| `session.logged_out` | User logged out |

### Example Webhook Payload

```json
{
  "event": "message.received",
  "timestamp": "2024-03-26T12:34:56.789Z",
  "sessionId": "6980c78c1c8fd1355d9c03c8",
  "userId": "6980c78c1c8fd1355d9c03c7",
  "data": {
    "from": "1234567890",
    "message": "Hello!",
    "type": "text"
  }
}
```

---

## Multi-User Filtering

Since the project supports multiple users, you can filter logs:

### Filter by User ID
```
Filter: 6980c78c1c8fd1355d9c03c7
Result: Shows only webhooks from this user's sessions
```

### Filter by Session ID
```
Filter: 6980c78c1c8fd1355d9c03c8
Result: Shows only webhooks from this specific session
```

### Filter by Event
```
Filter: message.received
Result: Shows only incoming messages for all users
```

### Combine Filters
You can use multiple filters together:
- User: `6980c78c1c8fd1355d9c03c7`
- Session: `6980c78c1c8fd1355d9c03c8`
- Event: `message.received`

---

## Security Considerations

### 1. Signature Verification

The PHP file verifies incoming webhooks using the `X-Webhook-Secret` header. Only requests with matching secret are accepted.

```php
$incomingSecret = $_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? '';
if (!hash_equals($SECRET, $incomingSecret)) {
    http_response_code(401);
    echo 'Unauthorized';
    exit;
}
```

### 2. Secret Key Best Practices

**DO:**
```bash
# Generate a strong secret (example)
openssl rand -base64 32
# Output: aBc1Def2GhI3JkL4MnO5PqR6StU7VwX8YzA9BcD0EfG1Hi=

# Use this value in both Node.js and PHP
```

**DON'T:**
- ❌ Don't use simple/guessable secrets
- ❌ Don't commit secrets to version control
- ❌ Don't share secrets in public repositories
- ❌ Don't use default secrets in production

### 3. HTTPS Requirement

All webhook URLs **MUST** use HTTPS for security:
```
✅ https://your-domain.com/webhook/webhook.php
❌ http://your-domain.com/webhook/webhook.php (NOT ALLOWED)
```

### 4. File Permissions

Ensure proper permissions:
```bash
# Allow PHP to write to webhook_log.json
chmod 644 webhook_receiver.php
chmod 666 webhook_log.json  # PHP needs write access
```

---

## Troubleshooting

### Problem: "Webhook not firing"

**Solution:**
1. Check secret matches in both Node.js and PHP
2. Verify webhook URL is HTTPS accessible
3. Check server logs for connection errors
4. Test with curl:
   ```bash
   curl -X POST https://your-domain.com/webhook/webhook.php \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Secret: my_super_secret_key_123" \
     -d '{"event":"test","data":{}}'
   ```

### Problem: "Dashboard shows no events"

**Solution:**
1. Check if webhook is correctly configured in sessions
2. Verify session status is "Connected"
3. Try sending a WhatsApp message
4. Refresh the dashboard (F5)

### Problem: "401 Unauthorized error"

**Solution:**
1. Check that `WEBHOOK_SECRET` matches exactly
2. Ensure no extra spaces in secret
3. Verify header name is `X-Webhook-Secret`
4. Check PHP can read environment variables

### Problem: "Permission denied writing logs"

**Solution:**
```bash
# Fix file permissions
chmod 666 webhook_log.json
# Or create with proper permissions
touch webhook_log.json && chmod 666 webhook_log.json
```

---

## Advanced: Processing Webhooks

If you want to process webhooks (not just log them), add your custom logic:

```php
// Add this after line 150 (after signature verification)

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // ... existing signature check code ...

    // ADD YOUR CUSTOM PROCESSING HERE
    $event = $data['event'] ?? '';
    $userId = $data['userId'] ?? '';
    $sessionId = $data['sessionId'] ?? '';

    switch($event) {
        case 'message.received':
            // Process incoming message
            processIncomingMessage($data, $userId, $sessionId);
            break;

        case 'session.connected':
            // Update session status in your DB
            updateSessionStatus($sessionId, 'connected');
            break;

        case 'session.disconnected':
            // Alert about disconnection
            alertDisconnection($sessionId);
            break;
    }

    // ... rest of the code ...
}

function processIncomingMessage($data, $userId, $sessionId) {
    // Your custom logic here
    // Example: Send to your CRM, database, notification service, etc.
    error_log("Message from {$data['data']['from']}: {$data['data']['message']}");
}
```

---

## Integration with Node.js

### How It Works

```
WhatsApp Event (Node.js)
    ↓
webhookDispatcher.js triggers
    ↓
POST to webhook URL with signature
    ↓
webhook_receiver.php (this file)
    ↓
Validates signature
    ↓
Stores in webhook_log.json
    ↓
Display in dashboard
```

### Making Sure It Works

1. **Check Node.js `.env`:**
   ```
   WEBHOOK_SECRET=my_super_secret_key_123
   ```

2. **Check PHP top of file (line ~12):**
   ```php
   $SECRET = 'my_super_secret_key_123';  // Must match!
   ```

3. **Test the connection:**
   ```bash
   # Restart Node.js server
   npm run dev
   
   # Watch PHP logs
   tail -f /var/log/php-errors.log
   ```

---

## Performance Notes

- **Log Storage**: Last 100 events kept (auto-rotates)
- **File Size**: Typically 50-200KB for 100 events
- **Live Refresh**: Every 2 seconds (adjustable)
- **Filter Speed**: Instant on client-side (no server delay)
- **Concurrent Users**: Supports unlimited webhook sources

---

## FAQ

**Q: Can I change the log retention from 100 to 1000 events?**  
A: Yes, change line `let $logs = array_slice($logs, -100);` to `-1000`

**Q: Where are logs stored?**  
A: In `webhook_log.json` file in same directory as PHP file

**Q: Can I export logs?**  
A: Yes, download `webhook_log.json` directly or add export button

**Q: Does it work with multiple webhook URLs?**  
A: Yes! One webhook receiver can be used by multiple sessions

**Q: Is the dashboard accessible without password?**  
A: Currently yes, consider adding auth in production

---

## Production Checklist

- [ ] Change `WEBHOOK_SECRET` to strong random value
- [ ] Use HTTPS (SSL certificate required)
- [ ] Set proper file permissions (644 for PHP, 666 for JSON)
- [ ] Consider adding basic auth to dashboard
- [ ] Set up log rotation for long-term storage
- [ ] Monitor webhook failures in production
- [ ] Test failover scenarios
- [ ] Document your webhook processing logic

---

**Ready to use!** 🚀 Open the dashboard and start monitoring webhooks.
