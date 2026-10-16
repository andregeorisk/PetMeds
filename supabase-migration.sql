-- Execute este arquivo no SQL Editor do Supabase apos criar as tabelas base.

drop policy if exists "shared family profiles" on public.profiles;
drop policy if exists "family admins update family" on public.families;

alter table public.doses
  add column if not exists administered_by uuid references public.profiles(id) on delete set null;

alter table public.doses
  alter column treatment_id drop not null;

alter table public.medications
  alter column bought_at drop not null;

alter table public.medications
  add column if not exists package_quantity numeric;

alter table public.medications
  add column if not exists single_dose boolean not null default false;

alter table public.treatments
  add column if not exists paused_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists pause_history jsonb not null default '[]'::jsonb,
  add column if not exists disabled_times text[] not null default '{}';

alter table public.pets
  add column if not exists donated_at date,
  add column if not exists deceased_at date;

alter table public.medications
  add column if not exists stock_history jsonb not null default '[]'::jsonb;

update public.medications
set stock_history = jsonb_build_array(jsonb_build_object(
  'type', 'initial',
  'purchased_at', coalesce(bought_at, current_date)::text,
  'expires_at', expires_at::text,
  'quantity_added', quantity,
  'recorded_at', now()
))
where stock_history = '[]'::jsonb;

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
alter table public.treatments
  add column if not exists schedule_mode text not null default 'exact';
alter table public.treatments
  add column if not exists tolerance_minutes integer not null default 0;
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
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treatments_schedule_mode_check' and conrelid = 'public.treatments'::regclass) then
    alter table public.treatments add constraint treatments_schedule_mode_check check (schedule_mode in ('exact', 'window', 'all_day'));
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

-- Cada dose administrada desconta 1 unidade do estoque; desfazer ou alterar o status devolve.
create or replace function public.sync_medication_stock_on_dose()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_done boolean := tg_op = 'UPDATE' and old.status = 'done';
  is_done boolean := new.status = 'done';
begin
  if is_done and not was_done then
    update public.medications set quantity = greatest(quantity - 1, 0) where id = new.medication_id;
  elsif was_done and not is_done then
    update public.medications set quantity = quantity + 1 where id = old.medication_id;
  end if;
  return new;
end;
$$;

drop trigger if exists doses_sync_stock on public.doses;
create trigger doses_sync_stock
after insert or update of status on public.doses
for each row execute function public.sync_medication_stock_on_dose();

-- Codigo sequencial (8 digitos com zeros a esquerda) atribuido a cada tratamento na criacao.
alter table public.treatments
  add column if not exists code text;

create or replace function public.assign_treatment_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    new.code := lpad(nextval('public.treatment_code_seq')::text, 8, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_assign_code on public.treatments;

-- Numera os tratamentos existentes pela data de inicio, uma unica vez (na criacao da sequencia).
do $$
begin
  if to_regclass('public.treatment_code_seq') is null then
    create sequence public.treatment_code_seq;
    with ordered as (
      select id, row_number() over (order by start_date nulls last, created_at, id) as position
      from public.treatments
    )
    update public.treatments t
    set code = lpad(ordered.position::text, 8, '0')
    from ordered
    where t.id = ordered.id;
    perform setval('public.treatment_code_seq', (select count(*) from public.treatments) + 1, false);
  end if;
end;
$$;

create trigger treatments_assign_code
before insert or update on public.treatments
for each row execute function public.assign_treatment_code();

create unique index if not exists treatments_code_key on public.treatments (code);

-- Posologia dividida em quantidade e unidade; a coluna dosage continua com o texto composto.
alter table public.treatments
  add column if not exists dosage_quantity numeric,
  add column if not exists dosage_unit text;

-- Cuidador temporario (so administra doses) com periodo de acesso; varias familias por usuario.
alter table public.family_members
  add column if not exists starts_on date,
  add column if not exists ends_on date;

do $$
declare
  existing record;
begin
  for existing in
    select conname from pg_constraint
    where conrelid = 'public.family_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.family_members drop constraint %I', existing.conname);
  end loop;
  alter table public.family_members
    add constraint family_members_role_check
    check (role in ('admin', 'cuidador', 'visualizador', 'cuidador_temporario'));
end;
$$;

