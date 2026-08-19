import axios from "axios";
import WebSocket from "ws";

const DEBUG_PORT = Number(process.env.GOOGLE_LENS_DEBUG_PORT || 9223);
let activeRequest = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1_000_000_000);
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    const onMessage = (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      if (message.error) reject(new Error(message.error.message || method));
      else resolve(message.result || {});
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await cdp(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
}

async function getPageTarget() {
  const { data } = await axios.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, { timeout: 3000 });
  const page = data.find((entry) => entry.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("Verified Google Chrome session is not available");
  return page;
}

async function uploadToLens(ws, imagePath) {
  // Page.navigate can recover a stale Google renderer even when
  // Runtime.evaluate/Page.enable are temporarily unresponsive.
  // Navigate first, then use Runtime/DOM commands on the recovered page.
  await cdp(ws, "Page.navigate", { url: "https://www.google.com/?hl=en" });
  await sleep(2500);

  const alreadyOpen = await evaluate(ws, `(() => document.body?.innerText?.includes('Search any image with Google Lens'))()`);
  if (!alreadyOpen) await evaluate(ws, `(() => {
    const button = document.querySelector('[aria-label="Search by image"]');
    if (button) button.click();
    return Boolean(button);
  })()`);
  await sleep(700);

  const doc = await cdp(ws, "DOM.getDocument", { depth: -1 });
  const inputs = await cdp(ws, "DOM.querySelectorAll", {
    nodeId: doc.root.nodeId,
    selector: 'input[type="file"]',
  });
  if (!inputs.nodeIds?.length) throw new Error("Google Lens upload control was not found");
  for (const nodeId of inputs.nodeIds) {
    await cdp(ws, "DOM.setFileInputFiles", { nodeId, files: [imagePath] });
  }
  await evaluate(ws, `(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    for (const input of inputs) input.dispatchEvent(new Event('change', { bubbles: true }));
    return inputs.some((input) => input.files && input.files.length);
  })()`);
  // Upload navigation is asynchronous and can take longer on a VPS. Poll
  // for the Lens result instead of reading the upload dialog too early.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const url = String(await evaluate(ws, "location.href") || "");
    if (/google\.com\/search\?[^ ]*vsrid=/u.test(url)) break;
    await sleep(1000);
  }

  // Lens sometimes opens the result with a Text tab. Selecting it exposes
  // the OCR panel while remaining compatible with the current web UI.
  await evaluate(ws, `(() => {
    const items = [...document.querySelectorAll('button,[role="button"]')];
    const textButton = items.find((el) => /^text$/i.test((el.innerText || '').trim()));
    if (textButton) textButton.click();
    return location.href;
  })()`);
  await sleep(2500);
  const body = String(await evaluate(ws, "document.body ? document.body.innerText : ''") || "").trim();
  // Keep Google's useful AI overview/visible-details section in `text`.
  // The complete page remains available as `raw_text` for debugging.
  const start = body.search(/The image shows|Document Type:|Visible Details:/u);
  if (start >= 0) {
    const remainder = body.slice(start);
    const stops = [remainder.indexOf("\nShow more"), remainder.indexOf("\nVisual matches"), remainder.indexOf("\nWeb results")]
      .filter((index) => index >= 0);
    return remainder.slice(0, stops.length ? Math.min(...stops) : remainder.length).trim();
  }
  return body;
}

export async function extractGoogleLensText(imagePath) {
  if (!imagePath) return { text: "", method: "NONE", error: "Missing image path" };
  if (activeRequest) return { text: "", method: "NONE", error: "Google Lens OCR is busy; try again shortly" };
  activeRequest = (async () => {
    let ws;
    try {
      const page = await getPageTarget();
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      const text = await uploadToLens(ws, imagePath);
      if (!text || /unusual traffic|sorry\/index|captcha/i.test(text)) {
        return { text: "", method: "NONE", error: "Google Lens verification/block page detected" };
      }
      return { text, method: "GOOGLE_LENS_WEB", error: null };
    } catch (error) {
      return { text: "", method: "NONE", error: error.message || "Google Lens OCR failed" };
    } finally {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    }
  })();
  try {
    return await activeRequest;
  } finally {
    activeRequest = null;
  }
}
