create table if not exists renewal_jobs (
  id uuid primary key default gen_random_uuid(),
  hubspot_deal_id text not null,
  billing_period text not null,
  status text not null default 'pending',
  zoho_estimate_id text,
  zoho_estimate_number text,
  zoho_estimate_total numeric,
  zoho_step_status text not null default 'pending',
  razorpay_payment_link_id text,
  razorpay_short_url text,
  razorpay_step_status text not null default 'pending',
  periskope_sent boolean not null default false,
  hubspot_updated boolean not null default false,
  error_log jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hubspot_deal_id, billing_period)
);
