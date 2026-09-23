# Step 6 — Billing cycles (monthly + quarterly/half-yearly), manual payments, reminders, one-time quotes

Status: implemented 2026-09-22 (unit-tested; live verification pending — see
`PROGRESS.md`). Supersedes the T+2/T+4/T+7 schedule in `step5.md` for every
cycle-billed customer; the legacy due-date flow (`step1.md`–`step4.md`) is
unchanged for yearly customers and deals with no usable line item.

## 1. Decisions (confirmed by the business, 2026-09-21 and 2026-09-22)
- **Cycle length from the line item's Term and Quantity.** The latest
  HubSpot line item decides: the cycle is the longer of its term
  (`hs_recurring_billing_period`) and its quantity — `P1M` × 1 monthly,
  `P1M` × 3 or `P3M` × 1 quarterly, `P6M` half-yearly, `P7M` × 7 every
  7 months … (quantity as months confirmed 2026-09-22). A year or longer
  stays on the legacy due-date flow.
- **Quote date from the deal's Next Renewal Date.** A client is quoted on
  HubSpot's `next_renewal_date`, for one cycle length from that day, at the
  `client_pricing` base price (monthly) or what they paid last time (terms:
  latest line item price × quantity). A missed tick is retried for three
  days; anything older is flagged on the admin page and never auto-quoted —
  the team corrects the date in HubSpot. Blank or `1970-01-01` = never due.
- **After payment the automation moves Next Renewal Date forward** by the
  cycle length, so the next quote needs no manual entry.
- **No "Quote now" button.** Quotes are automatic at 11:00 IST; the only
  on-demand path is the secret-protected `POST /webhooks/renewal`.
- **Reminders** on days 5, 7 and 9 of the cycle counted from its start
  (the 5th/7th/9th for a cycle starting on the 1st); stop the moment it is
  paid.
- **Delivery:** quote and invoice go to the client's WhatsApp **group**
  (`clients.whatsapp_group_id`, contact phone as fallback) and by email
  through Zoho Books' own email API to every address in the deal's
  **Accountant Email** field (comma-separated list) — only when at least
  one is set; no fallback to the contact.
- **Marking paid (2026-09-23):** two buttons — "Mark paid by Yes Bank"
  (date + narration) and "Mark paid by Razorpay" (for a webhook that never
  arrived: accepted only when Razorpay itself shows the link as paid, with
  the payment id, amount and date taken from Razorpay). Both settle exactly
  like a webhook payment; the date entered becomes HubSpot's Date Paid. The
  same two buttons sit beside every unpaid one-time quote. The "Record
  manual payment" form was removed the same day (not required); the API
  still takes other methods.
- **Zoho shows the invoice as Paid (2026-09-23):** every settlement records
  a Zoho customer payment for the invoice's full balance (bank transfer for
  Yes Bank / NEFT, cheque, cash, "others" for Razorpay / UPI / other, the
  method and narration in the description). Needs the
  `ZohoBooks.customerpayments.CREATE` scope, missing from the token as of
  2026-09-23; until it is re-granted the step fails, is shown as "Zoho
  payment pending" and is retried by the daily sweep.
- **HubSpot on payment:** one complete "Renewal" line item per paid cycle
  with the cycle's frequency, term, start date and Date Paid — a new item
  each time, never an edit of an old one — then Next Renewal Date moved
  forward, then the stage to Renewal Done.
- **One-time quotes:** the admin page takes an amount, a service name and
  an optional narration and sends a quote (service bold, narration beneath)
  to the group and by email; paid through its Razorpay link; invoice
  confirmed to the group and emailed.
- **Pause switch (2026-09-23):** the admin can switch a client's automatic
  quotes off and on (`client_pricing.auto_quote`); while off, nothing is
  quoted for that client by the daily run, the on-demand route or the
  legacy cron.
- **Sender (2026-09-23):** quote and invoice emails go out from the Zoho
  organisation email, to be set to accounts@aiaccountant.com in Zoho.
- **Admin auth:** left open (business decision, see `ARCHITECTURE.md` §3.7c).

## 2. Requirements (EARS)
- REQ-6.1 WHEN a deal's latest line item term and quantity are both under a year and
  its Next Renewal Date is today or within the last three days, the system
  SHALL create one `renewal_jobs` row keyed `(hubspot_deal_id, <that date>)`,
  a Zoho estimate whose single line reads **Virtual Accounting** with
  description "Service period: <start> to <end>" (start = that date, end =
  the day before the same date one cycle later), a Razorpay link, a
  WhatsApp group message with the quote PDF, and — when the Accountant
  Email is set — a Zoho email.
