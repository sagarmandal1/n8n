import fs from "node:fs";

const workflowPath = new URL("../local-files/deepseek-chat-workflow.json", import.meta.url);
const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

const byName = (name) => workflow.nodes.find((node) => node.name === name);
const upsertNode = (node) => {
  const index = workflow.nodes.findIndex((candidate) => candidate.name === node.name);
  if (index >= 0) workflow.nodes[index] = node;
  else workflow.nodes.push(node);
};

const entityCode = String.raw`const item = $input.first().json;
const text = String(item.normalized_message || item.message || '');
const normalizeDigits = (value = '') => String(value).replace(/[০-৯]/g, (digit) => '০১২৩৪৫৬৭৮৯'.indexOf(digit));
const first = (patterns) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return '';
};
const applicationId = normalizeDigits(first([/(?:application\s*id|আবেদনপত্র\s*নম্বর|আবেদন\s*নম্বর)\s*[:#：ঃ-]?\s*([০-৯\d]{6,20})/iu]));
const birthRegistrationNumber = normalizeDigits(first([/(?:birth\s*registration\s*(?:number|no)|জন্ম\s*নিবন্ধন\s*(?:নম্বর|নং))\s*[:#：ঃ-]?\s*([০-৯\d]{15,20})/iu]));
const dob = normalizeDigits(first([/(?:date\s*of\s*birth|dob|জন্ম\s*তারিখ)\s*[:：ঃ-]?\s*([০-৯\d]{1,2}[\/.-][০-৯\d]{1,2}[\/.-][০-৯\d]{4})/iu, /(?:^|\n)\s*([০-৯\d]{1,2}[\/.-][০-৯\d]{1,2}[\/.-][০-৯\d]{4})\s*$/imu])).replace(/[.-]/g, '/');
const englishName = first([/name\s*\(\s*english\s*\)\s*[:：ঃ-]?\s*([^\n\r]+)/iu, /name\s*english\s*[:：ঃ-]?\s*([^\n\r]+)/iu]);
const name = first([/(?:^|\n)\s*(?:নাম(?:\s+বাংলা)?(?:\s+নাম)?|name(?!\s*\())\s*[:：ঃ-]?\s*([^\n\r]+)/imu]);
const fatherName = first([/(?:father(?:'s)?\s*name|পিতার\s*নাম|পিতাঃ|পিতা)\s*[:：ঃ-]?\s*([^\n\r]+)/iu]);
const motherName = first([/(?:mother(?:'s)?\s*name|মাতার\s*নাম|মাতাঃ|মাতা)\s*[:：ঃ-]?\s*([^\n\r]+)/iu]);
const address = first([/(?:office\s*address|permanent\s*address|স্থায়ী\s*ঠিকানা|ঠিকানা|গ্রাম)\s*[:：ঃ-]?\s*([^\n\r]+)/iu]);
const trxId = first([/(?:trx\s*id|trxid|transaction\s*id)\s*[:#：ঃ-]?\s*([A-Za-z0-9_-]{8,64})/iu]);
const entities = Object.fromEntries(Object.entries({ applicationId, birthRegistrationNumber, name, englishName, dob, fatherName, motherName, address, trxId }).filter(([, value]) => value));
return [{ json: { ...item, entities, entity_count: Object.keys(entities).length } }];`;

