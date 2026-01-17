
import React, { useState, useEffect } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { formatCLP } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { FileDown, Loader2 } from 'lucide-react';

interface ReportData {
  field_name: string;
  sector_name: string;
  hectares: number;
  total_cost: number;
  cost_per_ha: number;
  application_count: number;
}

export const Reports: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData[]>([]);

  useEffect(() => {
    if (selectedCompany) {
      loadReports();
    }
  }, [selectedCompany]);

  const loadReports = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // 1. Get all fields and sectors for the company
      const { data: fields } = await supabase
        .from('fields')
        .select('id, name, sectors(id, name, hectares)')
        .eq('company_id', selectedCompany.id);

      if (!fields) return;

      // 2. Get all applications for these fields
      const { data: applications } = await supabase
        .from('applications')
        .select('field_id, sector_id, total_cost')
        .in('field_id', fields.map(f => f.id));

      // 3. Aggregate Data
      const data: ReportData[] = [];

      fields.forEach(field => {
        field.sectors?.forEach(sector => {
          const sectorApps = applications?.filter(app => app.sector_id === sector.id) || [];
          const totalCost = sectorApps.reduce((sum, app) => sum + Number(app.total_cost), 0);
          const hectares = Number(sector.hectares);
          
          data.push({
            field_name: field.name,
            sector_name: sector.name,
            hectares: hectares,
            total_cost: totalCost,
            cost_per_ha: hectares > 0 ? totalCost / hectares : 0,
            application_count: sectorApps.length
          });
        });
      });

      setReportData(data);

    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes de Costos</h1>
          <p className="text-sm text-gray-500">Análisis de costos por hectárea y sector</p>
        </div>
        <button className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
          <FileDown className="mr-2 h-4 w-4" /> Exportar
        </button>
      </div>

      {/* Chart */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Costo por Hectárea (por Sector)</h3>
        <div className="h-96 w-full">
          {loading ? (
             <div className="flex h-full items-center justify-center">
               <Loader2 className="animate-spin h-8 w-8 text-green-600" />
             </div>
          ) : reportData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500">
              No hay datos suficientes para mostrar el gráfico
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={reportData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sector_name" label={{ value: 'Sector', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Costo / Ha ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  formatter={(value) => formatCLP(Number(value))}
                  labelFormatter={(label, payload) => {
                    if (payload && payload.length > 0) {
                      return `${payload[0].payload.field_name} - ${label}`;
                    }
                    return label;
                  }}
                />
                <Legend />
                <Bar dataKey="cost_per_ha" name="Costo por Hectárea" fill="#2E7D32" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Detalle por Sector</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campo</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hectáreas</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">N° Aplicaciones</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Total</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo / Ha</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reportData.map((row, index) => (
                <tr key={index}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.field_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.sector_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.hectares}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.application_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCLP(row.total_cost)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-700">{formatCLP(row.cost_per_ha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
