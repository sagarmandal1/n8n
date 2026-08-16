# AI Agent Training Requirements — বাংলা

## ১. উদ্দেশ্য

AI agent-কে ব্যবহারকারীর Bangla/Banglish message বুঝে নিজে নিজে কাজ করার জন্য প্রস্তুত করতে হবে। Agent শুধু উত্তর দেবে না; প্রয়োজন অনুযায়ী order, seller, customer, file, OCR, matching ও delivery status বুঝে পরবর্তী action নেবে।

## ২. Training data-এর উৎস

- ব্যবহারকারীর পুরোনো WhatsApp message
- Customer order message
- Seller group ও personal chat-এর message
- Seller-এর image/PDF reply
- Customer delivery status
- ভুল match, no-match ও manual correction-এর উদাহরণ
- ব্যবহারকারী যেভাবে ভুল ধরিয়ে দেন এবং সঠিক ব্যাখ্যা দেন

Raw message ব্যবহার করার আগে phone number, NID, birth registration number, address ও ব্যক্তিগত তথ্য mask করতে হবে।

## ৩. Message category

প্রতিটি message নিচের category-এর এক বা একাধিকটিতে label করতে হবে:

- `CUSTOMER_ORDER`: customer-এর নতুন কাজ বা তথ্য
- `SELLER_REQUEST`: seller কাজ চাইছে বা task চাইছে
- `SELLER_RESULT`: seller image/PDF/result পাঠিয়েছে
- `GROUP_TASK`: seller group-এ পাঠানো application/task
- `DELIVERY_STATUS`: file customer-এর কাছে গেছে কি না
- `OCR_STATUS`: OCR হয়েছে কি না বা OCR ভুল হয়েছে
- `MATCH_REQUEST`: কোন customer-এর file তা জানতে চাওয়া
- `TROUBLESHOOTING`: delivery, capture, webhook বা server সমস্যা
- `HUMAN_CORRECTION`: ব্যবহারকারী agent-এর ভুল ঠিক করে দিচ্ছেন
- `GENERAL_REPLY`: সাধারণ কথোপকথন

## ৪. Agent-এর শেখার নিয়ম

Agent-কে বুঝতে হবে:

- `seller`, `customer`, `group`, `personal inbox` আলাদা বিষয়।
- Seller group-এ task পাঠানো মানে seller personal inbox-এ আলাদা message পাঠানো নয়।
- Seller-এর personal inbox-এ আসা file আগে seller phone ও message time দিয়ে যাচাই করতে হবে।
- একই নামের একাধিক customer থাকলে শুধু নাম দেখে delivery করা যাবে না।
- Customer-এর order, seller-এর file এবং application তথ্য একই customer-এর কি না মিলাতে হবে।
- User যদি বলে “আগেরটা নয়”, “last file নয়”, “এই seller-এরটা”—তাহলে পুরোনো test file বাদ দিতে হবে।
- Screenshot বা visual evidence থাকলে database log-এর সঙ্গে cross-check করতে হবে।
- Database-এ message না থাকলেও screenshot-এ থাকলে capture/sync সমস্যা হিসেবে report করতে হবে।

## ৫. File matching rule

File match করার সময় priority হবে:

১. Exact verified PDF filename
২. Application ID
৩. Birth Registration Number
৪. Name + Date of Birth
৫. Name + father/mother name
৬. Name + address

কমপক্ষে দুইটি independent field না মিললে automatic delivery করা যাবে না। OCR আংশিক হলে registration number-এর reliable শেষ অংশ ব্যবহার করা যেতে পারে, তবে আরেকটি name/DOB evidence অবশ্যই থাকতে হবে।

## ৬. OCR handling

Agent-কে বুঝতে হবে:

- OCR `NONE` মানে ছবিতে তথ্য নেই—এমন নয়; OCR engine পড়তে পারেনি।
- Monitor/screen photo-তে moiré, glare, crop ও low contrast-এর কারণে OCR ভুল হতে পারে।
- OCR text ভুল হলে image visual review বা improved preprocessing দরকার।
- PDF-তে text থাকলে OCR না করে filename/text extraction ব্যবহার করতে হবে।
- OCR ব্যর্থ হলে সম্ভাব্য তথ্য ও confidence আলাদা করে দেখাতে হবে।

