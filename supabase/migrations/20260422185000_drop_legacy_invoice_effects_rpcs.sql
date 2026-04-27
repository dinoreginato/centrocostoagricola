DROP FUNCTION IF EXISTS public.create_invoice_item_with_effects(
  uuid,
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
);

DROP FUNCTION IF EXISTS public.update_invoice_item_with_effects(
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
  jsonb
);

