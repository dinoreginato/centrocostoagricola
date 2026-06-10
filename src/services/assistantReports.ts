import { isDateInSeason } from '../lib/seasonUtils';
import { loadReportsRawData } from './reports';

type DateFilter =
  | { kind: 'season'; season: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'all' };

function normalize(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function pickFirst<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

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
    fuel_diesel: number;
    fuel_gasoline: number;
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
    fuel_diesel: 0,
    fuel_gasoline: 0,
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
  const fuelAssignments = (raw.fuel || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const machinery = (raw.machinery || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const irrigation = (raw.irrigation || []).filter((r) => inFilter((r as any).assigned_date, params.filter));
  const distribution = (raw.generalCosts || []).filter((r) => inFilter((r as any).date, params.filter));

  const appsTotalBySector = sumByKey(applications as any[], (r) => String(r.sector_id), (r) => Number(r.total_cost) || 0);
  const laborBySector = sumByKey(labor as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const workersBySector = sumByKey(workers as any[], (r) => String(r.sector_id), (r) => Number(r.amount) || 0);
  const machineryBySector = sumByKey(machinery as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const irrigationBySector = sumByKey(irrigation as any[], (r) => String(r.sector_id), (r) => Number(r.assigned_amount) || 0);
  const distBySector = sumByKey(distribution as any[], (r) => String(r.sector_id), (r) => Number(r.amount) || 0);

  const fuelDieselBySector = new Map<string, number>();
  const fuelGasolineBySector = new Map<string, number>();

  const addFuel = (sectorId: string, kind: 'diesel' | 'gasoline', amount: number) => {
    const key = String(sectorId || '');
    if (!key) return;
    const v = Number(amount) || 0;
    if (kind === 'diesel') fuelDieselBySector.set(key, (fuelDieselBySector.get(key) || 0) + v);
    else fuelGasolineBySector.set(key, (fuelGasolineBySector.get(key) || 0) + v);
  };

  fuelAssignments.forEach((r: any) => {
    const sectorId = String(r.sector_id || '');
    if (!sectorId) return;
    addFuel(sectorId, 'diesel', Number(r.assigned_amount) || 0);
  });

  const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];

  let totalDieselLiters = 0;
  let totalDieselCost = 0;
  let totalGasLiters = 0;
  let totalGasCost = 0;

  (raw.invoices || []).forEach((inv: any) => {
    (inv.invoice_items || []).forEach((item: any) => {
      const cat = normalize(item.category || item.products?.category);
      const productName = normalize(item.products?.name);
      const unit = normalize(item.products?.unit);
      if (invalidUnits.includes(unit)) return;

      const docType = normalize(inv.document_type);
      const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito') || docType === 'nc';
      const qty = Number(item.quantity || 0);
      const price = Number(item.total_price || 0);
      const finalQty = isNC ? -Math.abs(qty) : qty;
      const finalPrice = isNC ? -Math.abs(price) : price;

      const isDiesel = ['petroleo', 'diesel'].some((t) => cat.includes(t) || productName.includes(t));
      const isGasoline = ['bencina', 'gasolina', 'combustible'].some((t) => cat.includes(t) || productName.includes(t));

      if (isDiesel && !productName.includes('bencina') && !productName.includes('gasolina')) {
        totalDieselLiters += finalQty;
        totalDieselCost += finalPrice;
      } else if (isGasoline) {
        totalGasLiters += finalQty;
        totalGasCost += finalPrice;
      }
    });
  });

  const avgPriceDiesel = totalDieselLiters > 0 ? totalDieselCost / totalDieselLiters : 0;
  const avgPriceGasoline = totalGasLiters > 0 ? totalGasCost / totalGasLiters : 0;

  const consumptionApplicationIds = new Set<string>();
  ((raw as any).fuelConsumption || []).forEach((c: any) => {
    if (c?.application_id) consumptionApplicationIds.add(String(c.application_id));
  });

  const fuelFromApplicationsBySector = new Map<string, { diesel: number; gasoline: number }>();
  (((raw as any).applicationItems || []) as any[]).forEach((row: any) => {
    const app = pickFirst(row.applications);
    if (!app?.sector_id || !app?.application_date) return;
    if (!inFilter(String(app.application_date), params.filter)) return;

    const appId = String(row.application_id || app.id || '');
    if (appId && consumptionApplicationIds.has(appId)) return;

    const product = pickFirst(row.products);
    const cat = normalize(product?.category);
    const name = normalize(product?.name);

    const isDiesel = ['petroleo', 'diesel'].some((t) => cat.includes(t) || name.includes(t));
    const isGasoline = ['bencina', 'gasolina', 'combustible'].some((t) => cat.includes(t) || name.includes(t));
    if (!isDiesel && !isGasoline) return;

    const sectorId = String(app.sector_id);
    const curr = fuelFromApplicationsBySector.get(sectorId) || { diesel: 0, gasoline: 0 };
    const cost = Number(row.total_cost || 0);
    if (isDiesel && !name.includes('bencina') && !name.includes('gasolina')) curr.diesel += cost;
    else curr.gasoline += cost;
    fuelFromApplicationsBySector.set(sectorId, curr);
  });

  ((raw as any).fuelConsumption || []).forEach((item: any) => {
    if (!item?.sector_id || !item?.date) return;
    if (!inFilter(String(item.date), params.filter)) return;
    const sectorId = String(item.sector_id);
    const activity = normalize(item.activity);
    const liters = Number(item.liters || 0);
    let cost = Number(item.estimated_price || 0);
    const isGasoline = activity.includes('gasolina') || activity.includes('bencina');

    if (cost === 0 && liters > 0) {
      cost = liters * (isGasoline ? avgPriceGasoline : avgPriceDiesel);
    }

    addFuel(sectorId, isGasoline ? 'gasoline' : 'diesel', cost);
  });

  fuelFromApplicationsBySector.forEach((v, sectorId) => {
    addFuel(sectorId, 'diesel', v.diesel);
    addFuel(sectorId, 'gasoline', v.gasoline);
  });

  const sectorRows: SectorCostRow[] = [];

  sectorIndex.forEach((meta, sectorId) => {
    const breakdown = emptyBreakdown();
    const fuelFromApps = fuelFromApplicationsBySector.get(String(sectorId)) || { diesel: 0, gasoline: 0 };
    breakdown.applications = Math.max((appsTotalBySector.get(sectorId) || 0) - (fuelFromApps.diesel + fuelFromApps.gasoline), 0);
    breakdown.labor = laborBySector.get(sectorId) || 0;
    breakdown.workers = workersBySector.get(sectorId) || 0;
    breakdown.fuel_diesel = fuelDieselBySector.get(sectorId) || 0;
    breakdown.fuel_gasoline = fuelGasolineBySector.get(sectorId) || 0;
    breakdown.machinery = machineryBySector.get(sectorId) || 0;
    breakdown.irrigation = irrigationBySector.get(sectorId) || 0;
    breakdown.distribution = distBySector.get(sectorId) || 0;

    const total_cost =
      breakdown.applications +
      breakdown.labor +
      breakdown.workers +
      breakdown.fuel_diesel +
      breakdown.fuel_gasoline +
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
    target.breakdown.fuel_diesel += r.breakdown.fuel_diesel;
    target.breakdown.fuel_gasoline += r.breakdown.fuel_gasoline;
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
