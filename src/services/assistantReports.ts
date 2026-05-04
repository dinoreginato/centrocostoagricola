import { isDateInSeason } from '../lib/seasonUtils';
import { loadReportsRawData } from './reports';

type DateFilter =
  | { kind: 'season'; season: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'all' };

export type FieldCostRow = {
  field_id: string;
  field_name: string;
  hectares: number;
  total_cost: number;
  cost_per_ha: number;
  breakdown: {
    applications: number;
    labor: number;
    workers: number;
    fuel: number;
    machinery: number;
    irrigation: number;
    distribution: number;
  };
};

export type SectorCostRow = {
  field_id: string;
  field_name: string;
  sector_id: string;
  sector_name: string;
  hectares: number;
  total_cost: number;
  breakdown: FieldCostRow['breakdown'];
};

export type FieldCostsReport = {
  title: string;
  filter: DateFilter;
  fields: FieldCostRow[];
  sectors: SectorCostRow[];
  total_cost: number;
};

function inFilter(dateStr: string | undefined | null, filter: DateFilter) {
  if (!dateStr) return false;
  if (filter.kind === 'all') return true;
  if (filter.kind === 'season') return isDateInSeason(dateStr, filter.season);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const from = new Date(filter.from);
  const to = new Date(filter.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return d >= from && d <= to;
}

function sumByKey<T>(rows: T[], getKey: (r: T) => string, getValue: (r: T) => number) {
  const map = new Map<string, number>();
  rows.forEach((r) => {
    const k = getKey(r);
    map.set(k, (map.get(k) || 0) + (Number(getValue(r)) || 0));
  });
  return map;
}

function emptyBreakdown(): FieldCostRow['breakdown'] {
  return {
    applications: 0,
    labor: 0,
    workers: 0,
    fuel: 0,
    machinery: 0,
    irrigation: 0,
    distribution: 0
  };
}

export async function generateFieldCostsReport(params: { companyId: string; filter: DateFilter; title: string }): Promise<FieldCostsReport> {
  const raw = await loadReportsRawData({ companyId: params.companyId });

  const fields = raw.fields || [];
  const sectorIndex = new Map<
    string,
    {
      field_id: string;
      field_name: string;
      sector_name: string;
      hectares: number;
    }
  >();

  fields.forEach((f) => {
    (f.sectors || []).forEach((s) => {
      sectorIndex.set(String(s.id), {
        field_id: String(f.id),
        field_name: String(f.name || ''),
        sector_name: String(s.name || ''),
        hectares: Number(s.hectares) || 0
      });
    });
  });

  const applications = (raw.applications || []).filter((r) => inFilter((r as any).application_date, params.filter));
  const labor = (raw.labor || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const workers = (raw.workerCosts || []).filter((r) => inFilter((r as any).date, params.filter));
  const fuel = (raw.fuel || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const machinery = (raw.machinery || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const irrigation = (raw.irrigation || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const distribution = (raw.generalCosts || []).filter((r) => inFilter((r as any).date, params.filter));

  const appsBySector = sumByKey(applications as any[], (r) => String(r.sector_id), (r) => Number(r.total_cost) || 0);
  const laborBySector = sumByKey(labor as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const workersBySector = sumByKey(workers as any[], (r) => String(r.sector_id), (r) => Number(r.amount) || 0);
  const fuelBySector = sumByKey(fuel as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const machineryBySector = sumByKey(machinery as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const irrigationBySector = sumByKey(irrigation as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const distBySector = sumByKey(distribution as any[], (r) => String(r.sector_id), (r) => Number(r.amount) || 0);

  const sectorRows: SectorCostRow[] = [];

  sectorIndex.forEach((meta, sectorId) => {
    const breakdown = emptyBreakdown();
    breakdown.applications = appsBySector.get(sectorId) || 0;
    breakdown.labor = laborBySector.get(sectorId) || 0;
    breakdown.workers = workersBySector.get(sectorId) || 0;
    breakdown.fuel = fuelBySector.get(sectorId) || 0;
    breakdown.machinery = machineryBySector.get(sectorId) || 0;
    breakdown.irrigation = irrigationBySector.get(sectorId) || 0;
    breakdown.distribution = distBySector.get(sectorId) || 0;

    const total_cost =
      breakdown.applications +
      breakdown.labor +
      breakdown.workers +
      breakdown.fuel +
      breakdown.machinery +
      breakdown.irrigation +
      breakdown.distribution;

    if (Math.abs(total_cost) <= 0.01) return;

    sectorRows.push({
      field_id: meta.field_id,
      field_name: meta.field_name,
      sector_id: sectorId,
      sector_name: meta.sector_name,
      hectares: meta.hectares,
      total_cost,
      breakdown
    });
  });

  const byField = new Map<string, FieldCostRow>();
  sectorRows.forEach((r) => {
    const existing = byField.get(r.field_id);
    if (!existing) {
      byField.set(r.field_id, {
        field_id: r.field_id,
        field_name: r.field_name,
        hectares: 0,
        total_cost: 0,
        cost_per_ha: 0,
        breakdown: emptyBreakdown()
      });
    }
    const target = byField.get(r.field_id)!;
    target.hectares += Number(r.hectares) || 0;
    target.total_cost += Number(r.total_cost) || 0;
    target.breakdown.applications += r.breakdown.applications;
    target.breakdown.labor += r.breakdown.labor;
    target.breakdown.workers += r.breakdown.workers;
    target.breakdown.fuel += r.breakdown.fuel;
    target.breakdown.machinery += r.breakdown.machinery;
    target.breakdown.irrigation += r.breakdown.irrigation;
    target.breakdown.distribution += r.breakdown.distribution;
  });

  const fieldRows = Array.from(byField.values()).map((r) => ({
    ...r,
    cost_per_ha: r.hectares > 0 ? r.total_cost / r.hectares : 0
  }));

  fieldRows.sort((a, b) => b.total_cost - a.total_cost);
  sectorRows.sort((a, b) => (a.field_name + a.sector_name).localeCompare(b.field_name + b.sector_name));

  const total_cost = fieldRows.reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0);

  return {
    title: params.title,
    filter: params.filter,
    fields: fieldRows,
    sectors: sectorRows,
    total_cost
  };
}

