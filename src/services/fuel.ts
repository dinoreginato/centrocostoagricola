import { supabase } from '../supabase/client';

function round2(num: number) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export async function fetchFuelInvoiceItems(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('invoice_items')
    .select(
      `
      id, quantity, total_price, category,
      products (name, unit, category),
      invoices!inner (invoice_number, invoice_date, company_id, document_type, tax_percentage)
    `
    )
    .eq('invoices.company_id', params.companyId);

  if (error) throw error;
  return (data || []) as any[];
}

export async function fetchFuelConsumptionLogs(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('fuel_consumption')
    .select('*, sectors(name)')
    .eq('company_id', params.companyId)
    .order('date', { ascending: false });

  if (error) throw error;
  return (data || []) as any[];
}

export function computeFuelStock(params: { items: any[]; consumption: any[]; activeTab: 'diesel' | 'gasoline' }) {
  const items = params.items || [];

  const fuelItems =
    items.filter((item: any) => {
      const cat = String(item.category || item.products?.category || '').toLowerCase().trim();
      const productName = String(item.products?.name || '').toLowerCase();
      const unit = String(item.products?.unit || '').toLowerCase().trim();

      const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];
      if (invalidUnits.includes(unit)) return false;

      const isDieselMatch = ['petroleo', 'diesel'].some((t) => cat.includes(t) || productName.includes(t));
      const isGasolineMatch = ['bencina', 'gasolina', 'combustible'].some((t) => cat.includes(t) || productName.includes(t));

      let itemType: 'diesel' | 'gasoline' | null = null;
      if (isDieselMatch && !productName.includes('bencina') && !productName.includes('gasolina')) itemType = 'diesel';
      else if (isGasolineMatch) itemType = 'gasoline';

      if (params.activeTab === 'diesel') return itemType === 'diesel';
      return itemType === 'gasoline';
    }) || [];

  const monthlySummary: Record<string, { diesel: number; gas93: number; gas95: number }> = {};

  items.forEach((item: any) => {
    const cat = String(item.category || item.products?.category || '').toLowerCase().trim();
    const productName = String(item.products?.name || '').toLowerCase();
    const unit = String(item.products?.unit || '').toLowerCase().trim();

    const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];
    if (invalidUnits.includes(unit)) return;

    let type: 'diesel' | 'gas93' | 'gas95' | null = null;
    const isDiesel = ['petroleo', 'diesel'].some((t) => cat.includes(t) || productName.includes(t));
    const isGasoline = ['bencina', 'gasolina', 'combustible'].some((t) => cat.includes(t) || productName.includes(t));

    if (isDiesel && !productName.includes('bencina') && !productName.includes('gasolina')) type = 'diesel';
    else if (isGasoline) type = productName.includes('95') ? 'gas95' : 'gas93';

    if (!type) return;

    const dateStr = String(item.invoices.invoice_date);
    const monthKey = dateStr.substring(0, 7);
    if (!monthlySummary[monthKey]) monthlySummary[monthKey] = { diesel: 0, gas93: 0, gas95: 0 };

    const qty = Number(item.quantity || 0);
    const docType = String(item.invoices.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
    const finalQty = isNC ? -Math.abs(qty) : qty;

    if (type === 'diesel') monthlySummary[monthKey].diesel = round2(monthlySummary[monthKey].diesel + finalQty);
    else if (type === 'gas93') monthlySummary[monthKey].gas93 = round2(monthlySummary[monthKey].gas93 + finalQty);
    else if (type === 'gas95') monthlySummary[monthKey].gas95 = round2(monthlySummary[monthKey].gas95 + finalQty);
  });

  const totalPurchasedLiters = round2(
    fuelItems.reduce((sum: number, item: any) => {
      const docType = String(item.invoices.document_type || '').toLowerCase();
      const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
      const qty = Number(item.quantity || 0);
      return sum + (isNC ? -Math.abs(qty) : qty);
    }, 0)
  );

  const totalPurchasedCost = fuelItems.reduce((sum: number, item: any) => {
    const docType = String(item.invoices.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
    const price = Number(item.total_price || 0);
    return sum + (isNC ? -Math.abs(price) : price);
  }, 0);

  const avgPrice = totalPurchasedLiters > 0 ? totalPurchasedCost / totalPurchasedLiters : 0;

  const filteredConsumption =
    (params.consumption || []).filter((log: any) => {
      const activityLower = String(log.activity || '').toLowerCase();
      const isGasoline = activityLower.includes('gasolina') || activityLower.includes('bencina');
      if (params.activeTab === 'diesel') return !isGasoline;
      return isGasoline;
    }) || [];

  const totalConsumedLiters = round2(filteredConsumption.reduce((sum: number, log: any) => sum + Number(log.liters), 0));

  return {
    fuelItems,
    monthlySummary,
    logs: filteredConsumption,
    stats: {
      totalPurchasedLiters,
      totalPurchasedCost,
      avgPrice,
      totalConsumedLiters,
      currentStock: round2(totalPurchasedLiters - totalConsumedLiters)
    }
  };
}

export async function loadFuelStockAndLogs(params: { companyId: string; activeTab: 'diesel' | 'gasoline' }) {
  const [items, consumption] = await Promise.all([fetchFuelInvoiceItems({ companyId: params.companyId }), fetchFuelConsumptionLogs({ companyId: params.companyId })]);
  return computeFuelStock({ items, consumption, activeTab: params.activeTab });
}

