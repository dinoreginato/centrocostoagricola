
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://teifjffodkkaxljluzpj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaWZqZmZvZGtrYXhsamx1enBqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODQzMzE3MSwiZXhwIjoyMDg0MDA5MTcxfQ.jGEtaC3Xc1ohoKmKT1s6MnxNfK_4UaelwRQl2xz2vK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkYears() {
  console.log('Checking invoice years...');

  // 1. Get all companies
  const { data: companies } = await supabase.from('companies').select('id, name');
  
  if (!companies) {
      console.log('No companies found');
      return;
  }

  for (const company of companies) {
      console.log(`\nCompany: ${company.name} (${company.id})`);
      
      const { data: invoices } = await supabase
          .from('invoices')
          .select('invoice_date')
          .eq('company_id', company.id);
          
      if (invoices && invoices.length > 0) {
          const years = new Set(invoices.map(inv => inv.invoice_date.substring(0, 4)));
          console.log('Years found:', Array.from(years));
          console.log('Total invoices:', invoices.length);
          
          // Print sample dates
          console.log('Sample dates:', invoices.slice(0, 3).map(i => i.invoice_date));
      } else {
          console.log('No invoices found.');
      }
  }
}

checkYears();
