CREATE OR REPLACE FUNCTION public.force_clean_all_applications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_record record;
  item_record record;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR app_record IN SELECT id FROM public.applications LOOP
    FOR item_record IN
      SELECT product_id, quantity_used
      FROM public.application_items
      WHERE application_id = app_record.id
    LOOP
      UPDATE public.products
      SET current_stock = current_stock + item_record.quantity_used,
          updated_at = now()
      WHERE id = item_record.product_id;
    END LOOP;

    DELETE FROM public.inventory_movements
    WHERE application_item_id IN (
      SELECT id FROM public.application_items WHERE application_id = app_record.id
    );
  END LOOP;

  DELETE FROM public.applications;
END;
$$;

REVOKE ALL ON FUNCTION public.force_clean_all_applications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_clean_all_applications() TO authenticated;

