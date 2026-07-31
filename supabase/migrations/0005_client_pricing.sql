create table if not exists client_pricing (
  id uuid primary key default gen_random_uuid(),
  hubspot_deal_id text not null unique,
  base_price numeric not null,
  addition_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
