export const getSeasonFromDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11. May is 4.

  // Season starts in May (Month 4)
  // If month is May or later (>= 4), season is Year-Year+1
  // If month is before May (< 4), season is Year-1-Year
  if (month >= 4) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
};

export const getSeasonRange = (season: string): { start: Date; end: Date } => {
  const [startYearStr, endYearStr] = season.split('-');
  const startYear = parseInt(startYearStr);
  const endYear = parseInt(endYearStr);

  // Start: May 1st of startYear
  const start = new Date(startYear, 4, 1); // Month 4 is May
  // End: April 30th of endYear
  const end = new Date(endYear, 4, 0); // Day 0 of May is April 30th
  // Actually, to include the full day, let's set it to May 1st of endYear but filter strictly less than
  // Or just use April 30th 23:59:59.
  // For simplicity in filters, we often use >= start AND <= end.
  // Let's stick to April 30th.
  
  return { start, end };
};

export const isDateInSeason = (dateStr: string, season: string): boolean => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return getSeasonFromDate(d) === season;
};
