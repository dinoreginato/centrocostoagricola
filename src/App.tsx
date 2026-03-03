import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { CompanyProvider } from './contexts/CompanyContext';
import { Fields } from './pages/Fields';
import { Invoices } from './pages/Invoices';
import { Inventory } from './pages/Inventory';
import { Applications } from './pages/Applications';
import { Reports } from './pages/Reports';
import { Users } from './pages/Users';
import { Labors } from './pages/Labors';
import { Machinery } from './pages/Machinery';
import { Fuel } from './pages/Fuel';
import { Irrigation } from './pages/Irrigation';
import { Workers } from './pages/Workers';
import { GeneralCosts } from './pages/GeneralCosts';
import { ChemicalCosts } from './pages/ChemicalCosts';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanyProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              {/* Other routes will be added here later */}
              <Route path="campos" element={<Fields />} />
              <Route path="facturas" element={<Invoices />} />
              <Route path="labores" element={<Labors />} />
              <Route path="maquinaria" element={<Machinery />} />
              <Route path="riego" element={<Irrigation />} />
              <Route path="petroleo" element={<Fuel />} />
              <Route path="trabajadores" element={<Workers />} />
              <Route path="bodega" element={<Inventory />} />
              <Route path="aplicaciones" element={<Applications />} />
              <Route path="otros-costos" element={<GeneralCosts />} />
              <Route path="precios-quimicos" element={<ChemicalCosts />} />
              <Route path="reportes" element={<Reports />} />
              <Route path="usuarios" element={<Users />} />
            </Route>
          </Routes>
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;