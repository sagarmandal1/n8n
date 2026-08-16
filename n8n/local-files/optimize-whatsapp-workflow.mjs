import fs from "node:fs";

const source = "/var/www/n8n/local-files/whatsappExpressN8nReply-current.json";
const target = "/var/www/n8n/local-files/whatsappExpressN8nReply-optimized.json";
const workflows = JSON.parse(fs.readFileSync(source, "utf8"));
const workflow = workflows[0];

workflow.connections = {
  "WhatsApp Express Webhook": {
    main: [[
      { node: "Filter and Deduplicate", type: "main", index: 0 },
      { node: "Store Sent Reply in Memory", type: "main", index: 0 },
    ]],
  },
  "Store Sent Reply in Memory": {
    main: [[{ node: "Persist Sent Reply Memory", type: "main", index: 0 }]],
  },
  "Filter and Deduplicate": {
    main: [[{ node: "Check Reply Mode", type: "main", index: 0 }]],
  },
  "Check Reply Mode": {
    main: [[{ node: "Auto Reply Enabled?", type: "main", index: 0 }]],
  },
  "Auto Reply Enabled?": {
    // Auto reply is intentionally hard-disabled. Keeping both branches empty
    // prevents n8n version-specific IF output ordering from sending messages.
    main: [[], []],
  },
  "Call DeepSeek Agent": {
    main: [[{ node: "Prepare WhatsApp Reply", type: "main", index: 0 }]],
  },
  "Prepare WhatsApp Reply": {
    main: [[{ node: "Send WhatsApp Reply", type: "main", index: 0 }]],
  },
  "Send WhatsApp Reply": { main: [[]] },
};

fs.writeFileSync(target, `${JSON.stringify(workflows, null, 2)}\n`);
