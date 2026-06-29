import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';
import { filterRowsBySeason } from '../lib/agriculturalData';
import type { AgriculturalCostMovement } from '../lib/costMovements';

type FieldRow = {
  id: string;
  name: string;
  total_hectares?: number | null;
  sectors?: Array<{
    id: string;
    name: string;
    hectares: number;
    field_id: string;
  }>;
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
type InvoiceUpcomingRow = {
  id: string;
  invoice_number: string;
  supplier: string;
  total_amount: number;
  due_date: string;
  notes?: string | null;
};
type StockRow = { name: string; current_stock: number; minimum_stock: number; unit: string; expiration_date?: string | null };
type OrderRow = {
  sector_id: string;
  scheduled_date: string;
  safety_period_hours?: number | null;
  grace_period_days?: number | null;
  protection_days?: number | null;
  application_type?: string | null;
  objective?: string | null;
  sector?: { name: string } | null;
};
type MachineRow = {
  id: string;
  name: string;
  type?: string | null;
  brand?: string | null;
  model?: string | null;
  plate?: string | null;
  current_hours?: number | null;
  maintenance_interval_hours?: number | null;
  last_maintenance_hours?: number | null;
  is_active?: boolean | null;
};
type IncomeEntryRow = { id: string; date: string; amount: number; category: string; description?: string | null; field_id?: string | null; sector_id?: string | null };
type RainLogRow = { id: string; date: string; rain_mm: number; field_id?: string | null; sector_id?: string | null; source?: string | null };

type QueryResult<T> = { data: T[] | null; error: unknown | null };
type DashboardWarning = { source: string; message: string };

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

const describeDashboardError = (error: any) => {
  const message = String(error?.message || error?.details || error?.hint || error || '');
  const code = String(error?.code || '');
  return code ? `${code}: ${message}` : message;
};

export async function loadDashboardRaw(params: { companyId: string; season?: string }) {
  const warnings: DashboardWarning[] = [];

  let typedFields: FieldRow[] = [];
  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('*, sectors(*)')
    .eq('company_id', params.companyId);

  if (fieldsError) {
    warnings.push({ source: 'fields', message: describeDashboardError(fieldsError) });
    const { data: basicFields, error: basicFieldsError } = await supabase
      .from('fields')
      .select('*')
      .eq('company_id', params.companyId);
    if (basicFieldsError) throw basicFieldsError;
    typedFields = (basicFields || []) as unknown as FieldRow[];

    const { data: sectorsData, error: sectorsError } = await supabase
      .from('sectors')
      .select('id, name, hectares, field_id, fields!inner(company_id)')
      .eq('fields.company_id', params.companyId);

    if (sectorsError) {
      warnings.push({ source: 'sectors', message: describeDashboardError(sectorsError) });
    }

    const sectorByField = new Map<string, FieldRow['sectors']>();
    (sectorsData || []).forEach((row: any) => {
      const fieldId = String(row.field_id || '');
      if (!fieldId) return;
      const current = sectorByField.get(fieldId) || [];
      current.push({
        id: String(row.id),
        name: String(row.name || ''),
        hectares: Number(row.hectares || 0),
        field_id: fieldId
      });
      sectorByField.set(fieldId, current);
    });

    typedFields = typedFields.map((field) => ({
      ...field,
      sectors: sectorByField.get(field.id) || []
    }));
  } else {
    typedFields = (fields || []) as unknown as FieldRow[];
  }

  const allSectors = typedFields.flatMap((f) => f.sectors || []);
  const sectorIds = allSectors.map((s) => s.id);

  const [
    costMovementsRes,
    upcomingInvoicesRes,
    incomeEntriesRes,
    stockRes,
    ordersRes,
    rainLogsRes,
    machinesRes
  ] = await Promise.all([
    supabase
      .from('v_agricultural_cost_movements')
      .select('source_type, category, subcategory, movement_date, season, field_id, sector_id, amount')
      .eq('company_id', params.companyId) as unknown as Promise<QueryResult<CostMovementViewRow>>,
    (async () => {
      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate.setMonth(startDate.getMonth() - 3);
      const endDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate.setMonth(endDate.getMonth() + 13);
      endDate.setDate(0);

      return supabase
        .from('invoices')
        .select(
          `
          id,
          invoice_number, 
          supplier, 
          total_amount, 
          due_date, 
          notes
        `
        )
        .eq('company_id', params.companyId)
        .eq('status', 'Pendiente')
        .not('due_date', 'is', null)
        .gte('due_date', startDate.toISOString().split('T')[0])
        .lte('due_date', endDate.toISOString().split('T')[0])
        .order('due_date', { ascending: true });
    })() as unknown as Promise<QueryResult<InvoiceUpcomingRow>>,
    supabase.from('income_entries').select('*').eq('company_id', params.companyId) as unknown as Promise<QueryResult<IncomeEntryRow>>,
    supabase
      .from('products')
      .select('name, current_stock, minimum_stock, unit, expiration_date')
      .eq('company_id', params.companyId)
      .neq('category', 'Archivado') as unknown as Promise<QueryResult<StockRow>>,
    supabase
      .from('application_orders')
      .select('sector_id, scheduled_date, safety_period_hours, grace_period_days, protection_days, application_type, objective, sector:sectors(name)')
      .eq('company_id', params.companyId)
      .order('scheduled_date', { ascending: false }) as unknown as Promise<QueryResult<OrderRow>>,
    (async () => {
      const activeYear = new Date().getFullYear();
      return supabase
        .from('rain_logs')
        .select('*')
        .eq('company_id', params.companyId)
        .gte('date', `${activeYear}-01-01`)
        .order('date', { ascending: false });
    })() as unknown as Promise<QueryResult<RainLogRow>>,
    supabase.from('machines').select('*').eq('company_id', params.companyId) as unknown as Promise<QueryResult<MachineRow>>
  ]);

  if (costMovementsRes.error) warnings.push({ source: 'v_agricultural_cost_movements', message: describeDashboardError(costMovementsRes.error) });
  if (upcomingInvoicesRes.error) warnings.push({ source: 'invoices', message: describeDashboardError(upcomingInvoicesRes.error) });
  if (incomeEntriesRes.error) warnings.push({ source: 'income_entries', message: describeDashboardError(incomeEntriesRes.error) });
  if (stockRes.error) warnings.push({ source: 'products', message: describeDashboardError(stockRes.error) });
  if (ordersRes.error) warnings.push({ source: 'application_orders', message: describeDashboardError(ordersRes.error) });
  if (rainLogsRes.error) warnings.push({ source: 'rain_logs', message: describeDashboardError(rainLogsRes.error) });
  if (machinesRes.error) warnings.push({ source: 'machines', message: describeDashboardError(machinesRes.error) });

  const costMovementsAll = (costMovementsRes.error ? [] : (costMovementsRes.data || [])).map(mapCostMovementViewRow);
  const incomeEntriesTyped = incomeEntriesRes.error ? [] : (incomeEntriesRes.data || []);
  const upcomingInvoicesTyped = upcomingInvoicesRes.error ? [] : (upcomingInvoicesRes.data || []);
  const stockDataTyped = stockRes.error ? [] : (stockRes.data || []);
  const ordersDataTyped = ordersRes.error ? [] : (ordersRes.data || []);
  const rainLogsTyped = rainLogsRes.error ? [] : (rainLogsRes.data || []);
  const machinesTyped = machinesRes.error ? [] : (machinesRes.data || []);

  const availableSeasons = Array.from(
    new Set<string>([
      getSeasonFromDate(new Date()),
      ...costMovementsAll.map((row) => String(row.season || '')).filter(Boolean),
      ...incomeEntriesTyped.map((row) => getSeasonFromDate(new Date(`${row.date}T12:00:00`)))
    ])
  ).sort().reverse();

  const selectedSeason = params.season || getSeasonFromDate(new Date());
  const filteredCostMovements = costMovementsAll.filter((row) => row.season === selectedSeason);
  const filteredIncomeEntries = filterRowsBySeason(incomeEntriesTyped, selectedSeason, (row) => row.date);

  return {
    fields: typedFields,
    sectorIds,
    allSectors,
    costMovements: filteredCostMovements,
    upcomingInvoices: upcomingInvoicesTyped,
    incomeEntries: filteredIncomeEntries,
    stockData: stockDataTyped,
    ordersData: ordersDataTyped,
    rainLogs: rainLogsTyped,
    machines: machinesTyped,
    availableSeasons,
    warnings
  };
}
