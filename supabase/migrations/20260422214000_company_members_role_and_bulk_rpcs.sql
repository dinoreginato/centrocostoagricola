CREATE OR REPLACE FUNCTION public.update_company_member_role(
  p_company_id uuid,
  p_member_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_role := lower(btrim(p_role));
  IF v_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Rol inválido';
  END IF;

  SELECT user_id
  INTO v_user_id
  FROM public.company_members
  WHERE id = p_member_id
    AND company_id = p_company_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Miembro no encontrado';
  END IF;

  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;

  UPDATE public.company_members
  SET role = v_role
  WHERE id = p_member_id
    AND company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_company_member_role(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_company_member_role(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_company_members(
  p_company_id uuid,
  p_member_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_member_ids IS NULL OR array_length(p_member_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.company_members
    WHERE company_id = p_company_id
      AND id = ANY(p_member_ids)
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'No puedes eliminar tu propio acceso';
  END IF;

  DELETE FROM public.company_members
  WHERE company_id = p_company_id
    AND id = ANY(p_member_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_company_members(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_company_members(uuid, uuid[]) TO authenticated;

