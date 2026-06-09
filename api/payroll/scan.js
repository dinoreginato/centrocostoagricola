const parseNumberCL = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.,-]/g, '');
  const normalized =
    cleaned.includes(',') && cleaned.includes('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.includes(',')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const stripHtml = (html) => {
  const raw = String(html || '');
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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

const isoToMindicadorDate = (iso) => {
  const parts = String(iso || '').split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return `${d}-${m}-${y}`;
};

const getAfpCommissionFromText = (text, afpLabel) => {
  const safe = afpLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = extractFirst(text, [
    new RegExp(`AFP\\s*${safe}[^0-9%]{0,60}([0-9]+(?:[.,][0-9]+)?)\\s*%`, 'i'),
    new RegExp(`${safe}[^0-9%]{0,60}([0-9]+(?:[.,][0-9]+)?)\\s*%`, 'i'),
    new RegExp(`${safe}\\s*\\|\\s*([0-9]+(?:[.,][0-9]+)?)\\s*%`, 'i')
  ]);
  const n = parseNumberCL(raw);
  if (n === null) return null;
  if (n >= 10 && n < 15) return Number((n - 10).toFixed(4));
  return n;
};

export default async function handler(req, res) {
  try {
    const effectiveFrom = typeof req.query.effective_from === 'string' ? req.query.effective_from : getMonthStartIso();

    const sources = [
      {
        url: 'https://boletindeltrabajo.cl/2026/02/17/minuta-cotizaciones-previsionales-ano-2026-2/',
        label: 'Boletín del Trabajo - Minuta Cotizaciones 2026 (Feb 2026)',
      },
      {
        url: 'https://boletindeltrabajo.cl/2026/01/14/minuta-cotizaciones-previsionales-ano-2026/2/',
        label: 'Boletín del Trabajo - Minuta Cotizaciones 2026 (Ene 2026)',
      },
      {
        url: 'https://boletindeltrabajo.cl/2026/01/14/minuta-cotizaciones-previsionales-ano-2026/5/',
        label: 'Boletín del Trabajo - Tabla tasas (Ene 2026)',
      },
      {
        url: 'https://www.ventanillaunicasocial.gob.cl/ficha/372/ley-sanna',
        label: 'Ventanilla Única Social - Ley SANNA',
      },
      {
        url: 'https://www.tvn.cl/publireportajes/la-comision-afp-explicada-facil-como-influye-en-tu-sueldo-mes-a-mes',
        label: 'TVN - Tabla de comisiones AFP (referencia pública)',
      }
    ];

    const ufDate = isoToMindicadorDate(effectiveFrom);
    if (ufDate) {
      sources.push({
        url: `https://mindicador.cl/api/uf/${ufDate}`,
        label: 'mindicador.cl - UF diaria',
      });
    }

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

    const combinedText = sourceResults.map((s) => stripHtml(s.text || '')).join('\n');

    const topeAfpUfRaw = extractFirst(combinedText, [
      /Tope imponible AFP:\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /Tope imponible\s*AFP\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
    ]);

    const topeAfcUfRaw = extractFirst(combinedText, [
      /Tope imponible Seguro Cesant[ií]a:\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /Tope imponible\s*Seguro\s*Cesant[ií]a\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
    ]);

    const sisRaw = extractFirst(combinedText, [
      /porcentaje\s*cotizaci[oó]n\s*s\.?i\.?s\.?[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Tasa\s*SIS[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Seguro\s+de\s+Invalidez\s+y\s+Sobrevivencia[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
    ]);

    const sannaRaw = extractFirst(combinedText, [
      /equivalente\s+al\s+([0-9]+(?:[.,][0-9]+)?)\s*%\s+de\s+las\s+remuneraciones\s+imponibles/i,
      /monto\s+es\s+de\s+un\s+([0-9]+(?:[.,][0-9]+)?)\s*%\s+de\s+las\s+remuneraciones\s+imponibles/i,
      /LEY\s+SANNA[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
    ]);

    const items = [];

    const ufSource = sourceResults.find((s) => String(s.url || '').includes('mindicador.cl') && s.ok);
    if (ufSource && ufSource.text) {
      try {
        const parsed = JSON.parse(ufSource.text);
        const value = Number(parsed?.serie?.[0]?.valor);
        if (Number.isFinite(value) && value > 0) {
          items.push({
            code: 'UF_CLP',
            name: 'UF (CLP)',
            kind: 'amount',
            payer: 'system',
            value,
            effective_from: effectiveFrom,
            source_url: ufSource.url
          });
        }
      } catch {
      }
    }

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

    items.push(
      {
        code: 'IMM_CLP',
        name: 'Ingreso Mínimo Mensual (CLP)',
        kind: 'amount',
        payer: 'system',
        value: 539000,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'GRAT_LEGAL_RATE',
        name: 'Gratificación legal Art. 50',
        kind: 'rate',
        payer: 'worker',
        value: 25,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'GRAT_LEGAL_TOPE_IMM_ANNUAL',
        name: 'Tope gratificación anual (IMM)',
        kind: 'amount',
        payer: 'system',
        value: 4.75,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'AFP_MANDATORY_RATE',
        name: 'AFP Obligatoria',
        kind: 'rate',
        payer: 'worker',
        value: 10,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'SALUD_FONASA_RATE',
        name: 'Salud Fonasa',
        kind: 'rate',
        payer: 'worker',
        value: 7,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'SALUD_ISAPRE_MIN_RATE',
        name: 'Salud Isapre mín.',
        kind: 'rate',
        payer: 'worker',
        value: 7,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'AFC_WORKER_INDEF_RATE',
        name: 'AFC Trabajador indefinido',
        kind: 'rate',
        payer: 'worker',
        value: 0.6,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'AFC_EMP_INDEF_RATE',
        name: 'AFC Empleador indefinido',
        kind: 'rate',
        payer: 'employer',
        value: 2.4,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'AFC_WORKER_FIXED_RATE',
        name: 'AFC Trabajador plazo fijo/obra',
        kind: 'rate',
        payer: 'worker',
        value: 0,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      },
      {
        code: 'AFC_EMP_FIXED_RATE',
        name: 'AFC Empleador plazo fijo/obra',
        kind: 'rate',
        payer: 'employer',
        value: 3,
        effective_from: effectiveFrom,
        source_url: sources[0].url
      }
    );

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

    const mutualRaw = extractFirst(combinedText, [
      /Ley\s*16\.744[^0-9%]{0,120}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Tasa\s*(?:base\s*)?Ley\s*16\.744[^0-9%]{0,120}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
    ]);
    const mutual = parseNumberCL(mutualRaw);
    if (mutual !== null) {
      items.push({
        code: 'MUTUAL_EMP_RATE',
        name: 'Mutual (Ley 16.744)',
        kind: 'rate',
        payer: 'employer',
        value: mutual,
        effective_from: effectiveFrom,
        source_url: sourceResults.find((s) => s.ok)?.url || sources[0].url
      });
    }

    const afpCommissionMap = [
      { code: 'AFP_CAPITAL_COMMISSION_RATE', label: 'Capital' },
      { code: 'AFP_CUPRUM_COMMISSION_RATE', label: 'Cuprum' },
      { code: 'AFP_HABITAT_COMMISSION_RATE', label: 'Habitat' },
      { code: 'AFP_MODELO_COMMISSION_RATE', label: 'Modelo' },
      { code: 'AFP_PLANVITAL_COMMISSION_RATE', label: 'Planvital' },
      { code: 'AFP_PROVIDA_COMMISSION_RATE', label: 'Provida' },
      { code: 'AFP_UNO_COMMISSION_RATE', label: 'Uno' }
    ];

    for (const a of afpCommissionMap) {
      const commission = getAfpCommissionFromText(combinedText, a.label);
      if (commission === null) continue;
      items.push({
        code: a.code,
        name: `Comisión AFP ${a.label}`,
        kind: 'rate',
        payer: 'worker',
        value: commission,
        effective_from: effectiveFrom,
        source_url: sourceResults.find((s) => s.ok)?.url || sources[0].url
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
