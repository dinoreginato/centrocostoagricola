import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Tractor, ArrowRight, Save, Loader2, CheckCircle2, AlertCircle, Trash2, Edit2 } from 'lucide-react';

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

interface HistoryItem {
    id: string;
    assigned_amount: number;
    assigned_date: string;
    sector_id: string;
    invoice_item_id: string;
    sectors?: { name: string };
    invoice_items?: {
        products?: { name: string };
        invoices?: { invoice_number: string };
    };
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
  const [assignedDate, setAssignedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  // Editing State
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);

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
    // We fetch ALL items for the company and filter in memory.
    // Corrected query: join with products to get the name, as invoice_items doesn't have product_name
    
    const { data: items, error } = await supabase
        .from('invoice_items')
        .select(`
            id, total_price, category,
            products (name),
            invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage)
        `)
        .eq('invoices.company_id', selectedCompany.id);

    if (error) {
        console.error('Error fetching items:', error);
        // Don't throw, just log and return empty to avoid crashing UI completely
        // throw error; 
    }

    // Filter strictly by Category as requested
    const laborCategories = ['labores agrícolas', 'labores agricolas', 'mano de obra', 'servicio de labores'];
    const filteredItems = items?.filter((item: any) => {
        const cat = (item.category || '').toLowerCase().trim();
        
        // Match only if category contains the labor keywords
        return laborCategories.some(c => cat.includes(c));
    });

    // 2. Get existing assignments to calculate remaining
    // Optimización: Filtrar asignaciones por empresa y aumentar límite
    const { data: assignments, error: assignError } = await supabase
        .from('labor_assignments')
        .select('invoice_item_id, assigned_amount, invoice_items!inner(invoices!inner(company_id))')
        .eq('invoice_items.invoices.company_id', selectedCompany.id)
        .range(0, 4999);

    if (assignError) {
        console.error('Error fetching assignments:', assignError);
    }

    const assignmentMap = new Map<string, number>();
    assignments?.forEach(a => {
        const current = assignmentMap.get(a.invoice_item_id) || 0;
        assignmentMap.set(a.invoice_item_id, current + a.assigned_amount);
    });

