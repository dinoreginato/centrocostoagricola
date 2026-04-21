import { toast } from 'sonner';
import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Users, UserPlus, Trash2, Briefcase, Loader2, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fetchCompanyFieldsBasic, fetchCompanySectorsBasic } from '../services/companyStructure';
import { fetchWorkerCosts, fetchWorkers } from '../services/workers';

interface Worker {
  id: string;
  name: string;
  role: string;
}

interface WorkerCost {
  id: string;
  date: string;
  amount: number;
  description: string;
  worker_id: string;
  sector_id: string;
  workers?: { name: string };
  sectors?: { name: string };
  is_piece_rate?: boolean;
  piece_quantity?: number;
  piece_price?: number;
  worker_name?: string;
  labor_type?: string;
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

export const Workers: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [costs, setCosts] = useState<WorkerCost[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  
  // Worker Form State
  const [showWorkerForm, setShowWorkerForm] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerRole, setNewWorkerRole] = useState('');

  // Cost Form State
  const [distributeBy, setDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [selectedFieldId, setSelectedFieldId] = useState('');
  
  // Piece-rate State
  const [isPieceRate, setIsPieceRate] = useState(false);
  const [pieceQuantity, setPieceQuantity] = useState<number | ''>('');
  const [piecePrice, setPiecePrice] = useState<number | ''>('');
  const [workerName, setWorkerName] = useState('');
  const [laborType, setLaborType] = useState('');

  const loadWorkers = useCallback(async () => {
      if (!selectedCompany) return;
      const data = await fetchWorkers({ companyId: selectedCompany.id });
      setWorkers(data || []);
  }, [selectedCompany]);

  const loadSectorsAndFields = useCallback(async () => {
    if (!selectedCompany) return;
    
    const [fieldsData, sectorsData] = await Promise.all([
      fetchCompanyFieldsBasic({ companyId: selectedCompany.id }),
      fetchCompanySectorsBasic({ companyId: selectedCompany.id })
    ]);
    setFields(fieldsData || []);
    setSectors(sectorsData || []);
  }, [selectedCompany]);

  const loadCosts = useCallback(async () => {
    if (!selectedCompany) return;
    const data = await fetchWorkerCosts({ companyId: selectedCompany.id });
    setCosts(data || []);
  }, [selectedCompany]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadWorkers(), loadSectorsAndFields(), loadCosts()]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [loadCosts, loadSectorsAndFields, loadWorkers]);

  useEffect(() => {
    if (selectedCompany) {
      void loadData();
    }
  }, [selectedCompany, loadData]);

