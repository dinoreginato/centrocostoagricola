import { supabase } from '../supabase/client';
import { filterAgrochemicalProducts } from '../lib/agrochemicals';

export type InventoryProduct = {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  average_cost: number;
  updated_at: string;
  active_ingredient?: string | null;
  lot_number?: string | null;
  expiration_date?: string | null;
};

export type OfficialProduct = {
  registration_number: string;
  commercial_name: string;
  active_ingredient?: string | null;
  concentration?: string | null;
  company_name?: string | null;
};

export type InventoryMovement = {
  id: string;
  created_at: string;
  movement_type: 'entrada' | 'salida';
  quantity: number;
  unit_cost: number;
  manual?: boolean;
  notes?: string | null;
  prev_stock?: number | null;
  prev_average_cost?: number | null;
  created_by?: string | null;
  invoice_items?: {
    invoice?: {
      number: string;
      supplier: string;
      date: string;
    } | null;
  } | null;
  application_items?: {
    application?: {
      application_date: string;
      field?: { name: string } | null;
      sector?: { name: string } | null;
    } | null;
  } | null;
};

export type PhytosanitaryProgram = {
  id: string;
  name?: string | null;
  season?: string | null;
};

export type ProgramEventProductProjection = {
  product_id: string;
  dose: number;
  dose_unit: string;
};

export type ProgramEventProjection = {
  id: string;
  water_per_ha: number | null;
  program_event_products: ProgramEventProductProjection[] | null;
};

export async function fetchInventoryProducts(params: { companyId: string }): Promise<InventoryProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('company_id', params.companyId)
    .neq('category', 'Archivado')
    .order('name');

  if (error) throw error;

  const products = (data || []) as InventoryProduct[];
  return filterAgrochemicalProducts(products);
}

export async function fetchInventoryHistory(params: { productId: string }): Promise<InventoryMovement[]> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select(
      `
      *,
      invoice_items (
        invoice:invoices (number, supplier, date)
      ),
      application_items (
        application:applications (
          application_date, 
          field:fields(name), 
          sector:sectors(name)
        )
      )
    `
    )
    .eq('product_id', params.productId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as InventoryMovement[];
}

export async function searchOfficialProducts(params: { query: string; limit?: number }): Promise<OfficialProduct[]> {
  const q = params.query.trim();
  if (q.length < 3) return [];

  const { data, error } = await supabase
    .from('official_products')
    .select('*')
    .ilike('commercial_name', `%${q}%`)
    .limit(params.limit ?? 5);

  if (error) throw error;
  return (data || []) as unknown as OfficialProduct[];
}

export async function upsertOfficialProducts(params: { rows: OfficialProduct[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase
    .from('official_products')
    .upsert(params.rows, { onConflict: 'registration_number', ignoreDuplicates: false });
  if (error) throw error;
}

export async function fetchPhytosanitaryPrograms(params: { companyId: string }): Promise<PhytosanitaryProgram[]> {
  const { data, error } = await supabase.from('phytosanitary_programs').select('*').eq('company_id', params.companyId);
  if (error) throw error;
  return (data || []) as unknown as PhytosanitaryProgram[];
}

export async function fetchProgramEventsForProjection(params: { programId: string }): Promise<ProgramEventProjection[]> {
  const { data, error } = await supabase
    .from('program_events')
    .select(
      `
      id,
      water_per_ha,
      program_event_products(product_id, dose, dose_unit)
    `
    )
    .eq('program_id', params.programId);

  if (error) throw error;
  return (data || []) as unknown as ProgramEventProjection[];
}

export async function updateInventoryProduct(params: {
  productId: string;
  patch: Partial<InventoryProduct> & { updated_at?: string };
}) {
  const payload = { ...params.patch, updated_at: params.patch.updated_at ?? new Date().toISOString() };
  const { error } = await supabase.from('products').update(payload).eq('id', params.productId);
  if (error) throw error;
}

export type ManualInventoryMovementInput = {
  productId: string;
  movementType: 'entrada' | 'salida';
  quantity: number;
  unitCost?: number | null;
  notes?: string | null;
};

export async function applyManualInventoryMovement(params: ManualInventoryMovementInput): Promise<{ movementId: string }> {
  const { data, error } = await supabase.rpc('apply_manual_inventory_movement', {
    p_product_id: params.productId,
    p_movement_type: params.movementType,
    p_quantity: params.quantity,
    p_unit_cost: params.unitCost ?? null,
    p_notes: params.notes ?? null
  });
  if (error) throw error;
  return { movementId: data as string };
}

export async function revertManualInventoryMovement(params: { movementId: string }) {
  const { error } = await supabase.rpc('revert_manual_inventory_movement', { p_movement_id: params.movementId });
  if (error) throw error;
}

export async function deleteOrArchiveInventoryProduct(params: { productId: string }) {
  const { error: deleteError } = await supabase.from('products').delete().eq('id', params.productId);

  if (!deleteError) return { mode: 'deleted' as const };

  if (deleteError.code === '23503') {
    const { error: updateError } = await supabase
      .from('products')
      .update({ current_stock: 0, minimum_stock: 0, category: 'Archivado' })
      .eq('id', params.productId);

    if (updateError) throw updateError;
    return { mode: 'archived' as const };
  }

  throw deleteError;
}

export async function mergeDuplicateInventoryProducts(params: { products: InventoryProduct[] }): Promise<{ mergedCount: number }> {
  const nameGroups = new Map<string, InventoryProduct[]>();
  params.products.forEach((p) => {
    const key = String(p.name || '').toLowerCase().trim();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(p);
  });

  let mergedCount = 0;

  for (const [, group] of nameGroups.entries()) {
    if (group.length <= 1) continue;

    group.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    const master = group[0];
    const duplicates = group.slice(1);

    let totalStock = Number(master.current_stock);
    let totalValue = Number(master.current_stock) * Number(master.average_cost);

    for (const dup of duplicates) {
      totalStock += Number(dup.current_stock);
      totalValue += Number(dup.current_stock) * Number(dup.average_cost);

      await supabase.from('inventory_movements').update({ product_id: master.id }).eq('product_id', dup.id);
      await supabase.from('application_items').update({ product_id: master.id }).eq('product_id', dup.id);
      await supabase.from('invoice_items').update({ product_id: master.id }).eq('product_id', dup.id);
      await supabase.from('products').delete().eq('id', dup.id);
    }

    const newAvgCost = totalStock > 0 ? totalValue / totalStock : master.average_cost;

    await supabase
      .from('products')
      .update({
        current_stock: totalStock,
        average_cost: newAvgCost
      })
      .eq('id', master.id);

    mergedCount += duplicates.length;
  }

  return { mergedCount };
}
