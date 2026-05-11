import { supabase } from '../supabase/client';

export type Company = {
  id: string;
  name: string;
  rut: string | null;
  owner_id: string | null;
  created_at?: string;
  application_fuel_rate?: number | null;
} & Record<string, unknown>;

export async function deleteCompany(params: { companyId: string }) {
  const { error } = await supabase.from('companies').delete().eq('id', params.companyId);
  if (error) throw error;
}

export async function createCompanyForCurrentUser(params: { name: string; rut: string | null }) {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Usuario no autenticado');

  const { data, error } = await supabase
    .from('companies')
    .insert([
      {
        name: params.name,
        rut: params.rut,
        owner_id: user.id
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCompanyApplicationFuelRate(params: { companyId: string; rate: number }) {
  const { error } = await supabase.from('companies').update({ application_fuel_rate: params.rate }).eq('id', params.companyId);
  if (error) throw error;
}

export async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as Company[];
}

export async function claimOrphanCompanies(params: { companyIds: string[]; ownerId: string }) {
  if (params.companyIds.length === 0) return;
  const { error } = await supabase
    .from('companies')
    .update({ owner_id: params.ownerId })
    .in('id', params.companyIds)
    .is('owner_id', null);
  if (error) throw error;
}

export async function fetchCompanyMemberRole(params: { companyId: string; userId: string }) {
  const { data, error } = await supabase.from('company_members').select('role').eq('company_id', params.companyId).eq('user_id', params.userId).single();
  if (error) throw error;
  return (data as { role: string } | null)?.role ?? null;
}
