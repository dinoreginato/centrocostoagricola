import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';
import { collectAvailableSeasons } from '../lib/agriculturalData';

type ReportFieldRow = {
  id: string;
  name: string;
  fruit_type?: string | null;
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
    .select('id, name, fruit_type, sectors(id, name, hectares)')
    .eq('company_id', params.companyId);

  if (fieldsError) throw fieldsError;

  const typedFields = (fields || []) as unknown as ReportFieldRow[];
  const fieldIds = typedFields.map((f) => f.id);
  const sectorIds = typedFields.flatMap((f) => (f.sectors || []).map((s) => s.id));

  const emptyResult = {
    fields: typedFields,
    applications: [] as any[],
    labor: [] as any[],
    workerCosts: [] as any[],
    fuel: [] as any[],
    fuelConsumption: [] as any[],
    machinery: [] as any[],
    irrigation: [] as any[],
    generalCosts: [] as any[],
    incomeEntries: [] as any[],
    invoices: [] as any[],
    products: [] as any[],
    availableSeasons: [getSeasonFromDate(new Date())]
  };

  if (fieldIds.length === 0 || sectorIds.length === 0) {
    const [incomeRes, invoicesRes, productsRes, fuelConsRes] = await Promise.all([
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
        .neq('category', 'Archivado'),
      supabase
        .from('fuel_consumption')
        .select('sector_id, estimated_price, date, activity, liters, machine_id, machine:machines(name, type)')
        .eq('company_id', params.companyId)
    ]);

    const lightweightErrors = [incomeRes.error, invoicesRes.error, productsRes.error, fuelConsRes.error].filter(Boolean);
    if (lightweightErrors.length > 0) throw lightweightErrors[0];

    const availableSeasons = collectAvailableSeasons([
      { rows: incomeRes.data || [], getDate: (row) => row.date },
      { rows: invoicesRes.data || [], getDate: (row) => row.invoice_date },
      { rows: fuelConsRes.data || [], getDate: (row) => row.date }
    ], getSeasonFromDate(new Date()));

    return {
      ...emptyResult,
      incomeEntries: incomeRes.data || [],
      invoices: invoicesRes.data || [],
      products: productsRes.data || [],
      fuelConsumption: fuelConsRes.data || [],
      availableSeasons
    };
  }

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
  const availableSeasons = collectAvailableSeasons([
    { rows: applications, getDate: (row) => row.application_date },
    { rows: laborRes.data || [], getDate: (row) => row.assigned_date },
    { rows: workerCostsRes.data || [], getDate: (row) => row.date },
    { rows: fuelRes.data || [], getDate: (row) => row.assigned_date },
    { rows: fuelConsRes.data || [], getDate: (row) => row.date },
    { rows: machineryRes.data || [], getDate: (row) => row.assigned_date },
    { rows: irrigationRes.data || [], getDate: (row) => row.assigned_date },
    { rows: generalCostsRes.data || [], getDate: (row) => row.date },
    { rows: incomeRes.data || [], getDate: (row) => row.date },
    { rows: invoices, getDate: (row) => row.invoice_date }
  ], getSeasonFromDate(new Date()));

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
