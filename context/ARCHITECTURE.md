# Architecture — renewal billing automation

Last updated: 2026-07-23 (step 5 implemented, not yet live-tested)

## 1. Problem this replaces
Today an accountant creates the Razorpay link, creates the Zoho quote,
sends both to the client on WhatsApp, and — once paid — creates the real
invoice and confirms payment to the client, all by hand, every renewal,
every client. This automates all five steps end to end, including
chasing clients who don't pay by the due date.

Note: step 1 creates a Zoho **quote/estimate**, not an invoice. The real
Zoho **Invoice** is created later, in step 4, only after Razorpay confirms
the client actually paid (see §7 — **changed 2026-07-21**, this reverses
the original "invoice creation is out of scope" decision).

## 2. High-level flow
```
Daily cron (this backend, in-process, node-cron @ 06:00 IST)
  -> query Neon (Live_HS_Updates) for VA renewal line items due today
       -> for each due deal_id:
            -> Step 1: re-fetch deal from HubSpot API, create Zoho Books
                       quote (estimate)
            -> Step 2: create Razorpay payment link
            -> Step 3: send quote + payment link via Periskope, update
                       HubSpot deal/line items ("Quote sent")

Razorpay webhook (POST /webhooks/razorpay, event-driven, whenever the
client actually pays — independent of the daily cron)
  -> Step 4: verify webhook signature, convert the Zoho estimate to a
             real invoice, send WhatsApp payment confirmation via
             Periskope, update HubSpot deal/line items ("Paid")

Daily cron (same 06:00 IST tick, runs right after the above — step 5)
  -> for each renewal_job with a payment link sent but not yet paid,
     at 2/4/7 days past due: send an escalating WhatsApp reminder via
     Periskope (see context/features/step5.md)
```
Each step's result is written to Supabase before the next step runs, so a
failure partway through is resumable instead of starting over. Steps 1-3
run synchronously in the daily cron/webhook pipeline; step 4 runs later
and separately, triggered by Razorpay whenever the client pays — which
could be minutes or weeks after step 3.

## 3. Components

### 3.1 Trigger: daily cron against Neon (not a HubSpot workflow webhook)
- **Changed 2026-07-21.** Originally planned as a HubSpot workflow with a
  custom webhook action (§3.1 in earlier drafts of this doc). That requires
  a HubSpot subscription tier with webhook actions in Workflows, which
  isn't available on this account — so the trigger was moved in-process
  instead.
- A **separate Neon Postgres project, `Live_HS_Updates`** (shared by
  another org, not owned by this project), is kept in sync with HubSpot
  deal/line-item data by an existing external process (not part of this
  repo). Table `line_items` holds one row per HubSpot line item, including
  `record_id` (= HubSpot `deal_id`), `pipeline`, `recurring_type` (`New` /
  `One-time` / `Renewal`), `due_on` (date), and `deleted` (`NULL` or the
  literal string `'Yes'` — not a boolean).
- The Virtual Accounting pipeline ID, confirmed against real row data
  (every deal/line-item name under it says "VA"), is **`1534965463`**. Do
  not confuse with `106069137`, which is the AIA pipeline.
- This backend runs a **daily cron (`node-cron`, 06:00 `Asia/Kolkata`,
  in-process — no separate service)** that queries `line_items` for rows
  where `pipeline = '1534965463' AND deleted IS NULL AND due_on =
  CURRENT_DATE`, grouped by `record_id`. See `src/clients/neon.ts` and
  `src/jobs/renewalCron.ts`. **Changed 2026-07-22**: no longer filters on
  `recurring_type = 'Renewal'` — any due line item counts, regardless of
  type (`New`/`One-time`/`Renewal`), per explicit instruction. Narrowing
  to genuinely active, in-cycle customers is now done entirely by the
  active-customer dealstage gate below, not by `recurring_type`.
- **Neon is used strictly as a trigger source** — it only tells the cron
  *which* `deal_id`s are due today. The code never builds a quote from
  Neon's copy of the line-item data. For each due `deal_id`, the existing
  `createZohoEstimate` step still re-fetches the deal from the **HubSpot
  API** for line items, price, and contact email — the untrusted/thin-data
  trust boundary from the original design (re-fetch before acting on
  anything money-related) is preserved; only the trigger mechanism changed.
