# Step 1 — HubSpot renewal trigger → Zoho Books estimate (quote)

Status: Done
Depends on: none

## 1. Requirements

### User story
As an AI Accountant VA, I want the renewal quote created in Zoho
automatically when a client's renewal date hits, so I don't have to build
it by hand every month. (Note: this creates a Zoho **Estimate**, not an
Invoice — actual invoicing happens later, outside this automation, after
payment. See `ARCHITECTURE.md` §7.)

### Acceptance criteria (EARS)
- REQ-1.1 (Event) — When a deal_id is identified as due for renewal (see
  `ARCHITECTURE.md` §3.1 — daily cron against Neon, or a manual
  `POST /webhooks/renewal` call), the system shall fetch the full deal and
  its line items from the HubSpot API before doing anything else.
- REQ-1.2 (Event) — When the deal's line items are retrieved, the system
  shall create a Zoho Books estimate for a customer matched by contact
  email.
- REQ-1.3 (Unwanted) — If no matching Zoho customer exists, then the system
  shall create one before creating the estimate.
- REQ-1.4 (Unwanted) — If a `renewal_jobs` row already exists for this
  `deal_id` and billing period with `zoho_step_status = done`, then the
  system shall skip estimate creation and reuse the stored
  `zoho_estimate_id`.
- REQ-1.5 (Ubiquitous) — The system shall write the resulting
  `zoho_estimate_id` and `estimate_number` to the `renewal_jobs` table before
  returning from step 1.
- REQ-1.6 (Unwanted) — If the Zoho API call fails, then the system shall
  record the error in `error_log` and stop the pipeline before step 2
  runs.

## 2. Design
- Trigger data (deal_id) is thin regardless of source (cron query result
  or webhook body) — always re-fetch from HubSpot, never trust it for
  money fields.
- Customer matching: search Zoho customers by email first, create only on
  a miss. Cache the mapping (e.g. on the `clients` Supabase table) so next
  month's renewal skips the search.
- Line items: 1:1 from HubSpot line items, free-form (no Zoho catalog
  item_id) — see `ARCHITECTURE.md` §6.

## 3. Tasks
- [x] Express route `POST /webhooks/renewal` — validate payload with Zod
- [x] HubSpot client: fetch deal + line items + contact
- [x] Supabase: check/create `renewal_jobs` row, idempotency check
- [x] Zoho client: OAuth token refresh helper
- [x] Zoho client: find-or-create customer
- [x] Zoho client: create estimate
- [x] Write `zoho_estimate_id` + status back to `renewal_jobs`
- [x] Unit test: idempotency skip path
- [x] Unit test: Zoho failure is recorded and pipeline halts
- [x] Neon client: query `line_items` for VA renewals due today
- [x] Daily in-process cron: find due deals, call `createZohoEstimate` per deal
- [x] Cron-only active-customer dealstage gate (2026-07-22): re-check each
      due deal's live HubSpot `dealstage` and skip anything not "Ready for
      Renewal" / "Renewal Done" / "Payment Done" — see `ARCHITECTURE.md`
      §3.1
