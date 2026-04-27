import { supabase } from '../supabase/client';

export async function supabaseRpc<TData = unknown>(fn: string, args?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn as never, (args ?? {}) as never);
  if (error) throw error;
  return data as TData;
}