- **Added 2026-07-22: active-customer dealstage gate.** Neon's
  `line_items` table has no `dealstage` column (confirmed via
  `describe_table_schema`), so a due line item alone doesn't tell you
  whether the deal is still an active customer — it could be lost,
  discarded, or pre-sale. Before running the pipeline for a due deal, the
  cron now calls `fetchDealStage` to re-check the deal's real, current
  `dealstage` against the VA pipeline directly, and skips (logs, does not
  error) any deal not in one of the three stages that represent an active
  renewing customer, per explicit business confirmation:
  `3668025064` ("Ready for Renewal"), `3102360263` ("Renewal Done"),
  `2462646003` ("Payment Done") — see
  `src/clients/hubspot.ts::VA_ACTIVE_CUSTOMER_DEALSTAGES`. **Two of these
  three IDs were not discoverable from HubSpot's dealstage property
  options list** — that list is portal-wide across every pipeline, and
  the same-labelled stage can exist under a different ID in a different
  pipeline (already caught once for "Renewal Done" during step 4 — see
  §3.6). Confirmed instead by cross-checking real live VA-pipeline deals
  and, for the final two IDs, directly from the business. Applies **only**
  to the automatic cron (`runRenewalCheck`) — the manual
  `POST /webhooks/renewal` route is unaffected, per explicit instruction,
  so it still works for any `deal_id` for testing/support use.
- The Neon connection (`NEON_DATABASE_URL`) uses the project owner's role
  (full read/write on that shared database) because a scoped read-only
  role wasn't available to create. The application code only ever issues
  `SELECT` statements against it — this is enforced by not exposing any
  other query method from `src/clients/neon.ts`, not by database
  permissions.

### 3.2 Backend service (this repo)
- Node.js + TypeScript, Express
- Single Docker container, deployed on the Hostinger VPS behind Traefik —
  same pattern as our other internal services
- `POST /webhooks/renewal` still exists and works standalone (manual
  re-trigger / testing with a known `deal_id`), plus the daily in-process
  cron described in §3.1 as the primary trigger. Sequential internal
  pipeline either way, no queue, no second service.

### 3.3 Zoho Books
- Auth: OAuth2, self-client / app-level refresh token (not per-user
  delegated)
- Data center: `.in` (India) — accounts at `accounts.zoho.in`, API at
  `www.zohoapis.in`
- Step 1 creates a Zoho **Estimate** (quote); step 4 later **converts**
  that same estimate into a real **Invoice** once Razorpay confirms
  payment (see §1, §7 — **changed 2026-07-21**) — it does not build the
  invoice independently from HubSpot.
- Estimate endpoint: `POST https://www.zohoapis.in/books/v3/estimates?organization_id=...`
- **Invoice-from-estimate endpoint, live-verified 2026-07-22:**
  `POST https://www.zohoapis.in/books/v3/invoices/fromestimates?organization_id=...&estimate_ids={estimate_id}`
  — see `src/clients/zoho.ts::convertEstimateToInvoice`. This was **not**
  the first endpoint tried: `POST /estimates/{id}/converttoinvoice`
  (originally implemented, plausible-sounding, never actually confirmed
  against docs) returned a real 404 "Invalid URL Passed" — it does not
  exist in Zoho Books v3. The real path was confirmed by fetching Zoho's
  own endpoint listing directly (a ~100-entry verbatim list containing
  `POST /invoices/fromestimates — "Create from estimates"`).
  Three more things had to be true for it to actually work, each found
  by testing live, not by reading docs (the docs for this specific
  endpoint never rendered a usable parameter table):
  1. **The estimate must be marked "Sent" first** —
     `POST /estimates/{id}/status/sent?organization_id=...`, called
     immediately before conversion, every time. Zoho's own web UI allows
     converting a DRAFT estimate directly, but the public API rejects a
     DRAFT estimate for this endpoint with `"Some of the quotes cannot
     be converted to Invoices"` — confirmed by testing both the UI
     button and the API call against the identical estimate.
  2. **The response body carries no invoice ID/number on success** —
     confirmed live: `{"code":0,"data":{}}`. The invoice is instead read
     back via a follow-up `GET /estimates/{id}` call, using its
     `invoice_ids` array field (needs no new scope beyond
     `estimates.READ`), then `GET /invoices/{id}` for the
     `invoice_number` (needs `invoices.READ`).
  3. **This endpoint is not idempotent.** Calling it again on an
     already-invoiced estimate can create a *second* real invoice rather
     than erroring or returning the existing one — confirmed by
     accumulating several duplicate invoices against the same test
     estimate during debugging. `convertEstimateToInvoice` now checks
     the estimate's actual Zoho `status` first and returns the existing
     linked invoice without re-converting if it's already `"invoiced"` —
     this is a second, estimate-level idempotency check on top of the
     `renewal_jobs.invoice_step_status` guard in
     `src/steps/convertZohoInvoice.ts`, needed because the two can drift
     out of sync (e.g. Zoho succeeds but a later step in the same
     function call throws, leaving our DB row `failed` while Zoho
     already shows the estimate invoiced).
