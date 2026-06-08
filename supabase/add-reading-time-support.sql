alter table public.meter_readings
  add column if not exists reading_time time not null default '07:00:00';

alter table public.meter_readings
  drop constraint if exists meter_readings_user_date_unique;
