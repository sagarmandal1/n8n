import { normalizePhone } from "./dynamicOrderDelivery.js";

// Dashboard-managed vendors are STRICTLY scoped to one WaFastAPI tenant/session.
// No global vendors.txt fallback is used here: a global file would allow one
// customer's vendor identity to leak into another customer's WhatsApp session.
//
// key: "<userId>:<sessionId>"
// value: { vendors: Map(normalizedPhone -> displayName), loadedAt: timestamp }
const vendorScopes = new Map();

function scopeKey(userId, sessionId) {
  return `${String(userId || "")}:${String(sessionId || "")}`;
}

function normalizeVendorEntries(entries = []) {
  const vendors = new Map();

  for (const entry of entries) {
    const raw = typeof entry === "string" ? entry : entry?.number;
    const label = typeof entry === "string" ? "" : entry?.name || "";

    const phone = normalizePhone(String(raw || "").replace(/\D/g, ""));
    if (!phone || phone.length < 10) continue;

    vendors.set(phone, label || phone);
  }

  return vendors;
}

/**
 * Replace the vendor set for ONE user + ONE WhatsApp session.
 * Passing [] intentionally clears that session's runtime vendor list.
 */
export function setDbVendors(userId, sessionId, entries = []) {
  const key = scopeKey(userId, sessionId);

  vendorScopes.set(key, {
    vendors: normalizeVendorEntries(entries),
    loadedAt: Date.now(),
  });
}

/** True when this exact tenant/session cache needs refreshing from MongoDB. */
export function dbVendorsStale(userId, sessionId, ttlMs = 15000) {
  const scoped = vendorScopes.get(scopeKey(userId, sessionId));
  if (!scoped) return true;

  return Date.now() - scoped.loadedAt > ttlMs;
}

/** Vendors configured for THIS tenant/session only. */
export function getVendors(userId, sessionId) {
  const scoped = vendorScopes.get(scopeKey(userId, sessionId));
  return new Map(scoped?.vendors || []);
}

/** True only when phone is a vendor for THIS tenant/session. */
export function isVendor(userId, sessionId, phone) {
  const normalized = normalizePhone(String(phone || "").replace(/\D/g, ""));
  if (!normalized) return false;

  return getVendors(userId, sessionId).has(normalized);
}

/** Display name for a vendor in THIS tenant/session. */
export function vendorName(userId, sessionId, phone) {
  const normalized = normalizePhone(String(phone || "").replace(/\D/g, ""));
  if (!normalized) return "";

  return getVendors(userId, sessionId).get(normalized) || "";
}
