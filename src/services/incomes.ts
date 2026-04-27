import { supabase } from '../supabase/client';

export type IncomeEntry = {
  id: string;
  company_id: string;
  date: string;
  category: string;
  amount: number;
  description: string | null;
  field_id: string | null;
  sector_id: string | null;
  quantity_kg: number | null;
  amount_usd: number | null;
  price_per_kg: number | null;
  season: string | null;
  fields?: { name: string } | null;
  sectors?: { name: string } | null;
};

export type IncomeFieldOption = {
  id: string;
  name: string;
  sectors: Array<{ id: string; name: string }>;
};

export type SystemSettings = {
  id: string;
  company_id: string;
  usd_exchange_rate?: number | null;
} & Record<string, unknown>;

export type IncomeEntryUpsert = Omit<IncomeEntry, 'id' | 'fields' | 'sectors'>;

export async function loadIncomesPageData(params: { companyId: string }) {
  const [incomesResponse, fieldsResponse, settingsResponse] = await Promise.all([
    supabase
      .from('income_entries')
      .select(
        `
        *,
        fields (name),
        sectors (name)
      `
      )
      .eq('company_id', params.companyId)
      .order('date', { ascending: false }),
    supabase.from('fields').select('id, name, sectors(id, name)').eq('company_id', params.companyId),
    supabase.from('system_settings').select('*').eq('company_id', params.companyId).single()
  ]);

  if (incomesResponse.error) throw incomesResponse.error;
  if (fieldsResponse.error) throw fieldsResponse.error;

  return {
    incomes: (incomesResponse.data || []) as unknown as IncomeEntry[],
    fields: (fieldsResponse.data || []) as unknown as IncomeFieldOption[],
    settings: (settingsResponse.data || null) as unknown as SystemSettings | null
  };
}

export async function upsertIncomeEntry(params: { incomeId?: string | null; payload: IncomeEntryUpsert }) {
  if (params.incomeId) {
    const { error } = await supabase.from('income_entries').update(params.payload).eq('id', params.incomeId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('income_entries').insert([params.payload]);
  if (error) throw error;
}

export async function deleteIncomeEntry(params: { incomeId: string }) {
  const { error } = await supabase.from('income_entries').delete().eq('id', params.incomeId);
  if (error) throw error;
}
