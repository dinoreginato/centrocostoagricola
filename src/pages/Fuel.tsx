
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Fuel as FuelIcon, ArrowRight, Save, Loader2, AlertCircle, Trash2, Edit2, Plus, Droplet } from 'lucide-react';

interface FuelLog {
  id: string;
  date: string;
  activity: string;
  liters: number;
  estimated_price: number;
  sector_id: string;
  sectors?: { name: string };
}

interface FuelStockStats {
  totalPurchasedLiters: number;
  totalPurchasedCost: number;
  avgPrice: number;
  totalConsumedLiters: number;
  currentStock: number;
}

interface Sector {
  id: string;
  name: string;
  hectares: number;
  field_id: string;
}

interface Field {
    id: string;
    name: string;
    total_hectares: number;
}

export const Fuel: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [stats, setStats] = useState<FuelStockStats>({
    totalPurchasedLiters: 0,
    totalPurchasedCost: 0,
    avgPrice: 0,
    totalConsumedLiters: 0,
    currentStock: 0
  });
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'diesel' | 'gasoline'>('diesel');

  // Form State
  const [distributeBy, setDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [activity, setActivity] = useState('');
  const [liters, setLiters] = useState<number | ''>('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [selectedFieldId, setSelectedFieldId] = useState('');
  
  // Invoices (for reference)
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany, activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
        await Promise.all([
            loadSectorsAndFields(),
            loadStockAndLogs()
        ]);
    } catch (error) {
        console.error('Error loading data:', error);
    } finally {
        setLoading(false);
    }
  };

  const loadSectorsAndFields = async () => {
    if (!selectedCompany) return;
    
    // Fetch Fields
    const { data: fieldsData } = await supabase
        .from('fields')
        .select('*')
        .eq('company_id', selectedCompany.id);
    setFields(fieldsData || []);

    // Fetch Sectors
    const { data: sectorsData } = await supabase
        .from('sectors')
        .select('id, name, hectares, field_id, fields!inner(company_id)')
        .eq('fields.company_id', selectedCompany.id);
    
    setSectors(sectorsData || []);
  };

  const loadStockAndLogs = async () => {
    if (!selectedCompany) return;

    // 1. Get Invoices (Inflow)
    const { data: items } = await supabase
        .from('invoice_items')
        .select(`
            id, quantity, total_price, category,
            products (name, unit),
            invoices!inner (invoice_number, invoice_date, company_id, document_type, tax_percentage)
        `)
        .eq('invoices.company_id', selectedCompany.id);

    const targetCategories = activeTab === 'diesel' 
        ? ['petroleo', 'diesel']
        : ['bencina', 'gasolina', 'combustible'];
        
    const fuelItems = items?.filter((item: any) => {
        const cat = (item.category || '').toLowerCase().trim();
        const productName = (item.products?.name || '').toLowerCase();
        const unit = (item.products?.unit || '').toLowerCase().trim();
        
        // 1. Exclude explicitly non-fuel units
        const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];
        if (invalidUnits.includes(unit)) {
            return false;
        }

        // 2. Strict Category Check
        const matchesCategory = targetCategories.some(c => cat.includes(c));
        
        // 3. Name Check
        const matchesName = targetCategories.some(c => productName.includes(c));

        // 4. Exclude cross-contamination
        // If searching for diesel, exclude gasoline terms and vice versa
        const gasolineTerms = ['bencina', 'gasolina'];
        const dieselTerms = ['petroleo', 'diesel'];
        
        if (activeTab === 'diesel') {
            if (gasolineTerms.some(t => cat.includes(t) || productName.includes(t))) return false;
        } else {
            if (dieselTerms.some(t => cat.includes(t) || productName.includes(t))) return false;
        }

        return matchesCategory || matchesName;
    }) || [];

    setInvoices(fuelItems);

    const totalPurchasedLiters = fuelItems.reduce((sum, item) => {
        const docType = (item.invoices.document_type || '').toLowerCase();
        const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
        
        const qty = Number(item.quantity || 0);
        // If it's a Credit Note, we subtract the quantity (unless it was already entered as negative)
        return sum + (isNC ? -Math.abs(qty) : qty);
    }, 0);

    const totalPurchasedCost = fuelItems.reduce((sum, item) => {
        const docType = (item.invoices.document_type || '').toLowerCase();
        const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
        
        // Use Net Price for Fuel stock valuation usually, but we ensure robustness here.
        // If user wants Gross here too, we can add it, but standard accounting usually tracks Net for stock value.
        // We will keep it as is (Net) for now unless requested, as it affects Average Price.
        const price = Number(item.total_price || 0);
        return sum + (isNC ? -Math.abs(price) : price);
    }, 0);

    const avgPrice = totalPurchasedLiters > 0 ? totalPurchasedCost / totalPurchasedLiters : 0;

    // 2. Get Consumption Logs (Outflow)
    // We filter consumption logs by checking if the activity or product suggests diesel/gasoline
    // Or we might need a 'type' column in fuel_consumption.
    // For now, we assume existing logs are Diesel unless stated otherwise.
    // But better: Filter based on what the user enters.
    // Actually, we should probably add a 'fuel_type' column to fuel_consumption.
    // However, to avoid migration now, let's rely on the 'activity' or just show all for now, 
    // OR filter by a convention.
    // Let's filter by the tab context. If tab is gasoline, we show gasoline logs.
    // But how do we know? We can check if 'activity' contains "Gasolina" or "Bencina".
    // Or we can just show all logs but that messes up the stock calculation.
    
    // To properly support this without migration, we can append "(Gasolina)" to activity when saving.
    
    const { data: consumption } = await supabase
        .from('fuel_consumption')
        .select('*, sectors(name)')
        .eq('company_id', selectedCompany.id)
        .order('date', { ascending: false });

    const filteredConsumption = consumption?.filter(log => {
        const activityLower = (log.activity || '').toLowerCase();
        const isGasoline = activityLower.includes('gasolina') || activityLower.includes('bencina');
        
        if (activeTab === 'diesel') return !isGasoline;
        return isGasoline;
    }) || [];

    setLogs(filteredConsumption);

    const totalConsumedLiters = filteredConsumption.reduce((sum, log) => sum + Number(log.liters), 0);

    setStats({
        totalPurchasedLiters,
        totalPurchasedCost,
        avgPrice,
        totalConsumedLiters,
        currentStock: totalPurchasedLiters - totalConsumedLiters
    });
  };

  const handleSaveLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany || !liters || !activity) {
        alert('Complete todos los campos');
        return;
    }

    if (distributeBy === 'sector' && !selectedSectorId) {
        alert('Seleccione un sector');
        return;
    }
    if (distributeBy === 'field' && !selectedFieldId) {
        alert('Seleccione un campo');
        return;
    }

    setLoading(true);
    try {
        const totalLiters = Number(liters);
        // Prefix/Suffix for Gasoline to distinguish
        const activitySuffix = activeTab === 'gasoline' ? ' (Gasolina)' : '';
        const finalActivity = `${activity}${activitySuffix}`;
        
        if (distributeBy === 'company') {
            // Distribute by Company (All Fields)
            // 1. Get all sectors of all fields
            const allSectors = sectors; // We already loaded all sectors for the company
            const totalHa = allSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            
            if (totalHa === 0) {
                alert('La empresa no tiene hectáreas definidas en ningún sector.');
                setLoading(false);
                return;
            }

            const logsToInsert = allSectors.map(s => {
                const sectorLiters = (Number(s.hectares) / totalHa) * totalLiters;
                const sectorCost = sectorLiters * stats.avgPrice;
                return {
                    company_id: selectedCompany.id,
                    date,
                    activity: `${finalActivity} (Dist. Empresa)`,
                    liters: sectorLiters,
                    estimated_price: sectorCost,
                    sector_id: s.id
                };
            });

            const { error } = await supabase
                .from('fuel_consumption')
                .insert(logsToInsert);
            
            if (error) throw error;

        } else if (distributeBy === 'field') {
            // Distribute by Field Logic
            const fieldSectors = sectors.filter(s => s.field_id === selectedFieldId);
            if (fieldSectors.length === 0) {
                alert('El campo seleccionado no tiene sectores asociados.');
                setLoading(false);
                return;
            }

            const totalHa = fieldSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            if (totalHa === 0) {
                alert('Los sectores del campo no tienen hectáreas definidas.');
                setLoading(false);
                return;
            }

            const logsToInsert = fieldSectors.map(s => {
                const sectorLiters = (Number(s.hectares) / totalHa) * totalLiters;
                const sectorCost = sectorLiters * stats.avgPrice;
                return {
                    company_id: selectedCompany.id,
                    date,
                    activity: `${finalActivity} (Dist. Campo)`,
                    liters: sectorLiters,
                    estimated_price: sectorCost,
                    sector_id: s.id
                };
            });

            const { error } = await supabase
                .from('fuel_consumption')
                .insert(logsToInsert);
            
            if (error) throw error;

        } else {
            // Single Sector Logic
            const cost = totalLiters * stats.avgPrice;
            const { error } = await supabase
                .from('fuel_consumption')
                .insert({
                    company_id: selectedCompany.id,
                    date,
                    activity: finalActivity,
                    liters: totalLiters,
                    estimated_price: cost,
                    sector_id: selectedSectorId
                });

            if (error) throw error;
        }

        // Reset form
        setActivity('');
        setLiters('');
        
        // Reload
        await loadStockAndLogs();
        alert('Consumo registrado exitosamente');

    } catch (error: any) {
        console.error('Error saving log:', error);
        alert('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
      if (!confirm('¿Eliminar este registro?')) return;
      
      const { error } = await supabase
          .from('fuel_consumption')
          .delete()
          .eq('id', id);

      if (error) {
          alert('Error al eliminar');
      } else {
          loadStockAndLogs();
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <FuelIcon className="mr-2 h-8 w-8 text-indigo-600" />
                Control de Petróleo y Combustible
            </h1>
            <p className="text-sm text-gray-500">Stock y Bitácora de Consumo</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
                onClick={() => setActiveTab('diesel')}
                className={`${
                    activeTab === 'diesel'
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
                Petróleo (Diesel)
            </button>
            <button
                onClick={() => setActiveTab('gasoline')}
                className={`${
                    activeTab === 'gasoline'
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
                Bencina (Gasolina)
            </button>
        </nav>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
              <div className="text-sm text-gray-500">Total Comprado</div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalPurchasedLiters.toLocaleString('es-CL')} L</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
              <div className="text-sm text-gray-500">Precio Promedio</div>
              <div className="text-2xl font-bold text-gray-900">{formatCLP(stats.avgPrice)} / L</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-orange-500">
              <div className="text-sm text-gray-500">Total Consumido</div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalConsumedLiters.toLocaleString('es-CL')} L</div>
          </div>
          <div className={`bg-white p-4 rounded-lg shadow border-l-4 ${stats.currentStock < 1000 ? 'border-red-500' : 'border-indigo-500'}`}>
              <div className="text-sm text-gray-500">Stock Actual</div>
              <div className={`text-2xl font-bold ${stats.currentStock < 1000 ? 'text-red-600' : 'text-indigo-600'}`}>
                  {stats.currentStock.toLocaleString('es-CL')} L
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Consumption Form */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Droplet className="h-5 w-5 mr-2 text-indigo-500" />
                Registrar Consumo
            </h3>
            <form onSubmit={handleSaveLog} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Fecha</label>
                    <input 
                        type="date" 
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Actividad</label>
                    <select
                        value={activity}
                        onChange={e => setActivity(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    >
                        <option value="">Seleccione...</option>
                        <option value="Cosecha">Cosecha</option>
                        <option value="Aplicacion">Aplicación</option>
                        <option value="Riego">Riego</option>
                        <option value="Transporte">Transporte</option>
                        <option value="Mantencion">Mantención</option>
                        <option value="Otros">Otros</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Asignar A</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <button
                            type="button"
                            onClick={() => setDistributeBy('sector')}
                            className={`relative inline-flex items-center px-4 py-2 rounded-l-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'sector'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            Un Sector
                        </button>
                        <button
                            type="button"
                            onClick={() => setDistributeBy('field')}
                            className={`-ml-px relative inline-flex items-center px-4 py-2 border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'field'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            } ${activeTab === 'gasoline' ? '' : 'rounded-r-md'}`}
                        >
                            Todo un Campo
                        </button>
                        {activeTab === 'gasoline' && (
                            <button
                                type="button"
                                onClick={() => setDistributeBy('company')}
                                className={`-ml-px relative inline-flex items-center px-4 py-2 rounded-r-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                    distributeBy === 'company'
                                        ? 'bg-indigo-600 border-indigo-600 text-white'
                                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                Empresa General
                            </button>
                        )}
                    </div>
                </div>

                {distributeBy === 'sector' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Sector Destino</label>
                        <select
                            value={selectedSectorId}
                            onChange={e => setSelectedSectorId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="">Seleccione Sector...</option>
                            {sectors.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                ) : distributeBy === 'field' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Campo Destino</label>
                        <select
                            value={selectedFieldId}
                            onChange={e => setSelectedFieldId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="">Seleccione Campo...</option>
                            {fields.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">El consumo se distribuirá proporcionalmente por hectárea entre todos los sectores de este campo.</p>
                    </div>
                ) : (
                    <div>
                        <div className="p-2 bg-indigo-50 border border-indigo-200 rounded text-sm text-indigo-700">
                            El consumo se distribuirá proporcionalmente entre <strong>TODOS</strong> los campos y sectores de la empresa.
                        </div>
                    </div>
                )}
                <div>
                    <label className="block text-sm font-medium text-gray-700">Litros Consumidos</label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                        <input
                            type="number"
                            step="0.1"
                            value={liters}
                            onChange={e => setLiters(Number(e.target.value))}
                            className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-3 pr-12 sm:text-sm border-gray-300 rounded-md"
                            placeholder="0.00"
                        />
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                            <span className="text-gray-500 sm:text-sm">L</span>
                        </div>
                    </div>
                </div>

                <div className="pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Registrar Salida'}
                    </button>
                </div>
            </form>
        </div>

        {/* Right: History Log */}
        <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Bitácora de Consumo</h3>
                </div>
                <div className="overflow-x-auto max-h-[500px]">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actividad</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sector</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Litros</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Costo Est.</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {logs.map(log => (
                                <tr key={log.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(log.date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {log.activity}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {log.sectors?.name || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-bold">
                                        {Number(log.liters).toLocaleString('es-CL')} L
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                                        {formatCLP(log.estimated_price)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => handleDeleteLog(log.id)} className="text-red-600 hover:text-red-900">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No hay registros de consumo.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Inflow List (Optional) */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h3 className="text-sm font-medium text-gray-700">Ingresos de Combustible (Facturas)</h3>
                </div>
                <div className="overflow-x-auto max-h-[300px]">
                     <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Factura</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {invoices.map(inv => (
                                <tr key={inv.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                                        {new Date(inv.invoices.invoice_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-900">
                                        {inv.invoices.invoice_number}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                                        {inv.products?.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-right text-green-600 font-bold">
                                        {Number(inv.quantity).toLocaleString('es-CL')} {inv.products?.unit || 'L'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                     </table>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
