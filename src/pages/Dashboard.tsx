
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { Plus, Building2, TrendingUp, DollarSign, Map, BarChart3, X, Trash2, Layout, AlertCircle, Play, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';
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
import { WeatherWidget } from '../components/WeatherWidget';

export const Dashboard: React.FC = () => {
  const { companies, selectedCompany, loading, selectCompany, addCompany, refreshCompanies } = useCompany();
  const { user } = useAuth();
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyRut, setNewCompanyRut] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true); // Default to Zen Mode
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null); // For invoice modal
  const [presentationMode, setPresentationMode] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const [dashboardStats, setDashboardStats] = useState({
    totalFields: 0,
    totalHectares: 0,
    totalCost: 0,
    costPerHectare: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [sectorChartData, setSectorChartData] = useState<any[]>([]);
  const [upcomingInvoices, setUpcomingInvoices] = useState<any[]>([]);
  const [criticalStock, setCriticalStock] = useState<any[]>([]); 
  const [sectorSafetyStatus, setSectorSafetyStatus] = useState<any[]>([]); 
  
  // Rain State
  const [rainLogs, setRainLogs] = useState<any[]>([]);
  const [newRainDate, setNewRainDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [newRainMm, setNewRainMm] = useState<number | ''>('');// New State

  useEffect(() => {
    if (selectedCompany) {
      loadDashboardData();
    }
  }, [selectedCompany]);

  // Keyboard navigation for presentation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!presentationMode) return;
      
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setCurrentSlide(s => Math.min(s + 1, 4)); // 5 slides total (0 to 4)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentSlide(s => Math.max(s - 1, 0));
      } else if (e.key === 'Escape') {
        exitPresentation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [presentationMode]);

  const startPresentation = () => {
    setPresentationMode(true);
    setCurrentSlide(0);
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(err => console.log('Error attempting to enable fullscreen:', err));
    }
  };

  const exitPresentation = () => {
    setPresentationMode(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(err => console.log('Error attempting to exit fullscreen:', err));
    }
  };

  const handleSaveRain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany || !newRainMm) return;

    try {
        const { error } = await supabase
            .from('rain_logs')
            .insert([{
                company_id: selectedCompany.id,
                date: newRainDate,
                rain_mm: Number(newRainMm)
            }]);

        if (error) throw error;
        
        setNewRainMm('');
        loadDashboardData();
    } catch (err) {
        console.error('Error saving rain:', err);
        alert('Error al registrar lluvia');
    }
  };

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
        .select(`
          id,
          invoice_number, 
          supplier, 
          total_amount, 
          due_date, 
          notes,
          invoice_items (
            quantity,
            unit_price,
            total_price,
            category,
            products (name, unit)
          )
        `)
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

      // 5. Load Critical Stock & Expiring Products
      const { data: stockData } = await supabase
        .from('products')
        .select('name, current_stock, minimum_stock, unit, expiration_date')
        .eq('company_id', selectedCompany.id);

      if (stockData) {
          const critical = stockData.filter(p => p.minimum_stock > 0 && p.current_stock <= p.minimum_stock);
          
          // Check for expiring products (within 30 days)
          const today = new Date();
          const nextMonth = new Date(today);
          nextMonth.setDate(today.getDate() + 30);
          
          const expiring = stockData.filter(p => {
              if (!p.expiration_date) return false;
              const expDate = new Date(p.expiration_date);
              return expDate <= nextMonth;
          }).map(p => ({
              ...p,
              isExpired: new Date(p.expiration_date) < today
          }));

          setCriticalStock([...critical, ...expiring.map(p => ({
              ...p,
              is_expiration_warning: true
          }))]);
      }

      // 6. Load Safety Status (Application Orders)
      const { data: ordersData } = await supabase
        .from('application_orders')
        .select('sector_id, scheduled_date, safety_period_hours, grace_period_days, sector:sectors(name)')
        .eq('company_id', selectedCompany.id)
        .order('scheduled_date', { ascending: false });

      if (ordersData) {
          const now = new Date();
          const safetyStatus = allSectors.map(sector => {
              // Get the most recent order for this sector
              const recentOrder = ordersData.find(o => o.sector_id === sector.id);
              if (!recentOrder) return { sectorName: sector.name, status: 'verde', message: 'Sin aplicaciones recientes' };

              const orderDate = new Date(recentOrder.scheduled_date + 'T00:00:00');
              const reentryDate = new Date(orderDate.getTime() + (recentOrder.safety_period_hours || 0) * 60 * 60 * 1000);
              const graceDate = new Date(orderDate.getTime() + (recentOrder.grace_period_days || 0) * 24 * 60 * 60 * 1000);

              if (now < reentryDate) {
                  return { sectorName: sector.name, status: 'rojo', message: `Prohibido entrar hasta ${reentryDate.toLocaleDateString()}` };
              } else if (now < graceDate) {
                  return { sectorName: sector.name, status: 'amarillo', message: `No cosechar hasta ${graceDate.toLocaleDateString()}` };
              } else {
                  return { sectorName: sector.name, status: 'verde', message: 'Seguro para reingreso y cosecha' };
              }
          });

          // Only keep red and yellow for the widget to keep it clean
          setSectorSafetyStatus(safetyStatus.filter(s => s.status !== 'verde'));
      }

      // 7. Load Rain Logs
      const currentYear = new Date().getFullYear();
      const { data: rainData } = await supabase
        .from('rain_logs')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .gte('date', `${currentYear}-01-01`)
        .order('date', { ascending: false });
        
      setRainLogs(rainData || []);

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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-lg shadow-sm print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500">Resumen de costos y producción</p>
        </div>
        
        {/* Right Action Section */}
        <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-3">
          {/* Main Actions */}
          <div className="flex items-center space-x-2">
              <button
                onClick={startPresentation}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 shadow-sm"
                title="Iniciar Presentación a Pantalla Completa"
              >
                <Play className="h-4 w-4 mr-2" />
                Presentar
              </button>

              <button
                onClick={() => setSimpleMode(!simpleMode)}
                className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm ${
                    simpleMode 
                    ? 'text-blue-700 bg-blue-100 hover:bg-blue-200' 
                    : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                }`}
                title="Alternar Modo Simplificado"
              >
                <Layout className="h-4 w-4 mr-2" />
                {simpleMode ? 'Vista Detallada' : 'Vista Zen'}
              </button>
          </div>

          <div className="h-6 w-px bg-gray-300 hidden sm:block mx-1"></div>

          {/* Company Controls */}
          <div className="flex items-center space-x-2">
              <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Building2 className="text-gray-400 h-4 w-4" />
                  </div>
                  <select
                    value={selectedCompany?.id || ''}
                    onChange={(e) => selectCompany(e.target.value)}
                    className="block w-full pl-9 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 rounded-md font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 cursor-pointer shadow-sm"
                  >
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
              </div>

              <button
                 type="button"
                 onClick={() => {
                    if (user?.email !== 'dino.reginato@gmail.com') {
                        alert('Solo el administrador del sistema puede crear nuevas empresas.');
                        return;
                    }
                    setShowNewCompanyModal(true);
                 }}
                 className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-sm ${
                    user?.email === 'dino.reginato@gmail.com' 
                    ? 'text-white bg-green-600 hover:bg-green-700' 
                    : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                 }`}
                 title={user?.email === 'dino.reginato@gmail.com' ? 'Crear nueva empresa' : 'Solo el administrador puede crear empresas'}
              >
                <Plus className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Nueva Empresa</span>
              </button>
              
              {selectedCompany && user && (selectedCompany.owner_id === user.id || user.email === 'dino.reginato@gmail.com') && (
                <button
                  onClick={handleDeleteCompany}
                  disabled={isDeleting}
                  className="inline-flex items-center p-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 shadow-sm"
                  title="Eliminar Empresa Actual"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
          </div>
        </div>
      </div>

      {simpleMode ? (
        // SIMPLE MODE UI
        <div className="space-y-8 mt-8 print:mt-4">
            {upcomingInvoices.length > 0 && (
                <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-r-2xl shadow-sm print:hidden">
                    <div className="flex items-center mb-4">
                        <AlertCircle className="h-6 w-6 text-red-600 mr-2" />
                        <h3 className="text-xl font-bold text-red-800">Facturas Próximas a Vencer ({new Date().getDate() <= 15 ? 'Quincena 1' : 'Quincena 2'})</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {upcomingInvoices.map((inv, idx) => (
                            <div 
                              key={idx} 
                              onClick={() => setSelectedInvoice(inv)}
                              className="bg-white p-3 rounded-md shadow-sm border border-red-100 flex flex-col justify-between h-full hover:shadow-md transition-shadow duration-200 cursor-pointer hover:bg-red-50"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="font-bold text-gray-700 text-sm truncate pr-2 flex-1" title={inv.supplier || ''}>{inv.supplier || 'Proveedor desconocido'}</div>
                                    <div className="text-xs text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-100 whitespace-nowrap">
                                        {inv.due_date ? new Date(inv.due_date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : 'N/A'}
                                    </div>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="text-xs text-gray-400 truncate max-w-[50%]" title={inv.invoice_number || ''}>
                                        N° {inv.invoice_number || '-'}
                                    </div>
                                    <div className="text-base font-bold text-red-600">
                                        {inv.total_amount ? formatCLP(Number(inv.total_amount)) : '$0'}
                                    </div>
                                </div>
                                {inv.notes && (
                                    <div className="mt-2 text-xs text-gray-500 italic border-t border-gray-100 pt-1 truncate" title={inv.notes}>
                                        {inv.notes}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 lg:gap-6 print:grid-cols-4 print:gap-4">
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-sm p-4 lg:p-5 text-white transform transition hover:scale-105 print:transform-none print:shadow-none print:border print:border-gray-200 print:text-black print:bg-none print:bg-white flex flex-col justify-center">
                    <div className="text-green-100 text-xs lg:text-sm font-medium mb-1 print:text-gray-600">Costo Total Acumulado</div>
                    <div className="text-xl lg:text-2xl font-bold truncate print:text-xl" title={formatCLP(Number(dashboardStats.totalCost) || 0)}>
                        {formatCLP(Number(dashboardStats.totalCost) || 0)}
                    </div>
                    <div className="mt-2 text-green-100 flex items-center text-[10px] lg:text-xs print:text-gray-500 print:mt-2">
                        <TrendingUp className="h-3 w-3 mr-1 print:text-gray-400" />
                        <span>Inversión Total</span>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-5 border border-gray-100 transform transition hover:scale-105 print:transform-none print:shadow-none flex flex-col justify-center">
                    <div className="text-gray-500 text-xs lg:text-sm font-medium mb-1">Costo Promedio / Hectárea</div>
                    <div className="text-xl lg:text-2xl font-bold text-gray-800 truncate print:text-xl" title={formatCLP(Number(dashboardStats.costPerHectare) || 0)}>
                        {formatCLP(Number(dashboardStats.costPerHectare) || 0)}
                    </div>
                    <div className="mt-2 text-gray-400 flex items-center text-[10px] lg:text-xs print:mt-2">
                        <Map className="h-3 w-3 mr-1" />
                        <span>{dashboardStats.totalHectares} Hectáreas Totales</span>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-5 border border-gray-100 transform transition hover:scale-105 print:transform-none print:shadow-none">
                    <div className="text-gray-500 text-xs lg:text-sm font-medium mb-3 print:mb-2">Sectores Más Costosos</div>
                    <div className="space-y-3">
                        {Array.isArray(sectorChartData) && sectorChartData.slice(0, 3).map((sector, idx) => (
                            <div key={idx} className="flex justify-between items-center border-b border-gray-50 pb-1.5 last:border-0">
                                <div>
                                    <div className="font-bold text-gray-800 text-xs lg:text-sm truncate max-w-[100px]">{sector?.name || 'Sin nombre'}</div>
                                    <div className="text-[10px] text-gray-400">{sector?.fieldName || ''}</div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-orange-600 text-xs lg:text-sm">{formatCLP(Number(sector?.costPerHa) || 0)}/ha</div>
                                </div>
                            </div>
                        ))}
                        {(!sectorChartData || sectorChartData.length === 0) && <div className="text-xs text-gray-400 italic">Sin datos</div>}
                    </div>
                </div>

                {/* Sector Safety Status Widget */}
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-5 border border-gray-100 transform transition hover:scale-105 print:hidden">
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-orange-600 text-xs lg:text-sm font-medium">Reingreso / Carencia</div>
                        <ShieldAlert className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="space-y-3 max-h-32 overflow-y-auto">
                        {sectorSafetyStatus.length > 0 ? (
                            sectorSafetyStatus.map((status, idx) => (
                                <div key={idx} className="flex justify-between items-center border-b border-gray-50 pb-1.5 last:border-0">
                                    <div className="font-medium text-gray-800 text-xs lg:text-sm truncate max-w-[100px]">{status.sectorName}</div>
                                    <div className="text-right flex items-center">
                                        <div className={`w-2 h-2 rounded-full mr-1.5 ${status.status === 'rojo' ? 'bg-red-500' : 'bg-yellow-400'}`}></div>
                                        <div className="text-[10px] text-gray-500 max-w-[90px] truncate" title={status.message}>{status.message}</div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-xs text-green-600 italic flex items-center">
                                <CheckCircle className="h-3 w-3 mr-1" /> Campos seguros
                            </div>
                        )}
                    </div>
                </div>

                {/* Critical Stock & Expiration Widget */}
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-5 border border-gray-100 transform transition hover:scale-105 print:hidden">
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-red-500 text-xs lg:text-sm font-medium">Alertas Bodega</div>
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="space-y-3 max-h-32 overflow-y-auto">
                        {criticalStock.length > 0 ? (
                            criticalStock.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center border-b border-gray-50 pb-1.5 last:border-0">
                                    <div className="font-medium text-gray-800 text-xs lg:text-sm truncate max-w-[120px]">{item.name}</div>
                                    <div className="text-right">
                                        {item.is_expiration_warning ? (
                                            <div className="font-bold text-red-600 text-xs lg:text-sm">
                                                {item.isExpired ? 'Vencido' : 'Por vencer'}
                                            </div>
                                        ) : (
                                            <div className="font-bold text-red-600 text-xs lg:text-sm">{item.current_stock} {item.unit}</div>
                                        )}
                                        <div className="text-[10px] text-gray-400">
                                            {item.is_expiration_warning ? `Vence: ${new Date(item.expiration_date).toLocaleDateString()}` : `Mín: ${item.minimum_stock}`}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-xs text-green-600 italic flex items-center">
                                <CheckCircle className="h-3 w-3 mr-1" /> Todo en orden
                            </div>
                        )}
                    </div>
                </div>

                {/* Rain Gauge Widget */}
                <div className="bg-white rounded-xl shadow-sm p-4 lg:p-5 border border-gray-100 transform transition hover:scale-105 print:hidden">
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-blue-500 text-xs lg:text-sm font-medium">Pluviómetro (Lluvia)</div>
                        <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                        </svg>
                    </div>
                    <form onSubmit={handleSaveRain} className="flex gap-2 mb-3">
                        <input 
                            type="number" 
                            step="0.1"
                            value={newRainMm}
                            onChange={e => setNewRainMm(Number(e.target.value))}
                            placeholder="mm"
                            className="w-16 text-xs border border-gray-300 rounded p-1"
                            required
                        />
                        <button type="submit" className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-200 font-medium">Añadir</button>
                    </form>
                    <div className="space-y-2 max-h-20 overflow-y-auto">
                        {rainLogs.slice(0, 5).map((log, idx) => (
                            <div key={idx} className="flex justify-between items-center text-xs">
                                <span className="text-gray-500">{new Date(log.date).toLocaleDateString('es-CL', {day: '2-digit', month: 'short'})}</span>
                                <span className="font-bold text-blue-600">{log.rain_mm} mm</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-xs font-bold text-gray-700">
                        <span>Total Año:</span>
                        <span className="text-blue-600">{rainLogs.reduce((sum, log) => sum + Number(log.rain_mm), 0).toFixed(1)} mm</span>
                    </div>
                </div>

                {/* Weather Widget Component */}
                <div className="transform transition hover:scale-105 print:hidden h-full">
                    <WeatherWidget />
                </div>
            </div>
        </div>
      ) : (
        // DETAILED MODE UI (Original)
        <>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-4 print:mt-4">
          <div className="bg-white overflow-hidden shadow rounded-lg print:shadow-none print:border print:border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 print:hidden">
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

        <div className="bg-white overflow-hidden shadow rounded-lg print:shadow-none print:border print:border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 print:hidden">
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

        <div className="bg-white overflow-hidden shadow rounded-lg print:shadow-none print:border print:border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 print:hidden">
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

        <div className="bg-white overflow-hidden shadow rounded-lg print:shadow-none print:border print:border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 print:hidden">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:grid-cols-2 print:gap-4 print:mt-4 print:break-inside-avoid">
          <div className="bg-white p-6 rounded-lg shadow print:shadow-none print:border print:border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Costos por Campo</h3>
            <div className="h-80 w-full print:h-64">
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

          <div className="bg-white p-6 rounded-lg shadow print:shadow-none print:border print:border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Costo / Hectárea por Sector</h3>
            <div className="h-80 w-full print:h-64">
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

      <div className="bg-white shadow overflow-hidden sm:rounded-lg print:shadow-none print:border print:border-gray-200 print:mt-4 print:break-inside-avoid">
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

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 md:p-5 border-b rounded-t bg-gray-50">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center">
                <DollarSign className="w-5 h-5 mr-2 text-blue-600" />
                Detalle de Factura N° {selectedInvoice.invoice_number || '-'}
              </h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ms-auto inline-flex justify-center items-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 md:p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-500 font-medium">Proveedor</p>
                  <p className="text-base font-semibold text-gray-900">{selectedInvoice.supplier || 'Desconocido'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 font-medium">Fecha de Vencimiento</p>
                  <p className="text-base font-semibold text-red-600">
                    {selectedInvoice.due_date ? new Date(selectedInvoice.due_date + 'T12:00:00').toLocaleDateString('es-CL') : 'N/A'}
                  </p>
                </div>
              </div>

              {selectedInvoice.notes && (
                <div className="mb-4 bg-yellow-50 p-3 rounded-md border border-yellow-100">
                  <p className="text-sm text-yellow-800"><span className="font-semibold">Notas:</span> {selectedInvoice.notes}</p>
                </div>
              )}

              <div>
                <h4 className="text-md font-semibold text-gray-800 mb-3 border-b pb-2">Ítems de la Factura</h4>
                {selectedInvoice.invoice_items && selectedInvoice.invoice_items.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                      <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                        <tr>
                          <th className="px-4 py-2">Categoría / Producto</th>
                          <th className="px-4 py-2 text-right">Cant.</th>
                          <th className="px-4 py-2 text-right">Precio Unit.</th>
                          <th className="px-4 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoice.invoice_items.map((item: any, idx: number) => (
                          <tr key={idx} className="bg-white border-b">
                            <td className="px-4 py-2">
                              <div className="font-medium text-gray-900">{item.products?.name || item.category || 'Ítem'}</div>
                              {item.category && item.products?.name && (
                                <div className="text-xs text-gray-500">{item.category}</div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {item.quantity} {item.products?.unit || ''}
                            </td>
                            <td className="px-4 py-2 text-right">{formatCLP(item.unit_price)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCLP(item.total_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-gray-900 bg-gray-50">
                          <td colSpan={3} className="px-4 py-3 text-right">Total Factura:</td>
                          <td className="px-4 py-3 text-right text-lg text-blue-600">{formatCLP(selectedInvoice.total_amount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 italic text-sm text-center py-4">No hay ítems registrados en esta factura.</p>
                )}
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="flex items-center justify-end p-4 border-t border-gray-200 rounded-b bg-gray-50">
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
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

      {/* PRESENTATION MODE OVERLAY */}
      {presentationMode && (
        <div className="fixed inset-0 z-[99999] bg-slate-50 flex flex-col font-sans text-slate-900">
          {/* Top Bar (Auto-hides slightly, visible on hover) */}
          <div className="flex justify-between items-center p-6 opacity-30 hover:opacity-100 transition-opacity absolute top-0 left-0 right-0 z-10">
            <div className="text-xl font-bold text-slate-400">{selectedCompany?.name}</div>
            <button onClick={exitPresentation} className="text-slate-400 hover:text-red-500 bg-white/80 rounded-full p-2">
              <X className="w-8 h-8" />
            </button>
          </div>

          {/* Slides */}
          <div className="flex-1 flex flex-col items-center justify-center p-12 relative w-full max-w-7xl mx-auto overflow-hidden">
            
            {/* Slide 0: Title */}
            {currentSlide === 0 && (
              <div className="text-center animate-fade-in-up w-full">
                <Building2 className="w-32 h-32 text-green-600 mx-auto mb-8" />
                <h1 className="text-5xl lg:text-6xl font-extrabold text-slate-800 mb-6">Reporte Financiero y Operativo</h1>
                <h2 className="text-3xl lg:text-4xl text-green-600 font-medium mb-12">{selectedCompany?.name}</h2>
                <p className="text-xl lg:text-2xl text-slate-500">
                  {new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }).toUpperCase()}
                </p>
              </div>
            )}

            {/* Slide 1: KPIs */}
            {currentSlide === 1 && (
              <div className="w-full animate-fade-in-up">
                <h2 className="text-4xl lg:text-5xl font-bold text-slate-800 mb-16 text-center">Resumen General</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
                  <div className="bg-white rounded-3xl shadow-2xl p-10 lg:p-12 text-center border-t-8 border-green-500">
                    <div className="text-slate-500 text-xl lg:text-2xl font-medium mb-4">Costo Total Acumulado</div>
                    <div className="text-4xl lg:text-5xl xl:text-6xl font-bold text-slate-800">{formatCLP(Number(dashboardStats.totalCost) || 0)}</div>
                  </div>
                  <div className="bg-white rounded-3xl shadow-2xl p-10 lg:p-12 text-center border-t-8 border-blue-500">
                    <div className="text-slate-500 text-xl lg:text-2xl font-medium mb-4">Costo Promedio / Hectárea</div>
                    <div className="text-4xl lg:text-5xl xl:text-6xl font-bold text-slate-800">{formatCLP(Number(dashboardStats.costPerHectare) || 0)}</div>
                  </div>
                  <div className="bg-white rounded-3xl shadow-2xl p-10 lg:p-12 text-center border-t-8 border-orange-500">
                    <div className="text-slate-500 text-xl lg:text-2xl font-medium mb-4">Hectáreas Totales</div>
                    <div className="text-4xl lg:text-5xl xl:text-6xl font-bold text-slate-800">{dashboardStats.totalHectares} ha</div>
                  </div>
                </div>
              </div>
            )}

            {/* Slide 2: Costos por Campo */}
            {currentSlide === 2 && (
              <div className="w-full h-full flex flex-col animate-fade-in-up pt-10">
                <h2 className="text-4xl lg:text-5xl font-bold text-slate-800 mb-8 text-center">Costos por Campo</h2>
                <div className="flex-1 bg-white rounded-3xl shadow-xl p-8 min-h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 60, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{fontSize: 16, fill: '#475569'}} axisLine={false} tickLine={false} dy={10} />
                      <YAxis tickFormatter={(value) => formatCLP(value)} tick={{fontSize: 16, fill: '#475569'}} axisLine={false} tickLine={false} dx={-10} />
                      <Tooltip formatter={(value) => formatCLP(Number(value))} cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                      <Bar dataKey="cost" name="Costo Total" fill="#2E7D32" radius={[8, 8, 0, 0]} barSize={80} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Slide 3: Costos por Sector */}
            {currentSlide === 3 && (
              <div className="w-full h-full flex flex-col animate-fade-in-up pt-10">
                <h2 className="text-4xl lg:text-5xl font-bold text-slate-800 mb-8 text-center">Top 10 Sectores Más Costosos (/ha)</h2>
                <div className="flex-1 bg-white rounded-3xl shadow-xl p-8 min-h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sectorChartData.slice(0, 10)} layout="vertical" margin={{ top: 20, right: 50, left: 120, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" tickFormatter={(value) => formatCLP(value)} tick={{fontSize: 16, fill: '#475569'}} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={120} tick={{fontSize: 16, fill: '#475569', fontWeight: 500}} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: number) => [formatCLP(value), 'Costo/Ha']} cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                      <Bar dataKey="costPerHa" name="Costo por Hectárea" fill="#E65100" radius={[0, 8, 8, 0]} barSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Slide 4: Facturas Vencidas */}
            {currentSlide === 4 && (
              <div className="w-full h-full flex flex-col animate-fade-in-up pt-10">
                <h2 className="text-4xl lg:text-5xl font-bold text-slate-800 mb-8 text-center">Próximos Compromisos (Facturas)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pr-4 pb-10" style={{ maxHeight: 'calc(100vh - 250px)' }}>
                  {upcomingInvoices.map((inv, idx) => (
                    <div key={idx} className="bg-white p-8 rounded-2xl shadow-lg border-l-8 border-red-500 flex flex-col">
                      <div className="text-2xl font-bold text-slate-800 mb-2 truncate" title={inv.supplier}>{inv.supplier || 'Desconocido'}</div>
                      <div className="text-xl text-slate-500 mb-6">N° {inv.invoice_number}</div>
                      <div className="flex justify-between items-end mt-auto pt-4 border-t border-slate-100">
                        <div>
                          <div className="text-sm text-slate-400 uppercase tracking-wider mb-1">Vencimiento</div>
                          <div className="text-xl font-semibold text-red-600">
                            {inv.due_date ? new Date(inv.due_date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : 'N/A'}
                          </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-800">{formatCLP(Number(inv.total_amount))}</div>
                      </div>
                    </div>
                  ))}
                  {upcomingInvoices.length === 0 && (
                    <div className="col-span-full text-center text-2xl text-slate-400 py-20">No hay facturas próximas a vencer.</div>
                  )}
                </div>
              </div>
            )}
            
          </div>

          {/* Bottom Bar / Controls */}
          <div className="flex justify-between items-center p-6 bg-white/80 backdrop-blur-sm absolute bottom-0 left-0 right-0 z-10 border-t border-slate-200">
            <div className="text-slate-400 text-sm lg:text-base flex items-center">
              <span className="hidden sm:inline">Use las flechas del teclado </span>
              <span className="font-mono bg-slate-100 px-2 py-1 rounded ml-2">←</span>
              <span className="font-mono bg-slate-100 px-2 py-1 rounded ml-1">→</span>
              <span className="hidden sm:inline ml-2"> para navegar, o </span>
              <span className="font-mono bg-slate-100 px-2 py-1 rounded ml-2">ESC</span>
              <span className="hidden sm:inline ml-2"> para salir</span>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-6">
              <button 
                onClick={() => setCurrentSlide(s => Math.max(s - 1, 0))}
                disabled={currentSlide === 0}
                className="p-2 sm:p-3 rounded-full hover:bg-slate-200 text-slate-600 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
              <div className="text-xl sm:text-2xl font-bold text-slate-500 w-16 text-center">
                {currentSlide + 1} / 5
              </div>
              <button 
                onClick={() => setCurrentSlide(s => Math.min(s + 1, 4))}
                disabled={currentSlide === 4}
                className="p-2 sm:p-3 rounded-full hover:bg-slate-200 text-slate-600 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS para impresión y animaciones */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.5s ease-out forwards;
        }
        @media print {
            @page {
                size: landscape;
                margin: 1cm;
            }
            body {
                background-color: white;
            }
            nav, header, aside, .sidebar {
                display: none !important;
            }
            .min-h-screen {
                min-height: auto !important;
            }
            main {
                padding: 0 !important;
                margin: 0 !important;
            }
            /* Fix for Recharts in print */
            .recharts-wrapper {
                width: 100% !important;
                height: 100% !important;
            }
            .recharts-surface {
                width: 100% !important;
                height: 100% !important;
            }
        }
      `}</style>
    </div>
  );
};
