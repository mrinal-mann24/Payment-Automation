# Step 5 — Overdue payment reminders (WhatsApp)

Status: Implemented, not yet live-tested (see `PROGRESS.md`)
Depends on: Step 2 (needs a payment link to remind about), Step 4 (needs
`invoice_step_status` as the "has this been paid" signal)

## 1. Requirements

### User story
As a client, if I haven't paid my renewal by the due date, I want a
WhatsApp reminder so I don't accidentally lose service — and as the
business, we want this to happen automatically instead of an accountant
tracking overdue clients by hand.

### Acceptance criteria (EARS)
- REQ-5.1 (Ubiquitous) — The system shall only consider a `renewal_job`
  for a reminder if `razorpay_step_status` is `done` (a payment link was
  actually sent) and `invoice_step_status` is not `done` (payment hasn't
  been confirmed yet).
- REQ-5.2 (Event) — When a `renewal_job`'s due date is exactly 2 days in
  the past and reminder 1 hasn't been sent, the system shall send WhatsApp
  reminder 1.
- REQ-5.3 (Event) — When a `renewal_job`'s due date is exactly 4 days in
  the past and reminder 2 hasn't been sent, the system shall send WhatsApp
  reminder 2.
- REQ-5.4 (Event) — When a `renewal_job`'s due date is exactly 7 days in
  the past and reminder 3 hasn't been sent, the system shall send WhatsApp
  reminder 3, which additionally warns that services will be discontinued.
- REQ-5.5 (Unwanted) — If no WhatsApp identifier is found for the client,
  then the system shall record the skip reason on that reminder stage and
  not fail the job.
- REQ-5.6 (Unwanted) — If a reminder stage has already been sent for a
  `renewal_job`, then the system shall not resend it (idempotent per
  stage, same non-negotiable as every other external write in this
  project).
- REQ-5.7 (Unwanted) — If `invoice_step_status` becomes `done` (client
  pays) at any point, then the system shall not send any further reminder
  stages for that `renewal_job`. Already-sent reminders are left as-is —
  no "disregard the last message" follow-up.

## 2. Design

- **Trigger**: same daily `node-cron` schedule (06:00 IST) as the existing
  job — **not** a second `node-cron.schedule(...)` registration. The
  single scheduled tick in `src/index.ts` calls `runRenewalCheck()` (Neon
  due-today deals → steps 1-3) followed by a new, separate
  `runOverdueReminderCheck()` (Supabase overdue-and-unpaid jobs → step 5),
  one after the other. Kept as two distinct functions rather than merged
  into one loop: different data source (Neon vs Supabase), different
  query condition (due-today vs N-days-overdue-and-unpaid), and a bug in
  the new reminder logic must not risk the already-live-verified
  renewal-creation flow. Matches this project's existing per-step
  function convention (`agent.md`) and the existing per-deal `try/catch`
  isolation already used in `runRenewalCheck`.
