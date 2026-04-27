DO $$
DECLARE
  r record;
  excluded_tables text[] := ARRAY[
    'system_admin_emails'
  ];
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    IF r.tablename = ANY(excluded_tables) THEN
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', r.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', r.tablename);
  END LOOP;

  FOR r IN
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM authenticated', r.sequencename);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO authenticated', r.sequencename);
  END LOOP;
END $$;

