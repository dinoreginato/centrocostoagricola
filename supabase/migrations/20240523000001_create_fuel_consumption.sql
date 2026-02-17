
create table if not exists fuel_consumption (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade not null,
  sector_id uuid references sectors(id) on delete set null,
  date date default current_date not null,
  activity text not null, -- e.g. 'Cosecha', 'Aplicacion', 'Transporte'
  liters numeric not null check (liters > 0),
  estimated_price numeric not null default 0, -- Calculated cost at the time of log
  created_at timestamptz default now()
);

-- Add RLS policies
alter table fuel_consumption enable row level security;

create policy "Users can view fuel_consumption of their company"
  on fuel_consumption for select
  using (company_id in (select id from companies where owner_id = auth.uid()));

create policy "Users can insert fuel_consumption for their company"
  on fuel_consumption for insert
  with check (company_id in (select id from companies where owner_id = auth.uid()));

create policy "Users can update fuel_consumption for their company"
  on fuel_consumption for update
  using (company_id in (select id from companies where owner_id = auth.uid()));

create policy "Users can delete fuel_consumption for their company"
  on fuel_consumption for delete
  using (company_id in (select id from companies where owner_id = auth.uid()));
