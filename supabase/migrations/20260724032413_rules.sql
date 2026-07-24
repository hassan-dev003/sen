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
