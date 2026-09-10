alter table public.clients drop constraint if exists clients_agency_id_name_key;

create unique index clients_agency_active_name_unique
  on public.clients (agency_id, lower(name))
  where active;

comment on column public.clients.active is
  'Soft-delete flag. Inactive clients remain available to historical tasks and billing reports.';
