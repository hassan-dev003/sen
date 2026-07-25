-- Balance verification needs a baseline. The opening balance is derived on the
-- first import and confirmed by the owner (D21); null until then.
alter table accounts
  add column opening_balance_cents bigint,
  add column opening_balance_at    date;

-- An explicit reconciliation entry closing a difference the capture path could
-- not explain (D21). Ordinary in every other respect, and counted in charts.
alter table transactions
  add column is_adjustment boolean not null default false;
