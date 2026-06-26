import { getSeasonFromDate } from './seasonUtils';

export const parseAgriculturalDate = (rawDate?: string | null): Date | null => {
  if (!rawDate) return null;
  const parsed = new Date(`${String(rawDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const getSeasonFromRawDate = (rawDate?: string | null): string | null => {
  const parsed = parseAgriculturalDate(rawDate);
  if (!parsed) return null;
  return getSeasonFromDate(parsed);
};

export const filterRowsBySeason = <T>(
  rows: T[],
  season: string,
  getDate: (row: T) => string | null | undefined
): T[] => rows.filter((row) => getSeasonFromRawDate(getDate(row)) === season);

export const collectAvailableSeasons = (
  sources: Array<{
    rows: any[];
    getDate: (row: any) => string | null | undefined;
  }>,
  fallbackSeason = getSeasonFromDate(new Date())
) => {
  const seasons = new Set<string>([fallbackSeason]);

  sources.forEach((source) => {
    (source.rows || []).forEach((row) => {
      const season = getSeasonFromRawDate(source.getDate(row));
      if (season) seasons.add(season);
    });
  });

  return Array.from(seasons).sort().reverse();
};
