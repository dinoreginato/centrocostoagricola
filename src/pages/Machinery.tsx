
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Tractor, ArrowRight, Save, Loader2, AlertCircle, Trash2, Edit2, Layers, Settings, Plus, X } from 'lucide-react';

interface MachineryItem {
  id: string; // invoice_item_id
  invoice_id: string;
  invoice_number: string;
  date: string;
  description: string;
  total_amount: number;
  assigned_amount: number;
  remaining_amount: number;
}

interface Machine {
    id: string;
    name: string;
    type: string;
    brand: string;
    model: string;
    plate: string;
    description: string;
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
    machine_id?: string;
    sectors?: { name: string };
    machines?: { name: string };
    invoice_items?: {
        products?: { name: string };
        invoices?: { invoice_number: string };
    };
}

export const Machinery: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [pendingItems, setPendingItems] = useState<MachineryItem[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  
  // Selection State
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [assignedDate, setAssignedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  
  // Distribution Mode
  const [distributeBy, setDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [fieldTotalAmount, setFieldTotalAmount] = useState<number>(0);

  // Editing State
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

  // Machine Management State
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Partial<Machine> | null>(null);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    setLoading(true);
    try {
        await Promise.all([
            loadSectorsAndFields(),
            loadPendingItems(),
            loadHistory(),
            loadMachines()
        ]);
    } catch (error) {
        console.error('Error loading data:', error);
    } finally {
        setLoading(false);
    }
  };

  const loadSectorsAndFields = async () => {
    if (!selectedCompany) return;
    
    // Load Fields
    const { data: fieldsData } = await supabase
        .from('fields')
        .select('id, name, total_hectares')
        .eq('company_id', selectedCompany.id);
    setFields(fieldsData || []);

    // Load Sectors
    const { data: sectorsData } = await supabase
        .from('sectors')
        .select(`
            id, name, hectares, field_id,
            fields!inner(company_id)
        `)
        .eq('fields.company_id', selectedCompany.id);
    
    setSectors(sectorsData || []);
  };

  const loadMachines = async () => {
      if (!selectedCompany) return;
      const { data } = await supabase
          .from('machines')
          .select('*')
          .eq('company_id', selectedCompany.id)
          .eq('is_active', true)
          .order('name');
      setMachines(data || []);
  };

  const loadPendingItems = async () => {
    if (!selectedCompany) return;

    // Load Pending Items
    // Increased limit and added sorting to ensure we get the latest items
    const { data: items, error } = await supabase
        .from('invoice_items')
        .select(`
            id, total_price, category,
            products (name, category),
            invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage)
        `)
        .eq('invoices.company_id', selectedCompany.id)
        .order('id', { ascending: false }) // Show newest items first
        .range(0, 19999); // Increased limit significantly

    if (error) {
        console.error('Error fetching items:', error);
    }
    
    // Updated filtering logic to be strict on categories as per user request
    const filteredItems = items?.filter((item: any) => {
        // Double check company_id strictly
        if (item.invoices?.company_id !== selectedCompany.id) return false;

        // Normalize category: lower case, remove accents
        // Fallback to product category if item category is missing
        const rawCat = item.category || item.products?.category || '';
        const cat = rawCat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        
        // Keywords (normalized)
        const allowedKeywords = ['maquinaria', 'repuesto', 'mantencion'];
        
        return allowedKeywords.some(keyword => cat.includes(keyword));
    });

    // Optimización: Usar RPC para obtener el total asignado de manera eficiente y escalable
    // Reemplaza la carga masiva de asignaciones individuales
    let assignmentMap = new Map<string, number>();
    
    try {
        const { data: summary, error: rpcError } = await supabase
            .rpc('get_machinery_assignments_summary', { p_company_id: selectedCompany.id });
            
        if (rpcError) throw rpcError;
        
        if (summary) {
            summary.forEach((item: any) => {
                assignmentMap.set(item.invoice_item_id, Number(item.total_assigned));
            });
        }
    } catch (err) {
        console.error('Error fetching assignment summary via RPC:', err);
        // Fallback (aunque no debería ser necesario si el RPC existe)
        const { data: fallbackData } = await supabase
            .from('machinery_assignments')
            .select('invoice_item_id, assigned_amount, invoice_items!inner(invoices!inner(company_id))')
            .eq('invoice_items.invoices.company_id', selectedCompany.id);
            
        if (fallbackData) {
            fallbackData.forEach((item: any) => {
                const current = assignmentMap.get(item.invoice_item_id) || 0;
                assignmentMap.set(item.invoice_item_id, current + Number(item.assigned_amount));
            });
        }
    }

    const pending: MachineryItem[] = [];
    filteredItems?.forEach((item: any) => {
        // Double Check: Ensure item belongs to selected company
        if (item.invoices?.company_id !== selectedCompany.id) return;

        // Credit Note Logic (Robust)
        const docType = (item.invoices.document_type || '').toLowerCase();
        const isCreditNote = docType.includes('nota de cr') || 
                             docType.includes('nota de cre') || 
                             docType.includes('nota credito') ||
                             docType.includes('credito') || 
                             docType === 'nc';
        
        // Calculate Gross Amount (Bruto)
        const taxPercent = item.invoices.tax_percentage !== undefined ? item.invoices.tax_percentage : 19;
        const netAmount = Number(item.total_price);
        const grossAmount = netAmount * (1 + (taxPercent / 100));

        let total = grossAmount;
        
        // Force Negative for Credit Notes
        if (isCreditNote) {
            total = -Math.abs(total);
        } else {
            total = Math.abs(total);
        }

        const assigned = assignmentMap.get(item.id) || 0;
        const remaining = total - assigned;

        if (Math.abs(remaining) > 10) { 
            pending.push({
                id: item.id,
                invoice_id: item.invoices.id,
                invoice_number: item.invoices.invoice_number,
                date: item.invoices.invoice_date,
                description: `${item.products?.name || 'Sin descripción'} ${isCreditNote ? '(NC)' : ''} [${item.invoices.document_type}]`,
                total_amount: total,
                assigned_amount: assigned,
                remaining_amount: remaining
            });
        }
    });

    setPendingItems(pending);
  };

  const loadHistory = async () => {
    if (!selectedCompany) return;

    // Fetch more items to allow better client-side search (e.g. last 500)
    const { data } = await supabase
        .from('machinery_assignments')
        .select(`
            id, assigned_amount, assigned_date,
            sectors (name),
            machines (name),
            invoice_items!inner (
                products (name),
                invoices!inner (invoice_number, company_id)
            )
        `)
        .eq('invoice_items.invoices.company_id', selectedCompany.id)
        .order('assigned_date', { ascending: false })
        .limit(500);
    
    setHistory(data as unknown as HistoryItem[] || []);
  };

  // Filtered History for Display
  const filteredHistory = history.filter(h => {
    if (!historySearch) return true;
    const search = historySearch.toLowerCase();
    const productName = (h.invoice_items?.products?.name || '').toLowerCase();
    const invoiceNum = (h.invoice_items?.invoices?.invoice_number || '').toLowerCase();
    const sectorName = (h.sectors?.name || '').toLowerCase();
    const machineName = (h.machines?.name || '').toLowerCase();
    
    return productName.includes(search) || invoiceNum.includes(search) || sectorName.includes(search) || machineName.includes(search);
  });

  const handleSelectItem = (item: MachineryItem) => {
    setSelectedItemId(item.id);
    setEditingAssignmentId(null);
    setAssignedDate(item.date ? item.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    setDistributeBy('sector');
    setSelectedMachineId('');
    setAllocations([{ sector_id: '', amount: item.remaining_amount }]);
    setFieldTotalAmount(item.remaining_amount);
  };

  const handleEditAssignment = (assignment: HistoryItem) => {
      setEditingAssignmentId(assignment.id);
      setSelectedItemId(assignment.invoice_item_id);
      setAssignedDate(assignment.assigned_date ? assignment.assigned_date.split('T')[0] : new Date().toISOString().split('T')[0]);
      setDistributeBy('sector'); // Edit is always single sector for now
      setSelectedMachineId(assignment.machine_id || '');
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
              .from('machinery_assignments')
              .delete()
              .eq('id', id);
              
          if (error) throw error;
          
          loadData();
      } catch (error: any) {
          console.error('Error deleting:', error);
          alert('Error: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleDeleteAllAssignments = async () => {
    if (!selectedCompany) return;
    if (!confirm('¿ESTÁ SEGURO? Esto eliminará TODAS las asignaciones de maquinaria para esta empresa. Esta acción no se puede deshacer.')) return;

    setLoading(true);
    // 1. Get all assignment IDs for this company via RPC to avoid query URL limits
    // We fetch in chunks if necessary, but RPC is cleaner. 
    // Let's stick to client-side fetch but minimal fields to keep payload small.
    // The previous error "Bad Request" is likely due to the URL being too long when sending thousands of IDs in `.in('id', batch)`.
    // OR the initial SELECT returned too many rows.
    
    // Better approach: Use a custom RPC to delete by company_id directly in the database.
    // This avoids transferring IDs back and forth.
    
    try {
        const { error: rpcError } = await supabase.rpc('delete_machinery_assignments_by_company', {
            p_company_id: selectedCompany.id
        });
        
        if (rpcError) {
             // If RPC doesn't exist yet, fall back to the batched method but with smaller batches and robust error handling
             console.warn('RPC delete failed, falling back to manual batch delete', rpcError);
             throw rpcError; 
        }

        alert('Todas las asignaciones han sido eliminadas.');
        loadData();
    } catch (error: any) {
         // Fallback implementation if RPC is missing
         try {
            const { data: assignments, error: fetchError } = await supabase
            .from('machinery_assignments')
            .select('id, invoice_items!inner(invoices!inner(company_id))')
            .eq('invoice_items.invoices.company_id', selectedCompany.id);

            if (fetchError) throw fetchError;

            if (!assignments || assignments.length === 0) {
                alert('No hay asignaciones para eliminar.');
                return;
            }

            const ids = assignments.map(a => a.id);
            // Smaller batch size to avoid Request-URI Too Long
            const BATCH_SIZE = 100; 
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                const { error: deleteError } = await supabase
                    .from('machinery_assignments')
                    .delete()
                    .in('id', batch);
                
                if (deleteError) throw deleteError;
            }
             alert('Todas las asignaciones han sido eliminadas (Método Manual).');
             loadData();

         } catch (manualError: any) {
            console.error('Error deleting all:', manualError);
            alert('Error al eliminar: ' + manualError.message);
         }
    } finally {
        setLoading(false);
    }
  };

  const handleSaveMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany || !editingMachine) return;

    setLoading(true);
    try {
        const machineData = {
            name: editingMachine.name,
            type: editingMachine.type || 'Tractor',
            brand: editingMachine.brand,
            model: editingMachine.model,
            plate: editingMachine.plate,
            description: editingMachine.description,
            company_id: selectedCompany.id
        };

        if (editingMachine.id) {
            // Update
            const { error } = await supabase
                .from('machines')
                .update(machineData)
                .eq('id', editingMachine.id);
            if (error) throw error;
        } else {
            // Create
            const { error } = await supabase
                .from('machines')
                .insert([machineData]);
            if (error) throw error;
        }

        setShowMachineModal(false);
        setEditingMachine(null);
        loadMachines();
    } catch (error: any) {
        console.error('Error saving machine:', error);
        alert('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteMachine = async (id: string) => {
      if (!confirm('¿Estás seguro? Esto no eliminará las asignaciones históricas, pero la máquina ya no estará disponible para nuevas asignaciones.')) return;
      
      setLoading(true);
      try {
          const { error } = await supabase
              .from('machines')
              .update({ is_active: false }) // Soft delete
              .eq('id', id);
          
          if (error) throw error;
          loadMachines();
      } catch (error: any) {
          console.error('Error deleting machine:', error);
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
    if (!selectedItemId) return;
    
    const selectedItem = pendingItems.find(p => p.id === selectedItemId);
    if (!selectedItem) return;

    let payload: any[] = [];

    if (distributeBy === 'company') {
        // Distribute by Company (All Fields)
        if (fieldTotalAmount === 0) {
            alert('Ingrese un monto válido');
            return;
        }
        if (!editingAssignmentId) {
            if (selectedItem.remaining_amount < 0) {
                if (fieldTotalAmount < selectedItem.remaining_amount - 1) {
                    alert(`El monto excede el pendiente (${formatCLP(selectedItem.remaining_amount)})`);
                    return;
                }
            } else {
                if (fieldTotalAmount > selectedItem.remaining_amount + 1) {
                    alert(`El monto excede el pendiente (${formatCLP(selectedItem.remaining_amount)})`);
                    return;
                }
            }
        }

        const allSectors = sectors;
        const totalHa = allSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
        
        if (totalHa === 0) {
            alert('La empresa no tiene hectáreas definidas en ningún sector.');
            return;
        }

        payload = allSectors.map(s => ({
            invoice_item_id: selectedItemId,
            sector_id: s.id,
            machine_id: selectedMachineId || null,
            assigned_amount: (Number(s.hectares) / totalHa) * fieldTotalAmount,
            assigned_date: assignedDate
        }));

    } else if (distributeBy === 'field') {
        if (!selectedFieldId || fieldTotalAmount === 0) {
            alert('Seleccione un campo y un monto válido');
            return;
        }
        if (!editingAssignmentId) {
            if (selectedItem.remaining_amount < 0) {
                if (fieldTotalAmount < selectedItem.remaining_amount - 1) {
                    alert(`El monto excede el pendiente (${formatCLP(selectedItem.remaining_amount)})`);
                    return;
                }
            } else {
                if (fieldTotalAmount > selectedItem.remaining_amount + 1) {
                    alert(`El monto excede el pendiente (${formatCLP(selectedItem.remaining_amount)})`);
                    return;
                }
            }
        }

        // Calculate distribution
        const fieldSectors = sectors.filter(s => s.field_id === selectedFieldId);
        const totalHa = fieldSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
        
        if (totalHa === 0) {
            alert('El campo seleccionado no tiene hectáreas registradas');
            return;
        }

        payload = fieldSectors.map(s => ({
            invoice_item_id: selectedItemId,
            sector_id: s.id,
            machine_id: selectedMachineId || null,
            assigned_amount: (Number(s.hectares) / totalHa) * fieldTotalAmount,
            assigned_date: assignedDate
        }));

    } else {
        // Sector by Sector
        const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
        
        if (!editingAssignmentId) {
            if (selectedItem.remaining_amount < 0) {
                if (totalAllocated < selectedItem.remaining_amount - 1) {
                    alert(`El monto asignado (${formatCLP(totalAllocated)}) excede el pendiente (${formatCLP(selectedItem.remaining_amount)})`);
                    return;
                }
            } else {
                if (totalAllocated > selectedItem.remaining_amount + 1) {
                    alert(`El monto asignado (${formatCLP(totalAllocated)}) excede el pendiente (${formatCLP(selectedItem.remaining_amount)})`);
                    return;
                }
            }
        }
        if (allocations.some(a => !a.sector_id || a.amount === 0) && distributeBy === 'sector') {
        alert('Complete todos los campos de sector y monto distinto de 0');
        return;
    }

    if (distributeBy === 'sector') {
        payload = allocations.map(a => ({
            invoice_item_id: selectedItemId,
            sector_id: a.sector_id,
            machine_id: selectedMachineId || null,
            assigned_amount: a.amount,
            assigned_date: assignedDate
        }));
    }
    }

    setLoading(true);
    try {
        if (editingAssignmentId) {
            // Update single assignment
            const alloc = payload[0]; // Only one when editing
            const { error } = await supabase
                .from('machinery_assignments')
                .update({
                    sector_id: alloc.sector_id,
                    machine_id: selectedMachineId || null,
                    assigned_amount: alloc.assigned_amount,
                    assigned_date: assignedDate
                })
                .eq('id', editingAssignmentId);

            if (error) throw error;
            alert('Asignación actualizada exitosamente');
        } else {
            // Insert multiple
            const { error } = await supabase
                .from('machinery_assignments')
                .insert(payload);

            if (error) throw error;
            alert('Asignaciones guardadas exitosamente');
        }

        setSelectedItemId(null);
        setEditingAssignmentId(null);
        setAllocations([]);
        setSelectedFieldId('');
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
                <Tractor className="mr-2 h-8 w-8 text-orange-600" />
                Maquinaria y Equipos
            </h1>
            <p className="text-sm text-gray-500">Asigna costos de maquinaria y repuestos a sectores</p>
        </div>
        <button
            onClick={() => {
                setEditingMachine({ type: 'Tractor' });
                setShowMachineModal(true);
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
        >
            <Settings className="h-4 w-4 mr-2" />
            Gestionar Máquinas
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Pending List */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-200">
                <h3 className="font-medium text-gray-900 flex items-center">
                    <AlertCircle className="h-4 w-4 mr-2 text-yellow-500" />
                    Items Pendientes
                </h3>
            </div>
            <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
                {pendingItems.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">No hay items de maquinaria pendientes.</div>
                ) : (
                    pendingItems.map(item => (
                        <div 
                            key={item.id} 
                            onClick={() => handleSelectItem(item)}
                            className={`p-4 cursor-pointer hover:bg-orange-50 transition-colors ${selectedItemId === item.id ? 'bg-orange-50 ring-2 ring-inset ring-orange-500' : ''}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="text-xs font-bold text-gray-500">#{item.invoice_number}</span>
                                <span className="text-xs text-gray-400">{new Date(item.date).toLocaleDateString()}</span>
                            </div>
                            <h4 className="text-sm font-medium text-gray-900 mb-1">{item.description}</h4>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                    Total: {formatCLP(item.total_amount)}
                                </span>
                                <span className="text-sm font-bold text-orange-600">
                                    Por asignar: {formatCLP(item.remaining_amount)}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* Middle: Assignment Form */}
        <div className="lg:col-span-2 space-y-6">
            {selectedItemId ? (
                <div className="bg-white rounded-lg shadow p-6 border-t-4 border-orange-500">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">
                        {editingAssignmentId ? 'Editar Asignación' : 'Asignar Costo'}
                    </h3>
                    
                    <div className="bg-gray-50 p-4 rounded-md mb-6">
                        <div className="text-sm text-gray-500">Item Seleccionado:</div>
                        <div className="font-medium text-gray-900">
                            {pendingItems.find(p => p.id === selectedItemId)?.description}
                        </div>
                        {!editingAssignmentId && (
                            <div className="text-right mt-2 text-lg font-bold text-orange-600">
                                Disponible: {formatCLP(pendingItems.find(p => p.id === selectedItemId)?.remaining_amount || 0)}
                            </div>
                        )}
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Fecha de Asignación</label>
                            <input
                                type="date"
                                value={assignedDate}
                                onChange={(e) => setAssignedDate(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                            />
                        </div>
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Máquina (Opcional)</label>
                            <select
                                value={selectedMachineId}
                                onChange={(e) => setSelectedMachineId(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                            >
                                <option value="">Ninguna / General</option>
                                {machines.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} ({m.type})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {!editingAssignmentId && (
                        <div className="flex space-x-4 mb-6">
                            <button
                                onClick={() => setDistributeBy('sector')}
                                className={`flex-1 py-2 px-4 rounded-l-md text-sm font-medium border ${distributeBy === 'sector' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Por Sector Específico
                            </button>
                            <button
                                onClick={() => setDistributeBy('field')}
                                className={`flex-1 py-2 px-4 border text-sm font-medium border ${distributeBy === 'field' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                <Layers className="inline h-4 w-4 mr-2" />
                                Distribuir en Todo el Campo
                            </button>
                            <button
                                onClick={() => setDistributeBy('company')}
                                className={`flex-1 py-2 px-4 rounded-r-md text-sm font-medium border ${distributeBy === 'company' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Empresa General
                            </button>
                        </div>
                    )}

                    {distributeBy === 'company' && !editingAssignmentId ? (
                        <div className="space-y-4 bg-orange-50 p-4 rounded-md border border-orange-200">
                            <p className="text-sm text-orange-800 mb-2">
                                El costo se distribuirá proporcionalmente entre <strong>TODOS</strong> los campos y sectores de la empresa.
                            </p>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Monto a Distribuir</label>
                                <input
                                    type="number"
                                    value={fieldTotalAmount}
                                    onChange={(e) => setFieldTotalAmount(Number(e.target.value))}
                                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                />
                            </div>
                        </div>
                    ) : distributeBy === 'field' && !editingAssignmentId ? (
                        <div className="space-y-4 bg-orange-50 p-4 rounded-md border border-orange-200">
                            <p className="text-sm text-orange-800 mb-2">
                                El costo se distribuirá proporcionalmente a las hectáreas de cada sector del campo seleccionado.
                            </p>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Campo Completo</label>
                                <select
                                    value={selectedFieldId}
                                    onChange={(e) => setSelectedFieldId(e.target.value)}
                                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                >
                                    <option value="">Seleccionar Campo...</option>
                                    {fields.map(f => (
                                        <option key={f.id} value={f.id}>{f.name} ({f.total_hectares} ha)</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Monto a Distribuir</label>
                                <input
                                    type="number"
                                    value={fieldTotalAmount}
                                    onChange={(e) => setFieldTotalAmount(Number(e.target.value))}
                                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {allocations.map((alloc, idx) => (
                                <div key={idx} className="flex gap-4 items-end">
                                    <div className="flex-1">
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Sector</label>
                                        <select
                                            value={alloc.sector_id}
                                            onChange={(e) => updateAllocation(idx, 'sector_id', e.target.value)}
                                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
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
                                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
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
                    )}

                    {!editingAssignmentId && distributeBy === 'sector' && (
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
                                    allocations.reduce((sum, a) => sum + a.amount, 0) > (pendingItems.find(p => p.id === selectedItemId)?.remaining_amount || 0) 
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
                                setSelectedItemId(null);
                                setEditingAssignmentId(null);
                            }}
                            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSaveAssignment}
                            disabled={loading}
                            className="inline-flex justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                            {editingAssignmentId ? 'Actualizar' : 'Guardar Asignación'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow p-12 text-center border-2 border-dashed border-gray-300">
                    <ArrowRight className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">Selecciona un item pendiente</h3>
                    <p className="text-gray-500">Haz clic en un item de la izquierda para asignarlo a un sector.</p>
                </div>
            )}

            {/* Recent History */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4">
                    <h3 className="text-lg font-medium text-gray-900">Historial de Asignaciones</h3>
                    
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <input
                            type="text"
                            placeholder="Buscar por item, factura o sector..."
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            className="text-sm border-gray-300 rounded-md shadow-sm focus:border-orange-500 focus:ring-orange-500 flex-1 md:w-64"
                        />
                        <button
                            onClick={handleDeleteAllAssignments}
                            className="text-xs text-red-600 hover:text-red-800 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-2 rounded transition-colors whitespace-nowrap"
                            title="Eliminar todas las asignaciones de esta empresa"
                        >
                            Eliminar Todo
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item / Factura</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sector Asignado</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Máquina</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredHistory.map((h) => (
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
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {h.machines?.name || '-'}
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

      {showMachineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Gestionar Máquinas y Vehículos</h3>
                    <button onClick={() => setShowMachineModal(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="h-6 w-6" />
                    </button>
                </div>
                
                <div className="mb-6 bg-gray-50 p-4 rounded-md border border-gray-200">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">{editingMachine?.id ? 'Editar Máquina' : 'Nueva Máquina'}</h4>
                    <form onSubmit={handleSaveMachine} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500">Nombre</label>
                            <input
                                type="text"
                                required
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                value={editingMachine?.name || ''}
                                onChange={e => setEditingMachine({...editingMachine, name: e.target.value})}
                                placeholder="Ej: Tractor John Deere"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500">Tipo</label>
                            <select
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                value={editingMachine?.type || 'Tractor'}
                                onChange={e => setEditingMachine({...editingMachine, type: e.target.value})}
                            >
                                <option value="Tractor">Tractor</option>
                                <option value="Camioneta">Camioneta</option>
                                <option value="Carro">Carro / Coloso</option>
                                <option value="Implemento">Implemento</option>
                                <option value="Fumigadora">Fumigadora</option>
                                <option value="Otro">Otro</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500">Marca</label>
                            <input
                                type="text"
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                value={editingMachine?.brand || ''}
                                onChange={e => setEditingMachine({...editingMachine, brand: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500">Modelo</label>
                            <input
                                type="text"
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                value={editingMachine?.model || ''}
                                onChange={e => setEditingMachine({...editingMachine, model: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500">Patente (Opcional)</label>
                            <input
                                type="text"
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                value={editingMachine?.plate || ''}
                                onChange={e => setEditingMachine({...editingMachine, plate: e.target.value})}
                            />
                        </div>
                        <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                             <button
                                type="button"
                                onClick={() => setEditingMachine(null)}
                                className="px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Limpiar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="inline-flex justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                            >
                                {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <Save className="h-4 w-4 mr-2" />}
                                Guardar
                            </button>
                        </div>
                    </form>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marca/Modelo</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {machines.map((m) => (
                                <tr key={m.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{m.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{m.type}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{m.brand} {m.model}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => setEditingMachine(m)} className="text-blue-600 hover:text-blue-900 mr-4">Editar</button>
                                        <button onClick={() => handleDeleteMachine(m.id)} className="text-red-600 hover:text-red-900">Eliminar</button>
                                    </td>
                                </tr>
                            ))}
                            {machines.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">No hay máquinas registradas.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
