import { supabase } from '../supabase/client';

export async function loadApplicationsPageData(params: { companyId: string; agrochemicalCategories: string[] }) {
  const [fieldsRes, productsRes, appsRes, fuelItemsRes] = await Promise.all([
    supabase.from('fields').select('*, sectors(*)').eq('company_id', params.companyId),
    supabase
      .from('products')
      .select('*')
      .eq('company_id', params.companyId)
      .in('category', params.agrochemicalCategories)
      .gt('current_stock', 0),
    supabase.rpc('get_company_applications_v2', { p_company_id: params.companyId }),
    supabase
      .from('invoice_items')
      .select(
        `
        quantity, total_price, category,
        products (name),
        invoices!inner (document_type, company_id)
      `
      )
      .eq('invoices.company_id', params.companyId)
  ]);

  if (fieldsRes.error) throw fieldsRes.error;
  if (productsRes.error) throw productsRes.error;
  if (appsRes.error) throw appsRes.error;
  if (fuelItemsRes.error) throw fuelItemsRes.error;

  let avgFuelPrice: number | null = null;

  const fuelItems = fuelItemsRes.data || [];
  const targetCategories = ['petroleo', 'diesel'];

  const filtered = fuelItems.filter((item: any) => {
    const cat = String(item.category || '').toLowerCase();
    const name = String(item.products?.name || '').toLowerCase();
    return targetCategories.some((t) => cat.includes(t) || name.includes(t)) && !cat.includes('bencina') && !name.includes('gasolina');
  });

  const totalLiters = filtered.reduce((sum: number, item: any) => {
    const docType = String(item.invoices.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nc');
    const qty = Number(item.quantity || 0);
    return sum + (isNC ? -qty : qty);
  }, 0);

  const totalCost = filtered.reduce((sum: number, item: any) => {
    const docType = String(item.invoices.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nc');
    const cost = Number(item.total_price || 0);
    return sum + (isNC ? -cost : cost);
  }, 0);

  if (totalLiters > 0) {
    avgFuelPrice = totalCost / totalLiters;
  }

  return {
    fields: fieldsRes.data || [],
    products: productsRes.data || [],
    applications: appsRes.data || [],
    avgFuelPrice
  };
}

export async function deleteApplicationAndRestoreStock(params: { applicationId: string }) {
  const { error } = await supabase.rpc('delete_application_and_restore_stock', { target_application_id: params.applicationId });
  if (error) throw error;
}

export async function deleteAllApplicationsRestoreStock(params: { companyId: string }) {
  const { error } = await supabase.rpc('delete_all_applications_restore_stock', { target_company_id: params.companyId });
  if (error) throw error;
}

export async function updateApplicationInventory(payload: any) {
  const { error } = await supabase.rpc('update_application_inventory', payload);
  if (error) throw error;
}

export async function findFuelConsumptionForApplication(params: { applicationId: string }) {
  const { data, error } = await supabase.from('fuel_consumption').select('id').eq('application_id', params.applicationId).maybeSingle();
  if (error) throw error;
  return data as any | null;
}

export async function upsertFuelConsumptionForApplication(params: {
  companyId: string;
  applicationId: string;
  sectorId: string;
  date: string;
  liters: number;
  estimatedPrice: number;
  activity?: string;
}) {
  const existing = await findFuelConsumptionForApplication({ applicationId: params.applicationId });

  if (existing?.id) {
    const { error } = await supabase
      .from('fuel_consumption')
      .update({
        date: params.date,
        sector_id: params.sectorId,
        liters: params.liters,
        estimated_price: params.estimatedPrice
      })
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('fuel_consumption')
    .insert([
      {
        company_id: params.companyId,
        date: params.date,
        activity: params.activity || 'Aplicación (Automática)',
        liters: params.liters,
        estimated_price: params.estimatedPrice,
        sector_id: params.sectorId,
        application_id: params.applicationId
      }
    ])
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function createApplication(params: { payload: any }) {
  const { data, error } = await supabase.from('applications').insert([params.payload]).select().single();
  if (error) throw error;
  return data as any;
}

export async function createApplicationItem(params: { payload: any }) {
  const { data, error } = await supabase.from('application_items').insert([params.payload]).select().single();
  if (error) throw error;
  return data as any;
}

export async function updateProductCurrentStock(params: { productId: string; newStock: number }) {
  const { error } = await supabase.from('products').update({ current_stock: params.newStock }).eq('id', params.productId);
  if (error) throw error;
}

export async function insertInventoryMovement(params: { payload: any }) {
  const { error } = await supabase.from('inventory_movements').insert([params.payload]);
  if (error) throw error;
}
