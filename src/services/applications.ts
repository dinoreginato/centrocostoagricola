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
