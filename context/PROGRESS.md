# Progress tracker

Last updated: 2026-09-22 (monthly billing cycles, WhatsApp-group + email delivery, one settlement path for Razorpay / Yes Bank / manual payments, 5th/7th/9th reminders, admin billing-cycle view — `context/features/step6.md`)

## How to use this file
- Claude Code updates this after every change — don't let it go stale.
- One row per feature/step. Status: `Not started` / `In progress` /
  `Blocked` / `Done`.
- Changelog at the bottom is append-only, newest entry on top.

## Status

| Step | Spec | Status | Notes |
|---|---|---|---|
| 1 — HubSpot → Zoho estimate (quote) | `context/features/step1.md` | Done | Fully verified end-to-end against real data: real due deal from Neon → real HubSpot fetch → real Zoho estimate (`QT-000414`). Idempotency confirmed live. |
| 2 — Razorpay payment link | `context/features/step2.md` | Done | Fully verified end-to-end against real data: real test deal → real Zoho estimate (`QT-000416`) → real live-mode Razorpay payment link (`plink_TG6rOiKpZwe2xM`). Idempotency confirmed live (identical re-run reused both). |
| 3 — Send quote + payment link via Periskope | `context/features/step3.md` | Done | Fully verified live end-to-end against the real test deal: real Zoho estimate PDF download → real Periskope WhatsApp send (confirmed `delivered` + received) → `renewal_jobs` marked done. No HubSpot write (see notes below — there's no real "Quote Sent" stage). Idempotent re-run confirmed. |
| 4 — Razorpay webhook → Zoho invoice → WhatsApp confirmation | `context/features/step4.md` | Done | Live-verified end-to-end 2026-07-22: real Razorpay test-mode payment → signature-verified webhook → real Zoho invoice created (`INV-10589`) and read back correctly → Periskope WhatsApp message **with invoice PDF attached** → HubSpot deal moved to "Renewal Done". `renewal_jobs` row confirmed clean (`invoice_step_status: done`, `periskope_payment_confirmed_sent: true`, `hubspot_renewal_done: true`, `error_log: null`). |
| 5 — Overdue payment reminders (WhatsApp) | `context/features/step5.md` → superseded by `step6.md` | Done (re-enabled) | Rewritten 2026-09-22 to the 5th/7th/9th IST schedule for monthly cycles (atomic claim before send, paid cycles never reminded, Razorpay lost-webhook guard) and re-enabled in `src/index.ts`. Nothing can fire before the first `YYYY-MM` cycle exists (October 2026). Message copy is still the placeholder. |
| 6 — GST + TDS on renewal estimates | n/a (no separate feature spec) | Done | See 2026-07-31 changelog. Live-verified: correct GST18 + TDS 10% math on two real estimates via the full webhook pipeline. |
| 7 — Supabase `client_pricing` renewal-price override | n/a (no separate feature spec) | Done | See 2026-07-31 changelog. Renewal pipeline reads the override, live-verified; all 27 real VA-pipeline deals seeded from HubSpot. Editable via the admin interface (step 8). `addition_price` column was added, found unused after the addition-charges revision (step 9), and **dropped** same day (`0008_drop_client_pricing_addition_price.sql`). |
| 8 — Pricing admin interface (`/admin/pricing`) | n/a (no separate feature spec) | Done | See 2026-07-31 changelog. Lists VA-pipeline deals, editable base price (saves to `client_pricing`), and an addition amount+description+Send control per deal. **No auth** — known, deferred gap. |
| 9 — Addition charges (one-off quote/link/WhatsApp, separate from renewal) | n/a (no separate feature spec) | Done | See 2026-07-31 changelog. Own table (`addition_charges`), own quote+Razorpay link+WhatsApp send (with quote PDF), and own payment→invoice→WhatsApp-confirmation flow (with invoice PDF) mirroring the renewal pipeline's step 4 — both live-verified via a simulated signed Razorpay webhook. |
| 10 — Monthly billing cycles (calendar-month quotes, "Virtual Accounting / Service period: …") | `context/features/step6.md` | Done — unit-tested; live verification pending | Migration `0010` applied live. Generator runs IST days 1–4; first cycle is October 2026. Classification rendered live on the admin page 2026-09-22 (28 deals). See the 2026-09-22 changelog. |
| 11 — WhatsApp group + Zoho email delivery | `context/features/step6.md` | Done — live verification pending | Group id from `clients.whatsapp_group_id` (24/27 billed deals have one; contact phone fallback). Email via Zoho Books' email API — **not yet exercised live** (token scope, PDF attachment, DRAFT→SENT side effect to confirm). |
| 12 — One settlement path (Razorpay / Yes Bank / manual) + HubSpot Renewal line item | `context/features/step6.md` | Done — unit-tested; live verification pending | `settleRenewalPayment` with atomic `claimPayment`, Razorpay link cancelled on manual payment, independent idempotent steps, daily sweep; `markRenewalDone` creates one complete HubSpot line item and stores its id. |
| 13 — Admin billing-cycle view + "Paid through Yes Bank" / "Record manual payment" | n/a | Done — rendered live 2026-09-22 | `/admin/pricing` shows the billing kind (+ reason) per deal, a Billing-cycles table and `POST /admin/pricing/record-payment`. "Add One-Time Payment" renamed 2026-09-22 (it records a payment; it never created one). Still no auth (business decision). |
| 14 — Term billing cycles (quarterly / half-yearly) on the Next Renewal Date, one-time quotes to group + email | `context/features/step6.md` | Done — unit-tested; live verification pending | Cycle decided from the latest line item's Term; term cycles quoted the day the last term ends at the last-paid amount, reminded 4/6/8 days later, HubSpot line item with the same term. `POST /admin/pricing/generate-quote` ("Quote now") for anything past the 4-day window. One-time quotes take service + narration and go to the group and by email. Migration `0011` applied live. 168/168. |

## Blocked / open questions
- No auth on `/admin/pricing` or its two POST endpoints — anyone who
  reaches the URL can view all client prices and trigger a real
  charge/WhatsApp send. Deferred per explicit instruction; revisit before
  deploying anywhere reachable outside a trusted network.
- ~~`client_pricing.addition_price` column exists but is unused...~~ —
  **resolved 2026-07-31.** Column dropped entirely
  (`0008_drop_client_pricing_addition_price.sql`) rather than left as
  dead weight, once confirmed permanent (superseded by the separate
  `addition_charges` flow, step 9).
- `ZOHO_REFRESH_TOKEN` was rotated 2026-07-31 to add `settings.READ`
  scope, and was briefly visible in a chat transcript during the
  exchange — flagged for a further rotation once things are confirmed
  stable, same caution as the still-open 2026-07-22 exposure below.
- ~~Step 5 (overdue reminders) is fully implemented but intentionally
  disabled~~ — **re-enabled 2026-09-22** with the 5th/7th/9th schedule the
  business asked for (`context/features/step6.md`).
- ~~Step 5's migration (`0004_renewal_jobs_step5.sql`) has not been applied
  to the live Supabase project yet~~ — **resolved 2026-09-21**: confirmed
  applied live via `list_tables`; the note was stale.
- **Live verification still owed for the 2026-09-22 monthly-billing work**,
  on test deal `337128679127` (its line items are bare — no term/end date —
  so it currently classifies as *not monthly*; give it a monthly/P1M line
  item first): Zoho email-estimate / email-invoice (current token scope,
  PDF attached?, DRAFT→SENT side effect, bold "Virtual Accounting" +
  description on the PDF), a Periskope send to a real test **group** id
  (none exists on the test deal's `clients` row yet), a HubSpot
  `createRenewalLineItem` (does `hs_product_id` override name/price?),
  Razorpay `cancelPaymentLink`, a simulated `payment_link.paid` delivered
  twice, "Paid through Yes Bank" / "Record manual payment" from the admin
  page, a **one-time quote** (service + narration → group + email), **Quote
  now** on a stale term, and a quarterly-term HubSpot line item
  (`quarterly/P3M`). All sends reach real channels, so these need an
  explicit go-ahead.
- **Go-live data checks (2026-09-22, Next Renewal Date rule):** 13 deals
  point at a future Next Renewal Date (10 of them 1 October, quoted that
  morning), 12 at a date that has already passed and 3 at the 1970-01-01
  placeholder — those 15 are quoted only once the team sets the date in
  HubSpot (the page lists them under "Renewal date needs fixing"). Down The
  Rabbit Hole's
  `P7M` line item is a normal 7-month cycle (next renewal 1 Apr 2027). Rapheal, MD Afreed and SLV Trades
  have no dated line item and are never billed. Yearly (Sahil, the test
  deal) stays on the legacy due-date flow.
- Zoho org setting to check before October: no Zoho customer payment is
  recorded (unchanged), so if Zoho's own automated payment reminders are
  on, Zoho will chase customers we have marked paid.
- The reference invoice image mentioned in the 2026-09-21 brief never
  arrived; the quote/invoice layout has not been compared against it.
- Step 5's three WhatsApp reminder message texts are placeholder copy,
  not yet confirmed by the business (see
  `src/steps/sendOverdueReminder.ts::reminderMessage`).
- Whether step 5's T+7 "services discontinued" notice needs an actual
  system action (e.g. HubSpot dealstage change) or stays message-only —
  currently message-only.
- Internal notification scope for step 3 *and* step 4 not yet confirmed
  (see `ARCHITECTURE.md` §6)
- What happens if a `line_items.due_on` row is still present the day after
  it was processed (external Neon sync lag, or `due_on` not advancing) —
  `renewal_jobs` idempotency should prevent a duplicate estimate, but this
  hasn't been tested against a real repeated-due-date case (see
  `ARCHITECTURE.md` §6).
- Whether step 3/4 also notify an internal GM/VA channel, or are
  client-only (see `ARCHITECTURE.md` §6)
- ~~Step 4 is implemented (code) but not live-tested...~~ — **resolved
  2026-07-22.** Live-verified end-to-end; see the Done row above and the
  2026-07-22 changelog entries for the full story (three separate Zoho
  scope gaps found and fixed one at a time: `invoices.CREATE`,
  `estimates.READ`, `invoices.READ`).
- ~~Migration `0003_renewal_jobs_step4.sql`...~~ — **resolved.** Confirmed
  applied to the live Supabase `renewal_jobs` table (verified via
  `list_tables`) — all five step-4 columns present with correct types.
- The test deal (`337128679127`) now has ~10 duplicate DRAFT estimates
  and ~10 duplicate DRAFT invoices in the live Zoho Books org from
  repeated testing during step 4 debugging (2026-07-22) — accumulated
  partly from real retries, partly from direct API calls made while
  diagnosing the real endpoint/response shapes. Left uncleaned per
  explicit instruction ("leave it, just fix the code"); clean up
  manually in the Zoho Books UI when convenient — none are real customer
  data. Same deal also now has an extra HubSpot line item
  (`333136447217`, "TEST - line item copy verification", ₹1) from
  verifying REQ-4.12 live — also left in place per explicit instruction.
- `ZOHO_REFRESH_TOKEN` currently in `.env`/live use was pasted into the
  chat transcript multiple times during step-4 debugging on 2026-07-22.
  Per this project's own security posture, treat it as exposed and
  rotate it again (same Self Client → Generate Code → exchange flow)
  once step 4 is confirmed stable — not urgent since it's a test-mode
  integration, but shouldn't be left indefinitely.
- ~~Step 3's `renewal_status` HubSpot deal property...~~ — **resolved
  2026-07-21.** There is no "Quote Sent" stage in the real VA pipeline.
  Step 3 makes no HubSpot write at all now; see `ARCHITECTURE.md` §3.6.
- The connected Supabase project already has live `clients` /
  `client_contacts` tables (67 rows, untracked by this repo's
  migrations) that closely match step3.md's *original* WhatsApp-lookup
  design. Step 3 was deliberately implemented against HubSpot contact
  phone instead, per explicit instruction — revisit whether
  `clients`/`client_contacts` should be the source of truth going forward
  (see `ARCHITECTURE.md` §3.6, §6).

## Changelog
- 2026-09-22 (email list) — The team reverted `accountant_email` to a
  plain-text field, so several recipients now live in that one field as a
  comma-separated list (`parseEmailList`: commas, semicolons or spaces;
  junk ignored, duplicates dropped). The three-field variant of a few
  hours earlier is gone; `accountant_email_2/_3` are not needed. The page
  has one box per client ("email1, email2, email3") and shows how many
  addresses will be mailed. Verified live: HubSpot accepts the two-address
  value on the test deal. 184/184.
- 2026-09-22 (three accountant emails) — HubSpot validates
  `accountant_email` as a single address (a comma-separated pair is
  rejected with INVALID_EMAIL), so multiple recipients use three fields:
  `accountant_email`, `accountant_email_2`, `accountant_email_3`. The deal
  fetch collects every valid, distinct one (`billingEmails`), Zoho's
  `to_mail_ids` gets the whole list, and the admin page shows three boxes
  per client saved together. **Fields 2 and 3 must be created in HubSpot
  by the team** (deal properties, single-line text, internal names exactly
  as above) — the app token has no schema scope (403 on create). Until
  then saving from the page fails with HubSpot's error; reading works.
- 2026-09-22 (any term) — Every whole number of months under a year is a
  billing cycle (P7M = "Every 7 months", quoted for 7 months at the last
  paid amount); the "unsupported" classification is gone. A year or longer
  still goes to the legacy due-date flow. On payment a term without a
  HubSpot frequency word is written as monthly frequency, quantity =
  months, price = monthly share (how the team enters them). Down The
  Rabbit Hole (P7M, next renewal 1 Apr 2027) is now a normal cycle.
- 2026-09-22 (Next Renewal Date) — The quote date now comes from the
  HubSpot deal's **Next Renewal Date** for every cycle (monthly and term);
  the line item's own dates no longer decide anything, only its Term
  (cycle length) and price. A client is quoted on that date (3-day
  catch-up), the row is keyed by it, and on payment the automation moves
  the date forward by one cycle (`updateDealNextRenewalDate`). The
  **Quote now** button and `POST /admin/pricing/generate-quote` are
  removed — quotes are automatic at 11:00 IST; `POST /webhooks/renewal`
  remains the only on-demand path. Admin page: next-quote date per client,
  "Quoting today" and "Renewal date needs fixing" tiles. RED confirmed
  (23 tests), GREEN: typecheck clean, 181/181.
- 2026-09-22 (accountant email) — The email source is the new HubSpot deal
  field **Accountant Email** (`accountant_email`, empty on every deal
  today), not Billing POC Email, which the team must not edit. Quotes and
  invoices go to the Accountant Email when it is a valid address, else to
  the contact's email; the admin page column is now "Accountant email" and
  writes to that field (`POST /admin/pricing/accountant-email`).
  **No fallback** (decision 2026-09-22): with the field blank nothing is
  emailed — the quote and invoice still go out on WhatsApp — and the step
  records "no Accountant Email on the HubSpot deal". Today that is every
  deal; the page shows a "No accountant email" tile and an amber note per
  client until the team fills the field in.
- 2026-09-22 (admin tweaks) — "Paid through Yes Bank" now opens an inline
  form with the real payment date (+ narration) instead of a prompt, so
  HubSpot's Date Paid is the day the money arrived, not the day the
  accountant noticed. Quotes and invoices are emailed to the deal's
  HubSpot **Billing POC Email** (valid address) with the contact's email
  as fallback; the Clients table shows and edits it in place, writing back
  to HubSpot (`fetchVaDealEmails`, `updateDealBillingPocEmail`,
  `HubspotDeal.billingEmail`). A deal with no associated contact is now
  billable when its POC email is set (Ayurpet). Live: 15 deals use the POC
  email, 11 fall back, 4 junk values ignored, 2 deals (Leon, Root Botanie)
  have no email at all and cannot be emailed until one is entered.
  typecheck clean, 178/178.
- 2026-09-22 (UI) — Admin page redesigned (`src/routes/pricingAdminPage.ts`)
  along the 2026 dense-UI guidance: ledger-style summary strip, visible
  table grid with monospaced numerals, fluid type via clamp(), stage IDs
  shown as names, toasts + in-button progress for every action, a "Reduce
  motion" toggle that also honours prefers-reduced-motion, no blur/glass.
  Same endpoints, payloads and confirm dialogs as before; rendered live.
- 2026-09-22 (later) — Gap fixes against the business flowchart: quarterly
  and half-yearly clients were outside the flow, one-time quotes went to a
  personal number with no email, and "Add One-Time Payment" was misnamed.
  TDD checkpoint commits (RED confirmed before every production change;
  `npm run typecheck` clean and `npm test` green after each) — 168/168 at
  the end, up from 126/126:
  1. Migration `0011_term_cycles_and_addition_delivery.sql` (applied
     live): `renewal_jobs.term_months`; `addition_charges.narration`,
     `periskope_sent`, `periskope_skip_reason`, `estimate_email_sent`,
     `invoice_email_sent`, `email_error`.
  2. `classifyDeal(deal, today)` decides from the latest line item's Term
     (monthly / term / unsupported / none); `billingCycle.ts` gains
     `servicePeriodFrom`, `termBillingCycle`, `daysBetween`.
  3. `src/jobs/billingCycleCron.ts` (was `monthlyBillingCron.ts`) with
     the 4-day generation window for both kinds; `src/jobs/generateRenewalQuote.ts`
     behind `POST /admin/pricing/generate-quote` and `/webhooks/renewal`.
  4. Term quotes at the last-paid amount (`EstimateLine` on
     `createEstimate`), `term_months` recorded; `createRenewalLineItem`
     writes the cycle's frequency + term.
  5. Reminders per cycle from its own start date (`findUnpaidCycleJobs`,
     `reminderStageForJob`).
  6. One-time quotes: service + narration, group + email, invoice email on
     payment, delivery recorded on `addition_charges`.
  7. Admin page: billing kind badges, Quote now, one-time quote inputs and
     table, "Record manual payment". Rendered live (28 deals).
  Decisions 2026-09-22: term price = same as last paid; terms that ended
  before go-live are not auto-quoted; yearly stays legacy; P7M unsupported.
  Files: `context/ARCHITECTURE.md` §3.5, §3.7c, §3.8; `context/features/step6.md`.
- 2026-09-22 — Monthly billing cycles for VA customers (spec:
  `context/features/step6.md`; design decisions confirmed with the
  business 2026-09-21; `ARCHITECTURE.md` §3.8). Built as TDD checkpoint
  commits (RED confirmed before each production change); `npm run
  typecheck` clean and `npm test` green after every one — 126/126 at the
  end, up from 52/52:
  1. Migration `supabase/migrations/0010_renewal_jobs_monthly_billing.sql`
     (applied live): `service_period_start`, `billed_price`, `paid_at`,
     `payment_method/amount/date/narration/reference`,
     `hubspot_line_item_id`, `estimate_email_sent`, `invoice_email_sent`,
     `email_error`; partial unique index on `zoho_estimate_number`.
  2. `src/utils/billingCycle.ts` — IST date helpers (fixed +05:30 on UTC
     getters); `servicePeriod("2026-10")` → "Service period: 1 October
     2026 to 31 October 2026".
  3. `src/clients/hubspot.ts::fetchVaDealsWithLineItems` (search +
     associations batch + line-item batch reads chunked by 100; per-deal
     parse errors recorded, not thrown) and
     `src/utils/monthlyEligibility.ts::classifyDeal`.
  4. `createEstimate(…, cycle)` bills one "Virtual Accounting" line with
     the service-period description; `createZohoEstimate(…, cycle)` keys
     the row by month, requires a `client_pricing` row for a monthly cycle,
     records `billed_price`/`service_period_start`, and no longer writes
     the quote-time HubSpot log-back line item.
  5. WhatsApp group recipient (`src/repositories/clients.ts`,
     `src/steps/whatsappRecipient.ts`, `periskope.ts::isValidWhatsappRecipient`)
     for quote, confirmation and reminders; contact phone fallback.
  6. Zoho email of quote and invoice (`zoho.ts::emailEstimate/emailInvoice`,
     `src/steps/sendQuoteEmail.ts`, `src/steps/sendInvoiceEmail.ts`,
     best-effort with `email_error`).
  7. `src/jobs/monthlyBillingCron.ts` (IST days 1–4), shared
     `src/jobs/renewalPipeline.ts`, legacy `runRenewalCheck(monthlyDealIds,
     now)` skips monthly deals and queries Neon by IST date,
     `/webhooks/renewal` classifies the deal, cron `noOverlap`, fail-closed
     when classification fails.
  8. `src/steps/settleRenewalPayment.ts` (one path for Razorpay / Yes Bank /
     manual; atomic `claimPayment`; link cancelled first on a manual
     payment; independent idempotent steps; in-flight guard),
     `src/jobs/settlementSweep.ts`, `convertZohoInvoice` reclaims
     failed/stale steps and no longer requires the link step,
     `markRenewalDone` creates ONE complete HubSpot "Renewal" line item
     (adopts a hand-entered one; id stored before the stage move),
     `razorpay.ts::fetchPaymentLink/cancelPaymentLink`, webhook reads the
     payment id/amount/date and answers 502 (outstanding steps) / 503
     (in progress) so Razorpay retries.
  9. Reminders rewritten to IST days 5–6 / 7–8 / 9–10 with `claimReminder`
     / `releaseReminder`, `findUnpaidMonthlyJobs`, a Razorpay lost-webhook
     guard, and re-enabled in `src/index.ts`; the old T+2/4/7 helpers were
     removed.
  10. Admin: Billing column, Billing-cycles table, "Paid through Yes Bank"
     and "Add One-Time Payment" → `POST /admin/pricing/record-payment`.
     Rendered live against real HubSpot + Supabase data (28 deals
     classified; cycles table empty as expected before 1 Oct).
  **Found while testing, left as-is**: `parseLineItem` accepts a blank
  HubSpot price (`Number("") === 0`) despite the 2026-09-15 note; only
  legacy deals without a `client_pricing` row are exposed. Pre-existing
  unused import `upsertClientPricing` in `createZohoEstimate.ts` left
  alone.
  **Not yet done**: the live spikes listed under "Blocked / open
  questions" — every one sends to a real channel.
- 2026-09-15 — Bug-fix pass addressing High and Medium findings from a
  full-pipeline audit (Zoho client/scopes + concurrency/validation/
  security across the whole codebase). All fixes are additive/surgical;
  `npm run typecheck` and `npm test` (52/52) both pass after every change.
  **High severity:**
  1. **Concurrent Razorpay webhook deliveries could create duplicate Zoho
     invoices.** `/invoices/fromestimates` is confirmed non-idempotent
     (§3.3), and the existing `invoice_step_status` guard was a plain
     read-then-act check with no row lock. Added `claimInvoiceStep`
     (`src/repositories/renewalJobs.ts`) — an atomic
     `UPDATE ... WHERE invoice_step_status = 'pending'` that flips it to
     a new transient `"converting"` value, so only one concurrent caller
     can win. `convertZohoInvoice.ts` now claims before calling Zoho; a
     losing caller polls for the winner's result (`waitForInvoiceStepDone`,
     5 attempts, 1s apart) instead of also converting.
  2. **`addition_charges` had no unique constraint** (unlike
     `renewal_jobs`/`client_pricing`), so double-clicking "Send" in the
     no-auth pricing admin UI could create two full duplicate flows (Zoho
     estimate, Razorpay link, WhatsApp send). Added
     `findRecentDuplicateAdditionCharge`
     (`src/repositories/additionCharges.ts`) — treats an identical
     deal+amount+description charge created in the last 5 minutes and not
     failed as the same request; `createAdditionCharge` returns that
     existing result instead of creating a second one.
  3. **A crash between Zoho estimate creation and the Supabase write
     could create an orphaned, unrecorded estimate**, and resuming the
     job would create a second real one (Zoho's `/estimates` has no
     idempotency key). Added `claimZohoStep`
     (`src/repositories/renewalJobs.ts`), same atomic-claim pattern as
     above with a transient `"creating"` status. `createZohoEstimate.ts`
     now throws a clear, actionable error if a job is found stuck in
     `"creating"` on entry (naming the `reference_number` to check in
     Zoho) instead of silently retrying.
  4. **`POST /webhooks/renewal` had no auth and bypassed the
     active-customer dealstage gate** that the automatic cron applies —
     anyone who could reach the route could trigger a real charge for any
     `deal_id`. Added a required `x-webhook-secret` header (new
     `RENEWAL_WEBHOOK_SECRET` env var, checked with `timingSafeEqual`,
     `src/routes/renewalWebhook.ts`) and applied the same
     `VA_ACTIVE_CUSTOMER_DEALSTAGES` gate the cron uses. **Manual testing
     of this route now requires the shared-secret header** — set
     `RENEWAL_WEBHOOK_SECRET` in `.env` before testing or deploying.
  5. **HubSpot line-item `price`/`quantity` were coerced with a bare
     `Number(...)`**, so a blank/malformed value silently became `0`/`1`
     instead of failing — capable of producing a real ₹0 Zoho estimate.
     `fetchDealWithLineItemsAndContact` (`src/clients/hubspot.ts`) now
     rejects any non-finite or negative value with a clear error.
  **Medium severity:**
  6. Zoho token refresh (`getAccessToken`) now de-dupes concurrent
     cache-miss calls into one in-flight request instead of each caller
     firing its own request at Zoho's OAuth endpoint.
  7. Zoho OAuth params (`client_secret`, `refresh_token`, etc.) are now
     sent as a POST body instead of URL query-string params — less likely
     to end up in proxy/access logs, and this project has had a real
     refresh-token-exposure incident before (see the still-open rotation
     item below).
  8. `createEstimate`'s response is now validated to have the expected
     `estimate_id`/`estimate_number`/`total` fields before use, instead of
     letting a malformed Zoho response surface later as an opaque
     `undefined` crash.
  9. Added `isValidWhatsappPhone` (`src/clients/periskope.ts`) — a
     malformed HubSpot `phone` value no longer silently resolves to some
     other real WhatsApp number. Every Periskope-sending step (3, 4, 5,
     and addition charges) now treats an invalid phone the same as a
     missing one: skip gracefully and record the reason.
  **Also fixed**: the cron schedule was documented in `ARCHITECTURE.md`/
  `PROGRESS.md` as 09:00 IST (changed from 06:00 on 2026-07-31), but the
  actual code (`src/index.ts`) has run at **11:00 IST**
  (`cron.schedule("0 11 * * *", ...)`) — an undocumented drift found
  during the audit. Docs corrected to 11:00 IST to match deployed code;
  the code itself was not changed.
  **Not yet done**: no migration was needed (all new state is either
  in-memory or reuses existing columns/tables with new string values), so
  nothing new to apply to Supabase. `RENEWAL_WEBHOOK_SECRET` must be set
  in the live `.env` before `/webhooks/renewal` will accept requests —
  the existing deployment's `.env` does not have this yet.
