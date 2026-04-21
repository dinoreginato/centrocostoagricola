import { supabase } from '../supabase/client';

export async function fetchCompanyFieldsBasic(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('fields')
    .select('id, name, total_hectares')
    .eq('company_id', params.companyId);

  if (error) throw error;
  return (data || []) as any[];
}

export async function fetchCompanySectorsBasic(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('sectors')
    .select(
      `
      id, name, hectares, field_id,
      fields!inner(company_id)
    `
    )
    .eq('fields.company_id', params.companyId);

  if (error) throw error;
  return (data || []) as any[];
}

