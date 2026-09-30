-- Which existing Zoho Books customer this deal bills (decision 2026-09-30):
-- the id is authoritative; the name is a display copy taken from Zoho at
-- save time. A deal with no mapping is not quoted.
alter table client_pricing
  add column if not exists zoho_customer_id text,
  add column if not exists zoho_customer_name text;
