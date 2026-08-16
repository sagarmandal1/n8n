import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

function isPublicIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIp(address) {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = net.isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;

  try {
    normalized = new URL(`http://[${normalized}]`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }

  if (normalized.startsWith("::ffff:")) {
    return isPublicIpv4(normalized.slice(7));
  }

  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

export const isPublicWebhookIp = isPublicIp;

async function resolvePublicAddresses(hostname) {
  const cleanHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (cleanHostname === "localhost" || cleanHostname.endsWith(".localhost")) {
    throw new Error("Webhook URL cannot target localhost");
  }

  const literalFamily = net.isIP(cleanHostname);
  let addresses;
  try {
    addresses = literalFamily
      ? [{ address: cleanHostname, family: literalFamily }]
      : await dns.lookup(cleanHostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Webhook URL hostname could not be resolved");
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("Webhook URL must resolve only to public IP addresses");
  }
  return addresses;
}

export async function assertSafeWebhookUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Invalid webhook URL format");
  }

  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Webhook URL cannot contain credentials");
  }

  await resolvePublicAddresses(url.hostname);
  return url.toString();
}

export const safeWebhookAgent = new https.Agent({
  keepAlive: true,
  lookup(hostname, options, callback) {
    resolvePublicAddresses(hostname)
      .then((addresses) => {
        if (options?.all) return callback(null, addresses);
        const selected = addresses.find((entry) => !options?.family || entry.family === options.family) || addresses[0];
        callback(null, selected.address, selected.family);
      })
      .catch((error) => callback(error));
  },
});

export function redactWebhookUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-webhook-url>";
  }
}
