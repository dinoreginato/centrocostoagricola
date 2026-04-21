import {
  BarChart3,
  Beaker,
  Briefcase,
  ClipboardList,
  DollarSign,
  Droplets,
  FileText,
  Fuel,
  LayoutDashboard,
  LayoutList,
  Map,
  Package,
  Tractor,
  Users
} from 'lucide-react';

export type NavItem = {
  name: string;
  href: string;
  icon: any;
  roles: string[];
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export function getNavGroups(userRole?: string | null): NavGroup[] {
  return [
    {
      title: 'Principal',
      items: [
        { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['admin', 'viewer'] },
        { name: 'Reportes', href: '/reportes', icon: BarChart3, roles: ['admin', 'viewer'] }
      ]
    },
    {
      title: 'Finanzas y Costos',
      items: [
        { name: 'Facturas', href: '/facturas', icon: FileText, roles: ['admin'] },
        { name: 'Liquidaciones', href: '/liquidaciones', icon: DollarSign, roles: ['admin'] },
        { name: 'Distribución Costos', href: '/otros-costos', icon: LayoutList, roles: ['admin', 'editor', 'viewer'] }
      ]
    },
    {
      title: 'Operaciones',
      items: [
        { name: 'Labores', href: '/labores', icon: Users, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Maquinaria', href: '/maquinaria', icon: Tractor, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Riego', href: '/riego', icon: Droplets, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Petróleo', href: '/petroleo', icon: Fuel, roles: ['admin', 'editor', 'viewer'] }
      ]
    },
    {
      title: 'Inventario (Bodega)',
      items: [
        { name: 'Bodega', href: '/bodega', icon: Package, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Prog. Fitosanitario', href: '/programas-fitosanitarios', icon: ClipboardList, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Aplicaciones', href: '/aplicaciones', icon: ClipboardList, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Ordenes de Aplic.', href: '/ordenes-aplicacion', icon: FileText, roles: ['admin', 'editor', 'viewer'] }
      ]
    },
    {
      title: 'Administración',
      items: [
        { name: 'Campos', href: '/campos', icon: Map, roles: ['admin', 'viewer'] },
        { name: 'Trabajadores', href: '/trabajadores', icon: Briefcase, roles: ['admin', 'editor', 'viewer'] },
        { name: 'Precios Químicos', href: '/precios-quimicos', icon: Beaker, roles: ['admin', 'editor', 'viewer'] },
        ...(userRole === 'admin' ? [{ name: 'Usuarios', href: '/usuarios', icon: Users, roles: ['admin'] }] : [])
      ]
    }
  ];
}
