-- Lock search_path on trigger functions so they cannot be hijacked by a
-- caller-controlled path. References are schema-qualified accordingly.
create or replace function public.enforce_category_one_level() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A category cannot be its own parent';
    end if;
    if exists (
      select 1 from public.categories c
      where c.id = new.parent_id and c.parent_id is not null
    ) then
      raise exception 'Categories may nest only one level deep';
    end if;
    if exists (select 1 from public.categories c where c.parent_id = new.id) then
      raise exception 'A category that has children cannot itself have a parent';
    end if;
  end if;
  return new;
end $$;

create or replace function public.touch_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;
