create table if not exists public.solar_usage_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_at timestamptz not null,
  value_kwh numeric not null,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.solar_usage_logs enable row level security;

drop policy if exists "Users can read own solar usage logs" on public.solar_usage_logs;
create policy "Users can read own solar usage logs"
on public.solar_usage_logs
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own solar usage logs" on public.solar_usage_logs;
create policy "Users can insert own solar usage logs"
on public.solar_usage_logs
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own solar usage logs" on public.solar_usage_logs;
create policy "Users can update own solar usage logs"
on public.solar_usage_logs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own solar usage logs" on public.solar_usage_logs;
create policy "Users can delete own solar usage logs"
on public.solar_usage_logs
for delete
using (auth.uid() = user_id);

create table if not exists public.solar_daily_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_date date not null,
  total_kwh numeric not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, summary_date)
);

alter table public.solar_daily_summaries enable row level security;

drop policy if exists "Users can read own solar daily summaries" on public.solar_daily_summaries;
create policy "Users can read own solar daily summaries"
on public.solar_daily_summaries
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own solar daily summaries" on public.solar_daily_summaries;
create policy "Users can insert own solar daily summaries"
on public.solar_daily_summaries
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own solar daily summaries" on public.solar_daily_summaries;
create policy "Users can update own solar daily summaries"
on public.solar_daily_summaries
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own solar daily summaries" on public.solar_daily_summaries;
create policy "Users can delete own solar daily summaries"
on public.solar_daily_summaries
for delete
using (auth.uid() = user_id);