const missingCode = String.raw`const item = $input.first().json;
const entities = item.entities || {};
const present = [];
if (entities.applicationId) present.push('applicationId');
if (entities.name || entities.englishName) present.push('name');
if (entities.dob) present.push('dob');
if (entities.fatherName) present.push('fatherName');
if (entities.motherName) present.push('motherName');
if (entities.address) present.push('address');
if (entities.birthRegistrationNumber) present.push('birthRegistrationNumber');
const missing = [];
if (present.length < 2) {
  if (!present.includes('name')) missing.push('name');
  if (!present.includes('dob')) missing.push('dob');
  if (present.length + missing.length < 2) missing.push('fatherName অথবা motherName');
}
const birthYear = Number(String(entities.dob || '').split('/').at(-1) || 0);
let ageBracket = '';
let requiredDocuments = [];
if (birthYear && birthYear < 2002) {
  ageBracket = 'BEFORE_2002';
  requiredDocuments = ['নিজের NID অথবা passport/online birth certificate'];
} else if (birthYear >= 2002 && birthYear <= 2012) {
  ageBracket = '2002_TO_2012';
  requiredDocuments = ['পিতার NID', 'মাতার NID'];
} else if (birthYear > 2012) {
  ageBracket = 'AFTER_2012';
  requiredDocuments = ['পিতার NID', 'মাতার NID', 'পিতা-মাতার online birth certificate', 'টিকা কার্ড'];
}
return [{ json: { ...item, match_readiness: { present_fields: present, matched_field_count: present.length, safe_two_field_ready: present.length >= 2, missing_fields: missing }, age_bracket: ageBracket, required_documents: requiredDocuments } }];`;

const toolCredential = { httpHeaderAuth: { id: "waExpressReplyApi01", name: "WhatsApp Express - Reply API" } };
const httpTool = ({ name, id, url, description, body, position }) => ({
  parameters: {
    toolDescription: description,
    method: "POST",
    url,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    specifyHeaders: "keypair",
    parametersHeaders: { values: [{ name: "Content-Type", valueProvider: "fieldValue", value: "application/json" }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: body,
    optimizeResponse: true,
    responseType: "json",
  },
  type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
  typeVersion: 1.1,
  position,
  id,
  name,
  credentials: toolCredential,
});

// n8n 2.34's dynamic Agent execution currently attempts to execute connected
// HTTP/Code tool subnodes as regular nodes. Preload authoritative live data in
// the main path instead, so the answer never depends on whether the model
// chooses (or manages) to invoke a tool.
const obsoleteToolNames = [
  "Calculator",
  "Digital Document Requirements Tool",
  "Online Service Timeline Tool",
  "Digital Payment Validator Tool",
  "Live Customer & Order Context Tool",
  "OCR Match & Delivery Decision Tool",
  "Dynamic Service Knowledge Tool",
  "Real Payment Verification Tool",
];
workflow.nodes = workflow.nodes.filter((node) => !obsoleteToolNames.includes(node.name));
for (const name of obsoleteToolNames) delete workflow.connections[name];

upsertNode({
  parameters: { mode: "runOnceForAllItems", jsCode: entityCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [880, 0],
  id: "e1111111-1111-4111-8111-111111111111",
  name: "Entity & Form Extractor",
});
upsertNode({
  parameters: { mode: "runOnceForAllItems", jsCode: missingCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1100, 0],
  id: "e2222222-2222-4222-8222-222222222222",
  name: "Missing Information & Match Readiness",
});

upsertNode({
  parameters: {
    method: "POST",
    url: "https://wafastapi.com/api/agent/analyze",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ phone: $json.customerId, message: $json.normalized_message, messageId: $json.messageId, hasMedia: Boolean($json.source?.mediaUrl || $json.source?.mediaType || $json.source?.ocrText), ocrText: $json.source?.ocrText || '' }) }}",
    options: { timeout: 30000 },
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1540, 0],
  id: "e3333333-3333-4333-8333-333333333333",
  name: "Live CRM, Order, OCR, Payment & Service Analyzer",
  alwaysOutputData: true,
  onError: "continueRegularOutput",
  credentials: toolCredential,
});
upsertNode({
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: "const original = $('[FILTER 4] Urgency, VIP & Service Package Injector').first().json;\nconst response = $input.first().json || {};\nconst live = response.success && response.analysis ? response.analysis : { unavailable: true, error: response.error?.message || response.error || 'Live analyzer unavailable' };\nconst selected = live.selectedService || null;\nreturn [{ json: { ...original, live_analysis: live, live_analysis_available: !live.unavailable, service_category: selected?.name || original.service_category, service_code: selected?.code || original.service_code, digital_delivery_time: selected?.deliveryTime || original.digital_delivery_time } }];",
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1760, 0],
  id: "e4444444-4444-4444-8444-444444444444",
  name: "Merge Authoritative Live Context",
});
upsertNode({
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: "const item = $input.first().json;\nconst live = item.live_analysis || {};\nconst requiresReview = Boolean(live.humanReviewRequired || live.documentAssessment?.needsReview || (live.payment && !live.payment.verified));\nlet reviewReason = '';\nif (live.documentAssessment?.needsReview) reviewReason = live.documentAssessment.decision || 'DOCUMENT_REVIEW';\nelse if (live.payment && !live.payment.verified) reviewReason = live.payment.status || 'PAYMENT_REVIEW';\nreturn [{ json: { ...item, requires_human_review: requiresReview, review_reason: reviewReason, delivery_authorized: live.documentAssessment?.autoDeliver === true && live.documentAssessment?.decision === 'UNIQUE_MATCH' } }];",
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1980, 0],
  id: "e5555555-5555-4555-8555-555555555555",
  name: "Confidence & Human Review Gate",
});