-- Retorna 'blocked' (fora do periodo), 'limited' (periodo ativo) ou null (nao e cuidador temporario).
create or replace function public.caregiver_restriction(p_family_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when fm.role <> 'cuidador_temporario' then null
    when (fm.starts_on is not null and current_date < fm.starts_on)
      or (fm.ends_on is not null and current_date > fm.ends_on) then 'blocked'
    else 'limited'
  end
  from public.family_members fm
  where fm.family_id = p_family_id and fm.user_id = auth.uid()
$$;

create or replace function public.pet_caregiver_restriction(p_pet_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.caregiver_restriction(p.family_id) from public.pets p where p.id = p_pet_id
$$;

do $$
declare
  t text;
begin
  foreach t in array array['pets', 'medications', 'treatments', 'doses'] loop
    execute format('drop policy if exists "temp caregiver blocked" on public.%I', t);
    execute format('create policy "temp caregiver blocked" on public.%I as restrictive for all to authenticated using (coalesce(public.caregiver_restriction(family_id), '''') <> ''blocked'')', t);
  end loop;

  foreach t in array array['pets', 'medications', 'treatments'] loop
    execute format('drop policy if exists "temp caregiver no insert" on public.%I', t);
    execute format('create policy "temp caregiver no insert" on public.%I as restrictive for insert to authenticated with check (public.caregiver_restriction(family_id) is null)', t);
    execute format('drop policy if exists "temp caregiver no update" on public.%I', t);
    execute format('create policy "temp caregiver no update" on public.%I as restrictive for update to authenticated using (public.caregiver_restriction(family_id) is null)', t);
    execute format('drop policy if exists "temp caregiver no delete" on public.%I', t);
    execute format('create policy "temp caregiver no delete" on public.%I as restrictive for delete to authenticated using (public.caregiver_restriction(family_id) is null)', t);
  end loop;

  drop policy if exists "temp caregiver no delete" on public.doses;
  create policy "temp caregiver no delete" on public.doses as restrictive for delete to authenticated using (public.caregiver_restriction(family_id) is null);

  drop policy if exists "temp caregiver blocked" on public.weight_records;
  create policy "temp caregiver blocked" on public.weight_records as restrictive for all to authenticated using (coalesce(public.pet_caregiver_restriction(pet_id), '') <> 'blocked');
  drop policy if exists "temp caregiver no insert" on public.weight_records;
  create policy "temp caregiver no insert" on public.weight_records as restrictive for insert to authenticated with check (public.pet_caregiver_restriction(pet_id) is null);
  drop policy if exists "temp caregiver no update" on public.weight_records;
  create policy "temp caregiver no update" on public.weight_records as restrictive for update to authenticated using (public.pet_caregiver_restriction(pet_id) is null);
  drop policy if exists "temp caregiver no delete" on public.weight_records;
  create policy "temp caregiver no delete" on public.weight_records as restrictive for delete to authenticated using (public.pet_caregiver_restriction(pet_id) is null);
end;
$$;

create or replace function public.invite_member_to_family(p_family_id uuid, p_email text, p_role text, p_starts_on date default null, p_ends_on date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if not exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem convidar membros';
  end if;

  if p_role not in ('admin', 'cuidador', 'visualizador', 'cuidador_temporario') then
    raise exception 'Funcao invalida';
  end if;

  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A data final deve ser igual ou posterior a data de inicio';
  end if;

  select u.id into target_user_id from auth.users u where lower(u.email) = lower(trim(p_email));
  if target_user_id is null then
    raise exception 'Usuario nao encontrado';
  end if;

  insert into public.family_members (family_id, user_id, role, receive_email, starts_on, ends_on)
  values (p_family_id, target_user_id, p_role, true,
          case when p_role = 'cuidador_temporario' then p_starts_on end,
          case when p_role = 'cuidador_temporario' then p_ends_on end)
  on conflict (family_id, user_id) do update
    set role = excluded.role, starts_on = excluded.starts_on, ends_on = excluded.ends_on;
end;
$$;

create or replace function public.delete_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem excluir uma familia';
  end if;

  delete from public.families where id = p_family_id;
end;
$$;

grant execute on function public.invite_member_to_family(uuid, text, text, date, date) to authenticated;
grant execute on function public.delete_family(uuid) to authenticated;
grant execute on function public.caregiver_restriction(uuid) to authenticated;
grant execute on function public.pet_caregiver_restriction(uuid) to authenticated;

-- Fotos (data URL JPEG 256x256 gerada no navegador) de pets e usuarios.
alter table public.pets
  add column if not exists photo text;
alter table public.profiles
  add column if not exists photo text;

grant execute on function public.join_family_by_code(text) to authenticated;
grant execute on function public.invite_member_by_email(text, text) to authenticated;
grant execute on function public.delete_pet(uuid) to authenticated;
grant execute on function public.create_personal_family(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.delete_family_and_create_personal(text) to authenticated;
