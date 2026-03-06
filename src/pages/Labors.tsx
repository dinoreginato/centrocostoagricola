import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Tractor, ArrowRight, Save, Loader2, CheckCircle2, AlertCircle, Trash2, Edit2, FileText, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const LABOR_TYPES = [
  'General',
  'Cosecha',
  'Poda',
  'Raleo',
  'Riego',
  'Aplicaciones',
  'Mantenimiento',
  'Plantación',
  'Administración',
  'Otros'
];

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
  field_id: string; // Added field_id for distribution logic
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
    labor_type?: string;
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
  const [fields, setFields] = useState<Field[]>([]);
  
  // Selection State
  const [selectedLaborId, setSelectedLaborId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [assignedDate, setAssignedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [laborType, setLaborType] = useState<string>('General');
  const [distributeBy, setDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [fieldTotalAmount, setFieldTotalAmount] = useState<number>(0);
  
  // Editing State
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

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
    
    // Load Fields
    const { data: fieldsData } = await supabase
        .from('fields')
        .select('*')
        .eq('company_id', selectedCompany.id);
    setFields(fieldsData || []);

    // We need sectors linked to fields of this company
    const { data } = await supabase
        .from('sectors')
        .select(`
            id, name, hectares, field_id,
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
        .eq('invoices.company_id', selectedCompany.id)
        .range(0, 9999);

    if (error) {
        console.error('Error fetching items:', error);
        // Don't throw, just log and return empty to avoid crashing UI completely
        // throw error; 
    }

    // Filter strictly by Category as requested
    const laborCategories = ['labores agrícolas', 'labores agricolas', 'mano de obra', 'servicio de labores'];
    const filteredItems = items?.filter((item: any) => {
        // Double check company_id strictly
        if (item.invoices?.company_id !== selectedCompany.id) return false;

        const cat = (item.category || '').toLowerCase().trim();
        
        // Match only if category contains the labor keywords
        return laborCategories.some(c => cat.includes(c));
    });

    // Optimización: Usar RPC para obtener el total asignado de manera eficiente y escalable
    let assignmentMap = new Map<string, number>();
    
    try {
        const { data: summary, error: rpcError } = await supabase
            .rpc('get_labor_assignments_summary', { p_company_id: selectedCompany.id });
            
        if (rpcError) throw rpcError;
        
        if (summary) {
            summary.forEach((item: any) => {
                assignmentMap.set(item.invoice_item_id, Number(item.total_assigned));
            });
        }
    } catch (err) {
        console.error('Error fetching assignment summary via RPC:', err);
         const { data: fallbackData } = await supabase
             .from('labor_assignments')
             .select('invoice_item_id, assigned_amount, invoice_items!inner(invoices!inner(company_id))')
             .eq('invoice_items.invoices.company_id', selectedCompany.id);
             
         if (fallbackData) {
             fallbackData.forEach((item: any) => {
                 const current = assignmentMap.get(item.invoice_item_id) || 0;
                 assignmentMap.set(item.invoice_item_id, current + Number(item.assigned_amount));
             });
         }
    }

    const pending: LaborItem[] = [];
    filteredItems?.forEach((item: any) => {
        // Double Check: Ensure item belongs to selected company
        if (item.invoices?.company_id !== selectedCompany.id) return;

        // Credit Note Logic (Robust)
        const docType = (item.invoices.document_type || '').toLowerCase();
        // Check for common credit note variations
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
        
        // Ensure negative if it's a credit note, even if database stored it as positive
        if (isCreditNote) {
            total = -Math.abs(total);
        } else {
            // If NOT a credit note, ensure positive
            total = Math.abs(total);
        }

        const assigned = assignmentMap.get(item.id) || 0;
        const remaining = total - assigned;

        // Tolerance for float errors (absolute value for negative amounts)
        if (Math.abs(remaining) > 10) {  
            pending.push({
                id: item.id,
                invoice_id: item.invoices.id,
                invoice_number: item.invoices.invoice_number,
                date: item.invoices.invoice_date,
                description: `${item.products?.name || 'Sin descripción'} ${isCreditNote ? '(NC)' : ''} [${item.invoices.document_type}]`, // Added doc type for debug visibility
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

    // Fetch more items to allow better client-side search (e.g. last 500)
    const { data } = await supabase
        .from('labor_assignments')
        .select(`
            id, assigned_amount, assigned_date, labor_type,
            sectors (name),
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
    const type = (h.labor_type || '').toLowerCase();
    
    return productName.includes(search) || invoiceNum.includes(search) || sectorName.includes(search) || type.includes(search);
  });

  const handleSelectLabor = (labor: LaborItem) => {
    setSelectedLaborId(labor.id);
    setEditingAssignmentId(null);
    setAssignedDate(labor.date ? labor.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    // Reset allocations
    setDistributeBy('sector');
    setAllocations([{ sector_id: '', amount: labor.remaining_amount }]);
    setFieldTotalAmount(labor.remaining_amount);
    
    // Try to guess labor type from description
    const desc = labor.description.toLowerCase();
    const matchedType = LABOR_TYPES.find(t => t !== 'General' && desc.includes(t.toLowerCase()));
    setLaborType(matchedType || 'General');
  };

  const handleEditAssignment = (assignment: HistoryItem) => {
      setEditingAssignmentId(assignment.id);
      setSelectedLaborId(assignment.invoice_item_id);
      setAssignedDate(assignment.assigned_date ? assignment.assigned_date.split('T')[0] : new Date().toISOString().split('T')[0]);
      setLaborType(assignment.labor_type || 'General');
      
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

  const handleDeleteAllAssignments = async () => {
    if (!selectedCompany) return;
    if (!confirm('¿ESTÁ SEGURO? Esto eliminará TODAS las asignaciones de labores para esta empresa. Esta acción no se puede deshacer.')) return;

    setLoading(true);
    // Use a custom RPC to delete by company_id directly in the database.
    try {
        const { error: rpcError } = await supabase.rpc('delete_labor_assignments_by_company', {
            p_company_id: selectedCompany.id
        });
        
        if (rpcError) {
             // If RPC doesn't exist yet, fall back to the batched method
             console.warn('RPC delete failed, falling back to manual batch delete', rpcError);
             throw rpcError; 
        }

        alert('Todas las asignaciones han sido eliminadas.');
        loadData();
    } catch (error: any) {
         // Fallback implementation
         try {
            const { data: assignments, error: fetchError } = await supabase
            .from('labor_assignments')
            .select('id, invoice_items!inner(invoices!inner(company_id))')
            .eq('invoice_items.invoices.company_id', selectedCompany.id);

            if (fetchError) throw fetchError;

            if (!assignments || assignments.length === 0) {
                alert('No hay asignaciones para eliminar.');
                return;
            }

            const ids = assignments.map(a => a.id);
            // Smaller batch size
            const BATCH_SIZE = 100; 
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                const { error: deleteError } = await supabase
                    .from('labor_assignments')
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
    
    if (allocations.some(a => !a.sector_id || a.amount === 0) && distributeBy === 'sector') { // Allow negative amounts, just not 0
        alert('Complete todos los campos de sector y monto distinto de 0');
        return;
    }

    if (distributeBy === 'field' && !selectedFieldId) {
        alert('Seleccione un campo');
        return;
    }
    
    if (distributeBy === 'field' || distributeBy === 'company') {
        if (fieldTotalAmount === 0) {
             alert('El monto a distribuir no puede ser 0');
             return;
        }
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
                    assigned_date: assignedDate,
                    labor_type: laborType
                })
                .eq('id', editingAssignmentId);

            if (error) throw error;
            alert('Asignación actualizada exitosamente');
        } else {
            // Create new assignments
            let payload: any[] = [];
            
            if (distributeBy === 'sector') {
                 payload = allocations.map(a => ({
                    invoice_item_id: selectedLaborId,
                    sector_id: a.sector_id,
                    assigned_amount: a.amount,
                    assigned_date: assignedDate,
                    labor_type: laborType
                }));
            } else if (distributeBy === 'field') {
                 // Distribute proportional to hectares in the selected field
                 const targetSectors = sectors.filter(s => s.field_id === selectedFieldId);
                 if (targetSectors.length === 0) throw new Error('El campo seleccionado no tiene sectores');
                 
                 const totalHa = targetSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
                 if (totalHa === 0) throw new Error('El campo no tiene hectáreas definidas');

                 payload = targetSectors.map(s => ({
                     invoice_item_id: selectedLaborId,
                     sector_id: s.id,
                     assigned_amount: (Number(s.hectares) / totalHa) * fieldTotalAmount,
                     assigned_date: assignedDate,
                     labor_type: laborType
                 }));
            } else if (distributeBy === 'company') {
                 // Distribute proportional to hectares across ALL fields
                 const totalHa = sectors.reduce((sum, s) => sum + Number(s.hectares), 0);
                 if (totalHa === 0) throw new Error('La empresa no tiene hectáreas definidas');

                 payload = sectors.map(s => ({
                     invoice_item_id: selectedLaborId,
                     sector_id: s.id,
                     assigned_amount: (Number(s.hectares) / totalHa) * fieldTotalAmount,
                     assigned_date: assignedDate,
                     labor_type: laborType
                 }));
            }

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

  const handlePrintReport = () => {
      const doc = new jsPDF();
      
      doc.setFontSize(18);
      doc.text('Informe de Labores Agrícolas', 14, 20);
      
      doc.setFontSize(12);
      doc.text(`Empresa: ${selectedCompany?.name}`, 14, 30);
      doc.text(`Fecha Emisión: ${new Date().toLocaleDateString()}`, 14, 36);

      // Group by Labor Type
      const grouped = filteredHistory.reduce((acc, curr) => {
          const type = curr.labor_type || 'General';
          if (!acc[type]) acc[type] = [];
          acc[type].push(curr);
          return acc;
      }, {} as Record<string, HistoryItem[]>);

      let yPos = 45;

      Object.entries(grouped).forEach(([type, items]) => {
          // Check if we need a new page
          if (yPos > 250) {
              doc.addPage();
              yPos = 20;
          }

          doc.setFontSize(14);
          doc.setTextColor(22, 163, 74); // Green-600
          doc.setFont("helvetica", "bold");
          doc.text(type.toUpperCase(), 14, yPos);
          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "normal");
          yPos += 5;

          const tableBody = items.map(item => [
              new Date(item.assigned_date).toLocaleDateString(),
              item.invoice_items?.products?.name || '',
              item.sectors?.name || '',
              formatCLP(item.assigned_amount)
          ]);
          
          const totalAmount = items.reduce((sum, i) => sum + i.assigned_amount, 0);

          autoTable(doc, {
              startY: yPos,
              head: [['Fecha', 'Labor / Item', 'Sector', 'Monto']],
              body: tableBody,
              theme: 'striped',
              headStyles: { fillColor: [22, 163, 74] }, // Green
              columnStyles: { 3: { halign: 'right' } },
              foot: [['', '', 'TOTAL:', formatCLP(totalAmount)]],
              footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold', halign: 'right' },
              margin: { left: 14, right: 14 }
          });

          yPos = (doc as any).lastAutoTable.finalY + 15;
      });

      window.open(doc.output('bloburl'), '_blank');
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
                            <label className="block text-sm font-medium text-gray-700">Modo de Distribución</label>
                            <div className="mt-2 flex space-x-4">
                                <label className="inline-flex items-center">
                                    <input
                                        type="radio"
                                        className="form-radio text-green-600"
                                        name="distributeBy"
                                        value="sector"
                                        checked={distributeBy === 'sector'}
                                        onChange={() => setDistributeBy('sector')}
                                    />
                                    <span className="ml-2">Por Sector</span>
                                </label>
                                <label className="inline-flex items-center">
                                    <input
                                        type="radio"
                                        className="form-radio text-green-600"
                                        name="distributeBy"
                                        value="field"
                                        checked={distributeBy === 'field'}
                                        onChange={() => setDistributeBy('field')}
                                    />
                                    <span className="ml-2">Por Campo Completo</span>
                                </label>
                                <label className="inline-flex items-center">
                                    <input
                                        type="radio"
                                        className="form-radio text-green-600"
                                        name="distributeBy"
                                        value="company"
                                        checked={distributeBy === 'company'}
                                        onChange={() => setDistributeBy('company')}
                                    />
                                    <span className="ml-2">Toda la Empresa</span>
                                </label>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Tipo de Labor</label>
                                <select
                                    value={laborType}
                                    onChange={(e) => setLaborType(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                >
                                    {LABOR_TYPES.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Fecha de Asignación</label>
                                <input
                                    type="date"
                                    value={assignedDate}
                                    onChange={(e) => setAssignedDate(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {distributeBy === 'sector' && allocations.map((alloc, idx) => (
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

                        {distributeBy === 'field' && (
                            <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Campo</label>
                                    <select
                                        value={selectedFieldId}
                                        onChange={(e) => setSelectedFieldId(e.target.value)}
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                    >
                                        <option value="">Seleccione un Campo...</option>
                                        {fields.map(f => (
                                            <option key={f.id} value={f.id}>{f.name}</option>
                                        ))}
                                    </select>
                                    <p className="mt-1 text-xs text-blue-600">
                                        El costo se distribuirá proporcionalmente a las hectáreas de cada sector dentro de este campo.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Monto Total a Distribuir</label>
                                    <input
                                        type="number"
                                        value={fieldTotalAmount}
                                        onChange={(e) => setFieldTotalAmount(Number(e.target.value))}
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                    />
                                </div>
                            </div>
                        )}

                        {distributeBy === 'company' && (
                            <div className="space-y-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                                <div className="text-sm text-purple-800 font-medium">
                                    Distribución a Toda la Empresa
                                </div>
                                <p className="text-xs text-purple-600">
                                    El costo se distribuirá proporcionalmente a las hectáreas de <strong>TODOS</strong> los sectores de la empresa.
                                </p>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Monto Total a Distribuir</label>
                                    <input
                                        type="number"
                                        value={fieldTotalAmount}
                                        onChange={(e) => setFieldTotalAmount(Number(e.target.value))}
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

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
                <div className="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4">
                    <h3 className="text-lg font-medium text-gray-900">Historial de Asignaciones</h3>
                    
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <input
                            type="text"
                            placeholder="Buscar por item, factura o sector..."
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            className="text-sm border-gray-300 rounded-md shadow-sm focus:border-green-500 focus:ring-green-500 flex-1 md:w-64"
                        />
                        <button
                            onClick={handlePrintReport}
                            className="text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-2 rounded transition-colors whitespace-nowrap flex items-center"
                            title="Descargar Reporte PDF"
                        >
                            <FileText className="h-4 w-4 mr-1" />
                            Reporte
                        </button>
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo Labor</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item / Factura</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sector Asignado</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredHistory.map((h) => (
                                <tr key={h.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(h.assigned_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                            h.labor_type === 'Cosecha' ? 'bg-orange-100 text-orange-800' :
                                            h.labor_type === 'Poda' ? 'bg-blue-100 text-blue-800' :
                                            h.labor_type === 'Raleo' ? 'bg-purple-100 text-purple-800' :
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                            {h.labor_type || 'General'}
                                        </span>
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
