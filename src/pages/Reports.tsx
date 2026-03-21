
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { getSeasonFromDate, getSeasonRange, isDateInSeason } from '../lib/seasonUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FileDown, Loader2, Calendar, PieChart as PieChartIcon, AlertCircle, Beaker, FileText, X, Printer, Settings, DollarSign, Scale, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';

interface ReportData {
  field_name: string;
  sector_name: string;
  sector_id: string; 
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
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1', '#a4de6c', '#d0ed57'];

// Categories considered as "Chemicals" or "Inputs"
const CHEMICAL_CATEGORIES = [
  'Quimicos', 'Plaguicida', 'Insecticida', 'Fungicida', 'Herbicida', 
  'Fertilizantes', 'fertilizante', 'pesticida', 'herbicida', 'fungicida'
];

export const Reports: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'applications' | 'monthly' | 'categories' | 'pending' | 'paid_payments' | 'chemicals' | 'detailed' | 'budget'>('general');
  const [activeGroup, setActiveGroup] = useState<'general' | 'financial' | 'inventory'>('general');
  
  // Pending Invoices Filter State
  const [pendingStartDate, setPendingStartDate] = useState<string>('');
  const [pendingEndDate, setPendingEndDate] = useState<string>('');

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
  const [productionRecords, setProductionRecords] = useState<any[]>([]); 
  const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>([]);

  // Filter State
  const [selectedSeason, setSelectedSeason] = useState<string>(getSeasonFromDate(new Date()));
  const [availableSeasons, setAvailableSeasons] = useState<string[]>([]);

