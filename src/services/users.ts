import { supabase } from '../supabase/client';

export async function fetchAllCompaniesAdmin() {
  const { data, error } = await supabase.rpc('get_all_companies_admin');
  if (error) throw error;
  return data || [];
}

export async function deleteCompanyAdmin(params: { targetCompanyId: string }) {
  const { error } = await supabase.rpc('delete_company_admin', { target_company_id: params.targetCompanyId });
  if (error) throw error;
}

export async function fetchCompanyMembers(params: { companyId: string }) {
  const { data, error } = await supabase.rpc('get_company_members', { company_id_input: params.companyId });
  if (error) throw error;
  return data || [];
}

