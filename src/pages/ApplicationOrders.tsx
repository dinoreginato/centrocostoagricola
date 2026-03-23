import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Loader2, Save, Trash2, Calendar, FileText, Printer, CheckCircle, XCircle, Search, Edit } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';

// Interfaces based on DB Schema
interface ApplicationOrder {
    id: string;
    order_number: number;
    scheduled_date: string;
    completed_date?: string; // New field for actual execution date
    status: 'pendiente' | 'completada' | 'cancelada';
    field_id: string;
    sector_id: string;
    application_type: string;
    water_liters_per_hectare: number;
  tank_capacity: number;
  tractor_id?: string;
  sprayer_id?: string;
  tractor_driver_id?: string;
  speed?: number;
  pressure?: number;
  rpm?: number;
  nozzles?: string;
  notes?: string;
  safety_period_hours?: number;
  grace_period_days?: number;
  
  // New Fields
  variety?: string;
  objective?: string; // Global objective
  
  // Relations
  field?: { name: string };
  sector?: { name: string; hectares: number };
  tractor?: { name: string };
  sprayer?: { name: string };
  driver?: { name: string };
  
  items?: OrderItem[];
}

interface OrderItem {
  id?: string;
  product_id: string;
  product_name: string;
  active_ingredient?: string; // For display
  category?: string; // For display
  stock?: number; // For display
  unit: string;
  dose_per_hectare: number;
  dose_per_100l?: number;
  total_quantity: number;
  objective?: string; // Per item objective (optional now)
}

// Reuse Interfaces from other parts
interface Field { id: string; name: string; sectors: Sector[] }
interface Sector { id: string; name: string; hectares: number }
interface Product { id: string; name: string; unit: string; current_stock: number; category: string; active_ingredient?: string; average_cost: number }
interface Machine { id: string; name: string; type: string }
interface Worker { id: string; name: string; role: string }

const AGROCHEMICAL_CATEGORIES = [
  'Quimicos', 'Plaguicida', 'Insecticida', 'Fungicida', 'Herbicida', 'Fertilizantes', 
  'fertilizante', 'pesticida', 'herbicida', 'fungicida'
];

