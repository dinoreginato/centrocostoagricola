import { toast } from 'sonner';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '../contexts/CompanyContext';
import { Plus, Loader2, Save, Trash2, Printer, Edit, Copy, ClipboardList } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';
import {
  createApplication,
  createApplicationItem,
  createFuelConsumption,
  createInventoryMovement,
  deleteApplicationOrderCascade,
  findCompletedOrderApplicationId,
  getFuelStats,
  loadApplicationOrdersPageData,
  markApplicationOrderCompleted,
  revertApplicationOrderToPending,
  updateProductStock,
  upsertApplicationOrder
} from '../services/applicationOrders';

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
  protection_days?: number; // Days the application protects the crop
  
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
  average_cost?: number; // Needed for completion calculation
}

// Reuse Interfaces from other parts
interface Field { id: string; name: string; sectors: Sector[] }
interface Sector { id: string; name: string; hectares: number }
interface Product { id: string; name: string; unit: string; current_stock: number; category: string; active_ingredient?: string; average_cost: number }
interface Machine { id: string; name: string; type: string }
interface Worker { id: string; name: string; role: string }

const normalizeUnit = (u: string) => {
  const lower = (u || '').toLowerCase().trim();
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
  if (from === 'cc' && to === 'l') return 0.001;
  if (from === 'l' && to === 'cc') return 1000;
  if (from === 'gr' && to === 'kg') return 0.001;
  if (from === 'kg' && to === 'gr') return 1000;
  return 1;
};

