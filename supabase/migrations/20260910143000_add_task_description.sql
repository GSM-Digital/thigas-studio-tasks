alter table public.tasks
  add column if not exists description text;

alter table public.tasks
  drop constraint if exists tasks_description_length;

alter table public.tasks
  add constraint tasks_description_length
  check (description is null or char_length(description) <= 4000);

comment on column public.tasks.description is
  'Optional task notes and implementation context, limited to 4000 characters.';
