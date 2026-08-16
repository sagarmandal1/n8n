import fs from "node:fs";

const target = new URL("../local-files/whatsappExpressN8nReply-current.json", import.meta.url);
const exported = JSON.parse(fs.readFileSync(target, "utf8"));
const workflow = Array.isArray(exported) ? exported[0] : exported;
const node = (name) => workflow.nodes.find((item) => item.name === name);
const upsertNode = (value) => {
  const index = workflow.nodes.findIndex((item) => item.name === value.name);
  if (index >= 0) workflow.nodes[index] = value;
  else workflow.nodes.push(value);
};

const filter = node("Filter and Deduplicate");
filter.parameters.jsCode = filter.parameters.jsCode
  .replace(
    "const message = String(data.message || '').trim().slice(0, 2000);",
    "const rawMessage = String(data.message || '').trim();\nconst hasMedia = Boolean(data.mediaUrl || data.mimeType || data.fileName || data.ocrText || data.ocrMethod);\nconst message = rawMessage.slice(0, hasMedia ? 12000 : 2000);",
  )
  .replace(
    "  webhook_event_id: String(body.id || ''),",
    "  webhook_event_id: String(body.id || ''),\n  has_media: hasMedia,\n  media_url: String(data.mediaUrl || ''),\n  media_type: String(data.mimeType || data.type || ''),\n  media_filename: String(data.fileName || ''),\n  ocr_text: String(data.ocrText || '').slice(0, 12000),\n  extraction_method: String(data.ocrMethod || 'NONE'),",
  );

node("Call DeepSeek Agent").parameters.jsonBody = "={{ JSON.stringify({ customer_id: $json.customer_id, session_id: $json.session_id, message: $json.message, message_id: $json.message_id, has_media: $json.has_media, media_url: $json.media_url, media_type: $json.media_type, media_filename: $json.media_filename, ocr_text: $json.ocr_text, extraction_method: $json.extraction_method }) }}";

node("Store Sent Reply in Memory").parameters.jsCode = node("Store Sent Reply in Memory").parameters.jsCode.replace(
  "memory_session_id: `whatsapp:${customerId}`",
  "memory_session_id: `whatsapp:${sessionId}:${customerId}`",
);

upsertNode({
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: "const item = $('Filter and Deduplicate').first().json;\nif (!item.customer_id || !item.session_id || !item.message) return [];\nreturn [{ json: { memory_session_id: `whatsapp:${item.session_id}:${item.customer_id}`, memory_message: { type: 'human', content: String(item.message).slice(0, 12000), additional_kwargs: { source: 'wafastapi_received_learning', message_id: item.message_id, media_url: item.media_url || '', media_type: item.media_type || '', media_filename: item.media_filename || '', extraction_method: item.extraction_method || 'NONE', historical: false }, response_metadata: {} } } }];",
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1500, 180],
  id: "ba111111-1111-4111-8111-111111111111",
  name: "Prepare Received Learning Memory",
});
upsertNode({
  parameters: {
    operation: "executeQuery",
    query: "INSERT INTO deepseek_customer_chat_memory (session_id, message) VALUES ($1, $2::jsonb);",
    options: { queryReplacement: "={{ [$json.memory_session_id, $json.memory_message] }}" },
  },
  type: "n8n-nodes-base.postgres",
  typeVersion: 2.6,
  position: [1740, 180],
  id: "ba222222-2222-4222-8222-222222222222",
  name: "Persist Received Learning Memory",
  credentials: { postgres: { id: "pgMemoryWhatsAppAgent01", name: "Postgres Memory - WhatsApp Agent" } },
});

workflow.connections["Auto Reply Enabled?"] = {
  main: [
    [{ node: "Prepare Received Learning Memory", type: "main", index: 0 }],
    [{ node: "Prepare Received Learning Memory", type: "main", index: 0 }],
  ],
};
workflow.connections["Prepare Received Learning Memory"] = {
  main: [[{ node: "Persist Received Learning Memory", type: "main", index: 0 }]],
};

fs.writeFileSync(target, `${JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2)}\n`);
console.log("upgraded WhatsApp media/OCR/voice intake");
