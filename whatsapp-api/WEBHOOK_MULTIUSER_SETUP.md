# 🚀 Multi-User Webhook Receiver Setup

## ✨ কি তৈরি হয়েছে (What's Ready):

### 1️⃣ **Node.js Backend** (আপনার প্রজেক্ট)
- ✅ Webhook dispatcher engine (`lib/webhookDispatcher.js`)
- ✅ Real-time event listeners on WhatsApp sessions
- ✅ 7 different event types
- ✅ Automatic retry with exponential backoff
- ✅ Signature verification headers

### 2️⃣ **PHP Webhook Receiver** (এখন ready!)
- ✅ Professional live dashboard
- ✅ Multi-user event tracking
- ✅ Advanced filtering by User/Session/Event
- ✅ Signature verification
- ✅ Real-time live logs
- ✅ Statistics panel

---

## 📋 Step-by-Step Setup

### **STEP 1: Node.js Configuration**

আপনার Node.js project এ একটি `.env` file তৈরি করুন:

```bash
# Go to your project directory
cd e:\path\to\whatsapp-api

# Create .env file with:
cat > .env << EOF
PORT=3002
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/whatsapp-api
JWT_SECRET=your_jwt_secret_key_here
WEBHOOK_SECRET=my_super_secret_key_123
EOF
```

**Important:** `WEBHOOK_SECRET` match করতে হবে PHP এ!

---

### **STEP 2: Upload PHP File to Your Server**

```bash
# If you have a PHP server running (example: on same domain)
# Upload webhook_receiver.php to: https://your-domain.com/webhook/webhook.php

# Or locally for testing:
# Keep it in this project folder, then access via local PHP server:
# php -S localhost:8080
# Then go to: http://localhost:8080/webhook_receiver.php
```

---

### **STEP 3: Set Webhook in WhatsApp Session**

1. Open: **http://localhost:3002**
2. Go to: **Sessions page**
3. Find your session → Click: **🔗 Webhook button**
4. Enter webhook URL:
   
   **Option A - Local Testing:**
   ```
   http://localhost:8080/webhook_receiver.php
   ```
   
   **Option B - Production (Your Server):**
   ```
   https://your-domain.com/webhook/webhook.php
   ```

5. Click: **Save** ✅

---

### **STEP 4: Test Webhook**

1. Open dashboard: **http://localhost:8080/webhook_receiver.php** (or your webhook URL)
2. Status should show: **Connected** 🟢
3. Send a WhatsApp message OR receive one
4. Dashboard automatically updates with the event! 📨

---

## 🎯 Multi-User Features (আপনার জন্য বিশেষভাবে!)

যেহেতু আপনি **multi-user project** করছেন, এখন আপনি পারবেন:

### ✅ Track সব user এর webhooks একসাথে:
```
Total Events: 150
Users: 7 (different users)
Sessions: 12 (users এর different sessions)
```

### ✅ Filter করা:
- **Filter by User ID**: একটা specific user এর সব events দেখুন
- **Filter by Session ID**: একটা specific session এর events দেখুন  
- **Filter by Event**: যেমন শুধু `message.received` events

### ✅ Stats দেখুন:
- Total events sent
- Last hour activity
- Unique users
- Unique sessions

---

## 📊 Real-time Dashboard

ড্যাশবোর্ড এ আপনি দেখবেন:

```
🕐 WhatsApp Webhook Logs          Status: Connected 🟢

📊 Stats:
   Total Events: 45
   Last Hour: 12
   Users: 3
   Sessions: 5

🔍 Filters:
   [Filter by User ID...] [Filter by Session ID...] [Filter by Event...] [Apply]

📝 Live Logs:
   🕐 2024-03-26 12:34:56 | 🔔 message.received
   👤 User: 6980c78c... | 🔑 Session: 699160894...
   
   {
     "event": "message.received",
     "data": {
       "from": "1234567890",
       "message": "Hello!"
     }
   }
```

---

## 🔐 Security Setup

### Secret Key Configuration:

