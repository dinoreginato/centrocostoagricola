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
    .select('id, invoice_number, supplier, invoice_date, due_date, total_amount, status, document_type, notes')
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

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function formatCLP(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function monthNameES(month) {
  const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return names[month - 1] || '';
}

function parseSeason(text) {
  const m = normalize(text).match(/(\d{4})\s*-\s*(\d{4})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}`;
}

function parseMonthYear(text) {
  const t = normalize(text);
  const months = {
    enero: 1,
    feb: 2,
    febrero: 2,
    mar: 3,
    marzo: 3,
    abr: 4,
    abril: 4,
    may: 5,
    mayo: 5,
    jun: 6,
    junio: 6,
    jul: 7,
    julio: 7,
    ago: 8,
    agosto: 8,
    sep: 9,
    sept: 9,
    septiembre: 9,
    oct: 10,
    octubre: 10,
    nov: 11,
    noviembre: 11,
    dic: 12,
    diciembre: 12
  };

  for (const [k, v] of Object.entries(months)) {
    const re = new RegExp(`\\b${k}\\b\\s*(\\d{4})`);
    const m = t.match(re);
    if (m) return { month: v, year: Number(m[1]) };
  }

  if (t.includes('este mes')) {
    const now = new Date();
    return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
  }

  return null;
}

function parseLearnCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.toLowerCase().startsWith('aprende:')) return null;
  const rest = raw.slice('aprende:'.length).trim();
  const parts = rest.split('=>');
  if (parts.length !== 2) return null;
  const alias = parts[0].trim().replace(/^"(.*)"$/, '$1').trim();
  const intent = parts[1].trim();
  if (!alias || !intent) return null;
  return { alias, intent };
}

function parseFieldQuery(text) {
  const raw = String(text || '');
  const quoted = raw.match(/"(.*?)"/);
  if (quoted && quoted[1]) return quoted[1].trim();
  const m = raw.match(/campo\s+(.+)$/i);
  if (!m || !m[1]) return '';
  return String(m[1])
    .trim()
    .replace(/^el\s+/i, '')
    .replace(/^la\s+/i, '')
    .replace(/^de\s+/i, '')
    .replace(/^del\s+/i, '')
    .replace(/[?¿!.,;:]+/g, '')
    .trim();
}

async function getLastApplicationForField(supabase, companyId, fieldQuery) {
  const q = String(fieldQuery || '').trim();
  if (!q) return { error: 'Dime el nombre del campo. Ej: “última aplicación en campo La Palma”.' };

  const { data: fields, error: fieldsError } = await supabase
    .from('fields')
    .select('id, name')
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(250);
  if (fieldsError) throw fieldsError;
  const qn = normalize(q);
  const candidates = (fields || []).filter((f) => normalize(f.name).includes(qn));
  const field = candidates[0];
  if (!field) {
    const examples = (fields || []).slice(0, 10).map((f) => `- ${f.name}`).join('\n');
    return {
      error:
        `No encontré un campo que coincida con “${q}”.` +
        (examples ? `\nCampos disponibles (ejemplos):\n${examples}` : '')
    };
  }

  const { data: apps, error: appsError } = await supabase.rpc('get_company_applications_v2', { p_company_id: companyId });
  if (appsError) throw appsError;

  const last = (apps || []).find((a) => a.field_id === field.id);
  if (!last) return { error: `No encontré aplicaciones para el campo “${field.name}”.` };
  return { field, application: last };
}

function resolveRuleIntent(memories, text) {
  const t = normalize(text);
  for (const m of memories || []) {
    if (m.kind !== 'rule') continue;
    const parsed = (() => {
      try {
        return JSON.parse(m.content);
      } catch {
        return null;
      }
    })();
    if (!parsed || parsed.type !== 'alias_intent') continue;
    if (!parsed.alias || !parsed.intent) continue;
    if (t.includes(normalize(parsed.alias))) return String(parsed.intent);
  }
  return '';
}

async function answerWithRules(supabase, ctx, companyId, text) {
  const learn = parseLearnCommand(text);
  if (learn) {
    const payload = { type: 'alias_intent', alias: learn.alias, intent: learn.intent };
    await toolSaveMemory(supabase, { companyId, kind: 'rule', content: JSON.stringify(payload), importance: 3 });
    return {
      answer: `Listo. Aprendí: cuando digas “${learn.alias}” lo interpretaré como “${learn.intent}”.`
    };
  }

  const ruleIntent = resolveRuleIntent(ctx.memories || [], text);
  const t = normalize(text);

  if (
    ruleIntent === 'ultima_aplicacion_campo' ||
    ((t.includes('ultima') || t.includes('última')) && t.includes('aplic'))
  ) {
    const fieldQuery = parseFieldQuery(text);
    const result = await getLastApplicationForField(supabase, companyId, fieldQuery);
    if (result.error) return { answer: result.error };

    const app = result.application;
    const items = Array.isArray(app.items) ? app.items : [];
    const lines = items
      .slice(0, 15)
      .map((it) => `- ${it.product_name || ''} · ${Number(it.quantity_used) || 0} ${it.unit || ''}`)
      .filter(Boolean);

    return {
      answer:
        `Última aplicación en el campo ${app.field_name} (${app.sector_name || 'sin sector'}):\n` +
        `- Fecha: ${app.application_date}\n` +
        `- Tipo: ${app.application_type || ''}\n` +
        `- Costo total: ${formatCLP(app.total_cost)}\n` +
        (Number(app.water_liters_per_hectare) ? `- Agua (L/ha): ${Number(app.water_liters_per_hectare)}` : '') +
        (lines.length ? `\nInsumos:\n${lines.join('\n')}${items.length > 15 ? `\n- ...y ${items.length - 15} más` : ''}` : ''),
      attachment: {
        kind: 'application_last',
        title: `Última aplicación - ${app.field_name}`,
        application: app
      }
    };
  }

  if (ruleIntent === 'facturas_vencen_mes' || (t.includes('factura') && t.includes('venc'))) {
    const my = parseMonthYear(text) || { month: new Date().getUTCMonth() + 1, year: new Date().getUTCFullYear() };
    const result = await toolGetInvoicesDue(supabase, { companyId, month: my.month, year: my.year, status: 'Pendiente', limit: 50 });
    if (!result.invoices || result.invoices.length === 0) {
      return {
        answer: `No encontré facturas Pendientes con vencimiento en ${monthNameES(my.month)} ${my.year}.`,
        attachment: {
          kind: 'invoices_due',
          title: `Facturas Pendientes por vencer - ${monthNameES(my.month)} ${my.year}`,
          month: my.month,
          year: my.year,
          status: result.status,
          range: result.range,
          invoices: []
        }
      };
    }
    const lines = result.invoices.slice(0, 15).map((inv) => {
      const due = inv.due_date || '';
      const sup = inv.supplier || 'Sin proveedor';
      const num = inv.invoice_number ? `N° ${inv.invoice_number}` : 'Sin N°';
      return `- ${due} · ${sup} · ${num} · ${formatCLP(inv.total_amount)}`;
    });
    const more = result.invoices.length > 15 ? `\n- ...y ${result.invoices.length - 15} más` : '';
    return {
      answer: `Facturas Pendientes que vencen en ${monthNameES(my.month)} ${my.year}:\n${lines.join('\n')}${more}`,
      attachment: {
        kind: 'invoices_due',
        title: `Facturas Pendientes por vencer - ${monthNameES(my.month)} ${my.year}`,
        month: my.month,
        year: my.year,
        status: result.status,
        range: result.range,
        invoices: result.invoices
      }
    };
  }

  if (ruleIntent === 'buscar_factura' || (t.includes('factura') && (/\d{2,}/.test(t) || t.includes('proveedor')))) {
    const q = text.replace(/facturas?/gi, '').trim();
    const result = await toolSearchInvoices(supabase, { companyId, query: q || text, limit: 20 });
    if (!result.invoices || result.invoices.length === 0) return { answer: 'No encontré facturas con ese criterio.' };
    const lines = result.invoices.slice(0, 10).map((inv) => {
      const d = inv.invoice_date || '';
      const sup = inv.supplier || 'Sin proveedor';
      const num = inv.invoice_number ? `N° ${inv.invoice_number}` : 'Sin N°';
      return `- ${d} · ${sup} · ${num} · ${formatCLP(inv.total_amount)} · ${inv.status || ''}`;
    });
    const more = result.invoices.length > 10 ? `\n- ...y ${result.invoices.length - 10} más` : '';
    return { answer: `Encontré estas facturas:\n${lines.join('\n')}${more}` };
  }

  if (ruleIntent === 'stock_producto' || t.includes('stock') || t.includes('bodega')) {
    const q = text
      .replace(/stock/gi, '')
      .replace(/bodega/gi, '')
      .replace(/cuanto|cuanta|tengo|hay|de/gi, ' ')
      .trim();
    if (!q) return { answer: 'Dime el nombre del producto para revisar el stock.' };
    const result = await toolSearchProducts(supabase, { companyId, query: q, limit: 10 });
    if (!result.products || result.products.length === 0) return { answer: 'No encontré productos con ese nombre.' };
    const lines = result.products.map((p) => `- ${p.name} · Stock: ${Number(p.current_stock) || 0} ${p.unit || ''}`);
    return { answer: `Stock:\n${lines.join('\n')}` };
  }

  const season = parseSeason(text);
  if (
    ruleIntent === 'resumen_costos' ||
    (t.includes('costo') || t.includes('costos') || t.includes('gasto') || t.includes('gastos')) &&
      (t.includes('temporada') || season)
  ) {
    const result = await toolGetCostsSummary(supabase, { companyId, season: season || '' });
    const total = (result.fields || []).reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    return { answer: `En Temporada ${season || ''}, el costo total es ${formatCLP(total)}.` };
  }

  return {
    answer:
      'Puedo responder preguntas usando los datos del sistema (facturas, costos, productos/stock). Si quieres, enséñame con: aprende: <tu frase> => <intención>. Ejemplo: aprende: "facturas a vencer" => facturas_vencen_mes'
  };
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
    const lastUser = [...messages].reverse().find((m) => m && typeof m === 'object' && m.role === 'user');
    const question = requireString(lastUser?.content || lastUser?.text);
    if (!question) {
      json(res, 400, { error: 'message requerido' });
      return;
    }

    const result = await answerWithRules(supabase, ctx, companyId, question);
    json(res, 200, {
      answer: String(result?.answer || '').trim(),
      attachment: result?.attachment || null,
      warnings: (ctx.warnings || []).filter(Boolean).slice(0, 5)
    });
  } catch (e) {
    json(res, 500, { error: 'Error interno', detail: String(e?.message || e) });
  }
}