- 2026-07-31 — Added `client_pricing.deal_name`
  (`supabase/migrations/0009_client_pricing_deal_name.sql`, applied
  live) — a denormalized, non-authoritative copy of the HubSpot deal
  name, purely so a direct query against `client_pricing` is
  self-describing without joining HubSpot. `upsertClientPricing` now
  takes an optional `dealName` param;
  `POST /admin/pricing/base-price` accepts an optional `dealName` field
  and the admin page's frontend now sends `deal.dealName` (already known
  from the deals list) on every save. **Backfilled all 27 existing
  rows** via 27 real calls to the same `POST /admin/pricing/base-price`
  endpoint (not a direct SQL write) — each preserving its existing
  `base_price` unchanged and adding the deal's current HubSpot name,
  pulled fresh via the Search API. Typecheck and `npm test` (52/52) both
  pass; live-verified via `execute_sql` that all 27 rows show the
  correct name and an unchanged price.
- 2026-07-31 — Dropped `client_pricing.addition_price`
  (`supabase/migrations/0008_drop_client_pricing_addition_price.sql`,
  applied live) — confirmed genuinely unused (grepped the codebase: only
  referenced in a stale comment and passed through, unused, by the admin
  API response) after the addition-charges revision made it permanently
  dead rather than temporarily unused. Removed from
  `src/repositories/clientPricing.ts`'s `ClientPricing` type and
  `src/routes/pricingAdmin.ts`'s deals-list response; cleaned up the
  stale comment in `src/steps/createZohoEstimate.ts`. Typecheck and
  `npm test` (52/52) both pass.
