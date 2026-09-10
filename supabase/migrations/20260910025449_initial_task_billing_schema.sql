create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create type public.app_role as enum ('developer', 'agency');
create type public.task_status as enum ('open', 'in_progress', 'completed', 'approved');
create type public.classification_status as enum ('pending', 'classified', 'failed', 'manual');

create table public.agencies (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  currency_code text not null default 'BRL' check (currency_code = 'BRL'),
  point_value_cents integer not null default 400 check (point_value_cents between 1 and 100000000),
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 3 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete restrict,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default extensions.gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  color text not null default '#3478f6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, name)
);

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 240),
  status public.task_status not null default 'open',
  complexity_level smallint not null check (complexity_level between 1 and 4),
  points smallint not null,
  classification_status public.classification_status not null default 'pending',
  classification_metadata jsonb not null default '{}'::jsonb,
  ai_model text,
  tracked_seconds integer not null default 0 check (tracked_seconds >= 0),
  manual_duration_seconds integer check (manual_duration_seconds between 0 and 359999999),
  completed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_points_match_level check (
    (complexity_level = 1 and points between 1 and 2) or
    (complexity_level = 2 and points between 5 and 10) or
    (complexity_level = 3 and points between 20 and 30) or
    (complexity_level = 4 and points between 50 and 100)
  ),
  constraint tasks_completion_consistent check (
    (status in ('completed', 'approved') and completed_at is not null) or
    (status in ('open', 'in_progress') and completed_at is null)
  ),
  constraint tasks_approval_consistent check (
    (status = 'approved' and approved_at is not null and approved_by is not null) or
    (status <> 'approved' and approved_at is null and approved_by is null)
  )
);

create table public.time_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null default clock_timestamp(),
  stopped_at timestamptz,
  duration_seconds integer check (duration_seconds between 0 and 359999999),
  created_at timestamptz not null default now(),
  constraint time_entries_stop_consistent check (
    (stopped_at is null and duration_seconds is null) or
    (stopped_at is not null and duration_seconds is not null and stopped_at >= started_at)
  )
);

create table public.task_time_adjustments (
  id uuid primary key default extensions.gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  previous_seconds integer,
  new_seconds integer not null check (new_seconds between 0 and 359999999),
  reason text,
  created_at timestamptz not null default now()
);

create table public.billing_cycles (
  id uuid primary key default extensions.gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  point_value_cents integer not null check (point_value_cents > 0),
  total_points integer not null default 0 check (total_points >= 0),
  total_amount_cents bigint not null default 0 check (total_amount_cents >= 0),
  generated_at timestamptz not null default now(),
  unique (agency_id, period_start, period_end),
  check (period_start < period_end)
);

