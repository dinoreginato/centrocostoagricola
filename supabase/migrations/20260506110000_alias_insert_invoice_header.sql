CREATE OR REPLACE FUNCTION public.insert_invoice_header(
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
SET search_path = public
AS $$
BEGIN
  RETURN public.upsert_invoice_header(
    p_invoice_id,
    p_company_id,
    p_invoice_number,
    p_supplier,
    p_supplier_rut,
    p_invoice_date,
    p_due_date,
    p_status,
    p_notes,
    p_document_type,
    p_tax_percentage,
    p_discount_amount,
    p_exempt_amount,
    p_special_tax_amount,
    p_total_amount,
    p_payment_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.insert_invoice_header(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_invoice_header(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  date
) TO authenticated;
