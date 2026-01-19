
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FileDown, Loader2, Calendar, PieChart as PieChartIcon, AlertCircle, Beaker, FileText, X, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportData {
  field_name: string;
  sector_name: string;
  hectares: number;
  total_cost: number;
  cost_per_ha: number;
  application_count: number;
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

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1', '#a4de6c', '#d0ed57'];

// Categories considered as "Chemicals" or "Inputs"
const CHEMICAL_CATEGORIES = [
  'Quimicos', 'Plaguicida', 'Insecticida', 'Fungicida', 'Herbicida', 
  'Fertilizantes', 'fertilizante', 'pesticida', 'herbicida', 'fungicida', 'Insumo'
];

export const Reports: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'applications' | 'monthly' | 'categories' | 'pending' | 'chemicals' | 'detailed'>('applications');
  
  // Data State
  const [rawFields, setRawFields] = useState<any[]>([]);
  const [rawApplications, setRawApplications] = useState<any[]>([]);
  const [rawInvoices, setRawInvoices] = useState<any[]>([]);

  // Filter State
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [availableYears, setAvailableYears] = useState<string[]>([]);

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

  // Preview Modal State
  const [showPreview, setShowPreview] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (selectedCompany) {
      loadRawData();
    }
  }, [selectedCompany]);

  // Process data whenever raw data or selected year changes
  useEffect(() => {
    processReports();
  }, [rawFields, rawApplications, rawInvoices, selectedYear]);

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

      // 2. Fetch Applications
      const { data: applications } = await supabase
        .from('applications')
        .select('field_id, sector_id, total_cost, application_date')
        .in('field_id', (fields || []).map(f => f.id));
      
      setRawApplications(applications || []);

      // 3. Fetch Invoices with Items and Product details
      const { data: invoices } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, supplier, invoice_date, due_date, total_amount, status,
          invoice_items (
            total_price, category, quantity, unit_price,
            products (name)
          )
        `)
        .eq('company_id', selectedCompany.id);
      
      setRawInvoices(invoices || []);

      // 4. Extract Years
      const yearsSet = new Set<string>();
      const currentYear = new Date().getFullYear().toString();
      yearsSet.add(currentYear);

      applications?.forEach(app => {
        if (app.application_date) {
          yearsSet.add(app.application_date.substring(0, 4));
        }
      });

      invoices?.forEach(inv => {
        if (inv.invoice_date) {
          try {
             let dateStr = inv.invoice_date;
             if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                yearsSet.add(dateStr.substring(0, 4));
             } else {
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) {
                   yearsSet.add(d.getFullYear().toString());
                }
             }
          } catch (e) {}
        }
      });

      const sortedYears = Array.from(yearsSet).sort().reverse();
      setAvailableYears(sortedYears);
      
      if (!sortedYears.includes(selectedYear)) {
        setSelectedYear(sortedYears[0]);
      }

    } catch (error) {
      console.error('Error loading raw data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processReports = () => {
    processApplicationReports();
    processFinancialReports();
    processDetailedReport();
  };

  const processDetailedReport = () => {
    // Filter invoices by selected year
    const filteredInvoices = rawInvoices.filter(inv => {
      if (!inv.invoice_date) return false;
      return inv.invoice_date.substring(0, 4) === selectedYear;
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
            // Note: Invoices have items with categories.
            // If invoice has items, we use them. If not (shouldn't happen with correct data), we use fallback.
            
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

    const filteredApps = rawApplications.filter(app => {
      if (!app.application_date) return false;
      return app.application_date.substring(0, 4) === selectedYear;
    });

    const data: ReportData[] = [];

    rawFields.forEach(field => {
      field.sectors?.forEach((sector: any) => {
        const sectorApps = filteredApps.filter(app => app.sector_id === sector.id);
        const totalCost = sectorApps.reduce((sum, app) => sum + Number(app.total_cost), 0);
        const hectares = Number(sector.hectares);
        
        data.push({
          field_name: field.name,
          sector_name: sector.name,
          hectares: hectares,
          total_cost: totalCost,
          cost_per_ha: hectares > 0 ? totalCost / hectares : 0,
          application_count: sectorApps.length
        });
      });
    });

    setReportData(data);
  };

  const processFinancialReports = () => {
    const filteredInvoices = rawInvoices.filter(inv => {
      try {
        if (!inv.invoice_date) return false;
        let year = '';
        if (inv.invoice_date.match(/^\d{4}-\d{2}-\d{2}/)) {
           year = inv.invoice_date.substring(0, 4);
        } else {
           const d = new Date(inv.invoice_date);
           if (!isNaN(d.getTime())) year = d.getFullYear().toString();
        }
        return year === selectedYear;
      } catch {
        return false;
      }
    });

    // 1. Monthly Expenses
    const monthlyData = new Map<string, number>();
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    monthNames.forEach(m => monthlyData.set(`${m} ${selectedYear}`, 0));

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
            days_overdue: daysOverdue
          };
        } catch (e) { return null; }
      })
      .filter(Boolean) as PendingInvoice[];
      
    pending.sort((a, b) => b.days_overdue - a.days_overdue);
    setPendingInvoices(pending);
  };

  const handleGeneratePDF = () => {
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(18);
    doc.text(`Reporte de Gastos Mensuales Detallado`, 14, 20);
    doc.setFontSize(12);
    doc.text(`Empresa: ${selectedCompany?.name}`, 14, 28);
    doc.text(`Año: ${selectedYear}`, 14, 34);
    
    let subHeader = 'Filtros: ';
    if (filterMonth !== 'all') {
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        subHeader += `Mes: ${monthNames[parseInt(filterMonth)]} `;
    }
    if (filterCategory !== 'all') {
        subHeader += `| Categoría: ${filterCategory}`;
    }
    if (filterMonth === 'all' && filterCategory === 'all') subHeader += 'Todos';
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(subHeader, 14, 40);
    doc.setTextColor(0);

    let yPos = 50;

    // Filter Data for PDF
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
        // Recalculate month total based on filtered categories
        const monthTotal = month.categories.reduce((sum, cat) => sum + cat.total, 0);

        // Check for page break
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        // Month Header
        doc.setFontSize(14);
        doc.setTextColor(0, 100, 0); // Dark Green
        doc.text(`${month.monthName} - Total: ${formatCLP(monthTotal)}`, 14, yPos);
        yPos += 10;

        month.categories.forEach((cat) => {
            // Category Header
            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }

            // Table for Category Items
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
                    0: { cellWidth: 25 }, // Date
                    1: { cellWidth: 40 }, // Supplier
                    2: { cellWidth: 25 }, // Invoice #
                    3: { cellWidth: 'auto' }, // Description
                    4: { cellWidth: 30, halign: 'right' } // Total
                },
                margin: { left: 14, right: 14 },
                didDrawPage: (data) => {
                    yPos = data.cursor.y + 10;
                }
            });
            
            yPos = (doc as any).lastAutoTable.finalY + 10;
        });
        
        yPos += 10; // Space between months
    });

    // Save or Preview
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    setPreviewPdfUrl(pdfUrl);
    setShowPreview(true);
  };

  const downloadFromPreview = () => {
    if (previewPdfUrl) {
        const link = document.createElement('a');
        link.href = previewPdfUrl;
        link.download = `reporte_gastos_${selectedYear}.pdf`;
        link.click();
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;
  
  const getReportTitle = () => {
    switch(activeTab) {
      case 'applications': return 'Costos de Aplicación';
      case 'monthly': return 'Gastos Mensuales';
      case 'categories': return 'Gastos por Clasificación';
      case 'chemicals': return 'Insumos Químicos';
      case 'pending': return 'Facturas Pendientes';
      case 'detailed': return 'Informe Detallado';
      default: return 'Reporte';
    }
  };

  return (
    <div className="space-y-6">
        {/* PDF PREVIEW MODAL */}
        {showPreview && (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-75 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
                    <div className="flex justify-between items-center p-4 border-b">
                        <h3 className="text-lg font-medium text-gray-900 flex items-center">
                            <Printer className="mr-2 h-5 w-5 text-gray-500" />
                            Vista Previa de Impresión
                        </h3>
                        <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-500">
                            <X className="h-6 w-6" />
                        </button>
                    </div>
                    <div className="flex-1 bg-gray-100 p-4 overflow-hidden">
                        {previewPdfUrl ? (
                            <iframe 
                                src={previewPdfUrl} 
                                className="w-full h-full border border-gray-300 rounded shadow" 
                                title="PDF Preview"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
                            </div>
                        )}
                    </div>
                    <div className="p-4 border-t bg-gray-50 flex justify-end space-x-3">
                        <button
                            onClick={() => setShowPreview(false)}
                            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                            Cerrar
                        </button>
                        <button
                            onClick={downloadFromPreview}
                            className="px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
                        >
                            <FileDown className="mr-2 h-4 w-4 inline" />
                            Descargar PDF
                        </button>
                    </div>
                </div>
            </div>
        )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes de Gestión</h1>
          <p className="text-sm text-gray-500">Vista integral de costos y gastos</p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={handleGeneratePDF}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <Printer className="mr-2 h-4 w-4" /> Generar Informe PDF
          </button>
        </div>
      </div>

      <div className="hidden print:block mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{selectedCompany.name}</h1>
        <h2 className="text-xl text-gray-600 mt-2">{getReportTitle()} - {selectedYear}</h2>
        <p className="text-sm text-gray-400 mt-1">Generado el {new Date().toLocaleDateString()}</p>
      </div>

      <div className="border-b border-gray-200 print:hidden">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          <button
            onClick={() => setActiveTab('applications')}
            className={`${
              activeTab === 'applications' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <PieChartIcon className="mr-2 h-4 w-4" /> Costos de Aplicación
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`${
              activeTab === 'monthly' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Calendar className="mr-2 h-4 w-4" /> Gastos Mensuales
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`${
              activeTab === 'categories' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <PieChartIcon className="mr-2 h-4 w-4" /> Por Clasificación
          </button>
          <button
            onClick={() => setActiveTab('chemicals')}
            className={`${
              activeTab === 'chemicals' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Beaker className="mr-2 h-4 w-4" /> Insumos Químicos
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`${
              activeTab === 'pending' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <AlertCircle className="mr-2 h-4 w-4" /> Facturas Pendientes
          </button>
          <button
            onClick={() => setActiveTab('detailed')}
            className={`${
              activeTab === 'detailed' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <FileText className="mr-2 h-4 w-4" /> Informe Detallado
          </button>
        </nav>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="animate-spin h-8 w-8 text-green-600" />
        </div>
      ) : (
        <div className="mt-6">
          {/* 1. APPLICATIONS REPORT */}
          {activeTab === 'applications' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Costo por Hectárea ({selectedYear})</h3>
                </div>
                <div className="h-96 w-full">
                  {reportData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">No hay datos para {selectedYear}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reportData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="sector_name" label={{ value: 'Sector', position: 'insideBottom', offset: -5 }} />
                        <YAxis tickFormatter={(value) => formatCLP(value)} />
                        <Tooltip formatter={(value) => formatCLP(Number(value))} />
                        <Legend />
                        <Bar dataKey="cost_per_ha" name="Costo por Hectárea" fill="#2E7D32" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              
              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Detalle por Sector ({selectedYear})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hectáreas</th>
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
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCLP(row.total_cost)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-700">{formatCLP(row.cost_per_ha)}</td>
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
              <h3 className="text-lg font-medium text-gray-900 mb-4">Evolución de Gastos Mensuales ({selectedYear})</h3>
              <div className="h-96 w-full">
                {monthlyExpenses.every(m => m.total === 0) ? (
                  <div className="flex h-full items-center justify-center text-gray-500">No hay gastos en {selectedYear}</div>
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">Gastos por Clasificación ({selectedYear})</h3>
                <div className="h-80 w-full">
                  {categoryExpenses.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">No hay gastos en {selectedYear}</div>
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">Detalle de Categorías ({selectedYear})</h3>
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
              <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Insumos Químicos y Fertilizantes ({selectedYear})</h3>
                  <p className="mt-1 text-sm text-gray-500">Detalle de productos adquiridos según facturas</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-gray-500">Total Insumos:</span>
                  <span className="ml-2 text-xl font-bold text-green-700">
                    {formatCLP(chemicalProducts.reduce((sum, p) => sum + p.total_cost, 0))}
                  </span>
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
                        <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No hay compras de insumos registradas en {selectedYear}</td>
                      </tr>
                    ) : (
                      chemicalProducts.map((prod, index) => (
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
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. PENDING INVOICES REPORT */}
          {activeTab === 'pending' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Facturas Pendientes de Pago (Total Histórico)</h3>
                  <p className="mt-1 text-sm text-gray-500">Ordenadas por fecha de vencimiento</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-gray-500">Total Pendiente:</span>
                  <span className="ml-2 text-xl font-bold text-red-600">
                    {formatCLP(pendingInvoices.reduce((sum, inv) => sum + inv.total_amount, 0))}
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vencimiento</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Días</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proveedor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">N° Factura</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pendingInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No hay facturas pendientes</td>
                      </tr>
                    ) : (
                      pendingInvoices.map((inv) => (
                        <tr key={inv.id} className={inv.days_overdue > 0 ? 'bg-red-50' : ''}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {new Date(inv.due_date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {inv.days_overdue > 0 ? (
                              <>
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 print:hidden">
                                  {inv.days_overdue} días vencida
                                </span>
                                <span className="hidden print:inline text-red-700 font-bold">
                                  {inv.days_overdue} días
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 print:hidden">
                                  Al día ({Math.abs(inv.days_overdue)} restantes)
                                </span>
                                <span className="hidden print:inline text-green-700">
                                  {Math.abs(inv.days_overdue)} rest.
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{inv.supplier}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{inv.invoice_number}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{formatCLP(inv.total_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* 6. DETAILED REPORT (NEW) */}
          {activeTab === 'detailed' && (
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Informe Detallado Mensual y por Clasificación ({selectedYear})</h3>
                    <div className="space-y-8">
                        {/* Filters */}
                        <div className="flex flex-col sm:flex-row gap-4 mb-4">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Filtrar por Mes</label>
                                <select
                                    value={filterMonth}
                                    onChange={(e) => setFilterMonth(e.target.value)}
                                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                >
                                    <option value="all">Todos los Meses</option>
                                    {detailedReport.map(m => (
                                        <option key={m.monthIndex} value={m.monthIndex.toString()}>{m.monthName}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Filtrar por Categoría</label>
                                <select
                                    value={filterCategory}
                                    onChange={(e) => setFilterCategory(e.target.value)}
                                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                >
                                    <option value="all">Todas las Categorías</option>
                                    {Array.from(new Set(detailedReport.flatMap(m => m.categories.map(c => c.name)))).map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {detailedReport
                            .filter(m => filterMonth === 'all' || m.monthIndex.toString() === filterMonth)
                            .map((month) => {
                                // Filter categories for display
                                const displayCategories = month.categories.filter(c => filterCategory === 'all' || c.name === filterCategory);
                                if (displayCategories.length === 0) return null;

                                return (
                                <div key={month.monthIndex} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="bg-green-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                                        <h4 className="text-lg font-bold text-green-800">{month.monthName}</h4>
                                        <span className="text-sm font-medium text-green-700 bg-green-100 px-3 py-1 rounded-full">
                                            Total Mes: {formatCLP(month.total)}
                                        </span>
                                    </div>
                                    <div className="p-4 space-y-6">
                                        {displayCategories.map((cat, catIdx) => (
                                            <div key={catIdx}>
                                                <h5 className="text-sm font-bold text-gray-700 mb-2 border-b border-gray-100 pb-1 flex justify-between">
                                                    <span>{cat.name}</span>
                                                    <span>{formatCLP(cat.total)}</span>
                                                </h5>
                                                <div className="overflow-x-auto">
                                                    <table className="min-w-full divide-y divide-gray-100">
                                                        <thead className="bg-gray-50">
                                                            <tr>
                                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Proveedor</th>
                                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">N° Doc</th>
                                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalle</th>
                                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {cat.items.map((item, itemIdx) => (
                                                                <tr key={itemIdx} className="hover:bg-gray-50">
                                                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                                                                        {new Date(item.date).toLocaleDateString()}
                                                                    </td>
                                                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">
                                                                        {item.supplier}
                                                                    </td>
                                                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                                                                        {item.invoiceNumber}
                                                                    </td>
                                                                    <td className="px-3 py-2 text-xs text-gray-500">
                                                                        {item.description}
                                                                    </td>
                                                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-right font-medium text-gray-900">
                                                                        {formatCLP(item.total)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        {detailedReport.filter(m => filterMonth === 'all' || m.monthIndex.toString() === filterMonth).length === 0 && (
                             <div className="text-center text-gray-500 py-8">No hay registros que coincidan con los filtros.</div>
                        )}
                    </div>
                </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