create table public.billing_items (
  id uuid primary key default extensions.gen_random_uuid(),
  billing_cycle_id uuid not null references public.billing_cycles(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  task_id uuid not null references public.tasks(id) on delete restrict,
  points integer not null check (points > 0),
  amount_cents bigint not null check (amount_cents >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  unique (billing_cycle_id, task_id)
);

create index profiles_agency_id_idx on public.profiles (agency_id);
create index clients_agency_active_idx on public.clients (agency_id, active, name);
create index tasks_agency_status_created_idx on public.tasks (agency_id, status, created_at desc);
create index tasks_agency_completed_idx on public.tasks (agency_id, completed_at) where completed_at is not null;
create index tasks_client_id_idx on public.tasks (client_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_approved_by_idx on public.tasks (approved_by);
create index time_entries_task_id_idx on public.time_entries (task_id);
create index time_entries_agency_started_idx on public.time_entries (agency_id, started_at desc);
create index time_entries_user_id_idx on public.time_entries (user_id);
create unique index time_entries_one_active_per_task_idx on public.time_entries (task_id) where stopped_at is null;
create unique index time_entries_one_active_per_user_idx on public.time_entries (user_id) where stopped_at is null;
create index task_time_adjustments_task_id_idx on public.task_time_adjustments (task_id);
create index task_time_adjustments_agency_id_idx on public.task_time_adjustments (agency_id);
create index task_time_adjustments_changed_by_idx on public.task_time_adjustments (changed_by);
create index billing_cycles_agency_period_idx on public.billing_cycles (agency_id, period_start desc);
create index billing_items_cycle_client_idx on public.billing_items (billing_cycle_id, client_id);
create index billing_items_agency_id_idx on public.billing_items (agency_id);
create index billing_items_client_id_idx on public.billing_items (client_id);
create unique index billing_items_task_id_idx on public.billing_items (task_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agencies_set_updated_at before update on public.agencies for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create or replace function public.audit_manual_time_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.manual_duration_seconds is distinct from new.manual_duration_seconds and new.manual_duration_seconds is not null then
    insert into public.task_time_adjustments (agency_id, task_id, changed_by, previous_seconds, new_seconds)
    values (new.agency_id, new.id, (select auth.uid()), old.manual_duration_seconds, new.manual_duration_seconds);
  end if;
  return new;
end;
$$;

create trigger tasks_audit_manual_time after update of manual_duration_seconds on public.tasks
for each row execute function public.audit_manual_time_change();

create or replace function public.start_task_timer(target_task_id uuid)
returns public.time_entries
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := (select auth.uid());
  target_agency_id uuid;
  new_entry public.time_entries;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'developer') then
    raise exception 'Developer role required' using errcode = '42501';
  end if;
  select agency_id into target_agency_id from public.tasks
  where id = target_task_id and status in ('open', 'in_progress') for update;
  if target_agency_id is null or target_agency_id <> (select agency_id from public.profiles where id = current_user_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  insert into public.time_entries (agency_id, task_id, user_id)
  values (target_agency_id, target_task_id, current_user_id) returning * into new_entry;
  update public.tasks set status = 'in_progress', manual_duration_seconds = null where id = target_task_id;
  return new_entry;
end;
$$;

create or replace function public.stop_task_timer(target_task_id uuid)
returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := (select auth.uid());
  entry public.time_entries;
  result public.tasks;
  elapsed integer;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into entry from public.time_entries
  where task_id = target_task_id and user_id = current_user_id and stopped_at is null for update;
  if entry.id is null then raise exception 'Active timer not found' using errcode = 'P0002'; end if;
  elapsed := greatest(0, floor(extract(epoch from (clock_timestamp() - entry.started_at)))::integer);
  update public.time_entries set stopped_at = clock_timestamp(), duration_seconds = elapsed where id = entry.id;
  update public.tasks set tracked_seconds = tracked_seconds + elapsed, status = 'in_progress'
  where id = target_task_id returning * into result;
  return result;
end;
$$;

create or replace function public.approve_task(target_task_id uuid)
returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := (select auth.uid());
  current_agency_id uuid;
  result public.tasks;
begin
  select agency_id into current_agency_id from public.profiles where id = current_user_id and role = 'agency';
  if current_user_id is null or current_agency_id is null then
    raise exception 'Agency role required' using errcode = '42501';
  end if;
  update public.tasks set status = 'approved', approved_at = now(), approved_by = current_user_id
  where id = target_task_id and agency_id = current_agency_id and status = 'completed'
  returning * into result;
  if result.id is null then raise exception 'Completed task not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create or replace function public.generate_monthly_billing_cycles(target_date date default current_date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  agency_record record;
  v_cycle_id uuid;
  period_end timestamptz;
  period_start timestamptz;
  generated_count integer := 0;
begin
  for agency_record in select id, point_value_cents, timezone from public.agencies loop
    period_end := ((date_trunc('month', target_date)::date + 14)::timestamp at time zone agency_record.timezone);
    period_start := (((date_trunc('month', target_date)::date - interval '1 month')::date + 14)::timestamp at time zone agency_record.timezone);
    insert into public.billing_cycles (agency_id, period_start, period_end, point_value_cents)
    values (agency_record.id, period_start, period_end, agency_record.point_value_cents)
    on conflict (agency_id, period_start, period_end) do nothing
    returning id into v_cycle_id;
    if v_cycle_id is null then continue; end if;

    insert into public.billing_items (billing_cycle_id, agency_id, client_id, task_id, points, amount_cents, duration_seconds)
    select v_cycle_id, task.agency_id, task.client_id, task.id, task.points,
      task.points::bigint * agency_record.point_value_cents,
      coalesce(task.manual_duration_seconds, task.tracked_seconds)
    from public.tasks as task
    where task.agency_id = agency_record.id
      and task.status in ('completed', 'approved')
      and task.completed_at >= period_start and task.completed_at < period_end;

    update public.billing_cycles as cycle set
      total_points = coalesce(summary.points, 0),
      total_amount_cents = coalesce(summary.amount_cents, 0)
    from (
      select sum(points)::integer as points, sum(amount_cents)::bigint as amount_cents
      from public.billing_items where billing_cycle_id = v_cycle_id
    ) as summary
    where cycle.id = v_cycle_id;
    generated_count := generated_count + 1;
    v_cycle_id := null;
  end loop;
  return generated_count;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.agencies, public.profiles, public.clients, public.tasks, public.time_entries,
  public.task_time_adjustments, public.billing_cycles, public.billing_items to authenticated;
grant update (point_value_cents) on public.agencies to authenticated;
grant insert, update, delete on public.clients, public.tasks to authenticated;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_manual_time_change() from public, anon, authenticated;
revoke execute on function public.start_task_timer(uuid) from public, anon;
revoke execute on function public.stop_task_timer(uuid) from public, anon;
revoke execute on function public.approve_task(uuid) from public, anon;
grant execute on function public.start_task_timer(uuid), public.stop_task_timer(uuid), public.approve_task(uuid) to authenticated;
revoke execute on function public.generate_monthly_billing_cycles(date) from public, anon, authenticated;
grant execute on function public.generate_monthly_billing_cycles(date) to service_role;

alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.tasks enable row level security;
alter table public.time_entries enable row level security;
alter table public.task_time_adjustments enable row level security;
alter table public.billing_cycles enable row level security;
alter table public.billing_items enable row level security;

create policy agencies_select_same_agency on public.agencies for select to authenticated
using (id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy agencies_update_member on public.agencies for update to authenticated
using (id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid and (select auth.jwt()) -> 'app_metadata' ->> 'role' in ('developer', 'agency'))
with check (id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);

create policy profiles_select_same_agency on public.profiles for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);

create policy clients_select_same_agency on public.clients for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy clients_insert_developer on public.clients for insert to authenticated
with check (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer');
create policy clients_update_developer on public.clients for update to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer')
with check (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy clients_delete_developer on public.clients for delete to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer');

create policy tasks_select_same_agency on public.tasks for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy tasks_insert_developer on public.tasks for insert to authenticated
with check (
  agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid
  and created_by = (select auth.uid())
  and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer'
);
create policy tasks_update_developer on public.tasks for update to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer')
with check (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy tasks_delete_developer on public.tasks for delete to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer');

create policy time_entries_select_same_agency on public.time_entries for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy task_time_adjustments_select_same_agency on public.task_time_adjustments for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy billing_cycles_select_same_agency on public.billing_cycles for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
create policy billing_items_select_same_agency on public.billing_items for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);

select cron.schedule(
  'generate-billing-cycles-day-15',
  '0 6 15 * *',
  $$select public.generate_monthly_billing_cycles(current_date);$$
);
