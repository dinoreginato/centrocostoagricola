import { supabase } from '../supabase/client';

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
    incomes: incomesResponse.data || [],
    fields: fieldsResponse.data || [],
    settings: settingsResponse.data || null
  };
}

export async function upsertIncomeEntry(params: { incomeId?: string | null; payload: any }) {
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
