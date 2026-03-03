
-- Drop existing policies if they exist (to be safe)
drop policy if exists "Users can view machines of their company" on public.machines;
drop policy if exists "Users can insert machines to their company" on public.machines;
drop policy if exists "Users can update machines of their company" on public.machines;
drop policy if exists "Users can delete machines of their company" on public.machines;

-- Ensure RLS is enabled
alter table public.machines enable row level security;

-- Create policies using company_members
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

-- Grant permissions for machines
grant all on public.machines to authenticated;
grant select on public.machines to anon;

-- Drop existing policies for income_entries
drop policy if exists "Users can view income_entries of their company" on public.income_entries;
drop policy if exists "Users can insert income_entries to their company" on public.income_entries;
drop policy if exists "Users can update income_entries of their company" on public.income_entries;
drop policy if exists "Users can delete income_entries of their company" on public.income_entries;

-- Ensure RLS is enabled for income_entries
alter table public.income_entries enable row level security;

-- Create policies using company_members for income_entries
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

-- Grant permissions for income_entries
grant all on public.income_entries to authenticated;
grant select on public.income_entries to anon;
