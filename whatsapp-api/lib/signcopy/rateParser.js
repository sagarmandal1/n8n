const BANGLA_DIGITS = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

export function normalizeDigits(input = "") {
  return String(input).replace(/[০-৯]/g, (ch) => BANGLA_DIGITS[ch] || ch);
}

export function normalizeText(input = "") {
  return normalizeDigits(String(input))
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

export function parseRateFromText(input = "") {
  const original = String(input || "").trim();
  const text = normalizeText(original).toLowerCase();
  if (!text) {
    return { found: false, confidence: 0, rate: null, pattern: null };
  }

  const patterns = [
    {
      name: "keyword-prefix",
      score: 0.98,
      regex: /\b(?:ret|rate|r8|রেট|নতুন রেট|new rate)\b\s*[:=\-]?\s*(\d+(?:\.\d+)?)/i,
    },
    {
      name: "keyword-middle",
      score: 0.9,
      regex:
        /\b(?:ret|rate|রেট|নতুন রেট|new rate)\b[^0-9]{0,16}(\d+(?:\.\d+)?)/i,
    },
    {
      name: "amount-suffix",
      score: 0.82,
      regex: /(\d+(?:\.\d+)?)\s*(?:tk|taka|টাকা)\b/i,
    },
    {
      name: "message-end",
      score: 0.58,
      regex: /(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/,
    },
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    const rate = Number(match[1]);
    if (!Number.isFinite(rate) || rate < 0) continue;

    return {
      found: true,
      rate,
      confidence: pattern.score,
      pattern: pattern.name,
      normalizedText: text,
      raw: original,
    };
  }

  return {
    found: false,
    rate: null,
    confidence: 0,
    pattern: null,
    normalizedText: text,
    raw: original,
  };
}

export function extractOrderDigits(input = "") {
  const text = normalizeDigits(input);
  const matches = text.match(/\d{8,25}/g) || [];
  return [...new Set(matches)];
}
