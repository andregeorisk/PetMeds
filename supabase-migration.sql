-- Execute este arquivo no SQL Editor do Supabase apos criar as tabelas base.

drop policy if exists "shared family profiles" on public.profiles;
drop policy if exists "family admins update family" on public.families;

create policy "shared family profiles"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.family_members mine
    join public.family_members theirs on theirs.family_id = mine.family_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
  )
);

create policy "family admins update family"
on public.families for update
to authenticated
using (public.is_family_admin(id))
with check (public.is_family_admin(id));

alter table public.treatments
  add column if not exists start_date date;
alter table public.treatments
  add column if not exists interval_value integer not null default 1;
alter table public.treatments
  add column if not exists interval_unit text not null default 'day';
update public.treatments
set start_date = coalesce(start_date, created_at::date),
    interval_value = case
      when interval_days = 7 then 1
      when interval_days = 14 then 2
      when interval_days = 30 then 1
      else coalesce(interval_value, interval_days, 1)
    end,
    interval_unit = case
      when interval_days in (7, 14) then 'week'
      when interval_days = 30 then 'month'
      else coalesce(interval_unit, 'day')
    end
where start_date is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treatments_interval_unit_check' and conrelid = 'public.treatments'::regclass) then
    alter table public.treatments add constraint treatments_interval_unit_check check (interval_unit in ('day', 'week', 'month', 'year'));
  end if;
end;
$$;

alter table public.pets
  add column if not exists status text not null default 'active';

update public.pets
set status = 'active'
where status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pets_status_check'
      and conrelid = 'public.pets'::regclass
  ) then
    alter table public.pets
      add constraint pets_status_check check (status in ('active', 'donated', 'lost', 'deceased'));
  end if;
end;
$$;

create or replace function public.prevent_deceased_pet_reactivation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'deceased' and new.status <> 'deceased' then
    raise exception 'Pets falecidos nao podem ser reativados';
  end if;
  return new;
end;
$$;

drop trigger if exists pets_status_transition on public.pets;
create trigger pets_status_transition
before update of status on public.pets
for each row execute function public.prevent_deceased_pet_reactivation();

create or replace function public.delete_pet(p_pet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pet_family_id uuid;
begin
  select family_id into pet_family_id
  from public.pets
  where id = p_pet_id;

  if pet_family_id is null then
    raise exception 'Pet nao encontrado';
  end if;

  if not exists (
    select 1
    from public.family_members
    where family_id = pet_family_id
      and user_id = auth.uid()
      and role in ('admin', 'cuidador')
  ) then
    raise exception 'Apenas administradores e cuidadores podem excluir pets';
  end if;

  delete from public.doses where pet_id = p_pet_id;
  delete from public.treatments where pet_id = p_pet_id;
  delete from public.weight_records where pet_id = p_pet_id;
  delete from public.pets where id = p_pet_id;
end;
$$;

create or replace function public.join_family_by_code(p_code text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family public.families;
begin
  select * into target_family
  from public.families
  where code = upper(trim(p_code));

  if target_family.id is null then
    raise exception 'Codigo de familia invalido';
  end if;

  if exists (
    select 1 from public.family_members
    where family_id = target_family.id and user_id = auth.uid()
  ) then
    return target_family;
  end if;

  delete from public.family_members where user_id = auth.uid();
  insert into public.family_members (family_id, user_id, role, receive_email)
  values (target_family.id, auth.uid(), 'cuidador', true);

  return target_family;
end;
$$;

create or replace function public.invite_member_by_email(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  family_id uuid;
begin
  select family_id into family_id
  from public.family_members
  where user_id = auth.uid() and role = 'admin'
  limit 1;

  if family_id is null then
    raise exception 'Apenas administradores podem convidar membros';
  end if;

  if p_role not in ('admin', 'cuidador', 'visualizador') then
    raise exception 'Funcao invalida';
  end if;

  select id into target_user_id from auth.users where lower(email) = lower(trim(p_email));
  if target_user_id is null then
    raise exception 'Usuario nao encontrado';
  end if;

  insert into public.family_members (family_id, user_id, role, receive_email)
  values (family_id, target_user_id, p_role, true)
  on conflict (family_id, user_id) do update set role = excluded.role;
end;
$$;

create or replace function public.create_personal_family(p_name text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  created_family public.families;
  family_code text;
begin
  family_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.families (name, code, admin_id)
  values (trim(p_name), family_code, auth.uid())
  returning * into created_family;

  insert into public.family_members (family_id, user_id, role, receive_email)
  values (created_family.id, auth.uid(), 'admin', true);

  return created_family;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

create or replace function public.delete_family_and_create_personal(p_name text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  old_family_id uuid;
  created_family public.families;
  family_code text;
begin
  select family_id into old_family_id
  from public.family_members
  where user_id = auth.uid() and role = 'admin'
  limit 1;

  if old_family_id is null then
    raise exception 'Apenas administradores podem excluir uma familia';
  end if;

  delete from public.families where id = old_family_id;

  family_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.families (name, code, admin_id)
  values (trim(p_name), family_code, auth.uid())
  returning * into created_family;

  insert into public.family_members (family_id, user_id, role, receive_email)
  values (created_family.id, auth.uid(), 'admin', true);

  return created_family;
end;
$$;

grant execute on function public.join_family_by_code(text) to authenticated;
grant execute on function public.invite_member_by_email(text, text) to authenticated;
grant execute on function public.delete_pet(uuid) to authenticated;
grant execute on function public.create_personal_family(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.delete_family_and_create_personal(text) to authenticated;