## ৭. Autonomous action

Agent নিজে করতে পারবে:

- Message ও file database-এ খোঁজা
- Seller/customer/group শনাক্ত করা
- Pending order খোঁজা
- OCR ও filename matching করা
- Delivery status পরীক্ষা করা
- Webhook/session error শনাক্ত করা
- Safe unique match হলে delivery queue করা
- Audit log তৈরি করা

## ৮. যেসব কাজের আগে approval দরকার

- একাধিক customer match হলে
- OCR খুব দুর্বল হলে
- Customer phone নিশ্চিত না হলে
- নতুন seller যোগ করা হলে
- Group permission পরিবর্তন হলে
- একই file পুনরায় পাঠানোর ক্ষেত্রে
- Payment/refund/complaint সংক্রান্ত কাজে
- NID, জন্মনিবন্ধন বা অন্য sensitive document ভুল customer-এ যাওয়ার সম্ভাবনা থাকলে

## ৯. Agent response format

প্রতিটি তদন্তের উত্তরে agent-কে সংক্ষেপে জানাতে হবে:

- কোন seller-এর message পাওয়া গেছে
- কখন পাওয়া গেছে
- file type ও filename
- OCR result: `OCR`, `TEXT`, `NONE`
- কোন customer/order match হয়েছে
- action: `DELIVERED`, `PENDING`, `NO_MATCH`, `AMBIGUOUS` বা `ERROR`
- সমস্যার কারণ

উদাহরণ:

```text
Seller: +8801973388955
File: image
OCR: NONE
সম্ভাব্য customer: 8801320824735
Status: PENDING
কারণ: ছবির তথ্য দেখা গেলেও OCR usable text দেয়নি; automatic delivery করা হয়নি।
```

## ১০. User correction থেকে শেখা

ব্যবহারকারী যখন বলেন:

- “এটা ওই seller-এর না”
- “last file নয়”
- “group-এ দিয়েছি, inbox-এ এসেছে”
- “screenshot-এ দেখা যাচ্ছে”
- “OCR হয়নি, ছবিতে লেখা আছে”

তখন agent-কে correction হিসেবে সংরক্ষণ করতে হবে এবং ভবিষ্যতে একই ধরনের ভুল এড়াতে হবে। Correction record-এ রাখতে হবে:

- ভুল assumption
- ব্যবহারকারীর সঠিক তথ্য
- কোন source প্রমাণ হিসেবে ব্যবহার করা হয়েছে
- ভবিষ্যতের matching rule

## ১১. Memory ও privacy

- Customer-এর sensitive document raw form-এ training dataset-এ রাখা যাবে না।
- Phone number ও document number mask করে রাখা উচিত।
- Agent-এর memory-তে শুধু প্রয়োজনীয় order context রাখা হবে।
- User correction audit করা হবে, কিন্তু public বা third-party model training-এ পাঠানো যাবে না।
- পুরোনো context-এর সঙ্গে নতুন seller/task গুলিয়ে ফেলা যাবে না।

## ১২. Evaluation ও acceptance criteria

Agent সফল ধরা হবে যদি:

- Bangla/Banglish message-এর intent সঠিকভাবে বোঝে।
- Seller group ও personal inbox আলাদা করতে পারে।
- পুরোনো test file বাদ দিতে পারে।
- Screenshot ও database log-এর mismatch ধরতে পারে।
- OCR `NONE`-কে সঠিকভাবে ব্যাখ্যা করতে পারে।
- Unique match হলে সঠিক customer শনাক্ত করে।
- Ambiguous/no-match হলে ভুল delivery না করে review চায়।
- User correction গ্রহণ করে পরের বার একই ভুল কমায়।
- প্রত্যেক action-এর কারণ ও evidence দেখাতে পারে।

## ১৩. Training process

১. Message export ও privacy masking
২. Category ও intent labeling
৩. Correct action labeling
৪. Seller/customer/group mapping
৫. OCR ও matching examples তৈরি
৬. User correction dataset তৈরি
৭. Prompt/rule/memory configuration
৮. Test set দিয়ে evaluation
৯. Human approval mode-এ চালানো
১০. Accuracy ঠিক থাকলে ধাপে ধাপে autonomous delivery চালু করা
