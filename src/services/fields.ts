import { supabase } from '../supabase/client';

export type FieldWithSectors = {
  id: string;
  name: string;
  total_hectares: number;
  fruit_type: string;
  latitude?: number | null;
  longitude?: number | null;
  sectors?: Array<{
    id: string;
    name: string;
    hectares: number;
    budget?: number;
    latitude?: number | null;
    longitude?: number | null;
  }>;
};

export async function fetchFieldsWithSectors(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('fields')
    .select('*, sectors(*)')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as FieldWithSectors[];
}

export async function fetchLaborAssignmentsMap(params: { sectorIds: string[] }) {
  if (params.sectorIds.length === 0) return {} as Record<string, number>;

  const { data, error } = await supabase
    .from('labor_assignments')
    .select('sector_id, assigned_amount')
    .in('sector_id', params.sectorIds);

  if (error) throw error;

  const laborMap: Record<string, number> = {};
  (data || []).forEach((item: any) => {
    const sectorId = String(item.sector_id);
    laborMap[sectorId] = (laborMap[sectorId] || 0) + Number(item.assigned_amount || 0);
  });
  return laborMap;
}

export async function fetchFieldsWithLaborCosts(params: { companyId: string }) {
  const fields = await fetchFieldsWithSectors({ companyId: params.companyId });
  const allSectors = fields.flatMap((f) => f.sectors || []);
  const sectorIds = allSectors.map((s) => s.id);
  const laborMap = await fetchLaborAssignmentsMap({ sectorIds });

  return fields.map((field) => ({
    ...field,
    sectors: (field.sectors || []).map((sector) => ({
      ...sector,
      total_labor_cost: laborMap[sector.id] || 0
    }))
  })) as any[];
}

