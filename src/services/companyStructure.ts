import { supabase } from '../supabase/client';

export type CompanyFieldBasic = {
  id: string;
  name: string;
  total_hectares: number;
};

export type CompanySectorBasic = {
  id: string;
  name: string;
  hectares: number;
  field_id: string;
  fields?: { company_id: string } | null;
};

export async function fetchCompanyFieldsBasic(params: { companyId: string }): Promise<CompanyFieldBasic[]> {
  const { data, error } = await supabase
    .from('fields')
    .select('id, name, total_hectares')
    .eq('company_id', params.companyId);

  if (error) throw error;
  return (data || []) as unknown as CompanyFieldBasic[];
}

export async function fetchCompanySectorsBasic(params: { companyId: string }): Promise<CompanySectorBasic[]> {
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
  return (data || []) as unknown as CompanySectorBasic[];
}
