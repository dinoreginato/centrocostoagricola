import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Loader2, Save, Trash2, Beaker, Calendar, Droplets, MapPin, RefreshCw } from 'lucide-react';

interface Field {
  id: string;
  name: string;
  sectors: Sector[];
}

interface Sector {
  id: string;
  name: string;
  hectares: number;
}

interface Product {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  average_cost: number;
  category: string;
}

interface ApplicationItem {
  product_id: string;
  product_name: string;
  quantity_used: number; // In product units (e.g. L)
  dose_per_hectare: number; // Final dose per hectare
  dose_input_value: number; // What the user typed
  dose_input_type: 'ha' | 'hl'; // How it was entered
  dose_unit: string; // Unit selected by user (e.g. cc)
  unit_cost: number;
  total_cost: number;
  unit: string; // Product unit
}

interface ApplicationHistory {
  id: string;
  application_date: string;
  application_type: string;
  total_cost: number;
  water_liters_per_hectare: number;
  field: { name: string };
  sector: { name: string; hectares: number };
  application_items: {
    quantity_used: number;
    dose_per_hectare: number;
    total_cost: number;
    product: { name: string; unit: string };
  }[];
}

const AGROCHEMICAL_CATEGORIES = [
  'Quimicos', 
  'Plaguicida', 
  'Insecticida', 
  'Fungicida', 
  'Herbicida', 
  'Fertilizantes', 
  'fertilizante', 
  'pesticida', 
  'herbicida', 
  'fungicida'
];

// Helper to normalize units for comparison
const normalizeUnit = (u: string) => {
  const lower = u.toLowerCase().trim();
  if (['l', 'lt', 'litro', 'litros'].includes(lower)) return 'l';
  if (['cc', 'ml', 'cm3'].includes(lower)) return 'cc';
  if (['kg', 'kgs', 'kilo', 'kilos'].includes(lower)) return 'kg';
  if (['gr', 'grs', 'g', 'gramo', 'gramos'].includes(lower)) return 'gr';
  return lower;
};

const getConversionFactor = (fromUnit: string, toUnit: string): number => {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);

  if (from === to) return 1;

  // Volume: cc -> L
  if (from === 'cc' && to === 'l') return 0.001;
  // Volume: L -> cc
  if (from === 'l' && to === 'cc') return 1000;

  // Weight: gr -> Kg
  if (from === 'gr' && to === 'kg') return 0.001;
  // Weight: Kg -> gr
  if (from === 'kg' && to === 'gr') return 1000;

  return 1; // Fallback
};

