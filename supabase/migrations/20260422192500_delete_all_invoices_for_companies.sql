CREATE OR REPLACE FUNCTION public.delete_all_invoices_for_companies(company_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF company_ids IS NULL OR array_length(company_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.invoice_items
  WHERE invoice_id IN (
    SELECT id FROM public.invoices WHERE company_id = ANY(company_ids)
  );

  DELETE FROM public.invoices
  WHERE company_id = ANY(company_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_all_invoices_for_companies(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_all_invoices_for_companies(uuid[]) TO authenticated;

