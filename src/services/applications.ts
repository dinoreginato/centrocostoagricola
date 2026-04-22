import { supabase } from '../supabase/client';

type ApplicationFieldSector = {
  id: string;
  name: string;
  hectares: number;
  field_id?: string;
};

type ApplicationField = {
  id: string;
  name: string;
  sectors: ApplicationFieldSector[];
  total_hectares?: number;
  fruit_type?: string;
  latitude?: number | null;
  longitude?: number | null;
  company_id?: string;
};

type ApplicationProduct = {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  average_cost: number;
  category: string;
  active_ingredient?: string | null;
  company_id?: string;
};

type ApplicationHistoryItem = {
  product_id: string;
  product_name: string;
  quantity_used: number;
  dose_per_hectare: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  objective?: string | null;
};

type ApplicationHistory = {
  id: string;
  application_date: string;
  application_type: string;
  total_cost: number;
  water_liters_per_hectare: number;
  field_id: string;
  field_name: string;
  sector_id: string;
  sector_name: string;
  sector_hectares: number;
  items: ApplicationHistoryItem[];
};

type FuelItemForAvg = {
  quantity: number | null;
  total_price: number | null;
  category: string | null;
  products?: { name: string | null } | { name: string | null }[] | null;
  invoices: { document_type: string | null; company_id: string | null } | { document_type: string | null; company_id: string | null }[];
};

function pickFirst<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export type UpdateApplicationInventoryParams = {
  p_application_id: string;
  p_field_id: string;
  p_sector_id: string;
  p_date: string;
  p_type: string;
  p_water_rate: number;
  p_total_cost: number;
  p_items: Array<{
    product_id: string;
    quantity_used: number;
    dose_per_hectare: number;
    unit_cost: number;
    total_cost: number;
    objective?: string;
  }>;
};

export type ApplicationInsert = {
  field_id: string;
  sector_id: string;
  application_date: string;
  application_type: string;
  total_cost: number;
  water_liters_per_hectare: number;
};

export type ApplicationItemInsert = {
  application_id: string;
  product_id: string;
  quantity_used: number;
  dose_per_hectare: number;
  unit_cost: number;
  total_cost: number;
  objective?: string;
};

export type InventoryMovementInsert = {
  product_id: string;
  movement_type: 'salida' | 'entrada';
  quantity: number;
  unit_cost: number;
  application_item_id?: string;
  invoice_item_id?: string;
};

type FuelConsumptionIdRow = { id: string };

export async function loadApplicationsPageData(params: { companyId: string; agrochemicalCategories: string[] }): Promise<{
  fields: ApplicationField[];
  products: ApplicationProduct[];
  applications: ApplicationHistory[];
  avgFuelPrice: number | null;
}> {
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

  const fuelItems = (fuelItemsRes.data || []) as unknown as FuelItemForAvg[];
  const targetCategories = ['petroleo', 'diesel'];

  const filtered = fuelItems.filter((item) => {
    const cat = String(item.category || '').toLowerCase();
    const product = pickFirst(item.products);
    const name = String(product?.name || '').toLowerCase();
    return targetCategories.some((t) => cat.includes(t) || name.includes(t)) && !cat.includes('bencina') && !name.includes('gasolina');
  });

  const totalLiters = filtered.reduce((sum: number, item) => {
    const inv = pickFirst(item.invoices);
    const docType = String(inv?.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nc');
    const qty = Number(item.quantity || 0);
    return sum + (isNC ? -qty : qty);
  }, 0);

  const totalCost = filtered.reduce((sum: number, item) => {
    const inv = pickFirst(item.invoices);
    const docType = String(inv?.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nc');
    const cost = Number(item.total_price || 0);
    return sum + (isNC ? -cost : cost);
  }, 0);

  if (totalLiters > 0) {
    avgFuelPrice = totalCost / totalLiters;
  }

  return {
    fields: (fieldsRes.data || []) as unknown as ApplicationField[],
    products: (productsRes.data || []) as ApplicationProduct[],
    applications: (appsRes.data || []) as ApplicationHistory[],
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

export async function updateApplicationInventory(payload: UpdateApplicationInventoryParams) {
  const { error } = await supabase.rpc('update_application_inventory', payload);
  if (error) throw error;
}

export async function findFuelConsumptionForApplication(params: { applicationId: string }): Promise<FuelConsumptionIdRow | null> {
  const { data, error } = await supabase.from('fuel_consumption').select('id').eq('application_id', params.applicationId).maybeSingle();
  if (error) throw error;
  return (data as FuelConsumptionIdRow | null) || null;
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
  return (data as FuelConsumptionIdRow).id;
}

export async function createApplication(params: { payload: ApplicationInsert }): Promise<{ id: string }> {
  const { data, error } = await supabase.from('applications').insert([params.payload]).select().single();
  if (error) throw error;
  return data as { id: string };
}

export async function createApplicationItem(params: { payload: ApplicationItemInsert }): Promise<{ id: string }> {
  const { data, error } = await supabase.from('application_items').insert([params.payload]).select().single();
  if (error) throw error;
  return data as { id: string };
}

export async function updateProductCurrentStock(params: { productId: string; newStock: number }) {
  const { error } = await supabase.from('products').update({ current_stock: params.newStock }).eq('id', params.productId);
  if (error) throw error;
}

export async function insertInventoryMovement(params: { payload: InventoryMovementInsert }) {
  const { error } = await supabase.from('inventory_movements').insert([params.payload]);
  if (error) throw error;
}