const filter3 = byName("[FILTER 3] PII Privacy & Security Shield");
const filter1 = byName("[FILTER 1] Spam & Payload Guard");
const filter4 = byName("[FILTER 4] Urgency, VIP & Service Package Injector");
const decision = byName("Needs DeepSeek AI?");
const agent = byName("AI Agent");
const filter5 = byName("[FILTER 5] Anti-Hallucination & Output Compliance");
const profiler = byName("CRM Lead & Digital Order Profiler");
const escalation = byName("Escalation Triage & Fast Router");
const respond = byName("Respond to Webhook");
const memory = byName("Postgres Customer Memory");

filter4.position = [1320, 0];
decision.position = [2220, 0];
agent.position = [2480, -160];
filter5.position = [2740, -160];
profiler.position = [2980, -160];
escalation.position = [2740, 80];
respond.position = [3500, 0];
filter1.parameters.jsCode = filter1.parameters.jsCode
  .replace(
    "const fullMessage = String(rawMessage).trim();\nconst message = fullMessage.slice(0, 2000);",
    "const fullMessage = String(rawMessage).trim();\nconst mediaPayload = Boolean(source.has_media || source.ocr_text || source.ocrText || source.media_url || source.mediaUrl || source.media_type || source.mimeType);\nconst maxMessageLength = mediaPayload ? 12000 : 2000;\nconst message = fullMessage.slice(0, maxMessageLength);",
  )
  .replace("const isTooLong = fullMessage.length > 2000;", "const isTooLong = fullMessage.length > maxMessageLength;")
  .replace("    fullMessage,\n    message,", "    fullMessage,\n    mediaPayload,\n    maxMessageLength,\n    message,");
memory.parameters.sessionKey = "={{ 'whatsapp:' + ($json.source?.session_id || $json.source?.sessionId || 'direct') + ':' + $json.customerId }}";
memory.parameters.contextWindowLength = 15;
decision.parameters.conditions.boolean[0].value1 = decision.parameters.conditions.boolean[0].value1.replace(
  "if (!$json.validCustomer || $json.is_spam || $json.is_prompt_injection || $json.is_risky) return false;",
  "if (!$json.validCustomer || $json.is_spam || $json.is_prompt_injection || $json.is_risky || $json.requires_human_review) return false;",
);

