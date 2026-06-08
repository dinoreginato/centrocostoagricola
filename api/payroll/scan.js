const parseNumberCL = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const getMonthStartIso = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

const extractFirst = (text, patterns) => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
};

export default async function handler(req, res) {
  try {
    const effectiveFrom = typeof req.query.effective_from === 'string' ? req.query.effective_from : getMonthStartIso();

    const sources = [
      {
        url: 'https://boletindeltrabajo.cl/2026/02/17/minuta-cotizaciones-previsionales-ano-2026-2/',
        label: 'Boletín del Trabajo - Minuta Cotizaciones 2026',
      },
    ];

    const sourceResults = await Promise.all(
      sources.map(async (s) => {
        try {
          const r = await fetch(s.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
          const text = await r.text();
          return { ...s, ok: r.ok, status: r.status, fetched_at: new Date().toISOString(), text };
        } catch (e) {
          return { ...s, ok: false, status: 0, fetched_at: new Date().toISOString(), error: String(e), text: '' };
        }
      })
    );

    const combinedText = sourceResults.map((s) => s.text || '').join('\n');

    const topeAfpUfRaw = extractFirst(combinedText, [
      /Tope imponible AFP:\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /Tope imponible\s*AFP\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
    ]);

    const topeAfcUfRaw = extractFirst(combinedText, [
      /Tope imponible Seguro Cesant[ií]a:\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /Tope imponible\s*Seguro\s*Cesant[ií]a\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
    ]);

    const sisRaw = extractFirst(combinedText, [
      /SIS[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Seguro\s+de\s+Invalidez\s+y\s+Sobrevivencia[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
    ]);

    const sannaRaw = extractFirst(combinedText, [
      /SANNA[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
    ]);

    const items = [];

    const topeAfpUf = parseNumberCL(topeAfpUfRaw);
    if (topeAfpUf !== null) {
      items.push({
        code: 'TOPE_AFP_UF',
        name: 'Tope Imponible AFP/Salud (UF)',
        kind: 'cap_uf',
        payer: 'system',
        value: topeAfpUf,
        effective_from: effectiveFrom,
        source_url: sourceResults.find((s) => s.ok)?.url || sources[0].url,
      });
    }

    const topeAfcUf = parseNumberCL(topeAfcUfRaw);
    if (topeAfcUf !== null) {
      items.push({
        code: 'TOPE_AFC_UF',
        name: 'Tope Imponible Seguro Cesantía (UF)',
        kind: 'cap_uf',
        payer: 'system',
        value: topeAfcUf,
        effective_from: effectiveFrom,
        source_url: sourceResults.find((s) => s.ok)?.url || sources[0].url,
      });
    }

    const sis = parseNumberCL(sisRaw);
    if (sis !== null) {
      items.push({
        code: 'SIS_EMP_RATE',
        name: 'SIS (Empleador)',
        kind: 'rate',
        payer: 'employer',
        value: sis,
        effective_from: effectiveFrom,
        source_url: sourceResults.find((s) => s.ok)?.url || sources[0].url,
      });
    }

    const sanna = parseNumberCL(sannaRaw);
    if (sanna !== null) {
      items.push({
        code: 'SANNA_EMP_RATE',
        name: 'Ley SANNA (Empleador)',
        kind: 'rate',
        payer: 'employer',
        value: sanna,
        effective_from: effectiveFrom,
        source_url: sourceResults.find((s) => s.ok)?.url || sources[0].url,
      });
    }

    res.status(200).json({
      effective_from: effectiveFrom,
      sources: sourceResults.map(({ text, ...rest }) => rest),
      items,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

