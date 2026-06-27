import { supabase } from '../supabase/client';

export type AgriculturalMarginRow = {
  company_id: string;
  field_id: string;
  field_name: string;
  fruit_type: string | null;
  sector_id: string;
  sector_name: string;
  season: string;
  hectares: number;
  budget_per_ha: number;
  total_budget: number;
  total_cost: number;
  income_clp_export: number;
  income_usd_export: number;
  income_clp_juice: number;
  income_usd_juice: number;
  total_income_clp: number;
  total_income_usd: number;
  kg_sent_export: number;
  kg_export: number;
  kg_juice: number;
  kg_sold: number;
  kg_produced: number;
  has_production_record: boolean;
  has_income_data: boolean;
  has_cost_data: boolean;
  production_source: 'production_records' | 'income_entries' | 'sin_produccion';
  price_export_usd_per_kg: number;
  price_juice_usd_per_kg: number;
  income_price_clp_per_kg: number;
  income_price_usd_per_kg: number;
  cost_per_ha: number;
  cost_per_kg: number;
  profit_clp: number;
  profit_per_ha: number;
  margin_pct: number;
};

export async function loadAgriculturalMarginRows(params: { companyId: string; season?: string }) {
  let query = supabase
    .from('v_agricultural_margin')
    .select('*')
    .eq('company_id', params.companyId)
    .order('season', { ascending: false })
    .order('field_name', { ascending: true })
    .order('sector_name', { ascending: true });

  if (params.season) {
    query = query.eq('season', params.season);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AgriculturalMarginRow[];
}
