-- Per-client switch for the automatic quote: when auto_quote is false the
-- 11:00 IST run and the on-demand route both skip the client until the
-- admin switches it back on. A client can be paused before it ever has a
-- base price, so base_price becomes nullable (a monthly cycle still
-- refuses to bill without one).
alter table client_pricing
  add column if not exists auto_quote boolean not null default true,
  alter column base_price drop not null;
