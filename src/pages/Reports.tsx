import { toast } from 'sonner';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { getSeasonFromDate, isDateInSeason } from '../lib/seasonUtils';
import { aggregateCostMovementsBySector, type AgriculturalCostMovement } from '../lib/costMovements';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Loader2, PieChart as PieChartIcon, AlertCircle, Beaker, FileText, X, Printer, Settings, DollarSign, Scale, Play, ChevronLeft, ChevronRight, Layers, Plus, Pencil, Trash2, Database } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';
import { loadReportsRawData } from '../services/reports';
import { loadAgriculturalCostAudit, loadAgriculturalCostAuditSummary, type AgriculturalCostAuditRow, type AgriculturalCostAuditSummaryRow } from '../services/costAudit';
import { loadAgriculturalMarginRows, type AgriculturalMarginRow } from '../services/agriculturalMargin';
import { loadProductionRecords, upsertProductionRecord, deleteProductionRecord, type ProductionRecord } from '../services/productionRecords';
import {
  createExecutiveExportWarningEvent,
  loadExecutiveExportWarningEvents,
  type ExecutiveExportWarningEventRow
} from '../services/executiveExportWarningEvents';
import { exportJsonToXlsx, exportWorkbookToXlsx } from '../lib/excel';

interface ReportData {
  field_name: string;
  sector_name: string;
  sector_id: string; 
  fruit_type?: string;
  hectares: number;
  total_cost: number;
  cost_per_ha: number;
  cost_per_kg: number;
  application_count: number;
  kg_produced?: number;
  kg_sold?: number;
  // Separate costs for specific reports
  app_cost_only: number;
  app_cost_per_ha: number;
  // Detailed costs
  labor_cost: number;
  labor_cosecha_cost: number;
  labor_poda_cost: number;
  labor_raleo_cost: number;
  labor_otros_cost: number;
  worker_cost: number; // New field for Plant Workers
  fuel_cost: number;
  fuel_cost_diesel: number; // New
  fuel_cost_gasoline: number; // New
  machinery_cost: number;
  irrigation_cost: number;
  general_cost: number; // New field for Other Costs
  budget_per_ha: number;
  total_budget: number;
  price_per_kg: number;
  kg_export?: number;
  price_export?: number;
  income_usd_export?: number;
  kg_jugo?: number;
  price_jugo?: number;
  income_usd_jugo?: number;
  income_estimated: number;
  production_source?: string;
  has_production_record?: boolean;
  profit_clp?: number;
  margin_pct?: number;
}

interface MonthlyExpense {
  month: string;
  total: number;
}

interface CategoryExpense {
  category: string;
  total: number;
  [key: string]: string | number;
}

interface PendingInvoice {
  id: string;
  invoice_number: string;
  supplier: string;
  due_date: string;
  total_amount: number;
  days_overdue: number;
  notes?: string;
  categories: string[];
}

interface ProductExpense {
  name: string;
  category: string;
  total_quantity: number;
  total_cost: number;
  avg_price: number;
}

// Detailed Report Interfaces
interface DetailedItem {
  date: string;
  supplier: string;
  invoiceNumber: string;
  description: string;
  total: number;
}

interface DetailedCategory {
  name: string;
  total: number;
  items: DetailedItem[];
}

interface DetailedMonth {
  monthName: string;
  monthIndex: number; // 0-11
  total: number;
  categories: DetailedCategory[];
}

interface IncomeEntry {
    id: string;
    date: string;
    category: string;
    amount: number;
    description: string;
    season: string;
    field_id?: string;
    sector_id?: string;
    fields?: { name: string };
    sectors?: { name: string };
    quantity_kg?: number;
    amount_usd?: number;
    price_per_kg?: number;
    export_percentage?: number;
}

interface EditingProductionRecord {
  id?: string | null;
  sector_id?: string;
  kg_produced?: number;
  price_per_kg?: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1', '#a4de6c', '#d0ed57'];
const MONTH_NAMES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_NAMES_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const buildExecutiveSeasonMonths = (season: string) => {
  const [startYearStr] = String(season || '').split('-');
  const startYear = Number(startYearStr) || new Date().getFullYear();
  const defs: Array<{ key: string; shortLabel: string; fullLabel: string }> = [];

  for (let month = 4; month <= 11; month += 1) {
    defs.push({
      key: `${startYear}-${String(month + 1).padStart(2, '0')}`,
      shortLabel: MONTH_NAMES_SHORT[month],
      fullLabel: `${MONTH_NAMES_LONG[month]} ${startYear}`
    });
  }

  for (let month = 0; month <= 3; month += 1) {
    defs.push({
      key: `${startYear + 1}-${String(month + 1).padStart(2, '0')}`,
      shortLabel: MONTH_NAMES_SHORT[month],
      fullLabel: `${MONTH_NAMES_LONG[month]} ${startYear + 1}`
    });
  }

  return defs;
};

const parseExecutiveMonthKey = (rawDate: string) => {
  if (!rawDate) return null;
  const parsed = new Date(`${String(rawDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
};

const getExecutiveTone = (variationPct: number) => {
  if (variationPct >= 30) {
    return {
      badge: 'bg-red-100 text-red-700 border-red-200',
      text: 'text-red-600',
      dot: 'bg-red-500',
      label: 'Alto'
    };
  }
  if (variationPct >= 15) {
    return {
      badge: 'bg-amber-100 text-amber-700 border-amber-200',
      text: 'text-amber-600',
      dot: 'bg-amber-500',
      label: 'Medio'
    };
  }
  return {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    text: 'text-emerald-600',
    dot: 'bg-emerald-500',
    label: 'Controlado'
  };
};

type ExecutiveSortKey = 'total' | 'variation' | 'budget' | 'cost_ha' | 'cost_kg';
type ExecutiveAuditPriorityFilter = 'all' | 'alta' | 'media' | 'baja';
type ExecutiveAuditLayerFilter = 'all' | AgriculturalCostAuditRow['source_layer'];
type ExecutiveExportAction = 'pdf' | 'excel';
type ClosureTrendDirection = 'mejora' | 'estable' | 'deterioro' | 'sin_base';
type ExecutiveRecommendationDecision = 'presentar' | 'presentar_con_cautela' | 'no_presentar';
type ExecutiveRankingTier = 'fuerte' | 'intermedio' | 'fragil';

const EXECUTIVE_SORT_OPTIONS: Array<{ value: ExecutiveSortKey; label: string }> = [
  { value: 'total', label: 'Mayor gasto' },
  { value: 'variation', label: 'Mayor variacion' },
  { value: 'budget', label: 'Mayor desviacion ppto' },
  { value: 'cost_ha', label: 'Mayor costo / ha' },
  { value: 'cost_kg', label: 'Mayor costo / kg' }
];

const EXECUTIVE_AUDIT_PRIORITY_OPTIONS: Array<{ value: ExecutiveAuditPriorityFilter; label: string }> = [
  { value: 'all', label: 'Todas las prioridades' },
  { value: 'alta', label: 'Prioridad alta' },
  { value: 'media', label: 'Prioridad media' },
  { value: 'baja', label: 'Prioridad baja' }
];

const EXECUTIVE_AUDIT_LAYER_OPTIONS: Array<{ value: ExecutiveAuditLayerFilter; label: string }> = [
  { value: 'all', label: 'Todas las capas' },
  { value: 'Operacional', label: 'Operacional' },
  { value: 'Distribucion', label: 'Distribucion' },
  { value: 'Manual', label: 'Manual' },
  { value: 'Contable', label: 'Contable' },
  { value: 'Otro', label: 'Otro' }
];

const EXECUTIVE_EXPORT_WARNING_TYPE_LABELS: Record<string, string> = {
  committee_not_ready: 'Comité no listo',
  trend_deterioration_high_closure: 'Deterioro con cierre alto'
};

const formatExecutiveExportWarningType = (value: string) => (
  EXECUTIVE_EXPORT_WARNING_TYPE_LABELS[value]
  || value
    .split('_')
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ')
);

const formatExecutiveExportActor = (value: string | null | undefined) => (
  value ? `Usuario ${value.slice(0, 8)}` : 'Sin usuario'
);

const buildExecutiveExportWarningAnalytics = (
  rows: ExecutiveExportWarningEventRow[],
  selectedSeason: string,
  scopeLabel: string
) => {
  const currentSeasonRows = rows.filter((row) => row.season === selectedSeason);
  const latestEvent = rows[0] || null;
  const latestCurrentSeasonEvent = currentSeasonRows[0] || null;
  const byFormat = {
    pdf: rows.filter((row) => row.export_format === 'pdf').length,
    excel: rows.filter((row) => row.export_format === 'excel').length
  };
  const warningTypeSummary = Array.from(
    rows.reduce((map, row) => {
      (row.warning_types || []).forEach((warningType) => {
        map.set(warningType, (map.get(warningType) || 0) + 1);
      });
      return map;
    }, new Map<string, number>())
  )
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  const seasonSummary = Array.from(
    rows.reduce((map, row) => {
      const current = map.get(row.season) || { season: row.season, count: 0 };
      current.count += 1;
      map.set(row.season, current);
      return map;
    }, new Map<string, { season: string; count: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.season.localeCompare(a.season));
  const dominantFormat = byFormat.pdf === byFormat.excel
    ? byFormat.pdf > 0 ? 'PDF y Excel' : 'Sin eventos'
    : byFormat.pdf > byFormat.excel
      ? 'PDF'
      : 'Excel';
  const topWarningType = warningTypeSummary[0] || null;
  const topSeason = seasonSummary[0] || null;
  const summaryLine = latestEvent
    ? `Se registran ${rows.length} exportaciones ejecutivas bajo advertencia para ${scopeLabel}. La última ocurrió en ${latestEvent.season} vía ${latestEvent.export_format.toUpperCase()} con estado ${latestEvent.readiness_title}.`
    : `No hay exportaciones ejecutivas bajo advertencia para ${scopeLabel}.`;

  return {
    rows,
    currentSeasonRows,
    latestEvent,
    latestCurrentSeasonEvent,
    recentRows: rows.slice(0, 12),
    byFormat,
    dominantFormat,
    seasonSummary,
    topSeason,
    warningTypeSummary,
    topWarningType,
    totalEvents: rows.length,
    summaryLine
  };
};

const getExecutiveSortMetric = (row: any, sortBy: ExecutiveSortKey) => {
  switch (sortBy) {
    case 'variation':
      return Math.abs(Number(row?.deltaPct || 0));
    case 'budget':
      return Math.abs(Number(row?.budgetDelta || 0));
    case 'cost_ha':
      return Number(row?.costPerHa || 0);
    case 'cost_kg':
      return Number(row?.costPerKg || 0);
    case 'total':
    default:
      return Number(row?.total || 0);
  }
};

const formatExecutiveCompareMetric = (value: number, format: 'percent' | 'number') => (
  format === 'percent'
    ? `${Number(value || 0).toFixed(1)}%`
    : Number(value || 0).toLocaleString('es-CL')
);

const buildClosureTrendSummary = (
  rows: Array<{ season: string; totalClosurePct: number }>,
  companyLabel: string,
  windowSize = 3
) => {
  const normalizedRows = rows
    .filter((row) => Number.isFinite(Number(row.totalClosurePct)))
    .slice()
    .sort((a, b) => b.season.localeCompare(a.season));
  const recentRows = normalizedRows.slice(0, windowSize);
  const previousRows = normalizedRows.slice(windowSize, windowSize * 2);
  const recentAvg = recentRows.length > 0
    ? recentRows.reduce((sum, row) => sum + Number(row.totalClosurePct || 0), 0) / recentRows.length
    : 0;
  const previousAvg = previousRows.length > 0
    ? previousRows.reduce((sum, row) => sum + Number(row.totalClosurePct || 0), 0) / previousRows.length
    : 0;
  const latest = recentRows[0] || null;
  const baseline = previousRows[0] || normalizedRows[recentRows.length] || null;
  const delta = previousRows.length > 0
    ? recentAvg - previousAvg
    : latest && baseline && latest.season !== baseline.season
      ? Number(latest.totalClosurePct || 0) - Number(baseline.totalClosurePct || 0)
      : 0;

  const direction: ClosureTrendDirection = normalizedRows.length < 2
    ? 'sin_base'
    : delta >= 5
      ? 'mejora'
      : delta <= -5
        ? 'deterioro'
        : 'estable';

  const tone = direction === 'mejora'
    ? {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        text: 'text-emerald-600',
        dot: 'bg-emerald-500',
        label: 'Mejora'
      }
    : direction === 'deterioro'
      ? {
          badge: 'bg-red-100 text-red-700 border-red-200',
          text: 'text-red-600',
          dot: 'bg-red-500',
          label: 'Deterioro'
        }
      : direction === 'estable'
        ? {
            badge: 'bg-amber-100 text-amber-700 border-amber-200',
            text: 'text-amber-600',
            dot: 'bg-amber-500',
            label: 'Estable'
          }
        : {
            badge: 'bg-slate-100 text-slate-700 border-slate-200',
            text: 'text-slate-600',
            dot: 'bg-slate-500',
            label: 'Sin base'
          };

  const recentWindowLabel = recentRows.length > 0
    ? `${recentRows[recentRows.length - 1].season} a ${recentRows[0].season}`
    : 'Sin ventana';
  const previousWindowLabel = previousRows.length > 0
    ? `${previousRows[previousRows.length - 1].season} a ${previousRows[0].season}`
    : 'Sin ventana previa';

  const narrative = direction === 'sin_base'
    ? `${companyLabel} todavía no tiene temporadas suficientes para medir tendencia histórica con ventana móvil.`
    : direction === 'mejora'
      ? `${companyLabel} mejora su cierre total reciente en ${Math.abs(delta).toFixed(1)} puntos frente a la ventana previa.`
      : direction === 'deterioro'
        ? `${companyLabel} deteriora su cierre total reciente en ${Math.abs(delta).toFixed(1)} puntos frente a la ventana previa.`
        : `${companyLabel} se mantiene estable, con una variación reciente de ${Math.abs(delta).toFixed(1)} puntos.`;

  return {
    companyLabel,
    windowSize,
    direction,
    tone,
    recentAvg,
    previousAvg,
    delta,
    recentWindowLabel,
    previousWindowLabel,
    recentRows,
    previousRows,
    latest,
    narrative
  };
};

const buildHighClosureTrendWarning = (params: {
  totalClosurePct: number;
  trend: ReturnType<typeof buildClosureTrendSummary>;
  compareCompanyLabel?: string | null;
  compareTrend?: ReturnType<typeof buildClosureTrendSummary> | null;
}) => {
  const isHighCurrentClosure = Number(params.totalClosurePct || 0) >= 75;
  const isNegativeTrend = params.trend.direction === 'deterioro';

  if (!isHighCurrentClosure || !isNegativeTrend) return null;

  const compareLine = params.compareTrend && params.compareCompanyLabel
    ? params.compareTrend.direction === 'mejora'
      ? `${params.compareCompanyLabel} mejora en la misma ventana, por lo que la brecha competitiva puede ampliarse.`
      : params.compareTrend.direction === 'estable'
        ? `${params.compareCompanyLabel} se mantiene estable en la misma ventana.`
        : `${params.compareCompanyLabel} también deteriora su tendencia, aunque conviene revisar la velocidad relativa.`
    : null;

  return {
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
    title: 'Alerta preventiva por tendencia',
    shortLabel: 'Tendencia empeorando',
    detail: `La temporada actual muestra ${Number(params.totalClosurePct || 0).toFixed(1)}% de cierre total, pero la ventana reciente cae ${Math.abs(Number(params.trend.delta || 0)).toFixed(1)} puntos frente a la previa.`,
    recommendation: 'Conviene presentar el dato con cautela, porque la foto puntual se ve alta pero la pendiente reciente pierde solidez.',
    compareLine
  };
};

const buildExecutiveRecommendation = (params: {
  companyLabel: string;
  totalClosure: {
    totalClosurePct: number;
    economicPct: number;
    traceabilityPct: number;
    officialSupportPct: number;
    blockers: string[];
    readiness: { title: string };
  };
  trend: ReturnType<typeof buildClosureTrendSummary>;
  trendWarning: ReturnType<typeof buildHighClosureTrendWarning> | null;
  compareCompanyLabel?: string | null;
  compareTotalClosurePct?: number | null;
  compareTrend?: ReturnType<typeof buildClosureTrendSummary> | null;
}) => {
  const closurePct = Number(params.totalClosure.totalClosurePct || 0);
  const blockerCount = params.totalClosure.blockers.length;
  const compareGap = params.compareTotalClosurePct === null || params.compareTotalClosurePct === undefined
    ? null
    : closurePct - Number(params.compareTotalClosurePct || 0);

  const decision: ExecutiveRecommendationDecision = params.totalClosure.readiness.title === 'No listo para comité'
    ? 'no_presentar'
    : params.totalClosure.readiness.title === 'Listo con advertencias' || Boolean(params.trendWarning)
      ? 'presentar_con_cautela'
      : 'presentar';

  const tone = decision === 'presentar'
    ? {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        title: 'Presentar a comité'
      }
    : decision === 'presentar_con_cautela'
      ? {
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          title: 'Presentar con cautela'
        }
      : {
          badge: 'bg-red-100 text-red-700 border-red-200',
          dot: 'bg-red-500',
          title: 'No presentar todavía'
        };

  const reasons = [
    `Cierre total actual: ${closurePct.toFixed(1)}%.`,
    blockerCount > 0
      ? `${blockerCount} bloqueo${blockerCount === 1 ? '' : 's'} principal${blockerCount === 1 ? '' : 'es'} siguen abierto${blockerCount === 1 ? '' : 's'}.`
      : 'No hay bloqueos críticos visibles.',
    params.trendWarning
      ? params.trendWarning.detail
      : `${params.companyLabel} muestra una tendencia ${params.trend.tone.label.toLowerCase()} en la ventana reciente.`,
    compareGap === null || !params.compareCompanyLabel
      ? null
      : Math.abs(compareGap) < 0.05
        ? `Mantiene un cierre total equivalente frente a ${params.compareCompanyLabel}.`
        : compareGap > 0
          ? `Supera a ${params.compareCompanyLabel} por ${Math.abs(compareGap).toFixed(1)} puntos de cierre total.`
          : `Queda por debajo de ${params.compareCompanyLabel} por ${Math.abs(compareGap).toFixed(1)} puntos de cierre total.`
  ].filter(Boolean) as string[];

  const summary = decision === 'presentar'
    ? `${params.companyLabel} puede presentarse como lectura principal para comité.`
    : decision === 'presentar_con_cautela'
      ? `${params.companyLabel} puede presentarse, pero requiere contexto ejecutivo explícito antes de circularlo.`
      : `${params.companyLabel} no debería circularse como lectura principal de comité hasta corregir los focos abiertos.`;

  const nextStep = decision === 'presentar'
    ? 'Usar esta temporada como base principal y acompañarla con el comparativo histórico entre empresas.'
    : decision === 'presentar_con_cautela'
      ? 'Presentar junto con bloqueos, tendencia y advertencias visibles para evitar sobreinterpretación.'
      : 'Resolver bloqueos estructurales y revisar el cierre antes de reactivar la presentación a comité.';

  return {
    decision,
    tone,
    summary,
    nextStep,
    reasons
  };
};

const buildExecutiveCompanyRanking = (params: {
  companyLabel: string;
  totalClosurePct: number;
  blockerCount: number;
  trend: ReturnType<typeof buildClosureTrendSummary>;
}) => {
  const closureWeight = 0.6;
  const trendWeight = 0.25;
  const blockersWeight = 0.15;
  const normalizedClosure = Math.max(0, Math.min(100, Number(params.totalClosurePct || 0)));
  const normalizedTrend = Math.max(0, Math.min(100, ((Math.max(-15, Math.min(15, Number(params.trend.delta || 0))) + 15) / 30) * 100));
  const normalizedBlockers = Math.max(0, 100 - (Math.max(0, Number(params.blockerCount || 0)) * 20));
  const score = Number((
    (normalizedClosure * closureWeight)
    + (normalizedTrend * trendWeight)
    + (normalizedBlockers * blockersWeight)
  ).toFixed(2));
  const tier: ExecutiveRankingTier = score >= 75
    ? 'fuerte'
    : score >= 55
      ? 'intermedio'
      : 'fragil';
  const tone = tier === 'fuerte'
    ? {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        label: 'Base fuerte'
      }
    : tier === 'intermedio'
      ? {
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          label: 'Base intermedia'
        }
      : {
          badge: 'bg-red-100 text-red-700 border-red-200',
          dot: 'bg-red-500',
          label: 'Base frágil'
        };

  return {
    companyLabel: params.companyLabel,
    score,
    tier,
    tone,
    components: {
      closure: Number(normalizedClosure.toFixed(2)),
      trend: Number(normalizedTrend.toFixed(2)),
      blockers: Number(normalizedBlockers.toFixed(2))
    },
    weights: {
      closure: closureWeight,
      trend: trendWeight,
      blockers: blockersWeight
    },
    narrative: `${params.companyLabel} obtiene ${score.toFixed(1)} puntos: cierre ${normalizedClosure.toFixed(1)}, tendencia ${normalizedTrend.toFixed(1)} y disciplina de bloqueos ${normalizedBlockers.toFixed(1)}.`
  };
};

const sortExecutiveRows = <T extends Record<string, any>>(rows: T[], sortBy: ExecutiveSortKey) => {
  return rows.slice().sort((a, b) => {
    const primary = getExecutiveSortMetric(b, sortBy) - getExecutiveSortMetric(a, sortBy);
    if (Math.abs(primary) > 0.0001) return primary;
    return Number(b?.total || 0) - Number(a?.total || 0);
  });
};

const aggregateExecutiveCosts = (params: {
  seasonMonths: Array<{ key: string; shortLabel: string; fullLabel: string }>;
  seasonMonthKeys: Set<string>;
  sectorMeta: Map<string, { fieldId: string; fieldName: string; sectorName: string; hectares: number }>;
  fieldMeta: Map<string, { fieldName: string; hectares: number }>;
  fuelPrices: { diesel: number; gasoline: number };
  costMovements?: AgriculturalCostMovement[];
  rawApplications: any[];
  rawLabor: any[];
  rawWorkerCosts: any[];
  rawFuel: any[];
  rawFuelConsumption: any[];
  rawMachinery: any[];
  rawIrrigation: any[];
  rawGeneralCosts: any[];
}) => {
  const monthlyTotals = new Map<string, number>();
  const fieldMonthly = new Map<string, Map<string, number>>();
  const sectorMonthly = new Map<string, Map<string, number>>();

  params.seasonMonths.forEach((month) => {
    monthlyTotals.set(month.key, 0);
  });

  const addAmount = (bucket: Map<string, Map<string, number>>, entityId: string, monthKey: string, amount: number) => {
    const current = bucket.get(entityId) || new Map<string, number>();
    current.set(monthKey, (current.get(monthKey) || 0) + amount);
    bucket.set(entityId, current);
  };

  const registerCost = (sectorId: string, rawDate: string, rawAmount: number) => {
    const meta = params.sectorMeta.get(sectorId);
    if (!meta) return;
    const monthKey = parseExecutiveMonthKey(rawDate);
    if (!monthKey || !params.seasonMonthKeys.has(monthKey)) return;
    const amount = Number(rawAmount || 0);
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.0001) return;

    monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) || 0) + amount);
    addAmount(fieldMonthly, meta.fieldId, monthKey, amount);
    addAmount(sectorMonthly, sectorId, monthKey, amount);
  };

  if (params.costMovements && params.costMovements.length > 0) {
    params.costMovements.forEach((item) => {
      registerCost(String(item.sectorId || ''), String(item.date || ''), Number(item.amount || 0));
    });
  } else {
    params.rawApplications.forEach((item: any) => registerCost(item.sector_id, item.application_date, Number(item.total_cost || 0)));
    params.rawLabor.forEach((item: any) => registerCost(item.sector_id, item.assigned_date, Number(item.assigned_amount || 0)));
    params.rawWorkerCosts.forEach((item: any) => registerCost(item.sector_id, item.date, Number(item.amount || 0)));
    params.rawFuel.forEach((item: any) => registerCost(item.sector_id, item.assigned_date, Number(item.assigned_amount || 0)));
    params.rawFuelConsumption.forEach((item: any) => {
      const activity = String(item.activity || '').toLowerCase();
      const isGasoline = activity.includes('gasolina') || activity.includes('bencina');
      let cost = Number(item.estimated_price || 0);
      if (cost === 0 && Number(item.liters || 0) > 0) {
        cost = Number(item.liters || 0) * (isGasoline ? params.fuelPrices.gasoline : params.fuelPrices.diesel);
      }
      registerCost(item.sector_id, item.date, cost);
    });
    params.rawMachinery.forEach((item: any) => registerCost(item.sector_id, item.assigned_date, Number(item.assigned_amount || 0)));
    params.rawIrrigation.forEach((item: any) => registerCost(item.sector_id, item.assigned_date, Number(item.assigned_amount || 0)));
    params.rawGeneralCosts.forEach((item: any) => registerCost(item.sector_id, item.date, Number(item.amount || 0)));
  }

  const fieldRows = Array.from(params.fieldMeta.entries())
    .map(([fieldId, meta]) => {
      const months = params.seasonMonths.reduce<Record<string, number>>((acc, month) => {
        acc[month.key] = fieldMonthly.get(fieldId)?.get(month.key) || 0;
        return acc;
      }, {});
      const total = Object.values(months).reduce((sum, value) => sum + value, 0);
      return { fieldId, fieldName: meta.fieldName, hectares: meta.hectares, months, total };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const sectorRows = Array.from(params.sectorMeta.entries())
    .map(([sectorId, meta]) => {
      const months = params.seasonMonths.reduce<Record<string, number>>((acc, month) => {
        acc[month.key] = sectorMonthly.get(sectorId)?.get(month.key) || 0;
        return acc;
      }, {});
      const total = Object.values(months).reduce((sum, value) => sum + value, 0);
      return { sectorId, sectorName: meta.sectorName, fieldName: meta.fieldName, hectares: meta.hectares, months, total };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const monthlyRows = params.seasonMonths.map((month, index) => {
    const total = monthlyTotals.get(month.key) || 0;
    const previousTotal = index > 0 ? monthlyTotals.get(params.seasonMonths[index - 1].key) || 0 : 0;
    const variation = index > 0 ? total - previousTotal : 0;
    const variationPct = index > 0 && previousTotal > 0 ? (variation / previousTotal) * 100 : 0;

    const topField = fieldRows
      .map((row) => ({ name: row.fieldName, total: row.months[month.key] || 0 }))
      .sort((a, b) => b.total - a.total)[0];
    const topSector = sectorRows
      .map((row) => ({ name: row.sectorName, total: row.months[month.key] || 0 }))
      .sort((a, b) => b.total - a.total)[0];

    return {
      monthKey: month.key,
      monthLabel: month.fullLabel,
      shortLabel: month.shortLabel,
      total,
      variation,
      variationPct,
      topFieldName: topField?.total ? topField.name : '-',
      topSectorName: topSector?.total ? topSector.name : '-'
    };
  });

  const totalSeasonCost = monthlyRows.reduce((sum, row) => sum + row.total, 0);
  const totalHectares = fieldRows.reduce((sum, row) => sum + row.hectares, 0);
  const peakMonth = [...monthlyRows].sort((a, b) => b.total - a.total)[0] || null;
  const averageMonthlyCost = monthlyRows.length > 0 ? totalSeasonCost / monthlyRows.length : 0;

  return {
    monthlyRows,
    fieldRows,
    sectorRows,
    totalSeasonCost,
    totalHectares,
    averageMonthlyCost,
    peakMonth,
    topField: fieldRows[0] || null,
    topSector: sectorRows[0] || null
  };
};

// Categories considered as "Chemicals" or "Inputs"
const CHEMICAL_CATEGORIES = [
  'Quimicos', 'Plaguicida', 'Insecticida', 'Fungicida', 'Herbicida', 
  'Fertilizantes', 'fertilizante', 'pesticida', 'herbicida', 'fungicida'
];

export const Reports: React.FC = () => {
  const { selectedCompany, companies } = useCompany();
  const companyName = selectedCompany?.name || 'Empresa';
  const companySlug = companyName.replace(/\s+/g, '_');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'executive' | 'general' | 'costs_ha' | 'margin' | 'labors' | 'applications' | 'monthly' | 'categories' | 'pending' | 'overdue' | 'paid_payments' | 'fuel_machines' | 'chemicals' | 'stock_breaks' | 'detailed' | 'budget' | 'comparative'>('executive');
  const [activeGroup, setActiveGroup] = useState<'general' | 'financial' | 'inventory' | 'comparative'>('general');
  
  // Pending Invoices Filter State
  const [pendingStartDate, setPendingStartDate] = useState<string>('');
  const [pendingEndDate, setPendingEndDate] = useState<string>('');
  const [pendingSupplierFilter, setPendingSupplierFilter] = useState<string[]>([]);
  const [pendingCategoryFilter, setPendingCategoryFilter] = useState<string[]>([]);

  // Paid Invoices Filter State
  const [paidStartDate, setPaidStartDate] = useState<string>('');
  const [paidEndDate, setPaidEndDate] = useState<string>('');
  
  // Data State
  const [rawFields, setRawFields] = useState<any[]>([]);
  const [rawApplications, setRawApplications] = useState<any[]>([]);
  const [rawCostMovements, setRawCostMovements] = useState<AgriculturalCostMovement[]>([]);
  const [rawInvoices, setRawInvoices] = useState<any[]>([]);
  const [rawLabor, setRawLabor] = useState<any[]>([]); 
  const [rawWorkerCosts, setRawWorkerCosts] = useState<any[]>([]); // New state
  const [rawFuel, setRawFuel] = useState<any[]>([]); 
  const [rawFuelConsumption, setRawFuelConsumption] = useState<any[]>([]); // New: Fuel Consumption
  const [rawMachinery, setRawMachinery] = useState<any[]>([]); 
  const [rawIrrigation, setRawIrrigation] = useState<any[]>([]); 
  const [rawGeneralCosts, setRawGeneralCosts] = useState<any[]>([]); // New state
  const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>([]);
  const [rawProducts, setRawProducts] = useState<any[]>([]);
  const [rawMarginRows, setRawMarginRows] = useState<AgriculturalMarginRow[]>([]);
  const [rawProductionRecords, setRawProductionRecords] = useState<ProductionRecord[]>([]);
  const [costAuditRows, setCostAuditRows] = useState<AgriculturalCostAuditRow[]>([]);
  const [costAuditSummary, setCostAuditSummary] = useState<AgriculturalCostAuditSummaryRow[]>([]);
  const [costAuditHistorySummary, setCostAuditHistorySummary] = useState<AgriculturalCostAuditSummaryRow[]>([]);
  const [executiveExportWarningEvents, setExecutiveExportWarningEvents] = useState<ExecutiveExportWarningEventRow[]>([]);
  const [executiveExportWarningLoading, setExecutiveExportWarningLoading] = useState(false);
  const [costAuditLoading, setCostAuditLoading] = useState(false);
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [savingProductionRecord, setSavingProductionRecord] = useState(false);
  const [editingProductionRecord, setEditingProductionRecord] = useState<EditingProductionRecord>({});

  // Comparative State
  const [comparativeData, setComparativeData] = useState<any[]>([]);

  // Filter State
  const [selectedSeason, setSelectedSeason] = useState<string>(getSeasonFromDate(new Date()));
  const [availableSeasons, setAvailableSeasons] = useState<string[]>([]);

  // Settings State (USD, etc)
  const [usdExchangeRate, setUsdExchangeRate] = useState<number>(950);
  const [distributeGeneralCosts, setDistributeGeneralCosts] = useState(true);
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('landscape'); // Default landscape

  // Display State
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState<MonthlyExpense[]>([]);
  const [categoryExpenses, setCategoryExpenses] = useState<CategoryExpense[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [chemicalProducts, setChemicalProducts] = useState<ProductExpense[]>([]);
  const [detailedReport, setDetailedReport] = useState<DetailedMonth[]>([]);

  // Detailed Report Filters
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  // Chemical Report Filters
  const [filterChemicalCategory, setFilterChemicalCategory] = useState<string>('all');
  const [executiveFieldFilter, setExecutiveFieldFilter] = useState<string>('all');
  const [executiveComparisonSeason, setExecutiveComparisonSeason] = useState<string>('');
  const [executiveCompareCompanyId, setExecutiveCompareCompanyId] = useState<string>('none');
  const [executiveCompareCompanyRaw, setExecutiveCompareCompanyRaw] = useState<any | null>(null);
  const [executiveCompareFieldA, setExecutiveCompareFieldA] = useState<string>('auto');
  const [executiveCompareFieldB, setExecutiveCompareFieldB] = useState<string>('auto');
  const [executiveFieldSortBy, setExecutiveFieldSortBy] = useState<ExecutiveSortKey>('total');
  const [executiveSectorSortBy, setExecutiveSectorSortBy] = useState<ExecutiveSortKey>('total');
  const [executiveAuditPriorityFilter, setExecutiveAuditPriorityFilter] = useState<ExecutiveAuditPriorityFilter>('all');
  const [executiveAuditLayerFilter, setExecutiveAuditLayerFilter] = useState<ExecutiveAuditLayerFilter>('all');
  const [executiveExportWarningFormatFilter, setExecutiveExportWarningFormatFilter] = useState<'all' | 'pdf' | 'excel'>('all');
  const [executiveExportWarningTypeFilter, setExecutiveExportWarningTypeFilter] = useState<string>('all');
  const [executiveExportWarningActorFilter, setExecutiveExportWarningActorFilter] = useState<string>('all');

  // Preview Modal State
  const [showPreview, setShowPreview] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [pendingExecutiveExportAction, setPendingExecutiveExportAction] = useState<ExecutiveExportAction | null>(null);
  const reportLoadSeqRef = useRef(0);
  const costAuditLoadSeqRef = useRef(0);

  // Update orientation when tab changes
  useEffect(() => {
    if (activeTab === 'executive' || activeTab === 'general' || activeTab === 'detailed' || activeTab === 'labors' || activeTab === 'costs_ha' || activeTab === 'margin' || activeTab === 'fuel_machines') {
      setPdfOrientation('landscape');
    } else {
      setPdfOrientation('portrait');
    }
  }, [activeTab]);

  // Presentation State
  const [presentationMode, setPresentationMode] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Filtered Pending Invoices
  const filteredPendingInvoices = pendingInvoices.filter(invoice => {
    // 1. Filter by Supplier
    if (pendingSupplierFilter.length > 0 && !pendingSupplierFilter.includes(invoice.supplier)) {
      return false;
    }

    // 2. Filter by Category
    if (pendingCategoryFilter.length > 0) {
      const hasMatchingCategory = invoice.categories.some(cat => pendingCategoryFilter.includes(cat));
      if (!hasMatchingCategory) {
        return false;
      }
    }

    // 3. Filter by Date Range (Due Date)
    if (pendingStartDate || pendingEndDate) {
      const dateToCheck = new Date(invoice.due_date + 'T12:00:00');
      const start = pendingStartDate ? new Date(pendingStartDate + 'T00:00:00') : null;
      const end = pendingEndDate ? new Date(pendingEndDate + 'T23:59:59') : null;

      if (start && end) {
        return dateToCheck >= start && dateToCheck <= end;
      } else if (start) {
        return dateToCheck >= start;
      } else if (end) {
        return dateToCheck <= end;
      }
    }

    return true;
  });

  const filteredOverdueInvoices = filteredPendingInvoices.filter((inv) => inv.days_overdue > 0);

  const loadRawData = useCallback(() => {
    if (!selectedCompany) return;
    void loadRawDataImpl();
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) {
      loadRawData();
    }
  }, [selectedCompany, loadRawData]);

  useEffect(() => {
    setExecutiveFieldFilter('all');
    setExecutiveComparisonSeason('');
    setExecutiveCompareCompanyId('none');
    setExecutiveCompareCompanyRaw(null);
    setExecutiveCompareFieldA('auto');
    setExecutiveCompareFieldB('auto');
    setExecutiveFieldSortBy('total');
    setExecutiveSectorSortBy('total');
    setExecutiveAuditPriorityFilter('all');
    setExecutiveAuditLayerFilter('all');
    setExecutiveExportWarningFormatFilter('all');
    setExecutiveExportWarningTypeFilter('all');
    setExecutiveExportWarningActorFilter('all');
    setCurrentSlide(0);
    setPresentationMode(false);
    setRawCostMovements([]);
    setRawMarginRows([]);
    setRawProductionRecords([]);
    setCostAuditRows([]);
    setCostAuditSummary([]);
    setCostAuditHistorySummary([]);
    setExecutiveExportWarningEvents([]);
    setReportData([]);
    setMonthlyExpenses([]);
    setCategoryExpenses([]);
    setPendingInvoices([]);
    setChemicalProducts([]);
    setDetailedReport([]);
    setComparativeData([]);
  }, [selectedCompany?.id]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    const companyId = selectedCompany.id;
    const loadSeq = ++costAuditLoadSeqRef.current;
    setCostAuditLoading(true);

    void (async () => {
      try {
        const [summaryHistory, auditRows] = await Promise.all([
          loadAgriculturalCostAuditSummary({ companyId }),
          loadAgriculturalCostAudit({ companyId, season: selectedSeason })
        ]);

        if (costAuditLoadSeqRef.current !== loadSeq || selectedCompany?.id !== companyId) return;
        const historyRows = summaryHistory || [];
        setCostAuditHistorySummary(historyRows);
        setCostAuditSummary(historyRows.filter((row) => row.season === selectedSeason));
        setCostAuditRows(auditRows || []);
      } catch {
        if (costAuditLoadSeqRef.current !== loadSeq || selectedCompany?.id !== companyId) return;
        setCostAuditHistorySummary([]);
        setCostAuditSummary([]);
        setCostAuditRows([]);
      } finally {
        if (costAuditLoadSeqRef.current === loadSeq) {
          setCostAuditLoading(false);
        }
      }
    })();
  }, [selectedCompany?.id, selectedSeason]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    const companyId = selectedCompany.id;
    let cancelled = false;
    setExecutiveExportWarningLoading(true);

    void (async () => {
      try {
        const rows = await loadExecutiveExportWarningEvents({ companyId, limit: 100 });
        if (cancelled || selectedCompany?.id !== companyId) return;
        setExecutiveExportWarningEvents(rows || []);
      } catch {
        if (cancelled || selectedCompany?.id !== companyId) return;
        setExecutiveExportWarningEvents([]);
      } finally {
        if (!cancelled && selectedCompany?.id === companyId) {
          setExecutiveExportWarningLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCompany?.id]);

  const executiveComparableCompanies = useMemo(
    () => companies.filter((company) => company.id !== selectedCompany?.id),
    [companies, selectedCompany?.id]
  );

  const selectedSeasonStartYear = useMemo(() => {
    const [startYear] = String(selectedSeason || '').split('-');
    return Number(startYear) || new Date().getFullYear();
  }, [selectedSeason]);

  useEffect(() => {
    if (executiveCompareCompanyId === 'none') {
      setExecutiveCompareCompanyRaw(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [raw, marginRows, productionRecords, auditSummary] = await Promise.all([
          loadReportsRawData({ companyId: executiveCompareCompanyId }),
          loadAgriculturalMarginRows({ companyId: executiveCompareCompanyId }),
          loadProductionRecords({ companyId: executiveCompareCompanyId }),
          loadAgriculturalCostAuditSummary({ companyId: executiveCompareCompanyId })
        ]);
        if (!cancelled) {
          setExecutiveCompareCompanyRaw({
            ...raw,
            marginRows: marginRows || [],
            productionRecords: productionRecords || [],
            auditSummary: auditSummary || []
          });
        }
      } catch {
        if (!cancelled) {
          setExecutiveCompareCompanyRaw(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [executiveCompareCompanyId, selectedSeason]);

  const presentationMaxSlide = activeTab === 'executive' ? 11 : activeTab === 'general' ? 3 : 1;

  // Update presentation logic to support executive slides and legacy tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!presentationMode) return;

      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setCurrentSlide(s => Math.min(s + 1, presentationMaxSlide));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentSlide(s => Math.max(s - 1, 0));
      } else if (e.key === 'Escape') {
        exitPresentation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [presentationMode, presentationMaxSlide]);

  const executiveSeasonMonths = useMemo(() => buildExecutiveSeasonMonths(selectedSeason), [selectedSeason]);
  const availablePreviousExecutiveSeasons = useMemo(() => {
    const currentStartYear = Number(String(selectedSeason || '').split('-')[0] || 0);
    return [...availableSeasons]
      .filter((season) => season !== selectedSeason)
      .filter((season) => Number(String(season || '').split('-')[0] || 0) <= currentStartYear)
      .sort((a, b) => b.localeCompare(a));
  }, [availableSeasons, selectedSeason]);
  const previousExecutiveSeason = useMemo(() => {
    if (executiveComparisonSeason && availablePreviousExecutiveSeasons.includes(executiveComparisonSeason)) {
      return executiveComparisonSeason;
    }
    const [startYearStr] = String(selectedSeason || '').split('-');
    const startYear = Number(startYearStr) || new Date().getFullYear();
    const immediatePrevious = `${startYear - 1}-${startYear}`;
    if (availablePreviousExecutiveSeasons.includes(immediatePrevious)) return immediatePrevious;
    return availablePreviousExecutiveSeasons[0] || immediatePrevious;
  }, [availablePreviousExecutiveSeasons, executiveComparisonSeason, selectedSeason]);
  const previousExecutiveSeasonMonths = useMemo(() => buildExecutiveSeasonMonths(previousExecutiveSeason), [previousExecutiveSeason]);

  const executiveMonthKeySet = useMemo(() => new Set(executiveSeasonMonths.map((month) => month.key)), [executiveSeasonMonths]);
  const previousExecutiveMonthKeySet = useMemo(() => new Set(previousExecutiveSeasonMonths.map((month) => month.key)), [previousExecutiveSeasonMonths]);

  const executiveSectorMeta = useMemo(() => {
    const map = new Map<string, { fieldId: string; fieldName: string; sectorName: string; hectares: number }>();

    rawFields.forEach((field: any) => {
      (field.sectors || []).forEach((sector: any) => {
        map.set(sector.id, {
          fieldId: field.id,
          fieldName: field.name,
          sectorName: sector.name,
          hectares: Number(sector.hectares || 0)
        });
      });
    });

    return map;
  }, [rawFields]);

  const executiveFieldMeta = useMemo(() => {
    const map = new Map<string, { fieldName: string; hectares: number }>();

    rawFields.forEach((field: any) => {
      const hectares = (field.sectors || []).reduce((sum: number, sector: any) => sum + Number(sector.hectares || 0), 0);
      map.set(field.id, {
        fieldName: field.name,
        hectares
      });
    });

    return map;
  }, [rawFields]);

  const executiveFuelPrices = useMemo(() => {
    let totalDieselLiters = 0;
    let totalDieselCost = 0;
    let totalGasLiters = 0;
    let totalGasCost = 0;

    rawInvoices.forEach((inv: any) => {
      inv.invoice_items?.forEach((item: any) => {
        const cat = String(item.category || item.products?.category || '').toLowerCase().trim();
        const productName = String(item.products?.name || '').toLowerCase();
        const unit = String(item.products?.unit || '').toLowerCase().trim();
        const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];
        if (invalidUnits.includes(unit)) return;

        const docType = String(inv.document_type || '').toLowerCase();
        const isCreditNote = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
        const qty = Number(item.quantity || 0);
        const price = Number(item.total_price || 0);
        const finalQty = isCreditNote ? -Math.abs(qty) : qty;
        const finalPrice = isCreditNote ? -Math.abs(price) : price;

        const isDiesel = ['petroleo', 'diesel'].some((token) => cat.includes(token) || productName.includes(token));
        const isGasoline = ['bencina', 'gasolina', 'combustible'].some((token) => cat.includes(token) || productName.includes(token));

        if (isDiesel && !productName.includes('bencina') && !productName.includes('gasolina')) {
          totalDieselLiters += finalQty;
          totalDieselCost += finalPrice;
        } else if (isGasoline) {
          totalGasLiters += finalQty;
          totalGasCost += finalPrice;
        }
      });
    });

    return {
      diesel: totalDieselLiters > 0 ? totalDieselCost / totalDieselLiters : 0,
      gasoline: totalGasLiters > 0 ? totalGasCost / totalGasLiters : 0
    };
  }, [rawInvoices]);

  const executiveCurrentBase = useMemo(() => {
    return aggregateExecutiveCosts({
      seasonMonths: executiveSeasonMonths,
      seasonMonthKeys: executiveMonthKeySet,
      sectorMeta: executiveSectorMeta,
      fieldMeta: executiveFieldMeta,
      fuelPrices: executiveFuelPrices,
      costMovements: rawCostMovements,
      rawApplications,
      rawLabor,
      rawWorkerCosts,
      rawFuel,
      rawFuelConsumption,
      rawMachinery,
      rawIrrigation,
      rawGeneralCosts
    });
  }, [
    executiveFieldMeta,
    executiveFuelPrices,
    executiveMonthKeySet,
    executiveSeasonMonths,
    executiveSectorMeta,
    rawCostMovements,
    rawApplications,
    rawFuel,
    rawFuelConsumption,
    rawGeneralCosts,
    rawIrrigation,
    rawLabor,
    rawMachinery,
    rawWorkerCosts
  ]);

  const executivePreviousBase = useMemo(() => {
    return aggregateExecutiveCosts({
      seasonMonths: previousExecutiveSeasonMonths,
      seasonMonthKeys: previousExecutiveMonthKeySet,
      sectorMeta: executiveSectorMeta,
      fieldMeta: executiveFieldMeta,
      fuelPrices: executiveFuelPrices,
      costMovements: rawCostMovements,
      rawApplications,
      rawLabor,
      rawWorkerCosts,
      rawFuel,
      rawFuelConsumption,
      rawMachinery,
      rawIrrigation,
      rawGeneralCosts
    });
  }, [
    executiveFieldMeta,
    executiveFuelPrices,
    previousExecutiveMonthKeySet,
    previousExecutiveSeasonMonths,
    executiveSectorMeta,
    rawCostMovements,
    rawApplications,
    rawFuel,
    rawFuelConsumption,
    rawGeneralCosts,
    rawIrrigation,
    rawLabor,
    rawMachinery,
    rawWorkerCosts
  ]);

  const executiveData = useMemo(() => {
    const fieldBudgetMap = new Map<string, { budget: number; cost: number; hectares: number; kg: number }>();
    const sectorBudgetMap = new Map<string, { budget: number; cost: number; hectares: number; kg: number }>();

    reportData.forEach((row) => {
      const fieldKey = String(row.field_name || '').trim();
      const sectorKey = `${fieldKey}::${String(row.sector_name || '').trim()}`;
      const currentField = fieldBudgetMap.get(fieldKey) || { budget: 0, cost: 0, hectares: 0, kg: 0 };
      currentField.budget += Number(row.total_budget || 0);
      currentField.cost += Number(row.total_cost || 0);
      currentField.hectares += Number(row.hectares || 0);
      currentField.kg += Number(row.kg_produced || 0);
      fieldBudgetMap.set(fieldKey, currentField);

      const currentSector = sectorBudgetMap.get(sectorKey) || { budget: 0, cost: 0, hectares: 0, kg: 0 };
      currentSector.budget += Number(row.total_budget || 0);
      currentSector.cost += Number(row.total_cost || 0);
      currentSector.hectares += Number(row.hectares || 0);
      currentSector.kg += Number(row.kg_produced || 0);
      sectorBudgetMap.set(sectorKey, currentSector);
    });

    const categoryRows = [
      { category: 'Aplicaciones', total: reportData.reduce((sum, row) => sum + Number(row.app_cost_only || 0), 0) },
      { category: 'Labores', total: reportData.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0) },
      { category: 'Trabajadores', total: reportData.reduce((sum, row) => sum + Number(row.worker_cost || 0), 0) },
      { category: 'Combustible', total: reportData.reduce((sum, row) => sum + Number(row.fuel_cost || 0), 0) },
      { category: 'Maquinaria', total: reportData.reduce((sum, row) => sum + Number(row.machinery_cost || 0), 0) },
      { category: 'Riego', total: reportData.reduce((sum, row) => sum + Number(row.irrigation_cost || 0), 0) },
      { category: 'Generales', total: reportData.reduce((sum, row) => sum + Number(row.general_cost || 0), 0) }
    ].filter((row) => row.total > 0);

    const monthlyRows = executiveCurrentBase.monthlyRows.map((row, index) => {
      const previousSeasonTotal = executivePreviousBase.monthlyRows[index]?.total || 0;
      const vsPreviousSeason = row.total - previousSeasonTotal;
      const vsPreviousSeasonPct = previousSeasonTotal > 0 ? (vsPreviousSeason / previousSeasonTotal) * 100 : 0;
      return {
        ...row,
        previousSeasonTotal,
        vsPreviousSeason,
        vsPreviousSeasonPct
      };
    });

    const previousFieldMap = new Map(executivePreviousBase.fieldRows.map((row) => [row.fieldId, row]));
    const previousSectorMap = new Map(executivePreviousBase.sectorRows.map((row) => [row.sectorId, row]));

    const fieldRows = executiveCurrentBase.fieldRows.map((row) => {
      const previous = previousFieldMap.get(row.fieldId);
      const previousTotal = previous?.total || 0;
      const delta = row.total - previousTotal;
      const deltaPct = previousTotal > 0 ? (delta / previousTotal) * 100 : 0;
      const budgetInfo = fieldBudgetMap.get(row.fieldName) || { budget: 0, cost: row.total, hectares: row.hectares, kg: 0 };
      const budgetTotal = Number(budgetInfo.budget || 0);
      const costPerHa = row.hectares > 0 ? row.total / row.hectares : 0;
      const costPerKg = Number(budgetInfo.kg || 0) > 0 ? row.total / Number(budgetInfo.kg || 0) : 0;
      return {
        ...row,
        previousTotal,
        delta,
        deltaPct,
        sharePct: executiveCurrentBase.totalSeasonCost > 0 ? (row.total / executiveCurrentBase.totalSeasonCost) * 100 : 0,
        budgetTotal,
        budgetDelta: row.total - budgetTotal,
        budgetExecutionPct: budgetTotal > 0 ? (row.total / budgetTotal) * 100 : 0,
        kgProduced: Number(budgetInfo.kg || 0),
        costPerHa,
        costPerKg
      };
    });

    const sectorRows = executiveCurrentBase.sectorRows.map((row) => {
      const previous = previousSectorMap.get(row.sectorId);
      const previousTotal = previous?.total || 0;
      const delta = row.total - previousTotal;
      const deltaPct = previousTotal > 0 ? (delta / previousTotal) * 100 : 0;
      const budgetInfo = sectorBudgetMap.get(`${row.fieldName}::${row.sectorName}`) || { budget: 0, cost: row.total, hectares: row.hectares, kg: 0 };
      const budgetTotal = Number(budgetInfo.budget || 0);
      const costPerHa = row.hectares > 0 ? row.total / row.hectares : 0;
      const costPerKg = Number(budgetInfo.kg || 0) > 0 ? row.total / Number(budgetInfo.kg || 0) : 0;
      return {
        ...row,
        previousTotal,
        delta,
        deltaPct,
        sharePct: executiveCurrentBase.totalSeasonCost > 0 ? (row.total / executiveCurrentBase.totalSeasonCost) * 100 : 0,
        budgetTotal,
        budgetDelta: row.total - budgetTotal,
        budgetExecutionPct: budgetTotal > 0 ? (row.total / budgetTotal) * 100 : 0,
        kgProduced: Number(budgetInfo.kg || 0),
        costPerHa,
        costPerKg
      };
    });

    const seasonVariation = executiveCurrentBase.totalSeasonCost - executivePreviousBase.totalSeasonCost;
    const seasonVariationPct = executivePreviousBase.totalSeasonCost > 0 ? (seasonVariation / executivePreviousBase.totalSeasonCost) * 100 : 0;
    const totalBudget = reportData.reduce((sum, row) => sum + Number(row.total_budget || 0), 0);
    const totalKgProduced = reportData.reduce((sum, row) => sum + Number(row.kg_produced || 0), 0);
    const averageCostPerHa = executiveCurrentBase.totalHectares > 0 ? executiveCurrentBase.totalSeasonCost / executiveCurrentBase.totalHectares : 0;
    const averageCostPerKg = totalKgProduced > 0 ? executiveCurrentBase.totalSeasonCost / totalKgProduced : 0;

    const alerts = [
      ...monthlyRows
        .filter((row) => row.total > 0 && row.vsPreviousSeasonPct >= 15)
        .map((row) => ({
          level: row.vsPreviousSeasonPct >= 30 ? 'alta' : 'media',
          title: `Alza mensual en ${row.monthLabel}`,
          message: `El gasto sube ${row.vsPreviousSeasonPct.toFixed(1)}% frente a la misma fecha de la temporada anterior.`,
          amount: row.vsPreviousSeason
        })),
      ...fieldRows
        .filter((row) => row.total > 0 && row.deltaPct >= 20)
        .slice(0, 3)
        .map((row) => ({
          level: row.deltaPct >= 35 ? 'alta' : 'media',
          title: `Campo ${row.fieldName} en alza`,
          message: `Acumula ${row.deltaPct.toFixed(1)}% más gasto que la temporada anterior.`,
          amount: row.delta
        }))
    ].sort((a, b) => b.amount - a.amount);

    const topFields = [...fieldRows].slice(0, 5);
    const topSectors = [...sectorRows].slice(0, 5);

    return {
      monthlyRows,
      fieldRows,
      sectorRows,
      categoryRows,
      alerts,
      topFields,
      topSectors,
      kpis: {
        totalSeasonCost: executiveCurrentBase.totalSeasonCost,
        totalHectares: executiveCurrentBase.totalHectares,
        averageMonthlyCost: executiveCurrentBase.averageMonthlyCost,
        peakMonth: executiveCurrentBase.peakMonth,
        topField: fieldRows[0] || null,
        topSector: sectorRows[0] || null,
        previousSeasonCost: executivePreviousBase.totalSeasonCost,
        seasonVariation,
        seasonVariationPct,
        totalBudget,
        budgetDelta: executiveCurrentBase.totalSeasonCost - totalBudget,
        budgetExecutionPct: totalBudget > 0 ? (executiveCurrentBase.totalSeasonCost / totalBudget) * 100 : 0,
        totalKgProduced,
        averageCostPerHa,
        averageCostPerKg
      }
    };
  }, [
    executiveCurrentBase,
    executivePreviousBase,
    reportData
  ]);

  const executiveFieldOptions = useMemo(
    () => executiveData.fieldRows.map((row) => ({ value: row.fieldId, label: row.fieldName })),
    [executiveData.fieldRows]
  );
  const executiveFieldLabel = useMemo(
    () => (executiveFieldFilter === 'all'
      ? 'Todos los campos'
      : (executiveFieldOptions.find((item) => item.value === executiveFieldFilter)?.label || executiveFieldFilter)),
    [executiveFieldFilter, executiveFieldOptions]
  );

  const executiveAllSortedFieldRows = useMemo(
    () => sortExecutiveRows(executiveData.fieldRows, executiveFieldSortBy),
    [executiveData.fieldRows, executiveFieldSortBy]
  );

  const executiveViewData = useMemo(() => {
    let baseViewData = executiveData;

    if (executiveFieldFilter !== 'all') {
      const selectedField = executiveData.fieldRows.find((row) => row.fieldId === executiveFieldFilter) || null;
      const filteredSectorRows = executiveData.sectorRows.filter((row) =>
        row.fieldName === selectedField?.fieldName
      );
      const filteredCategoryRows = [
        { category: 'Aplicaciones', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.app_cost_only || 0), 0) },
        { category: 'Labores', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.labor_cost || 0), 0) },
        { category: 'Trabajadores', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.worker_cost || 0), 0) },
        { category: 'Combustible', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.fuel_cost || 0), 0) },
        { category: 'Maquinaria', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.machinery_cost || 0), 0) },
        { category: 'Riego', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.irrigation_cost || 0), 0) },
        { category: 'Generales', total: reportData.filter((row) => row.field_name === selectedField?.fieldName).reduce((sum, row) => sum + Number(row.general_cost || 0), 0) }
      ].filter((row) => row.total > 0);

      const monthlyRows = executiveSeasonMonths.map((month, index) => {
        const total = selectedField?.months[month.key] || 0;
        const previousSeasonTotal = executivePreviousBase.fieldRows.find((row) => row.fieldId === executiveFieldFilter)?.months[previousExecutiveSeasonMonths[index]?.key] || 0;
        const previousMonthTotal = index > 0 ? (selectedField?.months[executiveSeasonMonths[index - 1].key] || 0) : 0;
        const variation = index > 0 ? total - previousMonthTotal : 0;
        const variationPct = index > 0 && previousMonthTotal > 0 ? (variation / previousMonthTotal) * 100 : 0;
        const vsPreviousSeason = total - previousSeasonTotal;
        const vsPreviousSeasonPct = previousSeasonTotal > 0 ? (vsPreviousSeason / previousSeasonTotal) * 100 : 0;
        const topSector = filteredSectorRows
          .map((row) => ({ name: row.sectorName, total: row.months[month.key] || 0 }))
          .sort((a, b) => b.total - a.total)[0];

        return {
          monthKey: month.key,
          monthLabel: month.fullLabel,
          shortLabel: month.shortLabel,
          total,
          variation,
          variationPct,
          previousSeasonTotal,
          vsPreviousSeason,
          vsPreviousSeasonPct,
          topFieldName: selectedField?.fieldName || '-',
          topSectorName: topSector?.total ? topSector.name : '-'
        };
      });

      const totalSeasonCost = monthlyRows.reduce((sum, row) => sum + row.total, 0);
      const previousSeasonCost = selectedField?.previousTotal || 0;
      const seasonVariation = totalSeasonCost - previousSeasonCost;
      const seasonVariationPct = previousSeasonCost > 0 ? (seasonVariation / previousSeasonCost) * 100 : 0;
      const peakMonth = [...monthlyRows].sort((a, b) => b.total - a.total)[0] || null;
      const averageMonthlyCost = monthlyRows.length > 0 ? totalSeasonCost / monthlyRows.length : 0;
      const totalBudget = Number((selectedField as any)?.budgetTotal || 0);
      const totalKgProduced = Number((selectedField as any)?.kgProduced || 0);

      baseViewData = {
        ...executiveData,
        monthlyRows,
        categoryRows: filteredCategoryRows,
        fieldRows: selectedField ? [selectedField] : [],
        sectorRows: filteredSectorRows,
        alerts: [],
        topFields: selectedField ? [selectedField] : [],
        topSectors: filteredSectorRows.slice(0, 5),
        kpis: {
          ...executiveData.kpis,
          totalSeasonCost,
          totalHectares: selectedField?.hectares || 0,
          previousSeasonCost,
          seasonVariation,
          seasonVariationPct,
          averageMonthlyCost,
          totalBudget,
          budgetDelta: totalSeasonCost - totalBudget,
          budgetExecutionPct: totalBudget > 0 ? (totalSeasonCost / totalBudget) * 100 : 0,
          totalKgProduced,
          averageCostPerHa: selectedField?.hectares ? totalSeasonCost / selectedField.hectares : 0,
          averageCostPerKg: totalKgProduced > 0 ? totalSeasonCost / totalKgProduced : 0,
          peakMonth,
          topField: selectedField,
          topSector: filteredSectorRows[0] || null
        }
      };
    }

    const sortedFieldRows = sortExecutiveRows(baseViewData.fieldRows, executiveFieldSortBy);
    const sortedSectorRows = sortExecutiveRows(baseViewData.sectorRows, executiveSectorSortBy);
    const averageFieldCostPerHa = baseViewData.fieldRows.length > 0
      ? baseViewData.fieldRows.reduce((sum, row) => sum + Number((row as any).costPerHa || 0), 0) / baseViewData.fieldRows.length
      : 0;
    const validCostPerKgRows = baseViewData.fieldRows.filter((row) => Number((row as any).costPerKg || 0) > 0);
    const averageFieldCostPerKg = validCostPerKgRows.length > 0
      ? validCostPerKgRows.reduce((sum, row) => sum + Number((row as any).costPerKg || 0), 0) / validCostPerKgRows.length
      : 0;

    const alertCandidates = [
      ...baseViewData.monthlyRows
        .filter((row) => row.total > 0 && row.vsPreviousSeasonPct >= 15)
        .map((row) => ({
          level: row.vsPreviousSeasonPct >= 30 ? 'alta' : 'media',
          title: `Alza mensual en ${row.monthLabel}`,
          message: `${row.topFieldName !== '-' ? `${row.topFieldName} lidera el gasto del mes. ` : ''}El gasto sube ${row.vsPreviousSeasonPct.toFixed(1)}% frente a la misma fecha de ${previousExecutiveSeason}.`,
          amount: Math.abs(row.vsPreviousSeason),
          score: Math.abs(row.vsPreviousSeason)
        })),
      ...sortedFieldRows
        .filter((row) => Number((row as any).budgetTotal || 0) > 0 && Number((row as any).budgetExecutionPct || 0) >= 110)
        .map((row) => ({
          level: Number((row as any).budgetExecutionPct || 0) >= 130 ? 'alta' : 'media',
          title: `Campo ${row.fieldName} sobre presupuesto`,
          message: `Ejecuta ${Number((row as any).budgetExecutionPct || 0).toFixed(1)}% del presupuesto y supera el plan en ${formatCLP(Number((row as any).budgetDelta || 0))}.`,
          amount: Math.max(Number((row as any).budgetDelta || 0), 0),
          score: Math.max(Number((row as any).budgetDelta || 0), 0)
        })),
      ...sortedFieldRows
        .filter((row) => row.total > 0 && Number((row as any).kgProduced || 0) <= 0 && Number(row.hectares || 0) > 0)
        .map((row) => ({
          level: row.total >= baseViewData.kpis.averageMonthlyCost ? 'alta' : 'media',
          title: `Campo ${row.fieldName} sin produccion visible`,
          message: `Registra ${formatCLP(row.total)} de costo acumulado, pero no tiene kilos informados para calcular eficiencia.`,
          amount: row.total,
          score: row.total
        })),
      ...sortedFieldRows
        .filter((row) => averageFieldCostPerHa > 0 && Number((row as any).costPerHa || 0) >= averageFieldCostPerHa * 1.25)
        .map((row) => ({
          level: Number((row as any).costPerHa || 0) >= averageFieldCostPerHa * 1.5 ? 'alta' : 'media',
          title: `Campo ${row.fieldName} con costo / ha exigido`,
          message: `Marca ${formatCLP(Number((row as any).costPerHa || 0))} por ha, sobre una referencia visible de ${formatCLP(averageFieldCostPerHa)}.`,
          amount: Number((row as any).costPerHa || 0),
          score: Number((row as any).costPerHa || 0)
        })),
      ...sortedFieldRows
        .filter((row) => averageFieldCostPerKg > 0 && Number((row as any).costPerKg || 0) > 0 && Number((row as any).costPerKg || 0) >= averageFieldCostPerKg * 1.25)
        .map((row) => ({
          level: Number((row as any).costPerKg || 0) >= averageFieldCostPerKg * 1.5 ? 'alta' : 'media',
          title: `Campo ${row.fieldName} con costo / kg tensionado`,
          message: `Su costo por kg llega a ${formatCLP(Number((row as any).costPerKg || 0))}, sobre el promedio visible de ${formatCLP(averageFieldCostPerKg)}.`,
          amount: Number((row as any).costPerKg || 0),
          score: Number((row as any).costPerKg || 0)
        })),
      ...sortedSectorRows
        .filter((row) => Number((row as any).budgetTotal || 0) > 0 && Number((row as any).budgetExecutionPct || 0) >= 115)
        .slice(0, 4)
        .map((row) => ({
          level: Number((row as any).budgetExecutionPct || 0) >= 135 ? 'alta' : 'media',
          title: `Sector ${row.fieldName} / ${row.sectorName} en desvio`,
          message: `El sector ejecuta ${Number((row as any).budgetExecutionPct || 0).toFixed(1)}% de su presupuesto y requiere explicacion operativa.`,
          amount: Math.max(Number((row as any).budgetDelta || 0), 0),
          score: Math.max(Number((row as any).budgetDelta || 0), 0)
        }))
    ];

    const dedupedAlerts = Array.from(
      new Map(alertCandidates.map((alert) => [`${alert.title}::${alert.message}`, alert])).values()
    );
    const alerts = dedupedAlerts
      .sort((a, b) => {
        if (a.level !== b.level) return a.level === 'alta' ? -1 : 1;
        return (b.score || 0) - (a.score || 0);
      })
      .slice(0, 8)
      .map(({ score, ...alert }) => alert);

    return {
      ...baseViewData,
      fieldRows: sortedFieldRows,
      sectorRows: sortedSectorRows,
      alerts,
      topFields: sortedFieldRows.slice(0, 5),
      topSectors: sortedSectorRows.slice(0, 5)
    };
  }, [
    executiveData,
    executiveFieldSortBy,
    executiveFieldFilter,
    executivePreviousBase.fieldRows,
    executiveSeasonMonths,
    executiveSectorSortBy,
    previousExecutiveSeasonMonths,
    previousExecutiveSeason,
    reportData
  ]);

  const executiveFieldComparison = useMemo(() => {
    if (executiveAllSortedFieldRows.length < 2) return null;

    const preferredFieldA = executiveCompareFieldA !== 'auto'
      ? executiveData.fieldRows.find((row) => row.fieldId === executiveCompareFieldA) || null
      : (executiveFieldFilter !== 'all'
        ? executiveData.fieldRows.find((row) => row.fieldId === executiveFieldFilter) || null
        : executiveAllSortedFieldRows[0] || null);

    const fieldA = preferredFieldA || executiveAllSortedFieldRows[0] || null;
    if (!fieldA) return null;

    const autoFieldB = executiveAllSortedFieldRows.find((row) => row.fieldId !== fieldA.fieldId) || null;
    const preferredFieldB = executiveCompareFieldB !== 'auto'
      ? executiveData.fieldRows.find((row) => row.fieldId === executiveCompareFieldB && row.fieldId !== fieldA.fieldId) || null
      : autoFieldB;
    const fieldB = preferredFieldB || autoFieldB;

    if (!fieldB || fieldA.fieldId === fieldB.fieldId) return null;

    const monthlyRows = executiveSeasonMonths.map((month) => {
      const fieldATotal = Number(fieldA.months[month.key] || 0);
      const fieldBTotal = Number(fieldB.months[month.key] || 0);
      return {
        monthKey: month.key,
        monthLabel: month.shortLabel,
        fullLabel: month.fullLabel,
        fieldATotal,
        fieldBTotal,
        gap: fieldATotal - fieldBTotal
      };
    });

    const comparisonRows = [
      {
        metric: 'Gasto total',
        fieldAValue: Number(fieldA.total || 0),
        fieldBValue: Number(fieldB.total || 0),
        gap: Number(fieldA.total || 0) - Number(fieldB.total || 0),
        format: 'currency'
      },
      {
        metric: 'Desviacion ppto',
        fieldAValue: Number((fieldA as any).budgetDelta || 0),
        fieldBValue: Number((fieldB as any).budgetDelta || 0),
        gap: Number((fieldA as any).budgetDelta || 0) - Number((fieldB as any).budgetDelta || 0),
        format: 'currency'
      },
      {
        metric: 'Costo / Ha',
        fieldAValue: Number((fieldA as any).costPerHa || 0),
        fieldBValue: Number((fieldB as any).costPerHa || 0),
        gap: Number((fieldA as any).costPerHa || 0) - Number((fieldB as any).costPerHa || 0),
        format: 'currency'
      },
      {
        metric: 'Costo / Kg',
        fieldAValue: Number((fieldA as any).costPerKg || 0),
        fieldBValue: Number((fieldB as any).costPerKg || 0),
        gap: Number((fieldA as any).costPerKg || 0) - Number((fieldB as any).costPerKg || 0),
        format: 'currency_optional'
      },
      {
        metric: 'Variacion %',
        fieldAValue: Number((fieldA as any).deltaPct || 0),
        fieldBValue: Number((fieldB as any).deltaPct || 0),
        gap: Number((fieldA as any).deltaPct || 0) - Number((fieldB as any).deltaPct || 0),
        format: 'percent'
      },
      {
        metric: 'Kg producidos',
        fieldAValue: Number((fieldA as any).kgProduced || 0),
        fieldBValue: Number((fieldB as any).kgProduced || 0),
        gap: Number((fieldA as any).kgProduced || 0) - Number((fieldB as any).kgProduced || 0),
        format: 'number'
      }
    ];

    const dominantField = fieldA.total >= fieldB.total ? fieldA : fieldB;
    const efficientField = (() => {
      const fieldACostPerHa = Number((fieldA as any).costPerHa || 0);
      const fieldBCostPerHa = Number((fieldB as any).costPerHa || 0);
      if (fieldACostPerHa <= 0 && fieldBCostPerHa <= 0) return null;
      if (fieldBCostPerHa <= 0) return fieldA;
      if (fieldACostPerHa <= 0) return fieldB;
      return fieldACostPerHa <= fieldBCostPerHa ? fieldA : fieldB;
    })();

    return {
      fieldA,
      fieldB,
      monthlyRows,
      comparisonRows,
      narrative: `${dominantField.fieldName} concentra el mayor gasto entre los dos campos comparados${efficientField ? `, mientras ${efficientField.fieldName} muestra la mejor eficiencia visible por hectarea.` : '.'}`
    };
  }, [
    executiveAllSortedFieldRows,
    executiveCompareFieldA,
    executiveCompareFieldB,
    executiveData.fieldRows,
    executiveFieldFilter,
    executiveSeasonMonths
  ]);

  const executiveInsights = useMemo(() => {
    const tone = getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct));
    const topMonth = executiveViewData.kpis.peakMonth;
    const topField = executiveViewData.kpis.topField;
    const topSector = executiveViewData.kpis.topSector;
    const topFieldShare = Number((topField as any)?.sharePct || 0);

    const findings = [
      {
        title: 'Variación acumulada',
        description: `La temporada ${selectedSeason} ${executiveViewData.kpis.seasonVariation >= 0 ? 'sube' : 'baja'} ${Math.abs(executiveViewData.kpis.seasonVariationPct).toFixed(1)}% frente a ${previousExecutiveSeason}.`,
        emphasis: `${formatCLP(executiveViewData.kpis.seasonVariation)}`
      },
      {
        title: 'Mayor concentración',
        description: topField
          ? `${topField.fieldName} lidera el gasto consolidado y representa ${topFieldShare.toFixed(1)}% del total visible.`
          : 'No hay un campo dominante con datos suficientes.',
        emphasis: topField ? formatCLP(topField.total) : 'Sin datos'
      },
      {
        title: 'Mes crítico',
        description: topMonth
          ? `${topMonth.monthLabel} es el punto más alto del período y debe explicarse en comité.`
          : 'No hay un mes crítico identificado.',
        emphasis: topMonth ? formatCLP(topMonth.total) : 'Sin datos'
      }
    ];

    const conclusion = topSector
      ? `La lectura ejecutiva sugiere concentrar la revisión en ${topSector.fieldName} / ${topSector.sectorName}, junto con las alertas activas y la variación acumulada de la temporada.`
      : 'La lectura ejecutiva no muestra suficientes datos para concluir un foco prioritario.';

    return {
      tone,
      findings,
      conclusion,
      activeAlertCount: executiveViewData.alerts.length
    };
  }, [executiveViewData, previousExecutiveSeason, selectedSeason]);

  const executiveAuditVisibleRows = useMemo(() => (
    costAuditRows.filter((row) => {
      if (executiveFieldFilter !== 'all' && row.field_id !== executiveFieldFilter) return false;
      if (executiveAuditPriorityFilter !== 'all' && row.review_priority !== executiveAuditPriorityFilter) return false;
      if (executiveAuditLayerFilter !== 'all' && row.source_layer !== executiveAuditLayerFilter) return false;
      return true;
    })
  ), [costAuditRows, executiveAuditLayerFilter, executiveAuditPriorityFilter, executiveFieldFilter]);

  const executiveAuditSummaryRows = useMemo(() => {
    const summaryMap = new Map<string, AgriculturalCostAuditSummaryRow>();

    executiveAuditVisibleRows.forEach((row) => {
      const season = row.season || selectedSeason;
      const key = [
        season,
        row.category,
        row.source_layer,
        row.cost_role,
        row.audit_status,
        row.review_priority
      ].join('::');

      const current = summaryMap.get(key) || {
        company_id: row.company_id,
        season,
        category: row.category,
        source_layer: row.source_layer,
        cost_role: row.cost_role,
        audit_status: row.audit_status,
        review_priority: row.review_priority,
        movement_count: 0,
        total_amount: 0,
        traceable_amount: 0,
        non_traceable_amount: 0
      };

      current.movement_count += 1;
      current.total_amount += Number(row.amount || 0);
      current.traceable_amount += row.has_full_traceability ? Number(row.amount || 0) : 0;
      current.non_traceable_amount += row.has_full_traceability ? 0 : Number(row.amount || 0);
      summaryMap.set(key, current);
    });

    return [...summaryMap.values()].sort((a, b) => Number(b.total_amount || 0) - Number(a.total_amount || 0));
  }, [executiveAuditVisibleRows, selectedSeason]);

  const executiveAuditExportSummaryRows = useMemo(() => (
    executiveFieldFilter === 'all' &&
    executiveAuditPriorityFilter === 'all' &&
    executiveAuditLayerFilter === 'all'
      ? costAuditSummary
      : executiveAuditSummaryRows
  ), [
    costAuditSummary,
    executiveAuditLayerFilter,
    executiveAuditPriorityFilter,
    executiveAuditSummaryRows,
    executiveFieldFilter
  ]);

  const executiveAuditData = useMemo(() => {
    const totalAudited = executiveAuditVisibleRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const traceableAmount = executiveAuditVisibleRows.reduce(
      (sum, row) => sum + (row.has_full_traceability ? Number(row.amount || 0) : 0),
      0
    );
    const nonTraceableAmount = totalAudited - traceableAmount;
    const backupAmount = executiveAuditVisibleRows
      .filter((row) => row.cost_role === 'respaldo')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const distributedAmount = executiveAuditVisibleRows
      .filter((row) => row.cost_role === 'distribucion')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const officialAmount = executiveAuditVisibleRows
      .filter((row) => row.cost_role === 'oficial')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const highReviewRows = executiveAuditVisibleRows.filter((row) => row.review_priority === 'alta');
    const highReviewAmount = highReviewRows
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const highReviewCount = highReviewRows.length;
    const traceabilityPct = totalAudited > 0 ? (traceableAmount / totalAudited) * 100 : 0;
    const highReviewPct = totalAudited > 0 ? (highReviewAmount / totalAudited) * 100 : 0;

    const tone = (() => {
      if (traceabilityPct < 70 || highReviewPct >= 20) {
        return {
          badge: 'bg-red-100 text-red-700 border-red-200',
          text: 'text-red-600',
          dot: 'bg-red-500',
          label: 'Riesgo alto'
        };
      }
      if (traceabilityPct < 85 || highReviewPct >= 10 || backupAmount > 0) {
        return {
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          text: 'text-amber-600',
          dot: 'bg-amber-500',
          label: 'Atencion'
        };
      }
      return {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        text: 'text-emerald-600',
        dot: 'bg-emerald-500',
        label: 'Trazable'
      };
    })();

    const topAuditCategory = [...executiveAuditSummaryRows]
      .filter((row) => row.review_priority === 'alta')
      .sort((a, b) => Number(b.total_amount || 0) - Number(a.total_amount || 0))[0] || null;
    const topBackupCategory = [...executiveAuditSummaryRows]
      .filter((row) => row.cost_role === 'respaldo')
      .sort((a, b) => Number(b.total_amount || 0) - Number(a.total_amount || 0))[0] || null;
    const topDetailRows = [...highReviewRows]
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .slice(0, 8);
    const scopeLabel = [
      executiveFieldFilter === 'all' ? 'Todos los campos' : executiveFieldLabel,
      EXECUTIVE_AUDIT_PRIORITY_OPTIONS.find((item) => item.value === executiveAuditPriorityFilter)?.label || 'Todas las prioridades',
      EXECUTIVE_AUDIT_LAYER_OPTIONS.find((item) => item.value === executiveAuditLayerFilter)?.label || 'Todas las capas'
    ].join(' · ');

    const findings = [
      {
        title: 'Costo trazable',
        description: `La temporada tiene ${traceabilityPct.toFixed(1)}% del monto conciliado con trazabilidad completa.`,
        emphasis: formatCLP(traceableAmount)
      },
      {
        title: 'Monto en revisión alta',
        description: topAuditCategory
          ? `${topAuditCategory.category} concentra la mayor exposición crítica en conciliación.`
          : 'No hay movimientos críticos detectados en la temporada visible.',
        emphasis: formatCLP(highReviewAmount)
      },
      {
        title: 'Respaldo y distribución',
        description: topBackupCategory
          ? `${topBackupCategory.category} es la principal bolsa de respaldo contable o distribución a vigilar.`
          : 'No hay respaldo contable material en la temporada visible.',
        emphasis: formatCLP(backupAmount + distributedAmount)
      }
    ];

    const conclusion = totalAudited <= 0
      ? 'La conciliación no tiene movimientos suficientes para emitir una lectura de trazabilidad.'
      : highReviewAmount > 0
        ? `La temporada requiere revisar ${highReviewCount} focos críticos antes de presentar el costo como definitivo a comité.`
        : `La temporada muestra una trazabilidad de ${traceabilityPct.toFixed(1)}% y puede presentarse con un nivel de respaldo más controlado.`;

    return {
      totalAudited,
      traceableAmount,
      nonTraceableAmount,
      backupAmount,
      distributedAmount,
      officialAmount,
      visibleMovementCount: executiveAuditVisibleRows.length,
      highReviewAmount,
      highReviewCount,
      traceabilityPct,
      highReviewPct,
      scopeLabel,
      tone,
      findings,
      conclusion,
      topDetailRows
    };
  }, [
    executiveAuditLayerFilter,
    executiveAuditPriorityFilter,
    executiveAuditSummaryRows,
    executiveAuditVisibleRows,
    executiveFieldFilter,
    executiveFieldLabel
  ]);

  const buildAuditMetricsFromSummaryRows = useCallback((summaryRows: AgriculturalCostAuditSummaryRow[], season: string) => {
    const visibleRows = summaryRows.filter((row) => (row.season || selectedSeason) === season);
    const totalAudited = visibleRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const traceableAmount = visibleRows.reduce((sum, row) => sum + Number(row.traceable_amount || 0), 0);
    const nonTraceableAmount = visibleRows.reduce((sum, row) => sum + Number(row.non_traceable_amount || 0), 0);
    const officialAmount = visibleRows
      .filter((row) => row.cost_role === 'oficial')
      .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const highReviewAmount = visibleRows
      .filter((row) => row.review_priority === 'alta')
      .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const highReviewCount = visibleRows
      .filter((row) => row.review_priority === 'alta')
      .reduce((sum, row) => sum + Number(row.movement_count || 0), 0);

    return {
      totalAudited,
      traceabilityPct: totalAudited > 0 ? (traceableAmount / totalAudited) * 100 : 0,
      officialAmount,
      nonTraceableAmount,
      highReviewPct: totalAudited > 0 ? (highReviewAmount / totalAudited) * 100 : 0,
      highReviewCount
    };
  }, [selectedSeason]);

  const executiveMarginData = useMemo(() => {
    const visibleRows = rawMarginRows.filter((row) => {
      if (row.season !== selectedSeason) return false;
      if (executiveFieldFilter !== 'all' && row.field_id !== executiveFieldFilter) return false;
      return true;
    });

    const totalIncome = visibleRows.reduce((sum, row) => sum + Number(row.total_income_clp || 0), 0);
    const totalCost = visibleRows.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
    const totalProfit = visibleRows.reduce((sum, row) => sum + Number(row.profit_clp || 0), 0);
    const totalKg = visibleRows.reduce((sum, row) => sum + Number(row.kg_produced || 0), 0);
    const productionRecordCount = visibleRows.filter((row) => row.production_source === 'production_records').length;
    const inferredCount = visibleRows.filter((row) => row.production_source === 'income_entries').length;
    const marginPct = totalIncome > 0 ? (totalProfit / totalIncome) * 100 : 0;
    const productionCoveragePct = visibleRows.length > 0 ? (productionRecordCount / visibleRows.length) * 100 : 0;
    const averageIncomePerKg = totalKg > 0 ? totalIncome / totalKg : 0;

    const tone = (() => {
      if (totalProfit < 0 || marginPct < 0 || productionCoveragePct < 40) {
        return {
          badge: 'bg-red-100 text-red-700 border-red-200',
          dot: 'bg-red-500',
          label: 'Riesgo alto'
        };
      }
      if (marginPct < 12 || productionCoveragePct < 75) {
        return {
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          label: 'Atención'
        };
      }
      return {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        label: 'Controlado'
      };
    })();

    return {
      visibleRows,
      totalIncome,
      totalCost,
      totalProfit,
      totalKg,
      marginPct,
      productionRecordCount,
      inferredCount,
      productionCoveragePct,
      averageIncomePerKg,
      tone
    };
  }, [executiveFieldFilter, rawMarginRows, selectedSeason]);

  const productionRecordsForSeason = useMemo(() => (
    rawProductionRecords.filter((row) => Number(row.season_year || 0) === selectedSeasonStartYear)
  ), [rawProductionRecords, selectedSeasonStartYear]);

  const productionRecordBySector = useMemo(
    () => new Map(productionRecordsForSeason.map((row) => [String(row.sector_id), row])),
    [productionRecordsForSeason]
  );

  const productionCoverageRows = useMemo(() => (
    rawFields.flatMap((field) =>
      (field.sectors || [])
        .map((sector: any) => {
          const record = productionRecordBySector.get(String(sector.id));
          const marginRow = rawMarginRows.find((row) => row.season === selectedSeason && row.sector_id === sector.id) || null;
          return {
            fieldId: String(field.id),
            fieldName: String(field.name || '-'),
            sectorId: String(sector.id),
            sectorName: String(sector.name || '-'),
            hectares: Number(sector.hectares || 0),
            kgProduced: Number(record?.kg_produced || 0),
            pricePerKg: Number(record?.price_per_kg || 0),
            hasRecord: Boolean(record),
            productionSource: marginRow?.production_source || 'sin_produccion',
            totalCost: Number(marginRow?.total_cost || 0),
            totalIncome: Number(marginRow?.total_income_clp || 0),
            marginPct: Number(marginRow?.margin_pct || 0),
            recordId: record?.id || null
          };
        })
    )
  ), [productionRecordBySector, rawFields, rawMarginRows, selectedSeason]);

  const economicCompletionData = useMemo(() => {
    const sectorsWithCostNoIncome = productionCoverageRows.filter((row) => row.totalCost > 0 && row.totalIncome <= 0);
    const sectorsWithIncomeNoFormalProduction = productionCoverageRows.filter((row) => row.totalIncome > 0 && !row.hasRecord);
    const sectorsWithFormalProductionNoIncome = productionCoverageRows.filter((row) => row.hasRecord && row.totalIncome <= 0);

    return {
      sectorsWithCostNoIncome,
      sectorsWithIncomeNoFormalProduction,
      sectorsWithFormalProductionNoIncome,
      topCostNoIncome: sectorsWithCostNoIncome
        .slice()
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 5),
      topIncomeNoProduction: sectorsWithIncomeNoFormalProduction
        .slice()
        .sort((a, b) => b.totalIncome - a.totalIncome)
        .slice(0, 5),
      topFormalNoIncome: sectorsWithFormalProductionNoIncome
        .slice()
        .sort((a, b) => b.kgProduced - a.kgProduced)
        .slice(0, 5)
    };
  }, [productionCoverageRows]);

  const buildEconomicClosureSummaryFromSources = useCallback((params: {
    season: string;
    fields: any[];
    marginRows: AgriculturalMarginRow[];
    productionRecords: ProductionRecord[];
  }) => {
    const { season, fields, marginRows, productionRecords } = params;
    const seasonStartYear = Number(String(season || '').split('-')[0]) || new Date().getFullYear();
    const productionRecordMap = new Map(
      productionRecords
        .filter((row) => Number(row.season_year || 0) === seasonStartYear)
        .map((row) => [String(row.sector_id), row])
    );
    const visibleRows = fields
      .flatMap((field) =>
        (field.sectors || []).map((sector: any) => {
          const record = productionRecordMap.get(String(sector.id));
          const marginRow = marginRows.find((row) => row.season === season && row.sector_id === sector.id) || null;
          return {
            fieldId: String(field.id),
            fieldName: String(field.name || '-'),
            sectorId: String(sector.id),
            sectorName: String(sector.name || '-'),
            hectares: Number(sector.hectares || 0),
            kgProduced: Number(record?.kg_produced || 0),
            pricePerKg: Number(record?.price_per_kg || 0),
            hasRecord: Boolean(record),
            productionSource: marginRow?.production_source || 'sin_produccion',
            totalCost: Number(marginRow?.total_cost || 0),
            totalIncome: Number(marginRow?.total_income_clp || 0),
            marginPct: Number(marginRow?.margin_pct || 0),
            recordId: record?.id || null
          };
        })
      )
      .filter((row) => executiveFieldFilter === 'all' || row.fieldId === executiveFieldFilter);
    const closedRows = visibleRows.filter((row) => row.hasRecord && row.totalIncome > 0 && row.totalCost > 0);
    const pendingProductionRows = visibleRows.filter((row) => row.totalIncome > 0 && !row.hasRecord);
    const pendingIncomeRows = visibleRows.filter((row) => row.hasRecord && row.totalIncome <= 0);
    const costWithoutIncomeRows = visibleRows.filter((row) => row.totalCost > 0 && row.totalIncome <= 0);
    const closurePct = visibleRows.length > 0 ? (closedRows.length / visibleRows.length) * 100 : 0;
    const pendingProductionAmount = pendingProductionRows.reduce((sum, row) => sum + Number(row.totalIncome || 0), 0);
    const pendingIncomeCost = pendingIncomeRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
    const costWithoutIncomeAmount = costWithoutIncomeRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);

    const tone = (() => {
      if (closurePct < 40 || pendingProductionRows.length > 0 || costWithoutIncomeRows.length > 0) {
        return {
          badge: 'bg-red-100 text-red-700 border-red-200',
          dot: 'bg-red-500',
          label: 'Riesgo alto'
        };
      }
      if (closurePct < 75 || pendingIncomeRows.length > 0) {
        return {
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          label: 'Atención'
        };
      }
      return {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        label: 'Controlado'
      };
    })();

    const findings = [
      {
        title: 'Sectores cerrados',
        description: 'Sectores con costo, ingreso y producción formal visibles.',
        emphasis: `${closedRows.length} de ${visibleRows.length} sectores · ${closurePct.toFixed(1)}%`
      },
      {
        title: 'Pendientes de producción',
        description: 'Sectores con ingresos visibles, pero aún sin producción formal registrada.',
        emphasis: `${pendingProductionRows.length} sectores · ${formatCLP(pendingProductionAmount)}`
      },
      {
        title: 'Pendientes de ingreso',
        description: 'Sectores con producción formal, pero sin ingresos visibles para cerrar margen.',
        emphasis: `${pendingIncomeRows.length} sectores · ${formatCLP(pendingIncomeCost)}`
      }
    ];

    const topFocusRows = [
      ...pendingProductionRows.map((row) => ({
        key: `prod-${row.sectorId}`,
        status: 'Ingreso sin producción formal',
        fieldName: row.fieldName,
        sectorName: row.sectorName,
        amount: row.totalIncome,
        unitLabel: formatCLP(row.totalIncome)
      })),
      ...costWithoutIncomeRows.map((row) => ({
        key: `income-${row.sectorId}`,
        status: 'Costo sin ingreso',
        fieldName: row.fieldName,
        sectorName: row.sectorName,
        amount: row.totalCost,
        unitLabel: formatCLP(row.totalCost)
      })),
      ...pendingIncomeRows.map((row) => ({
        key: `formal-${row.sectorId}`,
        status: 'Producción formal sin ingreso',
        fieldName: row.fieldName,
        sectorName: row.sectorName,
        amount: row.kgProduced,
        unitLabel: `${Number(row.kgProduced || 0).toLocaleString('es-CL')} Kg`
      }))
    ]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    const conclusion = visibleRows.length <= 0
      ? 'No hay sectores visibles para medir cierre económico.'
      : closurePct >= 85 && pendingProductionRows.length === 0 && pendingIncomeRows.length === 0
        ? `La temporada presenta un cierre económico de ${closurePct.toFixed(1)}% y ya puede usarse como lectura más confiable de margen.`
        : `La temporada muestra un cierre económico de ${closurePct.toFixed(1)}%. Conviene regularizar ${pendingProductionRows.length + pendingIncomeRows.length + costWithoutIncomeRows.length} focos antes de presentar el margen como definitivo.`;

    return {
      season,
      visibleRows,
      closedRows,
      pendingProductionRows,
      pendingIncomeRows,
      costWithoutIncomeRows,
      closurePct,
      pendingProductionAmount,
      pendingIncomeCost,
      costWithoutIncomeAmount,
      tone,
      findings,
      topFocusRows,
      conclusion
    };
  }, [executiveFieldFilter]);

  const buildEconomicClosureSummary = useCallback((season: string) => (
    buildEconomicClosureSummaryFromSources({
      season,
      fields: rawFields,
      marginRows: rawMarginRows,
      productionRecords: rawProductionRecords
    })
  ), [buildEconomicClosureSummaryFromSources, rawFields, rawMarginRows, rawProductionRecords]);

  const executiveEconomicClosureData = useMemo(
    () => buildEconomicClosureSummary(selectedSeason),
    [buildEconomicClosureSummary, selectedSeason]
  );

  const executiveEconomicClosureHistoryRows = useMemo(() => (
    Array.from(new Set([selectedSeason, ...availableSeasons]))
      .map((season) => {
        const summary = buildEconomicClosureSummary(season);
        return {
          season,
          visibleSectorCount: summary.visibleRows.length,
          closedSectorCount: summary.closedRows.length,
          closurePct: summary.closurePct,
          pendingProductionCount: summary.pendingProductionRows.length,
          pendingIncomeCount: summary.pendingIncomeRows.length,
          costWithoutIncomeCount: summary.costWithoutIncomeRows.length,
          pendingProductionAmount: summary.pendingProductionAmount,
          pendingIncomeCost: summary.pendingIncomeCost,
          costWithoutIncomeAmount: summary.costWithoutIncomeAmount,
          toneLabel: summary.tone.label
        };
      })
      .sort((a, b) => b.season.localeCompare(a.season))
  ), [availableSeasons, buildEconomicClosureSummary, selectedSeason]);

  const bestClosureHistoryRow = useMemo(
    () => executiveEconomicClosureHistoryRows.slice().sort((a, b) => b.closurePct - a.closurePct)[0] || null,
    [executiveEconomicClosureHistoryRows]
  );

  const widestClosureGapHistoryRow = useMemo(
    () => executiveEconomicClosureHistoryRows.slice().sort(
      (a, b) =>
        (b.pendingProductionCount + b.pendingIncomeCount + b.costWithoutIncomeCount) -
        (a.pendingProductionCount + a.pendingIncomeCount + a.costWithoutIncomeCount)
    )[0] || null,
    [executiveEconomicClosureHistoryRows]
  );

  const buildTotalDataClosure = useCallback((params: {
    economicClosureData: {
      closurePct: number;
      pendingProductionRows: Array<any>;
      pendingIncomeRows: Array<any>;
      costWithoutIncomeRows: Array<any>;
    };
    auditMetrics: {
      totalAudited: number;
      traceabilityPct: number;
      officialAmount: number;
      nonTraceableAmount: number;
      highReviewPct: number;
      highReviewCount: number;
    };
  }) => {
    const { economicClosureData, auditMetrics } = params;
    const totalAudited = Number(auditMetrics.totalAudited || 0);
    const economicPct = Number(economicClosureData.closurePct || 0);
    const traceabilityPct = Number(auditMetrics.traceabilityPct || 0);
    const officialSupportPct = totalAudited > 0
      ? (Number(auditMetrics.officialAmount || 0) / totalAudited) * 100
      : 0;
    const reviewCleanPct = Math.max(0, 100 - Number(auditMetrics.highReviewPct || 0));
    const totalClosurePct =
      economicPct * 0.45 +
      traceabilityPct * 0.3 +
      officialSupportPct * 0.15 +
      reviewCleanPct * 0.1;

    const blockers = [
      economicClosureData.pendingProductionRows.length > 0
        ? `${economicClosureData.pendingProductionRows.length} sectores con ingreso sin producción formal`
        : null,
      economicClosureData.pendingIncomeRows.length > 0
        ? `${economicClosureData.pendingIncomeRows.length} sectores con producción formal sin ingreso`
        : null,
      economicClosureData.costWithoutIncomeRows.length > 0
        ? `${economicClosureData.costWithoutIncomeRows.length} sectores con costo sin cierre comercial`
        : null,
      auditMetrics.nonTraceableAmount > 0
        ? `${formatCLP(auditMetrics.nonTraceableAmount)} aún sin trazabilidad completa`
        : null,
      auditMetrics.highReviewCount > 0
        ? `${auditMetrics.highReviewCount} focos de revisión alta siguen abiertos`
        : null
    ].filter(Boolean) as string[];

    const readiness = (() => {
      if (
        totalClosurePct < 55 ||
        economicPct < 50 ||
        traceabilityPct < 60 ||
        auditMetrics.highReviewPct > 20
      ) {
        return {
          badge: 'bg-red-100 text-red-700 border-red-200',
          dot: 'bg-red-500',
          title: 'No listo para comité',
          detail: 'La temporada todavía no tiene calidad suficiente para presentarse como dato definitivo.'
        };
      }
      if (
        totalClosurePct < 75 ||
        officialSupportPct < 60 ||
        blockers.length > 0
      ) {
        return {
          badge: 'bg-amber-100 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          title: 'Listo con advertencias',
          detail: 'La lectura sirve para seguimiento ejecutivo, pero todavía requiere contexto y cautela.'
        };
      }
      return {
        badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        title: 'Listo para comité',
        detail: 'La temporada tiene un nivel de cierre y trazabilidad suficientemente sólido para presentarse como lectura principal.'
      };
    })();

    const findings = [
      {
        title: 'Cierre integrado',
        description: 'Combina cierre económico, trazabilidad, soporte oficial y limpieza de revisión.',
        emphasis: `${totalClosurePct.toFixed(1)}% consolidado`
      },
      {
        title: 'Soporte oficial',
        description: 'Mide cuánto del costo auditado descansa en base oficial y no solo en respaldo o distribución.',
        emphasis: `${officialSupportPct.toFixed(1)}% del costo auditado`
      },
      {
        title: 'Lectura para comité',
        description: readiness.detail,
        emphasis: readiness.title
      }
    ];

    const conclusion = blockers.length === 0
      ? `La temporada presenta un cierre total del dato de ${totalClosurePct.toFixed(1)}% y no muestra bloqueos críticos visibles.`
      : `La temporada presenta un cierre total del dato de ${totalClosurePct.toFixed(1)}%. Antes de considerarla definitiva conviene resolver ${blockers.length} bloqueos principales.`;

    return {
      economicPct,
      traceabilityPct,
      officialSupportPct,
      reviewCleanPct,
      totalClosurePct,
      blockers,
      readiness,
      findings,
      conclusion
    };
  }, []);

  const executiveTotalDataClosure = useMemo(() => {
    return buildTotalDataClosure({
      economicClosureData: executiveEconomicClosureData,
      auditMetrics: {
        totalAudited: Number(executiveAuditData.totalAudited || 0),
        traceabilityPct: Number(executiveAuditData.traceabilityPct || 0),
        officialAmount: Number(executiveAuditData.officialAmount || 0),
        nonTraceableAmount: Number(executiveAuditData.nonTraceableAmount || 0),
        highReviewPct: Number(executiveAuditData.highReviewPct || 0),
        highReviewCount: Number(executiveAuditData.highReviewCount || 0)
      }
    });
  }, [buildTotalDataClosure, executiveAuditData, executiveEconomicClosureData]);

  const executiveCategoryComparisonRows = useMemo(() => {
    const currentMap = new Map(executiveViewData.categoryRows.map((row) => [row.category, row.total]));
    const previousCategories = (() => {
      const seasonMonths = buildExecutiveSeasonMonths(previousExecutiveSeason);
      const monthKeys = new Set(seasonMonths.map((month) => month.key));
      const isAllowedSector = (sectorId: string) => executiveFieldFilter === 'all' || executiveSectorMeta.get(sectorId)?.fieldId === executiveFieldFilter;
      const summary = new Map<string, number>();
      rawCostMovements.forEach((item) => {
        const monthKey = parseExecutiveMonthKey(String(item.date || ''));
        if (!monthKey || !monthKeys.has(monthKey) || !isAllowedSector(String(item.sectorId || ''))) return;
        summary.set(item.category, (summary.get(item.category) || 0) + Number(item.amount || 0));
      });

      return ['Aplicaciones', 'Labores', 'Trabajadores', 'Combustible', 'Maquinaria', 'Riego', 'Generales'].map((category) => ({
        category,
        total: Number(summary.get(category) || 0)
      }));
    })();

    return previousCategories.map((row) => {
      const current = Number(currentMap.get(row.category) || 0);
      const previous = Number(row.total || 0);
      const delta = current - previous;
      const deltaPct = previous > 0 ? (delta / previous) * 100 : 0;
      return { category: row.category, current, previous, delta, deltaPct };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [
    executiveFieldFilter,
    executiveSectorMeta,
    executiveViewData.categoryRows,
    previousExecutiveSeason,
    rawCostMovements
  ]);

  const executiveParetoFields = useMemo(() => {
    let cumulative = 0;
    return executiveViewData.fieldRows
      .slice()
      .sort((a, b) => b.total - a.total)
      .map((row) => {
        cumulative += Number((row as any).sharePct || 0);
        return { ...row, cumulativeSharePct: cumulative };
      });
  }, [executiveViewData.fieldRows]);

  const executiveHeatmapMax = useMemo(() => {
    return Math.max(
      0,
      ...executiveViewData.fieldRows.flatMap((row) => executiveSeasonMonths.map((month) => Number(row.months[month.key] || 0)))
    );
  }, [executiveSeasonMonths, executiveViewData.fieldRows]);

  const executiveCompareCompanyName = useMemo(
    () => executiveComparableCompanies.find((company) => company.id === executiveCompareCompanyId)?.name || '',
    [executiveComparableCompanies, executiveCompareCompanyId]
  );

  const executiveCompareCompanySummary = useMemo(() => {
    if (!executiveCompareCompanyRaw) return null;

    const compareSectorMeta = new Map<string, { fieldId: string; fieldName: string; sectorName: string; hectares: number }>();
    const compareFieldMeta = new Map<string, { fieldName: string; hectares: number }>();
    (executiveCompareCompanyRaw.fields || []).forEach((field: any) => {
      const hectares = (field.sectors || []).reduce((sum: number, sector: any) => sum + Number(sector.hectares || 0), 0);
      compareFieldMeta.set(field.id, { fieldName: field.name, hectares });
      (field.sectors || []).forEach((sector: any) => {
        compareSectorMeta.set(sector.id, { fieldId: field.id, fieldName: field.name, sectorName: sector.name, hectares: Number(sector.hectares || 0) });
      });
    });

    const fuelPrices = { diesel: executiveFuelPrices.diesel, gasoline: executiveFuelPrices.gasoline };
    const aggregated = aggregateExecutiveCosts({
      seasonMonths: executiveSeasonMonths,
      seasonMonthKeys: new Set(executiveSeasonMonths.map((month) => month.key)),
      sectorMeta: compareSectorMeta,
      fieldMeta: compareFieldMeta,
      fuelPrices,
      costMovements: executiveCompareCompanyRaw.costMovements || [],
      rawApplications: executiveCompareCompanyRaw.applications || [],
      rawLabor: executiveCompareCompanyRaw.labor || [],
      rawWorkerCosts: executiveCompareCompanyRaw.workerCosts || [],
      rawFuel: executiveCompareCompanyRaw.fuel || [],
      rawFuelConsumption: executiveCompareCompanyRaw.fuelConsumption || [],
      rawMachinery: executiveCompareCompanyRaw.machinery || [],
      rawIrrigation: executiveCompareCompanyRaw.irrigation || [],
      rawGeneralCosts: executiveCompareCompanyRaw.generalCosts || []
    });

    const totalHectares = aggregated.totalHectares;
    return {
      totalSeasonCost: aggregated.totalSeasonCost,
      totalHectares,
      averageCostPerHa: totalHectares > 0 ? aggregated.totalSeasonCost / totalHectares : 0,
      averageMonthlyCost: aggregated.averageMonthlyCost,
      peakMonth: aggregated.peakMonth,
      topField: aggregated.topField
    };
  }, [executiveCompareCompanyRaw, executiveFuelPrices.diesel, executiveFuelPrices.gasoline, executiveSeasonMonths]);

  const executiveCompareCompanyEconomicClosure = useMemo(() => {
    if (!executiveCompareCompanyRaw) return null;
    return buildEconomicClosureSummaryFromSources({
      season: selectedSeason,
      fields: executiveCompareCompanyRaw.fields || [],
      marginRows: executiveCompareCompanyRaw.marginRows || [],
      productionRecords: executiveCompareCompanyRaw.productionRecords || []
    });
  }, [buildEconomicClosureSummaryFromSources, executiveCompareCompanyRaw, selectedSeason]);

  const executiveCompareCompanyAuditMetrics = useMemo(() => {
    if (!executiveCompareCompanyRaw) return null;
    return buildAuditMetricsFromSummaryRows(
      (executiveCompareCompanyRaw.auditSummary || []) as AgriculturalCostAuditSummaryRow[],
      selectedSeason
    );
  }, [buildAuditMetricsFromSummaryRows, executiveCompareCompanyRaw, selectedSeason]);

  const executiveCompareCompanyTotalClosure = useMemo(() => {
    if (!executiveCompareCompanyEconomicClosure || !executiveCompareCompanyAuditMetrics) return null;
    return buildTotalDataClosure({
      economicClosureData: executiveCompareCompanyEconomicClosure,
      auditMetrics: executiveCompareCompanyAuditMetrics
    });
  }, [buildTotalDataClosure, executiveCompareCompanyAuditMetrics, executiveCompareCompanyEconomicClosure]);

  const executiveCompareCompanyTotalClosureRows = useMemo(() => {
    if (!executiveCompareCompanyTotalClosure) return [];
    return [
      {
        metric: 'Cierre total',
        currentValue: executiveTotalDataClosure.totalClosurePct,
        compareValue: executiveCompareCompanyTotalClosure.totalClosurePct,
        format: 'percent' as const
      },
      {
        metric: 'Cierre económico',
        currentValue: executiveTotalDataClosure.economicPct,
        compareValue: executiveCompareCompanyTotalClosure.economicPct,
        format: 'percent' as const
      },
      {
        metric: 'Trazabilidad costo',
        currentValue: executiveTotalDataClosure.traceabilityPct,
        compareValue: executiveCompareCompanyTotalClosure.traceabilityPct,
        format: 'percent' as const
      },
      {
        metric: 'Soporte oficial',
        currentValue: executiveTotalDataClosure.officialSupportPct,
        compareValue: executiveCompareCompanyTotalClosure.officialSupportPct,
        format: 'percent' as const
      },
      {
        metric: 'Bloqueos visibles',
        currentValue: executiveTotalDataClosure.blockers.length,
        compareValue: executiveCompareCompanyTotalClosure.blockers.length,
        format: 'number' as const
      }
    ].map((row) => ({
      ...row,
      gap: row.currentValue - row.compareValue
    }));
  }, [executiveCompareCompanyTotalClosure, executiveTotalDataClosure]);

  const executiveCompareCompanyInsights = useMemo(() => {
    if (!executiveCompareCompanySummary || !executiveCompareCompanyTotalClosure) return null;

    const totalGap = executiveTotalDataClosure.totalClosurePct - executiveCompareCompanyTotalClosure.totalClosurePct;
    const blockerGap = executiveTotalDataClosure.blockers.length - executiveCompareCompanyTotalClosure.blockers.length;
    const strongestGap = executiveCompareCompanyTotalClosureRows
      .slice()
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0] || null;
    const leaderName = totalGap >= 0 ? companyName : executiveCompareCompanyName;
    const lowerBlockerCompanyName = blockerGap <= 0 ? companyName : executiveCompareCompanyName;
    const blockerNarrative = blockerGap === 0
      ? 'Ambas empresas muestran la misma cantidad de bloqueos visibles.'
      : `${lowerBlockerCompanyName} opera con ${Math.abs(blockerGap)} bloqueo${Math.abs(blockerGap) === 1 ? '' : 's'} menos en la temporada.`;
    const summaryLine = Math.abs(totalGap) < 0.05
      ? `Ambas empresas muestran un cierre total prácticamente equivalente para la temporada ${selectedSeason}.`
      : `${leaderName} lidera el cierre total del dato por ${Math.abs(totalGap).toFixed(1)} puntos para la temporada ${selectedSeason}.`;

    return {
      totalGap,
      blockerGap,
      strongestGap,
      summaryLine,
      blockerNarrative,
      currentBlockers: executiveTotalDataClosure.blockers,
      compareBlockers: executiveCompareCompanyTotalClosure.blockers
    };
  }, [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanySummary,
    executiveCompareCompanyTotalClosure,
    executiveCompareCompanyTotalClosureRows,
    executiveTotalDataClosure,
    selectedSeason
  ]);

  const executiveTotalClosureHistoryRows = useMemo(() => (
    Array.from(new Set([selectedSeason, ...availableSeasons]))
      .map((season) => {
        const totalClosure = buildTotalDataClosure({
          economicClosureData: buildEconomicClosureSummary(season),
          auditMetrics: buildAuditMetricsFromSummaryRows(costAuditHistorySummary, season)
        });
        return {
          season,
          totalClosurePct: totalClosure.totalClosurePct,
          economicPct: totalClosure.economicPct,
          traceabilityPct: totalClosure.traceabilityPct,
          officialSupportPct: totalClosure.officialSupportPct,
          blockersCount: totalClosure.blockers.length,
          readinessTitle: totalClosure.readiness.title
        };
      })
      .sort((a, b) => b.season.localeCompare(a.season))
  ), [
    availableSeasons,
    buildAuditMetricsFromSummaryRows,
    buildEconomicClosureSummary,
    buildTotalDataClosure,
    costAuditHistorySummary,
    selectedSeason
  ]);

  const executiveCompareCompanyTotalClosureHistoryRows = useMemo(() => {
    if (!executiveCompareCompanyRaw) return [];

    const compareAvailableSeasons = Array.isArray(executiveCompareCompanyRaw.availableSeasons)
      ? executiveCompareCompanyRaw.availableSeasons
      : [];

    return Array.from(new Set([selectedSeason, ...compareAvailableSeasons]))
      .map((season) => {
        const totalClosure = buildTotalDataClosure({
          economicClosureData: buildEconomicClosureSummaryFromSources({
            season,
            fields: executiveCompareCompanyRaw.fields || [],
            marginRows: executiveCompareCompanyRaw.marginRows || [],
            productionRecords: executiveCompareCompanyRaw.productionRecords || []
          }),
          auditMetrics: buildAuditMetricsFromSummaryRows(
            (executiveCompareCompanyRaw.auditSummary || []) as AgriculturalCostAuditSummaryRow[],
            season
          )
        });

        return {
          season,
          totalClosurePct: totalClosure.totalClosurePct,
          economicPct: totalClosure.economicPct,
          traceabilityPct: totalClosure.traceabilityPct,
          officialSupportPct: totalClosure.officialSupportPct,
          blockersCount: totalClosure.blockers.length,
          readinessTitle: totalClosure.readiness.title
        };
      })
      .sort((a, b) => b.season.localeCompare(a.season));
  }, [
    buildAuditMetricsFromSummaryRows,
    buildEconomicClosureSummaryFromSources,
    buildTotalDataClosure,
    executiveCompareCompanyRaw,
    selectedSeason
  ]);

  const executiveCompareCompanyHistoryRows = useMemo(() => {
    if (!executiveCompareCompanyRaw) return [];

    const currentMap = new Map(executiveTotalClosureHistoryRows.map((row) => [row.season, row]));
    const compareMap = new Map(executiveCompareCompanyTotalClosureHistoryRows.map((row) => [row.season, row]));

    return Array.from(new Set([
      ...executiveTotalClosureHistoryRows.map((row) => row.season),
      ...executiveCompareCompanyTotalClosureHistoryRows.map((row) => row.season)
    ]))
      .sort((a, b) => b.localeCompare(a))
      .map((season) => {
        const current = currentMap.get(season) || null;
        const compare = compareMap.get(season) || null;
        const gap = current && compare ? current.totalClosurePct - compare.totalClosurePct : null;
        const leader = gap === null
          ? 'Sin base comparable'
          : Math.abs(gap) < 0.05
            ? 'Empate técnico'
            : gap > 0
              ? companyName
              : executiveCompareCompanyName;

        return {
          season,
          current,
          compare,
          gap,
          leader
        };
      });
  }, [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanyRaw,
    executiveCompareCompanyTotalClosureHistoryRows,
    executiveTotalClosureHistoryRows
  ]);

  const executiveCompareCompanyHistoryInsights = useMemo(() => {
    if (!executiveCompareCompanyRaw) return null;

    const comparableRows = executiveCompareCompanyHistoryRows.filter((row) => row.current && row.compare && row.gap !== null);
    const strongestHistoricalGap = comparableRows
      .slice()
      .sort((a, b) => Math.abs(Number(b.gap || 0)) - Math.abs(Number(a.gap || 0)))[0] || null;
    const currentLeadCount = comparableRows.filter((row) => Number(row.gap || 0) > 0.05).length;
    const compareLeadCount = comparableRows.filter((row) => Number(row.gap || 0) < -0.05).length;
    const tiedCount = comparableRows.filter((row) => Math.abs(Number(row.gap || 0)) <= 0.05).length;
    const currentBest = executiveTotalClosureHistoryRows
      .slice()
      .sort((a, b) => b.totalClosurePct - a.totalClosurePct)[0] || null;
    const compareBest = executiveCompareCompanyTotalClosureHistoryRows
      .slice()
      .sort((a, b) => b.totalClosurePct - a.totalClosurePct)[0] || null;

    const summaryLine = comparableRows.length <= 0
      ? 'Todavía no hay temporadas comparables suficientes para una lectura histórica entre empresas.'
      : currentLeadCount === compareLeadCount
        ? `Ambas empresas reparten el liderazgo histórico de cierre total en ${comparableRows.length} temporadas comparables.`
        : `${currentLeadCount > compareLeadCount ? companyName : executiveCompareCompanyName} lidera el historial en ${Math.max(currentLeadCount, compareLeadCount)} de ${comparableRows.length} temporadas comparables.`;

    return {
      comparableRows,
      strongestHistoricalGap,
      currentLeadCount,
      compareLeadCount,
      tiedCount,
      currentBest,
      compareBest,
      summaryLine
    };
  }, [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanyRaw,
    executiveCompareCompanyHistoryRows,
    executiveCompareCompanyTotalClosureHistoryRows,
    executiveTotalClosureHistoryRows
  ]);

  const executiveCurrentCompanyTrend = useMemo(() => (
    buildClosureTrendSummary(executiveTotalClosureHistoryRows, companyName, 3)
  ), [companyName, executiveTotalClosureHistoryRows]);

  const executiveCompareCompanyTrend = useMemo(() => {
    if (!executiveCompareCompanyRaw) return null;
    return buildClosureTrendSummary(executiveCompareCompanyTotalClosureHistoryRows, executiveCompareCompanyName, 3);
  }, [
    executiveCompareCompanyName,
    executiveCompareCompanyRaw,
    executiveCompareCompanyTotalClosureHistoryRows
  ]);

  const executiveCurrentCompanyRanking = useMemo(() => (
    buildExecutiveCompanyRanking({
      companyLabel: companyName,
      totalClosurePct: executiveTotalDataClosure.totalClosurePct,
      blockerCount: executiveTotalDataClosure.blockers.length,
      trend: executiveCurrentCompanyTrend
    })
  ), [companyName, executiveCurrentCompanyTrend, executiveTotalDataClosure.blockers.length, executiveTotalDataClosure.totalClosurePct]);

  const executiveCompareCompanyRanking = useMemo(() => {
    if (!executiveCompareCompanyTotalClosure || !executiveCompareCompanyTrend) return null;
    return buildExecutiveCompanyRanking({
      companyLabel: executiveCompareCompanyName,
      totalClosurePct: executiveCompareCompanyTotalClosure.totalClosurePct,
      blockerCount: executiveCompareCompanyTotalClosure.blockers.length,
      trend: executiveCompareCompanyTrend
    });
  }, [executiveCompareCompanyName, executiveCompareCompanyTotalClosure, executiveCompareCompanyTrend]);

  const executiveCompanyRankingComparison = useMemo(() => {
    if (!executiveCompareCompanyRanking) return null;
    const rows = [
      executiveCurrentCompanyRanking,
      executiveCompareCompanyRanking
    ].sort((a, b) => b.score - a.score);
    const gap = executiveCurrentCompanyRanking.score - executiveCompareCompanyRanking.score;
    const leader = Math.abs(gap) < 0.05
      ? 'Empate técnico'
      : gap > 0
        ? companyName
        : executiveCompareCompanyName;
    const summaryLine = Math.abs(gap) < 0.05
      ? 'Ambas empresas muestran una base ejecutiva equivalente en el ranking ponderado.'
      : `${leader} lidera el ranking ejecutivo por ${Math.abs(gap).toFixed(1)} puntos ponderados.`;

    return {
      rows,
      gap,
      leader,
      summaryLine
    };
  }, [companyName, executiveCompareCompanyName, executiveCompareCompanyRanking, executiveCurrentCompanyRanking]);

  const executiveTrendComparisonInsights = useMemo(() => {
    if (!executiveCompareCompanyTrend) return null;

    const deltaGap = executiveCurrentCompanyTrend.delta - executiveCompareCompanyTrend.delta;
    const leader = Math.abs(deltaGap) < 0.05
      ? 'Ambas empresas sostienen una pendiente similar.'
      : deltaGap > 0
        ? `${companyName} acelera más rápido su cierre total reciente.`
        : `${executiveCompareCompanyName} acelera más rápido su cierre total reciente.`;

    return {
      deltaGap,
      leader,
      narrative: `${executiveCurrentCompanyTrend.narrative} ${executiveCompareCompanyTrend.narrative}`
    };
  }, [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanyTrend,
    executiveCurrentCompanyTrend
  ]);

  const executiveTrendWarning = useMemo(() => (
    buildHighClosureTrendWarning({
      totalClosurePct: executiveTotalDataClosure.totalClosurePct,
      trend: executiveCurrentCompanyTrend,
      compareCompanyLabel: executiveCompareCompanyName,
      compareTrend: executiveCompareCompanyTrend
    })
  ), [
    executiveCompareCompanyName,
    executiveCompareCompanyTrend,
    executiveCurrentCompanyTrend,
    executiveTotalDataClosure.totalClosurePct
  ]);

  const executiveCompareCompanyTrendWarning = useMemo(() => {
    if (!executiveCompareCompanyTotalClosure || !executiveCompareCompanyTrend) return null;
    return buildHighClosureTrendWarning({
      totalClosurePct: executiveCompareCompanyTotalClosure.totalClosurePct,
      trend: executiveCompareCompanyTrend,
      compareCompanyLabel: companyName,
      compareTrend: executiveCurrentCompanyTrend
    });
  }, [
    companyName,
    executiveCompareCompanyTotalClosure,
    executiveCompareCompanyTrend,
    executiveCurrentCompanyTrend
  ]);

  const executiveCurrentRecommendation = useMemo(() => (
    buildExecutiveRecommendation({
      companyLabel: companyName,
      totalClosure: executiveTotalDataClosure,
      trend: executiveCurrentCompanyTrend,
      trendWarning: executiveTrendWarning,
      compareCompanyLabel: executiveCompareCompanyName,
      compareTotalClosurePct: executiveCompareCompanyTotalClosure?.totalClosurePct ?? null,
      compareTrend: executiveCompareCompanyTrend
    })
  ), [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanyTotalClosure?.totalClosurePct,
    executiveCompareCompanyTrend,
    executiveCurrentCompanyTrend,
    executiveTotalDataClosure,
    executiveTrendWarning
  ]);

  const executiveCompareCompanyRecommendation = useMemo(() => {
    if (!executiveCompareCompanyTotalClosure || !executiveCompareCompanyTrend) return null;

    return buildExecutiveRecommendation({
      companyLabel: executiveCompareCompanyName,
      totalClosure: executiveCompareCompanyTotalClosure,
      trend: executiveCompareCompanyTrend,
      trendWarning: executiveCompareCompanyTrendWarning,
      compareCompanyLabel: companyName,
      compareTotalClosurePct: executiveTotalDataClosure.totalClosurePct,
      compareTrend: executiveCurrentCompanyTrend
    });
  }, [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanyTotalClosure,
    executiveCompareCompanyTrend,
    executiveCompareCompanyTrendWarning,
    executiveCurrentCompanyTrend,
    executiveTotalDataClosure.totalClosurePct
  ]);

  const executiveExportWarningContext = useMemo(() => {
    const warningTypes: string[] = [];

    if (executiveTotalDataClosure.readiness.title === 'No listo para comité') {
      warningTypes.push('committee_not_ready');
    }

    if (executiveTrendWarning) {
      warningTypes.push('trend_deterioration_high_closure');
    }

    const hasWarning = warningTypes.length > 0;
    const warningSummary = !hasWarning
      ? 'Sin advertencias activas para exportación ejecutiva.'
      : [
          executiveTotalDataClosure.readiness.title === 'No listo para comité'
            ? `La temporada sigue en ${executiveTotalDataClosure.readiness.title}.`
            : null,
          executiveTrendWarning?.detail || null
        ].filter(Boolean).join(' ');

    return {
      hasWarning,
      warningTypes,
      warningSummary
    };
  }, [executiveTotalDataClosure.readiness.title, executiveTrendWarning]);

  const logExecutiveExportWarningEvent = useCallback(async (format: ExecutiveExportAction) => {
    if (!selectedCompany?.id || !executiveExportWarningContext.hasWarning) return;

    try {
      await createExecutiveExportWarningEvent({
        companyId: selectedCompany.id,
        season: selectedSeason,
        exportFormat: format,
        readinessTitle: executiveTotalDataClosure.readiness.title,
        totalClosurePct: Number(executiveTotalDataClosure.totalClosurePct.toFixed(2)),
        warningTypes: executiveExportWarningContext.warningTypes,
        warningSummary: executiveExportWarningContext.warningSummary,
        warningDetail: executiveTrendWarning?.recommendation || executiveTotalDataClosure.readiness.detail,
        fieldFilter: executiveFieldFilter,
        fieldLabel: executiveFieldLabel,
        compareCompanyId: executiveCompareCompanyId !== 'none' ? executiveCompareCompanyId : null,
        compareCompanyName: executiveCompareCompanyName || null,
        metadata: {
          company_name: companyName,
          economic_pct: Number(executiveTotalDataClosure.economicPct.toFixed(2)),
          traceability_pct: Number(executiveTotalDataClosure.traceabilityPct.toFixed(2)),
          official_support_pct: Number(executiveTotalDataClosure.officialSupportPct.toFixed(2)),
          review_clean_pct: Number(executiveTotalDataClosure.reviewCleanPct.toFixed(2)),
          blockers: executiveTotalDataClosure.blockers,
          trend_direction: executiveCurrentCompanyTrend.direction,
          trend_delta: Number(executiveCurrentCompanyTrend.delta.toFixed(2)),
          trend_recent_window: executiveCurrentCompanyTrend.recentWindowLabel,
          trend_previous_window: executiveCurrentCompanyTrend.previousWindowLabel,
          compare_company_trend_direction: executiveCompareCompanyTrend?.direction || null,
          compare_company_trend_delta: executiveCompareCompanyTrend ? Number(executiveCompareCompanyTrend.delta.toFixed(2)) : null,
          compare_company_readiness: executiveCompareCompanyTotalClosure?.readiness.title || null,
          trend_alert_detail: executiveTrendWarning?.detail || null,
          trend_alert_compare_line: executiveTrendWarning?.compareLine || null
        }
      });
    } catch (error) {
      console.error('No se pudo registrar la bitácora de exportación bajo advertencia.', error);
    }
  }, [
    companyName,
    executiveCompareCompanyId,
    executiveCompareCompanyName,
    executiveCompareCompanyTotalClosure,
    executiveCompareCompanyTrend,
    executiveCurrentCompanyTrend,
    executiveExportWarningContext,
    executiveFieldFilter,
    executiveFieldLabel,
    executiveTotalDataClosure,
    executiveTrendWarning,
    selectedCompany?.id,
    selectedSeason
  ]);

  const executiveExportWarningHistoryData = useMemo(
    () => buildExecutiveExportWarningAnalytics(executiveExportWarningEvents, selectedSeason, 'la empresa activa'),
    [executiveExportWarningEvents, selectedSeason]
  );
  const executiveExportWarningFormatOptions = useMemo(() => (
    ['all', ...Array.from(new Set(executiveExportWarningEvents.map((row) => row.export_format)))]
  ), [executiveExportWarningEvents]);
  const executiveExportWarningTypeOptions = useMemo(() => (
    ['all', ...Array.from(new Set(
      executiveExportWarningEvents.flatMap((row) => row.warning_types || [])
    )).sort((a, b) => formatExecutiveExportWarningType(a).localeCompare(formatExecutiveExportWarningType(b)))]
  ), [executiveExportWarningEvents]);
  const executiveExportWarningActorOptions = useMemo(() => (
    ['all', ...Array.from(new Set(
      executiveExportWarningEvents.map((row) => row.created_by).filter(Boolean)
    )).sort((a, b) => String(a).localeCompare(String(b)))]
  ), [executiveExportWarningEvents]);
  const executiveExportWarningFiltersActive = useMemo(() => (
    executiveExportWarningFormatFilter !== 'all'
    || executiveExportWarningTypeFilter !== 'all'
    || executiveExportWarningActorFilter !== 'all'
  ), [
    executiveExportWarningActorFilter,
    executiveExportWarningFormatFilter,
    executiveExportWarningTypeFilter
  ]);
  const executiveExportWarningFilteredRows = useMemo(() => (
    executiveExportWarningEvents.filter((row) => {
      if (executiveExportWarningFormatFilter !== 'all' && row.export_format !== executiveExportWarningFormatFilter) {
        return false;
      }
      if (executiveExportWarningTypeFilter !== 'all' && !(row.warning_types || []).includes(executiveExportWarningTypeFilter)) {
        return false;
      }
      if (executiveExportWarningActorFilter !== 'all' && row.created_by !== executiveExportWarningActorFilter) {
        return false;
      }
      return true;
    })
  ), [
    executiveExportWarningActorFilter,
    executiveExportWarningEvents,
    executiveExportWarningFormatFilter,
    executiveExportWarningTypeFilter
  ]);
  const executiveExportWarningFilteredData = useMemo(
    () => buildExecutiveExportWarningAnalytics(
      executiveExportWarningFilteredRows,
      selectedSeason,
      executiveExportWarningFiltersActive ? 'los filtros activos' : 'la empresa activa'
    ),
    [executiveExportWarningFilteredRows, executiveExportWarningFiltersActive, selectedSeason]
  );
  const executiveExportWarningFiltersLabel = useMemo(() => {
    const parts: string[] = [];
    if (executiveExportWarningFormatFilter !== 'all') {
      parts.push(`Formato: ${executiveExportWarningFormatFilter.toUpperCase()}`);
    }
    if (executiveExportWarningTypeFilter !== 'all') {
      parts.push(`Advertencia: ${formatExecutiveExportWarningType(executiveExportWarningTypeFilter)}`);
    }
    if (executiveExportWarningActorFilter !== 'all') {
      parts.push(`Emisor: ${formatExecutiveExportActor(executiveExportWarningActorFilter)}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Todos los eventos';
  }, [
    executiveExportWarningActorFilter,
    executiveExportWarningFormatFilter,
    executiveExportWarningTypeFilter
  ]);
  const executiveCommitteeSlideSummary = useMemo(() => {
    const decisionLabel = executiveCurrentRecommendation.tone.title;
    const blockerSummary = executiveTotalDataClosure.blockers.length > 0
      ? `${executiveTotalDataClosure.blockers.length} bloqueos visibles siguen abiertos.`
      : 'No hay bloqueos críticos visibles para el filtro actual.';
    const trendSummary = executiveTrendWarning
      ? executiveTrendWarning.detail
      : executiveCurrentCompanyTrend.narrative;
    const exportControlSummary = executiveExportWarningFilteredData.latestEvent
      ? `Última exportación advertida visible: ${executiveExportWarningFilteredData.latestEvent.export_format.toUpperCase()} · ${executiveExportWarningFilteredData.latestEvent.season} · ${formatExecutiveExportActor(executiveExportWarningFilteredData.latestEvent.created_by)}.`
      : 'No hay exportaciones advertidas visibles para los filtros actuales.';
    const compareSummary = executiveCompareCompanyRecommendation
      ? `${companyName}: ${executiveCurrentRecommendation.tone.title}. ${executiveCompareCompanyName}: ${executiveCompareCompanyRecommendation.tone.title}.`
      : 'No hay una empresa comparada activa para este cierre.';
    const rankingSummary = executiveCompanyRankingComparison
      ? executiveCompanyRankingComparison.summaryLine
      : 'No hay ranking comparado activo para este cierre.';
    const finalMessage = `${decisionLabel}. ${executiveCurrentRecommendation.summary} ${executiveCurrentRecommendation.nextStep}`;

    return {
      decisionLabel,
      blockerSummary,
      trendSummary,
      exportControlSummary,
      compareSummary,
      rankingSummary,
      finalMessage
    };
  }, [
    companyName,
    executiveCompareCompanyName,
    executiveCompareCompanyRecommendation,
    executiveCompanyRankingComparison,
    executiveCurrentCompanyTrend.narrative,
    executiveCurrentRecommendation.nextStep,
    executiveCurrentRecommendation.summary,
    executiveCurrentRecommendation.tone.title,
    executiveExportWarningFilteredData.latestEvent,
    executiveTotalDataClosure.blockers.length,
    executiveTrendWarning
  ]);

  const executiveHistoricalSeasonRows = useMemo(() => {
    return availablePreviousExecutiveSeasons.map((season) => {
      const base = aggregateExecutiveCosts({
        seasonMonths: buildExecutiveSeasonMonths(season),
        seasonMonthKeys: new Set(buildExecutiveSeasonMonths(season).map((month) => month.key)),
        sectorMeta: executiveSectorMeta,
        fieldMeta: executiveFieldMeta,
        fuelPrices: executiveFuelPrices,
        costMovements: rawCostMovements,
        rawApplications,
        rawLabor,
        rawWorkerCosts,
        rawFuel,
        rawFuelConsumption,
        rawMachinery,
        rawIrrigation,
        rawGeneralCosts
      });

      if (executiveFieldFilter !== 'all') {
        const selectedField = base.fieldRows.find((row) => row.fieldId === executiveFieldFilter) || null;
        const total = selectedField?.total || 0;
        return {
          season,
          total,
          averageMonthlyCost: total > 0 ? total / base.monthlyRows.length : 0,
          peakMonthLabel: base.peakMonth?.monthLabel || '-'
        };
      }

      return {
        season,
        total: base.totalSeasonCost,
        averageMonthlyCost: base.averageMonthlyCost,
        peakMonthLabel: base.peakMonth?.monthLabel || '-'
      };
    }).sort((a, b) => b.season.localeCompare(a.season));
  }, [
    availablePreviousExecutiveSeasons,
    executiveFieldFilter,
    executiveFieldMeta,
    executiveFuelPrices,
    executiveSectorMeta,
    rawApplications,
    rawFuel,
    rawFuelConsumption,
    rawGeneralCosts,
    rawIrrigation,
    rawLabor,
    rawMachinery,
    rawWorkerCosts
  ]);

  const exportExecutiveExcel = async () => {
    try {
      const boardRows = [
        { Indicador: 'Empresa', Valor: companyName },
        { Indicador: 'Temporada actual', Valor: selectedSeason },
        { Indicador: 'Temporada comparativa', Valor: previousExecutiveSeason },
        { Indicador: 'Campo filtrado', Valor: executiveFieldLabel },
        { Indicador: 'Orden campos', Valor: EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveFieldSortBy)?.label || executiveFieldSortBy },
        { Indicador: 'Orden sectores', Valor: EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveSectorSortBy)?.label || executiveSectorSortBy },
        { Indicador: 'Comparacion campos', Valor: executiveFieldComparison ? `${executiveFieldComparison.fieldA.fieldName} vs ${executiveFieldComparison.fieldB.fieldName}` : 'No disponible' },
        { Indicador: 'Gasto total temporada', Valor: Number(executiveViewData.kpis.totalSeasonCost.toFixed(0)) },
        { Indicador: 'Presupuesto visible', Valor: Number((executiveViewData.kpis.totalBudget || 0).toFixed(0)) },
        { Indicador: 'Desviación presupuesto', Valor: Number((executiveViewData.kpis.budgetDelta || 0).toFixed(0)) },
        { Indicador: 'Costo por ha', Valor: Number((executiveViewData.kpis.averageCostPerHa || 0).toFixed(2)) },
        { Indicador: 'Costo por kg', Valor: Number((executiveViewData.kpis.averageCostPerKg || 0).toFixed(2)) },
        { Indicador: 'Temporada anterior', Valor: Number(executiveViewData.kpis.previousSeasonCost.toFixed(0)) },
        { Indicador: 'Variación temporada', Valor: Number(executiveViewData.kpis.seasonVariation.toFixed(0)) },
        { Indicador: 'Variación temporada %', Valor: Number(executiveViewData.kpis.seasonVariationPct.toFixed(2)) },
        { Indicador: 'Promedio mensual', Valor: Number(executiveViewData.kpis.averageMonthlyCost.toFixed(0)) },
        { Indicador: 'Alertas activas', Valor: executiveInsights.activeAlertCount },
        { Indicador: 'Monto oficial', Valor: Number(executiveAuditData.officialAmount.toFixed(0)) },
        { Indicador: 'Trazabilidad %', Valor: Number(executiveAuditData.traceabilityPct.toFixed(2)) },
        { Indicador: 'Monto trazable', Valor: Number(executiveAuditData.traceableAmount.toFixed(0)) },
        { Indicador: 'Monto respaldo', Valor: Number(executiveAuditData.backupAmount.toFixed(0)) },
        { Indicador: 'Monto distribución', Valor: Number(executiveAuditData.distributedAmount.toFixed(0)) },
        { Indicador: 'Monto revisión alta', Valor: Number(executiveAuditData.highReviewAmount.toFixed(0)) },
        { Indicador: 'Ingreso total', Valor: Number(executiveMarginData.totalIncome.toFixed(0)) },
        { Indicador: 'Utilidad neta', Valor: Number(executiveMarginData.totalProfit.toFixed(0)) },
        { Indicador: 'Margen neto %', Valor: Number(executiveMarginData.marginPct.toFixed(2)) },
        { Indicador: 'Cobertura producción %', Valor: Number(executiveMarginData.productionCoveragePct.toFixed(2)) },
        { Indicador: 'Cierre económico %', Valor: Number(executiveEconomicClosureData.closurePct.toFixed(2)) },
        { Indicador: 'Sectores cerrados', Valor: executiveEconomicClosureData.closedRows.length },
        { Indicador: 'Pendientes producción', Valor: executiveEconomicClosureData.pendingProductionRows.length },
        { Indicador: 'Pendientes ingreso', Valor: executiveEconomicClosureData.pendingIncomeRows.length },
        { Indicador: 'Cierre total dato %', Valor: Number(executiveTotalDataClosure.totalClosurePct.toFixed(2)) },
        { Indicador: 'Soporte oficial %', Valor: Number(executiveTotalDataClosure.officialSupportPct.toFixed(2)) },
        { Indicador: 'Estado comité', Valor: executiveTotalDataClosure.readiness.title },
        { Indicador: 'Recomendación automática', Valor: executiveCurrentRecommendation.tone.title },
        { Indicador: 'Resumen recomendación', Valor: executiveCurrentRecommendation.summary },
        { Indicador: 'Alerta tendencia', Valor: executiveTrendWarning?.shortLabel || 'Sin alerta' },
        { Indicador: 'Detalle alerta tendencia', Valor: executiveTrendWarning?.detail || 'Sin alerta preventiva visible' },
        { Indicador: 'Eventos bitácora advertencia', Valor: executiveExportWarningHistoryData.totalEvents },
        { Indicador: 'Eventos bitácora visibles', Valor: executiveExportWarningFilteredData.totalEvents },
        { Indicador: 'Filtros bitácora', Valor: executiveExportWarningFiltersLabel },
        { Indicador: 'Última exportación advertida', Valor: executiveExportWarningFilteredData.latestEvent ? `${executiveExportWarningFilteredData.latestEvent.export_format.toUpperCase()} · ${executiveExportWarningFilteredData.latestEvent.season}` : 'Sin eventos' },
        { Indicador: 'Empresa comparada', Valor: executiveCompareCompanyName || 'Sin comparar' },
        { Indicador: 'Cierre total empresa comparada', Valor: executiveCompareCompanyTotalClosure ? Number(executiveCompareCompanyTotalClosure.totalClosurePct.toFixed(2)) : 'Sin datos' },
        { Indicador: 'Estado comité comparado', Valor: executiveCompareCompanyTotalClosure?.readiness.title || 'Sin datos' },
        { Indicador: 'Ranking actual', Valor: Number(executiveCurrentCompanyRanking.score.toFixed(2)) },
        { Indicador: 'Ranking comparado', Valor: executiveCompareCompanyRanking ? Number(executiveCompareCompanyRanking.score.toFixed(2)) : 'Sin datos' },
        { Indicador: 'Líder ranking', Valor: executiveCompanyRankingComparison?.leader || 'Sin comparar' },
        { Indicador: 'Recomendación comparada', Valor: executiveCompareCompanyRecommendation?.tone.title || 'Sin datos' },
        { Indicador: 'Mejor cierre histórico', Valor: bestClosureHistoryRow ? `${bestClosureHistoryRow.season} (${bestClosureHistoryRow.closurePct.toFixed(2)}%)` : 'Sin datos' },
        { Indicador: 'Conclusión ejecutiva', Valor: executiveInsights.conclusion }
      ];
      const historicalRows = executiveHistoricalSeasonRows.map((row) => ({
        Temporada: row.season,
        'Gasto total': Number(row.total.toFixed(0)),
        'Promedio mensual': Number(row.averageMonthlyCost.toFixed(0)),
        'Mes más alto': row.peakMonthLabel
      }));

      const summaryRows = executiveViewData.monthlyRows.map((row) => ({
        Mes: row.monthLabel,
        'Gasto Total': Number(row.total.toFixed(0)),
        'Variación CLP': Number(row.variation.toFixed(0)),
        'Variación %': Number(row.variationPct.toFixed(2)),
        [`${previousExecutiveSeason}`]: Number(row.previousSeasonTotal.toFixed(0)),
        'Vs Temp. Anterior CLP': Number(row.vsPreviousSeason.toFixed(0)),
        'Vs Temp. Anterior %': Number(row.vsPreviousSeasonPct.toFixed(2)),
        'Campo Mayor Gasto': row.topFieldName,
        'Sector Mayor Gasto': row.topSectorName
      }));

      const fieldRows = executiveViewData.fieldRows.map((row) => {
        const base: Record<string, unknown> = {
          Campo: row.fieldName,
          Hectáreas: Number(row.hectares.toFixed(2)),
          'Total Temporada': Number(row.total.toFixed(0)),
          Presupuesto: Number((row.budgetTotal || 0).toFixed(0)),
          'Desviación Ppto': Number((row.budgetDelta || 0).toFixed(0)),
          'Ejecución Ppto %': Number((row.budgetExecutionPct || 0).toFixed(2)),
          'Costo / Ha': Number((row.costPerHa || 0).toFixed(2)),
          'Costo / Kg': Number((row.costPerKg || 0).toFixed(2)),
          [`Temp. ${previousExecutiveSeason}`]: Number(row.previousTotal.toFixed(0)),
          'Variación CLP': Number(row.delta.toFixed(0)),
          'Variación %': Number(row.deltaPct.toFixed(2)),
          'Participación %': Number(row.sharePct.toFixed(2))
        };
        executiveSeasonMonths.forEach((month) => {
          base[month.shortLabel] = Number((row.months[month.key] || 0).toFixed(0));
        });
        return base;
      });

      const sectorRows = executiveViewData.sectorRows.map((row) => {
        const base: Record<string, unknown> = {
          Campo: row.fieldName,
          Sector: row.sectorName,
          Hectáreas: Number(row.hectares.toFixed(2)),
          'Total Temporada': Number(row.total.toFixed(0)),
          Presupuesto: Number((row.budgetTotal || 0).toFixed(0)),
          'Desviación Ppto': Number((row.budgetDelta || 0).toFixed(0)),
          'Ejecución Ppto %': Number((row.budgetExecutionPct || 0).toFixed(2)),
          'Costo / Ha': Number((row.costPerHa || 0).toFixed(2)),
          'Costo / Kg': Number((row.costPerKg || 0).toFixed(2)),
          [`Temp. ${previousExecutiveSeason}`]: Number(row.previousTotal.toFixed(0)),
          'Variación CLP': Number(row.delta.toFixed(0)),
          'Variación %': Number(row.deltaPct.toFixed(2)),
          'Participación %': Number(row.sharePct.toFixed(2))
        };
        executiveSeasonMonths.forEach((month) => {
          base[month.shortLabel] = Number((row.months[month.key] || 0).toFixed(0));
        });
        return base;
      });

      const topFieldsRows = executiveViewData.topFields.map((row, index) => ({
        Ranking: index + 1,
        Campo: row.fieldName,
        'Total Temporada': Number(row.total.toFixed(0)),
        [`Temp. ${previousExecutiveSeason}`]: Number(row.previousTotal.toFixed(0)),
        'Variación CLP': Number(row.delta.toFixed(0)),
        'Variación %': Number(row.deltaPct.toFixed(2)),
        'Participación %': Number(row.sharePct.toFixed(2))
      }));

      const topSectorsRows = executiveViewData.topSectors.map((row, index) => ({
        Ranking: index + 1,
        Campo: row.fieldName,
        Sector: row.sectorName,
        'Total Temporada': Number(row.total.toFixed(0)),
        [`Temp. ${previousExecutiveSeason}`]: Number(row.previousTotal.toFixed(0)),
        'Variación CLP': Number(row.delta.toFixed(0)),
        'Variación %': Number(row.deltaPct.toFixed(2)),
        'Participación %': Number(row.sharePct.toFixed(2))
      }));

      const alertRows = executiveViewData.alerts.map((alert, index) => ({
        Ranking: index + 1,
        Nivel: alert.level,
        Título: alert.title,
        Mensaje: alert.message,
        Monto: Number(alert.amount.toFixed(0))
      }));
      const comparisonRows = executiveFieldComparison
        ? executiveFieldComparison.comparisonRows.map((row) => ({
          Indicador: row.metric,
          [executiveFieldComparison.fieldA.fieldName]: Number(row.fieldAValue.toFixed(2)),
          [executiveFieldComparison.fieldB.fieldName]: Number(row.fieldBValue.toFixed(2)),
          Brecha: Number(row.gap.toFixed(2))
        }))
        : [];
      const comparisonMonthlyRows = executiveFieldComparison
        ? executiveFieldComparison.monthlyRows.map((row) => ({
          Mes: row.fullLabel,
          [executiveFieldComparison.fieldA.fieldName]: Number(row.fieldATotal.toFixed(0)),
          [executiveFieldComparison.fieldB.fieldName]: Number(row.fieldBTotal.toFixed(0)),
          Brecha: Number(row.gap.toFixed(0))
        }))
        : [];
      const auditSummaryRows = executiveAuditExportSummaryRows.map((row) => ({
        Temporada: row.season || 'Sin temporada',
        Categoria: row.category,
        Capa: row.source_layer,
        Rol: row.cost_role,
        Estado: row.audit_status,
        Prioridad: row.review_priority,
        Movimientos: Number(row.movement_count || 0),
        Total: Number(row.total_amount || 0),
        Trazable: Number(row.traceable_amount || 0),
        'No trazable': Number(row.non_traceable_amount || 0)
      }));
      const auditDetailRows = executiveAuditData.topDetailRows.map((row, index) => ({
        Ranking: index + 1,
        Fecha: row.movement_date,
        Campo: row.field_name || '-',
        Sector: row.sector_name || '-',
        Categoria: row.category,
        Estado: row.audit_status,
        Prioridad: row.review_priority,
        Monto: Number(row.amount || 0)
      }));
      const economicClosureRows = executiveEconomicClosureData.visibleRows.map((row) => ({
        Campo: row.fieldName,
        Sector: row.sectorName,
        Hectareas: Number(row.hectares || 0),
        'Produccion formal': row.hasRecord ? 'Si' : 'No',
        'Fuente margen': row.productionSource,
        'Kg producidos': Number(row.kgProduced || 0),
        'Ingreso CLP': Number(row.totalIncome || 0),
        'Costo CLP': Number(row.totalCost || 0),
        'Margen %': Number(row.marginPct || 0)
      }));
      const economicFocusRows = executiveEconomicClosureData.topFocusRows.map((row, index) => ({
        Ranking: index + 1,
        Estado: row.status,
        Campo: row.fieldName,
        Sector: row.sectorName,
        Referencia: row.unitLabel
      }));
      const historicalClosureRows = executiveEconomicClosureHistoryRows.map((row) => ({
        Temporada: row.season,
        Estado: row.toneLabel,
        'Sectores visibles': row.visibleSectorCount,
        'Sectores cerrados': row.closedSectorCount,
        'Cierre %': Number(row.closurePct.toFixed(2)),
        'Pend. producción': row.pendingProductionCount,
        'Pend. ingreso': row.pendingIncomeCount,
        'Costo sin ingreso': row.costWithoutIncomeCount,
        'Monto pend. producción': Number(row.pendingProductionAmount.toFixed(0)),
        'Monto pend. ingreso': Number(row.pendingIncomeCost.toFixed(0)),
        'Monto costo sin ingreso': Number(row.costWithoutIncomeAmount.toFixed(0))
      }));
      const totalDataClosureRows = [
        { Indicador: 'Cierre total del dato', Valor: `${executiveTotalDataClosure.totalClosurePct.toFixed(2)}%` },
        { Indicador: 'Cierre económico', Valor: `${executiveTotalDataClosure.economicPct.toFixed(2)}%` },
        { Indicador: 'Trazabilidad costo', Valor: `${executiveTotalDataClosure.traceabilityPct.toFixed(2)}%` },
        { Indicador: 'Soporte oficial', Valor: `${executiveTotalDataClosure.officialSupportPct.toFixed(2)}%` },
        { Indicador: 'Limpieza revisión', Valor: `${executiveTotalDataClosure.reviewCleanPct.toFixed(2)}%` },
        { Indicador: 'Estado comité', Valor: executiveTotalDataClosure.readiness.title },
        { Indicador: 'Recomendación automática', Valor: executiveCurrentRecommendation.tone.title },
        { Indicador: 'Resumen recomendación', Valor: executiveCurrentRecommendation.summary },
        { Indicador: 'Siguiente paso', Valor: executiveCurrentRecommendation.nextStep },
        { Indicador: 'Alerta tendencia', Valor: executiveTrendWarning?.shortLabel || 'Sin alerta' },
        { Indicador: 'Detalle alerta tendencia', Valor: executiveTrendWarning?.detail || 'Sin alerta preventiva visible' },
        { Indicador: 'Conclusión', Valor: executiveTotalDataClosure.conclusion }
      ];
      const recommendationRows = [
        {
          Empresa: companyName,
          Decisión: executiveCurrentRecommendation.tone.title,
          Resumen: executiveCurrentRecommendation.summary,
          'Siguiente paso': executiveCurrentRecommendation.nextStep,
          'Razón 1': executiveCurrentRecommendation.reasons[0] || '-',
          'Razón 2': executiveCurrentRecommendation.reasons[1] || '-',
          'Razón 3': executiveCurrentRecommendation.reasons[2] || '-',
          'Razón 4': executiveCurrentRecommendation.reasons[3] || '-'
        },
        ...(executiveCompareCompanyRecommendation ? [{
          Empresa: executiveCompareCompanyName,
          Decisión: executiveCompareCompanyRecommendation.tone.title,
          Resumen: executiveCompareCompanyRecommendation.summary,
          'Siguiente paso': executiveCompareCompanyRecommendation.nextStep,
          'Razón 1': executiveCompareCompanyRecommendation.reasons[0] || '-',
          'Razón 2': executiveCompareCompanyRecommendation.reasons[1] || '-',
          'Razón 3': executiveCompareCompanyRecommendation.reasons[2] || '-',
          'Razón 4': executiveCompareCompanyRecommendation.reasons[3] || '-'
        }] : [])
      ];
      const rankingRows = [
        {
          Empresa: executiveCurrentCompanyRanking.companyLabel,
          Puntaje: Number(executiveCurrentCompanyRanking.score.toFixed(2)),
          Nivel: executiveCurrentCompanyRanking.tone.label,
          'Cierre ponderado': Number(executiveCurrentCompanyRanking.components.closure.toFixed(2)),
          'Tendencia ponderada': Number(executiveCurrentCompanyRanking.components.trend.toFixed(2)),
          'Disciplina bloqueos': Number(executiveCurrentCompanyRanking.components.blockers.toFixed(2)),
          Lectura: executiveCurrentCompanyRanking.narrative
        },
        ...(executiveCompareCompanyRanking ? [{
          Empresa: executiveCompareCompanyRanking.companyLabel,
          Puntaje: Number(executiveCompareCompanyRanking.score.toFixed(2)),
          Nivel: executiveCompareCompanyRanking.tone.label,
          'Cierre ponderado': Number(executiveCompareCompanyRanking.components.closure.toFixed(2)),
          'Tendencia ponderada': Number(executiveCompareCompanyRanking.components.trend.toFixed(2)),
          'Disciplina bloqueos': Number(executiveCompareCompanyRanking.components.blockers.toFixed(2)),
          Lectura: executiveCompareCompanyRanking.narrative
        }] : []),
        ...(executiveCompanyRankingComparison ? [{
          Empresa: 'Resultado',
          Puntaje: Number(Math.abs(executiveCompanyRankingComparison.gap).toFixed(2)),
          Nivel: executiveCompanyRankingComparison.leader,
          'Cierre ponderado': Number(executiveCurrentCompanyRanking.weights.closure.toFixed(2)),
          'Tendencia ponderada': Number(executiveCurrentCompanyRanking.weights.trend.toFixed(2)),
          'Disciplina bloqueos': Number(executiveCurrentCompanyRanking.weights.blockers.toFixed(2)),
          Lectura: executiveCompanyRankingComparison.summaryLine
        }] : [])
      ];
      const exportWarningHistoryRows = executiveExportWarningFilteredData.rows.map((row) => ({
        Fecha: new Date(row.created_at).toLocaleString('es-CL'),
        Temporada: row.season,
        Formato: row.export_format.toUpperCase(),
        Emisor: formatExecutiveExportActor(row.created_by),
        Estado: row.readiness_title,
        'Cierre total': Number(Number(row.total_closure_pct || 0).toFixed(2)),
        Advertencias: (row.warning_types || []).map((item) => formatExecutiveExportWarningType(item)).join(', ') || 'Sin detalle',
        Resumen: row.warning_summary,
        Detalle: row.warning_detail || '',
        Campo: row.field_label || 'Todos los campos',
        'Empresa comparada': row.compare_company_name || 'Sin comparar'
      }));
      const trendWarningRows = executiveTrendWarning ? [
        { Campo: 'Estado', Valor: executiveTrendWarning.shortLabel },
        { Campo: 'Detalle', Valor: executiveTrendWarning.detail },
        { Campo: 'Recomendación', Valor: executiveTrendWarning.recommendation },
        { Campo: 'Comparativo', Valor: executiveTrendWarning.compareLine || 'Sin comparativo adicional' }
      ] : [];
      const totalDataBlockerRows = executiveTotalDataClosure.blockers.map((item, index) => ({
        Ranking: index + 1,
        Bloqueo: item
      }));
      const compareCompanyRows = executiveCompareCompanyTotalClosure
        ? [
            {
              Indicador: 'Cierre total',
              [companyName]: Number(executiveTotalDataClosure.totalClosurePct.toFixed(2)),
              [executiveCompareCompanyName]: Number(executiveCompareCompanyTotalClosure.totalClosurePct.toFixed(2)),
              Brecha: Number((executiveTotalDataClosure.totalClosurePct - executiveCompareCompanyTotalClosure.totalClosurePct).toFixed(2))
            },
            {
              Indicador: 'Cierre económico',
              [companyName]: Number(executiveTotalDataClosure.economicPct.toFixed(2)),
              [executiveCompareCompanyName]: Number(executiveCompareCompanyTotalClosure.economicPct.toFixed(2)),
              Brecha: Number((executiveTotalDataClosure.economicPct - executiveCompareCompanyTotalClosure.economicPct).toFixed(2))
            },
            {
              Indicador: 'Trazabilidad costo',
              [companyName]: Number(executiveTotalDataClosure.traceabilityPct.toFixed(2)),
              [executiveCompareCompanyName]: Number(executiveCompareCompanyTotalClosure.traceabilityPct.toFixed(2)),
              Brecha: Number((executiveTotalDataClosure.traceabilityPct - executiveCompareCompanyTotalClosure.traceabilityPct).toFixed(2))
            },
            {
              Indicador: 'Soporte oficial',
              [companyName]: Number(executiveTotalDataClosure.officialSupportPct.toFixed(2)),
              [executiveCompareCompanyName]: Number(executiveCompareCompanyTotalClosure.officialSupportPct.toFixed(2)),
              Brecha: Number((executiveTotalDataClosure.officialSupportPct - executiveCompareCompanyTotalClosure.officialSupportPct).toFixed(2))
            },
            {
              Indicador: 'Bloqueos visibles',
              [companyName]: executiveTotalDataClosure.blockers.length,
              [executiveCompareCompanyName]: executiveCompareCompanyTotalClosure.blockers.length,
              Brecha: executiveTotalDataClosure.blockers.length - executiveCompareCompanyTotalClosure.blockers.length
            },
            {
              Indicador: 'Estado comité',
              [companyName]: executiveTotalDataClosure.readiness.title,
              [executiveCompareCompanyName]: executiveCompareCompanyTotalClosure.readiness.title,
              Brecha: '-'
            }
          ]
        : [];
      const compareCompanyHistoryRows = executiveCompareCompanyHistoryRows.map((row) => ({
        Temporada: row.season,
        [companyName]: row.current ? Number(row.current.totalClosurePct.toFixed(2)) : 'Sin datos',
        [executiveCompareCompanyName || 'Empresa comparada']: row.compare ? Number(row.compare.totalClosurePct.toFixed(2)) : 'Sin datos',
        Brecha: row.gap !== null ? Number(row.gap.toFixed(2)) : 'Sin datos',
        'Estado actual': row.current?.readinessTitle || 'Sin datos',
        'Estado comparada': row.compare?.readinessTitle || 'Sin datos',
        'Bloqueos actual': row.current?.blockersCount ?? 'Sin datos',
        'Bloqueos comparada': row.compare?.blockersCount ?? 'Sin datos',
        Lider: row.leader
      }));
      const trendCompanyRows = [
        {
          Empresa: companyName,
          Tendencia: executiveCurrentCompanyTrend.tone.label,
          'Ventana reciente': executiveCurrentCompanyTrend.recentWindowLabel,
          'Promedio reciente': Number(executiveCurrentCompanyTrend.recentAvg.toFixed(2)),
          'Ventana previa': executiveCurrentCompanyTrend.previousWindowLabel,
          'Promedio previo': Number(executiveCurrentCompanyTrend.previousAvg.toFixed(2)),
          'Delta ventana': Number(executiveCurrentCompanyTrend.delta.toFixed(2)),
          'Última temporada': executiveCurrentCompanyTrend.latest?.season || 'Sin datos',
          'Último cierre': executiveCurrentCompanyTrend.latest ? Number(executiveCurrentCompanyTrend.latest.totalClosurePct.toFixed(2)) : 'Sin datos',
          Lectura: executiveCurrentCompanyTrend.narrative
        },
        ...(executiveCompareCompanyTrend ? [{
          Empresa: executiveCompareCompanyName,
          Tendencia: executiveCompareCompanyTrend.tone.label,
          'Ventana reciente': executiveCompareCompanyTrend.recentWindowLabel,
          'Promedio reciente': Number(executiveCompareCompanyTrend.recentAvg.toFixed(2)),
          'Ventana previa': executiveCompareCompanyTrend.previousWindowLabel,
          'Promedio previo': Number(executiveCompareCompanyTrend.previousAvg.toFixed(2)),
          'Delta ventana': Number(executiveCompareCompanyTrend.delta.toFixed(2)),
          'Última temporada': executiveCompareCompanyTrend.latest?.season || 'Sin datos',
          'Último cierre': executiveCompareCompanyTrend.latest ? Number(executiveCompareCompanyTrend.latest.totalClosurePct.toFixed(2)) : 'Sin datos',
          Lectura: executiveCompareCompanyTrend.narrative
        }] : []),
        ...(executiveTrendComparisonInsights ? [{
          Empresa: 'Comparación',
          Tendencia: executiveTrendComparisonInsights.leader,
          'Ventana reciente': executiveCurrentCompanyTrend.recentWindowLabel,
          'Promedio reciente': Number(executiveCurrentCompanyTrend.recentAvg.toFixed(2)),
          'Ventana previa': executiveCompareCompanyTrend?.recentWindowLabel || 'Sin base',
          'Promedio previo': executiveCompareCompanyTrend ? Number(executiveCompareCompanyTrend.recentAvg.toFixed(2)) : 'Sin datos',
          'Delta ventana': Number(executiveTrendComparisonInsights.deltaGap.toFixed(2)),
          'Última temporada': selectedSeason,
          'Último cierre': '-',
          Lectura: executiveTrendComparisonInsights.narrative
        }] : [])
      ];

      await exportWorkbookToXlsx({
        filename: `Reporte_Ejecutivo_${companySlug}_${selectedSeason}${executiveFieldFilter !== 'all' ? `_campo_${executiveFieldFilter}` : ''}.xlsx`,
        sheets: [
          { name: 'Resumen Directorio', rows: boardRows },
          { name: 'Resumen Mensual', rows: summaryRows },
          { name: 'Campos', rows: fieldRows },
          { name: 'Sectores', rows: sectorRows },
          { name: 'Historico Temporadas', rows: historicalRows },
          { name: 'Top Campos', rows: topFieldsRows },
          { name: 'Top Sectores', rows: topSectorsRows },
          { name: 'Alertas', rows: alertRows },
          { name: 'Cierre Total', rows: totalDataClosureRows },
          ...(recommendationRows.length > 0 ? [{ name: 'Recomendacion Ejecutiva', rows: recommendationRows }] : []),
          ...(rankingRows.length > 0 ? [{ name: 'Ranking Empresas', rows: rankingRows }] : []),
          ...(totalDataBlockerRows.length > 0 ? [{ name: 'Bloqueos Dato', rows: totalDataBlockerRows }] : []),
          ...(compareCompanyRows.length > 0 ? [{ name: 'Comparacion Empresas', rows: compareCompanyRows }] : []),
          ...(compareCompanyHistoryRows.length > 0 ? [{ name: 'Historial Empresas', rows: compareCompanyHistoryRows }] : []),
          ...(trendCompanyRows.length > 0 ? [{ name: 'Tendencia Empresas', rows: trendCompanyRows }] : []),
          ...(trendWarningRows.length > 0 ? [{ name: 'Alerta Tendencia', rows: trendWarningRows }] : []),
          ...(exportWarningHistoryRows.length > 0 ? [{ name: 'Bitacora Exportaciones', rows: exportWarningHistoryRows }] : []),
          ...(historicalClosureRows.length > 0 ? [{ name: 'Historial Cierre', rows: historicalClosureRows }] : []),
          ...(economicClosureRows.length > 0 ? [{ name: 'Cierre Economico', rows: economicClosureRows }] : []),
          ...(economicFocusRows.length > 0 ? [{ name: 'Focos Economicos', rows: economicFocusRows }] : []),
          ...(auditSummaryRows.length > 0 ? [{ name: 'Auditoria Costos', rows: auditSummaryRows }] : []),
          ...(auditDetailRows.length > 0 ? [{ name: 'Focos Revision', rows: auditDetailRows }] : []),
          ...(comparisonRows.length > 0 ? [
            { name: 'Comparacion Campos', rows: comparisonRows },
            { name: 'Campos Mes a Mes', rows: comparisonMonthlyRows }
          ] : [])
        ]
      });
    } catch (error: any) {
      toast.error(`No se pudo exportar el reporte ejecutivo: ${error?.message || 'intenta nuevamente.'}`);
    }
  };

  const refreshProductionRecords = useCallback(async () => {
    if (!selectedCompany?.id) return;
    try {
      const rows = await loadProductionRecords({ companyId: selectedCompany.id });
      setRawProductionRecords(rows || []);
    } catch {
      toast.error('No se pudo refrescar la producción formal.');
    }
  }, [selectedCompany?.id]);

  const openCreateProductionModal = () => {
    setEditingProductionRecord({});
    setShowProductionModal(true);
  };

  const openEditProductionModal = (row: ProductionRecord) => {
    setEditingProductionRecord({
      id: row.id,
      sector_id: row.sector_id,
      kg_produced: Number(row.kg_produced || 0),
      price_per_kg: Number(row.price_per_kg || 0)
    });
    setShowProductionModal(true);
  };

  const handleSaveProductionRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany?.id) return;
    if (!editingProductionRecord.sector_id) {
      toast.error('Debes seleccionar un sector.');
      return;
    }

    setSavingProductionRecord(true);
    try {
      await upsertProductionRecord({
        productionRecordId: editingProductionRecord.id || null,
        payload: {
          company_id: selectedCompany.id,
          sector_id: editingProductionRecord.sector_id,
          season_year: selectedSeasonStartYear,
          kg_produced: Number(editingProductionRecord.kg_produced || 0),
          price_per_kg: Number(editingProductionRecord.price_per_kg || 0)
        }
      });

      await Promise.all([
        refreshProductionRecords(),
        loadAgriculturalMarginRows({ companyId: selectedCompany.id }).then((rows) => setRawMarginRows(rows || []))
      ]);

      setShowProductionModal(false);
      setEditingProductionRecord({});
      toast.success('Producción formal guardada.');
    } catch (error: any) {
      toast.error(`No se pudo guardar la producción: ${error?.message || 'intenta nuevamente.'}`);
    } finally {
      setSavingProductionRecord(false);
    }
  };

  const handleDeleteProductionRecord = async (productionRecordId: string) => {
    if (!selectedCompany?.id) return;
    if (!window.confirm('¿Seguro que quieres eliminar este registro de producción?')) return;

    try {
      await deleteProductionRecord({ productionRecordId });
      await Promise.all([
        refreshProductionRecords(),
        loadAgriculturalMarginRows({ companyId: selectedCompany.id }).then((rows) => setRawMarginRows(rows || []))
      ]);
      toast.success('Registro de producción eliminado.');
    } catch (error: any) {
      toast.error(`No se pudo eliminar la producción: ${error?.message || 'intenta nuevamente.'}`);
    }
  };

  const startPresentation = () => {
    setPresentationMode(true);
    setCurrentSlide(0);
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(() => toast.error('No se pudo activar pantalla completa.'));
    }
  };

  const exitPresentation = () => {
    setPresentationMode(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => toast.error('No se pudo salir de pantalla completa.'));
    }
  };

  // Process data whenever raw data or selected season changes
  const processReports = useCallback(() => {
    processReportsImpl();
  }, [
    rawFields,
    rawApplications,
    rawCostMovements,
    rawInvoices,
    rawProducts,
    incomeEntries,
    selectedSeason,
    usdExchangeRate,
    distributeGeneralCosts
  ]);

  useEffect(() => {
    // Only process if we have sectors/fields loaded, otherwise wait
    processReports();
  }, [rawFields, rawApplications, rawCostMovements, rawInvoices, rawProducts, rawMarginRows, incomeEntries, selectedSeason, processReports]);

  async function loadRawDataImpl() {
    if (!selectedCompany) return;
    const companyId = selectedCompany.id;
    const loadSeq = ++reportLoadSeqRef.current;
    setLoading(true);
    try {
      const [reportsResult, marginResult, productionResult] = await Promise.allSettled([
        loadReportsRawData({ companyId }),
        loadAgriculturalMarginRows({ companyId }),
        loadProductionRecords({ companyId })
      ]);

      if (reportsResult.status !== 'fulfilled') {
        throw reportsResult.reason;
      }

      const res = reportsResult.value;
      if (reportLoadSeqRef.current !== loadSeq || selectedCompany?.id !== companyId) return;
      setRawFields(res.fields || []);
      setRawApplications(res.applications || []);
      setRawCostMovements((res as any).costMovements || []);
      setRawLabor(res.labor || []);
      setRawWorkerCosts(res.workerCosts || []);
      setRawFuel(res.fuel || []);
      setRawFuelConsumption(res.fuelConsumption || []);
      setRawMachinery(res.machinery || []);
      setRawIrrigation(res.irrigation || []);
      setRawGeneralCosts(res.generalCosts || []);
      setIncomeEntries(res.incomeEntries || []);
      setRawInvoices(res.invoices || []);
      setRawProducts((res as any).products || []);
      setRawMarginRows(marginResult.status === 'fulfilled' ? (marginResult.value || []) : []);
      setRawProductionRecords(productionResult.status === 'fulfilled' ? (productionResult.value || []) : []);

      setAvailableSeasons(res.availableSeasons || []);
      if (res.availableSeasons && res.availableSeasons.length > 0 && !res.availableSeasons.includes(selectedSeason)) {
        setSelectedSeason(res.availableSeasons[0]);
      }

    } catch {
      if (reportLoadSeqRef.current !== loadSeq || selectedCompany?.id !== companyId) return;
      setRawFields([]);
      setRawApplications([]);
      setRawCostMovements([]);
      setRawLabor([]);
      setRawWorkerCosts([]);
      setRawFuel([]);
      setRawFuelConsumption([]);
      setRawMachinery([]);
      setRawIrrigation([]);
      setRawGeneralCosts([]);
      setIncomeEntries([]);
      setRawInvoices([]);
      setRawProducts([]);
      setRawMarginRows([]);
      setRawProductionRecords([]);
      setAvailableSeasons([getSeasonFromDate(new Date())]);
      setReportData([]);
      setMonthlyExpenses([]);
      setCategoryExpenses([]);
      setPendingInvoices([]);
      setChemicalProducts([]);
      setDetailedReport([]);
      setComparativeData([]);
      toast.error('Error al cargar datos de reportes.');
    } finally {
      if (reportLoadSeqRef.current === loadSeq) {
        setLoading(false);
      }
    }
  }

  function processReportsImpl() {
    processApplicationReports(); // This is effectively the "General Cost Report" now
    processFinancialReports();
    processDetailedReport();
  }

  const processDetailedReport = () => {
    // Filter invoices by selected season
    const filteredInvoices = rawInvoices.filter(inv => {
      if (!inv.invoice_date) return false;
      return isDateInSeason(inv.invoice_date, selectedSeason);
    });

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const monthsMap = new Map<number, DetailedMonth>();

    // Initialize months
    monthNames.forEach((name, index) => {
        monthsMap.set(index, {
            monthName: name,
            monthIndex: index,
            total: 0,
            categories: []
        });
    });

    filteredInvoices.forEach(inv => {
        const date = new Date(inv.invoice_date);
        const monthIndex = date.getMonth();
        const monthData = monthsMap.get(monthIndex);

        if (monthData) {
            monthData.total += Number(inv.total_amount);

            // Group by category within invoice items
            
            if (inv.invoice_items && inv.invoice_items.length > 0) {
                inv.invoice_items.forEach((item: any) => {
                    const catName = item.category || 'Sin Categoría';
                    let category = monthData.categories.find(c => c.name === catName);
                    
                    if (!category) {
                        category = { name: catName, total: 0, items: [] };
                        monthData.categories.push(category);
                    }

                    category.total += Number(item.total_price);
                    category.items.push({
                        date: inv.invoice_date,
                        supplier: inv.supplier,
                        invoiceNumber: inv.invoice_number,
                        description: item.products?.name || 'Item',
                        total: Number(item.total_price)
                    });
                });
            } else {
                // Fallback for invoice without items (treat as whole)
                const catName = 'Sin Categoría';
                let category = monthData.categories.find(c => c.name === catName);
                if (!category) {
                    category = { name: catName, total: 0, items: [] };
                    monthData.categories.push(category);
                }
                category.total += Number(inv.total_amount);
                category.items.push({
                    date: inv.invoice_date,
                    supplier: inv.supplier,
                    invoiceNumber: inv.invoice_number,
                    description: 'Factura sin detalle',
                    total: Number(inv.total_amount)
                });
            }
        }
    });

    // Clean up empty months and sort categories
    const result = Array.from(monthsMap.values())
        .filter(m => m.total > 0)
        .map(m => ({
            ...m,
            categories: m.categories.sort((a, b) => b.total - a.total)
        }));

    setDetailedReport(result);
  };

  const processApplicationReports = () => {
    if (!rawFields.length) {
      setReportData([]);
      return;
    }

    // Calculate Average Fuel Prices (Diesel vs Gasoline) for fallback
    let totalDieselLiters = 0;
    let totalDieselCost = 0;
    let totalGasLiters = 0;
    let totalGasCost = 0;

    rawInvoices.forEach(inv => {
        inv.invoice_items?.forEach((item: any) => {
            const cat = (item.category || item.products?.category || '').toLowerCase().trim();
            const productName = (item.products?.name || '').toLowerCase();
            const unit = (item.products?.unit || '').toLowerCase().trim();
            
            // Skip non-fuel units
            const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];
            if (invalidUnits.includes(unit)) return;

            const docType = (inv.document_type || '').toLowerCase();
            const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
            const qty = Number(item.quantity || 0);
            const price = Number(item.total_price || 0);
            
            const finalQty = isNC ? -Math.abs(qty) : qty;
            const finalPrice = isNC ? -Math.abs(price) : price;

            const isDiesel = ['petroleo', 'diesel'].some(t => cat.includes(t) || productName.includes(t));
            const isGasoline = ['bencina', 'gasolina', 'combustible'].some(t => cat.includes(t) || productName.includes(t));

            // Logic to separate Diesel from Gasoline (Gasoline takes precedence if ambiguous "Combustible" unless "Diesel" is explicit)
            if (isDiesel && !productName.includes('bencina') && !productName.includes('gasolina')) {
                totalDieselLiters += finalQty;
                totalDieselCost += finalPrice;
            } else if (isGasoline) {
                totalGasLiters += finalQty;
                totalGasCost += finalPrice;
            }
        });
    });

    // Filter apps by season
    const filteredApps = rawApplications.filter(app => {
      if (!app.application_date) return false;
      return isDateInSeason(app.application_date, selectedSeason);
    });

    const costMovements = rawCostMovements.filter((movement) => movement.season === selectedSeason);
    const sectorCostSummary = aggregateCostMovementsBySector(costMovements);
    const marginRowsBySector = new Map(
      rawMarginRows
        .filter((row) => row.season === selectedSeason)
        .map((row) => [String(row.sector_id), row])
    );

    const data: ReportData[] = [];

    rawFields.forEach(field => {
      field.sectors?.forEach((sector: any) => {
        // Costs
        const sectorApps = filteredApps.filter(app => app.sector_id === sector.id);
        const sectorSummary = sectorCostSummary.get(String(sector.id));
        const appCost = Number(sectorSummary?.byCategory?.Aplicaciones || 0);
        const laborCost = Number(sectorSummary?.byCategory?.Labores || 0);
        const labor_cosecha_cost = Number(sectorSummary?.bySubCategory?.['Labores:Cosecha'] || 0);
        const labor_poda_cost = Number(sectorSummary?.bySubCategory?.['Labores:Poda'] || 0);
        const labor_raleo_cost = Number(sectorSummary?.bySubCategory?.['Labores:Raleo'] || 0);
        const labor_otros_cost = Number(sectorSummary?.bySubCategory?.['Labores:Otros'] || 0);
        const workerCost = Number(sectorSummary?.byCategory?.Trabajadores || 0);
        const fuelCostDiesel = Number(sectorSummary?.bySubCategory?.['Combustible:Diesel'] || 0);
        const fuelCostGasoline = Number(sectorSummary?.bySubCategory?.['Combustible:Gasolina'] || 0);
        const fuelCost = Number(sectorSummary?.byCategory?.Combustible || 0);
        const machineryCost = Number(sectorSummary?.byCategory?.Maquinaria || 0);
        const irrigationCost = Number(sectorSummary?.byCategory?.Riego || 0);
        const generalCost = Number(sectorSummary?.byCategory?.Generales || 0);

        // For General Report: Total Cost = Apps + Labor + Workers + Fuel + Machinery + Irrigation + General
        const marginRow = marginRowsBySector.get(String(sector.id));
        const totalCostGeneral = marginRow
          ? Number(marginRow.total_cost || 0)
          : Number(sectorSummary?.total || 0);
        const totalCostAppsOnly = appCost;
        
        const hectares = Number(sector.hectares);

        // Production from Income Entries
        const getExportPct = (i: any) => Math.max(0, Math.min(100, Number(i.export_percentage ?? 0)));
        const getExportKg = (i: any) => Number(i.quantity_kg || 0) * (getExportPct(i) / 100);
        const calcEntryUsd = (i: any, kg: number) => {
          const byField = Number(i.amount_usd || 0);
          if (byField > 0) return byField;
          return kg * Number(i.price_per_kg || 0);
        };

        const sectorSalesExport = incomeEntries.filter(i =>
          i.sector_id === sector.id &&
          i.category === 'Venta Fruta' &&
          i.season === selectedSeason
        );
        const sectorSalesJugo = incomeEntries.filter(i =>
          i.sector_id === sector.id &&
          i.category === 'Venta Fruta Jugo' &&
          i.season === selectedSeason
        );

        const kgSentExport = sectorSalesExport.reduce((sum, i) => sum + Number(i.quantity_kg || 0), 0);
        const kgExport = sectorSalesExport.reduce((sum, i) => sum + getExportKg(i), 0);
        const usdExport = sectorSalesExport.reduce((sum, i) => sum + calcEntryUsd(i, getExportKg(i)), 0);
        const priceExport = kgExport > 0 ? usdExport / kgExport : 0;

        const kgJugo = sectorSalesJugo.reduce((sum, i) => sum + Number(i.quantity_kg || 0), 0);
        const usdJugo = sectorSalesJugo.reduce((sum, i) => sum + calcEntryUsd(i, Number(i.quantity_kg || 0)), 0);
        const priceJugo = kgJugo > 0 ? usdJugo / kgJugo : 0;

        const kgProduced = kgSentExport + kgJugo;
        const totalIncomeUsd = usdExport + usdJugo;
        const kgSold = kgExport + kgJugo;
        const pricePerKg = kgSold > 0 ? totalIncomeUsd / kgSold : 0;
        const finalKgProduced = marginRow ? Number(marginRow.kg_produced || 0) : kgProduced;
        const finalKgSold = marginRow ? Number(marginRow.kg_sold || 0) : kgSold;
        const finalKgExport = marginRow ? Number(marginRow.kg_export || 0) : kgExport;
        const finalUsdExport = marginRow ? Number(marginRow.income_usd_export || 0) : usdExport;
        const finalPriceExport = marginRow ? Number(marginRow.price_export_usd_per_kg || 0) : priceExport;
        const finalKgJugo = marginRow ? Number(marginRow.kg_juice || 0) : kgJugo;
        const finalUsdJugo = marginRow ? Number(marginRow.income_usd_juice || 0) : usdJugo;
        const finalPriceJugo = marginRow ? Number(marginRow.price_juice_usd_per_kg || 0) : priceJugo;
        const finalPricePerKg = marginRow ? Number(marginRow.income_price_usd_per_kg || 0) : pricePerKg;
        const finalIncomeClp = marginRow ? Number(marginRow.total_income_clp || 0) : (kgSold * pricePerKg * (usdExchangeRate || 1));
        const finalCostPerHa = marginRow
          ? Number(marginRow.cost_per_ha || 0)
          : (hectares > 0 ? totalCostGeneral / hectares : 0);
        const finalCostPerKg = marginRow
          ? Number(marginRow.cost_per_kg || 0)
          : (finalKgProduced > 0 ? totalCostGeneral / finalKgProduced : 0);
        const finalProfitClp = marginRow ? Number(marginRow.profit_clp || 0) : (finalIncomeClp - totalCostGeneral);
        const finalMarginPct = marginRow
          ? Number(marginRow.margin_pct || 0)
          : (finalIncomeClp > 0 ? (finalProfitClp / finalIncomeClp) * 100 : 0);
        
        const budgetPerHa = Number(sector.budget) || 0;
        
        data.push({
          field_name: field.name,
          sector_name: sector.name,
          sector_id: sector.id,
          fruit_type: String((field as any).fruit_type || ''),
          hectares: hectares,
          total_cost: totalCostGeneral, // Default for General Table
          cost_per_ha: finalCostPerHa,
          cost_per_kg: finalCostPerKg,
          application_count: sectorApps.length,
          kg_produced: finalKgProduced,
          kg_sold: finalKgSold,
          price_per_kg: finalPricePerKg,
          kg_export: finalKgExport,
          price_export: finalPriceExport,
          income_usd_export: finalUsdExport,
          kg_jugo: finalKgJugo,
          price_jugo: finalPriceJugo,
          income_usd_jugo: finalUsdJugo,
          budget_per_ha: budgetPerHa,
          total_budget: budgetPerHa * hectares,
          income_estimated: finalIncomeClp,
          production_source: marginRow?.production_source || 'income_entries',
          has_production_record: Boolean(marginRow?.has_production_record),
          profit_clp: finalProfitClp,
          margin_pct: finalMarginPct,
          // Specific Costs
          app_cost_only: totalCostAppsOnly,
          app_cost_per_ha: hectares > 0 ? totalCostAppsOnly / hectares : 0,
          labor_cost: laborCost,
          labor_cosecha_cost,
          labor_poda_cost,
          labor_raleo_cost,
          labor_otros_cost,
          worker_cost: workerCost,
          fuel_cost: fuelCost,
          fuel_cost_diesel: fuelCostDiesel,
          fuel_cost_gasoline: fuelCostGasoline,
          machinery_cost: machineryCost,
          irrigation_cost: irrigationCost,
          general_cost: generalCost
        });
      });
    });

    setReportData(data);
  };

  const processFinancialReports = () => {
    // Current Season Invoices
    const filteredInvoices = rawInvoices.filter(inv => {
      try {
        if (!inv.invoice_date) return false;
        return isDateInSeason(inv.invoice_date, selectedSeason);
      } catch {
        return false;
      }
    });

    // Previous Season Invoices
    const [startYearStr] = selectedSeason.split('-');
    const startYear = parseInt(startYearStr);
    const prevSeason = `${startYear - 1}-${startYear}`;
    
    const prevInvoices = rawInvoices.filter(inv => {
      try {
        if (!inv.invoice_date) return false;
        return isDateInSeason(inv.invoice_date, prevSeason);
      } catch {
        return false;
      }
    });

    // 1. Monthly Expenses (Current Season)
    const monthlyData = new Map<string, number>();
    const compData = new Map<string, { current: number, prev: number }>();
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    
    // Generate keys for the season
    // May(4) to Dec(11) of startYear
    for (let m = 4; m <= 11; m++) {
        monthlyData.set(`${monthNames[m]} ${startYear}`, 0);
        compData.set(monthNames[m], { current: 0, prev: 0 });
    }
    // Jan(0) to Apr(3) of startYear + 1
    for (let m = 0; m <= 3; m++) {
        monthlyData.set(`${monthNames[m]} ${startYear + 1}`, 0);
        compData.set(monthNames[m], { current: 0, prev: 0 });
    }

    const filteredWorkerCostsCurrent = rawCostMovements.filter((movement) =>
      movement.category === 'Trabajadores' && movement.season === selectedSeason
    );

    const filteredWorkerCostsPrev = rawCostMovements.filter((movement) =>
      movement.category === 'Trabajadores' && movement.season === prevSeason
    );

    filteredInvoices.forEach(inv => {
      try {
        if (!inv.invoice_date) return;
        let date = new Date(inv.invoice_date + 'T12:00:00');
        if (isNaN(date.getTime())) {
          const parts = inv.invoice_date.split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }

        if (!isNaN(date.getTime())) {
          const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
          const mKey = monthNames[date.getMonth()];
          const amount = Number(inv.total_amount) || 0;
          
          if (monthlyData.has(key)) {
            monthlyData.set(key, (monthlyData.get(key) || 0) + amount);
          }
          if (compData.has(mKey)) {
            compData.get(mKey)!.current += amount;
          }
        }
      } catch (_e) { void _e; }
    });

    filteredWorkerCostsCurrent.forEach((w) => {
      try {
        let date = new Date(`${w.date}T12:00:00`);
        if (isNaN(date.getTime())) {
          const parts = String(w.date).split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }
        if (!isNaN(date.getTime())) {
          const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
          const mKey = monthNames[date.getMonth()];
          const amount = Number(w.amount || 0);

          if (monthlyData.has(key)) {
            monthlyData.set(key, (monthlyData.get(key) || 0) + amount);
          }
          if (compData.has(mKey)) {
            compData.get(mKey)!.current += amount;
          }
        }
      } catch (_e) { void _e; }
    });

    prevInvoices.forEach(inv => {
      try {
        if (!inv.invoice_date) return;
        let date = new Date(inv.invoice_date + 'T12:00:00');
        if (isNaN(date.getTime())) {
          const parts = inv.invoice_date.split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }

        if (!isNaN(date.getTime())) {
          const mKey = monthNames[date.getMonth()];
          const amount = Number(inv.total_amount) || 0;
          
          if (compData.has(mKey)) {
            compData.get(mKey)!.prev += amount;
          }
        }
      } catch (_e) { void _e; }
    });

    filteredWorkerCostsPrev.forEach((w) => {
      try {
        let date = new Date(`${w.date}T12:00:00`);
        if (isNaN(date.getTime())) {
          const parts = String(w.date).split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }
        if (!isNaN(date.getTime())) {
          const mKey = monthNames[date.getMonth()];
          const amount = Number(w.amount || 0);

          if (compData.has(mKey)) {
            compData.get(mKey)!.prev += amount;
          }
        }
      } catch (_e) { void _e; }
    });

    setMonthlyExpenses(Array.from(monthlyData.entries()).map(([month, total]) => ({ month, total })));
    setComparativeData(Array.from(compData.entries()).map(([month, data]) => ({ month, current: data.current, prev: data.prev })));

    // 2. Category Expenses
    const catData = new Map<string, number>();
    filteredInvoices.forEach(inv => {
      inv.invoice_items?.forEach((item: any) => {
        const cat = item.category || 'Sin Categoría';
        catData.set(cat, (catData.get(cat) || 0) + Number(item.total_price));
      });
    });

    const totalPlantWorkers = filteredWorkerCostsCurrent.reduce((sum: number, w: any) => sum + (Number(w.amount) || 0), 0);
    if (Math.abs(totalPlantWorkers) > 0.0001) {
      const cat = 'Empleados de Planta';
      catData.set(cat, (catData.get(cat) || 0) + totalPlantWorkers);
    }

    setCategoryExpenses(Array.from(catData.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total));
      
    // 5. Chemical Products Report
    const prodMap = new Map<string, ProductExpense>();
    
    filteredInvoices.forEach(inv => {
      inv.invoice_items?.forEach((item: any) => {
        // Normalize category check (case insensitive or specific list)
        const cat = item.category || '';
        const isChemical = CHEMICAL_CATEGORIES.some(c => cat.toLowerCase().includes(c.toLowerCase()));
        
        if (isChemical && item.products) {
           const productName = item.products.name;
           const current = prodMap.get(productName) || {
             name: productName,
             category: cat,
             total_quantity: 0,
             total_cost: 0,
             avg_price: 0
           };
           
           current.total_quantity += Number(item.quantity) || 0;
           current.total_cost += Number(item.total_price) || 0;
           prodMap.set(productName, current);
        }
      });
    });
    
    const chemicals = Array.from(prodMap.values()).map(p => ({
      ...p,
      avg_price: p.total_quantity > 0 ? p.total_cost / p.total_quantity : 0
    })).sort((a, b) => b.total_cost - a.total_cost);
    
    setChemicalProducts(chemicals);


    // 3. Pending Invoices
    const today = new Date();
    const pending: PendingInvoice[] = rawInvoices
      .filter(inv => inv.status === 'Pendiente')
      .map(inv => {
        try {
          let dueDate = inv.due_date ? new Date(inv.due_date) : new Date(inv.invoice_date);
          if (isNaN(dueDate.getTime())) dueDate = new Date(); 
          const diffTime = today.getTime() - dueDate.getTime();
          const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Extract categories from invoice items
          const categories = Array.from(new Set(
              (inv.invoice_items || []).map((item: any) => item.category).filter(Boolean)
          )) as string[];

          return {
            id: inv.id,
            invoice_number: inv.invoice_number || 'S/N',
            supplier: inv.supplier || 'Desconocido',
            due_date: inv.due_date || inv.invoice_date || 'Sin fecha',
            total_amount: Number(inv.total_amount) || 0,
            days_overdue: daysOverdue,
            notes: inv.notes || '',
            categories
          };
        } catch { return null; }
      })
      .filter(Boolean) as PendingInvoice[];
      
    pending.sort((a, b) => b.days_overdue - a.days_overdue);
    setPendingInvoices(pending);
  };

  const handleGeneratePDF = () => {
    const doc = new jsPDF({ orientation: pdfOrientation });
    const title = getReportTitle();
    
    // Header
    doc.setFontSize(18);
    doc.text(`Reporte: ${title}`, 14, 20);
    doc.setFontSize(12);
        doc.text(`Empresa: ${companyName}`, 14, 28);
    doc.text(`Temporada: ${selectedSeason}`, 14, 34);
    
    let subHeader = '';
    
    // Customize subheader based on tab
    if (activeTab === 'detailed') {
        subHeader = 'Filtros: ';
        if (filterMonth !== 'all') {
            const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            subHeader += `Mes: ${monthNames[parseInt(filterMonth)]} `;
        }
        if (filterCategory !== 'all') {
            subHeader += `| Categoría: ${filterCategory}`;
        }
        if (filterMonth === 'all' && filterCategory === 'all') subHeader += 'Todos';
    } else if (activeTab === 'general' || activeTab === 'costs_ha') {
        subHeader = `Tipo de Cambio: ${formatCLP(usdExchangeRate)} CLP/USD`;
    }

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(subHeader, 14, 40);
    doc.setTextColor(0);

    let yPos = 50;

    // --- REPORT GENERATION LOGIC BASED ON ACTIVE TAB ---

    if (activeTab === 'executive') {
        doc.setFillColor(245, 243, 255);
        doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), 'F');
        doc.setFontSize(26);
        doc.setTextColor(88, 28, 135);
        doc.text('Reporte Ejecutivo', 14, 70);
        doc.setFontSize(16);
        doc.setTextColor(31, 41, 55);
        doc.text(companyName, 14, 85);
        doc.setFontSize(12);
        doc.text(`Temporada actual: ${selectedSeason}`, 14, 98);
        doc.text(`Temporada comparativa: ${previousExecutiveSeason}`, 14, 106);
        if (executiveFieldFilter !== 'all') {
          doc.text(`Campo filtrado: ${executiveFieldLabel}`, 14, 114);
          doc.text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 14, 122);
          doc.setFontSize(14);
          doc.text(`Gasto total: ${formatCLP(executiveViewData.kpis.totalSeasonCost)}`, 14, 140);
          doc.text(`Variación vs temporada anterior: ${formatCLP(executiveViewData.kpis.seasonVariation)} (${executiveViewData.kpis.seasonVariationPct.toFixed(1)}%)`, 14, 150);
        } else {
          doc.text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 14, 114);
          doc.setFontSize(14);
          doc.text(`Gasto total: ${formatCLP(executiveViewData.kpis.totalSeasonCost)}`, 14, 132);
          doc.text(`Variación vs temporada anterior: ${formatCLP(executiveViewData.kpis.seasonVariation)} (${executiveViewData.kpis.seasonVariationPct.toFixed(1)}%)`, 14, 142);
        }

        doc.addPage();
        doc.setFontSize(18);
        doc.setTextColor(0);
        doc.text(`Reporte: ${title}`, 14, 20);
        doc.setFontSize(12);
        doc.text(`Empresa: ${companyName}`, 14, 28);
        doc.text(`Temporada: ${selectedSeason}`, 14, 34);
        doc.text(`Comparativa: ${previousExecutiveSeason}`, 14, 40);
        if (executiveFieldFilter !== 'all') {
          doc.text(`Campo: ${executiveFieldLabel}`, 14, 46);
          yPos = 56;
        } else {
          yPos = 50;
        }

        autoTable(doc, {
          startY: yPos,
          head: [['Resumen para Directorio', 'Detalle']],
          body: [
            ['Campo visible', executiveFieldLabel],
            ['Orden campos', EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveFieldSortBy)?.label || executiveFieldSortBy],
            ['Orden sectores', EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveSectorSortBy)?.label || executiveSectorSortBy],
            ['Comparacion campos', executiveFieldComparison ? `${executiveFieldComparison.fieldA.fieldName} vs ${executiveFieldComparison.fieldB.fieldName}` : '-'],
            ['Alertas activas', String(executiveInsights.activeAlertCount)],
            ['Monto oficial', formatCLP(executiveAuditData.officialAmount)],
            ['Trazabilidad %', `${executiveAuditData.traceabilityPct.toFixed(1)}%`],
            ['Monto respaldo', formatCLP(executiveAuditData.backupAmount)],
            ['Monto revisión alta', formatCLP(executiveAuditData.highReviewAmount)],
            ['Ingreso total', formatCLP(executiveMarginData.totalIncome)],
            ['Utilidad neta', formatCLP(executiveMarginData.totalProfit)],
            ['Margen neto', `${executiveMarginData.marginPct.toFixed(1)}%`],
            ['Cobertura producción', `${executiveMarginData.productionCoveragePct.toFixed(1)}%`],
            ['Cierre económico', `${executiveEconomicClosureData.closurePct.toFixed(1)}%`],
            ['Sectores cerrados', `${executiveEconomicClosureData.closedRows.length} / ${executiveEconomicClosureData.visibleRows.length}`],
            ['Pendientes producción', String(executiveEconomicClosureData.pendingProductionRows.length)],
            ['Pendientes ingreso', String(executiveEconomicClosureData.pendingIncomeRows.length)],
            ['Cierre total dato', `${executiveTotalDataClosure.totalClosurePct.toFixed(1)}%`],
            ['Estado comité', executiveTotalDataClosure.readiness.title],
            ['Recomendación automática', executiveCurrentRecommendation.tone.title],
            ['Alerta tendencia', executiveTrendWarning?.shortLabel || 'Sin alerta'],
            ['Historial visible', `${executiveEconomicClosureHistoryRows.length} temporadas`],
            ['Hallazgo 1', executiveInsights.findings[0]?.description || '-'],
            ['Hallazgo 2', executiveInsights.findings[1]?.description || '-'],
            ['Hallazgo 3', executiveInsights.findings[2]?.description || '-'],
            ['Conclusión', executiveInsights.conclusion]
          ],
          theme: 'grid',
          headStyles: { fillColor: [67, 56, 202] },
          styles: { fontSize: 9 }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Indicador', 'Valor']],
          body: [
            ['Gasto total temporada', formatCLP(executiveViewData.kpis.totalSeasonCost)],
            ['Temporada anterior', formatCLP(executiveViewData.kpis.previousSeasonCost)],
            ['Variación temporada', formatCLP(executiveViewData.kpis.seasonVariation)],
            ['Variación temporada %', `${executiveViewData.kpis.seasonVariationPct.toFixed(1)}%`],
            ['Promedio mensual', formatCLP(executiveViewData.kpis.averageMonthlyCost)],
            ['Monto trazable', formatCLP(executiveAuditData.traceableAmount)],
            ['Monto no trazable', formatCLP(executiveAuditData.nonTraceableAmount)],
            ['Cierre económico %', `${executiveEconomicClosureData.closurePct.toFixed(1)}%`],
            ['Costo sin ingreso', formatCLP(executiveEconomicClosureData.costWithoutIncomeAmount)],
            ['Pendiente producción', formatCLP(executiveEconomicClosureData.pendingProductionAmount)],
            ['Pendiente ingreso', formatCLP(executiveEconomicClosureData.pendingIncomeCost)],
            ['Cierre total dato %', `${executiveTotalDataClosure.totalClosurePct.toFixed(1)}%`],
            ['Soporte oficial %', `${executiveTotalDataClosure.officialSupportPct.toFixed(1)}%`],
            ['Estado comité', executiveTotalDataClosure.readiness.title],
            ['Recomendación automática', executiveCurrentRecommendation.tone.title],
            ['Alerta tendencia', executiveTrendWarning?.shortLabel || 'Sin alerta'],
            ['Hectáreas reportadas', executiveViewData.kpis.totalHectares.toFixed(2)],
            ['Campo con mayor gasto', executiveViewData.kpis.topField ? `${executiveViewData.kpis.topField.fieldName} (${formatCLP(executiveViewData.kpis.topField.total)})` : '-'],
            ['Sector con mayor gasto', executiveViewData.kpis.topSector ? `${executiveViewData.kpis.topSector.sectorName} (${formatCLP(executiveViewData.kpis.topSector.total)})` : '-'],
            ['Mes más alto', executiveViewData.kpis.peakMonth ? `${executiveViewData.kpis.peakMonth.monthLabel} (${formatCLP(executiveViewData.kpis.peakMonth.total)})` : '-']
          ],
          theme: 'grid',
          headStyles: { fillColor: [88, 28, 135] }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        if (executiveTrendWarning) {
          autoTable(doc, {
            startY: yPos,
            head: [['Alerta preventiva de tendencia']],
            body: [
              [executiveTrendWarning.detail],
              [executiveTrendWarning.recommendation],
              [executiveTrendWarning.compareLine || 'Sin comparativo adicional para esta alerta.']
            ],
            theme: 'grid',
            headStyles: { fillColor: [217, 119, 6] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        autoTable(doc, {
          startY: yPos,
          head: [['Recomendacion ejecutiva', 'Detalle']],
          body: [
            ['Decisión', executiveCurrentRecommendation.tone.title],
            ['Resumen', executiveCurrentRecommendation.summary],
            ['Siguiente paso', executiveCurrentRecommendation.nextStep],
            ['Razón 1', executiveCurrentRecommendation.reasons[0] || '-'],
            ['Razón 2', executiveCurrentRecommendation.reasons[1] || '-'],
            ['Razón 3', executiveCurrentRecommendation.reasons[2] || '-'],
            ['Razón 4', executiveCurrentRecommendation.reasons[3] || '-']
          ],
          theme: 'grid',
          headStyles: { fillColor: [21, 128, 61] },
          styles: { fontSize: 8 }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Mes', 'Gasto actual', previousExecutiveSeason, 'Vs ant. CLP', 'Vs ant. %', 'Campo mayor gasto', 'Sector mayor gasto']],
          body: executiveViewData.monthlyRows.map((row) => [
            row.monthLabel,
            formatCLP(row.total),
            formatCLP(row.previousSeasonTotal),
            formatCLP(row.vsPreviousSeason),
            `${row.vsPreviousSeasonPct.toFixed(1)}%`,
            row.topFieldName,
            row.topSectorName
          ]),
          theme: 'striped',
          headStyles: { fillColor: [22, 101, 52] }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Alerta', 'Nivel', 'Impacto']],
          body: (executiveViewData.alerts.length > 0 ? executiveViewData.alerts : [{ title: 'Sin alertas relevantes', level: 'informativa', amount: 0 }]).map((alert) => [
            alert.title,
            alert.level,
            formatCLP(alert.amount)
          ]),
          theme: 'grid',
          headStyles: { fillColor: [185, 28, 28] }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        if (executiveFieldComparison) {
          if (yPos > 150) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Comparacion entre campos', 'Detalle']],
            body: executiveFieldComparison.comparisonRows.map((row) => [
              row.metric,
              `${executiveFieldComparison.fieldA.fieldName}: ${row.format === 'percent'
                ? `${row.fieldAValue.toFixed(1)}%`
                : row.format === 'number'
                  ? row.fieldAValue.toLocaleString('es-CL')
                  : row.format === 'currency_optional' && row.fieldAValue <= 0
                    ? '-'
                    : formatCLP(row.fieldAValue)
              }\n${executiveFieldComparison.fieldB.fieldName}: ${row.format === 'percent'
                ? `${row.fieldBValue.toFixed(1)}%`
                : row.format === 'number'
                  ? row.fieldBValue.toLocaleString('es-CL')
                  : row.format === 'currency_optional' && row.fieldBValue <= 0
                    ? '-'
                    : formatCLP(row.fieldBValue)
              }\nBrecha: ${row.format === 'percent'
                ? `${row.gap.toFixed(1)}%`
                : row.format === 'number'
                  ? row.gap.toLocaleString('es-CL')
                  : row.format === 'currency_optional' && Math.abs(row.gap) <= 0
                    ? '-'
                    : formatCLP(row.gap)
              }`
            ]),
            theme: 'grid',
            headStyles: { fillColor: [67, 56, 202] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        if (executiveAuditData.topDetailRows.length > 0) {
          if (yPos > 150) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Foco auditoría', 'Detalle', 'Monto']],
            body: executiveAuditData.topDetailRows.slice(0, 6).map((row) => [
              `${row.category} · ${row.audit_status}`,
              `${row.field_name || '-'} / ${row.sector_name || '-'}\n${row.movement_date} · ${row.review_priority}`,
              formatCLP(row.amount)
            ]),
            theme: 'grid',
            headStyles: { fillColor: [146, 64, 14] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        if (executiveEconomicClosureData.topFocusRows.length > 0) {
          if (yPos > 150) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Foco económico', 'Campo / Sector', 'Referencia']],
            body: executiveEconomicClosureData.topFocusRows.map((row) => [
              row.status,
              `${row.fieldName} / ${row.sectorName}`,
              row.unitLabel
            ]),
            theme: 'grid',
            headStyles: { fillColor: [79, 70, 229] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        if (executiveEconomicClosureHistoryRows.length > 0) {
          if (yPos > 140) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Temporada', 'Estado', 'Cierre %', 'Cerrados', 'Pend. prod.', 'Pend. ingreso', 'Costo sin ingreso']],
            body: executiveEconomicClosureHistoryRows.map((row) => [
              row.season,
              row.toneLabel,
              `${row.closurePct.toFixed(1)}%`,
              `${row.closedSectorCount}/${row.visibleSectorCount}`,
              String(row.pendingProductionCount),
              String(row.pendingIncomeCount),
              String(row.costWithoutIncomeCount)
            ]),
            theme: 'grid',
            headStyles: { fillColor: [8, 145, 178] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        if (executiveTotalDataClosure.blockers.length > 0) {
          if (yPos > 170) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Bloqueo de calidad del dato']],
            body: executiveTotalDataClosure.blockers.map((row) => [row]),
            theme: 'grid',
            headStyles: { fillColor: [185, 28, 28] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        if (executiveCompareCompanyTotalClosure) {
          if (yPos > 150) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Comparacion entre empresas', 'Actual', 'Comparada', 'Brecha actual - comparada']],
            body: [
              ...executiveCompareCompanyTotalClosureRows.map((row) => [
                row.metric,
                formatExecutiveCompareMetric(row.currentValue, row.format),
                formatExecutiveCompareMetric(row.compareValue, row.format),
                row.format === 'percent'
                  ? `${row.gap.toFixed(1)} pp`
                  : row.gap.toLocaleString('es-CL')
              ]),
              ['Estado comité', executiveTotalDataClosure.readiness.title, executiveCompareCompanyTotalClosure.readiness.title, '-'],
              ['Conclusión', companyName, executiveCompareCompanyName, executiveCompareCompanyInsights?.summaryLine || '-']
            ],
            theme: 'grid',
            headStyles: { fillColor: [88, 28, 135] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;

          if (executiveCompareCompanyRecommendation) {
            autoTable(doc, {
              startY: yPos,
              head: [['Recomendacion entre empresas', 'Actual', 'Comparada']],
              body: [
                ['Decisión', executiveCurrentRecommendation.tone.title, executiveCompareCompanyRecommendation.tone.title],
                ['Resumen', executiveCurrentRecommendation.summary, executiveCompareCompanyRecommendation.summary],
                ['Siguiente paso', executiveCurrentRecommendation.nextStep, executiveCompareCompanyRecommendation.nextStep]
              ],
              theme: 'grid',
              headStyles: { fillColor: [8, 145, 178] },
              styles: { fontSize: 8 }
            });

            yPos = (doc as any).lastAutoTable.finalY + 8;
          }

          if (executiveCompanyRankingComparison) {
            autoTable(doc, {
              startY: yPos,
              head: [['Ranking empresas', 'Puntaje', 'Cierre', 'Tendencia', 'Bloqueos', 'Nivel']],
              body: executiveCompanyRankingComparison.rows.map((row) => [
                row.companyLabel,
                row.score.toFixed(1),
                row.components.closure.toFixed(1),
                row.components.trend.toFixed(1),
                row.components.blockers.toFixed(1),
                row.tone.label
              ]),
              theme: 'grid',
              headStyles: { fillColor: [71, 85, 105] },
              styles: { fontSize: 8 }
            });

            yPos = (doc as any).lastAutoTable.finalY + 8;

            autoTable(doc, {
              startY: yPos,
              head: [['Lectura ranking', 'Detalle']],
              body: [
                ['Líder', executiveCompanyRankingComparison.leader],
                ['Brecha', `${Math.abs(executiveCompanyRankingComparison.gap).toFixed(1)} puntos`],
                ['Ponderación', 'Cierre total 60% · Tendencia 25% · Bloqueos 15%'],
                ['Conclusión', executiveCompanyRankingComparison.summaryLine]
              ],
              theme: 'grid',
              headStyles: { fillColor: [100, 116, 139] },
              styles: { fontSize: 8 }
            });

            yPos = (doc as any).lastAutoTable.finalY + 8;
          }
        }

        if (executiveCompareCompanyHistoryInsights && executiveCompareCompanyHistoryRows.length > 0) {
          if (yPos > 135) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Historial entre empresas', 'Actual', 'Comparada', 'Brecha', 'Lider']],
            body: executiveCompareCompanyHistoryRows.map((row) => [
              row.season,
              row.current ? `${row.current.totalClosurePct.toFixed(1)}% · ${row.current.readinessTitle}` : 'Sin datos',
              row.compare ? `${row.compare.totalClosurePct.toFixed(1)}% · ${row.compare.readinessTitle}` : 'Sin datos',
              row.gap === null ? 'Sin datos' : `${row.gap.toFixed(1)} pp`,
              row.leader
            ]),
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;
        }

        if (executiveExportWarningFilteredData.totalEvents > 0) {
          if (yPos > 135) {
            doc.addPage();
            yPos = 20;
          }

          autoTable(doc, {
            startY: yPos,
            head: [['Bitácora exportación advertida', 'Detalle']],
            body: [
              ['Eventos históricos', String(executiveExportWarningHistoryData.totalEvents)],
              ['Eventos visibles', String(executiveExportWarningFilteredData.totalEvents)],
              ['Filtros aplicados', executiveExportWarningFiltersLabel],
              ['Temporada actual', `${selectedSeason} · ${executiveExportWarningFilteredData.currentSeasonRows.length} eventos`],
              ['Última exportación', executiveExportWarningFilteredData.latestEvent ? `${executiveExportWarningFilteredData.latestEvent.export_format.toUpperCase()} · ${executiveExportWarningFilteredData.latestEvent.season} · ${executiveExportWarningFilteredData.latestEvent.readiness_title}` : 'Sin eventos'],
              ['Formato dominante', executiveExportWarningFilteredData.dominantFormat],
              ['Advertencia dominante', executiveExportWarningFilteredData.topWarningType ? `${formatExecutiveExportWarningType(executiveExportWarningFilteredData.topWarningType.type)} (${executiveExportWarningFilteredData.topWarningType.count})` : 'Sin advertencias frecuentes'],
              ['Temporada más expuesta', executiveExportWarningFilteredData.topSeason ? `${executiveExportWarningFilteredData.topSeason.season} (${executiveExportWarningFilteredData.topSeason.count})` : 'Sin temporadas'],
              ['Lectura', executiveExportWarningFilteredData.summaryLine]
            ],
            theme: 'grid',
            headStyles: { fillColor: [146, 64, 14] },
            styles: { fontSize: 8 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 8;

          if (executiveExportWarningFilteredData.recentRows.length > 0) {
            if (yPos > 150) {
              doc.addPage();
              yPos = 20;
            }

            autoTable(doc, {
              startY: yPos,
              head: [['Fecha', 'Temporada', 'Formato', 'Emisor', 'Advertencias', 'Campo']],
              body: executiveExportWarningFilteredData.recentRows.slice(0, 6).map((row) => [
                new Date(row.created_at).toLocaleDateString('es-CL'),
                row.season,
                row.export_format.toUpperCase(),
                formatExecutiveExportActor(row.created_by),
                (row.warning_types || []).map((item) => formatExecutiveExportWarningType(item)).join(', ') || 'Sin detalle',
                row.field_label || 'Todos los campos'
              ]),
              theme: 'grid',
              headStyles: { fillColor: [120, 53, 15] },
              styles: { fontSize: 8 }
            });

            yPos = (doc as any).lastAutoTable.finalY + 8;
          }
        }

        if (yPos > 150) {
          doc.addPage();
          yPos = 20;
        }

        autoTable(doc, {
          startY: yPos,
          head: [['Tendencia historica', 'Estado', 'Ventana reciente', 'Ventana previa', 'Delta']],
          body: [
            [
              companyName,
              executiveCurrentCompanyTrend.tone.label,
              `${executiveCurrentCompanyTrend.recentWindowLabel} · ${executiveCurrentCompanyTrend.recentAvg.toFixed(1)}%`,
              `${executiveCurrentCompanyTrend.previousWindowLabel} · ${executiveCurrentCompanyTrend.previousAvg.toFixed(1)}%`,
              `${executiveCurrentCompanyTrend.delta.toFixed(1)} pp`
            ],
            ...(executiveCompareCompanyTrend ? [[
              executiveCompareCompanyName,
              executiveCompareCompanyTrend.tone.label,
              `${executiveCompareCompanyTrend.recentWindowLabel} · ${executiveCompareCompanyTrend.recentAvg.toFixed(1)}%`,
              `${executiveCompareCompanyTrend.previousWindowLabel} · ${executiveCompareCompanyTrend.previousAvg.toFixed(1)}%`,
              `${executiveCompareCompanyTrend.delta.toFixed(1)} pp`
            ]] : []),
            ...(executiveTrendComparisonInsights ? [[
              'Comparación',
              executiveTrendComparisonInsights.leader,
              executiveCurrentCompanyTrend.recentWindowLabel,
              executiveCompareCompanyTrend?.recentWindowLabel || 'Sin base',
              `${executiveTrendComparisonInsights.deltaGap.toFixed(1)} pp`
            ]] : [])
          ],
          theme: 'grid',
          headStyles: { fillColor: [22, 163, 74] },
          styles: { fontSize: 8 }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        if (yPos > 160) {
          doc.addPage();
          yPos = 20;
        }

        autoTable(doc, {
          startY: yPos,
          head: [['Ranking', 'Campo', 'Total', previousExecutiveSeason, 'Variación %', 'Participación %']],
          body: executiveViewData.topFields.map((row, index) => [
            String(index + 1),
            row.fieldName,
            formatCLP(row.total),
            formatCLP(row.previousTotal),
            `${row.deltaPct.toFixed(1)}%`,
            `${row.sharePct.toFixed(1)}%`
          ]),
          theme: 'grid',
          headStyles: { fillColor: [30, 64, 175] }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Cierre ejecutivo']],
          body: [[executiveInsights.conclusion]],
          theme: 'grid',
          headStyles: { fillColor: [17, 24, 39] },
          styles: { fontSize: 9 }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: yPos,
          head: [[
            'Campo',
            ...executiveSeasonMonths.map((month) => month.shortLabel),
            'Total'
          ]],
          body: executiveViewData.fieldRows.map((row) => [
            row.fieldName,
            ...executiveSeasonMonths.map((month) => formatCLP(row.months[month.key] || 0)),
            formatCLP(row.total)
          ]),
          theme: 'grid',
          styles: { fontSize: 8 },
          headStyles: { fillColor: [30, 64, 175] }
        });

        yPos = (doc as any).lastAutoTable.finalY + 8;

        if (yPos > 160) {
          doc.addPage();
          yPos = 20;
        }

        autoTable(doc, {
          startY: yPos,
          head: [[
            'Campo',
            'Sector',
            ...executiveSeasonMonths.map((month) => month.shortLabel),
            'Total'
          ]],
          body: executiveViewData.sectorRows.map((row) => [
            row.fieldName,
            row.sectorName,
            ...executiveSeasonMonths.map((month) => formatCLP(row.months[month.key] || 0)),
            formatCLP(row.total)
          ]),
          theme: 'grid',
          styles: { fontSize: 7 },
          headStyles: { fillColor: [109, 40, 217] }
        });
    } else if (activeTab === 'general') {
        // GENERAL REPORT
        const tableBody = reportData.map(row => {
            const costUsd = row.total_cost / (usdExchangeRate || 1);
            const costPerHaUsd = row.cost_per_ha / (usdExchangeRate || 1);
            const costPerKgClp = (row.kg_produced || 0) > 0 ? row.total_cost / row.kg_produced! : 0;
            const costPerKgUsd = (row.kg_produced || 0) > 0 ? costUsd / row.kg_produced! : 0;

            return [
                `${row.sector_name}\n(${row.field_name})`,
                row.hectares.toString(),
                (row.kg_produced || 0).toLocaleString('es-CL'),
                formatCLP(row.labor_cost),
                formatCLP(row.worker_cost),
                formatCLP(row.app_cost_only),
                formatCLP(row.machinery_cost),
                formatCLP(row.irrigation_cost),
                formatCLP(row.fuel_cost),
                formatCLP(row.total_cost),
                `$${Math.round(costUsd).toLocaleString('en-US')}`,
                formatCLP(row.cost_per_ha),
                `$${Math.round(costPerHaUsd).toLocaleString('en-US')}`,
                costPerKgClp > 0 ? formatCLP(costPerKgClp) : '-',
                costPerKgUsd > 0 ? `$${costPerKgUsd.toFixed(2)}` : '-'
            ];
        });

        autoTable(doc, {
            startY: yPos,
            head: [['Sector/Campo', 'Has', 'Prod (Kg)', 'Mano Obra', 'Personal', 'Aplic.', 'Maq.', 'Riego', 'Comb.', 'Total (CLP)', 'Total (USD)', 'Costo/Ha (CLP)', 'Costo/Ha (USD)', 'Costo/Kg (CLP)', 'Costo/Kg (USD)']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 125, 50], fontSize: 7 }, // Green, smaller font
            styles: { fontSize: 7, cellPadding: 1 },
            columnStyles: {
                0: { cellWidth: 20 },
                1: { halign: 'right', cellWidth: 10 },
                2: { halign: 'right', cellWidth: 15 },
                3: { halign: 'right' },
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
                7: { halign: 'right' },
                8: { halign: 'right' },
                9: { halign: 'right', fontStyle: 'bold' },
                10: { halign: 'right' },
                11: { halign: 'right' },
                12: { halign: 'right' },
                13: { halign: 'right', fontStyle: 'bold' },
                14: { halign: 'right', fontStyle: 'bold' }
            }
        });

    } else if (activeTab === 'costs_ha') {
        const tableBody = reportData.map((row) => {
            const ha = row.hectares || 1;
            return [
                `${row.sector_name}\n(${row.field_name})`,
                row.hectares.toString(),
                formatCLP(row.app_cost_only / ha),
                formatCLP(row.labor_cost / ha),
                formatCLP(row.worker_cost / ha),
                formatCLP(row.machinery_cost / ha),
                formatCLP(row.irrigation_cost / ha),
                formatCLP(row.fuel_cost_diesel / ha),
                formatCLP(row.fuel_cost_gasoline / ha),
                formatCLP(row.general_cost / ha),
                formatCLP(row.cost_per_ha),
                formatCLP(row.total_cost)
            ];
        });

        const totalHas = reportData.reduce((sum, r) => sum + r.hectares, 0);
        if (reportData.length > 0 && totalHas > 0) {
            const totalApps = reportData.reduce((sum, r) => sum + r.app_cost_only, 0);
            const totalLabor = reportData.reduce((sum, r) => sum + r.labor_cost, 0);
            const totalWorker = reportData.reduce((sum, r) => sum + r.worker_cost, 0);
            const totalMachinery = reportData.reduce((sum, r) => sum + r.machinery_cost, 0);
            const totalIrrigation = reportData.reduce((sum, r) => sum + r.irrigation_cost, 0);
            const totalDiesel = reportData.reduce((sum, r) => sum + r.fuel_cost_diesel, 0);
            const totalGasoline = reportData.reduce((sum, r) => sum + r.fuel_cost_gasoline, 0);
            const totalGeneral = reportData.reduce((sum, r) => sum + r.general_cost, 0);
            const totalCost = reportData.reduce((sum, r) => sum + r.total_cost, 0);

            tableBody.push([
                'TOTAL GENERAL',
                totalHas.toString(),
                formatCLP(totalApps / totalHas),
                formatCLP(totalLabor / totalHas),
                formatCLP(totalWorker / totalHas),
                formatCLP(totalMachinery / totalHas),
                formatCLP(totalIrrigation / totalHas),
                formatCLP(totalDiesel / totalHas),
                formatCLP(totalGasoline / totalHas),
                formatCLP(totalGeneral / totalHas),
                formatCLP(totalCost / totalHas),
                formatCLP(totalCost)
            ]);
        }

        autoTable(doc, {
            startY: yPos,
            head: [['Sector/Campo', 'Has', 'Aplic/Ha', 'Mano Obra/Ha', 'Personal/Ha', 'Maq/Ha', 'Riego/Ha', 'Diésel/Ha', 'Bencina/Ha', 'Otros/Ha', 'Total/Ha', 'Total (CLP)']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 125, 50], fontSize: 8 },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                0: { cellWidth: 26 },
                1: { halign: 'right', cellWidth: 12 },
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
                7: { halign: 'right' },
                8: { halign: 'right' },
                9: { halign: 'right' },
                10: { halign: 'right', fontStyle: 'bold' },
                11: { halign: 'right', fontStyle: 'bold' }
            },
            didParseCell: function(data) {
                if (reportData.length > 0 && data.row.index === reportData.length) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [230, 230, 230];
                }
            }
        });

    } else if (activeTab === 'margin') {
        const { rows, totals } = getMarginRows();
        const tableBody = rows.map((r) => [
            `${r.sector_name}\n(${r.field_name})`,
            r.production_source === 'production_records' ? 'Registro' : r.production_source === 'income_entries' ? 'Ingreso' : 'Sin base',
            r.hectares.toString(),
            formatCLP(r.income),
            formatCLP(r.cost),
            formatCLP(r.profit),
            formatCLP(r.profit_per_ha),
            `${r.margin_pct.toFixed(1)}%`
        ]);

        if (rows.length > 0) {
            tableBody.push([
                'TOTAL GENERAL',
            '-',
                totals.totalHa.toString(),
                formatCLP(totals.totalIncome),
                formatCLP(totals.totalCost),
                formatCLP(totals.totalProfit),
                formatCLP(totals.totalProfitPerHa),
                `${totals.totalMarginPct.toFixed(1)}%`
            ]);
        }

        autoTable(doc, {
            startY: yPos,
            head: [['Sector/Campo', 'Base prod.', 'Has', 'Ingresos (CLP)', 'Costos (CLP)', 'Utilidad (CLP)', 'Utilidad/Ha', 'Margen %']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 125, 50], fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: {
                0: { cellWidth: 26 },
                1: { halign: 'right', cellWidth: 12 },
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right', fontStyle: 'bold' },
                5: { halign: 'right' },
                6: { halign: 'right', fontStyle: 'bold' }
            },
            didParseCell: function(data) {
                if (rows.length > 0 && data.row.index === rows.length) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [230, 230, 230];
                }
            }
        });

    } else if (activeTab === 'labors') {
        // LABORS BY SECTOR REPORT
        const tableHead = [['Sector', 'Has', 'Poda', 'Raleo', 'Cosecha', 'Otras', 'Personal', 'Total', 'Costo/Ha']];
        const tableBody = reportData.map(row => {
            const totalLabors = row.labor_poda_cost + row.labor_raleo_cost + row.labor_cosecha_cost + row.labor_otros_cost + row.worker_cost;
            return [
                `${row.sector_name} (${row.field_name})`,
                row.hectares.toString(),
                formatCLP(row.labor_poda_cost),
                formatCLP(row.labor_raleo_cost),
                formatCLP(row.labor_cosecha_cost),
                formatCLP(row.labor_otros_cost),
                formatCLP(row.worker_cost),
                formatCLP(totalLabors),
                formatCLP(totalLabors / (row.hectares || 1))
            ];
        });

        // Add Total Row
        if (reportData.length > 0) {
            const totalHas = reportData.reduce((sum, r) => sum + r.hectares, 0);
            const totalPoda = reportData.reduce((sum, r) => sum + r.labor_poda_cost, 0);
            const totalRaleo = reportData.reduce((sum, r) => sum + r.labor_raleo_cost, 0);
            const totalCosecha = reportData.reduce((sum, r) => sum + r.labor_cosecha_cost, 0);
            const totalOtros = reportData.reduce((sum, r) => sum + r.labor_otros_cost, 0);
            const totalWorker = reportData.reduce((sum, r) => sum + r.worker_cost, 0);
            const grandTotal = totalPoda + totalRaleo + totalCosecha + totalOtros + totalWorker;
            
            tableBody.push([
                'TOTAL GENERAL',
                totalHas.toString(),
                formatCLP(totalPoda),
                formatCLP(totalRaleo),
                formatCLP(totalCosecha),
                formatCLP(totalOtros),
                formatCLP(totalWorker),
                formatCLP(grandTotal),
                '-'
            ]);
        }

        autoTable(doc, {
            startY: yPos,
            head: tableHead,
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [46, 125, 50], fontSize: 8 },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                1: { halign: 'right' },
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
                7: { halign: 'right', fontStyle: 'bold' },
                8: { halign: 'right', fontStyle: 'bold' }
            },
            didParseCell: function(data) {
                // Style the last row (Total General)
                if (reportData.length > 0 && data.row.index === reportData.length) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [230, 230, 230];
                }
            }
        });

    } else if (activeTab === 'applications') {
        // APPLICATIONS / COST PER HA REPORT
        const tableBody = reportData.map(row => [
            row.field_name,
            row.sector_name,
            row.hectares.toString(),
            formatCLP(row.app_cost_only),
            formatCLP(row.app_cost_per_ha)
        ]);

        autoTable(doc, {
            startY: yPos,
            head: [['Campo', 'Sector', 'Hectáreas', 'Costo Total', 'Costo / Ha']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [46, 125, 50] },
            columnStyles: {
                3: { halign: 'right' },
                4: { halign: 'right', fontStyle: 'bold' }
            }
        });

    } else if (activeTab === 'monthly') {
        // PROFESSIONAL MONTHLY EXPENSES REPORT
        if (detailedReport && detailedReport.length > 0) {
            let totalSeason = 0;
            const pageWidth = doc.internal.pageSize.getWidth();
            
            detailedReport.forEach(month => {
                totalSeason += month.total;
                
                if (yPos > doc.internal.pageSize.getHeight() - 40) {
                    doc.addPage();
                    yPos = 20;
                }

                doc.setFontSize(14);
                doc.setTextColor(255, 255, 255);
                
                // Draw a nice banner for the month
                doc.setFillColor(136, 132, 216); // Purple brand color
                doc.rect(14, yPos - 6, pageWidth - 28, 10, 'F');
                doc.text(`Resumen ${month.monthName}`, 16, yPos + 1);
                
                // Right align total
                const totalText = `Total Mes: ${formatCLP(month.total)}`;
                const textWidth = doc.getTextWidth(totalText);
                doc.text(totalText, pageWidth - 16 - textWidth, yPos + 1);
                
                yPos += 10;
                
                // Now create a small table for categories in this month
                const catBody = month.categories
                    .sort((a, b) => b.total - a.total)
                    .map(c => [c.name, formatCLP(c.total)]);
                    
                autoTable(doc, {
                    startY: yPos,
                    head: [['Categoría de Gasto', 'Monto']],
                    body: catBody,
                    theme: 'grid',
                    headStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold' },
                    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
                    margin: { left: 14, right: 14 }
                });
                
                yPos = (doc as any).lastAutoTable.finalY + 15;
            });
            
            // Grand Total
            if (yPos > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); yPos = 20; }
            doc.setFontSize(16);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text(`TOTAL TEMPORADA: ${formatCLP(totalSeason)}`, 14, yPos);
            doc.setFont("helvetica", "normal");
            
        } else {
            // Fallback
            const tableBody = monthlyExpenses.map(m => [
                m.month,
                formatCLP(m.total)
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Mes', 'Total Gastado']],
                body: tableBody,
                theme: 'striped',
                headStyles: { fillColor: [136, 132, 216] }, // Purple
                columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
            });
        }

    } else if (activeTab === 'categories') {
        // CATEGORIES REPORT
        const tableBody = categoryExpenses.map(c => [
            c.category,
            formatCLP(c.total)
        ]);

        autoTable(doc, {
            startY: yPos,
            head: [['Categoría', 'Monto Total']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [136, 132, 216] },
            columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
        });

    } else if (activeTab === 'fuel_machines') {
        const { rows, totals } = getFuelMachinesRows();
        const tableBody = rows.map((r) => [
            r.machine_name,
            r.liters_diesel.toFixed(1),
            r.liters_gasoline.toFixed(1),
            r.liters_total.toFixed(1),
            formatCLP(r.cost_total),
            formatCLP(r.avg_price)
        ]);

        if (rows.length > 0) {
            tableBody.push([
                'TOTAL GENERAL',
                totals.liters_diesel.toFixed(1),
                totals.liters_gasoline.toFixed(1),
                totals.liters_total.toFixed(1),
                formatCLP(totals.cost_total),
                formatCLP(totals.avg_price)
            ]);
        }

        autoTable(doc, {
            startY: yPos,
            head: [['Máquina', 'L Diésel', 'L Bencina', 'L Total', 'Costo Total', 'CLP/L']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [136, 132, 216] },
            columnStyles: {
                1: { halign: 'right' },
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right', fontStyle: 'bold' },
                5: { halign: 'right' }
            },
            didParseCell: function(data) {
                if (rows.length > 0 && data.row.index === rows.length) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [230, 230, 230];
                }
            }
        });

    } else if (activeTab === 'chemicals') {
        // CHEMICALS REPORT
        const filteredChems = chemicalProducts.filter(p => filterChemicalCategory === 'all' || p.category === filterChemicalCategory);
        const tableBody = filteredChems.map(p => [
            p.name,
            p.category,
            p.total_quantity.toLocaleString('es-CL'),
            formatCLP(p.avg_price),
            formatCLP(p.total_cost)
        ]);

        // Add filter info to subheader if needed, handled by generic header mostly
        if (filterChemicalCategory !== 'all') {
            doc.text(`Filtro Tipo: ${filterChemicalCategory}`, 14, 45);
            yPos += 5;
        }

        autoTable(doc, {
            startY: yPos,
            head: [['Producto', 'Categoría', 'Cantidad Total', 'Precio Promedio', 'Costo Total']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [0, 136, 254] }, // Blue
            columnStyles: {
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right', fontStyle: 'bold' }
            }
        });

    } else if (activeTab === 'stock_breaks') {
        const { rows, totals } = getStockBreakRows();
        const tableBody = rows.map((r) => [
            r.name,
            r.category,
            r.unit,
            r.current_stock.toFixed(2),
            r.minimum_stock.toFixed(2),
            r.deficit.toFixed(2),
            formatCLP(r.average_cost),
            formatCLP(r.value)
        ]);

        if (rows.length > 0) {
            tableBody.push(['TOTAL', '', '', '', '', totals.deficit.toFixed(2), '', formatCLP(totals.value)]);
        }

        autoTable(doc, {
            startY: yPos,
            head: [['Producto', 'Categoría', 'Unidad', 'Stock', 'Mínimo', 'Faltante', 'Costo Prom.', 'Costo Reposición']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [0, 136, 254] },
            columnStyles: {
                3: { halign: 'right' },
                4: { halign: 'right' },
                5: { halign: 'right', fontStyle: 'bold' },
                6: { halign: 'right' },
                7: { halign: 'right', fontStyle: 'bold' }
            },
            didParseCell: function(data) {
                if (rows.length > 0 && data.row.index === rows.length) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [230, 230, 230];
                }
            }
        });

    } else if (activeTab === 'pending') {
        // PENDING INVOICES REPORT
        if (pendingStartDate || pendingEndDate || pendingSupplierFilter.length > 0 || pendingCategoryFilter.length > 0) {
            const startStr = pendingStartDate ? new Date(pendingStartDate + 'T12:00:00').toLocaleDateString() : 'Inicio';
            const endStr = pendingEndDate ? new Date(pendingEndDate + 'T12:00:00').toLocaleDateString() : 'Fin';
            let filterText = '';
            if (pendingStartDate || pendingEndDate) filterText += `Vencimiento: ${startStr} - ${endStr} `;
            if (pendingSupplierFilter.length > 0) filterText += `| Prov: ${pendingSupplierFilter.join(', ')} `;
            if (pendingCategoryFilter.length > 0) filterText += `| Cat: ${pendingCategoryFilter.join(', ')}`;
            
            doc.text(`Filtros: ${filterText}`, 14, 45);
            yPos += 5;
        }

        const tableBody = filteredPendingInvoices.map(inv => [
            new Date(inv.due_date + 'T12:00:00').toLocaleDateString(),
            `${inv.days_overdue} días`,
            inv.supplier,
            inv.categories.join(', '),
            inv.invoice_number,
            formatCLP(inv.total_amount),
        ]);

        // Calculate Total
        const totalAmount = filteredPendingInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);

        autoTable(doc, {
            startY: yPos,
            head: [['Vencimiento', 'Días Vencida', 'Proveedor', 'Categorías', 'N° Factura', 'Monto']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 53, 69] }, // Red
            columnStyles: {
                5: { halign: 'right', fontStyle: 'bold' }
            },
            foot: [['', '', '', '', 'TOTAL:', formatCLP(totalAmount)]],
            footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold', halign: 'right' }
        });

    } else if (activeTab === 'overdue') {
        if (pendingStartDate || pendingEndDate || pendingSupplierFilter.length > 0 || pendingCategoryFilter.length > 0) {
            const startStr = pendingStartDate ? new Date(pendingStartDate + 'T12:00:00').toLocaleDateString() : 'Inicio';
            const endStr = pendingEndDate ? new Date(pendingEndDate + 'T12:00:00').toLocaleDateString() : 'Fin';
            let filterText = '';
            if (pendingStartDate || pendingEndDate) filterText += `Vencimiento: ${startStr} - ${endStr} `;
            if (pendingSupplierFilter.length > 0) filterText += `| Prov: ${pendingSupplierFilter.join(', ')} `;
            if (pendingCategoryFilter.length > 0) filterText += `| Cat: ${pendingCategoryFilter.join(', ')}`;
            
            doc.text(`Filtros: ${filterText}`, 14, 45);
            yPos += 5;
        }

        const tableBody = filteredOverdueInvoices.map(inv => [
            new Date(inv.due_date + 'T12:00:00').toLocaleDateString(),
            `${inv.days_overdue} días`,
            inv.supplier,
            inv.categories.join(', '),
            inv.invoice_number,
            formatCLP(inv.total_amount),
        ]);

        const totalAmount = filteredOverdueInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);

        autoTable(doc, {
            startY: yPos,
            head: [['Vencimiento', 'Días Vencida', 'Proveedor', 'Categorías', 'N° Factura', 'Monto']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 53, 69] },
            columnStyles: {
                5: { halign: 'right', fontStyle: 'bold' }
            },
            foot: [['', '', '', '', 'TOTAL:', formatCLP(totalAmount)]],
            footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold', halign: 'right' }
        });

    } else if (activeTab === 'detailed') {
        // DETAILED REPORT (Existing Logic)
        const filteredData = detailedReport
            .filter(m => filterMonth === 'all' || m.monthIndex.toString() === filterMonth)
            .map(m => ({
                ...m,
                categories: m.categories.filter(c => filterCategory === 'all' || c.name === filterCategory)
            }))
            .filter(m => m.categories.length > 0);

        if (filteredData.length === 0) {
            doc.text('No hay datos para los filtros seleccionados.', 14, yPos);
        }

        filteredData.forEach((month) => {
            const monthTotal = month.categories.reduce((sum, cat) => sum + cat.total, 0);

            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }

            doc.setFontSize(14);
            doc.setTextColor(0, 100, 0);
            doc.text(`${month.monthName} - Total: ${formatCLP(monthTotal)}`, 14, yPos);
            yPos += 10;

            month.categories.forEach((cat) => {
                if (yPos > 250) {
                    doc.addPage();
                    yPos = 20;
                }

                const tableData = cat.items.map(item => [
                    new Date(item.date).toLocaleDateString(),
                    item.supplier,
                    item.invoiceNumber,
                    item.description,
                    formatCLP(item.total)
                ]);

                autoTable(doc, {
                    startY: yPos,
                    head: [[`${cat.name} (Total: ${formatCLP(cat.total)})`, '', '', '', '']],
                    body: tableData,
                    theme: 'grid',
                    headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },
                    columnStyles: {
                        0: { cellWidth: 25 },
                        1: { cellWidth: 40 },
                        2: { cellWidth: 25 },
                        3: { cellWidth: 'auto' },
                        4: { cellWidth: 30, halign: 'right' }
                    },
                    margin: { left: 14, right: 14 },
                    didDrawPage: (data) => {
                        yPos = data.cursor.y + 10;
                    }
                });
                
                yPos = (doc as any).lastAutoTable.finalY + 10;
            });
            yPos += 10;
        });
    }

    // Save or Preview
    const pdfBlobUrl = doc.output('bloburl');
    setPreviewPdfUrl(pdfBlobUrl.toString());
    setPreviewTitle(title);
    setShowPreview(true);
  };

  const requiresExecutiveExportConfirmation = activeTab === 'executive' && executiveTotalDataClosure.readiness.title === 'No listo para comité';

  const runExecutiveExportAction = async (action: ExecutiveExportAction) => {
    await logExecutiveExportWarningEvent(action);

    if (action === 'excel') {
      void exportExecutiveExcel();
      return;
    }
    handleGeneratePDF();
  };

  const requestExecutiveExportAction = (action: ExecutiveExportAction) => {
    if (!requiresExecutiveExportConfirmation) {
      void runExecutiveExportAction(action);
      return;
    }

    setPendingExecutiveExportAction(action);
  };

  const confirmExecutiveExportAction = () => {
    if (!pendingExecutiveExportAction) return;
    const action = pendingExecutiveExportAction;
    setPendingExecutiveExportAction(null);
    void runExecutiveExportAction(action);
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;
  
  const getReportTitle = () => {
    switch(activeTab) {
      case 'executive': return 'Resumen Ejecutivo';
      case 'applications': return 'Costos de Aplicación';
      case 'costs_ha': return 'Costos por Hectárea';
      case 'margin': return 'Rentabilidad Neta';
      case 'labors': return 'Detalle de Labores por Sector';
      case 'monthly': return 'Gastos Mensuales';
      case 'categories': return 'Gastos por Clasificación';
      case 'chemicals': return 'Insumos Químicos';
      case 'stock_breaks': return 'Quiebres de Stock';
      case 'pending': return 'Facturas Pendientes';
      case 'overdue': return 'Facturas Vencidas';
      case 'paid_payments': return 'Pagos Realizados por Categoría';
      case 'fuel_machines': return 'Petróleo por Máquina';
      case 'detailed': return 'Informe Detallado';
      default: return 'Reporte';
    }
  };

  const getMarginRows = () => {
    const rows = reportData.map((row) => {
      const income = Number(row.income_estimated || 0);
      const cost = Number(row.total_cost || 0);
      const profit = Number(row.profit_clp ?? (income - cost));
      const ha = Number(row.hectares || 0);
      const profitPerHa = ha > 0 ? profit / ha : 0;
      const marginPct = Number(row.margin_pct ?? (income > 0 ? (profit / income) * 100 : 0));
      return {
        field_name: row.field_name,
        sector_name: row.sector_name,
        hectares: ha,
        kg_produced: Number(row.kg_produced || 0),
        kg_sold: Number(row.kg_sold || 0),
        price_per_kg: Number(row.price_per_kg || 0),
        income,
        cost,
        profit,
        profit_per_ha: profitPerHa,
        margin_pct: marginPct,
        production_source: row.production_source || 'income_entries',
        has_production_record: Boolean(row.has_production_record)
      };
    });

    const totalIncome = rows.reduce((sum, r) => sum + r.income, 0);
    const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
    const totalProfit = totalIncome - totalCost;
    const totalHa = rows.reduce((sum, r) => sum + r.hectares, 0);
    const totalProfitPerHa = totalHa > 0 ? totalProfit / totalHa : 0;
    const totalMarginPct = totalIncome > 0 ? (totalProfit / totalIncome) * 100 : 0;

    return { rows, totals: { totalIncome, totalCost, totalProfit, totalHa, totalProfitPerHa, totalMarginPct } };
  };

  const getFuelMachinesRows = () => {
    const items = (rawFuelConsumption || []).filter((it) => {
      try {
        if (!it?.date) return false;
        return isDateInSeason(it.date, selectedSeason);
      } catch {
        return false;
      }
    });

    const map = new Map<string, { machine_id: string | null; machine_name: string; liters_diesel: number; liters_gasoline: number; cost_diesel: number; cost_gasoline: number }>();

    items.forEach((it) => {
      const activity = String(it.activity || '').toLowerCase();
      const isGasoline = activity.includes('bencina');
      const machineId = it.machine_id ? String(it.machine_id) : null;
      const machineName = it.machine?.name ? String(it.machine.name) : 'Sin máquina';
      const key = machineId || 'none';
      const liters = Number(it.liters || 0);
      const cost = Number(it.estimated_price || 0);

      const row = map.get(key) || { machine_id: machineId, machine_name: machineName, liters_diesel: 0, liters_gasoline: 0, cost_diesel: 0, cost_gasoline: 0 };

      if (isGasoline) {
        row.liters_gasoline += liters;
        row.cost_gasoline += cost;
      } else {
        row.liters_diesel += liters;
        row.cost_diesel += cost;
      }

      map.set(key, row);
    });

    const rows = Array.from(map.values()).map((r) => {
      const liters_total = r.liters_diesel + r.liters_gasoline;
      const cost_total = r.cost_diesel + r.cost_gasoline;
      const avg_price = liters_total > 0 ? cost_total / liters_total : 0;
      return { ...r, liters_total, cost_total, avg_price };
    }).sort((a, b) => b.cost_total - a.cost_total);

    const totals = rows.reduce(
      (acc, r) => ({
        liters_diesel: acc.liters_diesel + r.liters_diesel,
        liters_gasoline: acc.liters_gasoline + r.liters_gasoline,
        liters_total: acc.liters_total + r.liters_total,
        cost_total: acc.cost_total + r.cost_total
      }),
      { liters_diesel: 0, liters_gasoline: 0, liters_total: 0, cost_total: 0 }
    );

    return { rows, totals: { ...totals, avg_price: totals.liters_total > 0 ? totals.cost_total / totals.liters_total : 0 } };
  };

  const getStockBreakRows = () => {
    const products = (rawProducts || []) as Array<any>;
    const rows = products
      .map((p) => {
        const current = Number(p.current_stock || 0);
        const min = Number(p.minimum_stock || 0);
        const deficit = Math.max(min - current, 0);
        const avgCost = Number(p.average_cost || 0);
        const value = deficit * avgCost;
        return {
          id: String(p.id),
          name: String(p.name || ''),
          category: String(p.category || ''),
          unit: String(p.unit || ''),
          current_stock: current,
          minimum_stock: min,
          deficit,
          average_cost: avgCost,
          value
        };
      })
      .filter((r) => r.minimum_stock > 0 && r.deficit > 0)
      .sort((a, b) => b.value - a.value);

    const totals = rows.reduce(
      (acc, r) => ({
        deficit: acc.deficit + r.deficit,
        value: acc.value + r.value
      }),
      { deficit: 0, value: 0 }
    );

    return { rows, totals };
  };

  return (
    <div className="space-y-6">
        <PdfPreviewModal 
            isOpen={showPreview}
            onClose={() => setShowPreview(false)}
            title={previewTitle}
            pdfUrl={previewPdfUrl}
        />

        {pendingExecutiveExportAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Confirmar exportación con dato no listo para comité</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {pendingExecutiveExportAction === 'excel' ? 'Excel Ejecutivo' : 'PDF Ejecutivo'} · {selectedSeason} · {companyName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingExecutiveExportAction(null)}
                  className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-5 px-6 py-5">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-red-700">Estado comité</div>
                      <div className="mt-2 text-xl font-semibold text-red-800">{executiveTotalDataClosure.readiness.title}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-red-700">Cierre total</div>
                      <div className="mt-2 text-2xl font-semibold text-red-800">{executiveTotalDataClosure.totalClosurePct.toFixed(1)}%</div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-red-700">{executiveTotalDataClosure.readiness.detail}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Cierre económico</div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">{executiveTotalDataClosure.economicPct.toFixed(1)}%</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Trazabilidad</div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">{executiveTotalDataClosure.traceabilityPct.toFixed(1)}%</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Bloqueos visibles</div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">{executiveTotalDataClosure.blockers.length}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  <div className="font-medium text-slate-900">Conclusión ejecutiva</div>
                  <p className="mt-2">{executiveTotalDataClosure.conclusion}</p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-sm font-medium text-slate-900">Bloqueos actuales</div>
                  <div className="mt-3 space-y-2 text-sm">
                    {executiveTotalDataClosure.blockers.length > 0 ? executiveTotalDataClosure.blockers.map((blocker) => (
                      <div key={blocker} className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">{blocker}</div>
                    )) : (
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">No hay bloqueos visibles, pero la temporada sigue sin quedar lista para comité.</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setPendingExecutiveExportAction(null)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmExecutiveExportAction}
                    className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Continuar con {pendingExecutiveExportAction === 'excel' ? 'Excel' : 'PDF'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showProductionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {editingProductionRecord.id ? 'Editar producción formal' : 'Registrar producción formal'}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">Temporada {selectedSeason} · Año base {selectedSeasonStartYear}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (savingProductionRecord) return;
                    setShowProductionModal(false);
                    setEditingProductionRecord({});
                  }}
                  className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <form onSubmit={handleSaveProductionRecord} className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Sector</span>
                    <select
                      value={editingProductionRecord.sector_id || ''}
                      onChange={(e) => setEditingProductionRecord((prev) => ({ ...prev, sector_id: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      required
                    >
                      <option value="">Selecciona un sector</option>
                      {rawFields.flatMap((field) =>
                        (field.sectors || []).map((sector: any) => (
                          <option key={sector.id} value={sector.id}>
                            {field.name} / {sector.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Kg producidos</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingProductionRecord.kg_produced ?? ''}
                      onChange={(e) => setEditingProductionRecord((prev) => ({ ...prev, kg_produced: Number(e.target.value || 0) }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      required
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Precio de referencia por Kg</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingProductionRecord.price_per_kg ?? ''}
                      onChange={(e) => setEditingProductionRecord((prev) => ({ ...prev, price_per_kg: Number(e.target.value || 0) }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                  Este registro alimenta la base formal de producción usada por el margen canónico y el costo por kilo.
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (savingProductionRecord) return;
                      setShowProductionModal(false);
                      setEditingProductionRecord({});
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingProductionRecord}
                    className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingProductionRecord && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar producción
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes de Gestión</h1>
          <p className="text-sm text-gray-500">Vista integral de costos y gastos</p>
        </div>
        <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-3">
          <button
            onClick={() => requestExecutiveExportAction('pdf')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            title="Generar y Previsualizar Informe PDF"
          >
            <Printer className="mr-2 h-4 w-4 text-gray-500" /> Imprimir PDF
          </button>

          {activeTab === 'executive' && (
            <>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center px-4 py-2 border border-purple-300 shadow-sm text-sm font-medium rounded-md text-purple-700 bg-white hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                title="Imprimir vista ejecutiva"
              >
                <Printer className="mr-2 h-4 w-4" /> Imprimir Vista
              </button>
              <button
                onClick={() => requestExecutiveExportAction('excel')}
                className="inline-flex items-center px-4 py-2 border border-green-300 shadow-sm text-sm font-medium rounded-md text-green-700 bg-white hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                title="Exportar tablas ejecutivas a Excel"
              >
                <FileText className="mr-2 h-4 w-4" /> Excel Ejecutivo
              </button>
            </>
          )}
          
          <div className="relative">
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md"
            >
              {availableSeasons.map(season => (
                <option key={season} value={season}>{season}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => {
              setActiveTab('executive');
              startPresentation();
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            title="Iniciar Presentación a Pantalla Completa"
          >
            <Play className="mr-2 h-4 w-4" /> Presentar Modo Ejecutivo
          </button>
        </div>
      </div>

      <div className="hidden print:block mb-8">
        <div className="flex items-start justify-between gap-6 border-b border-gray-200 pb-6">
          <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-xl font-bold text-white">
              {String(companyName || 'R').trim().slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{companyName}</h1>
              <h2 className="text-xl text-gray-600 mt-2">{getReportTitle()} - {selectedSeason}</h2>
            </div>
          </div>
          <div className="text-right text-sm text-gray-500">
            <div>Documento ejecutivo</div>
            <div>Emitido el {new Date().toLocaleDateString()}</div>
          </div>
        </div>
        {activeTab === 'executive' && (
          <div className="mt-2 text-sm text-gray-500 space-y-1">
            <div>Temporada comparativa: {previousExecutiveSeason}</div>
            <div>Campo: {executiveFieldLabel}</div>
          </div>
        )}
        <p className="text-sm text-gray-400 mt-1">Generado el {new Date().toLocaleDateString()}</p>
      </div>

      <div className="border-b border-gray-200 print:hidden mb-4">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => { setActiveGroup('general'); setActiveTab('executive'); }}
            className={`${
              activeGroup === 'general' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Scale className="mr-2 h-4 w-4" /> Costos y Producción
          </button>
          <button
            onClick={() => { setActiveGroup('financial'); setActiveTab('monthly'); }}
            className={`${
              activeGroup === 'financial' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <DollarSign className="mr-2 h-4 w-4" /> Resumen Financiero
          </button>
          <button
            onClick={() => { setActiveGroup('inventory'); setActiveTab('chemicals'); }}
            className={`${
              activeGroup === 'inventory' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Beaker className="mr-2 h-4 w-4" /> Insumos y Detalle
          </button>
          <button
            onClick={() => { setActiveGroup('comparative'); setActiveTab('comparative'); }}
            className={`${
              activeGroup === 'comparative' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Layers className="mr-2 h-4 w-4" /> Comparativa Temporadas
          </button>
        </nav>
      </div>

      <div className="border-b border-gray-100 print:hidden mb-6 bg-slate-50 p-2 rounded-t-lg">
        {activeGroup === 'general' && (
            <nav className="flex space-x-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab('executive')}
                className={`${
                  activeTab === 'executive' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Vista Ejecutiva
              </button>
              <button
                onClick={() => setActiveTab('general')}
                className={`${
                  activeTab === 'general' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Costos Generales (USD/Kg)
              </button>
              <button
                onClick={() => setActiveTab('costs_ha')}
                className={`${
                  activeTab === 'costs_ha' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Costos por Ha
              </button>
              <button
                onClick={() => setActiveTab('margin')}
                className={`${
                  activeTab === 'margin' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Rentabilidad
              </button>
              <button
                onClick={() => setActiveTab('labors')}
                className={`${
                  activeTab === 'labors' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Detalle de Labores
              </button>
              <button
                onClick={() => setActiveTab('budget')}
                className={`${
                  activeTab === 'budget' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Presupuesto y Ventas
              </button>
            </nav>
        )}
        
        {activeGroup === 'financial' && (
            <nav className="flex space-x-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab('monthly')}
                className={`${
                  activeTab === 'monthly' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Gastos Mensuales
              </button>
              <button
                onClick={() => setActiveTab('categories')}
                className={`${
                  activeTab === 'categories' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Por Clasificación
              </button>
              <button
                onClick={() => setActiveTab('pending')}
                className={`${
                  activeTab === 'pending' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Facturas Pendientes
              </button>
              <button
                onClick={() => setActiveTab('overdue')}
                className={`${
                  activeTab === 'overdue' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Facturas Vencidas
              </button>
              <button
                onClick={() => setActiveTab('paid_payments')}
                className={`${
                  activeTab === 'paid_payments' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Pagos Realizados
              </button>
              <button
                onClick={() => setActiveTab('fuel_machines')}
                className={`${
                  activeTab === 'fuel_machines' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Petróleo por Máquina
              </button>
            </nav>
        )}

        {activeGroup === 'inventory' && (
            <nav className="flex space-x-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab('chemicals')}
                className={`${
                  activeTab === 'chemicals' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Insumos Químicos
              </button>
              <button
                onClick={() => setActiveTab('stock_breaks')}
                className={`${
                  activeTab === 'stock_breaks' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Quiebres de Stock
              </button>
              <button
                onClick={() => setActiveTab('applications')}
                className={`${
                  activeTab === 'applications' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Costos de Aplicación
              </button>
              <button
                onClick={() => setActiveTab('detailed')}
                className={`${
                  activeTab === 'detailed' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Informe Detallado (Excel)
              </button>
            </nav>
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="animate-spin h-8 w-8 text-green-600" />
        </div>
      ) : (
        <div className="mt-6">
          {activeTab === 'executive' && (
            <div className="space-y-6">
              {rawFields.length === 0 && reportData.length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                  <div className="text-sm font-semibold">Sin estructura suficiente para el reporte ejecutivo</div>
                  <p className="mt-1 text-sm text-amber-800">
                    La empresa activa no tiene campos o sectores cargados para construir esta vista. Igual puedes usar temporadas disponibles, historial financiero y exportaciones cuando existan datos.
                  </p>
                </div>
              )}

              <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 text-white rounded-xl p-6 shadow print:bg-white print:text-gray-900 print:border print:border-gray-200">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h3 className="text-2xl font-semibold">Resumen Ejecutivo</h3>
                    <p className="text-sm text-purple-100 print:text-gray-500">
                      Lectura gerencial de gastos por mes, campo y sector para presentar e imprimir.
                    </p>
                  </div>
                  <div className="text-sm text-purple-100 print:text-gray-500">
                    <div>Temporada {selectedSeason} · {companyName}</div>
                    {executiveFieldFilter !== 'all' && (
                      <div className="mt-1">Campo: {executiveFieldOptions.find((item) => item.value === executiveFieldFilter)?.label || executiveFieldFilter}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 p-4 print:hidden">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Filtro ejecutivo</h3>
                    <p className="text-sm text-gray-500">Enfoca la vista por campo, define el orden ejecutivo de las matrices y prepara la comparacion directa entre campos.</p>
                  </div>
                  <div className="grid w-full xl:w-auto grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
                    <select
                      value={executiveFieldFilter}
                      onChange={(e) => setExecutiveFieldFilter(e.target.value)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      <option value="all">Todos los campos</option>
                      {executiveFieldOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      value={previousExecutiveSeason}
                      onChange={(e) => setExecutiveComparisonSeason(e.target.value)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      {availablePreviousExecutiveSeasons.length > 0 ? (
                        availablePreviousExecutiveSeasons.map((season) => (
                          <option key={season} value={season}>{season}</option>
                        ))
                      ) : (
                        <option value={previousExecutiveSeason}>{previousExecutiveSeason}</option>
                      )}
                    </select>
                    <select
                      value={executiveCompareCompanyId}
                      onChange={(e) => setExecutiveCompareCompanyId(e.target.value)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      <option value="none">Sin comparar empresa</option>
                      {executiveComparableCompanies.map((company) => (
                        <option key={company.id} value={company.id}>{company.name}</option>
                      ))}
                    </select>
                    <select
                      value={executiveFieldSortBy}
                      onChange={(e) => setExecutiveFieldSortBy(e.target.value as ExecutiveSortKey)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      {EXECUTIVE_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>Campos: {option.label}</option>
                      ))}
                    </select>
                    <select
                      value={executiveSectorSortBy}
                      onChange={(e) => setExecutiveSectorSortBy(e.target.value as ExecutiveSortKey)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      {EXECUTIVE_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>Sectores: {option.label}</option>
                      ))}
                    </select>
                    <select
                      value={executiveCompareFieldA}
                      onChange={(e) => setExecutiveCompareFieldA(e.target.value)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      <option value="auto">Campo A automatico</option>
                      {executiveFieldOptions.map((option) => (
                        <option key={`field-a-${option.value}`} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      value={executiveCompareFieldB}
                      onChange={(e) => setExecutiveCompareFieldB(e.target.value)}
                      className="block w-full rounded-md border-gray-300 text-sm focus:border-purple-500 focus:ring-purple-500"
                    >
                      <option value="auto">Campo B automatico</option>
                      {executiveFieldOptions
                        .filter((option) => option.value !== executiveCompareFieldA || executiveCompareFieldA === 'auto')
                        .map((option) => (
                          <option key={`field-b-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow overflow-hidden print:break-after-page">
                <div className="bg-slate-950 text-white px-6 py-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.25em] text-slate-300">Resumen Directorio</div>
                      <h3 className="mt-2 text-2xl font-semibold">Lectura Ejecutiva en Una Página</h3>
                    </div>
                    <div className="text-sm text-slate-300">
                      {companyName} · {selectedSeason} · {executiveFieldLabel}
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {executiveInsights.findings.map((finding, index) => (
                      <div key={finding.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Hallazgo {index + 1}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{finding.title}</div>
                        <div className="mt-2 text-sm text-slate-600">{finding.description}</div>
                        <div className="mt-3 text-sm font-semibold text-slate-900">{finding.emphasis}</div>
                      </div>
                    ))}
                  </div>

                  <div className={`rounded-xl border px-5 py-4 ${executiveTotalDataClosure.readiness.badge}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wide">Estado del dato</div>
                        <div className="mt-2 text-lg font-semibold">{executiveTotalDataClosure.readiness.title}</div>
                        <p className="mt-2 text-sm">{executiveTotalDataClosure.readiness.detail}</p>
                      </div>
                      <div className="text-sm font-medium">
                        Cierre total: {executiveTotalDataClosure.totalClosurePct.toFixed(1)}%
                      </div>
                    </div>
                    {executiveTotalDataClosure.blockers.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-2 text-sm">
                        {executiveTotalDataClosure.blockers.map((blocker) => (
                          <div key={blocker} className="rounded-lg bg-white/70 px-3 py-2">
                            {blocker}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {executiveTrendWarning && (
                    <div className={`rounded-xl border px-5 py-4 ${executiveTrendWarning.badge}`}>
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-wide">Alerta preventiva</div>
                          <div className="mt-2 text-lg font-semibold">{executiveTrendWarning.title}</div>
                          <p className="mt-2 text-sm">{executiveTrendWarning.detail}</p>
                          <p className="mt-2 text-sm">{executiveTrendWarning.recommendation}</p>
                          {executiveTrendWarning.compareLine && (
                            <p className="mt-2 text-sm">{executiveTrendWarning.compareLine}</p>
                          )}
                        </div>
                        <div className="text-sm font-medium">
                          Delta tendencia: {executiveCurrentCompanyTrend.delta.toFixed(1)} pp
                        </div>
                      </div>
                    </div>
                  )}

                  <div className={`rounded-xl border px-5 py-4 ${executiveCurrentRecommendation.tone.badge}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wide">Recomendación automática</div>
                        <div className="mt-2 text-lg font-semibold">{executiveCurrentRecommendation.tone.title}</div>
                        <p className="mt-2 text-sm">{executiveCurrentRecommendation.summary}</p>
                        <p className="mt-2 text-sm">{executiveCurrentRecommendation.nextStep}</p>
                      </div>
                      <div className="text-sm font-medium">
                        Decisión para {companyName}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-2 text-sm">
                      {executiveCurrentRecommendation.reasons.map((reason) => (
                        <div key={reason} className="rounded-lg bg-white/70 px-3 py-2">
                          {reason}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,0.8fr] gap-4">
                    <div className="rounded-xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Conclusión</div>
                          <div className="mt-2 text-lg font-semibold text-slate-900">Mensaje para comité ejecutivo</div>
                        </div>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveInsights.tone.badge}`}>
                          <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveInsights.tone.dot}`} />
                          {executiveInsights.tone.label}
                        </span>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-slate-700">{executiveInsights.conclusion}</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-5">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Ficha rápida</div>
                      <div className="mt-3 space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Gasto actual</span>
                          <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.totalSeasonCost)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Temp. anterior</span>
                          <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.previousSeasonCost)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Campo visible</span>
                          <span className="font-semibold text-slate-900">{executiveFieldLabel}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Alertas activas</span>
                          <span className="font-semibold text-slate-900">{executiveInsights.activeAlertCount}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Presupuesto</span>
                          <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.totalBudget || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Costo / Ha</span>
                          <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.averageCostPerHa || 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Cierre total del dato</h3>
                      <p className="text-sm text-gray-500">Unifica cierre económico, trazabilidad de costo, soporte oficial y limpieza de revisión para decidir si la temporada está lista para comité.</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveTotalDataClosure.readiness.badge}`}>
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveTotalDataClosure.readiness.dot}`} />
                      {executiveTotalDataClosure.readiness.title}
                    </span>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Cierre total</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.totalClosurePct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">Semáforo consolidado</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Cierre económico</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.economicPct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">Costo, ingreso y producción formal</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Trazabilidad costo</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.traceabilityPct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">Costo conciliado y soportado</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Soporte oficial</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.officialSupportPct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">Participación oficial del costo auditado</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Limpieza revisión</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.reviewCleanPct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">Focos críticos ya resueltos</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {executiveTotalDataClosure.findings.map((finding, index) => (
                      <div key={finding.title} className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Dato {index + 1}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{finding.title}</div>
                        <div className="mt-2 text-sm text-slate-600">{finding.description}</div>
                        <div className="mt-3 text-sm font-semibold text-slate-900">{finding.emphasis}</div>
                      </div>
                    ))}
                  </div>

                  <div className={`rounded-xl border px-4 py-4 text-sm ${executiveTotalDataClosure.readiness.badge}`}>
                    {executiveTotalDataClosure.conclusion}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Bloqueos visibles</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {executiveTotalDataClosure.blockers.map((row) => (
                          <tr key={row}>
                            <td className="px-4 py-3 text-slate-700">{row}</td>
                          </tr>
                        ))}
                        {executiveTotalDataClosure.blockers.length === 0 && (
                          <tr>
                            <td className="px-4 py-4 text-center text-sm text-slate-500">
                              No hay bloqueos críticos visibles para el filtro actual.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Salud de trazabilidad del costo</h3>
                      <p className="text-sm text-gray-500">Controla qué parte del costo ejecutivo está trazada, en respaldo contable o requiere revisión antes de comité.</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveAuditData.tone.badge}`}>
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveAuditData.tone.dot}`} />
                      {costAuditLoading ? 'Cargando auditoría' : executiveAuditData.tone.label}
                    </span>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Monto oficial</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCLP(executiveAuditData.officialAmount)}</div>
                      <div className="mt-1 text-sm text-slate-500">Base oficial consolidada</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Trazabilidad</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveAuditData.traceabilityPct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">{formatCLP(executiveAuditData.traceableAmount)} conciliado</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Respaldo contable</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCLP(executiveAuditData.backupAmount)}</div>
                      <div className="mt-1 text-sm text-slate-500">Monto sostenido por respaldo</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Distribución</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCLP(executiveAuditData.distributedAmount)}</div>
                      <div className="mt-1 text-sm text-slate-500">Costo distribuido desde factura</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Revisión alta</div>
                      <div className={`mt-2 text-2xl font-semibold ${executiveAuditData.highReviewAmount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatCLP(executiveAuditData.highReviewAmount)}</div>
                      <div className="mt-1 text-sm text-slate-500">{executiveAuditData.highReviewCount} focos críticos visibles</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">No trazable</div>
                      <div className={`mt-2 text-2xl font-semibold ${executiveAuditData.nonTraceableAmount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{formatCLP(executiveAuditData.nonTraceableAmount)}</div>
                      <div className="mt-1 text-sm text-slate-500">Monto pendiente de mejor soporte</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Auditoría visible</div>
                        <div className="mt-1 text-sm text-slate-600">{executiveAuditData.scopeLabel}</div>
                        <div className="mt-2 text-sm font-medium text-slate-900">
                          {executiveAuditData.visibleMovementCount} movimientos considerados en esta lectura
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:min-w-[420px]">
                        <label className="text-sm text-slate-600">
                          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Prioridad</span>
                          <select
                            value={executiveAuditPriorityFilter}
                            onChange={(e) => setExecutiveAuditPriorityFilter(e.target.value as ExecutiveAuditPriorityFilter)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                          >
                            {EXECUTIVE_AUDIT_PRIORITY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm text-slate-600">
                          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Capa</span>
                          <select
                            value={executiveAuditLayerFilter}
                            onChange={(e) => setExecutiveAuditLayerFilter(e.target.value as ExecutiveAuditLayerFilter)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                          >
                            {EXECUTIVE_AUDIT_LAYER_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {executiveAuditData.findings.map((finding, index) => (
                      <div key={finding.title} className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Auditoría {index + 1}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{finding.title}</div>
                        <div className="mt-2 text-sm text-slate-600">{finding.description}</div>
                        <div className="mt-3 text-sm font-semibold text-slate-900">{finding.emphasis}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
                    {executiveAuditData.conclusion}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Categoría</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Capa</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Estado</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Mov.</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Monto</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Trazable %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {executiveAuditSummaryRows.slice(0, 8).map((row) => {
                          const ratio = Number(row.total_amount || 0) > 0
                            ? (Number(row.traceable_amount || 0) / Number(row.total_amount || 0)) * 100
                            : 0;
                          return (
                            <tr key={`${row.category}-${row.source_layer}-${row.audit_status}-${row.review_priority}`}>
                              <td className="px-4 py-3 text-slate-900">{row.category}</td>
                              <td className="px-4 py-3 text-slate-700">{row.source_layer}</td>
                              <td className="px-4 py-3 text-slate-700">{row.audit_status}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{Number(row.movement_count || 0)}</td>
                              <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCLP(Number(row.total_amount || 0))}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{ratio.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                        {!costAuditLoading && executiveAuditSummaryRows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-4 text-center text-sm text-slate-500">
                              No hay movimientos de auditoría para los filtros visibles.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Salud económica del margen</h3>
                      <p className="text-sm text-gray-500">Controla la utilidad visible y qué tan respaldada está la producción usada para costear por kilo.</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveMarginData.tone.badge}`}>
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveMarginData.tone.dot}`} />
                      {executiveMarginData.tone.label}
                    </span>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Ingreso total</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{formatCLP(executiveMarginData.totalIncome)}</div>
                      <div className="mt-1 text-sm text-slate-500">Venta visible del período</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Utilidad neta</div>
                      <div className={`mt-2 text-2xl font-semibold ${executiveMarginData.totalProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCLP(executiveMarginData.totalProfit)}</div>
                      <div className="mt-1 text-sm text-slate-500">Ingreso menos costo consolidado</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Margen neto</div>
                      <div className={`mt-2 text-2xl font-semibold ${executiveMarginData.marginPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{executiveMarginData.marginPct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">Rentabilidad sobre venta visible</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Cobertura producción</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveMarginData.productionCoveragePct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">{executiveMarginData.productionRecordCount} sectores con registro formal</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Ingreso / Kg</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveMarginData.averageIncomePerKg > 0 ? formatCLP(executiveMarginData.averageIncomePerKg) : '-'}</div>
                      <div className="mt-1 text-sm text-slate-500">{executiveMarginData.totalKg.toLocaleString('es-CL')} Kg considerados</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Campo visible</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">{executiveFieldLabel}</div>
                      <div className="mt-2 text-sm text-slate-600">{executiveMarginData.visibleRows.length} sectores con lectura económica visible.</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Registro formal</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">{executiveMarginData.productionRecordCount}</div>
                      <div className="mt-2 text-sm text-slate-600">Sectores cuya producción viene desde `production_records`.</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Respaldo por ingreso</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">{executiveMarginData.inferredCount}</div>
                      <div className="mt-2 text-sm text-slate-600">Sectores que todavía infieren producción desde ingresos.</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Cierre económico de temporada</h3>
                      <p className="text-sm text-gray-500">Mide qué parte del margen visible ya tiene costo, ingreso y producción formal suficientemente cerrados para comité.</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveEconomicClosureData.tone.badge}`}>
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveEconomicClosureData.tone.dot}`} />
                      {executiveEconomicClosureData.tone.label}
                    </span>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Cierre económico</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveEconomicClosureData.closurePct.toFixed(1)}%</div>
                      <div className="mt-1 text-sm text-slate-500">{executiveEconomicClosureData.closedRows.length} sectores cerrados</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Pendiente producción</div>
                      <div className="mt-2 text-2xl font-semibold text-amber-700">{executiveEconomicClosureData.pendingProductionRows.length}</div>
                      <div className="mt-1 text-sm text-slate-500">{formatCLP(executiveEconomicClosureData.pendingProductionAmount)} con venta visible</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Pendiente ingreso</div>
                      <div className="mt-2 text-2xl font-semibold text-indigo-700">{executiveEconomicClosureData.pendingIncomeRows.length}</div>
                      <div className="mt-1 text-sm text-slate-500">{formatCLP(executiveEconomicClosureData.pendingIncomeCost)} con producción formal</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Costo sin ingreso</div>
                      <div className="mt-2 text-2xl font-semibold text-red-700">{executiveEconomicClosureData.costWithoutIncomeRows.length}</div>
                      <div className="mt-1 text-sm text-slate-500">{formatCLP(executiveEconomicClosureData.costWithoutIncomeAmount)} pendiente de cierre comercial</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Sectores visibles</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveEconomicClosureData.visibleRows.length}</div>
                      <div className="mt-1 text-sm text-slate-500">{executiveFieldLabel}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {executiveEconomicClosureData.findings.map((finding, index) => (
                      <div key={finding.title} className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Cierre {index + 1}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{finding.title}</div>
                        <div className="mt-2 text-sm text-slate-600">{finding.description}</div>
                        <div className="mt-3 text-sm font-semibold text-slate-900">{finding.emphasis}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
                    {executiveEconomicClosureData.conclusion}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Foco</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Campo / Sector</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Referencia</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {executiveEconomicClosureData.topFocusRows.map((row) => (
                          <tr key={row.key}>
                            <td className="px-4 py-3 text-slate-900">{row.status}</td>
                            <td className="px-4 py-3 text-slate-700">{row.fieldName} / {row.sectorName}</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{row.unitLabel}</td>
                          </tr>
                        ))}
                        {executiveEconomicClosureData.topFocusRows.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-4 py-4 text-center text-sm text-slate-500">
                              No hay focos económicos visibles para el filtro actual.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Historial de cierre del dato</h3>
                      <p className="text-sm text-gray-500">Sigue cómo evoluciona el cierre económico por temporada para la empresa activa y el campo visible.</p>
                    </div>
                    <div className="text-sm text-slate-500">
                      {executiveEconomicClosureHistoryRows.length} temporadas visibles
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Temporada actual</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{selectedSeason}</div>
                      <div className="mt-1 text-sm text-slate-500">{executiveEconomicClosureData.closurePct.toFixed(1)}% de cierre</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Mejor cierre visible</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">
                        {bestClosureHistoryRow
                          ? `${bestClosureHistoryRow.closurePct.toFixed(1)}%`
                          : '-'}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {bestClosureHistoryRow
                          ? bestClosureHistoryRow.season
                          : 'Sin temporadas'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Mayor brecha visible</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">
                        {widestClosureGapHistoryRow
                          ? `${widestClosureGapHistoryRow.pendingProductionCount + widestClosureGapHistoryRow.pendingIncomeCount + widestClosureGapHistoryRow.costWithoutIncomeCount} focos`
                          : '-'}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {widestClosureGapHistoryRow
                          ? widestClosureGapHistoryRow.season
                          : 'Sin temporadas'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Campo visible</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveFieldLabel}</div>
                      <div className="mt-1 text-sm text-slate-500">Seguimiento histórico del cierre económico</div>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Temporada</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Estado</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Cierre %</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Cerrados</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Pend. prod.</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Pend. ingreso</th>
                          <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Costo sin ingreso</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {executiveEconomicClosureHistoryRows.map((row) => (
                          <tr key={row.season} className={row.season === selectedSeason ? 'bg-purple-50/50' : ''}>
                            <td className="px-4 py-3 font-medium text-slate-900">{row.season}</td>
                            <td className="px-4 py-3 text-slate-700">{row.toneLabel}</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{row.closurePct.toFixed(1)}%</td>
                            <td className="px-4 py-3 text-right text-slate-700">{row.closedSectorCount} / {row.visibleSectorCount}</td>
                            <td className="px-4 py-3 text-right text-slate-700">{row.pendingProductionCount}</td>
                            <td className="px-4 py-3 text-right text-slate-700">{row.pendingIncomeCount}</td>
                            <td className="px-4 py-3 text-right text-slate-700">{row.costWithoutIncomeCount}</td>
                          </tr>
                        ))}
                        {executiveEconomicClosureHistoryRows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-4 text-center text-sm text-slate-500">
                              No hay temporadas suficientes para construir historial de cierre.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Focos de revisión alta</h3>
                  <p className="text-sm text-gray-500">Movimientos que conviene revisar antes de usar el costo como referencia definitiva en comité o directorio.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Fecha</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Campo / Sector</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Categoría</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Estado</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Origen</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executiveAuditData.topDetailRows.map((row) => (
                        <tr key={`${row.source_type}-${row.source_id}`}>
                          <td className="px-4 py-3 text-gray-700">{row.movement_date}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{row.field_name || '-'}</div>
                            <div className="text-xs text-gray-500">{row.sector_name || 'Sin sector'}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            <div>{row.category}</div>
                            <div className="text-xs text-gray-500">{row.subcategory || row.source_layer}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                              row.review_priority === 'alta'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : row.review_priority === 'media'
                                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }`}>
                              {row.audit_status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            <div>{row.cost_role}</div>
                            <div className="text-xs text-gray-500">{row.origin_type}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCLP(row.amount)}</td>
                        </tr>
                      ))}
                      {!costAuditLoading && executiveAuditData.topDetailRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">
                            No hay focos de revisión alta para la temporada visible.
                          </td>
                        </tr>
                      )}
                      {costAuditLoading && (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">
                            Cargando auditoría de costos...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Comparativo de temporadas anteriores</h3>
                  <p className="text-sm text-gray-500">Referencia histórica para la empresa activa y el campo visible.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Temporada</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Gasto total</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Promedio mensual</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Mes más alto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executiveHistoricalSeasonRows.map((row) => (
                        <tr key={row.season} className={row.season === previousExecutiveSeason ? 'bg-purple-50' : ''}>
                          <td className="px-4 py-3 font-medium text-gray-900">{row.season}</td>
                          <td className="px-4 py-3 text-right text-gray-900">{formatCLP(row.total)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.averageMonthlyCost)}</td>
                          <td className="px-4 py-3 text-gray-700">{row.peakMonthLabel}</td>
                        </tr>
                      ))}
                      {executiveHistoricalSeasonRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-4 text-center text-sm text-gray-500">
                            No hay temporadas anteriores disponibles para comparar en esta empresa.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8 gap-4">
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Gasto temporada</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{formatCLP(executiveViewData.kpis.totalSeasonCost)}</div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Temp. anterior</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{formatCLP(executiveViewData.kpis.previousSeasonCost)}</div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Promedio mensual</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{formatCLP(executiveViewData.kpis.averageMonthlyCost)}</div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Presupuesto</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{formatCLP(executiveViewData.kpis.totalBudget || 0)}</div>
                  <div className={`mt-1 text-sm ${(executiveViewData.kpis.budgetDelta || 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCLP(executiveViewData.kpis.budgetDelta || 0)}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Costo / Ha</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{formatCLP(executiveViewData.kpis.averageCostPerHa || 0)}</div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Costo / Kg</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">
                    {executiveViewData.kpis.averageCostPerKg ? formatCLP(executiveViewData.kpis.averageCostPerKg) : '-'}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Variación temporada</div>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct)).badge}`}>
                      <span className={`mr-1 inline-block h-2 w-2 rounded-full ${getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct)).dot}`} />
                      {getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct)).label}
                    </span>
                  </div>
                  <div className={`mt-2 text-2xl font-semibold ${executiveViewData.kpis.seasonVariation >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCLP(executiveViewData.kpis.seasonVariation)}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">{executiveViewData.kpis.seasonVariationPct.toFixed(1)}%</div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Campo principal</div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {executiveViewData.kpis.topField?.fieldName || '-'}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {executiveViewData.kpis.topField ? formatCLP(executiveViewData.kpis.topField.total) : 'Sin datos'}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Sector principal</div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {executiveViewData.kpis.topSector?.sectorName || '-'}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {executiveViewData.kpis.topSector ? formatCLP(executiveViewData.kpis.topSector.total) : 'Sin datos'}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Alertas activas</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{executiveViewData.alerts.length}</div>
                  <div className="mt-1 text-sm text-gray-500">Focos relevantes para revisión ejecutiva</div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="bg-white rounded-lg shadow border border-gray-200 p-6 xl:col-span-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Presupuesto vs real</h3>
                      <p className="text-sm text-gray-500">Seguimiento del gasto ejecutado contra el presupuesto visible.</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getExecutiveTone(Math.abs((executiveViewData.kpis.budgetExecutionPct || 0) - 100)).badge}`}>
                      {Number(executiveViewData.kpis.budgetExecutionPct || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Presupuesto</div>
                      <div className="mt-2 text-xl font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.totalBudget || 0)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Gasto real</div>
                      <div className="mt-2 text-xl font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.totalSeasonCost)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Desviación</div>
                      <div className={`mt-2 text-xl font-semibold ${(executiveViewData.kpis.budgetDelta || 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCLP(executiveViewData.kpis.budgetDelta || 0)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900">Pareto 80/20</h3>
                  <p className="text-sm text-gray-500">Campos que concentran la mayor parte del costo.</p>
                  <div className="mt-4 space-y-3">
                    {executiveParetoFields.slice(0, 5).map((row) => (
                      <div key={row.fieldId} className="rounded-xl bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="font-medium text-slate-900">{row.fieldName}</div>
                          <div className="text-sm font-semibold text-slate-900">{row.sharePct.toFixed(1)}%</div>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full bg-purple-600" style={{ width: `${Math.min(row.cumulativeSharePct, 100)}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Acumulado {row.cumulativeSharePct.toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {executiveCompareCompanySummary && executiveCompareCompanyTotalClosure && executiveCompareCompanyInsights && (
                <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Comparación entre empresas</h3>
                      <p className="text-sm text-gray-500">Contrasta costo visible con cierre total del dato para no comparar empresas con distinta calidad de información.</p>
                    </div>
                    <div className="text-sm text-gray-500">{selectedSeason}</div>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-wide text-purple-700">{companyName}</div>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveTotalDataClosure.readiness.badge}`}>
                          <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveTotalDataClosure.readiness.dot}`} />
                          {executiveTotalDataClosure.readiness.title}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl bg-white/70 p-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Cierre total</div>
                          <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.totalClosurePct.toFixed(1)}%</div>
                        </div>
                        <div className="rounded-xl bg-white/70 p-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Bloqueos visibles</div>
                          <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveTotalDataClosure.blockers.length}</div>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4"><span>Gasto total</span><span className="font-semibold">{formatCLP(executiveViewData.kpis.totalSeasonCost)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Costo / Ha</span><span className="font-semibold">{formatCLP(executiveViewData.kpis.averageCostPerHa || 0)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Promedio mensual</span><span className="font-semibold">{formatCLP(executiveViewData.kpis.averageMonthlyCost)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Trazabilidad</span><span className="font-semibold">{executiveTotalDataClosure.traceabilityPct.toFixed(1)}%</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Soporte oficial</span><span className="font-semibold">{executiveTotalDataClosure.officialSupportPct.toFixed(1)}%</span></div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-wide text-slate-700">{executiveCompareCompanyName}</div>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveCompareCompanyTotalClosure.readiness.badge}`}>
                          <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveCompareCompanyTotalClosure.readiness.dot}`} />
                          {executiveCompareCompanyTotalClosure.readiness.title}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl bg-white/80 p-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Cierre total</div>
                          <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveCompareCompanyTotalClosure.totalClosurePct.toFixed(1)}%</div>
                        </div>
                        <div className="rounded-xl bg-white/80 p-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Bloqueos visibles</div>
                          <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveCompareCompanyTotalClosure.blockers.length}</div>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4"><span>Gasto total</span><span className="font-semibold">{formatCLP(executiveCompareCompanySummary.totalSeasonCost)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Costo / Ha</span><span className="font-semibold">{formatCLP(executiveCompareCompanySummary.averageCostPerHa || 0)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Promedio mensual</span><span className="font-semibold">{formatCLP(executiveCompareCompanySummary.averageMonthlyCost)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Trazabilidad</span><span className="font-semibold">{executiveCompareCompanyTotalClosure.traceabilityPct.toFixed(1)}%</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Soporte oficial</span><span className="font-semibold">{executiveCompareCompanyTotalClosure.officialSupportPct.toFixed(1)}%</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-6">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-sm font-medium text-slate-900">Brechas del cierre total</div>
                      <div className="mt-4 space-y-3">
                        {executiveCompareCompanyTotalClosureRows.map((row) => {
                          const isBlockerMetric = row.metric === 'Bloqueos visibles';
                          const currentBetter = isBlockerMetric ? row.gap <= 0 : row.gap >= 0;
                          const gapClass = Math.abs(row.gap) < 0.05
                            ? 'text-slate-600'
                            : currentBetter
                              ? 'text-emerald-600'
                              : 'text-red-600';
                          return (
                            <div key={row.metric} className="rounded-xl bg-slate-50 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="font-medium text-slate-900">{row.metric}</div>
                                  <div className="mt-1 text-sm text-slate-500">{companyName}: {formatExecutiveCompareMetric(row.currentValue, row.format)}</div>
                                  <div className="text-sm text-slate-500">{executiveCompareCompanyName}: {formatExecutiveCompareMetric(row.compareValue, row.format)}</div>
                                </div>
                                <div className={`text-right font-semibold ${gapClass}`}>
                                  {row.format === 'percent'
                                    ? `${row.gap.toFixed(1)} pp`
                                    : row.gap.toLocaleString('es-CL')}
                                  <div className="text-xs text-slate-500">Brecha actual - comparada</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                        <div className="font-medium text-slate-900">Lectura ejecutiva</div>
                        <p className="mt-2">{executiveCompareCompanyInsights.summaryLine}</p>
                        <p className="mt-2">{executiveCompareCompanyInsights.blockerNarrative}</p>
                        <p className="mt-2">
                          Mayor brecha actual: {executiveCompareCompanyInsights.strongestGap
                            ? `${executiveCompareCompanyInsights.strongestGap.metric} (${executiveCompareCompanyInsights.strongestGap.format === 'percent'
                              ? `${Math.abs(executiveCompareCompanyInsights.strongestGap.gap).toFixed(1)} pp`
                              : Math.abs(executiveCompareCompanyInsights.strongestGap.gap).toLocaleString('es-CL')
                            })`
                            : 'Sin brechas relevantes visibles'}.
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-sm font-medium text-slate-900">Bloqueos visibles</div>
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <div className="font-medium text-slate-700">{companyName}</div>
                            <div className="mt-2 space-y-2">
                              {executiveCompareCompanyInsights.currentBlockers.length > 0
                                ? executiveCompareCompanyInsights.currentBlockers.map((blocker) => (
                                    <div key={blocker} className="rounded-lg bg-purple-50 px-3 py-2 text-slate-700">{blocker}</div>
                                  ))
                                : <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">Sin bloqueos visibles.</div>}
                            </div>
                          </div>
                          <div>
                            <div className="font-medium text-slate-700">{executiveCompareCompanyName}</div>
                            <div className="mt-2 space-y-2">
                              {executiveCompareCompanyInsights.compareBlockers.length > 0
                                ? executiveCompareCompanyInsights.compareBlockers.map((blocker) => (
                                    <div key={blocker} className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{blocker}</div>
                                  ))
                                : <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">Sin bloqueos visibles.</div>}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                        <div className="font-medium text-slate-900">Contexto operativo comparado</div>
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center justify-between gap-4"><span>Campo con mayor presión actual</span><span className="font-medium text-slate-900">{executiveViewData.kpis.topField?.fieldName || '-'}</span></div>
                          <div className="flex items-center justify-between gap-4"><span>Campo con mayor presión comparado</span><span className="font-medium text-slate-900">{executiveCompareCompanySummary.topField?.fieldName || '-'}</span></div>
                          <div className="flex items-center justify-between gap-4"><span>Mes más alto actual</span><span className="font-medium text-slate-900">{executiveViewData.kpis.peakMonth ? `${executiveViewData.kpis.peakMonth.shortLabel} · ${formatCLP(executiveViewData.kpis.peakMonth.total)}` : '-'}</span></div>
                          <div className="flex items-center justify-between gap-4"><span>Mes más alto comparado</span><span className="font-medium text-slate-900">{executiveCompareCompanySummary.peakMonth ? `${executiveCompareCompanySummary.peakMonth.shortLabel} · ${formatCLP(executiveCompareCompanySummary.peakMonth.total)}` : '-'}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {executiveCompareCompanyRecommendation && (
                    <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className={`rounded-xl border p-4 ${executiveCurrentRecommendation.tone.badge}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{companyName}</div>
                          <span className="text-sm font-semibold">{executiveCurrentRecommendation.tone.title}</span>
                        </div>
                        <p className="mt-3 text-sm">{executiveCurrentRecommendation.summary}</p>
                        <p className="mt-2 text-sm">{executiveCurrentRecommendation.nextStep}</p>
                      </div>
                      <div className={`rounded-xl border p-4 ${executiveCompareCompanyRecommendation.tone.badge}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{executiveCompareCompanyName}</div>
                          <span className="text-sm font-semibold">{executiveCompareCompanyRecommendation.tone.title}</span>
                        </div>
                        <p className="mt-3 text-sm">{executiveCompareCompanyRecommendation.summary}</p>
                        <p className="mt-2 text-sm">{executiveCompareCompanyRecommendation.nextStep}</p>
                      </div>
                    </div>
                  )}
                  {executiveCompanyRankingComparison && (
                    <div className="mt-6 rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-4 py-4 border-b border-slate-200 bg-slate-50">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="text-sm font-medium text-slate-900">Ranking automático entre empresas</div>
                            <p className="text-sm text-slate-500">Pondera cierre total, tendencia y disciplina de bloqueos para ordenar la solidez ejecutiva de cada empresa.</p>
                          </div>
                          <div className="text-sm font-semibold text-slate-700">{executiveCompanyRankingComparison.summaryLine}</div>
                        </div>
                      </div>
                      <div className="p-4 grid grid-cols-1 xl:grid-cols-[1fr,0.9fr] gap-4">
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-white">
                              <tr>
                                <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Empresa</th>
                                <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Puntaje</th>
                                <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Cierre</th>
                                <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Tendencia</th>
                                <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Bloqueos</th>
                                <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Nivel</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                              {executiveCompanyRankingComparison.rows.map((row, index) => (
                                <tr key={row.companyLabel}>
                                  <td className="px-4 py-3 font-medium text-slate-900">{index + 1}. {row.companyLabel}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.score.toFixed(1)}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{row.components.closure.toFixed(1)}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{row.components.trend.toFixed(1)}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{row.components.blockers.toFixed(1)}</td>
                                  <td className="px-4 py-3">
                                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${row.tone.badge}`}>
                                      <span className={`mr-2 inline-block h-2 w-2 rounded-full ${row.tone.dot}`} />
                                      {row.tone.label}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="space-y-3">
                          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                            <div className="font-medium text-slate-900">Regla de ponderación</div>
                            <p className="mt-2">Cierre total 60%, tendencia 25% y disciplina de bloqueos 15%.</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                            <div className="font-medium text-slate-900">Lectura del líder</div>
                            <p className="mt-2">{executiveCompanyRankingComparison.rows[0]?.narrative}</p>
                          </div>
                          <div className="rounded-xl bg-slate-950 p-4 text-sm text-slate-200">
                            <div className="font-medium text-white">Resultado ejecutivo</div>
                            <p className="mt-2">{executiveCompanyRankingComparison.summaryLine}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {executiveCompareCompanyHistoryInsights && executiveCompareCompanyHistoryRows.length > 0 && (
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Historial comparado entre empresas</h3>
                        <p className="text-sm text-gray-500">Compara temporada por temporada qué empresa llega con mejor cierre total del dato hacia comité.</p>
                      </div>
                      <div className="text-sm text-slate-500">
                        {executiveCompareCompanyHistoryInsights.comparableRows.length} temporadas comparables
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Liderazgo histórico</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {executiveCompareCompanyHistoryInsights.currentLeadCount === executiveCompareCompanyHistoryInsights.compareLeadCount
                            ? 'Parejo'
                            : executiveCompareCompanyHistoryInsights.currentLeadCount > executiveCompareCompanyHistoryInsights.compareLeadCount
                              ? companyName
                              : executiveCompareCompanyName}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {companyName}: {executiveCompareCompanyHistoryInsights.currentLeadCount} · {executiveCompareCompanyName}: {executiveCompareCompanyHistoryInsights.compareLeadCount}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Mejor temporada actual</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {executiveCompareCompanyHistoryInsights.currentBest
                            ? `${executiveCompareCompanyHistoryInsights.currentBest.totalClosurePct.toFixed(1)}%`
                            : '-'}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{executiveCompareCompanyHistoryInsights.currentBest?.season || 'Sin datos'}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Mejor temporada comparada</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {executiveCompareCompanyHistoryInsights.compareBest
                            ? `${executiveCompareCompanyHistoryInsights.compareBest.totalClosurePct.toFixed(1)}%`
                            : '-'}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{executiveCompareCompanyHistoryInsights.compareBest?.season || 'Sin datos'}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Mayor brecha histórica</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {executiveCompareCompanyHistoryInsights.strongestHistoricalGap?.gap !== null && executiveCompareCompanyHistoryInsights.strongestHistoricalGap
                            ? `${Math.abs(executiveCompareCompanyHistoryInsights.strongestHistoricalGap.gap || 0).toFixed(1)} pp`
                            : '-'}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{executiveCompareCompanyHistoryInsights.strongestHistoricalGap?.season || 'Sin datos'}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                      <div className="font-medium text-slate-900">Lectura histórica</div>
                      <p className="mt-2">{executiveCompareCompanyHistoryInsights.summaryLine}</p>
                      <p className="mt-2">
                        Empates técnicos: {executiveCompareCompanyHistoryInsights.tiedCount}. Mayor apertura histórica: {executiveCompareCompanyHistoryInsights.strongestHistoricalGap
                          ? `${executiveCompareCompanyHistoryInsights.strongestHistoricalGap.season} con ${Math.abs(executiveCompareCompanyHistoryInsights.strongestHistoricalGap.gap || 0).toFixed(1)} pp`
                          : 'sin brecha comparable visible'}.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">Tendencia móvil · {companyName}</div>
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveCurrentCompanyTrend.tone.badge}`}>
                            <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveCurrentCompanyTrend.tone.dot}`} />
                            {executiveCurrentCompanyTrend.tone.label}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Ventana reciente</div>
                            <div className="mt-2 font-semibold text-slate-900">{executiveCurrentCompanyTrend.recentAvg.toFixed(1)}%</div>
                            <div className="text-xs text-slate-500">{executiveCurrentCompanyTrend.recentWindowLabel}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Ventana previa</div>
                            <div className="mt-2 font-semibold text-slate-900">{executiveCurrentCompanyTrend.previousAvg.toFixed(1)}%</div>
                            <div className="text-xs text-slate-500">{executiveCurrentCompanyTrend.previousWindowLabel}</div>
                          </div>
                        </div>
                        <p className={`mt-4 text-sm ${executiveCurrentCompanyTrend.tone.text}`}>{executiveCurrentCompanyTrend.narrative}</p>
                      </div>

                      {executiveCompareCompanyTrend && (
                        <div className="rounded-xl border border-slate-200 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">Tendencia móvil · {executiveCompareCompanyName}</div>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${executiveCompareCompanyTrend.tone.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveCompareCompanyTrend.tone.dot}`} />
                              {executiveCompareCompanyTrend.tone.label}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs uppercase tracking-wide text-slate-500">Ventana reciente</div>
                              <div className="mt-2 font-semibold text-slate-900">{executiveCompareCompanyTrend.recentAvg.toFixed(1)}%</div>
                              <div className="text-xs text-slate-500">{executiveCompareCompanyTrend.recentWindowLabel}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs uppercase tracking-wide text-slate-500">Ventana previa</div>
                              <div className="mt-2 font-semibold text-slate-900">{executiveCompareCompanyTrend.previousAvg.toFixed(1)}%</div>
                              <div className="text-xs text-slate-500">{executiveCompareCompanyTrend.previousWindowLabel}</div>
                            </div>
                          </div>
                          <p className={`mt-4 text-sm ${executiveCompareCompanyTrend.tone.text}`}>{executiveCompareCompanyTrend.narrative}</p>
                        </div>
                      )}
                    </div>

                    {executiveTrendComparisonInsights && (
                      <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
                        <div className="font-medium text-emerald-900">Comparación de pendiente</div>
                        <p className="mt-2">{executiveTrendComparisonInsights.leader}</p>
                        <p className="mt-2">{executiveTrendComparisonInsights.narrative}</p>
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Temporada</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">{companyName}</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">{executiveCompareCompanyName}</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Brecha</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Bloq. actual</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Bloq. comparada</th>
                            <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Lider</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {executiveCompareCompanyHistoryRows.map((row) => (
                            <tr key={row.season} className={row.season === selectedSeason ? 'bg-purple-50/50' : ''}>
                              <td className="px-4 py-3 font-medium text-slate-900">{row.season}</td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {row.current ? `${row.current.totalClosurePct.toFixed(1)}% · ${row.current.readinessTitle}` : 'Sin datos'}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {row.compare ? `${row.compare.totalClosurePct.toFixed(1)}% · ${row.compare.readinessTitle}` : 'Sin datos'}
                              </td>
                              <td className="px-4 py-3 text-right font-medium text-slate-900">
                                {row.gap === null ? '-' : `${row.gap.toFixed(1)} pp`}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">{row.current?.blockersCount ?? '-'}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{row.compare?.blockersCount ?? '-'}</td>
                              <td className="px-4 py-3 text-slate-700">{row.leader}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Bitácora de exportaciones bajo advertencia</h3>
                      <p className="text-sm text-gray-500">Permite auditoría interna de cuándo se exportó el reporte ejecutivo con alertas visibles, bajo qué formato y en qué contexto de cierre.</p>
                    </div>
                    <span className="text-sm text-slate-500">
                      {executiveExportWarningLoading
                        ? 'Cargando bitácora...'
                        : `${executiveExportWarningFilteredData.totalEvents} visibles de ${executiveExportWarningHistoryData.totalEvents} históricos`}
                    </span>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Formato</span>
                        <select
                          value={executiveExportWarningFormatFilter}
                          onChange={(e) => setExecutiveExportWarningFormatFilter(e.target.value as 'all' | 'pdf' | 'excel')}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                        >
                          {executiveExportWarningFormatOptions.map((option) => (
                            <option key={option} value={option}>
                              {option === 'all' ? 'Todos los formatos' : option.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Advertencia</span>
                        <select
                          value={executiveExportWarningTypeFilter}
                          onChange={(e) => setExecutiveExportWarningTypeFilter(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                        >
                          {executiveExportWarningTypeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option === 'all' ? 'Todas las advertencias' : formatExecutiveExportWarningType(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Emisor</span>
                        <select
                          value={executiveExportWarningActorFilter}
                          onChange={(e) => setExecutiveExportWarningActorFilter(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                        >
                          {executiveExportWarningActorOptions.map((option) => (
                            <option key={option} value={option}>
                              {option === 'all' ? 'Todos los emisores' : formatExecutiveExportActor(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 text-sm text-slate-500">
                      {executiveExportWarningFiltersLabel}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Eventos visibles</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveExportWarningFilteredData.totalEvents}</div>
                      <div className="mt-1 text-sm text-slate-500">Lectura resultante según filtros activos</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Temporada visible</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveExportWarningFilteredData.currentSeasonRows.length}</div>
                      <div className="mt-1 text-sm text-slate-500">{selectedSeason} con exportaciones advertidas visibles</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Formato dominante</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{executiveExportWarningFilteredData.dominantFormat}</div>
                      <div className="mt-1 text-sm text-slate-500">PDF: {executiveExportWarningFilteredData.byFormat.pdf} · Excel: {executiveExportWarningFilteredData.byFormat.excel}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Última exportación</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">
                        {executiveExportWarningFilteredData.latestEvent
                          ? `${executiveExportWarningFilteredData.latestEvent.export_format.toUpperCase()} · ${executiveExportWarningFilteredData.latestEvent.season}`
                          : 'Sin eventos'}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {executiveExportWarningFilteredData.latestEvent
                          ? `${executiveExportWarningFilteredData.latestEvent.readiness_title} · ${formatExecutiveExportActor(executiveExportWarningFilteredData.latestEvent.created_by)}`
                          : 'Aún sin exportaciones advertidas visibles'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                    <div className="font-medium text-slate-900">Lectura de auditoría interna</div>
                    <p className="mt-2">{executiveExportWarningFilteredData.summaryLine}</p>
                    <p className="mt-2">
                      {executiveExportWarningFilteredData.latestCurrentSeasonEvent
                        ? `La última exportación advertida visible de la temporada ocurrió el ${new Date(executiveExportWarningFilteredData.latestCurrentSeasonEvent.created_at).toLocaleString('es-CL')} en formato ${executiveExportWarningFilteredData.latestCurrentSeasonEvent.export_format.toUpperCase()} por ${formatExecutiveExportActor(executiveExportWarningFilteredData.latestCurrentSeasonEvent.created_by)}.`
                        : `La temporada ${selectedSeason} no registra exportaciones advertidas para los filtros actuales.`}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Temporada</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Eventos</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {executiveExportWarningFilteredData.seasonSummary.slice(0, 6).map((row) => (
                            <tr key={row.season} className={row.season === selectedSeason ? 'bg-purple-50/50' : ''}>
                              <td className="px-4 py-3 font-medium text-slate-900">{row.season}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{row.count}</td>
                            </tr>
                          ))}
                          {!executiveExportWarningLoading && executiveExportWarningFilteredData.seasonSummary.length === 0 && (
                            <tr>
                              <td colSpan={2} className="px-4 py-4 text-center text-sm text-slate-500">
                                No hay temporadas visibles para los filtros seleccionados.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Advertencia frecuente</th>
                            <th className="px-4 py-3 text-right font-medium uppercase tracking-wide text-slate-500">Veces</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {executiveExportWarningFilteredData.warningTypeSummary.slice(0, 6).map((row) => (
                            <tr key={row.type}>
                              <td className="px-4 py-3 text-slate-900">{formatExecutiveExportWarningType(row.type)}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{row.count}</td>
                            </tr>
                          ))}
                          {!executiveExportWarningLoading && executiveExportWarningFilteredData.warningTypeSummary.length === 0 && (
                            <tr>
                              <td colSpan={2} className="px-4 py-4 text-center text-sm text-slate-500">
                                No hay advertencias visibles para los filtros seleccionados.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Fecha</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Temporada</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Formato</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Emisor</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Estado</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Advertencias</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Campo</th>
                          <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">Empresa comparada</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {executiveExportWarningFilteredData.recentRows.map((row) => (
                          <tr key={row.id}>
                            <td className="px-4 py-3 text-slate-700">{new Date(row.created_at).toLocaleString('es-CL')}</td>
                            <td className="px-4 py-3 font-medium text-slate-900">{row.season}</td>
                            <td className="px-4 py-3 text-slate-700">{row.export_format.toUpperCase()}</td>
                            <td className="px-4 py-3 text-slate-700">{formatExecutiveExportActor(row.created_by)}</td>
                            <td className="px-4 py-3 text-slate-700">{row.readiness_title}</td>
                            <td className="px-4 py-3 text-slate-700">{(row.warning_types || []).map((item) => formatExecutiveExportWarningType(item)).join(', ') || 'Sin detalle'}</td>
                            <td className="px-4 py-3 text-slate-700">{row.field_label || 'Todos los campos'}</td>
                            <td className="px-4 py-3 text-slate-700">{row.compare_company_name || 'Sin comparar'}</td>
                          </tr>
                        ))}
                        {!executiveExportWarningLoading && executiveExportWarningFilteredData.recentRows.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-4 text-center text-sm text-slate-500">
                              No hay exportaciones bajo advertencia para los filtros seleccionados.
                            </td>
                          </tr>
                        )}
                        {executiveExportWarningLoading && (
                          <tr>
                            <td colSpan={8} className="px-4 py-4 text-center text-sm text-slate-500">
                              Cargando bitácora histórica de exportaciones...
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {executiveFieldComparison && (
                <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Comparacion lado a lado entre campos</h3>
                      <p className="text-sm text-gray-500">Sirve para defender en comite por que un campo presiona mas costo, presupuesto o eficiencia que otro.</p>
                    </div>
                    <div className="text-sm text-gray-500">
                      Orden activo campos: {EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveFieldSortBy)?.label || executiveFieldSortBy}
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
                      <div className="text-xs uppercase tracking-wide text-purple-700">Campo A</div>
                      <div className="mt-2 text-xl font-semibold text-slate-900">{executiveFieldComparison.fieldA.fieldName}</div>
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4"><span>Gasto total</span><span className="font-semibold">{formatCLP(executiveFieldComparison.fieldA.total)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Desviacion ppto</span><span className={`font-semibold ${Number((executiveFieldComparison.fieldA as any).budgetDelta || 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCLP(Number((executiveFieldComparison.fieldA as any).budgetDelta || 0))}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Costo / Ha</span><span className="font-semibold">{formatCLP(Number((executiveFieldComparison.fieldA as any).costPerHa || 0))}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Costo / Kg</span><span className="font-semibold">{Number((executiveFieldComparison.fieldA as any).costPerKg || 0) > 0 ? formatCLP(Number((executiveFieldComparison.fieldA as any).costPerKg || 0)) : '-'}</span></div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <div className="text-xs uppercase tracking-wide text-slate-700">Campo B</div>
                      <div className="mt-2 text-xl font-semibold text-slate-900">{executiveFieldComparison.fieldB.fieldName}</div>
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4"><span>Gasto total</span><span className="font-semibold">{formatCLP(executiveFieldComparison.fieldB.total)}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Desviacion ppto</span><span className={`font-semibold ${Number((executiveFieldComparison.fieldB as any).budgetDelta || 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCLP(Number((executiveFieldComparison.fieldB as any).budgetDelta || 0))}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Costo / Ha</span><span className="font-semibold">{formatCLP(Number((executiveFieldComparison.fieldB as any).costPerHa || 0))}</span></div>
                        <div className="flex items-center justify-between gap-4"><span>Costo / Kg</span><span className="font-semibold">{Number((executiveFieldComparison.fieldB as any).costPerKg || 0) > 0 ? formatCLP(Number((executiveFieldComparison.fieldB as any).costPerKg || 0)) : '-'}</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-6">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-sm font-medium text-slate-900">Evolucion mensual comparada</div>
                      <div className="mt-4 h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={executiveFieldComparison.monthlyRows}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="monthLabel" />
                            <YAxis tickFormatter={(value) => formatCLP(Number(value))} />
                            <Tooltip formatter={(value) => formatCLP(Number(value))} />
                            <Legend />
                            <Bar dataKey="fieldATotal" name={executiveFieldComparison.fieldA.fieldName} fill="#7c3aed" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="fieldBTotal" name={executiveFieldComparison.fieldB.fieldName} fill="#0f172a" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-sm font-medium text-slate-900">Brechas ejecutivas</div>
                      <div className="mt-4 space-y-3">
                        {executiveFieldComparison.comparisonRows.map((row) => (
                          <div key={row.metric} className="rounded-xl bg-slate-50 p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="font-medium text-slate-900">{row.metric}</div>
                                <div className="mt-1 text-sm text-slate-500">
                                  {executiveFieldComparison.fieldA.fieldName}: {row.format === 'percent'
                                    ? `${row.fieldAValue.toFixed(1)}%`
                                    : row.format === 'number'
                                      ? row.fieldAValue.toLocaleString('es-CL')
                                      : row.format === 'currency_optional' && row.fieldAValue <= 0
                                        ? '-'
                                        : formatCLP(row.fieldAValue)}
                                </div>
                                <div className="text-sm text-slate-500">
                                  {executiveFieldComparison.fieldB.fieldName}: {row.format === 'percent'
                                    ? `${row.fieldBValue.toFixed(1)}%`
                                    : row.format === 'number'
                                      ? row.fieldBValue.toLocaleString('es-CL')
                                      : row.format === 'currency_optional' && row.fieldBValue <= 0
                                        ? '-'
                                        : formatCLP(row.fieldBValue)}
                                </div>
                              </div>
                              <div className={`text-right font-semibold ${row.gap >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {row.format === 'percent'
                                  ? `${row.gap.toFixed(1)}%`
                                  : row.format === 'number'
                                    ? row.gap.toLocaleString('es-CL')
                                    : row.format === 'currency_optional' && Math.abs(row.gap) <= 0
                                      ? '-'
                                      : formatCLP(row.gap)}
                                <div className="text-xs text-slate-500">Brecha A - B</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                        {executiveFieldComparison.narrative}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Evolución mensual</h3>
                      <p className="text-sm text-gray-500">Total consolidado por mes de la temporada.</p>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      <div>Mes más alto</div>
                      <div className="font-semibold text-gray-900">
                        {executiveViewData.kpis.peakMonth ? `${executiveViewData.kpis.peakMonth.shortLabel} · ${formatCLP(executiveViewData.kpis.peakMonth.total)}` : '-'}
                      </div>
                    </div>
                  </div>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={executiveViewData.monthlyRows}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="shortLabel" />
                        <YAxis tickFormatter={(value) => formatCLP(Number(value))} />
                        <Tooltip formatter={(value) => formatCLP(Number(value))} />
                        <Bar dataKey="total" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Participación por categoría</h3>
                    <p className="text-sm text-gray-500">Distribución consolidada de costos de la temporada.</p>
                  </div>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={executiveViewData.categoryRows}
                          dataKey="total"
                          nameKey="category"
                          cx="50%"
                          cy="50%"
                          outerRadius={110}
                          label={({ name, percent }) => `${String(name || '')} ${(((percent || 0) as number) * 100).toFixed(0)}%`}
                        >
                          {executiveViewData.categoryRows.map((entry, index) => (
                            <Cell key={`${entry.category}-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCLP(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Drivers de variación por categoría</h3>
                    <p className="text-sm text-gray-500">Qué categorías explican la subida o baja frente a la temporada comparativa.</p>
                  </div>
                  <div className="p-4 space-y-3">
                    {executiveCategoryComparisonRows.map((row) => (
                      <div key={row.category} className="rounded-xl bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="font-medium text-slate-900">{row.category}</div>
                            <div className="text-sm text-slate-500">{formatCLP(row.previous)} -&gt; {formatCLP(row.current)}</div>
                          </div>
                          <div className={`text-right font-semibold ${row.delta >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCLP(row.delta)}
                            <div className="text-xs">{row.deltaPct.toFixed(1)}%</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Heatmap de costos por campo y mes</h3>
                    <p className="text-sm text-gray-500">Permite detectar rápidamente meses y campos con mayor intensidad de gasto.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">Campo</th>
                          {executiveSeasonMonths.map((month) => (
                            <th key={month.key} className="px-4 py-3 text-center font-medium text-gray-500 uppercase">{month.shortLabel}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {executiveViewData.fieldRows.map((row) => (
                          <tr key={row.fieldId}>
                            <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white">{row.fieldName}</td>
                            {executiveSeasonMonths.map((month) => {
                              const value = Number(row.months[month.key] || 0);
                              const opacity = executiveHeatmapMax > 0 ? Math.max(0.12, value / executiveHeatmapMax) : 0;
                              return (
                                <td key={month.key} className="px-2 py-3 text-center">
                                  <div
                                    className="rounded-lg px-2 py-2 text-xs font-medium text-slate-900"
                                    style={{ backgroundColor: `rgba(124, 58, 237, ${opacity})` }}
                                  >
                                    {value > 0 ? formatCLP(value) : '-'}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden print:break-before-page">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Resumen mensual ejecutivo</h3>
                  <p className="text-sm text-gray-500">Incluye comparación contra la temporada anterior y concentración del gasto.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Mes</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-500 uppercase">Semáforo</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Actual</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">{previousExecutiveSeason}</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Vs anterior</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Vs anterior %</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Campo mayor gasto</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase">Sector mayor gasto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executiveViewData.monthlyRows.map((row) => (
                        <tr key={row.monthKey}>
                          <td className="px-4 py-3 text-gray-900">{row.monthLabel}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getExecutiveTone(Math.abs(row.vsPreviousSeasonPct)).badge}`}>
                              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${getExecutiveTone(Math.abs(row.vsPreviousSeasonPct)).dot}`} />
                              {getExecutiveTone(Math.abs(row.vsPreviousSeasonPct)).label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCLP(row.total)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.previousSeasonTotal)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${row.vsPreviousSeason >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCLP(row.vsPreviousSeason)}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium ${row.vsPreviousSeason >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {row.vsPreviousSeasonPct.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-gray-700">{row.topFieldName}</td>
                          <td className="px-4 py-3 text-gray-700">{row.topSectorName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 print:break-before-page">
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Alertas ejecutivas</h3>
                    <p className="text-sm text-gray-500">Variaciones relevantes que merecen revisión con el equipo.</p>
                  </div>
                  <div className="p-4 space-y-3">
                    {executiveViewData.alerts.length > 0 ? executiveViewData.alerts.map((alert, index) => (
                      <div key={`${alert.title}-${index}`} className={`rounded-lg border p-4 ${alert.level === 'alta' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="font-medium text-gray-900">{alert.title}</div>
                            <div className="text-sm text-gray-600">{alert.message}</div>
                          </div>
                          <div className="text-right">
                            <div className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getExecutiveTone(alert.level === 'alta' ? 35 : 20).badge}`}>
                              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${getExecutiveTone(alert.level === 'alta' ? 35 : 20).dot}`} />
                              {getExecutiveTone(alert.level === 'alta' ? 35 : 20).label}
                            </div>
                            <div className={`mt-2 text-sm font-semibold ${alert.level === 'alta' ? 'text-red-700' : 'text-amber-700'}`}>
                              {formatCLP(alert.amount)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                        No se detectan alertas relevantes para la temporada seleccionada.
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Top focos de gasto</h3>
                    <p className="text-sm text-gray-500">Campos y sectores que concentran la mayor parte del costo.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 p-4">
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-700">Top 5 campos</div>
                      <div className="mb-3 text-xs text-gray-500">Ordenados por {EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveFieldSortBy)?.label || executiveFieldSortBy}.</div>
                      <div className="space-y-2">
                        {executiveViewData.topFields.map((row, index) => (
                          <div key={row.fieldId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                            <div className="text-sm text-gray-900">{index + 1}. {row.fieldName}</div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-gray-900">{formatCLP(row.total)} · {row.sharePct.toFixed(1)}%</div>
                              <div className={`text-xs ${getExecutiveTone(Math.abs(row.deltaPct)).text}`}>{row.deltaPct.toFixed(1)}% vs anterior</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-700">Top 5 sectores</div>
                      <div className="mb-3 text-xs text-gray-500">Ordenados por {EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveSectorSortBy)?.label || executiveSectorSortBy}.</div>
                      <div className="space-y-2">
                        {executiveViewData.topSectors.map((row, index) => (
                          <div key={row.sectorId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                            <div className="text-sm text-gray-900">{index + 1}. {row.fieldName} / {row.sectorName}</div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-gray-900">{formatCLP(row.total)} · {row.sharePct.toFixed(1)}%</div>
                              <div className={`text-xs ${getExecutiveTone(Math.abs(row.deltaPct)).text}`}>{row.deltaPct.toFixed(1)}% vs anterior</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden print:break-before-page">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Gasto mes a mes por campo</h3>
                  <p className="text-sm text-gray-500">Matriz ejecutiva lista para imprimir y presentar, con comparación total por temporada.</p>
                  <div className="mt-2 text-xs text-gray-500">Filas ordenadas por {EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveFieldSortBy)?.label || executiveFieldSortBy}.</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">Campo</th>
                        {executiveSeasonMonths.map((month) => (
                          <th key={month.key} className="px-4 py-3 text-right font-medium text-gray-500 uppercase">{month.shortLabel}</th>
                        ))}
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Ppto</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Costo/Ha</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Costo/Kg</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">{previousExecutiveSeason}</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Var %</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executiveViewData.fieldRows.map((row) => (
                        <tr key={row.fieldId}>
                          <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white">{row.fieldName}</td>
                          {executiveSeasonMonths.map((month) => (
                            <td key={month.key} className="px-4 py-3 text-right text-gray-700">
                              {formatCLP(row.months[month.key] || 0)}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.budgetTotal || 0)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.costPerHa || 0)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{row.costPerKg ? formatCLP(row.costPerKg) : '-'}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.previousTotal)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${row.delta >= 0 ? 'text-red-600' : 'text-green-600'}`}>{row.deltaPct.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCLP(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden print:break-before-page">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Gasto mes a mes por sector</h3>
                  <p className="text-sm text-gray-500">Detalle ejecutivo resumido por sector y campo, con comparación acumulada.</p>
                  <div className="mt-2 text-xs text-gray-500">Filas ordenadas por {EXECUTIVE_SORT_OPTIONS.find((item) => item.value === executiveSectorSortBy)?.label || executiveSectorSortBy}.</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">Campo</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase sticky left-[120px] bg-gray-50">Sector</th>
                        {executiveSeasonMonths.map((month) => (
                          <th key={month.key} className="px-4 py-3 text-right font-medium text-gray-500 uppercase">{month.shortLabel}</th>
                        ))}
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Ppto</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Costo/Ha</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Costo/Kg</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">{previousExecutiveSeason}</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Var %</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {executiveViewData.sectorRows.map((row) => (
                        <tr key={row.sectorId}>
                          <td className="px-4 py-3 text-gray-700 sticky left-0 bg-white">{row.fieldName}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 sticky left-[120px] bg-white">{row.sectorName}</td>
                          {executiveSeasonMonths.map((month) => (
                            <td key={month.key} className="px-4 py-3 text-right text-gray-700">
                              {formatCLP(row.months[month.key] || 0)}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.budgetTotal || 0)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.costPerHa || 0)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{row.costPerKg ? formatCLP(row.costPerKg) : '-'}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCLP(row.previousTotal)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${row.delta >= 0 ? 'text-red-600' : 'text-green-600'}`}>{row.deltaPct.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCLP(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow p-6 print:break-before-page">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Cierre ejecutivo</div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-900">Conclusión para presentación</h3>
                    <p className="mt-4 text-sm leading-6 text-slate-700">{executiveInsights.conclusion}</p>
                    <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      Recomendación: presentar primero esta conclusión, luego revisar alertas, después validar el top de campos/sectores y finalmente abrir las matrices mensuales como respaldo.
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Aprobación / Firma</div>
                    <div className="mt-6 space-y-5">
                      <div>
                        <div className="h-10 border-b border-slate-300" />
                        <div className="mt-2 text-sm text-slate-500">Nombre y cargo</div>
                      </div>
                      <div>
                        <div className="h-10 border-b border-slate-300" />
                        <div className="mt-2 text-sm text-slate-500">Observaciones ejecutivas</div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="h-10 border-b border-slate-300" />
                          <div className="mt-2 text-sm text-slate-500">Fecha</div>
                        </div>
                        <div>
                          <div className="h-10 border-b border-slate-300" />
                          <div className="mt-2 text-sm text-slate-500">Firma</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 8. BUDGET & SALES REPORT (NEW) */}
          {activeTab === 'budget' && (
            <div className="space-y-6">
                {/* Settings for Budget - Exchange Rate */}
                 <div className="bg-white p-4 rounded-lg shadow border border-gray-200 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900">Configuración de Cálculo</h3>
                        <p className="text-sm text-gray-500">Defina el tipo de cambio para los cálculos automáticos de ventas</p>
                    </div>
                    <div className="flex items-center gap-4">
                         <label className="text-sm font-medium text-gray-700">Dólar (CLP/USD):</label>
                         <input
                             type="number"
                             value={usdExchangeRate}
                             onChange={(e) => setUsdExchangeRate(Number(e.target.value))}
                             className="w-28 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm text-right"
                         />
                    </div>
                 </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                        <div className="flex items-center">
                            <div className="p-3 rounded-full bg-green-100 text-green-600">
                                <DollarSign className="h-6 w-6" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-500">Ingresos / Presupuesto</p>
                                <p className="text-2xl font-semibold text-gray-900">
                                    {formatCLP(incomeEntries.reduce((sum, i) => sum + i.amount, 0))}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
                        <div className="flex items-center">
                            <div className="p-3 rounded-full bg-red-100 text-red-600">
                                <Scale className="h-6 w-6" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-500">Gastos Totales</p>
                                <p className="text-2xl font-semibold text-gray-900">
                                    {formatCLP(monthlyExpenses.reduce((sum, m) => sum + m.total, 0))}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                        <div className="flex items-center">
                            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                                <PieChartIcon className="h-6 w-6" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-500">Balance / Saldo</p>
                                <p className={`text-2xl font-semibold ${
                                    (incomeEntries.reduce((sum, i) => sum + i.amount, 0) - monthlyExpenses.reduce((sum, m) => sum + m.total, 0)) >= 0 
                                    ? 'text-green-600' : 'text-red-600'
                                }`}>
                                    {formatCLP(incomeEntries.reduce((sum, i) => sum + i.amount, 0) - monthlyExpenses.reduce((sum, m) => sum + m.total, 0))}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Summary by Sector Table */}
                <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center">
                        <div>
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Resumen por Campo</h3>
                            <p className="mt-1 text-sm text-gray-500">Kilos enviados y valores totales</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Has</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Kilos (Kg)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ingresos (USD)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ingresos (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Directos (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Total (USD)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Total (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance (USD)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Promedio USD/Kg</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {(() => {
                                    const totalInvoices = monthlyExpenses.reduce((sum, m) => sum + m.total, 0);
                                    const totalAllocated = reportData.reduce((sum, r) => sum + r.total_cost, 0);
                                    const totalHectares = reportData.reduce((sum, r) => sum + r.hectares, 0);
                                    const unassignedCost = Math.max(0, totalInvoices - totalAllocated);
                                    const distributionFactor = totalHectares > 0 ? unassignedCost / totalHectares : 0;

                                    const sectorToField = new Map<string, string>();
                                    const fieldIdToField = new Map<string, string>();
                                    (rawFields || []).forEach((f: any) => {
                                        if (f?.id) fieldIdToField.set(String(f.id), String(f.name || ''));
                                        (f?.sectors || []).forEach((s: any) => {
                                            if (s?.id) sectorToField.set(String(s.id), String(f.name || ''));
                                        });
                                    });

                                    let companyIncomeKg = 0;
                                    let companyIncomeUsd = 0;
                                    let companyIncomeClp = 0;

                                    const incomeMap = incomeEntries.reduce((acc, entry) => {
                                        const fieldName =
                                            (entry.field_id ? fieldIdToField.get(String(entry.field_id)) : null) ||
                                            (entry.sector_id ? sectorToField.get(String(entry.sector_id)) : null) ||
                                            String(entry.fields?.name || '');

                                        if (!fieldName) {
                                            companyIncomeKg += Number(entry.quantity_kg || 0);
                                            companyIncomeUsd += Number(entry.amount_usd || 0);
                                            companyIncomeClp += Number(entry.amount || 0);
                                            return acc;
                                        }

                                        const key = fieldName;
                                        if (!acc[key]) acc[key] = { name: fieldName, kg: 0, usd: 0, clp: 0 };
                                        acc[key].kg += Number(entry.quantity_kg || 0);
                                        acc[key].usd += Number(entry.amount_usd || 0);
                                        acc[key].clp += Number(entry.amount || 0);
                                        return acc;
                                    }, {} as Record<string, { name: string, kg: number, usd: number, clp: number }>);

                                    const expenseMap = reportData.reduce((acc, r) => {
                                        const key = String(r.field_name || '');
                                        if (!key) return acc;
                                        const direct = Number(r.total_cost || 0);
                                        const hectares = Number(r.hectares || 0);
                                        const prev = acc[key] || { direct: 0, distributed: 0, total: 0, hectares: 0 };
                                        const nextDirect = prev.direct + direct;
                                        const nextHectares = prev.hectares + hectares;
                                        const nextDistributed = nextHectares * distributionFactor;
                                        acc[key] = {
                                            direct: nextDirect,
                                            distributed: nextDistributed,
                                            total: nextDirect + nextDistributed,
                                            hectares: nextHectares
                                        };
                                        return acc;
                                    }, {} as Record<string, { direct: number, distributed: number, total: number, hectares: number }>);

                                    const allKeysSet = new Set([...Object.keys(incomeMap), ...Object.keys(expenseMap)]);
                                    const allKeys = Array.from(allKeysSet);
                                    
                                    const rows = allKeys.map(key => {
                                        const inc = incomeMap[key] || { name: key, kg: 0, usd: 0, clp: 0 };
                                        const expData = expenseMap[key] || { direct: 0, distributed: 0, total: 0, hectares: 0 };
                                        
                                        let displayName = inc.name;
                                        if (!displayName) displayName = key;

                                        const finalExpense = expData.total;

                                        return {
                                            name: displayName,
                                            hectares: expData.hectares,
                                            kg: inc.kg,
                                            usd: inc.usd,
                                            income: inc.clp,
                                            expenseDirect: expData.direct,
                                            expenseDistributed: expData.distributed,
                                            expenseTotal: finalExpense,
                                            balance: inc.clp - finalExpense
                                        };
                                    }).sort((a, b) => b.income - a.income);

                                    if (companyIncomeClp !== 0 || companyIncomeUsd !== 0 || companyIncomeKg !== 0) {
                                        const keys = rows.map((r) => r.name);
                                        const eligible = rows.filter((r) => r.hectares > 0);
                                        const totalHas = eligible.reduce((sum, r) => sum + r.hectares, 0);
                                        if (totalHas > 0 && keys.length > 0) {
                                            rows.forEach((r) => {
                                                if (r.hectares <= 0) return;
                                                const ratio = r.hectares / totalHas;
                                                r.kg += companyIncomeKg * ratio;
                                                r.usd += companyIncomeUsd * ratio;
                                                r.income += companyIncomeClp * ratio;
                                                r.balance = r.income - r.expenseTotal;
                                            });
                                        }
                                    }

                                    const totalKg = rows.reduce((sum, r) => sum + r.kg, 0);
                                    const totalUsd = rows.reduce((sum, r) => sum + r.usd, 0);
                                    const totalIncome = rows.reduce((sum, r) => sum + r.income, 0);
                                    const totalExpenseDirect = rows.reduce((sum, r) => sum + r.expenseDirect, 0);
                                    const totalExpenseDistributed = rows.reduce((sum, r) => sum + r.expenseDistributed, 0);
                                    const totalExpense = rows.reduce((sum, r) => sum + r.expenseTotal, 0);

                                    return (
                                        <>
                                            {rows.map((row, idx) => (
                                                <tr key={idx}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{row.hectares > 0 ? row.hectares : '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{row.kg.toLocaleString('es-CL')}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-700 font-medium">${row.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(row.income)}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.expenseDirect)}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-700 font-medium">${(row.expenseTotal / (usdExchangeRate || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-bold">{formatCLP(row.expenseTotal)}</td>
                                                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${row.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                        ${(row.balance / (usdExchangeRate || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>
                                                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${row.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                        {formatCLP(row.balance)}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500 font-medium">
                                                        {row.kg > 0 ? `$${(row.usd / row.kg).toFixed(2)}` : '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">-</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{totalKg.toLocaleString('es-CL')}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-700">${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalIncome)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(totalExpenseDirect)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-700 font-medium">${(totalExpense / (usdExchangeRate || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-bold">{formatCLP(totalExpense)}</td>
                                                <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${totalIncome - totalExpense >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                    ${((totalIncome - totalExpense) / (usdExchangeRate || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${totalIncome - totalExpense >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                    {formatCLP(totalIncome - totalExpense)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                                                    {totalKg > 0 ? `$${(totalUsd / totalKg).toFixed(2)}` : '-'}
                                                </td>
                                            </tr>
                                        </>
                                    );
                                })()}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Chart: Income vs Expenses */}
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Flujo de Caja Mensual ({selectedSeason})</h3>
                    <div className="h-96 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={monthlyExpenses.map(m => {
                                    // Calculate income for this month
                                    const monthIncome = incomeEntries
                                        .filter(i => {
                                            const d = new Date(i.date);
                                            const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
                                            const key = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
                                            return key === m.month;
                                        })
                                        .reduce((sum, i) => sum + i.amount, 0);
                                    return {
                                        month: m.month,
                                        gastos: m.total,
                                        ingresos: monthIncome
                                    };
                                })}
                                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" />
                                <YAxis tickFormatter={(value) => formatCLP(value)} />
                                <Tooltip formatter={(value) => formatCLP(Number(value))} />
                                <Legend />
                                <Bar dataKey="ingresos" name="Ingresos / Presupuesto" fill="#10B981" />
                                <Bar dataKey="gastos" name="Gastos Reales" fill="#EF4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Income Table */}
                <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
                        <div>
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Registro de Ingresos y Presupuesto</h3>
                            <p className="mt-1 text-sm text-gray-500">Ventas de fruta, exportaciones y presupuesto asignado</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descripción</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo / Sector</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Kilos (Kg)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">USD</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Monto (CLP)</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {incomeEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No hay ingresos registrados.</td>
                                    </tr>
                                ) : (
                                    incomeEntries.map((entry) => (
                                        <tr key={entry.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(entry.date + 'T12:00:00').toLocaleDateString('es-CL')}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                    entry.category === 'Presupuesto' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                                                }`}>
                                                    {entry.category}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-500">{entry.description}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {entry.fields?.name || '-'} {entry.sectors?.name ? `/ ${entry.sectors.name}` : ''}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{(entry.quantity_kg || 0).toLocaleString('es-CL')}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">${(entry.amount_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-green-700">{formatCLP(entry.amount)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
          )}

          {/* 0. GENERAL REPORT (NEW) */}
      {activeTab === 'general' && (
        <div className="space-y-6">
            {/* Settings Card */}
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-gray-900 flex items-center">
                        <Settings className="mr-2 h-5 w-5 text-gray-500" />
                        Configuración de Reporte
                    </h3>
                </div>
                <div className="flex items-center gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Cambio (CLP/USD)</label>
                        <div className="relative rounded-md shadow-sm w-40">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <DollarSign className="h-4 w-4 text-gray-400" />
                            </div>
                            <input
                                type="number"
                                value={usdExchangeRate}
                                onChange={(e) => setUsdExchangeRate(Number(e.target.value))}
                                className="focus:ring-green-500 focus:border-green-500 block w-full pl-9 sm:text-sm border-gray-300 rounded-md"
                            />
                        </div>
                    </div>
                    <div className="text-sm text-gray-500 pt-6">
                        * Los Kilos y Precios provienen del módulo "Liquidaciones".
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <div className="flex justify-between items-center px-4 py-5 sm:px-6 border-b border-gray-200">
                  <div>
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Costos Generales y Producción ({selectedSeason})</h3>
                    <p className="mt-1 text-sm text-gray-500">Resumen por Sector incluyendo Labores y Aplicaciones</p>
                  </div>
                  <button
                      onClick={() => {
                          const rows = [['Campo', 'Sector', 'Has', 'Prod. (Kg)', 'Kg Exportados', 'Precio Exportación (USD/Kg)', 'Kg Jugo/Pulpa', 'Precio Jugo/Pulpa (USD/Kg)', 'Mano Obra', 'Personal', 'Aplicaciones', 'Maquinaria', 'Riego', 'Petróleo', 'Combustible (Bencina)', 'Otros', 'Total (CLP)', 'Total (USD)', 'Costo/Ha (CLP)', 'Costo/Ha (USD)', 'Costo/Kg (CLP)', 'Costo/Kg (USD)']];
                          reportData.forEach(row => {
                              const costUsd = row.total_cost / (usdExchangeRate || 1);
                              const costPerHaUsd = row.cost_per_ha / (usdExchangeRate || 1);
                              const costPerKgClp = (row.kg_produced || 0) > 0 ? row.total_cost / row.kg_produced! : 0;
                              const costPerKgUsd = (row.kg_produced || 0) > 0 ? costUsd / row.kg_produced! : 0;
                              rows.push([
                                  row.field_name,
                                  row.sector_name,
                                  row.hectares.toString(),
                                  (row.kg_produced || 0).toString(),
                                  String(row.kg_export || 0),
                                  String(row.price_export || 0),
                                  String(row.kg_jugo || 0),
                                  String(row.price_jugo || 0),
                                  row.labor_cost.toString(),
                                  row.worker_cost.toString(),
                                  row.app_cost_only.toString(),
                                  row.machinery_cost.toString(),
                                  row.irrigation_cost.toString(),
                                  row.fuel_cost_diesel.toString(),
                                  row.fuel_cost_gasoline.toString(),
                                  row.general_cost.toString(),
                                  row.total_cost.toString(),
                                  costUsd.toFixed(2),
                                  row.cost_per_ha.toString(),
                                  costPerHaUsd.toFixed(2),
                                  costPerKgClp.toFixed(2),
                                  costPerKgUsd.toFixed(2)
                              ]);
                          });
                          const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
                          const encodedUri = encodeURI(csvContent);
                          const link = document.createElement("a");
                          link.setAttribute("href", encodedUri);
                          link.setAttribute("download", `Costos_Generales_${companySlug}_${selectedSeason}.csv`);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                      }}
                      className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200"
                  >
                      <FileText className="mr-1.5 h-4 w-4" /> Exportar a CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo / Sector</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Has</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-green-50">Prod. (Kg)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Mano Obra</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Personal</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Aplicaciones</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Maquinaria</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Riego</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Petróleo</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Combustible (Bencina)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Otros</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total (CLP)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total (USD)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo/Ha (CLP)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo/Ha (USD)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo/Kg (CLP)</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo/Kg (USD)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportData.map((row, index) => {
                          const costUsd = row.total_cost / (usdExchangeRate || 1);
                          const costPerHaUsd = row.cost_per_ha / (usdExchangeRate || 1);
                          const costPerKgClp = (row.kg_produced || 0) > 0 ? row.total_cost / row.kg_produced! : 0;
                          const costPerKgUsd = (row.kg_produced || 0) > 0 ? costUsd / row.kg_produced! : 0;

                          return (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="text-sm font-medium text-gray-900">{row.sector_name}</div>
                                  <div className="text-xs text-gray-500">{row.field_name}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{row.hectares}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right bg-green-50">
                                  <div className="flex flex-col items-end gap-1">
                                      <span className="font-medium text-gray-900">{(row.kg_produced || 0).toLocaleString('es-CL')} Kg</span>
                                      {Number(row.kg_export || 0) > 0 && (
                                        <span className="text-xs text-green-700 font-medium">
                                          Exportados: {(row.kg_export || 0).toLocaleString('es-CL')} Kg · US$ {(row.price_export || 0).toFixed(2)}/Kg
                                        </span>
                                      )}
                                      {Number(row.kg_jugo || 0) > 0 && (
                                        <span className="text-xs text-emerald-700 font-medium">
                                          Jugo/Pulpa: {(row.kg_jugo || 0).toLocaleString('es-CL')} Kg · US$ {(row.price_jugo || 0).toFixed(2)}/Kg
                                        </span>
                                      )}
                                  </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-gray-600">{formatCLP(row.labor_cost)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-indigo-600">{formatCLP(row.worker_cost)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-blue-600">{formatCLP(row.app_cost_only)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-orange-600">{formatCLP(row.machinery_cost)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-cyan-600">{formatCLP(row.irrigation_cost)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-purple-600">{formatCLP(row.fuel_cost_diesel)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-purple-800">{formatCLP(row.fuel_cost_gasoline)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-gray-600">{formatCLP(row.general_cost)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900">{formatCLP(row.total_cost)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">${costUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{formatCLP(row.cost_per_ha)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-600">${costPerHaUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-600">
                                  {costPerKgClp > 0 ? formatCLP(costPerKgClp) : '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-800">
                                  {costPerKgUsd > 0 ? `$${costPerKgUsd.toFixed(2)}` : '-'}
                              </td>
                            </tr>
                          );
                      })}
                    </tbody>
                  </table>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'costs_ha' && (
        <div className="space-y-6">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="flex justify-between items-center px-4 py-5 sm:px-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">Costos por Hectárea ({selectedSeason})</h3>
                <p className="mt-1 text-sm text-gray-500">Desglose por rubro (CLP/ha) y total por sector</p>
              </div>
              <button
                onClick={() => {
                  const rows = [['Campo', 'Sector', 'Has', 'Aplic/Ha', 'Mano Obra/Ha', 'Personal/Ha', 'Maq/Ha', 'Riego/Ha', 'Diésel/Ha', 'Bencina/Ha', 'Otros/Ha', 'Total/Ha', 'Total (CLP)']];
                  reportData.forEach((row) => {
                    const ha = row.hectares || 1;
                    rows.push([
                      row.field_name,
                      row.sector_name,
                      row.hectares.toString(),
                      (row.app_cost_only / ha).toFixed(2),
                      (row.labor_cost / ha).toFixed(2),
                      (row.worker_cost / ha).toFixed(2),
                      (row.machinery_cost / ha).toFixed(2),
                      (row.irrigation_cost / ha).toFixed(2),
                      (row.fuel_cost_diesel / ha).toFixed(2),
                      (row.fuel_cost_gasoline / ha).toFixed(2),
                      (row.general_cost / ha).toFixed(2),
                      row.cost_per_ha.toFixed(2),
                      row.total_cost.toFixed(2),
                    ]);
                  });
                  const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement("a");
                  link.setAttribute("href", encodedUri);
                  link.setAttribute("download", `Costos_por_Ha_${companySlug}_${selectedSeason}.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200"
              >
                <FileText className="mr-1.5 h-4 w-4" /> Exportar a CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector/Campo</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Has</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Aplic/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Mano Obra/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Personal/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Maq/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Riego/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Diésel/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Bencina/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Otros/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">Total/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total (CLP)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData.map((row, index) => {
                    const ha = row.hectares || 1;
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{row.sector_name}</div>
                          <div className="text-xs text-gray-500">{row.field_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{row.hectares}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.app_cost_only / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.labor_cost / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.worker_cost / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.machinery_cost / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.irrigation_cost / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.fuel_cost_diesel / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.fuel_cost_gasoline / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.general_cost / ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-700 bg-blue-50">{formatCLP(row.cost_per_ha)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(row.total_cost)}</td>
                      </tr>
                    );
                  })}
                  {reportData.length > 0 && (
                    (() => {
                      const totalHas = reportData.reduce((sum, r) => sum + r.hectares, 0);
                      const totalApps = reportData.reduce((sum, r) => sum + r.app_cost_only, 0);
                      const totalLabor = reportData.reduce((sum, r) => sum + r.labor_cost, 0);
                      const totalWorker = reportData.reduce((sum, r) => sum + r.worker_cost, 0);
                      const totalMachinery = reportData.reduce((sum, r) => sum + r.machinery_cost, 0);
                      const totalIrrigation = reportData.reduce((sum, r) => sum + r.irrigation_cost, 0);
                      const totalDiesel = reportData.reduce((sum, r) => sum + r.fuel_cost_diesel, 0);
                      const totalGasoline = reportData.reduce((sum, r) => sum + r.fuel_cost_gasoline, 0);
                      const totalGeneral = reportData.reduce((sum, r) => sum + r.general_cost, 0);
                      const totalCost = reportData.reduce((sum, r) => sum + r.total_cost, 0);
                      const ha = totalHas || 1;

                      return (
                        <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL GENERAL</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{totalHas}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalApps / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalLabor / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalWorker / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalMachinery / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalIrrigation / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalDiesel / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalGasoline / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalGeneral / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-800 bg-blue-100">{formatCLP(totalCost / ha)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totalCost)}</td>
                        </tr>
                      );
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="flex justify-between items-center px-4 py-5 sm:px-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">Kilos/Ha para Solventar Costos</h3>
                <p className="mt-1 text-sm text-gray-500">Compara Prod/Ha (Liquidaciones) vs Kg/Ha requeridos (Costo/Ha ÷ Venta CLP/Kg)</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const totalInvoices = monthlyExpenses.reduce((sum, m) => sum + Number((m as any).total || 0), 0);
                  const totalAllocated = reportData.reduce((sum, r) => sum + Number((r as any).total_cost || 0), 0);
                  const unassigned = Math.max(0, totalInvoices - totalAllocated);
                  const perSector = reportData.length > 0 ? unassigned / reportData.length : 0;
                  const rows = reportData.map((row) => {
                    const ha = Number(row.hectares || 1);
                    const sectorIncomes = incomeEntries.filter((i) =>
                      i.sector_id === row.sector_id &&
                      (i.category === 'Venta Fruta' || i.category === 'Venta Fruta Jugo') &&
                      i.season === selectedSeason
                    );
                    const qtyKg = sectorIncomes.reduce((sum, i) => {
                      const kg = Number(i.quantity_kg || 0);
                      if (i.category === 'Venta Fruta') return sum + (kg * Math.max(0, Math.min(100, Number((i as any).export_percentage ?? 0)))) / 100;
                      return sum + kg;
                    }, 0);
                    const totalClp = sectorIncomes.reduce((sum, i) => sum + Number(i.amount || 0), 0);
                    const saleClp = qtyKg > 0 ? totalClp / qtyKg : 0;
                    const producedKgHa = qtyKg > 0 ? qtyKg / ha : 0;
                    const costHaClp = Number(row.cost_per_ha || 0) + (perSector / ha);
                    const requiredKgHa = saleClp > 0 ? costHaClp / saleClp : 0;
                    const diffKgHa = saleClp > 0 ? producedKgHa - requiredKgHa : 0;

                    return {
                      Campo: row.field_name,
                      Sector: row.sector_name,
                      Fruta: String(row.fruit_type || '').trim() || '-',
                      Has: Number(row.hectares || 0),
                      'Costo/Ha (CLP)': Number(costHaClp || 0),
                      'Venta (CLP/Kg)': Number(saleClp.toFixed(2)),
                      'Prod/Ha (Kg)': Number(producedKgHa.toFixed(2)),
                      'Kg/Ha Requeridos': Number(requiredKgHa.toFixed(2)),
                      'Dif (Kg/Ha)': Number(diffKgHa.toFixed(2))
                    };
                  });
                    await exportJsonToXlsx({
                    filename: `KilosHa_SolventarCostos_${companySlug}_${selectedSeason}.xlsx`,
                    sheetName: `Eq_${selectedSeason}`,
                    rows
                  });
                }}
                className="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-xs font-bold rounded text-white bg-green-600 hover:bg-green-700"
              >
                <FileText className="mr-1.5 h-4 w-4" /> Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector/Campo</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fruta</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo/Ha (CLP)</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Venta (CLP/Kg)</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Prod/Ha (Kg)</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">Kg/Ha Requeridos</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dif (Kg/Ha)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData.map((row, index) => {
                    const totalInvoices = monthlyExpenses.reduce((sum, m) => sum + Number((m as any).total || 0), 0);
                    const totalAllocated = reportData.reduce((sum, r) => sum + Number((r as any).total_cost || 0), 0);
                    const unassigned = Math.max(0, totalInvoices - totalAllocated);
                    const perSector = reportData.length > 0 ? unassigned / reportData.length : 0;
                    const ha = Number(row.hectares || 1);
                    const sectorIncomes = incomeEntries.filter((i) =>
                      i.sector_id === row.sector_id &&
                      (i.category === 'Venta Fruta' || i.category === 'Venta Fruta Jugo') &&
                      i.season === selectedSeason
                    );
                    const qtyKg = sectorIncomes.reduce((sum, i) => {
                      const kg = Number(i.quantity_kg || 0);
                      if (i.category === 'Venta Fruta') return sum + (kg * Math.max(0, Math.min(100, Number((i as any).export_percentage ?? 0)))) / 100;
                      return sum + kg;
                    }, 0);
                    const totalClp = sectorIncomes.reduce((sum, i) => sum + Number(i.amount || 0), 0);
                    const saleClp = qtyKg > 0 ? totalClp / qtyKg : 0;
                    const producedKgHa = qtyKg > 0 ? qtyKg / ha : 0;
                    const costHaClp = Number(row.cost_per_ha || 0) + (perSector / ha);
                    const requiredKgHa = saleClp > 0 ? costHaClp / saleClp : 0;
                    const diffKgHa = saleClp > 0 ? producedKgHa - requiredKgHa : 0;
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{row.sector_name}</div>
                          <div className="text-xs text-gray-500">{row.field_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{String(row.fruit_type || '').trim() || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{formatCLP(costHaClp)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{saleClp > 0 ? formatCLP(saleClp) : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{qtyKg > 0 ? producedKgHa.toLocaleString('es-CL', { maximumFractionDigits: 0 }) : '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-700 bg-blue-50">
                          {saleClp > 0 ? requiredKgHa.toLocaleString('es-CL', { maximumFractionDigits: 0 }) : '-'}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${diffKgHa >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {saleClp > 0 ? diffKgHa.toLocaleString('es-CL', { maximumFractionDigits: 0 }) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'margin' && (
        <div className="space-y-6">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="flex justify-between items-center px-4 py-5 sm:px-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">Rentabilidad Neta ({selectedSeason})</h3>
                <p className="mt-1 text-sm text-gray-500">Ingresos y costos por sector con prioridad a la base canónica de margen.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openCreateProductionModal}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-indigo-700 bg-indigo-100 hover:bg-indigo-200"
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Registrar producción
                </button>
                <button
                  onClick={() => {
                    const { rows, totals } = getMarginRows();
                    const csvRows = [['Campo', 'Sector', 'Base Producción', 'Has', 'Ingresos (CLP)', 'Costos (CLP)', 'Utilidad (CLP)', 'Utilidad/Ha', 'Margen %']];
                    rows.forEach((r) => {
                      csvRows.push([
                        r.field_name,
                        r.sector_name,
                        r.production_source === 'production_records' ? 'Registro' : r.production_source === 'income_entries' ? 'Ingreso' : 'Sin base',
                        r.hectares.toString(),
                        r.income.toFixed(2),
                        r.cost.toFixed(2),
                        r.profit.toFixed(2),
                        r.profit_per_ha.toFixed(2),
                        r.margin_pct.toFixed(2)
                      ]);
                    });
                    csvRows.push(['TOTAL', '', '-', totals.totalHa.toString(), totals.totalIncome.toFixed(2), totals.totalCost.toFixed(2), totals.totalProfit.toFixed(2), totals.totalProfitPerHa.toFixed(2), totals.totalMarginPct.toFixed(2)]);
                    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `Rentabilidad_${companySlug}_${selectedSeason}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200"
                >
                  <FileText className="mr-1.5 h-4 w-4" /> Exportar a CSV
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 px-4 py-4 border-b border-gray-200 bg-gray-50">
              {(() => {
                const { rows, totals } = getMarginRows();
                const productionRecordCount = rows.filter((row) => row.production_source === 'production_records').length;
                const inferredCount = rows.filter((row) => row.production_source === 'income_entries').length;
                return (
                  <>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Utilidad neta</div>
                      <div className={`mt-2 text-2xl font-semibold ${totals.totalProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCLP(totals.totalProfit)}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Margen total</div>
                      <div className={`mt-2 text-2xl font-semibold ${totals.totalMarginPct >= 0 ? 'text-green-700' : 'text-red-700'}`}>{totals.totalMarginPct.toFixed(1)}%</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Sectores con registro</div>
                      <div className="mt-2 text-2xl font-semibold text-gray-900">{productionRecordCount}</div>
                      <div className="mt-1 text-sm text-gray-500">Producción desde `production_records`</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Sectores en respaldo</div>
                      <div className="mt-2 text-2xl font-semibold text-gray-900">{inferredCount}</div>
                      <div className="mt-1 text-sm text-gray-500">Producción inferida desde ingresos</div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr,1.1fr] gap-6 px-4 py-4 border-b border-gray-200 bg-white">
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <h4 className="text-sm font-semibold text-gray-900">Alertas de completitud económica</h4>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">Sectores que todavía no tienen una base económica suficientemente completa.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-red-700">Costo sin ingreso</div>
                    <div className="mt-2 text-2xl font-semibold text-red-700">{economicCompletionData.sectorsWithCostNoIncome.length}</div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-amber-700">Ingreso sin producción formal</div>
                    <div className="mt-2 text-2xl font-semibold text-amber-700">{economicCompletionData.sectorsWithIncomeNoFormalProduction.length}</div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-indigo-700">Producción formal sin ingreso</div>
                    <div className="mt-2 text-2xl font-semibold text-indigo-700">{economicCompletionData.sectorsWithFormalProductionNoIncome.length}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h4 className="text-sm font-semibold text-gray-900">Sectores prioritarios</h4>
                  <p className="mt-1 text-sm text-gray-500">Focos para regularizar la base de producción e ingreso usada por el margen.</p>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    ...economicCompletionData.topCostNoIncome.map((row) => ({
                      key: `cost-${row.sectorId}`,
                      tone: 'text-red-700',
                      label: 'Costo sin ingreso',
                      detail: `${row.fieldName} / ${row.sectorName}`,
                      value: formatCLP(row.totalCost)
                    })),
                    ...economicCompletionData.topIncomeNoProduction.map((row) => ({
                      key: `income-${row.sectorId}`,
                      tone: 'text-amber-700',
                      label: 'Ingreso sin producción formal',
                      detail: `${row.fieldName} / ${row.sectorName}`,
                      value: formatCLP(row.totalIncome)
                    })),
                    ...economicCompletionData.topFormalNoIncome.map((row) => ({
                      key: `formal-${row.sectorId}`,
                      tone: 'text-indigo-700',
                      label: 'Producción formal sin ingreso',
                      detail: `${row.fieldName} / ${row.sectorName}`,
                      value: `${Number(row.kgProduced || 0).toLocaleString('es-CL')} Kg`
                    }))
                  ].slice(0, 6).map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
                      <div>
                        <div className={`text-sm font-semibold ${item.tone}`}>{item.label}</div>
                        <div className="text-sm text-gray-500">{item.detail}</div>
                      </div>
                      <div className="text-sm font-medium text-gray-900">{item.value}</div>
                    </div>
                  ))}
                  {economicCompletionData.topCostNoIncome.length === 0 &&
                    economicCompletionData.topIncomeNoProduction.length === 0 &&
                    economicCompletionData.topFormalNoIncome.length === 0 && (
                      <div className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                        No hay alertas de completitud económica visibles para el filtro actual.
                      </div>
                    )}
                </div>
              </div>
            </div>
            <div className="bg-white border-b border-gray-200">
              <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-indigo-600" />
                  <h4 className="text-sm font-semibold text-gray-900">Producción formal por sector</h4>
                </div>
                <p className="mt-1 text-sm text-gray-500">Registra la producción oficial de la temporada para mejorar costo/kg y margen real.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo / Sector</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Has</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Kg producidos</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Precio ref. / Kg</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {productionCoverageRows.map((row) => (
                      <tr key={`prod-${row.sectorId}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{row.sectorName}</div>
                          <div className="text-xs text-gray-500">{row.fieldName}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600">{row.hectares.toLocaleString('es-CL', { maximumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">{row.kgProduced > 0 ? row.kgProduced.toLocaleString('es-CL') : '-'}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600">{row.pricePerKg > 0 ? formatCLP(row.pricePerKg) : '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                            row.hasRecord
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                          }`}>
                            {row.hasRecord ? 'Formal' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditProductionModal({
                                id: row.recordId || '',
                                company_id: selectedCompany?.id || '',
                                sector_id: row.sectorId,
                                season_year: selectedSeasonStartYear,
                                kg_produced: row.kgProduced,
                                price_per_kg: row.pricePerKg
                              })}
                              className="inline-flex items-center rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" /> {row.hasRecord ? 'Editar' : 'Cargar'}
                            </button>
                            {row.recordId && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteProductionRecord(row.recordId!)}
                                className="inline-flex items-center rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {productionCoverageRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                          No hay sectores visibles para registrar producción en este filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector/Campo</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Base producción</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Has</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ingresos</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costos</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">Utilidad</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Utilidad/Ha</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Margen %</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(() => {
                    const { rows, totals } = getMarginRows();
                    return (
                      <>
                        {rows.map((r) => (
                          <tr key={`${r.field_name}-${r.sector_name}`} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">{r.sector_name}</div>
                              <div className="text-xs text-gray-500">{r.field_name}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                                r.production_source === 'production_records'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : r.production_source === 'income_entries'
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-gray-200 bg-gray-50 text-gray-600'
                              }`}>
                                {r.production_source === 'production_records' ? 'Registro' : r.production_source === 'income_entries' ? 'Ingreso' : 'Sin base'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{r.hectares}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{formatCLP(r.income)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{formatCLP(r.cost)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold bg-blue-50 ${r.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCLP(r.profit)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${r.profit_per_ha >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCLP(r.profit_per_ha)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${r.margin_pct >= 0 ? 'text-green-700' : 'text-red-700'}`}>{r.margin_pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                        {rows.length > 0 && (
                          <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL GENERAL</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">-</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{totals.totalHa}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totals.totalIncome)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totals.totalCost)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right bg-blue-100 ${totals.totalProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatCLP(totals.totalProfit)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${totals.totalProfitPerHa >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatCLP(totals.totalProfitPerHa)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${totals.totalMarginPct >= 0 ? 'text-green-800' : 'text-red-800'}`}>{totals.totalMarginPct.toFixed(1)}%</td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* LABORS REPORT (NEW) */}
      {activeTab === 'labors' && (
        <div className="space-y-6">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Detalle de Labores Agrícolas por Sector ({selectedSeason})</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">Desglose de costos de Poda, Raleo, Cosecha, Otras Labores y Tratos por cada sector.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector/Campo</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Hectáreas</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Poda</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Raleo</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cosecha</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Otras Labores</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-orange-50">Personal (Planta y Tratos)</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">Total Labores</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo / Ha</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData.map((row, index) => {
                    const totalLabors = row.labor_poda_cost + row.labor_raleo_cost + row.labor_cosecha_cost + row.labor_otros_cost + row.worker_cost;
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{row.sector_name}</div>
                            <div className="text-xs text-gray-500">{row.field_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{row.hectares}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.labor_poda_cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.labor_raleo_cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.labor_cosecha_cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{formatCLP(row.labor_otros_cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600 bg-orange-50">{formatCLP(row.worker_cost)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-700 bg-blue-50">{formatCLP(totalLabors)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{formatCLP(totalLabors / (row.hectares || 1))}</td>
                      </tr>
                    );
                  })}
                  {reportData.length > 0 && (
                    <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL GENERAL</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {reportData.reduce((sum, r) => sum + r.hectares, 0)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCLP(reportData.reduce((sum, r) => sum + r.labor_poda_cost, 0))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCLP(reportData.reduce((sum, r) => sum + r.labor_raleo_cost, 0))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCLP(reportData.reduce((sum, r) => sum + r.labor_cosecha_cost, 0))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCLP(reportData.reduce((sum, r) => sum + r.labor_otros_cost, 0))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-700 bg-orange-100">
                        {formatCLP(reportData.reduce((sum, r) => sum + r.worker_cost, 0))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-800 bg-blue-100">
                        {formatCLP(reportData.reduce((sum, r) => sum + r.labor_poda_cost + r.labor_raleo_cost + r.labor_cosecha_cost + r.labor_otros_cost + r.worker_cost, 0))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">-</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 1. APPLICATIONS REPORT */}
      {activeTab === 'applications' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Costo por Hectárea ({selectedSeason})</h3>
                </div>
                <div className="h-96 w-full">
                  {reportData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">No hay datos para {selectedSeason}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reportData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="sector_name" label={{ value: 'Sector', position: 'insideBottom', offset: -5 }} />
                        <YAxis tickFormatter={(value) => formatCLP(value)} />
                        <Tooltip formatter={(value) => formatCLP(Number(value))} />
                        <Legend />
                        <Bar dataKey="app_cost_per_ha" name="Costo por Hectárea" fill="#2E7D32" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              
              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Detalle por Sector ({selectedSeason})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hectáreas</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prod (Kg)</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo / Kg</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Total</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo / Ha</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportData.map((row, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.field_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.sector_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.hectares}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{(row.kg_produced || 0).toLocaleString('es-CL')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600">{row.cost_per_kg > 0 ? formatCLP(row.cost_per_kg) : '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCLP(row.app_cost_only)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-700">{formatCLP(row.app_cost_per_ha)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. MONTHLY EXPENSES REPORT */}
          {activeTab === 'monthly' && (
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Evolución de Gastos Mensuales ({selectedSeason})</h3>
              <div className="h-96 w-full">
                {monthlyExpenses.every(m => m.total === 0) ? (
                  <div className="flex h-full items-center justify-center text-gray-500">No hay gastos en {selectedSeason}</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyExpenses} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(value) => formatCLP(value)} />
                      <Tooltip formatter={(value) => formatCLP(Number(value))} />
                      <Legend />
                      <Bar dataKey="total" name="Total Gastado" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* 3. CATEGORY EXPENSES REPORT */}
          {activeTab === 'categories' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Gastos por Clasificación ({selectedSeason})</h3>
                <div className="h-80 w-full">
                  {categoryExpenses.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">No hay gastos en {selectedSeason}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryExpenses}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="total"
                          nameKey="category"
                        >
                          {categoryExpenses.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCLP(Number(value))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow overflow-hidden">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Detalle de Categorías ({selectedSeason})</h3>
                <div className="overflow-y-auto max-h-80">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Categoría</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto Total</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {categoryExpenses.map((cat, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{cat.category}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900">{formatCLP(cat.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'fuel_machines' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="flex justify-between items-center px-4 py-5 sm:px-6 border-b border-gray-200">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Petróleo por Máquina ({selectedSeason})</h3>
                  <p className="mt-1 text-sm text-gray-500">Consumo registrado en bitácora (fuel_consumption)</p>
                </div>
                <button
                  onClick={() => {
                    const { rows, totals } = getFuelMachinesRows();
                    const csvRows = [['Máquina', 'L Diésel', 'L Bencina', 'L Total', 'Costo Total', 'CLP/L']];
                    rows.forEach((r) => {
                      csvRows.push([
                        r.machine_name,
                        r.liters_diesel.toFixed(1),
                        r.liters_gasoline.toFixed(1),
                        r.liters_total.toFixed(1),
                        r.cost_total.toFixed(2),
                        r.avg_price.toFixed(2)
                      ]);
                    });
                    csvRows.push(['TOTAL', totals.liters_diesel.toFixed(1), totals.liters_gasoline.toFixed(1), totals.liters_total.toFixed(1), totals.cost_total.toFixed(2), totals.avg_price.toFixed(2)]);
                    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `Petroleo_por_Maquina_${companySlug}_${selectedSeason}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200"
                >
                  <FileText className="mr-1.5 h-4 w-4" /> Exportar a CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Máquina</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">L Diésel</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">L Bencina</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">L Total</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Total</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">CLP/L</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(() => {
                      const { rows, totals } = getFuelMachinesRows();
                      return (
                        <>
                          {rows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No hay consumos registrados en {selectedSeason}</td>
                            </tr>
                          ) : (
                            rows.map((r) => (
                              <tr key={r.machine_id || r.machine_name}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.machine_name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{r.liters_diesel.toFixed(1)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{r.liters_gasoline.toFixed(1)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{r.liters_total.toFixed(1)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900">{formatCLP(r.cost_total)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{formatCLP(r.avg_price)}</td>
                              </tr>
                            ))
                          )}
                          {rows.length > 0 && (
                            <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL GENERAL</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{totals.liters_diesel.toFixed(1)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{totals.liters_gasoline.toFixed(1)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{totals.liters_total.toFixed(1)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totals.cost_total)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCLP(totals.avg_price)}</td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'stock_breaks' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="flex justify-between items-center px-4 py-5 sm:px-6 border-b border-gray-200">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Quiebres de Stock</h3>
                  <p className="mt-1 text-sm text-gray-500">Productos bajo stock mínimo (bodega local)</p>
                </div>
                <button
                  onClick={() => {
                    const { rows, totals } = getStockBreakRows();
                    const csvRows = [['Producto', 'Categoría', 'Unidad', 'Stock', 'Mínimo', 'Faltante', 'Costo Prom.', 'Costo Reposición']];
                    rows.forEach((r) => {
                      csvRows.push([
                        r.name,
                        r.category,
                        r.unit,
                        r.current_stock.toFixed(2),
                        r.minimum_stock.toFixed(2),
                        r.deficit.toFixed(2),
                        r.average_cost.toFixed(2),
                        r.value.toFixed(2)
                      ]);
                    });
                    csvRows.push(['TOTAL', '', '', '', '', totals.deficit.toFixed(2), '', totals.value.toFixed(2)]);
                    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `Quiebres_Stock_${companySlug}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200"
                >
                  <FileText className="mr-1.5 h-4 w-4" /> Exportar a CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unidad</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Mínimo</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-red-50">Faltante</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Prom.</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">Costo Reposición</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(() => {
                      const { rows, totals } = getStockBreakRows();
                      return (
                        <>
                          {rows.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-6 py-4 text-center text-gray-500">No hay quiebres de stock</td>
                            </tr>
                          ) : (
                            rows.map((r) => (
                              <tr key={r.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{r.category}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{r.unit}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{r.current_stock.toFixed(2)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{r.minimum_stock.toFixed(2)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-red-700 bg-red-50">{r.deficit.toFixed(2)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">{formatCLP(r.average_cost)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-700 bg-blue-50">{formatCLP(r.value)}</td>
                              </tr>
                            ))
                          )}
                          {rows.length > 0 && (
                            <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL</td>
                              <td className="px-6 py-4 whitespace-nowrap" />
                              <td className="px-6 py-4 whitespace-nowrap" />
                              <td className="px-6 py-4 whitespace-nowrap" />
                              <td className="px-6 py-4 whitespace-nowrap" />
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-800 bg-red-100">{totals.deficit.toFixed(2)}</td>
                              <td className="px-6 py-4 whitespace-nowrap" />
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-800 bg-blue-100">{formatCLP(totals.value)}</td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. CHEMICALS REPORT (NEW) */}
          {activeTab === 'chemicals' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
                    <div>
                      <h3 className="text-lg leading-6 font-medium text-gray-900">Insumos Químicos y Fertilizantes ({selectedSeason})</h3>
                      <p className="mt-1 text-sm text-gray-500">Detalle de productos adquiridos según facturas</p>
                    </div>
                    <div className="text-right mt-2 sm:mt-0">
                      <span className="text-sm font-medium text-gray-500">Total Insumos:</span>
                      <span className="ml-2 text-xl font-bold text-green-700">
                        {formatCLP(
                            chemicalProducts
                                .filter(p => filterChemicalCategory === 'all' || p.category === filterChemicalCategory)
                                .reduce((sum, p) => sum + p.total_cost, 0)
                        )}
                      </span>
                    </div>
                </div>
                
                {/* Filter */}
                <div className="w-full sm:w-64">
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Filtrar por Tipo</label>
                    <select
                        value={filterChemicalCategory}
                        onChange={(e) => setFilterChemicalCategory(e.target.value)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                    >
                        <option value="all">Todos los Tipos</option>
                        {Array.from(new Set(chemicalProducts.map(p => p.category))).sort().map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cantidad Total</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Precio Promedio</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {chemicalProducts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No hay compras de insumos registradas en {selectedSeason}</td>
                      </tr>
                    ) : (
                      chemicalProducts
                        .filter(p => filterChemicalCategory === 'all' || p.category === filterChemicalCategory)
                        .map((prod, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{prod.name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                              {prod.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{prod.total_quantity.toLocaleString('es-CL')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{formatCLP(prod.avg_price)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-green-700">{formatCLP(prod.total_cost)}</td>
                        </tr>
                      ))
                    )}
                    {chemicalProducts.filter(p => filterChemicalCategory === 'all' || p.category === filterChemicalCategory).length === 0 && chemicalProducts.length > 0 && (
                         <tr>
                            <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No hay productos en esta categoría.</td>
                         </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. PENDING INVOICES REPORT */}
          {activeTab === 'pending' && (
            <div className="space-y-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
                        <div>
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Facturas Pendientes de Pago</h3>
                            <p className="mt-1 text-sm text-gray-500">Facturas ingresadas sin marcar como "Pagada"</p>
                        </div>
                        <div className="text-right bg-red-50 p-3 rounded-lg border border-red-100 w-full lg:w-auto">
                            <span className="text-sm font-medium text-red-800">Total Deuda Mostrada:</span>
                            <span className="ml-2 text-2xl font-black text-red-600">
                                {formatCLP(filteredPendingInvoices.reduce((sum, inv) => sum + inv.total_amount, 0))}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-3 pt-4 border-t border-gray-100">
                        <div className="w-full md:w-auto">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Proveedores (Selección Múltiple)</label>
                            <div className="flex gap-2">
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val && !pendingSupplierFilter.includes(val)) {
                                            setPendingSupplierFilter([...pendingSupplierFilter, val]);
                                        }
                                        e.target.value = ''; // Reset select
                                    }}
                                    className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                                >
                                    <option value="">Añadir proveedor...</option>
                                    {Array.from(new Set(pendingInvoices.map(inv => inv.supplier))).sort().filter(s => !pendingSupplierFilter.includes(s)).map(sup => (
                                        <option key={sup} value={sup}>{sup}</option>
                                    ))}
                                </select>
                                {pendingSupplierFilter.length > 0 && (
                                    <div className="flex flex-wrap gap-1 max-w-[300px]">
                                        {pendingSupplierFilter.map(sup => (
                                            <span key={sup} className="bg-red-50 text-red-700 border border-red-200 text-[10px] px-2 py-1 rounded flex items-center">
                                                <span className="truncate max-w-[100px]" title={sup}>{sup}</span>
                                                <button onClick={() => setPendingSupplierFilter(prev => prev.filter(s => s !== sup))} className="ml-1 font-bold hover:text-red-900">&times;</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="w-full md:w-auto">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Categorías (Selección Múltiple)</label>
                            <div className="flex gap-2">
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val && !pendingCategoryFilter.includes(val)) {
                                            setPendingCategoryFilter([...pendingCategoryFilter, val]);
                                        }
                                        e.target.value = ''; // Reset select
                                    }}
                                    className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                                >
                                    <option value="">Añadir categoría...</option>
                                    {Array.from(new Set(pendingInvoices.flatMap(inv => inv.categories))).sort().filter(c => !pendingCategoryFilter.includes(c)).map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                                {pendingCategoryFilter.length > 0 && (
                                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                                        {pendingCategoryFilter.map(cat => (
                                            <span key={cat} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-1 rounded flex items-center">
                                                {cat}
                                                <button onClick={() => setPendingCategoryFilter(prev => prev.filter(c => c !== cat))} className="ml-1 font-bold hover:text-blue-900">&times;</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Desde (Vencimiento)</label>
                            <input 
                                type="date" 
                                value={pendingStartDate}
                                onChange={(e) => setPendingStartDate(e.target.value)}
                                className="block w-36 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Hasta (Vencimiento)</label>
                            <input 
                                type="date" 
                                value={pendingEndDate}
                                onChange={(e) => setPendingEndDate(e.target.value)}
                                className="block w-36 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                            />
                        </div>
                        {(pendingStartDate || pendingEndDate || pendingSupplierFilter.length > 0 || pendingCategoryFilter.length > 0) && (
                            <button
                                onClick={() => { 
                                    setPendingStartDate(''); 
                                    setPendingEndDate(''); 
                                    setPendingSupplierFilter([]);
                                    setPendingCategoryFilter([]);
                                }}
                                className="mb-0.5 px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Limpiar Filtros
                            </button>
                        )}
                    </div>
                </div>

              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vencimiento</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proveedor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categorías</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">N° Factura</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Monto Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredPendingInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                            No hay facturas pendientes que coincidan con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredPendingInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {new Date(inv.due_date + 'T12:00:00').toLocaleDateString('es-CL')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-md ${
                              inv.days_overdue > 0 ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                            }`}>
                              {inv.days_overdue > 0 ? `${inv.days_overdue} días vencida` : 'Por vencer'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-700">{inv.supplier}</td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                              <div className="flex flex-wrap gap-1">
                                  {inv.categories.slice(0, 2).map((cat, i) => (
                                      <span key={i} className="bg-gray-100 px-2 py-0.5 rounded text-[10px] border border-gray-200">{cat}</span>
                                  ))}
                                  {inv.categories.length > 2 && <span className="text-xs text-gray-400">+{inv.categories.length - 2}</span>}
                              </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">N° {inv.invoice_number}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-black text-red-600">{formatCLP(inv.total_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          )}

          {/* 6b. OVERDUE INVOICES REPORT */}
          {activeTab === 'overdue' && (
            <div className="space-y-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
                        <div>
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Facturas Vencidas</h3>
                            <p className="mt-1 text-sm text-gray-500">Facturas pendientes con vencimiento anterior a hoy</p>
                        </div>
                        <div className="text-right bg-red-50 p-3 rounded-lg border border-red-100 w-full lg:w-auto">
                            <span className="text-sm font-medium text-red-800">Total Vencido Mostrado:</span>
                            <span className="ml-2 text-2xl font-black text-red-600">
                                {formatCLP(filteredOverdueInvoices.reduce((sum, inv) => sum + inv.total_amount, 0))}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-3 pt-4 border-t border-gray-100">
                        <div className="w-full md:w-auto">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Proveedores (Selección Múltiple)</label>
                            <div className="flex gap-2">
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val && !pendingSupplierFilter.includes(val)) {
                                            setPendingSupplierFilter([...pendingSupplierFilter, val]);
                                        }
                                        e.target.value = '';
                                    }}
                                    className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                                >
                                    <option value="">Añadir proveedor...</option>
                                    {Array.from(new Set(pendingInvoices.map(inv => inv.supplier))).sort().filter(s => !pendingSupplierFilter.includes(s)).map(sup => (
                                        <option key={sup} value={sup}>{sup}</option>
                                    ))}
                                </select>
                                {pendingSupplierFilter.length > 0 && (
                                    <div className="flex flex-wrap gap-1 max-w-[300px]">
                                        {pendingSupplierFilter.map(sup => (
                                            <span key={sup} className="bg-red-50 text-red-700 border border-red-200 text-[10px] px-2 py-1 rounded flex items-center">
                                                <span className="truncate max-w-[100px]" title={sup}>{sup}</span>
                                                <button onClick={() => setPendingSupplierFilter(prev => prev.filter(s => s !== sup))} className="ml-1 font-bold hover:text-red-900">&times;</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="w-full md:w-auto">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Categorías (Selección Múltiple)</label>
                            <div className="flex gap-2">
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val && !pendingCategoryFilter.includes(val)) {
                                            setPendingCategoryFilter([...pendingCategoryFilter, val]);
                                        }
                                        e.target.value = '';
                                    }}
                                    className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                                >
                                    <option value="">Añadir categoría...</option>
                                    {Array.from(new Set(pendingInvoices.flatMap(inv => inv.categories))).sort().filter(c => !pendingCategoryFilter.includes(c)).map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                                {pendingCategoryFilter.length > 0 && (
                                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                                        {pendingCategoryFilter.map(cat => (
                                            <span key={cat} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-1 rounded flex items-center">
                                                {cat}
                                                <button onClick={() => setPendingCategoryFilter(prev => prev.filter(c => c !== cat))} className="ml-1 font-bold hover:text-blue-900">&times;</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Desde (Vencimiento)</label>
                            <input 
                                type="date" 
                                value={pendingStartDate}
                                onChange={(e) => setPendingStartDate(e.target.value)}
                                className="block w-36 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Hasta (Vencimiento)</label>
                            <input 
                                type="date" 
                                value={pendingEndDate}
                                onChange={(e) => setPendingEndDate(e.target.value)}
                                className="block w-36 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-xs"
                            />
                        </div>
                        {(pendingStartDate || pendingEndDate || pendingSupplierFilter.length > 0 || pendingCategoryFilter.length > 0) && (
                            <button
                                onClick={() => { 
                                    setPendingStartDate(''); 
                                    setPendingEndDate(''); 
                                    setPendingSupplierFilter([]);
                                    setPendingCategoryFilter([]);
                                }}
                                className="mb-0.5 px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Limpiar Filtros
                            </button>
                        )}
                    </div>
                </div>

              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vencimiento</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Días Vencida</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proveedor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categorías</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">N° Factura</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Monto Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredOverdueInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                            No hay facturas vencidas que coincidan con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredOverdueInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {new Date(inv.due_date + 'T12:00:00').toLocaleDateString('es-CL')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-md bg-red-100 text-red-800 border border-red-200">
                              {inv.days_overdue} días
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-700">{inv.supplier}</td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                              <div className="flex flex-wrap gap-1">
                                  {inv.categories.slice(0, 2).map((cat, i) => (
                                      <span key={i} className="bg-gray-100 px-2 py-0.5 rounded text-[10px] border border-gray-200">{cat}</span>
                                  ))}
                                  {inv.categories.length > 2 && <span className="text-xs text-gray-400">+{inv.categories.length - 2}</span>}
                              </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">N° {inv.invoice_number}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-black text-red-600">{formatCLP(inv.total_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          )}

          {/* 7. PAID PAYMENTS REPORT */}
          {activeTab === 'paid_payments' && (
            <div className="space-y-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-wrap gap-4 items-center justify-between">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900">Pagos Realizados</h3>
                        <p className="text-sm text-gray-500">Montos con IVA incluido, segmentado por categoría y fecha de vencimiento</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Desde (Vencimiento)</label>
                            <input 
                                type="date" 
                                value={paidStartDate}
                                onChange={(e) => setPaidStartDate(e.target.value)}
                                className="block w-36 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Hasta (Vencimiento)</label>
                            <input 
                                type="date" 
                                value={paidEndDate}
                                onChange={(e) => setPaidEndDate(e.target.value)}
                                className="block w-36 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-xs"
                            />
                        </div>
                        {(paidStartDate || paidEndDate) && (
                            <button
                                onClick={() => { setPaidStartDate(''); setPaidEndDate(''); }}
                                className="mb-0.5 px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Limpiar
                            </button>
                        )}
                    </div>
                </div>

                {(() => {
                    // Logic to process Paid Invoices
                    const isCreditNote = (documentType: any) => {
                        const dt = String(documentType || '').toLowerCase();
                        return dt.includes('nota de cr') || dt.includes('credito') || dt === 'nc';
                    };

                    const computeGrossItemAmount = (inv: any, itemNet: number) => {
                        const subtotal = (inv.invoice_items || []).reduce((sum: number, it: any) => sum + (Number(it.total_price) || 0), 0);
                        const discount = Number(inv.discount_amount) || 0;
                        const exempt = Number(inv.exempt_amount) || 0;
                        const special = Number(inv.special_tax_amount) || 0;
                        const taxPct = String(inv.document_type || '').toLowerCase().includes('exenta') ? 0 : (Number(inv.tax_percentage) || 19);
                        const multiplier = isCreditNote(inv.document_type) ? -1 : 1;

                        const netAfterDiscount = subtotal - discount;
                        const discountShare = subtotal > 0 ? (discount * (itemNet / subtotal)) : 0;
                        const itemNetAfterDiscount = itemNet - discountShare;
                        const baseForShares = netAfterDiscount > 0 ? netAfterDiscount : (subtotal > 0 ? subtotal : 1);
                        const shareRatio = baseForShares > 0 ? (itemNetAfterDiscount / baseForShares) : 0;
                        const itemExemptShare = exempt * shareRatio;
                        const itemSpecialShare = special * shareRatio;
                        const itemTax = itemNetAfterDiscount * (taxPct / 100);

                        return (itemNetAfterDiscount + itemTax + itemExemptShare + itemSpecialShare) * multiplier;
                    };

                    const paidItems = rawInvoices
                        .filter(inv => inv.status === 'Pagada')
                        .filter(inv => {
                            if (!paidStartDate && !paidEndDate) return true;
                            const dateToCheck = new Date((inv.due_date || inv.invoice_date) + 'T12:00:00');
                            const start = paidStartDate ? new Date(paidStartDate + 'T00:00:00') : null;
                            const end = paidEndDate ? new Date(paidEndDate + 'T23:59:59') : null;

                            if (start && end) return dateToCheck >= start && dateToCheck <= end;
                            if (start) return dateToCheck >= start;
                            if (end) return dateToCheck <= end;
                            return true;
                        });

                    // Flatten items and group by category
                    const groupedData = new Map<string, { total: number, items: any[] }>();

                    paidItems.forEach(inv => {
                        const dueDate = inv.due_date || inv.invoice_date;
                        
                        // If invoice has items, distribute cost. If not, put in "Sin Categoría"
                        if (inv.invoice_items && inv.invoice_items.length > 0) {
                            inv.invoice_items.forEach((item: any) => {
                                const category = item.category || item.products?.category || 'Sin Categoría';
                                if (!groupedData.has(category)) {
                                    groupedData.set(category, { total: 0, items: [] });
                                }
                                const group = groupedData.get(category)!;
                                const amountNet = Number(item.total_price) || 0;
                                const amount = computeGrossItemAmount(inv, amountNet);
                                group.total += amount;
                                group.items.push({
                                    date: inv.invoice_date,
                                    dueDate: dueDate,
                                    supplier: inv.supplier,
                                    invoiceNumber: inv.invoice_number,
                                    description: item.products?.name || 'Item',
                                    amount: amount
                                });
                            });
                        } else {
                            const category = 'Sin Categoría';
                            if (!groupedData.has(category)) {
                                groupedData.set(category, { total: 0, items: [] });
                            }
                            const group = groupedData.get(category)!;
                            const amount = Number(inv.total_amount) || 0;
                            group.total += amount;
                            group.items.push({
                                date: inv.invoice_date,
                                dueDate: dueDate,
                                supplier: inv.supplier,
                                invoiceNumber: inv.invoice_number,
                                description: 'Factura General',
                                amount: amount
                            });
                        }
                    });

                    // Sort groups by total amount desc
                    const sortedGroups = Array.from(groupedData.entries())
                        .sort((a, b) => b[1].total - a[1].total);

                    if (sortedGroups.length === 0) {
                        return (
                            <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow">
                                No hay pagos registrados en el periodo seleccionado.
                            </div>
                        );
                    }

                    return (
                        <div className="space-y-6">
                            {sortedGroups.map(([category, data]) => {
                                // Sort items by due date
                                const sortedItems = data.items.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

                                return (
                                    <div key={category} className="bg-white shadow overflow-hidden sm:rounded-lg">
                                        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                                            <h3 className="text-lg leading-6 font-medium text-gray-900">{category}</h3>
                                            <span className="text-lg font-bold text-green-700">{formatCLP(data.total)}</span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-white">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vencimiento</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Emisión</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proveedor</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">N° Factura</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Detalle</th>
                                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Monto</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {sortedItems.map((item, idx) => (
                                                        <tr key={idx} className="hover:bg-gray-50">
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                                {new Date(item.dueDate + 'T12:00:00').toLocaleDateString('es-CL')}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                {new Date(item.date + 'T12:00:00').toLocaleDateString('es-CL')}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.supplier}</td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.invoiceNumber}</td>
                                                            <td className="px-6 py-4 text-sm text-gray-500">{item.description}</td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{formatCLP(item.amount)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>
          )}

          {/* 7. DETAILED REPORT */}
          {activeTab === 'detailed' && (
            <div className="space-y-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-wrap gap-4 items-center">
                    <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Filtrar por Mes</label>
                        <select 
                            value={filterMonth}
                            onChange={(e) => setFilterMonth(e.target.value)}
                            className="block w-40 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="all">Todos los Meses</option>
                            {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => (
                                <option key={i} value={i}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Filtrar por Categoría</label>
                        <select 
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="all">Todas las Categorías</option>
                            {Array.from(new Set(rawInvoices.flatMap(i => i.invoice_items?.map((item: any) => item.category || 'Sin Categoría') || []))).sort().map((cat: any) => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex justify-end mb-4">
                    <button
                        onClick={() => {
                            // Simple CSV export for detailed report
                            const rows = [['Mes', 'Categoría', 'Fecha', 'Proveedor', 'N° Factura', 'Detalle', 'Monto (CLP)']];
                            
                            detailedReport
                                .filter(m => filterMonth === 'all' || m.monthIndex.toString() === filterMonth)
                                .forEach(month => {
                                    month.categories
                                        .filter(c => filterCategory === 'all' || c.name === filterCategory)
                                        .forEach(cat => {
                                            cat.items.forEach(item => {
                                                rows.push([
                                                    month.monthName,
                                                    cat.name,
                                                    new Date(item.date + 'T12:00:00').toLocaleDateString('es-CL'),
                                                    `"${item.supplier.replace(/"/g, '""')}"`,
                                                    item.invoiceNumber,
                                                    `"${item.description.replace(/"/g, '""')}"`,
                                                    item.total.toString()
                                                ]);
                                            });
                                        });
                                });

                            const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
                            const encodedUri = encodeURI(csvContent);
                            const link = document.createElement("a");
                            link.setAttribute("href", encodedUri);
                            link.setAttribute("download", `Reporte_Detallado_${companySlug}_${selectedSeason}.csv`);
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        }}
                        className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
                    >
                        <FileText className="mr-2 h-4 w-4" /> Exportar a Excel (CSV)
                    </button>
                </div>

                {detailedReport
                    .filter(m => filterMonth === 'all' || m.monthIndex.toString() === filterMonth)
                    .map(month => {
                        const filteredCategories = month.categories.filter(c => filterCategory === 'all' || c.name === filterCategory);
                        if (filteredCategories.length === 0) return null;
                        const monthTotal = filteredCategories.reduce((sum, c) => sum + c.total, 0);

                        return (
                            <div key={month.monthIndex} className="bg-white shadow overflow-hidden sm:rounded-lg">
                                <div className="px-4 py-5 sm:px-6 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                                    <h3 className="text-lg leading-6 font-medium text-gray-900">{month.monthName}</h3>
                                    <span className="text-lg font-bold text-indigo-600">{formatCLP(monthTotal)}</span>
                                </div>
                                <div className="p-4 space-y-6">
                                    {filteredCategories.map((cat, idx) => (
                                        <div key={idx} className="border rounded-md overflow-hidden">
                                            <div className="bg-gray-100 px-4 py-2 border-b flex justify-between">
                                                <span className="font-semibold text-gray-700">{cat.name}</span>
                                                <span className="font-bold text-gray-900">{formatCLP(cat.total)}</span>
                                            </div>
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Proveedor</th>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Factura</th>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalle</th>
                                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {cat.items.map((item, i) => (
                                                        <tr key={i}>
                                                            <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500">
                                                                {new Date(item.date + 'T12:00:00').toLocaleDateString('es-CL')}
                                                            </td>
                                                            <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-900">{item.supplier}</td>
                                                            <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500">{item.invoiceNumber}</td>
                                                            <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-xs">{item.description}</td>
                                                            <td className="px-4 py-2 whitespace-nowrap text-xs text-right font-medium text-gray-900">{formatCLP(item.total)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                
                {detailedReport.filter(m => filterMonth === 'all' || m.monthIndex.toString() === filterMonth).length === 0 && (
                    <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow">
                        No hay registros para los filtros seleccionados.
                    </div>
                )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'comparative' && (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">Comparativa Histórica de Gastos</h3>
                        <p className="text-sm text-gray-500">Temporada {selectedSeason} vs Temporada Anterior</p>
                    </div>
                </div>
                <div className="h-96 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparativeData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="month" />
                            <YAxis 
                                tickFormatter={(value) => `$${(value / 1000000).toFixed(0)}M`}
                                width={80}
                            />
                            <Tooltip 
                                formatter={(value: number) => formatCLP(value)}
                                labelStyle={{ color: '#374151', fontWeight: 'bold', marginBottom: '8px' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }}/>
                            <Bar dataKey="prev" name="Temporada Anterior" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="current" name={`Temporada ${selectedSeason}`} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Detalle Mes a Mes</h3>
                </div>
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mes</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Temporada Anterior</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Temporada {selectedSeason}</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Variación</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {comparativeData.map((row, idx) => {
                            const variation = row.prev > 0 ? ((row.current - row.prev) / row.prev) * 100 : (row.current > 0 ? 100 : 0);
                            const isPositive = variation > 0;
                            return (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.month}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{formatCLP(row.prev)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{formatCLP(row.current)}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                                        {variation === 0 ? '-' : `${isPositive ? '+' : ''}${variation.toFixed(1)}%`}
                                    </td>
                                </tr>
                            );
                        })}
                        <tr className="bg-gray-50 font-bold">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">TOTAL</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                {formatCLP(comparativeData.reduce((sum, r) => sum + r.prev, 0))}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                {formatCLP(comparativeData.reduce((sum, r) => sum + r.current, 0))}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                {(() => {
                                    const totalPrev = comparativeData.reduce((sum, r) => sum + r.prev, 0);
                                    const totalCurrent = comparativeData.reduce((sum, r) => sum + r.current, 0);
                                    const varTotal = totalPrev > 0 ? ((totalCurrent - totalPrev) / totalPrev) * 100 : 0;
                                    return totalPrev === 0 && totalCurrent === 0 ? '-' : `${varTotal > 0 ? '+' : ''}${varTotal.toFixed(1)}%`;
                                })()}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
      )}

      {/* PRESENTATION MODE OVERLAY */}
      {presentationMode && (
        <div className="fixed inset-0 z-[99999] bg-slate-50 flex flex-col font-sans text-slate-900">
          <div className="flex justify-between items-center p-6 opacity-30 hover:opacity-100 transition-opacity absolute top-0 left-0 right-0 z-10">
            <div className="text-xl font-bold text-slate-400">{companyName} - {getReportTitle()}</div>
            <button onClick={exitPresentation} className="text-slate-400 hover:text-red-500 bg-white/80 rounded-full p-2">
              <X className="w-8 h-8" />
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-12 relative w-full max-w-[95vw] mx-auto overflow-hidden">
            {activeTab === 'executive' ? (
              <>
                {currentSlide === 0 && (
                  <div className="text-center animate-fade-in-up w-full">
                    <FileText className="w-28 h-28 text-purple-600 mx-auto mb-8" />
                    <div className="text-sm uppercase tracking-[0.35em] text-slate-400 mb-4">Reporte Ejecutivo</div>
                    <h1 className="text-5xl lg:text-6xl font-extrabold text-slate-800 mb-6">{companyName}</h1>
                    <h2 className="text-3xl lg:text-4xl text-purple-600 font-medium mb-6">Temporada {selectedSeason}</h2>
                    <p className="text-xl lg:text-2xl text-slate-500">Campo visible: {executiveFieldLabel}</p>
                  </div>
                )}

                {currentSlide >= 1 && currentSlide <= 11 && (
                  <div className="w-full h-full flex flex-col animate-fade-in-up pt-4">
                    <h2 className="text-3xl lg:text-4xl font-bold text-slate-800 mb-6 text-center">Resumen Ejecutivo</h2>
                    <div className="flex-1 bg-white rounded-3xl shadow-xl p-6 overflow-y-auto pb-24" style={{ maxHeight: 'calc(100vh - 120px)' }}>
                      {currentSlide === 1 && (
                        <div className="space-y-8">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {executiveInsights.findings.map((finding, index) => (
                              <div key={finding.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Hallazgo {index + 1}</div>
                                <div className="mt-3 text-2xl font-bold text-slate-900">{finding.title}</div>
                                <div className="mt-3 text-lg text-slate-600 leading-8">{finding.description}</div>
                                <div className="mt-5 text-xl font-semibold text-purple-700">{finding.emphasis}</div>
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,0.6fr] gap-6">
                            <div className="rounded-2xl bg-slate-950 text-white p-8">
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Conclusión</div>
                                  <div className="mt-3 text-3xl font-bold">Mensaje para comité</div>
                                </div>
                                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveInsights.tone.badge}`}>
                                  <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveInsights.tone.dot}`} />
                                  {executiveInsights.tone.label}
                                </span>
                              </div>
                              <p className="mt-6 text-xl leading-9 text-slate-200">{executiveInsights.conclusion}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-6 bg-white">
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Ficha rápida</div>
                              <div className="mt-5 space-y-4 text-lg">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Campo</span>
                                  <span className="font-semibold text-slate-900">{executiveFieldLabel}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Gasto total</span>
                                  <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.totalSeasonCost)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Alertas</span>
                                  <span className="font-semibold text-slate-900">{executiveInsights.activeAlertCount}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Comparativa base</span>
                                  <span className="font-semibold text-slate-900">{previousExecutiveSeason}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Presupuesto</span>
                                  <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.totalBudget || 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Costo / Ha</span>
                                  <span className="font-semibold text-slate-900">{formatCLP(executiveViewData.kpis.averageCostPerHa || 0)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {currentSlide === 2 && (
                        <div className="space-y-8 h-full">
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="text-sm text-slate-500 uppercase tracking-wide">Gasto temporada</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveViewData.kpis.totalSeasonCost)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="text-sm text-slate-500 uppercase tracking-wide">Temp. anterior</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveViewData.kpis.previousSeasonCost)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="text-sm text-slate-500 uppercase tracking-wide">Promedio mensual</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveViewData.kpis.averageMonthlyCost)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="text-sm text-slate-500 uppercase tracking-wide">Presupuesto</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveViewData.kpis.totalBudget || 0)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="text-sm text-slate-500 uppercase tracking-wide">Costo / Ha</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveViewData.kpis.averageCostPerHa || 0)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="text-sm text-slate-500 uppercase tracking-wide">Costo / Kg</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveViewData.kpis.averageCostPerKg ? formatCLP(executiveViewData.kpis.averageCostPerKg) : '-'}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm text-slate-500 uppercase tracking-wide">Variación</div>
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct)).badge}`}>
                                  <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct)).dot}`} />
                                  {getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct)).label}
                                </span>
                              </div>
                              <div className={`mt-3 text-3xl font-bold ${executiveViewData.kpis.seasonVariation >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {formatCLP(executiveViewData.kpis.seasonVariation)}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 xl:grid-cols-[1.25fr,0.75fr] gap-6 min-h-[420px]">
                            <div className="rounded-2xl border border-slate-200 p-4">
                              <div className="text-xl font-bold text-slate-800 mb-4">Tendencia mensual</div>
                              <div className="h-[360px]">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={executiveViewData.monthlyRows}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="shortLabel" tick={{ fontSize: 16, fill: '#475569' }} axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={(value) => formatCLP(Number(value))} tick={{ fontSize: 14, fill: '#475569' }} axisLine={false} tickLine={false} />
                                    <Tooltip formatter={(value) => formatCLP(Number(value))} />
                                    <Bar dataKey="total" fill="#7c3aed" radius={[10, 10, 0, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-4">
                              <div className="text-xl font-bold text-slate-800 mb-4">Temporadas anteriores</div>
                              <div className="space-y-3">
                                {executiveHistoricalSeasonRows.slice(0, 5).map((row) => (
                                  <div key={row.season} className={`flex items-center justify-between rounded-xl px-4 py-3 ${row.season === previousExecutiveSeason ? 'bg-purple-50' : 'bg-slate-50'}`}>
                                    <div>
                                      <div className="font-semibold text-slate-900">{row.season}</div>
                                      <div className="text-sm text-slate-500">{row.peakMonthLabel}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-semibold text-slate-900">{formatCLP(row.total)}</div>
                                      <div className="text-sm text-slate-500">{formatCLP(row.averageMonthlyCost)}</div>
                                    </div>
                                  </div>
                                ))}
                                {executiveHistoricalSeasonRows.length === 0 && (
                                  <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-slate-400">No hay temporadas anteriores cargadas.</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {currentSlide === 3 && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                          <div className="rounded-2xl border border-slate-200 p-6">
                            <div className="text-2xl font-bold text-slate-800 mb-5">Alertas ejecutivas</div>
                            <div className="space-y-4">
                              {executiveViewData.alerts.length > 0 ? executiveViewData.alerts.map((alert, index) => (
                                <div key={`${alert.title}-${index}`} className={`rounded-2xl border p-5 ${alert.level === 'alta' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                                  <div className="flex items-center justify-between gap-4">
                                    <div>
                                      <div className="text-xl font-semibold text-slate-900">{alert.title}</div>
                                      <div className="mt-2 text-base text-slate-600">{alert.message}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${getExecutiveTone(alert.level === 'alta' ? 35 : 20).badge}`}>
                                        <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${getExecutiveTone(alert.level === 'alta' ? 35 : 20).dot}`} />
                                        {getExecutiveTone(alert.level === 'alta' ? 35 : 20).label}
                                      </div>
                                      <div className="mt-3 text-xl font-bold text-slate-900">{formatCLP(alert.amount)}</div>
                                    </div>
                                  </div>
                                </div>
                              )) : (
                                <div className="rounded-2xl bg-slate-50 p-8 text-center text-xl text-slate-400">No hay alertas relevantes.</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 p-6">
                            <div className="text-2xl font-bold text-slate-800 mb-5">Top focos de gasto</div>
                            <div className="space-y-6">
                              <div>
                                <div className="text-lg font-semibold text-slate-700 mb-3">Top campos</div>
                                <div className="space-y-3">
                                  {executiveViewData.topFields.map((row, index) => (
                                    <div key={row.fieldId} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                                      <div className="font-semibold text-slate-900">{index + 1}. {row.fieldName}</div>
                                      <div className="text-right">
                                        <div className="font-semibold text-slate-900">{formatCLP(row.total)}</div>
                                        <div className={`text-sm ${getExecutiveTone(Math.abs(row.deltaPct)).text}`}>{row.deltaPct.toFixed(1)}%</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <div className="text-lg font-semibold text-slate-700 mb-3">Top sectores</div>
                                <div className="space-y-3">
                                  {executiveViewData.topSectors.map((row, index) => (
                                    <div key={row.sectorId} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                                      <div className="font-semibold text-slate-900">{index + 1}. {row.fieldName} / {row.sectorName}</div>
                                      <div className="text-right">
                                        <div className="font-semibold text-slate-900">{formatCLP(row.total)}</div>
                                        <div className={`text-sm ${getExecutiveTone(Math.abs(row.deltaPct)).text}`}>{row.deltaPct.toFixed(1)}%</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {currentSlide === 4 && (
                        <div className="space-y-5">
                          <div className="text-2xl font-bold text-slate-800">Matriz por campo</div>
                          <table className="w-full text-left text-base">
                            <thead className="text-lg text-slate-500 bg-slate-50 sticky top-0">
                              <tr>
                                <th className="p-3">Campo</th>
                                {executiveSeasonMonths.map((month) => (
                                  <th key={month.key} className="p-3 text-right">{month.shortLabel}</th>
                                ))}
                                <th className="p-3 text-right">{previousExecutiveSeason}</th>
                                <th className="p-3 text-right">Var %</th>
                                <th className="p-3 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {executiveViewData.fieldRows.map((row) => (
                                <tr key={row.fieldId} className="border-b border-slate-100">
                                  <td className="p-3 font-semibold text-slate-900">{row.fieldName}</td>
                                  {executiveSeasonMonths.map((month) => (
                                    <td key={month.key} className="p-3 text-right">{formatCLP(row.months[month.key] || 0)}</td>
                                  ))}
                                  <td className="p-3 text-right">{formatCLP(row.previousTotal)}</td>
                                  <td className={`p-3 text-right font-semibold ${row.delta >= 0 ? 'text-red-600' : 'text-green-600'}`}>{row.deltaPct.toFixed(1)}%</td>
                                  <td className="p-3 text-right font-bold text-slate-900">{formatCLP(row.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {currentSlide === 5 && (
                        <div className="space-y-6">
                          <div className="text-2xl font-bold text-slate-800">Matriz por sector y cierre</div>
                          <table className="w-full text-left text-sm">
                            <thead className="text-base text-slate-500 bg-slate-50 sticky top-0">
                              <tr>
                                <th className="p-3">Campo</th>
                                <th className="p-3">Sector</th>
                                {executiveSeasonMonths.map((month) => (
                                  <th key={month.key} className="p-3 text-right">{month.shortLabel}</th>
                                ))}
                                <th className="p-3 text-right">{previousExecutiveSeason}</th>
                                <th className="p-3 text-right">Var %</th>
                                <th className="p-3 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {executiveViewData.sectorRows.map((row) => (
                                <tr key={row.sectorId} className="border-b border-slate-100">
                                  <td className="p-3">{row.fieldName}</td>
                                  <td className="p-3 font-semibold text-slate-900">{row.sectorName}</td>
                                  {executiveSeasonMonths.map((month) => (
                                    <td key={month.key} className="p-3 text-right">{formatCLP(row.months[month.key] || 0)}</td>
                                  ))}
                                  <td className="p-3 text-right">{formatCLP(row.previousTotal)}</td>
                                  <td className={`p-3 text-right font-semibold ${row.delta >= 0 ? 'text-red-600' : 'text-green-600'}`}>{row.deltaPct.toFixed(1)}%</td>
                                  <td className="p-3 text-right font-bold text-slate-900">{formatCLP(row.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="rounded-2xl bg-slate-950 text-white p-6">
                            <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Cierre Ejecutivo</div>
                            <p className="mt-4 text-2xl leading-10">{executiveInsights.conclusion}</p>
                          </div>
                        </div>
                      )}

                      {currentSlide === 6 && (
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <div>
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Auditoría De Costos</div>
                              <div className="mt-2 text-3xl font-bold text-slate-900">Trazabilidad y conciliación</div>
                              <div className="mt-2 text-lg text-slate-500">{executiveAuditData.scopeLabel}</div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveAuditData.tone.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveAuditData.tone.dot}`} />
                              {costAuditLoading ? 'Cargando auditoría' : executiveAuditData.tone.label}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Monto oficial</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveAuditData.officialAmount)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Trazabilidad</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveAuditData.traceabilityPct.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Respaldo</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveAuditData.backupAmount)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Distribución</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{formatCLP(executiveAuditData.distributedAmount)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Rev. alta</div>
                              <div className={`mt-3 text-3xl font-bold ${executiveAuditData.highReviewAmount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatCLP(executiveAuditData.highReviewAmount)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Movimientos</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveAuditData.visibleMovementCount}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 xl:grid-cols-[0.9fr,1.1fr] gap-6">
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Hallazgos de conciliación</div>
                              <div className="space-y-4">
                                {executiveAuditData.findings.map((finding) => (
                                  <div key={finding.title} className="rounded-2xl bg-slate-50 p-5">
                                    <div className="text-lg font-semibold text-slate-900">{finding.title}</div>
                                    <div className="mt-2 text-base text-slate-600">{finding.description}</div>
                                    <div className="mt-3 text-xl font-bold text-purple-700">{finding.emphasis}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Focos críticos visibles</div>
                              <div className="space-y-3">
                                {executiveAuditData.topDetailRows.slice(0, 5).map((row) => (
                                  <div key={`${row.source_type}-${row.source_id}`} className="rounded-2xl bg-slate-50 px-4 py-3">
                                    <div className="flex items-center justify-between gap-4">
                                      <div>
                                        <div className="font-semibold text-slate-900">{row.category} · {row.audit_status}</div>
                                        <div className="mt-1 text-sm text-slate-500">{row.field_name || '-'} / {row.sector_name || 'Sin sector'} · {row.movement_date}</div>
                                      </div>
                                      <div className="text-right">
                                        <div className="font-semibold text-slate-900">{formatCLP(row.amount)}</div>
                                        <div className="text-sm text-slate-500">{row.source_layer}</div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {executiveAuditData.topDetailRows.length === 0 && (
                                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-xl text-slate-400">
                                    No hay focos críticos visibles para los filtros actuales.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-950 text-white p-6">
                            <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Cierre De Auditoría</div>
                            <p className="mt-4 text-2xl leading-10">{executiveAuditData.conclusion}</p>
                          </div>
                        </div>
                      )}

                      {currentSlide === 7 && (
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <div>
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Cierre Económico</div>
                              <div className="mt-2 text-3xl font-bold text-slate-900">Producción, ingresos y margen cerrados</div>
                              <div className="mt-2 text-lg text-slate-500">{executiveFieldLabel} · Temporada {selectedSeason}</div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveEconomicClosureData.tone.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveEconomicClosureData.tone.dot}`} />
                              {executiveEconomicClosureData.tone.label}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Cierre económico</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveEconomicClosureData.closurePct.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Sectores cerrados</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveEconomicClosureData.closedRows.length}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Pend. producción</div>
                              <div className="mt-3 text-3xl font-bold text-amber-700">{executiveEconomicClosureData.pendingProductionRows.length}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Pend. ingreso</div>
                              <div className="mt-3 text-3xl font-bold text-indigo-700">{executiveEconomicClosureData.pendingIncomeRows.length}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Costo sin ingreso</div>
                              <div className="mt-3 text-3xl font-bold text-red-700">{executiveEconomicClosureData.costWithoutIncomeRows.length}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 xl:grid-cols-[0.9fr,1.1fr] gap-6">
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Hallazgos de cierre</div>
                              <div className="space-y-4">
                                {executiveEconomicClosureData.findings.map((finding) => (
                                  <div key={finding.title} className="rounded-2xl bg-slate-50 p-5">
                                    <div className="text-lg font-semibold text-slate-900">{finding.title}</div>
                                    <div className="mt-2 text-base text-slate-600">{finding.description}</div>
                                    <div className="mt-3 text-xl font-bold text-purple-700">{finding.emphasis}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Focos económicos visibles</div>
                              <div className="space-y-3">
                                {executiveEconomicClosureData.topFocusRows.map((row) => (
                                  <div key={row.key} className="rounded-2xl bg-slate-50 px-4 py-3">
                                    <div className="flex items-center justify-between gap-4">
                                      <div>
                                        <div className="font-semibold text-slate-900">{row.status}</div>
                                        <div className="mt-1 text-sm text-slate-500">{row.fieldName} / {row.sectorName}</div>
                                      </div>
                                      <div className="text-right">
                                        <div className="font-semibold text-slate-900">{row.unitLabel}</div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {executiveEconomicClosureData.topFocusRows.length === 0 && (
                                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-xl text-slate-400">
                                    No hay focos económicos visibles para el filtro actual.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-950 text-white p-6">
                            <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Cierre De Temporada</div>
                            <p className="mt-4 text-2xl leading-10">{executiveEconomicClosureData.conclusion}</p>
                          </div>
                        </div>
                      )}

                      {currentSlide === 8 && (
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <div>
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Historial De Cierre</div>
                              <div className="mt-2 text-3xl font-bold text-slate-900">Madurez del dato por temporada</div>
                              <div className="mt-2 text-lg text-slate-500">{executiveFieldLabel} · {companyName}</div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveEconomicClosureData.tone.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveEconomicClosureData.tone.dot}`} />
                              {bestClosureHistoryRow ? `Mejor: ${bestClosureHistoryRow.season}` : 'Sin historial'}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Temporadas</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveEconomicClosureHistoryRows.length}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Mejor cierre</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{bestClosureHistoryRow ? `${bestClosureHistoryRow.closurePct.toFixed(1)}%` : '-'}</div>
                              <div className="text-sm text-slate-500">{bestClosureHistoryRow?.season || 'Sin datos'}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Mayor brecha</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">
                                {widestClosureGapHistoryRow
                                  ? widestClosureGapHistoryRow.pendingProductionCount + widestClosureGapHistoryRow.pendingIncomeCount + widestClosureGapHistoryRow.costWithoutIncomeCount
                                  : 0}
                              </div>
                              <div className="text-sm text-slate-500">{widestClosureGapHistoryRow?.season || 'Sin datos'}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Temporada actual</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveEconomicClosureData.closurePct.toFixed(1)}%</div>
                              <div className="text-sm text-slate-500">{selectedSeason}</div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 p-6">
                            <div className="text-2xl font-bold text-slate-800 mb-5">Evolución del cierre</div>
                            <table className="w-full text-left text-sm">
                              <thead className="text-base text-slate-500 bg-slate-50 sticky top-0">
                                <tr>
                                  <th className="p-3">Temporada</th>
                                  <th className="p-3">Estado</th>
                                  <th className="p-3 text-right">Cierre %</th>
                                  <th className="p-3 text-right">Cerrados</th>
                                  <th className="p-3 text-right">Pend. prod.</th>
                                  <th className="p-3 text-right">Pend. ingreso</th>
                                  <th className="p-3 text-right">Costo sin ingreso</th>
                                </tr>
                              </thead>
                              <tbody>
                                {executiveEconomicClosureHistoryRows.map((row) => (
                                  <tr key={row.season} className={`border-b border-slate-100 ${row.season === selectedSeason ? 'bg-purple-50' : ''}`}>
                                    <td className="p-3 font-semibold text-slate-900">{row.season}</td>
                                    <td className="p-3 text-slate-700">{row.toneLabel}</td>
                                    <td className="p-3 text-right font-semibold text-slate-900">{row.closurePct.toFixed(1)}%</td>
                                    <td className="p-3 text-right text-slate-700">{row.closedSectorCount}/{row.visibleSectorCount}</td>
                                    <td className="p-3 text-right text-slate-700">{row.pendingProductionCount}</td>
                                    <td className="p-3 text-right text-slate-700">{row.pendingIncomeCount}</td>
                                    <td className="p-3 text-right text-slate-700">{row.costWithoutIncomeCount}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="rounded-2xl bg-slate-950 text-white p-6">
                            <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Lectura Histórica</div>
                            <p className="mt-4 text-2xl leading-10">
                              {bestClosureHistoryRow
                                ? `La mejor temporada visible es ${bestClosureHistoryRow.season} con ${bestClosureHistoryRow.closurePct.toFixed(1)}% de cierre. La referencia más débil sigue siendo ${widestClosureGapHistoryRow?.season || selectedSeason}, por lo que conviene sostener el seguimiento histórico antes de cerrar comité.`
                                : 'Todavía no hay historial suficiente para una lectura de cierre del dato.'}
                            </p>
                          </div>
                        </div>
                      )}

                      {currentSlide === 9 && (
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <div>
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Cierre Total Del Dato</div>
                              <div className="mt-2 text-3xl font-bold text-slate-900">¿La temporada está lista para comité?</div>
                              <div className="mt-2 text-lg text-slate-500">{companyName} · {selectedSeason} · {executiveFieldLabel}</div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveTotalDataClosure.readiness.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveTotalDataClosure.readiness.dot}`} />
                              {executiveTotalDataClosure.readiness.title}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Cierre total</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.totalClosurePct.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Cierre económico</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.economicPct.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Trazabilidad</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.traceabilityPct.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Soporte oficial</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.officialSupportPct.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <div className="text-sm uppercase tracking-wide text-slate-500">Limpieza revisión</div>
                              <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.reviewCleanPct.toFixed(1)}%</div>
                            </div>
                          </div>
                          {executiveTrendWarning && (
                            <div className={`rounded-2xl border p-6 ${executiveTrendWarning.badge}`}>
                              <div className="flex items-start justify-between gap-6">
                                <div>
                                  <div className="text-sm uppercase tracking-[0.25em]">Alerta Preventiva</div>
                                  <div className="mt-3 text-2xl font-bold">{executiveTrendWarning.title}</div>
                                  <p className="mt-4 text-xl leading-9">{executiveTrendWarning.detail}</p>
                                  <p className="mt-4 text-lg leading-8">{executiveTrendWarning.recommendation}</p>
                                  {executiveTrendWarning.compareLine && (
                                    <p className="mt-4 text-lg leading-8">{executiveTrendWarning.compareLine}</p>
                                  )}
                                </div>
                                <div className="text-right">
                                  <div className="text-sm uppercase tracking-[0.25em]">Delta</div>
                                  <div className="mt-3 text-3xl font-bold">{executiveCurrentCompanyTrend.delta.toFixed(1)} pp</div>
                                </div>
                              </div>
                            </div>
                          )}
                          <div className={`rounded-2xl border p-6 ${executiveCurrentRecommendation.tone.badge}`}>
                            <div className="flex items-start justify-between gap-6">
                              <div>
                                <div className="text-sm uppercase tracking-[0.25em]">Recomendación Automática</div>
                                <div className="mt-3 text-2xl font-bold">{executiveCurrentRecommendation.tone.title}</div>
                                <p className="mt-4 text-xl leading-9">{executiveCurrentRecommendation.summary}</p>
                                <p className="mt-4 text-lg leading-8">{executiveCurrentRecommendation.nextStep}</p>
                              </div>
                              <div className="text-right">
                                <div className="text-sm uppercase tracking-[0.25em]">Empresa</div>
                                <div className="mt-3 text-3xl font-bold">{companyName}</div>
                              </div>
                            </div>
                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 text-base">
                              {executiveCurrentRecommendation.reasons.map((reason) => (
                                <div key={reason} className="rounded-2xl bg-white/60 px-4 py-3">
                                  {reason}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 xl:grid-cols-[0.9fr,1.1fr] gap-6">
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Lectura consolidada</div>
                              <div className="space-y-4">
                                {executiveTotalDataClosure.findings.map((finding) => (
                                  <div key={finding.title} className="rounded-2xl bg-slate-50 p-5">
                                    <div className="text-lg font-semibold text-slate-900">{finding.title}</div>
                                    <div className="mt-2 text-base text-slate-600">{finding.description}</div>
                                    <div className="mt-3 text-xl font-bold text-purple-700">{finding.emphasis}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Bloqueos que siguen abiertos</div>
                              <div className="space-y-3">
                                {executiveTotalDataClosure.blockers.map((row) => (
                                  <div key={row} className="rounded-2xl bg-slate-50 px-4 py-3">
                                    <div className="font-semibold text-slate-900">{row}</div>
                                  </div>
                                ))}
                                {executiveTotalDataClosure.blockers.length === 0 && (
                                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-xl text-slate-400">
                                    No hay bloqueos críticos visibles para el filtro actual.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className={`rounded-2xl p-6 ${executiveTotalDataClosure.readiness.badge}`}>
                            <div className="text-sm uppercase tracking-[0.25em]">Decisión De Presentación</div>
                            <p className="mt-4 text-2xl leading-10">{executiveTotalDataClosure.conclusion}</p>
                          </div>
                        </div>
                      )}

                      {currentSlide === 10 && (
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <div>
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Historial Comparado Entre Empresas</div>
                              <div className="mt-2 text-3xl font-bold text-slate-900">¿Quién llega mejor preparado al comité en el tiempo?</div>
                              <div className="mt-2 text-lg text-slate-500">
                                {executiveCompareCompanyName
                                  ? `${companyName} vs ${executiveCompareCompanyName}`
                                  : `${companyName} · Falta seleccionar empresa comparada`}
                              </div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveTotalDataClosure.readiness.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveTotalDataClosure.readiness.dot}`} />
                              {executiveCompareCompanyHistoryInsights
                                ? `${executiveCompareCompanyHistoryInsights.comparableRows.length} temporadas comparables`
                                : 'Sin comparativo activo'}
                            </span>
                          </div>

                          {executiveCompareCompanyHistoryInsights && executiveCompareCompanyHistoryRows.length > 0 ? (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                  <div className="text-sm uppercase tracking-wide text-slate-500">Liderazgo histórico</div>
                                  <div className="mt-3 text-3xl font-bold text-slate-900">
                                    {executiveCompareCompanyHistoryInsights.currentLeadCount === executiveCompareCompanyHistoryInsights.compareLeadCount
                                      ? 'Parejo'
                                      : executiveCompareCompanyHistoryInsights.currentLeadCount > executiveCompareCompanyHistoryInsights.compareLeadCount
                                        ? companyName
                                        : executiveCompareCompanyName}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                  <div className="text-sm uppercase tracking-wide text-slate-500">Mejor temporada actual</div>
                                  <div className="mt-3 text-3xl font-bold text-slate-900">
                                    {executiveCompareCompanyHistoryInsights.currentBest
                                      ? `${executiveCompareCompanyHistoryInsights.currentBest.totalClosurePct.toFixed(1)}%`
                                      : '-'}
                                  </div>
                                  <div className="text-sm text-slate-500">{executiveCompareCompanyHistoryInsights.currentBest?.season || 'Sin datos'}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                  <div className="text-sm uppercase tracking-wide text-slate-500">Mejor temporada comparada</div>
                                  <div className="mt-3 text-3xl font-bold text-slate-900">
                                    {executiveCompareCompanyHistoryInsights.compareBest
                                      ? `${executiveCompareCompanyHistoryInsights.compareBest.totalClosurePct.toFixed(1)}%`
                                      : '-'}
                                  </div>
                                  <div className="text-sm text-slate-500">{executiveCompareCompanyHistoryInsights.compareBest?.season || 'Sin datos'}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                  <div className="text-sm uppercase tracking-wide text-slate-500">Mayor brecha histórica</div>
                                  <div className="mt-3 text-3xl font-bold text-slate-900">
                                    {executiveCompareCompanyHistoryInsights.strongestHistoricalGap
                                      ? `${Math.abs(executiveCompareCompanyHistoryInsights.strongestHistoricalGap.gap || 0).toFixed(1)} pp`
                                      : '-'}
                                  </div>
                                  <div className="text-sm text-slate-500">{executiveCompareCompanyHistoryInsights.strongestHistoricalGap?.season || 'Sin datos'}</div>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <div className="rounded-2xl border border-slate-200 p-6">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-2xl font-bold text-slate-800">Tendencia móvil · {companyName}</div>
                                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveCurrentCompanyTrend.tone.badge}`}>
                                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveCurrentCompanyTrend.tone.dot}`} />
                                      {executiveCurrentCompanyTrend.tone.label}
                                    </span>
                                  </div>
                                  <div className="mt-5 grid grid-cols-2 gap-4">
                                    <div className="rounded-2xl bg-slate-50 p-5">
                                      <div className="text-sm uppercase tracking-wide text-slate-500">Ventana reciente</div>
                                      <div className="mt-3 text-3xl font-bold text-slate-900">{executiveCurrentCompanyTrend.recentAvg.toFixed(1)}%</div>
                                      <div className="text-sm text-slate-500">{executiveCurrentCompanyTrend.recentWindowLabel}</div>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 p-5">
                                      <div className="text-sm uppercase tracking-wide text-slate-500">Ventana previa</div>
                                      <div className="mt-3 text-3xl font-bold text-slate-900">{executiveCurrentCompanyTrend.previousAvg.toFixed(1)}%</div>
                                      <div className="text-sm text-slate-500">{executiveCurrentCompanyTrend.previousWindowLabel}</div>
                                    </div>
                                  </div>
                                  <p className={`mt-5 text-lg leading-8 ${executiveCurrentCompanyTrend.tone.text}`}>{executiveCurrentCompanyTrend.narrative}</p>
                                </div>

                                {executiveCompareCompanyTrend && (
                                  <div className="rounded-2xl border border-slate-200 p-6">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-2xl font-bold text-slate-800">Tendencia móvil · {executiveCompareCompanyName}</div>
                                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveCompareCompanyTrend.tone.badge}`}>
                                        <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveCompareCompanyTrend.tone.dot}`} />
                                        {executiveCompareCompanyTrend.tone.label}
                                      </span>
                                    </div>
                                    <div className="mt-5 grid grid-cols-2 gap-4">
                                      <div className="rounded-2xl bg-slate-50 p-5">
                                        <div className="text-sm uppercase tracking-wide text-slate-500">Ventana reciente</div>
                                        <div className="mt-3 text-3xl font-bold text-slate-900">{executiveCompareCompanyTrend.recentAvg.toFixed(1)}%</div>
                                        <div className="text-sm text-slate-500">{executiveCompareCompanyTrend.recentWindowLabel}</div>
                                      </div>
                                      <div className="rounded-2xl bg-slate-50 p-5">
                                        <div className="text-sm uppercase tracking-wide text-slate-500">Ventana previa</div>
                                        <div className="mt-3 text-3xl font-bold text-slate-900">{executiveCompareCompanyTrend.previousAvg.toFixed(1)}%</div>
                                        <div className="text-sm text-slate-500">{executiveCompareCompanyTrend.previousWindowLabel}</div>
                                      </div>
                                    </div>
                                    <p className={`mt-5 text-lg leading-8 ${executiveCompareCompanyTrend.tone.text}`}>{executiveCompareCompanyTrend.narrative}</p>
                                  </div>
                                )}
                              </div>

                              <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-6">
                                <div className="rounded-2xl border border-slate-200 p-6">
                                  <div className="text-2xl font-bold text-slate-800 mb-5">Cierre total por temporada</div>
                                  <table className="w-full text-left text-sm">
                                    <thead className="text-base text-slate-500 bg-slate-50 sticky top-0">
                                      <tr>
                                        <th className="p-3">Temporada</th>
                                        <th className="p-3 text-right">{companyName}</th>
                                        <th className="p-3 text-right">{executiveCompareCompanyName}</th>
                                        <th className="p-3 text-right">Brecha</th>
                                        <th className="p-3">Lider</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {executiveCompareCompanyHistoryRows.map((row) => (
                                        <tr key={row.season} className={`border-b border-slate-100 ${row.season === selectedSeason ? 'bg-purple-50' : ''}`}>
                                          <td className="p-3 font-semibold text-slate-900">{row.season}</td>
                                          <td className="p-3 text-right text-slate-700">{row.current ? `${row.current.totalClosurePct.toFixed(1)}%` : 'Sin datos'}</td>
                                          <td className="p-3 text-right text-slate-700">{row.compare ? `${row.compare.totalClosurePct.toFixed(1)}%` : 'Sin datos'}</td>
                                          <td className="p-3 text-right font-semibold text-slate-900">{row.gap === null ? '-' : `${row.gap.toFixed(1)} pp`}</td>
                                          <td className="p-3 text-slate-700">{row.leader}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="space-y-6">
                                  <div className="rounded-2xl border border-slate-200 p-6">
                                    <div className="text-2xl font-bold text-slate-800 mb-5">Lectura histórica</div>
                                    <p className="text-xl leading-9 text-slate-600">{executiveCompareCompanyHistoryInsights.summaryLine}</p>
                                    <p className="mt-5 text-lg text-slate-500">
                                      Empates técnicos: {executiveCompareCompanyHistoryInsights.tiedCount}. Liderazgo actual: {companyName} {executiveCompareCompanyHistoryInsights.currentLeadCount} vs {executiveCompareCompanyName} {executiveCompareCompanyHistoryInsights.compareLeadCount}.
                                    </p>
                                    {executiveTrendComparisonInsights && (
                                      <p className="mt-5 text-lg text-emerald-700">{executiveTrendComparisonInsights.leader}</p>
                                    )}
                                  </div>
                                  <div className="rounded-2xl bg-slate-950 text-white p-6">
                                    <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Conclusión Entre Empresas</div>
                                    <p className="mt-4 text-2xl leading-10">
                                      {executiveCompareCompanyHistoryInsights.strongestHistoricalGap
                                        ? `La mayor apertura histórica se observa en ${executiveCompareCompanyHistoryInsights.strongestHistoricalGap.season}, con una brecha de ${Math.abs(executiveCompareCompanyHistoryInsights.strongestHistoricalGap.gap || 0).toFixed(1)} puntos de cierre total.`
                                        : 'Todavía no hay temporadas comparables suficientes para emitir una lectura histórica robusta entre empresas.'}
                                    </p>
                                    {executiveTrendComparisonInsights && (
                                      <p className="mt-4 text-lg leading-8 text-slate-300">{executiveTrendComparisonInsights.narrative}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {executiveCompanyRankingComparison && (
                                <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-6">
                                  <div className="rounded-2xl border border-slate-200 p-6">
                                    <div className="text-2xl font-bold text-slate-800 mb-5">Ranking automático</div>
                                    <div className="space-y-4">
                                      {executiveCompanyRankingComparison.rows.map((row, index) => (
                                        <div key={row.companyLabel} className="rounded-2xl bg-slate-50 p-5">
                                          <div className="flex items-start justify-between gap-4">
                                            <div>
                                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Posición {index + 1}</div>
                                              <div className="mt-2 text-2xl font-bold text-slate-900">{row.companyLabel}</div>
                                            </div>
                                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${row.tone.badge}`}>
                                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${row.tone.dot}`} />
                                              {row.tone.label}
                                            </span>
                                          </div>
                                          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                            <div className="rounded-xl bg-white p-3">
                                              <div className="text-xs uppercase tracking-wide text-slate-500">Puntaje</div>
                                              <div className="mt-2 text-2xl font-semibold text-slate-900">{row.score.toFixed(1)}</div>
                                            </div>
                                            <div className="rounded-xl bg-white p-3">
                                              <div className="text-xs uppercase tracking-wide text-slate-500">Cierre</div>
                                              <div className="mt-2 text-2xl font-semibold text-slate-900">{row.components.closure.toFixed(1)}</div>
                                            </div>
                                            <div className="rounded-xl bg-white p-3">
                                              <div className="text-xs uppercase tracking-wide text-slate-500">Tendencia</div>
                                              <div className="mt-2 text-2xl font-semibold text-slate-900">{row.components.trend.toFixed(1)}</div>
                                            </div>
                                            <div className="rounded-xl bg-white p-3">
                                              <div className="text-xs uppercase tracking-wide text-slate-500">Bloqueos</div>
                                              <div className="mt-2 text-2xl font-semibold text-slate-900">{row.components.blockers.toFixed(1)}</div>
                                            </div>
                                          </div>
                                          <p className="mt-4 text-lg leading-8 text-slate-600">{row.narrative}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="space-y-6">
                                    <div className="rounded-2xl border border-slate-200 p-6">
                                      <div className="text-2xl font-bold text-slate-800 mb-5">Regla de ranking</div>
                                      <p className="text-lg leading-8 text-slate-600">Cierre total 60%, tendencia 25% y disciplina de bloqueos 15%.</p>
                                      <p className="mt-4 text-lg leading-8 text-slate-600">{executiveCompanyRankingComparison.summaryLine}</p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-950 text-white p-6">
                                      <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Resultado Del Ranking</div>
                                      <p className="mt-4 text-2xl leading-10">{executiveCompanyRankingComparison.summaryLine}</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {executiveCompareCompanyRecommendation && (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                  <div className={`rounded-2xl border p-6 ${executiveCurrentRecommendation.tone.badge}`}>
                                    <div className="text-sm uppercase tracking-[0.25em]">Recomendación Actual</div>
                                    <div className="mt-3 text-2xl font-bold">{executiveCurrentRecommendation.tone.title}</div>
                                    <p className="mt-4 text-lg leading-8">{executiveCurrentRecommendation.summary}</p>
                                  </div>
                                  <div className={`rounded-2xl border p-6 ${executiveCompareCompanyRecommendation.tone.badge}`}>
                                    <div className="text-sm uppercase tracking-[0.25em]">Recomendación Comparada</div>
                                    <div className="mt-3 text-2xl font-bold">{executiveCompareCompanyRecommendation.tone.title}</div>
                                    <p className="mt-4 text-lg leading-8">{executiveCompareCompanyRecommendation.summary}</p>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
                              <AlertCircle className="mx-auto h-16 w-16 text-slate-300" />
                              <div className="mt-6 text-3xl font-bold text-slate-800">Sin comparativo histórico activo</div>
                              <p className="mt-4 text-xl text-slate-500">
                                Selecciona una empresa comparada en la vista ejecutiva para mostrar el historial de cierre total entre ambas empresas dentro de la presentación.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {currentSlide === 11 && (
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <div>
                              <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Decisión Final Para Comité</div>
                              <div className="mt-2 text-3xl font-bold text-slate-900">¿Qué decisión ejecutiva se recomienda presentar?</div>
                              <div className="mt-2 text-lg text-slate-500">{companyName} · {selectedSeason} · {executiveFieldLabel}</div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${executiveCurrentRecommendation.tone.badge}`}>
                              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${executiveCurrentRecommendation.tone.dot}`} />
                              {executiveCommitteeSlideSummary.decisionLabel}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-6">
                            <div className={`rounded-3xl border p-8 ${executiveCurrentRecommendation.tone.badge}`}>
                              <div className="text-sm uppercase tracking-[0.25em]">Dictamen ejecutivo</div>
                              <div className="mt-4 text-4xl font-extrabold">{executiveCurrentRecommendation.tone.title}</div>
                              <p className="mt-6 text-2xl leading-10">{executiveCurrentRecommendation.summary}</p>
                              <p className="mt-5 text-xl leading-9">{executiveCurrentRecommendation.nextStep}</p>
                              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                                {executiveCurrentRecommendation.reasons.map((reason) => (
                                  <div key={reason} className="rounded-2xl bg-white/70 px-4 py-3 text-lg">
                                    {reason}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <div className="text-sm uppercase tracking-wide text-slate-500">Cierre total</div>
                                <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.totalClosurePct.toFixed(1)}%</div>
                                <div className="mt-2 text-base text-slate-500">{executiveTotalDataClosure.readiness.title}</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <div className="text-sm uppercase tracking-wide text-slate-500">Tendencia</div>
                                <div className={`mt-3 text-3xl font-bold ${executiveCurrentCompanyTrend.tone.text}`}>{executiveCurrentCompanyTrend.tone.label}</div>
                                <div className="mt-2 text-base text-slate-500">{executiveCurrentCompanyTrend.delta.toFixed(1)} pp</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <div className="text-sm uppercase tracking-wide text-slate-500">Bloqueos visibles</div>
                                <div className="mt-3 text-3xl font-bold text-slate-900">{executiveTotalDataClosure.blockers.length}</div>
                                <div className="mt-2 text-base text-slate-500">Control de calidad pendiente</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <div className="text-sm uppercase tracking-wide text-slate-500">Bitácora advertida</div>
                                <div className="mt-3 text-3xl font-bold text-slate-900">{executiveExportWarningFilteredData.totalEvents}</div>
                                <div className="mt-2 text-base text-slate-500">Eventos visibles</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 md:col-span-2">
                                <div className="text-sm uppercase tracking-wide text-slate-500">Ranking ejecutivo</div>
                                <div className="mt-3 flex items-center justify-between gap-4">
                                  <div>
                                    <div className="text-3xl font-bold text-slate-900">{executiveCurrentCompanyRanking.score.toFixed(1)}</div>
                                    <div className="mt-2 text-base text-slate-500">{executiveCurrentCompanyRanking.tone.label}</div>
                                  </div>
                                  {executiveCompanyRankingComparison && (
                                    <div className="text-right">
                                      <div className="text-sm text-slate-500">Líder comparado</div>
                                      <div className="mt-2 text-xl font-semibold text-slate-900">{executiveCompanyRankingComparison.leader}</div>
                                      <div className="mt-1 text-sm text-slate-500">{Math.abs(executiveCompanyRankingComparison.gap).toFixed(1)} puntos</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Soporte de la decisión</div>
                              <div className="space-y-4">
                                {executiveTotalDataClosure.findings.map((finding) => (
                                  <div key={finding.title} className="rounded-2xl bg-slate-50 p-5">
                                    <div className="text-lg font-semibold text-slate-900">{finding.title}</div>
                                    <div className="mt-2 text-base text-slate-600">{finding.description}</div>
                                    <div className="mt-3 text-lg font-bold text-purple-700">{finding.emphasis}</div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 p-6">
                              <div className="text-2xl font-bold text-slate-800 mb-5">Riesgos a gobernar</div>
                              <div className="space-y-4">
                                <div className="rounded-2xl bg-slate-50 p-5">
                                  <div className="text-lg font-semibold text-slate-900">Bloqueos</div>
                                  <p className="mt-3 text-base leading-8 text-slate-600">{executiveCommitteeSlideSummary.blockerSummary}</p>
                                </div>
                                <div className={`rounded-2xl border p-5 ${executiveTrendWarning ? executiveTrendWarning.badge : executiveCurrentCompanyTrend.tone.badge}`}>
                                  <div className="text-lg font-semibold">Tendencia y cautelas</div>
                                  <p className="mt-3 text-base leading-8">{executiveCommitteeSlideSummary.trendSummary}</p>
                                  {executiveTrendWarning && (
                                    <p className="mt-3 text-base leading-8">{executiveTrendWarning.recommendation}</p>
                                  )}
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-5">
                                  <div className="text-lg font-semibold text-slate-900">Control de circulación</div>
                                  <p className="mt-3 text-base leading-8 text-slate-600">{executiveCommitteeSlideSummary.exportControlSummary}</p>
                                  <p className="mt-3 text-sm text-slate-500">{executiveExportWarningFiltersLabel}</p>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-6">
                              <div className="rounded-2xl border border-slate-200 p-6">
                                <div className="text-2xl font-bold text-slate-800 mb-5">Contexto comparado</div>
                                <p className="text-lg leading-8 text-slate-600">{executiveCommitteeSlideSummary.compareSummary}</p>
                                <p className="mt-4 text-lg leading-8 text-slate-600">{executiveCommitteeSlideSummary.rankingSummary}</p>
                                {executiveCompareCompanyInsights && (
                                  <p className="mt-4 text-base leading-8 text-slate-500">{executiveCompareCompanyInsights.summaryLine}</p>
                                )}
                                {executiveCompareCompanyRecommendation && (
                                  <div className={`mt-5 rounded-2xl border p-5 ${executiveCompareCompanyRecommendation.tone.badge}`}>
                                    <div className="text-sm uppercase tracking-[0.25em]">Empresa comparada</div>
                                    <div className="mt-3 text-2xl font-bold">{executiveCompareCompanyRecommendation.tone.title}</div>
                                    <p className="mt-3 text-base leading-8">{executiveCompareCompanyRecommendation.summary}</p>
                                  </div>
                                )}
                              </div>

                              <div className="rounded-2xl bg-slate-950 text-white p-6">
                                <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Mensaje Final Para Comité</div>
                                <p className="mt-5 text-2xl leading-10">{executiveCommitteeSlideSummary.finalMessage}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {currentSlide === 0 && (
                  <div className="text-center animate-fade-in-up w-full">
                    <FileText className="w-32 h-32 text-purple-600 mx-auto mb-8" />
                    <h1 className="text-5xl lg:text-6xl font-extrabold text-slate-800 mb-6">Reporte: {getReportTitle()}</h1>
                    <h2 className="text-3xl lg:text-4xl text-purple-600 font-medium mb-12">{companyName}</h2>
                    <p className="text-xl lg:text-2xl text-slate-500">Temporada {selectedSeason}</p>
                  </div>
                )}

                {currentSlide >= 1 && (
                  <div className="w-full h-full flex flex-col animate-fade-in-up pt-4">
                    <h2 className="text-3xl lg:text-4xl font-bold text-slate-800 mb-6 text-center">{getReportTitle()}</h2>
                    <div className="flex-1 bg-white rounded-3xl shadow-xl p-6 overflow-y-auto pb-24" style={{ maxHeight: 'calc(100vh - 120px)' }}>
                      <div className="text-center text-3xl text-slate-400 py-20 flex flex-col items-center">
                        <AlertCircle className="w-20 h-20 mb-6 text-slate-300" />
                        <p>La presentación extendida quedó disponible principalmente para la Vista Ejecutiva.</p>
                        <button onClick={exitPresentation} className="mt-8 px-6 py-3 bg-purple-100 text-purple-700 rounded-lg font-medium text-xl hover:bg-purple-200">
                          Volver a la vista normal
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex justify-between items-center p-6 bg-white/80 backdrop-blur-sm absolute bottom-0 left-0 right-0 z-10 border-t border-slate-200">
            <div className="text-slate-400 text-sm lg:text-base flex items-center">
              <span className="hidden sm:inline">Use las flechas del teclado </span>
              <span className="font-mono bg-slate-100 px-2 py-1 rounded ml-2">←</span>
              <span className="font-mono bg-slate-100 px-2 py-1 rounded ml-1">→</span>
              <span className="hidden sm:inline ml-2"> para navegar, o </span>
              <span className="font-mono bg-slate-100 px-2 py-1 rounded ml-2">ESC</span>
              <span className="hidden sm:inline ml-2"> para salir</span>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-6">
              <button 
                onClick={() => setCurrentSlide(s => Math.max(s - 1, 0))}
                disabled={currentSlide === 0}
                className="p-2 sm:p-3 rounded-full hover:bg-slate-200 text-slate-600 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
              <div className="text-xl sm:text-2xl font-bold text-slate-500 w-24 text-center">
                {currentSlide + 1} / {presentationMaxSlide + 1}
              </div>
              <button 
                onClick={() => setCurrentSlide(s => Math.min(s + 1, presentationMaxSlide))}
                disabled={currentSlide === presentationMaxSlide}
                className="p-2 sm:p-3 rounded-full hover:bg-slate-200 text-slate-600 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add specific CSS for print mode here if needed or use tailwind print classes */}
    </div>
  );
};
