import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Tractor, ArrowRight, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface LaborItem {
  id: string; // invoice_item_id
  invoice_id: string;
  invoice_number: string;
  date: string;
  description: string;
  total_amount: number;
  assigned_amount: number;
  remaining_amount: number;
}

interface Sector {
  id: string;
  name: string;
  hectares: number;
}

interface Allocation {
  sector_id: string;
  amount: number;
}

export const Labors: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [pendingLabors, setPendingLabors] = useState<LaborItem[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  
  // Selection State
  const [selectedLaborId, setSelectedLaborId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  
  // History State
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    setLoading(true);
    try {
        await Promise.all([
            loadSectors(),
            loadPendingLabors(),
            loadHistory()
        ]);
    } catch (error) {
        console.error('Error loading data:', error);
    } finally {
        setLoading(false);
    }
  };

  const loadSectors = async () => {
    if (!selectedCompany) return;
    // We need sectors linked to fields of this company
    const { data } = await supabase
        .from('sectors')
        .select(`
            id, name, hectares,
            fields!inner(company_id)
        `)
        .eq('fields.company_id', selectedCompany.id);
    
    setSectors(data || []);
  };

  const loadPendingLabors = async () => {
    if (!selectedCompany) return;

    // 1. Get all invoice items with category related to labor
    // Using simple OR logic for exact matches to avoid regex issues, plus ILIKE for flexibility
    // But since Supabase client 'or' syntax can be tricky, let's simplify.
    // We will fetch ALL items for the company and filter in memory to be 100% sure.
    // This is safer given the small volume of invoice items per company.
    
    const { data: items, error } = await supabase
        .from('invoice_items')
        .select(`
            id, total_price, product_name, category,
            invoices!inner (id, invoice_number, invoice_date, company_id)
        `)
        .eq('invoices.company_id', selectedCompany.id);

    if (error) {
        console.error('Error fetching items:', error);
        throw error;
    }

    // Filter in memory for robust matching
    const laborKeywords = ['labor', 'mano de obra', 'trabajo', 'faena', 'poda', 'cosecha', 'raleo', 'aplicacion'];
    const filteredItems = items?.filter((item: any) => {
        const cat = (item.category || '').toLowerCase();
        const desc = (item.product_name || '').toLowerCase();
        
        // Match if category OR description contains keywords
        return laborKeywords.some(kw => cat.includes(kw)) || laborKeywords.some(kw => desc.includes(kw));
    });

    // 2. Get existing assignments to calculate remaining
    const { data: assignments } = await supabase
        .from('labor_assignments')
        .select('invoice_item_id, assigned_amount');

    const assignmentMap = new Map<string, number>();
    assignments?.forEach(a => {
        const current = assignmentMap.get(a.invoice_item_id) || 0;
        assignmentMap.set(a.invoice_item_id, current + a.assigned_amount);
    });

    // 3. Filter and map
    const pending: LaborItem[] = [];
    filteredItems?.forEach((item: any) => {
        const total = Number(item.total_price);
        const assigned = assignmentMap.get(item.id) || 0;
        const remaining = total - assigned;

        // Tolerance for float errors
        if (remaining > 1) { 
            pending.push({
                id: item.id,
                invoice_id: item.invoices.id,
                invoice_number: item.invoices.invoice_number,
                date: item.invoices.invoice_date,
                description: item.product_name,
                total_amount: total,
                assigned_amount: assigned,
                remaining_amount: remaining
            });
        }
    });

    setPendingLabors(pending);
  };

  const loadHistory = async () => {
    if (!selectedCompany) return;

    const { data } = await supabase
        .from('labor_assignments')
        .select(`
            id, assigned_amount, assigned_date,
            sectors (name),
            invoice_items (product_name, invoices(invoice_number))
        `)
        .order('assigned_date', { ascending: false })
        .limit(50);
    
    // Filter by company (via RLS it handles it, but let's be safe if query is complex)
    // The RLS policy we added ensures we only see our company's data.
    setHistory(data || []);
  };

  const handleSelectLabor = (labor: LaborItem) => {
    setSelectedLaborId(labor.id);
    // Reset allocations
    setAllocations([{ sector_id: '', amount: labor.remaining_amount }]);
  };

  const handleAddAllocationRow = () => {
    setAllocations([...allocations, { sector_id: '', amount: 0 }]);
  };

  const handleRemoveAllocationRow = (index: number) => {
    const newAlloc = [...allocations];
    newAlloc.splice(index, 1);
    setAllocations(newAlloc);
  };

  const updateAllocation = (index: number, field: keyof Allocation, value: any) => {
    const newAlloc = [...allocations];
    newAlloc[index] = { ...newAlloc[index], [field]: value };
    setAllocations(newAlloc);
  };

  const handleSaveAssignment = async () => {
    if (!selectedLaborId) return;
    
    // Validate
    const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    const selectedLabor = pendingLabors.find(p => p.id === selectedLaborId);
    
    if (!selectedLabor) return;
    if (totalAllocated > selectedLabor.remaining_amount + 1) { // +1 for float tolerance
        alert(`El monto asignado (${formatCLP(totalAllocated)}) excede el pendiente (${formatCLP(selectedLabor.remaining_amount)})`);
        return;
    }
    if (allocations.some(a => !a.sector_id || a.amount <= 0)) {
        alert('Complete todos los campos de sector y monto mayor a 0');
        return;
    }

    setLoading(true);
    try {
        const payload = allocations.map(a => ({
            invoice_item_id: selectedLaborId,
            sector_id: a.sector_id,
            assigned_amount: a.amount
        }));

        const { error } = await supabase
            .from('labor_assignments')
            .insert(payload);

        if (error) throw error;

        alert('Asignación guardada exitosamente');
        setSelectedLaborId(null);
        setAllocations([]);
        loadData();

    } catch (error: any) {
        console.error('Error saving:', error);
        alert('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <Tractor className="mr-2 h-8 w-8 text-green-600" />
                Labores Agrícolas
            </h1>
            <p className="text-sm text-gray-500">Asigna costos de labores (facturas) a sectores específicos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Pending List */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-200">
                <h3 className="font-medium text-gray-900 flex items-center">
                    <AlertCircle className="h-4 w-4 mr-2 text-yellow-500" />
                    Labores Pendientes
                </h3>
            </div>
            <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
                {pendingLabors.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">No hay labores pendientes de asignar.</div>
                ) : (
                    pendingLabors.map(labor => (
                        <div 
                            key={labor.id} 
                            onClick={() => handleSelectLabor(labor)}
                            className={`p-4 cursor-pointer hover:bg-green-50 transition-colors ${selectedLaborId === labor.id ? 'bg-green-50 ring-2 ring-inset ring-green-500' : ''}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="text-xs font-bold text-gray-500">#{labor.invoice_number}</span>
                                <span className="text-xs text-gray-400">{new Date(labor.date).toLocaleDateString()}</span>
                            </div>
                            <h4 className="text-sm font-medium text-gray-900 mb-1">{labor.description}</h4>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                    Total: {formatCLP(labor.total_amount)}
                                </span>
                                <span className="text-sm font-bold text-green-600">
                                    Por asignar: {formatCLP(labor.remaining_amount)}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* Middle: Assignment Form */}
        <div className="lg:col-span-2 space-y-6">
            {selectedLaborId ? (
                <div className="bg-white rounded-lg shadow p-6 border-t-4 border-green-500">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Asignar Costo a Sectores</h3>
                    
                    <div className="bg-gray-50 p-4 rounded-md mb-6">
                        <div className="text-sm text-gray-500">Item Seleccionado:</div>
                        <div className="font-medium text-gray-900">
                            {pendingLabors.find(p => p.id === selectedLaborId)?.description}
                        </div>
                        <div className="text-right mt-2 text-lg font-bold text-green-600">
                            Disponible: {formatCLP(pendingLabors.find(p => p.id === selectedLaborId)?.remaining_amount || 0)}
                        </div>
                    </div>

                    <div className="space-y-4">
                        {allocations.map((alloc, idx) => (
                            <div key={idx} className="flex gap-4 items-end">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Sector</label>
                                    <select
                                        value={alloc.sector_id}
                                        onChange={(e) => updateAllocation(idx, 'sector_id', e.target.value)}
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                    >
                                        <option value="">Seleccionar Sector...</option>
                                        {sectors.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="w-40">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Monto</label>
                                    <input
                                        type="number"
                                        value={alloc.amount}
                                        onChange={(e) => updateAllocation(idx, 'amount', Number(e.target.value))}
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                    />
                                </div>
                                <button 
                                    onClick={() => handleRemoveAllocationRow(idx)}
                                    className="mb-1 p-2 text-red-500 hover:text-red-700"
                                    disabled={allocations.length === 1}
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 flex justify-between">
                        <button
                            onClick={handleAddAllocationRow}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                            + Agregar otro sector
                        </button>
                        <div className="text-right">
                            <span className="text-sm text-gray-500 mr-2">Total Asignado:</span>
                            <span className={`font-bold ${
                                allocations.reduce((sum, a) => sum + a.amount, 0) > (pendingLabors.find(p => p.id === selectedLaborId)?.remaining_amount || 0) 
                                ? 'text-red-600' : 'text-gray-900'
                            }`}>
                                {formatCLP(allocations.reduce((sum, a) => sum + a.amount, 0))}
                            </span>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end space-x-3">
                        <button
                            onClick={() => setSelectedLaborId(null)}
                            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSaveAssignment}
                            disabled={loading}
                            className="inline-flex justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                            Guardar Asignación
                        </button>
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow p-12 text-center border-2 border-dashed border-gray-300">
                    <ArrowRight className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">Selecciona una labor pendiente</h3>
                    <p className="text-gray-500">Haz clic en un item de la izquierda para asignarlo a un sector.</p>
                </div>
            )}

            {/* Recent History */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Historial de Asignaciones Recientes</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Labor / Factura</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sector Asignado</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {history.map((h) => (
                                <tr key={h.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(h.assigned_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900">
                                        <div className="font-medium">{h.invoice_items?.product_name}</div>
                                        <div className="text-xs text-gray-500">#{h.invoice_items?.invoices?.invoice_number}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {h.sectors?.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 text-right">
                                        {formatCLP(h.assigned_amount)}
                                    </td>
                                </tr>
                            ))}
                            {history.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">
                                        No hay historial reciente.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
