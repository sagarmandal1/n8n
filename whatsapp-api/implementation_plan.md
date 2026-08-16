# bKash Automated Payment Gateway Integration

Currently, the user panel displays a "manual" bKash flow (instructing users to go to their app, send money, and input the TrxID). Because the admin panel allows the configuration of official bKash credentials (`appKey`, `appSecret`, `username`, `password`), the system should leverage the official **bKash Tokenized Checkout API** for a fully automated, seamless payment experience.

## User Review Required

> [!IMPORTANT]
> This change will entirely replace the manual bKash number/TrxID submission process with an automatic "Pay with bKash" button that redirects the user to the official bKash checkout page so they can enter their bKash number, OTP, and PIN securely.
> Does this align with your expectations? Do you want to keep the manual form as a fallback, or completely replace it with the automated gateway?

## Proposed Changes

### Backend Controllers & Services
I will implement the standard bKash Tokenized API flow in Node.js:

#### [NEW] `lib/bkashService.js`
- `grantToken()`: Fetches the Auth token from bKash using the credentials saved in the admin global `Settings`.
- `createPayment(amount, invoiceNumber)`: Generates a payment URL with bKash.
- `executePayment(paymentID)`: Finalizes the transaction after the user enters their PIN on the bKash secure gateway.

#### [NEW/MODIFY] `routers/rechargeRouter.js` & `controllers/rechargeController.js`
- **POST `/api/recharge/bkash/create`**: Called by the frontend to initiate a payment. Returns the `bkashURL` to redirect to.
- **GET `/api/recharge/bkash/callback`**: The callback URL where bKash redirects the user back to your site. It will execute the payment, update the user's `balance`, save a `Transaction`, update `Recharge` history, and redirect the user back to the success popup.

---

### Frontend Update

#### [MODIFY] `views/recharge.html`
- Hide the `Sender bKash No.` and `Transaction ID (TrxID)` input fields if the automated gateway is fully configured (`appKey`, `appSecret` are present).
- Change the submit button to **"Pay with bKash"**.
- Upon clicking, standard API call to `/api/recharge/bkash/create` will occur, taking the user to the bKash gateway.

## Open Questions

1. **bKash Environment:** Are the credentials you provided in the admin panel for **Sandbox (Test)** or **Live (Production)**? I will configure the base URL to point to live (`https://tokenized.pay.bkash.com`) by default unless told otherwise.
2. **Callback Base URL:** Your app will need to tell bKash where to return after payment (the callback URL). We will dynamically use the host (e.g., `https://yourdomain.com/api/recharge/bkash/callback`) but during localhost testing, bKash might not redirect back properly unless configured.

## Verification Plan

### Manual Verification
- Attempt to start a recharge from `http://localhost:3000/recharge`.
- Assert that clicking "Pay with bKash" initiates a request and returns the bKash token/URL.
- Assert that the frontend redirects to `checkout.pay.bkash.com`.