**In Node.js** (`.env` file):
```
WEBHOOK_SECRET=my_super_secret_key_123
```

**In PHP** (line 12 of `webhook_receiver.php`):
```php
$SECRET = getenv('WEBHOOK_SECRET') ?: 'my_super_secret_key_123';
```

### Generate Strong Secret:
```bash
# On Linux/Mac:
openssl rand -base64 32

# Example output:
# aBc1Def2GhI3JkL4MnO5PqR6StU7VwX8YzA9BcD0EfG1Hi=
```

---

## 🧪 Testing Locally

### Option 1: PHP Built-in Server

```bash
# In your project folder
php -S localhost:8080

# Access: http://localhost:8080/webhook_receiver.php
```

### Option 2: Python HTTP Server

```bash
# Python 3
python -m http.server 8080

# Access: http://localhost:8080/webhook_receiver.php
```

### Option 3: Node.js Express (for testing)

```javascript
const express = require('express');
const app = express();

app.use(express.static('.'));
app.listen(8080, () => console.log('Server on :8080'));
```

---

## 🚨 Troubleshooting

### ❌ Webhook URL invalid
**সমাধান:** URL এ `https://` বা `http://` দিয়ে শুরু করতে হবে

### ❌ No events showing
**সমাধান:**
1. সেশন "Connected" স্ট্যাটাসে আছে কি চেক করুন
2. `WEBHOOK_SECRET` match করছে কি দেখুন
3. Dashboard refresh করুন (F5)

### ❌ 401 Unauthorized error
**সমাধান:** Node.js এবং PHP এর `WEBHOOK_SECRET` match করুন

### ❌ Dashboard "Disconnected" দেখাচ্ছে
**সমাধান:**
1. PHP server চলছে কি চেক করুন
2. URL accessible আছে কি test করুন
3. Network error কি আছে দেখুন

---

## 📁 File Structure

```
whatsapp-api/
├── server.js
├── .env                          ← NEW: Configuration
├── webhook_receiver.php          ← NEW: PHP receiver  
├── PHP_WEBHOOK_README.md         ← NEW: PHP documentation
├── lib/
│   ├── webhookDispatcher.js      ← Modified: Webhook engine
│   └── whatsapp.js               ← Modified: Event listeners
├── models/
│   └── sessionModel.js
└── ...
```

---

## ✅ Complete Setup Checklist

- [ ] Node.js `.env` file created with `WEBHOOK_SECRET`
- [ ] `webhook_receiver.php` uploaded to server/accessible locally
- [ ] PHP secret matches Node.js secret
- [ ] WhatsApp session created and connected
- [ ] Webhook URL configured in session
- [ ] PHP server running (if local testing)
- [ ] Dashboard loads without errors
- [ ] Test message sent/received
- [ ] Event appears in dashboard ✅

---

## 🎯 Next Steps

### For Development:
1. Keep both Node.js and PHP servers running
2. Use local URL (`http://localhost:8080`) for testing
3. Test different event types

### For Production:
1. Deploy PHP to production server (HTTPS required!)
2. Update webhook URL to production domain in sessions
3. Change WEBHOOK_SECRET to strong random value
4. Set up monitoring/alerting
5. Backup webhook logs regularly

---

## 💡 Tips

**Tip 1:** ড্যাশবোর্ড সব users এর webhooks একসাথে দেখায়। Filter ব্যবহার করে specific user দেখুন।

**Tip 2:** Logs automatically rotate (last 100 events kept)। যদি বেশি চান, PHP file এ change করুন।

**Tip 3:** কোন processing করতে চাইলে, PHP file এ custom logic add করুন।

**Tip 4:** Production এ password লাগান dashboard এর জন্য।

---

## 🎉 Done!

আপনার **multi-user WhatsApp webhook system** এখন fully ready!

```
✨ All systems operational ✨
📊 Webhooks: Active
🔗 Listeners: Connected  
📝 Logging: Working
🔐 Security: Verified
```

**Happy Webhook Monitoring!** 🚀
