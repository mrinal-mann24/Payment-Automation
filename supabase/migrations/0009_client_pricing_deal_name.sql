alter table client_pricing
  add column if not exists deal_name text;