export const Applications: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [applications, setApplications] = useState<ApplicationHistory[]>([]);
  
  // Application Form State
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [applicationDate, setApplicationDate] = useState(new Date().toISOString().split('T')[0]);
  const [applicationType, setApplicationType] = useState('fertilizacion');
  const [waterVolumePerHectare, setWaterVolumePerHectare] = useState<number>(0); 
  const [items, setItems] = useState<ApplicationItem[]>([]);

  // Item Form State
  const [currentItem, setCurrentItem] = useState<{
    product_id: string;
    quantity: number; // Calculated total quantity in product units
    dose_input_value: number;
    dose_input_type: 'ha' | 'hl';
    dose_unit: string;
  }>({
    product_id: '',
    quantity: 0,
    dose_input_value: 0,
    dose_input_type: 'ha',
    dose_unit: ''
  });

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  // Update dose unit when product changes
  useEffect(() => {
    if (currentItem.product_id) {
      const product = products.find(p => p.id === currentItem.product_id);
      if (product) {
        // Default to product unit, but if it's L allow cc, if Kg allow gr
        const base = normalizeUnit(product.unit);
        setCurrentItem(prev => ({ ...prev, dose_unit: product.unit })); // Default to product unit
      }
    }
  }, [currentItem.product_id, products]);

  // Recalculate quantity when dose inputs, water volume or sector changes
  useEffect(() => {
    if (selectedFieldId && selectedSectorId && currentItem.dose_input_value > 0 && currentItem.product_id) {
      const field = fields.find(f => f.id === selectedFieldId);
      const sector = field?.sectors.find(s => s.id === selectedSectorId);
      const product = products.find(p => p.id === currentItem.product_id);
      
      if (sector && product) {
        const unitFactor = getConversionFactor(currentItem.dose_unit, product.unit);
        let dosePerHectareInProductUnit = 0;

        if (currentItem.dose_input_type === 'ha') {
            // Dosis/Ha entered directly
            dosePerHectareInProductUnit = currentItem.dose_input_value * unitFactor;
        } else {
            // Dosis/hL (Concentration)
            if (waterVolumePerHectare > 0) {
                 dosePerHectareInProductUnit = (currentItem.dose_input_value * unitFactor / 100) * waterVolumePerHectare;
            } else {
                dosePerHectareInProductUnit = 0; // Cannot calculate without water volume
            }
        }
        
        // Total = DosePerHa * Hectares
        const calculatedQuantity = dosePerHectareInProductUnit * sector.hectares;
        setCurrentItem(prev => ({ ...prev, quantity: Number(calculatedQuantity.toFixed(4)) }));
      }
    } else {
        // Reset calculation if inputs invalid
        if (currentItem.quantity !== 0) setCurrentItem(prev => ({ ...prev, quantity: 0 }));
    }
  }, [
    currentItem.dose_input_value, 
    currentItem.dose_input_type, 
    currentItem.dose_unit, 
    currentItem.product_id, 
    selectedSectorId, 
    selectedFieldId, 
    waterVolumePerHectare, 
    fields, 
    products
  ]);

  const loadData = async () => {
    if (!selectedCompany) return;
    
    // Load fields with sectors
    const { data: fieldsData } = await supabase
      .from('fields')
      .select('*, sectors(*)')
      .eq('company_id', selectedCompany.id);
    setFields(fieldsData || []);

    // Load products - Filter for Agrochemicals
    const { data: productsData } = await supabase
      .from('products')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .in('category', AGROCHEMICAL_CATEGORIES) // Filter by category
      .gt('current_stock', 0);
    setProducts(productsData || []);

    // Load Applications History
    const { data: appsData, error: appsError } = await supabase
        .from('applications')
        .select(`
            *,
            field!inner (name, company_id),
            sector (name, hectares),
            application_items (
                quantity_used,
                dose_per_hectare,
                total_cost,
                product (name, unit)
            )
        `)
        .eq('field.company_id', selectedCompany.id)
        .order('application_date', { ascending: false });
    
    if (appsError) {
        console.error('Error loading applications:', appsError);
    } else {
        setApplications(appsData || []);
    }
  };

  const handleAddItem = () => {
    const product = products.find(p => p.id === currentItem.product_id);
    if (!product || currentItem.quantity <= 0) return;

    if (currentItem.dose_input_type === 'hl' && waterVolumePerHectare <= 0) {
        alert('Debe ingresar el Mojamiento (Volumen de agua) para calcular la dosis por concentración.');
        return;
    }

    if (currentItem.quantity > product.current_stock) {
      alert(`Stock insuficiente. Disponible: ${product.current_stock} ${product.unit}`);
      return;
    }

    // Calculate final dose per hectare for storage
    // Quantity / Hectares
    const selectedField = fields.find(f => f.id === selectedFieldId);
    const selectedSector = selectedField?.sectors.find(s => s.id === selectedSectorId);
    const dosePerHectare = selectedSector ? currentItem.quantity / selectedSector.hectares : 0;

    const newItem: ApplicationItem = {
      product_id: product.id,
      product_name: product.name,
      quantity_used: currentItem.quantity,
      dose_per_hectare: Number(dosePerHectare.toFixed(4)), // Normalized dose/ha
      dose_input_value: currentItem.dose_input_value,
      dose_input_type: currentItem.dose_input_type,
      dose_unit: currentItem.dose_unit,
      unit_cost: product.average_cost,
      total_cost: currentItem.quantity * product.average_cost,
      unit: product.unit
    };

    setItems([...items, newItem]);
    setCurrentItem({ product_id: '', quantity: 0, dose_input_value: 0, dose_input_type: 'ha', dose_unit: '' });
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleDeleteApplication = async (id: string) => {
    if (!window.confirm('¿Estás seguro de eliminar esta aplicación?\n\n¡Cuidado! El stock descontado será RESTAURADO a la bodega.')) return;
    
    try {
        const { error } = await supabase.rpc('delete_application_and_restore_stock', { target_application_id: id });
        if (error) throw error;
        alert('Aplicación eliminada y stock restaurado exitosamente.');
        loadData();
    } catch (error: any) {
        console.error('Error deleting application:', error);
        alert('Error al eliminar: ' + error.message);
    }
  };

  const handleDeleteAllApplications = async () => {
    if (!selectedCompany) return;
    if (!window.confirm('¿ESTÁS SEGURO DE ELIMINAR TODAS LAS APLICACIONES?\n\nEsta acción borrará todo el historial de aplicaciones y RESTAURARÁ el stock de los productos a la bodega.\n\nEs ideal para empezar de cero si has estado haciendo pruebas.')) return;
    
    setLoading(true);
    try {
        const { error } = await supabase.rpc('delete_all_applications_restore_stock', { target_company_id: selectedCompany.id });
        if (error) throw error;
        alert('Todas las aplicaciones han sido eliminadas y el stock restaurado.');
        loadData();
    } catch (error: any) {
        console.error('Error deleting all applications:', error);
        alert('Error al eliminar todo: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFieldId || !selectedSectorId || items.length === 0) return;

    setLoading(true);
    try {
      // 1. Create Application
      const totalCost = items.reduce((sum, item) => sum + item.total_cost, 0);
      
      const { data: application, error: appError } = await supabase
        .from('applications')
        .insert([{
          field_id: selectedFieldId,
          sector_id: selectedSectorId,
          application_date: applicationDate,
          application_type: applicationType,
          total_cost: totalCost,
          water_liters_per_hectare: waterVolumePerHectare
        }])
        .select()
        .single();

      if (appError) throw appError;

      // 2. Process Items and Deduct Stock
      for (const item of items) {
        // Create Application Item
        const { data: savedItem, error: itemError } = await supabase
          .from('application_items')
          .insert([{
            application_id: application.id,
            product_id: item.product_id,
            quantity_used: item.quantity_used,
            dose_per_hectare: item.dose_per_hectare, 
            unit_cost: item.unit_cost,
            total_cost: item.total_cost
          }])
          .select()
          .single();

        if (itemError) throw itemError;

        // Deduct Stock
        const product = products.find(p => p.id === item.product_id);
        if (product) {
            const newStock = product.current_stock - item.quantity_used;
            await supabase
                .from('products')
                .update({ current_stock: newStock })
                .eq('id', item.product_id);
            
            // Record Inventory Movement (Salida) linked to Application Item
            await supabase
                .from('inventory_movements')
                .insert([{
                    product_id: item.product_id,
                    movement_type: 'salida',
                    quantity: item.quantity_used,
                    unit_cost: item.unit_cost,
                    application_item_id: savedItem.id // LINK TO APPLICATION
                }]);
        }
      }

      alert('Aplicación registrada exitosamente');
      setItems([]);
      setSelectedFieldId('');
      setSelectedSectorId('');
      setWaterVolumePerHectare(0);
      loadData(); 

    } catch (error: any) {
      console.error('Error saving application:', error);
      alert('Error al guardar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  const selectedField = fields.find(f => f.id === selectedFieldId);
  const selectedSector = selectedField?.sectors.find(s => s.id === selectedSectorId);

  // Helper to get compatible units based on product unit
  const getCompatibleUnits = (productUnit: string) => {
    const base = normalizeUnit(productUnit);
    if (base === 'l' || base === 'cc') return ['L', 'cc'];
    if (base === 'kg' || base === 'gr') return ['Kg', 'gr'];
    return [productUnit];
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Libro de Aplicaciones</h1>
        {applications.length > 0 && (
            <button
                onClick={handleDeleteAllApplications}
                className="inline-flex items-center px-4 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50"
            >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reiniciar / Borrar Todo
            </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Nueva Aplicación</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Application Header */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Campo</label>
              <select
                required
                value={selectedFieldId}
                onChange={e => {
                    setSelectedFieldId(e.target.value);
                    setSelectedSectorId('');
                }}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="">Seleccionar Campo...</option>
                {fields.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Sector</label>
              <select
                required
                value={selectedSectorId}
                disabled={!selectedFieldId}
                onChange={e => setSelectedSectorId(e.target.value)}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="">Seleccionar Sector...</option>
                {selectedField?.sectors?.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Fecha</label>
              <input
                type="date"
                required
                value={applicationDate}
                onChange={e => setApplicationDate(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Tipo</label>
              <select
                value={applicationType}
                onChange={e => setApplicationType(e.target.value)}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="fertilizacion">Fertilización</option>
                <option value="fitosanitario">Fitosanitario</option>
                <option value="riego">Riego</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Mojamiento (L/ha)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={waterVolumePerHectare}
                onChange={e => setWaterVolumePerHectare(Number(e.target.value))}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                placeholder="0"
              />
              {selectedSector && waterVolumePerHectare > 0 && (
                <span className="text-xs text-gray-500">
                   Total agua: {(waterVolumePerHectare * selectedSector.hectares).toFixed(0)} L
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-sm font-medium text-gray-900 mb-4">Productos a Aplicar</h3>
            
            {/* Add Item Row */}
            <div className="flex flex-col gap-4 bg-gray-50 p-4 rounded-md">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-500">Producto (Stock Disponible)</label>
                    <select
                      value={currentItem.product_id}
                      onChange={e => setCurrentItem({...currentItem, product_id: e.target.value})}
                      className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    >
                      <option value="">Seleccionar...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.current_stock} {p.unit}) - ${p.average_cost.toFixed(0)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Mode Toggle */}
                  <div className="w-40">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de Dosis</label>
                      <div className="flex bg-white rounded-md border border-gray-300 p-0.5">
                          <button
                              type="button"
                              onClick={() => setCurrentItem({...currentItem, dose_input_type: 'ha'})}
                              className={`flex-1 text-xs py-1.5 px-2 rounded ${currentItem.dose_input_type === 'ha' ? 'bg-green-100 text-green-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                          >
                              Por Ha
                          </button>
                          <button
                              type="button"
                              onClick={() => setCurrentItem({...currentItem, dose_input_type: 'hl'})}
                              className={`flex-1 text-xs py-1.5 px-2 rounded ${currentItem.dose_input_type === 'hl' ? 'bg-green-100 text-green-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                          >
                              Por 100L
                          </button>
                      </div>
                  </div>

                  <div className="w-32">
                    <label className="block text-xs font-medium text-gray-500">
                        {currentItem.dose_input_type === 'ha' ? 'Dosis / Ha' : 'Dosis / 100L'}
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={currentItem.dose_input_value}
                      onChange={e => setCurrentItem({...currentItem, dose_input_value: Number(e.target.value)})}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                      placeholder="0"
                    />
                  </div>

                  <div className="w-24">
                    <label className="block text-xs font-medium text-gray-500">Unidad</label>
                    <select
                      value={currentItem.dose_unit}
                      onChange={e => setCurrentItem({...currentItem, dose_unit: e.target.value})}
                      className="mt-1 block w-full py-2 px-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                      disabled={!currentItem.product_id}
                    >
                      {!currentItem.product_id && <option value="">-</option>}
                      {currentItem.product_id && 
                        getCompatibleUnits(products.find(p => p.id === currentItem.product_id)?.unit || '').map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))
                      }
                    </select>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 items-end justify-between border-t border-gray-200 pt-3 mt-1">
                   {/* Info Display */}
                   <div className="flex-1 flex gap-6 text-sm text-gray-600">
                       {currentItem.product_id && currentItem.dose_input_value > 0 && (
                           <>
                               <div className="flex flex-col">
                                   <span className="text-xs text-gray-400">Dosis Real / Ha:</span>
                                   <span className="font-medium">
                                       {(currentItem.quantity / (selectedField?.sectors.find(s => s.id === selectedSectorId)?.hectares || 1)).toFixed(4)} {products.find(p => p.id === currentItem.product_id)?.unit}
                                   </span>
                               </div>
                               <div className="flex flex-col">
                                   <span className="text-xs text-gray-400">Total a Descontar:</span>
                                   <span className="font-medium text-green-700">
                                       {currentItem.quantity} {products.find(p => p.id === currentItem.product_id)?.unit}
                                   </span>
                               </div>
                           </>
                       )}
                   </div>

                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    <Plus className="h-5 w-5" /> Agregar
                  </button>
                </div>
            </div>

            {/* Items List */}
            <div className="mt-4">
              {items.length > 0 && (
                <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dosis/Ha (Real)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entrada</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Usado</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total $</th>
                        <th className="relative px-6 py-3"><span className="sr-only">Eliminar</span></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {items.map((item, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.product_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.dose_per_hectare} {item.unit}/ha</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                              {item.dose_input_value} {item.dose_unit} ({item.dose_input_type === 'ha' ? '/ha' : '/100L'})
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.quantity_used} {item.unit}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatCLP(item.total_cost)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button type="button" onClick={() => removeItem(index)} className="text-red-600 hover:text-red-900">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-gray-50">
                          <td colSpan={4} className="px-6 py-4 text-right text-sm font-bold text-gray-900">Costo Total Aplicación:</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                            {formatCLP(items.reduce((sum, item) => sum + item.total_cost, 0))}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={loading || items.length === 0 || !selectedFieldId || !selectedSectorId}
              className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="-ml-1 mr-2 h-5 w-5" />
                  Registrar Aplicación
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Applications List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Historial de Aplicaciones</h2>
        </div>
        {applications.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No hay aplicaciones registradas.</div>
        ) : (
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lugar</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Detalles</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Costo Total</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {applications.map((app) => (
                            <tr key={app.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    <div className="flex items-center">
                                        <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                        {new Date(app.application_date).toLocaleDateString()}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    <div className="flex flex-col">
                                        <span className="font-medium">{app.field?.name}</span>
                                        <span className="text-gray-500 text-xs flex items-center mt-0.5">
                                            <MapPin className="h-3 w-3 mr-1" />
                                            {app.sector?.name} ({app.sector?.hectares} ha)
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                                    {app.application_type}
                                    {app.water_liters_per_hectare > 0 && (
                                        <div className="text-xs text-blue-500 flex items-center mt-1">
                                            <Droplets className="h-3 w-3 mr-1" />
                                            {app.water_liters_per_hectare} L/ha
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500">
                                    <ul className="list-disc pl-4 space-y-1">
                                        {app.application_items?.map((item, idx) => (
                                            <li key={idx} className="text-xs">
                                                <span className="font-medium text-gray-700">{item.product?.name}:</span> 
                                                {' '}{item.dose_per_hectare} {item.product?.unit}/ha
                                                {' '}<span className="text-gray-400">({item.quantity_used} {item.product?.unit} total)</span>
                                            </li>
                                        ))}
                                    </ul>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {formatCLP(app.total_cost)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button 
                                        onClick={() => handleDeleteApplication(app.id)}
                                        className="text-red-600 hover:text-red-900"
                                        title="Eliminar y restaurar stock"
                                    >
                                        <Trash2 className="h-5 w-5" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </div>
  );
};