export const ApplicationOrders: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [orders, setOrders] = useState<ApplicationOrder[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  
  // PDF Preview State
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('');

  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Partial<ApplicationOrder>>({
    scheduled_date: new Date().toLocaleDateString('en-CA'),
    status: 'pendiente',
    application_type: 'fitosanitario',
    water_liters_per_hectare: 1000,
    tank_capacity: 2000,
    items: [],
    variety: '',
    objective: ''
  });
  
  // Item Form State
  const [currentItem, setCurrentItem] = useState<{
    product_id: string;
    dose_input_value: number;
    dose_input_type: 'ha' | 'hl';
    objective: string;
    unit_override: string; // New field for specific unit (cc, L, kg, gr)
  }>({
    product_id: '',
    dose_input_value: 0,
    dose_input_type: 'hl', // Default to concentration for orders usually
    objective: '',
    unit_override: ''
  });

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    setLoading(true);
    try {
        // 1. Load Orders
        const { data: ordersData, error: ordersError } = await supabase
            .from('application_orders')
            .select(`
                *,
                field:fields(name),
                sector:sectors(name, hectares),
                tractor:machines!application_orders_tractor_id_fkey(name),
                sprayer:machines!application_orders_sprayer_id_fkey(name),
                driver:workers(name),
                items:application_order_items(
                    *,
                    product:products(name, unit, active_ingredient, category)
                )
            `)
            .eq('company_id', selectedCompany.id)
            .order('created_at', { ascending: false });

        if (ordersError) throw ordersError;
        
        // Map items to flatten structure
        const mappedOrders = ordersData?.map(o => ({
            ...o,
            items: Array.isArray(o.items) ? o.items.map((i: any) => ({
                id: i.id,
                product_id: i.product_id,
                product_name: i.product?.name,
                active_ingredient: i.product?.active_ingredient,
                category: i.product?.category,
                unit: i.unit,
                dose_per_hectare: i.dose_per_hectare,
                dose_per_100l: i.dose_per_100l,
                total_quantity: i.total_quantity,
                objective: i.objective
            })) : []
        }));
        
        setOrders(mappedOrders || []);

        // 2. Load Metadata (Fields, Products, Machines, Workers)
        const [fieldsRes, productsRes, machinesRes, workersRes] = await Promise.all([
            supabase.from('fields').select('*, sectors(*)').eq('company_id', selectedCompany.id),
            supabase.from('products').select('*').eq('company_id', selectedCompany.id).in('category', AGROCHEMICAL_CATEGORIES).gt('current_stock', 0),
            supabase.from('machines').select('id, name, type').eq('company_id', selectedCompany.id).eq('is_active', true),
            supabase.from('workers').select('id, name, role').eq('company_id', selectedCompany.id).eq('is_active', true)
        ]);

        setFields(fieldsRes.data || []);
        setProducts(productsRes.data || []);
        setMachines(machinesRes.data || []);
        setWorkers(workersRes.data || []);

    } catch (error: any) {
        console.error('Error loading data:', error);
        alert('Error cargando datos: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleAddItem = () => {
      const product = products.find(p => p.id === currentItem.product_id);
      if (!product || currentItem.dose_input_value <= 0) return;

      const field = fields.find(f => f.id === currentOrder.field_id);
      const sector = field?.sectors.find(s => s.id === currentOrder.sector_id);
      
      if (!sector) {
          alert('Seleccione un sector primero para calcular totales.');
          return;
      }

      let doseHa = 0;
      let dose100L = 0;
      let totalQty = 0;

      // Calculation Logic
      if (currentItem.dose_input_type === 'ha') {
          doseHa = currentItem.dose_input_value;
          // Calculate theoretical concentration if water volume is known
          if (currentOrder.water_liters_per_hectare && currentOrder.water_liters_per_hectare > 0) {
              dose100L = (doseHa / currentOrder.water_liters_per_hectare) * 100;
          }
      } else {
          // Input is per 100L
          dose100L = currentItem.dose_input_value;
          if (currentOrder.water_liters_per_hectare && currentOrder.water_liters_per_hectare > 0) {
              doseHa = (dose100L * currentOrder.water_liters_per_hectare) / 100;
          } else {
              alert('Debe ingresar el Mojamiento (L/ha) para calcular la dosis por hectárea.');
              return;
          }
      }

      totalQty = doseHa * sector.hectares;

      if (totalQty > product.current_stock) {
          alert(`¡Advertencia de Stock!\n\nEstás ordenando aplicar ${totalQty.toFixed(2)} ${currentItem.unit_override || product.unit} de ${product.name}, pero solo tienes ${product.current_stock} en bodega.`);
      }

      const newItem: OrderItem = {
          product_id: product.id,
          product_name: product.name,
          active_ingredient: product.active_ingredient,
          category: product.category,
          unit: currentItem.unit_override || product.unit,
          stock: product.current_stock,
          dose_per_hectare: Number(doseHa.toFixed(4)),
          dose_per_100l: Number(dose100L.toFixed(4)),
          total_quantity: Number(totalQty.toFixed(4)),
          objective: currentItem.objective // Optional per item
      };

      setCurrentOrder(prev => ({
          ...prev,
          items: [...(prev.items || []), newItem]
      }));

      setCurrentItem({ product_id: '', dose_input_value: 0, dose_input_type: 'hl', objective: '', unit_override: '' });
  };

  const handleRemoveItem = (index: number) => {
      const newItems = [...(currentOrder.items || [])];
      newItems.splice(index, 1);
      setCurrentOrder({...currentOrder, items: newItems});
  };

  const handleSaveOrder = async () => {
      if (!currentOrder.field_id || !currentOrder.sector_id || !currentOrder.items?.length) {
          alert('Complete los campos obligatorios (Campo, Sector, Items)');
          return;
      }

      setLoading(true);
      try {
          // 1. Insert/Update Order Header
          const orderData = {
              company_id: selectedCompany.id,
              field_id: currentOrder.field_id,
              sector_id: currentOrder.sector_id,
              scheduled_date: currentOrder.scheduled_date,
              completed_date: currentOrder.completed_date || null,
              status: currentOrder.status,
              application_type: currentOrder.application_type,
              water_liters_per_hectare: currentOrder.water_liters_per_hectare,
              tank_capacity: currentOrder.tank_capacity,
              tractor_id: currentOrder.tractor_id || null,
              sprayer_id: currentOrder.sprayer_id || null,
              tractor_driver_id: currentOrder.tractor_driver_id || null,
              speed: currentOrder.speed,
              pressure: currentOrder.pressure,
              rpm: currentOrder.rpm,
              nozzles: currentOrder.nozzles,
              notes: currentOrder.notes,
              safety_period_hours: currentOrder.safety_period_hours,
              grace_period_days: currentOrder.grace_period_days,
              updated_at: new Date().toISOString(),
              variety: currentOrder.variety, // New field
              objective: currentOrder.objective // New field
          };

          let orderId = currentOrder.id;

          if (orderId) {
              const { error } = await supabase.from('application_orders').update(orderData).eq('id', orderId);
              if (error) throw error;
              // Delete old items to rewrite
              await supabase.from('application_order_items').delete().eq('order_id', orderId);
          } else {
              const { data, error } = await supabase.from('application_orders').insert([orderData]).select().single();
              if (error) throw error;
              orderId = data.id;
          }

          // 2. Insert Items
          const itemsData = currentOrder.items.map(item => ({
              order_id: orderId,
              product_id: item.product_id,
              dose_per_hectare: item.dose_per_hectare,
              dose_per_100l: item.dose_per_100l,
              total_quantity: item.total_quantity,
              unit: item.unit,
              objective: item.objective
          }));

          const { error: itemsError } = await supabase.from('application_order_items').insert(itemsData);
          if (itemsError) throw itemsError;

          alert('Orden guardada correctamente');
          setIsEditing(false);
          loadData();

      } catch (error: any) {
          console.error('Error saving order:', error);
          alert('Error al guardar: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleDeleteOrder = async (id: string) => {
      if (!window.confirm('¿Está seguro de eliminar esta orden de aplicación? Esta acción no se puede deshacer.')) {
          return;
      }

      setLoading(true);
      try {
          // First delete items to avoid foreign key constraints
          await supabase.from('application_order_items').delete().eq('order_id', id);
          
          // Then delete the order
          const { error } = await supabase.from('application_orders').delete().eq('id', id);
          if (error) throw error;
          
          loadData();
      } catch (error: any) {
          console.error('Error deleting order:', error);
          alert('Error al eliminar: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handlePrintOrder = (order: ApplicationOrder) => {
      const doc = new jsPDF();
      
      // -- Header Section --
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text('ORDEN DE APLICACIÓN DE AGROQUÍMICOS', 105, 20, { align: 'center' });
      
      // Folio Top Right
      doc.setFontSize(10);
      doc.text('FOLIO N°', 170, 15);
      doc.setFontSize(14);
      doc.setTextColor(220, 38, 38); // Red color for folio
      doc.text(`${order.order_number}`, 170, 22);
      doc.setTextColor(0, 0, 0); // Reset color
      
      // -- Box 1: General Info --
      doc.setDrawColor(200);
      doc.setFillColor(245, 245, 245);
      doc.roundedRect(14, 30, 182, 45, 3, 3, 'FD'); // Box
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      
      // Row 1
      doc.text('PRODUCTOR:', 18, 40);
      doc.setFont("helvetica", "normal");
      doc.text(selectedCompany?.name || 'Inversiones Regis Ltda', 45, 40);
      
      doc.setFont("helvetica", "bold");
      doc.text('FECHA:', 120, 40);
      doc.setFont("helvetica", "normal");
      // Format date to local to avoid timezone shift
      const localDate = new Date(order.scheduled_date + 'T00:00:00');
      doc.text(localDate.toLocaleDateString('es-CL'), 140, 40);

      // Row 2
      doc.setFont("helvetica", "bold");
      doc.text('HUERTO:', 18, 50);
      doc.setFont("helvetica", "normal");
      doc.text(order.field?.name || '', 45, 50);

      doc.setFont("helvetica", "bold");
      doc.text('SECTOR:', 90, 50);
      doc.setFont("helvetica", "normal");
      doc.text(order.sector?.name || '', 110, 50);

      doc.setFont("helvetica", "bold");
      doc.text('HAS:', 155, 50);
      doc.setFont("helvetica", "normal");
      doc.text(order.sector?.hectares ? order.sector.hectares.toString() : '', 165, 50);

      // Row 3
      doc.setFont("helvetica", "bold");
      doc.text('VARIEDAD:', 18, 60);
      doc.setFont("helvetica", "normal");
      doc.text(order.variety || '', 45, 60);

      doc.setFont("helvetica", "bold");
      doc.text('OBJETIVO:', 90, 60);
      doc.setFont("helvetica", "normal");
      doc.text(order.objective || order.application_type || '', 110, 60);

      // Row 4
      doc.setFont("helvetica", "bold");
      doc.text('MOJAMIENTO:', 18, 70);
      doc.setFont("helvetica", "normal");
      doc.text(`${order.water_liters_per_hectare || 0} Lts / ha`, 45, 70);
      
      // -- Products Table --
      const tableData = order.items?.map(item => [
          item.product_name,
          item.active_ingredient || '-',
          item.dose_per_100l ? `${item.dose_per_100l} ${item.unit || 'L/Kg'}` : '-',
          item.dose_per_hectare ? `${item.dose_per_hectare} ${item.unit || 'L/Kg'}` : '-',
          `${item.total_quantity} ${item.unit || 'L/Kg'}`
      ]) || [];

      autoTable(doc, {
          startY: 82,
          head: [['PRODUCTO', 'INGREDIENTE ACTIVO', 'DOSIS / 100L', 'DOSIS / Ha', 'TOTAL A PEDIR']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [41, 128, 185], fontSize: 9 },
          styles: { fontSize: 9, cellPadding: 4 },
          columnStyles: {
              0: { cellWidth: 50 },
              2: { halign: 'center' },
              3: { halign: 'center' },
              4: { halign: 'center', fontStyle: 'bold', textColor: [41, 128, 185] }
          }
      });

      let currentY = (doc as any).lastAutoTable.finalY + 15;

      // -- Box 2: Machinery & Observations --
      doc.setDrawColor(200);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(14, currentY, 182, 65, 3, 3, 'FD');

      doc.setFont("helvetica", "bold");
      doc.text('DATOS DE APLICACIÓN Y MAQUINARIA', 18, currentY + 8);
      
      doc.setFontSize(9);
      doc.text('Maquinaria:', 18, currentY + 18);
      doc.setFont("helvetica", "normal");
      doc.text(`${order.tractor?.name || '-'} / ${order.sprayer?.name || '-'}`, 45, currentY + 18);

      doc.setFont("helvetica", "bold");
      doc.text('Operador:', 100, currentY + 18);
      doc.setFont("helvetica", "normal");
      doc.text(`${order.driver?.name || '-'}`, 120, currentY + 18);

      doc.setFont("helvetica", "bold");
      doc.text('Parámetros:', 18, currentY + 28);
      doc.setFont("helvetica", "normal");
      doc.text(`Velocidad: ${order.speed || '-'} km/h  |  Presión: ${order.pressure || '-'} bar  |  RPM: ${order.rpm || '-'}  |  Boquillas: ${order.nozzles || '-'}`, 45, currentY + 28);

      doc.setFont("helvetica", "bold");
      doc.text('Carencia/Reingreso:', 18, currentY + 38);
      doc.setFont("helvetica", "normal");
      doc.text(`Reingreso: ${order.safety_period_hours || 0} hrs  |  Carencia: ${order.grace_period_days || 0} días`, 55, currentY + 38);

      doc.setFont("helvetica", "bold");
      doc.text('Observaciones:', 18, currentY + 48);
      doc.setFont("helvetica", "normal");
      const splitNotes = doc.splitTextToSize(order.notes || 'Ninguna.', 150);
      doc.text(splitNotes, 45, currentY + 48);

      // -- Signatures --
      currentY += 90;
      doc.line(30, currentY, 80, currentY);
      doc.text('Firma Preparador / Entrega', 35, currentY + 5);

      doc.line(130, currentY, 180, currentY);
      doc.text('Firma Operador / Recibe', 135, currentY + 5);

      // -- Footer --
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('Documento generado por Sistema de Control Agrícola', 105, 285, { align: 'center' });

      const pdfBlob = doc.output('bloburl');
      setPdfPreviewUrl(pdfBlob.toString());
      setPdfPreviewTitle(`Orden N° ${order.order_number}`);
      setPdfPreviewOpen(true);
  };

  const getStatusColor = (status: string) => {
      switch(status) {
          case 'pendiente': return 'bg-yellow-100 text-yellow-800';
          case 'completada': return 'bg-green-100 text-green-800';
          case 'cancelada': return 'bg-red-100 text-red-800';
          default: return 'bg-gray-100 text-gray-800';
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Ordenes de Aplicación</h1>
        {!isEditing && (
            <button
                onClick={() => {
                    setCurrentOrder({
                        scheduled_date: new Date().toLocaleDateString('en-CA'),
                        status: 'pendiente',
                        application_type: 'fitosanitario',
                        water_liters_per_hectare: 1000,
                        tank_capacity: 2000,
                        items: [],
                        variety: '',
                        objective: ''
                    });
                    setIsEditing(true);
                }}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md flex items-center"
            >
                <Plus className="h-5 w-5 mr-2" /> Nueva Orden
            </button>
        )}
      </div>

      {isEditing ? (
          <div className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between mb-6">
                  <h2 className="text-lg font-bold">Crear/Editar Orden</h2>
                  <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">Cancelar</button>
              </div>

              {/* Form Header Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Fecha Planificada</label>
                      <input 
                          type="date" 
                          value={currentOrder.scheduled_date}
                          onChange={e => setCurrentOrder({...currentOrder, scheduled_date: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Estado</label>
                      <select 
                          value={currentOrder.status}
                          onChange={e => {
                              const newStatus = e.target.value;
                              const updates: any = { status: newStatus };
                              if (newStatus === 'completada') {
                                  // Asignar fecha de completado automáticamente a hoy si no la tiene
                                  if (!currentOrder.completed_date) {
                                      updates.completed_date = new Date().toLocaleDateString('en-CA');
                                  }
                              } else {
                                  // Limpiar fecha completada si se pasa a pendiente o cancelada
                                  updates.completed_date = null;
                              }
                              setCurrentOrder({...currentOrder, ...updates});
                          }}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                      >
                          <option value="pendiente">Pendiente</option>
                          <option value="completada">Completada / Realizada</option>
                          <option value="cancelada">Cancelada</option>
                      </select>
                  </div>
                  {currentOrder.status === 'completada' && (
                      <div>
                          <label className="block text-sm font-medium text-gray-700">Fecha de Realización</label>
                          <input 
                              type="date" 
                              value={currentOrder.completed_date || ''}
                              onChange={e => setCurrentOrder({...currentOrder, completed_date: e.target.value})}
                              className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-green-50 border-green-200"
                              required
                          />
                      </div>
                  )}
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Objetivo Aplicación</label>
                      <input 
                          type="text" 
                          value={currentOrder.objective || ''}
                          onChange={e => setCurrentOrder({...currentOrder, objective: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                          placeholder="Ej: Polilla, Arañita, etc."
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Campo</label>
                      <select 
                          value={currentOrder.field_id || ''}
                          onChange={e => setCurrentOrder({...currentOrder, field_id: e.target.value, sector_id: ''})}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                      >
                          <option value="">Seleccione...</option>
                          {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Sector</label>
                      <select 
                          value={currentOrder.sector_id || ''}
                          onChange={e => setCurrentOrder({...currentOrder, sector_id: e.target.value})}
                          disabled={!currentOrder.field_id}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                      >
                          <option value="">Seleccione...</option>
                          {fields.find(f => f.id === currentOrder.field_id)?.sectors?.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>
                          ))}
                      </select>
                  </div>
                   <div>
                      <label className="block text-sm font-medium text-gray-700">Variedad</label>
                      <input 
                          type="text" 
                          value={currentOrder.variety || ''}
                          onChange={e => setCurrentOrder({...currentOrder, variety: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                          placeholder="Ej: Forelle"
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Tipo</label>
                      <select 
                          value={currentOrder.application_type}
                          onChange={e => setCurrentOrder({...currentOrder, application_type: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                      >
                          <option value="fitosanitario">Fitosanitario</option>
                          <option value="fertilizacion">Fertilización</option>
                          <option value="herbicida">Herbicida</option>
                      </select>
                  </div>
              </div>

              {/* Items Section */}
              <div className="border rounded-md p-4 mb-6">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">Productos y Dosis</h3>
                  
                  {/* Add Item Form */}
                  <div className="flex flex-wrap items-end gap-2 mb-4 bg-gray-50 p-3 rounded">
                      <div className="flex-1 min-w-[200px]">
                          <label className="block text-xs text-gray-500">Producto</label>
                          <select 
                              value={currentItem.product_id}
                              onChange={e => setCurrentItem({...currentItem, product_id: e.target.value})}
                              className="w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">Seleccione...</option>
                              {products?.map(p => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.current_stock} {p.unit})</option>
                              ))}
                          </select>
                      </div>
                      <div className="w-24">
                          <label className="block text-xs text-gray-500">Tipo Dosis</label>
                          <select 
                              value={currentItem.dose_input_type}
                              onChange={e => setCurrentItem({...currentItem, dose_input_type: e.target.value as any})}
                              className="w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="hl">/ 100L</option>
                              <option value="ha">/ Ha</option>
                          </select>
                      </div>
                      <div className="w-24">
                          <label className="block text-xs text-gray-500">Dosis</label>
                          <input 
                              type="number" 
                              value={currentItem.dose_input_value}
                              onChange={e => setCurrentItem({...currentItem, dose_input_value: Number(e.target.value)})}
                              className="w-full border border-gray-300 rounded p-1.5 text-sm"
                          />
                      </div>
                      <div className="w-24">
                          <label className="block text-xs text-gray-500">Unidad</label>
                          <select 
                              value={currentItem.unit_override}
                              onChange={e => setCurrentItem({...currentItem, unit_override: e.target.value})}
                              className="w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">Auto</option>
                              <option value="L">L</option>
                              <option value="cc">cc</option>
                              <option value="Kg">Kg</option>
                              <option value="gr">gr</option>
                          </select>
                      </div>
                      <button 
                          onClick={handleAddItem}
                          className="bg-blue-600 text-white p-1.5 rounded hover:bg-blue-700"
                      >
                          <Plus className="h-5 w-5" />
                      </button>
                  </div>

                  {/* Items Table */}
                  <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                          <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Producto</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Dosis / 100L</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Dosis / Ha</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Total a Pedir</th>
                              <th className="px-3 py-2"></th>
                          </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                          {currentOrder.items?.map((item, idx) => (
                              <tr key={idx}>
                                  <td className="px-3 py-2 text-sm">
                                      <div className="font-medium">{item.product_name}</div>
                                      <div className="text-xs text-gray-500">{item.active_ingredient}</div>
                                  </td>
                                  <td className="px-3 py-2 text-sm">{item.dose_per_100l ? `${item.dose_per_100l} ${item.unit}` : '-'}</td>
                                  <td className="px-3 py-2 text-sm">{item.dose_per_hectare} {item.unit}</td>
                                  <td className="px-3 py-2 text-sm font-bold">{item.total_quantity} {item.unit}</td>
                                  <td className="px-3 py-2 text-right">
                                      <button onClick={() => handleRemoveItem(idx)} className="text-red-600 hover:text-red-800">
                                          <Trash2 className="h-4 w-4" />
                                      </button>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>

              {/* Machinery & Tech Specs (Collapsed/Secondary) */}
              <div className="bg-gray-50 p-4 rounded-md mb-6">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">Parámetros Técnicos y Maquinaria</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                          <label className="block text-xs text-gray-500">Mojamiento (L/ha)</label>
                          <input 
                              type="number" 
                              value={currentOrder.water_liters_per_hectare}
                              onChange={e => setCurrentOrder({...currentOrder, water_liters_per_hectare: Number(e.target.value)})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          />
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Tractor</label>
                          <select 
                              value={currentOrder.tractor_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, tractor_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {machines.filter(m => m.type?.toLowerCase().includes('tractor')).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Equipo</label>
                          <select 
                              value={currentOrder.sprayer_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, sprayer_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {machines.filter(m => !m.type?.toLowerCase().includes('tractor')).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Operador</label>
                          <select 
                              value={currentOrder.tractor_driver_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, tractor_driver_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {workers?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                      </div>
                      {/* Optional Params */}
                      <div>
                          <label className="block text-xs text-gray-500">Velocidad</label>
                          <input type="number" value={currentOrder.speed || ''} onChange={e => setCurrentOrder({...currentOrder, speed: Number(e.target.value)})} className="w-full border p-1 rounded text-sm"/>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Presión</label>
                          <input type="number" value={currentOrder.pressure || ''} onChange={e => setCurrentOrder({...currentOrder, pressure: Number(e.target.value)})} className="w-full border p-1 rounded text-sm"/>
                      </div>
                       <div>
                          <label className="block text-xs text-gray-500">Boquillas</label>
                          <input type="text" value={currentOrder.nozzles || ''} onChange={e => setCurrentOrder({...currentOrder, nozzles: e.target.value})} className="w-full border p-1 rounded text-sm"/>
                      </div>
                  </div>
              </div>

              {/* Footer Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Observaciones</label>
                      <textarea 
                          value={currentOrder.notes || ''}
                          onChange={e => setCurrentOrder({...currentOrder, notes: e.target.value})}
                          rows={3}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2 text-sm"
                          placeholder="Notas adicionales..."
                      />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700">Reingreso (hrs)</label>
                          <input 
                              type="number" 
                              value={currentOrder.safety_period_hours || 0}
                              onChange={e => setCurrentOrder({...currentOrder, safety_period_hours: Number(e.target.value)})}
                              className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700">Carencia (días)</label>
                          <input 
                              type="number" 
                              value={currentOrder.grace_period_days || 0}
                              onChange={e => setCurrentOrder({...currentOrder, grace_period_days: Number(e.target.value)})}
                              className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                          />
                      </div>
                  </div>
              </div>

              <div className="flex justify-end gap-3">
                  <button 
                      onClick={handleSaveOrder}
                      disabled={loading}
                      className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 flex items-center"
                  >
                      {loading ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                      Guardar Orden
                  </button>
              </div>
          </div>
      ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                      <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">N°</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Huerto/Sector</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Objetivo</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                      </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                      {orders.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">#{order.order_number}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  <div>Plan: {new Date(order.scheduled_date + 'T12:00:00').toLocaleDateString()}</div>
                                  {order.completed_date && (
                                      <div className="text-green-600 font-medium">Realizada: {new Date(order.completed_date + 'T12:00:00').toLocaleDateString()}</div>
                                  )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  <div>{order.field?.name}</div>
                                  <div className="text-xs text-gray-500">{order.sector?.name}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{order.objective || '-'}</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)}`}>
                                      {order.status.toUpperCase()}
                                  </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end gap-2">
                                  <button 
                                      onClick={() => handlePrintOrder(order)}
                                      className="text-gray-600 hover:text-gray-900"
                                      title="Imprimir PDF"
                                  >
                                      <Printer className="h-5 w-5" />
                                  </button>
                                  <button 
                                      onClick={() => {
                                          setCurrentOrder(order);
                                          setIsEditing(true);
                                      }}
                                      className="text-blue-600 hover:text-blue-900"
                                      title="Editar"
                                  >
                                      <Edit className="h-5 w-5" />
                                  </button>
                                  <button 
                                      onClick={() => handleDeleteOrder(order.id)}
                                      className="text-red-600 hover:text-red-900 ml-2"
                                      title="Eliminar"
                                  >
                                      <Trash2 className="h-5 w-5" />
                                  </button>
                              </td>
                          </tr>
                      ))}
                      {orders.length === 0 && (
                          <tr>
                              <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No hay ordenes registradas</td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      )}

      <PdfPreviewModal 
        isOpen={pdfPreviewOpen}
        onClose={() => setPdfPreviewOpen(false)}
        title={pdfPreviewTitle}
        pdfUrl={pdfPreviewUrl}
      />
    </div>
  );
};
