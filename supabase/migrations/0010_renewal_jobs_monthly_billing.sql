alter table renewal_jobs
  add column if not exists service_period_start date,
  add column if not exists billed_price numeric,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text,
  add column if not exists payment_amount numeric,
  add column if not exists payment_date date,
  add column if not exists payment_narration text,
  add column if not exists payment_reference text,
  add column if not exists hubspot_line_item_id text,
  add column if not exists estimate_email_sent boolean not null default false,
  add column if not exists invoice_email_sent boolean not null default false,
  add column if not exists email_error text;

-- paid_at is now the single definition of PAID. Backfill any row that was
-- already settled under the old invoice_step_status-based definition.
update renewal_jobs
   set paid_at = updated_at,
       payment_method = 'razorpay',
       payment_amount = zoho_estimate_total,
       payment_date = (updated_at at time zone 'Asia/Kolkata')::date
 where invoice_step_status = 'done' and paid_at is null;

-- The Razorpay webhook looks jobs up by estimate number with .maybeSingle();
-- make that lookup unambiguous at the DB level.
create unique index if not exists renewal_jobs_zoho_estimate_number_key
  on renewal_jobs (zoho_estimate_number)
  where zoho_estimate_number is not null;
