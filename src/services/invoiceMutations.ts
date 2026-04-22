import { supabase } from '../supabase/client';

export type InvoiceStatus = 'Pendiente' | 'Pagada';

export type InvoiceInsert = {
  company_id: string;
  invoice_number: string;
  supplier: string;
  supplier_rut?: string | null;
  invoice_date: string;
  due_date?: string | null;
  status: InvoiceStatus | string;
  notes?: string | null;
  document_type?: string | null;
  tax_percentage?: number | null;
  discount_amount?: number | null;
  exempt_amount?: number | null;
  special_tax_amount?: number | null;
  total_amount?: number | null;
  payment_date?: string | null;
};

export type InvoiceUpdate = Partial<Omit<InvoiceInsert, 'company_id'>>;

export type InvoiceItemInsert = {
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  category: string;
};

export type InvoiceItemUpdate = Partial<Omit<InvoiceItemInsert, 'invoice_id'>>;

export type ReverseInventoryMovementParams =
  | { invoice_item_id: string }
  | { target_product_id: string; quantity_to_remove: number };

export type MachineryAssignmentInsert = {
  invoice_item_id: string;
  assigned_date: string;
  assigned_amount: number;
  sector_id?: string | null;
  machine_id?: string | null;
  notes?: string | null;
};

export type LaborAssignmentInsert = {
  invoice_item_id: string;
  assigned_date: string;
  sector_id: string;
  assigned_amount: number;
  labor_type: string;
  worker_id?: string | null;
  notes?: string | null;
};

export type IrrigationAssignmentInsert = {
  invoice_item_id: string;
  assigned_date: string;
  sector_id: string;
  assigned_amount: number;
  notes?: string | null;
};

export type GeneralCostInsert = {
  company_id: string;
  invoice_item_id: string;
  date: string;
  sector_id: string;
  amount: number;
  category: string;
  description: string;
};

export type LaborAssignmentInput = Omit<LaborAssignmentInsert, 'invoice_item_id'>;
export type IrrigationAssignmentInput = Omit<IrrigationAssignmentInsert, 'invoice_item_id'>;
export type MachineryAssignmentInput = Omit<MachineryAssignmentInsert, 'invoice_item_id'>;
export type GeneralCostInput = Omit<GeneralCostInsert, 'company_id' | 'invoice_item_id'>;

export async function createInvoiceItemWithEffects(params: {
  invoiceId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: string;
  laborAssignments?: LaborAssignmentInput[];
  irrigationAssignments?: IrrigationAssignmentInput[];
  machineryAssignments?: MachineryAssignmentInput[];
  generalCosts?: GeneralCostInput[];
}): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('create_invoice_item_with_effects', {
    p_invoice_id: params.invoiceId,
    p_product_id: params.productId,
    p_quantity: params.quantity,
    p_unit_price: params.unitPrice,
    p_total_price: params.totalPrice,
    p_category: params.category,
    p_labor_assignments: params.laborAssignments || [],
    p_irrigation_assignments: params.irrigationAssignments || [],
    p_machinery_assignments: params.machineryAssignments || [],
    p_general_costs: params.generalCosts || []
  });
  if (error) throw error;
  return { id: data as string };
}

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

export async function createInvoice(params: { payload: InvoiceInsert }) {
  const { data, error } = await supabase.from('invoices').insert([params.payload]).select().single();
  if (error) throw error;
  return data;
}

export async function updateInvoice(params: { invoiceId: string; patch: InvoiceUpdate }) {
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

export async function createInvoiceItem(params: { payload: InvoiceItemInsert }) {
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

export async function updateInvoiceItem(params: { invoiceItemId: string; patch: InvoiceItemUpdate }) {
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

export async function rpcUpdateInvoiceItemWithInventory(params: {
  invoiceItemId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: string;
}) {
  const { error } = await supabase.rpc('update_invoice_item_with_inventory', {
    p_invoice_item_id: params.invoiceItemId,
    p_product_id: params.productId,
    p_quantity: params.quantity,
    p_unit_price: params.unitPrice,
    p_total_price: params.totalPrice,
    p_category: params.category
  });
  if (error) throw error;
}

export async function rpcReverseInventoryMovement(params: { payload: ReverseInventoryMovementParams }) {
  const { error } = await supabase.rpc('reverse_inventory_movement', params.payload);
  if (error) throw error;
}

export async function rpcDeleteInvoiceForce(params: { invoiceId: string }) {
  const { error } = await supabase.rpc('delete_invoice_force', { target_invoice_id: params.invoiceId });
  if (error) throw error;
}

export async function rpcDeleteInvoiceItemsWithEffects(params: { invoiceItemIds: string[] }) {
  if (params.invoiceItemIds.length === 0) return;
  const { error } = await supabase.rpc('delete_invoice_items_with_effects', { p_invoice_item_ids: params.invoiceItemIds });
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

export async function insertMachineryAssignment(params: { payload: MachineryAssignmentInsert }) {
  const { error } = await supabase.from('machinery_assignments').insert([params.payload]);
  if (error) throw error;
}

export async function insertLaborAssignment(params: { payload: LaborAssignmentInsert }) {
  const { error } = await supabase.from('labor_assignments').insert([params.payload]);
  if (error) throw error;
}

export async function insertIrrigationAssignment(params: { payload: IrrigationAssignmentInsert }) {
  const { error } = await supabase.from('irrigation_assignments').insert([params.payload]);
  if (error) throw error;
}

export async function insertGeneralCost(params: { payload: GeneralCostInsert }) {
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
  return (data as { supplier_rut: string | null } | null)?.supplier_rut ?? null;
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
  for (const invoiceId of params.invoiceIds) {
    await rpcDeleteInvoiceForce({ invoiceId });
  }
}