- **Scope, final working set (confirmed live 2026-07-22):**
  `ZohoBooks.estimates.CREATE,ZohoBooks.estimates.READ,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.READ,ZohoBooks.invoices.CREATE,ZohoBooks.invoices.READ`.
  Three scopes were added one at a time across this project, each only
  discovered once the previous gap was fixed and a new 401 surfaced
  further into the pipeline: `invoices.CREATE` (call `fromestimates` at
  all), `estimates.READ` (step 3's PDF download, and reading back
  `invoice_ids` here), `invoices.READ` (reading the invoice number, and
  step 4's own invoice-PDF attachment — see §3.5). A **very confusing
  symptom** while debugging the `invoices.READ` gap specifically: the
  invoice was genuinely being created successfully in Zoho the whole
  time (`invoices.CREATE` alone is enough for the conversion call
  itself), but the code then threw on the invoice-number lookup and
  marked the whole step `failed` in `renewal_jobs` — so Zoho showed a
  real invoice while Supabase showed `failed`, which looks like a
  contradiction until you trace it to that one specific later call.
- Line items can be custom (name/rate/quantity) without a pre-registered
  item_id, or mapped to catalog items — decision in §6

### 3.4 Razorpay
- Auth: API key + secret, server-side only (no OAuth)
- Endpoint: `POST https://api.razorpay.com/v1/payment_links`
- `reference_id` = Zoho `estimate_number` — doubles as an idempotency guard,
  since Razorpay rejects a duplicate `reference_id`, and is reused in step
  4 to match an inbound `payment_link.paid` webhook back to its
  `renewal_job`.
- **Step 4, implemented 2026-07-21**: `POST /webhooks/razorpay` on this
  backend (`src/routes/razorpayWebhook.ts`) verifies
  `X-Razorpay-Signature` (HMAC-SHA256 over the raw request body, via
  `src/clients/razorpay.ts::verifyWebhookSignature`, using
  `timingSafeEqual`) against `RAZORPAY_WEBHOOK_SECRET` — separate from
  `RAZORPAY_KEY_SECRET` — before processing the `payment_link.paid`
  event. Getting the raw body required adding a `verify` callback to
  `express.json()` in `src/app.ts` (stashes the raw buffer on
  `req.rawBody`), since Express only exposes the parsed object by
  default and HMAC verification needs the exact bytes Razorpay signed.
  **Live-verified 2026-07-22**: real Razorpay test-mode payment link
  paid, real webhook delivered through ngrok to the local server, real
  signature verification passed, full pipeline completed (see the
  2026-07-22 `PROGRESS.md` changelog entry for the debugging trail).

### 3.5 Periskope
- Existing bearer token + `x-phone` header (reused from other AIA
  workflows)
- **Implemented and live-verified 2026-07-21 (step 3).** `POST
  https://api.periskope.app/v1/message/send` — request shape confirmed
  against public docs (`docs.periskope.app/api-reference/message/send-message`)
  and against real traffic: recipient is `chat_id` (`"<digits>@c.us"`,
  derived from the phone number, not a raw phone field), document media
  sent as `{ type: "document", filedata: <base64>, filename, mimetype }`.
  See `src/clients/periskope.ts::sendDocumentMessage`. A real send against
  the test deal was confirmed `status: "delivered"` via Periskope's
  message-status endpoint (`GET /messages/{unique_id}/status`) and
  confirmed received on the actual test WhatsApp number.
- Used twice per renewal cycle:
  - Step 3: Zoho estimate PDF (downloaded via
    `GET /estimates/pdf?estimate_ids={id}`, sent as base64, not a hosted
    URL) + Razorpay payment link, in one message
  - **Step 4, live-verified 2026-07-22**: payment-confirmation message
    with the **invoice PDF attached** (added same day, after the
    text-only version was already confirmed working) — downloaded via
    `GET /invoices/pdf?estimate_ids={id}` → `getInvoicePdf` in
    `src/clients/zoho.ts`, same pattern as step 3's `getEstimatePdf`,
    sent via `sendDocumentMessage`. Referencing `zoho_invoice_number`,
    sent only after `invoice_step_status` is `done`.
    `src/clients/periskope.ts::sendTextMessage` (added first, same
    request shape minus `media`) went unused in production for a while
    after that, but **step 5 (2026-07-23) now uses it** for the three
    overdue-payment reminder messages (text-only, no PDF attachment).

### 3.6 HubSpot (write-back)
- **Changed 2026-07-21 (implementation).** Step 3 makes **no HubSpot
  write**. The real VA pipeline (`1534965463`) has no "Quote Sent" stage
  (confirmed by listing the pipeline's actual stages via the API — see
  `context/features/step3.md` REQ-3.5/3.6), and moving the deal to
  "Renewal Done" belongs to step 4 (real payment confirmation), not step
  3 (quote merely sent). `src/clients/hubspot.ts::updateDealStatus` (the
  placeholder `renewal_status` PATCH) was removed rather than fixed —
  there was no correct property/stage to point it at. Step 3 only updates
  `renewal_jobs` in Supabase.
  - **Step 4, implemented 2026-07-21.** Moves the deal's `dealstage` to
    `3102360263` — confirmed live to be the real "Renewal Done" stage in
    the VA pipeline by inspecting an actual deal ("Leon Enterprises_VA")
    that was already sitting in that stage with that pipeline. This is a
    **different** `dealstage` ID than the "Ready for Renewal"
    (`1873133250`) / "Renewal Done" (`2691583694`) values that first
    turned up via a `dealstage` property-options search — those two
    looked right by label but turned out to belong to pipeline
    `106069137` (AiA), not VA; confirmed by checking which pipeline deals
    using those exact stage IDs actually belong to. `dealstage` is a
    single global enum shared across all pipelines, so a stage's label
    alone never confirms which pipeline it's really used in — only
    checking real deals does. See `src/clients/hubspot.ts::markDealRenewalDone`.
    No invoice ID is written to HubSpot (no existing property is a
    reasonable fit — searched "invoice"/"zoho", nothing matched); the
    Zoho invoice ID/number lives only in `renewal_jobs`. Per explicit
    instruction.
  - **Added 2026-07-22.** Alongside the `dealstage` move, step 4 now also
    adds a **new** HubSpot line item to the deal — a copy (same name,
    quantity, price) of whichever line item step 1 used to build that
    renewal's estimate. This matches an existing real-world pattern
    already observed on live deals (e.g. "Leon Enterprises_VA" had 8
    accumulated line items, one per past renewal cycle) — the automation
    now maintains that same pattern going forward instead of leaving the
    deal at a single, stale line item after each renewal. See
    `src/clients/hubspot.ts::addLineItemToDeal`, called from
    `src/steps/markRenewalDone.ts`. Live-verified directly against the
    real HubSpot API (test deal `337128679127`): the association type for
    line-item-to-deal is `associationTypeId: 20`
    (`HUBSPOT_DEFINED`/`deal_to_line_item`) — confirmed by creating a real
    test line item and checking it appeared in the deal's `line_items`
    associations. Uses the existing `line_items.write` scope already
    granted to the `Renewal Automation` private app.
- Contact phone (`phone` property) is now also read in
  `fetchDealWithLineItemsAndContact` and used as step 3's WhatsApp
  identifier — see §3.1 idempotency note and `context/features/step3.md`
  REQ-3.2 for why this reads from HubSpot rather than the `clients` table
  that turned out to already exist in the connected Supabase project.

### 3.7a Overdue reminders (step 5, implemented 2026-07-23)
- Trigger: same daily `node-cron` tick (06:00 `Asia/Kolkata`) as the
  renewal cron, **not** a second `cron.schedule(...)` registration —
  `src/index.ts` calls `runRenewalCheck()` then `runOverdueReminderCheck()`
  sequentially, each independently `try/catch`-wrapped so one failing does
  not block the other. See `src/jobs/reminderCron.ts`.
- Source of "overdue and unpaid": `findOverdueUnpaidJobs` in
  `src/repositories/renewalJobs.ts` queries `renewal_jobs` directly
  (`razorpay_step_status = 'done' AND invoice_step_status != 'done'`) — no
  new Razorpay/Zoho calls, reuses state steps 2/4 already maintain.
- Due date: parsed from `renewal_jobs.billing_period` rather than a new
  column. `billing_period` is always `${billing_cycle}-${next_renewal_date}`
  (`src/clients/hubspot.ts`), and `next_renewal_date` is always a plain
  `YYYY-MM-DD` string — `parseDueDate` extracts the trailing
  `\d{4}-\d{2}-\d{2}` via regex, which holds for all three `billing_cycle`
  values (`Monthly`/`Quarterly`/`Annual`, none containing a dash).
  Resolves the open item in `context/features/step5.md` §3.
- Stage selection: `nextDueStage` compares whole days overdue (UTC, via
  `daysOverdue`) against the fixed schedule (2/4/7 days) and only returns
  a stage if that exact day matches and the stage's `reminder_N_sent_at`
  column is still null — so a cron run that's delayed or re-triggered
  same-day never resends, and a job that's overdue by, say, 5 days with
  reminder 1 unsent does **not** retroactively send reminder 1 (only exact
  day matches trigger a send, per REQ-5.2/5.3/5.4 wording).
- Idempotency: per-stage, via `reminder_1_sent_at`/`reminder_2_sent_at`/
  `reminder_3_sent_at` (REQ-5.6) — same pattern as every other external
  write in this project.
- Message wording is placeholder copy, not yet confirmed by the business
  — see `context/features/step5.md` open items.
- No HubSpot write for this step (not decided either way — see open
  items).

### 3.7 Supabase — job state (not a system of record)
Table: `renewal_jobs`

| column | type | notes |
|---|---|---|
| id | uuid | pk |
| hubspot_deal_id | text | unique per renewal cycle |
| billing_period | text | e.g. `2026-07`; combined with `hubspot_deal_id` for the idempotency check (REQ-1.4) |
| status | text | pending / in_progress / done / failed |
| zoho_estimate_id | text | null until step 1 done |
| zoho_estimate_number | text | null until step 1 done |
| zoho_estimate_total | numeric | null until step 1 done; source for the Razorpay amount in step 2 |
| zoho_step_status | text | pending / done / failed |
| razorpay_payment_link_id | text | null until step 2 done |
| razorpay_short_url | text | null until step 2 done |
| razorpay_step_status | text | pending / done / failed |
| periskope_sent | boolean | step 3's quote+payment-link message |
| periskope_skip_reason | text | null unless step 3 skipped the WhatsApp send (e.g. no contact phone found); new for step 3 |
| hubspot_updated | boolean | step 3 sets this once its (no-op) HubSpot phase is done — no actual HubSpot write happens; see §3.6 |
| zoho_invoice_id | text | null until step 4 done; new for step 4 |
| zoho_invoice_number | text | null until step 4 done; new for step 4 |
| invoice_step_status | text | pending / done / failed; new for step 4 |
| periskope_payment_confirmed_sent | boolean | step 4's payment-confirmation message; new for step 4 |
| hubspot_renewal_done | boolean | step 4's "move dealstage to Renewal Done" write — separate terminal state from step 3's `hubspot_updated`, since the two steps run independently (step 3 in the daily pipeline, step 4 on the Razorpay webhook, possibly much later); new for step 4 |
| reminder_1_sent_at | timestamptz | T+2 overdue reminder; null until sent; new for step 5 |
| reminder_2_sent_at | timestamptz | T+4 overdue reminder; null until sent; new for step 5 |
| reminder_3_sent_at | timestamptz | T+7 overdue reminder (includes discontinuation notice); null until sent; new for step 5 |
| reminder_skip_reason | text | null unless a reminder send was skipped (e.g. no contact phone found); new for step 5 |
| error_log | jsonb | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Note: the five `*step 4*`/`hubspot_renewal_done` columns above were added
via `supabase/migrations/0003_renewal_jobs_step4.sql` (`alter table ...
add column if not exists`), same pattern as `0002` — applied live (see
step 4's Done status).

Note: the four `reminder_*` columns above were added via
`supabase/migrations/0004_renewal_jobs_step5.sql`, same pattern as
`0002`/`0003` — **not yet applied live** as of this note; apply before
`runOverdueReminderCheck` is used for real.

Note: `0001_renewal_jobs.sql` was already applied to the live Supabase
project before step 3 started, so the new `periskope_skip_reason` column
was added via a separate migration, `0002_renewal_jobs_step3.sql`
(`alter table ... add column if not exists`), applied live — not by
editing `0001` in place as earlier columns were, since that convention
only holds while a migration is still unapplied.

Note: while implementing step 3, discovered that the connected Supabase
project already has a `clients` table (67 rows) and a related
`client_contacts` table (with `whatsapp_number`), matching the *original*
step3.md design almost exactly — they're just untracked by this repo's
migrations, so a plain read of the codebase won't surface them. Per
explicit instruction, step 3 does **not** use these tables; it reads the
WhatsApp identifier from the HubSpot contact's `phone` property instead
(see §3.6). Revisit if `clients`/`client_contacts` should become the
source of truth later — they already carry real production data.

## 4. Idempotency
- Re-running the cron (or manually re-triggering `/webhooks/renewal`) for
  the same deal must not create a second estimate or payment link. This
  matters more now that the trigger is a daily cron: if the cron runs more
  than once on the same day, or a `due_on` row is still present tomorrow
  for any reason, the same deal must not be double-processed.
- Before step 1: check for an existing `renewal_jobs` row for this
  `deal_id` + billing period; if one exists, resume from the last
  incomplete step instead of starting over.
- Razorpay's `reference_id` = `estimate_number` gives a second layer of
  protection at the API level itself.
- **Step 4, implemented 2026-07-21**: Razorpay can and does redeliver
  webhooks. `invoice_step_status`/`zoho_invoice_id` on `renewal_jobs` is
  the guard — `convertZohoInvoice` returns the already-stored invoice
  instead of calling Zoho again when `invoice_step_status` is already
  `done` (REQ-4.5). `sendPaymentConfirmation` and `markRenewalDone` are
  independently idempotent the same way (`periskope_payment_confirmed_sent`
  / `hubspot_renewal_done`), so a duplicate webhook that arrives after a
  partial failure still completes whichever of those two hadn't
  succeeded yet, without re-running the ones that had — see `step4.md`
  REQ-4.5.

## 5. Credentials (env vars — never commit)
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` — new for step 4; HMAC-SHA256 secret
  configured alongside the `payment_link.paid` webhook in the Razorpay
  dashboard, used to verify `X-Razorpay-Signature` on inbound
  `POST /webhooks/razorpay` calls. Separate from `RAZORPAY_KEY_SECRET`.
- `HUBSPOT_PRIVATE_APP_TOKEN`
- `PERISKOPE_BEARER_TOKEN`, `PERISKOPE_X_PHONE`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEON_DATABASE_URL` — connection string for the shared `Live_HS_Updates`
  Neon project (see §3.1). Owner-role credential; treat with the same care
  as the other secrets even though this app only reads from it.

- [x] Exact renewal trigger timing — resolved as part of the §3.1 trigger
      change: day-of only, driven by `line_items.due_on = CURRENT_DATE`
      (not `next_renewal_date` — that was the HubSpot-workflow-based plan,
      superseded). No "N days before" option implemented. Cron runs once
      daily at 06:00 IST. Decided 2026-07-21.
- [ ] What happens if the same `due_on` row is still present the day after
      it was processed (e.g. the external Neon sync job lags, or a
      `Renewal` line item's `due_on` isn't advanced after being handled).
      `renewal_jobs` idempotency (§4) prevents a duplicate estimate, but
      this hasn't been tested against a real repeated-due-date scenario
      yet.
- [ ] Whether step 3 also notifies an internal GM/VA channel, or is
      client-only
- [x] New 2026-07-21, resolved 2026-07-22: step 4 live-tested end-to-end.
      See the full debugging trail in the 2026-07-22 `PROGRESS.md`
      changelog and §3.3's rewrite — wrong endpoint, missing
      mark-as-sent step, three separate scope gaps, and a non-idempotent
      conversion endpoint all had to be found and fixed one at a time.
- [ ] New 2026-07-22: `ZOHO_REFRESH_TOKEN` was pasted into the chat
      transcript multiple times during step-4 debugging — rotate it
      again (Self Client → Generate Code → `scripts/zoho-exchange-grant.mjs`)
      once step 4 is confirmed stable in ongoing use. Not urgent (test
      mode), but shouldn't be left indefinitely. See `PROGRESS.md`.
- [ ] New 2026-07-22: the test deal (`337128679127`) has ~10 duplicate
      DRAFT estimates and ~10 duplicate DRAFT invoices in the live Zoho
      Books org from step-4 debugging — clean up manually in the Zoho
      Books UI when convenient. None are real customer data. See
      `PROGRESS.md`.
- [x] New 2026-07-21, resolved same day: whether step 3 should write a
      `renewal_status`-style property to HubSpot. Resolved by checking the
      real VA pipeline's stages via the API — there is no "Quote Sent"
      stage. Step 3 makes no HubSpot write at all; see §3.6.
- [ ] New 2026-07-21: whether `clients`/`client_contacts` (which already
      exist live in the connected Supabase project, untracked by this
      repo's migrations) should replace the HubSpot-contact-phone lookup
      step 3 currently uses for the WhatsApp identifier — see §3.6.
- [x] Line item mapping — **Superseded 2026-07-21.** Originally 1:1 from
      all HubSpot line items on the deal. Changed to **only the first line
      item returned by the HubSpot API** (`deal.lineItems[0]`) — a deal can
      carry many line items across different months/types (`New`,
      `One-time`, `Renewal` for various future dates; one real deal had 6),
      and only one is relevant per estimate. Free-form custom line items
      (name/rate/quantity sent directly, no Zoho catalog item_id lookup)
      still applies to that one item. **Known risk, accepted deliberately**:
      HubSpot does not guarantee association return order, so "first" is
      not guaranteed to be the line item actually due for this renewal —
      it could occasionally be a `New` or `One-time` item instead of the
      relevant `Renewal` one. If quotes start showing the wrong line item,
      this is the first place to check.
- [x] Where `billing_period` comes from on the HubSpot side. Confirmed
      against real deal records in the "Finance Collections View-VA" view:
      the deal properties are **`next_renewal_date`** ("Next Renewal
      Date") and **`billing_cycle`** ("Billing Cycle" — Monthly / Quarterly
      / Annual). Step 1 now reads both and derives `billing_period` as
      `${billing_cycle}-${next_renewal_date}` (e.g. `Monthly-2026-08-15`).
      The earlier assumed property name `renewal_billing_period` does not
      exist and has been removed. Decided 2026-07-21.
- [x] Invoice vs. quote — step 1 creates a Zoho **Estimate** (quote), not
      an Invoice. Actual invoicing happens later, outside this automation,
      after payment is received. Decided 2026-07-21.
- [ ] New 2026-07-23: step 5 (overdue reminders) implemented but not yet
      live-tested — migration `0004_renewal_jobs_step5.sql` not yet
      applied to the live Supabase project, and no real overdue
      `renewal_jobs` row has been run through `runOverdueReminderCheck`
      yet. See `context/features/step5.md` §4.
- [ ] New 2026-07-23: step 5's three WhatsApp message texts are
      placeholder copy, not yet confirmed by the business — see
      `src/steps/sendOverdueReminder.ts::reminderMessage` and
      `context/features/step5.md` open items.
- [ ] New 2026-07-23: whether "services discontinued" at T+7 needs an
      actual system action (e.g. a HubSpot dealstage change) beyond the
      WhatsApp message wording — currently message-only, no HubSpot write.

## 7. Explicitly out of scope (v1)
- ~~Creating the actual Zoho Invoice~~ — **reversed 2026-07-21.** Step 4
  now creates the real Invoice (by converting the step-1 Estimate) once
  Razorpay confirms payment via webhook. Step 1 still only creates the
  Estimate; step 4 is what turns it into an Invoice.
- ~~Auto-marking anything "paid" when Razorpay confirms payment~~ —
  **reversed 2026-07-21.** This is now exactly what step 4 does, via the
  `payment_link.paid` Razorpay webhook.
- Retry/backoff automation beyond a manual re-trigger endpoint
- Handling Razorpay events other than `payment_link.paid` (e.g. partial
  payments, expired links, refunds) — step 4 only reacts to a full
  successful payment.
