import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Package, Search, AlertTriangle, Edit, Trash2, X, Save } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  average_cost: number;
  updated_at: string;
}

export const Inventory: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Edit State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});

  useEffect(() => {
    if (selectedCompany) {
      loadInventory();
    }
  }, [selectedCompany]);

  const loadInventory = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // Define allowed categories for warehouse (Chemicals & Fertilizers only)
      // Using partial matching logic later, but for initial fetch we get all and filter in JS 
      // or use a broad filter if Supabase supports ILIKE ANY (it doesn't easily).
      // Let's fetch all and filter in memory to be robust with casing/variations.
      
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('name');

      if (error) throw error;
      
      // Filter for specific chemical/agrochemical categories OR names containing keywords
      const AGRO_KEYWORDS = [
        'fertilizante', 'plaguicida', 'insecticida', 'fungicida', 'herbicida', 
        'quimico', 'agro', 'urea', 'salitre', 'potasio', 'fosforo', 'nitrato', 'sulfato'
      ];
      
      const chemicalProducts = (data || []).filter(product => {
        const cat = (product.category || '').toLowerCase();
        const name = product.name.toLowerCase();
        
        // Check if category OR name matches any allowed term
        const match = AGRO_KEYWORDS.some(term => cat.includes(term) || name.includes(term));
        
        return match;
      });

      setProducts(chemicalProducts);
      
      if (chemicalProducts.length > 0) {
        const cats = Array.from(new Set(chemicalProducts.map(p => p.category))).filter(Boolean).sort();
        setAvailableCategories(cats);
      } else {
        setAvailableCategories([]);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar el producto "${name}"?\n\nSi este producto se usa en facturas o aplicaciones, podría fallar o dejar registros huérfanos.`)) return;

    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      
      setProducts(products.filter(p => p.id !== id));
      alert('Producto eliminado correctamente');
    } catch (error: any) {
      console.error('Error deleting product:', error);
      alert('Error al eliminar: ' + error.message);
    }
  };

  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      name: product.name,
      category: product.category,
      unit: product.unit,
      current_stock: product.current_stock,
      average_cost: product.average_cost
    });
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditForm({});
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct || !editForm.name) return;

    try {
      const { error } = await supabase
        .from('products')
        .update({
          name: editForm.name,
          category: editForm.category,
          unit: editForm.unit,
          current_stock: editForm.current_stock,
          average_cost: editForm.average_cost,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingProduct.id);

      if (error) throw error;

      // Update local state
      setProducts(products.map(p => 
        p.id === editingProduct.id 
          ? { ...p, ...editForm } as Product 
          : p
      ));
      
      cancelEdit();
      alert('Producto actualizado');
    } catch (error: any) {
      console.error('Error updating product:', error);
      alert('Error al actualizar: ' + error.message);
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || product.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const totalValue = products.reduce((sum, p) => sum + (p.current_stock * p.average_cost), 0);

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bodega de Productos</h1>
          <p className="text-sm text-gray-500">Gestión de inventario y costos promedio</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-lg shadow border border-gray-200">
          <span className="text-sm text-gray-500">Valor Total Bodega:</span>
          <span className="ml-2 text-lg font-bold text-green-700">{formatCLP(totalValue)}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 sm:text-sm"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="sm:w-48">
          <select
            className="block w-full border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 sm:text-sm"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="all">Todas las categorías</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Producto
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Categoría
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stock Actual
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Costo Promedio
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Valor Total
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">Cargando inventario...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No se encontraron productos.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                          <Package className="h-5 w-5 text-green-600" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{product.name}</div>
                          <div className="text-xs text-gray-500">Actualizado: {new Date(product.updated_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800 capitalize">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">{product.current_stock}</div>
                      <div className="text-xs text-gray-500">{product.unit}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{formatCLP(product.average_cost)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-bold">
                        {formatCLP(product.current_stock * product.average_cost)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {product.current_stock <= 0 ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                          Sin Stock
                        </span>
                      ) : product.current_stock < 10 ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800 flex items-center">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Bajo
                        </span>
                      ) : (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                          Normal
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => startEdit(product)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                        title="Editar"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteProduct(product.id, product.name)}
                        className="text-red-600 hover:text-red-900"
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Editar Producto</h3>
              <button onClick={cancelEdit} className="text-gray-500 hover:text-gray-700">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={editForm.name || ''}
                  onChange={e => setEditForm({...editForm, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-md p-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                <input
                  type="text"
                  value={editForm.category || ''}
                  onChange={e => setEditForm({...editForm, category: e.target.value})}
                  className="w-full border border-gray-300 rounded-md p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock Actual</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.current_stock || 0}
                    onChange={e => setEditForm({...editForm, current_stock: Number(e.target.value)})}
                    className="w-full border border-gray-300 rounded-md p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unidad</label>
                  <select
                    value={editForm.unit || 'un'}
                    onChange={e => setEditForm({...editForm, unit: e.target.value})}
                    className="w-full border border-gray-300 rounded-md p-2"
                  >
                    <option value="L">L</option>
                    <option value="kg">kg</option>
                    <option value="un">un</option>
                    <option value="m3">m3</option>
                    <option value="g">g</option>
                    <option value="cc">cc</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Costo Promedio</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.average_cost || 0}
                  onChange={e => setEditForm({...editForm, average_cost: Number(e.target.value)})}
                  className="w-full border border-gray-300 rounded-md p-2"
                />
              </div>

              <div className="flex justify-end pt-4 gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateProduct}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
                >
                  <Save className="h-4 w-4 mr-2" /> Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
