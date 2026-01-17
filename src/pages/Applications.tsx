
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, ClipboardList, Calendar, MapPin, Loader2, Save, Trash2, AlertCircle } from 'lucide-react';

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
}

interface ApplicationItem {
  product_id: string;
  product_name: string;
  quantity_used: number;
  unit_cost: number;
  total_cost: number;
  unit: string;
}

export const Applications: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  // Application Form State
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [applicationDate, setApplicationDate] = useState(new Date().toISOString().split('T')[0]);
  const [applicationType, setApplicationType] = useState('fertilizacion');
  const [items, setItems] = useState<ApplicationItem[]>([]);

  // Item Form State
  const [currentItem, setCurrentItem] = useState<{
    product_id: string;
    quantity: number;
  }>({
    product_id: '',
    quantity: 0
  });

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    if (!selectedCompany) return;
    
    // Load fields with sectors
    const { data: fieldsData } = await supabase
      .from('fields')
      .select('*, sectors(*)')
      .eq('company_id', selectedCompany.id);
    setFields(fieldsData || []);

    // Load products with stock > 0
    const { data: productsData } = await supabase
      .from('products')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .gt('current_stock', 0);
    setProducts(productsData || []);
  };

  const handleAddItem = () => {
    const product = products.find(p => p.id === currentItem.product_id);
    if (!product || currentItem.quantity <= 0) return;

    if (currentItem.quantity > product.current_stock) {
      alert(`Stock insuficiente. Disponible: ${product.current_stock} ${product.unit}`);
      return;
    }

    const newItem: ApplicationItem = {
      product_id: product.id,
      product_name: product.name,
      quantity_used: currentItem.quantity,
      unit_cost: product.average_cost,
      total_cost: currentItem.quantity * product.average_cost,
      unit: product.unit
    };

    setItems([...items, newItem]);
    setCurrentItem({ product_id: '', quantity: 0 });
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
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
          total_cost: totalCost
        }])
        .select()
        .single();

      if (appError) throw appError;

      // 2. Process Items and Deduct Stock
      for (const item of items) {
        // Create Application Item
        const { error: itemError } = await supabase
          .from('application_items')
          .insert([{
            application_id: application.id,
            product_id: item.product_id,
            quantity_used: item.quantity_used,
            unit_cost: item.unit_cost,
            total_cost: item.total_cost
          }]);

        if (itemError) throw itemError;

        // Deduct Stock
        // We fetch current stock again to be safe, but for MVP simplified:
        const product = products.find(p => p.id === item.product_id);
        if (product) {
            const newStock = product.current_stock - item.quantity_used;
            await supabase
                .from('products')
                .update({ current_stock: newStock })
                .eq('id', item.product_id);
            
            // Record Inventory Movement (Salida)
            await supabase
                .from('inventory_movements')
                .insert([{
                    product_id: item.product_id,
                    movement_type: 'salida',
                    quantity: item.quantity_used,
                    unit_cost: item.unit_cost
                }]);
        }
      }

      alert('Aplicación registrada exitosamente');
      setItems([]);
      setSelectedFieldId('');
      setSelectedSectorId('');
      loadData(); // Reload to get updated stock

    } catch (error: any) {
      console.error('Error saving application:', error);
      alert('Error al guardar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  const selectedField = fields.find(f => f.id === selectedFieldId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Libro de Aplicaciones</h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
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
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Productos a Aplicar</h3>
            
            {/* Add Item Row */}
            <div className="flex flex-col sm:flex-row gap-4 items-end bg-gray-50 p-4 rounded-md">
              <div className="flex-1">
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

              <div className="w-32">
                <label className="block text-xs font-medium text-gray-500">Cantidad</label>
                <input
                  type="number"
                  step="0.01"
                  value={currentItem.quantity}
                  onChange={e => setCurrentItem({...currentItem, quantity: Number(e.target.value)})}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                />
              </div>

              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            {/* Items List */}
            <div className="mt-4">
              {items.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">Agrega productos a la aplicación</div>
              ) : (
                <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Costo Unit.</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="relative px-6 py-3"><span className="sr-only">Eliminar</span></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {items.map((item, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.product_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.quantity_used} {item.unit}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatCLP(item.unit_cost)}</td>
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
                          <td colSpan={3} className="px-6 py-4 text-right text-sm font-bold text-gray-900">Costo Total Aplicación:</td>
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
    </div>
  );
};
