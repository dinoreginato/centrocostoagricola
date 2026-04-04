import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { CompanyProvider } from './contexts/CompanyContext';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotFound } from './pages/NotFound';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'sonner';

// Lazy loaded pages
const Login = React.lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Dashboard = React.lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Fields = React.lazy(() => import('./pages/Fields').then(module => ({ default: module.Fields })));
const Invoices = React.lazy(() => import('./pages/Invoices').then(module => ({ default: module.Invoices })));
const Inventory = React.lazy(() => import('./pages/Inventory').then(module => ({ default: module.Inventory })));
const Applications = React.lazy(() => import('./pages/Applications').then(module => ({ default: module.Applications })));
const ApplicationOrders = React.lazy(() => import('./pages/ApplicationOrders').then(module => ({ default: module.ApplicationOrders })));
const Reports = React.lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })));
const Users = React.lazy(() => import('./pages/Users').then(module => ({ default: module.Users })));
const Labors = React.lazy(() => import('./pages/Labors').then(module => ({ default: module.Labors })));
const Machinery = React.lazy(() => import('./pages/Machinery').then(module => ({ default: module.Machinery })));
const Fuel = React.lazy(() => import('./pages/Fuel').then(module => ({ default: module.Fuel })));
const Irrigation = React.lazy(() => import('./pages/Irrigation').then(module => ({ default: module.Irrigation })));
const Workers = React.lazy(() => import('./pages/Workers').then(module => ({ default: module.Workers })));
const GeneralCosts = React.lazy(() => import('./pages/GeneralCosts').then(module => ({ default: module.GeneralCosts })));
const ChemicalCosts = React.lazy(() => import('./pages/ChemicalCosts').then(module => ({ default: module.ChemicalCosts })));
const Incomes = React.lazy(() => import('./pages/Incomes').then(module => ({ default: module.Incomes })));
const PhytosanitaryPrograms = React.lazy(() => import('./pages/PhytosanitaryPrograms').then(module => ({ default: module.PhytosanitaryPrograms })));

const FallbackLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <Loader2 className="w-10 h-10 animate-spin text-green-600" />
  </div>
);

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <CompanyProvider>
            <Toaster position="top-right" richColors />
            <Suspense fallback={<FallbackLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                
                <Route path="/" element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="campos" element={<Fields />} />
                  <Route path="facturas" element={<Invoices />} />
                  <Route path="liquidaciones" element={<Incomes />} />
                  <Route path="labores" element={<Labors />} />
                  <Route path="maquinaria" element={<Machinery />} />
                  <Route path="riego" element={<Irrigation />} />
                  <Route path="petroleo" element={<Fuel />} />
                  <Route path="trabajadores" element={<Workers />} />
                  <Route path="bodega" element={<Inventory />} />
                  <Route path="programas-fitosanitarios" element={<PhytosanitaryPrograms />} />
                  <Route path="aplicaciones" element={<Applications />} />
                  <Route path="ordenes-aplicacion" element={<ApplicationOrders />} />
                  <Route path="otros-costos" element={<GeneralCosts />} />
                  <Route path="precios-quimicos" element={<ChemicalCosts />} />
                  <Route path="reportes" element={<Reports />} />
                  <Route path="usuarios" element={<Users />} />
                  
                  {/* 404 Catch All */}
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </CompanyProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
