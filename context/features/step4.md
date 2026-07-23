# Step 4 — Payment confirmation: Razorpay webhook → Zoho invoice → WhatsApp

Status: Done — live-verified end-to-end 2026-07-22 (see `ARCHITECTURE.md`
§3.3 and the `PROGRESS.md` changelog for the full debugging trail: wrong
endpoint, missing mark-as-sent step, three scope gaps, non-idempotent
conversion)
Depends on: Step 3 (needs a `renewal_job` whose quote + payment link were
already sent)

## 1. Requirements

### User story
As a client, once I've paid the Razorpay link, I want to automatically
receive a proper invoice and a WhatsApp confirmation that my payment went
through, so I don't have to wait on the accountant to notice and follow up
by hand.

**New 2026-07-21.** This reverses the earlier "invoice creation is out of
scope" decision (`ARCHITECTURE.md` §7, original draft). Step 1 still only
creates a Zoho **Estimate** (quote) up front — the real **Invoice** is now
created here, in step 4, only after Razorpay confirms the client actually
paid.

### Acceptance criteria (EARS)
- REQ-4.1 (Event) — When Razorpay sends a `payment_link.paid` webhook
  event to `POST /webhooks/razorpay`, the system shall verify the
  `X-Razorpay-Signature` header against the raw request body using
  `RAZORPAY_WEBHOOK_SECRET` before processing it.
- REQ-4.2 (Unwanted) — If signature verification fails, then the system
  shall reject the request (401) and take no further action.
- REQ-4.3 (Event) — When the signature is valid and the event is
  `payment_link.paid`, the system shall look up the `renewal_job` by the
  payment link's `reference_id` (= Zoho `estimate_number`).
- REQ-4.4 (Unwanted) — If no matching `renewal_job` is found, or its
  `razorpay_step_status` is not `done`, then the system shall record the
  event and return without creating an invoice.
- REQ-4.5 (Unwanted) — If a `renewal_job` already has `zoho_invoice_id`
  set, then the system shall treat the webhook as a duplicate delivery,
  skip invoice creation, and still ensure the WhatsApp confirmation +
  HubSpot update have been sent (do not silently drop a retry).
- REQ-4.6 (Event) — When step 4 proceeds, the system shall convert the
  job's existing Zoho **Estimate** into a Zoho **Invoice** (Zoho's
  estimate→invoice conversion), reusing the same customer and line items
  rather than rebuilding them from HubSpot.
- REQ-4.7 (Ubiquitous) — The system shall write the resulting
  `zoho_invoice_id` and `invoice_number` to the `renewal_jobs` table
  before sending any WhatsApp message.
- REQ-4.8 (Event) — When the invoice is created, the system shall look up
  the client's WhatsApp identifier (same `clients` table lookup as step 3)
  and send one Periskope message confirming the payment was received
  successfully, referencing the invoice. **Extended 2026-07-22**: the
  message includes the invoice PDF as an attachment (downloaded via
  `getInvoicePdf`), same pattern as step 3's quote PDF — added after the
  text-only version was already live-verified working.
- REQ-4.9 (Unwanted) — If no WhatsApp identifier is found, then the system
  shall mark `periskope_payment_confirmed_sent = false`, record the
  reason, and still proceed to update HubSpot.
- REQ-4.10 (Event) — When the invoice is created (regardless of WhatsApp
  send outcome), the system shall update the HubSpot deal/line item with
  the invoice ID and a status such as "Paid" / "Invoice sent".
  **Resolved 2026-07-21 (implementation).** The deal's `dealstage` moves
  to `3102360263` ("Renewal Done" in the real VA pipeline) — confirmed
  live against an actual deal ("Leon Enterprises_VA") already sitting in
  that stage/pipeline, not assumed from the label alone (a same-labelled
  `dealstage` value found via property search turned out to belong to
  the AiA pipeline instead — see `ARCHITECTURE.md` §3.6 for the full
  story). No invoice ID is written to HubSpot: no existing deal property
  is a reasonable fit for it, per explicit instruction. The invoice
  ID/number lives only in `renewal_jobs`.
- REQ-4.11 (Unwanted) — If the Zoho invoice conversion call fails, then
  the system shall record the error in `error_log` and stop — no WhatsApp
  message or HubSpot update for that event.
- REQ-4.12 (Event) — **New 2026-07-22.** When the HubSpot deal is updated
  in REQ-4.10, the system shall also add a new HubSpot line item to the
  deal, copied (same name, quantity, price) from the line item step 1
  used to build that renewal's estimate — a running per-cycle billing
  record on the deal, matching the pattern already seen on real deals
  (e.g. "Leon Enterprises_VA" with 8 accumulated line items, one per past
  renewal). This adds a **new** line item; it does not modify or remove
  the original. See `src/clients/hubspot.ts::addLineItemToDeal`, wired
  into `src/steps/markRenewalDone.ts`. Live-verified against the real
  HubSpot API (test deal `337128679127`): confirmed the new line item is
  created and correctly associated to the deal
  (`associationTypeId: 20`, "deal_to_line_item"). Guarded by the same
  `hubspot_renewal_done` idempotency flag as REQ-4.10 — accepted risk,
  per explicit instruction: a failure between the line-item add and the
  dealstage PATCH could duplicate the line item on retry, not
  independently guarded like `convertZohoInvoice`'s multi-call sequence
  is.