  // Settings State (USD, etc)
  const [usdExchangeRate, setUsdExchangeRate] = useState<number>(950);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingProduction, setEditingProduction] = useState<boolean>(false); 
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Partial<IncomeEntry>>({});
  const [distributeGeneralCosts, setDistributeGeneralCosts] = useState(false);
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

  // Preview Modal State
  const [showPreview, setShowPreview] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  // Presentation State
  const [presentationMode, setPresentationMode] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Production Record Input State
  const [editingProdSectorId, setEditingProdSectorId] = useState<string | null>(null);
  const [editingProdKg, setEditingProdKg] = useState<string>('');
  const [editingProdPrice, setEditingProdPrice] = useState<string>('');

  // Filtered Pending Invoices
  const filteredPendingInvoices = pendingInvoices.filter(invoice => {
    if (!pendingStartDate && !pendingEndDate) return true;
    
    // Check against Due Date (Vencimiento) as requested "Facturas Vencidas"
    // Or Issue Date? User said "SELECCIONAR POR FECHAS LAS FACTURAS VENCIDAS".
    // Usually means filtering by the Due Date range.
    const dateToCheck = new Date(invoice.due_date);
    const start = pendingStartDate ? new Date(pendingStartDate) : null;
    const end = pendingEndDate ? new Date(pendingEndDate) : null;

    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);

    if (start && end) {
      return dateToCheck >= start && dateToCheck <= end;
    } else if (start) {
      return dateToCheck >= start;
    } else if (end) {
      return dateToCheck <= end;
    }
    return true;
  });

  useEffect(() => {
    if (selectedCompany) {
      loadRawData();
    }
  }, [selectedCompany]);

  // Update presentation logic to support 4 slides for General tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!presentationMode) return;
      
      const maxSlides = activeTab === 'general' ? 3 : 1; // 0=Title, 1=Overview, 2=Labor, 3=Profit
      
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setCurrentSlide(s => Math.min(s + 1, maxSlides));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentSlide(s => Math.max(s - 1, 0));
      } else if (e.key === 'Escape') {
        exitPresentation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [presentationMode, activeTab]);

  const startPresentation = () => {
    setPresentationMode(true);
    setCurrentSlide(0);
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(err => console.log('Error attempting to enable fullscreen:', err));
    }
  };

  const exitPresentation = () => {
    setPresentationMode(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(err => console.log('Error attempting to exit fullscreen:', err));
    }
  };

  // Process data whenever raw data or selected season changes
  useEffect(() => {
    // Only process if we have sectors/fields loaded, otherwise wait
    if (rawFields.length > 0) {
        processReports();
    }
  }, [rawFields, rawApplications, rawInvoices, rawLabor, rawWorkerCosts, rawFuel, rawFuelConsumption, rawMachinery, rawIrrigation, rawGeneralCosts, productionRecords, incomeEntries, selectedSeason]);

  const loadRawData = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // 1. Fetch Fields
      const { data: fields } = await supabase
        .from('fields')
        .select('id, name, sectors(id, name, hectares)')
        .eq('company_id', selectedCompany.id);
      
      setRawFields(fields || []);
      const fieldIds = (fields || []).map(f => f.id);
      const sectorIds = (fields || []).flatMap(f => f.sectors.map((s:any) => s.id));

      // 2. Fetch Applications
      const { data: applications } = await supabase
        .from('applications')
        .select('field_id, sector_id, total_cost, application_date')
        .in('field_id', fieldIds);
      
      setRawApplications(applications || []);

      // 2b. Fetch Labor Assignments
      const { data: labor } = await supabase
        .from('labor_assignments')
        .select('sector_id, assigned_amount, assigned_date, labor_type')
        .in('sector_id', sectorIds);
      setRawLabor(labor || []);

      // 2b2. Fetch Worker Costs (Plant Staff)
      const { data: workers } = await supabase
        .from('worker_costs')
        .select('sector_id, amount, date')
        .in('sector_id', sectorIds);
      setRawWorkerCosts(workers || []);

      // 2c. Fetch Fuel Assignments (Direct)
      const { data: fuel } = await supabase
        .from('fuel_assignments')
        .select('sector_id, assigned_amount, assigned_date')
        .in('sector_id', sectorIds);
      setRawFuel(fuel || []);

      // 2d. Fetch Fuel Consumption (Stock System)
      const { data: fuelCons } = await supabase
        .from('fuel_consumption')
        .select('sector_id, estimated_price, date, activity, liters') 
        .in('sector_id', sectorIds);
      setRawFuelConsumption(fuelCons || []);

      // 2e. Fetch Machinery
      const { data: machinery } = await supabase
        .from('machinery_assignments')
        .select('sector_id, assigned_amount, assigned_date')
        .in('sector_id', sectorIds);
      setRawMachinery(machinery || []);

      // 2f. Fetch Irrigation
      const { data: irrigation } = await supabase
        .from('irrigation_assignments')
        .select('sector_id, assigned_amount, assigned_date')
        .in('sector_id', sectorIds);
      setRawIrrigation(irrigation || []);

      // 2g. Fetch General Costs (Distributed)
      const { data: general } = await supabase
        .from('general_costs')
        .select('sector_id, amount, date')
        .in('sector_id', sectorIds);
      setRawGeneralCosts(general || []);

      // 2g. Fetch Production
      const { data: prod } = await supabase
        .from('production_records')
        .select('*')
        .eq('company_id', selectedCompany.id);
      setProductionRecords(prod || []);

      // 2h. Fetch Income Entries
      const { data: income } = await supabase
        .from('income_entries')
        .select('*, fields(name), sectors(name)')
        .eq('company_id', selectedCompany.id);
      setIncomeEntries(income || []);

      // 3. Fetch Invoices
      const { data: invoicesData } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, invoice_date, total_amount, supplier, status, due_date, document_type, notes,
          invoice_items (
            id, category, total_price, quantity,
            products (name, unit, category)
          )
        `)
        .eq('company_id', selectedCompany.id);
      
      setRawInvoices(invoicesData || []);

      // 4. Extract Seasons
      const seasonsSet = new Set<string>();
      seasonsSet.add(getSeasonFromDate(new Date()));

      applications?.forEach(app => {
        if (app.application_date) {
          seasonsSet.add(getSeasonFromDate(new Date(app.application_date)));
        }
      });

      invoicesData?.forEach(inv => {
        if (inv.invoice_date) {
            seasonsSet.add(getSeasonFromDate(new Date(inv.invoice_date)));
        }
      });

      const sortedSeasons = Array.from(seasonsSet).sort().reverse();
      setAvailableSeasons(sortedSeasons);
      
      if (!sortedSeasons.includes(selectedSeason)) {
        setSelectedSeason(sortedSeasons[0]);
      }

    } catch (error) {
      console.error('Error loading raw data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processReports = () => {
    processApplicationReports(); // This is effectively the "General Cost Report" now
    processFinancialReports();
    processDetailedReport();
  };

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
    if (!rawFields.length) return;

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

        // Production
        // We assume production records are stored with 'season_year' as the start year of the season
        // e.g., Season 2025-2026 -> season_year 2025
        const seasonStartYear = parseInt(selectedSeason.split('-')[0]);
        const prodRecord = productionRecords.find(p => p.sector_id === sector.id && p.season_year === seasonStartYear);
        const kgProduced = prodRecord ? Number(prodRecord.kg_produced) : 0;
        const pricePerKg = prodRecord ? Number(prodRecord.price_per_kg) : 0;
        const budgetPerHa = Number(sector.budget) || 0;
        
        data.push({
          field_name: field.name,
          sector_name: sector.name,
          sector_id: sector.id,
          hectares: hectares,
          total_cost: totalCostGeneral, // Default for General Table
          cost_per_ha: hectares > 0 ? totalCostGeneral / hectares : 0, // Default for General Table
          cost_per_kg: kgProduced > 0 ? totalCostGeneral / kgProduced : 0, // NEW: Cost per Kg
          application_count: sectorApps.length,
          kg_produced: kgProduced,
          price_per_kg: pricePerKg,
          budget_per_ha: budgetPerHa,
          total_budget: budgetPerHa * hectares,
          income_estimated: kgProduced * pricePerKg * (usdExchangeRate || 1), // New pre-calculated field
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
    const filteredInvoices = rawInvoices.filter(inv => {
      try {
        if (!inv.invoice_date) return false;
        return isDateInSeason(inv.invoice_date, selectedSeason);
      } catch {
        return false;
      }
    });

    // 1. Monthly Expenses
    const monthlyData = new Map<string, number>();
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    // For a season (e.g. 2025-2026), we want months from May 2025 to April 2026
    const [startYearStr] = selectedSeason.split('-');
    const startYear = parseInt(startYearStr);
    
    // Generate keys for the season
    // May(4) to Dec(11) of startYear
    for (let m = 4; m <= 11; m++) {
        monthlyData.set(`${monthNames[m]} ${startYear}`, 0);
    }
    // Jan(0) to Apr(3) of startYear + 1
    for (let m = 0; m <= 3; m++) {
        monthlyData.set(`${monthNames[m]} ${startYear + 1}`, 0);
    }

    filteredInvoices.forEach(inv => {
      try {
        if (!inv.invoice_date) return;
        let date = new Date(inv.invoice_date);
        if (isNaN(date.getTime())) {
          const parts = inv.invoice_date.split(/[-/]/);
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }

        if (!isNaN(date.getTime())) {
          const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
          if (monthlyData.has(key)) {
             const amount = Number(inv.total_amount) || 0;
             monthlyData.set(key, (monthlyData.get(key) || 0) + amount);
          }
        }
      } catch (e) {}
    });

    setMonthlyExpenses(Array.from(monthlyData.entries()).map(([month, total]) => ({ month, total })));

    // 2. Category Expenses
    const catData = new Map<string, number>();
    filteredInvoices.forEach(inv => {
      inv.invoice_items?.forEach((item: any) => {
        const cat = item.category || 'Sin Categoría';
        catData.set(cat, (catData.get(cat) || 0) + Number(item.total_price));
      });
    });

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
          return {
            id: inv.id,
            invoice_number: inv.invoice_number || 'S/N',
            supplier: inv.supplier || 'Desconocido',
            due_date: inv.due_date || inv.invoice_date || 'Sin fecha',
            total_amount: Number(inv.total_amount) || 0,
            days_overdue: daysOverdue,
            notes: inv.notes || ''
          };
        } catch (e) { return null; }
      })
      .filter(Boolean) as PendingInvoice[];
      
    pending.sort((a, b) => b.days_overdue - a.days_overdue);
    setPendingInvoices(pending);
  };

  const handleSaveProduction = async (sectorId: string, kg: number, pricePerKg?: number) => {
    try {
        if (!selectedCompany) return;
        // Use the start year of the season for storage
        const seasonStartYear = parseInt(selectedSeason.split('-')[0]);
        
        const payload: any = {
            sector_id: sectorId,
            season_year: seasonStartYear,
            kg_produced: kg,
            company_id: selectedCompany.id,
            updated_at: new Date().toISOString()
        };

        if (pricePerKg !== undefined) {
            payload.price_per_kg = pricePerKg;
        }

        // Upsert production record
        const { error } = await supabase
            .from('production_records')
            .upsert(payload, { onConflict: 'sector_id, season_year' });

        if (error) throw error;

        // Update local state
        setProductionRecords(prev => {
            const existing = prev.findIndex(p => p.sector_id === sectorId && p.season_year === seasonStartYear);
            if (existing >= 0) {
                const newArr = [...prev];
                newArr[existing] = { ...newArr[existing], kg_produced: kg };
                if (pricePerKg !== undefined) {
                    newArr[existing].price_per_kg = pricePerKg;
                }
                return newArr;
            } else {
                return [...prev, { sector_id: sectorId, season_year: seasonStartYear, kg_produced: kg, price_per_kg: pricePerKg }];
            }
        });
        
        loadRawData(); // Reload to refresh all calculations

    } catch (error: any) {
        console.error('Error saving production:', error);
        alert(`Error al guardar producción: ${error.message || JSON.stringify(error)}`);
    }
  };

  const handleSaveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    
    setLoading(true);
    try {
        const payload = {
            company_id: selectedCompany.id,
            date: editingIncome.date,
            category: editingIncome.category || 'Venta Fruta',
            amount: Number(editingIncome.amount),
            description: editingIncome.description,
            season: selectedSeason, // Or derived from date
            field_id: editingIncome.field_id || null,
            sector_id: editingIncome.sector_id || null,
            quantity_kg: Number(editingIncome.quantity_kg) || 0,
            amount_usd: Number(editingIncome.amount_usd) || 0,
            price_per_kg: Number(editingIncome.price_per_kg) || 0
        };

        if (editingIncome.id) {
            const { error } = await supabase
                .from('income_entries')
                .update(payload)
                .eq('id', editingIncome.id);
            if(error) throw error;
        } else {
            const { error } = await supabase
                .from('income_entries')
                .insert([payload]);
            if(error) throw error;
        }
        
        setShowIncomeModal(false);
        setEditingIncome({});
        loadRawData(); // Reload all data
        
    } catch (error: any) {
        alert('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteIncome = async (id: string) => {
    if(!confirm('¿Eliminar registro?')) return;
    setLoading(true);
    const { error } = await supabase.from('income_entries').delete().eq('id', id);
    if (!error) {
        loadRawData();
    } else {
        alert('Error al eliminar');
        setLoading(false);
    }
  };

  const handleGeneratePDF = () => {
    const doc = new jsPDF({ orientation: pdfOrientation });
    const title = getReportTitle();
    
    // Header
    doc.setFontSize(18);
    doc.text(`Reporte: ${title}`, 14, 20);
    doc.setFontSize(12);
    doc.text(`Empresa: ${selectedCompany?.name}`, 14, 28);
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
    } else if (activeTab === 'general') {
        subHeader = `Tipo de Cambio: ${formatCLP(usdExchangeRate)} CLP/USD`;
    }

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(subHeader, 14, 40);
    doc.setTextColor(0);

    let yPos = 50;

    // --- REPORT GENERATION LOGIC BASED ON ACTIVE TAB ---

    if (activeTab === 'general') {
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
        // MONTHLY EXPENSES REPORT
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

    } else if (activeTab === 'pending') {
        // PENDING INVOICES REPORT
        if (pendingStartDate || pendingEndDate) {
            const startStr = pendingStartDate ? new Date(pendingStartDate).toLocaleDateString() : 'Inicio';
            const endStr = pendingEndDate ? new Date(pendingEndDate).toLocaleDateString() : 'Fin';
            doc.text(`Rango Vencimiento: ${startStr} - ${endStr}`, 14, 45);
            yPos += 5;
        }

        const tableBody = filteredPendingInvoices.map(inv => [
            new Date(inv.due_date).toLocaleDateString(),
            `${inv.days_overdue} días`,
            inv.supplier,
            inv.invoice_number,
            formatCLP(inv.total_amount),
            inv.notes || '-'
        ]);

        // Calculate Total
        const totalAmount = filteredPendingInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);

        autoTable(doc, {
            startY: yPos,
            head: [['Vencimiento', 'Días Vencida', 'Proveedor', 'N° Factura', 'Monto', 'Notas']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 53, 69] }, // Red
            columnStyles: {
                4: { halign: 'right', fontStyle: 'bold' },
                5: { fontStyle: 'italic', cellWidth: 50 } // Smaller/italic for notes
            },
            foot: [['', '', '', 'TOTAL:', formatCLP(totalAmount), '']],
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
      case 'applications': return 'Costos de Aplicación';
      case 'monthly': return 'Gastos Mensuales';
      case 'categories': return 'Gastos por Clasificación';
      case 'chemicals': return 'Insumos Químicos';
      case 'pending': return 'Facturas Pendientes';
      case 'paid_payments': return 'Pagos Realizados por Categoría';
      case 'detailed': return 'Informe Detallado';
      default: return 'Reporte';
    }
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
              setActiveTab('general');
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
        <h1 className="text-3xl font-bold text-gray-900">{selectedCompany.name}</h1>
        <h2 className="text-xl text-gray-600 mt-2">{getReportTitle()} - {selectedSeason}</h2>
        <p className="text-sm text-gray-400 mt-1">Generado el {new Date().toLocaleDateString()}</p>
      </div>

      <div className="border-b border-gray-200 print:hidden mb-4">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => { setActiveGroup('general'); setActiveTab('general'); }}
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
        </nav>
      </div>

      <div className="border-b border-gray-100 print:hidden mb-6 bg-slate-50 p-2 rounded-t-lg">
        {activeGroup === 'general' && (
            <nav className="flex space-x-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab('general')}
                className={`${
                  activeTab === 'general' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Costos Generales (USD/Kg)
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
                onClick={() => setActiveTab('paid_payments')}
                className={`${
                  activeTab === 'paid_payments' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                } px-3 py-1.5 rounded-md font-medium text-sm transition-colors`}
              >
                Pagos Realizados
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
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Resumen por Sector</h3>
                            <p className="mt-1 text-sm text-gray-500">Kilos enviados y valores totales</p>
                        </div>
                        <div className="mt-2 sm:mt-0 flex items-center">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={distributeGeneralCosts}
                                    onChange={(e) => setDistributeGeneralCosts(e.target.checked)}
                                    className="form-checkbox h-4 w-4 text-green-600 transition duration-150 ease-in-out"
                                />
                                <span className="text-sm font-medium text-gray-700">Distribuir Gastos No Asignados (Proporcional a Has)</span>
                            </label>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector / Campo</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Has</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Kilos (Kg)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ingresos (USD)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ingresos (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Directos (CLP)</th>
                                    {distributeGeneralCosts && (
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Gral. (CLP)</th>
                                    )}
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Total (USD)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gastos Total (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance (USD)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance (CLP)</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Promedio USD/Kg</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {(() => {
                                    // 0. Calculate General Distribution Factor
                                    const totalInvoices = monthlyExpenses.reduce((sum, m) => sum + m.total, 0);
                                    const totalAllocated = reportData.reduce((sum, r) => sum + r.total_cost, 0);
                                    const totalHectares = reportData.reduce((sum, r) => sum + r.hectares, 0);
                                    
                                    // Unassigned costs = Total Invoices - Allocated Costs (Usage)
                                    // If negative (usage > purchase), we assume 0 unassigned.
                                    const unassignedCost = Math.max(0, totalInvoices - totalAllocated);
                                    const distributionFactor = (distributeGeneralCosts && totalHectares > 0) 
                                        ? unassignedCost / totalHectares 
                                        : 0;

                                    // 1. Income Aggregation
                                    const incomeMap = incomeEntries.reduce((acc, entry) => {
                                        const key = entry.sector_id || 'general';
                                        const name = entry.sectors ? `${entry.sectors.name} (${entry.fields?.name})` : (entry.fields?.name || 'Empresa General');
                                        if (!acc[key]) acc[key] = { name, kg: 0, usd: 0, clp: 0 };
                                        acc[key].kg += Number(entry.quantity_kg || 0);
                                        acc[key].usd += Number(entry.amount_usd || 0);
                                        acc[key].clp += Number(entry.amount || 0);
                                        return acc;
                                    }, {} as Record<string, { name: string, kg: number, usd: number, clp: number }>);

                                    // 2. Expense Aggregation (Direct Costs + Distributed)
                                    const expenseMap = reportData.reduce((acc, r) => {
                                        // Direct Cost
                                        const direct = r.total_cost;
                                        // Distributed Cost
                                        const distributed = r.hectares * distributionFactor;
                                        
                                        acc[r.sector_id] = {
                                            direct: direct,
                                            distributed: distributed,
                                            total: direct + distributed,
                                            hectares: r.hectares
                                        };
                                        return acc;
                                    }, {} as Record<string, { direct: number, distributed: number, total: number, hectares: number }>);

                                    // 3. Merge
                                    const allKeysSet = new Set([...Object.keys(incomeMap), ...Object.keys(expenseMap)]);
                                    if (unassignedCost > 0 && !distributeGeneralCosts) {
                                        allKeysSet.add('general');
                                    }
                                    const allKeys = Array.from(allKeysSet);
                                    
                                    const rows = allKeys.map(key => {
                                        const inc = incomeMap[key] || { name: '', kg: 0, usd: 0, clp: 0 };
                                        const expData = expenseMap[key] || { direct: 0, distributed: 0, total: 0, hectares: 0 };
                                        
                                        // Try to find name if missing in income
                                        let displayName = inc.name;
                                        if (!displayName && key !== 'general') {
                                            const r = reportData.find(d => d.sector_id === key);
                                            if (r) displayName = `${r.sector_name} (${r.field_name})`;
                                            else displayName = 'Sector Desconocido';
                                        } else if (!displayName) {
                                            displayName = 'Empresa General';
                                        }

                                        // If 'general' key exists and distribute is ON, its expenses (unassigned) are distributed to sectors, so they are 0 here.
                                        // But wait, 'unassignedCost' is calculated globally.
                                        // The 'general' row in this table usually comes from 'incomeEntries' with no sector.
                                        // It should not show expenses if they are distributed.
                                        
                                        let finalExpense = expData.total;
                                        
                                        // If key is 'general' and we are NOT distributing, we should probably show the unassigned cost here?
                                        // But 'expenseMap' only has keys from 'reportData' (sectors).
                                        // So 'general' key in 'expenseMap' is undefined unless a sector is named 'general'.
                                        
                                        // If we are NOT distributing, the unassigned cost is simply not shown in sector rows.
                                        // Should we show a "General / No Asignado" row?
                                        // Yes, if there is income there, or if we want to balance the total.
                                        
                                        if (key === 'general' && !distributeGeneralCosts && unassignedCost > 0) {
                                            // Show unassigned cost in General row if not distributed
                                            finalExpense += unassignedCost;
                                        }

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
                                                    {distributeGeneralCosts && (
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600">{formatCLP(row.expenseDistributed)}</td>
                                                    )}
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
                                                {distributeGeneralCosts && (
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600">{formatCLP(totalExpenseDistributed)}</td>
                                                )}
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
                        <button
                            onClick={() => {
                                setEditingIncome({});
                                setShowIncomeModal(true);
                            }}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"
                        >
                            <DollarSign className="mr-2 h-4 w-4" />
                            Agregar Ingreso
                        </button>
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
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
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
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(entry.date).toLocaleDateString()}</td>
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
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <button 
                                                    onClick={() => {
                                                        setEditingIncome(entry);
                                                        setShowIncomeModal(true);
                                                    }}
                                                    className="text-indigo-600 hover:text-indigo-900 mr-4"
                                                >
                                                    Editar
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteIncome(entry.id)}
                                                    className="text-red-600 hover:text-red-900"
                                                >
                                                    Eliminar
                                                </button>
                                            </td>
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
                    <button
                        onClick={() => setEditingProduction(!editingProduction)}
                        className={`text-sm font-medium px-3 py-1 rounded-md border ${editingProduction ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                        {editingProduction ? 'Finalizar Edición' : 'Editar Producción (Kg)'}
                    </button>
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
                        * Ingrese la producción de Kg en la tabla para calcular costos unitarios.
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
                          const rows = [['Campo', 'Sector', 'Has', 'Prod. (Kg)', 'Mano Obra', 'Personal', 'Aplicaciones', 'Maquinaria', 'Riego', 'Petróleo', 'Combustible (Bencina)', 'Otros', 'Total (CLP)', 'Total (USD)', 'Costo/Ha (CLP)', 'Costo/Ha (USD)', 'Costo/Kg (CLP)', 'Costo/Kg (USD)']];
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
                          link.setAttribute("download", `Costos_Generales_${selectedCompany.name.replace(/\s+/g, '_')}_${selectedSeason}.csv`);
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
                                      {editingProduction ? (
                                          <div className="flex flex-col gap-1 w-full max-w-[120px]">
                                            <input 
                                                type="number" 
                                                placeholder="Kg"
                                                className="w-full text-right text-xs border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 p-1"
                                                defaultValue={row.kg_produced || ''}
                                                onBlur={(e) => {
                                                    const kg = Number(e.target.value);
                                                    const priceInput = e.target.parentElement?.querySelector('input[placeholder="US$/Kg"]') as HTMLInputElement;
                                                    const price = Number(priceInput?.value || row.price_per_kg || 0);
                                                    // Solo guardar si hay cambios, se maneja de forma simplificada por ahora o delegar a un botón "Guardar" global
                                                }}
                                            />
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                placeholder="US$/Kg"
                                                className="w-full text-right text-xs border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 p-1"
                                                defaultValue={row.price_per_kg || ''}
                                            />
                                            <button 
                                                onClick={(e) => {
                                                    const parent = e.currentTarget.parentElement;
                                                    const kg = Number((parent?.querySelector('input[placeholder="Kg"]') as HTMLInputElement)?.value || 0);
                                                    const price = Number((parent?.querySelector('input[placeholder="US$/Kg"]') as HTMLInputElement)?.value || 0);
                                                    
                                                    handleSaveProduction(row.sector_id, kg, price);
                                                }}
                                                className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded w-full"
                                            >
                                                Guardar
                                            </button>
                                          </div>
                                      ) : (
                                          <>
                                            <span className="font-medium text-gray-900">{(row.kg_produced || 0).toLocaleString('es-CL')} Kg</span>
                                            {row.price_per_kg > 0 && <span className="text-xs text-green-600 font-medium">US$ {row.price_per_kg}/Kg</span>}
                                          </>
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
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h3 className="text-lg leading-6 font-medium text-gray-900">Facturas Pendientes de Pago</h3>
                        <p className="mt-1 text-sm text-gray-500">Facturas ingresadas sin marcar como "Pagada"</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
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
                        {(pendingStartDate || pendingEndDate) && (
                            <button
                                onClick={() => { setPendingStartDate(''); setPendingEndDate(''); }}
                                className="mb-0.5 px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Limpiar
                            </button>
                        )}
                    </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vencimiento</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proveedor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">N° Factura</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notas</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Monto Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredPendingInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No hay facturas pendientes en el rango seleccionado.</td>
                      </tr>
                    ) : (
                      filteredPendingInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {new Date(inv.due_date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              inv.days_overdue > 0 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {inv.days_overdue > 0 ? `${inv.days_overdue} días vencida` : 'Por vencer'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{inv.supplier}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{inv.invoice_number}</td>
                          <td className="px-6 py-4 whitespace-normal text-sm text-gray-500 italic max-w-xs">{inv.notes || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900">{formatCLP(inv.total_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 7. PAID PAYMENTS REPORT */}
          {activeTab === 'paid_payments' && (
            <div className="space-y-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-wrap gap-4 items-center justify-between">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900">Pagos Realizados</h3>
                        <p className="text-sm text-gray-500">Segmentado por categoría y fecha de vencimiento</p>
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
                    const paidItems = rawInvoices
                        .filter(inv => inv.status === 'Pagada')
                        .filter(inv => {
                            if (!paidStartDate && !paidEndDate) return true;
                            const dateToCheck = new Date(inv.due_date || inv.invoice_date);
                            const start = paidStartDate ? new Date(paidStartDate) : null;
                            const end = paidEndDate ? new Date(paidEndDate) : null;
                            
                            if (start) start.setHours(0, 0, 0, 0);
                            if (end) end.setHours(23, 59, 59, 999);

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
                                const amount = Number(item.total_price) || 0;
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
                                                                {new Date(item.dueDate).toLocaleDateString()}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                {new Date(item.date).toLocaleDateString()}
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
                                                    new Date(item.date).toLocaleDateString('es-CL'),
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
                            link.setAttribute("download", `Reporte_Detallado_${selectedCompany.name.replace(/\s+/g, '_')}_${selectedSeason}.csv`);
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
                                                                {new Date(item.date).toLocaleDateString()}
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

      {showIncomeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{editingIncome.id ? 'Editar Ingreso' : 'Registrar Ingreso / Presupuesto'}</h3>
                <div className="text-sm text-gray-500 mb-4 text-right">
                    Tipo de Cambio: ${usdExchangeRate} CLP/USD
                </div>
                <form onSubmit={handleSaveIncome} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Fecha</label>
                        <input
                            type="date"
                            required
                            value={editingIncome.date || new Date().toISOString().split('T')[0]}
                            onChange={e => setEditingIncome({...editingIncome, date: e.target.value})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Categoría</label>
                        <select
                            value={editingIncome.category || 'Venta Fruta'}
                            onChange={e => setEditingIncome({...editingIncome, category: e.target.value})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        >
                            <option value="Venta Fruta">Venta Fruta / Exportación</option>
                            <option value="Presupuesto">Presupuesto Asignado</option>
                            <option value="Otro Ingreso">Otro Ingreso</option>
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Kilos (Kg)</label>
                            <input
                                type="number"
                                min="0"
                                value={editingIncome.quantity_kg || ''}
                                onChange={e => {
                                    const kg = Number(e.target.value);
                                    const price = editingIncome.price_per_kg || 0;
                                    const usdVal = kg * price;
                                    setEditingIncome({
                                        ...editingIncome, 
                                        quantity_kg: kg,
                                        amount_usd: usdVal,
                                        amount: Math.round(usdVal * usdExchangeRate)
                                    });
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Precio Venta (USD/Kg)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editingIncome.price_per_kg || ''}
                                onChange={e => {
                                    const price = Number(e.target.value);
                                    const kg = editingIncome.quantity_kg || 0;
                                    const usdVal = kg * price;
                                    setEditingIncome({
                                        ...editingIncome, 
                                        price_per_kg: price,
                                        amount_usd: usdVal,
                                        amount: Math.round(usdVal * usdExchangeRate)
                                    });
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Total (USD)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editingIncome.amount_usd || ''}
                                onChange={e => {
                                    const usdVal = Number(e.target.value);
                                    setEditingIncome({
                                        ...editingIncome, 
                                        amount_usd: usdVal,
                                        amount: Math.round(usdVal * usdExchangeRate)
                                    });
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Total (CLP)</label>
                            <input
                                type="number"
                                required
                                min="0"
                                value={editingIncome.amount || ''}
                                onChange={e => setEditingIncome({...editingIncome, amount: Number(e.target.value)})}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Descripción</label>
                        <input
                            type="text"
                            value={editingIncome.description || ''}
                            onChange={e => setEditingIncome({...editingIncome, description: e.target.value})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Campo (Opcional)</label>
                        <select
                            value={editingIncome.field_id || ''}
                            onChange={e => setEditingIncome({...editingIncome, field_id: e.target.value, sector_id: undefined})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        >
                            <option value="">General (Toda la Empresa)</option>
                            {rawFields.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>
                    {editingIncome.field_id && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Sector (Opcional)</label>
                            <select
                                value={editingIncome.sector_id || ''}
                                onChange={e => setEditingIncome({...editingIncome, sector_id: e.target.value})}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            >
                                <option value="">Todo el Campo</option>
                                {rawFields.find(f => f.id === editingIncome.field_id)?.sectors.map((s: any) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={() => setShowIncomeModal(false)}
                            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
                        >
                            Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
      {/* PRESENTATION MODE OVERLAY */}
      {presentationMode && (
        <div className="fixed inset-0 z-[99999] bg-slate-50 flex flex-col font-sans text-slate-900">
          {/* Top Bar (Auto-hides slightly, visible on hover) */}
          <div className="flex justify-between items-center p-6 opacity-30 hover:opacity-100 transition-opacity absolute top-0 left-0 right-0 z-10">
            <div className="text-xl font-bold text-slate-400">{selectedCompany?.name} - {getReportTitle()}</div>
            <button onClick={exitPresentation} className="text-slate-400 hover:text-red-500 bg-white/80 rounded-full p-2">
              <X className="w-8 h-8" />
            </button>
          </div>

          {/* Slides */}
          <div className="flex-1 flex flex-col items-center justify-center p-12 relative w-full max-w-[95vw] mx-auto overflow-hidden">
            
            {/* Slide 0: Title */}
            {currentSlide === 0 && (
              <div className="text-center animate-fade-in-up w-full">
                <FileText className="w-32 h-32 text-purple-600 mx-auto mb-8" />
                <h1 className="text-5xl lg:text-6xl font-extrabold text-slate-800 mb-6">Reporte: {getReportTitle()}</h1>
                <h2 className="text-3xl lg:text-4xl text-purple-600 font-medium mb-12">{selectedCompany?.name}</h2>
                <p className="text-xl lg:text-2xl text-slate-500">
                  Temporada {selectedSeason}
                </p>
              </div>
            )}

            {/* Slide 1 or 2: Content depending on active tab */}
            {(currentSlide >= 1 && currentSlide <= 3) && (
              <div className="w-full h-full flex flex-col animate-fade-in-up pt-4">
                <h2 className="text-3xl lg:text-4xl font-bold text-slate-800 mb-6 text-center">{getReportTitle()}</h2>
                
                <div className="flex-1 bg-white rounded-3xl shadow-xl p-6 overflow-y-auto pb-24" style={{ maxHeight: 'calc(100vh - 120px)' }}>
                  
                  {/* General Report - Overview */}
                  {activeTab === 'general' && currentSlide === 1 && (
                    <table className="w-full text-left text-base lg:text-lg">
                      <thead className="text-lg lg:text-xl text-slate-500 bg-slate-50 sticky top-0">
                        <tr>
                          <th className="p-3 lg:p-4">Sector/Campo</th>
                          <th className="p-3 lg:p-4 text-right">Hectáreas</th>
                          <th className="p-3 lg:p-4 text-right">Prod (Kg)</th>
                          <th className="p-3 lg:p-4 text-right">Ppto (CLP)</th>
                          <th className="p-3 lg:p-4 text-right">Total (CLP)</th>
                          <th className="p-3 lg:p-4 text-right font-bold text-purple-700">Costo/Ha (CLP)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((row, idx) => {
                          const isOverBudget = row.total_budget > 0 && row.total_cost > row.total_budget;
                          return (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-3 lg:p-4">
                              <div className="font-bold text-slate-800">{row.sector_name}</div>
                              <div className="text-sm lg:text-base text-slate-500">{row.field_name}</div>
                            </td>
                            <td className="p-3 lg:p-4 text-right">{row.hectares}</td>
                            <td className="p-3 lg:p-4 text-right">{(row.kg_produced || 0).toLocaleString('es-CL')}</td>
                            <td className="p-3 lg:p-4 text-right text-slate-500">
                                {row.total_budget > 0 ? formatCLP(row.total_budget) : '-'}
                            </td>
                            <td className={`p-3 lg:p-4 text-right ${isOverBudget ? 'text-red-600 font-bold' : ''}`}>
                                {formatCLP(row.total_cost)}
                                {isOverBudget && <div className="text-xs text-red-500 mt-1">▲ Sobre Ppto</div>}
                            </td>
                            <td className="p-3 lg:p-4 text-right font-bold text-purple-600">{formatCLP(row.cost_per_ha)}</td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  )}

                  {/* General Report - Cost/Kg & Labor Breakdown */}
                  {activeTab === 'general' && currentSlide === 2 && (
                    <div className="space-y-4 lg:space-y-8">
                        <h3 className="text-xl lg:text-2xl font-bold text-slate-700 border-b pb-2 lg:pb-4">Análisis por Kilo y Desglose Operativo</h3>
                        <table className="w-full text-left text-base lg:text-lg">
                          <thead className="text-lg lg:text-xl text-slate-500 bg-slate-50 sticky top-0">
                            <tr>
                              <th className="p-3 lg:p-4">Sector/Campo</th>
                              <th className="p-3 lg:p-4 text-right text-blue-700 font-bold">Costo / Kg</th>
                              <th className="p-3 lg:p-4 text-right">Mano de Obra (Labores)</th>
                              <th className="p-3 lg:p-4 text-right">Insumos (Aplic.)</th>
                              <th className="p-3 lg:p-4 text-right">Maquinaria</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.map((row, idx) => (
                              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="p-3 lg:p-4">
                                  <div className="font-bold text-slate-800">{row.sector_name}</div>
                                  <div className="text-sm lg:text-base text-slate-500">Prod: {(row.kg_produced || 0).toLocaleString('es-CL')} Kg</div>
                                </td>
                                <td className="p-3 lg:p-4 text-right font-bold">
                                  <div className="text-blue-600">{row.cost_per_kg > 0 ? formatCLP(row.cost_per_kg) : '-'}</div>
                                  {row.cost_per_kg > 0 && (
                                    <div className="text-xs lg:text-sm text-green-600 mt-1">
                                      US$ {(row.cost_per_kg / (usdExchangeRate || 1)).toFixed(2)}
                                    </div>
                                  )}
                                </td>
                                <td className="p-3 lg:p-4 text-right">
                                    <div className="text-slate-800 font-medium">{formatCLP(row.labor_cost)}</div>
                                    {row.labor_cost > 0 && (
                                        <div className="text-xs lg:text-sm text-slate-500 flex flex-col items-end mt-1">
                                            {row.labor_cosecha_cost > 0 && <span>Cosecha: {formatCLP(row.labor_cosecha_cost)}</span>}
                                            {row.labor_poda_cost > 0 && <span>Poda: {formatCLP(row.labor_poda_cost)}</span>}
                                            {row.labor_raleo_cost > 0 && <span>Raleo: {formatCLP(row.labor_raleo_cost)}</span>}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3 lg:p-4 text-right text-slate-600">{formatCLP(row.app_cost_only)}</td>
                                <td className="p-3 lg:p-4 text-right text-slate-600">{formatCLP(row.machinery_cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                    </div>
                  )}

                  {/* General Report - Profitability Analysis */}
                  {activeTab === 'general' && currentSlide === 3 && (
                    <div className="space-y-4 lg:space-y-8">
                        <h3 className="text-xl lg:text-2xl font-bold text-slate-700 border-b pb-2 lg:pb-4">Análisis de Rentabilidad Neta</h3>
                        <table className="w-full text-left text-base lg:text-lg">
                          <thead className="text-lg lg:text-xl text-slate-500 bg-slate-50 sticky top-0">
                            <tr>
                              <th className="p-3 lg:p-4">Sector/Campo</th>
                              <th className="p-3 lg:p-4 text-right">Prod (Kg)</th>
                              <th className="p-3 lg:p-4 text-right">Precio Venta (US$)</th>
                              <th className="p-3 lg:p-4 text-right">Ingreso Estimado (CLP)</th>
                              <th className="p-3 lg:p-4 text-right">Costo Total (CLP)</th>
                              <th className="p-3 lg:p-4 text-right font-bold text-green-700">Rentabilidad Neta (CLP)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.map((row, idx) => {
                                const totalIncomeCLP = row.income_estimated || 0;
                                const netProfit = totalIncomeCLP - row.total_cost;
                                const isProfitable = netProfit > 0;
                                return (
                              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="p-3 lg:p-4">
                                  <div className="font-bold text-slate-800">{row.sector_name}</div>
                                  <div className="text-sm lg:text-base text-slate-500">{row.field_name}</div>
                                </td>
                                <td className="p-3 lg:p-4 text-right">{(row.kg_produced || 0).toLocaleString('es-CL')}</td>
                                <td className="p-3 lg:p-4 text-right text-green-600 font-medium">
                                    {row.price_per_kg > 0 ? `US$ ${row.price_per_kg}` : '-'}
                                </td>
                                <td className="p-3 lg:p-4 text-right text-slate-600">
                                    {row.price_per_kg > 0 ? formatCLP(totalIncomeCLP) : '-'}
                                    {row.price_per_kg > 0 && <div className="text-xs text-green-600 mt-1">US$ {(totalIncomeCLP / (usdExchangeRate || 1)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>}
                                </td>
                                <td className="p-3 lg:p-4 text-right text-red-600">{formatCLP(row.total_cost)}</td>
                                <td className={`p-3 lg:p-4 text-right font-bold ${row.price_per_kg > 0 ? (isProfitable ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}`}>
                                    {row.price_per_kg > 0 ? formatCLP(netProfit) : '-'}
                                </td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                    </div>
                  )}

                  {/* Monthly Expenses */}
                  {activeTab === 'monthly' && (
                    <div className="h-full min-h-[400px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyExpenses} margin={{ top: 20, right: 30, left: 60, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="month" tick={{fontSize: 16, fill: '#475569'}} axisLine={false} tickLine={false} dy={10} />
                          <YAxis tickFormatter={(value) => formatCLP(value)} tick={{fontSize: 16, fill: '#475569'}} axisLine={false} tickLine={false} dx={-10} />
                          <Tooltip formatter={(value) => formatCLP(Number(value))} cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                          <Bar dataKey="total" name="Total Gastado" fill="#8b5cf6" radius={[8, 8, 0, 0]} barSize={60} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Categories */}
                  {activeTab === 'categories' && (
                     <div className="h-full min-h-[500px] flex justify-center">
                        <ResponsiveContainer width="80%" height="100%">
                            <PieChart>
                                <Pie
                                    data={categoryExpenses.sort((a,b) => b.total - a.total).slice(0, 10)} // Top 10 for presentation
                                    cx="50%"
                                    cy="50%"
                                    labelLine={true}
                                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                    outerRadius={200}
                                    fill="#8884d8"
                                    dataKey="total"
                                    nameKey="category"
                                >
                                    {categoryExpenses.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value: number) => formatCLP(value)} />
                                <Legend wrapperStyle={{ fontSize: '18px' }}/>
                            </PieChart>
                        </ResponsiveContainer>
                     </div>
                  )}

                  {/* Pending Invoices */}
                  {activeTab === 'pending' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {filteredPendingInvoices.map((inv, idx) => (
                        <div key={idx} className="bg-white p-8 rounded-2xl shadow border-l-8 border-red-500 flex flex-col">
                          <div className="text-2xl font-bold text-slate-800 mb-2 truncate" title={inv.supplier}>{inv.supplier}</div>
                          <div className="text-xl text-slate-500 mb-6">N° {inv.invoice_number}</div>
                          <div className="flex justify-between items-end mt-auto pt-4 border-t border-slate-100">
                            <div>
                              <div className="text-sm text-slate-400 uppercase tracking-wider mb-1">Vencimiento</div>
                              <div className="text-xl font-semibold text-red-600">
                                {new Date(inv.due_date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                              </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-800">{formatCLP(inv.total_amount)}</div>
                          </div>
                        </div>
                      ))}
                      {filteredPendingInvoices.length === 0 && (
                         <div className="col-span-full text-center text-3xl text-slate-400 py-20">No hay facturas pendientes.</div>
                      )}
                    </div>
                  )}

                  {/* Add fallback for other tabs to show a simple table or message */}
                  {!['general', 'monthly', 'categories', 'pending'].includes(activeTab) && (
                      <div className="text-center text-3xl text-slate-400 py-20 flex flex-col items-center">
                          <AlertCircle className="w-20 h-20 mb-6 text-slate-300" />
                          <p>Para esta vista, recomendamos generar el PDF o usar la tabla detallada.</p>
                          <button onClick={exitPresentation} className="mt-8 px-6 py-3 bg-purple-100 text-purple-700 rounded-lg font-medium text-xl hover:bg-purple-200">
                              Volver a la vista normal
                          </button>
                      </div>
                  )}

                </div>
              </div>
            )}
            
          </div>

          {/* Bottom Bar / Controls */}
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
                {currentSlide + 1} / {activeTab === 'general' ? 4 : 2}
              </div>
              <button 
                onClick={() => setCurrentSlide(s => Math.min(s + 1, activeTab === 'general' ? 3 : 1))}
                disabled={currentSlide === (activeTab === 'general' ? 3 : 1)}
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
