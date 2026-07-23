alter table renewal_jobs
  add column if not exists zoho_invoice_id text,
  add column if not exists zoho_invoice_number text,
  add column if not exists invoice_step_status text not null default 'pending',
  add column if not exists periskope_payment_confirmed_sent boolean not null default false,
  add column if not exists hubspot_renewal_done boolean not null default false;
