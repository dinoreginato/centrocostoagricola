import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';
import { collectAvailableSeasons } from '../lib/agriculturalData';
import type { AgriculturalCostMovement } from '../lib/costMovements';

type ReportsWarning = { source: string; message: string };

type ReportFieldRow = {
  id: string;
  name: string;
  fruit_type?: string | null;
  sectors?: Array<{
    id: string;
    name?: string;
    hectares?: number;
    expected_production_kg?: number;
    expected_price_per_kg?: number;
    sector_budget_season_plans?: Array<{
      id: string;
      season: string;
      budget_cost_clp_per_ha?: number;
      budget_cost_usd_per_ha?: number;
      expected_production_kg?: number;
      expected_sale_price_clp_per_kg?: number;
      expected_sale_price_usd_per_kg?: number;
      exchange_rate_reference?: number;
      notes?: string | null;
    }>;
    productive_stage?: string | null;
    production_expected_from_season?: string | null;
    non_productive_reason?: string | null;
    establishment_notes?: string | null;
  }>;
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

type CostMovementViewRow = {
  source_type: string;
  category: string;
  subcategory?: string | null;
  movement_date: string;
  season: string | null;
  field_id?: string | null;
  sector_id?: string | null;
  amount: number;
};

const mapCostMovementViewRow = (row: CostMovementViewRow): AgriculturalCostMovement => ({
  source: row.source_type as AgriculturalCostMovement['source'],
  category: row.category as AgriculturalCostMovement['category'],
  subCategory: row.subcategory || undefined,
  date: row.movement_date,
  season: row.season || null,
  fieldId: row.field_id || null,
  sectorId: row.sector_id || null,
  amount: Number(row.amount || 0)
});

const describeReportsError = (error: any) => {
  const message = String(error?.message || error?.details || error?.hint || error || '');
  const code = String(error?.code || '');
  const status = String(error?.status || error?.statusCode || '');
  const prefix = [status, code].filter(Boolean).join(' ');
  return prefix ? `${prefix}: ${message}` : message;
};

const isMissingSeasonPlansRelationError = (error: any) => {
  const message = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return message.includes('sector_budget_season_plans')
    && (
      message.includes('does not exist')
      || message.includes('could not find')
      || message.includes('relationship')
      || message.includes('schema cache')
      || message.includes('not found')
    );
};

const fieldsSelectWithSeasonPlans = 'id, name, fruit_type, sectors(id, name, hectares, productive_stage, production_expected_from_season, non_productive_reason, establishment_notes, sector_budget_season_plans(id, season, budget_cost_clp_per_ha, budget_cost_usd_per_ha, expected_production_kg, expected_sale_price_clp_per_kg, expected_sale_price_usd_per_kg, exchange_rate_reference, notes))';
const fieldsSelectWithoutSeasonPlans = 'id, name, fruit_type, sectors(id, name, hectares, productive_stage, production_expected_from_season, non_productive_reason, establishment_notes)';
const sectorsSelectWithSeasonPlans = 'id, name, hectares, productive_stage, production_expected_from_season, non_productive_reason, establishment_notes, sector_budget_season_plans(id, season, budget_cost_clp_per_ha, budget_cost_usd_per_ha, expected_production_kg, expected_sale_price_clp_per_kg, expected_sale_price_usd_per_kg, exchange_rate_reference, notes), field_id, fields!inner(company_id)';
const sectorsSelectWithoutSeasonPlans = 'id, name, hectares, productive_stage, production_expected_from_season, non_productive_reason, establishment_notes, field_id, fields!inner(company_id)';

export async function loadReportsRawData(params: { companyId: string }) {
  const warnings: ReportsWarning[] = [];

  let typedFields: ReportFieldRow[] = [];
  const fieldsRes = await supabase
    .from('fields')
    .select(fieldsSelectWithSeasonPlans)
    .eq('company_id', params.companyId);
  let fields = fieldsRes.data as any[] | null;
  let fieldsError: any = fieldsRes.error;

  if (fieldsError && isMissingSeasonPlansRelationError(fieldsError)) {
    const fallbackFieldsRes = await supabase
      .from('fields')
      .select(fieldsSelectWithoutSeasonPlans)
      .eq('company_id', params.companyId);

    fields = fallbackFieldsRes.data;
    fieldsError = fallbackFieldsRes.error;
  }

  if (fieldsError) {
    warnings.push({ source: 'fields', message: describeReportsError(fieldsError) });
    const { data: basicFields, error: basicFieldsError } = await supabase
      .from('fields')
      .select('id, name, fruit_type')
      .eq('company_id', params.companyId);
    if (basicFieldsError) throw basicFieldsError;
    typedFields = (basicFields || []) as unknown as ReportFieldRow[];

    const sectorsRes = await supabase
      .from('sectors')
      .select(sectorsSelectWithSeasonPlans)
      .eq('fields.company_id', params.companyId);
    let sectorsData = sectorsRes.data as any[] | null;
    let sectorsError: any = sectorsRes.error;

    if (sectorsError && isMissingSeasonPlansRelationError(sectorsError)) {
      const fallbackSectorsRes = await supabase
        .from('sectors')
        .select(sectorsSelectWithoutSeasonPlans)
        .eq('fields.company_id', params.companyId);

      sectorsData = fallbackSectorsRes.data;
      sectorsError = fallbackSectorsRes.error;
    }

    if (sectorsError) {
      warnings.push({ source: 'sectors', message: describeReportsError(sectorsError) });
    }

    const sectorByField = new Map<string, ReportFieldRow['sectors']>();
    (sectorsData || []).forEach((row: any) => {
      const fieldId = String(row.field_id || '');
      if (!fieldId) return;
      const current = sectorByField.get(fieldId) || [];
      current.push({
        id: String(row.id),
        name: String(row.name || ''),
        hectares: Number(row.hectares || 0),
        sector_budget_season_plans: Array.isArray(row.sector_budget_season_plans)
          ? row.sector_budget_season_plans.map((plan: any) => ({
            id: String(plan.id),
            season: String(plan.season || ''),
            budget_cost_clp_per_ha: Number(plan.budget_cost_clp_per_ha || 0),
            budget_cost_usd_per_ha: Number(plan.budget_cost_usd_per_ha || 0),
            expected_production_kg: Number(plan.expected_production_kg || 0),
            expected_sale_price_clp_per_kg: Number(plan.expected_sale_price_clp_per_kg || 0),
            expected_sale_price_usd_per_kg: Number(plan.expected_sale_price_usd_per_kg || 0),
            exchange_rate_reference: Number(plan.exchange_rate_reference || 0),
            notes: plan.notes || null
          }))
          : [],
        productive_stage: row.productive_stage || null,
        production_expected_from_season: row.production_expected_from_season || null,
        non_productive_reason: row.non_productive_reason || null,
        establishment_notes: row.establishment_notes || null
      });
      sectorByField.set(fieldId, current);
    });

    typedFields = typedFields.map((field) => ({
      ...field,
      sectors: sectorByField.get(field.id) || []
    }));
  } else {
    typedFields = (fields || []) as unknown as ReportFieldRow[];
  }

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
    costMovements: [] as AgriculturalCostMovement[],
    incomeEntries: [] as any[],
    invoices: [] as any[],
    products: [] as any[],
    availableSeasons: [getSeasonFromDate(new Date())],
    warnings
  };

  if (fieldIds.length === 0 || sectorIds.length === 0) {
    const [incomeRes, invoicesRes, productsRes, fuelConsRes, costMovementsRes] = await Promise.all([
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
        .eq('company_id', params.companyId),
      supabase
        .from('v_agricultural_cost_movements')
        .select('source_type, category, subcategory, movement_date, season, field_id, sector_id, amount')
        .eq('company_id', params.companyId)
    ]);

    const resolveRows = <T,>(res: { data: T[] | null; error: any }, source: string): T[] => {
      if (res.error) {
        warnings.push({ source, message: describeReportsError(res.error) });
        return [];
      }
      return (res.data || []) as T[];
    };

    const incomeEntries = resolveRows<any>(incomeRes as any, 'income_entries');
    const invoices = resolveRows<any>(invoicesRes as any, 'invoices');
    const products = resolveRows<any>(productsRes as any, 'products');
    const fuelConsumption = resolveRows<any>(fuelConsRes as any, 'fuel_consumption');
    const costMovements = resolveRows<any>(costMovementsRes as any, 'v_agricultural_cost_movements').map((row: any) =>
      mapCostMovementViewRow(row)
    );

    const availableSeasons = collectAvailableSeasons([
      { rows: costMovements, getDate: (row) => row.date },
      { rows: incomeEntries, getDate: (row) => row.date },
      { rows: invoices, getDate: (row) => row.invoice_date },
      { rows: fuelConsumption, getDate: (row) => row.date }
    ], getSeasonFromDate(new Date()));

    return {
      ...emptyResult,
      incomeEntries,
      invoices,
      products,
      fuelConsumption,
      costMovements,
      availableSeasons: availableSeasons.length > 0 ? availableSeasons : emptyResult.availableSeasons
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
    productsRes,
    costMovementsRes
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
      .neq('category', 'Archivado'),
    supabase
      .from('v_agricultural_cost_movements')
      .select('source_type, category, subcategory, movement_date, season, field_id, sector_id, amount')
      .eq('company_id', params.companyId)
  ]);

  const resolveRows = <T,>(res: { data: T[] | null; error: any }, source: string): T[] => {
    if (res.error) {
      warnings.push({ source, message: describeReportsError(res.error) });
      return [];
    }
    return (res.data || []) as T[];
  };

  const applications = resolveRows<ReportApplicationRow>(applicationsRes as any, 'applications');
  const labor = resolveRows<any>(laborRes as any, 'labor_assignments');
  const workerCosts = resolveRows<any>(workerCostsRes as any, 'worker_costs');
  const fuel = resolveRows<any>(fuelRes as any, 'fuel_assignments');
  const fuelConsumption = resolveRows<any>(fuelConsRes as any, 'fuel_consumption');
  const machinery = resolveRows<any>(machineryRes as any, 'machinery_assignments');
  const irrigation = resolveRows<any>(irrigationRes as any, 'irrigation_assignments');
  const generalCosts = resolveRows<any>(generalCostsRes as any, 'general_costs');
  const incomeEntries = resolveRows<any>(incomeRes as any, 'income_entries');
  const invoices = resolveRows<ReportInvoiceRow>(invoicesRes as any, 'invoices');
  const products = resolveRows<any>(productsRes as any, 'products');
  const costMovements = resolveRows<any>(costMovementsRes as any, 'v_agricultural_cost_movements').map((row: any) =>
    mapCostMovementViewRow(row)
  );
  const availableSeasons = collectAvailableSeasons([
    { rows: costMovements, getDate: (row) => row.date },
    { rows: applications, getDate: (row) => row.application_date },
    { rows: labor, getDate: (row) => row.assigned_date },
    { rows: workerCosts, getDate: (row) => row.date },
    { rows: fuel, getDate: (row) => row.assigned_date },
    { rows: fuelConsumption, getDate: (row) => row.date },
    { rows: machinery, getDate: (row) => row.assigned_date },
    { rows: irrigation, getDate: (row) => row.assigned_date },
    { rows: generalCosts, getDate: (row) => row.date },
    { rows: incomeEntries, getDate: (row) => row.date },
    { rows: invoices, getDate: (row) => row.invoice_date }
  ], getSeasonFromDate(new Date()));

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
    costMovements,
    incomeEntries,
    invoices,
    products,
    availableSeasons: availableSeasons.length > 0 ? availableSeasons : emptyResult.availableSeasons,
    warnings
  };
}
