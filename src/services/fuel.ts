import { supabase } from '../supabase/client';
import { getSeasonFromDate } from '../lib/seasonUtils';

function round2(num: number) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

type FuelInvoiceItem = {
  id: string;
  quantity: number | null;
  total_price: number | null;
  category: string | null;
  products?: { name: string | null; unit: string | null; category: string | null } | { name: string | null; unit: string | null; category: string | null }[] | null;
  invoices:
    | {
        invoice_number: string | null;
        invoice_date: string;
        company_id: string;
        document_type: string | null;
        tax_percentage?: number | null;
      }
    | {
        invoice_number: string | null;
        invoice_date: string;
        company_id: string;
        document_type: string | null;
        tax_percentage?: number | null;
      }[];
};

export type FuelConsumptionLog = {
  id: string;
  date: string;
  activity: string | null;
  liters: number;
  estimated_price: number | null;
  sector_id: string | null;
  sectors?: { name: string | null } | null;
};

export type FuelConsumptionInsert = {
  company_id: string;
  date: string;
  activity: string;
  liters: number;
  estimated_price: number;
  sector_id: string;
  application_id?: string | null;
};

function pickFirst<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function getSeasonKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const raw = String(dateStr).slice(0, 10);
  const [yStr, mStr, dStr] = raw.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!y || !m) return null;
  const dt = new Date(y, m - 1, d || 2);
  if (isNaN(dt.getTime())) return null;
  return getSeasonFromDate(dt);
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
  return (data || []) as unknown as FuelInvoiceItem[];
}

export async function fetchFuelConsumptionLogs(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('fuel_consumption')
    .select('*, sectors(name)')
    .eq('company_id', params.companyId)
    .order('date', { ascending: false });

  if (error) throw error;
  return (data || []) as FuelConsumptionLog[];
}

