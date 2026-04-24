CREATE OR REPLACE FUNCTION upsert_invoice_header(
  p_invoice_id uuid DEFAULT NULL,
  p_company_id uuid,
  p_invoice_number text,
  p_supplier text,
  p_supplier_rut text DEFAULT NULL,
  p_invoice_date date,
  p_due_date date DEFAULT NULL,
  p_status text DEFAULT 'Pendiente',
  p_notes text DEFAULT NULL,
  p_document_type text DEFAULT 'Factura',
  p_tax_percentage numeric DEFAULT 19,
  p_discount_amount numeric DEFAULT 0,
  p_exempt_amount numeric DEFAULT 0,
  p_special_tax_amount numeric DEFAULT 0,
  p_total_amount numeric DEFAULT 0,
  p_payment_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_id uuid;
  v_tax numeric;
  v_supplier text;
  v_invoice_number text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id requerido';
  END IF;

  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_supplier := btrim(COALESCE(p_supplier, ''));
  v_invoice_number := btrim(COALESCE(p_invoice_number, ''));

  IF v_supplier = '' OR v_invoice_number = '' THEN
    RAISE EXCEPTION 'supplier e invoice_number requeridos';
  END IF;

  IF p_document_type ILIKE '%exenta%' THEN
    v_tax := 0;
  ELSE
    v_tax := COALESCE(p_tax_percentage, 19);
  END IF;

  IF p_invoice_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.company_id = p_company_id
      AND i.invoice_number = v_invoice_number
      AND lower(i.supplier) = lower(v_supplier)
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_INVOICE';
    END IF;

    INSERT INTO public.invoices (
      company_id,
      invoice_number,
      supplier,
      supplier_rut,
      invoice_date,
      due_date,
      status,
      notes,
      document_type,
      tax_percentage,
      discount_amount,
      exempt_amount,
      special_tax_amount,
      total_amount,
      payment_date,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      v_invoice_number,
      v_supplier,
      NULLIF(btrim(COALESCE(p_supplier_rut, '')), ''),
      p_invoice_date,
      p_due_date,
      COALESCE(p_status, 'Pendiente'),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      COALESCE(p_document_type, 'Factura'),
      v_tax,
      COALESCE(p_discount_amount, 0),
      COALESCE(p_exempt_amount, 0),
      COALESCE(p_special_tax_amount, 0),
      COALESCE(p_total_amount, 0),
      p_payment_date,
      now(),
      now()
    ) RETURNING id INTO v_invoice_id;

    RETURN v_invoice_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.company_id = p_company_id
    AND i.invoice_number = v_invoice_number
    AND lower(i.supplier) = lower(v_supplier)
    AND i.id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_INVOICE';
  END IF;

  UPDATE public.invoices
  SET
    invoice_number = v_invoice_number,
    supplier = v_supplier,
    supplier_rut = NULLIF(btrim(COALESCE(p_supplier_rut, '')), ''),
    invoice_date = p_invoice_date,
    due_date = p_due_date,
    status = COALESCE(p_status, status),
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    document_type = COALESCE(p_document_type, document_type),
    tax_percentage = v_tax,
    discount_amount = COALESCE(p_discount_amount, 0),
    exempt_amount = COALESCE(p_exempt_amount, 0),
    special_tax_amount = COALESCE(p_special_tax_amount, 0),
    total_amount = COALESCE(p_total_amount, 0),
    payment_date = p_payment_date,
    updated_at = now()
  WHERE id = p_invoice_id
  AND company_id = p_company_id;

  RETURN p_invoice_id;
END;
$$;

