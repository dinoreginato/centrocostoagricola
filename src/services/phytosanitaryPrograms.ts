import { supabase } from '../supabase/client';

export async function loadPhytosanitaryProgramsData(params: { companyId: string }) {
  const [programsRes, eventsRes, eventProductsRes, inventoryRes] = await Promise.all([
    supabase.from('phytosanitary_programs').select('*').eq('company_id', params.companyId).order('created_at', { ascending: false }),
    supabase
      .from('program_events')
      .select('*, phytosanitary_programs!inner(company_id)')
      .eq('phytosanitary_programs.company_id', params.companyId),
    supabase
      .from('program_event_products')
      .select(
        `
        *,
        product:products(name, unit),
        program_events!inner(
          phytosanitary_programs!inner(company_id)
        )
      `
      )
      .eq('program_events.phytosanitary_programs.company_id', params.companyId),
    supabase.from('products').select('id, name, unit').eq('company_id', params.companyId).order('name')
  ]);

  if (programsRes.error) throw programsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (eventProductsRes.error) throw eventProductsRes.error;
  if (inventoryRes.error) throw inventoryRes.error;

  return {
    programs: programsRes.data || [],
    events: eventsRes.data || [],
    eventProducts: eventProductsRes.data || [],
    inventory: inventoryRes.data || []
  };
}

