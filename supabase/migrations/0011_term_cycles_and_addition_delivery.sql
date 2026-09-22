-- Term-based billing cycles (quarterly / half-yearly) share renewal_jobs
-- with the monthly ones; term_months says how long the service period is
-- (1 = calendar month, 3, 6). Existing monthly rows are backfilled to 1.
alter table renewal_jobs
  add column if not exists term_months integer;

update renewal_jobs
   set term_months = 1
 where service_period_start is not null and term_months is null;

-- One-time quotes (addition_charges) now go to the client's WhatsApp group
-- and by email like renewals, with a separate narration line under the
-- service name; record each delivery so the admin page can show it.
alter table addition_charges
  add column if not exists narration text,
  add column if not exists periskope_sent boolean not null default false,
  add column if not exists periskope_skip_reason text,
  add column if not exists estimate_email_sent boolean not null default false,
  add column if not exists invoice_email_sent boolean not null default false,
  add column if not exists email_error text;