agent.parameters.text = "={{ 'Customer number: ' + $json.customerId + '\\nRequired reply language:\\n' + ($json.reply_language === 'en' ? 'English only' : 'Bengali script only') + '\\n\\nTarget Service Package:\\n' + $json.service_category + ' (Estimated Delivery: ' + $json.digital_delivery_time + ')\\n\\nCustomer Lead Tier & Sentiment:\\n' + $json.lead_tier + ' | Sentiment: ' + $json.sentiment + '\\n\\nExtracted entities:\\n' + JSON.stringify($json.entities || {}) + '\\n\\nMissing information / match readiness:\\n' + JSON.stringify($json.match_readiness || {}) + '\\n\\nAuthoritative live CRM/order/OCR/payment/service analysis:\\n' + JSON.stringify($json.live_analysis || {}) + '\\n\\nCustomer message and OCR/transcription content:\\n' + $json.normalized_message + '\\n\\nVerified Business Context:\\n' + JSON.stringify($json.body?.business_context ?? {}) + '\\n\\nCustomer CRM Context supplied by caller:\\n' + JSON.stringify($json.body?.crm_context ?? {}) + '\\n\\nConversation History supplied by caller:\\n' + JSON.stringify($json.body?.crm_context?.conversationHistory ?? []) }}";
agent.parameters.options.systemMessage = agent.parameters.options.systemMessage.replace(/\n\nLive-tool policy:[\s\S]*$/u, "");
const liveContextPolicy = "\n\nLive-context policy:\n- The Authoritative live analysis is already loaded before you answer. Use its order status, history, role, service, payment and document decision as facts.\n- Never approve delivery unless documentAssessment.autoDeliver=true and decision=UNIQUE_MATCH.\n- Only payment.status=VERIFIED means paid.\n- If live analysis is unavailable, ambiguous, conflicting, unverified or missing required information, do not guess; request the missing information or route to human review.";
if (!agent.parameters.options.systemMessage.includes("Live-context policy:")) agent.parameters.options.systemMessage += liveContextPolicy;

const complianceCode = filter5.parameters.jsCode;
filter5.parameters.jsCode = complianceCode
  .replace("খরচ ও ১ দিনের মধ্যে ডেলিভারির বিস্তারিত জানিয়ে দেব।", "খরচ ও সম্ভাব্য ডেলিভারির সময় জানিয়ে দেব।")
  .replace(
    /    reason: failed \? 'deepseek_unavailable' : 'deepseek_ai_agent',[\s\S]*?    message_id: routed\.messageId,/u,
    "    reason: failed ? 'deepseek_unavailable' : 'deepseek_ai_agent',\n    service_code: routed.service_code,\n    customer_id: routed.customerId,\n    customer_ref: routed.customer_ref,\n    entities: routed.entities || {},\n    match_readiness: routed.match_readiness || {},\n    missing_fields: routed.match_readiness?.missing_fields || [],\n    message_id: routed.messageId,",
  );

profiler.parameters.jsCode = profiler.parameters.jsCode.replace(
  "    ...item,\n    lifecycle_stage,",
  "    ...item,\n    lifecycle_stage,",
);
escalation.parameters.jsCode = escalation.parameters.jsCode.replace(
  /    reason,[\s\S]*?    message_id: item\.messageId/u,
  "    reason,\n    intent: handoff ? 'sensitive_handoff' : 'fast_rule',\n    specialist_persona: item.specialist_persona,\n    sentiment: item.sentiment,\n    lead_tier: item.lead_tier,\n    urgency_score: item.urgency_score,\n    service_category: item.service_category,\n    service_code: item.service_code,\n    customer_id: item.customerId,\n    customer_ref: item.customer_ref,\n    entities: item.entities || {},\n    match_readiness: item.match_readiness || {},\n    missing_fields: item.match_readiness?.missing_fields || [],\n    message_id: item.messageId",
);
if (!escalation.parameters.jsCode.includes("item.requires_human_review")) {
  escalation.parameters.jsCode = escalation.parameters.jsCode.replace(
    "} else if (item.is_prompt_injection) {",
    "} else if (item.requires_human_review) {\n  reply = item.review_reason === 'NOT_FOUND'\n    ? 'পেমেন্টটি স্বয়ংক্রিয়ভাবে যাচাই হয়নি। আমাদের টিম TrxID দেখে নিশ্চিত করছে।'\n    : 'ফাইল বা অর্ডারের তথ্য নিশ্চিতভাবে মেলেনি। ভুল ডেলিভারি এড়াতে আমাদের টিম যাচাই করছে।';\n  handoff = true;\n  priority = 'P1_HIGH';\n  reason = item.review_reason || 'live_analysis_review';\n} else if (item.is_prompt_injection) {",
  );
}

