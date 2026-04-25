import { toast } from 'sonner';
import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { Loader2, Search, Calendar } from 'lucide-react';
import { fetchChemicalInvoices, fetchYearlyExchangeRates, getExchangeRateForDate } from '../services/chemicalCosts';

interface ChemicalItem {
  id: string;
  date: string;
  product_name: string;
  category: string;
  quantity: number;
  unit: string;
  total_price_clp: number;
  unit_price_clp: number;
  exchange_rate: number;
  total_price_usd: number;
  unit_price_usd: number;
  invoice_number: string;
  supplier: string;
}

const CHEMICAL_CATEGORIES = [
  'Quimicos', 'Plaguicida', 'Insecticida', 'Fungicida', 'Herbicida', 
  'Fertilizantes', 'fertilizante', 'pesticida', 'herbicida', 'fungicida'
];

export const ChemicalCosts: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ChemicalItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const [viewMode, setViewMode] = useState<'list' | 'summary'>('summary');

  const loadData = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // 1. Fetch Exchange Rates for the selected year
      const rates = await fetchYearlyExchangeRates(selectedYear);

      // 2. Fetch Invoices with items
      const invoices = await fetchChemicalInvoices({ companyId: selectedCompany.id, year: selectedYear });

      if (!invoices) return;

      const processedItems: ChemicalItem[] = [];

      invoices.forEach(inv => {
        if (!inv.invoice_date) return;
        
        // Get exchange rate for this invoice date
        const rate = getExchangeRateForDate(inv.invoice_date, rates);

        inv.invoice_items?.forEach((item: any) => {
          // Check if it's a chemical
          const cat = (item.category || item.products?.category || '').toLowerCase();
          const isChemical = CHEMICAL_CATEGORIES.some(c => cat.includes(c.toLowerCase()));
          
          if (isChemical) {
            const quantity = Number(item.quantity) || 0;
            const totalPriceClp = Number(item.total_price) || 0;
            const unitPriceClp = quantity > 0 ? totalPriceClp / quantity : 0;
            
            // Calculate USD values
            const totalPriceUsd = rate > 0 ? totalPriceClp / rate : 0;
            const unitPriceUsd = rate > 0 ? unitPriceClp / rate : 0;

            processedItems.push({
              id: item.id,
              date: inv.invoice_date,
              product_name: item.products?.name || 'Producto Desconocido',
              category: item.category || 'Sin Categoría',
              quantity,
              unit: item.products?.unit || 'Unid.',
              total_price_clp: totalPriceClp,
              unit_price_clp: unitPriceClp,
              exchange_rate: rate,
              total_price_usd: totalPriceUsd,
              unit_price_usd: unitPriceUsd,
              invoice_number: inv.invoice_number || '-',
              supplier: inv.supplier || '-'
            });
          }
        });
      });

      // Sort by date descending
      processedItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setItems(processedItems);

    } catch {
      toast.error('Error al cargar datos de químicos.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, selectedYear]);

  useEffect(() => {
    if (selectedCompany) {
      void loadData();
    }
  }, [selectedCompany, selectedYear, loadData]);

  const filteredItems = items.filter(item => 
    item.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.supplier.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const summaryData = React.useMemo(() => {
    const map = new Map<string, {
      name: string;
      category: string;
      unit: string;
      monthly: number[];
      total_qty: number;
      total_usd: number;
    }>();

    filteredItems.forEach(item => {
      const key = item.product_name;
      if (!map.has(key)) {
        map.set(key, {
          name: item.product_name,
          category: item.category,
          unit: item.unit,
          monthly: Array(12).fill(0),
          total_qty: 0,
          total_usd: 0
        });
      }
      
      const entry = map.get(key)!;
      // Adjust month based on date. Invoices are YYYY-MM-DD
      // We want to show Jan-Dec for the selectedYear
      const date = new Date(item.date);
      // Ensure we only process items for selectedYear (already filtered in loadData but good to be safe)
      if (date.getFullYear() === selectedYear) {
          const month = date.getMonth(); // 0-11
          entry.monthly[month] += item.total_price_usd;
      }
      
      entry.total_qty += item.quantity;
      entry.total_usd += item.total_price_usd;
    });

    return Array.from(map.values()).sort((a, b) => b.total_usd - a.total_usd);
  }, [filteredItems, selectedYear]);

  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Precios de Productos Químicos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Histórico de costos valorizados en Dólares (Banco Central)</p>
        </div>
        
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-300 dark:border-gray-600 flex">
                <button
                    onClick={() => setViewMode('summary')}
                    className={`px-3 py-2 text-sm font-medium rounded-l-md ${
                        viewMode === 'summary' 
                        ? 'bg-green-50 text-green-700' 
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                    }`}
                >
                    Resumen Mensual
                </button>
                <button
                    onClick={() => setViewMode('list')}
                    className={`px-3 py-2 text-sm font-medium rounded-r-md border-l border-gray-300 dark:border-gray-600 ${
                        viewMode === 'list' 
                        ? 'bg-green-50 text-green-700' 
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                    }`}
                >
                    Lista de Facturas
                </button>
            </div>

            <div className="flex items-center bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-300 dark:border-gray-600 px-3 py-2">
                <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                <select 
                    value={selectedYear} 
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="border-none focus:ring-0 text-sm p-0 text-gray-700 dark:text-gray-300"
                >
                    {[...Array(5)].map((_, i) => {
                        const year = new Date().getFullYear() - i;
                        return <option key={year} value={year}>{year}</option>;
                    })}
                </select>
            </div>
        </div>
      </div>

      {/* Search and Summary */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="relative w-full sm:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
                type="text"
                placeholder="Buscar producto, proveedor o categoría..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-10 sm:text-sm border-gray-300 dark:border-gray-600 rounded-md focus:ring-green-500 focus:border-green-500"
            />
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
            {viewMode === 'list' 
                ? `Mostrando ${filteredItems.length} registros`
                : `Mostrando ${summaryData.length} productos`
            }
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
            <Loader2 className="animate-spin h-8 w-8 text-green-600" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-lg">
            <div className="overflow-x-auto">
                {viewMode === 'list' ? (
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Producto</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Proveedor / Factura</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cantidad</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Dólar (Día)</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Costo Unit. (CLP)</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Costo Unit. (USD)</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total (USD)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredItems.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                        {new Date(item.date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.product_name}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.category}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm text-gray-900 dark:text-gray-100">{item.supplier}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">Fact: {item.invoice_number}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100">
                                        {item.quantity.toLocaleString('es-CL')} <span className="text-gray-500 dark:text-gray-400 text-xs">{item.unit}</span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500 dark:text-gray-400">
                                        {item.exchange_rate > 0 ? formatCLP(item.exchange_rate) : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100">
                                        {formatCLP(item.unit_price_clp)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-green-700">
                                        {item.unit_price_usd > 0 ? `$${item.unit_price_usd.toFixed(2)}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-700">
                                        {item.total_price_usd > 0 ? `$${item.total_price_usd.toFixed(2)}` : '-'}
                                    </td>
                                </tr>
                            ))}
                            {filteredItems.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                        No se encontraron registros de productos químicos en este periodo.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                ) : (
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider sticky left-0 bg-gray-50 dark:bg-gray-900 z-10">Producto</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Categoría</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total (Kg/Lt)</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Promedio (USD)</th>
                                {monthNames.map(m => (
                                    <th key={m} className="px-2 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-20">{m}</th>
                                ))}
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold">Total Año</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {summaryData.map((row, idx) => (
                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-100">
                                        {row.name}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                                        {row.category}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100">
                                        {row.total_qty.toLocaleString('es-CL', { maximumFractionDigits: 1 })} {row.unit}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-green-700">
                                        {row.total_qty > 0 ? `$${(row.total_usd / row.total_qty).toFixed(2)}` : '-'}
                                    </td>
                                    {row.monthly.map((val, mIdx) => (
                                        <td key={mIdx} className="px-2 py-3 whitespace-nowrap text-xs text-right text-gray-600 dark:text-gray-400">
                                            {val > 0 ? `$${Math.round(val).toLocaleString('en-US')}` : '-'}
                                        </td>
                                    ))}
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-blue-700">
                                        ${row.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                            {summaryData.length === 0 && (
                                <tr>
                                    <td colSpan={17} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                        No se encontraron registros.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="bg-gray-50 dark:bg-gray-900 font-bold">
                            <tr>
                                <td colSpan={4} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-gray-100">Totales Mensuales (USD):</td>
                                {monthNames.map((_, mIdx) => {
                                    const monthTotal = summaryData.reduce((sum, row) => sum + row.monthly[mIdx], 0);
                                    return (
                                        <td key={mIdx} className="px-2 py-3 text-xs text-right text-blue-800">
                                            {monthTotal > 0 ? `$${Math.round(monthTotal).toLocaleString('en-US')}` : '-'}
                                        </td>
                                    );
                                })}
                                <td className="px-4 py-3 text-sm text-right text-blue-900">
                                    ${summaryData.reduce((sum, row) => sum + row.total_usd, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>
        </div>
      )}
    </div>
  );
};
