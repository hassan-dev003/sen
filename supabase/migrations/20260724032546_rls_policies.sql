-- Every table gets RLS. No exceptions (AGENTS.md #5, data-model.md).
-- Tables with a user_id column: owner may do anything to their own rows.

alter table accounts enable row level security;
create policy accounts_owner on accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table categories enable row level security;
create policy categories_owner on categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table import_batches enable row level security;
create policy import_batches_owner on import_batches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table rules enable row level security;
create policy rules_owner on rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table transactions enable row level security;
create policy transactions_owner on transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table tags enable row level security;
create policy tags_owner on tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table budgets enable row level security;
create policy budgets_owner on budgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table recurring_series enable row level security;
create policy recurring_series_owner on recurring_series
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The two join-ish tables with no user_id column go through their parent.

alter table raw_rows enable row level security;
create policy raw_rows_owner on raw_rows
  for all
  using (exists (
    select 1 from import_batches b
    where b.id = raw_rows.batch_id and b.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from import_batches b
    where b.id = raw_rows.batch_id and b.user_id = auth.uid()
  ));

alter table transaction_tags enable row level security;
create policy transaction_tags_owner on transaction_tags
  for all
  using (exists (
    select 1 from transactions t
    where t.id = transaction_tags.transaction_id and t.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from transactions t
    where t.id = transaction_tags.transaction_id and t.user_id = auth.uid()
  ));
