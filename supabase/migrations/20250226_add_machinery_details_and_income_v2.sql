-- Create table for tracking machinery/vehicles
create table if not exists public.machines (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    company_id uuid references public.companies(id) on delete cascade not null,
    name text not null, -- e.g. "Tractor John Deere 5055"
    type text, -- e.g. "Tractor", "Camioneta", "Carro"
    brand text,
    model text,
    plate text, -- Patente
    description text,
    is_active boolean default true
);

-- Enable RLS for machines
alter table public.machines enable row level security;

create policy "Users can view machines of their company"
    on public.machines for select
    using (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

create policy "Users can insert machines to their company"
    on public.machines for insert
    with check (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

create policy "Users can update machines of their company"
    on public.machines for update
    using (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

create policy "Users can delete machines of their company"
    on public.machines for delete
    using (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

-- Add machine_id to machinery_assignments
alter table public.machinery_assignments
add column if not exists machine_id uuid references public.machines(id) on delete set null;

-- Create table for tracking income/budget/sales
create table if not exists public.income_entries (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    company_id uuid references public.companies(id) on delete cascade not null,
    field_id uuid references public.fields(id) on delete set null,
    sector_id uuid references public.sectors(id) on delete set null,
    date date not null,
    category text default 'Venta Fruta', -- 'Presupuesto', 'Venta Fruta', 'Otro Ingreso'
    amount numeric(12, 2) not null,
    description text,
    season text -- e.g. "2024-2025"
);

-- Enable RLS for income_entries
alter table public.income_entries enable row level security;

create policy "Users can view income_entries of their company"
    on public.income_entries for select
    using (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

create policy "Users can insert income_entries to their company"
    on public.income_entries for insert
    with check (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

create policy "Users can update income_entries of their company"
    on public.income_entries for update
    using (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));

create policy "Users can delete income_entries of their company"
    on public.income_entries for delete
    using (company_id in (
        select company_id from public.company_members where user_id = auth.uid()
    ));
