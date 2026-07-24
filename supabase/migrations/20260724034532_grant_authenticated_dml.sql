-- RLS decides which rows; table privileges decide whether the role may touch
-- the table at all. The authenticated owner needs DML on every table; RLS then
-- confines them to their own rows. anon gets nothing (it has no policy and the
-- app never queries these tables unauthenticated).
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  accounts,
  categories,
  import_batches,
  raw_rows,
  rules,
  transactions,
  tags,
  transaction_tags,
  budgets,
  recurring_series
to authenticated;
