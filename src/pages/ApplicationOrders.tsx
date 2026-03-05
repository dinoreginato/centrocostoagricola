import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Loader2, Save, Trash2, Calendar, FileText, Printer, CheckCircle, XCircle, Search, Edit } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Interfaces based on DB Schema
interface ApplicationOrder {
  id: string;
  order_number: number;
  scheduled_date: string;
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
  objective?: string;
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

  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Partial<ApplicationOrder>>({
    scheduled_date: new Date().toISOString().split('T')[0],
    status: 'pendiente',
    application_type: 'fitosanitario',
    water_liters_per_hectare: 1000,
    tank_capacity: 2000,
    items: []
  });
  
  // Item Form State
  const [currentItem, setCurrentItem] = useState<{
    product_id: string;
    dose_input_value: number;
    dose_input_type: 'ha' | 'hl';
    objective: string;
  }>({
    product_id: '',
    dose_input_value: 0,
    dose_input_type: 'hl', // Default to concentration for orders usually
    objective: ''
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
            items: o.items.map((i: any) => ({
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
            }))
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
      // Assumption: dose_unit is always product.unit for simplicity in this version, 
      // or we handle conversion if we want to be fancy later.
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

      const newItem: OrderItem = {
          product_id: product.id,
          product_name: product.name,
          active_ingredient: product.active_ingredient,
          category: product.category,
          unit: product.unit,
          stock: product.current_stock,
          dose_per_hectare: Number(doseHa.toFixed(4)),
          dose_per_100l: Number(dose100L.toFixed(4)),
          total_quantity: Number(totalQty.toFixed(4)),
          objective: currentItem.objective
      };

      setCurrentOrder(prev => ({
          ...prev,
          items: [...(prev.items || []), newItem]
      }));

      setCurrentItem({ product_id: '', dose_input_value: 0, dose_input_type: 'hl', objective: '' });
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
              updated_at: new Date().toISOString()
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

  const handlePrintOrder = (order: ApplicationOrder) => {
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(16);
      doc.text('ORDEN DE APLICACIÓN', 105, 20, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`N° Orden: ${order.order_number}`, 180, 20, { align: 'right' });
      doc.text(`Fecha Programada: ${new Date(order.scheduled_date).toLocaleDateString()}`, 14, 30);
      
      // Info Box
      doc.setDrawColor(0);
      doc.rect(14, 35, 182, 35);
      
      doc.setFont("helvetica", "bold");
      doc.text('Ubicación:', 16, 42);
      doc.text('Responsables:', 100, 42);
      
      doc.setFont("helvetica", "normal");
      doc.text(`Campo: ${order.field?.name}`, 16, 48);
      doc.text(`Sector: ${order.sector?.name} (${order.sector?.hectares} ha)`, 16, 54);
      doc.text(`Tipo: ${order.application_type}`, 16, 60);
      
      doc.text(`Tractorista: ${order.driver?.name || 'Por definir'}`, 100, 48);
      doc.text(`Tractor: ${order.tractor?.name || '-'}`, 100, 54);
      doc.text(`Equipo: ${order.sprayer?.name || '-'}`, 100, 60);

      // Technical Params
      doc.setFont("helvetica", "bold");
      doc.text('Parámetros Técnicos:', 14, 80);
      
      const params = [
          ['Mojamiento', `${order.water_liters_per_hectare} L/ha`],
          ['Cap. Tanque', `${order.tank_capacity} L`],
          ['Velocidad', order.speed ? `${order.speed} km/h` : '-'],
          ['Presión', order.pressure ? `${order.pressure} bar` : '-'],
          ['Boquillas', order.nozzles || '-'],
          ['RPM', order.rpm ? `${order.rpm}` : '-'],
      ];
      
      autoTable(doc, {
          startY: 85,
          head: [['Parámetro', 'Valor', 'Parámetro', 'Valor', 'Parámetro', 'Valor']],
          body: [
              [params[0][0], params[0][1], params[2][0], params[2][1], params[4][0], params[4][1]],
              [params[1][0], params[1][1], params[3][0], params[3][1], params[5][0], params[5][1]],
          ],
          theme: 'plain',
          styles: { fontSize: 10, cellPadding: 2 },
      });

      // Products Table
      doc.text('Productos a Aplicar:', 14, (doc as any).lastAutoTable.finalY + 10);
      
      const productRows = order.items?.map(item => [
          item.product_name,
          item.active_ingredient || '-',
          item.objective || '-',
          `${item.dose_per_100l ? item.dose_per_100l + ' ' + item.unit + '/100L' : '-'}`,
          `${item.dose_per_hectare} ${item.unit}/ha`,
          `${item.total_quantity} ${item.unit}`
      ]);

      autoTable(doc, {
          startY: (doc as any).lastAutoTable.finalY + 15,
          head: [['Producto', 'Ing. Activo', 'Objetivo', 'Dosis (100L)', 'Dosis (Ha)', 'Total a Pedir']],
          body: productRows,
          headStyles: { fillColor: [46, 125, 50] },
          styles: { fontSize: 9 }
      });

      // Instructions/Notes
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFont("helvetica", "bold");
      doc.text('Instrucciones Especiales / Seguridad:', 14, finalY);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Reingreso: ${order.safety_period_hours || 0} horas`, 14, finalY + 6);
      doc.text(`Carencia: ${order.grace_period_days || 0} días`, 60, finalY + 6);
      
      if (order.notes) {
          doc.text(`Notas: ${order.notes}`, 14, finalY + 12);
      }

      // Signatures
      doc.line(20, 270, 80, 270);
      doc.text('Firma Responsable', 30, 275);
      
      doc.line(120, 270, 180, 270);
      doc.text('Firma Aplicador', 135, 275);

      window.open(doc.output('bloburl'), '_blank');
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
                        scheduled_date: new Date().toISOString().split('T')[0],
                        status: 'pendiente',
                        application_type: 'fitosanitario',
                        water_liters_per_hectare: 1000,
                        tank_capacity: 2000,
                        items: []
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

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Fecha Programada</label>
                      <input 
                          type="date" 
                          value={currentOrder.scheduled_date}
                          onChange={e => setCurrentOrder({...currentOrder, scheduled_date: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
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
                          {fields.find(f => f.id === currentOrder.field_id)?.sectors.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>
                          ))}
                      </select>
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

              {/* Machinery & Tech Specs */}
              <div className="bg-gray-50 p-4 rounded-md mb-6">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">Maquinaria y Calibración</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                          <label className="block text-xs text-gray-500">Tractor</label>
                          <select 
                              value={currentOrder.tractor_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, tractor_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {machines.filter(m => m.type.toLowerCase().includes('tractor')).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Equipo (Nebulizadora)</label>
                          <select 
                              value={currentOrder.sprayer_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, sprayer_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {machines.filter(m => !m.type.toLowerCase().includes('tractor')).map(m => (
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
                              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                      </div>
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
                          <label className="block text-xs text-gray-500">Cap. Tanque (L)</label>
                          <input 
                              type="number" 
                              value={currentOrder.tank_capacity}
                              onChange={e => setCurrentOrder({...currentOrder, tank_capacity: Number(e.target.value)})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                          />
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Velocidad (km/h)</label>
                          <input 
                              type="number" 
                              value={currentOrder.speed || ''}
                              onChange={e => setCurrentOrder({...currentOrder, speed: Number(e.target.value)})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                              placeholder="Ej: 5.5"
                          />
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Presión (bar)</label>
                          <input 
                              type="number" 
                              value={currentOrder.pressure || ''}
                              onChange={e => setCurrentOrder({...currentOrder, pressure: Number(e.target.value)})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                              placeholder="Ej: 10"
                          />
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500">Boquillas</label>
                          <input 
                              type="text" 
                              value={currentOrder.nozzles || ''}
                              onChange={e => setCurrentOrder({...currentOrder, nozzles: e.target.value})}
                              className="mt-1 w-full border border-gray-300 rounded p-1.5 text-sm"
                              placeholder="Ej: ATR Lila"
                          />
                      </div>
                  </div>
              </div>

              {/* Items Section */}
              <div className="border rounded-md p-4 mb-6">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">Productos</h3>
                  
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
                              {products.map(p => (
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
                      <div className="flex-1 min-w-[150px]">
                          <label className="block text-xs text-gray-500">Objetivo</label>
                          <input 
                              type="text" 
                              value={currentItem.objective}
                              onChange={e => setCurrentItem({...currentItem, objective: e.target.value})}
                              placeholder="Ej: Polilla"
                              className="w-full border border-gray-300 rounded p-1.5 text-sm"
                          />
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
                                      <div className="text-xs text-gray-500">{item.objective}</div>
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

              {/* Footer Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                      <label className="block text-sm font-medium text-gray-700">Notas / Instrucciones</label>
                      <textarea 
                          value={currentOrder.notes || ''}
                          onChange={e => setCurrentOrder({...currentOrder, notes: e.target.value})}
                          rows={3}
                          className="mt-1 block w-full border border-gray-300 rounded-md p-2 text-sm"
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
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lugar</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Maquinaria</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                      </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                      {orders.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">#{order.order_number}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {new Date(order.scheduled_date).toLocaleDateString()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  <div>{order.field?.name}</div>
                                  <div className="text-xs text-gray-500">{order.sector?.name}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)}`}>
                                      {order.status.toUpperCase()}
                                  </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {order.tractor?.name} / {order.sprayer?.name}
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
    </div>
  );
};
