# 🚀 WEBHOOK SETUP - QUICK REFERENCE

## ✅ STATUS: SERVER RUNNING

```
🎯 URL: http://localhost:3002
🔌 Port: 3002
✅ Status: Running
📦 Dependencies: Installed
```

---

## 📋 QUICK STEPS (আপনার জন্য বাংলায়):

### ১️⃣ **ওয়েবসাইটে যান**
```
http://localhost:3002
```

### ২️⃣ **নতুন অ্যাকাউন্ট তৈরি করুন (Register)**
- Name দিন
- Username দিন (ছোট হাতের অক্ষর, স্পেস নেই)
- Email দিন
- Password দিন

### ३️⃣ **লগইন করুন**
- Username/Email দিয়ে লগইন করুন

### ४️⃣ **সেশন তৈরি করুন**
- "Sessions" পেজে যান
- "Create Session" বাটন ক্লিক করুন
- সেশন নাম দিন (যেমন: "My Session")
- QR কোড স্ক্যান করুন মোবাইল দিয়ে
- "Connected" হওয়ার অপেক্ষা করুন ✅

### ५️⃣ **Webhook সেটআপ করুন (এটাই আসল কাজ!)**

আপনার session কার্ডে **"🔗 Webhook"** বাটন দেখবেন। ক্লিক করুন।

#### মডালে যা পাবেন:
```
📍 Current Webhook URL: (যা আছে তা দেখাবে)
📝 New Webhook URL: (এখানে নতুন URL দিন)
```

#### Webhook URL দেওয়ার অপশন:

**A) webhook.site দিয়ে (সহজ - টেস্টিং এর জন্য)**
1. https://webhook.site খুলুন 
2. আপনার ইউনিক URL কপি করুন (যেমন: `https://webhook.site/abc123...`)
3. পেস্ট করুন "New Webhook URL" তে
4. Save ক্লিক করুন

**B) আপনার নিজের সার্ভারে**
```
https://your-domain.com/webhook
```

### ६️⃣ **Save করুন এবং সম্পন্ন!** 🎉

---

## 🧪 টেস্ট করুন

### মেথড 1: webhook.site দিয়ে (সবচেয়ে সহজ)
1. https://webhook.site যান
2. আপনার অনন্য URL দিয়ে webhook সেট করুন
3. WhatsApp সেশনে যেকোনো মেসেজ পাঠান বা পান
4. webhook.site এ মেসেজ আসবে! ✅ দেখুন

### মেথড 2: লোকাল সার্ভার + ngrok
```bash
# ngrok ডাউনলোড করুন: https://ngrok.com/download

# আপনার সার্ভারে চালান
ngrok http 3000

# ngrok URL পাবেন (যেমন): https://abc123.ngrok.io
# এটি webhook URL হিসেবে ব্যবহার করুন
```

---

## 📊 Webhook Events যা পাবেন

### 1) **বার্তা পাওয়া গেলে** (`message.received`)
```json
{
  "event": "message.received",
  "timestamp": "2024-03-26T12:34:56.789Z",
  "sessionId": "session_id",
  "data": {
    "from": "1234567890",
    "message": "আমি একটা মেসেজ পাঠাচ্ছি",
    "type": "text"
  }
}
```

### 2) **বার্তা পাঠানো হলে** (`message.sent`)
```json
{
  "event": "message.sent",
  "timestamp": "2024-03-26T12:34:56.789Z",
  "sessionId": "session_id",
  "data": {
    "to": "1234567890",
    "messageId": "msg_12345",
    "status": "sent"
  }
}
```

### 3) **সেশন সংযুক্ত হলে** (`session.connected`)
```json
{
  "event": "session.connected",
  "timestamp": "2024-03-26T12:34:56.789Z",
  "sessionId": "session_id",
  "data": {
    "phoneNumber": "1234567890",
    "name": "আপনার নাম",
    "status": "connected"
  }
}
```

### 4) **সংযোগ হারালে** (`session.disconnected`)
```json
{
  "event": "session.disconnected",
  "timestamp": "2024-03-26T12:34:56.789Z",
  "data": {
    "reason": "network_error"
  }
}
```

---

## ❓ সমস্যা হলে

| সমস্যা | সমাধান |
|--------|--------|
| **Webhook URL invalid** | HTTPS এ শুরু করতে হবে |
| **Webhook firing না হচ্ছে** | Session "Connected" স্ট্যাটাসে আছে কি চেক করুন |
| **Timeout error** | webhook endpoint 10 সেকেন্ডের মধ্যে রেসপন্স দিতে হবে |
| **Network error** | ফায়ারওয়াল আউটবাউন্ড রিকোয়েস্ট ব্লক করছে কিনা চেক করুন |

---

## 🎯 পরবর্তী ধাপ (Production এ যাওয়ার আগে)

✅ Webhook URL সেট করা হয়েছে  
✅ Events পাচ্ছেন (webhook.site এ দেখেছেন)  
✅ Message পাঠানো/পাওয়া টেস্ট করেছেন  

এখন:
```
1. আপনার webhook handler তৈরি করুন
2. Production সার্ভারে deploy করুন
3. Webhook URL পরিবর্তন করুন production URL এ
4. নিয়মিত monitoring করুন
```

---

**✨ প্রস্তুত! Webhook এখন fully active!** 🎉
