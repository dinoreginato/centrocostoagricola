import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, FileText, Calendar, Trash2, Save, Loader2, Filter, ChevronDown, Check, Download, Upload, RefreshCw, Search } from 'lucide-react';

interface InvoiceItem {
  id?: string;
  product_id: string;
  product_name: string; // Helper for UI
  quantity: number;
  unit_price: number;
  total_price: number;
  category: string;
  unit: string;
  active_ingredient?: string;
  // Direct Assignment Fields
  destination_type?: 'machine' | 'sector';
  destination_id?: string; 
  destination_name?: string; // Helper for UI
}

interface Product {
  id: string;
  name: string;
  unit: string;
  category: string;
  active_ingredient?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  supplier: string;
  invoice_date: string;
  total_amount: number;
  status: string;
  items?: any[];
  invoice_items?: any[]; // Allow this property
}

interface DashboardStats {
  total: number;
  paid: number;
  pending: number;
  count: number;
  topCategories: { name: string; value: number }[];
}

const CATEGORIES = [
  'Quimicos', 'Plaguicida', 'Insecticida', 'Fungicida', 'Herbicida', 'Fertilizantes',
  'Petroleo', 'Transporte', 'Mano de obra', 'Labores agrícolas', 'Riego',
  'Maquinaria', 'Servicios', 'Insumo', 'Repuesto', 'Combustible', 'Honorarios', 'Otros'
];

// Helper to determine category from product name if not provided
const guessCategory = (name: string): string => {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('urea') || lowerName.includes('salitre') || lowerName.includes('nitro') || lowerName.includes('fosfato')) return 'Fertilizantes';
  if (lowerName.includes('glifosato') || lowerName.includes('mcpa') || lowerName.includes('herb')) return 'Herbicida';
  if (lowerName.includes('insect') || lowerName.includes('ciper')) return 'Insecticida';
  if (lowerName.includes('fung') || lowerName.includes('cobre')) return 'Fungicida';
  if (lowerName.includes('petroleo') || lowerName.includes('diesel') || lowerName.includes('bencina')) return 'Petroleo';
  if (lowerName.includes('servicio') || lowerName.includes('flete')) return 'Servicios';
  if (lowerName.includes('repuesto') || lowerName.includes('filtro') || lowerName.includes('aceite')) return 'Repuesto';
  return 'Otros';
};

