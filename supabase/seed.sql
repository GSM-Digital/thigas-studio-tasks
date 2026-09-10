insert into public.agencies (id, name, point_value_cents)
values ('00000000-0000-4000-8000-000000000001', 'Thigas Studio', 400)
on conflict (id) do update set name = excluded.name, point_value_cents = excluded.point_value_cents;

insert into public.clients (id, agency_id, name, color)
values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Make One', '#3478f6'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Aurora Studio', '#af52de'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'Norte Café', '#ff9f0a')
on conflict (id) do update set name = excluded.name, color = excluded.color;
