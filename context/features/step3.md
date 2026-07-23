# Step 3 — Send quote + payment link via Periskope

Status: Done — verified live end-to-end against the test deal
Depends on: Step 2 (needs payment link `short_url`)

## 1. Requirements

### User story
As a VA, I want the client to automatically receive the quote and payment
link on WhatsApp once both are ready, so I don't have to send them by hand
every renewal.

**Changed 2026-07-21.** This step is now WhatsApp-send only. Updating
HubSpot with "sent" status, and everything to do with the *invoice*
(creating it, confirming payment, notifying the client it succeeded) moved
to `step4.md`, which only runs after Razorpay confirms the payment via
webhook. Step 3 no longer creates or references a Zoho Invoice — only the
Estimate (quote) from step 1 and the payment link from step 2.

### Acceptance criteria (EARS)
- REQ-3.1 (Ubiquitous) — The system shall only run step 3 for a
  `renewal_job` whose `razorpay_step_status` is `done`.
- REQ-3.2 (Event) — When step 3 starts, the system shall look up the
  client's WhatsApp identifier from the `clients` table by
  `hubspot_deal_id`.
  **Changed 2026-07-21 (implementation).** A live `clients` /
  `client_contacts` table pair (with `whatsapp_number`) does in fact exist
  in the connected Supabase project — it just isn't tracked in this repo's
  migrations, so it wasn't visible by reading the codebase alone. Despite
  that, per explicit instruction the WhatsApp identifier is read from the
  HubSpot contact's `phone` property instead (added as `contactPhone` to
  `fetchDealWithLineItemsAndContact` in `src/clients/hubspot.ts`), not from
  `clients`/`client_contacts`. Revisit this decision if `clients` should be
  the source of truth going forward.
- REQ-3.3 (Event) — When the WhatsApp identifier is found, the system
  shall send one Periskope message containing the Zoho **estimate**
  (quote) PDF and the Razorpay `short_url`.
- REQ-3.4 (Unwanted) — If no WhatsApp identifier is found for the client,
  then the system shall mark `periskope_sent = false`, record the reason,
  and still proceed to update HubSpot.
- REQ-3.5/REQ-3.6 — **Changed 2026-07-21 (implementation).** "Update
  HubSpot" no longer means writing anything to the HubSpot deal. The real
  VA pipeline (`1534965463`) has no "Quote Sent" stage, and moving the
  deal to "Renewal Done" belongs to step 4 (actual payment confirmation
  via Razorpay webhook), not step 3 (quote merely sent). Per explicit
  instruction, step 3 makes **no HubSpot write at all** — it only marks
  the `renewal_job` `hubspot_updated = true` / `status = done` in
  Supabase once the Periskope outcome (sent or skipped) is resolved. The
  deal stays on whatever stage it was already on (e.g. "Ready for
  Renewal") until step 4 moves it.

## 2. Design
- **Changed 2026-07-21 (implementation).** WhatsApp identifier comes from
  the HubSpot contact's `phone` property (re-fetched live, same
  trust-boundary rule as step 1), not the `clients` table — see REQ-3.2
  note above.
- The estimate "quote" attachment is the actual Zoho Estimate PDF, fetched
  live via `GET /estimates/pdf?estimate_ids={id}` (Zoho's bulk-estimate-PDF
  endpoint, used here with a single ID; there's no documented
  single-estimate PDF endpoint) and sent to Periskope as base64
  `media.filedata`, not a hosted URL — see `src/clients/zoho.ts::getEstimatePdf`
  and `src/clients/periskope.ts::sendDocumentMessage`. **Live-verified
  2026-07-21**: real PDF downloaded from Zoho, sent via Periskope, and
  confirmed `status: "delivered"` by Periskope's own message-status
  endpoint (`GET /messages/{unique_id}/status`) — and confirmed received
  on the actual test WhatsApp number by direct human check.
- Periskope request shape confirmed against public docs and now against
  real traffic: `POST https://api.periskope.app/v1/message/send`,
  recipient identified by `chat_id` (`"<digits>@c.us"`, derived from the
  phone number), media sent as
  `{ type: "document", filedata: <base64>, filename, mimetype }`.
- Open: does this message also go to an internal GM/VA channel, or is it
  client-only? See `ARCHITECTURE.md` §6. Not resolved yet — carried
  forward from the original design.
- **No HubSpot write in step 3** — see the REQ-3.5/3.6 change note above.
  `src/clients/hubspot.ts::updateDealStatus` (the placeholder
  `renewal_status` PATCH) was removed entirely rather than fixed, since
  there was nothing correct to point it at.
- Idempotency: `periskope_sent` (true) and `periskope_skip_reason`
  (non-null) are both terminal states on `renewal_jobs` — a resumed job
  does not resend or re-evaluate the WhatsApp send once either is set.
  `hubspot_updated` is the separate terminal state for REQ-3.6, checked
  independently so a Periskope skip never blocks it.

## 3. Tasks
- [x] Supabase: look up WhatsApp identifier — implemented via HubSpot
      contact phone instead of `clients` table (see design note above)
- [x] Periskope client: send message with estimate (quote) PDF + payment
      link (`src/clients/periskope.ts`) — live-verified, delivered
- [x] HubSpot: **removed**, not implemented — no real "Quote Sent" stage
      exists; step 3 makes no HubSpot write (see REQ-3.5/3.6 change note)
- [x] Mark `renewal_job` status = `done` (`markHubspotUpdated` in
      `src/repositories/renewalJobs.ts`)
- [x] Unit test: missing WhatsApp identifier doesn't block the
      `renewal_job` completion (`src/steps/updateHubspotDeal.test.ts`)
- [x] Integration test: full step 1→2→3 pipeline end-to-end — **run live
      2026-07-21** against the real test deal (`337128679127`), real
      Zoho, real Razorpay, real Periskope. See `PROGRESS.md` changelog for
      the full run detail. Confirmed idempotent on immediate re-run.
