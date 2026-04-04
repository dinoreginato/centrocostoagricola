import { toast } from 'sonner';
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Map, MapPin, ChevronDown, ChevronRight, Loader2, Edit2, X, Check, Trash2, DollarSign } from 'lucide-react';

interface Sector {
  id: string;
  name: string;
  hectares: number;
  budget?: number;
  total_labor_cost?: number;
}

interface Field {
  id: string;
  name: string;
  total_hectares: number;
  fruit_type: string;
  sectors?: Sector[];
}

export const Fields: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);

  // Form states
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldHectares, setNewFieldHectares] = useState('');
  const [newFieldFruit, setNewFieldFruit] = useState('');
  
  const [showSectorForm, setShowSectorForm] = useState<string | null>(null); // Field ID
  const [newSectorName, setNewSectorName] = useState('');
  const [newSectorHectares, setNewSectorHectares] = useState('');
  const [newSectorBudget, setNewSectorBudget] = useState('');

  // Edit Field states
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldName, setEditFieldName] = useState('');
  const [editFieldHectares, setEditFieldHectares] = useState('');
  const [editFieldFruit, setEditFieldFruit] = useState('');

  // Edit Sector states
  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [editSectorName, setEditSectorName] = useState('');
  const [editSectorHectares, setEditSectorHectares] = useState('');
  const [editSectorBudget, setEditSectorBudget] = useState('');

  useEffect(() => {
    if (selectedCompany) {
      loadFields();
    }
  }, [selectedCompany]);

  const loadFields = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // 1. Fetch Fields and Sectors
      const { data: fieldsData, error: fieldsError } = await supabase
        .from('fields')
        .select('*, sectors(*)')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false });

      if (fieldsError) throw fieldsError;

      // 2. Fetch Labor Costs for these sectors
      const allSectors = fieldsData?.flatMap(f => f.sectors || []) || [];
      const sectorIds = allSectors.map(s => s.id);

      let laborMap: Record<string, number> = {};

      if (sectorIds.length > 0) {
        const { data: laborData, error: laborError } = await supabase
          .from('labor_assignments')
          .select('sector_id, assigned_amount')
          .in('sector_id', sectorIds);
        
        if (laborError) {
             console.error('Error loading labor costs:', laborError);
        } else {
             laborData?.forEach(item => {
                 laborMap[item.sector_id] = (laborMap[item.sector_id] || 0) + Number(item.assigned_amount);
             });
        }
      }

      // 3. Merge data
      const fieldsWithCosts = fieldsData?.map(field => ({
          ...field,
          sectors: field.sectors?.map(sector => ({
              ...sector,
              total_labor_cost: laborMap[sector.id] || 0
          }))
      }));

      setFields(fieldsWithCosts || []);
    } catch (error) {
      console.error('Error loading fields:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;

    try {
      const { data, error } = await supabase
        .from('fields')
        .insert([{
          company_id: selectedCompany.id,
          name: newFieldName,
          total_hectares: parseFloat(newFieldHectares),
          fruit_type: newFieldFruit
        }])
        .select()
        .single();

      if (error) throw error;

      setFields([data, ...fields]);
      setShowFieldForm(false);
      setNewFieldName('');
      setNewFieldHectares('');
      setNewFieldFruit('');
    } catch (error) {
      console.error('Error creating field:', error);
    }
  };

  const startEditingField = (field: Field) => {
    setEditingFieldId(field.id);
    setEditFieldName(field.name);
    setEditFieldHectares(field.total_hectares.toString());
    setEditFieldFruit(field.fruit_type);
  };

  const cancelEditingField = () => {
    setEditingFieldId(null);
    setEditFieldName('');
    setEditFieldHectares('');
    setEditFieldFruit('');
  };

  const handleUpdateField = async (e: React.FormEvent, fieldId: string) => {
    e.preventDefault();
    try {
      const { data, error } = await supabase
        .from('fields')
        .update({
          name: editFieldName,
          total_hectares: parseFloat(editFieldHectares),
          fruit_type: editFieldFruit
        })
        .eq('id', fieldId)
        .select()
        .single();

      if (error) throw error;

      setFields(fields.map(f => f.id === fieldId ? { ...f, ...data, sectors: f.sectors } : f));
      cancelEditingField();
    } catch (error) {
      console.error('Error updating field:', error);
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este campo? Se eliminarán también todos sus sectores.')) return;

    try {
      const { error } = await supabase
        .from('fields')
        .delete()
        .eq('id', fieldId);

      if (error) throw error;

      setFields(fields.filter(f => f.id !== fieldId));
    } catch (error) {
      console.error('Error deleting field:', error);
      toast.error('Error al eliminar el campo. Asegúrate de no tener registros asociados importantes.');
    }
  };

  // --- SECTOR MANAGEMENT ---

  const handleCreateSector = async (e: React.FormEvent, fieldId: string) => {
    e.preventDefault();
    try {
      const { data, error } = await supabase
        .from('sectors')
        .insert([{
          field_id: fieldId,
          name: newSectorName,
          hectares: parseFloat(newSectorHectares),
          budget: newSectorBudget ? parseFloat(newSectorBudget) : 0
        }])
        .select()
        .single();

      if (error) throw error;

      setFields(fields.map(f => {
        if (f.id === fieldId) {
          return {
            ...f,
            sectors: [...(f.sectors || []), data]
          };
        }
        return f;
      }));

      setShowSectorForm(null);
      setNewSectorName('');
      setNewSectorHectares('');
      setNewSectorBudget('');
    } catch (error) {
      console.error('Error creating sector:', error);
    }
  };

  const startEditingSector = (sector: Sector) => {
    setEditingSectorId(sector.id);
    setEditSectorName(sector.name);
    setEditSectorHectares(sector.hectares.toString());
    setEditSectorBudget(sector.budget ? sector.budget.toString() : '');
  };

  const cancelEditingSector = () => {
    setEditingSectorId(null);
    setEditSectorName('');
    setEditSectorHectares('');
    setEditSectorBudget('');
  };

  const handleUpdateSector = async (e: React.FormEvent, sectorId: string, fieldId: string) => {
    e.preventDefault();
    try {
      const { data, error } = await supabase
        .from('sectors')
        .update({
          name: editSectorName,
          hectares: parseFloat(editSectorHectares),
          budget: editSectorBudget ? parseFloat(editSectorBudget) : 0
        })
        .eq('id', sectorId)
        .select()
        .single();

      if (error) throw error;

      setFields(fields.map(f => {
        if (f.id === fieldId) {
          return {
            ...f,
            sectors: f.sectors?.map(s => s.id === sectorId ? data : s)
          };
        }
        return f;
      }));
      cancelEditingSector();
    } catch (error) {
      console.error('Error updating sector:', error);
    }
  };

  const handleDeleteSector = async (sectorId: string, fieldId: string) => {
    if (!window.confirm('¿Eliminar este sector?')) return;

    try {
      const { error } = await supabase
        .from('sectors')
        .delete()
        .eq('id', sectorId);

      if (error) throw error;

      setFields(fields.map(f => {
        if (f.id === fieldId) {
          return {
            ...f,
            sectors: f.sectors?.filter(s => s.id !== sectorId)
          };
        }
        return f;
      }));
    } catch (error) {
      console.error('Error deleting sector:', error);
    }
  };

  if (!selectedCompany) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Selecciona una empresa para gestionar sus campos.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestión de Campos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Administra tus campos, sectores y cultivos</p>
        </div>
        {userRole !== 'viewer' && (
          <button
            onClick={() => setShowFieldForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"
          >
            <Plus className="mr-2 h-4 w-4" /> Nuevo Campo
          </button>
        )}
      </div>

      {/* Create Field Form */}
      {showFieldForm && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Agregar Nuevo Campo</h3>
          <form onSubmit={handleCreateField} className="grid grid-cols-1 gap-6 sm:grid-cols-4">
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del Campo</label>
              <input
                type="text"
                required
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Hectáreas Totales</label>
              <input
                type="number"
                step="0.01"
                required
                value={newFieldHectares}
                onChange={e => setNewFieldHectares(e.target.value)}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Frutal</label>
              <input
                type="text"
                required
                value={newFieldFruit}
                onChange={e => setNewFieldFruit(e.target.value)}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1 flex items-end space-x-2">
              <button
                type="submit"
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setShowFieldForm(false)}
                className="flex-1 bg-gray-200 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-md hover:bg-gray-300"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Fields List */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="animate-spin h-8 w-8 text-green-600" />
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
          <Map className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No hay campos registrados</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Comienza agregando tu primer campo.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {fields.map((field) => (
              <li key={field.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition duration-150 ease-in-out">
                  {editingFieldId === field.id ? (
                    <form onSubmit={(e) => handleUpdateField(e, field.id)} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                        <input
                          type="text"
                          value={editFieldName}
                          onChange={(e) => setEditFieldName(e.target.value)}
                          className="block w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Nombre del Campo"
                          required
                        />
                         <input
                          type="text"
                          value={editFieldFruit}
                          onChange={(e) => setEditFieldFruit(e.target.value)}
                          className="block w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Tipo de Frutal"
                          required
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={editFieldHectares}
                          onChange={(e) => setEditFieldHectares(e.target.value)}
                          className="block w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Hectáreas"
                          required
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="submit"
                          className="p-1 text-green-600 hover:bg-green-100 rounded-full"
                          title="Guardar cambios"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditingField}
                          className="p-1 text-red-600 hover:bg-red-100 rounded-full"
                          title="Cancelar"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center flex-1 cursor-pointer" onClick={() => setExpandedFieldId(expandedFieldId === field.id ? null : field.id)}>
                        {expandedFieldId === field.id ? (
                          <ChevronDown className="h-5 w-5 text-gray-400 mr-2" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-gray-400 mr-2" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-green-600 truncate">{field.name}</div>
                          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                            <span className="truncate">{field.fruit_type}</span>
                            <span className="mx-2">•</span>
                            <span>{field.total_hectares} ha</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
                          {field.sectors?.length || 0} sectores
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => startEditingField(field)}
                            className="text-gray-400 hover:text-green-600 transition-colors"
                            title="Editar campo"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteField(field.id)}
                            className="text-gray-400 hover:text-red-600 transition-colors"
                            title="Eliminar campo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sectors Expansion */}
                  {expandedFieldId === field.id && !editingFieldId && (
                    <div className="mt-4 ml-8 border-l-2 border-gray-200 dark:border-gray-700 pl-4">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Sectores</h4>
                      
                      <ul className="space-y-3 mb-4">
                        {field.sectors?.map((sector) => (
                          <li key={sector.id} className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 group">
                            {editingSectorId === sector.id ? (
                              <form onSubmit={(e) => handleUpdateSector(e, sector.id, field.id)} className="flex items-center space-x-3 w-full">
                                <input
                                  type="text"
                                  value={editSectorName}
                                  onChange={(e) => setEditSectorName(e.target.value)}
                                  className="block w-40 border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm"
                                  placeholder="Nombre"
                                  required
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editSectorHectares}
                                  onChange={(e) => setEditSectorHectares(e.target.value)}
                                  className="block w-24 border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm"
                                  placeholder="Has"
                                  required
                                />
                                <input
                                  type="number"
                                  value={editSectorBudget}
                                  onChange={(e) => setEditSectorBudget(e.target.value)}
                                  className="block w-32 border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm"
                                  placeholder="Ppto/Ha ($)"
                                />
                                <button
                                  type="submit"
                                  className="text-green-600 hover:text-green-800"
                                  title="Guardar"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditingSector}
                                  className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
                                  title="Cancelar"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </form>
                            ) : (
                              <>
                                <div className="flex items-center flex-1">
                                  <MapPin className="h-4 w-4 text-gray-400 mr-2" />
                                  <span className="font-medium mr-2">{sector.name}</span>
                                  <span className="text-gray-400 mr-6">({sector.hectares} ha)</span>
                                  
                                  {sector.budget > 0 && (
                                    <div className="hidden sm:flex items-center mr-6 text-sm">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-gray-400 font-bold">Ppto / Ha</span>
                                        <span className="font-medium text-blue-600">{formatCLP(sector.budget)}</span>
                                      </div>
                                    </div>
                                  )}

                                  {(sector.total_labor_cost || 0) > 0 && (
                                    <div className="hidden sm:flex items-center space-x-6 text-sm">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase text-gray-400 font-bold">Mano de Obra</span>
                                            <span className="font-medium text-green-600">{formatCLP(sector.total_labor_cost || 0)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase text-gray-400 font-bold">Costo / Ha</span>
                                            <span className="font-medium text-gray-700 dark:text-gray-300">{formatCLP((sector.total_labor_cost || 0) / (sector.hectares || 1))}</span>
                                        </div>
                                    </div>
                                  )}
                                </div>
                                {userRole !== 'viewer' && (
                                  <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => startEditingSector(sector)}
                                      className="text-gray-400 hover:text-green-600"
                                      title="Editar sector"
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSector(sector.id, field.id)}
                                      className="text-gray-400 hover:text-red-600"
                                      title="Eliminar sector"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>

                      {userRole !== 'viewer' && (
                        showSectorForm === field.id ? (
                          <form onSubmit={(e) => handleCreateSector(e, field.id)} className="flex items-center space-x-3 mt-2">
                            <input
                              type="text"
                              placeholder="Nombre Sector"
                              required
                              value={newSectorName}
                              onChange={e => setNewSectorName(e.target.value)}
                              className="block w-40 border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm"
                            />
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Has"
                              required
                              value={newSectorHectares}
                              onChange={e => setNewSectorHectares(e.target.value)}
                              className="block w-24 border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm"
                            />
                            <input
                              type="number"
                              placeholder="Ppto/Ha ($)"
                              value={newSectorBudget}
                              onChange={e => setNewSectorBudget(e.target.value)}
                              className="block w-32 border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-1 px-2 text-sm"
                            />
                            <button
                              type="submit"
                              className="text-green-600 hover:text-green-800 text-sm font-medium"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowSectorForm(null)}
                              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 text-sm"
                            >
                              Cancelar
                            </button>
                          </form>
                        ) : (
                          <button
                            onClick={() => setShowSectorForm(field.id)}
                            className="flex items-center text-sm text-green-600 hover:text-green-800"
                          >
                            <Plus className="h-4 w-4 mr-1" /> Agregar Sector
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
