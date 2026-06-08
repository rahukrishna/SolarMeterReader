create table if not exists public.meter_readings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reading_date date not null,
  reading_time time not null default '07:00:00',
  import_t numeric,
  import_t1 numeric not null,
  import_t2 numeric not null,
  import_t3 numeric not null,
  export_t numeric,
  export_t1 numeric not null,
  export_t2 numeric not null,
  export_t3 numeric not null,
  net numeric,
  solar_generated numeric not null,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.meter_readings
  add column if not exists reading_time time not null default '07:00:00';

alter table public.meter_readings
  drop constraint if exists meter_readings_user_date_unique;

alter table public.meter_readings enable row level security;

drop policy if exists "Users can read own meter readings" on public.meter_readings;
create policy "Users can read own meter readings"
on public.meter_readings
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own meter readings" on public.meter_readings;
create policy "Users can insert own meter readings"
on public.meter_readings
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own meter readings" on public.meter_readings;
create policy "Users can update own meter readings"
on public.meter_readings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own meter readings" on public.meter_readings;
create policy "Users can delete own meter readings"
on public.meter_readings
for delete
using (auth.uid() = user_id);
