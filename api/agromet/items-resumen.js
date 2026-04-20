const AGROMET_BASE = 'https://agrometeorologia.cl';

export default async function handler(req, res) {
  try {
    const htmlResp = await fetch(`${AGROMET_BASE}/`, {
      headers: {
        'user-agent': 'Mozilla/5.0'
      }
    });

    if (!htmlResp.ok) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se pudo obtener la página de agrometeorologia.cl' }));
      return;
    }

    const html = await htmlResp.text();
    const m = html.match(/data-ts-map-tmp\s*=\s*([^\s"'<>]+)/i);
    const tmp = m?.[1];

    if (!tmp) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se encontró el identificador tmp en agrometeorologia.cl' }));
      return;
    }

    const itemsUrl = `${AGROMET_BASE}/json/${tmp}/items-resumen.json`;
    const itemsResp = await fetch(itemsUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json'
      }
    });

    if (!itemsResp.ok) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se pudo obtener items-resumen.json', url: itemsUrl }));
      return;
    }

    const data = await itemsResp.json();
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 's-maxage=600, stale-while-revalidate=3600');
    res.end(JSON.stringify({ tmp, url: itemsUrl, data }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Error interno', detail: String(e?.message || e) }));
  }
}
