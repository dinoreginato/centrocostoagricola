import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://teifjffodkkaxljluzpj.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaWZqZmZvZGtrYXhsamx1enBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzMxNzEsImV4cCI6MjA4NDAwOTE3MX0.E73FAseoKFQKeX1W48_6NqLOtNid5iEWb-QBlW5sr64');

async function checkSchema() {
  const { data, error } = await supabase.from('applications').select('*').limit(1);
  if (error) console.error("Error fetching applications:", error.message);
  else console.log("Applications columns:", Object.keys(data[0] || {}));
}
checkSchema();
