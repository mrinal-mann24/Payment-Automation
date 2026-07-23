# Progress tracker

Last updated: 2026-07-23 (step 5 implemented, not yet live-tested)

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
| 5 — Overdue payment reminders (WhatsApp, T+2/T+4/T+7) | `context/features/step5.md` | In progress | Implemented 2026-07-23: `runOverdueReminderCheck` (`src/jobs/reminderCron.ts`) runs right after `runRenewalCheck` in the same daily cron tick, querying `renewal_jobs` for `razorpay_step_status: done` + `invoice_step_status != done`, sending an escalating Periskope text reminder at exactly 2/4/7 days overdue (T+7 includes a discontinuation notice), idempotent per stage. Migration `0004_renewal_jobs_step5.sql` not yet applied live; message wording is placeholder, not yet business-confirmed; not yet live-tested — see notes below. |

## Blocked / open questions
- Step 5's migration (`0004_renewal_jobs_step5.sql`) has not been applied
  to the live Supabase project yet — apply before `runOverdueReminderCheck`
  is used for real.
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
