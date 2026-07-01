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
    expected_production_kg?: number;
    expected_price_per_kg?: number;
    sector_budget_season_plans?: SectorBudgetSeasonPlan[];
    productive_stage?: 'productivo' | 'en_formacion' | 'renovacion' | 'arranque';
    production_expected_from_season?: string | null;
    non_productive_reason?: 'plantacion_nueva' | 'replante' | 'recuperacion' | 'otro' | null;
    establishment_notes?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>;
};

export type SectorBudgetSeasonPlan = {
  id: string;
  sector_id: string;
  season: string;
  budget_cost_clp_per_ha?: number;
  budget_cost_usd_per_ha?: number;
  expected_production_kg?: number;
  expected_sale_price_clp_per_kg?: number;
  expected_sale_price_usd_per_kg?: number;
  exchange_rate_reference?: number;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

type LaborAssignmentRow = { sector_id: string; assigned_amount: number | null };

export type FieldSectorWithLabor = NonNullable<FieldWithSectors['sectors']>[number] & {
  total_labor_cost: number;
};

export type FieldWithLaborCosts = Omit<FieldWithSectors, 'sectors'> & {
  sectors: FieldSectorWithLabor[];
};

export type FieldInsert = {
  name: string;
  total_hectares: number;
  fruit_type: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type FieldUpdate = Partial<FieldInsert>;

export type SectorInsert = {
  name: string;
  hectares: number;
  budget?: number;
  expected_production_kg?: number;
  expected_price_per_kg?: number;
  productive_stage?: 'productivo' | 'en_formacion' | 'renovacion' | 'arranque';
  production_expected_from_season?: string | null;
  non_productive_reason?: 'plantacion_nueva' | 'replante' | 'recuperacion' | 'otro' | null;
  establishment_notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SectorUpdate = Partial<SectorInsert>;

export type SectorBudgetSeasonPlanInsert = {
  season: string;
  budget_cost_clp_per_ha?: number;
  budget_cost_usd_per_ha?: number;
  expected_production_kg?: number;
  expected_sale_price_clp_per_kg?: number;
  expected_sale_price_usd_per_kg?: number;
  exchange_rate_reference?: number;
  notes?: string | null;
};

export type SectorBudgetSeasonPlanUpdate = Partial<SectorBudgetSeasonPlanInsert>;

const isMissingSeasonPlansRelationError = (error: any) => {
  const message = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return message.includes('sector_budget_season_plans')
    && (
      message.includes('does not exist')
      || message.includes('could not find')
      || message.includes('relationship')
      || message.includes('schema cache')
      || message.includes('not found')
    );
};

export async function fetchFieldsWithSectors(params: { companyId: string }) {
  let { data, error } = await supabase
    .from('fields')
    .select('*, sectors(*, sector_budget_season_plans(*))')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (error && isMissingSeasonPlansRelationError(error)) {
    const fallbackRes = await supabase
      .from('fields')
      .select('*, sectors(*)')
      .eq('company_id', params.companyId)
      .order('created_at', { ascending: false });

    data = fallbackRes.data;
    error = fallbackRes.error;
  }

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
  (data as LaborAssignmentRow[] | null | undefined || []).forEach((item) => {
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
  })) as FieldWithLaborCosts[];
}

export async function createField(params: { companyId: string; payload: FieldInsert }) {
  const { data, error } = await supabase.from('fields').insert([{ ...params.payload, company_id: params.companyId }]).select().single();
  if (error) throw error;
  return data;
}

export async function updateField(params: { fieldId: string; patch: FieldUpdate }) {
  const { data, error } = await supabase.from('fields').update(params.patch).eq('id', params.fieldId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteField(params: { fieldId: string }) {
  const { error } = await supabase.from('fields').delete().eq('id', params.fieldId);
  if (error) throw error;
}

export async function createSector(params: { fieldId: string; payload: SectorInsert }) {
  const { data, error } = await supabase.from('sectors').insert([{ ...params.payload, field_id: params.fieldId }]).select().single();
  if (error) throw error;
  return data;
}

export async function updateSector(params: { sectorId: string; patch: SectorUpdate }) {
  const { data, error } = await supabase.from('sectors').update(params.patch).eq('id', params.sectorId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSector(params: { sectorId: string }) {
  const { error } = await supabase.from('sectors').delete().eq('id', params.sectorId);
  if (error) throw error;
}

export async function createSectorBudgetSeasonPlan(params: { sectorId: string; payload: SectorBudgetSeasonPlanInsert }) {
  const { data, error } = await supabase
    .from('sector_budget_season_plans')
    .insert([{ ...params.payload, sector_id: params.sectorId }])
    .select()
    .single();
  if (error) throw error;
  return data as SectorBudgetSeasonPlan;
}

export async function updateSectorBudgetSeasonPlan(params: { planId: string; patch: SectorBudgetSeasonPlanUpdate }) {
  const { data, error } = await supabase
    .from('sector_budget_season_plans')
    .update(params.patch)
    .eq('id', params.planId)
    .select()
    .single();
  if (error) throw error;
  return data as SectorBudgetSeasonPlan;
}

export async function deleteSectorBudgetSeasonPlan(params: { planId: string }) {
  const { error } = await supabase
    .from('sector_budget_season_plans')
    .delete()
    .eq('id', params.planId);
  if (error) throw error;
}
