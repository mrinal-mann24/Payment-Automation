# Step 6 — Billing cycles (monthly + quarterly/half-yearly), manual payments, reminders, one-time quotes

Status: implemented 2026-09-22 (unit-tested; live verification pending — see
`PROGRESS.md`). Supersedes the T+2/T+4/T+7 schedule in `step5.md` for every
cycle-billed customer; the legacy due-date flow (`step1.md`–`step4.md`) is
unchanged for yearly customers and deals with no usable line item.

## 1. Decisions (confirmed by the business, 2026-09-21 and 2026-09-22)
- **Cycle from the line item's Term.** The latest HubSpot line item's
  `hs_recurring_billing_period` decides: `P1M` monthly, `P3M` quarterly,
  `P6M` half-yearly. The deal-level Billing Cycle field is ignored (wrong on
  five live deals). Yearly stays on the legacy due-date flow; any other term
  (e.g. `P7M`) is unsupported and billed by nobody until corrected.
- **Monthly = advance billing, same month.** On the 1st, quote the month
  that is starting (service period 1st–last day) at the `client_pricing`
  base price. Reminders on the 5th, 7th and 9th; stop the moment it is paid.
- **Term = quote the day the last term ends, for the same length again,
  at what the client paid last time** (latest line item price × quantity).
  Service period = that day to the day before the same date `months`
  later. Reminders 4, 6 and 8 days after the quote.
- **Catch-up window.** A cycle the tick misses is retried for three more
  days; anything older is never auto-quoted — the admin page shows **Quote
  now** and a person decides. Piyush and Ankit Yadav, whose terms ended
  before go-live, are handled this way.
- **Delivery:** quote and invoice go to the client's WhatsApp **group**
  (`clients.whatsapp_group_id`, contact phone as fallback) **and** by email
  through Zoho Books' own email API, to the HubSpot contact's `email`.
- **Manual payments:** "Paid through Yes Bank" (one click) and "Record
  manual payment" (amount, date, method, narration, reference) both mark
  the cycle PAID and settle it exactly like a Razorpay payment.
- **HubSpot on payment:** one complete "Renewal" line item per paid cycle
  with the cycle's frequency, term, start date and Date Paid — a new item
  each time, never an edit of an old one.
- **One-time quotes:** the admin page takes an amount, a service name and
  an optional narration and sends a quote (service bold, narration beneath)
  to the group and by email; paid through its Razorpay link; invoice
  confirmed to the group and emailed.
- **Admin auth:** left open (business decision, see `ARCHITECTURE.md` §3.7c).

## 2. Requirements (EARS)
- REQ-6.1 On IST days 1–4, WHEN a deal's latest line item is `P1M` and ends
  on or before the 1st, the system SHALL create one `renewal_jobs` row keyed
  `(hubspot_deal_id, "YYYY-MM")`, a Zoho estimate whose single line reads
  **Virtual Accounting** with description "Service period: 1 <Month> <Year>
  to <last> <Month> <Year>", a Razorpay link, a WhatsApp group message with
  the quote PDF, and a Zoho email.
- REQ-6.2 WHEN a deal's latest line item is `P3M` or `P6M` and its end date
  is today or within the last three days, the system SHALL do the same
  keyed `(hubspot_deal_id, <end date>)`, for a service period of the same
  length starting on that date, at the latest item's price × quantity.
- REQ-6.3 The system SHALL NOT auto-quote a term that ended four or more
  days ago, an unsupported term, a deal already billed past the cycle
  start, or a deal with an unpaid legacy quote; the legacy cron SHALL skip
  every deal a cycle owns. `POST /admin/pricing/generate-quote` and
  `POST /webhooks/renewal` SHALL quote any due deal regardless of the window
  and refuse (409) a not-due, unsupported or unlisted one.
- REQ-6.4 A cycle is PAID ⇔ `renewal_jobs.paid_at` is set. Razorpay
  (webhook), "Paid through Yes Bank" and manual entry SHALL all set it
  through the same `settleRenewalPayment` path: record payment → cancel
  the Razorpay link if paid outside Razorpay → Zoho invoice → WhatsApp
  confirmation with invoice PDF → invoice email → HubSpot line item +
  Renewal Done.
- REQ-6.5 Recording a payment SHALL be atomic (`paid_at IS NULL` claim);
  every settlement step SHALL be independent and idempotent; a daily sweep
  re-runs the unfinished steps of any paid cycle.
- REQ-6.6 On payment the system SHALL write one HubSpot line item with the
  cycle's frequency and term (`monthly/P1M`, `quarterly/P3M`,
  `per_six_months/P6M`), start = period start, Date Paid = payment date,
  price = the amount billed, adopting an item the team already entered for
  the same start date.
- REQ-6.7 On days 5–6 / 7–8 / 9–10 of a cycle, counted from its start date,
  the system SHALL send reminder 1 / 2 / 3 to each unpaid cycle, at most
  once per stage, claiming the stage atomically (`reminder_N_sent_at IS
  NULL AND paid_at IS NULL`) immediately before sending; a paid cycle SHALL
  never be reminded; a link Razorpay reports as paid SHALL be settled instead.
- REQ-6.8 A one-time quote SHALL create its own Zoho estimate (line named
  after the service, narration as description) and Razorpay link, send the
  PDF to the WhatsApp group (phone fallback) and email it with the link,
  recording each channel; a delivery failure SHALL NOT fail the quote. On
  payment the invoice SHALL be confirmed to the group and emailed.
- REQ-6.9 All month boundaries, cycle days and reminder days SHALL be
  computed in IST. Previous cycles' rows SHALL never be modified by a new
  cycle.

## 3. Where it lives
`src/utils/billingCycle.ts`, `src/utils/monthlyEligibility.ts`,
`src/jobs/billingCycleCron.ts`, `src/jobs/generateRenewalQuote.ts`,
`src/jobs/renewalPipeline.ts`, `src/steps/settleRenewalPayment.ts`,
`src/jobs/settlementSweep.ts`, `src/jobs/reminderCron.ts`,
`src/steps/sendQuoteEmail.ts`, `src/steps/sendInvoiceEmail.ts`,
`src/steps/whatsappRecipient.ts`, `src/repositories/clients.ts`,
`src/steps/createAdditionCharge.ts`, `src/steps/sendAdditionInvoiceEmail.ts`,
`src/routes/pricingAdmin.ts`, `src/routes/pricingAdminPage.ts`,
migrations `0010_renewal_jobs_monthly_billing.sql` and
`0011_term_cycles_and_addition_delivery.sql`.

## 4. Open items
- Live verification of the Zoho email API behaviour (PDF attachment,
  DRAFT→SENT side effect, bold name / description rendering), a group send,
  a term-cycle HubSpot line item and a one-time quote on the test deal —
  see `PROGRESS.md`.
- Mid-month monthly terms (e.g. 15 Sep–15 Oct) are skipped for the month in
  progress and billed from the next full month; pro-rata stays manual.
- Down The Rabbit Hole's `P7M` line item (ends 30 Sep) is unsupported; the
  team must correct it in HubSpot before that client is billed by anything.
- Three deals have no dated line item (Rapheal, MD Afreed, SLV Trades) and
  are never billed until one is entered.
