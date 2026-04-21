import { toast } from 'sonner';
import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { Package, Search, AlertTriangle, Edit, Trash2, X, Save, History, ArrowDownLeft, ArrowUpRight, Upload, ShoppingCart } from 'lucide-react';
import { read, utils } from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { deleteOrArchiveInventoryProduct, fetchInventoryHistory, fetchInventoryProducts, fetchPhytosanitaryPrograms, fetchProgramEventsForProjection, mergeDuplicateInventoryProducts, searchOfficialProducts, updateInventoryProduct, upsertOfficialProducts } from '../services/inventory';

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  minimum_stock: number; // New field
  average_cost: number;
  updated_at: string;
  active_ingredient?: string; // New field
  lot_number?: string;
  expiration_date?: string;
}

interface InventoryMovement {
  id: string;
  created_at: string;
  movement_type: 'entrada' | 'salida';
  quantity: number;
  unit_cost: number;
  invoice_items?: {
    invoice: {
      number: string;
      supplier: string;
      date: string;
    }
  };
  application_items?: {
    application: {
      application_date: string;
      field: { name: string };
      sector: { name: string };
    }
  };
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
  const [editSuggestions, setEditSuggestions] = useState<any[]>([]);

  // History State
  const [viewingHistory, setViewingHistory] = useState<Product | null>(null);
  const [historyData, setHistoryData] = useState<InventoryMovement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // SAG Import
  const sagFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleMergeDuplicates = async () => {
    if (!window.confirm('¿Desea buscar y fusionar productos duplicados? (Se unificará el stock bajo el producto más reciente y se borrarán los repetidos)')) return;
    setLoading(true);
    try {
      const { mergedCount } = await mergeDuplicateInventoryProducts({ products: products as any });

      if (mergedCount > 0) {
        toast.success(`Se fusionaron ${mergedCount} productos duplicados exitosamente.`);
        loadInventory();
      } else {
        toast('No se encontraron productos duplicados.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Error al fusionar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSAG = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
        const buffer = await file.arrayBuffer();
        const workbook = read(buffer);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = utils.sheet_to_json(worksheet);

        // Normalize headers (to lowercase, trim, remove accents)
        const normalizeKey = (key: string) => key.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const normalizedData = jsonData.map(row => {
            const newRow: any = {};
            Object.keys(row).forEach(key => {
                newRow[normalizeKey(key)] = row[key];
            });
            return newRow;
        });

        // Debug: Show found columns in alert if mapping fails
        const firstRowKeys = Object.keys(normalizedData[0] || {});
        console.log('Columnas encontradas:', firstRowKeys);

        const mappedData = normalizedData.map(row => {
            const commercialName = row['nombre comercial'] || row['nombre'] || row['producto'] || row['plaguicida'] || '';
            const company = row['titular'] || row['empresa'] || row['fabricante'] || row['titular autorizacion'] || '';
            let regNum = String(row['autorizacion'] || row['n° autorizacion'] || row['registro'] || row['sag'] || row['nº autorizacion'] || row['numero autorizacion'] || '');
            
            // Fallback for registration number if missing (use name as ID)
            if (!regNum && commercialName) {
                regNum = `SAG-${commercialName.replace(/\s+/g, '-').toUpperCase()}`;
            }

            return {
                commercial_name: commercialName,
                active_ingredient: row['sustancias activas'] || row['sustancia activa'] || row['ingrediente activo'] || row['ingrediente'] || row['ia'] || '',
                concentration: row['concentracion'] || row['concentracion'] || row['concentracion (v/v)'] || row['concentracion (p/p)'] || '',
                company_name: company,
                registration_number: regNum
            };
        }).filter(p => p.commercial_name && p.registration_number);

        if (mappedData.length === 0) {
            toast(`No se encontraron columnas compatibles.\nColumnas detectadas: ${firstRowKeys.join(', ')}\n\nEsperadas: "Nombre Comercial", "Sustancias Activas", "Concentración", "Autorización (opcional)"`);
            return;
        }

        if (!window.confirm(`Se encontraron ${mappedData.length} productos válidos. ¿Importar al registro oficial?`)) return;

        // Batch Insert
        const chunkSize = 100;
        let insertedCount = 0;
        let lastError = '';
        
        for (let i = 0; i < mappedData.length; i += chunkSize) {
            const chunk = mappedData.slice(i, i + chunkSize);
            // Use upsert to avoid duplicates
            try {
                await upsertOfficialProducts({ rows: chunk });
                insertedCount += chunk.length;
            } catch (error: any) {
                console.error('Error importing chunk:', error);
                lastError = error.message;
            }
        }

        if (insertedCount === 0 && lastError) {
            toast.error(`Error al importar: ${lastError}`);
        } else {
            toast(`Importación finalizada. ${insertedCount} productos actualizados/insertados.`);
        }

    } catch (error: any) {
        console.error('Error importing SAG file:', error);
        toast.error('Error al importar: ' + error.message);
    } finally {
        setLoading(false);
        if (sagFileInputRef.current) sagFileInputRef.current.value = '';
    }
  };


  const loadInventory = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const chemicalProducts = await fetchInventoryProducts({ companyId: selectedCompany.id });
      setProducts(chemicalProducts as any);

      if (chemicalProducts.length > 0) {
        const cats = Array.from(new Set(chemicalProducts.map((p: any) => p.category))).filter(Boolean).sort();
        setAvailableCategories(cats);
      } else {
        setAvailableCategories([]);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) {
      void loadInventory();
    }
  }, [selectedCompany, loadInventory]);

