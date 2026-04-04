import { toast } from 'sonner';
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { LayoutList, ArrowRight, Save, Loader2, AlertCircle, Trash2, Edit2 } from 'lucide-react';

interface GeneralCostItem {
  id: string; // invoice_item_id
  invoice_id: string;
  invoice_number: string;
  date: string;
  description: string;
  category: string;
  total_amount: number;
  assigned_amount: number;
  remaining_amount: number;
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
    category: string;
    description: string;
    sectors?: { name: string };
    invoice_items?: {
        products?: { name: string };
        invoices?: { invoice_number: string };
    };
}

export const GeneralCosts: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  // Removed activeTab since Chemicals are excluded as per user request
  
  // Data State
  const [pendingCosts, setPendingCosts] = useState<GeneralCostItem[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  
  // Selection State
  const [selectedCostId, setSelectedCostId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [assignedDate, setAssignedDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [distributeBy, setDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [fieldTotalAmount, setFieldTotalAmount] = useState<number>(0);
  const [manualDescription, setManualDescription] = useState<string>(''); // For manual entries if we add that later
  
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
            loadPendingCosts(),
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

    // Load Sectors
    const { data } = await supabase
        .from('sectors')
        .select(`
            id, name, hectares, field_id,
            fields!inner(company_id)
        `)
        .eq('fields.company_id', selectedCompany.id);
    
    setSectors(data || []);
  };

  const loadPendingCosts = async () => {
    if (!selectedCompany) return;

    // 1. Fetch Invoice Items with Exempt Amounts
    const { data: items, error } = await supabase
        .from('invoice_items')
        .select(`
            id, total_price, category,
            products (name, category),
            invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage, exempt_amount, special_tax_amount, total_amount)
        `)
        .eq('invoices.company_id', selectedCompany.id)
        .range(0, 9999);

    if (error) {
        console.error('Error fetching items:', error);
        return;
    }

    // Categories explicitly handled by other modules (Core)
    const CORE_EXCLUDED = [
        'mano de obra', 'labores agricolas', 'labores agricolas', 'servicio de labores',
        'petroleo', 'combustible', 'diesel', 'bencina',
        'riego', 'agua', 'electricidad',
        'maquinaria', 'arriendo maquinaria', 'repuesto', 'mantencion',
        // EXCLUDED CHEMICALS AS PER USER REQUEST - Handled by Applications module
        'quimicos', 'fertilizantes', 'pesticida', 'fungicida', 'herbicida', 'insecticida', 'semillas', 'plantas', 'plaguicida'
    ];

    // Filter items
    const filteredItems = items?.filter((item: any) => {
        // Normalize category: lower case, remove accents
        const rawCat = item.category || item.products?.category || '';
        const cat = rawCat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const prodName = (item.products?.name || '').toLowerCase().trim();
        
        // Always exclude CORE modules and CHEMICALS
        // We now primarily check CATEGORY.
        // If the category contains any core keyword, exclude it.
        const isCore = CORE_EXCLUDED.some(ex => cat.includes(ex));
        
        if (isCore) return false;
        
        return true; 
    });

    // 2. Calculate Assigned Amounts
    // We need to sum up assignments from `general_costs` table
    // Use RPC to get the sum directly from the database to avoid pagination limits (1000 rows)
    const { data: assignments, error: assignmentError } = await supabase
        .rpc('get_general_costs_summary', { p_company_id: selectedCompany.id });

    if (assignmentError) {
        console.error('Error fetching cost summary:', assignmentError);
    }

    const assignmentMap = new Map<string, number>();
    (assignments || []).forEach((a: any) => {
        assignmentMap.set(a.invoice_item_id, Number(a.total_assigned));
    });

    // Pre-calculate subtotal for each invoice to properly apportion exempt/special taxes
    const invoiceSubtotals = new Map<string, number>();
    items?.forEach((item: any) => {
        const invId = item.invoices.id;
        const currentSum = invoiceSubtotals.get(invId) || 0;
        invoiceSubtotals.set(invId, currentSum + (Number(item.total_price) || 0));
    });

    const pending: GeneralCostItem[] = [];
    filteredItems?.forEach((item: any) => {
        const docType = (item.invoices.document_type || '').toLowerCase();
        const isCreditNote = docType.includes('nota de cr') || docType.includes('nc');

        // Logic for Tax Calculation
        // Invoices table might have tax_percentage. If not, default to 19.
        // However, if the item total price is just the net, and it has exempt amounts, 
        // the item level doesn't know it's exempt unless we check the invoice document_type.
        let taxPercent = item.invoices.tax_percentage !== undefined ? item.invoices.tax_percentage : 19;
        
        // Force 0% tax for Exenta documents to ensure we don't add IVA
        if (docType.includes('exenta') || docType.includes('honorario')) {
            taxPercent = 0;
        }

        const itemNet = Number(item.total_price) || 0;
        
        // Use the pre-calculated subtotal of all items in this invoice
        const invId = item.invoices.id;
        const invoiceSubtotal = invoiceSubtotals.get(invId) || 0;
        
        const invoiceExempt = Number(item.invoices.exempt_amount) || 0;
        const invoiceSpecial = Number(item.invoices.special_tax_amount) || 0;
        
        // Proportion of this item relative to the total of all items
        // If subtotal is 0 (e.g. items with 0 price), we just split equally among items or give 100% if it's the only one.
        // For simplicity, if subtotal is 0, we can't easily apportion. We'll default to 1 if it's the only item, or 0.
        const itemProportion = invoiceSubtotal > 0 ? (itemNet / invoiceSubtotal) : 1;
        
        const itemExemptShare = itemProportion * invoiceExempt;
        const itemSpecialShare = itemProportion * invoiceSpecial;
        
        // The final gross amount to distribute is the item's taxable amount + its tax + its share of the exempt/special amounts
        const itemTaxAmount = itemNet * (taxPercent / 100);
        const grossAmount = itemNet + itemTaxAmount + itemExemptShare + itemSpecialShare;
        
        let total = isCreditNote ? -Math.abs(grossAmount) : Math.abs(grossAmount);
        
        // Ensure total is positive for logic, we handle negative signs if needed but usually costs are positive to distribute
        // If it's a credit note, we need to treat its total as negative so the assigned amount (also negative) cancels it out.
        const assigned = assignmentMap.get(item.id) || 0;
        
        // For credit notes, total is negative, assigned is negative.
        // Remaining should be total - assigned.
        // Example: total = -100, assigned = -100. Remaining = 0.
        // Example 2: total = -100, assigned = 0. Remaining = -100.
        const remaining = total - assigned;

        // Check if remaining is significant (ignore minor rounding differences)
        // Also ensure we handle negative remaining amounts for credit notes properly
        // If remaining is very close to 0 (e.g. between -500 and 500), consider it fully assigned
        const isSignificant = Math.abs(remaining) > 500;

        if (isSignificant) {  
            pending.push({
                id: item.id,
                invoice_id: item.invoices.id,
                invoice_number: item.invoices.invoice_number,
                date: item.invoices.invoice_date,
                description: `${item.products?.name || 'Item'} [${item.category}]`,
                category: item.category,
                total_amount: total,
                assigned_amount: assigned,
                remaining_amount: remaining
            });
        }
    });

    setPendingCosts(pending);
  };

  const loadHistory = async () => {
    if (!selectedCompany) return;

    const { data } = await supabase
        .from('general_costs')
        .select(`
            id, amount, date, category, description, invoice_item_id,
            sectors (name),
            invoice_items (
                products (name),
                invoices (invoice_number)
            )
        `)
        .eq('company_id', selectedCompany.id)
        .order('date', { ascending: false })
        .limit(500);
    
    // Map to HistoryItem
    const mapped: HistoryItem[] = (data || []).map((d: any) => ({
        id: d.id,
        assigned_amount: d.amount,
        assigned_date: d.date,
        sector_id: d.sectors?.id, // Note: select didn't fetch id, need to verify if needed for edit
        invoice_item_id: d.invoice_item_id,
        category: d.category,
        description: d.description,
        sectors: d.sectors,
        invoice_items: d.invoice_items
    }));
    
    setHistory(mapped);
  };

  const filteredHistory = history.filter(h => {
    if (!historySearch) return true;
    const search = historySearch.toLowerCase();
    const desc = (h.description || '').toLowerCase();
    const cat = (h.category || '').toLowerCase();
    const sector = (h.sectors?.name || '').toLowerCase();
    const invoice = (h.invoice_items?.invoices?.invoice_number || '').toLowerCase();
    
    return desc.includes(search) || cat.includes(search) || sector.includes(search) || invoice.includes(search);
  });

  const handleSelectCost = (cost: GeneralCostItem) => {
    setSelectedCostId(cost.id);
    setEditingAssignmentId(null);
    setAssignedDate(cost.date ? cost.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    setDistributeBy('sector');
    setAllocations([{ sector_id: '', amount: cost.remaining_amount }]);
    setFieldTotalAmount(cost.remaining_amount);
  };

  const handleEditAssignment = (assignment: HistoryItem) => {
      setEditingAssignmentId(assignment.id);
      setSelectedCostId(assignment.invoice_item_id); // If null (manual entry), this might be null
      setAssignedDate(assignment.assigned_date);
      setAllocations([{ 
          sector_id: assignment.sector_id, // We need sector_id in history fetch!
          amount: assignment.assigned_amount 
      }]);
      // Note: Editing manual entries or entries without invoice link might need special handling
      // For now assume all are linked
  };

  const handleDeleteAssignment = async (id: string) => {
      if (!confirm('¿Eliminar asignación?')) return;
      setLoading(true);
      const { error } = await supabase.from('general_costs').delete().eq('id', id);
      if (!error) loadData();
      else toast.error('Error al eliminar');
      setLoading(false);
  };

  const handleDeleteAllHistory = async () => {
    if (!selectedCompany) return;
    if (!confirm('¿ESTÁ SEGURO? Esto eliminará TODAS las distribuciones de costos realizadas. Esta acción no se puede deshacer.')) return;
    
    setLoading(true);
    try {
        const { error } = await supabase
            .from('general_costs')
            .delete()
            .eq('company_id', selectedCompany.id);
        
        if (error) throw error;
        
        toast('Historial eliminado correctamente. Todos los costos volverán a estar pendientes.');
        loadData();
    } catch (error: any) {
        console.error('Error deleting all history:', error);
        toast.error('Error al eliminar historial: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleSaveAssignment = async () => {
    if (!selectedCostId) return;
    
    const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    const selectedCost = pendingCosts.find(p => p.id === selectedCostId);
    
    // Validation logic similar to Labors...
    if (selectedCost && !editingAssignmentId) {
        if (Math.abs(totalAllocated) > Math.abs(selectedCost.remaining_amount) + 1) {
             toast('El monto excede el pendiente');
             return;
        }
    }

    if (distributeBy === 'field' && !selectedFieldId) { toast('Seleccione Campo'); return; }

    setLoading(true);
    try {
        let payload: any[] = [];
        const baseData = {
            company_id: selectedCompany?.id,
            invoice_item_id: selectedCostId,
            category: selectedCost?.category || 'General',
            description: selectedCost?.description || 'Asignación General',
            date: assignedDate
        };

        if (editingAssignmentId) {
            // Update single
             const { error } = await supabase.from('general_costs').update({
                 sector_id: allocations[0].sector_id,
                 amount: allocations[0].amount,
                 date: assignedDate
             }).eq('id', editingAssignmentId);
             if(error) throw error;
        } else {
            // Insert
            if (distributeBy === 'sector') {
                payload = allocations.map(a => ({
                    ...baseData,
                    sector_id: a.sector_id,
                    amount: a.amount
                }));
            } else if (distributeBy === 'field') {
                 const targetSectors = sectors.filter(s => s.field_id === selectedFieldId);
                 const totalHa = targetSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
                 payload = targetSectors.map(s => ({
                     ...baseData,
                     sector_id: s.id,
                     amount: (Number(s.hectares) / totalHa) * fieldTotalAmount
                 }));
            } else if (distributeBy === 'company') {
                 const totalHa = sectors.reduce((sum, s) => sum + Number(s.hectares), 0);
                 payload = sectors.map(s => ({
                     ...baseData,
                     sector_id: s.id,
                     amount: (Number(s.hectares) / totalHa) * fieldTotalAmount
                 }));
            }
            
            const { error } = await supabase.from('general_costs').insert(payload);
            if(error) throw error;
        }

        toast('Guardado correctamente');
        setSelectedCostId(null);
        setEditingAssignmentId(null);
        setAllocations([]);
        loadData();

    } catch (error: any) {
        toast.error('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  // Helper to add/remove rows
  const handleAddRow = () => setAllocations([...allocations, { sector_id: '', amount: 0 }]);
  const handleRemoveRow = (i: number) => {
      const n = [...allocations]; n.splice(i, 1); setAllocations(n);
  };
  const updateAlloc = (i: number, f: keyof Allocation, v: any) => {
      const n = [...allocations]; n[i] = { ...n[i], [f]: v }; setAllocations(n);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
                <LayoutList className="mr-2 h-8 w-8 text-purple-600" />
                Distribución de Costos
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Asignación de Servicios, Transporte y Otros Gastos Generales</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending List */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center">
                    <AlertCircle className="h-4 w-4 mr-2 text-yellow-500" />
                    Items Pendientes
                </h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[600px] overflow-y-auto">
                {pendingCosts.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">No hay items pendientes.</div>
                ) : (
                    pendingCosts.map(item => (
                        <div 
                            key={item.id} 
                            onClick={() => handleSelectCost(item)}
                            className={`p-4 cursor-pointer hover:bg-purple-50 transition-colors ${selectedCostId === item.id ? 'bg-purple-50 ring-2 ring-inset ring-purple-500' : ''}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">#{item.invoice_number}</span>
                                <span className="text-xs text-gray-400">{new Date(item.date).toLocaleDateString()}</span>
                            </div>
                            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">{item.description}</h4>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                                    {item.category}
                                </span>
                                <span className="text-sm font-bold text-purple-600">
                                    {formatCLP(item.remaining_amount)}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* Form */}
        <div className="lg:col-span-2 space-y-6">
            {selectedCostId ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-t-4 border-purple-500">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                        {editingAssignmentId ? 'Editar Asignación' : 'Distribuir Costo'}
                    </h3>
                    
                    <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-md mb-6">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                            {pendingCosts.find(p => p.id === selectedCostId)?.description}
                        </div>
                         <div className="text-right mt-2 text-lg font-bold text-purple-600">
                            Por Asignar: {formatCLP(pendingCosts.find(p => p.id === selectedCostId)?.remaining_amount || 0)}
                        </div>

                        {/* Distribution Mode */}
                        <div className="mt-4 flex space-x-4">
                            {['sector', 'field', 'company'].map(mode => (
                                <label key={mode} className="inline-flex items-center capitalize">
                                    <input
                                        type="radio"
                                        className="form-radio text-purple-600"
                                        name="distributeBy"
                                        value={mode}
                                        checked={distributeBy === mode}
                                        onChange={() => setDistributeBy(mode as any)}
                                    />
                                    <span className="ml-2">{mode === 'sector' ? 'Por Sector' : mode === 'field' ? 'Por Campo' : 'Toda la Empresa'}</span>
                                </label>
                            ))}
                        </div>
                        
                         <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha</label>
                            <input
                                type="date"
                                value={assignedDate}
                                onChange={(e) => setAssignedDate(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                            />
                        </div>
                    </div>

                    {/* Dynamic Inputs */}
                    <div className="space-y-4">
                        {distributeBy === 'sector' && allocations.map((alloc, idx) => (
                            <div key={idx} className="flex gap-4 items-end">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Sector</label>
                                    <select
                                        value={alloc.sector_id}
                                        onChange={(e) => updateAlloc(idx, 'sector_id', e.target.value)}
                                        className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                                    >
                                        <option value="">Seleccionar...</option>
                                        {sectors.map(s => <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>)}
                                    </select>
                                </div>
                                <div className="w-40">
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monto</label>
                                    <input
                                        type="number"
                                        value={alloc.amount}
                                        onChange={(e) => updateAlloc(idx, 'amount', Number(e.target.value))}
                                        className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                                    />
                                </div>
                                <button onClick={() => handleRemoveRow(idx)} className="mb-1 p-2 text-red-500">&times;</button>
                            </div>
                        ))}

                        {distributeBy === 'field' && (
                             <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Campo</label>
                                <select
                                    value={selectedFieldId}
                                    onChange={(e) => setSelectedFieldId(e.target.value)}
                                    className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm mb-4"
                                >
                                    <option value="">Seleccione Campo...</option>
                                    {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto Total</label>
                                <input
                                    type="number"
                                    value={fieldTotalAmount}
                                    onChange={(e) => setFieldTotalAmount(Number(e.target.value))}
                                    className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                                />
                            </div>
                        )}
                        
                        {distributeBy === 'company' && (
                             <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto Total a Distribuir</label>
                                <input
                                    type="number"
                                    value={fieldTotalAmount}
                                    onChange={(e) => setFieldTotalAmount(Number(e.target.value))}
                                    className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                                />
                            </div>
                        )}
                    </div>

                    {distributeBy === 'sector' && (
                        <button onClick={handleAddRow} className="mt-2 text-sm text-purple-600">+ Agregar Sector</button>
                    )}

                    <div className="mt-8 flex justify-end space-x-3">
                        <button onClick={() => setSelectedCostId(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300">Cancelar</button>
                        <button onClick={handleSaveAssignment} className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700">
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : <Save className="h-5 w-5 mr-2 inline" />}
                            Guardar
                        </button>
                    </div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-12 text-center border-2 border-dashed border-gray-300 dark:border-gray-600">
                    <ArrowRight className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Selecciona un item pendiente</h3>
                </div>
            )}

            {/* History Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Historial</h3>
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={historySearch}
                            onChange={e => setHistorySearch(e.target.value)}
                            className="mt-2 text-sm border-gray-300 dark:border-gray-600 rounded-md shadow-sm w-full"
                        />
                    </div>
                    {history.length > 0 && (
                        <button 
                            onClick={handleDeleteAllHistory}
                            className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center bg-red-50 px-3 py-2 rounded-md hover:bg-red-100 transition-colors"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar Todo
                        </button>
                    )}
                </div>
                <div className="overflow-x-auto max-h-[400px]">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Item</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Sector</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monto</th>
                                <th className="px-6 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredHistory.map(h => (
                                <tr key={h.id}>
                                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{new Date(h.assigned_date).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                        <div className="font-medium">{h.description}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">#{h.invoice_items?.invoices?.invoice_number}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{h.sectors?.name}</td>
                                    <td className="px-6 py-4 text-sm text-right font-bold text-gray-900 dark:text-gray-100">{formatCLP(h.assigned_amount)}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button onClick={() => handleDeleteAssignment(h.id)} className="text-red-500 hover:text-red-700">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
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
