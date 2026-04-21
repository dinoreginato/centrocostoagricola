import { toast } from 'sonner';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase/client';
import { useCompany } from '../contexts/CompanyContext';
import { Plus, Trash2, Edit, ChevronDown, ChevronRight, X, Upload } from 'lucide-react';
import { read, utils } from 'xlsx';
import { loadPhytosanitaryProgramsData } from '../services/phytosanitaryPrograms';

interface Program {
  id: string;
  name: string;
  season: string;
  description: string;
}

interface ProgramEvent {
  id: string;
  program_id: string;
  stage_name: string;
  objective: string;
  water_per_ha: number;
}

interface ProgramEventProduct {
  id: string;
  event_id: string;
  product_id: string;
  dose: number;
  dose_unit: string;
  product?: { name: string; unit: string };
}

export const PhytosanitaryPrograms: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [events, setEvents] = useState<ProgramEvent[]>([]);
  const [eventProducts, setEventProducts] = useState<ProgramEventProduct[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);

  // Selection state
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  // Modal states
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Partial<Program>>({});
  
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<ProgramEvent>>({});

  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<ProgramEventProduct>>({ dose_unit: 'L/ha' });
  const [activeEventIdForProduct, setActiveEventIdForProduct] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      if (!selectedCompany) return;
      const res = await loadPhytosanitaryProgramsData({ companyId: selectedCompany.id });
      setPrograms(res.programs || []);
      setEvents(res.events || []);
      setEventProducts(res.eventProducts || []);
      setInventory(res.inventory || []);

    } catch (err: any) {
      console.error(err);
      toast.error('Error cargando programas: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) {
      void loadData();
    }
  }, [selectedCompany, loadData]);

  const toggleEventExpansion = (eventId: string) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId);
    } else {
      newExpanded.add(eventId);
    }
    setExpandedEvents(newExpanded);
  };

  // --- SAVE PROGRAM ---
  const handleSaveProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    try {
      setLoading(true);
      const payload = {
        company_id: selectedCompany.id,
        name: editingProgram.name,
        season: editingProgram.season || '2025-2026',
        description: editingProgram.description
      };

      if (editingProgram.id) {
        const { error } = await supabase.from('phytosanitary_programs').update(payload).eq('id', editingProgram.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('phytosanitary_programs').insert([payload]);
        if (error) throw error;
      }
      setShowProgramModal(false);
      loadData();
    } catch (err: any) {
      toast(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProgram = async (id: string) => {
    if (!confirm('¿Eliminar programa y todos sus eventos?')) return;
    const { error } = await supabase.from('phytosanitary_programs').delete().eq('id', id);
    if (error) toast.error('Error: ' + error.message);
    else loadData();
  };

  // --- SAVE EVENT ---
  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProgram) return;
    try {
      setLoading(true);
      const payload = {
        program_id: selectedProgram.id,
        stage_name: editingEvent.stage_name,
        objective: editingEvent.objective,
        water_per_ha: Number(editingEvent.water_per_ha) || 0
      };

      if (editingEvent.id) {
        const { error } = await supabase.from('program_events').update(payload).eq('id', editingEvent.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('program_events').insert([payload]);
        if (error) throw error;
      }
      setShowEventModal(false);
      loadData();
    } catch (err: any) {
      toast(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('¿Eliminar esta etapa?')) return;
    const { error } = await supabase.from('program_events').delete().eq('id', id);
    if (error) toast.error('Error: ' + error.message);
    else loadData();
  };

  // --- SAVE PRODUCT ---
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const payload = {
        event_id: activeEventIdForProduct,
        product_id: editingProduct.product_id,
        dose: Number(editingProduct.dose),
        dose_unit: editingProduct.dose_unit || 'L/ha'
      };

      if (editingProduct.id) {
        const { error } = await supabase.from('program_event_products').update(payload).eq('id', editingProduct.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('program_event_products').insert([payload]);
        if (error) throw error;
      }
      setShowProductModal(false);
      loadData();
    } catch (err: any) {
      toast(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('¿Eliminar producto de esta etapa?')) return;
    const { error } = await supabase.from('program_event_products').delete().eq('id', id);
    if (error) toast.error('Error: ' + error.message);
    else loadData();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedCompany) return;

      try {
          setLoading(true);
          const data = await file.arrayBuffer();
          const workbook = read(data);
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = utils.sheet_to_json(worksheet);

          if (jsonData.length === 0) {
              toast("El archivo está vacío.");
              return;
          }

          // 1. Create a new Program
          const programName = prompt("Ingrese un nombre para el Programa a importar:", "Programa Importado " + new Date().toLocaleDateString());
          if (!programName) return;

          const { data: progData, error: progErr } = await supabase.from('phytosanitary_programs').insert([{
              company_id: selectedCompany.id,
              name: programName,
              season: '2025-2026',
              description: 'Importado desde Excel'
          }]).select().single();

          if (progErr) throw progErr;
          const newProgramId = progData.id;

          // 2. Process rows (assuming columns: Etapa, Objetivo, Mojamiento, Producto, Dosis, Unidad)
          // We group by 'Etapa'
          const eventsMap = new Map<string, { id: string, items: any[] }>();

          for (const row of jsonData as any[]) {
              const etapa = row['Etapa'] || row['ETAPA'] || row['Stage'] || 'Etapa General';
              const objetivo = row['Objetivo'] || row['OBJETIVO'] || '';
              const mojamiento = parseFloat(row['Mojamiento'] || row['MOJAMIENTO'] || '0');
              
              const prodName = row['Producto'] || row['PRODUCTO'];
              const dosis = parseFloat(row['Dosis'] || row['DOSIS'] || '0');
              const unidad = row['Unidad'] || row['UNIDAD'] || 'L/ha';

              // Create Event if not exists
              if (!eventsMap.has(etapa)) {
                  const { data: evData, error: evErr } = await supabase.from('program_events').insert([{
                      program_id: newProgramId,
                      stage_name: etapa,
                      objective: objetivo,
                      water_per_ha: isNaN(mojamiento) ? 0 : mojamiento
                  }]).select().single();

                  if (evErr) throw evErr;
                  eventsMap.set(etapa, { id: evData.id, items: [] });
              }

              const eventId = eventsMap.get(etapa)!.id;

              // Find product in inventory by name (basic match)
              if (prodName) {
                  const foundProd = inventory.find(p => p.name.toLowerCase().includes(String(prodName).toLowerCase()));
                  
                  if (foundProd) {
                      await supabase.from('program_event_products').insert([{
                          event_id: eventId,
                          product_id: foundProd.id,
                          dose: isNaN(dosis) ? 0 : dosis,
                          dose_unit: unidad
                      }]);
                  } else {
                      console.warn(`Producto no encontrado en bodega: ${prodName}`);
                  }
              }
          }

          toast('Programa importado con éxito. Revise si algunos productos no se enlazaron porque el nombre no coincide exactamente con la bodega.');
          loadData();

      } catch (err: any) {
          console.error(err);
          toast.error('Error importando archivo: ' + err.message);
      } finally {
          setLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Programas Fitosanitarios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Define tus calendarios de aplicación por temporada</p>
        </div>
        <div className="flex gap-2">
          <input
              type="file"
              accept=".xlsx,.xls,.csv"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
          />
          <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 focus:outline-none"
              title="Importar Excel. Columnas: Etapa, Objetivo, Mojamiento, Producto, Dosis, Unidad"
          >
              <Upload className="mr-2 h-4 w-4 text-gray-500 dark:text-gray-400" />
              Importar Excel
          </button>
          <button
            onClick={() => { setEditingProgram({ season: '2025-2026' }); setShowProgramModal(true); }}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Programa
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* LEFT COLUMN: PROGRAMS LIST */}
        <div className="w-1/3 bg-white dark:bg-gray-800 shadow rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-medium mb-4">Tus Programas</h2>
          {programs.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No hay programas creados.</p>
          ) : (
            <ul className="space-y-2">
              {programs.map(prog => (
                <li 
                  key={prog.id}
                  onClick={() => setSelectedProgram(prog)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedProgram?.id === prog.id ? 'bg-green-50 border-green-500' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{prog.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Temp: {prog.season}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); setEditingProgram(prog); setShowProgramModal(true); }} className="text-gray-400 hover:text-indigo-600"><Edit className="h-4 w-4"/></button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteProgram(prog.id); }} className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* RIGHT COLUMN: EVENTS OF SELECTED PROGRAM */}
        <div className="w-2/3 bg-white dark:bg-gray-800 shadow rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          {selectedProgram ? (
            <>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{selectedProgram.name}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedProgram.description}</p>
                </div>
                <button
                  onClick={() => { setEditingEvent({}); setShowEventModal(true); }}
                  className="inline-flex items-center px-3 py-1.5 border border-green-600 rounded-md shadow-sm text-sm font-medium text-green-600 bg-white dark:bg-gray-800 hover:bg-green-50"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Agregar Etapa/Aplicación
                </button>
              </div>

              <div className="space-y-4">
                {events.filter(e => e.program_id === selectedProgram.id).length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No hay etapas en este programa. Haz clic en "Agregar Etapa".</p>
                ) : (
                  events.filter(e => e.program_id === selectedProgram.id).map(ev => {
                    const isExpanded = expandedEvents.has(ev.id);
                    const eProducts = eventProducts.filter(ep => ep.event_id === ev.id);
                    
                    return (
                      <div key={ev.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                        <div 
                          className="bg-gray-50 dark:bg-gray-900 px-4 py-3 flex justify-between items-center cursor-pointer"
                          onClick={() => toggleEventExpansion(ev.id)}
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />}
                            <div>
                              <h4 className="font-semibold text-gray-900 dark:text-gray-100">{ev.stage_name}</h4>
                              <p className="text-xs text-gray-500 dark:text-gray-400">Objetivo: {ev.objective || '-'} | Mojamiento: {ev.water_per_ha} L/ha</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setEditingEvent(ev); setShowEventModal(true); }} className="text-gray-500 dark:text-gray-400 hover:text-indigo-600"><Edit className="h-4 w-4"/></button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteEvent(ev.id); }} className="text-gray-500 dark:text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex justify-between items-center mb-3">
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">Productos a Aplicar</h5>
                              <button
                                onClick={() => { setActiveEventIdForProduct(ev.id); setEditingProduct({ dose_unit: 'L/ha' }); setShowProductModal(true); }}
                                className="text-xs font-medium text-green-600 hover:text-green-800 flex items-center"
                              >
                                <Plus className="h-3 w-3 mr-1" /> Añadir Producto
                              </button>
                            </div>
                            
                            {eProducts.length === 0 ? (
                              <p className="text-xs text-gray-500 dark:text-gray-400 italic">No se han asignado productos.</p>
                            ) : (
                              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead>
                                  <tr>
                                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Producto</th>
                                    <th className="text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Dosis</th>
                                    <th className="text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unidad</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {eProducts.map(ep => (
                                    <tr key={ep.id}>
                                      <td className="py-2 text-sm text-gray-900 dark:text-gray-100">{ep.product?.name}</td>
                                      <td className="py-2 text-sm text-right text-gray-900 dark:text-gray-100">{ep.dose}</td>
                                      <td className="py-2 text-sm text-right text-gray-500 dark:text-gray-400">{ep.dose_unit}</td>
                                      <td className="py-2 text-right">
                                        <button onClick={() => handleDeleteProduct(ep.id)} className="text-red-400 hover:text-red-600 ml-3"><X className="h-4 w-4"/></button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <p className="text-gray-400">Selecciona un programa a la izquierda para ver sus detalles</p>
            </div>
          )}
        </div>
      </div>

      {/* --- MODALS --- */}
      
      {/* Program Modal */}
      {showProgramModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">{editingProgram.id ? 'Editar Programa' : 'Nuevo Programa'}</h3>
            <form onSubmit={handleSaveProgram} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del Programa</label>
                <input required type="text" value={editingProgram.name || ''} onChange={e => setEditingProgram({...editingProgram, name: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" placeholder="Ej: Programa Cerezos Base" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Temporada</label>
                <input required type="text" value={editingProgram.season || ''} onChange={e => setEditingProgram({...editingProgram, season: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" placeholder="2025-2026" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción (Opcional)</label>
                <textarea value={editingProgram.description || ''} onChange={e => setEditingProgram({...editingProgram, description: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" rows={2} />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowProgramModal(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">Cancelar</button>
                <button type="submit" disabled={loading} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">{editingEvent.id ? 'Editar Etapa' : 'Nueva Etapa de Aplicación'}</h3>
            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre de la Etapa</label>
                <input required type="text" value={editingEvent.stage_name || ''} onChange={e => setEditingEvent({...editingEvent, stage_name: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" placeholder="Ej: Botón Rosado, Plena Flor, etc." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Objetivo Principal</label>
                <input required type="text" value={editingEvent.objective || ''} onChange={e => setEditingEvent({...editingEvent, objective: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" placeholder="Ej: Control Polilla, Nutrición" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mojamiento (L/ha) Recomendado</label>
                <input required type="number" value={editingEvent.water_per_ha || ''} onChange={e => setEditingEvent({...editingEvent, water_per_ha: Number(e.target.value)})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowEventModal(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">Cancelar</button>
                <button type="submit" disabled={loading} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Añadir Producto a la Etapa</h3>
            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Producto (Bodega)</label>
                <select required value={editingProduct.product_id || ''} onChange={e => setEditingProduct({...editingProduct, product_id: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm">
                  <option value="">Seleccione producto...</option>
                  {inventory.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Dosis</label>
                  <input required type="number" step="0.01" value={editingProduct.dose || ''} onChange={e => setEditingProduct({...editingProduct, dose: Number(e.target.value)})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Unidad de Dosis</label>
                  <select required value={editingProduct.dose_unit || 'L/ha'} onChange={e => setEditingProduct({...editingProduct, dose_unit: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm">
                    <option value="L/ha">L/ha</option>
                    <option value="Kg/ha">Kg/ha</option>
                    <option value="cc/100L">cc/100L</option>
                    <option value="g/100L">g/100L</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowProductModal(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">Cancelar</button>
                <button type="submit" disabled={loading} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
