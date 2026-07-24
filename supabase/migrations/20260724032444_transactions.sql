create function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

create table transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  account_id            uuid not null references accounts(id) on delete restrict,
  batch_id              uuid references import_batches(id) on delete set null,
  raw_row_id            uuid references raw_rows(id) on delete set null,

  source                txn_source not null,
  external_id           text,
  posting_state         txn_posting not null default 'posted',
  review_state          txn_review not null default 'draft',

  booked_at             date not null,
  amount_cents          bigint not null check (amount_cents > 0),
  direction             txn_direction not null,
  balance_after_cents   bigint,

  description_raw        text not null,
  description_normalized text not null,
  reference             text,
  merchant              text,
  merchant_truncated    boolean not null default false,
  rail                  text,
  event_group_id        uuid,
  event_role            event_role not null default 'single',
  event_state           event_state not null default 'resolved',

  category_id           uuid references categories(id) on delete set null,
  applied_rule_id       uuid references rules(id) on delete set null,
  transfer_group_id     uuid,
  note                  text,

  day_occurrence        int,
  dedupe_hash           text not null,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index transactions_dedupe
  on transactions (user_id, dedupe_hash);

create unique index transactions_external
  on transactions (user_id, source, external_id)
  where external_id is not null;

create index transactions_review  on transactions (user_id, review_state);
create index transactions_event   on transactions (user_id, event_group_id);
create index transactions_booked  on transactions (user_id, booked_at desc);

create trigger transactions_touch_updated_at
  before update on transactions
  for each row execute function touch_updated_at();
