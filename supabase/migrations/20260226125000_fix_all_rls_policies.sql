
-- Enable RLS for all tables (just in case)
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_records ENABLE ROW LEVEL SECURITY;

-- 1. FIX MACHINES POLICIES
DROP POLICY IF EXISTS "Users can view machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines for their company" ON public.machines;

CREATE POLICY "Users can view machines for their company" ON public.machines FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = machines.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = machines.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can insert machines for their company" ON public.machines FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = machines.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = machines.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can update machines for their company" ON public.machines FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = machines.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = machines.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can delete machines for their company" ON public.machines FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = machines.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = machines.company_id AND owner_id = auth.uid())
);

-- 2. FIX INCOME_ENTRIES POLICIES
DROP POLICY IF EXISTS "Users can view income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can insert income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can update income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can delete income entries for their company" ON public.income_entries;

CREATE POLICY "Users can view income entries for their company" ON public.income_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = income_entries.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = income_entries.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can insert income entries for their company" ON public.income_entries FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = income_entries.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = income_entries.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can update income entries for their company" ON public.income_entries FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = income_entries.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = income_entries.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can delete income entries for their company" ON public.income_entries FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = income_entries.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = income_entries.company_id AND owner_id = auth.uid())
);

-- 3. FIX PRODUCTION_RECORDS POLICIES
DROP POLICY IF EXISTS "Users can view production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON public.production_records;

CREATE POLICY "Users can view production records for their company" ON public.production_records FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = production_records.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = production_records.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can insert production records for their company" ON public.production_records FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = production_records.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = production_records.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can update production records for their company" ON public.production_records FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = production_records.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = production_records.company_id AND owner_id = auth.uid())
);
CREATE POLICY "Users can delete production records for their company" ON public.production_records FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.company_members WHERE company_id = production_records.company_id AND user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.companies WHERE id = production_records.company_id AND owner_id = auth.uid())
);
