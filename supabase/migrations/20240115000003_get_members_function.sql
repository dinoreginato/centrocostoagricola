
-- Function to get company members with emails
CREATE OR REPLACE FUNCTION public.get_company_members(company_id_input UUID)
RETURNS TABLE (
  member_id UUID,
  user_id UUID,
  email VARCHAR,
  role VARCHAR,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = company_id_input AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.company_members WHERE company_id = company_id_input AND user_id = auth.uid() AND role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT 
    cm.id as member_id,
    cm.user_id,
    au.email::VARCHAR,
    cm.role,
    cm.created_at
  FROM public.company_members cm
  JOIN auth.users au ON cm.user_id = au.id
  WHERE cm.company_id = company_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_company_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_members(uuid) TO authenticated;
