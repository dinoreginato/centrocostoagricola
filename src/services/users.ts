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

export async function getUserIdByEmail(params: { email: string }) {
  const { data, error } = await supabase.rpc('get_user_id_by_email', { email_input: params.email });
  if (error) throw error;
  return data as string | null;
}

export async function addCompanyMember(params: { companyId: string; userId: string; role: string }) {
  const { error } = await supabase.from('company_members').insert([
    {
      company_id: params.companyId,
      user_id: params.userId,
      role: params.role
    }
  ]);
  if (error) throw error;
}

export async function removeCompanyMember(params: { memberId: string }) {
  const { error } = await supabase.from('company_members').delete().eq('id', params.memberId);
  if (error) throw error;
}