- 2026-07-31 — Revised the `client_pricing` feature (same day as its
  initial build, below) and added two new features on top of it, all per
  explicit instruction during design review:
  1. **Reverted addition-into-renewal billing.** The initial version
     billed `base_price + addition_price` together on the renewal
     estimate. Changed to bill `base_price` alone — additions are now a
     fully separate flow (see #3 below), never folded into the renewal
     total, to avoid a timing collision (an addition set after the day's
     cron has already fired had no clean way to reach the client under
     the old design). `client_pricing.addition_price` column left in
     place but is now unused/always 0 for the renewal pipeline.
  2. **Seeded `client_pricing` for all 27 real VA-pipeline deals**, pulled
     live from HubSpot's deal Search API (pipeline `1534965463` +
     `VA_ACTIVE_CUSTOMER_DEALSTAGES`, the same filter the live renewal
     cron already uses) — `base_price` set to each deal's current
     `lineItems[0].price`, `addition_price = 0`. One-off script, not
     committed to the repo. The existing test deal (`337128679127`) was
     excluded from the seed to avoid clobbering its in-progress test
     values.
  3. **Added `addition_charges`** (`supabase/migrations/0006_addition_charges.sql`,
     `0007_addition_charges_invoice.sql`, both applied live) and
     `src/steps/createAdditionCharge.ts` — a fully independent one-off
     charge flow (own Zoho quote with GST18+TDS, own Razorpay link, own
     WhatsApp send with the **quote PDF** attached — changed from an
     initial text-only version, per explicit instruction that the PDF
     itself should go out). Payment is handled by extending the existing
     `src/routes/razorpayWebhook.ts` to also check `addition_charges`
     (via `findAdditionChargeByEstimateNumber`) when an incoming
     `payment_link.paid` event doesn't match a `renewal_jobs` row —
     converts the addition's estimate to a real Zoho invoice
     (`src/steps/convertAdditionInvoice.ts`, reuses the existing
     `convertEstimateToInvoice`) and sends the **invoice** PDF as the
     WhatsApp payment confirmation (`src/steps/sendAdditionPaymentConfirmation.ts`),
     mirroring the renewal pipeline's step 4 exactly. No HubSpot write on
     an addition's payment (nothing to move — no dealstage concept for a
     one-off charge).
  4. **Added the admin interface**: `GET /admin/pricing`
     (`src/routes/pricingAdmin.ts` + `src/routes/pricingAdminPage.ts`,
     HTML inlined as a template string rather than a static file, since
     `tsc`'s build doesn't copy non-`.ts` files into `dist/`). Lists VA
     deals (`fetchVaPipelineDeals`, new in `src/clients/hubspot.ts`) with
     an editable base-price field (`POST /admin/pricing/base-price`) and
     a per-deal amount+description+Send control
     (`POST /admin/pricing/send-addition`). **No auth** — deferred per
     explicit instruction; flagged as an open item.
  **Live-verified end-to-end**, via the real HTTP endpoints (not calling
  step functions directly): base-price save; an addition send (₹50 base
  → estimate `QT-000447`, total ₹54, quote PDF confirmed sent); the
  renewal pipeline re-run for the same deal immediately after, confirming
  it billed ₹32.40 (₹30 base, completely unaffected by the addition sent
  moments earlier — proving the two flows are truly independent); a
  second addition send (₹60 → `QT-000449`, total ₹64.80) followed by a
  manually HMAC-signed `payment_link.paid` webhook against the real
  `/webhooks/razorpay` endpoint, confirming a real Zoho invoice
  (`INV-10617`) was created and the invoice-PDF confirmation was sent.
