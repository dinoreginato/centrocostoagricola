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
              <Route path="bodega" element={<Inventory />} />
              <Route path="aplicaciones" element={<Applications />} />
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
