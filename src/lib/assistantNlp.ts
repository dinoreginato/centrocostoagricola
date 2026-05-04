import { getSeasonFromDate } from './seasonUtils';

export type AssistantIntent =
  | { kind: 'field_costs'; season?: string; from?: string; to?: string }
  | { kind: 'unknown' };

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

  if (!isFieldCosts) return { kind: 'unknown' };

  const seasonMatch = text.match(/(\d{4})\s*-\s*(\d{4})/);
  if (seasonMatch) {
    const season = `${seasonMatch[1]}-${seasonMatch[2]}`;
    return { kind: 'field_costs', season };
  }

  const monthMatch = text.match(
    /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})/
  );
  if (monthMatch) {
    const month = MONTHS[monthMatch[1]];
    const year = Number(monthMatch[2]);
    if (month != null && !Number.isNaN(year)) {
      const { from, to } = monthRange(month, year);
      return { kind: 'field_costs', from, to };
    }
  }

  const nowSeason = getSeasonFromDate(new Date());
  return { kind: 'field_costs', season: nowSeason };
}

