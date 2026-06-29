CREATE OR REPLACE FUNCTION public.validate_field_total_hectares()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_assigned_hectares numeric(12,2);
  v_tolerance constant numeric(12,2) := 0.01;
BEGIN
  IF NEW.total_hectares IS NULL THEN
    RAISE EXCEPTION 'fields.total_hectares es obligatorio';
  END IF;

  IF NEW.total_hectares < 0 THEN
    RAISE EXCEPTION 'fields.total_hectares no puede ser negativo';
  END IF;

  SELECT COALESCE(SUM(s.hectares), 0)
  INTO v_assigned_hectares
  FROM public.sectors s
  WHERE s.field_id = NEW.id;

  IF v_assigned_hectares > NEW.total_hectares + v_tolerance THEN
    RAISE EXCEPTION
      'fields.total_hectares no puede quedar bajo la suma de sectores (campo=% ha, sectores=% ha)',
      NEW.total_hectares,
      v_assigned_hectares;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_field_total_hectares ON public.fields;
CREATE TRIGGER trg_validate_field_total_hectares
BEFORE INSERT OR UPDATE ON public.fields
FOR EACH ROW
EXECUTE FUNCTION public.validate_field_total_hectares();


CREATE OR REPLACE FUNCTION public.validate_sector_hectares_with_field()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_field_total_hectares numeric(12,2);
  v_other_sectors_hectares numeric(12,2);
  v_projected_total numeric(12,2);
  v_tolerance constant numeric(12,2) := 0.01;
BEGIN
  IF NEW.field_id IS NULL THEN
    RAISE EXCEPTION 'sectors.field_id es obligatorio';
  END IF;

  IF NEW.hectares IS NULL THEN
    RAISE EXCEPTION 'sectors.hectares es obligatorio';
  END IF;

  IF NEW.hectares < 0 THEN
    RAISE EXCEPTION 'sectors.hectares no puede ser negativo';
  END IF;

  SELECT f.total_hectares
  INTO v_field_total_hectares
  FROM public.fields f
  WHERE f.id = NEW.field_id;

  IF v_field_total_hectares IS NULL THEN
    RAISE EXCEPTION 'sectors.field_id no existe';
  END IF;

  SELECT COALESCE(SUM(s.hectares), 0)
  INTO v_other_sectors_hectares
  FROM public.sectors s
  WHERE s.field_id = NEW.field_id
    AND (TG_OP <> 'UPDATE' OR s.id <> NEW.id);

  v_projected_total := v_other_sectors_hectares + NEW.hectares;

  IF v_projected_total > v_field_total_hectares + v_tolerance THEN
    RAISE EXCEPTION
      'La suma de hectáreas de sectores no puede superar el campo (campo=% ha, sectores proyectados=% ha)',
      v_field_total_hectares,
      v_projected_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sector_hectares_with_field ON public.sectors;
CREATE TRIGGER trg_validate_sector_hectares_with_field
BEFORE INSERT OR UPDATE ON public.sectors
FOR EACH ROW
EXECUTE FUNCTION public.validate_sector_hectares_with_field();
