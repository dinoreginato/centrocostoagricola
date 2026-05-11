import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';

async function fetchAllPages<T>(
  queryFactory: (from: number, to: number) => any,
  params?: { pageSize?: number; maxRows?: number }
): Promise<T[]> {
  const pageSize = params?.pageSize ?? 5000;
  const maxRows = params?.maxRows ?? 100000;
  let from = 0;
  const out: T[] = [];

  while (true) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw error;
    (data || []).forEach((r: any) => out.push(r as T));
    if (!data || data.length < pageSize) break;
    from += pageSize;
    if (from >= maxRows) break;
  }

  return out;
}

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

type ReportApplicationItemRow = {
  application_id: string;
  total_cost: number;
  applications: { id: string; sector_id: string; application_date: string } | { id: string; sector_id: string; application_date: string }[];
  products?: { name: string | null; category: string | null; unit: string | null } | { name: string | null; category: string | null; unit: string | null }[] | null;
};

type ReportInvoiceRow = {
  invoice_date?: string | null;
  [key: string]: any;
};

async function fetchFuelConsumptionAll(params: { companyId: string }) {
  try {
    return await fetchAllPages<any>((from, to) =>
      supabase
        .from('fuel_consumption')
        .select('id, application_id, sector_id, estimated_price, date, activity, liters')
        .eq('company_id', params.companyId)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    );
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes('application_id')) {
      return await fetchAllPages<any>((from, to) =>
        supabase
          .from('fuel_consumption')
          .select('id, sector_id, estimated_price, date, activity, liters')
          .eq('company_id', params.companyId)
          .order('date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
      );
    }
    throw e;
  }
}

export async function loadReportsRawData(params: { companyId: string }) {
  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('id, name, fruit_type, sectors(id, name, hectares)')
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
    machineryRes,
    irrigationRes,
    generalCostsRes,
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
    sectorIds.length
      ? supabase.from('machinery_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds)
      : emptyOk,
    sectorIds.length
      ? supabase.from('irrigation_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds)
      : emptyOk,
    sectorIds.length ? supabase.from('general_costs').select('sector_id, amount, date').in('sector_id', sectorIds) : emptyOk,
    supabase
      .from('products')
      .select('id, name, unit, category, current_stock, minimum_stock, average_cost')
      .eq('company_id', params.companyId)
      .neq('category', 'Archivado')
  ]);

  const warnings: any[] = [];
  const safeData = <T,>(res: { data: any; error: any }) => {
    if (res.error) {
      warnings.push(res.error);
      return [] as unknown as T[];
    }
    return (res.data || []) as unknown as T[];
  };

  const [fuelConsumption, incomeEntries, invoices, applicationItems] = await Promise.all([
    fetchFuelConsumptionAll({ companyId: params.companyId }).catch((e) => {
      warnings.push(e);
      return [];
    }),
    fetchAllPages<any>((from, to) =>
      supabase
        .from('income_entries')
        .select('*, fields(name), sectors(name)')
        .eq('company_id', params.companyId)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    ).catch((e) => {
      warnings.push(e);
      return [];
    }),
    fetchAllPages<ReportInvoiceRow>((from, to) =>
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
        .eq('company_id', params.companyId)
        .order('invoice_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    ),
    fetchAllPages<ReportApplicationItemRow>((from, to) =>
      supabase
        .from('application_items')
        .select(
          `
          application_id,
          total_cost,
          applications!inner(id, sector_id, application_date),
          products (name, category, unit)
        `
        )
        .in('applications.sector_id', sectorIds)
        .order('application_id', { ascending: false })
        .range(from, to)
    ).catch((e) => {
      warnings.push(e);
      return [];
    })
  ]);

  const applications = safeData<ReportApplicationRow>(applicationsRes as any);
  const labor = safeData<any>(laborRes as any);
  const workerCosts = safeData<any>(workerCostsRes as any);
  const fuel = safeData<any>(fuelRes as any);
  const machinery = safeData<any>(machineryRes as any);
  const irrigation = safeData<any>(irrigationRes as any);
  const generalCosts = safeData<any>(generalCostsRes as any);
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
    applicationItems,
    products,
    availableSeasons,
    warnings: warnings.map((w) => w?.message || String(w))
  };
}
