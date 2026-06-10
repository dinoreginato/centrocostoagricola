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

const isMonthOnOrAfter = (value, target) => {
  const safeValue = String(value || '').slice(0, 7);
  const safeTarget = String(target || '').slice(0, 7);
  return safeValue >= safeTarget;
};

const addMonths = (iso, delta) => {
  const [y, m] = String(iso || '').slice(0, 7).split('-').map(Number);
  if (!y || !m) return null;
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const getSpanishMonthName = (iso, format = 'capitalized') => {
  const value = String(iso || '').slice(0, 7);
  const month = Number(value.split('-')[1]);
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre'
  ];
  const name = months[month - 1];
  if (!name) return null;
  return format === 'capitalized' ? name.charAt(0).toUpperCase() + name.slice(1) : name;
};

const getMonthNumber = (iso) => {
  const value = String(iso || '').slice(0, 7);
  const month = Number(value.split('-')[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : null;
};

const getYearNumber = (iso) => {
  const value = String(iso || '').slice(0, 4);
  const year = Number(value);
  return Number.isFinite(year) && year >= 2000 && year <= 2100 ? year : null;
};

const buildNgulamIndicatorsUrl = (effectiveFrom) => {
  const month = getMonthNumber(effectiveFrom);
  const year = getYearNumber(effectiveFrom);
  if (!month || !year) return 'https://www.ngulam.cl/wPortal/Recursos/Previred.php';
  return `https://www.ngulam.cl/wPortal/Recursos/Previred.php?mes=${month}&anio=${year}`;
};

const buildPreviredIndicatorCandidates = (effectiveFrom) => {
  const monthCandidates = [effectiveFrom, addMonths(effectiveFrom, -1)].filter(Boolean);
  const seen = new Set();
  return monthCandidates.flatMap((monthIso) => {
    const [year] = String(monthIso).split('-');
    const monthLower = getSpanishMonthName(monthIso, 'lower');
    const monthCap = getSpanishMonthName(monthIso, 'capitalized');
    if (!year || !monthLower || !monthCap) return [];
    const urls = [
      `https://www.previred.com/wp-content/uploads/${year}/${String(monthIso).slice(5, 7)}/Indicadores-Previsionales-Previred-${monthCap}-${year}.pdf`,
      `https://www.previred.com/wp-content/uploads/${year}/${String(monthIso).slice(5, 7)}/Indicadores-Previsionales-Previred-${monthCap}-${year}-1.pdf`,
      `https://www.previred.com/wp-content/uploads/${year}/${String(monthIso).slice(5, 7)}/Indicadores-Previsionales-Previred-${monthLower}-${year}.pdf`,
      `https://www.previred.com/wp-content/uploads/${year}/${String(monthIso).slice(5, 7)}/Indicadores-Previsionales-Previred-${monthLower}-${year}-1.pdf`
    ];
    return urls
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      })
      .map((url) => ({
        url,
        label: `Previred - Indicadores Previsionales ${monthCap} ${year}`
      }));
  });
};

