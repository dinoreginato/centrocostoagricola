import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';

type ReportFieldRow = {
  id: string;
  name: string;
  sectors?: Array<{ id: string; name?: string; hectares?: number }>;
};

type ReportApplicationRow = {
  field_id: string;
  sector_id: string;
  total_cost: number;
  application_date: string;
};

type ReportInvoiceRow = {
  invoice_date?: string | null;
  [key: string]: any;
};

export async function loadReportsRawData(params: { companyId: string }) {
  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('id, name, sectors(id, name, hectares)')
    .eq('company_id', params.companyId);

  if (fieldsError) throw fieldsError;

  const typedFields = (fields || []) as unknown as ReportFieldRow[];
  const fieldIds = typedFields.map((f) => f.id);
  const sectorIds = typedFields.flatMap((f) => (f.sectors || []).map((s) => s.id));

  const emptyOk = Promise.resolve({ data: [], error: null } as { data: any[]; error: any });

  const [
    applicationsRes,
    laborRes,
    workerCostsRes,
    fuelRes,
    fuelConsRes,
    machineryRes,
    irrigationRes,
    generalCostsRes,
    incomeRes,
    invoicesRes,
    productsRes
  ] = await Promise.all([
    fieldIds.length
      ? supabase.from('applications').select('field_id, sector_id, total_cost, application_date').in('field_id', fieldIds)
      : emptyOk,
    sectorIds.length
      ? supabase.from('labor_assignments').select('sector_id, assigned_amount, assigned_date, labor_type').in('sector_id', sectorIds)
      : emptyOk,
    sectorIds.length ? supabase.from('worker_costs').select('sector_id, amount, date').in('sector_id', sectorIds) : emptyOk,
    sectorIds.length
      ? supabase.from('fuel_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds)
      : emptyOk,
    supabase
      .from('fuel_consumption')
      .select('sector_id, estimated_price, date, activity, liters, machine_id, machine:machines(name, type)')
      .eq('company_id', params.companyId),
    sectorIds.length
      ? supabase.from('machinery_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds)
      : emptyOk,
    sectorIds.length
      ? supabase.from('irrigation_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds)
      : emptyOk,
    sectorIds.length ? supabase.from('general_costs').select('sector_id, amount, date').in('sector_id', sectorIds) : emptyOk,
    supabase.from('income_entries').select('*, fields(name), sectors(name)').eq('company_id', params.companyId),
    supabase
      .from('invoices')
      .select(
        `
        id, invoice_number, invoice_date, total_amount, supplier, status, due_date, document_type, notes,
        tax_percentage, discount_amount, exempt_amount, special_tax_amount,
        invoice_items (
          id, category, total_price, quantity,
          products (name, unit, category)
        )
      `
      )
      .eq('company_id', params.companyId),
    supabase
      .from('products')
      .select('id, name, unit, category, current_stock, minimum_stock, average_cost')
      .eq('company_id', params.companyId)
      .neq('category', 'Archivado')
  ]);

  if (invoicesRes.error) throw invoicesRes.error;

  const warnings: any[] = [];
  const safeData = <T,>(res: { data: any; error: any }) => {
    if (res.error) {
      warnings.push(res.error);
      return [] as unknown as T[];
    }
    return (res.data || []) as unknown as T[];
  };

  const applications = safeData<ReportApplicationRow>(applicationsRes as any);
  const invoices = (invoicesRes.data || []) as unknown as ReportInvoiceRow[];
  const labor = safeData<any>(laborRes as any);
  const workerCosts = safeData<any>(workerCostsRes as any);
  const fuel = safeData<any>(fuelRes as any);
  const fuelConsumption = safeData<any>(fuelConsRes as any);
  const machinery = safeData<any>(machineryRes as any);
  const irrigation = safeData<any>(irrigationRes as any);
  const generalCosts = safeData<any>(generalCostsRes as any);
  const incomeEntries = safeData<any>(incomeRes as any);
  const products = safeData<any>(productsRes as any);

  const seasonsSet = new Set<string>();
  seasonsSet.add(getSeasonFromDate(new Date()));

  applications.forEach((app) => {
    if (app.application_date) seasonsSet.add(getSeasonFromDate(new Date(app.application_date)));
  });

  invoices.forEach((inv) => {
    if (inv.invoice_date) seasonsSet.add(getSeasonFromDate(new Date(inv.invoice_date)));
  });

  const availableSeasons = Array.from(seasonsSet).sort().reverse();

  return {
    fields: typedFields,
    applications,
    labor,
    workerCosts,
    fuel,
    fuelConsumption,
    machinery,
    irrigation,
    generalCosts,
    incomeEntries,
    invoices,
    products,
    availableSeasons,
    warnings: warnings.map((w) => w?.message || String(w))
  };
}