export const Invoices: React.FC = () => {
  const { selectedCompany, companies } = useCompany();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [machines, setMachines] = useState<{id: string, name: string}[]>([]); // New for direct assignment
  const [sectors, setSectors] = useState<{id: string, name: string}[]>([]); // New for direct assignment

  // Invoice Form State
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [supplier, setSupplier] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState('Pendiente');
  const [notes, setNotes] = useState('');
  const [documentType, setDocumentType] = useState('Factura');
  const [taxPercentage, setTaxPercentage] = useState(19);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [exemptAmount, setExemptAmount] = useState(0);
  const [specialTaxAmount, setSpecialTaxAmount] = useState(0);
  
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);

  // Item Form State
  const [currentItem, setCurrentItem] = useState<Partial<InvoiceItem>>({
    product_id: '',
    product_name: '',
    quantity: 0,
    unit_price: 0,
    category: 'Fertilizantes',
    unit: 'L',
    active_ingredient: '',
    destination_type: undefined,
    destination_id: '',
  });
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [officialSuggestions, setOfficialSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Dashboard/Filter/Search State
  const [stats, setStats] = useState<DashboardStats>({ total: 0, paid: 0, pending: 0, count: 0, topCategories: [] });
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('Todas');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [availableYears, setAvailableYears] = useState<string[]>([new Date().getFullYear().toString()]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedCompany) {
      loadProducts();
      loadStats(); // Fetches data
      loadSuppliers();
      loadDestinations(); // Load machines and sectors
    }
  }, [selectedCompany, filterStatus]); // Reload if company or status filter changes

  const loadDestinations = async () => {
    if (!selectedCompany) return;
    
    // Load Machines
    const { data: mData } = await supabase
        .from('machinery')
        .select('id, name, brand, model')
        .eq('company_id', selectedCompany.id);
    
    if (mData) {
        setMachines(mData.map(m => ({ id: m.id, name: `${m.name} (${m.brand} ${m.model})` })));
    }

    // Load Sectors
    const { data: sData } = await supabase
        .from('sectors')
        .select('id, name, crop_variety')
        .eq('company_id', selectedCompany.id);
    
    if (sData) {
        setSectors(sData.map(s => ({ id: s.id, name: `${s.name} - ${s.crop_variety || ''}` })));
    }
  };

  // Recalculate stats when data or year changes
  useEffect(() => {
    processStatsAndYears(allInvoices);
  }, [allInvoices, selectedYear]);

  const loadSuppliers = async () => {
    if (!selectedCompany) return;
    const { data } = await supabase
      .from('invoices')
      .select('supplier')
      .eq('company_id', selectedCompany.id)
      .not('supplier', 'is', null);
    
    if (data) {
      const uniqueSuppliers = Array.from(new Set(data.map(i => i.supplier)));
      setSuppliers(uniqueSuppliers);
    }
  };

  const loadProducts = async () => {
    if (!selectedCompany) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, unit, category')
      .eq('company_id', selectedCompany.id);
    setProducts(data || []);
  };

  const loadStats = async () => {
    if (!selectedCompany) return;
    
    // Fetch all invoices with items and products for client-side search/stats
    let query = supabase
      .from('invoices')
      .select(`
        id, invoice_number, supplier, invoice_date, total_amount, status, due_date, notes, document_type,
        tax_percentage, discount_amount, exempt_amount, special_tax_amount,
        invoice_items (
          id, quantity, unit_price, total_price, category, product_id,
          products (id, name, unit)
        )
      `)
      .eq('company_id', selectedCompany.id)
      .order('invoice_date', { ascending: false });

    if (filterStatus !== 'Todas') {
      query = query.eq('status', filterStatus);
    }

    const { data, error } = await query;

    if (data) {
      // Store all for search and filtering
      setAllInvoices(data as any[]);
      
      // Force refresh of search if active
      if (searchQuery) {
        setSearchQuery(prev => prev);
      }
    }
  };

  const processStatsAndYears = (data: Invoice[]) => {
    try {
      // 1. Extract Years safely
      const rawYears = data
        .filter(inv => inv.invoice_date) // Ensure date exists
        .map(inv => {
           // Handle potential ISO strings or other formats if necessary, 
           // but Supabase date is usually YYYY-MM-DD
           return inv.invoice_date.substring(0, 4);
        });
      
      const years = Array.from(new Set(rawYears)).sort().reverse();
      
      // Always ensure we have years, defaulting to current if empty
      const currentYear = new Date().getFullYear().toString();
      const finalYears = years.length > 0 ? years : [currentYear];
      
      console.log('Processed Years:', finalYears); // Debug
      setAvailableYears(finalYears);

      // Ensure selected year is valid
      if (!finalYears.includes(selectedYear)) {
          setSelectedYear(finalYears[0]);
      }

      // 2. Filter by Year
      const effectiveYear = finalYears.includes(selectedYear) ? selectedYear : finalYears[0];
      const filteredByYear = data.filter(inv => inv.invoice_date && inv.invoice_date.substring(0, 4) === effectiveYear);

      // 3. Calculate Stats
      const total = filteredByYear.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      const paid = filteredByYear.filter(inv => inv.status === 'Pagada').reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      const pending = filteredByYear.filter(inv => inv.status === 'Pendiente').reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      
      // Calculate categories
      const categoryMap = new Map<string, number>();
      filteredByYear.forEach((inv: any) => {
        inv.invoice_items?.forEach((item: any) => {
          const cat = item.category || 'Otros';
          categoryMap.set(cat, (categoryMap.get(cat) || 0) + item.total_price);
        });
      });

      const topCategories = Array.from(categoryMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);

      setStats({
        total,
        paid,
        pending,
        count: filteredByYear.length,
        topCategories
      });
    } catch (err) {
      console.error('Error processing stats:', err);
    }
  };

  const getFilteredInvoices = () => {
    let filtered = allInvoices;

    // 1. Date Range Filter
    if (filterDateFrom) {
      filtered = filtered.filter(inv => inv.invoice_date >= filterDateFrom);
    }
    if (filterDateTo) {
      filtered = filtered.filter(inv => inv.invoice_date <= filterDateTo);
    }

    // 2. Year Filter (Only if NO Date Range and NO Search)
    const hasDateRange = filterDateFrom || filterDateTo;
    if (!searchQuery && !hasDateRange && typeof selectedYear !== 'undefined' && selectedYear) {
      filtered = filtered.filter(inv => inv.invoice_date.substring(0, 4) === selectedYear);
    }

    // 3. Status Filter
    if (filterStatus !== 'Todas') {
      filtered = filtered.filter(inv => inv.status === filterStatus);
    }

    if (!searchQuery) return filtered; // Return filtered list if no search
    
    const lowerQuery = searchQuery.toLowerCase();
    filtered = filtered.filter(inv => 
      inv.invoice_number.toLowerCase().includes(lowerQuery) ||
      inv.supplier.toLowerCase().includes(lowerQuery) ||
      inv.invoice_items?.some((item: any) => 
        item.products?.name?.toLowerCase().includes(lowerQuery)
      )
    );

    // Remove duplicates based on ID (just in case)
    const uniqueInvoices = Array.from(new Map(filtered.map(item => [item.id, item])).values());
    return uniqueInvoices;
  };

  const handleProductChange = async (val: string) => {
    // Check if selecting existing or new
    // For simplicity in this UI, we treat input as name search or new name
    const existing = products.find(p => p.name.toLowerCase() === val.toLowerCase());
    
    if (existing) {
      setIsNewProduct(false);
      setCurrentItem({
        ...currentItem,
        product_id: existing.id,
        product_name: existing.name,
        unit: existing.unit,
        category: existing.category,
        active_ingredient: existing.active_ingredient || ''
      });
      setShowSuggestions(false);
    } else {
      setIsNewProduct(true);
      setCurrentItem({
        ...currentItem,
        product_id: 'new',
        product_name: val,
        active_ingredient: ''
      });

      // Search Official Products
      if (val.length >= 3) {
          const { data } = await supabase
              .from('official_products')
              .select('*')
              .ilike('commercial_name', `%${val}%`)
              .limit(5);
          
          if (data && data.length > 0) {
              setOfficialSuggestions(data);
              setShowSuggestions(true);
          } else {
              setShowSuggestions(false);
          }
      } else {
          setShowSuggestions(false);
      }
    }
  };

  const selectOfficialProduct = (official: any) => {
      // Concatenate Active Ingredient + Concentration
      const combinedIngredient = [official.active_ingredient, official.concentration]
        .filter(Boolean)
        .join(' ');

      setCurrentItem({
          ...currentItem,
          product_name: official.commercial_name,
          active_ingredient: combinedIngredient || '',
          product_id: 'new' // Still new to our inventory
      });
      setShowSuggestions(false);
  };

  const addItem = () => {
    if (!currentItem.product_name || !currentItem.quantity || !currentItem.unit_price) return;

    const newItem: InvoiceItem = {
      id: currentItem.id, // Preserve ID if editing existing item
      product_id: currentItem.product_id || 'new',
      product_name: currentItem.product_name,
      quantity: Number(currentItem.quantity),
      unit_price: Number(currentItem.unit_price),
      total_price: Number(currentItem.quantity) * Number(currentItem.unit_price),
      category: currentItem.category || 'Otros',
      unit: currentItem.unit || 'un',
      active_ingredient: currentItem.active_ingredient,
      destination_type: currentItem.destination_type,
      destination_id: currentItem.destination_id,
      destination_name: currentItem.destination_id 
        ? (currentItem.destination_type === 'machine' ? machines.find(m => m.id === currentItem.destination_id)?.name : sectors.find(s => s.id === currentItem.destination_id)?.name)
        : undefined
    };

    if (editingItemIndex !== null) {
        // Update existing item
        const updatedItems = [...items];
        updatedItems[editingItemIndex] = newItem;
        setItems(updatedItems);
        setEditingItemIndex(null);
    } else {
        // Add new item
        setItems([...items, newItem]);
    }

    // Reset form
    setCurrentItem({
      product_id: '',
      product_name: '',
      quantity: 0,
      unit_price: 0,
      category: 'Fertilizantes',
      unit: 'L',
      destination_id: '',
      destination_type: undefined
    });
    setIsNewProduct(false);
  };

  const editItem = (index: number) => {
    const item = items[index];
    setCurrentItem({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        category: item.category,
        unit: item.unit,
        active_ingredient: item.active_ingredient || '',
        destination_type: item.destination_type,
        destination_id: item.destination_id
    });
    setEditingItemIndex(index);
  };

  const cancelEditItem = () => {
    setEditingItemIndex(null);
    setCurrentItem({
      product_id: '',
      product_name: '',
      quantity: 0,
      unit_price: 0,
      category: 'Fertilizantes',
      unit: 'L',
      active_ingredient: '',
      destination_id: '',
      destination_type: undefined
    });
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const calculateTotals = () => {
    // Basic Sum of Items (Net Prices)
    const subtotal = items.reduce((sum, item) => sum + item.total_price, 0);
    
    // Check for Credit Note
    const isCreditNote = documentType.toLowerCase().includes('nota de cr') || 
                         documentType.toLowerCase().includes('credito') || 
                         documentType.toLowerCase() === 'nc';

    const multiplier = isCreditNote ? -1 : 1;

    // Apply Discount
    const netAfterDiscount = subtotal - discountAmount;
    
    // Calculate Tax
    const tax = (netAfterDiscount * (taxPercentage / 100));
    
    // Total
    const total = (netAfterDiscount + tax + exemptAmount + specialTaxAmount) * multiplier;

    return { 
        subtotal: subtotal * multiplier, 
        tax: tax * multiplier, 
        total,
        isCreditNote // Export this flag for UI rendering
    };
  };

  const { subtotal, tax, total, isCreditNote } = calculateTotals();

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Helper to normalize strings for comparison (remove accents, lowercase, trim)
  const normalizeString = (str: string) => {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCompany) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        let jsonContent = event.target?.result as string;
        let json;

        // Smart JSON Parsing Strategy
        const parseFlexibleJSON = (text: string) => {
          text = text.trim();
          
          // 1. Try standard parse
          try { return JSON.parse(text); } catch (e) {}
          
          // 2. Try wrapping in brackets (for comma-separated lists)
          try { return JSON.parse(`[${text}]`); } catch (e) {}

          // 3. Try fixing concatenated objects like } { -> }, {
          try {
             const fixed = text.replace(/}\s*{/g, '},{');
             return JSON.parse(`[${fixed}]`);
          } catch (e) {}

          // 4. Aggressive Regex Extraction (Finds anything looking like an object)
          // Matches { ... } allowing for one level of nesting
          try {
            const matches = text.match(/\{(?:[^{}]|{[^{}]*})*\}/g);
            if (matches && matches.length > 0) {
              // Join matches with commas and wrap in brackets
              return JSON.parse(`[${matches.join(',')}]`);
            }
          } catch (e) {}

          throw new Error("No se pudo interpretar el formato del archivo.");
        };

        try {
          json = parseFlexibleJSON(jsonContent);
        } catch (e: any) {
          console.error('JSON Parse Error:', e);
          alert(`Error crítico al leer el archivo: ${e.message}\n\nPor favor verifica que sea un archivo de texto con formato JSON válido.`);
          return;
        }

        // Handle "facturas" wrapper if present
        const invoicesToImport = json.facturas || (Array.isArray(json) ? json : [json]);
        
        if (!window.confirm(`¿Estás seguro de importar ${invoicesToImport.length} facturas?`)) return;

        setLoading(true);
        let successCount = 0;
        let errorCount = 0;

        for (const inv of invoicesToImport) {
          try {
            let targetCompanyId = selectedCompany.id;

            // Map fields from JSON to our schema
            const invoiceDataMap = {
              number: inv.numero || inv.invoice_number,
              supplier: inv.proveedor || inv.supplier,
              date: inv.fecha || inv.invoice_date,
              dueDate: inv.vencimiento || inv.due_date,
              status: inv.estado ? (inv.estado.toLowerCase() === 'pagada' ? 'Pagada' : 'Pendiente') : 'Pendiente',
              notes: inv.notes || inv.notas || '',
              type: inv.tipo ? (inv.tipo.toLowerCase() === 'boleta' ? 'Boleta' : 'Factura') : 'Factura',
              taxPct: inv.impuestosPct !== undefined ? inv.impuestosPct : (inv.impuestoPct !== undefined ? inv.impuestoPct : 19),
              discount: inv.descuentoMonto || 0,
              exempt: inv.montoExentoGlobal || inv.montoExentoMontoTotal || 0,
              specialTax: inv.impuestoEspecialMonto || 0,
              total: inv.total || 0,
              companyName: inv.empresa || inv.company_name
            };

            if (invoiceDataMap.companyName) {
               const normCompanyName = normalizeString(invoiceDataMap.companyName);
               
               // Try exact match first
               let foundCompany = companies.find(c => normalizeString(c.name) === normCompanyName);
               
               // If not found, try includes (fuzzy match)
               if (!foundCompany) {
                 foundCompany = companies.find(c => normalizeString(c.name).includes(normCompanyName) || normCompanyName.includes(normalizeString(c.name)));
               }

               if (foundCompany) {
                 targetCompanyId = foundCompany.id;
               } else {
                 console.warn(`Company '${invoiceDataMap.companyName}' not found. Using default: ${selectedCompany.name}`);
               }
            }

            if (!invoiceDataMap.number || !invoiceDataMap.supplier || !invoiceDataMap.date || !inv.items) {
              console.warn('Skipping invalid invoice:', inv);
              errorCount++;
              continue;
            }

            // Check duplicate on import
            const { data: existingImport } = await supabase
              .from('invoices')
              .select('id')
              .eq('company_id', targetCompanyId)
              .eq('invoice_number', invoiceDataMap.number)
              .eq('supplier', invoiceDataMap.supplier)
              .maybeSingle();

            if (existingImport) {
              console.warn(`Skipping duplicate invoice: ${invoiceDataMap.number} - ${invoiceDataMap.supplier}`);
              // Optional: count as error or just skip silently? Let's skip.
              continue;
            }

            // 1. Create Invoice
            const { data: invoiceData, error: invError } = await supabase
              .from('invoices')
              .insert([{
                company_id: targetCompanyId,
                invoice_number: invoiceDataMap.number,
                supplier: invoiceDataMap.supplier,
                invoice_date: invoiceDataMap.date,
                due_date: invoiceDataMap.dueDate || null,
                status: invoiceDataMap.status,
                notes: invoiceDataMap.notes,
                document_type: invoiceDataMap.type,
                tax_percentage: invoiceDataMap.taxPct,
                discount_amount: invoiceDataMap.discount,
                exempt_amount: invoiceDataMap.exempt,
                special_tax_amount: invoiceDataMap.specialTax,
                total_amount: invoiceDataMap.total
              }])
              .select()
              .single();

            if (invError) throw invError;

            // 2. Process Items
            for (const item of inv.items) {
              const itemMap = {
                name: item.descripcion || item.product_name,
                category: item.categoria || guessCategory(item.descripcion || item.product_name || ''),
                quantity: Number(item.cantidad || item.quantity || 0),
                unit: item.unidad ? (item.unidad.toLowerCase().startsWith('unid') ? 'un' : item.unidad) : 'un',
                price: Number(item.precio || item.precioUnit || item.unit_price || 0),
                total: Number(item.total || item.total_price || 0)
              };

              let productId;
              const { data: existingProduct } = await supabase
                .from('products')
                .select('id')
                .eq('company_id', targetCompanyId)
                .ilike('name', itemMap.name)
                .single();

              if (existingProduct) {
                productId = existingProduct.id;
              } else {
                const { data: newProduct, error: prodError } = await supabase
                  .from('products')
                  .insert([{
                    company_id: targetCompanyId,
                    name: itemMap.name,
                    category: itemMap.category,
                    unit: itemMap.unit,
                    current_stock: 0,
                    average_cost: 0
                  }])
                  .select()
                  .single();
                
                if (prodError) throw prodError;
                productId = newProduct.id;
              }

              const { data: invItem, error: itemError } = await supabase
                .from('invoice_items')
                .insert([{
                  invoice_id: invoiceData.id,
                  product_id: productId,
                  quantity: itemMap.quantity,
                  unit_price: itemMap.price,
                  total_price: itemMap.total,
                  category: itemMap.category
                }])
                .select()
                .single();

              if (itemError) throw itemError;

              await supabase.rpc('update_inventory_with_average_cost', {
                product_id: productId,
                quantity_in: itemMap.quantity,
                unit_cost: itemMap.price,
                invoice_item_id: invItem.id
              });
            }
            successCount++;
          } catch (err) {
            console.error('Error importing invoice:', inv, err);
            errorCount++;
          }
        }

        alert(`Importación completada.\nExitosos: ${successCount}\nFallidos: ${errorCount}`);
        loadStats();
        loadProducts();
        loadSuppliers();

      } catch (error) {
        console.error('Error parsing JSON:', error);
        alert('Error al leer el archivo JSON. Asegúrate de que el formato sea correcto.');
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleEditClick = (inv: any) => {
    setEditingInvoiceId(inv.id);
    setInvoiceNumber(inv.invoice_number);
    setSupplier(inv.supplier);
    setInvoiceDate(inv.invoice_date);
    setDueDate(inv.due_date || '');
    setStatus(inv.status);
    setNotes(inv.notes || '');
    setDocumentType(inv.document_type || 'Factura');
    // Fix for legacy data: if Exempt, force 0 tax on load
    if (inv.document_type === 'Factura Exenta') {
        setTaxPercentage(0);
    } else {
        setTaxPercentage(inv.tax_percentage !== undefined ? inv.tax_percentage : 19);
    }
    setDiscountAmount(inv.discount_amount || 0);
    setExemptAmount(inv.exempt_amount || 0);
    setSpecialTaxAmount(inv.special_tax_amount || 0);
    
    // Load items for this invoice
    if (inv.invoice_items) {
      const loadedItems = inv.invoice_items.map((item: any) => ({
        id: item.id,
        product_id: item.products?.id,
        product_name: item.products?.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        category: item.category,
        unit: item.products?.unit || 'un',
        active_ingredient: item.products?.active_ingredient || ''
      }));
      setItems(loadedItems);
    }
  };

  const handleCancelEdit = () => {
    setEditingInvoiceId(null);
    setInvoiceNumber('');
    setSupplier('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setDueDate('');
    setStatus('Pendiente');
    setNotes('');
    setItems([]);
    setDiscountAmount(0);
    setExemptAmount(0);
    setSpecialTaxAmount(0);
  };

  const handleDeleteInvoice = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('¿FUERZA BRUTA: Borrar esta factura definitivamente?')) return;

    try {
      setLoading(true);
      
      // Use the new RPC function for atomic force delete
      const { error } = await supabase.rpc('delete_invoice_force', {
        target_invoice_id: id
      });

      if (error) throw error;
      
      alert('Factura eliminada (Forzado)');
      
      // Update local state
      const updatedInvoices = allInvoices.filter(inv => inv.id !== id);
      setAllInvoices(updatedInvoices);
      
      loadStats();
      if (editingInvoiceId === id) handleCancelEdit();
    } catch (error: any) {
      console.error('Error deleting:', error);
      alert('Error al eliminar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanDuplicates = async () => {
    if (!selectedCompany) return;
    if (!window.confirm('¿Desea buscar y eliminar facturas duplicadas automáticamente? Se conservará la versión más reciente de cada factura.')) return;

    setLoading(true);
    try {
      // Fetch all invoices
      const { data: allInvoicesRaw, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, supplier, created_at')
        .eq('company_id', selectedCompany.id);

      if (error) throw error;

      const duplicatesToDelete: string[] = [];
      const seen = new Set<string>();

      // Sort by created_at desc so we keep the newest
      const sorted = (allInvoicesRaw || []).sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      for (const inv of sorted) {
        const key = `${inv.invoice_number}-${inv.supplier}`;
        if (seen.has(key)) {
          duplicatesToDelete.push(inv.id);
        } else {
          seen.add(key);
        }
      }

      if (duplicatesToDelete.length === 0) {
        alert('No se encontraron duplicados.');
      } else {
        if (!window.confirm(`Se encontraron ${duplicatesToDelete.length} duplicados. ¿Eliminar?`)) {
            setLoading(false);
            return;
        }

        // Delete items first for these duplicates
        const { error: itemsError } = await supabase
            .from('invoice_items')
            .delete()
            .in('invoice_id', duplicatesToDelete);
        
        if (itemsError) throw itemsError;

        // Delete invoices
        const { error: deleteError } = await supabase
            .from('invoices')
            .delete()
            .in('id', duplicatesToDelete);

        if (deleteError) throw deleteError;

        alert(`Se eliminaron ${duplicatesToDelete.length} facturas duplicadas.`);
        loadStats();
      }

    } catch (err: any) {
      console.error('Error cleaning duplicates:', err);
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleInvoiceStatus = async (e: React.MouseEvent, invoice: Invoice) => {
    e.stopPropagation(); // Prevent opening edit mode
    
    const newStatus = invoice.status === 'Pagada' ? 'Pendiente' : 'Pagada';
    
    try {
        const { error } = await supabase
            .from('invoices')
            .update({ status: newStatus })
            .eq('id', invoice.id);

        if (error) throw error;

        // Update local state directly to reflect change immediately
        const updatedInvoices = allInvoices.map(inv => 
            inv.id === invoice.id ? { ...inv, status: newStatus } : inv
        );
        setAllInvoices(updatedInvoices);
        
        // Also update editing form if it's the same invoice
        if (editingInvoiceId === invoice.id) {
            setStatus(newStatus);
        }

    } catch (error: any) {
        console.error('Error toggling status:', error);
        alert('Error al cambiar estado: ' + error.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany || items.length === 0) return;

    setLoading(true);
    try {
      let invoiceId = editingInvoiceId;

      if (editingInvoiceId) {
        // --- UPDATE EXISTING INVOICE (DIFFING STRATEGY) ---
        
        // 1. Update Invoice Details Header
        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            invoice_number: invoiceNumber,
            supplier: supplier,
            invoice_date: invoiceDate,
            due_date: dueDate || null,
            status: status,
            notes: notes,
            document_type: documentType,
            tax_percentage: taxPercentage,
            discount_amount: discountAmount,
            exempt_amount: exemptAmount,
            special_tax_amount: specialTaxAmount,
            total_amount: total
          })
          .eq('id', editingInvoiceId);

        if (updateError) throw updateError;
        
        invoiceId = editingInvoiceId;

        // 2. Fetch current DB items to compare
        const { data: currentDbItems, error: fetchError } = await supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', editingInvoiceId);

        if (fetchError) throw fetchError;
        
        const dbItems = currentDbItems || [];

        // Identify items to DELETE (in DB but not in current State)
        const itemsToDelete = dbItems.filter(dbItem => !items.find(formItem => formItem.id === dbItem.id));
        
        // Identify items to UPDATE (in both)
        const itemsToUpdate = items.filter(formItem => formItem.id && dbItems.find(dbItem => dbItem.id === formItem.id));
        
        // Identify items to ADD (in State but no ID)
        const itemsToAdd = items.filter(formItem => !formItem.id);

        // A. Process DELETES
        // Optimization: Gather IDs first for batch delete, but do inventory reversal individually
        const deleteIds = itemsToDelete.map(i => i.id);

        for (const item of itemsToDelete) {
           // Reverse Inventory first
           if (item.product_id) {
             await supabase.rpc('reverse_inventory_movement', {
               target_product_id: item.product_id,
               quantity_to_remove: item.quantity
             });
           }
        }
        
        if (deleteIds.length > 0) {
            const { error: delErr } = await supabase
                .from('invoice_items')
                .delete()
                .in('id', deleteIds);
            if (delErr) throw delErr;
        }

        // B. Process UPDATES
        for (const item of itemsToUpdate) {
           const oldItem = dbItems.find(db => db.id === item.id);
           if (!oldItem) continue;

           let currentProductId = item.product_id;

           // Handle Product Change / New Product during Update
           // If product_id is 'new' or null, it means user typed a new name.
           // Or if they selected a different product ID.
           if (currentProductId === 'new' || !currentProductId) {
                // Create new product
                const { data: newProduct, error: productError } = await supabase
                    .from('products')
                    .insert([{
                        company_id: selectedCompany.id,
                        name: item.product_name,
                        category: item.category,
                        unit: item.unit,
                        current_stock: 0, 
                        average_cost: 0,
                        active_ingredient: item.active_ingredient || ''
                    }])
                    .select()
                    .single();
                
                if (productError) throw productError;
                currentProductId = newProduct.id;
           }

           // Check if fields changed
           const quantityChanged = oldItem.quantity !== item.quantity;
           const priceChanged = oldItem.unit_price !== item.unit_price;
           const productChanged = oldItem.product_id !== currentProductId;
           const categoryChanged = oldItem.category !== item.category;

           if (quantityChanged || priceChanged || productChanged || categoryChanged) {
               // 1. Reverse OLD stock impact (if quantity or product changed)
               // Even if only price changed, we usually reverse and re-apply to update avg cost correctly.
               // If product changed, we MUST reverse old product.
               
               if (quantityChanged || priceChanged || productChanged) {
                   await supabase.rpc('reverse_inventory_movement', {
                       target_product_id: oldItem.product_id,
                       quantity_to_remove: oldItem.quantity
                   });
               }

               // 2. Update Item Record
               const { error: upErr } = await supabase
                   .from('invoice_items')
                   .update({
                       product_id: currentProductId, // Update product_id
                       quantity: item.quantity,
                       unit_price: item.unit_price,
                       total_price: item.total_price,
                       category: item.category
                   })
                   .eq('id', item.id);
               if (upErr) throw upErr;

               // 3. Add NEW stock impact (re-calculate avg cost)
               // Only if inventory-relevant fields changed
               if (quantityChanged || priceChanged || productChanged) {
                   await supabase.rpc('update_inventory_with_average_cost', {
                       product_id: currentProductId,
                       quantity_in: item.quantity,
                       unit_cost: item.unit_price,
                       invoice_item_id: item.id
                   });
               }
           }
        }

        // C. Process ADDS
        for (const item of itemsToAdd) {
            let productId = item.product_id;

            // Handle New Product Creation
            if (productId === 'new' || !productId) {
                 const { data: newProduct, error: productError } = await supabase
                    .from('products')
                    .insert([{
                      company_id: selectedCompany.id,
                      name: item.product_name,
                      category: item.category,
                      unit: item.unit,
                      current_stock: 0, 
                      average_cost: 0,
                      active_ingredient: item.active_ingredient || ''
                    }])
                    .select()
                    .single();
                  
                  if (productError) throw productError;
                  productId = newProduct.id;
            }

            // Insert Invoice Item
            const { data: invoiceItem, error: itemError } = await supabase
              .from('invoice_items')
              .insert([{
                invoice_id: invoiceId,
                product_id: productId,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                category: item.category
              }])
              .select()
              .single();

            if (itemError) throw itemError;

            // --- DIRECT ASSIGNMENT LOGIC ---
            if (item.destination_type && item.destination_id) {
               if (item.destination_type === 'machine') {
                  // Create Machinery Assignment
                  await supabase.from('machinery_assignments').insert([{
                      company_id: selectedCompany.id,
                      invoice_item_id: invoiceItem.id,
                      machine_id: item.destination_id,
                      date: invoiceDate, // Use invoice date as default assignment date
                      amount: item.total_price,
                      sector_id: null, 
                      notes: 'Asignación automática desde Factura'
                  }]);
               } else if (item.destination_type === 'sector') {
                  // Pending implementation for sectors
                  console.log('Sector assignment pending implementation for item:', invoiceItem.id);
               }
            }
            // -------------------------------

            // Update Inventory
            await supabase.rpc('update_inventory_with_average_cost', {
              product_id: productId,
              quantity_in: item.quantity,
              unit_cost: item.unit_price,
              invoice_item_id: invoiceItem.id
            });
        }

      } else {
        // --- CREATE NEW INVOICE ---
        
        // 0. Check for duplicates before creating
        const { data: existingInvoice } = await supabase
          .from('invoices')
          .select('id')
          .eq('company_id', selectedCompany.id)
          .eq('invoice_number', invoiceNumber)
          .eq('supplier', supplier)
          .maybeSingle();

        if (existingInvoice) {
          alert(`¡Atención! Ya existe una factura con el número "${invoiceNumber}" para el proveedor "${supplier}".\n\nNo se puede crear un duplicado.`);
          setLoading(false);
          return;
        }

        const { data: invoice, error: invoiceError } = await supabase
          .from('invoices')
          .insert([{
            company_id: selectedCompany.id,
            invoice_number: invoiceNumber,
            supplier: supplier,
            invoice_date: invoiceDate,
            due_date: dueDate || null,
            status: status,
            notes: notes,
            document_type: documentType,
            tax_percentage: taxPercentage,
            discount_amount: discountAmount,
            exempt_amount: exemptAmount,
            special_tax_amount: specialTaxAmount,
            total_amount: total
          }])
          .select()
          .single();

        if (invoiceError) throw invoiceError;
        invoiceId = invoice.id;

        // Process Items for NEW Invoice
        for (const item of items) {
            let productId = item.product_id;

            if (productId === 'new' || !productId) {
              const { data: newProduct, error: productError } = await supabase
                .from('products')
                .insert([{
                  company_id: selectedCompany.id,
                  name: item.product_name,
                  category: item.category,
                  unit: item.unit,
                  current_stock: 0, 
                  average_cost: 0,
                  active_ingredient: item.active_ingredient || ''
                }])
                .select()
                .single();
              
              if (productError) throw productError;
              productId = newProduct.id;
            }

            // Insert Invoice Item
            const { data: invoiceItem, error: itemError } = await supabase
              .from('invoice_items')
              .insert([{
                invoice_id: invoiceId,
                product_id: productId,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                category: item.category
              }])
              .select()
              .single();

            if (itemError) throw itemError;

            // --- DIRECT ASSIGNMENT LOGIC ---
            if (item.destination_type && item.destination_id) {
               if (item.destination_type === 'machine') {
                  // Create Machinery Assignment
                  await supabase.from('machinery_assignments').insert([{
                      company_id: selectedCompany.id,
                      invoice_item_id: invoiceItem.id,
                      machine_id: item.destination_id,
                      date: invoiceDate, // Use invoice date as default assignment date
                      amount: item.total_price,
                      sector_id: null, 
                      notes: 'Asignación automática desde Factura'
                  }]);
               } else if (item.destination_type === 'sector') {
                   // Pending
                   console.log('Sector assignment pending implementation for item:', invoiceItem.id);
               }
            }
            // -------------------------------

            await supabase.rpc('update_inventory_with_average_cost', {
              product_id: productId,
              quantity_in: item.quantity,
              unit_cost: item.unit_price,
              invoice_item_id: invoiceItem.id
            });
        }
      }

      // Success Reset
      setEditingInvoiceId(null); // Clear edit mode
      setInvoiceNumber('');
      setSupplier('');
      setItems([]);
      setNotes('');
      setDueDate('');
      setSpecialTaxAmount(0);
      alert(editingInvoiceId ? 'Factura actualizada exitosamente' : 'Factura ingresada exitosamente');
      loadProducts();
      loadStats();
      loadSuppliers();

    } catch (error: any) {
      console.error('Error saving invoice:', error);
      alert('Error al guardar la factura: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-100px)]">
      {/* Left Panel: Invoice Form (Approx 66%) */}
      <div className="lg:w-2/3 space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <FileText className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-semibold">Aplicación de Facturas Agrícolas</h2>
            </div>
            <div className="flex space-x-2">
              {editingInvoiceId && (
                <>
                  <button 
                    onClick={handleCancelEdit}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm flex items-center"
                  >
                    Cancelar Edición
                  </button>
                </>
              )}
              <button 
                onClick={handleCleanDuplicates}
                className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm flex items-center font-bold"
                title="Buscar y eliminar facturas duplicadas"
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Limpiar Duplicados
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImportFile} 
                accept=".json" 
                className="hidden" 
              />
              <button 
                onClick={handleImportClick}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm flex items-center"
              >
                <Upload className="h-4 w-4 mr-1" /> Importar
              </button>
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm flex items-center">
                <Download className="h-4 w-4 mr-1" /> Exportar
              </button>
              <button className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-sm flex items-center">
                <FileText className="h-4 w-4 mr-1" /> Reportes
              </button>
            </div>
          </div>

          <div className="p-6">
            <form onSubmit={handleSubmit}>
              {/* Row 1 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Número</label>
                  <input
                    type="text"
                    required
                    value={invoiceNumber}
                    onChange={e => setInvoiceNumber(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                    placeholder="Ej. 00123"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Fecha Emisión</label>
                  <input
                    type="date"
                    required
                    value={invoiceDate}
                    onChange={e => setInvoiceDate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Vencimiento</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Proveedor</label>
                  <input
                    type="text"
                    required
                    list="supplier-list"
                    value={supplier}
                    onChange={e => setSupplier(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                    placeholder="Nombre del prov"
                  />
                  <datalist id="supplier-list">
                    {suppliers.map((s, idx) => (
                      <option key={idx} value={s} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Estado</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <option value="Pendiente">Pendiente</option>
                    <option value="Pagada">Pagada</option>
                    <option value="Anulada">Anulada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Notas</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                    placeholder="Opcional"
                  />
                </div>
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Empresa</label>
                  <div className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 font-medium">
                    {selectedCompany.name}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Tipo de Documento</label>
                  <select
                    value={documentType}
                    onChange={e => {
                        const val = e.target.value;
                        setDocumentType(val);
                        // Auto-set tax percentage based on type
                        if (val === 'Factura Exenta') {
                            setTaxPercentage(0);
                        } else if (val === 'Factura' || val === 'Nota de Crédito' || val === 'Nota de Débito') {
                            setTaxPercentage(19);
                        }
                    }}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <option value="Factura">Factura</option>
                    <option value="Factura Exenta">Factura Exenta</option>
                    <option value="Boleta">Boleta</option>
                    <option value="Guía de Despacho">Guía de Despacho</option>
                    <option value="Nota de Crédito">Nota de Crédito</option>
                    <option value="Nota de Débito">Nota de Débito</option>
                  </select>
                </div>
              </div>

              {/* Row 4: Financials */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Impuesto (%)</label>
                  <input
                    type="number"
                    value={taxPercentage}
                    onChange={e => setTaxPercentage(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Descuento</label>
                  <input
                    type="number"
                    value={discountAmount}
                    onChange={e => setDiscountAmount(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Monto Exento</label>
                  <input
                    type="number"
                    value={exemptAmount}
                    onChange={e => setExemptAmount(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                    placeholder="Ej. 0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Impuesto Especial</label>
                  <input
                    type="number"
                    value={specialTaxAmount}
                    onChange={e => setSpecialTaxAmount(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                    placeholder="Ej. 0"
                  />
                </div>
              </div>

              {/* Item Entry Section */}
              <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">Items {items.length}</span>
                </div>
                
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-3 relative">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Descripción</label>
                    <input
                      type="text"
                      value={currentItem.product_name}
                      onChange={e => handleProductChange(e.target.value)}
                      className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5"
                      placeholder="Buscar o crear..."
                      autoComplete="off"
                    />
                    
                    {showSuggestions && officialSuggestions.length > 0 && (
                        <div className="absolute z-50 left-0 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            <div className="px-3 py-2 text-xs font-bold text-gray-500 bg-gray-50 border-b">
                                Sugerencias SAG (Registro Oficial)
                            </div>
                            {officialSuggestions.map((sug, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => selectOfficialProduct(sug)}
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-green-50 border-b border-gray-100 last:border-0"
                                >
                                    <div className="font-medium text-gray-900">{sug.commercial_name}</div>
                                    <div className="text-xs text-gray-500 flex justify-between">
                                        <span>{sug.active_ingredient}</span>
                                        <span>{sug.concentration}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                        Reg: {sug.registration_number} • {sug.company_name}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                  </div>
                  
                  <div className="col-span-12 md:col-span-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Categoría</label>
                    <select
                      value={currentItem.category}
                      onChange={e => setCurrentItem({...currentItem, category: e.target.value})}
                      className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-4 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cant.</label>
                    <input
                      type="number"
                      step="0.01"
                      value={currentItem.quantity}
                      onChange={e => setCurrentItem({...currentItem, quantity: Number(e.target.value)})}
                      className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5"
                    />
                  </div>

                  <div className="col-span-4 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Unidad</label>
                    <select
                      value={currentItem.unit}
                      onChange={e => setCurrentItem({...currentItem, unit: e.target.value})}
                      className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5"
                    >
                      <option value="L">Litros (L)</option>
                      <option value="kg">Kilos (kg)</option>
                      <option value="un">Unidad (un)</option>
                      <option value="m3">m3</option>
                      <option value="g">Gramos (g)</option>
                      <option value="cc">cc</option>
                    </select>
                  </div>

                  <div className="col-span-4 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Precio</label>
                    <input
                      type="number"
                      step="0.01"
                      value={currentItem.unit_price}
                      onChange={e => setCurrentItem({...currentItem, unit_price: Number(e.target.value)})}
                      className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5"
                    />
                  </div>

                  {/* Direct Assignment Fields */}
                  <div className="col-span-12 md:col-span-4 bg-blue-50 p-2 rounded-lg border border-blue-100">
                     <label className="block text-xs font-bold text-blue-800 mb-1">
                        Asignación Inmediata (Opcional)
                     </label>
                     <div className="flex gap-2">
                         <select
                            value={currentItem.destination_type || ''}
                            onChange={e => setCurrentItem({
                                ...currentItem, 
                                destination_type: e.target.value as any,
                                destination_id: '' // Reset ID when type changes
                            })}
                            className="w-1/3 bg-white border border-blue-300 text-gray-900 text-xs rounded-lg p-2"
                         >
                            <option value="">Sin asignar</option>
                            <option value="machine">Maquinaria</option>
                            <option value="sector">Sector</option>
                         </select>
                         
                         {currentItem.destination_type && (
                             <select
                                value={currentItem.destination_id || ''}
                                onChange={e => setCurrentItem({...currentItem, destination_id: e.target.value})}
                                className="w-2/3 bg-white border border-blue-300 text-gray-900 text-xs rounded-lg p-2"
                             >
                                <option value="">Seleccione...</option>
                                {currentItem.destination_type === 'machine' ? (
                                    machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                                ) : (
                                    sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                                )}
                             </select>
                         )}
                     </div>
                  </div>
                </div>
                
                <div className="mt-3 flex justify-end space-x-2">
                  {editingItemIndex !== null && (
                      <button
                        type="button"
                        onClick={cancelEditItem}
                        className="bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg text-sm"
                      >
                        Cancelar
                      </button>
                  )}
                  <button
                    type="button"
                    onClick={addItem}
                    className="bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded-lg text-sm flex items-center"
                  >
                    {editingItemIndex !== null ? (
                        <>Actualizar item</>
                    ) : (
                        <><Plus className="h-4 w-4 mr-1" /> Añadir item</>
                    )}
                  </button>
                </div>
              </div>

              {/* Items Table Summary (Small) */}
              {items.length > 0 && (
                <div className="mb-6 overflow-x-auto">
                  <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                      <tr>
                        <th className="px-4 py-2">Desc</th>
                        <th className="px-4 py-2">Cat</th>
                        <th className="px-4 py-2">Cant</th>
                        <th className="px-4 py-2">Total</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx} className={`border-b ${editingItemIndex === idx ? 'bg-blue-50' : 'bg-white'}`}>
                          <td className="px-4 py-2">{item.product_name}</td>
                          <td className="px-4 py-2">{item.category}</td>
                          <td className="px-4 py-2">{item.quantity} {item.unit}</td>
                          <td className="px-4 py-2">
                             {formatCLP(item.total_price)}
                             {item.destination_type && (
                                <div className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1 rounded inline-block ml-1">
                                  ➜ {item.destination_type === 'machine' ? '🚜' : '🌱'} {item.destination_name}
                                </div>
                             )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button 
                                type="button" 
                                onClick={() => editItem(idx)} 
                                className="text-blue-500 hover:text-blue-700 mr-3"
                                disabled={editingItemIndex !== null && editingItemIndex !== idx}
                            >
                                Editar
                            </button>
                            <button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals Footer */}
              <div className="bg-gray-900 text-white p-4 rounded-lg">
                <div className="flex justify-between items-center text-xs text-gray-400 mb-2">
                  <span>Subtotal: {formatCLP(subtotal)}</span>
                  <span>Descuento: {formatCLP(discountAmount)}</span>
                  <span>Impuesto ({taxPercentage}%): {formatCLP(tax)}</span>
                  <span>Exento: {formatCLP(exemptAmount)}</span>
                  <span>Imp. Esp: {formatCLP(specialTaxAmount)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-700">
                  <div className="text-sm">
                    Impuestos: {formatCLP(tax)}
                  </div>
                  <div className="text-xl font-bold">
                    Total: {formatCLP(total)}
                  </div>
                  <button
                    type="submit"
                    disabled={loading || items.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg flex items-center disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                    Guardar factura
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Right Panel: Dashboard Stats (Approx 33%) */}
      <div className="lg:w-1/3 space-y-4">
        {/* Filters Card */}
        <div className="bg-gray-900 text-white rounded-xl p-6 shadow-sm">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">ESTADO</label>
              <select 
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full bg-gray-800 border-gray-700 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              >
                <option value="Todas">Todas</option>
                <option value="Pendiente">Pendiente</option>
                <option value="Pagada">Pagada</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">ORDEN</label>
              <select className="w-full bg-gray-800 border-gray-700 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5">
                <option>Fecha ↓</option>
                <option>Fecha ↑</option>
              </select>
            </div>
          </div>
          
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-400 mb-1">BUSCAR</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Factura, proveedor, producto..."
                className="w-full bg-gray-800 border-gray-700 text-white text-sm rounded-lg pl-8 p-2.5 focus:ring-blue-500 focus:border-blue-500"
              />
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-gray-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">DESDE</label>
              <input 
                type="date" 
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full bg-gray-800 border-gray-700 text-white text-sm rounded-lg p-2.5" 
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">HASTA</label>
              <input 
                type="date" 
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full bg-gray-800 border-gray-700 text-white text-sm rounded-lg p-2.5" 
              />
            </div>
          </div>
        </div>

        {/* Stats Cards or Search Results */}
        <div className="bg-gray-900 text-white rounded-xl p-6 shadow-sm">
          {searchQuery || filterDateFrom || filterDateTo ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase">RESULTADOS</h3>
                <span className="text-xs text-gray-500">{getFilteredInvoices().length} encontrados</span>
              </div>
              
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                {getFilteredInvoices().length > 0 ? (
                  getFilteredInvoices().map(inv => (
                    <div 
                      key={inv.id} 
                      onClick={() => handleEditClick(inv)}
                      className="bg-gray-800 p-3 rounded-lg border border-gray-700 hover:border-blue-500 cursor-pointer transition-colors relative group"
                    >
                      <div className="flex justify-between items-start mb-1 pr-6">
                        <span className="font-bold text-sm text-white">#{inv.invoice_number}</span>
                        <div className="flex flex-col items-end">
                          <span 
                            onClick={(e) => toggleInvoiceStatus(e, inv)}
                            className={`text-xs px-2 py-0.5 rounded-full mb-1 cursor-pointer hover:opacity-80 transition-opacity select-none ${
                            inv.status === 'Pagada' ? 'bg-green-900 text-green-300' : 
                            inv.status === 'Pendiente' ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'
                          }`}>
                            {inv.status}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {inv.invoice_items?.length || 0} items
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-300 mb-1 truncate">{inv.supplier}</div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{new Date(inv.invoice_date).toLocaleDateString()}</span>
                        <span className="font-bold text-gray-300">{formatCLP(inv.total_amount)}</span>
                      </div>
                      
                      <button
                        onClick={(e) => handleDeleteInvoice(e, inv.id)}
                        className="absolute top-2 right-2 p-1.5 bg-red-900/50 text-red-400 rounded hover:bg-red-600 hover:text-white transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        title="Eliminar factura"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    No se encontraron facturas
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xs font-bold text-gray-400 uppercase">ESTADÍSTICAS DEL AÑO:</h3>
                <select 
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-gray-800 border-none text-xs rounded text-white focus:ring-0 cursor-pointer hover:bg-gray-700 w-24 text-right"
                  style={{ colorScheme: 'dark' }} // Force dark dropdown to ensure visibility
                >
                  {availableYears.map(year => (
                    <option key={year} value={year} className="text-black bg-white">{year}</option>
                  ))}
                  {/* Fallback if empty */}
                  {availableYears.length === 0 && <option value="2026" className="text-black bg-white">2026</option>}
                </select>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-800 p-4 rounded-lg">
                  <div className="text-xs text-blue-400 mb-1">$ TOTAL</div>
                  <div className="text-2xl font-bold">{formatCLP(stats.total)}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800 p-4 rounded-lg">
                    <div className="flex items-center text-xs text-green-400 mb-1">
                      <Check className="h-3 w-3 mr-1" /> PAGADO
                    </div>
                    <div className="text-xl font-bold">{formatCLP(stats.paid)}</div>
                  </div>
                  <div className="bg-gray-800 p-4 rounded-lg">
                    <div className="flex items-center text-xs text-yellow-400 mb-1">
                      <Loader2 className="h-3 w-3 mr-1" /> PENDIENTE
                    </div>
                    <div className="text-xl font-bold">{formatCLP(stats.pending)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800 p-4 rounded-lg">
                    <div className="text-xs text-gray-400 mb-1">CONTEO</div>
                    <div className="text-xl font-bold">{stats.count}</div>
                  </div>
                  
                  <div className="bg-gray-800 p-4 rounded-lg">
                    <div className="text-xs text-purple-400 mb-2">TOP CATEGORÍAS</div>
                    <div className="space-y-2">
                      {stats.topCategories.map((cat, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-gray-300">{cat.name}</span>
                          <span className="font-bold">{formatCLP(cat.value)}</span>
                        </div>
                      ))}
                      {stats.topCategories.length === 0 && <span className="text-gray-500 text-xs">Sin datos</span>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          
          <div className="mt-6 pt-4 border-t border-gray-800 flex justify-center items-center text-xs text-gray-500">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span>Usando Archivo Compartido</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
