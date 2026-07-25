-- One atomic import. SECURITY INVOKER so RLS applies and auth.uid() is the
-- caller; the whole body is one transaction (architecture.md#import-as-a-transaction).
create function import_m2u_batch(
  p_account_id           uuid,
  p_storage_path         text,
  p_filename             text,
  p_period_start         date,
  p_period_end           date,
  p_balance_anchor_cents bigint,
  p_anchor_reliable      boolean,
  p_rows_parsed          int,
  p_raw_rows             jsonb,
  p_txns                 jsonb,
  p_regroups             jsonb
) returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_batch    uuid;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = p_account_id and a.user_id = v_uid
  ) then
    raise exception 'account not found';
  end if;

  insert into public.import_batches (
    user_id, account_id, source, status, original_filename, storage_path,
    period_start, period_end, rows_parsed, balance_anchor_cents, anchor_reliable
  ) values (
    v_uid, p_account_id, 'm2u_history', 'imported', p_filename, p_storage_path,
    p_period_start, p_period_end, p_rows_parsed, p_balance_anchor_cents, p_anchor_reliable
  ) returning id into v_batch;

  insert into public.raw_rows (batch_id, line_no, raw_text, parsed)
  select v_batch, (e->>'lineNo')::int, e->>'rawText', e->'parsed'
  from jsonb_array_elements(p_raw_rows) e;

  insert into public.transactions (
    user_id, account_id, batch_id, raw_row_id, source, review_state,
    booked_at, amount_cents, direction, description_raw, description_normalized,
    reference, merchant, merchant_truncated, rail, event_group_id, event_role,
    event_state, day_occurrence, dedupe_hash
  )
  select
    v_uid, p_account_id, v_batch, rr.id, 'm2u_history', 'draft',
    (t->>'bookedAt')::date, (t->>'amountCents')::bigint,
    (t->>'direction')::public.txn_direction,
    t->>'descriptionRaw', t->>'descriptionNormalized',
    nullif(t->>'reference', ''), t->>'merchant',
    (t->>'merchantTruncated')::boolean, t->>'rail',
    (t->>'eventGroupId')::uuid, (t->>'eventRole')::public.event_role,
    (t->>'eventState')::public.event_state, (t->>'dayOccurrence')::int,
    t->>'dedupeHash'
  from jsonb_array_elements(p_txns) t
  join public.raw_rows rr
    on rr.batch_id = v_batch and rr.line_no = (t->>'rawLineNo')::int
  on conflict (user_id, dedupe_hash) do nothing;
  get diagnostics v_inserted = row_count;

  -- Record the prior grouping of each earlier-batch row before changing it.
  insert into public.import_regroups (
    batch_id, transaction_id, prev_event_group_id, prev_event_role, prev_event_state
  )
  select v_batch, t.id, t.event_group_id, t.event_role, t.event_state
  from jsonb_array_elements(p_regroups) r
  join public.transactions t on t.id = (r->>'id')::uuid and t.user_id = v_uid;

  update public.transactions t
  set event_group_id = (r->>'eventGroupId')::uuid,
      event_role     = (r->>'eventRole')::public.event_role,
      event_state    = (r->>'eventState')::public.event_state
  from jsonb_array_elements(p_regroups) r
  where t.id = (r->>'id')::uuid and t.user_id = v_uid;

  update public.import_batches
  set rows_inserted  = v_inserted,
      rows_duplicate = p_rows_parsed - v_inserted
  where id = v_batch;

  return jsonb_build_object(
    'batchId', v_batch,
    'rowsParsed', p_rows_parsed,
    'rowsInserted', v_inserted,
    'rowsDuplicate', p_rows_parsed - v_inserted
  );
end $$;

grant execute on function import_m2u_batch(
  uuid, text, text, date, date, bigint, boolean, int, jsonb, jsonb, jsonb
) to authenticated;

-- Roll a batch back: restore the regroupings it caused, delete its own drafts,
-- and refuse if any of its rows has been confirmed (architecture.md).
create function rollback_import_batch(p_batch_id uuid) returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_confirmed int;
  v_deleted   int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.import_batches b where b.id = p_batch_id and b.user_id = v_uid
  ) then
    raise exception 'batch not found';
  end if;

  select count(*) into v_confirmed
  from public.transactions
  where batch_id = p_batch_id and user_id = v_uid and review_state = 'confirmed';
  if v_confirmed > 0 then
    raise exception 'cannot roll back: % confirmed row(s) in batch', v_confirmed;
  end if;

  update public.transactions t
  set event_group_id = ir.prev_event_group_id,
      event_role     = ir.prev_event_role,
      event_state    = ir.prev_event_state
  from public.import_regroups ir
  where ir.batch_id = p_batch_id and ir.transaction_id = t.id and t.user_id = v_uid;

  delete from public.transactions where batch_id = p_batch_id and user_id = v_uid;
  get diagnostics v_deleted = row_count;

  delete from public.import_regroups where batch_id = p_batch_id;
  update public.import_batches set status = 'rolled_back', rows_inserted = 0
  where id = p_batch_id;

  return jsonb_build_object('batchId', p_batch_id, 'deleted', v_deleted);
end $$;

grant execute on function rollback_import_batch(uuid) to authenticated;