- **"Due date" source**: `renewal_jobs` has no dedicated due-date column
  today — it only has `billing_period` (e.g. `"Monthly-2026-08-15"`,
  derived from HubSpot's `next_renewal_date`). Step 5 parses the date
  portion out of `billing_period` rather than adding a redundant column.
  Open item to confirm at implementation time: whether the trailing date
  in `billing_period` is reliably parseable for every `billing_cycle`
  value seen in practice.
- **"Unpaid" source of truth**: `renewal_jobs.invoice_step_status !=
  'done'` — reuses existing state from step 4, no new calls to
  Razorpay/Zoho needed.
- **WhatsApp identifier**: same HubSpot contact `phone` lookup already
  used by steps 3 and 4, for consistency.
- **New `renewal_jobs` columns** (additive migration, same pattern as
  `0002`/`0003`):
  - `reminder_1_sent_at` (timestamptz, null until sent)
  - `reminder_2_sent_at` (timestamptz, null until sent)
  - `reminder_3_sent_at` (timestamptz, null until sent)
  - `reminder_skip_reason` (text, null unless a send was skipped — last
    skip reason only, mirrors `periskope_skip_reason`'s pattern)
- **New step function**: `sendOverdueReminder` in `src/steps/`, following
  the existing one-function-per-step convention. Takes the job + which
  stage (1/2/3) and sends the corresponding message via the existing
  `src/clients/periskope.ts::sendTextMessage` (already exists, currently
  unused in production — see `ARCHITECTURE.md` §3.5).
- **New job function**: `runOverdueReminderCheck` in a new
  `src/jobs/reminderCron.ts` (mirrors `runRenewalCheck` in
  `renewalCron.ts`) — queries `renewal_jobs` for overdue-and-unpaid rows
  (REQ-5.1), determines which stage (if any) is next per job, and calls
  `sendOverdueReminder` per job with the same per-job `try/catch`
  isolation `runRenewalCheck` already uses. Wired into `src/index.ts`
  right after `runRenewalCheck()` in the same `node-cron` callback.
- **No HubSpot write** for this step, unless you want one — not yet
  decided (see open items).

## 3. Open items (need answers before/at implementation)
- [ ] Exact wording for the three WhatsApp messages (especially reminder
      3's discontinuation notice). **Implemented with placeholder copy**
      (`src/steps/sendOverdueReminder.ts::reminderMessage`) — not yet
      confirmed by the business. Revisit before this runs against real
      clients.
- [ ] Does reminder 3 (or any reminder) also notify an internal GM/VA
      channel? Same open question already carried in `ARCHITECTURE.md` §6
      for steps 3/4. Not implemented.
- [x] Resolved — same daily `node-cron` schedule, but `runRenewalCheck`
      and the new `runOverdueReminderCheck` stay separate functions in
      separate files, called sequentially from the one scheduled tick.
      See design note above.
- [ ] Does "services discontinued" at T+7 need an actual system action
      (e.g. HubSpot dealstage change), or is it just the wording of the
      message for now? Implemented as **message-only**, no HubSpot write.
- [x] Resolved at implementation — whether the trailing date in
      `billing_period` is reliably parseable: yes. `billing_period` is
      always built (`src/clients/hubspot.ts::fetchDealWithLineItemsAndContact`)
      as `${billing_cycle}-${next_renewal_date}`, and `next_renewal_date`
      is always a plain `YYYY-MM-DD` string with no dashes of its own from
      `billing_cycle` (`Monthly`/`Quarterly`/`Annual`) to collide with — so
      `parseDueDate` in `src/jobs/reminderCron.ts` extracts the trailing
      `\d{4}-\d{2}-\d{2}` via regex. Unit-tested against all three
      `billing_cycle` values.

## 4. Implementation notes (2026-07-23)
- New migration `supabase/migrations/0004_renewal_jobs_step5.sql` — adds
  `reminder_1_sent_at`, `reminder_2_sent_at`, `reminder_3_sent_at`,
  `reminder_skip_reason`. **Not yet applied to the live Supabase project.**
- New `findOverdueUnpaidJobs`, `markReminderSent`, `markReminderSkipped` in
  `src/repositories/renewalJobs.ts`.
- New `sendOverdueReminder` step (`src/steps/sendOverdueReminder.ts`):
  refuses to run unless `razorpay_step_status` is `done` (REQ-5.1); no-ops
  once `invoice_step_status` is `done` (REQ-5.7); idempotent per stage via
  the three `reminder_N_sent_at` columns (REQ-5.6); skips and records a
  reason when no contact phone is found (REQ-5.5); reuses
  `sendTextMessage` (previously implemented but unused in production, per
  `ARCHITECTURE.md` §3.5).
- New `runOverdueReminderCheck` (`src/jobs/reminderCron.ts`): queries
  overdue-and-unpaid jobs, parses the due date, computes days overdue,
  determines the next unsent stage due today (`nextDueStage`), and calls
  `sendOverdueReminder` per job with the same per-job `try/catch`
  isolation `runRenewalCheck` uses. Wired into `src/index.ts` right after
  `runRenewalCheck()` in the same scheduled tick, not a second
  `node-cron.schedule(...)`.
- Unit tests: `src/steps/sendOverdueReminder.test.ts` (REQ-5.1, 5.4, 5.5,
  5.6, 5.7), `src/jobs/reminderCron.test.ts` (`parseDueDate` against all
  three `billing_cycle` values, `daysOverdue` via `vi.useFakeTimers`,
  `nextDueStage` stage-selection/idempotency). Typecheck and `npm test`
  both pass (11 files, 52 tests, up from 9/37).
- **Not yet live-tested** — no real overdue `renewal_jobs` row has been
  run through this yet, and the migration hasn't been applied live. Same
  position step 4 was in immediately after its own implementation.
