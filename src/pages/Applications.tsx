import { toast } from 'sonner';
import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Loader2, Save, Trash2, Calendar, Droplets, MapPin, RefreshCw, Edit, Filter, Download, Eye, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';

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
  active_ingredient?: string; // New field
}

interface ApplicationItem {
  product_id: string;
  product_name: string;
  product_category: string; // Added category
  quantity_used: number; // In product units (e.g. L)
  dose_per_hectare: number; // Final dose per hectare
  dose_input_value: number; // What the user typed
  dose_input_type: 'ha' | 'hl'; // How it was entered
  dose_unit: string; // Unit selected by user (e.g. cc)
  unit_cost: number;
  total_cost: number;
  unit: string; // Product unit
  objective?: string; // New field for application objective
}

interface ApplicationHistory {
  id: string;
  application_date: string;
  application_type: string;
  total_cost: number;
  water_liters_per_hectare: number;
  field_id: string;
  field_name: string;
  sector_id: string;
  sector_name: string;
  sector_hectares: number;
  items: {
    product_id: string;
    product_name: string;
    quantity_used: number;
    dose_per_hectare: number;
    unit: string;
    unit_cost: number;
    total_cost: number;
    objective?: string; // New field
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
  const { selectedCompany, userRole } = useCompany();
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [applications, setApplications] = useState<ApplicationHistory[]>([]);
  const [avgFuelPrice, setAvgFuelPrice] = useState<number>(0);
  
  // PDF Preview State
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('');

  // Application Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [applicationDate, setApplicationDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [applicationType, setApplicationType] = useState('fertilizacion');
  const [waterVolumePerHectare, setWaterVolumePerHectare] = useState<number>(0); 
  const [items, setItems] = useState<ApplicationItem[]>([]);

  // Filter State
  const [filterSectorId, setFilterSectorId] = useState<string>('all');


  // Item Form State
  const [currentItem, setCurrentItem] = useState<{
    product_id: string;
    quantity: number; // Calculated total quantity in product units
    dose_input_value: number;
    dose_input_type: 'ha' | 'hl';
    dose_unit: string;
    objective: string;
  }>({
    product_id: '',
    quantity: 0,
    dose_input_value: 0,
    dose_input_type: 'ha',
    dose_unit: '',
    objective: ''
  });

  // Update dose unit and suggest objective when product changes
  useEffect(() => {
    if (currentItem.product_id) {
      const product = products.find(p => p.id === currentItem.product_id);
      if (product) {
        // Default to product unit, but if it's L allow cc, if Kg allow gr
        // Find last used objective for this product
        let lastObjective = '';
        for (const app of applications) {
            const item = app.items.find(i => i.product_id === currentItem.product_id);
            if (item && item.objective) {
                lastObjective = item.objective;
                break;
            }
        }

        setCurrentItem(prev => ({ 
            ...prev, 
            dose_unit: product.unit,
            objective: lastObjective
        })); 
      }
    }
  }, [currentItem.product_id, products, applications]);

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
    currentItem.quantity,
    selectedSectorId, 
    selectedFieldId, 
    waterVolumePerHectare, 
    fields, 
    products
  ]);

  const loadData = useCallback(async () => {
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
        .rpc('get_company_applications_v2', { p_company_id: selectedCompany.id });
    
    if (appsError) {
        console.error('Error loading applications:', appsError);
        toast.error('Error cargando historial: ' + appsError.message);
    } else {
        setApplications(appsData || []);
    }

    // Calculate Average Fuel Price (Diesel)
    try {
        const { data: fuelItems } = await supabase
            .from('invoice_items')
            .select(`
                quantity, total_price, category,
                products (name),
                invoices!inner (document_type)
            `)
            .eq('invoices.company_id', selectedCompany.id);

        if (fuelItems) {
            const targetCategories = ['petroleo', 'diesel'];
            const filtered = fuelItems.filter((item: any) => {
                const cat = (item.category || '').toLowerCase();
                const name = (item.products?.name || '').toLowerCase();
                return targetCategories.some(t => cat.includes(t) || name.includes(t)) && !cat.includes('bencina') && !name.includes('gasolina');
            });

            const totalLiters = filtered.reduce((sum, item: any) => {
                 const docType = (item.invoices.document_type || '').toLowerCase();
                 const isNC = docType.includes('nota de cr') || docType.includes('nc');
                 const qty = Number(item.quantity || 0);
                 return sum + (isNC ? -qty : qty);
            }, 0);

            const totalCost = filtered.reduce((sum, item: any) => {
                 const docType = (item.invoices.document_type || '').toLowerCase();
                 const isNC = docType.includes('nota de cr') || docType.includes('nc');
                 const cost = Number(item.total_price || 0);
                 return sum + (isNC ? -cost : cost);
            }, 0);

            if (totalLiters > 0) {
                setAvgFuelPrice(totalCost / totalLiters);
            }
        }
    } catch (err) {
        console.error('Error calculating fuel price:', err);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) {
      void loadData();
    }
  }, [selectedCompany, loadData]);

  const handleAddItem = () => {
    const product = products.find(p => p.id === currentItem.product_id);
    if (!product || currentItem.quantity <= 0) return;

    if (currentItem.dose_input_type === 'hl' && waterVolumePerHectare <= 0) {
        toast('Debe ingresar el Mojamiento (Volumen de agua) para calcular la dosis por concentración.');
        return;
    }

    if (currentItem.quantity > product.current_stock) {
      toast(`Stock insuficiente. Disponible: ${product.current_stock} ${product.unit}`);
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
      product_category: product.category,
      quantity_used: currentItem.quantity,
      dose_per_hectare: Number(dosePerHectare.toFixed(4)), // Normalized dose/ha
      dose_input_value: currentItem.dose_input_value,
      dose_input_type: currentItem.dose_input_type,
      dose_unit: currentItem.dose_unit,
      unit_cost: product.average_cost,
      total_cost: currentItem.quantity * product.average_cost,
      unit: product.unit,
      objective: currentItem.objective // Save objective
    };

    setItems([...items, newItem]);
    setCurrentItem({ product_id: '', quantity: 0, dose_input_value: 0, dose_input_type: 'ha', dose_unit: '', objective: '' });
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const editItem = (index: number) => {
    const item = items[index];
    setCurrentItem({
        product_id: item.product_id,
        quantity: item.quantity_used,
        dose_input_value: item.dose_input_value,
        dose_input_type: item.dose_input_type,
        dose_unit: item.dose_unit,
        objective: item.objective || ''
    });
    // Remove from list so user can update it
    removeItem(index);
  };

  const handleDeleteApplication = async (id: string) => {
    if (!window.confirm('¿Estás seguro de eliminar esta aplicación?\n\n¡Cuidado! El stock descontado será RESTAURADO a la bodega.')) return;
    
    try {
        const { error } = await supabase.rpc('delete_application_and_restore_stock', { target_application_id: id });
        if (error) throw error;
        toast('Aplicación eliminada y stock restaurado exitosamente.');
        loadData();
    } catch (error: any) {
        console.error('Error deleting application:', error);
        toast.error('Error al eliminar: ' + error.message);
    }
  };

  const handleDownloadPDF = (action: 'save' | 'preview' = 'save') => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const filteredApps = applications.filter(app => filterSectorId === 'all' || app.sector_id === filterSectorId);
    
    // Title
    doc.setFontSize(18);
    doc.text('Libro de Campo (Cuaderno de Aplicaciones)', 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    const dateStr = new Date().toLocaleDateString('es-CL');
    let subtitle = `Empresa: ${selectedCompany?.name} | Fecha de Emisión: ${dateStr}`;
    
    if (filterSectorId !== 'all') {
        const sectorName = applications.find(a => a.sector_id === filterSectorId)?.sector_name || 'Sector Seleccionado';
        subtitle += ` | Sector: ${sectorName}`;
    }
    
    doc.text(subtitle, 14, 30);
    
    // Flatten data: One row per product applied
    const tableRows: any[] = [];
    filteredApps.forEach(app => {
        app.items.forEach(item => {
            // Find active ingredient from loaded products
            const productInfo = products.find(p => p.id === item.product_id);
            const activeIngredient = productInfo?.active_ingredient || 'No especificado';
            const objective = item.objective || app.application_type || 'Control Fitosanitario';

            tableRows.push([
                new Date(app.application_date).toLocaleDateString('es-CL'),
                `${app.field_name} - ${app.sector_name}`,
                `${app.sector_hectares} ha`,
                objective,
                item.product_name,
                activeIngredient,
                `${item.dose_per_hectare} ${item.unit}/ha`,
                `${app.water_liters_per_hectare} L/ha`
            ]);
        });
    });

    autoTable(doc, {
        head: [['Fecha', 'Ubicación (Sector)', 'Superficie', 'Objetivo / Plaga', 'Producto Comercial', 'Ingrediente Activo', 'Dosis / Ha', 'Mojamiento']],
        body: tableRows,
        startY: 40,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
        headStyles: { fillColor: [46, 125, 50], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 40 },
            2: { cellWidth: 20, halign: 'right' },
            3: { cellWidth: 35 },
            4: { cellWidth: 40 },
            5: { cellWidth: 40 },
            6: { cellWidth: 25, halign: 'right' },
            7: { cellWidth: 25, halign: 'right' },
        }
    });

    // --- SUMMARY SECTION ---
    const finalY = (doc as any).lastAutoTable.finalY + 15;
    
    // Check if we need a new page
    if (finalY > 180) { // Landscape height is approx 210
        doc.addPage();
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text('Resumen de Productos Utilizados', 14, 20);
    } else {
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text('Resumen de Productos Utilizados', 14, finalY);
    }

    const summaryStart = finalY > 180 ? 30 : finalY + 10;

    // Calculate totals
    const productTotals: Record<string, {name: string, active_ingredient: string, quantity: number, unit: string, cost: number}> = {};
    
    filteredApps.forEach(app => {
        app.items.forEach(item => {
             if (!productTotals[item.product_id]) {
                 const productInfo = products.find(p => p.id === item.product_id);
                 productTotals[item.product_id] = {
                     name: item.product_name,
                     active_ingredient: productInfo?.active_ingredient || 'No especificado',
                     quantity: 0,
                     unit: item.unit,
                     cost: 0
                 };
             }
             productTotals[item.product_id].quantity += item.quantity_used;
             productTotals[item.product_id].cost += item.total_cost;
        });
    });

    const summaryRows = Object.values(productTotals)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => [
            p.name,
            p.active_ingredient,
            `${p.quantity.toFixed(2)} ${p.unit}`,
            formatCLP(p.cost)
        ]);

    autoTable(doc, {
        head: [['Producto Comercial', 'Ingrediente Activo', 'Cantidad Total Aplicada', 'Costo Total (CLP)']],
        body: summaryRows,
        startY: summaryStart,
        theme: 'striped',
        headStyles: { fillColor: [60, 60, 60] },
        styles: { fontSize: 9 },
        columnStyles: {
            2: { halign: 'right' },
            3: { halign: 'right' }
        }
    });

    if (action === 'save') {
        doc.save(`Libro_Campo_${selectedCompany?.name.replace(/\s+/g, '_')}_${dateStr}.pdf`);
    } else {
        const pdfBlobUrl = doc.output('bloburl');
        setPdfPreviewUrl(pdfBlobUrl.toString());
        setPdfPreviewTitle(`Libro de Campo - ${selectedCompany?.name}`);
        setPdfPreviewOpen(true);
    }
  };

  const handleDownloadFieldPDF = (action: 'save' | 'preview' = 'save') => {
    const doc = new jsPDF();
    const filteredApps = applications.filter(app => filterSectorId === 'all' || app.sector_id === filterSectorId);
    
    // Title
    doc.setFontSize(18);
    doc.text('Orden de Aplicación (Campo)', 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    const dateStr = new Date().toLocaleDateString();
    let subtitle = `Generado el: ${dateStr}`;
    
    if (filterSectorId !== 'all') {
        const sectorName = applications.find(a => a.sector_id === filterSectorId)?.sector_name || 'Sector Seleccionado';
        subtitle += ` - Filtrado por Sector: ${sectorName}`;
    } else {
        subtitle += ' - Todos los Sectores';
    }
    
    doc.text(subtitle, 14, 30);
    
    // Iterate over applications to create detailed field orders
    let currentY = 40;

    filteredApps.forEach((app, index) => {
        // Add page break if needed
        if (currentY > 250) {
            doc.addPage();
            currentY = 20;
        }

        // Application Header
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        
        // Ensure date is clear and formatted
        const [y, m, d] = app.application_date.split('T')[0].split('-');
        const appDate = `${d}/${m}/${y}`;

        doc.text(`Aplicación #${index + 1} - ${appDate}`, 14, currentY);
        currentY += 6;
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Campo: ${app.field_name} | Sector: ${app.sector_name} (${app.sector_hectares} ha)`, 14, currentY);
        currentY += 5;
        doc.text(`Tipo: ${app.application_type} | Mojamiento: ${app.water_liters_per_hectare} L/ha`, 14, currentY);
        currentY += 8;

        // Table for this application
        const tableBody = app.items.map(item => {
            // Find product to get active ingredient
            // We need to look up in the 'products' state. 
            // Note: 'products' state must be accessible here.
            const product = products.find(p => p.id === item.product_id);
            const activeIngredient = product?.active_ingredient || '-';

            return [
                item.product_name,
                activeIngredient,
                item.objective || '-',
                `${item.dose_per_hectare} ${item.unit}/ha`,
                `${app.water_liters_per_hectare} L/ha`,
                `${item.quantity_used} ${item.unit}` // Added Total Quantity
            ];
        });

        autoTable(doc, {
            head: [['Producto', 'Ingrediente Activo', 'Objetivo', 'Dosis', 'Mojamiento', 'Total']],
            body: tableBody,
            startY: currentY,
            styles: { fontSize: 9, cellPadding: 3 },
            headStyles: { fillColor: [46, 191, 88] }, // Green header
            margin: { left: 14, right: 14 },
            theme: 'grid'
        });

        // Update Y for next loop
        currentY = (doc as any).lastAutoTable.finalY + 15;
    });

    if (action === 'save') {
        doc.save(`orden_campo_${new Date().toISOString().split('T')[0]}.pdf`);
    } else {
        const pdfBlob = doc.output('bloburl');
        setPdfPreviewUrl(pdfBlob.toString());
        setPdfPreviewTitle('Orden de Aplicación (Campo)');
        setPdfPreviewOpen(true);
    }
  };

  const handleDownloadDetailedReport = (action: 'save' | 'preview' = 'save') => {
    const doc = new jsPDF();
    const filteredApps = applications.filter(app => filterSectorId === 'all' || app.sector_id === filterSectorId);
    
    // Title
    doc.setFontSize(18);
    doc.text('Reporte Detallado de Aplicaciones', 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    const dateStr = new Date().toLocaleDateString();
    let subtitle = `Generado el: ${dateStr}`;
    
    if (filterSectorId !== 'all') {
        const sectorName = applications.find(a => a.sector_id === filterSectorId)?.sector_name || 'Sector Seleccionado';
        subtitle += ` - Filtrado por Sector: ${sectorName}`;
    } else {
        subtitle += ' - Todos los Sectores';
    }
    
    doc.text(subtitle, 14, 30);
    
    // Prepare flattened data for the table
    const tableBody: any[] = [];

    // Sort applications by date ascending for the report
    const sortedApps = [...filteredApps].sort((a, b) => new Date(a.application_date).getTime() - new Date(b.application_date).getTime());

    sortedApps.forEach(app => {
        const [y, m, d] = app.application_date.split('T')[0].split('-');
        const appDate = `${d}/${m}/${y}`;
        const location = `${app.field_name} - ${app.sector_name}`;

        app.items.forEach(item => {
            // Find product to get active ingredient
            const product = products.find(p => p.id === item.product_id);
            const activeIngredient = product?.active_ingredient || '-';

            tableBody.push([
                appDate,
                location,
                item.product_name,
                activeIngredient,
                `${item.dose_per_hectare} ${item.unit}/ha`,
                `${app.water_liters_per_hectare} L/ha`,
                `${item.quantity_used} ${item.unit}`
            ]);
        });
    });

    autoTable(doc, {
        head: [['Fecha', 'Lugar', 'Producto', 'Ing. Activo', 'Dosis', 'Volumen', 'Total']],
        body: tableBody,
        startY: 40,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [46, 191, 88] }, // Green header
        columnStyles: {
            0: { cellWidth: 20 }, // Fecha
            1: { cellWidth: 35 }, // Lugar
            2: { cellWidth: 35 }, // Producto
            3: { cellWidth: 35 }, // Ing. Activo
            4: { cellWidth: 20 }, // Dosis
            5: { cellWidth: 20 }, // Volumen
            6: { cellWidth: 20 }, // Total
        },
        alternateRowStyles: { fillColor: [245, 245, 245] }
    });

    if (action === 'save') {
        doc.save(`reporte_detallado_${new Date().toISOString().split('T')[0]}.pdf`);
    } else {
        const pdfBlob = doc.output('bloburl');
        setPdfPreviewUrl(pdfBlob.toString());
        setPdfPreviewTitle('Reporte Detallado de Aplicaciones');
        setPdfPreviewOpen(true);
    }
  };

  const handleDeleteAllApplications = async () => {
    if (!selectedCompany) return;
    if (!window.confirm('¿ESTÁS SEGURO DE ELIMINAR TODAS LAS APLICACIONES?\n\nEsta acción borrará todo el historial de aplicaciones y RESTAURARÁ el stock de los productos a la bodega.\n\nEs ideal para empezar de cero si has estado haciendo pruebas.')) return;
    
    setLoading(true);
    try {
        const { error } = await supabase.rpc('delete_all_applications_restore_stock', { target_company_id: selectedCompany.id });
        if (error) throw error;
        toast('Todas las aplicaciones han sido eliminadas y el stock restaurado.');
        loadData();
    } catch (error: any) {
        console.error('Error deleting all applications:', error);
        toast.error('Error al eliminar todo: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleEditApplication = (app: ApplicationHistory) => {
    // Populate form with application data
    setEditingId(app.id);
    setSelectedFieldId(app.field_id);
    setSelectedSectorId(app.sector_id);
    
    // Fix Date: Ensure we use the date string directly without timezone conversion issues
    // Assuming app.application_date is YYYY-MM-DD or ISO
    const dateStr = app.application_date.split('T')[0];
    setApplicationDate(dateStr);
    
    setApplicationType(app.application_type);
    setWaterVolumePerHectare(app.water_liters_per_hectare || 0);

    // Populate items
    const mappedItems: ApplicationItem[] = app.items.map((ai) => {
        const prod = products.find(p => p.id === ai.product_id);
        return {
            product_id: ai.product_id,
            product_name: ai.product_name,
            product_category: prod?.category || 'Desconocido', // Lookup category
            quantity_used: ai.quantity_used,
            dose_per_hectare: ai.dose_per_hectare,
            dose_input_value: ai.dose_per_hectare, // Approximation
            dose_input_type: 'ha',
            dose_unit: ai.unit,
            unit_cost: ai.unit_cost,
            total_cost: ai.total_cost,
            unit: ai.unit,
            objective: ai.objective || '' // Populate objective
        };
    });
    
    setItems(mappedItems);
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setSelectedFieldId('');
    setSelectedSectorId('');
    setApplicationDate(new Date().toISOString().split('T')[0]);
    setApplicationType('fertilizacion');
    setWaterVolumePerHectare(0);
    setItems([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFieldId || !selectedSectorId || items.length === 0) return;

    setLoading(true);
    try {
      const totalCost = items.reduce((sum, item) => sum + item.total_cost, 0);

      if (editingId) {
        // UPDATE MODE
        const { error } = await supabase.rpc('update_application_inventory', {
            p_application_id: editingId,
            p_field_id: selectedFieldId,
            p_sector_id: selectedSectorId,
            p_date: applicationDate,
            p_type: applicationType,
            p_water_rate: waterVolumePerHectare,
            p_total_cost: totalCost,
            p_items: items.map(item => ({
                product_id: item.product_id,
                quantity_used: item.quantity_used,
                dose_per_hectare: item.dose_per_hectare,
                unit_cost: item.unit_cost,
                total_cost: item.total_cost,
                objective: item.objective || '' // Include objective
            }))
        });

        if (error) throw error;
        
        // Update Fuel Record (Formula: 12L/ha)
        // We do this separately. Ideally should be in the RPC but keeping it here for now.
        // For Update, we check if record exists or create it.
        const sector = fields.find(f => f.id === selectedFieldId)?.sectors.find(s => s.id === selectedSectorId);
        
        if (sector && sector.hectares > 0) {
            // Use configured rate or default to 12
            const rate = selectedCompany.application_fuel_rate || 12;
            const fuelLiters = rate * sector.hectares;
            const finalLiters = Math.max(fuelLiters, 0.01);
            const fuelCost = finalLiters * avgFuelPrice;
            
            // Check if exists
            const { data: existingFuel } = await supabase
                .from('fuel_consumption')
                .select('id')
                .eq('application_id', editingId)
                .maybeSingle();

            if (existingFuel) {
                const { error: updateError } = await supabase
                    .from('fuel_consumption')
                    .update({
                        date: applicationDate,
                        sector_id: selectedSectorId,
                        liters: finalLiters,
                        estimated_price: fuelCost
                    })
                    .eq('id', existingFuel.id);
                
                if (updateError) console.error('Error updating fuel record:', updateError);

            } else {
                // Create if missing
                const { error: insertError } = await supabase
                    .from('fuel_consumption')
                    .insert([{
                        company_id: selectedCompany.id,
                        date: applicationDate,
                        activity: 'Aplicación (Automática)',
                        liters: finalLiters,
                        estimated_price: fuelCost,
                        sector_id: selectedSectorId,
                        application_id: editingId
                    }]);
                
                if (insertError) console.error('Error creating missing fuel record on update:', insertError);
            }
        }

        toast('Aplicación actualizada exitosamente');
        handleCancelEdit(); // Reset form

      } else {
        // CREATE MODE
        // 1. Create Application
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
              total_cost: item.total_cost,
              objective: item.objective || '' // Include objective
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

        // 3. Create Automatic Fuel Consumption Record
        const sector = fields.find(f => f.id === selectedFieldId)?.sectors.find(s => s.id === selectedSectorId);
        
        if (sector && sector.hectares > 0) {
            // Use configured rate or default to 12
            const rate = selectedCompany.application_fuel_rate || 12;
            const fuelLiters = rate * sector.hectares;
            // Ensure we have at least a small amount to pass check constraint > 0
            const finalLiters = Math.max(fuelLiters, 0.01);
            const fuelCost = finalLiters * avgFuelPrice;
            
            console.log('Attempting to create fuel record:', {
                company_id: selectedCompany.id,
                date: applicationDate,
                liters: finalLiters,
                sector_id: selectedSectorId,
                application_id: application.id
            });

            const { error: fuelError } = await supabase
                .from('fuel_consumption')
                .insert([{
                    company_id: selectedCompany.id,
                    date: applicationDate,
                    activity: 'Aplicación (Automática)',
                    liters: finalLiters,
                    estimated_price: fuelCost,
                    sector_id: selectedSectorId,
                    application_id: application.id
                }]);
            
            if (fuelError) {
                console.error('Error creating fuel record:', fuelError);
                toast('La aplicación se guardó, pero hubo un error registrando el petróleo: ' + fuelError.message);
            }
        } else {
            console.warn('Skipping fuel record: Sector not found or 0 hectares', sector);
        }

        toast('Aplicación registrada exitosamente');
        handleCancelEdit(); // Reset form
      }

      loadData(); 

    } catch (error: any) {
      console.error('Error saving application:', error);
      toast.error('Error al guardar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedField = fields.find(f => f.id === selectedFieldId);
  const selectedSector = selectedField?.sectors.find(s => s.id === selectedSectorId);

  // Helper to get compatible units based on product unit
  const getCompatibleUnits = (productUnit: string) => {
    const base = normalizeUnit(productUnit);
    if (base === 'l' || base === 'cc') return ['L', 'cc'];
    if (base === 'kg' || base === 'gr') return ['Kg', 'gr'];
    return [productUnit];
  };

  // Calculate stats by objective
  const objectiveStats = React.useMemo(() => {
    const stats: Record<string, number> = {};
    applications.forEach(app => {
      if (filterSectorId === 'all' || app.sector_id === filterSectorId) {
          app.items.forEach(item => {
            if (item.objective) {
               // Normalize slightly to group similar ones if needed, but strict for now
               const key = item.objective.trim();
               if (key) stats[key] = (stats[key] || 0) + 1;
            }
          });
      }
    });
    return stats;
  }, [applications, filterSectorId]);

  // Derive unique objectives for autocomplete
  const uniqueObjectives = React.useMemo(() => {
    const objectives = new Set<string>();
    applications.forEach(app => {
        app.items.forEach(item => {
            if (item.objective) {
                objectives.add(item.objective.trim());
            }
        });
    });
    return Array.from(objectives).sort();
  }, [applications]);

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Libro de Aplicaciones</h1>
        <div className="flex space-x-2">
            <button
                onClick={loadData}
                className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                title="Recargar datos"
            >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
                onClick={handleDeleteAllApplications}
                className="inline-flex items-center px-4 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white dark:bg-gray-800 hover:bg-red-50"
            >
                <Trash2 className="h-4 w-4 mr-2" />
                Reiniciar / Borrar Todo
            </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {editingId ? 'Editar Aplicación' : 'Nueva Aplicación'}
            </h2>
            {editingId && (
                <button
                    onClick={handleCancelEdit}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 underline"
                >
                    Cancelar Edición
                </button>
            )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Application Header */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Campo</label>
              <select
                required
                value={selectedFieldId}
                onChange={e => {
                    setSelectedFieldId(e.target.value);
                    // Only clear sector if we are NOT in the middle of setting up edit (which sets both)
                    // But standard behavior is clear sector on field change.
                    // If user manually changes field, we should clear sector.
                    // Our handleEdit sets both, but React batching might trigger this?
                    // Usually onChange is only user interaction.
                    setSelectedSectorId('');
                }}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="">Seleccionar Campo...</option>
                {fields.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sector</label>
              <select
                required
                value={selectedSectorId}
                disabled={!selectedFieldId}
                onChange={e => setSelectedSectorId(e.target.value)}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="">Seleccionar Sector...</option>
                {selectedField?.sectors?.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha</label>
              <input
                type="date"
                required
                value={applicationDate}
                onChange={e => setApplicationDate(e.target.value)}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
              <select
                value={applicationType}
                onChange={e => setApplicationType(e.target.value)}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="fertilizacion">Fertilización</option>
                <option value="fitosanitario">Fitosanitario</option>
                <option value="riego">Riego</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mojamiento (L/ha)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={waterVolumePerHectare}
                onChange={e => setWaterVolumePerHectare(Number(e.target.value))}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                placeholder="0"
              />
              {selectedSector && waterVolumePerHectare > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                   Total agua: {(waterVolumePerHectare * selectedSector.hectares).toFixed(0)} L
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Productos a Aplicar</h3>
            
            {/* Add Item Row */}
            <div className="flex flex-col gap-4 bg-gray-50 dark:bg-gray-900 p-4 rounded-md">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Producto (Stock Disponible)</label>
                    <select
                      value={currentItem.product_id}
                      onChange={e => setCurrentItem({...currentItem, product_id: e.target.value})}
                      className="mt-1 block w-full py-2 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
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
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de Dosis</label>
                      <div className="flex bg-white dark:bg-gray-800 rounded-md border border-gray-300 dark:border-gray-600 p-0.5">
                          <button
                              type="button"
                              onClick={() => setCurrentItem({...currentItem, dose_input_type: 'ha'})}
                              className={`flex-1 text-xs py-1.5 px-2 rounded ${currentItem.dose_input_type === 'ha' ? 'bg-green-100 text-green-700 font-medium' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'}`}
                          >
                              Por Ha
                          </button>
                          <button
                              type="button"
                              onClick={() => setCurrentItem({...currentItem, dose_input_type: 'hl'})}
                              className={`flex-1 text-xs py-1.5 px-2 rounded ${currentItem.dose_input_type === 'hl' ? 'bg-green-100 text-green-700 font-medium' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'}`}
                          >
                              Por 100L
                          </button>
                      </div>
                  </div>

                  <div className="w-32">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {currentItem.dose_input_type === 'ha' ? 'Dosis / Ha' : 'Dosis / 100L'}
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={currentItem.dose_input_value}
                      onChange={e => setCurrentItem({...currentItem, dose_input_value: Number(e.target.value)})}
                      className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                      placeholder="0"
                    />
                  </div>

                  <div className="w-24">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Unidad</label>
                    <select
                      value={currentItem.dose_unit}
                      onChange={e => setCurrentItem({...currentItem, dose_unit: e.target.value})}
                      className="mt-1 block w-full py-2 px-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
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

                {/* Objective Input */}
                <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Objetivo (Plaga / Enfermedad / Nutrición)</label>
                    <input
                        type="text"
                        list="objectives-list"
                        value={currentItem.objective}
                        onChange={e => setCurrentItem({...currentItem, objective: e.target.value})}
                        className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                        placeholder="Ej: Arañita, Oidio, Corrector de Carencias..."
                    />
                    <datalist id="objectives-list">
                        {uniqueObjectives.map((obj, idx) => (
                            <option key={idx} value={obj} />
                        ))}
                    </datalist>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 items-end justify-between border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
                   {/* Info Display */}
                   <div className="flex-1 flex gap-6 text-sm text-gray-600 dark:text-gray-400">
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
                <div className="shadow overflow-hidden border-b border-gray-200 dark:border-gray-700 sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Producto</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Categoría</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Objetivo</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Dosis/Ha (Real)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Entrada</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Usado</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total $</th>
                        <th className="relative px-6 py-3"><span className="sr-only">Eliminar</span></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {items.map((item, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{item.product_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{item.product_category}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{item.objective || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.dose_per_hectare} {item.unit}/ha</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                              {item.dose_input_value} {item.dose_unit} ({item.dose_input_type === 'ha' ? '/ha' : '/100L'})
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.quantity_used} {item.unit}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatCLP(item.total_cost)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button type="button" onClick={() => editItem(index)} className="text-blue-600 hover:text-blue-900 mr-2" title="Editar item">
                                <Edit className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => removeItem(index)} className="text-red-600 hover:text-red-900" title="Eliminar item">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-gray-50 dark:bg-gray-900">
                          <td colSpan={6} className="px-6 py-4 text-right text-sm font-bold text-gray-900 dark:text-gray-100">Costo Total Aplicación:</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-gray-100">
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
            {editingId && (
                <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="mr-3 inline-flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 focus:outline-none"
                >
                    Cancelar
                </button>
            )}
            <button
              type="submit"
              disabled={loading || items.length === 0 || !selectedFieldId || !selectedSectorId}
              className={`ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${editingId ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500' : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'} disabled:opacity-50`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                  {editingId ? 'Actualizando...' : 'Guardando...'}
                </>
              ) : (
                <>
                  <Save className="-ml-1 mr-2 h-5 w-5" />
                  {editingId ? 'Actualizar Aplicación' : 'Registrar Aplicación'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Objective Stats Summary */}
      {Object.keys(objectiveStats).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(objectiveStats).map(([obj, count]) => (
                  <div key={obj} className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg px-4 py-3 border-l-4 border-green-500">
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                          {obj}
                      </dt>
                      <dd className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                          {count}
                      </dd>
                  </div>
              ))}
          </div>
      )}

      {/* Applications List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Historial de Aplicaciones</h2>
            
            {/* Sector Filter & Download */}
            <div className="flex items-center space-x-4">
                <div className="flex shadow-sm rounded-md">
                    <button
                        onClick={() => handleDownloadFieldPDF('preview')}
                        className="inline-flex items-center px-2 py-1.5 border border-green-300 text-sm font-medium rounded-l-md text-green-700 bg-white dark:bg-gray-800 hover:bg-green-50 focus:z-10 focus:ring-1 focus:ring-green-500 focus:border-green-500"
                        title="Vista Previa PDF Campo"
                    >
                        <Eye className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleDownloadFieldPDF('save')}
                        className="inline-flex items-center px-3 py-1.5 border border-l-0 border-green-300 text-sm font-medium rounded-r-md text-green-700 bg-white dark:bg-gray-800 hover:bg-green-50 focus:z-10 focus:ring-1 focus:ring-green-500 focus:border-green-500"
                        title="Descargar PDF de Campo"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        PDF Campo
                    </button>
                </div>

                <div className="flex shadow-sm rounded-md">
                    <button
                        onClick={() => handleDownloadPDF('preview')}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-l-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 focus:z-10 focus:ring-1 focus:ring-green-500 focus:border-green-500"
                        title="Previsualizar Libro"
                    >
                        <Eye className="h-4 w-4 mr-2" />
                        Previsualizar Libro
                    </button>
                    <button
                        onClick={() => handleDownloadPDF('save')}
                        className="inline-flex items-center px-3 py-1.5 border border-l-0 border-green-600 text-sm font-medium rounded-r-md text-white bg-green-600 hover:bg-green-700 focus:z-10 focus:ring-1 focus:ring-green-500 focus:border-green-500"
                        title="Exportar Libro de Campo (GlobalG.A.P)"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Exportar Libro de Campo (GlobalG.A.P)
                    </button>
                </div>

                <div className="flex shadow-sm rounded-md">
                    <button
                        onClick={() => handleDownloadDetailedReport('preview')}
                        className="inline-flex items-center px-2 py-1.5 border border-purple-300 text-sm font-medium rounded-l-md text-purple-700 bg-white dark:bg-gray-800 hover:bg-purple-50 focus:z-10 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                        title="Vista Previa Reporte Detallado"
                    >
                        <Eye className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleDownloadDetailedReport('save')}
                        className="inline-flex items-center px-3 py-1.5 border border-l-0 border-purple-300 text-sm font-medium rounded-r-md text-purple-700 bg-white dark:bg-gray-800 hover:bg-purple-50 focus:z-10 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                        title="Descargar Reporte Detallado (Tabla)"
                    >
                        <FileText className="h-4 w-4 mr-2" />
                        Detalle
                    </button>
                </div>

                <div className="flex items-center space-x-2">
                    <Filter className="h-4 w-4 text-gray-400" />
                    <select
                        value={filterSectorId}
                        onChange={(e) => setFilterSectorId(e.target.value)}
                        className="block w-48 py-1.5 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    >
                        <option value="all">Todos los Sectores</option>
                        {/* Unique sectors from history */}
                        {Array.from(new Set(applications.map(a => JSON.stringify({id: a.sector_id, name: a.sector_name}))))
                            .map(s => JSON.parse(s))
                            .map((sector: any) => (
                                <option key={sector.id} value={sector.id}>{sector.name}</option>
                            ))
                        }
                    </select>
                </div>
            </div>
        </div>
        {applications.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">No hay aplicaciones registradas.</div>
        ) : (
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Lugar</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tipo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Detalles</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Costo Total</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {applications
                            .filter(app => filterSectorId === 'all' || app.sector_id === filterSectorId)
                            .map((app) => (
                            <tr key={app.id} className={editingId === app.id ? 'bg-blue-50' : ''}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    <div className="flex items-center">
                                        <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                        {/* Parse date manually to avoid timezone shift */}
                                        {(() => {
                                            const [y, m, d] = app.application_date.split('T')[0].split('-');
                                            return `${d}/${m}/${y}`;
                                        })()}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    <div className="flex flex-col">
                                        <span className="font-medium">{app.field_name}</span>
                                        <span className="text-gray-500 dark:text-gray-400 text-xs flex items-center mt-0.5">
                                            <MapPin className="h-3 w-3 mr-1" />
                                            {app.sector_name} ({app.sector_hectares} ha)
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 capitalize">
                                    {app.application_type}
                                    {app.water_liters_per_hectare > 0 && (
                                        <div className="text-xs text-blue-500 flex items-center mt-1">
                                            <Droplets className="h-3 w-3 mr-1" />
                                            {app.water_liters_per_hectare} L/ha
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                    <ul className="list-disc pl-4 space-y-1">
                                        {app.items?.map((item, idx) => (
                                            <li key={idx} className="text-xs">
                                                <span className="font-medium text-gray-700 dark:text-gray-300">{item.product_name}</span> 
                                                {item.objective && <span className="text-green-600 font-medium"> ({item.objective})</span>}:
                                                {' '}{item.dose_per_hectare} {item.unit}/ha
                                                {' '}<span className="text-gray-400">({item.quantity_used} {item.unit} total)</span>
                                            </li>
                                        ))}
                                    </ul>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                                    {formatCLP(app.total_cost)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    {userRole !== 'viewer' && (
                                      <>
                                        <button 
                                            onClick={() => handleEditApplication(app)}
                                            className="text-blue-600 hover:text-blue-900 mr-3"
                                            title="Editar aplicación"
                                        >
                                            <Edit className="h-5 w-5" />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteApplication(app.id)}
                                            className="text-red-600 hover:text-red-900"
                                            title="Eliminar y restaurar stock"
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </button>
                                      </>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
      
      <PdfPreviewModal 
        isOpen={pdfPreviewOpen}
        onClose={() => setPdfPreviewOpen(false)}
        title={pdfPreviewTitle}
        pdfUrl={pdfPreviewUrl}
      />
    </div>
  );
};
