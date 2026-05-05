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

function getSeasonRange(season) {
  const m = String(season || '').match(/(\d{4})\s*-\s*(\d{4})/);
  if (!m) return null;
  const startYear = Number(m[1]);
  const endYear = Number(m[2]);
  if (Number.isNaN(startYear) || Number.isNaN(endYear)) return null;
  const start = new Date(Date.UTC(startYear, 4, 1, 0, 0, 0));
  const end = new Date(Date.UTC(endYear, 3, 30, 23, 59, 59));
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  return { from, to };
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

async function fetchAssistantContext(supabase, companyId) {
  const [memRes, fbRes] = await Promise.all([
    supabase
      .from('assistant_memories')
      .select('kind, content, importance, created_at')
      .eq('company_id', companyId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('assistant_feedback')
      .select('user_message, assistant_message, rating, correction, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  const memories = memRes.error ? [] : memRes.data || [];
  const feedback = fbRes.error ? [] : fbRes.data || [];
  return { memories, feedback, warnings: [memRes.error, fbRes.error].filter(Boolean).map((e) => e.message || String(e)) };
}

async function toolSearchInvoices(supabase, args) {
  const companyId = requireString(args.companyId);
  const query = requireString(args.query);
  const limit = Math.max(1, Math.min(Number(args.limit || 25), 100));
  if (!companyId) throw new Error('companyId requerido');
  if (!query) throw new Error('query requerido');

  const q = query.trim();
  const isNumber = /^\d+$/.test(q);

  const base = supabase
    .from('invoices')
    .select('id, invoice_number, supplier, invoice_date, due_date, total_amount, status, document_type')
    .eq('company_id', companyId)
    .order('invoice_date', { ascending: false })
    .limit(limit);

  if (isNumber) {
    const { data, error } = await base.ilike('invoice_number', `%${q}%`);
    if (error) throw error;
    return { invoices: data || [] };
  }

  const [bySupplier, byNumber] = await Promise.all([
    base.ilike('supplier', `%${q}%`),
    base.ilike('invoice_number', `%${q}%`)
  ]);
  if (bySupplier.error) throw bySupplier.error;
  if (byNumber.error) throw byNumber.error;

  const byId = new Map();
  (bySupplier.data || []).forEach((r) => byId.set(r.id, r));
  (byNumber.data || []).forEach((r) => byId.set(r.id, r));
  return { invoices: Array.from(byId.values()).slice(0, limit) };
}

async function toolSearchProducts(supabase, args) {
  const companyId = requireString(args.companyId);
  const query = requireString(args.query);
  const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));
  if (!companyId) throw new Error('companyId requerido');
  if (!query) throw new Error('query requerido');

  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, unit, current_stock, average_cost')
    .eq('company_id', companyId)
    .ilike('name', `%${query}%`)
    .neq('category', 'Archivado')
    .order('name')
    .limit(limit);
  if (error) throw error;
  return { products: data || [] };
}

function getMonthRange(year, monthIndex0) {
  const start = new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 0, 23, 59, 59));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

async function toolGetInvoicesDue(supabase, args) {
  const companyId = requireString(args.companyId);
  if (!companyId) throw new Error('companyId requerido');

  const year = args.year ? Number(args.year) : new Date().getUTCFullYear();
  const month = args.month ? Number(args.month) : new Date().getUTCMonth() + 1;
  const status = requireString(args.status) || 'Pendiente';
  const limit = Math.max(1, Math.min(Number(args.limit || 50), 200));

  if (Number.isNaN(year) || year < 2000 || year > 2100) throw new Error('year inválido');
  if (Number.isNaN(month) || month < 1 || month > 12) throw new Error('month inválido');

  const range = getMonthRange(year, month - 1);

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, supplier, invoice_date, due_date, total_amount, status, document_type')
    .eq('company_id', companyId)
    .eq('status', status)
    .not('due_date', 'is', null)
    .gte('due_date', range.from)
    .lte('due_date', range.to)
    .order('due_date', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return { range, status, invoices: data || [] };
}

const ALLOWED_TABLES = new Set([
  'invoices',
  'invoice_items',
  'products',
  'fields',
  'sectors',
  'applications',
  'application_items',
  'labor_assignments',
  'worker_costs',
  'fuel_consumption',
  'fuel_assignments',
  'machinery_assignments',
  'irrigation_assignments',
  'general_costs',
  'income_entries',
  'inventory_movements'
]);

function isSafeIdent(value) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
}

async function toolSelectRows(supabase, args) {
  const companyId = requireString(args.companyId);
  const table = requireString(args.table);
  const select = requireString(args.select) || '*';
  const limit = Math.max(1, Math.min(Number(args.limit || 50), 200));
  const orderBy = requireString(args.orderBy);
  const orderAsc = args.orderAsc === undefined ? false : Boolean(args.orderAsc);
  const filters = Array.isArray(args.filters) ? args.filters : [];

  if (!companyId) throw new Error('companyId requerido');
  if (!table || !ALLOWED_TABLES.has(table)) throw new Error('table no permitido');
  if (orderBy && !isSafeIdent(orderBy)) throw new Error('orderBy inválido');

  let q = supabase.from(table).select(select).limit(limit);

  const applyCompany = async (query) => {
    try {
      const { data, error } = await query.eq('company_id', companyId);
      if (error) throw error;
      return { data };
    } catch (e) {
      return null;
    }
  };

  for (const f of filters) {
    const column = requireString(f?.column);
    const op = requireString(f?.op);
    const value = f?.value;
    if (!column || !isSafeIdent(column)) continue;
    if (op === 'eq') q = q.eq(column, value);
    else if (op === 'ilike') q = q.ilike(column, `%${requireString(value)}%`);
    else if (op === 'gte') q = q.gte(column, requireString(value));
    else if (op === 'lte') q = q.lte(column, requireString(value));
    else if (op === 'in' && Array.isArray(value)) q = q.in(column, value);
    else if (op === 'is') q = q.is(column, value);
  }

  if (orderBy) q = q.order(orderBy, { ascending: orderAsc });

  const tryWithCompany = await applyCompany(q);
  if (tryWithCompany) return { rows: tryWithCompany.data || [] };

  const { data, error } = await q;
  if (error) throw error;
  return { rows: data || [] };
}

async function safeSelectFuelConsumption(supabase, companyId, from, to) {
  const trySelect = async (columns) => {
    const { data, error } = await supabase
      .from('fuel_consumption')
      .select(columns)
      .eq('company_id', companyId)
      .gte('date', from)
      .lte('date', to);
    if (error) throw error;
    return data || [];
  };

  try {
    return { rows: await trySelect('sector_id, estimated_price, date, activity, liters, application_id'), warnings: [] };
  } catch (e1) {
    try {
      return { rows: await trySelect('sector_id, estimated_price, date, activity, liters'), warnings: [String(e1?.message || e1)] };
    } catch (e2) {
      return { rows: [], warnings: [String(e1?.message || e1), String(e2?.message || e2)] };
    }
  }
}

async function toolGetCostsSummary(supabase, args) {
  const companyId = requireString(args.companyId);
  const season = requireString(args.season);
  const range = args.range && typeof args.range === 'object' ? args.range : null;
  if (!companyId) throw new Error('companyId requerido');

  let from = null;
  let to = null;
  if (range && range.from && range.to) {
    from = requireString(range.from);
    to = requireString(range.to);
  } else if (season) {
    const r = getSeasonRange(season);
    if (r) {
      from = r.from;
      to = r.to;
    }
  }

  if (!from || !to) throw new Error('Se requiere season o range(from,to)');

  const fieldsRes = await supabase.from('fields').select('id, name, sectors(id, name, hectares)').eq('company_id', companyId);
  if (fieldsRes.error) throw fieldsRes.error;

  const fields = fieldsRes.data || [];
  const sectorMeta = new Map();
  fields.forEach((f) => {
    (f.sectors || []).forEach((s) => {
      sectorMeta.set(String(s.id), {
        sector_id: String(s.id),
        sector_name: String(s.name || ''),
        hectares: Number(s.hectares) || 0,
        field_id: String(f.id),
        field_name: String(f.name || '')
      });
    });
  });

  const sectorIds = Array.from(sectorMeta.keys());
  const empty = [];

  const [
    appsRes,
    laborRes,
    workerRes,
    fuelAssignRes,
    machineryRes,
    irrigationRes,
    generalRes
  ] = sectorIds.length
    ? await Promise.all([
        supabase.from('applications').select('sector_id, total_cost, application_date').in('sector_id', sectorIds).gte('application_date', from).lte('application_date', to),
        supabase.from('labor_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds).gte('assigned_date', from).lte('assigned_date', to),
        supabase.from('worker_costs').select('sector_id, amount, date').in('sector_id', sectorIds).gte('date', from).lte('date', to),
        supabase.from('fuel_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds).gte('assigned_date', from).lte('assigned_date', to),
        supabase.from('machinery_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds).gte('assigned_date', from).lte('assigned_date', to),
        supabase.from('irrigation_assignments').select('sector_id, assigned_amount, assigned_date').in('sector_id', sectorIds).gte('assigned_date', from).lte('assigned_date', to),
        supabase.from('general_costs').select('sector_id, amount, date').in('sector_id', sectorIds).gte('date', from).lte('date', to)
      ])
    : [{ data: empty }, { data: empty }, { data: empty }, { data: empty }, { data: empty }, { data: empty }, { data: empty }];

  const sumBy = (rows, keyField, valueField) => {
    const m = new Map();
    (rows || []).forEach((r) => {
      const k = String(r[keyField]);
      m.set(k, (m.get(k) || 0) + (Number(r[valueField]) || 0));
    });
    return m;
  };

  const appsBySector = sumBy(appsRes.data, 'sector_id', 'total_cost');
  const laborBySector = sumBy(laborRes.data, 'sector_id', 'assigned_amount');
  const workerBySector = sumBy(workerRes.data, 'sector_id', 'amount');
  const fuelBySector = sumBy(fuelAssignRes.data, 'sector_id', 'assigned_amount');
  const machineryBySector = sumBy(machineryRes.data, 'sector_id', 'assigned_amount');
  const irrigationBySector = sumBy(irrigationRes.data, 'sector_id', 'assigned_amount');
  const generalBySector = sumBy(generalRes.data, 'sector_id', 'amount');

  const fuelCons = await safeSelectFuelConsumption(supabase, companyId, from, to);
  fuelCons.rows.forEach((r) => {
    const k = String(r.sector_id);
    const cost = Number(r.estimated_price) || 0;
    if (!k) return;
    fuelBySector.set(k, (fuelBySector.get(k) || 0) + cost);
  });

  const sectors = [];
  sectorMeta.forEach((meta, sectorId) => {
    const row = {
      ...meta,
      applications: appsBySector.get(sectorId) || 0,
      labor: laborBySector.get(sectorId) || 0,
      workers: workerBySector.get(sectorId) || 0,
      fuel: fuelBySector.get(sectorId) || 0,
      machinery: machineryBySector.get(sectorId) || 0,
      irrigation: irrigationBySector.get(sectorId) || 0,
      distribution: generalBySector.get(sectorId) || 0
    };
    row.total =
      row.applications + row.labor + row.workers + row.fuel + row.machinery + row.irrigation + row.distribution;
    sectors.push(row);
  });

  const byField = new Map();
  sectors.forEach((s) => {
    const key = s.field_id;
    const existing =
      byField.get(key) ||
      ({
        field_id: s.field_id,
        field_name: s.field_name,
        hectares: 0,
        applications: 0,
        labor: 0,
        workers: 0,
        fuel: 0,
        machinery: 0,
        irrigation: 0,
        distribution: 0,
        total: 0
      });
    existing.hectares += Number(s.hectares) || 0;
    existing.applications += s.applications;
    existing.labor += s.labor;
    existing.workers += s.workers;
    existing.fuel += s.fuel;
    existing.machinery += s.machinery;
    existing.irrigation += s.irrigation;
    existing.distribution += s.distribution;
    existing.total += s.total;
    byField.set(key, existing);
  });

  const fieldsSummary = Array.from(byField.values()).sort((a, b) => b.total - a.total);

  return {
    range: { from, to },
    fields: fieldsSummary,
    sectors: sectors.sort((a, b) => (a.field_name + a.sector_name).localeCompare(b.field_name + b.sector_name)),
    warnings: [...fuelCons.warnings].filter(Boolean)
  };
}

async function toolSaveMemory(supabase, args) {
  const companyId = requireString(args.companyId);
  const content = requireString(args.content);
  const kind = requireString(args.kind) || 'preference';
  const importance = Math.max(1, Math.min(Number(args.importance || 1), 5));
  if (!companyId) throw new Error('companyId requerido');
  if (!content) throw new Error('content requerido');

  const { error } = await supabase.from('assistant_memories').insert([{ company_id: companyId, kind, content, importance }]);
  if (error) throw error;
  return { ok: true };
}

async function openaiChat(params) {
  const apiKey = pickEnv('OPENAI_API_KEY');
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY');
  const model = pickEnv('OPENAI_MODEL') || 'gpt-4o-mini';

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: params.messages,
      tools: params.tools,
      tool_choice: 'auto'
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || 'Error OpenAI';
    throw new Error(msg);
  }
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' });
      return;
    }

    const body = await readBody(req);
    const companyId = requireString(body.companyId);
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!companyId) {
      json(res, 400, { error: 'companyId requerido' });
      return;
    }

    const supabase = buildSupabaseClient(req);
    const ctx = await fetchAssistantContext(supabase, companyId);

    const system = {
      role: 'system',
      content: [
        'Eres el Asistente de AgroCostos.',
        'Puedes responder preguntas de cualquier ámbito (agricultura, contabilidad, gestión, etc.).',
        'Responde en español, con datos verificables.',
        'Si la pregunta no requiere datos del sistema, responde directamente sin usar herramientas.',
        'Si no tienes datos suficientes, pregunta por el período/temporada o el campo/sector y explica qué falta.',
        'No inventes números.',
        'Usa las herramientas disponibles para consultar datos.',
        ctx.memories.length ? `Memoria:\n${ctx.memories.map((m) => `- (${m.kind}) ${m.content}`).join('\n')}` : '',
        ctx.feedback.length
          ? `Feedback reciente:\n${ctx.feedback
              .filter((f) => f.rating === -1 && f.correction)
              .slice(0, 5)
              .map((f) => `- Corrección: ${f.correction}`)
              .join('\n')}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    };

    const toolDefs = [
      {
        type: 'function',
        function: {
          name: 'search_invoices',
          description: 'Busca facturas por número o proveedor (dentro de una empresa).',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyId: { type: 'string' },
              query: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['companyId', 'query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_invoices_due',
          description:
            'Lista facturas pendientes que vencen en un mes específico (por defecto el mes actual).',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyId: { type: 'string' },
              year: { type: 'number' },
              month: { type: 'number' },
              status: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['companyId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_products',
          description: 'Busca productos por nombre para ver stock y costo promedio.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyId: { type: 'string' },
              query: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['companyId', 'query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'select_rows',
          description:
            'Consulta filas de tablas del sistema de forma segura (solo lectura, con filtros y límite).',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyId: { type: 'string' },
              table: { type: 'string' },
              select: { type: 'string' },
              filters: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    column: { type: 'string' },
                    op: { type: 'string' },
                    value: {}
                  }
                }
              },
              orderBy: { type: 'string' },
              orderAsc: { type: 'boolean' },
              limit: { type: 'number' }
            },
            required: ['companyId', 'table']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_costs_summary',
          description:
            'Entrega un resumen de costos por campo/sector en un rango o temporada (aplicaciones, labores, trabajadores, combustible, maquinaria, riego, distribución).',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyId: { type: 'string' },
              season: { type: 'string' },
              range: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' }
                }
              }
            },
            required: ['companyId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'save_memory',
          description: 'Guarda una preferencia/corrección/regla para que el asistente la recuerde en el futuro.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyId: { type: 'string' },
              kind: { type: 'string' },
              content: { type: 'string' },
              importance: { type: 'number' }
            },
            required: ['companyId', 'content']
          }
        }
      }
    ];

    const convo = [system, ...messages]
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.text
      }))
      .filter((m) => m.role && typeof m.content === 'string' && m.content.length > 0);

    const toolHandlers = {
      search_invoices: (args) => toolSearchInvoices(supabase, args),
      get_invoices_due: (args) => toolGetInvoicesDue(supabase, args),
      search_products: (args) => toolSearchProducts(supabase, args),
      select_rows: (args) => toolSelectRows(supabase, args),
      get_costs_summary: (args) => toolGetCostsSummary(supabase, args),
      save_memory: (args) => toolSaveMemory(supabase, args)
    };

    let workingMessages = [...convo];
    let finalText = '';
    let warnings = ctx.warnings || [];

    for (let i = 0; i < 4; i++) {
      const completion = await openaiChat({ messages: workingMessages, tools: toolDefs });
      const choice = completion?.choices?.[0];
      const msg = choice?.message || {};
      const toolCalls = msg.tool_calls || [];

      if (toolCalls.length === 0) {
        finalText = String(msg.content || '').trim();
        break;
      }

      workingMessages.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: toolCalls
      });

      for (const call of toolCalls) {
        const name = call?.function?.name;
        const rawArgs = call?.function?.arguments || '{}';
        const parsed = (() => {
          try {
            return JSON.parse(rawArgs);
          } catch {
            return {};
          }
        })();

        const handlerFn = toolHandlers[name];
        if (!handlerFn) {
          workingMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Tool no soportada: ${name}` })
          });
          continue;
        }

        try {
          const result = await handlerFn({ companyId, ...parsed });
          if (result?.warnings && Array.isArray(result.warnings)) warnings = [...warnings, ...result.warnings];
          workingMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result || {})
          });
        } catch (e) {
          workingMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: String(e?.message || e) })
          });
        }
      }
    }

    if (!finalText) {
      finalText = 'No pude generar una respuesta. Prueba reformulando la pregunta o indicando la temporada.';
    }

    json(res, 200, { answer: finalText, warnings: warnings.filter(Boolean).slice(0, 5) });
  } catch (e) {
    json(res, 500, { error: 'Error interno', detail: String(e?.message || e) });
  }
}
