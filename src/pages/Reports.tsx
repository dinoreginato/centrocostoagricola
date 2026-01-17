
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FileDown, Loader2, Calendar, PieChart as PieChartIcon, AlertCircle } from 'lucide-react';

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
}

interface PendingInvoice {
  id: string;
  invoice_number: string;
  supplier: string;
  due_date: string;
  total_amount: number;
  days_overdue: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1', '#a4de6c', '#d0ed57'];

export const Reports: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'applications' | 'monthly' | 'categories' | 'pending'>('applications');
  
  // State for different reports
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState<MonthlyExpense[]>([]);
  const [categoryExpenses, setCategoryExpenses] = useState<CategoryExpense[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);

  useEffect(() => {
    if (selectedCompany) {
      loadAllReports();
    }
  }, [selectedCompany]);

  const loadAllReports = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      await Promise.all([
        loadApplicationReports(),
        loadFinancialReports()
      ]);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadApplicationReports = async () => {
    if (!selectedCompany) return;
    
    // 1. Get all fields and sectors for the company
    const { data: fields } = await supabase
      .from('fields')
      .select('id, name, sectors(id, name, hectares)')
      .eq('company_id', selectedCompany.id);

    if (!fields) return;

    // 2. Get all applications for these fields
    const { data: applications } = await supabase
      .from('applications')
      .select('field_id, sector_id, total_cost')
      .in('field_id', fields.map(f => f.id));

    // 3. Aggregate Data
    const data: ReportData[] = [];

    fields.forEach(field => {
      field.sectors?.forEach(sector => {
        const sectorApps = applications?.filter(app => app.sector_id === sector.id) || [];
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

  const loadFinancialReports = async () => {
    if (!selectedCompany) return;

    // Fetch invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, supplier, invoice_date, due_date, total_amount, status, invoice_items(total_price, category)')
      .eq('company_id', selectedCompany.id);

    if (!invoices) return;

    // 1. Monthly Expenses
    const monthlyData = new Map<string, number>();
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    invoices.forEach(inv => {
      const date = new Date(inv.invoice_date);
      const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      monthlyData.set(key, (monthlyData.get(key) || 0) + Number(inv.total_amount));
    });

    // Sort chronologically (needs helper but for now simple iteration)
    // Actually better to sort by date string YYYY-MM then map to names
    const sortedKeys = Array.from(monthlyData.keys()); // Simplified for now
    const monthlyStats: MonthlyExpense[] = sortedKeys.map(key => ({
      month: key,
      total: monthlyData.get(key) || 0
    }));
    setMonthlyExpenses(monthlyStats);

    // 2. Category Expenses
    const catData = new Map<string, number>();
    invoices.forEach(inv => {
      inv.invoice_items?.forEach((item: any) => {
        const cat = item.category || 'Sin Categoría';
        catData.set(cat, (catData.get(cat) || 0) + Number(item.total_price));
      });
    });

    const catStats: CategoryExpense[] = Array.from(catData.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
    setCategoryExpenses(catStats);

    // 3. Pending Invoices
    const today = new Date();
    const pending: PendingInvoice[] = invoices
      .filter(inv => inv.status === 'Pendiente')
      .map(inv => {
        const dueDate = inv.due_date ? new Date(inv.due_date) : new Date(inv.invoice_date); // Fallback to invoice date if no due date
        const diffTime = today.getTime() - dueDate.getTime();
        const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          supplier: inv.supplier,
          due_date: inv.due_date || 'Sin vencimiento',
          total_amount: Number(inv.total_amount),
          days_overdue: daysOverdue
        };
      })
      .sort((a, b) => b.days_overdue - a.days_overdue); // Most overdue first

    setPendingInvoices(pending);
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes de Gestión</h1>
          <p className="text-sm text-gray-500">Vista integral de costos y gastos</p>
        </div>
        <button className="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
          <FileDown className="mr-2 h-4 w-4" /> Exportar
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          <button
            onClick={() => setActiveTab('applications')}
            className={`${
              activeTab === 'applications'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <PieChartIcon className="mr-2 h-4 w-4" />
            Costos de Aplicación
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`${
              activeTab === 'monthly'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Calendar className="mr-2 h-4 w-4" />
            Gastos Mensuales
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`${
              activeTab === 'categories'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <PieChartIcon className="mr-2 h-4 w-4" />
            Por Clasificación
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`${
              activeTab === 'pending'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <AlertCircle className="mr-2 h-4 w-4" />
            Facturas Pendientes
          </button>
        </nav>
      </div>

      {/* Content Area */}
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">Costo por Hectárea (por Sector)</h3>
                <div className="h-96 w-full">
                  {reportData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">No hay datos</div>
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
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Detalle por Sector</h3>
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
              <h3 className="text-lg font-medium text-gray-900 mb-4">Evolución de Gastos Mensuales</h3>
              <div className="h-96 w-full">
                {monthlyExpenses.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-gray-500">No hay datos de facturas</div>
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">Gastos por Clasificación</h3>
                <div className="h-80 w-full">
                  {categoryExpenses.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">No hay datos</div>
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">Detalle de Categorías</h3>
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

          {/* 4. PENDING INVOICES REPORT */}
          {activeTab === 'pending' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Facturas Pendientes de Pago</h3>
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
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                                {inv.days_overdue} días vencida
                              </span>
                            ) : (
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                Al día ({Math.abs(inv.days_overdue)} restantes)
                              </span>
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
        </div>
      )}
    </div>
  );
};