export function computeFuelStock(params: {
  items: FuelInvoiceItem[];
  consumption: FuelConsumptionLog[];
  activeTab: 'diesel' | 'gasoline';
}) {
  const items = params.items || [];

  const fuelItems =
    items.filter((item) => {
      const product = pickFirst(item.products);
      const cat = String(item.category || product?.category || '').toLowerCase().trim();
      const productName = String(product?.name || '').toLowerCase();
      const unit = String(product?.unit || '').toLowerCase().trim();

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

  items.forEach((item) => {
    const product = pickFirst(item.products);
    const cat = String(item.category || product?.category || '').toLowerCase().trim();
    const productName = String(product?.name || '').toLowerCase();
    const unit = String(product?.unit || '').toLowerCase().trim();

    const invalidUnits = ['un', 'unid', 'unidad', 'und', 'pieza', 'kit', 'juego', 'global', 'servicio', 'hrs', 'horas'];
    if (invalidUnits.includes(unit)) return;

    let type: 'diesel' | 'gas93' | 'gas95' | null = null;
    const isDiesel = ['petroleo', 'diesel'].some((t) => cat.includes(t) || productName.includes(t));
    const isGasoline = ['bencina', 'gasolina', 'combustible'].some((t) => cat.includes(t) || productName.includes(t));

    if (isDiesel && !productName.includes('bencina') && !productName.includes('gasolina')) type = 'diesel';
    else if (isGasoline) type = productName.includes('95') ? 'gas95' : 'gas93';

    if (!type) return;

    const inv = pickFirst(item.invoices);
    const dateStr = String(inv?.invoice_date || '');
    const monthKey = dateStr.substring(0, 7);
    if (!monthlySummary[monthKey]) monthlySummary[monthKey] = { diesel: 0, gas93: 0, gas95: 0 };

    const qty = Number(item.quantity || 0);
    const docType = String(inv?.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
    const finalQty = isNC ? -Math.abs(qty) : qty;

    if (type === 'diesel') monthlySummary[monthKey].diesel = round2(monthlySummary[monthKey].diesel + finalQty);
    else if (type === 'gas93') monthlySummary[monthKey].gas93 = round2(monthlySummary[monthKey].gas93 + finalQty);
    else if (type === 'gas95') monthlySummary[monthKey].gas95 = round2(monthlySummary[monthKey].gas95 + finalQty);
  });

  const totalPurchasedLiters = round2(
    fuelItems.reduce((sum: number, item) => {
      const inv = pickFirst(item.invoices);
      const docType = String(inv?.document_type || '').toLowerCase();
      const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
      const qty = Number(item.quantity || 0);
      return sum + (isNC ? -Math.abs(qty) : qty);
    }, 0)
  );

  const totalPurchasedCost = fuelItems.reduce((sum: number, item) => {
    const inv = pickFirst(item.invoices);
    const docType = String(inv?.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
    const price = Number(item.total_price || 0);
    return sum + (isNC ? -Math.abs(price) : price);
  }, 0);

  const avgPrice = totalPurchasedLiters > 0 ? totalPurchasedCost / totalPurchasedLiters : 0;

  const filteredConsumption =
    (params.consumption || []).filter((log) => {
      const activityLower = String(log.activity || '').toLowerCase();
      const isGasoline = activityLower.includes('gasolina') || activityLower.includes('bencina');
      if (params.activeTab === 'diesel') return !isGasoline;
      return isGasoline;
    }) || [];

  const totalConsumedLiters = round2(filteredConsumption.reduce((sum: number, log) => sum + Number(log.liters), 0));

  const seasonSummary: Record<
    string,
    {
      purchasedLiters: number;
      purchasedCost: number;
      avgPrice: number;
      consumedLiters: number;
      balance: number;
    }
  > = {};

  fuelItems.forEach((item) => {
    const inv = pickFirst(item.invoices);
    const season = getSeasonKey(inv?.invoice_date);
    if (!season) return;
    if (!seasonSummary[season]) {
      seasonSummary[season] = { purchasedLiters: 0, purchasedCost: 0, avgPrice: 0, consumedLiters: 0, balance: 0 };
    }
    const docType = String(inv?.document_type || '').toLowerCase();
    const isNC = docType.includes('nota de cr') || docType.includes('nota de cre') || docType.includes('nota credito');
    const qty = Number(item.quantity || 0);
    const price = Number(item.total_price || 0);
    const finalQty = isNC ? -Math.abs(qty) : qty;
    const finalPrice = isNC ? -Math.abs(price) : price;
    seasonSummary[season].purchasedLiters = round2(seasonSummary[season].purchasedLiters + finalQty);
    seasonSummary[season].purchasedCost = seasonSummary[season].purchasedCost + finalPrice;
  });

  filteredConsumption.forEach((log) => {
    const season = getSeasonKey(log.date);
    if (!season) return;
    if (!seasonSummary[season]) {
      seasonSummary[season] = { purchasedLiters: 0, purchasedCost: 0, avgPrice: 0, consumedLiters: 0, balance: 0 };
    }
    seasonSummary[season].consumedLiters = round2(seasonSummary[season].consumedLiters + Number(log.liters || 0));
  });

  Object.keys(seasonSummary).forEach((season) => {
    const row = seasonSummary[season];
    row.avgPrice = row.purchasedLiters > 0 ? row.purchasedCost / row.purchasedLiters : 0;
    row.balance = round2(row.purchasedLiters - row.consumedLiters);
  });

  return {
    fuelItems,
    monthlySummary,
    logs: filteredConsumption,
    seasonSummary,
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

export async function updateFuelConsumptionLog(params: {
  id: string;
  patch: Partial<Pick<FuelConsumptionLog, 'date' | 'activity' | 'liters' | 'estimated_price' | 'sector_id'>>;
}) {
  const { error } = await supabase.from('fuel_consumption').update(params.patch).eq('id', params.id);
  if (error) throw error;
}

export async function insertFuelConsumptionLogs(params: { rows: FuelConsumptionInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('fuel_consumption').insert(params.rows);
  if (error) throw error;
}

export async function deleteFuelConsumptionLog(params: { id: string }) {
  const { error } = await supabase.from('fuel_consumption').delete().eq('id', params.id);
  if (error) throw error;
}

export async function deleteFuelConsumptionLogs(params: { ids: string[] }) {
  if (params.ids.length === 0) return;
  const { error } = await supabase.from('fuel_consumption').delete().in('id', params.ids);
  if (error) throw error;
}
