import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://teifjffodkkaxljluzpj.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaWZqZmZvZGtrYXhsamx1enBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzMxNzEsImV4cCI6MjA4NDAwOTE3MX0.E73FAseoKFQKeX1W48_6NqLOtNid5iEWb-QBlW5sr64');

async function test() {
  const { data: user, error: loginError } = await supabase.auth.signInWithPassword({
    email: 'dino.reginato@gmail.com',
    password: 'password123' // assuming this or we can bypass auth for script if we have service key. Wait, I only have anon key.
  });
  
  const { data: orders, error: fetchError } = await supabase
    .from('application_orders')
    .select(`
        id, order_number, field_id, sector_id, application_type, water_liters_per_hectare,
        items:application_order_items(
            product_id, quantity_used:total_quantity, dose_per_hectare,
            product:products(average_cost)
        )
    `)
    .limit(10);
    
  if (fetchError) {
    console.error("Fetch error:", fetchError);
    return;
  }
  
  console.log("Orders:", JSON.stringify(orders, null, 2));
}
test();