export const ApplicationOrders: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? null;
  const [loading, setLoading] = useState(false);
  const canWrite = userRole !== 'viewer';
  
  // PDF Preview State
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('');

  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
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

  const pageQuery = useQuery({
    queryKey: ['applicationOrdersPage', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      return await loadApplicationOrdersPageData({ companyId });
    },
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });

  const orders = useMemo(() => (pageQuery.data?.orders || []) as ApplicationOrder[], [pageQuery.data?.orders]);
  const fields = useMemo(() => (pageQuery.data?.fields || []) as Field[], [pageQuery.data?.fields]);
  const products = useMemo(() => (pageQuery.data?.products || []) as Product[], [pageQuery.data?.products]);
  const machines = useMemo(() => (pageQuery.data?.machines || []) as Machine[], [pageQuery.data?.machines]);
  const workers = useMemo(() => (pageQuery.data?.workers || []) as Worker[], [pageQuery.data?.workers]);
  const programEvents = useMemo(() => (pageQuery.data?.programEvents || []) as any[], [pageQuery.data?.programEvents]);

  const reloadData = async () => {
    if (!companyId) return;
    await queryClient.invalidateQueries({ queryKey: ['applicationOrdersPage', companyId] });
  };

  const prefsKey = useMemo(() => (companyId ? `applicationOrdersPrefs:${companyId}` : null), [companyId]);

  useEffect(() => {
    if (!prefsKey) return;
    if (!isEditing) return;
    try {
      localStorage.setItem(
        prefsKey,
        JSON.stringify({
          field_id: currentOrder.field_id ?? '',
          sector_id: currentOrder.sector_id ?? '',
          application_type: currentOrder.application_type ?? 'fitosanitario',
          water_liters_per_hectare: currentOrder.water_liters_per_hectare ?? 1000,
          tank_capacity: currentOrder.tank_capacity ?? 2000,
        }),
      );
    } catch (_e) {
      void _e;
    }
  }, [
    currentOrder.application_type,
    currentOrder.field_id,
    currentOrder.sector_id,
    currentOrder.tank_capacity,
    currentOrder.water_liters_per_hectare,
    isEditing,
    prefsKey,
  ]);

  useEffect(() => {
    if (!isEditing) return;
    if (!currentOrder.field_id) return;
    if (currentOrder.sector_id) return;
    const field = fields.find((f) => f.id === currentOrder.field_id);
    const firstSector = field?.sectors?.[0];
    if (!firstSector) return;
    setCurrentOrder((prev) => ({ ...prev, sector_id: firstSector.id }));
  }, [currentOrder.field_id, currentOrder.sector_id, fields, isEditing]);

  const handleLoadFromProgramEvent = (eventId: string) => {
    if (!eventId) return;
    const ev = programEvents.find(e => e.id === eventId);
    if (!ev) return;

    setCurrentOrder(prev => ({
        ...prev,
        objective: ev.objective || prev.objective,
        water_liters_per_hectare: ev.water_per_ha || prev.water_liters_per_hectare,
        items: [] // we reset items to populate them next
    }));

    // If we have a sector selected, we can calculate the totals right away
    const field = fields.find(f => f.id === currentOrder.field_id);
    const sector = field?.sectors.find(s => s.id === currentOrder.sector_id);

    if (sector && ev.products && ev.products.length > 0) {
        const newItems = ev.products.map((ep: any) => {
            let doseHa = 0;
            let dose100L = 0;
            let totalQty = 0;

            if (ep.dose_unit === 'L/ha' || ep.dose_unit === 'Kg/ha') {
                doseHa = Number(ep.dose);
                if (ev.water_per_ha > 0) {
                    dose100L = (doseHa / ev.water_per_ha) * 100;
                }
            } else {
                dose100L = Number(ep.dose);
                if (ev.water_per_ha > 0) {
                    doseHa = (dose100L * ev.water_per_ha) / 100;
                }
            }

            if (doseHa > 0) {
                totalQty = doseHa * sector.hectares;
            }

            return {
                id: crypto.randomUUID(),
                product_id: ep.product_id,
                product_name: ep.product?.name,
                dose_per_hectare: doseHa,
                dose_per_100l: dose100L,
                total_quantity: totalQty,
                unit: ep.dose_unit.includes('ha') ? (ep.dose_unit === 'L/ha' ? 'L' : 'Kg') : (ep.dose_unit.includes('cc') ? 'cc' : 'gr'),
                objective: ev.objective || ''
            };
        });

        setCurrentOrder(prev => ({ ...prev, items: newItems }));
    } else {
        // If no sector, we just load them with 0 total, it will recalculate when sector is chosen
        const newItems = ev.products.map((ep: any) => {
            let doseHa = 0;
            let dose100L = 0;

            if (ep.dose_unit === 'L/ha' || ep.dose_unit === 'Kg/ha') {
                doseHa = Number(ep.dose);
                if (ev.water_per_ha > 0) {
                    dose100L = (doseHa / ev.water_per_ha) * 100;
                }
            } else {
                dose100L = Number(ep.dose);
                if (ev.water_per_ha > 0) {
                    doseHa = (dose100L * ev.water_per_ha) / 100;
                }
            }

            return {
                id: crypto.randomUUID(),
                product_id: ep.product_id,
                product_name: ep.product?.name,
                dose_per_hectare: doseHa,
                dose_per_100l: dose100L,
                total_quantity: 0,
                unit: ep.dose_unit.includes('ha') ? (ep.dose_unit === 'L/ha' ? 'L' : 'Kg') : (ep.dose_unit.includes('cc') ? 'cc' : 'gr'),
                objective: ev.objective || ''
            };
        });
        setCurrentOrder(prev => ({ ...prev, items: newItems }));
        toast('Se han cargado los productos del programa. Seleccione un sector para calcular los totales automáticamente.');
    }
  };

  const handleAddItem = () => {
      const product = products.find(p => p.id === currentItem.product_id);
      if (!product || currentItem.dose_input_value <= 0) return;

      const field = fields.find(f => f.id === currentOrder.field_id);
      const sector = field?.sectors.find(s => s.id === currentOrder.sector_id);
      
      if (!sector) {
          toast('Seleccione un sector primero para calcular totales.');
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
              toast('Debe ingresar el Mojamiento (L/ha) para calcular la dosis por hectárea.');
              return;
          }
      }

      totalQty = doseHa * sector.hectares;

      const selectedUnit = currentItem.unit_override || product.unit;
      const conversionFactor = getConversionFactor(selectedUnit, product.unit);
      const totalQtyInBaseUnit = totalQty * conversionFactor;

      if (totalQtyInBaseUnit > product.current_stock) {
          toast(`¡Advertencia de Stock!\n\nEstás ordenando aplicar ${totalQtyInBaseUnit.toFixed(2)} ${product.unit} de ${product.name}, pero solo tienes ${product.current_stock} en bodega.`);
      }

      const newItem: OrderItem = {
          product_id: product.id,
          product_name: product.name,
          active_ingredient: product.active_ingredient,
          category: product.category,
          unit: selectedUnit,
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
      if (!canWrite) {
          toast.error('No tienes permisos para guardar órdenes.');
          return;
      }
      if (!currentOrder.field_id || !currentOrder.sector_id || !currentOrder.items?.length) {
          toast('Complete los campos obligatorios (Campo, Sector, Items)');
          return;
      }

      setLoading(true);
      try {
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
              protection_days: currentOrder.protection_days,
              updated_at: new Date().toISOString(),
              variety: currentOrder.variety, // New field
              objective: currentOrder.objective // New field
          };
          const itemsData = currentOrder.items.map(item => ({
              product_id: item.product_id,
              dose_per_hectare: item.dose_per_hectare,
              dose_per_100l: item.dose_per_100l,
              total_quantity: item.total_quantity,
              unit: item.unit,
              objective: item.objective
          }));
          
          await upsertApplicationOrder({ orderId: currentOrder.id, orderData, itemsData });

          toast('Orden guardada correctamente');
          setIsEditing(false);
          await reloadData();

      } catch (error: any) {
          toast.error('Error al guardar: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleCloneOrder = (order: ApplicationOrder) => {
      if (!canWrite) {
          toast.error('No tienes permisos para duplicar órdenes.');
          return;
      }
      const userInputDate = prompt('Duplicar orden.\nIngrese la nueva fecha programada (YYYY-MM-DD):', new Date().toLocaleDateString('en-CA'));
      if (!userInputDate) return;

      const clonedOrder = { ...order };
      delete clonedOrder.id; // Remove the ID so it's treated as new
      delete clonedOrder.order_number;
      delete clonedOrder.completed_date;
      clonedOrder.status = 'pendiente';
      clonedOrder.scheduled_date = userInputDate;
      // Generate new items without IDs
      clonedOrder.items = (order.items || []).map(item => {
          const newItem = { ...item };
          delete newItem.id;
          // @ts-expect-error - Ignore the TypeScript error for removing an internal/untyped property
          delete newItem.application_order_id;
          return newItem;
      });
      setCurrentOrder(clonedOrder);
      setIsEditing(true);
      setWizardStep(2);
  };

  const handleDeleteOrder = async (id: string) => {
      if (!canWrite) {
          toast.error('No tienes permisos para eliminar órdenes.');
          return;
      }
      if (!window.confirm('¿Está seguro de eliminar esta orden de aplicación? Esta acción no se puede deshacer.')) {
          return;
      }

      setLoading(true);
      try {
          const order = orders.find(o => o.id === id);
          const completedApplicationId =
            order && order.status === 'completada' && order.completed_date
              ? await findCompletedOrderApplicationId({
                  sectorId: order.sector_id,
                  completedDate: order.completed_date,
                  applicationType: order.application_type
                })
              : null;

          await deleteApplicationOrderCascade({ orderId: id, completedApplicationId });
          
          await reloadData();
      } catch (error: any) {
          toast.error('Error al eliminar: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleRevertToPending = async (order: ApplicationOrder) => {
      if (!canWrite) {
          toast.error('No tienes permisos para modificar órdenes.');
          return;
      }
      if (!window.confirm(`¿Está seguro de revertir la orden #${order.order_number} a PENDIENTE? Si esta orden generó un registro en "Aplicaciones", ese registro no se eliminará automáticamente, deberá borrarlo manualmente allá.`)) {
          return;
      }
      setLoading(true);
      try {
          await revertApplicationOrderToPending({ orderId: order.id });
          toast.success(`Orden #${order.order_number} revertida a PENDIENTE.`);
          await reloadData();
      } catch (error: any) {
          toast.error('Error al revertir: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const handleMarkAsCompleted = async (order: ApplicationOrder, completedDate: string) => {
      if (!canWrite) {
          toast.error('No tienes permisos para completar órdenes.');
          return;
      }
      setLoading(true);
      try {
          // 1. Calculate Total Cost from items - STRICT NUMBER CASTING & CONVERSION
          let totalCost = 0;
          const itemsData = order.items.map(item => {
              const product = products.find(p => p.id === item.product_id);
              const baseUnit = product?.unit || item.unit;
              const conversionFactor = getConversionFactor(item.unit, baseUnit);

              const unitCost = Number(item.average_cost) || 0; 
              const rawQty = Number(item.total_quantity) || 0;
              const rawDose = Number(item.dose_per_hectare) || 0;

              const qtyInBaseUnit = rawQty * conversionFactor;
              const doseInBaseUnit = rawDose * conversionFactor;

              const itemTotal = unitCost * qtyInBaseUnit;
              totalCost += itemTotal;
              return {
                  product_id: item.product_id,
                  quantity_used: qtyInBaseUnit,
                  dose_per_hectare: doseInBaseUnit,
                  unit_cost: unitCost,
                  total_cost: itemTotal,
                  objective: item.objective || ''
              };
          });

          const safeTotalCost = isNaN(totalCost) ? 0 : Number(totalCost.toFixed(2));
          const waterLiters = Number(order.water_liters_per_hectare) || 0;
          const safeWaterLiters = isNaN(waterLiters) ? 0 : Number(waterLiters.toFixed(2));

          const application = await createApplication({
            payload: {
              field_id: order.field_id,
              sector_id: order.sector_id,
              application_date: completedDate,
              application_type: order.application_type,
              total_cost: safeTotalCost,
              water_liters_per_hectare: safeWaterLiters
            }
          });

          // 3. Insert Application Items & Deduct Stock
          for (const itemData of itemsData) {
              const safeQty = isNaN(itemData.quantity_used) ? 0 : Number(itemData.quantity_used.toFixed(2));
              const safeDose = isNaN(itemData.dose_per_hectare) ? 0 : Number(itemData.dose_per_hectare.toFixed(2));
              const safeUnitCost = isNaN(itemData.unit_cost) ? 0 : Number(itemData.unit_cost.toFixed(2));
              const safeItemTotal = isNaN(itemData.total_cost) ? 0 : Number(itemData.total_cost.toFixed(2));

              const savedItem = await createApplicationItem({
                payload: {
                  application_id: application.id,
                  product_id: itemData.product_id,
                  quantity_used: safeQty,
                  dose_per_hectare: safeDose,
                  unit_cost: safeUnitCost,
                  total_cost: safeItemTotal,
                  objective: itemData.objective
                }
              });

              // Deduct stock and create movement
              const product = products.find(p => p.id === itemData.product_id);
              if (product) {
                  const currentStock = Number(product.current_stock) || 0;
                  const newStock = currentStock - safeQty;
                  const safeNewStock = isNaN(newStock) ? 0 : Number(newStock.toFixed(2));

                  await updateProductStock({ productId: itemData.product_id, currentStock: safeNewStock });
                  await createInventoryMovement({
                    payload: {
                      product_id: itemData.product_id,
                      movement_type: 'salida',
                      quantity: safeQty,
                      unit_cost: safeUnitCost,
                      application_item_id: savedItem.id
                    }
                  });
              }
          }

          // 4. Automatic Fuel Consumption (Skip if 'fertirriego')
          if (order.application_type !== 'fertirriego') {
              const sector = fields.find(f => f.id === order.field_id)?.sectors.find(s => s.id === order.sector_id);
              const hectares = Number(sector?.hectares) || 0;
              
              if (hectares > 0) {
                  const rate = Number(selectedCompany.application_fuel_rate) || 12;
                  const fuelLiters = Math.max(rate * hectares, 0.01);
                  
                  const fuelStats = await getFuelStats({ companyId: selectedCompany.id, type: 'diesel' });
                  const avgFuelPrice = Number((fuelStats as any)?.[0]?.avg_price) || 1050;
                  
                  const fuelCost = fuelLiters * avgFuelPrice;
                  
                  const safeFuelLiters = isNaN(fuelLiters) ? 0 : Number(fuelLiters.toFixed(2));
                  const safeFuelCost = isNaN(fuelCost) ? 0 : Number(fuelCost.toFixed(2));

                  await createFuelConsumption({
                    payload: {
                      company_id: selectedCompany.id,
                      date: completedDate,
                      activity: `Aplicación Orden #${order.order_number}`,
                      liters: safeFuelLiters,
                      estimated_price: safeFuelCost,
                      sector_id: order.sector_id,
                      machine_id: order.tractor_id || order.sprayer_id || null,
                      application_id: application.id
                    }
                  });
              }
          }

          await markApplicationOrderCompleted({ orderId: order.id, completedDate });

          toast.success('Orden completada exitosamente. Se ha registrado la aplicación y descontado el inventario.');
          await reloadData();
      } catch (error: any) {
          toast.error('Error al completar la orden: ' + error.message);
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
      
      const isFertirriego = order.application_type === 'fertirriego';
      const boxHeight = isFertirriego ? 45 : 65; // Smaller box if no machinery
      
      doc.roundedRect(14, currentY, 182, boxHeight, 3, 3, 'FD');

      doc.setFont("helvetica", "bold");
      doc.text(isFertirriego ? 'DATOS DE APLICACIÓN' : 'DATOS DE APLICACIÓN Y MAQUINARIA', 18, currentY + 8);
      
      doc.setFontSize(9);
      
      let textY = currentY + 18;
      
      if (!isFertirriego) {
          doc.text('Maquinaria:', 18, textY);
          doc.setFont("helvetica", "normal");
          doc.text(`${order.tractor?.name || '-'} / ${order.sprayer?.name || '-'}`, 45, textY);

          doc.setFont("helvetica", "bold");
          doc.text('Operador:', 100, textY);
          doc.setFont("helvetica", "normal");
          doc.text(`${order.driver?.name || '-'}`, 120, textY);

          textY += 10;
          doc.setFont("helvetica", "bold");
          doc.text('Parámetros:', 18, textY);
          doc.setFont("helvetica", "normal");
          doc.text(`Velocidad: ${order.speed || '-'} km/h  |  Presión: ${order.pressure || '-'} bar  |  RPM: ${order.rpm || '-'}  |  Boquillas: ${order.nozzles || '-'}`, 45, textY);
          textY += 10;
      }

      doc.setFont("helvetica", "bold");
      doc.text('Carencia/Reingreso:', 18, textY);
      doc.setFont("helvetica", "normal");
      doc.text(`Reingreso: ${order.safety_period_hours || 0} hrs  |  Carencia: ${order.grace_period_days || 0} días  |  Protección: ${order.protection_days || 0} días`, 55, textY);

      textY += 10;
      doc.setFont("helvetica", "bold");
      doc.text('Observaciones:', 18, textY);
      doc.setFont("helvetica", "normal");
      const splitNotes = doc.splitTextToSize(order.notes || 'Ninguna.', 150);
      doc.text(splitNotes, 45, textY);

      // -- Signatures --
      currentY += boxHeight + 25;
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
          default: return 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200';
      }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;
  if (pageQuery.isLoading) return <div className="p-8">Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Ordenes de Aplicación</h1>
        {!isEditing && (
            <button
                onClick={() => {
                    let prefs: any = null;
                    if (prefsKey) {
                      try {
                        const raw = localStorage.getItem(prefsKey);
                        prefs = raw ? JSON.parse(raw) : null;
                      } catch (_e) {
                        void _e;
                      }
                    }
                    setCurrentOrder({
                        scheduled_date: new Date().toLocaleDateString('en-CA'),
                        status: 'pendiente',
                        application_type: prefs?.application_type || 'fitosanitario',
                        water_liters_per_hectare: Number(prefs?.water_liters_per_hectare ?? 1000),
                        tank_capacity: Number(prefs?.tank_capacity ?? 2000),
                        field_id: prefs?.field_id || '',
                        sector_id: prefs?.sector_id || '',
                        items: [],
                        variety: '',
                        objective: ''
                    });
                    setIsEditing(true);
                    setWizardStep(1);
                }}
                disabled={!canWrite}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md flex items-center"
            >
                <Plus className="h-5 w-5 mr-2" /> Nueva Orden
            </button>
        )}
      </div>

      {isEditing ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex justify-between mb-6">
                  <h2 className="text-lg font-bold">Crear/Editar Orden</h2>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setWizardStep(1);
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
                  >
                    Cancelar
                  </button>
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="text-sm text-gray-600 dark:text-gray-300">Paso {wizardStep} de 3</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className={`px-3 py-1.5 rounded text-xs border ${wizardStep === 1 ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'}`}
                  >
                    Datos
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    disabled={!currentOrder.field_id || !currentOrder.sector_id}
                    className={`px-3 py-1.5 rounded text-xs border ${wizardStep === 2 ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'} disabled:opacity-50`}
                  >
                    Productos
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    disabled={!currentOrder.items?.length || !currentOrder.field_id || !currentOrder.sector_id}
                    className={`px-3 py-1.5 rounded text-xs border ${wizardStep === 3 ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'} disabled:opacity-50`}
                  >
                    Revisión
                  </button>
                </div>
              </div>

              {wizardStep === 1 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha Planificada</label>
                      <input 
                          type="date" 
                          value={currentOrder.scheduled_date}
                          onChange={e => setCurrentOrder({...currentOrder, scheduled_date: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Estado</label>
                      <select 
                          value={currentOrder.status}
                          onChange={e => {
                              const newStatus = e.target.value;
                              if (newStatus === 'completada') {
                                  toast('Para marcar como completada y registrar el consumo en inventario, use el botón de "PENDIENTE" en la tabla principal.');
                                  return;
                              }
                              setCurrentOrder({...currentOrder, status: newStatus as any});
                          }}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                      >
                          <option value="pendiente">Pendiente</option>
                          <option value="cancelada">Cancelada</option>
                      </select>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Objetivo Aplicación</label>
                      <input 
                          type="text" 
                          value={currentOrder.objective || ''}
                          onChange={e => setCurrentOrder({...currentOrder, objective: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                          placeholder="Ej: Polilla, Arañita, etc."
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Campo</label>
                      <select 
                          value={currentOrder.field_id || ''}
                          onChange={e => {
                            const fieldId = e.target.value;
                            const firstSector = fields.find((f) => f.id === fieldId)?.sectors?.[0];
                            setCurrentOrder({
                              ...currentOrder,
                              field_id: fieldId,
                              sector_id: firstSector?.id || '',
                            });
                          }}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                      >
                          <option value="">Seleccione...</option>
                          {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sector</label>
                      <select 
                          value={currentOrder.sector_id || ''}
                          onChange={e => {
                              const newSectorId = e.target.value;
                              
                              // Find old and new sector hectares
                              const newSector = fields.find(f => f.id === currentOrder.field_id)?.sectors?.find(s => s.id === newSectorId);
                              
                              let updatedItems = currentOrder.items;

                              // If changing sector and we have items, recalculate total_quantity
                              if (newSectorId && newSector && currentOrder.items && currentOrder.items.length > 0) {
                                  updatedItems = currentOrder.items.map(item => {
                                      let newTotalQty = item.total_quantity;
                                      
                                      // If dose was calculated per hectare, recalculate total
                                      if (item.dose_per_hectare > 0) {
                                          newTotalQty = item.dose_per_hectare * newSector.hectares;
                                      } 
                                      // If it was per 100L, recalculate based on new total water volume
                                      else if (item.dose_per_100l && currentOrder.water_liters_per_hectare) {
                                          const totalWater = currentOrder.water_liters_per_hectare * newSector.hectares;
                                          newTotalQty = (item.dose_per_100l * totalWater) / 100;
                                      }
                                      
                                      return { ...item, total_quantity: Number(newTotalQty.toFixed(2)) };
                                  });
                              }

                              setCurrentOrder({
                                  ...currentOrder, 
                                  sector_id: newSectorId,
                                  items: updatedItems
                              });
                          }}
                          disabled={!currentOrder.field_id}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                      >
                          <option value="">Seleccione...</option>
                          {fields.find(f => f.id === currentOrder.field_id)?.sectors?.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({s.hectares} ha)</option>
                          ))}
                      </select>
                  </div>
                   <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Variedad</label>
                      <input 
                          type="text" 
                          value={currentOrder.variety || ''}
                          onChange={e => setCurrentOrder({...currentOrder, variety: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                          placeholder="Ej: Forelle"
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 text-indigo-600">
                          <span className="flex items-center"><ClipboardList className="w-4 h-4 mr-1"/>Cargar desde Programa (Opcional)</span>
                      </label>
                      <select 
                          onChange={e => handleLoadFromProgramEvent(e.target.value)}
                          className="mt-1 block w-full border border-indigo-300 bg-indigo-50 rounded-md p-2 text-indigo-800"
                      >
                          <option value="">Seleccionar etapa...</option>
                          {programEvents.map(ev => (
                              <option key={ev.id} value={ev.id}>
                                  {ev.phytosanitary_programs?.name} - {ev.stage_name}
                              </option>
                          ))}
                      </select>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                      <select 
                          value={currentOrder.application_type}
                          onChange={e => setCurrentOrder({...currentOrder, application_type: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                      >
                          <option value="fitosanitario">Fitosanitario</option>
                          <option value="fertilizacion">Fertilización</option>
                          <option value="herbicida">Herbicida</option>
                          <option value="fertirriego">Fertirriego (Riego)</option>
                      </select>
                  </div>
              </div>
              )}

              {/* Items Section */}
              {wizardStep === 2 && (
              <div className="border rounded-md p-4 mb-6">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Productos y Dosis</h3>
                  
                  {/* Add Item Form */}
                  <div className="flex flex-wrap items-end gap-2 mb-4 bg-gray-50 dark:bg-gray-900 p-3 rounded">
                      <div className="flex-1 min-w-[200px]">
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Producto</label>
                          <select 
                              value={currentItem.product_id}
                              onChange={e => setCurrentItem({...currentItem, product_id: e.target.value})}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          >
                              <option value="">Seleccione...</option>
                              {products?.map(p => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.current_stock} {p.unit})</option>
                              ))}
                          </select>
                      </div>
                      <div className="w-24">
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Tipo Dosis</label>
                          <select 
                              value={currentItem.dose_input_type}
                              onChange={e => setCurrentItem({...currentItem, dose_input_type: e.target.value as any})}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          >
                              <option value="hl">/ 100L</option>
                              <option value="ha">/ Ha</option>
                          </select>
                      </div>
                      <div className="w-24">
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Dosis</label>
                          <input 
                              type="number" 
                              value={currentItem.dose_input_value}
                              onChange={e => setCurrentItem({...currentItem, dose_input_value: Number(e.target.value)})}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          />
                          {/* Equivalent Calculator Helper */}
                          {currentItem.dose_input_value > 0 && currentOrder.water_liters_per_hectare > 0 && (
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 whitespace-nowrap" title="Equivalencia automática">
                                  {currentItem.dose_input_type === 'hl' 
                                      ? `≈ ${((currentItem.dose_input_value * currentOrder.water_liters_per_hectare) / 100).toFixed(2)} / Ha` 
                                      : `≈ ${((currentItem.dose_input_value * 100) / currentOrder.water_liters_per_hectare).toFixed(2)} / 100L`}
                              </div>
                          )}
                      </div>
                      <div className="w-24">
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Unidad</label>
                          <select 
                              value={currentItem.unit_override}
                              onChange={e => setCurrentItem({...currentItem, unit_override: e.target.value})}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
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
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                          <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Producto</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Dosis / 100L</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Dosis / Ha</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Total a Pedir</th>
                              <th className="px-3 py-2"></th>
                          </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {currentOrder.items?.map((item, idx) => (
                              <tr key={idx}>
                                  <td className="px-3 py-2 text-sm">
                                      <div className="font-medium">{item.product_name}</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400">{item.active_ingredient}</div>
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
              )}

              {/* Machinery & Tech Specs (Collapsed/Secondary) */}
              {currentOrder.application_type !== 'fertirriego' && (
              <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-md mb-6">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Parámetros Técnicos y Maquinaria</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Mojamiento (L/ha)</label>
                          <input 
                              type="number" 
                              value={currentOrder.water_liters_per_hectare}
                              onChange={e => setCurrentOrder({...currentOrder, water_liters_per_hectare: Number(e.target.value)})}
                              className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          />
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Tractor</label>
                          <select 
                              value={currentOrder.tractor_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, tractor_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {machines.filter(m => m.type?.toLowerCase().includes('tractor')).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Equipo</label>
                          <select 
                              value={currentOrder.sprayer_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, sprayer_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {machines.filter(m => !m.type?.toLowerCase().includes('tractor')).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Operador</label>
                          <select 
                              value={currentOrder.tractor_driver_id || ''}
                              onChange={e => setCurrentOrder({...currentOrder, tractor_driver_id: e.target.value})}
                              className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded p-1.5 text-sm"
                          >
                              <option value="">-</option>
                              {workers?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                      </div>
                      {/* Optional Params */}
                      <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Velocidad</label>
                          <input type="number" value={currentOrder.speed || ''} onChange={e => setCurrentOrder({...currentOrder, speed: Number(e.target.value)})} className="w-full border p-1 rounded text-sm"/>
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Presión</label>
                          <input type="number" value={currentOrder.pressure || ''} onChange={e => setCurrentOrder({...currentOrder, pressure: Number(e.target.value)})} className="w-full border p-1 rounded text-sm"/>
                      </div>
                       <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400">Boquillas</label>
                          <input type="text" value={currentOrder.nozzles || ''} onChange={e => setCurrentOrder({...currentOrder, nozzles: e.target.value})} className="w-full border p-1 rounded text-sm"/>
                      </div>
                  </div>
              </div>
              )}

              {wizardStep === 3 && (
              <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Observaciones</label>
                      <textarea 
                          value={currentOrder.notes || ''}
                          onChange={e => setCurrentOrder({...currentOrder, notes: e.target.value})}
                          rows={3}
                          className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                          placeholder="Notas adicionales..."
                      />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Reingreso (hrs)</label>
                          <input 
                              type="number" 
                              value={currentOrder.safety_period_hours || 0}
                              onChange={e => setCurrentOrder({...currentOrder, safety_period_hours: Number(e.target.value)})}
                              className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Carencia (días)</label>
                          <input 
                              type="number" 
                              value={currentOrder.grace_period_days || 0}
                              onChange={e => setCurrentOrder({...currentOrder, grace_period_days: Number(e.target.value)})}
                              className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Días de Protección</label>
                          <input 
                              type="number" 
                              value={currentOrder.protection_days || 0}
                              onChange={e => setCurrentOrder({...currentOrder, protection_days: Number(e.target.value)})}
                              className="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                              title="¿Cuántos días dura la protección de esta aplicación?"
                          />
                      </div>
                  </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={handleSaveOrder}
                  disabled={loading || !canWrite}
                  className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 flex items-center disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                  Guardar Orden
                </button>
              </div>
              </>
              )}

              <div className="flex justify-between mt-6">
                <button
                  type="button"
                  onClick={() => setWizardStep((s) => (s === 1 ? 1 : ((s - 1) as 1 | 2 | 3)))}
                  disabled={wizardStep === 1}
                  className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 disabled:opacity-50"
                >
                  Atrás
                </button>
                {wizardStep !== 3 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep((s) => (s === 1 ? 2 : 3))}
                    disabled={(wizardStep === 1 && (!currentOrder.field_id || !currentOrder.sector_id)) || (wizardStep === 2 && !currentOrder.items?.length)}
                    className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                )}
              </div>
          </div>
      ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">N°</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Huerto/Sector</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Objetivo</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Estado</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acciones</th>
                      </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {orders.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-gray-100">#{order.order_number}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                  <div>Plan: {new Date(order.scheduled_date + 'T12:00:00').toLocaleDateString()}</div>
                                  {order.completed_date && (
                                      <div className="text-green-600 font-medium">Realizada: {new Date(order.completed_date + 'T12:00:00').toLocaleDateString()}</div>
                                  )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                  <div>{order.field?.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">{order.sector?.name}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{order.objective || '-'}</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                  {canWrite && order.status === 'pendiente' ? (
                                      <button
                                          onClick={async (e) => {
                                              e.stopPropagation();
                                              const userInputDate = prompt('Marcar orden como Realizada.\nIngrese la fecha de realización (YYYY-MM-DD):', new Date().toLocaleDateString('en-CA'));
                                              if (userInputDate) {
                                                  await handleMarkAsCompleted(order, userInputDate);
                                              }
                                          }}
                                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)} hover:bg-green-100 hover:text-green-800 transition-colors cursor-pointer border border-transparent hover:border-green-300`}
                                          title="Click para marcar como Realizada"
                                      >
                                          {order.status.toUpperCase()}
                                      </button>
                                  ) : canWrite ? (
                                      <button 
                                          onClick={(e) => {
                                              e.stopPropagation();
                                              handleRevertToPending(order);
                                          }}
                                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)} hover:opacity-75 cursor-pointer`}
                                          title="Click para deshacer y volver a PENDIENTE"
                                      >
                                          {order.status.toUpperCase()} (Deshacer)
                                      </button>
                                  ) : (
                                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)}`}>
                                          {order.status.toUpperCase()}
                                      </span>
                                  )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end gap-2">
                                  <button 
                                      onClick={() => handlePrintOrder(order)}
                                      className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:text-gray-100"
                                      title="Imprimir PDF"
                                  >
                                      <Printer className="h-5 w-5" />
                                  </button>
                                  {canWrite && (
                                    <>
                                      <button 
                                          onClick={() => handleCloneOrder(order)}
                                          className="text-green-600 hover:text-green-900"
                                          title="Duplicar/Clonar"
                                      >
                                          <Copy className="h-5 w-5" />
                                      </button>
                                      <button 
                                          onClick={() => {
                                              setCurrentOrder(order);
                                              setIsEditing(true);
                                              setWizardStep(2);
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
                                    </>
                                  )}
                              </td>
                          </tr>
                      ))}
                      {orders.length === 0 && (
                          <tr>
                              <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">No hay ordenes registradas</td>
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
