-- Every settled payment is now also recorded in Zoho Books as a customer
-- payment so the invoice shows as Paid there; the payment id is stored so
-- the step is never repeated (null = still to record, retried daily).
alter table renewal_jobs
  add column if not exists zoho_payment_id text;

-- One-time quotes can now be marked paid from the admin page (Yes Bank,
-- Razorpay when the webhook was missed, or a manual entry), exactly like a
-- billing cycle: paid_at is the one definition of PAID.
alter table addition_charges
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text,
  add column if not exists payment_amount numeric,
  add column if not exists payment_date date,
  add column if not exists payment_narration text,
  add column if not exists payment_reference text,
  add column if not exists zoho_payment_id text;

-- Quotes already invoiced by the Razorpay webhook were paid via Razorpay.
update addition_charges
   set paid_at = updated_at,
       payment_method = 'razorpay',
       payment_amount = zoho_estimate_total,
       payment_date = (updated_at at time zone 'Asia/Kolkata')::date
 where invoice_step_status = 'done' and paid_at is null;
