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

export async function upsertPhytosanitaryProgram(params: { companyId: string; programId?: string | null; payload: { name: string; season: string; description: string } }) {
  const basePayload = {
    company_id: params.companyId,
    name: params.payload.name,
    season: params.payload.season,
    description: params.payload.description
  };

  if (params.programId) {
    const { error } = await supabase.from('phytosanitary_programs').update(basePayload).eq('id', params.programId);
    if (error) throw error;
    return params.programId;
  }

  const { data, error } = await supabase.from('phytosanitary_programs').insert([basePayload]).select().single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deletePhytosanitaryProgram(params: { programId: string }) {
  const { error } = await supabase.from('phytosanitary_programs').delete().eq('id', params.programId);
  if (error) throw error;
}

export async function upsertProgramEvent(params: { programId: string; eventId?: string | null; payload: { stage_name: string; objective: string; water_per_ha: number } }) {
  const basePayload = {
    program_id: params.programId,
    stage_name: params.payload.stage_name,
    objective: params.payload.objective,
    water_per_ha: params.payload.water_per_ha
  };

  if (params.eventId) {
    const { error } = await supabase.from('program_events').update(basePayload).eq('id', params.eventId);
    if (error) throw error;
    return params.eventId;
  }

  const { data, error } = await supabase.from('program_events').insert([basePayload]).select().single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteProgramEvent(params: { eventId: string }) {
  const { error } = await supabase.from('program_events').delete().eq('id', params.eventId);
  if (error) throw error;
}

export async function upsertProgramEventProduct(params: { eventId: string; eventProductId?: string | null; payload: { product_id: string; dose: number; dose_unit: string } }) {
  const basePayload = {
    event_id: params.eventId,
    product_id: params.payload.product_id,
    dose: params.payload.dose,
    dose_unit: params.payload.dose_unit
  };

  if (params.eventProductId) {
    const { error } = await supabase.from('program_event_products').update(basePayload).eq('id', params.eventProductId);
    if (error) throw error;
    return params.eventProductId;
  }

  const { data, error } = await supabase.from('program_event_products').insert([basePayload]).select().single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteProgramEventProduct(params: { eventProductId: string }) {
  const { error } = await supabase.from('program_event_products').delete().eq('id', params.eventProductId);
  if (error) throw error;
}
