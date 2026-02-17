-- Create workers table
create table if not exists workers (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  role text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create worker_costs table
create table if not exists worker_costs (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade not null,
  worker_id uuid references workers(id) on delete cascade not null,
  sector_id uuid references sectors(id) on delete cascade not null,
  date date default current_date not null,
  amount numeric not null check (amount >= 0),
  description text,
  created_at timestamp with time zone default now()
);

-- RLS Policies
alter table workers enable row level security;
alter table worker_costs enable row level security;

create policy "Users can view workers of their companies"
  on workers for select
  using (exists (
    select 1 from companies
    where companies.id = workers.company_id
    and companies.owner_id = auth.uid()
  ));

create policy "Users can insert workers to their companies"
  on workers for insert
  with check (exists (
    select 1 from companies
    where companies.id = workers.company_id
    and companies.owner_id = auth.uid()
  ));

create policy "Users can update workers of their companies"
  on workers for update
  using (exists (
    select 1 from companies
    where companies.id = workers.company_id
    and companies.owner_id = auth.uid()
  ));

create policy "Users can delete workers of their companies"
  on workers for delete
  using (exists (
    select 1 from companies
    where companies.id = workers.company_id
    and companies.owner_id = auth.uid()
  ));

-- Policies for costs
create policy "Users can view worker_costs of their companies"
  on worker_costs for select
  using (exists (
    select 1 from companies
    where companies.id = worker_costs.company_id
    and companies.owner_id = auth.uid()
  ));

create policy "Users can insert worker_costs to their companies"
  on worker_costs for insert
  with check (exists (
    select 1 from companies
    where companies.id = worker_costs.company_id
    and companies.owner_id = auth.uid()
  ));

create policy "Users can delete worker_costs of their companies"
  on worker_costs for delete
  using (exists (
    select 1 from companies
    where companies.id = worker_costs.company_id
    and companies.owner_id = auth.uid()
  ));
