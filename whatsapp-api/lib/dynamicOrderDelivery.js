import DynamicOrder from "../models/dynamicOrderModel.js";
import crypto from "node:crypto";

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";
const ASCII_DIGITS = "0123456789";

export function normalizeDigits(value = "") {
  return String(value).replace(/[০-৯]/g, (digit) => ASCII_DIGITS[BENGALI_DIGITS.indexOf(digit)]);
}

export function normalizePhone(value = "") {
  const digits = normalizeDigits(value).replace(/\D/g, "");
  if (/^01\d{9}$/.test(digits)) return `88${digits}`;
  return digits;
}

function clean(value = "") {
  return String(value).toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function tokens(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

const MIN_SUBSTRING_EVIDENCE = 4;

function similar(value, evidence) {
  const normalizeLabel = (text) => text.replace(/^(?:বাংলায়|ইংরেজি|name|english)+/iu, "");
  const expected = normalizeLabel(clean(value));
  const actual = clean(evidence);
  if (!expected || !actual) return false;
  // A substring hit only means something when the needle is distinctive. OCR
  // noise regularly produces one- or two-character "names", and such a needle
  // is contained in almost every document, so without this floor one junk order
  // matches everything it is compared against. Paired with any second field
  // that happens to agree, that satisfies the two-field rule and auto-delivers
  // a document to the wrong customer.
  if (expected.length >= MIN_SUBSTRING_EVIDENCE && actual.includes(expected)) return true;
  const expectedTokens = new Set(tokens(String(value).replace(/^\s*\(?\s*(?:বাংলায়|ইংরেজি|name|english)\s*\)?\s*[:：-]?\s*/iu, "")));
  const actualTokens = new Set(tokens(evidence));
  if (!expectedTokens.size) return false;
  let overlap = 0;
  for (const token of expectedTokens) if (actualTokens.has(token)) overlap += 1;
  return overlap >= 2 && overlap / expectedTokens.size >= 0.67;
}

function firstMatch(text, expressions) {
  for (const expression of expressions) {
    const match = String(text).match(expression);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}

// Gender appears as an explicit label on certificates ("Sex : Male",
// "লিঙ্গ : পুরুষ") and occasionally as a bare word. Normalising to male/female
// lets a Bangla order match an English certificate for the same person.
// Certificates write dates both as 12/04/2023 and as "22 September 2001" /
// "২২ সেপ্টেম্বর ২০০১". Only the numeric form was recognised, so every document
// using a written month lost its date of birth entirely — and DOB is one of the
// identity fields delivery depends on.
const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
  "জানুয়ারি": 1, "ফেব্রুয়ারি": 2, "মার্চ": 3, "এপ্রিল": 4, "মে": 5, "জুন": 6,
  "জুলাই": 7, "আগস্ট": 8, "সেপ্টেম্বর": 9, "অক্টোবর": 10, "নভেম্বর": 11, "ডিসেম্বর": 12,
};

function parseWrittenDate(text) {
  const source = normalizeDigits(String(text || ""));
  const names = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join("|");
  const pattern = new RegExp(
    `(?:date\\s*of\\s*birth|dob|জন্ম\\s*তারিখ)?\\s*[:：ঃ\\-]?\\s*(\\d{1,2})\\s*[\\s,.-]\\s*(${names})\\s*[\\s,.-]\\s*(\\d{4})`,
    "iu",
  );
  const match = source.match(pattern);
  if (!match) return "";
  const day = String(match[1]).padStart(2, "0");
  const month = MONTH_NAMES[String(match[2]).toLowerCase()];
  if (!month) return "";
  return `${day}/${String(month).padStart(2, "0")}/${match[3]}`;
}

export function parseGender(input = "") {
  const text = String(input || "");
  const labelled = text.match(
    /(?:sex|gender|লিঙ্গ|লিঙ্গঃ)\s*[:：ঃ\-]?\s*(male|female|m\b|f\b|পুরুষ|মহিলা|নারী|স্ত্রী)/iu,
  );
  const token = labelled?.[1] || text.match(/\b(পুরুষ|মহিলা|নারী|স্ত্রী)\b/u)?.[1] || "";
  const value = String(token).toLowerCase().trim();
  if (!value) return "";
  if (/^(male|m|পুরুষ)$/u.test(value)) return "male";
  if (/^(female|f|মহিলা|নারী|স্ত্রী)$/u.test(value)) return "female";
  return "";
}

export function parseOrderDetails(input = "") {
  const text = String(input || "");
  const applicationId = firstMatch(text, [
    /(?:application\s*id|application|আবেদনপত্র\s*নম্বর|আবেদন\s*নম্বর)\s*[:#\-]?\s*([০-৯\d]{6,20})/iu,
  ]);
  const birthRegistrationNumber = firstMatch(text, [
    /(?:birth\s*registration\s*(?:number|no)|br\s*(?:number|no)|জন্ম\s*নিবন্ধন\s*(?:নম্বর|নং))\s*[:#：ঃ\-]?\s*([০-৯\d]{15,20})/iu,
  ]);
  const dob = firstMatch(text, [
    /(?:date\s*of\s*birth|dob|জন্ম\s*তারিখ)\s*[:：ঃ\-]?\s*([০-৯\d]{1,2}[\/.-][০-৯\d]{1,2}[\/.-][০-৯\d]{4})/iu,
    /(?:^|\n)\s*([০-৯\d]{1,2}[\/.-][০-৯\d]{1,2}[\/.-][০-৯\d]{4})\s*$/imu,
  ]);
  const englishName = firstMatch(text, [
    /name\s*\(\s*english\s*\)\s*[:：\-]?\s*([^\n\r]+)/iu,
    /name\s*english\s*[:：\-]?\s*([^\n\r]+)/iu,
    /নাম\s*\(\s*ইংরেজি\s*\)\s*[:：ঃ\-]?\s*([^\n\r]+)/iu,
  ]);
  const name = firstMatch(text, [
    /(?:^|\n)\s*(?:নাম\s*(?:\(\s*বাংলা\s*\)|বাংলা)?(?:\s+নাম)?|নাম বাংলা নাম|name(?!\s*\())\s*[:：ঃ\-]?\s*([^\n\r]+)/imu,
  ]);
  const fallbackBanglaName = firstMatch(text, [
    /(?:^|\n)\s*((?:মোছাঃ|মোসাম্মৎ|মোঃ|মোহাম্মদ|মুহাম্মাদ)\s+[^\n\r]+)/imu,
  ]);
  const resolvedName = name || fallbackBanglaName;
  const resolvedEnglishName = englishName || firstMatch(text, [
    /(?:^|\n)\s*((?:mst\.?|md\.?|mohammad|muhammad)\s+[a-z][^\n\r]+)/imu,
  ]);
  const fatherName = firstMatch(text, [
    /(?:father(?:'s)?\s*name|পিতার\s*নাম|পিতাঃ|পিতা)\s*[:：ঃ\-]?\s*([^\n\r]+)/iu,
  ]);
  const motherName = firstMatch(text, [
    /(?:mother(?:'s)?\s*name|মাতার\s*নাম|মাতাঃ|মাতা)\s*[:：ঃ\-]?\s*([^\n\r]+)/iu,
  ]);
  const address = firstMatch(text, [
    /(?:office\s*address|permanent\s*address|স্থায়ী\s*ঠিকানা|ঠিকানা|গ্রাম)\s*[:：ঃ\-]?\s*([^\n\r]+)/iu,
  ]);
  const normalizedDob = dob
    ? normalizeDigits(dob).replace(/-/g, "/").replace(/\./g, "/")
    : parseWrittenDate(text);
  const gender = parseGender(text);
  const independentFields = [
    applicationId,
    resolvedName || resolvedEnglishName,
    normalizedDob,
    fatherName,
    motherName,
    address,
    birthRegistrationNumber,
  ].filter(Boolean);
  if (independentFields.length < 2) return null;
  const stableKey = crypto.createHash("sha256")
    .update(`${clean(resolvedName)}|${clean(resolvedEnglishName)}|${normalizedDob}|${clean(fatherName)}|${clean(motherName)}`)
    .digest("hex")
    .slice(0, 16);
  return {
    applicationId: normalizeDigits(applicationId) || `FORM-${stableKey}`,
    name: resolvedName.trim(),
    englishName: resolvedEnglishName.trim(),
    dob: normalizedDob,
    gender,
    fatherName: fatherName.trim(),
    motherName: motherName.trim(),
    address: address.trim(),
    birthRegistrationNumber: normalizeDigits(birthRegistrationNumber),
  };
}

// Two orders describe the same person when their names agree and their dates of
// birth do not contradict. Used to decide whether a newly parsed order replaces
// an earlier one or stands alongside it as a separate request.
function isSamePerson(a, b) {
  const nameA = clean(a.name || a.englishName || "");
  const nameB = clean(b.name || b.englishName || "");
  if (!nameA || !nameB) return false;

  const namesAgree = nameA === nameB
    || similar(a.name || a.englishName || "", b.name || b.englishName || "")
    || similar(b.name || b.englishName || "", a.name || a.englishName || "");
  if (!namesAgree) return false;

  const dobA = normalizeDigits(String(a.dob || ""));
  const dobB = normalizeDigits(String(b.dob || ""));
  // A stated date of birth that differs means different people, even when the
  // names look alike — siblings and cousins share names constantly.
  if (dobA && dobB && dobA !== dobB) return false;
  return true;
}

// An exact identity duplicate: same name AND same stated date of birth. Both
// must be present — a missing DOB is not evidence of sameness, and treating it
// as such would delete a different person's pending order.
function isExactIdentityDuplicate(a, b) {
  const dobA = normalizeDigits(String(a.dob || ""));
  const dobB = normalizeDigits(String(b.dob || ""));
  if (!dobA || !dobB || dobA !== dobB) return false;

  const nameA = clean(a.name || a.englishName || "");
  const nameB = clean(b.name || b.englishName || "");
  if (!nameA || !nameB) return false;
  return nameA === nameB
    || similar(a.name || a.englishName || "", b.name || b.englishName || "");
}

export async function upsertDynamicOrder({ userId, sessionId, customerPhone, text, messageId = "" }) {
  const details = parseOrderDetails(text);
  if (!details) return null;
  const phone = normalizePhone(customerPhone);
  if (!phone) return null;
  const filter = { user: userId, session: sessionId, customerPhone: phone, applicationId: details.applicationId };
  const existing = await DynamicOrder.findOne(filter);
  if (existing) {
    if (existing.status !== "DELIVERED") {
      Object.assign(existing, details, {
        sourceMessageId: messageId || existing.sourceMessageId,
        sourceText: String(text).slice(0, 12000),
        reviewReason: "",
      });
      await existing.save();
    }
    return existing;
  }
  const created = await DynamicOrder.create({
    ...filter,
    ...details,
    sourceMessageId: messageId,
    sourceText: String(text).slice(0, 12000),
    status: "PENDING",
  });

  // Replace only earlier readings of the SAME person. Re-sending one document
  // rarely produces an identical applicationId — it hashes the parsed fields and
  // OCR reads a page slightly differently each time — so resends used to leave
  // near-identical orders behind that tied on score and blocked delivery.
  //
  // Scoped to the same person on purpose: one customer legitimately opens
  // several orders for different family members, and a vendor may return those
  // files in any order, so clearing every pending order would delete work that
  // has not been delivered yet.
  const siblings = await DynamicOrder.find({
    user: userId,
    session: sessionId,
    status: "PENDING",
    _id: { $ne: created._id },
  });

  let replaced = 0;
  for (const other of siblings) {
    const sameCustomer = normalizePhone(other.customerPhone) === phone;
    // Within one customer, replace any earlier reading of the same person.
    // Across customers, replace only on an exact name + date-of-birth duplicate:
    // the system must never hold two records with the same name and DOB,
    // because a vendor file matching both ties and is never delivered.
    const duplicate = sameCustomer
      ? isSamePerson(created, other)
      : isExactIdentityDuplicate(created, other);
    if (!duplicate) continue;
    await DynamicOrder.deleteOne({ _id: other._id });
    replaced += 1;
    if (!sameCustomer) {
      console.log(`[Order] duplicate identity: removed ${other.applicationId} (${other.customerPhone}) superseded by ${created.applicationId} (${phone})`);
    }
  }
  if (replaced) {
    console.log(`[Order] ${phone}: replaced ${replaced} earlier record(s) with ${created.applicationId}`);
  }

  return created;
}

// Record which vendor was asked to handle a customer's order. Called when the
// CEO forwards customer details onward, so the returned file can be resolved by
// the assignment instead of by content alone.
// A vendor signals a finished correction by writing "Revision Done" (or a Bangla
// equivalent) with the file. Only then may an already-delivered or in-revision
// order be auto-delivered again — an unmarked resend is treated as work still in
// progress and is held for manual handling.
export function isRevisionDone(text = "") {
  const value = String(text || "").toLowerCase();
  const original = String(text || "");
  // "Revision" on its own counts as well as "Revision Done". This is read from
  // what the vendor writes with the file — caption or quoted text — never from
  // the document's OCR, so a certificate containing the word cannot trigger it.
  return /\brevision\b/u.test(value)
    || /\brevised\b/u.test(value)
    || /(?:রিভিশন|সংশোধন)/u.test(original);
}

export async function assignOrdersToVendor({ userId, sessionId, vendorPhone, text }) {
  const vendor = normalizePhone(vendorPhone);
  if (!vendor || !String(text || "").trim()) return [];

  const matches = await findDynamicOrderMatches({ userId, sessionId, evidenceText: text });
  const assigned = [];
  for (const result of matches) {
    // Only assign on a confident identification, using the same bar as
    // delivery. A vague forward must not silently reassign someone's order.
    if (!result.matchedFields.includes("name")
      && !result.matchedFields.includes("applicationId")
      && !result.matchedFields.includes("birthRegistrationNumber")) continue;
    result.order.assignedVendor = vendor;
    result.order.assignedAt = new Date();
    await result.order.save();
    assigned.push(result.order);
  }
  return assigned;
}

export async function findDynamicOrderMatches({ userId, sessionId, evidenceText, filenameExact = false, vendorPhone = "", revisionDone = false }) {
  const evidence = String(evidenceText || "");
  const evidenceDigits = normalizeDigits(evidence);
  const evidenceClean = clean(evidence);
  // Completed orders are always searched, otherwise a resend of an already
  // delivered file matches nothing and is reported as NO_MATCH — the revision
  // check downstream never runs and the vendor's correction is lost. They are
  // heavily penalised below so an outstanding order always wins; a delivered one
  // only surfaces when nothing else fits, which is exactly the revision case.
  const orders = await DynamicOrder.find({
    user: userId,
    session: sessionId,
    status: { $in: ["PENDING", "REVISION", "DELIVERED"] },
  }).sort({ createdAt: 1 });
  const vendor = normalizePhone(vendorPhone);
  return orders
    .map((order) => {
      // A file from the vendor this order was assigned to is far stronger
      // evidence than the same fields matching an unassigned order. It breaks
      // ties between customers who share a name and a date of birth, which is
      // the failure mode that grows with the customer base.
      const assignedToSender = Boolean(vendor) && normalizePhone(order.assignedVendor || "") === vendor;
      const idMatch = !String(order.applicationId).startsWith("FORM-") && evidenceDigits.includes(String(order.applicationId));
      const nameMatch = [order.name, order.englishName].filter(Boolean).some((name) => similar(name, evidence));
      // A date of birth present on both sides that disagrees proves this is a
      // different person, exactly like a gender clash.
      const evidenceDob = parseWrittenDate(evidence) || firstMatch(evidence, [
        /(?:date\s*of\s*birth|dob|জন্ম\s*তারিখ)\s*[:：ঃ\-]?\s*([০-৯\d]{1,2}[\/.-][০-৯\d]{1,2}[\/.-][০-৯\d]{4})/iu,
      ]).replace(/-/g, "/").replace(/\./g, "/");
      const normalizedEvidenceDob = normalizeDigits(evidenceDob);
      const orderDob = normalizeDigits(String(order.dob || ""));
      const dobConflict = Boolean(orderDob) && Boolean(normalizedEvidenceDob) && orderDob !== normalizedEvidenceDob;
      // Compare the PARSED evidence date too: a written form such as
      // "22 September 2001" yields digits 222001, which never contains the
      // stored 22092001, so an identical date looked like a mismatch.
      const dobMatch = Boolean(order.dob) && (
        (Boolean(normalizedEvidenceDob) && orderDob === normalizedEvidenceDob)
        || evidenceDigits.replace(/\D/g, "").includes(normalizeDigits(order.dob).replace(/\D/g, ""))
        || evidence.includes(order.dob)
      );

      const evidenceGender = parseGender(evidence);
      const genderMatch = Boolean(order.gender) && Boolean(evidenceGender) && order.gender === evidenceGender;
      // A gender that is present on BOTH sides and disagrees is proof this is a
      // different person, however well the other fields line up.
      const genderConflict = Boolean(order.gender) && Boolean(evidenceGender) && order.gender !== evidenceGender;
      const fatherMatch = Boolean(order.fatherName) && similar(order.fatherName, evidence);
      const motherMatch = Boolean(order.motherName) && similar(order.motherName, evidence);
      const addressMatch = Boolean(order.address) && similar(order.address, evidence);
      const registration = String(order.birthRegistrationNumber || "");
      // Screen-photo OCR often drops the first digits while preserving the
      // distinctive tail. Accept a 9-digit tail only when it is paired with
      // another independent field (the two-field rule below remains active).
      const registrationTail = registration.length >= 9 ? registration.slice(-9) : "";
      const birthRegistrationMatch = Boolean(registration) && (
        evidenceDigits.includes(registration) ||
        (registrationTail.length === 9 && evidenceDigits.includes(registrationTail))
      );
      const matchedFields = [
        idMatch && "applicationId",
        nameMatch && "name",
        dobMatch && "dob",
        genderMatch && "gender",
        // The assignment counts as an independent field: it is evidence from
        // the CEO's forward rather than from the document, so a file returned
        // by the assigned vendor whose OCR only recovered the name still has
        // two separate signals pointing at one customer.
        assignedToSender && "vendorAssignment",
        fatherMatch && "fatherName",
        motherMatch && "motherName",
        addressMatch && "address",
        birthRegistrationMatch && "birthRegistrationNumber",
      ].filter(Boolean);
      // A completed order must never outrank outstanding work. The penalty
      // exceeds any achievable positive score, so a delivered order can only
      // come first when no open order matched at all.
      const deliveredPenalty = order.status === "DELIVERED" ? 1000 : 0;
      const score = matchedFields.length * 100 + (idMatch ? 20 : 0) + (birthRegistrationMatch ? 10 : 0) + (assignedToSender ? 50 : 0) - deliveredPenalty;
      const confidence = Math.min(
        0.99,
        0.5 + matchedFields.length * 0.15 + (idMatch ? 0.08 : 0) + (birthRegistrationMatch ? 0.04 : 0),
      );
      return { order, score, confidence, matchedFields, genderConflict, dobConflict, nameMatch, assignedToSender };
    })
      .filter((result) => !result.genderConflict)
      .filter((result) => !result.dobConflict)
      // The name must agree, so a vendor's file cannot reach a stranger who
      // merely shares a father's name and a district address. Three identifiers
      // stand in for it:
      //
      //  - a verified application or birth-registration number, both unique;
      //  - an exact date of birth together with gender.
      //
      // The last exists because names routinely cannot match across scripts:
      // customers write in Bangla, certificates are issued in English, and OCR
      // mangles the Bangla half of a bilingual document ("মেহেদী রহমান" comes
      // back as "মে হেদী রহেমোন"). A date of birth is script-independent, and
      // should two customers share one, the tie check downstream refuses the
      // delivery rather than guessing.
      .filter((result) => result.nameMatch
        || result.matchedFields.includes("applicationId")
        || result.matchedFields.includes("birthRegistrationNumber")
        || (result.matchedFields.includes("dob") && result.matchedFields.includes("gender")))
      .filter((result) => result.matchedFields.length >= 2 || (
        filenameExact && (result.matchedFields.includes("applicationId") || result.matchedFields.includes("birthRegistrationNumber"))
      ))
    .sort((a, b) => b.score - a.score);
}

export async function assessDynamicOrderMatch({ userId, sessionId, evidenceText }) {
  const matches = await findDynamicOrderMatches({ userId, sessionId, evidenceText });
  if (!matches.length) {
    return {
      decision: "NO_MATCH",
      autoDeliver: false,
      needsReview: true,
      confidence: 0,
      reason: "At least two independent fields did not match any pending order",
      match: null,
      alternatives: [],
    };
  }

  const best = matches[0];
  const tied = matches.filter((candidate) => candidate.score === best.score);
  // Only a tie across DIFFERENT customers is genuinely ambiguous. Repeated OCR
  // readings of one person produce several near-identical orders, and every one
  // of them names the same recipient, so delivery is still safe.
  const tiedCustomers = new Set(tied.map((candidate) => normalizePhone(candidate.order.customerPhone)));
  if (tied.length > 1 && tiedCustomers.size > 1) {
    return {
      decision: "AMBIGUOUS",
      autoDeliver: false,
      needsReview: true,
      confidence: Math.min(best.confidence, 0.69),
      reason: `${tied.length} pending orders have the same match score`,
      match: null,
      alternatives: tied.slice(0, 5),
    };
  }

  return {
    decision: "UNIQUE_MATCH",
    autoDeliver: true,
    needsReview: false,
    confidence: best.confidence,
    reason: `${best.matchedFields.length} independent fields matched one pending order`,
    match: best,
    alternatives: matches.slice(1, 4),
  };
}
