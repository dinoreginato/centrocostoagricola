
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://teifjffodkkaxljluzpj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaWZqZmZvZGtrYXhsamx1enBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzMxNzEsImV4cCI6MjA4NDAwOTE3MX0.E73FAseoKFQKeX1W48_6NqLOtNid5iEWb-QBlW5sr64';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkInvoice() {
  console.log('Checking invoice #6310288...');

  // 1. Get the invoice ID
  const { data: invoice, error: invError } = await supabase
    .from('invoices')
    .select('*')
    .eq('invoice_number', '6310288')
    .single();

  if (invError) {
    console.error('Error fetching invoice:', invError);
    return;
  }

  if (!invoice) {
    console.log('Invoice not found!');
    return;
  }

  console.log('Invoice found:', invoice.id);
  console.log('Total Amount:', invoice.total_amount);

  // 2. Get items for this invoice
  const { data: items, error: itemsError } = await supabase
    .from('invoice_items')
    .select('*, products(*)')
    .eq('invoice_id', invoice.id);

  if (itemsError) {
    console.error('Error fetching items:', itemsError);
    return;
  }

  console.log(`Found ${items.length} items for this invoice.`);
  
  if (items.length > 0) {
      console.log('First item sample:', JSON.stringify(items[0], null, 2));
  } else {
      console.log('WARNING: Invoice has NO items linked in the database.');
  }
}

checkInvoice();
