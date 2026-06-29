DO $$
BEGIN
  IF to_regclass('public.v_agricultural_margin') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.v_agricultural_margin FROM PUBLIC;
    GRANT SELECT ON TABLE public.v_agricultural_margin TO authenticated;
  END IF;
END;
$$;
