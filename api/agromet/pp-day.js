const AGROMET_BASE = 'https://agrometeorologia.cl';

const parseDateDMY = (dmy) => {
  const m = String(dmy || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
};

const formatDateToDMY = (ymd) => {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

const parseNumberCL = (s) => {
  const str = String(s || '').trim();
  if (!str) return null;
  const normalized = str.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (Number.isNaN(n)) return null;
  return n;
};

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const station = url.searchParams.get('station');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (!station || !from || !to) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Faltan parámetros: station, from, to' }));
      return;
    }

    const fromDMY = formatDateToDMY(from);
    const toDMY = formatDateToDMY(to);
    if (!fromDMY || !toDMY) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Formato de fecha inválido (usar YYYY-MM-DD)' }));
      return;
    }

    const body = new URLSearchParams();
    body.append('estaciones[]', station);
    body.append('variables[]', 'PP_SUM');
    body.append('intervalo', 'day');
    body.append('desde', fromDMY);
    body.append('hasta', toDMY);
    body.append('vista[]', 'tabla');

    const resp = await fetch(`${AGROMET_BASE}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': 'Mozilla/5.0'
      },
      body: body.toString()
    });

    if (!resp.ok) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se pudo consultar agrometeorologia.cl' }));
      return;
    }

    const html = await resp.text();
    const tableStart = html.indexOf('<table class="table table-bordered table-striped">');
    if (tableStart === -1) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se encontró tabla de resultados' }));
      return;
    }

    const tableEnd = html.indexOf('</table>', tableStart);
    if (tableEnd === -1) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Tabla de resultados incompleta' }));
      return;
    }

    const table = html.slice(tableStart, tableEnd);
    const rowRe = /<tr>[\s\S]*?<td[^>]*>\s*([\s\S]*?)\s*<\/td>[\s\S]*?<td>\s*([\s\S]*?)\s*<\/td>[\s\S]*?<\/tr>/g;

    const data = [];
    let m;
    while ((m = rowRe.exec(table)) !== null) {
      const dateRaw = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const mmRaw = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

      const ymd = parseDateDMY(dateRaw);
      const mm = parseNumberCL(mmRaw);
      if (!ymd || mm == null) continue;
      data.push({ date: ymd, mm });
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 's-maxage=1800, stale-while-revalidate=3600');
    res.end(JSON.stringify({ station, from, to, count: data.length, data }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Error interno', detail: String(e?.message || e) }));
  }
}
