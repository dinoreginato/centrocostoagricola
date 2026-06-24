import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';

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
type ApplicationRow = { total_cost: number; field_id: string; sector_id: string; application_date?: string | null };
type AssignmentRow = { assigned_amount: number; sector_id: string; assigned_date?: string | null };
type WorkerCostRow = { amount: number; sector_id: string; date?: string | null };
type GeneralCostRow = { amount: number; sector_id: string; date?: string | null };
type FuelConsumptionRow = { estimated_price: number | null; sector_id: string; date?: string | null };
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
const emptyResult = <T>(): Promise<QueryResult<T>> => Promise.resolve({ data: [] as T[], error: null });

const seasonFromRawDate = (rawDate?: string | null) => {
  if (!rawDate) return null;
  const parsed = new Date(`${String(rawDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return getSeasonFromDate(parsed);
};

export async function loadDashboardRaw(params: { companyId: string; season?: string }) {
  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('*, sectors(*)')
    .eq('company_id', params.companyId);

  if (fieldsError) throw fieldsError;

  const typedFields = (fields || []) as unknown as FieldRow[];
  const allSectors = typedFields.flatMap((f) => f.sectors || []);
  const sectorIds = allSectors.map((s) => s.id);

  const { data: applications, error: appError } = await supabase
    .from('applications')
    .select('total_cost, field_id, sector_id, application_date')
    .in(
      'field_id',
      typedFields.map((f) => f.id)
    );

  if (appError) throw appError;

  const [
    laborAssignmentsRes,
    workerCostsRes,
    fuelAssignmentsRes,
    fuelConsumptionRes,
    machineryAssignmentsRes,
    irrigationAssignmentsRes,
    generalCostsRes,
    upcomingInvoicesRes,
    incomeEntriesRes,
    stockRes,
    ordersRes,
    rainLogsRes,
    machinesRes
  ] = await Promise.all([
    sectorIds.length > 0
      ? (supabase.from('labor_assignments').select('assigned_amount, sector_id, assigned_date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('worker_costs').select('amount, sector_id, date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<WorkerCostRow>>)
      : emptyResult<WorkerCostRow>(),
    sectorIds.length > 0
      ? (supabase.from('fuel_assignments').select('assigned_amount, sector_id, assigned_date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('fuel_consumption').select('estimated_price, sector_id, date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<FuelConsumptionRow>>)
      : emptyResult<FuelConsumptionRow>(),
    sectorIds.length > 0
      ? (supabase.from('machinery_assignments').select('assigned_amount, sector_id, assigned_date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('irrigation_assignments').select('assigned_amount, sector_id, assigned_date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('general_costs').select('amount, sector_id, date').in('sector_id', sectorIds) as unknown as Promise<QueryResult<GeneralCostRow>>)
      : emptyResult<GeneralCostRow>(),
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
    laborAssignmentsRes.error,
    workerCostsRes.error,
    fuelAssignmentsRes.error,
    fuelConsumptionRes.error,
    machineryAssignmentsRes.error,
    irrigationAssignmentsRes.error,
    generalCostsRes.error,
    upcomingInvoicesRes.error,
    incomeEntriesRes.error,
    stockRes.error,
    ordersRes.error,
    rainLogsRes.error,
    machinesRes.error
  ].filter(Boolean);

  if (errors.length > 0) throw errors[0];

  const applicationsTyped = (applications || []) as unknown as ApplicationRow[];
  const laborAssignmentsTyped = laborAssignmentsRes.data || [];
  const workerCostsTyped = workerCostsRes.data || [];
  const fuelAssignmentsTyped = fuelAssignmentsRes.data || [];
  const fuelConsumptionTyped = fuelConsumptionRes.data || [];
  const machineryAssignmentsTyped = machineryAssignmentsRes.data || [];
  const irrigationAssignmentsTyped = irrigationAssignmentsRes.data || [];
  const generalCostsTyped = generalCostsRes.data || [];
  const incomeEntriesTyped = incomeEntriesRes.data || [];
  const upcomingInvoicesTyped = upcomingInvoicesRes.data || [];
  const stockDataTyped = stockRes.data || [];
  const ordersDataTyped = ordersRes.data || [];
  const rainLogsTyped = rainLogsRes.data || [];
  const machinesTyped = machinesRes.data || [];

  const seasonsSet = new Set<string>();
  seasonsSet.add(getSeasonFromDate(new Date()));
  applicationsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.application_date);
    if (season) seasonsSet.add(season);
  });
  laborAssignmentsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.assigned_date);
    if (season) seasonsSet.add(season);
  });
  workerCostsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.date);
    if (season) seasonsSet.add(season);
  });
  fuelAssignmentsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.assigned_date);
    if (season) seasonsSet.add(season);
  });
  fuelConsumptionTyped.forEach((row) => {
    const season = seasonFromRawDate(row.date);
    if (season) seasonsSet.add(season);
  });
  machineryAssignmentsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.assigned_date);
    if (season) seasonsSet.add(season);
  });
  irrigationAssignmentsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.assigned_date);
    if (season) seasonsSet.add(season);
  });
  generalCostsTyped.forEach((row) => {
    const season = seasonFromRawDate(row.date);
    if (season) seasonsSet.add(season);
  });
  incomeEntriesTyped.forEach((row) => {
    const season = seasonFromRawDate(row.date);
    if (season) seasonsSet.add(season);
  });

  const selectedSeason = params.season || getSeasonFromDate(new Date());
  const filterBySeason = <T extends { [key: string]: any }>(items: T[], dateKey: string) =>
    items.filter((item) => seasonFromRawDate(item?.[dateKey]) === selectedSeason);

  const filteredApplications = filterBySeason(applicationsTyped, 'application_date');
  const filteredLaborAssignments = filterBySeason(laborAssignmentsTyped, 'assigned_date');
  const filteredWorkerCosts = filterBySeason(workerCostsTyped, 'date');
  const filteredFuelAssignments = filterBySeason(fuelAssignmentsTyped, 'assigned_date');
  const filteredFuelConsumption = filterBySeason(fuelConsumptionTyped, 'date');
  const filteredMachineryAssignments = filterBySeason(machineryAssignmentsTyped, 'assigned_date');
  const filteredIrrigationAssignments = filterBySeason(irrigationAssignmentsTyped, 'assigned_date');
  const filteredGeneralCosts = filterBySeason(generalCostsTyped, 'date');
  const filteredIncomeEntries = filterBySeason(incomeEntriesTyped, 'date');

  return {
    fields: typedFields,
    sectorIds,
    allSectors,
    applications: filteredApplications,
    laborAssignments: filteredLaborAssignments,
    workerCosts: filteredWorkerCosts,
    fuelAssignments: filteredFuelAssignments,
    fuelConsumption: filteredFuelConsumption,
    machineryAssignments: filteredMachineryAssignments,
    irrigationAssignments: filteredIrrigationAssignments,
    generalCosts: filteredGeneralCosts,
    upcomingInvoices: upcomingInvoicesTyped,
    incomeEntries: filteredIncomeEntries,
    stockData: stockDataTyped,
    ordersData: ordersDataTyped,
    rainLogs: rainLogsTyped,
    machines: machinesTyped,
    availableSeasons: Array.from(seasonsSet).sort().reverse()
  };
}