  const handleCreateWorker = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newWorkerName || !selectedCompany) return;

      setLoading(true);
      try {
          const { error } = await supabase.from('workers').insert({
              company_id: selectedCompany.id,
              name: newWorkerName,
              role: newWorkerRole
          });
          if (error) throw error;
          
          setNewWorkerName('');
          setNewWorkerRole('');
          setShowWorkerForm(false);
          loadWorkers();
      } catch (error: any) {
          toast.error('Error: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleDeleteWorker = async (id: string) => {
      if (!confirm('¿Eliminar trabajador? Se borrarán sus registros de costos.')) return;
      const { error } = await supabase.from('workers').delete().eq('id', id);
      if (error) toast.error('Error al eliminar');
      else loadWorkers();
  };

  const handleSaveCost = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedCompany) return;

    if (isPieceRate) {
        if (!pieceQuantity || !piecePrice || !workerName || !laborType) {
            toast('Complete todos los campos del trato');
            return;
        }
        if (distributeBy === 'sector' && !selectedSectorId) {
            toast('Seleccione un sector');
            return;
        }
    } else {
        if (!amount || !selectedWorkerId || !description) {
            toast('Complete todos los campos obligatorios');
            return;
        }
        if (distributeBy === 'sector' && !selectedSectorId) {
            toast('Seleccione un sector');
            return;
        }
        if (distributeBy === 'field' && !selectedFieldId) {
            toast('Seleccione un campo');
            return;
        }
    }

    setLoading(true);
    try {
        const totalAmount = isPieceRate ? (Number(pieceQuantity) * Number(piecePrice)) : Number(amount);
        
        if (distributeBy === 'company') {
            // Distribute by Company (All Fields)
            const allSectors = sectors;
            const totalHa = allSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            
            if (totalHa === 0) {
                toast('La empresa no tiene hectáreas definidas en ningún sector.');
                setLoading(false);
                return;
            }

            const costsToInsert = allSectors.map(s => {
                const sectorAmount = (Number(s.hectares) / totalHa) * totalAmount;
                return {
                    company_id: selectedCompany.id,
                    worker_id: selectedWorkerId,
                    date,
                    description: `${description} (Dist. Empresa)`,
                    amount: sectorAmount,
                    sector_id: s.id
                };
            });

            const { error } = await supabase
                .from('worker_costs')
                .insert(costsToInsert);
            
            if (error) throw error;

        } else if (distributeBy === 'field') {
            // Distribute by Field Logic
            const fieldSectors = sectors.filter(s => s.field_id === selectedFieldId);
            if (fieldSectors.length === 0) {
                toast('El campo seleccionado no tiene sectores asociados.');
                setLoading(false);
                return;
            }

            const totalHa = fieldSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            if (totalHa === 0) {
                toast('Los sectores del campo no tienen hectáreas definidas.');
                setLoading(false);
                return;
            }

            const costsToInsert = fieldSectors.map(s => {
                const sectorAmount = (Number(s.hectares) / totalHa) * totalAmount;
                return {
                    company_id: selectedCompany.id,
                    worker_id: selectedWorkerId,
                    date,
                    description: `${description} (Dist. Campo)`,
                    amount: sectorAmount,
                    sector_id: s.id
                };
            });

            const { error } = await supabase
                .from('worker_costs')
                .insert(costsToInsert);
            
            if (error) throw error;

        } else {
            // Single Sector Logic
            const { error } = await supabase
                .from('worker_costs')
                .insert({
                    company_id: selectedCompany.id,
                    worker_id: isPieceRate ? null : selectedWorkerId,
                    date,
                    description: isPieceRate ? `Trato: ${laborType} - ${workerName} (${pieceQuantity} x $${piecePrice})` : description,
                    amount: totalAmount,
                    sector_id: selectedSectorId,
                    is_piece_rate: isPieceRate,
                    piece_quantity: isPieceRate ? Number(pieceQuantity) : null,
                    piece_price: isPieceRate ? Number(piecePrice) : null,
                    worker_name: isPieceRate ? workerName : null,
                    labor_type: isPieceRate ? laborType : null
                });

            if (error) throw error;
        }

        // Reset form partial
        setAmount('');
        setDescription('');
        setPieceQuantity('');
        setPiecePrice('');
        setWorkerName('');
        setLaborType('');
        
        // Reload
        await loadCosts();
        toast('Costo registrado exitosamente');

    } catch (error: any) {
        console.error('Error saving cost:', error);
        toast.error('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteCost = async (id: string) => {
      if (!confirm('¿Eliminar este registro de costo?')) return;
      const { error } = await supabase.from('worker_costs').delete().eq('id', id);
      if (error) toast.error('Error al eliminar');
      else loadCosts();
  };

  const generatePayrollPDF = () => {
    if (costs.length === 0) {
      toast('No hay registros de costos o tratos para exportar.');
      return;
    }

    const doc = new jsPDF();
    const companyName = selectedCompany?.name || 'Empresa';
    
    // Header
    doc.setFontSize(18);
    doc.text('Planilla de Pagos y Tratos', 14, 22);
    doc.setFontSize(11);
    doc.text(`Empresa: ${companyName}`, 14, 30);
    doc.text(`Fecha Emisión: ${new Date().toLocaleDateString('es-CL')}`, 14, 36);

    // Group costs by worker
    const workerTotals = new Map<string, { total: number, name: string, details: string[] }>();
    
    costs.forEach(cost => {
        const workerName = cost.worker_name || cost.workers?.name || 'Trabajador Externo';
        if (!workerTotals.has(workerName)) {
            workerTotals.set(workerName, { total: 0, name: workerName, details: [] });
        }
        
        const w = workerTotals.get(workerName)!;
        w.total += cost.amount;
        
        const dateStr = new Date(cost.date).toLocaleDateString('es-CL');
        if (cost.is_piece_rate) {
            w.details.push(`${dateStr} - ${cost.description} (${cost.piece_quantity} un. x ${formatCLP(cost.piece_price || 0)}) = ${formatCLP(cost.amount)}`);
        } else {
            w.details.push(`${dateStr} - ${cost.description} = ${formatCLP(cost.amount)}`);
        }
    });

    const tableData: any[] = [];
    let grandTotal = 0;

    workerTotals.forEach(data => {
        tableData.push([{ content: data.name, styles: { fontStyle: 'bold' } }, { content: formatCLP(data.total), styles: { fontStyle: 'bold', halign: 'right' } }]);
        data.details.forEach(detail => {
            tableData.push([{ content: `  • ${detail}`, colSpan: 2, styles: { fontSize: 9, textColor: [100, 100, 100] } }]);
        });
        grandTotal += data.total;
    });

    // Add Grand Total row
    tableData.push([
        { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, 
        { content: formatCLP(grandTotal), styles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 240, 240] } }
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Trabajador / Detalle', 'Monto a Pagar']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }, // indigo-600
      styles: { fontSize: 10 }
    });

    doc.save(`Planilla_Pagos_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
                <Briefcase className="mr-2 h-8 w-8 text-indigo-600" />
                Trabajadores de Planta
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gestión de personal fijo y sus costos</p>
        </div>
        <div className="flex gap-2">
            <button
                onClick={generatePayrollPDF}
                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Download className="mr-2 h-5 w-5" />
                Planilla Pagos PDF
            </button>
            <button
                onClick={() => setShowWorkerForm(!showWorkerForm)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
                <UserPlus className="mr-2 h-5 w-5" />
                Nuevo Trabajador
            </button>
        </div>
      </div>

      {/* New Worker Form Modal/Inline */}
      {showWorkerForm && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-indigo-100">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Agregar Trabajador</h3>
              <form onSubmit={handleCreateWorker} className="flex gap-4 items-end">
                  <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre Completo</label>
                      <input
                          type="text"
                          required
                          value={newWorkerName}
                          onChange={e => setNewWorkerName(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                  </div>
                  <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Cargo / Rol</label>
                      <input
                          type="text"
                          value={newWorkerRole}
                          onChange={e => setNewWorkerRole(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                  </div>
                  <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                      Guardar
                  </button>
                  <button
                      type="button"
                      onClick={() => setShowWorkerForm(false)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                  >
                      Cancelar
                  </button>
              </form>
          </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Cost Registration Form */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4 border-b pb-2">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                    <Users className="h-5 w-5 mr-2 text-indigo-500" />
                    Registrar Costo
                </h3>
                <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Jornal</span>
                    <button
                        type="button"
                        onClick={() => setIsPieceRate(!isPieceRate)}
                        className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isPieceRate ? 'bg-indigo-600' : 'bg-gray-200'}`}
                    >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-800 shadow ring-0 transition duration-200 ease-in-out ${isPieceRate ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                    <span className="text-xs text-indigo-600 font-bold">Trato</span>
                </div>
            </div>

            <form onSubmit={handleSaveCost} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha</label>
                    <input 
                        type="date" 
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                </div>

                {!isPieceRate ? (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Trabajador Fijo</label>
                            <select
                                value={selectedWorkerId}
                                onChange={e => setSelectedWorkerId(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            >
                                <option value="">Seleccione...</option>
                                {workers.map(w => (
                                    <option key={w.id} value={w.id}>{w.name} ({w.role})</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción</label>
                            <input
                                type="text"
                                placeholder="Ej: Sueldo Enero 2026"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del Contratista / Trabajador</label>
                            <input
                                type="text"
                                placeholder="Ej: Cuadrilla Juan Pérez"
                                value={workerName}
                                onChange={e => setWorkerName(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Labor / Tipo de Trato</label>
                            <input
                                type="text"
                                placeholder="Ej: Cosecha de Pera"
                                value={laborType}
                                onChange={e => setLaborType(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Cantidad</label>
                                <input
                                    type="number"
                                    placeholder="Ej: 50"
                                    value={pieceQuantity}
                                    onChange={e => setPieceQuantity(Number(e.target.value))}
                                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Precio x Unidad</label>
                                <input
                                    type="number"
                                    placeholder="Ej: 500"
                                    value={piecePrice}
                                    onChange={e => setPiecePrice(Number(e.target.value))}
                                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>
                        </div>
                    </>
                )}
                
                {/* Distribution Logic */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asignar A</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <button
                            type="button"
                            onClick={() => setDistributeBy('sector')}
                            className={`relative inline-flex items-center px-4 py-2 rounded-l-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'sector'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
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
                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                            }`}
                        >
                            Todo un Campo
                        </button>
                        <button
                            type="button"
                            onClick={() => setDistributeBy('company')}
                            className={`-ml-px relative inline-flex items-center px-4 py-2 rounded-r-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'company'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                            }`}
                        >
                            Empresa General
                        </button>
                    </div>
                </div>

                {distributeBy === 'sector' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sector Destino</label>
                        <select
                            value={selectedSectorId}
                            onChange={e => setSelectedSectorId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="">Seleccione Sector...</option>
                            {sectors.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                ) : distributeBy === 'field' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Campo Destino</label>
                        <select
                            value={selectedFieldId}
                            onChange={e => setSelectedFieldId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="">Seleccione Campo...</option>
                            {fields.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">El costo se distribuirá proporcionalmente por hectárea.</p>
                    </div>
                ) : (
                    <div>
                        <div className="p-2 bg-indigo-50 border border-indigo-200 rounded text-sm text-indigo-700">
                            El costo se distribuirá proporcionalmente entre <strong>TODOS</strong> los campos y sectores de la empresa.
                        </div>
                    </div>
                )}

                {!isPieceRate && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Monto Total (CLP)</label>
                        <div className="mt-1 relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <span className="text-gray-500 dark:text-gray-400 sm:text-sm">$</span>
                            </div>
                            <input
                                type="number"
                                value={amount}
                                onChange={e => setAmount(Number(e.target.value))}
                                className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-7 pr-12 sm:text-sm border-gray-300 dark:border-gray-600 rounded-md"
                                placeholder="0"
                            />
                        </div>
                    </div>
                )}

                <div className="pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Registrar Costo'}
                    </button>
                </div>
            </form>
        </div>

        {/* Right: History Log */}
        <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Historial de Pagos</h3>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        Total Mostrado: {formatCLP(costs.reduce((sum, c) => sum + Number(c.amount), 0))}
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[600px]">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Trabajador</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Descripción</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Sector</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monto</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {costs.map(cost => (
                                <tr key={cost.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {new Date(cost.date + 'T12:00:00').toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {cost.is_piece_rate ? (
                                            <div className="flex flex-col">
                                                <span>{cost.worker_name} <span className="text-xs font-normal text-indigo-600">(Trato)</span></span>
                                            </div>
                                        ) : (
                                            cost.workers?.name
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {cost.description}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {cost.sectors?.name || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100 font-bold">
                                        {formatCLP(cost.amount)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => handleDeleteCost(cost.id)} className="text-red-600 hover:text-red-900">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {costs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">No hay registros de costos.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {/* Workers List Mini */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Personal Registrado</h3>
                </div>
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {workers.map(w => (
                        <li key={w.id} className="px-6 py-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{w.name}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{w.role}</p>
                            </div>
                            <button onClick={() => handleDeleteWorker(w.id)} className="text-gray-400 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {workers.length === 0 && (
                        <li className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">No hay trabajadores registrados.</li>
                    )}
                </ul>
            </div>
        </div>
      </div>
    </div>
  );
};
