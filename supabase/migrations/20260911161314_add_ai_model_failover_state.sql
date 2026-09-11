create table public.ai_model_failover_state (
  provider text primary key check (provider = 'gemini'),
  primary_model text not null check (char_length(primary_model) between 3 and 80),
  fallback_model text not null check (char_length(fallback_model) between 3 and 80),
  fallback_until timestamptz,
  last_quota_error_at timestamptz,
  last_quota_error_code text check (last_quota_error_code is null or char_length(last_quota_error_code) <= 80),
  last_recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (primary_model <> fallback_model)
);

create trigger ai_model_failover_state_set_updated_at
before update on public.ai_model_failover_state
for each row execute function public.set_updated_at();

alter table public.ai_model_failover_state enable row level security;

revoke all on table public.ai_model_failover_state from public, anon, authenticated;
grant select, insert, update on table public.ai_model_failover_state to service_role;
