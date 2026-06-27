import { supabase } from '../supabase/client';

export type ProductionRecord = {
  id: string;
  company_id: string;
  sector_id: string;
  season_year: number;
  kg_produced: number;
  price_per_kg: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProductionRecordUpsert = Omit<ProductionRecord, 'id' | 'created_at' | 'updated_at'>;

export async function loadProductionRecords(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('production_records')
    .select('id, company_id, sector_id, season_year, kg_produced, price_per_kg, created_at, updated_at')
    .eq('company_id', params.companyId)
    .order('season_year', { ascending: false });

  if (error) throw error;
  return (data || []) as ProductionRecord[];
}

export async function upsertProductionRecord(params: { productionRecordId?: string | null; payload: ProductionRecordUpsert }) {
  if (params.productionRecordId) {
    const { error } = await supabase
      .from('production_records')
      .update(params.payload)
      .eq('id', params.productionRecordId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('production_records').insert([params.payload]);
  if (error) throw error;
}

export async function deleteProductionRecord(params: { productionRecordId: string }) {
  const { error } = await supabase.from('production_records').delete().eq('id', params.productionRecordId);
  if (error) throw error;
}
