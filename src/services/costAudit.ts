import { supabase } from '../supabase/client';

export type AgriculturalCostAuditRow = {
  company_id: string;
  field_id: string | null;
  field_name: string | null;
  sector_id: string | null;
  sector_name: string | null;
  movement_date: string;
  season: string | null;
  category: string;
  subcategory: string | null;
  amount: number;
  source_type: string;
  source_id: string;
  origin_type: string;
  origin_id: string;
  invoice_item_id: string | null;
  worker_id: string | null;
  machine_id: string | null;
  application_id: string | null;
  notes: string | null;
  is_official: boolean;
  is_fallback: boolean;
  cost_role: 'oficial' | 'respaldo' | 'distribucion';
  source_layer: 'Operacional' | 'Distribucion' | 'Manual' | 'Contable' | 'Otro';
  has_full_traceability: boolean;
  audit_status: string;
  review_priority: 'alta' | 'media' | 'baja';
  reconciliation_key: string;
};

export type AgriculturalCostAuditSummaryRow = {
  company_id: string;
  season: string | null;
  category: string;
  source_layer: string;
  cost_role: string;
  audit_status: string;
  review_priority: string;
  movement_count: number;
  total_amount: number;
  traceable_amount: number;
  non_traceable_amount: number;
};

export async function loadAgriculturalCostAudit(params: {
  companyId: string;
  season?: string;
  reviewPriority?: 'alta' | 'media' | 'baja';
}) {
  let query = supabase
    .from('v_agricultural_cost_reconciliation')
    .select('*')
    .eq('company_id', params.companyId)
    .order('movement_date', { ascending: false });

  if (params.season) {
    query = query.eq('season', params.season);
  }

  if (params.reviewPriority) {
    query = query.eq('review_priority', params.reviewPriority);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AgriculturalCostAuditRow[];
}

export async function loadAgriculturalCostAuditSummary(params: {
  companyId: string;
  season?: string;
}) {
  let query = supabase
    .from('v_agricultural_cost_reconciliation_summary')
    .select('*')
    .eq('company_id', params.companyId)
    .order('season', { ascending: false })
    .order('category', { ascending: true });

  if (params.season) {
    query = query.eq('season', params.season);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AgriculturalCostAuditSummaryRow[];
}
