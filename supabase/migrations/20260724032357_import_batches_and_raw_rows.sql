create table import_batches (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  account_id         uuid not null references accounts(id) on delete cascade,
  source             txn_source not null,
  status             batch_status not null default 'parsing',
  original_filename  text,
  storage_path       text,
  period_start       date,
  period_end         date,
  rows_parsed        int not null default 0,
  rows_inserted      int not null default 0,
  rows_duplicate     int not null default 0,
  balance_check      jsonb,
  balance_anchor_cents bigint,
  anchor_reliable    boolean,
  error              text,
  created_at         timestamptz not null default now()
);

-- Never deleted while its batch exists. This is what makes reprocessing
-- possible without re-upload (data-model.md, AGENTS.md #3).
create table raw_rows (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references import_batches(id) on delete cascade,
  line_no    int not null,
  raw_text   text not null,
  parsed     jsonb not null,
  unique (batch_id, line_no)
);
