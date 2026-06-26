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

export async function loadDashboardRaw(params: { companyId: string; season?: string }) {
  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('*, sectors(*)')
    .eq('company_id', params.companyId);

  if (fieldsError) throw fieldsError;

  const typedFields = (fields || []) as unknown as FieldRow[];
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

  const errors = [
    costMovementsRes.error,
    upcomingInvoicesRes.error,
    incomeEntriesRes.error,
    stockRes.error,
    ordersRes.error,
    rainLogsRes.error,
    machinesRes.error
  ].filter(Boolean);

  if (errors.length > 0) throw errors[0];

  const costMovementsAll = (costMovementsRes.data || []).map(mapCostMovementViewRow);
  const incomeEntriesTyped = incomeEntriesRes.data || [];
  const upcomingInvoicesTyped = upcomingInvoicesRes.data || [];
  const stockDataTyped = stockRes.data || [];
  const ordersDataTyped = ordersRes.data || [];
  const rainLogsTyped = rainLogsRes.data || [];
  const machinesTyped = machinesRes.data || [];

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
    availableSeasons
  };
}
