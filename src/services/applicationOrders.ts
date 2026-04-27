import { supabase } from '../supabase/client';
import { filterAgrochemicalProducts } from '../lib/agrochemicals';

export type ApplicationOrderStatus = 'pendiente' | 'completada' | 'cancelada';

export type ApplicationOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  dose_per_hectare: number;
  dose_per_100l?: number | null;
  total_quantity: number;
  objective?: string | null;
  active_ingredient?: string | null;
  category?: string | null;
  average_cost?: number | null;
};

export type ApplicationOrder = {
  id: string;
  company_id: string;
  order_number: number;
  scheduled_date: string;
  completed_date?: string | null;
  status: ApplicationOrderStatus;
  field_id: string;
  sector_id: string;
  application_type: string;
  water_liters_per_hectare: number;
  tank_capacity: number;
  tractor_id?: string | null;
  sprayer_id?: string | null;
  tractor_driver_id?: string | null;
  speed?: number | null;
  pressure?: number | null;
  rpm?: number | null;
  nozzles?: string | null;
  notes?: string | null;
  safety_period_hours?: number | null;
  grace_period_days?: number | null;
  protection_days?: number | null;
  variety?: string | null;
  objective?: string | null;
  field?: { name: string } | null;
  sector?: { name: string; hectares: number } | null;
  tractor?: { name: string } | null;
  sprayer?: { name: string } | null;
  driver?: { name: string } | null;
  items: ApplicationOrderItem[];
};

export type FieldWithSectors = {
  id: string;
  name: string;
  sectors: Array<{ id: string; name: string; hectares: number }>;
};

export type ProductRow = {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  category: string;
  average_cost: number;
  active_ingredient?: string | null;
};

export type MachineRow = { id: string; name: string; type: string };
export type WorkerRow = { id: string; name: string; role: string };

export type ProgramEventForOrder = {
  id: string;
  program_id: string;
  stage_name?: string | null;
  phytosanitary_programs?: { name?: string | null } | null;
  products?: Array<{
    id: string;
    product_id: string;
    dose?: number | null;
    dose_unit?: string | null;
    product?: ProductRow | null;
  }> | null;
};

type RawOrderItem = {
  id: string;
  product_id: string;
  unit: string;
  dose_per_hectare: number;
  dose_per_100l?: number | null;
  total_quantity: number;
  objective?: string | null;
  product?: { name?: string | null; unit?: string | null; active_ingredient?: string | null; category?: string | null; average_cost?: number | null } | null;
};

type RawOrder = Omit<ApplicationOrder, 'items' | 'field' | 'sector' | 'tractor' | 'sprayer' | 'driver'> & {
  field?: { name: string } | null;
  sector?: { name: string; hectares: number } | null;
  tractor?: { name: string } | null;
  sprayer?: { name: string } | null;
  driver?: { name: string } | null;
  items?: RawOrderItem[] | null;
};

