
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Building2, TrendingUp, DollarSign, Map, BarChart3, X, Trash2, Layout } from 'lucide-react';
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
  const { companies, selectedCompany, loading, selectCompany, addCompany, refreshCompanies } = useCompany();
  const { user } = useAuth();
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyRut, setNewCompanyRut] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);

  const [dashboardStats, setDashboardStats] = useState({
    totalFields: 0,
    totalHectares: 0,
    totalCost: 0,
    costPerHectare: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [sectorChartData, setSectorChartData] = useState<any[]>([]);
  const [upcomingInvoices, setUpcomingInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (selectedCompany) {
      loadDashboardData();
    }
  }, [selectedCompany]);

  const loadDashboardData = async () => {
    if (!selectedCompany) return;

    try {
      // 1. Load fields and their sectors
      const { data: fields } = await supabase
        .from('fields')
        .select('*, sectors(*)')
        .eq('company_id', selectedCompany.id);

      const totalFields = fields?.length || 0;
      const totalHectares = fields?.reduce((sum, field) => sum + Number(field.total_hectares), 0) || 0;

      // Flatten sectors
      const allSectors = fields?.flatMap(f => f.sectors || []) || [];
      const sectorIds = allSectors.map(s => s.id);

      // 2. Load Costs
      // A. Applications
      const { data: applications, error: appError } = await supabase
        .from('applications')
        .select('total_cost, field_id, sector_id')
        .in('field_id', fields?.map(f => f.id) || []);

      if (appError) throw appError;

      // B. Labor Assignments
      let laborAssignments: any[] = [];
      if (sectorIds.length > 0) {
          const { data: labors } = await supabase
            .from('labor_assignments')
            .select('assigned_amount, sector_id')
            .in('sector_id', sectorIds);
          laborAssignments = labors || [];
      }

      // C. Fuel Assignments (Legacy/Direct)
      let fuelAssignments: any[] = [];
      if (sectorIds.length > 0) {
          const { data: fuels } = await supabase
            .from('fuel_assignments')
            .select('assigned_amount, sector_id')
            .in('sector_id', sectorIds);
          fuelAssignments = fuels || [];
      }

      // C2. Fuel Consumption (New Stock System)
      let fuelConsumption: any[] = [];
      if (sectorIds.length > 0) {
          const { data: consumptions } = await supabase
            .from('fuel_consumption')
            .select('estimated_price, sector_id')
            .in('sector_id', sectorIds);
          fuelConsumption = consumptions || [];
      }

      // D. Machinery Assignments
      let machineryAssignments: any[] = [];
      if (sectorIds.length > 0) {
          const { data: machineries } = await supabase
            .from('machinery_assignments')
            .select('assigned_amount, sector_id')
            .in('sector_id', sectorIds);
          machineryAssignments = machineries || [];
      }

      // E. Irrigation Assignments
      let irrigationAssignments: any[] = [];
      if (sectorIds.length > 0) {
          const { data: irrigations } = await supabase
            .from('irrigation_assignments')
            .select('assigned_amount, sector_id')
            .in('sector_id', sectorIds);
          irrigationAssignments = irrigations || [];
      }

      // F. Upcoming Invoices for Zen Mode
      const today = new Date();
      const currentDay = today.getDate();
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();
      
      let startDate, endDate;

      if (currentDay <= 15) {
          // Look for invoices due between 1st and 15th of current month
          startDate = new Date(currentYear, currentMonth, 1);
          endDate = new Date(currentYear, currentMonth, 15);
      } else {
          // Look for invoices due between 16th and end of current month
          startDate = new Date(currentYear, currentMonth, 16);
          endDate = new Date(currentYear, currentMonth + 1, 0); // Last day of month
      }

      const { data: invoices } = await supabase
        .from('invoices')
        .select('invoice_number, supplier, total_amount, due_date')
        .eq('company_id', selectedCompany.id)
        .eq('status', 'Pendiente')
        .gte('due_date', startDate.toISOString().split('T')[0])
        .lte('due_date', endDate.toISOString().split('T')[0])
        .order('due_date', { ascending: true });

      setUpcomingInvoices(invoices || []);

      // Calculate Totals
      const totalAppCost = applications?.reduce((sum, app) => sum + Number(app.total_cost), 0) || 0;
      const totalLaborCost = laborAssignments.reduce((sum, l) => sum + Number(l.assigned_amount), 0);
      
      const totalFuelDirect = fuelAssignments.reduce((sum, l) => sum + Number(l.assigned_amount), 0);
      const totalFuelConsumption = fuelConsumption.reduce((sum, l) => sum + Number(l.estimated_price), 0);
      const totalFuelCost = totalFuelDirect + totalFuelConsumption;

      const totalMachineryCost = machineryAssignments.reduce((sum, l) => sum + Number(l.assigned_amount), 0);
      const totalIrrigationCost = irrigationAssignments.reduce((sum, l) => sum + Number(l.assigned_amount), 0);
      
      const totalCost = totalAppCost + totalLaborCost + totalFuelCost + totalMachineryCost + totalIrrigationCost;
      const costPerHectare = totalHectares > 0 ? totalCost / totalHectares : 0;

      setDashboardStats({
        totalFields,
        totalHectares,
        totalCost,
        costPerHectare
      });

      // 3. Prepare Chart Data: Cost per Field
      const fieldCosts = fields?.map(field => {
        // App costs for this field
        const fieldAppCost = applications?.filter(app => app.field_id === field.id)
            .reduce((sum, app) => sum + Number(app.total_cost), 0) || 0;
        
        // Assignments for sectors in this field
        const fieldSectorIds = field.sectors?.map(s => s.id) || [];
        
        const fieldLaborCost = laborAssignments
            .filter(l => fieldSectorIds.includes(l.sector_id))
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);
        
        const fieldFuelDirect = fuelAssignments
            .filter(l => fieldSectorIds.includes(l.sector_id))
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);
        const fieldFuelConsumption = fuelConsumption
            .filter(l => fieldSectorIds.includes(l.sector_id))
            .reduce((sum, l) => sum + Number(l.estimated_price), 0);
        const fieldFuelCost = fieldFuelDirect + fieldFuelConsumption;

        const fieldMachineryCost = machineryAssignments
            .filter(l => fieldSectorIds.includes(l.sector_id))
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);

        const fieldIrrigationCost = irrigationAssignments
            .filter(l => fieldSectorIds.includes(l.sector_id))
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);

        const totalFieldCost = fieldAppCost + fieldLaborCost + fieldFuelCost + fieldMachineryCost + fieldIrrigationCost;

        return {
          name: field.name,
          cost: totalFieldCost,
          hectares: field.total_hectares,
          costPerHa: field.total_hectares > 0 ? totalFieldCost / field.total_hectares : 0
        };
      });

      setChartData(fieldCosts || []);

      // 4. Prepare Chart Data: Cost per Sector (Detailed)
      const sectorCosts = allSectors.map(sector => {
          // App costs
          const sectorAppCost = applications?.filter(app => app.sector_id === sector.id)
            .reduce((sum, app) => sum + Number(app.total_cost), 0) || 0;
          
          // Labor
          const sectorLaborCost = laborAssignments
            .filter(l => l.sector_id === sector.id)
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);
          
          // Fuel (Direct + Consumption)
          const sectorFuelDirect = fuelAssignments
            .filter(l => l.sector_id === sector.id)
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);
          const sectorFuelConsumption = fuelConsumption
            .filter(l => l.sector_id === sector.id)
            .reduce((sum, l) => sum + Number(l.estimated_price), 0);
          const sectorFuelCost = sectorFuelDirect + sectorFuelConsumption;

          // Machinery
          const sectorMachineryCost = machineryAssignments
            .filter(l => l.sector_id === sector.id)
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);

          // Irrigation
          const sectorIrrigationCost = irrigationAssignments
            .filter(l => l.sector_id === sector.id)
            .reduce((sum, l) => sum + Number(l.assigned_amount), 0);
          
          const totalSectorCost = sectorAppCost + sectorLaborCost + sectorFuelCost + sectorMachineryCost + sectorIrrigationCost;
          
          return {
              name: sector.name,
              fieldName: fields?.find(f => f.id === sector.field_id)?.name || '',
              totalCost: totalSectorCost,
              hectares: sector.hectares,
              costPerHa: sector.hectares > 0 ? totalSectorCost / sector.hectares : 0,
              laborCost: sectorLaborCost,
              appCost: sectorAppCost,
              machineryCost: sectorMachineryCost,
              irrigationCost: sectorIrrigationCost,
              fuelCost: sectorFuelCost
          };
      }).sort((a, b) => b.costPerHa - a.costPerHa);

      setSectorChartData(sectorCosts);

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  };

  const handleDeleteCompany = async () => {
    if (!selectedCompany || !user) return;
    
    const isOwner = selectedCompany.owner_id === user.id;
    const isSystemAdmin = user.email === 'dino.reginato@gmail.com';
    
    if (!isOwner && !isSystemAdmin) {
        alert('Solo el dueño de la empresa puede eliminarla.');
        return;
    }

    if (!window.confirm(`PELIGRO: ¿Estás seguro de eliminar la empresa "${selectedCompany.name}"?\n\nEsta acción borrará PERMANENTEMENTE todos los campos, facturas, bodega y aplicaciones asociados.\n\nNO SE PUEDE DESHACER.`)) return;
    
    const confirmName = prompt(`Para confirmar, escribe el nombre de la empresa: "${selectedCompany.name}"`);
    if (confirmName !== selectedCompany.name) {
        alert('El nombre no coincide. Eliminación cancelada.');
        return;
    }

    setIsDeleting(true);
    try {
        const { error } = await supabase
            .from('companies')
            .delete()
            .eq('id', selectedCompany.id);
        
        if (error) throw error;
        
        alert('Empresa eliminada exitosamente.');
        await refreshCompanies();
        
    } catch (err: any) {
        console.error('Error deleting company:', err);
        alert('Error al eliminar: ' + err.message);
    } finally {
        setIsDeleting(false);
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-lg shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500">Resumen de costos y producción</p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-2">
          <button
            onClick={() => setSimpleMode(!simpleMode)}
            className={`inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                simpleMode 
                ? 'text-blue-700 bg-blue-100 hover:bg-blue-200' 
                : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
            }`}
            title="Alternar Modo Simplificado"
          >
            <Layout className="h-4 w-4 mr-1" />
            {simpleMode ? 'Vista Detallada' : 'Vista Zen'}
          </button>

          <div className="h-6 w-px bg-gray-300 mx-2"></div>

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
             onClick={() => {
                if (user?.email !== 'dino.reginato@gmail.com') {
                    alert('Solo el administrador del sistema puede crear nuevas empresas.');
                    return;
                }
                setShowNewCompanyModal(true);
             }}
             className={`inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 ${
                user?.email === 'dino.reginato@gmail.com' 
                ? 'text-green-700 bg-green-100 hover:bg-green-200' 
                : 'text-gray-400 bg-gray-100 cursor-not-allowed'
             }`}
             title={user?.email === 'dino.reginato@gmail.com' ? 'Crear nueva empresa' : 'Solo el administrador puede crear empresas'}
          >
            <Plus className="h-4 w-4 mr-1" />
            Nueva Empresa
          </button>
          
          {selectedCompany && user && (selectedCompany.owner_id === user.id || user.email === 'dino.reginato@gmail.com') && (
            <button
              onClick={handleDeleteCompany}
              disabled={isDeleting}
              className="ml-2 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
              title="Eliminar Empresa Actual"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {simpleMode ? (
        // SIMPLE MODE UI
        <div className="space-y-8 mt-8">
            {/* 
            {upcomingInvoices.length > 0 && (
                <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-r-2xl shadow-sm">
                    <div className="flex items-center mb-4">
                        <AlertCircle className="h-6 w-6 text-red-600 mr-2" />
                        <h3 className="text-xl font-bold text-red-800">Facturas Próximas a Vencer ({new Date().getDate() <= 15 ? 'Quincena 1' : 'Quincena 2'})</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {upcomingInvoices.map((inv, idx) => (
                            <div key={idx} className="bg-white p-4 rounded-lg shadow border border-red-100 flex flex-col justify-between">
                                <div>
                                    <div className="font-semibold text-gray-800">{inv.supplier}</div>
                                    <div className="text-sm text-gray-500">Factura: {inv.invoice_number}</div>
                                </div>
                                <div className="mt-3 flex justify-between items-end">
                                    <div className="text-2xl font-bold text-red-600">
                                        {inv.total_amount ? formatCLP(Number(inv.total_amount)) : '$0'}
                                    </div>
                                    <div className="text-sm font-medium text-red-500 bg-red-100 px-2 py-1 rounded">
                                        Vence: {inv.due_date ? new Date(inv.due_date).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : 'N/A'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            */}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl shadow-lg p-8 text-white transform transition hover:scale-105">
                    <div className="text-green-100 text-lg font-medium mb-2">Costo Total Acumulado</div>
                    <div className="text-5xl font-bold">{formatCLP(dashboardStats.totalCost)}</div>
                    <div className="mt-4 text-green-100 flex items-center">
                        <TrendingUp className="h-5 w-5 mr-2" />
                        <span>Inversión Total</span>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 transform transition hover:scale-105">
                    <div className="text-gray-500 text-lg font-medium mb-2">Costo Promedio / Hectárea</div>
                    <div className="text-5xl font-bold text-gray-800">{formatCLP(dashboardStats.costPerHectare)}</div>
                    <div className="mt-4 text-gray-400 flex items-center">
                        <Map className="h-5 w-5 mr-2" />
                        <span>{dashboardStats.totalHectares} Hectáreas Totales</span>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 transform transition hover:scale-105">
                    <div className="text-gray-500 text-lg font-medium mb-4">Sectores Más Costosos</div>
                    <div className="space-y-4">
                        {sectorChartData.slice(0, 3).map((sector, idx) => (
                            <div key={idx} className="flex justify-between items-center border-b border-gray-50 pb-2 last:border-0">
                                <div>
                                    <div className="font-bold text-gray-800">{sector.name}</div>
                                    <div className="text-xs text-gray-400">{sector.fieldName}</div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-orange-600">{formatCLP(sector.costPerHa)}/ha</div>
                                </div>
                            </div>
                        ))}
                        {sectorChartData.length === 0 && <div className="text-gray-400 italic">Sin datos</div>}
                    </div>
                </div>
            </div>
        </div>
      ) : (
        // DETAILED MODE UI (Original)
        <>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Costos por Campo</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => formatCLP(value)} />
                  <Tooltip formatter={(value) => formatCLP(Number(value))} />
                  <Legend />
                  <Bar dataKey="cost" name="Costo Total" fill="#2E7D32" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Costo / Hectárea por Sector</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sectorChartData.slice(0, 10)} 
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(value) => formatCLP(value)} />
                  <YAxis type="category" dataKey="name" width={100} />
                  <Tooltip 
                    formatter={(value: number) => [formatCLP(value), 'Costo/Ha']}
                    labelFormatter={(label) => `Sector: ${label}`}
                  />
                  <Legend />
                  <Bar dataKey="costPerHa" name="Costo por Hectárea" fill="#E65100" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">* Mostrando los 10 sectores con mayor costo por hectárea</p>
          </div>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Desglose de Costos por Sector</h3>
            <p className="mt-1 text-sm text-gray-500">Detalle de costos acumulados (Aplicaciones + Labores)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector / Campo</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Hectáreas</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Labores</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Aplicaciones</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Maquinaria</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Riego</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Combustible</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Total</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider">Costo / Ha</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sectorChartData.map((sector, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{sector.name}</div>
                      <div className="text-xs text-gray-500">{sector.fieldName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                      {sector.hectares} ha
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                      {formatCLP(sector.laborCost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-600">
                      {formatCLP(sector.appCost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600">
                      {formatCLP(sector.machineryCost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-cyan-600">
                      {formatCLP(sector.irrigationCost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-purple-600">
                       {formatCLP(sector.fuelCost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                      {formatCLP(sector.totalCost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-orange-600">
                      {formatCLP(sector.costPerHa)}
                    </td>
                  </tr>
                ))}
                {sectorChartData.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                      No hay datos de costos registrados aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
      </div>
      </>
      )}

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
