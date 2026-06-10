alter table public.workers
add column if not exists art69_exempt boolean not null default false;
