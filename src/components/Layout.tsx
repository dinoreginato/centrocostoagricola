
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
  Lock
} from 'lucide-react';
import { ChangePasswordModal } from './ChangePasswordModal';

export const Layout: React.FC = () => {
  const { user, loading, signOut } = useAuth();
  const { userRole, companies, selectedCompany, selectCompany } = useCompany();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = React.useState(false);

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

  // Define navigation items
  const allNavItems = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['admin', 'viewer'] },
    { name: 'Campos', href: '/campos', icon: Map, roles: ['admin', 'viewer'] },
    { name: 'Facturas', href: '/facturas', icon: FileText, roles: ['admin'] },
    { name: 'Labores', href: '/labores', icon: Users, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Maquinaria', href: '/maquinaria', icon: Tractor, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Riego', href: '/riego', icon: Droplets, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Petróleo', href: '/petroleo', icon: Fuel, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Trabajadores', href: '/trabajadores', icon: Briefcase, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Bodega', href: '/bodega', icon: Package, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Aplicaciones', href: '/aplicaciones', icon: ClipboardList, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Ordenes de Aplicación', href: '/ordenes-aplicacion', icon: FileText, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Precios Químicos', href: '/precios-quimicos', icon: Beaker, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Distribución Costos', href: '/otros-costos', icon: LayoutList, roles: ['admin', 'editor', 'viewer'] },
    { name: 'Reportes', href: '/reportes', icon: BarChart3, roles: ['admin', 'viewer'] },
    // Removed "Usuarios" from sidebar for regular users, accessible via top right or special admin page
    ...(userRole === 'admin' ? [{ name: 'Usuarios', href: '/usuarios', icon: Users, roles: ['admin'] }] : []),
  ];

  const navigation = allNavItems.filter(item => 
    !userRole || item.roles.includes(userRole)
  );

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar for desktop */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-gray-200 print:hidden">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-center h-16 border-b border-gray-200 px-4">
            <span className="text-xl font-bold text-green-700">AgroCostos</span>
          </div>
          
          {/* Company Selector in Sidebar */}
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <label className="block text-xs font-medium text-gray-500 mb-1">Empresa Actual</label>
            <div className="relative">
              <select
                value={selectedCompany?.id || ''}
                onChange={(e) => selectCompany(e.target.value)}
                className="block w-full pl-3 pr-8 py-2 text-sm border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 rounded-md"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <Building2 className="h-4 w-4" />
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-y-auto pt-2 pb-4">
          <nav className="mt-5 flex-1 px-2 space-y-1">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                    isActive
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon
                    className={`mr-3 flex-shrink-0 h-6 w-6 ${
                      isActive ? 'text-green-700' : 'text-gray-400 group-hover:text-gray-500'
                    }`}
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
          <div className="flex-shrink-0 w-full group block">
            <div className="flex items-center">
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-700 truncate">{user.email}</p>
                <div className="flex space-x-2 mt-1">
                  <button
                    onClick={() => setIsPasswordModalOpen(true)}
                    className="text-xs font-medium text-gray-500 hover:text-green-700 flex items-center"
                    title="Cambiar Contraseña"
                  >
                    <Lock className="mr-1 h-3 w-3" /> Contraseña
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={signOut}
                    className="text-xs font-medium text-gray-500 hover:text-red-700 flex items-center"
                  >
                    <LogOut className="mr-1 h-3 w-3" /> Salir
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 mt-1">v1.10.4 (Viewer Fix)</div>
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
      <div className="md:hidden fixed top-0 left-0 w-full bg-white border-b border-gray-200 z-10 flex items-center justify-between px-4 h-16 print:hidden">
        <span className="text-xl font-bold text-green-700">AgroCostos</span>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-20 bg-white pt-16">
           <div className="px-4 py-4 bg-gray-50 border-b border-gray-200">
               <label className="block text-xs font-medium text-gray-500 mb-1">Empresa Actual</label>
               <select
                   value={selectedCompany?.id || ''}
                   onChange={(e) => {
                       selectCompany(e.target.value);
                       setIsMobileMenuOpen(false);
                   }}
                   className="block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
               >
                   {companies.map((company) => (
                       <option key={company.id} value={company.id}>
                           {company.name}
                       </option>
                   ))}
               </select>
           </div>
           <nav className="mt-2 px-2 space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50"
              >
                <div className="flex items-center">
                  <item.icon className="mr-4 h-6 w-6 text-gray-500" />
                  {item.name}
                </div>
              </Link>
            ))}
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
