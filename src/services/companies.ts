import { supabase } from '../supabase/client';

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