export async function loadApplicationOrdersPageData(params: {
  companyId: string;
}): Promise<{
  orders: ApplicationOrder[];
  fields: FieldWithSectors[];
  products: ProductRow[];
  machines: MachineRow[];
  workers: WorkerRow[];
  programEvents: ProgramEventForOrder[];
}> {
  const { data: ordersData, error: ordersError } = await supabase
    .from('application_orders')
    .select(
      `
      *,
      field:fields(name),
      sector:sectors(name, hectares),
      tractor:machines!application_orders_tractor_id_fkey(name),
      sprayer:machines!application_orders_sprayer_id_fkey(name),
      driver:workers(name),
      items:application_order_items(
        *,
        product:products(name, unit, active_ingredient, category, average_cost)
      )
    `
    )
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (ordersError) throw ordersError;

  const mappedOrders: ApplicationOrder[] = ((ordersData || []) as unknown as RawOrder[]).map((o) => {
    const { items, ...rest } = o;
    const base = rest as unknown as Omit<ApplicationOrder, 'items'>;
    return {
      ...base,
      items: Array.isArray(items)
        ? items.map((i) => ({
            id: i.id,
            product_id: i.product_id,
            product_name: i.product?.name ?? '',
            active_ingredient: i.product?.active_ingredient ?? null,
            category: i.product?.category ?? null,
            average_cost: i.product?.average_cost ?? 0,
            unit: i.unit,
            dose_per_hectare: i.dose_per_hectare,
            dose_per_100l: i.dose_per_100l ?? null,
            total_quantity: i.total_quantity,
            objective: i.objective ?? null
          }))
        : []
    } as ApplicationOrder;
  });

  const [fieldsRes, productsRes, machinesRes, workersRes, progRes] = await Promise.all([
    supabase.from('fields').select('*, sectors(*)').eq('company_id', params.companyId),
    supabase
      .from('products')
      .select('*')
      .eq('company_id', params.companyId)
      .neq('category', 'Archivado')
      .gt('current_stock', 0),
    supabase.from('machines').select('id, name, type').eq('company_id', params.companyId).eq('is_active', true),
    supabase.from('workers').select('id, name, role').eq('company_id', params.companyId).eq('is_active', true),
    supabase.from('phytosanitary_programs').select('*').eq('company_id', params.companyId).order('created_at', { ascending: false })
  ]);

  if (fieldsRes.error) throw fieldsRes.error;
  if (productsRes.error) throw productsRes.error;
  if (machinesRes.error) throw machinesRes.error;
  if (workersRes.error) throw workersRes.error;
  if (progRes.error) throw progRes.error;

  let programEvents: ProgramEventForOrder[] = [];

  const progData = (progRes.data || []) as Array<{ id: string }>;
  if (progData.length > 0) {
    const { data: evData, error: evError } = await supabase
      .from('program_events')
      .select(
        `
        *,
        products:program_event_products(
          *,
          product:products(*)
        )
      `
      )
      .in(
        'program_id',
        progData.map((p) => p.id)
      );

    if (evError) throw evError;
    programEvents = (evData || []) as unknown as ProgramEventForOrder[];
  }

  return {
    orders: mappedOrders,
    fields: (fieldsRes.data || []) as unknown as FieldWithSectors[],
    products: filterAgrochemicalProducts((productsRes.data || []) as unknown as ProductRow[]),
    machines: (machinesRes.data || []) as unknown as MachineRow[],
    workers: (workersRes.data || []) as unknown as WorkerRow[],
    programEvents
  };
}

export type ApplicationOrderUpsert = Omit<ApplicationOrder, 'id' | 'items' | 'field' | 'sector' | 'tractor' | 'sprayer' | 'driver'>;
export type ApplicationOrderItemUpsert = Omit<ApplicationOrderItem, 'id' | 'product_name' | 'active_ingredient' | 'category' | 'average_cost'>;

export type ApplicationOrderUpsertInput = Omit<ApplicationOrderUpsert, 'order_number'> & { order_number?: number };

export async function upsertApplicationOrder(params: { orderId?: string | null; orderData: ApplicationOrderUpsertInput; itemsData: ApplicationOrderItemUpsert[] }) {
  let orderId = params.orderId || null;

  if (orderId) {
    const { error } = await supabase.from('application_orders').update(params.orderData).eq('id', orderId);
    if (error) throw error;
    const { error: deleteItemsError } = await supabase.from('application_order_items').delete().eq('order_id', orderId);
    if (deleteItemsError) throw deleteItemsError;
  } else {
    const { data, error } = await supabase.from('application_orders').insert([params.orderData]).select().single();
    if (error) throw error;
    orderId = data.id;
  }

  if (params.itemsData.length > 0) {
    const { error: itemsError } = await supabase.from('application_order_items').insert(params.itemsData.map((i) => ({ ...i, order_id: orderId })));
    if (itemsError) throw itemsError;
  }

  return orderId as string;
}

