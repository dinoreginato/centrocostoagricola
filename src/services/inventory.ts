import { supabase } from '../supabase/client';

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
  commercial_name: string;
  active_ingredient?: string | null;
  concentration?: string | null;
};

const AGRO_KEYWORDS = [
  'fertilizante',
  'plaguicida',
  'insecticida',
  'fungicida',
  'herbicida',
  'quimico',
  'agro',
  'urea',
  'salitre',
  'potasio',
  'fosforo',
  'nitrato',
  'sulfato'
];

export async function fetchInventoryProducts(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('company_id', params.companyId)
    .order('name');

  if (error) throw error;

  const products = (data || []) as InventoryProduct[];
  return products.filter((product) => {
    const cat = String(product.category || '').toLowerCase();
    const name = String(product.name || '').toLowerCase();
    return AGRO_KEYWORDS.some((term) => cat.includes(term) || name.includes(term));
  });
}

export async function fetchInventoryHistory(params: { productId: string }) {
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
  return (data || []) as any[];
}

export async function searchOfficialProducts(params: { query: string; limit?: number }) {
  const q = params.query.trim();
  if (q.length < 3) return [];

  const { data, error } = await supabase
    .from('official_products')
    .select('*')
    .ilike('commercial_name', `%${q}%`)
    .limit(params.limit ?? 5);

  if (error) throw error;
  return (data || []) as any[];
}

export async function upsertOfficialProducts(params: { rows: OfficialProduct[] | any[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase
    .from('official_products')
    .upsert(params.rows, { onConflict: 'registration_number', ignoreDuplicates: false });
  if (error) throw error;
}

export async function fetchPhytosanitaryPrograms(params: { companyId: string }) {
  const { data, error } = await supabase.from('phytosanitary_programs').select('*').eq('company_id', params.companyId);
  if (error) throw error;
  return data || [];
}

export async function fetchProgramEventsForProjection(params: { programId: string }) {
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
  return data || [];
}

export async function updateInventoryProduct(params: {
  productId: string;
  patch: Partial<InventoryProduct> & { updated_at?: string };
}) {
  const payload = { ...params.patch, updated_at: params.patch.updated_at ?? new Date().toISOString() };
  const { error } = await supabase.from('products').update(payload).eq('id', params.productId);
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

export async function mergeDuplicateInventoryProducts(params: { products: InventoryProduct[] }) {
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
