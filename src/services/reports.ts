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
  invoice_date: string;
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
    supabase.from('applications').select('field_id, sector_id, total_cost, application_date').in('field_id', fieldIds),
    supabase.from('labor_assignments').select('sector_id, assigned_amount, assigned_date, labor_type').in('sector_id', sectorIds),
    supabase.from('worker_costs').select('sector_id, amount, date').in('sector_id', sectorIds),
    supabase.from('fuel_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds),
    supabase
      .from('fuel_consumption')
      .select('sector_id, estimated_price, date, activity, liters, machine_id, machine:machines(name, type)')
      .eq('company_id', params.companyId),
    supabase.from('machinery_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds),
    supabase.from('irrigation_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds),
    supabase.from('general_costs').select('sector_id, amount, date').in('sector_id', sectorIds),
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

  const errors = [
    applicationsRes.error,
    laborRes.error,
    workerCostsRes.error,
    fuelRes.error,
    fuelConsRes.error,
    machineryRes.error,
    irrigationRes.error,
    generalCostsRes.error,
    incomeRes.error,
    invoicesRes.error,
    productsRes.error
  ].filter(Boolean);

  if (errors.length > 0) throw errors[0];

  const applications = (applicationsRes.data || []) as unknown as ReportApplicationRow[];
  const invoices = (invoicesRes.data || []) as unknown as ReportInvoiceRow[];

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
    labor: laborRes.data || [],
    workerCosts: workerCostsRes.data || [],
    fuel: fuelRes.data || [],
    fuelConsumption: fuelConsRes.data || [],
    machinery: machineryRes.data || [],
    irrigation: irrigationRes.data || [],
    generalCosts: generalCostsRes.data || [],
    incomeEntries: incomeRes.data || [],
    invoices,
    products: productsRes.data || [],
    availableSeasons
  };
}
