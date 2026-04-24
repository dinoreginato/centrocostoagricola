ALTER TABLE public.inventory_movements
ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;

ALTER TABLE public.inventory_movements
ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.inventory_movements
ADD COLUMN IF NOT EXISTS prev_stock numeric;

ALTER TABLE public.inventory_movements
ADD COLUMN IF NOT EXISTS prev_average_cost numeric;

ALTER TABLE public.inventory_movements
ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE OR REPLACE FUNCTION apply_manual_inventory_movement(
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_prev_stock numeric;
  v_prev_avg numeric;
  v_new_stock numeric;
  v_new_avg numeric;
  v_unit_cost numeric;
  v_movement_id uuid;
BEGIN
  SELECT company_id, current_stock, average_cost
  INTO v_company_id, v_prev_stock, v_prev_avg
  FROM public.products
  WHERE id = p_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  v_prev_stock := COALESCE(v_prev_stock, 0);
  v_prev_avg := COALESCE(v_prev_avg, 0);

  IF p_movement_type = 'entrada' THEN
    IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
      RAISE EXCEPTION 'Costo unitario inválido';
    END IF;
    v_unit_cost := p_unit_cost;
    v_new_stock := v_prev_stock + p_quantity;
    v_new_avg := CASE
      WHEN v_new_stock > 0 THEN ((v_prev_stock * v_prev_avg) + (p_quantity * v_unit_cost)) / v_new_stock
      ELSE 0
    END;
  ELSIF p_movement_type = 'salida' THEN
    v_unit_cost := v_prev_avg;
    v_new_stock := v_prev_stock - p_quantity;
    IF v_new_stock < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente';
    END IF;
    v_new_avg := v_prev_avg;
  ELSE
    RAISE EXCEPTION 'Tipo de movimiento inválido';
  END IF;

  INSERT INTO public.inventory_movements (
    product_id,
    invoice_item_id,
    application_item_id,
    movement_type,
    quantity,
    unit_cost,
    manual,
    notes,
    prev_stock,
    prev_average_cost,
    created_by
  ) VALUES (
    p_product_id,
    NULL,
    NULL,
    p_movement_type,
    p_quantity,
    v_unit_cost,
    true,
    p_notes,
    v_prev_stock,
    v_prev_avg,
    auth.uid()
  ) RETURNING id INTO v_movement_id;

  UPDATE public.products
  SET
    current_stock = v_new_stock,
    average_cost = v_new_avg,
    updated_at = now()
  WHERE id = p_product_id;

  RETURN v_movement_id;
END;
$$;

CREATE OR REPLACE FUNCTION revert_manual_inventory_movement(
  p_movement_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_product_id uuid;
  v_prev_stock numeric;
  v_prev_avg numeric;
  v_latest_id uuid;
BEGIN
  SELECT im.product_id, im.prev_stock, im.prev_average_cost, p.company_id
  INTO v_product_id, v_prev_stock, v_prev_avg, v_company_id
  FROM public.inventory_movements im
  JOIN public.products p ON p.id = im.product_id
  WHERE im.id = p_movement_id
  AND im.manual = true
  AND im.invoice_item_id IS NULL
  AND im.application_item_id IS NULL;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Movimiento no elegible para reversa';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT id INTO v_latest_id
  FROM public.inventory_movements
  WHERE product_id = v_product_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_id IS DISTINCT FROM p_movement_id THEN
    RAISE EXCEPTION 'Solo se puede revertir el último movimiento del producto';
  END IF;

  UPDATE public.products
  SET
    current_stock = COALESCE(v_prev_stock, 0),
    average_cost = COALESCE(v_prev_avg, 0),
    updated_at = now()
  WHERE id = v_product_id;

  DELETE FROM public.inventory_movements WHERE id = p_movement_id;
END;
$$;
