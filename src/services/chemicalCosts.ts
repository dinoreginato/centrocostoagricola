import { supabase } from '../supabase/client';

export type ExchangeRateCache = Record<string, number>;

export async function fetchYearlyExchangeRates(year: number): Promise<ExchangeRateCache> {
  const response = await fetch(`https://mindicador.cl/api/dolar/${year}`);
  if (!response.ok) throw new Error('Error fetching exchange rates');
  const data = await response.json();

  const rates: ExchangeRateCache = {};
  if (data.serie) {
    data.serie.forEach((item: any) => {
      const date = item.fecha.split('T')[0];
      rates[date] = item.valor;
    });
  }

  return rates;
}

export function getExchangeRateForDate(dateStr: string, rates: ExchangeRateCache): number {
  if (rates[dateStr]) return rates[dateStr];

  const date = new Date(dateStr);
  for (let i = 0; i < 5; i++) {
    date.setDate(date.getDate() - 1);
    const prevDateStr = date.toISOString().split('T')[0];
    if (rates[prevDateStr]) return rates[prevDateStr];
  }

  return 0;
}

export async function fetchChemicalInvoices(params: { companyId: string; year: number }) {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      id, invoice_number, invoice_date, supplier,
      invoice_items (
        id, category, total_price, quantity, unit_price,
        products (name, unit, category)
      )
    `
    )
    .eq('company_id', params.companyId)
    .gte('invoice_date', `${params.year}-01-01`)
    .lte('invoice_date', `${params.year}-12-31`);

  if (error) throw error;
  return data || [];
}

