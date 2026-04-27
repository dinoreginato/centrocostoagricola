REVOKE ALL ON FUNCTION public.apply_manual_inventory_movement(uuid, text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_manual_inventory_movement(uuid, text, numeric, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.revert_manual_inventory_movement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_manual_inventory_movement(uuid) TO authenticated;

