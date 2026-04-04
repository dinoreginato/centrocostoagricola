
import React from 'react';
import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCompany } from '../contexts/CompanyContext';
import { 
  LayoutDashboard, 
  Map, 
  FileText, 
  Package, 
  ClipboardList, 
  BarChart3, 
  LogOut,
  Menu,
  X,
  Users,
  Tractor,
  Fuel,
  Wrench,
  Droplets,
  Briefcase,
  Building2,
  LayoutList,
  Beaker,
  Lock,
  DollarSign,
  Sun,
  Moon,
  DownloadCloud
} from 'lucide-react';
import { ChangePasswordModal } from './ChangePasswordModal';
import { useTheme } from '../contexts/ThemeContext';
import { utils, writeFile } from 'xlsx';
import { supabase } from '../supabase/client';
import { toast } from 'sonner';

type NavItem = {
  name: string;
  href: string;
  icon: any;
  roles: string[];
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

export const Layout: React.FC = () => {
  const { user, loading, signOut } = useAuth();
  const { userRole, companies, selectedCompany, selectCompany } = useCompany();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = React.useState(false);
  const [isBackingUp, setIsBackingUp] = React.useState(false);

  const handleBackup = async () => {
    if (!selectedCompany) return;
    setIsBackingUp(true);
    const toastId = toast.loading('Generando copia de seguridad de toda la empresa...');
    
    try {
      const wb = utils.book_new();

      // 1. Products
      const { data: products } = await supabase.from('products').select('*').eq('company_id', selectedCompany.id);
      if (products && products.length > 0) {
        utils.book_append_sheet(wb, utils.json_to_sheet(products), 'Bodega_Inventario');
      }

      // 2. Fields & Sectors
      const { data: fields } = await supabase.from('fields').select('*, sectors(*)').eq('company_id', selectedCompany.id);
      if (fields && fields.length > 0) {
         const flatSectors = fields.flatMap(f => (f.sectors || []).map((s: any) => ({
           Campo: f.name,
           Sector: s.name,
           Hectareas: s.hectares
         })));
         utils.book_append_sheet(wb, utils.json_to_sheet(flatSectors), 'Campos_Sectores');
      }

      // 3. Invoices
      const { data: invoices } = await supabase.from('invoices').select('*, invoice_items(*)').eq('company_id', selectedCompany.id);
      if (invoices && invoices.length > 0) {
         const flatInvoices = invoices.map(inv => ({
           Numero: inv.invoice_number,
           Proveedor: inv.supplier,
           Fecha: inv.invoice_date,
           Total: inv.total_amount,
           Estado: inv.status,
           Items: inv.invoice_items?.length || 0
         }));
         utils.book_append_sheet(wb, utils.json_to_sheet(flatInvoices), 'Facturas_Resumen');
      }

      // 4. Applications (by field)
      if (fields && fields.length > 0) {
          const fieldIds = fields.map(f => f.id);
          const { data: apps } = await supabase.from('applications').select('*').in('field_id', fieldIds);
          if (apps && apps.length > 0) {
              utils.book_append_sheet(wb, utils.json_to_sheet(apps), 'Aplicaciones');
          }
      }

      // 5. Incomes
      const { data: incomes } = await supabase.from('income_entries').select('*').eq('company_id', selectedCompany.id);
      if (incomes && incomes.length > 0) {
          utils.book_append_sheet(wb, utils.json_to_sheet(incomes), 'Liquidaciones');
      }

      // 6. Machines
      const { data: machines } = await supabase.from('machines').select('*').eq('company_id', selectedCompany.id);
      if (machines && machines.length > 0) {
          utils.book_append_sheet(wb, utils.json_to_sheet(machines), 'Maquinaria');
      }
      
      // 7. Workers
      const { data: workers } = await supabase.from('workers').select('*').eq('company_id', selectedCompany.id);
      if (workers && workers.length > 0) {
          utils.book_append_sheet(wb, utils.json_to_sheet(workers), 'Trabajadores');
      }

      const dateStr = new Date().toISOString().split('T')[0];
      writeFile(wb, `Respaldo_AgroCostos_${selectedCompany.name.replace(/\s+/g, '_')}_${dateStr}.xlsx`);
      
      toast.success('Copia de seguridad descargada exitosamente', { id: toastId });
    } catch (error: any) {
      console.error(error);
      toast.error('Error al generar el respaldo: ' + error.message, { id: toastId });
    } finally {
      setIsBackingUp(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Define navigation groups
  const navGroups: NavGroup[] = [
    {
      title: 'Principal',
      items: [
        { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['admin', 'viewer'] },
        { name: 'Reportes', href: '/reportes', icon: BarChart3, roles: ['admin', 'viewer'] },
      ]
    },
    {
      title: 'Finanzas y Costos',
      items: [
        { name: 'Facturas', href: '/facturas', icon: FileText, roles: ['admin'] },
        { name: 'Liquidaciones', href: '/liquidaciones', icon: DollarSign, roles: ['admin'] },
        { name: 'Distribución Costos', href: '/otros-costos', icon: LayoutList, roles: ['admin', 'editor', 'viewer'] },
      ]
    },
    {
      title: 'Operaciones',
      items: [
        { name: 'Labores', href: '/labores', icon: Users, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Maquinaria', href: '/maquinaria', icon: Tractor, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Riego', href: '/riego', icon: Droplets, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Petróleo', href: '/petroleo', icon: Fuel, roles: ['admin', 'editor', 'viewer'] },
      ]
    },
    {
      title: 'Inventario (Bodega)',
      items: [
        { name: 'Bodega', href: '/bodega', icon: Package, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Prog. Fitosanitario', href: '/programas-fitosanitarios', icon: ClipboardList, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Aplicaciones', href: '/aplicaciones', icon: ClipboardList, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Ordenes de Aplic.', href: '/ordenes-aplicacion', icon: FileText, roles: ['admin', 'editor', 'viewer'] },
      ]
    },
    {
      title: 'Administración',
      items: [
        { name: 'Campos', href: '/campos', icon: Map, roles: ['admin', 'viewer'] },
        { name: 'Trabajadores', href: '/trabajadores', icon: Briefcase, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Precios Químicos', href: '/precios-quimicos', icon: Beaker, roles: ['admin', 'editor', 'viewer'] },
        ...(userRole === 'admin' ? [{ name: 'Usuarios', href: '/usuarios', icon: Users, roles: ['admin'] }] : []),
      ]
    }
  ];

  // Helper to check if a group has any visible items for the user
  const filterGroupItems = (items: NavItem[]) => {
    return items.filter(item => !userRole || item.roles.includes(userRole));
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex">
      {/* Sidebar for desktop */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 print:hidden">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between h-16 border-b border-gray-200 dark:border-gray-700 px-4">
            <span className="text-xl font-bold text-green-700">AgroCostos</span>
            <div className="flex items-center space-x-2">
              <button 
                onClick={handleBackup} 
                disabled={isBackingUp}
                className={`p-1.5 rounded-md text-gray-500 hover:text-green-700 dark:text-gray-400 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-gray-700 transition-colors ${isBackingUp ? 'opacity-50 cursor-not-allowed' : ''}`} 
                title="Descargar Respaldo (Excel)"
              >
                <DownloadCloud className="h-5 w-5" />
              </button>
              <button onClick={toggleTheme} className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Cambiar Tema">
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>
          </div>
          
          {/* Company Selector in Sidebar */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Empresa Actual</label>
            <div className="relative">
              <select
                value={selectedCompany?.id || ''}
                onChange={(e) => selectCompany(e.target.value)}
                className="block w-full pl-3 pr-8 py-2 text-sm border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-green-500 focus:border-green-500 rounded-md"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300">
                <Building2 className="h-4 w-4" />
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-y-auto pt-2 pb-4">
          <nav className="mt-2 flex-1 px-2 space-y-4">
            {navGroups.map((group, idx) => {
              const groupItems = filterGroupItems(group.items);
              if (groupItems.length === 0) return null;

              return (
                <div key={group.title} className={idx > 0 ? 'pt-4 border-t border-gray-100' : ''}>
                  <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {group.title}
                  </p>
                  <div className="space-y-1">
                    {groupItems.map((item) => {
                      const isActive = location.pathname === item.href;
                      return (
                        <Link
                          key={item.name}
                          to={item.href}
                          className={`group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            isActive
                              ? 'bg-green-50 text-green-700'
                              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 hover:text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          <item.icon
                            className={`mr-3 flex-shrink-0 h-5 w-5 transition-colors ${
                              isActive ? 'text-green-700' : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-400'
                            }`}
                          />
                          {item.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>
        <div className="flex-shrink-0 flex border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex-shrink-0 w-full group block">
            <div className="flex items-center">
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{user.email}</p>
                <div className="flex space-x-2 mt-1">
                  <button
                    onClick={() => setIsPasswordModalOpen(true)}
                    className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-green-700 flex items-center"
                    title="Cambiar Contraseña"
                  >
                    <Lock className="mr-1 h-3 w-3" /> Contraseña
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={signOut}
                    className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-700 flex items-center"
                  >
                    <LogOut className="mr-1 h-3 w-3" /> Salir
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 mt-1">v1.16.34</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <ChangePasswordModal 
        isOpen={isPasswordModalOpen} 
        onClose={() => setIsPasswordModalOpen(false)} 
      />

      {/* Mobile menu */}
      <div className="md:hidden fixed top-0 left-0 w-full bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-10 flex items-center justify-between px-4 h-16 print:hidden">
        <span className="text-xl font-bold text-green-700">AgroCostos</span>
        <div className="flex items-center space-x-2">
          <button 
            onClick={handleBackup} 
            disabled={isBackingUp}
            className={`p-2 rounded-md text-gray-500 hover:text-green-700 dark:text-gray-400 dark:hover:text-green-400 ${isBackingUp ? 'opacity-50' : ''}`}
          >
            <DownloadCloud className="h-6 w-6" />
          </button>
          <button onClick={toggleTheme} className="p-2 rounded-md text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            {theme === 'dark' ? <Sun className="h-6 w-6" /> : <Moon className="h-6 w-6" />}
          </button>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-20 bg-white dark:bg-gray-800 pt-16">
           <div className="px-4 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
               <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Empresa Actual</label>
               <select
                   value={selectedCompany?.id || ''}
                   onChange={(e) => {
                       selectCompany(e.target.value);
                       setIsMobileMenuOpen(false);
                   }}
                   className="block w-full py-2 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
               >
                   {companies.map((company) => (
                       <option key={company.id} value={company.id}>
                           {company.name}
                       </option>
                   ))}
               </select>
           </div>
           <nav className="mt-2 px-2 space-y-4">
            {navGroups.map((group, idx) => {
              const groupItems = filterGroupItems(group.items);
              if (groupItems.length === 0) return null;

              return (
                <div key={group.title} className={idx > 0 ? 'pt-4 border-t border-gray-200 dark:border-gray-700' : ''}>
                  <p className="px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    {group.title}
                  </p>
                  <div className="space-y-1">
                    {groupItems.map((item) => {
                      const isActive = location.pathname === item.href;
                      return (
                        <Link
                          key={item.name}
                          to={item.href}
                          onClick={() => setIsMobileMenuOpen(false)}
                          className={`block px-3 py-2 rounded-md text-base font-medium ${
                            isActive ? 'text-green-700 bg-green-50' : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                          }`}
                        >
                          <div className="flex items-center">
                            <item.icon className={`mr-4 h-6 w-6 ${isActive ? 'text-green-700' : 'text-gray-500 dark:text-gray-400'}`} />
                            {item.name}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  signOut();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full text-left block px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-red-50"
              >
                <div className="flex items-center">
                  <LogOut className="mr-4 h-6 w-6" />
                  Cerrar Sesión
                </div>
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* Main content */}
      <div className="md:pl-64 flex flex-col flex-1 w-full print:pl-0">
        <main className="flex-1">
          <div className="py-6 px-4 sm:px-6 md:px-8 mt-16 md:mt-0">
             <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
