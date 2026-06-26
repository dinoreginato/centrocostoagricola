import { getSeasonFromRawDate } from './agriculturalData';

export type AgriculturalCostCategory =
  | 'Aplicaciones'
  | 'Labores'
  | 'Trabajadores'
  | 'Combustible'
  | 'Maquinaria'
  | 'Riego'
  | 'Generales';

export type AgriculturalCostSource =
  | 'applications'
  | 'labor_assignments'
  | 'worker_costs'
  | 'fuel_assignments'
  | 'fuel_consumption'
  | 'machinery_assignments'
  | 'irrigation_assignments'
  | 'general_costs';

export interface AgriculturalCostMovement {
  source: AgriculturalCostSource;
  category: AgriculturalCostCategory;
  subCategory?: string;
  date: string;
  season: string | null;
  fieldId: string | null;
  sectorId: string | null;
  amount: number;
}

type SectorMeta = { fieldId: string };

export const normalizeLaborSubCategory = (laborType?: string | null) => {
  const type = String(laborType || '').toLowerCase();
  if (type.includes('cosecha')) return 'Cosecha';
  if (type.includes('poda')) return 'Poda';
  if (type.includes('raleo')) return 'Raleo';
  return 'Otros';
};

export const resolveFuelSubCategory = (activity?: string | null) => {
  const value = String(activity || '').toLowerCase();
  if (value.includes('gasolina') || value.includes('bencina')) return 'Gasolina';
  return 'Diesel';
};

export const buildAgriculturalCostMovements = (params: {
  sectorMeta?: Map<string, SectorMeta>;
  fuelPrices?: { diesel?: number; gasoline?: number };
  applications?: any[];
  labor?: any[];
  workerCosts?: any[];
  fuelAssignments?: any[];
  fuelConsumption?: any[];
  machinery?: any[];
  irrigation?: any[];
  generalCosts?: any[];
}) => {
  const movements: AgriculturalCostMovement[] = [];
  const sectorMeta = params.sectorMeta || new Map<string, SectorMeta>();
  const fuelPrices = {
    diesel: Number(params.fuelPrices?.diesel || 0),
    gasoline: Number(params.fuelPrices?.gasoline || 0)
  };

  const pushMovement = (movement: Omit<AgriculturalCostMovement, 'season'>) => {
    const amount = Number(movement.amount || 0);
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.0001) return;
    const date = String(movement.date || '');
    if (!date) return;
    const season = getSeasonFromRawDate(date);
    movements.push({
      ...movement,
      amount,
      season
    });
  };

  (params.applications || []).forEach((item) => {
    const fieldId = item.field_id || sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'applications',
      category: 'Aplicaciones',
      date: item.application_date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.total_cost || 0)
    });
  });

  (params.labor || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'labor_assignments',
      category: 'Labores',
      subCategory: normalizeLaborSubCategory(item.labor_type),
      date: item.assigned_date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.assigned_amount || 0)
    });
  });

  (params.workerCosts || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'worker_costs',
      category: 'Trabajadores',
      date: item.date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.amount || 0)
    });
  });

  (params.fuelAssignments || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'fuel_assignments',
      category: 'Combustible',
      subCategory: 'Diesel',
      date: item.assigned_date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.assigned_amount || 0)
    });
  });

  (params.fuelConsumption || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    const subCategory = resolveFuelSubCategory(item.activity);
    let amount = Number(item.estimated_price || 0);
    if (amount === 0 && Number(item.liters || 0) > 0) {
      amount = Number(item.liters || 0) * (subCategory === 'Gasolina' ? fuelPrices.gasoline : fuelPrices.diesel);
    }
    pushMovement({
      source: 'fuel_consumption',
      category: 'Combustible',
      subCategory,
      date: item.date,
      fieldId,
      sectorId: item.sector_id || null,
      amount
    });
  });

  (params.machinery || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'machinery_assignments',
      category: 'Maquinaria',
      date: item.assigned_date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.assigned_amount || 0)
    });
  });

  (params.irrigation || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'irrigation_assignments',
      category: 'Riego',
      date: item.assigned_date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.assigned_amount || 0)
    });
  });

  (params.generalCosts || []).forEach((item) => {
    const fieldId = sectorMeta.get(String(item.sector_id || ''))?.fieldId || null;
    pushMovement({
      source: 'general_costs',
      category: 'Generales',
      date: item.date,
      fieldId,
      sectorId: item.sector_id || null,
      amount: Number(item.amount || 0)
    });
  });

  return movements;
};

export const aggregateCostMovementsBySector = (movements: AgriculturalCostMovement[]) => {
  const summary = new Map<string, {
    total: number;
    byCategory: Record<string, number>;
    bySubCategory: Record<string, number>;
  }>();

  movements.forEach((movement) => {
    const sectorId = String(movement.sectorId || '');
    if (!sectorId) return;
    const current = summary.get(sectorId) || {
      total: 0,
      byCategory: {},
      bySubCategory: {}
    };
    current.total += Number(movement.amount || 0);
    current.byCategory[movement.category] = (current.byCategory[movement.category] || 0) + Number(movement.amount || 0);
    if (movement.subCategory) {
      const key = `${movement.category}:${movement.subCategory}`;
      current.bySubCategory[key] = (current.bySubCategory[key] || 0) + Number(movement.amount || 0);
    }
    summary.set(sectorId, current);
  });

  return summary;
};
