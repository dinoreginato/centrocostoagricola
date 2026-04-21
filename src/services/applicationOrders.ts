import { supabase } from '../supabase/client';

export async function loadApplicationOrdersPageData(params: { companyId: string; agrochemicalCategories: string[] }) {
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

  const mappedOrders =
    ordersData?.map((o: any) => ({
      ...o,
      items: Array.isArray(o.items)
        ? o.items.map((i: any) => ({
            id: i.id,
            product_id: i.product_id,
            product_name: i.product?.name,
            active_ingredient: i.product?.active_ingredient,
            category: i.product?.category,
            average_cost: i.product?.average_cost || 0,
            unit: i.unit,
            dose_per_hectare: i.dose_per_hectare,
            dose_per_100l: i.dose_per_100l,
            total_quantity: i.total_quantity,
            objective: i.objective
          }))
        : []
    })) || [];

  const [fieldsRes, productsRes, machinesRes, workersRes, progRes] = await Promise.all([
    supabase.from('fields').select('*, sectors(*)').eq('company_id', params.companyId),
    supabase
      .from('products')
      .select('*')
      .eq('company_id', params.companyId)
      .in('category', params.agrochemicalCategories)
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

  let programEvents: any[] = [];

  const progData = progRes.data || [];
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
        progData.map((p: any) => p.id)
      );

    if (evError) throw evError;
    programEvents = evData || [];
  }

  return {
    orders: mappedOrders,
    fields: fieldsRes.data || [],
    products: productsRes.data || [],
    machines: machinesRes.data || [],
    workers: workersRes.data || [],
    programEvents
  };
}

export async function upsertApplicationOrder(params: { orderId?: string | null; orderData: any; itemsData: any[] }) {
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
  return data && data.length > 0 ? (data[0] as any).id : null;
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

export async function createApplication(params: { payload: any }) {
  const { data, error } = await supabase.from('applications').insert([params.payload]).select().single();
  if (error) throw error;
  return data;
}

export async function createApplicationItem(params: { payload: any }) {
  const { data, error } = await supabase.from('application_items').insert([params.payload]).select().single();
  if (error) throw error;
  return data;
}

export async function updateProductStock(params: { productId: string; currentStock: number }) {
  const { error } = await supabase.from('products').update({ current_stock: params.currentStock }).eq('id', params.productId);
  if (error) throw error;
}

export async function createInventoryMovement(params: { payload: any }) {
  const { error } = await supabase.from('inventory_movements').insert([params.payload]);
  if (error) throw error;
}

export async function getFuelStats(params: { companyId: string; type: string }) {
  const { data, error } = await supabase.rpc('get_fuel_stats', { p_company_id: params.companyId, p_type: params.type });
  if (error) throw error;
  return data || [];
}

export async function createFuelConsumption(params: { payload: any }) {
  const { error } = await supabase.from('fuel_consumption').insert([params.payload]);
  if (error) throw error;
}

export async function markApplicationOrderCompleted(params: { orderId: string; completedDate: string }) {
  const { error } = await supabase.from('application_orders').update({ status: 'completada', completed_date: params.completedDate }).eq('id', params.orderId);
  if (error) throw error;
}
