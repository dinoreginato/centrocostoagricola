import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://teifjffodkkaxljluzpj.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaWZqZmZvZGtrYXhsamx1enBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzMxNzEsImV4cCI6MjA4NDAwOTE3MX0.E73FAseoKFQKeX1W48_6NqLOtNid5iEWb-QBlW5sr64');

async function test() {
  const { data: orders, error: fetchError } = await supabase
    .from('application_orders')
    .select(`
        *,
        field:fields(name),
        sector:sectors(name, hectares),
        items:application_order_items(
            *,
            product:products(name, unit, active_ingredient, category, average_cost)
        )
    `)
    .in('order_number', [8, 26]);
    
  if (fetchError) {
    console.error("Fetch error:", fetchError);
    return;
  }
  
  if (!orders || orders.length === 0) {
    console.error("No orders found");
    return;
  }
  
  for (const order of orders) {
    console.log(`\nTesting order ${order.order_number}...`);
    let totalCost = 0;
    const itemsData = order.items.map(item => {
        const unitCost = item.product?.average_cost || 0;
        const itemTotal = unitCost * item.total_quantity;
        totalCost += itemTotal;
        return {
            product_id: item.product_id,
            quantity_used: item.total_quantity,
            dose_per_hectare: item.dose_per_hectare,
            unit_cost: unitCost,
            total_cost: itemTotal
        };
    });

    const appInsert = {
        field_id: order.field_id,
        sector_id: order.sector_id,
        application_date: '2026-04-09',
        application_type: order.application_type,
        total_cost: Number(totalCost.toFixed(2)),
        water_liters_per_hectare: Number((order.water_liters_per_hectare || 0).toFixed(2))
    };
    
    console.log("App insert:", appInsert);
    const { data: application, error: appError } = await supabase
        .from('applications')
        .insert([appInsert])
        .select()
        .single();
        
    if (appError) {
      console.error("APP ERROR:", appError);
      continue;
    }
    
    console.log("App inserted:", application.id);
    
    for (const itemData of itemsData) {
        const itemInsert = {
            application_id: application.id,
            product_id: itemData.product_id,
            quantity_used: Number(itemData.quantity_used.toFixed(2)),
            dose_per_hectare: Number(itemData.dose_per_hectare.toFixed(2)),
            unit_cost: Number(itemData.unit_cost.toFixed(2)),
            total_cost: Number(itemData.total_cost.toFixed(2))
        };
        console.log("Inserting item:", itemInsert);
        const { data: savedItem, error: itemError } = await supabase
            .from('application_items')
            .insert([itemInsert])
            .select()
            .single();

        if (itemError) {
          console.error("ITEM ERROR:", itemError);
        } else {
          console.log("Item inserted:", savedItem.id);
        }
    }
    
    await supabase.from('applications').delete().eq('id', application.id);
  }
}
test();
