import { getSeasonFromDate } from './seasonUtils';

export type AssistantIntent =
  | { kind: 'field_costs'; season?: string; from?: string; to?: string }
  | {
      kind: 'cost_category';
      category:
        | 'irrigation'
        | 'labor'
        | 'workers'
        | 'machinery'
        | 'applications'
        | 'distribution'
        | 'fuel'
        | 'fuel_diesel'
        | 'fuel_gasoline';
      season?: string;
      from?: string;
      to?: string;
    }
  | { kind: 'unknown' };

type CostCategory = Extract<AssistantIntent, { kind: 'cost_category' }>['category'];

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11
};

function normalize(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function monthRange(month: number, year: number) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const from = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
  const to = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
  return { from, to };
}

export function parseAssistantIntent(input: string): AssistantIntent {
  const text = normalize(input);
  const isFieldCosts =
    text.includes('costos por campo') ||
    text.includes('costo por campo') ||
    text.includes('costos campo') ||
    text.includes('costos de campo');

  const wantsCost =
    text.includes('gasto') ||
    text.includes('cost') ||
    text.includes('cuanto') ||
    text.includes('total') ||
    text.includes('temporada') ||
    text.includes('mes');

  const category: CostCategory | null = wantsCost
    ? text.includes('riego')
      ? 'irrigation'
      : text.includes('labor') || text.includes('mano de obra') || text.includes('labores')
        ? 'labor'
        : text.includes('trabajador') || text.includes('personal')
          ? 'workers'
          : text.includes('maquinaria')
            ? 'machinery'
            : text.includes('aplicacion')
              ? 'applications'
              : text.includes('distribucion') || text.includes('costos generales')
                ? 'distribution'
                : text.includes('bencina') || text.includes('gasolina')
                  ? 'fuel_gasoline'
                  : text.includes('petroleo') || text.includes('diesel')
                    ? 'fuel_diesel'
                    : text.includes('combustible')
                      ? 'fuel'
                      : null
    : null;

  if (!isFieldCosts && !category) return { kind: 'unknown' };

  const seasonMatch = text.match(/(\d{4})\s*-\s*(\d{4})/);
  if (seasonMatch) {
    const season = `${seasonMatch[1]}-${seasonMatch[2]}`;
    if (isFieldCosts) return { kind: 'field_costs', season };
    return { kind: 'cost_category', category, season };
  }

  const monthMatch = text.match(
    /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})/
  );
  if (monthMatch) {
    const month = MONTHS[monthMatch[1]];
    const year = Number(monthMatch[2]);
    if (month != null && !Number.isNaN(year)) {
      const { from, to } = monthRange(month, year);
      if (isFieldCosts) return { kind: 'field_costs', from, to };
      return { kind: 'cost_category', category, from, to };
    }
  }

  const nowSeason = getSeasonFromDate(new Date());
  if (isFieldCosts) return { kind: 'field_costs', season: nowSeason };
  return { kind: 'cost_category', category, season: nowSeason };
}
