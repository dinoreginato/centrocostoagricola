import { supabase } from '../supabase/client';

export async function loadDashboardRaw(params: { companyId: string }) {
  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('*, sectors(*)')
    .eq('company_id', params.companyId);

  if (fieldsError) throw fieldsError;

  const allSectors = (fields || []).flatMap((f: any) => f.sectors || []);
  const sectorIds = allSectors.map((s: any) => s.id);

  const { data: applications, error: appError } = await supabase
    .from('applications')
    .select('total_cost, field_id, sector_id')
    .in(
      'field_id',
      (fields || []).map((f: any) => f.id)
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
      ? supabase.from('labor_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    sectorIds.length > 0
      ? supabase.from('fuel_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    sectorIds.length > 0
      ? supabase.from('fuel_consumption').select('estimated_price, sector_id').in('sector_id', sectorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    sectorIds.length > 0
      ? supabase.from('machinery_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    sectorIds.length > 0
      ? supabase.from('irrigation_assignments').select('assigned_amount, sector_id').in('sector_id', sectorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
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
    })(),
    supabase.from('income_entries').select('*').eq('company_id', params.companyId),
    supabase
      .from('products')
      .select('name, current_stock, minimum_stock, unit, expiration_date')
      .eq('company_id', params.companyId),
    supabase
      .from('application_orders')
      .select('sector_id, scheduled_date, safety_period_hours, grace_period_days, protection_days, application_type, objective, sector:sectors(name)')
      .eq('company_id', params.companyId)
      .order('scheduled_date', { ascending: false }),
    (async () => {
      const activeYear = new Date().getFullYear();
      return supabase
        .from('rain_logs')
        .select('*')
        .eq('company_id', params.companyId)
        .gte('date', `${activeYear}-01-01`)
        .order('date', { ascending: false });
    })(),
    supabase.from('machines').select('*').eq('company_id', params.companyId)
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
    fields: fields || [],
    sectorIds,
    allSectors,
    applications: applications || [],
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
