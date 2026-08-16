# SaaS Update Phase II - Tasks

## Phase II (Approved)

### 1. 👑 Super Admin Panel
- `[x]` 1. Add `role: 'admin' | 'user'` to `userModel.js`.
- `[x]` 2. Build `middlewares/authMiddleware.js` function `isAdmin`.
- `[x]` 3. Create `models/settingsModel.js` for Gateway Settings.
- `[x]` 4. Build `controllers/adminController.js` logic and `routers/adminRouter.js`.
- `[x]` 5. Design UI dashboard for `/admin` management.

### 2. 🖼️ Media/File Support
- `[x]` 6. Add `multer` upload logic for `/api/campaigns` and `/api/autoreply`.
- `[x]` 7. Build a Cron Job to auto-delete uploads after 24 hours to clear server space.
- `[ ]` 8. Expand `lib/whatsapp.js` engine to accept media payloads for broadcasts.
- `[ ]` 9. Modify `campaigns.html` & `chatbot.html` forms to support file attachments visually.

### 3. 📊 Dashboard Analytics
- `[ ]` 10. Implement `Chart.js` graphs inside `views/sessions.html`.
- `[ ]` 11. Add an `/api/session/analytics` data endpoint.

### 4. 📄 CSV/Excel Importer
- `[ ]` 12. Integrate `PapaParse` into `campaigns.html`.
- `[ ]` 13. Enable "Paste from Excel/CSV" client-side drag-and-drop.

### 5. 🤖 VIP ChatGPT VIP Bot
- `[ ]` 14. Expand `sessionModel.js` with `aiEnabled`, `openAiKey`, and `aiPrompt`.
- `[ ]` 15. Create `lib/openai.js` helper.
- `[ ]` 16. Implement AI Fallback logic inside `lib/whatsapp.js` `messages.upsert` handler.
- `[ ]` 17. Add UI toggles to `views/chatbot.html`.
