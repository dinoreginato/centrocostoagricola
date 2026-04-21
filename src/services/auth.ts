import { supabase } from '../supabase/client';

export async function resetPasswordForEmail(params: { email: string; redirectTo: string }) {
  const { error } = await supabase.auth.resetPasswordForEmail(params.email, { redirectTo: params.redirectTo });
  if (error) throw error;
}

export async function signUpWithEmail(params: { email: string; password: string }) {
  const { data, error } = await supabase.auth.signUp({ email: params.email, password: params.password });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(params: { email: string; password: string }) {
  const { error } = await supabase.auth.signInWithPassword({ email: params.email, password: params.password });
  if (error) throw error;
}

export async function updateUserPassword(params: { password: string }) {
  const { error } = await supabase.auth.updateUser({ password: params.password });
  if (error) throw error;
}

