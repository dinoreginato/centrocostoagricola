import { supabase } from '../supabase/client';

export type InvoiceProduct = {
  id: string;
  name: string;
  unit: string;
  category: string;
  active_ingredient?: string | null;
};

export type InvoiceMachineOption = { id: string; name: string };

export type InvoiceDestinationOption = {
  id: string;
  name: string;
  type: 'sector' | 'field' | 'company';
  hectares?: number;
  field_id?: string;
};

export type InvoiceListRow = {
  id: string;
  invoice_number: string;
  supplier: string;
  supplier_rut?: string | null;
  invoice_date: string;
  payment_date?: string | null;
  total_amount: number;
  status: string;
  due_date?: string | null;
  notes?: string | null;
  document_type?: string | null;
  tax_percentage?: number | null;
  discount_amount?: number | null;
  exempt_amount?: number | null;
  special_tax_amount?: number | null;
  invoice_items?: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    category: string;
    product_id: string;
    products?: { id: string; name: string; unit: string } | { id: string; name: string; unit: string }[] | null;
  }>;
};

export async function fetchInvoiceSuppliers(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('invoices')
    .select('supplier')
    .eq('company_id', params.companyId)
    .not('supplier', 'is', null);

  if (error) throw error;
  const suppliers = Array.from(new Set((data || []).map((i: any) => i.supplier).filter(Boolean)));
  return suppliers as string[];
}

export async function fetchInvoiceProducts(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, unit, category, active_ingredient')
    .eq('company_id', params.companyId);

  if (error) throw error;
  return (data || []) as InvoiceProduct[];
}

export async function fetchInvoicesForCompany(params: { companyId: string; status?: string }) {
  let query = supabase
    .from('invoices')
    .select(`
      id, invoice_number, supplier, supplier_rut, invoice_date, payment_date, total_amount, status, due_date, notes, document_type,
      tax_percentage, discount_amount, exempt_amount, special_tax_amount,
      invoice_items (
        id, quantity, unit_price, total_price, category, product_id,
        products (id, name, unit)
      )
    `)
    .eq('company_id', params.companyId)
    .order('invoice_date', { ascending: false });

  if (params.status && params.status !== 'Todas') {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []) as unknown as InvoiceListRow[];
}

export async function fetchInvoiceDestinations(params: { companyId: string; companyName: string }) {
  const { data: mData, error: mError } = await supabase
    .from('machines')
    .select('id, name, brand, model')
    .eq('company_id', params.companyId);

  if (mError) throw mError;

  const machines = (mData || []).map((m: any) => ({
    id: m.id,
    name: `${m.name} (${m.brand} ${m.model})`
  })) as InvoiceMachineOption[];

  const { data: fieldsData, error: fError } = await supabase
    .from('fields')
    .select('id, name')
    .eq('company_id', params.companyId);

  if (fError) throw fError;

  if (!fieldsData || fieldsData.length === 0) {
    return {
      machines,
      destinations: [
        {
          id: 'company_general',
          name: `🏢 [EMPRESA] ${params.companyName}`,
          type: 'company'
        }
      ] satisfies InvoiceDestinationOption[]
    };
  }

  const fieldIds = fieldsData.map((f: any) => f.id);

  const { data: sectorsData, error: sError } = await supabase
    .from('sectors')
    .select('id, name, field_id, hectares')
    .in('field_id', fieldIds);

  if (sError) throw sError;

  const destinations: InvoiceDestinationOption[] = [
    { id: 'company_general', name: `🏢 [EMPRESA] ${params.companyName}`, type: 'company' }
  ];

  fieldsData.forEach((f: any) => {
    destinations.push({ id: f.id, name: `🌱 [CAMPO] ${f.name}`, type: 'field' });
  });

  const sectorsWithField = (sectorsData || []).map((s: any) => {
    const field = fieldsData.find((f: any) => f.id === s.field_id);
    return { ...s, fieldName: field?.name || '' };
  });

  sectorsWithField.sort((a: any, b: any) => {
    const fieldCompare = String(a.fieldName).localeCompare(String(b.fieldName));
    if (fieldCompare !== 0) return fieldCompare;
    return String(a.name).localeCompare(String(b.name));
  });

  sectorsWithField.forEach((s: any) => {
    destinations.push({
      id: s.id,
      name: `└── ${s.name}`,
      type: 'sector',
      hectares: s.hectares,
      field_id: s.field_id
    });
  });

  return { machines, destinations };
}

export async function markInvoiceAsPaid(params: { invoiceId: string; paymentDate: string }) {
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'Pagada', payment_date: params.paymentDate })
    .eq('id', params.invoiceId);

  if (error) throw error;
}