    // 3. Filter and map
    const pending: LaborItem[] = [];
    filteredItems?.forEach((item: any) => {
        // If it's a Credit Note, the amount should be negative to subtract cost
        const docType = (item.invoices.document_type || '').toLowerCase();
        const isCreditNote = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
        
        // Calculate Gross Amount (Bruto)
        // item.total_price is usually Net. We need to add VAT.
        // Tax percentage defaults to 19 if not present (standard Chile VAT)
        // But if it's Exenta, tax should be 0.
        // However, Invoices table stores tax_percentage.
        const taxPercent = item.invoices.tax_percentage !== undefined ? item.invoices.tax_percentage : 19;
        const netAmount = Number(item.total_price);
        const grossAmount = netAmount * (1 + (taxPercent / 100));

        let total = grossAmount;
        
        if (isCreditNote && total > 0) {
            total = -total;
        }

        const assigned = assignmentMap.get(item.id) || 0;
        const remaining = total - assigned;

        // Tolerance for float errors (absolute value for negative amounts)
        if (Math.abs(remaining) > 10) {  // Increased tolerance slightly for rounding diffs
            pending.push({
                id: item.id,
                invoice_id: item.invoices.id,
                invoice_number: item.invoices.invoice_number,
                date: item.invoices.invoice_date,
                description: `${item.products?.name || 'Sin descripción'} ${isCreditNote ? '(NC)' : ''}`,
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
            invoice_items (
                products (name),
                invoices (invoice_number)
            )
        `)
        .order('assigned_date', { ascending: false })
        .limit(50);
    
    // Filter by company (via RLS it handles it, but let's be safe if query is complex)
    // The RLS policy we added ensures we only see our company's data.
    setHistory(data as unknown as HistoryItem[] || []);
  };

  const handleSelectLabor = (labor: LaborItem) => {
    setSelectedLaborId(labor.id);
    setEditingAssignmentId(null);
    setAssignedDate(labor.date ? labor.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    // Reset allocations
    setAllocations([{ sector_id: '', amount: labor.remaining_amount }]);
  };

  const handleEditAssignment = (assignment: HistoryItem) => {
      setEditingAssignmentId(assignment.id);
      setSelectedLaborId(assignment.invoice_item_id);
      setAssignedDate(assignment.assigned_date ? assignment.assigned_date.split('T')[0] : new Date().toISOString().split('T')[0]);
      
      // When editing, we need to know the original labor item to show details
      // We also need to 'free up' the amount of this assignment so it can be re-allocated
      // For simplicity in this UI, we will treat it as updating just this allocation record.
      
      setAllocations([{ 
          sector_id: assignment.sector_id, 
          amount: assignment.assigned_amount 
      }]);
  };

  const handleDeleteAssignment = async (id: string) => {
      if (!confirm('¿Estás seguro de eliminar esta asignación?')) return;
      
      setLoading(true);
      try {
          const { error } = await supabase
              .from('labor_assignments')
              .delete()
              .eq('id', id);
              
          if (error) throw error;
          
          loadData(); // Reload to update lists
      } catch (error: any) {
          console.error('Error deleting:', error);
          alert('Error: ' + error.message);
      } finally {
          setLoading(false);
      }
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
    // When editing, we ignore the check against remaining amount for now as it's complex to recalc
    // For negative amounts (Credit Notes), logic is reversed or just check absolute
    if (!editingAssignmentId) {
        if (selectedLabor.remaining_amount < 0) {
             // It's a credit note or negative balance
             // totalAllocated should be negative and not less than remaining (more negative)
             // e.g. remaining -1000. allocated -1200 -> Error. allocated -500 -> OK.
             if (totalAllocated < selectedLabor.remaining_amount - 1) {
                 alert(`El monto asignado (${formatCLP(totalAllocated)}) excede el pendiente (${formatCLP(selectedLabor.remaining_amount)})`);
                 return;
             }
        } else {
             // Normal positive balance
             if (totalAllocated > selectedLabor.remaining_amount + 1) { 
                alert(`El monto asignado (${formatCLP(totalAllocated)}) excede el pendiente (${formatCLP(selectedLabor.remaining_amount)})`);
                return;
             }
        }
    }
    
    if (allocations.some(a => !a.sector_id || a.amount === 0)) { // Allow negative amounts, just not 0
        alert('Complete todos los campos de sector y monto distinto de 0');
        return;
    }

    setLoading(true);
    try {
        if (editingAssignmentId) {
            // Update existing assignment
            // Note: We only support single row editing in this simple mode
            const alloc = allocations[0];
            const { error } = await supabase
                .from('labor_assignments')
                .update({
                    sector_id: alloc.sector_id,
                    assigned_amount: alloc.amount,
                    assigned_date: assignedDate
                })
                .eq('id', editingAssignmentId);

            if (error) throw error;
            alert('Asignación actualizada exitosamente');
        } else {
            // Create new assignments
            const payload = allocations.map(a => ({
                invoice_item_id: selectedLaborId,
                sector_id: a.sector_id,
                assigned_amount: a.amount,
                assigned_date: assignedDate
            }));

            const { error } = await supabase
                .from('labor_assignments')
                .insert(payload);

            if (error) throw error;
            alert('Asignación guardada exitosamente');
        }

        setSelectedLaborId(null);
        setEditingAssignmentId(null);
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
                    <h3 className="text-lg font-medium text-gray-900 mb-4">
                        {editingAssignmentId ? 'Editar Asignación' : 'Asignar Costo a Sectores'}
                    </h3>
                    
                    <div className="bg-gray-50 p-4 rounded-md mb-6">
                        <div className="text-sm text-gray-500">Item Seleccionado:</div>
                        <div className="font-medium text-gray-900">
                            {pendingLabors.find(p => p.id === selectedLaborId)?.description}
                        </div>
                        {!editingAssignmentId && (
                            <div className="text-right mt-2 text-lg font-bold text-green-600">
                                Disponible: {formatCLP(pendingLabors.find(p => p.id === selectedLaborId)?.remaining_amount || 0)}
                            </div>
                        )}
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Fecha de Asignación</label>
                            <input
                                type="date"
                                value={assignedDate}
                                onChange={(e) => setAssignedDate(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
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
                                {!editingAssignmentId && (
                                    <button 
                                        onClick={() => handleRemoveAllocationRow(idx)}
                                        className="mb-1 p-2 text-red-500 hover:text-red-700"
                                        disabled={allocations.length === 1}
                                    >
                                        &times;
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {!editingAssignmentId && (
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
                    )}

                    <div className="mt-8 flex justify-end space-x-3">
                        <button
                            onClick={() => {
                                setSelectedLaborId(null);
                                setEditingAssignmentId(null);
                            }}
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
                            {editingAssignmentId ? 'Actualizar' : 'Guardar Asignación'}
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
                                        <div className="font-medium">{h.invoice_items?.products?.name || 'Sin nombre'}</div>
                                        <div className="text-xs text-gray-500">#{h.invoice_items?.invoices?.invoice_number}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {h.sectors?.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            {formatCLP(h.assigned_amount)}
                                            <div className="flex gap-1">
                                                <button 
                                                    onClick={() => handleEditAssignment(h)}
                                                    className="text-blue-500 hover:text-blue-700 p-1"
                                                    title="Editar"
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteAssignment(h.id)}
                                                    className="text-red-500 hover:text-red-700 p-1"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
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
