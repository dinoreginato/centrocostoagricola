REVOKE ALL ON FUNCTION public.create_application_inventory(
  uuid,
  uuid,
  date,
  text,
  numeric,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_application_inventory(
  uuid,
  uuid,
  date,
  text,
  numeric,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_application_inventory(
  uuid,
  uuid,
  uuid,
  date,
  text,
  numeric,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_application_inventory(
  uuid,
  uuid,
  uuid,
  date,
  text,
  numeric,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_invoice_item_with_effects(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_item_with_effects(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_invoice_item_with_effects(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  boolean,
  boolean,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_invoice_item_with_effects(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  boolean,
  boolean,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_invoice_items_with_effects(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_invoice_items_with_effects(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_invoice_force(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_invoice_force(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_invoice_header(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_invoice_header(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  date
) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_manual_inventory_movement(
  uuid,
  text,
  numeric,
  numeric,
  text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_manual_inventory_movement(
  uuid,
  text,
  numeric,
  numeric,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.revert_manual_inventory_movement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_manual_inventory_movement(uuid) TO authenticated;