respond.parameters.responseBody = `={
  "success": {{ $json.success ?? true }},
  "reply": {{ JSON.stringify($json.reply || '') }},
  "confidence": {{ $json.confidence ?? ($json.handoff ? 0.9 : 0.95) }},
  "used_deepseek": {{ $json.used_deepseek ?? false }},
  "handoff": {{ $json.handoff ?? false }},
  "priority_level": {{ JSON.stringify($json.priority_level || 'NORMAL') }},
  "lead_tier": {{ JSON.stringify($json.lead_tier || 'STANDARD') }},
  "urgency_score": {{ $json.urgency_score ?? 5 }},
  "service_category": {{ JSON.stringify($json.service_category || 'Digital Services') }},
  "service_code": {{ JSON.stringify($json.service_code || 'SRV_GENERAL') }},
  "intent": {{ JSON.stringify($json.intent || 'general_inquiry') }},
  "specialist_persona": {{ JSON.stringify($json.specialist_persona || 'general_support') }},
  "sentiment": {{ JSON.stringify($json.sentiment || 'neutral') }},
  "lifecycle_stage": {{ JSON.stringify($json.lifecycle_stage || 'inquiry') }},
  "next_best_action": {{ JSON.stringify($json.next_best_action || '') }},
  "digital_delivery_mode": {{ JSON.stringify($json.digital_delivery_mode || 'WhatsApp PDF') }},
  "entities": {{ JSON.stringify($json.entities || {}) }},
  "match_readiness": {{ JSON.stringify($json.match_readiness || {}) }},
  "missing_fields": {{ JSON.stringify($json.missing_fields || []) }},
  "reason": {{ JSON.stringify($json.reason || 'ok') }},
  "customer_ref": {{ JSON.stringify($json.customer_ref || '') }},
  "message_id": {{ JSON.stringify($json.message_id || '') }}
}`;

const auditNode = ({ name, id, position }) => ({
  parameters: {
    method: "POST",
    url: "https://wafastapi.com/api/agent/audit",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ eventType: 'AGENT_RESPONSE', customerPhone: $json.customer_id, messageId: $json.message_id, outcome: $json.reason, confidence: $json.confidence, needsReview: $json.handoff, details: { intent: $json.intent, sentiment: $json.sentiment, lifecycleStage: $json.lifecycle_stage, serviceCode: $json.service_code, entities: $json.entities, role: 'customer' } }) }}",
    options: { timeout: 10000 },
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position,
  id,
  name,
  alwaysOutputData: true,
  onError: "continueRegularOutput",
  credentials: toolCredential,
});
upsertNode(auditNode({ name: "Audit AI Decision", id: "e6666666-6666-4666-8666-666666666666", position: [3220, -260] }));
upsertNode(auditNode({ name: "Audit Fast Decision", id: "e7777777-7777-4777-8777-777777777777", position: [3020, 120] }));

workflow.connections[filter3.name] = { main: [[{ node: "Entity & Form Extractor", type: "main", index: 0 }]] };
workflow.connections["Entity & Form Extractor"] = { main: [[{ node: "Missing Information & Match Readiness", type: "main", index: 0 }]] };
workflow.connections["Missing Information & Match Readiness"] = { main: [[{ node: filter4.name, type: "main", index: 0 }]] };
workflow.connections[filter4.name] = { main: [[{ node: "Live CRM, Order, OCR, Payment & Service Analyzer", type: "main", index: 0 }]] };
workflow.connections["Live CRM, Order, OCR, Payment & Service Analyzer"] = { main: [[{ node: "Merge Authoritative Live Context", type: "main", index: 0 }]] };
workflow.connections["Merge Authoritative Live Context"] = { main: [[{ node: "Confidence & Human Review Gate", type: "main", index: 0 }]] };
workflow.connections["Confidence & Human Review Gate"] = { main: [[{ node: decision.name, type: "main", index: 0 }]] };
workflow.connections[profiler.name] = { main: [[
  { node: respond.name, type: "main", index: 0 },
  { node: "Audit AI Decision", type: "main", index: 0 },
]] };
workflow.connections[escalation.name] = { main: [[
  { node: respond.name, type: "main", index: 0 },
  { node: "Audit Fast Decision", type: "main", index: 0 },
]] };

workflow.settings.executionTimeout = 300;
workflow.settings.errorWorkflow = "deepseekAgentErrorAudit";
workflow.versionId = undefined;
workflow.activeVersionId = undefined;
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`upgraded ${workflow.nodes.length} nodes`);
