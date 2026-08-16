import axios from "axios";
import Settings from "../models/settingsModel.js";

// ─── bKash Tokenized Checkout API (Live/Production) ───────────────────────
const BASE_URL = "https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout";

// Load credentials from DB
async function getBkashCreds() {
  const settings = await Settings.findOne().lean();
  const bkash = settings?.paymentGateway?.bKash;
  if (!bkash?.appKey || !bkash?.appSecret || !bkash?.username || !bkash?.password) {
    throw new Error("bKash credentials are not configured.");
  }
  if (!bkash.isActive) {
    throw new Error("bKash payment gateway is disabled.");
  }
  return bkash;
}

// Step 1: Grant Token
async function grantToken(creds) {
  const res = await axios.post(
    `${BASE_URL}/token/grant`,
    { app_key: creds.appKey, app_secret: creds.appSecret },
    {
      headers: {
        "Content-Type": "application/json",
        username: creds.username,
        password: creds.password,
      },
    }
  );

  if (res.data?.statusCode !== "0000") {
    throw new Error(res.data?.statusMessage || "bKash token grant failed");
  }

  return {
    idToken: res.data.id_token,
    refreshToken: res.data.refresh_token,
    appKey: creds.appKey,
  };
}

// Step 2: Create Payment — returns bkashURL & paymentID
export async function createBkashPayment({ amount, invoiceNumber, callbackURL, payerReference }) {
  const creds = await getBkashCreds();
  const auth = await grantToken(creds);

  const res = await axios.post(
    `${BASE_URL}/create`,
    {
      mode: "0011",
      payerReference: String(payerReference),
      callbackURL,
      amount: String(parseFloat(amount).toFixed(2)),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: String(invoiceNumber),
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: auth.idToken,
        "X-APP-Key": auth.appKey,
      },
    }
  );

  if (res.data?.statusCode !== "0000") {
    throw new Error(res.data?.statusMessage || "bKash payment creation failed");
  }

  return {
    paymentID: res.data.paymentID,
    bkashURL: res.data.bkashURL,
    idToken: auth.idToken,
    appKey: auth.appKey,
  };
}

// Step 3: Execute Payment — verifies and completes the payment
export async function executeBkashPayment({ paymentID }) {
  const creds = await getBkashCreds();
  const auth = await grantToken(creds);

  const res = await axios.post(
    `${BASE_URL}/execute`,
    { paymentID },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: auth.idToken,
        "X-APP-Key": auth.appKey,
      },
    }
  );

  return res.data; // { transactionStatus, trxID, amount, paymentID, ... }
}

// Optional: Query payment status
export async function queryBkashPayment({ paymentID }) {
  const creds = await getBkashCreds();
  const auth = await grantToken(creds);

  const res = await axios.post(
    `${BASE_URL}/payment/status`,
    { paymentID },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: auth.idToken,
        "X-APP-Key": auth.appKey,
      },
    }
  );

  return res.data;
}
