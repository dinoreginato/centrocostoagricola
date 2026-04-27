DO $$
BEGIN
  IF to_regclass('public.company_members') IS NULL THEN
    RETURN;
  END IF;

  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY company_id, user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.company_members
  )
  DELETE FROM public.company_members cm
  USING ranked r
  WHERE cm.id = r.id
    AND r.rn > 1;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_members_company_id_user_id_key'
  ) THEN
    ALTER TABLE public.company_members
    ADD CONSTRAINT company_members_company_id_user_id_key UNIQUE (company_id, user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_company_member_by_email(
  p_company_id uuid,
  p_email text,
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

  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(p_email));

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado. Debe estar registrado.';
  END IF;

  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (p_company_id, v_user_id, v_role)
  ON CONFLICT (company_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_company_member_by_email(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_company_member_by_email(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_company_member(
  p_company_id uuid,
  p_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
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
    RAISE EXCEPTION 'No puedes eliminar tu propio acceso';
  END IF;

  DELETE FROM public.company_members
  WHERE id = p_member_id
    AND company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_company_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_company_member(uuid, uuid) TO authenticated;