const findFirstSourceWithPatterns = (sourceResults, patterns) => {
  for (const source of sourceResults) {
    const text = stripHtml(source.text || '');
    if (!text) continue;
    if (patterns.some((pattern) => pattern.test(text))) return source;
  }
  return null;
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
        url: 'https://www.previred.com/indicadores-previsionales/',
        label: 'Previred - Indicadores previsionales',
      },
      {
        url: buildNgulamIndicatorsUrl(effectiveFrom),
        label: 'Indicadores previsionales (Previred) - espejo',
      },
      ...buildPreviredIndicatorCandidates(effectiveFrom),
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
      },
      {
        url: 'https://www.afc.cl/empleadores/pagos-y-dudas-sobre-cotizaciones/cotizaciones-cuanto-y-como-se-paga/',
        label: 'AFC - Cotizaciones y Seguro de Cesantía',
      },
      {
        url: 'https://www.chileatiende.gob.cl/fichas/130987-aportes-del-empleador-al-sistema-de-pensiones',
        label: 'ChileAtiende - Aportes del empleador al Sistema de Pensiones',
      },
      {
        url: 'https://www.chileatiende.gob.cl/fichas/130459-seguro-social-previsional-ssp',
        label: 'ChileAtiende - Seguro Social',
      },
      {
        url: 'https://chileatiende.gob.cl/fichas/130455-cotizacion-con-rentabilidad-protegida-crp',
        label: 'ChileAtiende - CRP',
      },
      {
        url: 'https://www.spensiones.gob.cl/portal/institucional/594/w3-propertyvalue-9917.html',
        label: 'SPensiones - SIS tasa vigente',
      },
      {
        url: 'https://www.spensiones.gob.cl/portal/institucional/594/w3-article-2955.html',
        label: 'SPensiones - Cobertura SIS',
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
    const indicatorSource =
      sourceResults.find(
        (s) =>
          s.ok &&
          (String(s.url || '').includes('previred.com/indicadores-previsionales') ||
            String(s.url || '').includes('ngulam.cl/wPortal/Recursos/Previred.php')) &&
          /Indicadores\s+Previsionales/i.test(stripHtml(s.text || ''))
      ) || null;
    const indicatorText = indicatorSource ? stripHtml(indicatorSource.text || '') : '';
    const indicatorUrl = indicatorSource?.url || sources[0].url;

    const topeAfpUfRaw = extractFirst(indicatorText || combinedText, [
      /Tope imponible AFP:\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /Tope imponible\s*AFP\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /\|\s*\*{0,2}AFP\*{0,2}\s*\|\s*([0-9]+(?:[.,][0-9]+)?)\s*\|/i,
    ]);

    const topeAfcUfRaw = extractFirst(indicatorText || combinedText, [
      /Tope imponible Seguro Cesant[ií]a:\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /Tope imponible\s*Seguro\s*Cesant[ií]a\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)\s*UF/i,
      /\|\s*\*{0,2}Seguro\s+de\s+Cesant[ií]a\*{0,2}\s*\|\s*([0-9]+(?:[.,][0-9]+)?)\s*\|/i,
    ]);

    const sisPatterns = [
      /porcentaje\s*cotizaci[oó]n\s*s\.?i\.?s\.?[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Tasa\s*SIS[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Seguro\s+de\s+Invalidez\s+y\s+Sobrevivencia[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Nueva\s+Tasa\s+del\s+Seguro\s+de\s+Invalidez\s+y\s+Sobrevivencia\s*\(SIS\)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /tasa\s+vigente\s+del\s+SIS[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /desde\s+abril\s+de\s+2026[^0-9%]{0,120}tasa\s+vigente\s+del\s+SIS[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i
    ];
    const sisPriorityTexts = [
      indicatorText,
      sourceResults
        .filter((s) => String(s.url || '').includes('previred.com'))
        .map((s) => stripHtml(s.text || ''))
        .join('\n'),
      sourceResults
        .filter((s) => String(s.url || '').includes('spensiones.gob.cl'))
        .map((s) => stripHtml(s.text || ''))
        .join('\n'),
      combinedText
    ].filter(Boolean);
    const sisRaw = sisPriorityTexts.map((text) => extractFirst(text, sisPatterns)).find(Boolean) || null;

    const sannaRaw = extractFirst(combinedText, [
      /equivalente\s+al\s+([0-9]+(?:[.,][0-9]+)?)\s*%\s+de\s+las\s+remuneraciones\s+imponibles/i,
      /monto\s+es\s+de\s+un\s+([0-9]+(?:[.,][0-9]+)?)\s*%\s+de\s+las\s+remuneraciones\s+imponibles/i,
      /LEY\s+SANNA[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
    ]);

    const immRaw = extractFirst(indicatorText || combinedText, [
      /Trabajadores\s+dependientes\s+e\s+independientes[^0-9$]{0,40}\$\s*([0-9.]+)\b/i,
      /Ingreso\s+M[ií]nimo\s+Mensual[^0-9$]{0,40}\$\s*([0-9.]+)\b/i,
    ]);
    const utmRaw = extractFirst(indicatorText || combinedText, [
      /Unidad\s+Tributaria\s+Mensual\s*\(UTM\)[^0-9$]{0,40}\$\s*([0-9.]+)\b/i,
      /\bUTM\b[^0-9$]{0,40}\$\s*([0-9.]+)\b/i,
    ]);
    const utaRaw = extractFirst(indicatorText || combinedText, [
      /Unidad\s+Tributaria\s+Anual\s*\(UTA\)[^0-9$]{0,40}\$\s*([0-9.]+)\b/i,
      /\bUTA\b[^0-9$]{0,40}\$\s*([0-9.]+)\b/i,
    ]);

    const saludCcafRaw = extractFirst(indicatorText || combinedText, [
      /\bCCAF\b[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%\s*R\.?I\.?/i,
      /\bCCAF\b[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i
    ]);
    const saludFonasaCcafRaw = extractFirst(indicatorText || combinedText, [
      /\bFONASA\b[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%\s*R\.?I\.?/i,
      /\bFONASA\b[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i
    ]);

    const afcEmpIndefRaw = extractFirst(indicatorText || combinedText, [
      /Contrato\s+Plazo\s+Indefinido[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%\s*R\.?I\.?/i
    ]);
    const afcWorkerIndefRaw = extractFirst(indicatorText || combinedText, [
      /Contrato\s+Plazo\s+Indefinido[^0-9%]{0,140}[|·\s]+([0-9]+(?:[.,][0-9]+)?)\s*%\s*R\.?I\.?/i
    ]);
    const afcEmpFixedRaw = extractFirst(indicatorText || combinedText, [
      /Contrato\s+Plazo\s+Fijo[^0-9%]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*%\s*R\.?I\.?/i
    ]);
    const afcWorkerFixedRaw = extractFirst(indicatorText || combinedText, [
      /Contrato\s+Plazo\s+Fijo[^0-9%]{0,140}[|·\s]+([0-9]+(?:[.,][0-9]+)?)\s*%\s*R\.?I\.?/i
    ]);

    const seguroSocialRaw = extractFirst(indicatorText || combinedText, [
      /Seguro\s+Social[\s\S]{0,80}Expectativa\s+de\s+Vida[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i,
      /Expectativa\s+de\s+Vida[^0-9%]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*%/i
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
        source_url: indicatorUrl,
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
        source_url: indicatorUrl,
      });
    }

    const imm = parseNumberCL(immRaw);
    const utm = parseNumberCL(utmRaw);
    const uta = parseNumberCL(utaRaw);
    const saludCcaf = parseNumberCL(saludCcafRaw);
    const saludFonasaCcaf = parseNumberCL(saludFonasaCcafRaw);
    const afcEmpIndef = parseNumberCL(afcEmpIndefRaw);
    const afcWorkerIndef = parseNumberCL(afcWorkerIndefRaw);
    const afcEmpFixed = parseNumberCL(afcEmpFixedRaw);
    const afcWorkerFixed = parseNumberCL(afcWorkerFixedRaw);
    const seguroSocial = parseNumberCL(seguroSocialRaw);

    items.push(
      {
        code: 'IMM_CLP',
        name: 'Ingreso Mínimo Mensual (CLP)',
        kind: 'amount',
        payer: 'system',
        value: imm !== null ? imm : 539000,
        effective_from: effectiveFrom,
        source_url: indicatorUrl
      },
      ...(utm !== null
        ? [
            {
              code: 'UTM_CLP',
              name: 'UTM (CLP)',
              kind: 'amount',
              payer: 'system',
              value: utm,
              effective_from: effectiveFrom,
              source_url: indicatorUrl
            }
          ]
        : []),
      ...(uta !== null
        ? [
            {
              code: 'UTA_CLP',
              name: 'UTA (CLP)',
              kind: 'amount',
              payer: 'system',
              value: uta,
              effective_from: effectiveFrom,
              source_url: indicatorUrl
            }
          ]
        : []),
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
      ...(saludCcaf !== null && saludFonasaCcaf !== null && Math.abs(saludCcaf + saludFonasaCcaf - 7) < 0.001
        ? [
            {
              code: 'SALUD_CCAF_RATE',
              name: 'Salud - Caja de Compensación (CCAF)',
              kind: 'rate',
              payer: 'worker',
              value: saludCcaf,
              effective_from: effectiveFrom,
              source_url: indicatorUrl
            },
            {
              code: 'SALUD_CCAF_FONASA_RATE',
              name: 'Salud - Fonasa (vía CCAF)',
              kind: 'rate',
              payer: 'worker',
              value: saludFonasaCcaf,
              effective_from: effectiveFrom,
              source_url: indicatorUrl
            }
          ]
        : []),
      {
        code: 'AFC_WORKER_INDEF_RATE',
        name: 'AFC Trabajador indefinido',
        kind: 'rate',
        payer: 'worker',
        value: afcWorkerIndef !== null ? afcWorkerIndef : 0.6,
        effective_from: effectiveFrom,
        source_url: indicatorUrl
      },
      {
        code: 'AFC_EMP_INDEF_RATE',
        name: 'AFC Empleador indefinido',
        kind: 'rate',
        payer: 'employer',
        value: afcEmpIndef !== null ? afcEmpIndef : 2.4,
        effective_from: effectiveFrom,
        source_url: indicatorUrl
      },
      {
        code: 'AFC_WORKER_FIXED_RATE',
        name: 'AFC Trabajador plazo fijo/obra',
        kind: 'rate',
        payer: 'worker',
        value: afcWorkerFixed !== null ? afcWorkerFixed : 0,
        effective_from: effectiveFrom,
        source_url: indicatorUrl
      },
      {
        code: 'AFC_EMP_FIXED_RATE',
        name: 'AFC Empleador plazo fijo/obra',
        kind: 'rate',
        payer: 'employer',
        value: afcEmpFixed !== null ? afcEmpFixed : 3,
        effective_from: effectiveFrom,
        source_url: indicatorUrl
      },
      {
        code: 'AFC_EMP_CIC_INDEF_RATE',
        name: 'Cesantía Cuenta Individual empleador indefinido',
        kind: 'rate',
        payer: 'employer',
        value: 1.6,
        effective_from: effectiveFrom,
        source_url: 'https://www.afc.cl/empleadores/pagos-y-dudas-sobre-cotizaciones/cotizaciones-cuanto-y-como-se-paga/'
      },
      {
        code: 'AFC_EMP_FCS_INDEF_RATE',
        name: 'Fondo Solidario Cesantía empleador indefinido',
        kind: 'rate',
        payer: 'employer',
        value: 0.8,
        effective_from: effectiveFrom,
        source_url: 'https://www.afc.cl/empleadores/pagos-y-dudas-sobre-cotizaciones/cotizaciones-cuanto-y-como-se-paga/'
      },
      {
        code: 'AFC_EMP_CIC_FIXED_RATE',
        name: 'Cesantía Cuenta Individual empleador plazo fijo/obra',
        kind: 'rate',
        payer: 'employer',
        value: 2.8,
        effective_from: effectiveFrom,
        source_url: 'https://www.afc.cl/empleadores/pagos-y-dudas-sobre-cotizaciones/cotizaciones-cuanto-y-como-se-paga/'
      },
      {
        code: 'AFC_EMP_FCS_FIXED_RATE',
        name: 'Fondo Solidario Cesantía empleador plazo fijo/obra',
        kind: 'rate',
        payer: 'employer',
        value: 0.2,
        effective_from: effectiveFrom,
        source_url: 'https://www.afc.cl/empleadores/pagos-y-dudas-sobre-cotizaciones/cotizaciones-cuanto-y-como-se-paga/'
      }
    );

    if (isMonthOnOrAfter(effectiveFrom, '2025-08')) {
      items.push(
        {
          code: 'SEGURO_SOCIAL_AFP_EMP_RATE',
          name: 'Seguro Social - Cuenta individual AFP',
          kind: 'rate',
          payer: 'employer',
          value: 0.1,
          effective_from: effectiveFrom,
          source_url: 'https://www.chileatiende.gob.cl/fichas/130987-aportes-del-empleador-al-sistema-de-pensiones'
        },
        {
          code: 'SEGURO_SOCIAL_EMP_RATE',
          name: 'Seguro Social Previsional',
          kind: 'rate',
          payer: 'employer',
          value: seguroSocial !== null ? seguroSocial : 0.9,
          effective_from: effectiveFrom,
          source_url: seguroSocial !== null ? indicatorUrl : 'https://www.chileatiende.gob.cl/fichas/130987-aportes-del-empleador-al-sistema-de-pensiones'
        }
      );
    }

    if (isMonthOnOrAfter(effectiveFrom, '2026-08')) {
      items.push({
        code: 'CRP_EMP_RATE',
        name: 'Cotización con Rentabilidad Protegida',
        kind: 'rate',
        payer: 'employer',
        value: isMonthOnOrAfter(effectiveFrom, '2027-08') ? 1.5 : 0.9,
        effective_from: effectiveFrom,
        source_url: 'https://chileatiende.gob.cl/fichas/130455-cotizacion-con-rentabilidad-protegida-crp'
      });
    }

    let sis = parseNumberCL(sisRaw);
    if (sis === null && isMonthOnOrAfter(effectiveFrom, '2026-04') && !isMonthOnOrAfter(effectiveFrom, '2026-08')) {
      sis = 1.62;
    }
    if (sis !== null) {
      const sisSource =
        (indicatorSource && /SIS/i.test(indicatorText) ? indicatorSource : null) ||
        findFirstSourceWithPatterns(sourceResults, sisPatterns.map((pattern) => new RegExp(pattern.source, pattern.flags.replace('g', '')))) ||
        sourceResults.find((s) => String(s.url || '').includes('previred.com')) ||
        sourceResults.find((s) => String(s.url || '').includes('ngulam.cl/wPortal/Recursos/Previred.php')) ||
        sourceResults.find((s) => String(s.url || '').includes('spensiones.gob.cl')) ||
        sourceResults.find((s) => s.ok) ||
        sources[0];
      items.push({
        code: 'SIS_EMP_RATE',
        name: 'SIS (Empleador)',
        kind: 'rate',
        payer: 'employer',
        value: sis,
        effective_from: effectiveFrom,
        source_url: sisSource.url,
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
