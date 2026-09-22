# Step 6 — Monthly billing cycles, manual payments, 5th/7th/9th reminders

Status: implemented 2026-09-22 (unit-tested; live verification pending — see
`PROGRESS.md`). Supersedes the T+2/T+4/T+7 schedule in `step5.md` for
monthly customers; the legacy due-date flow (`step1.md`–`step4.md`) is
unchanged for every other customer.

## 1. Decisions (confirmed by the business, 2026-09-21)
- **Advance billing, same month.** On the 1st, quote the month that is
  starting (service period 1st–last day). Reminders for that cycle on the
  5th, 7th and 9th of the same month; stop the moment the cycle is paid.
- **Monthly ⇔** HubSpot deal `billing_cycle = "Monthly"` **AND** the deal's
  latest line item (by `billing_term_end_date`) has
  `recurringbillingfrequency = "monthly"` and `hs_recurring_billing_period
  = "P1M"`. Anything else is not monthly: no monthly quote, invoice or
  reminders; it stays on the legacy due-date flow and is listed on the
  admin page with the reason.
- **Delivery:** quote and invoice go to the client's WhatsApp **group**
  (`clients.whatsapp_group_id`, contact phone as fallback) **and** by email
  through Zoho Books' own email API, to the HubSpot contact's `email`.
- **Manual payments:** "Paid through Yes Bank" (one click) and "Add
  One-Time Payment" (amount, date, method, narration, reference) both mark
  the cycle PAID and settle it exactly like a Razorpay payment.
- **HubSpot on payment:** one complete "Renewal" line item per paid
  monthly cycle (monthly, P1M, start = period start, Date Paid); the
  quote-time log-back line item is gone.
- **Admin auth:** left open (business decision, see `ARCHITECTURE.md` §3.7c).

## 2. Requirements (EARS)
- REQ-6.1 On IST days 1–4, WHEN a deal classifies as monthly and its latest
  line item ends on or before the 1st, the system SHALL create one
  `renewal_jobs` row keyed `(hubspot_deal_id, "YYYY-MM")`, a Zoho estimate
  whose single line reads **Virtual Accounting** with description
  "Service period: 1 <Month> <Year> to <last> <Month> <Year>", a Razorpay
  link, a WhatsApp group message with the quote PDF, and a Zoho email.
- REQ-6.2 The system SHALL NOT generate a monthly cycle for a deal that is
  not monthly, that is already billed past the 1st, or that still has an
  unpaid legacy quote; the legacy cron SHALL skip every monthly deal.
- REQ-6.3 A cycle is PAID ⇔ `renewal_jobs.paid_at` is set. Razorpay
  (webhook), "Paid through Yes Bank" and manual entry SHALL all set it
  through the same `settleRenewalPayment` path: record payment → cancel
  the Razorpay link if paid outside Razorpay → Zoho invoice → WhatsApp
  confirmation with invoice PDF → invoice email → HubSpot line item +
  Renewal Done.
- REQ-6.4 Recording a payment SHALL be atomic (`paid_at IS NULL` claim):
  duplicate webhooks, double-clicks and Razorpay-vs-manual races record
  exactly one payment; a genuine second payment is written to `error_log`.
- REQ-6.5 Every settlement step SHALL be independent and idempotent; a
  daily sweep re-runs the unfinished steps of any paid cycle.
- REQ-6.6 On IST days 5–6 / 7–8 / 9–10 the system SHALL send reminder
  1 / 2 / 3 to each unpaid current-month cycle, at most once per stage,
  claiming the stage atomically (`reminder_N_sent_at IS NULL AND paid_at
  IS NULL`) immediately before sending; a paid cycle SHALL never be
  reminded; a link Razorpay reports as paid SHALL be settled instead.
- REQ-6.7 All month boundaries and reminder days SHALL be computed in IST.
- REQ-6.8 Previous months' rows SHALL never be modified by a new cycle.

## 3. Where it lives
`src/utils/billingCycle.ts`, `src/utils/monthlyEligibility.ts`,
`src/jobs/monthlyBillingCron.ts`, `src/jobs/renewalPipeline.ts`,
`src/steps/settleRenewalPayment.ts`, `src/jobs/settlementSweep.ts`,
`src/jobs/reminderCron.ts`, `src/steps/sendQuoteEmail.ts`,
`src/steps/sendInvoiceEmail.ts`, `src/steps/whatsappRecipient.ts`,
`src/repositories/clients.ts`, `src/routes/pricingAdmin.ts`,
migration `supabase/migrations/0010_renewal_jobs_monthly_billing.sql`.

## 4. Open items
- Live verification of the Zoho email API behaviour (PDF attachment,
  DRAFT→SENT side effect, bold name / description rendering) on the test
  deal — see `PROGRESS.md`.
- Reminder message wording is still the placeholder copy from `step5.md`.
- Mid-month terms (e.g. 15 Sep–15 Oct) are skipped for the month in
  progress and billed from the next full month; pro-rata stays manual.
