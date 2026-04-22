import { supabase } from '../supabase/client';

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
type ApplicationRow = { total_cost: number; field_id: string; sector_id: string };
type AssignmentRow = { assigned_amount: number; sector_id: string };
type FuelConsumptionRow = { estimated_price: number | null; sector_id: string };
type InvoiceUpcomingRow = {
  id: string;
  invoice_number: string;
  supplier: string;
  total_amount: number;
  due_date: string;
  notes?: string | null;
  invoice_items?: Array<{
    quantity: number;
    unit_price: number;
    total_price: number;
    category: string;
    products?: { name: string; unit: string } | { name: string; unit: string }[] | null;
  }>;
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

export async function loadDashboardRaw(params: { companyId: string }) {
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
    .select('total_cost, field_id, sector_id')
    .in(
      'field_id',
      typedFields.map((f) => f.id)
    );

  if (appError) throw appError;

  const [
    laborAssignmentsRes,
    fuelAssignmentsRes,
    fuelConsumptionRes,
    machineryAssignmentsRes,
    irrigationAssignmentsRes,
    upcomingInvoicesRes,
    incomeEntriesRes,
    stockRes,
    ordersRes,
    rainLogsRes,
    machinesRes
  ] = await Promise.all([
    sectorIds.length > 0
      ? (supabase.from('labor_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('fuel_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('fuel_consumption').select('estimated_price, sector_id').in('sector_id', sectorIds) as unknown as Promise<QueryResult<FuelConsumptionRow>>)
      : emptyResult<FuelConsumptionRow>(),
    sectorIds.length > 0
      ? (supabase.from('machinery_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    sectorIds.length > 0
      ? (supabase.from('irrigation_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds) as unknown as Promise<QueryResult<AssignmentRow>>)
      : emptyResult<AssignmentRow>(),
    (async () => {
      const today = new Date();
      const currentDay = today.getDate();
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();

      let startDate: Date;
      let endDate: Date;

      if (currentDay <= 15) {
        startDate = new Date(currentYear, currentMonth, 1);
        endDate = new Date(currentYear, currentMonth, 15);
      } else {
        startDate = new Date(currentYear, currentMonth, 16);
        endDate = new Date(currentYear, currentMonth + 1, 0);
      }

      return supabase
        .from('invoices')
        .select(
          `
          id,
          invoice_number, 
          supplier, 
          total_amount, 
          due_date, 
          notes,
          invoice_items (
            quantity,
            unit_price,
            total_price,
            category,
            products (name, unit)
          )
        `
        )
        .eq('company_id', params.companyId)
        .eq('status', 'Pendiente')
        .gte('due_date', startDate.toISOString().split('T')[0])
        .lte('due_date', endDate.toISOString().split('T')[0])
        .order('due_date', { ascending: true });
    })() as unknown as Promise<QueryResult<InvoiceUpcomingRow>>,
    supabase.from('income_entries').select('*').eq('company_id', params.companyId) as unknown as Promise<QueryResult<IncomeEntryRow>>,
    supabase
      .from('products')
      .select('name, current_stock, minimum_stock, unit, expiration_date')
      .eq('company_id', params.companyId) as unknown as Promise<QueryResult<StockRow>>,
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
    fuelAssignmentsRes.error,
    fuelConsumptionRes.error,
    machineryAssignmentsRes.error,
    irrigationAssignmentsRes.error,
    upcomingInvoicesRes.error,
    incomeEntriesRes.error,
    stockRes.error,
    ordersRes.error,
    rainLogsRes.error,
    machinesRes.error
  ].filter(Boolean);

  if (errors.length > 0) throw errors[0];

  return {
    fields: typedFields,
    sectorIds,
    allSectors,
    applications: (applications || []) as unknown as ApplicationRow[],
    laborAssignments: laborAssignmentsRes.data || [],
    fuelAssignments: fuelAssignmentsRes.data || [],
    fuelConsumption: fuelConsumptionRes.data || [],
    machineryAssignments: machineryAssignmentsRes.data || [],
    irrigationAssignments: irrigationAssignmentsRes.data || [],
    upcomingInvoices: upcomingInvoicesRes.data || [],
    incomeEntries: incomeEntriesRes.data || [],
    stockData: stockRes.data || [],
    ordersData: ordersRes.data || [],
    rainLogs: rainLogsRes.data || [],
    machines: machinesRes.data || []
  };
}
