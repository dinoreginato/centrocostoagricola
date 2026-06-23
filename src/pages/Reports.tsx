import { toast } from 'sonner';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { getSeasonFromDate, isDateInSeason } from '../lib/seasonUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Loader2, PieChart as PieChartIcon, AlertCircle, Beaker, FileText, X, Printer, Settings, DollarSign, Scale, Play, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';
import { loadReportsRawData } from '../services/reports';
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

const aggregateExecutiveCosts = (params: {
  seasonMonths: Array<{ key: string; shortLabel: string; fullLabel: string }>;
  seasonMonthKeys: Set<string>;
  sectorMeta: Map<string, { fieldId: string; fieldName: string; sectorName: string; hectares: number }>;
  fieldMeta: Map<string, { fieldName: string; hectares: number }>;
  fuelPrices: { diesel: number; gasoline: number };
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
  const { selectedCompany } = useCompany();
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

  // Preview Modal State
  const [showPreview, setShowPreview] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

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
    setCurrentSlide(0);
    setPresentationMode(false);
    setReportData([]);
    setMonthlyExpenses([]);
    setCategoryExpenses([]);
    setPendingInvoices([]);
    setChemicalProducts([]);
    setDetailedReport([]);
    setComparativeData([]);
  }, [selectedCompany?.id]);

  const presentationMaxSlide = activeTab === 'executive' ? 5 : activeTab === 'general' ? 3 : 1;

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
      return { ...row, previousTotal, delta, deltaPct, sharePct: executiveCurrentBase.totalSeasonCost > 0 ? (row.total / executiveCurrentBase.totalSeasonCost) * 100 : 0 };
    });

    const sectorRows = executiveCurrentBase.sectorRows.map((row) => {
      const previous = previousSectorMap.get(row.sectorId);
      const previousTotal = previous?.total || 0;
      const delta = row.total - previousTotal;
      const deltaPct = previousTotal > 0 ? (delta / previousTotal) * 100 : 0;
      return { ...row, previousTotal, delta, deltaPct, sharePct: executiveCurrentBase.totalSeasonCost > 0 ? (row.total / executiveCurrentBase.totalSeasonCost) * 100 : 0 };
    });

    const seasonVariation = executiveCurrentBase.totalSeasonCost - executivePreviousBase.totalSeasonCost;
    const seasonVariationPct = executivePreviousBase.totalSeasonCost > 0 ? (seasonVariation / executivePreviousBase.totalSeasonCost) * 100 : 0;

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
        topField: executiveCurrentBase.topField,
        topSector: executiveCurrentBase.topSector,
        previousSeasonCost: executivePreviousBase.totalSeasonCost,
        seasonVariation,
        seasonVariationPct
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

  const executiveViewData = useMemo(() => {
    if (executiveFieldFilter === 'all') return executiveData;

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
    const alerts = [
      ...monthlyRows
        .filter((row) => row.total > 0 && row.vsPreviousSeasonPct >= 15)
        .map((row) => ({
          level: row.vsPreviousSeasonPct >= 30 ? 'alta' : 'media',
          title: `Alza mensual en ${row.monthLabel}`,
          message: `El campo ${selectedField?.fieldName || ''} sube ${row.vsPreviousSeasonPct.toFixed(1)}% frente a la temporada anterior.`,
          amount: row.vsPreviousSeason
        })),
      ...filteredSectorRows
        .filter((row) => row.total > 0 && row.deltaPct >= 20)
        .slice(0, 3)
        .map((row) => ({
          level: row.deltaPct >= 35 ? 'alta' : 'media',
          title: `Sector ${row.sectorName} en alza`,
          message: `Acumula ${row.deltaPct.toFixed(1)}% más gasto que la temporada anterior.`,
          amount: row.delta
        }))
    ].sort((a, b) => b.amount - a.amount);

    return {
      ...executiveData,
      monthlyRows,
      categoryRows: filteredCategoryRows,
      fieldRows: selectedField ? [selectedField] : [],
      sectorRows: filteredSectorRows,
      alerts,
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
        peakMonth,
        topField: selectedField,
        topSector: filteredSectorRows[0] || null
      }
    };
  }, [
    executiveData,
    executiveFieldFilter,
    executivePreviousBase.fieldRows,
    executiveSeasonMonths,
    previousExecutiveSeasonMonths,
    reportData
  ]);

  const executiveInsights = useMemo(() => {
    const tone = getExecutiveTone(Math.abs(executiveViewData.kpis.seasonVariationPct));
    const topMonth = executiveViewData.kpis.peakMonth;
    const topField = executiveViewData.kpis.topField;
    const topSector = executiveViewData.kpis.topSector;

    const findings = [
      {
        title: 'Variación acumulada',
        description: `La temporada ${selectedSeason} ${executiveViewData.kpis.seasonVariation >= 0 ? 'sube' : 'baja'} ${Math.abs(executiveViewData.kpis.seasonVariationPct).toFixed(1)}% frente a ${previousExecutiveSeason}.`,
        emphasis: `${formatCLP(executiveViewData.kpis.seasonVariation)}`
      },
      {
        title: 'Mayor concentración',
        description: topField
          ? `${topField.fieldName} lidera el gasto consolidado y representa ${topField.sharePct.toFixed(1)}% del total visible.`
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

  const executiveHistoricalSeasonRows = useMemo(() => {
    return availablePreviousExecutiveSeasons.map((season) => {
      const base = aggregateExecutiveCosts({
        seasonMonths: buildExecutiveSeasonMonths(season),
        seasonMonthKeys: new Set(buildExecutiveSeasonMonths(season).map((month) => month.key)),
        sectorMeta: executiveSectorMeta,
        fieldMeta: executiveFieldMeta,
        fuelPrices: executiveFuelPrices,
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
        { Indicador: 'Gasto total temporada', Valor: Number(executiveViewData.kpis.totalSeasonCost.toFixed(0)) },
        { Indicador: 'Temporada anterior', Valor: Number(executiveViewData.kpis.previousSeasonCost.toFixed(0)) },
        { Indicador: 'Variación temporada', Valor: Number(executiveViewData.kpis.seasonVariation.toFixed(0)) },
        { Indicador: 'Variación temporada %', Valor: Number(executiveViewData.kpis.seasonVariationPct.toFixed(2)) },
        { Indicador: 'Promedio mensual', Valor: Number(executiveViewData.kpis.averageMonthlyCost.toFixed(0)) },
        { Indicador: 'Alertas activas', Valor: executiveInsights.activeAlertCount },
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
          { name: 'Alertas', rows: alertRows }
        ]
      });
    } catch (error: any) {
      toast.error(`No se pudo exportar el reporte ejecutivo: ${error?.message || 'intenta nuevamente.'}`);
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
    rawInvoices,
    rawLabor,
    rawWorkerCosts,
    rawFuel,
    rawFuelConsumption,
    rawMachinery,
    rawIrrigation,
    rawGeneralCosts,
    rawProducts,
    incomeEntries,
    selectedSeason,
    usdExchangeRate,
    distributeGeneralCosts
  ]);

  useEffect(() => {
    // Only process if we have sectors/fields loaded, otherwise wait
    processReports();
  }, [rawFields, rawApplications, rawInvoices, rawLabor, rawWorkerCosts, rawFuel, rawFuelConsumption, rawMachinery, rawIrrigation, rawGeneralCosts, rawProducts, incomeEntries, selectedSeason, processReports]);

  async function loadRawDataImpl() {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const res = await loadReportsRawData({ companyId: selectedCompany.id });
      setRawFields(res.fields || []);
      setRawApplications(res.applications || []);
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

      setAvailableSeasons(res.availableSeasons || []);
      if (res.availableSeasons && res.availableSeasons.length > 0 && !res.availableSeasons.includes(selectedSeason)) {
        setSelectedSeason(res.availableSeasons[0]);
      }

    } catch {
      setRawFields([]);
      setRawApplications([]);
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
      setLoading(false);
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

    const avgPriceDiesel = totalDieselLiters > 0 ? totalDieselCost / totalDieselLiters : 0;
    const avgPriceGasoline = totalGasLiters > 0 ? totalGasCost / totalGasLiters : 0;

    // Filter apps by season
    const filteredApps = rawApplications.filter(app => {
      if (!app.application_date) return false;
      return isDateInSeason(app.application_date, selectedSeason);
    });

    // Filter labor by season
    const filteredLabor = rawLabor.filter(lab => {
      if (!lab.assigned_date) return false;
      return isDateInSeason(lab.assigned_date, selectedSeason);
    });

    // Filter Worker Costs by season
    const filteredWorkerCosts = rawWorkerCosts.filter(w => {
        if (!w.date) return false;
        return isDateInSeason(w.date, selectedSeason);
    });

    // Filter Fuel by season (Direct)
    const filteredFuel = rawFuel.filter(item => {
      if (!item.assigned_date) return false;
      return isDateInSeason(item.assigned_date, selectedSeason);
    });

    // Filter Fuel Consumption by season
    const filteredFuelConsumption = rawFuelConsumption.filter(item => {
      if (!item.date) return false; // column is 'date'
      return isDateInSeason(item.date, selectedSeason);
    });

    // Filter Machinery by season
    const filteredMachinery = rawMachinery.filter(item => {
      if (!item.assigned_date) return false;
      return isDateInSeason(item.assigned_date, selectedSeason);
    });

    // Filter Irrigation by season
    const filteredIrrigation = rawIrrigation.filter(item => {
      if (!item.assigned_date) return false;
      return isDateInSeason(item.assigned_date, selectedSeason);
    });

    // Filter General Costs by season
    const filteredGeneral = rawGeneralCosts.filter(item => {
      if (!item.date) return false;
      return isDateInSeason(item.date, selectedSeason);
    });

    const data: ReportData[] = [];

    rawFields.forEach(field => {
      field.sectors?.forEach((sector: any) => {
        // Costs
        const sectorApps = filteredApps.filter(app => app.sector_id === sector.id);
        const appCost = sectorApps.reduce((sum, app) => sum + Number(app.total_cost), 0);
        
        const sectorLabor = filteredLabor.filter(lab => lab.sector_id === sector.id);
        const laborCost = sectorLabor.reduce((sum, lab) => sum + Number(lab.assigned_amount), 0);
        
        let labor_cosecha_cost = 0;
        let labor_poda_cost = 0;
        let labor_raleo_cost = 0;
        let labor_otros_cost = 0;

        sectorLabor.forEach(lab => {
            const amount = Number(lab.assigned_amount);
            const type = (lab.labor_type || '').toLowerCase();
            if (type.includes('cosecha')) {
                labor_cosecha_cost += amount;
            } else if (type.includes('poda')) {
                labor_poda_cost += amount;
            } else if (type.includes('raleo')) {
                labor_raleo_cost += amount;
            } else {
                labor_otros_cost += amount;
            }
        });

        const sectorWorkers = filteredWorkerCosts.filter(w => w.sector_id === sector.id);
        const workerCost = sectorWorkers.reduce((sum, w) => sum + Number(w.amount), 0);

        const sectorFuelDirect = filteredFuel.filter(item => item.sector_id === sector.id);
        const sectorFuelCons = filteredFuelConsumption.filter(item => item.sector_id === sector.id);
        
        // Split fuel costs (We need to guess type from activity for Consumption, or assume Diesel for Direct)
        // Direct Fuel Assignment is typically Diesel (old system)
        const fuelCostDirect = sectorFuelDirect.reduce((sum, item) => sum + Number(item.assigned_amount), 0);
        
        let fuelCostDiesel = fuelCostDirect;
        let fuelCostGasoline = 0;

        sectorFuelCons.forEach(item => {
            const activity = (item.activity || '').toLowerCase();
            let cost = Number(item.estimated_price);
            
            const isGasoline = activity.includes('gasolina') || activity.includes('bencina');
            
            // Fallback: If cost is 0 but we have liters, calculate it
            if (cost === 0 && item.liters > 0) {
                if (isGasoline) {
                    cost = item.liters * avgPriceGasoline;
                } else {
                    cost = item.liters * avgPriceDiesel;
                }
            }
            
            if (isGasoline) {
                fuelCostGasoline += cost;
            } else {
                fuelCostDiesel += cost;
            }
        });

        const fuelCost = fuelCostDiesel + fuelCostGasoline;

        const sectorMachinery = filteredMachinery.filter(item => item.sector_id === sector.id);
        const machineryCost = sectorMachinery.reduce((sum, item) => sum + Number(item.assigned_amount), 0);

        const sectorIrrigation = filteredIrrigation.filter(item => item.sector_id === sector.id);
        const irrigationCost = sectorIrrigation.reduce((sum, item) => sum + Number(item.assigned_amount), 0);

        const sectorGeneral = filteredGeneral.filter(item => item.sector_id === sector.id);
        const generalCost = sectorGeneral.reduce((sum, item) => sum + Number(item.amount), 0);

        // For General Report: Total Cost = Apps + Labor + Workers + Fuel + Machinery + Irrigation + General
        const totalCostGeneral = appCost + laborCost + workerCost + fuelCost + machineryCost + irrigationCost + generalCost;
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
        
        const budgetPerHa = Number(sector.budget) || 0;
        
        data.push({
          field_name: field.name,
          sector_name: sector.name,
          sector_id: sector.id,
          fruit_type: String((field as any).fruit_type || ''),
          hectares: hectares,
          total_cost: totalCostGeneral, // Default for General Table
          cost_per_ha: hectares > 0 ? totalCostGeneral / hectares : 0, // Default for General Table
          cost_per_kg: kgProduced > 0 ? totalCostGeneral / kgProduced : 0, // NEW: Cost per Kg
          application_count: sectorApps.length,
          kg_produced: kgProduced,
          price_per_kg: pricePerKg,
          kg_export: kgExport,
          price_export: priceExport,
          income_usd_export: usdExport,
          kg_jugo: kgJugo,
          price_jugo: priceJugo,
          income_usd_jugo: usdJugo,
          budget_per_ha: budgetPerHa,
          total_budget: budgetPerHa * hectares,
          income_estimated: kgSold * pricePerKg * (usdExchangeRate || 1), // New pre-calculated field
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

    const filteredWorkerCostsCurrent = rawWorkerCosts.filter(w => {
      if (!w.date) return false;
      return isDateInSeason(w.date, selectedSeason);
    });

    const filteredWorkerCostsPrev = rawWorkerCosts.filter(w => {
      if (!w.date) return false;
      return isDateInSeason(w.date, prevSeason);
    });

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

    filteredWorkerCostsCurrent.forEach(w => {
      try {
        let date = new Date(w.date + 'T12:00:00');
        if (isNaN(date.getTime())) {
          const parts = String(w.date).split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }
        if (!isNaN(date.getTime())) {
          const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
          const mKey = monthNames[date.getMonth()];
          const amount = Number(w.amount) || 0;

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

    filteredWorkerCostsPrev.forEach(w => {
      try {
        let date = new Date(w.date + 'T12:00:00');
        if (isNaN(date.getTime())) {
          const parts = String(w.date).split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }
        if (!isNaN(date.getTime())) {
          const mKey = monthNames[date.getMonth()];
          const amount = Number(w.amount) || 0;

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
            ['Alertas activas', String(executiveInsights.activeAlertCount)],
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
            ['Hectáreas reportadas', executiveViewData.kpis.totalHectares.toFixed(2)],
            ['Campo con mayor gasto', executiveViewData.kpis.topField ? `${executiveViewData.kpis.topField.fieldName} (${formatCLP(executiveViewData.kpis.topField.total)})` : '-'],
            ['Sector con mayor gasto', executiveViewData.kpis.topSector ? `${executiveViewData.kpis.topSector.sectorName} (${formatCLP(executiveViewData.kpis.topSector.total)})` : '-'],
            ['Mes más alto', executiveViewData.kpis.peakMonth ? `${executiveViewData.kpis.peakMonth.monthLabel} (${formatCLP(executiveViewData.kpis.peakMonth.total)})` : '-']
          ],
          theme: 'grid',
          headStyles: { fillColor: [88, 28, 135] }
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
            head: [['Sector/Campo', 'Has', 'Ingresos (CLP)', 'Costos (CLP)', 'Utilidad (CLP)', 'Utilidad/Ha', 'Margen %']],
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
      const profit = income - cost;
      const ha = Number(row.hectares || 0);
      const profitPerHa = ha > 0 ? profit / ha : 0;
      const marginPct = income > 0 ? (profit / income) * 100 : 0;
      return {
        field_name: row.field_name,
        sector_name: row.sector_name,
        hectares: ha,
        kg_produced: Number(row.kg_produced || 0),
        price_per_kg: Number(row.price_per_kg || 0),
        income,
        cost,
        profit,
        profit_per_ha: profitPerHa,
        margin_pct: marginPct
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

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes de Gestión</h1>
          <p className="text-sm text-gray-500">Vista integral de costos y gastos</p>
        </div>
        <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-3">
          <button
            onClick={handleGeneratePDF}
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
                onClick={() => void exportExecutiveExcel()}
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
                    <p className="text-sm text-gray-500">Enfoca la vista por campo y elige la temporada anterior que quieres usar como base comparativa.</p>
                  </div>
                  <div className="grid w-full xl:w-auto grid-cols-1 md:grid-cols-2 gap-3">
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
                      </div>
                    </div>
                  </div>
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

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
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
                          label={({ category, percent }) => `${category} ${(percent * 100).toFixed(0)}%`}
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
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">Campo</th>
                        {executiveSeasonMonths.map((month) => (
                          <th key={month.key} className="px-4 py-3 text-right font-medium text-gray-500 uppercase">{month.shortLabel}</th>
                        ))}
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
                <p className="mt-1 text-sm text-gray-500">Ingresos estimados vs costos por sector</p>
              </div>
              <button
                onClick={() => {
                  const { rows, totals } = getMarginRows();
                  const csvRows = [['Campo', 'Sector', 'Has', 'Ingresos (CLP)', 'Costos (CLP)', 'Utilidad (CLP)', 'Utilidad/Ha', 'Margen %']];
                  rows.forEach((r) => {
                    csvRows.push([
                      r.field_name,
                      r.sector_name,
                      r.hectares.toString(),
                      r.income.toFixed(2),
                      r.cost.toFixed(2),
                      r.profit.toFixed(2),
                      r.profit_per_ha.toFixed(2),
                      r.margin_pct.toFixed(2)
                    ]);
                  });
                  csvRows.push(['TOTAL', '', totals.totalHa.toString(), totals.totalIncome.toFixed(2), totals.totalCost.toFixed(2), totals.totalProfit.toFixed(2), totals.totalProfitPerHa.toFixed(2), totals.totalMarginPct.toFixed(2)]);
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
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector/Campo</th>
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

                {currentSlide >= 1 && currentSlide <= 5 && (
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
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {currentSlide === 2 && (
                        <div className="space-y-8 h-full">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
