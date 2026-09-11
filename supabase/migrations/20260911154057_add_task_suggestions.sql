create table public.task_suggestions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  position smallint not null check (position between 1 and 6),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 500),
  category text not null check (category in ('essential', 'recommended', 'value', 'follow_up')),
  reward_percentage smallint not null check (reward_percentage between 1 and 5),
  omission_penalty_percentage smallint not null default 0,
  evidence_required boolean not null default false,
  tools text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'completed', 'not_applicable')),
  evidence text check (evidence is null or char_length(evidence) <= 1000),
  completed_at timestamptz,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected', 'not_applicable')),
  verification_rationale text check (verification_rationale is null or char_length(verification_rationale) <= 600),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_suggestions_task_position_unique unique (task_id, position),
  constraint task_suggestions_penalty_rule check (
    (category = 'essential' and omission_penalty_percentage between 5 and 15)
    or (category <> 'essential' and omission_penalty_percentage = 0)
  )
);

create index task_suggestions_agency_id_idx on public.task_suggestions(agency_id);
create index task_suggestions_task_id_idx on public.task_suggestions(task_id);

create trigger task_suggestions_set_updated_at
before update on public.task_suggestions
for each row execute function public.set_updated_at();

alter table public.task_suggestions enable row level security;

grant select, insert, update on table public.task_suggestions to authenticated;

create policy "task_suggestions_select_agency"
on public.task_suggestions for select to authenticated
using (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);

create policy "task_suggestions_insert_developer"
on public.task_suggestions for insert to authenticated
with check (
  agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid
  and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer'
);

create policy "task_suggestions_update_developer"
on public.task_suggestions for update to authenticated
using (
  agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid
  and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'developer'
)
with check (agency_id = ((select auth.jwt()) -> 'app_metadata' ->> 'agency_id')::uuid);
