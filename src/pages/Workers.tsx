import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Users, UserPlus, Trash2, Briefcase, Plus, Loader2 } from 'lucide-react';

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

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    setLoading(true);
    try {
        await Promise.all([
            loadWorkers(),
            loadSectorsAndFields(),
            loadCosts()
        ]);
    } catch (error) {
        console.error('Error loading data:', error);
    } finally {
        setLoading(false);
    }
  };

  const loadWorkers = async () => {
      if (!selectedCompany) return;
      const { data } = await supabase
          .from('workers')
          .select('*')
          .eq('company_id', selectedCompany.id)
          .order('name');
      setWorkers(data || []);
  };

  const loadSectorsAndFields = async () => {
    if (!selectedCompany) return;
    
    const { data: fieldsData } = await supabase
        .from('fields')
        .select('*')
        .eq('company_id', selectedCompany.id);
    setFields(fieldsData || []);

    const { data: sectorsData } = await supabase
        .from('sectors')
        .select('id, name, hectares, field_id, fields!inner(company_id)')
        .eq('fields.company_id', selectedCompany.id);
    
    setSectors(sectorsData || []);
  };

  const loadCosts = async () => {
      if (!selectedCompany) return;
      const { data } = await supabase
          .from('worker_costs')
          .select('*, workers(name), sectors(name)')
          .eq('company_id', selectedCompany.id)
          .order('date', { ascending: false });
      setCosts(data || []);
  };

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
          alert('Error: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleDeleteWorker = async (id: string) => {
      if (!confirm('¿Eliminar trabajador? Se borrarán sus registros de costos.')) return;
      const { error } = await supabase.from('workers').delete().eq('id', id);
      if (error) alert('Error al eliminar');
      else loadWorkers();
  };

  const handleSaveCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany || !amount || !selectedWorkerId || !description) {
        alert('Complete todos los campos obligatorios');
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
        const totalAmount = Number(amount);
        
        if (distributeBy === 'company') {
            // Distribute by Company (All Fields)
            const allSectors = sectors;
            const totalHa = allSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            
            if (totalHa === 0) {
                alert('La empresa no tiene hectáreas definidas en ningún sector.');
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
                    worker_id: selectedWorkerId,
                    date,
                    description,
                    amount: totalAmount,
                    sector_id: selectedSectorId
                });

            if (error) throw error;
        }

        // Reset form partial
        setAmount('');
        setDescription('');
        
        // Reload
        await loadCosts();
        alert('Costo registrado exitosamente');

    } catch (error: any) {
        console.error('Error saving cost:', error);
        alert('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteCost = async (id: string) => {
      if (!confirm('¿Eliminar este registro de costo?')) return;
      const { error } = await supabase.from('worker_costs').delete().eq('id', id);
      if (error) alert('Error al eliminar');
      else loadCosts();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <Briefcase className="mr-2 h-8 w-8 text-indigo-600" />
                Trabajadores de Planta
            </h1>
            <p className="text-sm text-gray-500">Gestión de personal fijo y sus costos</p>
        </div>
        <button
            onClick={() => setShowWorkerForm(!showWorkerForm)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
        >
            <UserPlus className="mr-2 h-5 w-5" />
            Nuevo Trabajador
        </button>
      </div>

      {/* New Worker Form Modal/Inline */}
      {showWorkerForm && (
          <div className="bg-white p-6 rounded-lg shadow border border-indigo-100">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Agregar Trabajador</h3>
              <form onSubmit={handleCreateWorker} className="flex gap-4 items-end">
                  <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Nombre Completo</label>
                      <input
                          type="text"
                          required
                          value={newWorkerName}
                          onChange={e => setNewWorkerName(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                  </div>
                  <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Cargo / Rol</label>
                      <input
                          type="text"
                          value={newWorkerRole}
                          onChange={e => setNewWorkerRole(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
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
                      className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                      Cancelar
                  </button>
              </form>
          </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Cost Registration Form */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Users className="h-5 w-5 mr-2 text-indigo-500" />
                Registrar Costo (Sueldo/Bono)
            </h3>
            <form onSubmit={handleSaveCost} className="space-y-4">
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
                    <label className="block text-sm font-medium text-gray-700">Trabajador</label>
                    <select
                        value={selectedWorkerId}
                        onChange={e => setSelectedWorkerId(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    >
                        <option value="">Seleccione...</option>
                        {workers.map(w => (
                            <option key={w.id} value={w.id}>{w.name} ({w.role})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Descripción</label>
                    <input
                        type="text"
                        placeholder="Ej: Sueldo Enero 2026"
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                </div>
                
                {/* Distribution Logic */}
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
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            Empresa General
                        </button>
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
                        <p className="mt-1 text-xs text-gray-500">El costo se distribuirá proporcionalmente por hectárea.</p>
                    </div>
                ) : (
                    <div>
                        <div className="p-2 bg-indigo-50 border border-indigo-200 rounded text-sm text-indigo-700">
                            El costo se distribuirá proporcionalmente entre <strong>TODOS</strong> los campos y sectores de la empresa.
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-gray-700">Monto Total (CLP)</label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-gray-500 sm:text-sm">$</span>
                        </div>
                        <input
                            type="number"
                            value={amount}
                            onChange={e => setAmount(Number(e.target.value))}
                            className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-7 pr-12 sm:text-sm border-gray-300 rounded-md"
                            placeholder="0"
                        />
                    </div>
                </div>

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
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gray-900">Historial de Pagos</h3>
                    <div className="text-sm text-gray-500">
                        Total Mostrado: {formatCLP(costs.reduce((sum, c) => sum + Number(c.amount), 0))}
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[600px]">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trabajador</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Descripción</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sector</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {costs.map(cost => (
                                <tr key={cost.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(cost.date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {cost.workers?.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {cost.description}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {cost.sectors?.name || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-bold">
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
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No hay registros de costos.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {/* Workers List Mini */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700">Personal Registrado</h3>
                </div>
                <ul className="divide-y divide-gray-200">
                    {workers.map(w => (
                        <li key={w.id} className="px-6 py-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900">{w.name}</p>
                                <p className="text-sm text-gray-500">{w.role}</p>
                            </div>
                            <button onClick={() => handleDeleteWorker(w.id)} className="text-gray-400 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {workers.length === 0 && (
                        <li className="px-6 py-4 text-sm text-gray-500 text-center">No hay trabajadores registrados.</li>
                    )}
                </ul>
            </div>
        </div>
      </div>
    </div>
  );
};
