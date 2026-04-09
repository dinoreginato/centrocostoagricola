import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://teifjffodkkaxljluzpj.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaWZqZmZvZGtrYXhsamx1enBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzMxNzEsImV4cCI6MjA4NDAwOTE3MX0.E73FAseoKFQKeX1W48_6NqLOtNid5iEWb-QBlW5sr64');

async function test() {
  const { data: { session }, error: loginError } = await supabase.auth.signInWithPassword({
    email: 'dino.reginato@gmail.com',
    password: 'password123'
  });
  // Without password we can't test RLS. But wait, I can test with admin key if I had it.
}
