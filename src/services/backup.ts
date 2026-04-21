import { utils, writeFile } from 'xlsx';
import { supabase } from '../supabase/client';

type CompanyRef = {
  id: string;
  name: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function downloadCompanyBackup(company: CompanyRef) {
  const wb = utils.book_new();

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*')
    .eq('company_id', company.id);
  if (productsError) throw new Error(getErrorMessage(productsError));
  if (products && products.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(products), 'Bodega_Inventario');
  }

  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('*, sectors(*)')
    .eq('company_id', company.id);
  if (fieldsError) throw new Error(getErrorMessage(fieldsError));
  if (fields && fields.length > 0) {
    const flatSectors = fields.flatMap((f: any) =>
      (f.sectors || []).map((s: any) => ({
        Campo: f.name,
        Sector: s.name,
        Hectareas: s.hectares
      }))
    );
    utils.book_append_sheet(wb, utils.json_to_sheet(flatSectors), 'Campos_Sectores');
  }

  const { data: invoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('company_id', company.id);
  if (invoicesError) throw new Error(getErrorMessage(invoicesError));
  if (invoices && invoices.length > 0) {
    const flatInvoices = invoices.map((inv: any) => ({
      Numero: inv.invoice_number,
      Proveedor: inv.supplier,
      Fecha: inv.invoice_date,
      Total: inv.total_amount,
      Estado: inv.status,
      Items: inv.invoice_items?.length || 0
    }));
    utils.book_append_sheet(wb, utils.json_to_sheet(flatInvoices), 'Facturas_Resumen');
  }

  if (fields && fields.length > 0) {
    const fieldIds = fields.map((f: any) => f.id);
    const { data: apps, error: appsError } = await supabase
      .from('applications')
      .select('*')
      .in('field_id', fieldIds);
    if (appsError) throw new Error(getErrorMessage(appsError));
    if (apps && apps.length > 0) {
      utils.book_append_sheet(wb, utils.json_to_sheet(apps), 'Aplicaciones');
    }
  }

  const { data: incomes, error: incomesError } = await supabase
    .from('income_entries')
    .select('*')
    .eq('company_id', company.id);
  if (incomesError) throw new Error(getErrorMessage(incomesError));
  if (incomes && incomes.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(incomes), 'Liquidaciones');
  }

  const { data: machines, error: machinesError } = await supabase
    .from('machines')
    .select('*')
    .eq('company_id', company.id);
  if (machinesError) throw new Error(getErrorMessage(machinesError));
  if (machines && machines.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(machines), 'Maquinaria');
  }

  const { data: workers, error: workersError } = await supabase
    .from('workers')
    .select('*')
    .eq('company_id', company.id);
  if (workersError) throw new Error(getErrorMessage(workersError));
  if (workers && workers.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(workers), 'Trabajadores');
  }

  const dateStr = new Date().toISOString().split('T')[0];
  writeFile(wb, `Respaldo_AgroCostos_${company.name.replace(/\s+/g, '_')}_${dateStr}.xlsx`);
}
