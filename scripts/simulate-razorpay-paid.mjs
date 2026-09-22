// Dev helper: deliver a correctly signed Razorpay `payment_link.paid`
// webhook to a running instance of this service, so the payment path can
// be tested end to end without a real payment (locally, where Razorpay
// cannot reach). Run it twice with the same estimate number to test the
// duplicate-webhook guard.
//
//   node scripts/simulate-razorpay-paid.mjs <ZOHO_ESTIMATE_NUMBER> [amountInRupees] [url]
//
// Reads RAZORPAY_WEBHOOK_SECRET from .env. Never prints the secret.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const [estimateNumber, amountArg, urlArg] = process.argv.slice(2);
if (!estimateNumber) {
  console.error("usage: node scripts/simulate-razorpay-paid.mjs <ZOHO_ESTIMATE_NUMBER> [amountInRupees] [url]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const secret = env.RAZORPAY_WEBHOOK_SECRET;
if (!secret) {
  console.error("RAZORPAY_WEBHOOK_SECRET is not set in .env");
  process.exit(1);
}

const url = urlArg ?? "http://localhost:3100/webhooks/razorpay";
const amountPaise = amountArg ? Math.round(Number(amountArg) * 100) : 100;
const body = JSON.stringify({
  event: "payment_link.paid",
  payload: {
    payment_link: { entity: { reference_id: estimateNumber } },
    payment: {
      entity: {
        id: `pay_SIMULATED_${Date.now()}`,
        amount: amountPaise,
        created_at: Math.floor(Date.now() / 1000),
      },
    },
  },
});
const signature = createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-razorpay-signature": signature },
  body,
});
console.log(`${res.status} ${res.statusText}`);
console.log(await res.text());
