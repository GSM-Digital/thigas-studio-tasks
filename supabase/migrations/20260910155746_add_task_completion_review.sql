alter table public.tasks
  add column if not exists completion_summary text,
  add column if not exists completion_rationale text,
  add column if not exists execution_adjustment smallint not null default 0;

alter table public.tasks
  drop constraint if exists tasks_completion_summary_length,
  drop constraint if exists tasks_completion_rationale_length,
  drop constraint if exists tasks_execution_adjustment_range;

alter table public.tasks
  add constraint tasks_completion_summary_length
    check (completion_summary is null or char_length(completion_summary) between 10 and 4000),
  add constraint tasks_completion_rationale_length
    check (completion_rationale is null or char_length(completion_rationale) <= 1000),
  add constraint tasks_execution_adjustment_range
    check (execution_adjustment between 0 and 20);

alter table public.tasks drop constraint if exists tasks_final_points_consistent;
alter table public.tasks add constraint tasks_final_points_consistent
  check (
    points = base_points + efficiency_adjustment + execution_adjustment
    and points between 1 and 160
  );

comment on column public.tasks.completion_summary is
  'Developer-authored completion report used by Jarvis for the final execution review.';
comment on column public.tasks.completion_rationale is
  'Jarvis explanation for granting or withholding the execution bonus.';
comment on column public.tasks.execution_adjustment is
  'Non-negative Jarvis bonus for documented execution merit, separate from time efficiency.';
