CREATE OR REPLACE FUNCTION public.validate_agricultural_income_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_field_company_id uuid;
  v_sector_field_id uuid;
  v_sector_company_id uuid;
  v_derived_season text;
BEGIN
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'income_entries requiere company_id';
  END IF;

  IF NEW.date IS NULL THEN
    RAISE EXCEPTION 'income_entries requiere fecha';
  END IF;

  IF COALESCE(NEW.amount, 0) < 0 THEN
    RAISE EXCEPTION 'income_entries.amount no puede ser negativo';
  END IF;

  IF COALESCE(NEW.quantity_kg, 0) < 0 THEN
    RAISE EXCEPTION 'income_entries.quantity_kg no puede ser negativo';
  END IF;

  IF COALESCE(NEW.amount_usd, 0) < 0 THEN
    RAISE EXCEPTION 'income_entries.amount_usd no puede ser negativo';
  END IF;

  IF COALESCE(NEW.price_per_kg, 0) < 0 THEN
    RAISE EXCEPTION 'income_entries.price_per_kg no puede ser negativo';
  END IF;

  IF COALESCE(NEW.price_clp_per_kg, 0) < 0 THEN
    RAISE EXCEPTION 'income_entries.price_clp_per_kg no puede ser negativo';
  END IF;

  IF COALESCE(NEW.export_percentage, 0) < 0 OR COALESCE(NEW.export_percentage, 0) > 100 THEN
    RAISE EXCEPTION 'income_entries.export_percentage debe estar entre 0 y 100';
  END IF;

  v_derived_season := public.agricultural_season_from_date(NEW.date);

  IF NEW.season IS NULL OR btrim(NEW.season) = '' THEN
    NEW.season := v_derived_season;
  ELSIF NEW.season <> v_derived_season THEN
    RAISE EXCEPTION 'income_entries.season no coincide con la fecha % y la temporada agricola %', NEW.date, v_derived_season;
  END IF;

  IF NEW.field_id IS NOT NULL THEN
    SELECT f.company_id
    INTO v_field_company_id
    FROM public.fields f
    WHERE f.id = NEW.field_id;

    IF v_field_company_id IS NULL THEN
      RAISE EXCEPTION 'income_entries.field_id no existe';
    END IF;

    IF v_field_company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'income_entries.field_id no pertenece a la empresa indicada';
    END IF;
  END IF;

  IF NEW.sector_id IS NOT NULL THEN
    SELECT s.field_id, f.company_id
    INTO v_sector_field_id, v_sector_company_id
    FROM public.sectors s
    JOIN public.fields f ON f.id = s.field_id
    WHERE s.id = NEW.sector_id;

    IF v_sector_field_id IS NULL THEN
      RAISE EXCEPTION 'income_entries.sector_id no existe';
    END IF;

    IF v_sector_company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'income_entries.sector_id no pertenece a la empresa indicada';
    END IF;

    IF NEW.field_id IS NULL THEN
      NEW.field_id := v_sector_field_id;
    ELSIF NEW.field_id <> v_sector_field_id THEN
      RAISE EXCEPTION 'income_entries.field_id no coincide con el campo del sector seleccionado';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_agricultural_income_entry ON public.income_entries;
CREATE TRIGGER trg_validate_agricultural_income_entry
BEFORE INSERT OR UPDATE ON public.income_entries
FOR EACH ROW
EXECUTE FUNCTION public.validate_agricultural_income_entry();


CREATE OR REPLACE FUNCTION public.validate_agricultural_production_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_sector_company_id uuid;
  v_current_year integer := EXTRACT(YEAR FROM now())::int;
BEGIN
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'production_records requiere company_id';
  END IF;

  IF NEW.sector_id IS NULL THEN
    RAISE EXCEPTION 'production_records requiere sector_id';
  END IF;

  SELECT f.company_id
  INTO v_sector_company_id
  FROM public.sectors s
  JOIN public.fields f ON f.id = s.field_id
  WHERE s.id = NEW.sector_id;

  IF v_sector_company_id IS NULL THEN
    RAISE EXCEPTION 'production_records.sector_id no existe';
  END IF;

  IF v_sector_company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'production_records.sector_id no pertenece a la empresa indicada';
  END IF;

  IF NEW.season_year IS NULL OR NEW.season_year < 2000 OR NEW.season_year > v_current_year + 2 THEN
    RAISE EXCEPTION 'production_records.season_year esta fuera del rango permitido';
  END IF;

  IF COALESCE(NEW.kg_produced, 0) < 0 THEN
    RAISE EXCEPTION 'production_records.kg_produced no puede ser negativo';
  END IF;

  IF COALESCE(NEW.price_per_kg, 0) < 0 THEN
    RAISE EXCEPTION 'production_records.price_per_kg no puede ser negativo';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_agricultural_production_record ON public.production_records;
CREATE TRIGGER trg_validate_agricultural_production_record
BEFORE INSERT OR UPDATE ON public.production_records
FOR EACH ROW
EXECUTE FUNCTION public.validate_agricultural_production_record();
