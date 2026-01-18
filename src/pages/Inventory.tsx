import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Package, Search, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';

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
      
      // Filter for specific chemical/agrochemical categories
      const AGRO_CATEGORIES = [
        'fertilizante', 'plaguicida', 'insecticida', 'fungicida', 'herbicida', 
        'quimico', 'agro', 'urea', 'salitre', 'potasio', 'fosforo'
      ];
      
      const chemicalProducts = (data || []).filter(product => {
        const cat = (product.category || '').toLowerCase();
        const name = product.name.toLowerCase();
        
        // Check if category matches any allowed term
        const categoryMatch = AGRO_CATEGORIES.some(term => cat.includes(term));
        
        // Optional: Also check name if category is missing or generic "Insumo"
        // But user asked strictly for specific types. Let's stick to category check mostly,
        // but allow "Insumo" ONLY if name sounds chemical? No, user said "no quiero insumos".
        // So we strictly filter by these agro keywords.
        
        return categoryMatch;
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
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center">Cargando inventario...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
