alter table public.tasks
  drop constraint if exists tasks_execution_adjustment_range,
  drop constraint if exists tasks_final_points_consistent;

alter table public.tasks
  add constraint tasks_execution_adjustment_range
    check (execution_adjustment between -base_points and 20),
  add constraint tasks_final_points_consistent
    check (
      points = greatest(0, base_points + efficiency_adjustment + execution_adjustment)
      and points between 0 and 160
    );

comment on column public.tasks.execution_adjustment is
  'Jarvis execution quality and authorship adjustment. May reduce up to all base points or add up to 20 points.';

alter table public.billing_items
  drop constraint if exists billing_items_points_check,
  drop constraint if exists billing_items_points_nonnegative;

alter table public.billing_items
  add constraint billing_items_points_nonnegative check (points >= 0);
