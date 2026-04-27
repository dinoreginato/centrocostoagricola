import { supabaseRpc } from './supabaseApi';

export type AdminCompanyRow = {
  id: string;
  name: string;
  owner_email: string | null;
  created_at: string;
};

export async function fetchAllCompaniesAdmin(): Promise<AdminCompanyRow[]> {
  const data = await supabaseRpc<AdminCompanyRow[]>('get_all_companies_admin');
  return (data || []) as unknown as AdminCompanyRow[];
}

export async function fetchIsSystemAdmin() {
  const data = await supabaseRpc<boolean>('is_system_admin');
  return Boolean(data);
}

export async function deleteCompanyAdmin(params: { targetCompanyId: string }) {
  await supabaseRpc('delete_company_admin', { target_company_id: params.targetCompanyId });
}

export async function fetchCompanyMembers(params: { companyId: string }) {
  const data = await supabaseRpc<unknown[]>('get_company_members', { company_id_input: params.companyId });
  return data || [];
}

export async function upsertCompanyMemberByEmail(params: { companyId: string; email: string; role: string }) {
  await supabaseRpc('upsert_company_member_by_email', {
    p_company_id: params.companyId,
    p_email: params.email,
    p_role: params.role,
  });
}

export async function removeCompanyMember(params: { companyId: string; memberId: string }) {
  await supabaseRpc('remove_company_member', {
    p_company_id: params.companyId,
    p_member_id: params.memberId,
  });
}
