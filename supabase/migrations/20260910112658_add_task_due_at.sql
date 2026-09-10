alter table public.tasks
  add column due_at timestamptz;

create index tasks_agency_due_at_idx
  on public.tasks (agency_id, due_at)
  where due_at is not null;

comment on column public.tasks.due_at is
  'Calendar deadline selected by the developer. New tasks created through the application require this value.';
