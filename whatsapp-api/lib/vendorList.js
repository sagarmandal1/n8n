import fs from "fs";
import path from "path";
import { normalizePhone } from "./dynamicOrderDelivery.js";

const VENDOR_FILE = process.env.VENDOR_LIST_FILE
  || path.join(process.cwd(), "vendors.txt");

// Re-read only when the file's mtime changes, so edits take effect without a
// restart while a busy inbox does not re-parse the file on every message.
let cache = { mtimeMs: 0, size: -1, vendors: new Map() };

function parse(contents) {
  const vendors = new Map();
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Accept comma, pipe, colon or tab between the name and the number, and
    // tolerate a missing name so a bare number on its own line still works.
    const parts = line.split(/\s*[,|:\t]\s*/).filter(Boolean);
    const numberPart = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    const namePart = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";

    const phone = normalizePhone(String(numberPart || "").replace(/\D/g, ""));
    // Reject anything too short to be a real number rather than silently
    // treating a typo as a vendor — a wrong entry here would stop a genuine
    // customer's order from ever being created.
    if (!phone || phone.length < 10) continue;

    vendors.set(phone, namePart || phone);
  }
  return vendors;
}

function load() {
  try {
    const stat = fs.statSync(VENDOR_FILE);
    if (stat.mtimeMs !== cache.mtimeMs || stat.size !== cache.size) {
      const vendors = parse(fs.readFileSync(VENDOR_FILE, "utf8"));
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, vendors };
      console.log(`[Vendors] loaded ${vendors.size} vendor(s) from ${VENDOR_FILE}`);
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[Vendors] cannot read ${VENDOR_FILE}:`, err.message);
    } else if (cache.mtimeMs !== -1) {
      // Announce a missing file once, then stay quiet.
      console.warn(`[Vendors] ${VENDOR_FILE} not found — every sender is treated as a customer`);
      cache = { mtimeMs: -1, size: -1, vendors: new Map() };
    }
  }
  return cache.vendors;
}

// Vendors entered through the dashboard, kept in memory so isVendor() stays
// synchronous — it runs on every inbound message and several of its callers are
// not async. The session controller pushes updates here on save, and the message
// handler refreshes on a short TTL so a change made in another process is picked
// up without a restart.
let dbVendors = new Map();
let dbLoadedAt = 0;

/** Replace the dashboard-managed vendor set. Values may be 01… or 8801… form. */
export function setDbVendors(entries = []) {
  const next = new Map();
  for (const entry of entries) {
    const raw = typeof entry === "string" ? entry : entry?.number;
    const label = typeof entry === "string" ? "" : entry?.name || "";
    const phone = normalizePhone(String(raw || "").replace(/\D/g, ""));
    if (phone && phone.length >= 10) next.set(phone, label || phone);
  }
  dbVendors = next;
  dbLoadedAt = Date.now();
}

/** True when the dashboard-managed set is older than `ttlMs`. */
export function dbVendorsStale(ttlMs = 15000) {
  return Date.now() - dbLoadedAt > ttlMs;
}

/** All configured vendors as a Map of normalised phone → display name. */
export function getVendors() {
  // The file and the dashboard list are both authoritative; either marks a
  // number as a vendor. The file wins on a label clash, being the explicit one.
  return new Map([...dbVendors, ...load()]);
}

/** True when this number belongs to a configured vendor. */
export function isVendor(phone) {
  const normalized = normalizePhone(String(phone || "").replace(/\D/g, ""));
  if (!normalized) return false;
  return load().has(normalized) || dbVendors.has(normalized);
}

/** Display name for a vendor, or "" when the number is not a vendor. */
export function vendorName(phone) {
  const normalized = normalizePhone(String(phone || "").replace(/\D/g, ""));
  return load().get(normalized) || dbVendors.get(normalized) || "";
}
