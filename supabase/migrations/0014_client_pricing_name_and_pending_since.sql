-- "Name" column (business decision, 2026-09-29): blank until the admin
-- types it, no HubSpot pre-fill. When set, every client-facing message
-- says "Hi <client_name>" instead of "Hi Team". Named client_name (not
-- contact_name) to avoid confusion with HubspotDeal.contactName, which is
-- the unrelated HubSpot contact used as the Zoho customer identity.
--
-- pending_since_override (business decision, 2026-09-29): the admin's
-- manual override for arrears tracking. The auto-computed default is
-- never stored — it is derived live from the deal's one open unpaid
-- cycle's own service_period_start (findUnpaidCycleJobs guarantees at
-- most one such row per deal, since Next Renewal Date only advances on
-- payment). This column holds only the override.
alter table client_pricing
  add column if not exists client_name text,
  add column if not exists pending_since_override date;
