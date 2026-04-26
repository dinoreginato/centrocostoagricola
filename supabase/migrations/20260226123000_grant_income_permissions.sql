
-- Grant permissions for income_entries to ensure RLS works for authenticated users
GRANT ALL ON public.income_entries TO authenticated;

-- Just in case, ensure company_members is accessible
GRANT SELECT ON public.company_members TO authenticated;
