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

-- One level of nesting only. A category with a parent may not itself be a
-- parent. Enforced here rather than in application code (data-model.md).
create function enforce_category_one_level() returns trigger as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A category cannot be its own parent';
    end if;
    if exists (
      select 1 from categories c
      where c.id = new.parent_id and c.parent_id is not null
    ) then
      raise exception 'Categories may nest only one level deep';
    end if;
    if exists (select 1 from categories c where c.parent_id = new.id) then
      raise exception 'A category that has children cannot itself have a parent';
    end if;
  end if;
  return new;
end $$ language plpgsql;

create trigger categories_one_level
  before insert or update on categories
  for each row execute function enforce_category_one_level();
