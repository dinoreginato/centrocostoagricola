import { toast } from 'sonner';
import React, { useState, useEffect } from 'react';
import { DollarSign, Plus, Save, Loader2, AlertCircle, Trash2, Edit2, Download } from 'lucide-react';
import { supabase } from '../supabase/client';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { utils, writeFile } from 'xlsx';
import { getSeasonFromDate } from '../lib/seasonUtils';

interface Income {
  id: string;
  date: string;
  category: string;
  amount: number;
  description: string;
  field_id?: string;
  sector_id?: string;
  quantity_kg?: number;
  amount_usd?: number;
  price_per_kg?: number;
  season?: string;
  fields?: { name: string };
  sectors?: { name: string };
}

interface Field {
  id: string;
  name: string;
  sectors: { id: string; name: string }[];
}

export function Incomes() {
  const { selectedCompany } = useCompany();
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowIncomeModal] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Partial<Income>>({});
  const [error, setError] = useState<string | null>(null);

  // Constants
  const [usdExchangeRate, setUsdExchangeRate] = useState<number>(950);

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [incomesResponse, fieldsResponse, settingsResponse] = await Promise.all([
        supabase
          .from('income_entries')
          .select(`
            *,
            fields (name),
            sectors (name)
          `)
          .eq('company_id', selectedCompany?.id)
          .order('date', { ascending: false }),
        supabase
          .from('fields')
          .select('id, name, sectors(id, name)')
          .eq('company_id', selectedCompany?.id),
        supabase
          .from('system_settings')
          .select('*')
          .eq('company_id', selectedCompany?.id)
          .single()
      ]);

      if (incomesResponse.error) throw incomesResponse.error;
      if (fieldsResponse.error) throw fieldsResponse.error;

      setIncomes(incomesResponse.data || []);
      setFields(fieldsResponse.data || []);
      
      if (settingsResponse.data && settingsResponse.data.usd_exchange_rate) {
          setUsdExchangeRate(settingsResponse.data.usd_exchange_rate);
      }

    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;

    setLoading(true);
    try {
        const payload = {
            company_id: selectedCompany.id,
            date: editingIncome.date,
            category: editingIncome.category || 'Venta Fruta',
            amount: Number(editingIncome.amount),
            description: editingIncome.description,
            season: editingIncome.date ? getSeasonFromDate(new Date(editingIncome.date + 'T12:00:00')) : getSeasonFromDate(new Date()),
            field_id: editingIncome.field_id || null,
            sector_id: editingIncome.sector_id || null,
            quantity_kg: Number(editingIncome.quantity_kg) || 0,
            amount_usd: Number(editingIncome.amount_usd) || 0,
            price_per_kg: Number(editingIncome.price_per_kg) || 0
        };

        if (editingIncome.id) {
            const { error } = await supabase
                .from('income_entries')
                .update(payload)
                .eq('id', editingIncome.id);
            if(error) throw error;
        } else {
            const { error } = await supabase
                .from('income_entries')
                .insert([payload]);
            if(error) throw error;
        }
        
        setShowIncomeModal(false);
        setEditingIncome({});
        loadData();
    } catch (error: any) {
        toast.error('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
      if (!window.confirm('¿Está seguro de eliminar este registro?')) return;
      try {
          const { error } = await supabase.from('income_entries').delete().eq('id', id);
          if (error) throw error;
          loadData();
      } catch (err: any) {
          toast.error('Error al eliminar: ' + err.message);
      }
  };

  const handleExportExcel = () => {
      const exportData = incomes.map(h => ({
          'Fecha': h.date,
          'Categoría': h.category,
          'Descripción': h.description || '-',
          'Campo': h.fields?.name || 'General',
          'Sector': h.sectors?.name || '-',
          'Kilos (Kg)': h.quantity_kg || 0,
          'Precio (US$/Kg)': h.price_per_kg || 0,
          'Total (USD)': h.amount_usd || 0,
          'Total (CLP)': h.amount
      }));

      const ws = utils.json_to_sheet(exportData);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Liquidaciones");
      writeFile(wb, `Liquidaciones_${new Date().toLocaleDateString('en-CA')}.xlsx`);
  };

  if (loading && incomes.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Liquidaciones e Ingresos</h1>
        <div className="flex gap-2">
            <button
              onClick={handleExportExcel}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </button>
            <button
              onClick={() => {
                setEditingIncome({ date: new Date().toISOString().split('T')[0], category: 'Venta Fruta' });
                setShowIncomeModal(true);
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Ingreso
            </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="ml-3 text-sm text-red-700">{error}</div>
          </div>
        </div>
      )}

      {/* Incomes List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descripción</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ubicación</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Kilos</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Precio</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total (CLP)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {incomes.map((income) => (
                <tr key={income.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(income.date + 'T12:00:00').toLocaleDateString('es-CL')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      income.category === 'Venta Fruta' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {income.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {income.description || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {income.fields?.name || 'General'} {income.sectors ? `(${income.sectors.name})` : ''}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {income.quantity_kg ? income.quantity_kg.toLocaleString('es-CL') + ' Kg' : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {income.price_per_kg ? `US$ ${income.price_per_kg}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                    {formatCLP(income.amount)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                            setEditingIncome(income);
                            setShowIncomeModal(true);
                        }}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(income.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {incomes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-sm text-gray-500">
                    No hay liquidaciones ni ingresos registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{editingIncome.id ? 'Editar Ingreso' : 'Registrar Ingreso / Liquidación'}</h3>
                <div className="text-sm text-gray-500 mb-4 text-right">
                    Tipo de Cambio: ${usdExchangeRate} CLP/USD
                </div>
                <form onSubmit={handleSaveIncome} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Fecha</label>
                        <input
                            type="date"
                            required
                            value={editingIncome.date || new Date().toISOString().split('T')[0]}
                            onChange={e => setEditingIncome({...editingIncome, date: e.target.value})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Categoría</label>
                        <select
                            value={editingIncome.category || 'Venta Fruta'}
                            onChange={e => setEditingIncome({...editingIncome, category: e.target.value})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        >
                            <option value="Venta Fruta">Venta Fruta / Exportación</option>
                            <option value="Presupuesto">Presupuesto Asignado</option>
                            <option value="Otro Ingreso">Otro Ingreso</option>
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Kilos (Kg)</label>
                            <input
                                type="number"
                                min="0"
                                value={editingIncome.quantity_kg || ''}
                                onChange={e => {
                                    const kg = Number(e.target.value);
                                    const price = editingIncome.price_per_kg || 0;
                                    const usdVal = kg * price;
                                    setEditingIncome({
                                        ...editingIncome, 
                                        quantity_kg: kg,
                                        amount_usd: usdVal,
                                        amount: Math.round(usdVal * usdExchangeRate)
                                    });
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Precio Venta (USD/Kg)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editingIncome.price_per_kg || ''}
                                onChange={e => {
                                    const price = Number(e.target.value);
                                    const kg = editingIncome.quantity_kg || 0;
                                    const usdVal = kg * price;
                                    setEditingIncome({
                                        ...editingIncome, 
                                        price_per_kg: price,
                                        amount_usd: usdVal,
                                        amount: Math.round(usdVal * usdExchangeRate)
                                    });
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Total (USD)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editingIncome.amount_usd || ''}
                                onChange={e => {
                                    const usdVal = Number(e.target.value);
                                    setEditingIncome({
                                        ...editingIncome, 
                                        amount_usd: usdVal,
                                        amount: Math.round(usdVal * usdExchangeRate)
                                    });
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Total (CLP)</label>
                            <input
                                type="number"
                                required
                                min="0"
                                value={editingIncome.amount || ''}
                                onChange={e => setEditingIncome({...editingIncome, amount: Number(e.target.value)})}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Descripción</label>
                        <input
                            type="text"
                            value={editingIncome.description || ''}
                            onChange={e => setEditingIncome({...editingIncome, description: e.target.value})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Campo (Opcional)</label>
                        <select
                            value={editingIncome.field_id || ''}
                            onChange={e => setEditingIncome({...editingIncome, field_id: e.target.value, sector_id: undefined})}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        >
                            <option value="">General (Toda la Empresa)</option>
                            {fields.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>
                    {editingIncome.field_id && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Sector (Opcional)</label>
                            <select
                                value={editingIncome.sector_id || ''}
                                onChange={e => setEditingIncome({...editingIncome, sector_id: e.target.value})}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                            >
                                <option value="">Todo el Campo</option>
                                {fields.find(f => f.id === editingIncome.field_id)?.sectors.map((s: any) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={() => setShowIncomeModal(false)}
                            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="inline-flex justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
                        >
                            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5 mr-2" />}
                            Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
}
