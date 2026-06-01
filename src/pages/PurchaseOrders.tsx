import { toast } from 'sonner';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, ShoppingCart, Trash2, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PdfPreviewModal } from '../components/PdfPreviewModal';
import { useCompany } from '../contexts/CompanyContext';
import { filterAgrochemicalProducts } from '../lib/agrochemicals';
import { formatCLP } from '../lib/utils';
import { fetchInventoryProducts, type InventoryProduct } from '../services/inventory';
import { createPurchaseOrder, deletePurchaseOrder, fetchPurchaseOrderItems, fetchPurchaseOrders, type PurchaseOrderItemRow, type PurchaseOrderRow } from '../services/purchaseOrders';

type DraftItem = {
  productId: string;
  quantity: number;
  unitPrice: number | null;
  notes: string;
};

export const PurchaseOrders: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? null;
  const canWrite = userRole !== 'viewer';

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [supplierName, setSupplierName] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [notes, setNotes] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ['purchaseOrders', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return await fetchPurchaseOrders({ companyId });
    },
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });

  const productsQuery = useQuery({
    queryKey: ['inventoryProductsForPO', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return await fetchInventoryProducts({ companyId });
    },
    enabled: Boolean(companyId) && createOpen,
    staleTime: 30_000,
  });

  const products = useMemo(() => {
    const raw = (productsQuery.data || []) as InventoryProduct[];
    return filterAgrochemicalProducts(raw).filter((p) => String(p.category) !== 'Archivado');
  }, [productsQuery.data]);

  const selectedOrderItemsQuery = useQuery({
    queryKey: ['purchaseOrderItems', selectedOrderId],
    queryFn: async () => {
      if (!selectedOrderId) return [];
      return await fetchPurchaseOrderItems({ orderId: selectedOrderId });
    },
    enabled: Boolean(selectedOrderId),
    staleTime: 0,
  });

  const selectedOrder = useMemo(() => {
    const list = (ordersQuery.data || []) as PurchaseOrderRow[];
    return selectedOrderId ? list.find((o) => o.id === selectedOrderId) || null : null;
  }, [ordersQuery.data, selectedOrderId]);

  const selectedItems = (selectedOrderItemsQuery.data || []) as PurchaseOrderItemRow[];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('Seleccione una empresa');
      if (!supplierName.trim()) throw new Error('Ingrese proveedor');
      if (draftItems.length === 0) throw new Error('Agregue al menos 1 producto');

      const items = draftItems.map((it) => {
        const p = products.find((x) => x.id === it.productId);
        if (!p) throw new Error('Producto inválido');
        return {
          productId: p.id,
          productName: p.name,
          unit: p.unit,
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice,
          notes: it.notes || null,
        };
      });

      return await createPurchaseOrder({
        companyId,
        orderNumber: orderNumber.trim() ? orderNumber.trim() : null,
        supplierName: supplierName.trim(),
        orderDate,
        status: 'Borrador',
        notes: notes.trim() ? notes.trim() : null,
        items,
      });
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['purchaseOrders', companyId] });
      setSelectedOrderId(created.id);
      closeCreate();
      toast('Orden de compra creada');
    },
    onError: (err: any) => {
      toast.error(err?.message ? String(err.message) : 'Error al crear orden de compra');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (!canWrite) throw new Error('No tienes permisos.');
      await deletePurchaseOrder({ orderId });
    },
    onSuccess: async () => {
      setSelectedOrderId(null);
      await queryClient.invalidateQueries({ queryKey: ['purchaseOrders', companyId] });
      toast('Orden eliminada');
    },
    onError: (err: any) => {
      toast.error(err?.message ? String(err.message) : 'Error al eliminar orden');
    },
  });

  const openCreate = () => {
    if (!canWrite) {
      toast.error('No tienes permisos para crear órdenes.');
      return;
    }
    setCreateOpen(true);
    setSupplierName('');
    setOrderNumber('');
    setOrderDate(new Date().toLocaleDateString('en-CA'));
    setNotes('');
    setDraftItems([]);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setSupplierName('');
    setOrderNumber('');
    setNotes('');
    setDraftItems([]);
  };

  const orderTotal = useMemo(() => {
    const list = selectedItems || [];
    return list.reduce((sum, it) => sum + Number(it.line_total || 0), 0);
  }, [selectedItems]);

  const handlePrintSelected = () => {
    if (!selectedOrder) return;

    const doc = new jsPDF();
    const companyName = selectedCompany?.name || 'Empresa';

    doc.setFontSize(16);
    doc.text('Orden de Compra (Químicos)', 14, 18);
    doc.setFontSize(11);
    doc.text(`Empresa: ${companyName}`, 14, 28);
    doc.text(`Proveedor: ${selectedOrder.supplier_name}`, 14, 34);
    doc.text(`Fecha: ${new Date(selectedOrder.order_date + 'T12:00:00').toLocaleDateString()}`, 14, 40);
    if (selectedOrder.order_number) doc.text(`N° OC: ${selectedOrder.order_number}`, 14, 46);

    const startY = selectedOrder.order_number ? 54 : 48;

    autoTable(doc, {
      startY,
      head: [['Producto', 'Unidad', 'Cantidad', 'Precio Unit.', 'Total']],
      body: selectedItems.map((it) => [
        it.product_name,
        it.unit || '',
        Number(it.quantity).toFixed(2),
        it.unit_price == null ? '' : formatCLP(Number(it.unit_price)),
        it.line_total == null ? '' : formatCLP(Number(it.line_total)),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [22, 163, 74] },
    });

    const endY = (doc as any).lastAutoTable?.finalY ? Number((doc as any).lastAutoTable.finalY) : startY + 20;
    doc.setFontSize(11);
    doc.text(`Total: ${formatCLP(orderTotal)}`, 14, endY + 10);

    if (selectedOrder.notes) {
      doc.setFontSize(10);
      doc.text(`Observaciones: ${selectedOrder.notes}`, 14, endY + 18, { maxWidth: 180 });
    }

    const title = `OC_${companyName}_${selectedOrder.order_date}`;
    const url = String(doc.output('bloburl'));
    setPdfPreviewTitle(title);
    setPdfPreviewUrl(url);
    setPdfPreviewOpen(true);
  };

  const handleClosePdfPreview = () => {
    setPdfPreviewOpen(false);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null);
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  const orders = (ordersQuery.data || []) as PurchaseOrderRow[];

  return (
    <div className="space-y-6">
      <PdfPreviewModal isOpen={pdfPreviewOpen} onClose={handleClosePdfPreview} title={pdfPreviewTitle} pdfUrl={pdfPreviewUrl} />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <ShoppingCart className="mr-2 h-7 w-7 text-green-600" />
            Órdenes de Compra (Químicos)
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Crear y exportar órdenes de compra por categoría de químicos</p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nueva OC
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">Órdenes</h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[650px] overflow-y-auto">
            {ordersQuery.isLoading ? (
              <div className="p-6 text-sm text-gray-500">Cargando...</div>
            ) : orders.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No hay órdenes creadas.</div>
            ) : (
              orders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedOrderId(o.id)}
                  className={`w-full text-left p-4 hover:bg-green-50 dark:hover:bg-gray-700 ${
                    selectedOrderId === o.id ? 'bg-green-50 dark:bg-gray-700' : ''
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{o.supplier_name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{new Date(o.order_date + 'T12:00:00').toLocaleDateString()}</div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex gap-2">
                    <span>{o.status}</span>
                    {o.order_number ? <span>· OC {o.order_number}</span> : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">Detalle</h3>
            {selectedOrder ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintSelected}
                  className="inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Ver PDF
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm('¿Eliminar esta orden de compra?')) return;
                      deleteMutation.mutate(selectedOrder.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="inline-flex items-center px-3 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {!selectedOrder ? (
            <div className="p-10 text-center text-gray-500">Seleccione una orden para ver el detalle.</div>
          ) : selectedOrderItemsQuery.isLoading ? (
            <div className="p-6 text-sm text-gray-500">Cargando items...</div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Proveedor</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{selectedOrder.supplier_name}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Fecha</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {new Date(selectedOrder.order_date + 'T12:00:00').toLocaleDateString()}
                  </div>
                </div>
                {selectedOrder.order_number ? (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">N° OC</div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{selectedOrder.order_number}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Estado</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{selectedOrder.status}</div>
                </div>
              </div>

              {selectedOrder.notes ? (
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Observaciones</div>
                  <div className="text-sm text-gray-900 dark:text-gray-100">{selectedOrder.notes}</div>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Producto</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unidad</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cantidad</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Precio Unit.</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {selectedItems.map((it) => (
                      <tr key={it.id}>
                        <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{it.product_name}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{it.unit || ''}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-200">{Number(it.quantity).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-200">
                          {it.unit_price == null ? '-' : formatCLP(Number(it.unit_price))}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                          {it.line_total == null ? '-' : formatCLP(Number(it.line_total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                        Total
                      </td>
                      <td className="px-4 py-2 text-right font-bold text-green-700">{formatCLP(orderTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onMouseDown={closeCreate}>
          <div
            className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Nueva Orden de Compra</h3>
              <button onClick={closeCreate} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Proveedor</label>
                  <input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                    placeholder="Ej. Agroinsumos Ltda."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">N° OC</label>
                  <input
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                    placeholder="Opcional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha</label>
                  <input value={orderDate} onChange={(e) => setOrderDate(e.target.value)} type="date" className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observaciones</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2"
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div className="mt-6">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Productos (químicos)</h4>
                  <button
                    type="button"
                    onClick={() => {
                      if (products.length === 0) return;
                      setDraftItems((prev) => [
                        ...prev,
                        { productId: products[0].id, quantity: 1, unitPrice: Number(products[0].average_cost || 0), notes: '' },
                      ]);
                    }}
                    disabled={products.length === 0}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar
                  </button>
                </div>

                {productsQuery.isLoading ? (
                  <div className="text-sm text-gray-500">Cargando productos...</div>
                ) : products.length === 0 ? (
                  <div className="text-sm text-gray-500">No hay productos químicos disponibles en bodega.</div>
                ) : draftItems.length === 0 ? (
                  <div className="text-sm text-gray-500">Agrega productos a la orden.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Producto</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unidad</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cantidad</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Precio Unit.</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {draftItems.map((it, idx) => {
                          const p = products.find((x) => x.id === it.productId) || products[0];
                          const qty = Number(it.quantity || 0);
                          const price = it.unitPrice == null ? null : Number(it.unitPrice);
                          const total = price == null ? null : qty * price;
                          return (
                            <tr key={idx}>
                              <td className="px-3 py-2">
                                <select
                                  value={it.productId}
                                  onChange={(e) =>
                                    setDraftItems((prev) =>
                                      prev.map((row, i) =>
                                        i === idx
                                          ? {
                                              ...row,
                                              productId: e.target.value,
                                              unitPrice: Number(products.find((x) => x.id === e.target.value)?.average_cost || 0),
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-800"
                                >
                                  {products.map((prod) => (
                                    <option key={prod.id} value={prod.id}>
                                      {prod.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={it.notes}
                                  onChange={(e) => setDraftItems((prev) => prev.map((row, i) => (i === idx ? { ...row, notes: e.target.value } : row)))}
                                  className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-md p-2 text-xs bg-white dark:bg-gray-800"
                                  placeholder="Nota (opcional)"
                                />
                              </td>
                              <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{p.unit}</td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={it.quantity}
                                  onChange={(e) =>
                                    setDraftItems((prev) =>
                                      prev.map((row, i) => (i === idx ? { ...row, quantity: Number(e.target.value) } : row)),
                                    )
                                  }
                                  className="w-28 border border-gray-300 dark:border-gray-600 rounded-md p-2 text-right bg-white dark:bg-gray-800"
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={it.unitPrice == null ? '' : it.unitPrice}
                                  onChange={(e) =>
                                    setDraftItems((prev) =>
                                      prev.map((row, i) =>
                                        i === idx ? { ...row, unitPrice: e.target.value === '' ? null : Number(e.target.value) } : row,
                                      ),
                                    )
                                  }
                                  className="w-32 border border-gray-300 dark:border-gray-600 rounded-md p-2 text-right bg-white dark:bg-gray-800"
                                />
                                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{total == null ? '' : formatCLP(total)}</div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))}
                                  className="inline-flex items-center px-2 py-2 text-red-600 hover:text-red-800"
                                  title="Quitar"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <button
                onClick={closeCreate}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-60"
              >
                Crear OC
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