export async function revertApplicationOrderToPending(params: { orderId: string }) {
  const { error } = await supabase.from('application_orders').update({ status: 'pendiente', completed_date: null }).eq('id', params.orderId);
  if (error) throw error;
}

export async function findCompletedOrderApplicationId(params: { sectorId: string; completedDate: string; applicationType: string }) {
  const { data, error } = await supabase
    .from('applications')
    .select('id')
    .eq('sector_id', params.sectorId)
    .eq('application_date', params.completedDate)
    .eq('application_type', params.applicationType);

  if (error) throw error;
  return data && data.length > 0 ? (data[0] as { id: string }).id : null;
}

export async function deleteApplicationByIdCascade(params: { applicationId: string }) {
  const { error: itemsError } = await supabase.from('application_items').delete().eq('application_id', params.applicationId);
  if (itemsError) throw itemsError;
  const { error: fuelError } = await supabase.from('fuel_consumption').delete().eq('application_id', params.applicationId);
  if (fuelError) throw fuelError;
  const { error: appError } = await supabase.from('applications').delete().eq('id', params.applicationId);
  if (appError) throw appError;
}

export async function deleteApplicationOrderCascade(params: { orderId: string; completedApplicationId?: string | null }) {
  if (params.completedApplicationId) {
    await deleteApplicationByIdCascade({ applicationId: params.completedApplicationId });
  }

  const { error: itemsError } = await supabase.from('application_order_items').delete().eq('order_id', params.orderId);
  if (itemsError) throw itemsError;

  const { error } = await supabase.from('application_orders').delete().eq('id', params.orderId);
  if (error) throw error;
}

export type ApplicationInsert = {
  field_id: string;
  sector_id: string;
  application_date: string;
  application_type: string;
  total_cost: number;
  water_liters_per_hectare: number;
};

export async function createApplication(params: { payload: ApplicationInsert }) {
  const { data, error } = await supabase.from('applications').insert([params.payload]).select().single();
  if (error) throw error;
  return data as { id: string };
}

export type ApplicationItemInsert = {
  application_id: string;
  product_id: string;
  quantity_used: number;
  dose_per_hectare: number;
  unit_cost: number;
  total_cost: number;
  objective?: string;
};

export async function createApplicationItem(params: { payload: ApplicationItemInsert }) {
  const { data, error } = await supabase.from('application_items').insert([params.payload]).select().single();
  if (error) throw error;
  return data as { id: string };
}

export async function updateProductStock(params: { productId: string; currentStock: number }) {
  const { error } = await supabase.from('products').update({ current_stock: params.currentStock }).eq('id', params.productId);
  if (error) throw error;
}

export type InventoryMovementInsert = {
  product_id: string;
  movement_type: 'salida' | 'entrada';
  quantity: number;
  unit_cost: number;
  application_item_id?: string;
};

export async function createInventoryMovement(params: { payload: InventoryMovementInsert }) {
  const { error } = await supabase.from('inventory_movements').insert([params.payload]);
  if (error) throw error;
}

export async function getFuelStats(params: { companyId: string; type: string }) {
  const { data, error } = await supabase.rpc('get_fuel_stats', { p_company_id: params.companyId, p_type: params.type });
  if (error) throw error;
  return (data || []) as Array<{ avg_price?: number | null }>;
}

export type FuelConsumptionInsert = {
  company_id: string;
  date: string;
  activity: string;
  liters: number;
  estimated_price: number;
  sector_id: string;
  application_id?: string | null;
};

export async function createFuelConsumption(params: { payload: FuelConsumptionInsert }) {
  const { error } = await supabase.from('fuel_consumption').insert([params.payload]);
  if (error) throw error;
}

export async function markApplicationOrderCompleted(params: { orderId: string; completedDate: string }) {
  const { error } = await supabase.from('application_orders').update({ status: 'completada', completed_date: params.completedDate }).eq('id', params.orderId);
  if (error) throw error;
}
