create table if not exists addition_charges (
  id uuid primary key default gen_random_uuid(),
  hubspot_deal_id text not null,
  amount numeric not null,
  description text not null,
  zoho_estimate_id text,
  zoho_estimate_number text,
  zoho_estimate_total numeric,
  razorpay_payment_link_id text,
  razorpay_short_url text,
  status text not null default 'pending',
  error_log jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
