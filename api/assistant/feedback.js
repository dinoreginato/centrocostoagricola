import { createClient } from '@supabase/supabase-js';

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function pickEnv(name, fallbacks = []) {
  const direct = process.env[name];
  if (direct) return direct;
  for (const key of fallbacks) {
    const v = process.env[key];
    if (v) return v;
  }
  return '';
}

function requireString(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildSupabaseClient(req) {
  const supabaseUrl = pickEnv('SUPABASE_URL', ['VITE_SUPABASE_URL']);
  const supabaseAnonKey = pickEnv('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Faltan variables de Supabase en el servidor');

  const authHeader = requireString(req.headers?.authorization);
  if (!authHeader.toLowerCase().startsWith('bearer ')) throw new Error('Falta Authorization Bearer token');

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        authorization: authHeader
      }
    }
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' });
      return;
    }

    const body = await readBody(req);
    const companyId = requireString(body.companyId);
    const userMessage = requireString(body.userMessage);
    const assistantMessage = requireString(body.assistantMessage);
    const correction = requireString(body.correction);
    const rating = Number(body.rating);

    if (!companyId) {
      json(res, 400, { error: 'companyId requerido' });
      return;
    }

    if (!userMessage || !assistantMessage) {
      json(res, 400, { error: 'userMessage y assistantMessage son requeridos' });
      return;
    }

    if (rating !== 1 && rating !== -1) {
      json(res, 400, { error: 'rating inválido' });
      return;
    }

    const supabase = buildSupabaseClient(req);
    const { error } = await supabase.from('assistant_feedback').insert([
      {
        company_id: companyId,
        user_message: userMessage,
        assistant_message: assistantMessage,
        rating,
        correction: correction || null
      }
    ]);

    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 500, { error: 'Error interno', detail: String(e?.message || e) });
  }
}

