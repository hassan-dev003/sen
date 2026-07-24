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

create table budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid not null references categories(id) on delete cascade,
  period_month  date not null,
  amount_cents  bigint not null check (amount_cents >= 0),
  created_at    timestamptz not null default now(),
  unique (user_id, category_id, period_month)
);

create table recurring_series (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  label               text not null,
  match_value         text not null,
  cadence_days        int not null,
  typical_amount_cents bigint not null,
  category_id         uuid references categories(id) on delete set null,
  last_seen_at        date,
  next_expected_at    date,
  confirmed           boolean not null default false,
  created_at          timestamptz not null default now()
);
