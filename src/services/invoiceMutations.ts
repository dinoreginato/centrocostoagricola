import { supabase } from '../supabase/client';

export async function searchOfficialProductsForInvoice(params: { query: string; limit?: number }) {
  const { data, error } = await supabase
    .from('official_products')
    .select('*')
    .ilike('commercial_name', `%${params.query}%`)
    .limit(params.limit ?? 5);
  if (error) throw error;
  return data || [];
}

export async function invoiceExists(params: { companyId: string; invoiceNumber: string; supplier: string }) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('invoice_number', params.invoiceNumber)
    .eq('supplier', params.supplier)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function createInvoice(params: { payload: any }) {
  const { data, error } = await supabase.from('invoices').insert([params.payload]).select().single();
  if (error) throw error;
  return data;
}

export async function updateInvoice(params: { invoiceId: string; patch: any }) {
  const { error } = await supabase.from('invoices').update(params.patch).eq('id', params.invoiceId);
  if (error) throw error;
}

export async function createOrFindProductByName(params: {
  companyId: string;
  name: string;
  category: string;
  unit: string;
  activeIngredient?: string | null;
}) {
  const { data: existingProduct, error: existingError } = await supabase
    .from('products')
    .select('id')
    .eq('company_id', params.companyId)
    .ilike('name', params.name)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingProduct) return existingProduct.id as string;

  const { data: newProduct, error: prodError } = await supabase
    .from('products')
    .insert([
      {
        company_id: params.companyId,
        name: params.name,
        category: params.category,
        unit: params.unit,
        active_ingredient: params.activeIngredient ?? null,
        current_stock: 0,
        average_cost: 0
      }
    ])
    .select()
    .single();

  if (prodError) throw prodError;
  return newProduct.id as string;
}

export async function createInvoiceItem(params: { payload: any }) {
  const { data, error } = await supabase.from('invoice_items').insert([params.payload]).select().single();
  if (error) throw error;
  return data;
}

export async function deleteInvoiceItem(params: { invoiceItemId: string }) {
  const { error } = await supabase.from('invoice_items').delete().eq('id', params.invoiceItemId);
  if (error) throw error;
}

export async function deleteInvoiceItemsByIds(params: { ids: string[] }) {
  if (params.ids.length === 0) return;
  const { error } = await supabase.from('invoice_items').delete().in('id', params.ids);
  if (error) throw error;
}

export async function updateInvoiceItem(params: { invoiceItemId: string; patch: any }) {
  const { error } = await supabase.from('invoice_items').update(params.patch).eq('id', params.invoiceItemId);
  if (error) throw error;
}

export async function rpcUpdateInventoryWithAverageCost(params: {
  productId: string;
  quantityIn: number;
  unitCost: number;
  invoiceItemId: string;
}) {
  const { error } = await supabase.rpc('update_inventory_with_average_cost', {
    product_id: params.productId,
    quantity_in: params.quantityIn,
    unit_cost: params.unitCost,
    invoice_item_id: params.invoiceItemId
  });
  if (error) throw error;
}

export async function rpcReverseInventoryMovement(params: { payload: any }) {
  const { error } = await supabase.rpc('reverse_inventory_movement', params.payload);
  if (error) throw error;
}

export async function rpcDeleteInvoiceForce(params: { invoiceId: string }) {
  const { error } = await supabase.rpc('delete_invoice_force', { target_invoice_id: params.invoiceId });
  if (error) throw error;
}

export async function fetchInvoiceItems(params: { invoiceId: string }) {
  const { data, error } = await supabase
    .from('invoice_items')
    .select('id, product_id, quantity, unit_price, total_price, category')
    .eq('invoice_id', params.invoiceId);
  if (error) throw error;
  return data || [];
}

export async function insertMachineryAssignment(params: { payload: any }) {
  const { error } = await supabase.from('machinery_assignments').insert([params.payload]);
  if (error) throw error;
}

export async function insertLaborAssignment(params: { payload: any }) {
  const { error } = await supabase.from('labor_assignments').insert([params.payload]);
  if (error) throw error;
}

export async function insertIrrigationAssignment(params: { payload: any }) {
  const { error } = await supabase.from('irrigation_assignments').insert([params.payload]);
  if (error) throw error;
}

export async function insertGeneralCost(params: { payload: any }) {
  const { error } = await supabase.from('general_costs').insert([params.payload]);
  if (error) throw error;
}

export async function fetchInvoicesForExport(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      *,
      invoice_items (
        *,
        products (name, unit, category, active_ingredient)
      )
    `
    )
    .eq('company_id', params.companyId)
    .order('invoice_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function findSupplierRut(params: { companyId: string; supplier: string }) {
  const { data, error } = await supabase
    .from('invoices')
    .select('supplier_rut')
    .eq('company_id', params.companyId)
    .eq('supplier', params.supplier)
    .not('supplier_rut', 'is', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as any)?.supplier_rut || null;
}

export async function fetchInvoicesBasic(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, supplier, created_at')
    .eq('company_id', params.companyId);
  if (error) throw error;
  return data || [];
}

export async function deleteInvoicesCascade(params: { invoiceIds: string[] }) {
  if (params.invoiceIds.length === 0) return;
  const { error: itemsError } = await supabase.from('invoice_items').delete().in('invoice_id', params.invoiceIds);
  if (itemsError) throw itemsError;
  const { error } = await supabase.from('invoices').delete().in('id', params.invoiceIds);
  if (error) throw error;
}
