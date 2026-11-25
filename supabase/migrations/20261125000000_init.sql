-- Ярмарка «4 сезона» — начальная схема: мероприятия, реестр участников, журнал изменений.
-- Публика читает только разрешённые данные; служебные поля реестра доступны только администратору.
-- Применяется через Supabase (Postgres). Версия: 2026-11-25.

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. Администраторы
-- =====================================================================
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
create policy "admin_users self read" on public.admin_users
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

-- =====================================================================
-- 2. Мероприятия
-- =====================================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  event_date date not null,
  start_time time not null default '12:00',
  end_time time,
  place text not null default '',
  cover_url text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events enable row level security;

-- Публика видит только опубликованные мероприятия.
create policy "events_public_read" on public.events
  for select to anon, authenticated
  using (status = 'published');

-- Администратор управляет всеми мероприятиями (включая черновики и архив).
create policy "events_admin_all" on public.events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

-- Фотографии мероприятия (галерея).
create table if not exists public.event_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  url text not null,
  caption text not null default '',
  position int not null default 0
);
alter table public.event_photos enable row level security;
create policy "event_photos_public_read" on public.event_photos
  for select to anon, authenticated
  using (exists (
    select 1 from public.events e where e.id = event_id and e.status = 'published'
  ));
create policy "event_photos_admin_all" on public.event_photos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
grant select on public.event_photos to anon, authenticated;
grant insert, update, delete on public.event_photos to authenticated;

-- Документы мероприятия (прикреплённые файлы).
create table if not exists public.event_documents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  url text not null,
  name text not null,
  position int not null default 0
);
alter table public.event_documents enable row level security;
create policy "event_documents_public_read" on public.event_documents
  for select to anon, authenticated
  using (exists (
    select 1 from public.events e where e.id = event_id and e.status = 'published'
  ));
create policy "event_documents_admin_all" on public.event_documents
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
grant select on public.event_documents to anon, authenticated;
grant insert, update, delete on public.event_documents to authenticated;

-- =====================================================================
-- 3. Реестр участников
-- =====================================================================
-- Публичные поля: name, products. Служебные поля: inn, phone, settlement,
-- representative, status, notes — видны и редактируются только администратором.
create table if not exists public.registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  products text not null default '',
  inn text not null default '',
  phone text not null default '',
  settlement text not null default '',
  representative text not null default '',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.registry enable row level security;

-- Публичный доступ к базовой таблице закрыт.
revoke all on public.registry from anon, authenticated;

-- Администратор: полный доступ к базовой таблице.
grant select, insert, update, delete on public.registry to authenticated;
create policy "registry_admin_all" on public.registry
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Публичный список: только активные записи, только name + products.
-- Представление выполняется от имени владельца (security definer) и не раскрывает
-- служебные колонки, поэтому служебные данные недоступны посетителю.
create or replace view public.public_registry as
  select id, name, products
  from public.registry
  where status = 'active';

grant select on public.public_registry to anon, authenticated;

-- =====================================================================
-- 4. Журнал изменений
-- =====================================================================
create table if not exists public.change_log (
  id bigint generated always as identity primary key,
  entity text not null,               -- 'event' | 'registry'
  entity_id uuid,
  action text not null,               -- 'insert' | 'update' | 'delete'
  changed_by uuid,
  changed_at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
alter table public.change_log enable row level security;
grant select on public.change_log to authenticated;
create policy "change_log_admin_read" on public.change_log
  for select to authenticated
  using (public.is_admin());

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entity_name text;
begin
  entity_name := case
    when tg_table_name = 'registry' then 'registry'
    when tg_table_name = 'events' then 'event'
    else tg_table_name
  end;
  if tg_op = 'DELETE' then
    insert into public.change_log (entity, entity_id, action, changed_by, before)
    values (entity_name, old.id, 'delete', auth.uid(), to_jsonb(old));
    return old;
  elsif tg_op = 'INSERT' then
    insert into public.change_log (entity, entity_id, action, changed_by, after)
    values (entity_name, new.id, 'insert', auth.uid(), to_jsonb(new));
    return new;
  else
    insert into public.change_log (entity, entity_id, action, changed_by, before, after)
    values (entity_name, new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  end if;
end;
$$;

drop trigger if exists registry_change_log on public.registry;
create trigger registry_change_log
  after insert or update or delete on public.registry
  for each row execute function public.log_change();

drop trigger if exists events_change_log on public.events;
create trigger events_change_log
  after insert or update or delete on public.events
  for each row execute function public.log_change();

-- Обновление updated_at.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists registry_touch on public.registry;
create trigger registry_touch
  before update on public.registry
  for each row execute function public.touch_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch
  before update on public.events
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- 5. Хранилище файлов
-- =====================================================================
insert into storage.buckets (id, name, public)
values
  ('event-covers', 'event-covers', true),
  ('event-photos', 'event-photos', true),
  ('event-documents', 'event-documents', true)
on conflict (id) do nothing;

-- Публичное чтение загруженных файлов.
drop policy if exists "event_assets_public_read" on storage.objects;
create policy "event_assets_public_read" on storage.objects
  for select
  using (bucket_id in ('event-covers', 'event-photos', 'event-documents'));

-- Запись/изменение/удаление — только администратор.
drop policy if exists "event_assets_admin_insert" on storage.objects;
create policy "event_assets_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('event-covers', 'event-photos', 'event-documents')
    and public.is_admin()
  );

drop policy if exists "event_assets_admin_update" on storage.objects;
create policy "event_assets_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('event-covers', 'event-photos', 'event-documents')
    and public.is_admin()
  );

drop policy if exists "event_assets_admin_delete" on storage.objects;
create policy "event_assets_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('event-covers', 'event-photos', 'event-documents')
    and public.is_admin()
  );
