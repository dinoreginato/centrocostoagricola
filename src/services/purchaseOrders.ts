import { supabase } from '../supabase/client';

export type PurchaseOrderStatus = 'Borrador' | 'Enviada' | 'Cancelada';

export type PurchaseOrderRow = {
  id: string;
  company_id: string;
  order_number: string | null;
  supplier_name: string;
  order_date: string;
  status: PurchaseOrderStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderItemRow = {
  id: string;
  company_id: string;
  purchase_order_id: string;
  product_id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
  notes: string | null;
  created_at: string;
};

export type PurchaseOrderCreateInput = {
  companyId: string;
  orderNumber?: string | null;
  supplierName: string;
  orderDate: string;
  status?: PurchaseOrderStatus;
  notes?: string | null;
  items: Array<{
    productId: string;
    productName: string;
    unit?: string | null;
    quantity: number;
    unitPrice?: number | null;
    notes?: string | null;
  }>;
};

export async function fetchPurchaseOrders(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('company_id', params.companyId)
    .order('order_date', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as unknown as PurchaseOrderRow[];
}

export async function fetchPurchaseOrder(params: { orderId: string }) {
  const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', params.orderId).maybeSingle();
  if (error) throw error;
  return (data || null) as unknown as PurchaseOrderRow | null;
}

export async function fetchPurchaseOrderItems(params: { orderId: string }) {
  const { data, error } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', params.orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as PurchaseOrderItemRow[];
}

export async function createPurchaseOrder(params: PurchaseOrderCreateInput) {
  const { data: created, error: createErr } = await supabase
    .from('purchase_orders')
    .insert([
      {
        company_id: params.companyId,
        order_number: params.orderNumber ?? null,
        supplier_name: params.supplierName,
        order_date: params.orderDate,
        status: params.status ?? 'Borrador',
        notes: params.notes ?? null,
      },
    ])
    .select('*')
    .single();

  if (createErr) throw createErr;

  const order = created as unknown as PurchaseOrderRow;

  try {
    const rows = params.items.map((it) => {
      const qty = Number(it.quantity);
      const price = it.unitPrice == null ? null : Number(it.unitPrice);
      const lineTotal = price == null ? null : qty * price;
      return {
        company_id: params.companyId,
        purchase_order_id: order.id,
        product_id: it.productId,
        product_name: it.productName,
        unit: it.unit ?? null,
        quantity: qty,
        unit_price: price,
        line_total: lineTotal,
        notes: it.notes ?? null,
      };
    });

    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(rows);
    if (itemsErr) throw itemsErr;
  } catch (e) {
    await supabase.from('purchase_orders').delete().eq('id', order.id);
    throw e;
  }

  return order;
}

export async function updatePurchaseOrder(params: {
  orderId: string;
  patch: Partial<Pick<PurchaseOrderRow, 'order_number' | 'supplier_name' | 'order_date' | 'status' | 'notes'>>;
}) {
  const { error } = await supabase.from('purchase_orders').update(params.patch).eq('id', params.orderId);
  if (error) throw error;
}

export async function replacePurchaseOrderItems(params: {
  companyId: string;
  orderId: string;
  items: PurchaseOrderCreateInput['items'];
}) {
  const { error: delErr } = await supabase.from('purchase_order_items').delete().eq('purchase_order_id', params.orderId);
  if (delErr) throw delErr;

  if (!params.items || params.items.length === 0) return;

  const rows = params.items.map((it) => {
    const qty = Number(it.quantity);
    const price = it.unitPrice == null ? null : Number(it.unitPrice);
    const lineTotal = price == null ? null : qty * price;
    return {
      company_id: params.companyId,
      purchase_order_id: params.orderId,
      product_id: it.productId,
      product_name: it.productName,
      unit: it.unit ?? null,
      quantity: qty,
      unit_price: price,
      line_total: lineTotal,
      notes: it.notes ?? null,
    };
  });

  const { error: insErr } = await supabase.from('purchase_order_items').insert(rows);
  if (insErr) throw insErr;
}

export async function deletePurchaseOrder(params: { orderId: string }) {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', params.orderId);
  if (error) throw error;
}