- 2026-07-31 — Added a `client_pricing` Supabase table
  (`supabase/migrations/0005_client_pricing.sql`, applied live) that now
  overrides HubSpot's line-item price for the renewal amount actually
  billed. `client_pricing.hubspot_deal_id → base_price, addition_price`;
  `src/steps/createZohoEstimate.ts` looks up this table before building
  the estimate — if a row exists, `base_price + addition_price` is billed
  instead of `deal.lineItems[0].price`; if no row exists (new/unmigrated
  deal), falls back to the existing HubSpot line-item behavior unchanged.
  After a successful estimate, the billed amount is written back to
  HubSpot as a **new** line item via the existing `addLineItemToDeal`
  (`src/clients/hubspot.ts`, reused from step 4) — this is a one-way log,
  never read back for pricing, so HubSpot and Supabase can't drift
  permanently out of sync the way two independent, mutually-read pricing
  stores would. New repository file `src/repositories/clientPricing.ts`
  (`findClientPricing`, read-only for now — no write path yet, since the
  editing interface itself hasn't been built). Rationale for not making
  Supabase and HubSpot two independently-trusted price sources: see the
  design discussion in this session — HubSpot remains contractually the
  "what did we actually charge" record via the log-back write, matching
  `agent.md`'s existing rule to treat HubSpot as authoritative for
  money-related data. **Live-verified end-to-end 2026-07-31**: seeded a
  test row (`337128679127` → base 34000, addition 3000), ran
  `POST /webhooks/renewal`, confirmed the resulting Zoho estimate
  (`QT-000446`) billed the overridden amount (37000 pre-tax → GST18 +
  TDS 10% → 39960 total, matching the manual math), and confirmed HubSpot
  received a new line item priced at exactly 37000 (`hs_lastmodifieddate`
  updated at the same moment). **Known gap, deliberate**: no write/edit
  interface exists yet — the table can only be populated by direct SQL
  today. **Also deliberate, per explicit instruction**: no reconciliation
  logic between HubSpot's price and Supabase's price (no `==`/`!=`
  comparison) — Supabase always wins once a row exists, full stop.
- 2026-07-31 — Added GST (18%) and TDS (10%, "Professional fees New tax")
  to every Zoho renewal estimate. `src/clients/zoho.ts::createEstimate`
  now sends `tax_id` (GST18, `2273874000000030203`) and `tds_tax_id`
  (`2273874000000527020`) on the line item — both org-specific IDs,
  confirmed live against this Zoho org (no generic lookup endpoint exists
  for TDS rates; found by re-authorizing the refresh token with the added
  `ZohoBooks.settings.READ` scope, then scanning existing estimates for
  one with `line_item_tds` already populated — `QT-000369`, "TWELVE FOUR
  VENTURES"). Zoho computes CGST+SGST (intra-state) or IGST (inter-state)
  automatically from the one `GST18` tax group, and nets out TDS in its
  own `total` field — confirmed live (₹40,000 base → ₹43,200 total; later
  ₹30 base → ₹32.40 total via the real webhook). No change needed in
  `src/steps/createRazorpayLink.ts` — it already charges
  `zoho_estimate_total` verbatim, and Razorpay itself never adds tax on
  top of the `amount` field sent to it (confirmed via a real test-mode
  payment link: sent 43200, payment page showed exactly INR 43,200.00).
  Rotated `ZOHO_REFRESH_TOKEN` as part of the scope change; flagged for a
  further rotation since it was briefly visible in a chat transcript
  during the exchange (same caution as the 2026-07-22 token exposure
  below).
- 2026-07-23 — Fixed a pre-existing bug surfaced by the first VPS Docker
  build: all 11 files under `src/test/*.test.ts` imported the module under
  test via a same-directory relative path (e.g.
  `import { sendDocumentMessage } from "./periskope.js"`), but the real
  files live in `src/clients/`, `src/steps/`, or `src/jobs/` — every *other*
  import in those same files already correctly used `../clients/...` etc.,
  only the file-under-test import was wrong. `vitest` apparently tolerated
  or never actually exercised this (all 11 files/52 tests reported passing
  before this fix too), but plain `tsc` (what `npm run build` runs, and
  what the Docker build's `RUN npm run build` step hits) does not resolve
  these paths and fails the whole build with 11 `TS2307` errors — this is
  what broke the user's first `docker compose up --build` on the VPS.
  Fixed each import to its correct relative path per the mapping above.
  Verified locally: `npm run typecheck` clean, `npm test` 11/11 files,
  52/52 tests passing (unchanged pass count, now for real). No production
  (`src/clients`, `src/steps`, `src/jobs`, `src/repositories`, `src/routes`)
  code touched.
- 2026-07-23 — Added Docker deployment files: `Dockerfile` (multi-stage
  build using `node:22-alpine` — deliberately not `node:22-slim`, which a
  local vulnerability scan showed had *more* flagged critical/high CVEs
  than alpine, per explicit instruction after comparing both), `.dockerignore`,
  and `docker-compose.yml` (single service, `env_file: .env`, no Traefik
  labels — per explicit instruction, added later once the VPS's Traefik
  network/routing convention is confirmed). Matches the deployment already
  described in `ARCHITECTURE.md` §3.2 (single container, Hostinger VPS).
  Intended VPS workflow: `git clone`/`git pull` the GitHub repo, then
  `docker compose up --build -d`; `.env` is created once on the VPS
  (gitignored, never committed) and reused across rebuilds. No GitHub
  remote set up yet — repo is not yet a git repository; user will handle
  git init/GitHub push themselves. No application code changed.
- 2026-07-23 — Implemented step 5 (overdue payment WhatsApp reminders,
  T+2/T+4/T+7). New migration `supabase/migrations/0004_renewal_jobs_step5.sql`
  (`reminder_1_sent_at`, `reminder_2_sent_at`, `reminder_3_sent_at`,
  `reminder_skip_reason` — **not yet applied live**). New
  `findOverdueUnpaidJobs`, `markReminderSent`, `markReminderSkipped` in
  `src/repositories/renewalJobs.ts` (widened the `RenewalJob` type with
  the four new columns — updated every existing test fixture across 8
  files to match, same mechanical update step 4 required). New
  `sendOverdueReminder` step (`src/steps/sendOverdueReminder.ts`): refuses
  to run unless `razorpay_step_status` is `done` (REQ-5.1), no-ops once
  `invoice_step_status` is `done` with no "disregard" follow-up (REQ-5.7),
  idempotent per stage via the three `reminder_N_sent_at` columns
  (REQ-5.6), skips gracefully and records a reason when no contact phone
  is found (REQ-5.5), reuses `src/clients/periskope.ts::sendTextMessage`
  (previously implemented but unused in production — now used for real).
  New `runOverdueReminderCheck` (`src/jobs/reminderCron.ts`): queries
  overdue-and-unpaid jobs, parses the due date out of the existing
  `billing_period` column (`parseDueDate` — resolves the open item on
  whether this parses reliably; confirmed yes, since `billing_period` is
  always `${billing_cycle}-${next_renewal_date}` with `next_renewal_date`
  always a plain `YYYY-MM-DD` string), computes whole days overdue in UTC
  (`daysOverdue`), and picks the next unsent stage due exactly today
  (`nextDueStage` — only an exact 2/4/7-day match triggers a send, so a
  job that's overdue by more than the matching day without an earlier
  stage sent does not retroactively fire that earlier stage). Wired into
  `src/index.ts` right after `runRenewalCheck()` in the same scheduled
  06:00 IST tick — not a second `node-cron.schedule(...)` registration,
  per the design already agreed in the 2026-07-22 entry below. New tests:
  `src/steps/sendOverdueReminder.test.ts` (REQ-5.1, 5.4, 5.5, 5.6, 5.7)
  and `src/jobs/reminderCron.test.ts` (`parseDueDate` against all three
  real `billing_cycle` values, `daysOverdue` via `vi.useFakeTimers`,
  `nextDueStage` stage-selection and idempotency) — the three helper
  functions were exported specifically so this previously-open-item logic
  gets direct unit coverage, unlike `renewalCron.ts`'s orchestration
  function which has never had a test file (integration-tested live
  only). Typecheck and `npm test` both pass (11 files, 52 tests, up from
  9/37). **Not yet live-tested**: migration not applied to the live
  Supabase table, and the three message texts
  (`src/steps/sendOverdueReminder.ts::reminderMessage`) are placeholder
  copy pending business confirmation — same "implemented, needs a live
  follow-up session" position step 2/3/4 were each in immediately after
  their own implementation. No HubSpot write added for this step (open
  item, not decided either way — see `ARCHITECTURE.md`).
- 2026-07-22 — Resolved step 5's cron open item: same daily `node-cron`
  schedule (06:00 IST) as the existing job, but kept as two separate
  functions (`runRenewalCheck`, new `runOverdueReminderCheck` in a new
  `src/jobs/reminderCron.ts`) called sequentially from one scheduled tick
  — not a second `node-cron.schedule(...)` registration, and not merged
  into one function. Reasoning: different data source (Neon vs Supabase),
  different query condition (due-today vs N-days-overdue-and-unpaid), and
  isolating a new/unproven reminder-query bug from the already
  live-verified renewal-creation flow. Updated `context/features/step5.md`
  §2/§3 only — still spec-only, no code yet.
- 2026-07-22 — Drafted spec for step 5 (overdue payment WhatsApp
  reminders), per explicit instruction: escalating reminders at T+2, T+4,
  and T+7 days past due, T+7 including a service-discontinuation notice.
  New `context/features/step5.md` (EARS requirements + design). Design
  decisions: "unpaid" reuses the existing `renewal_jobs.invoice_step_status
  != 'done'` signal from step 4 (no new external calls); "due date" is
  parsed from the existing `billing_period` column rather than adding a
  redundant date column, flagged as an open item to confirm parses
  reliably at implementation time; reminders stop once payment is
  confirmed, with no "disregard the last message" follow-up. Planned four
  new `renewal_jobs` columns (`reminder_1_sent_at`, `reminder_2_sent_at`,
  `reminder_3_sent_at`, `reminder_skip_reason`) documented in
  `ARCHITECTURE.md` §3.7 as **planned, not yet implemented** — no
  migration written yet. `ARCHITECTURE.md` §1/§2 also updated to mention
  the planned step. No code, no migration, no new cron — spec only, per
  explicit instruction to plan first.
- 2026-07-22 — Removed the `recurring_type = 'Renewal'` filter from the
  cron's Neon due-deal query (`src/clients/neon.ts::findDealsWithRenewalDueToday`),
  per explicit instruction — a due line item now triggers the automation
  regardless of its `recurring_type` value (`New`/`One-time`/`Renewal`).
  Narrowing to genuinely active, in-cycle customers is now done entirely
  by the active-customer dealstage gate added earlier the same day (see
  the next changelog entry) rather than by `recurring_type`. Typecheck
  and `npm test` both pass (9 files, 37 tests, unchanged).
- 2026-07-22 — Added REQ-4.12: once payment is confirmed, step 4 now also
  adds a **new** HubSpot line item to the deal, a copy (name/quantity/
  price) of the line item step 1 used to build that renewal's estimate —
  matches an existing real pattern already seen on live deals (e.g.
  "Leon Enterprises_VA" had 8 accumulated line items, one per past
  renewal). New `addLineItemToDeal` in `src/clients/hubspot.ts`, called
  from `src/steps/markRenewalDone.ts` right before the `dealstage` PATCH,
  guarded by the same `hubspot_renewal_done` flag (accepted risk of a
  duplicate line item on a failure between the two calls, per explicit
  instruction — not worth a separate DB flag for this). Live-verified
  directly against the real HubSpot API (not just unit tests, given
  today's track record on unverified endpoint guesses): created a real
  test line item on deal `337128679127` and confirmed it actually
  associated to the deal (`associationTypeId: 20`,
  `HUBSPOT_DEFINED`/`deal_to_line_item`) before writing it into
  production code. That test line item (`333136447217`, "TEST - line
  item copy verification", ₹1) was left in place per explicit
  instruction — clean up alongside the other test-data noted below.
  New unit tests in `markRenewalDone.test.ts`: adds the copy on success,
  skips gracefully if the deal somehow has no line items, and confirmed
  idempotent (no call at all when `hubspot_renewal_done` is already
  true). Typecheck and `npm test` both pass (9 files, 37 tests, up from
  35).
- 2026-07-22 — Added an active-customer dealstage gate to the daily cron
  (`runRenewalCheck` in `src/jobs/renewalCron.ts`). Neon's `line_items`
  table (the cron's due-deal source) has no `dealstage` column — confirmed
  via `describe_table_schema` against the shared `Live_HS_Updates` project
  (`misty-rice-89660278`) — so a due line item alone doesn't guarantee the
  deal is still an active customer. The cron now calls a new
  `fetchDealStage` (`src/clients/hubspot.ts`) for each due deal and skips
  (logs, doesn't error) any deal whose live `dealstage` isn't one of three
  VA-pipeline stages representing an active renewing customer: "Ready for
  Renewal" (`3668025064`), "Renewal Done" (`3102360263`), "Payment Done"
  (`2462646003`) — new `VA_ACTIVE_CUSTOMER_DEALSTAGES` constant. Two of
  the three IDs were confirmed directly by the business rather than
  discovered via the API — the global `dealstage` property-options list
  didn't contain them (`3668025064` isn't listed at all; `2462646003`
  belongs to a stage that's apparently been removed from the currently
  active options but is still a real, live value on real deals — same
  "same label, different pipeline/ID" trap that hit step 4's "Renewal
  Done" earlier, confirmed again here: verified against 27 real VA-deal
  matches, including obvious real client names like "Think Industrial
  (OPC) Private Limited <> VA", not test data). Applies **only** to the
  automatic cron, per explicit instruction — the manual
  `POST /webhooks/renewal` route is unaffected, so testing/support use
  with any `deal_id` still works. No test file added — `renewalCron.ts`
  has never had unit test coverage (integration-tested live only, same
  as before this change). Typecheck and `npm test` both pass (9 files,
  35 tests, unchanged).
- 2026-07-22 — Added invoice PDF attachment to step 4's WhatsApp payment
  confirmation (was plain text only). Added `getInvoicePdf` to
  `src/clients/zoho.ts` (`GET /invoices/pdf?organization_id=...&invoice_ids={id}`,
  confirmed live — same pattern as the existing `getEstimatePdf`, no new
  scope needed since `invoices.READ` was already added earlier the same
  day). `sendPaymentConfirmation.ts` now calls `sendDocumentMessage`
  (like step 3) instead of `sendTextMessage`, attaching the invoice PDF
  with filename `{invoice_number}.pdf`. Updated
  `sendPaymentConfirmation.test.ts` to mock `getInvoicePdf`/
  `sendDocumentMessage` instead of `sendTextMessage`, mirroring
  `sendRenewalMessage.test.ts`'s existing pattern. Live-verified: real
  WhatsApp message with the actual invoice PDF attached, confirmed
  received. `sendTextMessage` itself is left in `periskope.ts` (it's a
  reasonable general client capability) but is currently unused in
  production code. Typecheck and `npm test` both pass (9 files, 35
  tests).
- 2026-07-22 — Step 4 live-verified end-to-end after a long real-credential
  debugging session; several real bugs found and fixed, documented here
  in full since they're exactly the kind of thing worth not
  re-discovering next time:
  - **`convertEstimateToInvoice`'s endpoint was wrong.** The originally
    implemented `POST /estimates/{id}/converttoinvoice` doesn't exist in
    Zoho Books — confirmed 404 "Invalid URL Passed" live. The real
    endpoint is `POST /invoices/fromestimates?organization_id=...&estimate_ids={id}`
    (confirmed against Zoho's own API reference page, cross-checked
    against a verbatim ~100-endpoint listing so it's a real path, not
    another hallucination).
  - **The estimate must be marked "Sent" before conversion.** Zoho
    Books' web UI allows "Convert to Invoice" directly from DRAFT status,
    but the public API's `/invoices/fromestimates` rejects a DRAFT
    estimate with `"Some of the quotes cannot be converted to Invoices"`
    — confirmed by testing both paths against the same estimate. Fixed
    by calling `POST /estimates/{id}/status/sent` immediately before
    conversion, every time.
  - **The conversion response carries no invoice ID/number on success**
    — confirmed live: `{"code":0,"data":{}}`. The invoice ID is instead
    read back from the estimate's own `invoice_ids` array via a
    follow-up `GET /estimates/{id}` call (uses `estimates.READ`, no new
    scope needed), then the invoice number via `GET /invoices/{id}`
    (needs `invoices.READ` — see below).
  - **`/invoices/fromestimates` is not idempotent on Zoho's side.**
    Calling it again on an already-invoiced estimate can create a
    *second* invoice rather than erroring — confirmed by accumulating
    ~7 duplicate invoices against the same test estimate during
    debugging. Fixed in `convertEstimateToInvoice`: it now checks the
    estimate's real Zoho status first (`GET /estimates/{id}`) and
    returns the existing linked invoice without calling
    mark-as-sent/convert again if `status === "invoiced"` already —
    this also makes retries safe when a job is stuck `failed` in our DB
    but Zoho already succeeded (see next point).
  - **Three separate Zoho scope gaps, found one at a time because each
    only surfaced once the previous one was fixed**: the refresh token
    started with only `estimates.CREATE,contacts.CREATE,contacts.READ`.
    Needed, in order of discovery: `invoices.CREATE` (to call
    `fromestimates` at all), `estimates.READ` (to call
    `GET /estimates/pdf` in step 3, found first, then again needed here
    to read back `invoice_ids`), `invoices.READ` (to call
    `GET /invoices/{id}` for the invoice number — this one caused the
    most confusing symptom: **the invoice was genuinely being created in
    Zoho successfully**, since `invoices.CREATE` covers the conversion
    call, **but the code then threw on the invoice-number lookup and
    marked the whole step `failed`** — so Supabase said failed while
    Zoho showed a real invoice, which looked like a contradiction until
    traced to this specific later call). Final working scope string:
    `ZohoBooks.estimates.CREATE,ZohoBooks.estimates.READ,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.READ,ZohoBooks.invoices.CREATE,ZohoBooks.invoices.READ`.
  - **`renewalWebhook.ts` (`/webhooks/renewal`, steps 1-3) had zero
    logging**, unlike the new `razorpayWebhook.ts` — this made early
    debugging look like "nothing is happening" when steps 1-3 were
    actually working the whole time. Added matching `[renewalWebhook]`
    console logs at every stage, same style as `[razorpayWebhook]`.
  - **`.env` changes require a full process restart**, not just a file
    save — `dotenv/config` loads once at startup and `tsx watch` only
    watches `.ts` source files, not `.env`. Several confusing
    "still failing after the fix" moments during this session traced
    back to a stale `npm run dev` process still holding old env vars in
    memory (or, in `zoho.ts`'s case, an old cached access token) after a
    credential fix had already landed on disk.
  - **Getting the refresh token itself required repeating the
    grant-code exchange process three times** (once per new scope
    found) — each time via Zoho API Console Self Client → Generate Code
    → `node scripts/zoho-exchange-grant.mjs <code> <redirect_uri>` (new
    helper script, kept for future scope changes) → paste the printed
    `refresh_token` into `.env`. `"https://www.zoho.com"` works as the
    redirect URI for Self Client grants. Multiple grant codes and,
    eventually, the working refresh token were pasted into the chat
    transcript during this process — flagged in "Blocked / open
    questions" above for rotation once step 4 is confirmed stable.
  - Test data note: this debugging process created a real, non-trivial
    number of duplicate DRAFT estimates/invoices in the live Zoho Books
    org (~10 of each) against the test deal — see "Blocked / open
    questions" above; left uncleaned per explicit instruction.
  - Final confirmed-clean run: estimate `QT-000428`/invoice `INV-10588`
    (text-only confirmation), then `QT-000429`/`INV-10589` (with PDF
    attachment, after the same-day follow-up addition) — both
    `renewal_jobs` rows ended with `invoice_step_status: done`,
    `periskope_payment_confirmed_sent: true`, `hubspot_renewal_done:
    true`, `error_log: null`.
- 2026-07-21 — Step 4 implemented (Razorpay `payment_link.paid` webhook →
  Zoho invoice → Periskope payment confirmation → HubSpot "Renewal Done").
  New route `POST /webhooks/razorpay` (`src/routes/razorpayWebhook.ts`):
  verifies `X-Razorpay-Signature` (HMAC-SHA256 via
  `src/clients/razorpay.ts::verifyWebhookSignature`, `timingSafeEqual`)
  against the raw request body before doing anything else (REQ-4.1/4.2);
  looks up the `renewal_job` by `zoho_estimate_number` (new
  `findRenewalJobByEstimateNumber` in `src/repositories/renewalJobs.ts`,
  REQ-4.3/4.4); then runs three new, independently idempotent steps:
  `convertZohoInvoice` (converts the Estimate via
  `src/clients/zoho.ts::convertEstimateToInvoice`,
  `POST /estimates/{id}/converttoinvoice`, REQ-4.6/4.7/4.11),
  `sendPaymentConfirmation` (new `sendTextMessage` in
  `src/clients/periskope.ts`, same shape as `sendDocumentMessage` minus
  `media`, REQ-4.8/4.9), and `markRenewalDone` (new
  `markDealRenewalDone` in `src/clients/hubspot.ts`, PATCHes `dealstage`
  to `3102360263`, REQ-4.10). Getting the raw body for signature
  verification required adding a `verify` callback to `express.json()`
  in `src/app.ts` (stashes the raw buffer as `req.rawBody`) since Express
  doesn't expose it by default. Added migration
  `supabase/migrations/0003_renewal_jobs_step4.sql` (`zoho_invoice_id`,
  `zoho_invoice_number`, `invoice_step_status`,
  `periskope_payment_confirmed_sent`, plus an unplanned
  `hubspot_renewal_done` — needed as step 4's own terminal state so its
  HubSpot write doesn't collide with step 3's separate `hubspot_updated`
  — not yet applied live) and matching repository functions
  (`markInvoiceStepDone/Failed`, `markPaymentConfirmedSent/Skipped`,
  `markHubspotRenewalDone`). **Key finding while resolving REQ-4.10**: a
  `dealstage` search for "Ready for Renewal"/"Renewal Done" initially
  returned IDs (`1873133250`/`2691583694`) that looked right by label,
  but turned out to belong to pipeline `106069137` (AiA), not VA
  (`1534965463`) — `dealstage` is one global enum shared across every
  pipeline, so a label match alone never proves which pipeline actually
  uses it. Caught by inspecting a real VA-pipeline deal already sitting
  in a "Renewal Done"-labelled stage ("Leon Enterprises_VA") and reading
  its actual `dealstage` value (`3102360263`) directly — a different ID
  from both of the first two. Confirmed via explicit user direction
  before writing the code. Also confirmed, per explicit instruction, that
  no invoice ID is written to HubSpot at all (searched deal properties
  for an "invoice"/"zoho" fit — none exists); the invoice ID/number lives
  only in `renewal_jobs`. Widened the `RenewalJob` type and every
  existing test fixture (`createZohoEstimate.test.ts`,
  `createRazorpayLink.test.ts`, `sendRenewalMessage.test.ts`,
  `updateHubspotDeal.test.ts`) with the five new columns. New tests:
  `convertZohoInvoice.test.ts`, `sendPaymentConfirmation.test.ts`,
  `markRenewalDone.test.ts`, plus `verifyWebhookSignature` cases added to
  `razorpay.test.ts` (valid signature, wrong secret, tampered body).
  Typecheck and `npm test` both pass (9 test files, 34 tests, up from 6
  files/19 tests). No route-level HTTP test was added — there's no
  `supertest`-equivalent dependency in the project and step 3's route
  also has none; kept consistent with the existing test strategy
  (unit-level coverage + a separate, not-yet-automated live/integration
  test task). **Not yet live-tested, by design this session**: per
  explicit instruction, this implementation did not touch the live Zoho
  refresh token (still lacks whatever scope `converttoinvoice` needs) or
  set `RAZORPAY_WEBHOOK_SECRET`/register the dashboard webhook — both
  need a follow-up session before step 4 can run for real, same position
  step 2 was in immediately after its own implementation.
- 2026-07-21 — Step 3 live-verified end-to-end and marked Done. Set the
  test contact's (`522649333454`) HubSpot `phone` property to
  `6372161101` (previously null) so the WhatsApp-identifier lookup had
  real data to work with — confirmed this is the same internal property
  name (`phone`, UI label "Phone Number") already populated on real VA
  deals, by inspecting a live deal ("Sahil <> VA") in the Finance
  Collections View-VA. Re-issued the Zoho refresh token
  (`ZOHO_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` all changed in `.env`) to add
  `ZohoBooks.estimates.READ` — the previous token only had
  `estimates.CREATE`, which blocked the new `getEstimatePdf` call with a
  401. Getting the new token right took a few wrong turns worth recording:
  a Zoho API Console "Generated Code" is a short-lived grant code, not a
  refresh token — it must be exchanged via `grant_type=authorization_code`
  first (`grant_type=refresh_token` on it directly fails with
  `invalid_code`, which is what happened twice before catching this).
  Separately, resolved REQ-3.5/3.6: listed the real VA pipeline
  (`1534965463`)'s actual deal stages via the HubSpot API and confirmed
  there is no "Quote Sent" stage — per explicit instruction, step 3 now
  makes **no HubSpot write at all** (removed
  `src/clients/hubspot.ts::updateDealStatus` and the call to it in
  `src/steps/updateHubspotDeal.ts`, which now only marks
  `renewal_jobs.hubspot_updated`/`status` done). Updated
  `src/steps/updateHubspotDeal.test.ts` to match (no more
  `clients/hubspot.js` mock). Ran the full `POST /webhooks/renewal`
  pipeline against the real test deal (`337128679127`,
  `billing_period = "Monthly-2026-07-21"`): steps 1–2 idempotently reused
  the existing estimate (`QT-000416`) and payment link
  (`plink_TG6rOiKpZwe2xM`) from the earlier step 1/2 test run, and step 3
  ran for real — downloaded the actual Zoho estimate PDF, sent it via a
  real Periskope WhatsApp message to `6372161101`, and confirmed
  `status: "delivered"` via Periskope's own `GET
  /messages/{unique_id}/status` tracking endpoint, then double-checked by
  direct human confirmation that the message was actually received.
  `renewal_jobs` row ended at `status: done`, `periskope_sent: true`,
  `hubspot_updated: true`. Re-ran the identical webhook call immediately
  after and confirmed idempotency held across all three steps — identical
  response, no duplicate estimate/payment link/WhatsApp send. **Process
  hygiene note, not a code issue**: repeatedly starting `npm run dev` via
  backgrounded shell commands during debugging left ~20+ stray `node.exe`
  processes running, one of which was silently serving stale requests
  with a pre-fix cached Zoho token and made the 401 look unresolved for
  longer than it actually was; killing all `node.exe` processes before
  each real test run fixed this. Typecheck and `npm test` both pass (19
  tests, 6 files) after the `updateHubspotDeal` changes.
- 2026-07-21 — Step 3 implemented (WhatsApp send of Zoho estimate PDF +
  Razorpay payment link via Periskope, then HubSpot "Quote sent" update).
  New files: `src/clients/periskope.ts` (`sendDocumentMessage`: `POST
  https://api.periskope.app/v1/message/send`, recipient as `chat_id`
  derived from phone number, document sent as base64 `media.filedata` —
  shape confirmed against Periskope's public API docs, not yet
  live-tested), `src/steps/sendRenewalMessage.ts` (refuses to run unless
  `razorpay_step_status` is `done` (REQ-3.1), idempotent on both
  `periskope_sent` and the new `periskope_skip_reason` terminal states,
  skips gracefully and records a reason when no WhatsApp identifier is
  found (REQ-3.4) rather than failing the job), `src/steps/updateHubspotDeal.ts`
  (idempotent on `hubspot_updated`, runs regardless of the Periskope
  outcome so a skipped WhatsApp send never blocks REQ-3.6). Extended
  `src/clients/hubspot.ts` with `contactPhone` (reads the contact's
  `phone` property, used as step 3's WhatsApp identifier) and
  `updateDealStatus` (PATCHes a placeholder `renewal_status` deal
  property — not yet confirmed against real HubSpot property names).
  Extended `src/clients/zoho.ts` with `getEstimatePdf` (`GET
  /estimates/pdf?estimate_ids={id}`, Zoho's bulk-estimate-PDF endpoint
  used here with a single ID since there's no documented single-estimate
  PDF endpoint). Added `markPeriskopeSent`/`markPeriskopeSkipped`/
  `markHubspotUpdated` to `src/repositories/renewalJobs.ts`; the last one
  sets `status: "done"`, matching REQ-3.6 exactly. Added
  `periskope_skip_reason` to `renewal_jobs` via a **new** migration
  (`supabase/migrations/0002_renewal_jobs_step3.sql`, applied live via
  Supabase MCP after confirming the connected project matches
  `SUPABASE_URL` in `.env`) rather than editing `0001` in place, since
  `0001` was already applied to the live table before this session
  started — that in-place-edit convention only holds pre-apply. Wired
  both new steps into `POST /webhooks/renewal` and `renewalCron.ts` after
  the existing step 1→2 sequence. Added `config.periskope` (bearer token
  + x-phone, env vars already present in `.env.example` from initial
  scaffolding). **Important open item, not resolved by this change**:
  while investigating the WhatsApp-lookup design, discovered the
  connected Supabase project already has live `clients`/`client_contacts`
  tables (67 rows) matching step3.md's *original* design almost exactly —
  they're untracked by this repo's migrations so a plain codebase read
  didn't surface them. Per explicit instruction, step 3 uses the HubSpot
  contact's `phone` property instead, not these tables; see
  `ARCHITECTURE.md` §3.6/§6 and `context/features/step3.md` REQ-3.2 for
  the full note and what to revisit. Also fixed an unrelated stray
  leading character (`n` before `import`) in `src/clients/hubspot.ts`
  that broke `tsc` — not something this session introduced, caught by
  `npm run typecheck` failing unexpectedly after this change's own edits
  were already applied and verified correct in isolation. Unit tests:
  `src/steps/sendRenewalMessage.test.ts` (REQ-3.1 refusal, REQ-3.4 skip
  path, REQ-3.3 send path, idempotency on both `periskope_sent` and
  `periskope_skip_reason`), `src/steps/updateHubspotDeal.test.ts`
  (updates+marks done, idempotent on `hubspot_updated`, throws with no
  job), `src/clients/periskope.test.ts` (chat_id derivation, media
  payload shape, API error handling). Also updated the two existing step
  1/2 test fixtures (`createZohoEstimate.test.ts`,
  `createRazorpayLink.test.ts`) to include the new `contactPhone`/
  `periskope_skip_reason` fields required by the widened `HubspotDeal`/
  `RenewalJob` types. Typecheck and `npm test` both pass (19 tests, 6
  files). **Not yet live-tested** — no real Periskope credentials used
  yet, and the `renewal_status` HubSpot property name is an unconfirmed
  placeholder; needs a live run before this can be marked Done, same
  situation step 2 was in immediately after its own implementation.
- 2026-07-21 — Spec-only change (no code): split the old step 3 into a
  narrower step 3 (WhatsApp send of quote + payment link, "Quote sent"
  HubSpot status only) and a new step 4 (Razorpay `payment_link.paid`
  webhook → convert the Zoho Estimate into a real Invoice → WhatsApp
  payment-confirmation message → "Paid" HubSpot status). This reverses
  the original "invoice creation is out of scope" / "auto-marking paid is
  out of scope" decisions in `ARCHITECTURE.md` §7 — both are explicitly
  in scope now, per direct instruction. Key design decisions made along
  the way: (1) payment detection is an inbound Razorpay webhook, not
  polling; (2) the invoice is created by **converting** the existing
  estimate (`estimate_id` → invoice), not built independently from
  HubSpot, so it always matches what the client actually saw and paid
  for; (3) a new `RAZORPAY_WEBHOOK_SECRET` (separate from
  `RAZORPAY_KEY_SECRET`) will be required to verify
  `X-Razorpay-Signature` on the new `POST /webhooks/razorpay` endpoint;
  (4) `zoho_invoice_id` on `renewal_jobs` is the idempotency guard against
  duplicate webhook deliveries creating a second invoice. Updated
  `context/features/step3.md` (rewritten, WhatsApp-only), added
  `context/features/step4.md` (new), and updated `ARCHITECTURE.md` §§1,
  2, 3.3–3.7, 4, 5, 7 to match. The internal GM/VA notification question
  (§6) remains open, carried forward unchanged. No code, migration, or
  Supabase schema changes made yet — `renewal_jobs` does not yet have the
  step-4 columns (`zoho_invoice_id`, `zoho_invoice_number`,
  `invoice_step_status`, `periskope_payment_confirmed_sent`); those land
  when step 4 is actually implemented.
- 2026-07-21 — First fully-real end-to-end run of step 1→step 2 together.
  Added `crm.objects.deals.write`, `crm.objects.line_items.write`,
  `crm.objects.contacts.write` scopes to the `Renewal Automation` HubSpot
  private app (previously read-only) so a test fixture could be created:
  test contact `522649333454`, test deal `337128679127` ("Test Renewal
  Automation Deal_VA", VA pipeline `1534965463`, `billing_cycle=Monthly`),
  line item `332741231299` priced at ₹1 — kept deliberately tiny since
  `RAZORPAY_KEY_ID` in `.env` is a **live** key, not a test/sandbox key.
  Applied the pending migration to the live Supabase `renewal_jobs` table
  (it had `zoho_estimate_total`/`razorpay_short_url` only in the local
  migration file, not the actual table — added both columns via `alter
  table`). Ran `POST /webhooks/renewal` against the real deal: step 1
  created Zoho estimate `QT-000416` (total ₹1.18), step 2 created a real
  live Razorpay payment link `plink_TG6rOiKpZwe2xM`
  (https://rzp.io/rzp/3fDALDa2). Re-ran the identical request and
  confirmed both REQ-1.4 and REQ-2.3 idempotency hold end-to-end: the
  second call returned the identical `zohoEstimateId`/`paymentLinkId`
  instantly, and `renewal_jobs` shows exactly one row for that
  `billing_period` (verified via Supabase SQL), not a duplicate Zoho
  estimate or Razorpay link. **Found and worked around a test-setup
  issue, not a code bug**: creating the test deal via the HubSpot v3 API
  with `next_renewal_date` as a plain `"YYYY-MM-DD"` string silently
  stored it as epoch `1970-01-01` instead — HubSpot date properties need
  midnight-UTC epoch milliseconds. This produced a first (harmless, still
  correctly idempotent) `renewal_jobs` row with `billing_period =
  "Monthly-1970-01-01"` before the date was corrected. **Noted but not
  fixed, per explicit instruction to keep this session scoped to testing
  rather than new validation work**: `fetchDealWithLineItemsAndContact`
  in `src/clients/hubspot.ts` only checks `billing_cycle`/
  `next_renewal_date` for truthiness, not plausibility — a malformed date
  from real HubSpot data could in theory produce the same
  silently-wrong `billing_period` in production. Worth revisiting later.
  Two real ₹1 Razorpay payment links and one HubSpot test deal/contact/
  line-item now exist from this test and should be cleaned up (cancel the
  links in the Razorpay dashboard; archive the HubSpot test records) once
  no longer needed.
- 2026-07-21 — Changed the Zoho estimate to include only the **first**
  HubSpot line item on the deal (`deal.lineItems[0]`), instead of all of
  them. A single deal can carry many line items across different
  months/types (e.g. one real deal had 6: `New`, `One-time`, and several
  `Renewal` entries for different future dates), and the previous 1:1
  mapping put all of them on every quote. Fixed in
  `src/clients/zoho.ts::createEstimate`. **Known risk, accepted
  deliberately per explicit instruction**: HubSpot does not guarantee
  association return order, so "first" may not always be the line item
  actually due for a given renewal — see `ARCHITECTURE.md` §6 for the
  full note. Typecheck and `npm test` (9 tests, 3 files) both pass.
- 2026-07-21 — Step 2 implemented (Razorpay payment link). Added
  `src/clients/razorpay.ts` (`createPaymentLink`: `POST /payment_links`
  with `reference_id` = Zoho `estimate_number`; on a 400 "reference_id
  already exists" response, fetches and reuses the existing link via
  `GET /payment_links?reference_id=...` instead of treating it as an
  error, per REQ-2.3). Added `src/steps/createRazorpayLink.ts`
  (`createRazorpayLink`: refuses to run unless the job's
  `zoho_step_status` is `done` (REQ-2.1), reuses the stored link if
  `razorpay_step_status` is already `done` (idempotent re-run), computes
  the amount from `renewal_jobs.zoho_estimate_total` in paise, records the
  error and re-throws on failure so the pipeline halts before step 3
  (REQ-2.5)). To support this, extended `createEstimate` in
  `src/clients/zoho.ts` to also return the estimate `total` (Zoho already
  returns it in the create-estimate response), and added a
  `zoho_estimate_total` column to `renewal_jobs` (migration
  `0001_renewal_jobs.sql`, edited in place since it isn't applied yet) so
  step 2 doesn't need to re-derive or re-fetch the amount on a resumed
  job. Also added `razorpay_short_url` column (REQ-2.4) and
  `markRazorpayStepDone`/`markRazorpayStepFailed` to
  `src/repositories/renewalJobs.ts`, mirroring the existing Zoho step
  helpers. `createZohoEstimate` now also returns `billingPeriod` in its
  result so callers (the webhook route, the cron job) can look up the
  `renewal_jobs` row for step 2 without a second HubSpot fetch. Wired into
  `POST /webhooks/renewal` and `src/jobs/renewalCron.ts` so both run step
  1 then step 2 sequentially, per the existing no-queue pipeline design.
  Added `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` to `src/config.ts`
  (`.env.example` already had the placeholders from initial scaffolding).
  Unit tests: `src/clients/razorpay.test.ts` (new link, reused
  `reference_id` per REQ-2.3, other API errors) and
  `src/steps/createRazorpayLink.test.ts` (reuse-if-already-done, refuses
  to run if Zoho step isn't done per REQ-2.1, failure halts and records
  error per REQ-2.5, success writes `payment_link_id`/`short_url` per
  REQ-2.4). Typecheck and `npm test` both pass (13 tests). **Not yet
  live-tested** — no real Razorpay account/keys configured yet, so this
  has only been verified against mocked `fetch` calls built from the
  public Razorpay API docs, unlike step 1 which was verified against real
  Zoho/HubSpot data. Needs a live run with real `RAZORPAY_KEY_ID`/
  `RAZORPAY_KEY_SECRET` before this can be marked verified end-to-end.
- 2026-07-21 — First fully-real end-to-end run of step 1: created the
  HubSpot private app (`Renewal Automation`, scopes
  `crm.objects.deals.read`, `crm.objects.line_items.read`,
  `crm.objects.contacts.read`) and set `HUBSPOT_PRIVATE_APP_TOKEN`. Tested
  `POST /webhooks/renewal` against the real due deal `259579847416`
  ("Erathem Curios Pvt. Ltd._VA") found earlier by the Neon query. Found
  and fixed a real bug in `src/clients/hubspot.ts`: HubSpot's deals API
  returns the line-item association under the key `"line items"` (with a
  literal space), not `"line_items"` — the code was reading the wrong key,
  so `lineItemIds` was silently always empty and Zoho correctly rejected
  the estimate ("At least one item should be specified"). After the fix,
  the full pipeline ran successfully end-to-end and created a real Zoho
  estimate (`QT-000414`). Re-ran the identical request and confirmed
  idempotency (REQ-1.4) returns the same estimate instantly instead of
  creating a duplicate — verified both via the HTTP response and directly
  in the `renewal_jobs` Supabase table (exactly one row). Also found and
  fixed a second bug in `src/repositories/renewalJobs.ts`:
  `markZohoStepDone` updated `zoho_step_status` but never reset the outer
  `status` column, so a job that failed once and then succeeded on retry
  stayed permanently marked `status = 'failed'` even though the estimate
  was created — now sets `status: "done"` alongside `zoho_step_status:
  "done"`. Manually corrected the one affected test row in Supabase to
  match. Typecheck and `npm test` both pass.
- 2026-07-21 — Replaced the planned HubSpot-workflow webhook trigger with
  a daily in-process cron, since custom webhook actions in HubSpot
  Workflows require a subscription tier not available on this account.
  Added `src/clients/neon.ts` (read-only, `SELECT`-only by construction)
  querying a separate shared Neon project (`Live_HS_Updates`, not owned by
  this project) whose `line_items` table is kept in sync with HubSpot by
  an external process. Confirmed against real row data that the Virtual
  Accounting pipeline ID is `1534965463` (not `106069137`, which turned out
  to be AIA — verified from actual deal/line-item names in both
  pipelines, not assumed). Query selects `line_items` rows where
  `pipeline = '1534965463' AND recurring_type = 'Renewal' AND deleted IS
  NULL AND due_on = CURRENT_DATE`, grouped by `record_id` (deal_id). Added
  `src/jobs/renewalCron.ts` (finds due deals, calls `createZohoEstimate`
  per deal in-process, catches per-deal failures so one bad deal doesn't
  block the rest) and wired it into `src/index.ts` via `node-cron` at
  06:00 `Asia/Kolkata`. `POST /webhooks/renewal` still exists unchanged for
  manual testing. HubSpot re-fetch (REQ-1.1) is unaffected — Neon is only
  used to decide *which* deal_ids are due; all line-item/price/contact
  data still comes from the HubSpot API. Verified the Neon query live
  against real data (found deal `259579847416`, "Erathem Curios Pvt.
  Ltd._VA", correctly due today out of 6 total line items on that deal
  spanning different months). Added `NEON_DATABASE_URL` to `.env` /
  `.env.example` / `config.ts` — uses the Neon project owner's role since a
  scoped read-only role wasn't available; read-only behavior enforced in
  application code, not database permissions. Installed `pg`, `node-cron`
  (+ types). Updated `ARCHITECTURE.md` §§1-7 and `context/features/step1.md`
  to reflect the new trigger design. Typecheck and `npm test` both pass.
- 2026-07-21 — Re-issued the Zoho refresh token with
  `ZohoBooks.estimates.CREATE,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.READ`
  scope (old token only had `invoices.CREATE`, left over from before the
  estimate/invoice rename) and re-verified `scripts/test-zoho-estimate.ts`
  against the live `.in` org — confirmed estimate `QT-000412` created
  successfully. Zoho estimate creation is now fully working end-to-end.
- 2026-07-21 — Changed step 1 to create a Zoho **Estimate** (quote)
  instead of an **Invoice** — actual invoicing happens later, outside this
  automation, after payment (per updated product decision; see
  `ARCHITECTURE.md` §7). Renamed throughout: `src/clients/zoho.ts`
  (`createInvoice`→`createEstimate`, endpoint `/invoices`→`/estimates`,
  scope `invoices.CREATE`→`estimates.CREATE`), `src/steps/createZohoInvoice.ts`
  → `src/steps/createZohoEstimate.ts` (+ test), `src/repositories/renewalJobs.ts`
  (`zoho_invoice_id`/`zoho_invoice_number` → `zoho_estimate_id`/`zoho_estimate_number`),
  `src/routes/renewalWebhook.ts`, `supabase/migrations/0001_renewal_jobs.sql`
  (not yet applied, so edited in place rather than a new migration),
  `context/features/step1.md`, and `ARCHITECTURE.md` (§3.3–3.7, §4, §6, §7).
  Renamed `scripts/test-zoho-invoice.ts` → `scripts/test-zoho-estimate.ts`.
  Typecheck and `npm test` both pass. **Not yet re-verified live** — the
  current Zoho refresh token was issued with the old `invoices.CREATE`
  scope and needs re-issuing with `estimates.CREATE` before the standalone
  test script or the real webhook will succeed against Zoho.
- 2026-07-21 — Verified Zoho Books connectivity end-to-end with a
  standalone script (`scripts/test-zoho-invoice.ts`, kept for future ad-hoc
  testing): `findOrCreateCustomer` + `createInvoice` both work against the
  real `.in` data center org (confirmed invoice `INV-10552` created).
  Along the way: fixed `zoho.ts`'s hard-coded `.com` URLs to `.in`
  (`accounts.zoho.in` / `www.zohoapis.in`) to match this org's actual data
  center, documented in `ARCHITECTURE.md` §3.3. Fixed a real bug in
  `getAccessToken()` — Zoho's OAuth endpoint returns HTTP 200 even when the
  refresh token is invalid (body has an `error` field instead of
  `access_token`), and the code wasn't checking for that, so a bad token
  silently produced `undefined` and failed later with a confusing 401 from
  the Books API instead of a clear error at the token-refresh step. Added
  `dotenv` and wired it into `src/index.ts` so `.env` is actually loaded on
  startup (`npm run dev` would not have picked up `.env` before this).
  Excluded `scripts/` from `tsconfig.json` so ad-hoc scripts don't break
  `tsc`'s `rootDir` constraint. Added
  `supabase/migrations/0001_renewal_jobs.sql` (with a
  `unique(hubspot_deal_id, billing_period)` constraint backing the
  idempotency check) — not yet applied to the live Supabase project.
- 2026-07-21 — Step 1 implemented (HubSpot renewal webhook → Zoho Books
  invoice). Files: `src/config.ts`, `src/clients/{supabase,hubspot,zoho}.ts`,
  `src/repositories/renewalJobs.ts`, `src/steps/createZohoInvoice.ts` (+
  test), `src/routes/renewalWebhook.ts`, `src/app.ts`, `src/index.ts`,
  `.env.example`. Added `express`, `zod`, `@supabase/supabase-js` deps and
  `dev`/`build`/`test`/`typecheck` npm scripts. Fixed `tsconfig.json`
  (`types: ["node"]`) and switched `package.json` to `"type": "module"` to
  match the `nodenext`/`verbatimModuleSyntax` config. Resolved
  `ARCHITECTURE.md` §6 line-item decision: 1:1 mapping, free-form Zoho line
  items. Added `billing_period` and `zoho_invoice_number` columns to the
  `renewal_jobs` schema in `ARCHITECTURE.md` §3.7. Unit tests cover the
  idempotency skip path (REQ-1.4) and Zoho-failure halt path (REQ-1.6); both
  pass (`npm test`). Not yet covered: the Express route itself
  (`POST /webhooks/renewal`) has no integration test, and the
  `renewal_jobs` table has not been created in Supabase.
- 2026-07-21 — Initial architecture, `CLAUDE.md`, and spec scaffolding
  created. No code written yet.
