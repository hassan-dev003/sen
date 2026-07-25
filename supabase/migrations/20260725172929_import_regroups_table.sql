-- Records the event grouping of an earlier-batch row before an import regrouped
-- it, so a rollback can restore exactly what it changed (architecture.md).
create table import_regroups (
  batch_id            uuid not null references import_batches(id) on delete cascade,
  transaction_id      uuid not null references transactions(id) on delete cascade,
  prev_event_group_id uuid,
  prev_event_role     event_role not null,
  prev_event_state    event_state not null,
  primary key (batch_id, transaction_id)
);

alter table import_regroups enable row level security;

-- No user_id column; ownership flows through the parent batch.
create policy import_regroups_owner on import_regroups
  for all
  using (exists (
    select 1 from import_batches b
    where b.id = import_regroups.batch_id and b.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from import_batches b
    where b.id = import_regroups.batch_id and b.user_id = auth.uid()
  ));

grant select, insert, update, delete on import_regroups to authenticated;