- REQ-6.2 The system SHALL NOT auto-quote a deal whose Next Renewal Date is
  blank, in the future, or passed four or more days ago, a deal with
  an unpaid legacy quote, or a deal the admin has paused; the legacy cron SHALL skip every deal a cycle
  owns. `POST /webhooks/renewal` SHALL quote any due deal regardless of
  the window and refuse (409) a not-due or unlisted one.
- REQ-6.3 A cycle is PAID ⇔ `renewal_jobs.paid_at` is set. Razorpay
  (webhook or "Mark paid by Razorpay"), "Mark paid by Yes Bank" and manual
  entry SHALL all set it through the same `settleRenewalPayment` path:
  record payment → cancel the Razorpay link if paid outside Razorpay →
  Zoho invoice → Zoho customer payment (invoice shows Paid) → WhatsApp
  confirmation with invoice PDF → invoice email → HubSpot line item + Next
  Renewal Date + Renewal Done. "Mark paid by Razorpay" SHALL be refused
  (409) unless Razorpay reports the link as paid. A one-time quote SHALL
  settle the same way (`settleAdditionPayment`, minus HubSpot) from the
  webhook or the same three buttons; `addition_charges.paid_at` is its
  PAID.
- REQ-6.4 Recording a payment SHALL be atomic (`paid_at IS NULL` claim);
  every settlement step SHALL be independent and idempotent; a daily sweep
  re-runs the unfinished steps of any paid cycle.
- REQ-6.5 On payment the system SHALL write one HubSpot line item with the
  cycle's term (`quarterly/P3M`, `per_six_months/P6M`, otherwise
  `monthly/P<n>M` with quantity n and the monthly share as price), start =
  period start, Date Paid = the payment date
  entered, price = the amount billed, adopting an item the team already
  entered for the same start date, and SHALL set the deal's Next Renewal
  Date to the day after the paid period.
- REQ-6.6 On days 5–6 / 7–8 / 9–10 of a cycle, counted from its start date,
  the system SHALL send reminder 1 / 2 / 3 to each unpaid cycle, at most
  once per stage, claiming the stage atomically (`reminder_N_sent_at IS
  NULL AND paid_at IS NULL`) immediately before sending; a paid cycle SHALL
  never be reminded; a link Razorpay reports as paid SHALL be settled instead.
- REQ-6.7 A one-time quote SHALL create its own Zoho estimate (line named
  after the service, narration as description) and Razorpay link, send the
  PDF to the WhatsApp group (phone fallback) and email it with the link
  when the Accountant Email is set, recording each channel; a delivery
  failure SHALL NOT fail the quote. On payment the invoice SHALL be
  confirmed to the group and emailed.
- REQ-6.8 Emails SHALL go only to the deal's Accountant Email; with none
  set, nothing is emailed and the reason is recorded on the row.
- REQ-6.9 All cycle days and reminder days SHALL be computed in IST.
  Previous cycles' rows SHALL never be modified by a new cycle.

## 3. Where it lives
`src/utils/billingCycle.ts`, `src/utils/monthlyEligibility.ts`,
`src/jobs/billingCycleCron.ts`, `src/jobs/generateRenewalQuote.ts`,
`src/jobs/renewalPipeline.ts`, `src/steps/settleRenewalPayment.ts`,
`src/steps/markRenewalDone.ts`, `src/jobs/settlementSweep.ts`,
`src/jobs/reminderCron.ts`, `src/steps/sendQuoteEmail.ts`,
`src/steps/sendInvoiceEmail.ts`, `src/steps/whatsappRecipient.ts`,
`src/repositories/clients.ts`, `src/steps/createAdditionCharge.ts`,
`src/steps/sendAdditionInvoiceEmail.ts`, `src/routes/pricingAdmin.ts`,
`src/routes/pricingAdminPage.ts`, migrations
`0010_renewal_jobs_monthly_billing.sql` and
`0011_term_cycles_and_addition_delivery.sql`.

## 4. Open items
- Live verification of the Zoho email API behaviour (PDF attachment,
  DRAFT→SENT side effect, bold name / description rendering), a group send,
  a term-cycle HubSpot line item, the Next Renewal Date write-back and a
  one-time quote on the test deal — see `PROGRESS.md`.
- 15 live deals have a blank, placeholder or passed Next Renewal Date and
  are quoted only once the team sets it; three deals have no dated line
  item; every
  Accountant Email is empty (WhatsApp only until filled).
