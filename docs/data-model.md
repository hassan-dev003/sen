# Data model

Target: Postgres via Supabase. This document is the intended end state of Sprint 1. Write it as
migrations under `supabase/migrations/`, one file per logical group, never edited after applying.

## Money

All amounts are `bigint` cents. MYR has two decimal places, so RM 12.50 is `1250`.

`amount_cents` is **always positive**. Sign is carried by `direction`. This avoids the classic bug
where a refund, a credit, and a negative expense are three different representations of the same
thing and the charts quietly disagree with the ledger.

Formatting happens in `lib/money/` and nowhere else.

## Enums

```sql
create type txn_source      as enum ('statement_pdf', 'm2u_history', 'finverse', 'manual');
create type txn_direction   as enum ('debit', 'credit');
create type txn_posting     as enum ('pending', 'posted');
create type txn_review      as enum ('draft', 'confirmed', 'ignored');
create type account_kind    as enum ('bank', 'cash');
create type category_kind   as enum ('expense', 'income', 'transfer');
create type batch_status    as enum ('parsing', 'ready', 'imported', 'failed', 'rolled_back');
create type rule_field      as enum ('description_normalized', 'reference');
create type rule_match      as enum ('contains', 'starts_with', 'exact', 'regex');
create type event_role      as enum ('single', 'authorization', 'auth_reversal',
                                     'settlement', 'settlement_reversal');
create type event_state     as enum ('resolved', 'pending', 'cancelled', 'orphan');
```

## Tables

### accounts

```sql
create table accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  kind          account_kind not null,
  institution   text,
  currency      char(3) not null default 'MYR',
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
```

Seed creates two: the bank account, and a `cash` account for manual entry.

### categories

```sql
create table categories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  kind          category_kind not null,
  parent_id     uuid references categories(id) on delete set null,
  color         text,
  sort_order    int not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, name, parent_id)
);
```

One level of nesting only. A category with a `parent_id` may not itself be a parent — enforce in a
check trigger, not in application code.

The starting taxonomy is an open question in `product-spec.md`. Do not invent one; seed a minimal
set (Food, Transport, Bills, Shopping, Health, Income, Transfer) and let the owner extend.

### import_batches

```sql
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
  balance_check      jsonb,        -- { ok: bool, breaks: [{ lineNo, expected, actual }] }
  balance_anchor_cents bigint,     -- m2u_history: account balance shown on the print
  anchor_reliable    boolean,      -- false when any float line was non-zero
  error              text,
  created_at         timestamptz not null default now()
);
```

### raw_rows

Never deleted while its batch exists. This is what makes reprocessing possible without re-upload.

```sql
create table raw_rows (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references import_batches(id) on delete cascade,
  line_no    int not null,
  raw_text   text not null,
  parsed     jsonb not null,
  unique (batch_id, line_no)
);
```

### transactions

```sql
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

  description_raw       text not null,
  description_normalized text not null,
  reference             text,
  merchant              text,           -- may be null, or a bare phone number
  merchant_truncated    boolean not null default false,
  rail                  text,           -- DUITNOW QR, MAE QR, PAYMENT VIA MYDEBIT, ...
  event_group_id        uuid,           -- shared by all rows of one economic event
  event_role            event_role not null default 'single',
  event_state           event_state not null default 'resolved',

  category_id           uuid references categories(id) on delete set null,
  applied_rule_id       uuid references rules(id) on delete set null,
  transfer_group_id     uuid,
  note                  text,

  day_occurrence        int,            -- m2u_history: index within its date, counted oldest-first
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
```

`event_group_id`, `event_role`, and `event_state` collapse a pre-authorisation group into one
reviewable event while keeping every row. See
`docs/event-collapse.md`. The review queue and every spending
figure group by `event_group_id`; balance reconstruction does not. An event's amount is its
settlement row, or zero if the authorisation was reversed without one.

`event_state` carries the outcomes that only appear at statement boundaries:

- `resolved` — matched and complete
- `pending` — an authorisation with no reversal yet; provisional, re-resolved on the next import
- `cancelled` — authorised then reversed with no settlement; nets to zero
- `orphan` — a reversal whose authorisation is in a statement not yet imported

`pending` and `orphan` are **normal states, not errors.** Grouping runs across statement
boundaries, so rows from an already-imported batch can be regrouped by a later import.

`transfer_group_id` pairs the two legs of a movement between own accounts — an ATM withdrawal
debiting the bank and crediting cash. Both legs share the id. Charts must exclude transactions
whose category kind is `transfer`, or the same ringgit is counted twice.

`applied_rule_id` records which rule produced the draft category. When the owner overrides it,
that rule's accuracy can be measured. This is what makes the learning loop honest rather than
merely additive.

### rules

```sql
create table rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  priority          int not null default 100,
  field             rule_field not null default 'description_normalized',
  match_type        rule_match not null default 'contains',
  match_value       text not null,
  set_category_id   uuid references categories(id) on delete cascade,
  set_merchant      text,
  learned           boolean not null default false,
  hit_count         int not null default 0,
  override_count    int not null default 0,
  last_hit_at       timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index rules_active on rules (user_id, active, priority);
```

Lower `priority` wins. First match applies. `override_count` increments when the owner changes a
category that this rule set — a rule with a bad ratio should surface in settings for review.

### tags

```sql
create table tags (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text not null,
  unique (user_id, name)
);

create table transaction_tags (
  transaction_id uuid not null references transactions(id) on delete cascade,
  tag_id         uuid not null references tags(id) on delete cascade,
  primary key (transaction_id, tag_id)
);
```

Tags are orthogonal to categories: a transaction has exactly one category and any number of tags.
Do not use tags as a second category system.

### budgets

```sql
create table budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid not null references categories(id) on delete cascade,
  period_month  date not null,   -- always the first of the month
  amount_cents  bigint not null check (amount_cents >= 0),
  created_at    timestamptz not null default now(),
  unique (user_id, category_id, period_month)
);
```

Budgets are per month, not recurring templates. Copying last month forward is a UI action that
writes new rows. This keeps history truthful — a budget you raised in March stays raised in March.

### recurring_series

```sql
create table recurring_series (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  label               text not null,
  match_value         text not null,
  cadence_days        int not null,
  typical_amount_cents bigint not null,   -- typical, not a matching condition — see D22
  category_id         uuid references categories(id) on delete set null,
  last_seen_at        date,
  next_expected_at    date,
  confirmed           boolean not null default false,
  created_at          timestamptz not null default now()
);
```

Detection writes `confirmed = false`. The owner promotes. Nothing acts on an unconfirmed series.

## Row level security

Every table above gets the same treatment. No exceptions.

```sql
alter table accounts enable row level security;

create policy accounts_owner on accounts
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

For the two join-ish tables without a `user_id` column — `raw_rows` and `transaction_tags` —
the policy goes through the parent:

```sql
alter table raw_rows enable row level security;

create policy raw_rows_owner on raw_rows
  for all
  using (exists (
    select 1 from import_batches b
    where b.id = raw_rows.batch_id and b.user_id = auth.uid()
  ));
```

**Test every policy.** Sprint 1 is not complete without a test that authenticates as a second user
and confirms that every table returns zero rows belonging to the first.

## updated_at

One trigger function, applied to `transactions`. Do not update it from application code.

```sql
create function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;
```