  const loadHistory = async (product: Product) => {
    setViewingHistory(product);
    setLoadingHistory(true);
    try {
        const data = await fetchInventoryHistory({ productId: product.id });
        setHistoryData(data as any);
    } catch (error) {
        console.error('Error loading history:', error);
        toast.error('Error al cargar historial');
    } finally {
        setLoadingHistory(false);
    }
  };

  const closeHistory = () => {
      setViewingHistory(null);
      setHistoryData([]);
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    try {
      if (!window.confirm(`¿Estás seguro de eliminar el producto "${name}" de tu bodega local?\n\n(Esto NO borrará las facturas históricas donde se haya comprado, solo lo ocultará de esta vista).`)) return;

      const res = await deleteOrArchiveInventoryProduct({ productId: id });
      if (res.mode === 'archived') {
        toast(`Este producto tiene historial contable y no puede ser borrado físicamente de la base de datos para no romper la contabilidad.\n\nEn su lugar, ajustaremos su stock a 0 y lo quitaremos de tu vista principal.`);
      }
      setProducts(products.filter(p => p.id !== id));
      toast('Producto eliminado correctamente');

    } catch (error: any) {
      console.error('Error checking/deleting product:', error);
      toast.error('Error: ' + error.message);
    }
  };

  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      name: product.name,
      category: product.category,
      unit: product.unit,
      current_stock: product.current_stock,
      minimum_stock: product.minimum_stock,
      average_cost: product.average_cost,
      active_ingredient: product.active_ingredient || '', // Include new field
      lot_number: product.lot_number || '',
      expiration_date: product.expiration_date || ''
    });
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditForm({});
    setEditSuggestions([]);
  };

  const searchOfficialForEdit = async (query: string) => {
      try {
        const data = await searchOfficialProducts({ query, limit: 5 });
        setEditSuggestions(data || []);
      } catch (error) {
        console.error(error);
        setEditSuggestions([]);
      }
  };

  const selectOfficialForEdit = (official: any) => {
      // Concatenate Active Ingredient + Concentration
      const combinedIngredient = [official.active_ingredient, official.concentration]
        .filter(Boolean)
        .join(' ');

      setEditForm({
          ...editForm,
          name: official.commercial_name,
          active_ingredient: combinedIngredient || ''
      });
      setEditSuggestions([]);
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct || !editForm.name) return;

    try {
      await updateInventoryProduct({
        productId: editingProduct.id,
        patch: {
          name: editForm.name,
          category: editForm.category,
          unit: editForm.unit,
          current_stock: editForm.current_stock as any,
          minimum_stock: editForm.minimum_stock as any,
          average_cost: editForm.average_cost as any,
          active_ingredient: editForm.active_ingredient as any,
          lot_number: editForm.lot_number as any,
          expiration_date: editForm.expiration_date ? (editForm.expiration_date as any) : null
        }
      });

      setProducts(products.map(p => 
        p.id === editingProduct.id 
          ? { ...p, ...editForm } as Product 
          : p
      ));
      
      cancelEdit();
      toast('Producto actualizado');
    } catch (error: any) {
      console.error('Error updating product:', error);
      toast.error('Error al actualizar: ' + error.message);
    }
  };

  // Remove the second handleDeleteProduct declaration below handleUpdateProduct

  const generateShoppingListPDF = async () => {
    try {
        // Load Phytosanitary Programs to give the user a choice to project purchases
        const programsData = selectedCompany ? await fetchPhytosanitaryPrograms({ companyId: selectedCompany.id }) : [];
            
        const projectedNeeds = new Map<string, number>();
        
        if (programsData && programsData.length > 0) {
            const useProjection = confirm('¿Desea incluir proyecciones de compras basadas en un Programa Fitosanitario?');
            if (useProjection) {
                const programStr = programsData.map((p, i) => `${i + 1}: ${p.name} (${p.season})`).join('\n');
                const progSelection = prompt(`Ingrese el número del programa a proyectar:\n${programStr}`);
                const selectedProgIndex = parseInt(progSelection || '0') - 1;
                
                if (selectedProgIndex >= 0 && selectedProgIndex < programsData.length) {
                    const prog = programsData[selectedProgIndex];
                    const haStr = prompt('¿Para cuántas hectáreas en total planea aplicar este programa? (Ej: 10.5)');
                    const totalHa = parseFloat(haStr || '0');
                    
                    if (totalHa > 0) {
                        // Fetch all events and products for this program
                        const evData = await fetchProgramEventsForProjection({ programId: prog.id });
                        
                        if (evData) {
                            evData.forEach(ev => {
                                ev.program_event_products.forEach((ep: any) => {
                                    let doseHa = 0;
                                    if (ep.dose_unit === 'L/ha' || ep.dose_unit === 'Kg/ha') {
                                        doseHa = Number(ep.dose);
                                    } else {
                                        // per 100L
                                        if (ev.water_per_ha > 0) {
                                            doseHa = (Number(ep.dose) * ev.water_per_ha) / 100;
                                        }
                                    }
                                    
                                    const neededQty = doseHa * totalHa;
                                    if (neededQty > 0) {
                                        projectedNeeds.set(ep.product_id, (projectedNeeds.get(ep.product_id) || 0) + neededQty);
                                    }
                                });
                            });
                        }
                    }
                }
            }
        }

        // Filter products that are at or below minimum stock OR have a projected need
        const criticalProducts = products.filter(p => {
            if (p.category === 'Archivado') return false;
            const projected = projectedNeeds.get(p.id) || 0;
            return p.current_stock <= (p.minimum_stock || 0) || (p.current_stock < projected);
        });
        
        if (criticalProducts.length === 0) {
          toast('No hay productos bajo el stock mínimo o no hay necesidades proyectadas para generar la lista.');
          return;
        }

        const doc = new jsPDF();
        const companyName = selectedCompany?.name || 'Empresa';
        
        // Header
        doc.setFontSize(18);
        doc.text('Lista de Compras Recomendada', 14, 22);
        doc.setFontSize(11);
        doc.text(`Empresa: ${companyName}`, 14, 30);
        doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, 14, 36);

        // Table Data
        const tableData = criticalProducts.map(p => {
          const minStock = p.minimum_stock || 0;
          const projected = projectedNeeds.get(p.id) || 0;
          
          let recommendedBuy = 0;
          if (projected > 0) {
              recommendedBuy = projected - p.current_stock;
          } else {
              recommendedBuy = minStock > 0 ? (minStock * 2) - p.current_stock : 10;
          }
          
          return [
            p.name,
            p.category,
            `${p.current_stock.toFixed(1)} ${p.unit}`,
            projected > 0 ? `Proyectado: ${projected.toFixed(1)} ${p.unit}` : `${minStock} ${p.unit}`,
            `${Math.max(1, recommendedBuy).toFixed(1)} ${p.unit}` // Suggest amount
          ];
        });

        autoTable(doc, {
          startY: 45,
          head: [['Producto', 'Categoría', 'Stock Actual', 'Referencia', 'Cantidad Sugerida']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [22, 163, 74] }, // green-600
          styles: { fontSize: 10 }
        });

        doc.save(`Lista_Compras_${companyName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch(err) {
        console.error(err);
        toast.error('Error al generar la lista de compras.');
    }
  };

  const filteredProducts = products.filter(product => {
    // Exclude archived products unless we explicitly want to see them
    if (product.category === 'Archivado') return false;

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Bodega de Productos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Gestión de inventario y costos promedio</p>
        </div>
        <div className="bg-white dark:bg-gray-800 px-4 py-2 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex items-center space-x-2">
          <button
              onClick={handleMergeDuplicates}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 mr-2"
              title="Fusionar productos duplicados con el mismo nombre"
          >
              <Package className="h-4 w-4 mr-2" />
              Unir Duplicados
          </button>
          <button
              onClick={generateShoppingListPDF}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              title="Generar PDF con lista de productos bajo stock mínimo"
          >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Lista de Compras
          </button>
          <input
              type="file"
              accept=".xlsx,.xls,.csv"
              ref={sagFileInputRef}
              onChange={handleImportSAG}
              className="hidden"
          />
          <button
              onClick={() => sagFileInputRef.current?.click()}
              className="text-sm font-medium text-green-700 hover:text-green-800 flex items-center"
              title="Importar Listado Oficial SAG (Excel)"
          >
              <Upload className="h-4 w-4 mr-1" />
              Importar SAG
          </button>
          <div className="h-4 w-px bg-gray-300 mx-2"></div>
          <span className="text-sm text-gray-500 dark:text-gray-400">Valor Total Bodega:</span>
          <span className="ml-2 text-lg font-bold text-green-700">{formatCLP(totalValue)}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 border-gray-300 dark:border-gray-600 rounded-md focus:ring-green-500 focus:border-green-500 sm:text-sm"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="sm:w-48">
          <select
            className="block w-full border-gray-300 dark:border-gray-600 rounded-md focus:ring-green-500 focus:border-green-500 sm:text-sm"
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
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Producto
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Categoría
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Stock Actual
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Costo Promedio
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Valor Total
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Estado
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">Cargando inventario...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
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
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                          {product.active_ingredient && (
                              <div className="text-xs text-blue-600 font-medium">{product.active_ingredient}</div>
                          )}
                          <div className="text-xs text-gray-500 dark:text-gray-400">Actualizado: {new Date(product.updated_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 capitalize">
                        {product.category}
                      </span>
                      {(product.lot_number || product.expiration_date) && (
                          <div className="mt-1 flex flex-col gap-0.5">
                              {product.lot_number && <span className="text-[10px] text-gray-500 dark:text-gray-400">Lote: {product.lot_number}</span>}
                              {product.expiration_date && (
                                  <span className={`text-[10px] font-medium ${new Date(product.expiration_date) < new Date(new Date().setDate(new Date().getDate() + 30)) ? 'text-red-600' : 'text-gray-500 dark:text-gray-400'}`}>
                                      Vence: {new Date(product.expiration_date + 'T12:00:00').toLocaleDateString()}
                                  </span>
                              )}
                          </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">{product.current_stock}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{product.unit}</div>
                      {product.minimum_stock > 0 && (
                          <div className="text-[10px] text-orange-500">Mín: {product.minimum_stock}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-gray-100">{formatCLP(product.average_cost)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-gray-100 font-bold">
                        {formatCLP(product.current_stock * product.average_cost)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {product.current_stock <= 0 ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                          Sin Stock
                        </span>
                      ) : product.minimum_stock > 0 && product.current_stock <= product.minimum_stock ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 flex items-center">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Crítico
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
                        onClick={() => loadHistory(product)}
                        className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:text-gray-100 mr-4"
                        title="Ver Movimientos"
                      >
                        <History className="h-4 w-4" />
                      </button>
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

      {/* History Modal */}
      {viewingHistory && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <div>
                          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Historial de Movimientos</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{viewingHistory.name}</p>
                      </div>
                      <button onClick={closeHistory} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300">
                          <X className="h-6 w-6" />
                      </button>
                  </div>

                  {loadingHistory ? (
                      <div className="text-center py-8">Cargando movimientos...</div>
                  ) : historyData.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">No hay movimientos registrados.</div>
                  ) : (
                      <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                              <thead className="bg-gray-50 dark:bg-gray-900">
                                  <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tipo</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cantidad</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Origen/Destino</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Costo Unit.</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                  {historyData.map(movement => (
                                      <tr key={movement.id}>
                                          <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">
                                              {new Date(movement.created_at).toLocaleDateString()}
                                          </td>
                                          <td className="px-4 py-2 text-sm">
                                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                  movement.movement_type === 'entrada' 
                                                  ? 'bg-blue-100 text-blue-800' 
                                                  : 'bg-orange-100 text-orange-800'
                                              }`}>
                                                  {movement.movement_type === 'entrada' ? 'Entrada' : 'Salida'}
                                              </span>
                                          </td>
                                          <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                                              {movement.movement_type === 'entrada' ? (
                                                  <span className="flex items-center text-blue-600">
                                                      <ArrowDownLeft className="h-4 w-4 mr-1" />
                                                      +{movement.quantity} {viewingHistory.unit}
                                                  </span>
                                              ) : (
                                                  <span className="flex items-center text-orange-600">
                                                      <ArrowUpRight className="h-4 w-4 mr-1" />
                                                      -{movement.quantity} {viewingHistory.unit}
                                                  </span>
                                              )}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                                              {movement.movement_type === 'entrada' && movement.invoice_items?.invoice ? (
                                                  <div>
                                                      <div className="font-medium text-gray-900 dark:text-gray-100">Factura {movement.invoice_items.invoice.number}</div>
                                                      <div className="text-xs">{movement.invoice_items.invoice.supplier}</div>
                                                  </div>
                                              ) : movement.movement_type === 'salida' && movement.application_items?.application ? (
                                                  <div>
                                                      <div className="font-medium text-gray-900 dark:text-gray-100">Aplicación {new Date(movement.application_items.application.application_date + 'T12:00:00').toLocaleDateString()}</div>
                                                      <div className="text-xs">
                                                          {movement.application_items.application.field?.name} - {movement.application_items.application.sector?.name}
                                                      </div>
                                                  </div>
                                              ) : (
                                                  <span className="italic text-gray-400">Ajuste Manual / Desconocido</span>
                                              )}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                                              {formatCLP(movement.unit_cost)}
                                          </td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Editar Producto</h3>
              <button onClick={cancelEdit} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre</label>
                <div className="relative">
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={e => {
                        setEditForm({...editForm, name: e.target.value});
                        searchOfficialForEdit(e.target.value);
                    }}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 pr-8"
                    autoComplete="off"
                    placeholder="Buscar en listado SAG..."
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                     <Search className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
                {editSuggestions.length > 0 && (
                    <div className="absolute z-50 left-0 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        <div className="px-3 py-2 text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 border-b">
                            Sugerencias SAG (Click para autocompletar)
                        </div>
                        {editSuggestions.map((sug, idx) => (
                            <button
                                key={idx}
                                onClick={() => selectOfficialForEdit(sug)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 border-b border-gray-100 last:border-0"
                            >
                                <div className="font-medium text-gray-900 dark:text-gray-100">{sug.commercial_name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 flex justify-between">
                                    <span>{sug.active_ingredient}</span>
                                    <span>{sug.concentration}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Ingrediente Activo
                </label>
                <div className="relative">
                    <input
                        type="text"
                        value={editForm.active_ingredient || ''}
                        onChange={e => {
                            setEditForm({...editForm, active_ingredient: e.target.value});
                            // Optional: search official products by active ingredient if needed, 
                            // but usually we search by name to find the ingredient.
                        }}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 pr-8"
                        placeholder="Ej. Glifosato 48%"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                        <Search className="h-4 w-4 text-gray-400" />
                    </div>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    * Al escribir el nombre del producto arriba, se sugerirá automáticamente el ingrediente activo si está en el registro oficial importado.
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                <input
                  type="text"
                  value={editForm.category || ''}
                  onChange={e => setEditForm({...editForm, category: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock Actual</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.current_stock || 0}
                    onChange={e => setEditForm({...editForm, current_stock: Number(e.target.value)})}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock Mínimo (Alerta)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.minimum_stock || 0}
                    onChange={e => setEditForm({...editForm, minimum_stock: Number(e.target.value)})}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-orange-50 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Ej. 10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unidad</label>
                  <select
                    value={editForm.unit || 'un'}
                    onChange={e => setEditForm({...editForm, unit: e.target.value})}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                  >
                    <option value="L">L</option>
                    <option value="kg">kg</option>
                    <option value="un">un</option>
                    <option value="m3">m3</option>
                    <option value="g">g</option>
                    <option value="cc">cc</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Costo Promedio</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.average_cost || 0}
                    onChange={e => setEditForm({...editForm, average_cost: Number(e.target.value)})}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">N° de Lote</label>
                  <input
                    type="text"
                    value={editForm.lot_number || ''}
                    onChange={e => setEditForm({...editForm, lot_number: e.target.value})}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                    placeholder="Ej. L-202305"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha Vencimiento</label>
                  <input
                    type="date"
                    value={editForm.expiration_date || ''}
                    onChange={e => setEditForm({...editForm, expiration_date: e.target.value})}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
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
