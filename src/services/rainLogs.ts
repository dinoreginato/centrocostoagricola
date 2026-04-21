import { supabase } from '../supabase/client';

export async function fetchRainLogDates(params: {
  companyId: string;
  from: string;
  fieldId?: string | null;
  sectorId?: string | null;
}) {
  let query = supabase.from('rain_logs').select('date').eq('company_id', params.companyId).gte('date', params.from);

  if (params.fieldId) query = query.eq('field_id', params.fieldId);
  else query = query.is('field_id', null);

  if (params.sectorId) query = query.eq('sector_id', params.sectorId);
  else query = query.is('sector_id', null);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((r: any) => r.date).filter(Boolean) as string[];
}

export async function fetchRainLogsForYear(params: { companyId: string; year: number }) {
  const { data, error } = await supabase
    .from('rain_logs')
    .select('*')
    .eq('company_id', params.companyId)
    .gte('date', `${params.year}-01-01`)
    .order('date', { ascending: false });

  if (error) throw error;
  return (data || []) as any[];
}

export async function fetchRainLogKeysForYear(params: { companyId: string; year: number }) {
  const { data, error } = await supabase
    .from('rain_logs')
    .select('date, field_id, sector_id')
    .eq('company_id', params.companyId)
    .gte('date', `${params.year}-01-01`);

  if (error) throw error;
  return (data || []) as Array<{ date: string; field_id: string | null; sector_id: string | null }>;
}

export async function insertRainLogs(params: { rows: any[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('rain_logs').insert(params.rows);
  if (error) throw error;
}

