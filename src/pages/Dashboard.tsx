
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Building2, TrendingUp, DollarSign, Map, BarChart3, X } from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';

export const Dashboard: React.FC = () => {
  const { companies, selectedCompany, loading, selectCompany, addCompany } = useCompany();
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyRut, setNewCompanyRut] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [dashboardStats, setDashboardStats] = useState({
    totalFields: 0,
    totalHectares: 0,
    totalCost: 0,
    costPerHectare: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    if (selectedCompany) {
      loadDashboardData();
    }
  }, [selectedCompany]);

  const loadDashboardData = async () => {
    if (!selectedCompany) return;

    try {
      // Load fields
      const { data: fields } = await supabase
        .from('fields')
        .select('*')
        .eq('company_id', selectedCompany.id);

      const totalFields = fields?.length || 0;
      const totalHectares = fields?.reduce((sum, field) => sum + Number(field.total_hectares), 0) || 0;

      // Load applications for cost calculation (Simplified for now)
      // Ideally we would join tables, but doing separate queries for simplicity in MVP
      // In real app, create a view or RPC for this.
      const { data: applications, error } = await supabase
        .from('applications')
        .select('total_cost, field_id')
        .in('field_id', fields?.map(f => f.id) || []);

      if (error) throw error;
      
      const totalCost = applications?.reduce((sum, app) => sum + Number(app.total_cost), 0) || 0;
      const costPerHectare = totalHectares > 0 ? totalCost / totalHectares : 0;

      setDashboardStats({
        totalFields,
        totalHectares,
        totalCost,
        costPerHectare
      });

      // Prepare chart data: Cost per field
      const fieldCosts = fields?.map(field => {
        const fieldApps = applications?.filter(app => app.field_id === field.id);
        const fieldCost = fieldApps?.reduce((sum, app) => sum + Number(app.total_cost), 0) || 0;
        return {
          name: field.name,
          cost: fieldCost,
          hectares: field.total_hectares,
          costPerHa: field.total_hectares > 0 ? fieldCost / field.total_hectares : 0
        };
      });

      setChartData(fieldCosts || []);

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('companies')
        .insert([{
          name: newCompanyName,
          rut: newCompanyRut.trim() || null,
          owner_id: user.id
        }])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        addCompany(data);
        setNewCompanyName('');
        setNewCompanyRut('');
        setShowNewCompanyModal(false);
      }
    } catch (error: any) {
      console.error('Error creating company:', error);
      alert('Error al crear la empresa: ' + (error.message || 'Error desconocido'));
    } finally {
      setIsCreating(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8">Cargando...</div>;
  }

  if (companies.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4 text-center text-gray-800">¡Bienvenido!</h2>
        <p className="text-gray-600 mb-6 text-center">Para comenzar, crea tu primera empresa agrícola.</p>
        
        <form onSubmit={handleCreateCompany} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Nombre de la Empresa</label>
            <input
              type="text"
              required
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="Ej: Agrícola Los Lagos"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">RUT (Opcional)</label>
            <input
              type="text"
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              value={newCompanyRut}
              onChange={(e) => setNewCompanyRut(e.target.value)}
              placeholder="Ej: 76.123.456-7"
            />
          </div>
          <button
            type="submit"
            disabled={isCreating}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
          >
            {isCreating ? 'Creando...' : 'Crear Empresa'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Company Selector */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-lg shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500">Resumen de costos y producción</p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-2">
          <Building2 className="text-gray-400 h-5 w-5" />
          <select
            value={selectedCompany?.id || ''}
            onChange={(e) => selectCompany(e.target.value)}
            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <button
             type="button"
             onClick={() => setShowNewCompanyModal(true)}
             className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-green-700 bg-green-100 hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <Plus className="h-4 w-4 mr-1" />
            Nueva Empresa
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Map className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Campos</dt>
                  <dd>
                    <div className="text-lg font-medium text-gray-900">{dashboardStats.totalFields}</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Hectáreas Totales</dt>
                  <dd>
                    <div className="text-lg font-medium text-gray-900">{dashboardStats.totalHectares} ha</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DollarSign className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Costo Total</dt>
                  <dd>
                    <div className="text-lg font-medium text-gray-900">{formatCLP(dashboardStats.totalCost)}</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BarChart3 className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Costo Promedio / ha</dt>
                  <dd>
                    <div className="text-lg font-medium text-gray-900">{formatCLP(dashboardStats.costPerHectare)}</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Costos por Campo</h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{
                top: 5,
                right: 30,
                left: 20,
                bottom: 5,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(value) => formatCLP(value)} />
              <Tooltip formatter={(value) => formatCLP(Number(value))} />
              <Legend />
              <Bar dataKey="cost" name="Costo Total" fill="#2E7D32" />
              <Bar dataKey="costPerHa" name="Costo / Ha" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* New Company Modal */}
      {showNewCompanyModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
          <div className="relative bg-white rounded-lg shadow-xl p-8 max-w-md w-full m-4">
            <button
              onClick={() => setShowNewCompanyModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="h-6 w-6" />
            </button>
            
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Nueva Empresa</h2>
            
            <form onSubmit={handleCreateCompany} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre de la Empresa</label>
                <input
                  type="text"
                  required
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="Ej: Agrícola Los Lagos"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">RUT (Opcional)</label>
                <input
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                  value={newCompanyRut}
                  onChange={(e) => setNewCompanyRut(e.target.value)}
                  placeholder="Ej: 76.123.456-7"
                />
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowNewCompanyModal(false)}
                  className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                >
                  {isCreating ? 'Creando...' : 'Crear Empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