## 2. Design
- Trigger: inbound **Razorpay webhook**, not polling.
  `POST /webhooks/razorpay` registered in the Razorpay dashboard for the
  `payment_link.paid` event, `RAZORPAY_WEBHOOK_SECRET` (separate from
  `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`) for HMAC-SHA256 signature
  verification. **Live-verified 2026-07-22.**
- Job lookup: match the incoming webhook's payment link `reference_id`
  back to `renewal_jobs.zoho_estimate_number` — same idempotency key
  already used for the Razorpay `reference_id` in step 2, so no new
  lookup key is needed. Implemented as
  `findRenewalJobByEstimateNumber` in `src/repositories/renewalJobs.ts`.
- Invoice creation = **convert the existing Estimate**, not a fresh
  invoice built independently from HubSpot. Guarantees the invoice
  matches exactly what the client already saw in the quote and paid for.
  See `src/clients/zoho.ts::convertEstimateToInvoice`. **Live-verified
  2026-07-22**, via `POST /invoices/fromestimates` (not
  `/estimates/{id}/converttoinvoice`, which doesn't exist — see
  `ARCHITECTURE.md` §3.3 for the full endpoint-discovery story,
  including the required mark-as-sent step and the non-idempotent
  conversion behavior).
- Idempotency: `zoho_invoice_id`/`invoice_step_status` on `renewal_jobs`
  is the guard — Razorpay can and does redeliver webhooks, so a duplicate
  `payment_link.paid` event must not create a second invoice (REQ-4.5).
  `sendPaymentConfirmation`/`markRenewalDone` are independently
  idempotent the same way, so a retry after a partial failure still
  finishes whichever step hadn't completed. `convertEstimateToInvoice`
  itself also checks Zoho's real estimate status before converting, as a
  second layer — see `ARCHITECTURE.md` §3.3 point 3.
- Open: does the WhatsApp confirmation (or the step 3 quote message) also
  go to an internal GM/VA channel? See `ARCHITECTURE.md` §6 — unresolved,
  carried forward from step 3.
- `renewal_jobs` columns added (migration `0003_renewal_jobs_step4.sql`,
  not yet applied live): `zoho_invoice_id`, `zoho_invoice_number`,
  `invoice_step_status` (pending/done/failed),
  `periskope_payment_confirmed_sent` (boolean), and
  `hubspot_renewal_done` (boolean, not in the original spec — added as
  step 4's own terminal state for the HubSpot write, kept separate from
  step 3's `hubspot_updated` since the two steps run independently).

## 3. Tasks
- [x] Express route `POST /webhooks/razorpay` — verify signature, parse
      `payment_link.paid` payload (`src/routes/razorpayWebhook.ts`)
- [x] Supabase: look up `renewal_job` by `zoho_estimate_number` =
      webhook's `reference_id`
- [x] Zoho client: convert estimate to invoice (live-verified 2026-07-22,
      real endpoint `POST /invoices/fromestimates`)
- [x] Write `zoho_invoice_id` + `invoice_number` to `renewal_jobs`
- [x] Periskope client: send payment-confirmed message with invoice PDF
      attached (`sendDocumentMessage`, live-verified 2026-07-22)
- [x] HubSpot client: update deal with invoice status (`dealstage` →
      `3102360263`, "Renewal Done" in the VA pipeline — no invoice ID
      written, see REQ-4.10 note)
- [x] HubSpot client: add a copy of the deal's line item once payment is
      confirmed (REQ-4.12, `addLineItemToDeal`, live-verified 2026-07-22)
- [x] Idempotency: duplicate webhook delivery for an already-invoiced job
      does not create a second invoice
- [x] Unit test: invalid signature is rejected before any processing
      (`src/clients/razorpay.test.ts`)
- [x] Unit test: duplicate/already-done invoice step is a no-op but
      downstream steps (`sendPaymentConfirmation`, `markRenewalDone`)
      still complete independently if not already done
      (`convertZohoInvoice.test.ts`, `sendPaymentConfirmation.test.ts`,
      `markRenewalDone.test.ts`)
- [x] Unit test: Zoho conversion failure halts before WhatsApp/HubSpot
      (`convertZohoInvoice.test.ts`, REQ-4.11)
- [x] Integration test: full step 1→2→3→4 pipeline end-to-end — live-
      verified 2026-07-22 against real Zoho/Razorpay/Periskope/HubSpot
      APIs (test mode). No automated test harness added (no
      `supertest`-equivalent dependency in the project); verified via
      real HTTP requests + Supabase state checks during this session.
