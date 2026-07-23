# agent.md — project context

Imported by `CLAUDE.md` via `@agent.md`. This file holds facts about *this*
project. General coding behavior lives in `CLAUDE.md` — don't duplicate it
here.

## Project overview
Automates the monthly renewal billing flow for AI Accountant VA clients:
HubSpot renewal trigger → Zoho Books invoice → Razorpay payment link →
WhatsApp (Periskope) + HubSpot update. Replaces the current manual process
where an accountant creates the Razorpay link, creates the Zoho invoice,
and sends both to the client on WhatsApp by hand.

## Before you start any session
1. Read `ARCHITECTURE.md` in full — source of truth for how the system
   fits together and what's already decided.
2. Read `PROGRESS.md` — what's done, in progress, blocked, and why.
3. Read every spec under `context/**/*.md` relevant to the task at hand.

## After every change
Update `PROGRESS.md`:
- Move the relevant task from "In progress" to "Done" (or "Blocked", with
  the reason).
- Add one line to the changelog: date, what changed, which files.
- If the change affects the architecture (new table, new env var, new
  external call), update `ARCHITECTURE.md` too.

## Tech stack
- Runtime: Node.js + TypeScript
- Framework: Express
- Database: Supabase (Postgres) — job-state store only, not a system of
  record for client/billing data
- Hosting: Hostinger VPS, Docker container behind Traefik — same pattern
  as our other internal services
- External APIs: HubSpot CRM, Zoho Books, Razorpay, Periskope

## Commands
- `npm run dev` — local dev server
- `npm run build` — compile TypeScript
- `npm test` — run test suite
- `npm run typecheck` — `tsc --noEmit`

(Placeholders until `package.json` scripts are final — check there before
trusting this list.)

## Project-specific non-negotiables
- Never create a Zoho invoice or Razorpay payment link twice for the same
  renewal — every write to an external system must be idempotent (see
  `ARCHITECTURE.md` §4).
- Never log full API keys, tokens, or client payment details — mask before
  logging.
- Every step writes its result to `renewal_jobs` before the next step
  runs. If step 3 fails, steps 1–2 must already be recorded so a retry
  doesn't redo them.
- Don't introduce a queue, a second service, or n8n into this flow without
  discussing it first. This is intentionally one sequential TypeScript
  service.

## Code style
- One small, named function per step: `createZohoInvoice`,
  `createRazorpayLink`, `sendRenewalMessage`, `updateHubspotDeal`.
- External API clients live in `src/clients/` (`zoho.ts`, `razorpay.ts`,
  `hubspot.ts`, `periskope.ts`). The webhook handler orchestrates — it
  doesn't make raw `fetch` calls itself.
- Validate the inbound HubSpot webhook payload with Zod before acting on
  it. Treat it as untrusted/thin — always re-fetch the deal from the
  HubSpot API for anything money-related.

## Where things live
- `features/step1.md` — HubSpot webhook → Zoho invoice
- `features/step2.md` — Razorpay payment link
- `features/step3.md` — WhatsApp send + HubSpot
  update
- `ARCHITECTURE.md` — system design, data model, external API contracts
- `PROGRESS.md` — status tracker, updated after every change