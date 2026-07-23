# Step 2 — Razorpay payment link

Status: Done
Depends on: Step 1 (needs `zoho_estimate_id` + amount)

## 1. Requirements

### User story
As a client, I want to receive a working payment link for my renewal so I
can pay without back-and-forth with the accountant.

### Acceptance criteria (EARS)
- REQ-2.1 (Ubiquitous) — The system shall only run step 2 for a
  `renewal_job` whose `zoho_step_status` is `done`.
- REQ-2.2 (Event) — When step 2 starts, the system shall create a Razorpay
  payment link with `reference_id` equal to the Zoho `estimate_number`.
- REQ-2.3 (Unwanted) — If a payment link with that `reference_id` already
  exists, then the system shall fetch and reuse the existing link instead
  of treating it as an error.
- REQ-2.4 (Ubiquitous) — The system shall write `payment_link_id` and
  `short_url` to `renewal_jobs` before returning from step 2.
- REQ-2.5 (Unwanted) — If the Razorpay API call fails, then the system
  shall record the error and stop the pipeline before step 3 runs.

## 2. Design
- Amount = Zoho estimate total (`renewal_jobs.zoho_estimate_total`, set by
  step 1), converted to paise.
- `reference_id` = `estimate_number` doubles as the idempotency guard at
  the API level (Razorpay rejects a duplicate `reference_id`; the reuse
  path fetches via `GET /payment_links?reference_id=...` instead of
  failing).
- `expire_by`: not set — decided against for v1, no expiry needed.

## 3. Tasks
- [x] Razorpay client: create payment link (`src/clients/razorpay.ts`)
- [x] Handle "reference_id already exists" by fetching instead of failing
- [x] Write `payment_link_id` + `short_url` to `renewal_jobs`
      (`razorpay_payment_link_id`, `razorpay_short_url`)
- [x] Unit test: reused `reference_id` path (`src/clients/razorpay.test.ts`)
- [x] Unit test: Razorpay failure halts pipeline before step 3
      (`src/steps/createRazorpayLink.test.ts`)
