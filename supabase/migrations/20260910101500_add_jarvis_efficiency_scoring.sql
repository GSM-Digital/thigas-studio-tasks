alter table public.tasks
  add column estimated_duration_seconds integer not null default 28800
    check (estimated_duration_seconds between 1 and 359999999),
  add column base_points smallint,
  add column efficiency_adjustment smallint not null default 0;

update public.tasks set base_points = points where base_points is null;
alter table public.tasks alter column base_points set not null;

alter table public.tasks drop constraint tasks_points_match_level;
alter table public.tasks add constraint tasks_base_points_match_level check (
  (complexity_level = 1 and base_points between 1 and 4) or
  (complexity_level = 2 and base_points between 5 and 15) or
  (complexity_level = 3 and base_points between 20 and 35) or
  (complexity_level = 4 and base_points between 50 and 100)
);
alter table public.tasks add constraint tasks_final_points_consistent
  check (points = base_points + efficiency_adjustment and points between 1 and 140);

comment on column public.tasks.estimated_duration_seconds is 'SLA used by the Jarvis efficiency evaluator.';
comment on column public.tasks.base_points is 'Technical complexity score before efficiency adjustment.';
comment on column public.tasks.efficiency_adjustment is 'Deterministic bonus or penalty applied to base_points.';
