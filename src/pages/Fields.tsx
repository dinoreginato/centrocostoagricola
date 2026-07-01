import { toast } from 'sonner';
import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { getSeasonFromDate } from '../lib/seasonUtils';
import { Plus, Map, MapPin, ChevronDown, ChevronRight, Loader2, Edit2, X, Check, Trash2 } from 'lucide-react';
import {
  createField,
  createSector,
  createSectorBudgetSeasonPlan,
  deleteField,
  deleteSector,
  deleteSectorBudgetSeasonPlan,
  fetchFieldsWithLaborCosts,
  updateField,
  updateSector,
  updateSectorBudgetSeasonPlan,
  type SectorBudgetSeasonPlan
} from '../services/fields';

interface Sector {
  id: string;
  name: string;
  hectares: number;
  sector_budget_season_plans?: SectorBudgetSeasonPlan[];
  productive_stage?: 'productivo' | 'en_formacion' | 'renovacion' | 'arranque';
  production_expected_from_season?: string | null;
  non_productive_reason?: 'plantacion_nueva' | 'replante' | 'recuperacion' | 'otro' | null;
  establishment_notes?: string | null;
  total_labor_cost?: number;
  latitude?: number | null;
  longitude?: number | null;
}

interface Field {
  id: string;
  name: string;
  total_hectares: number;
  fruit_type: string;
  latitude?: number | null;
  longitude?: number | null;
  sectors?: Sector[];
}

const resolveSeasonPlanMetrics = (plan?: SectorBudgetSeasonPlan | null) => {
  const exchangeRate = Number(plan?.exchange_rate_reference || 0);
  const budgetClpPerHa = Number(plan?.budget_cost_clp_per_ha || 0) > 0
    ? Number(plan?.budget_cost_clp_per_ha || 0)
    : exchangeRate > 0
      ? Number(plan?.budget_cost_usd_per_ha || 0) * exchangeRate
      : 0;
  const budgetUsdPerHa = Number(plan?.budget_cost_usd_per_ha || 0) > 0
    ? Number(plan?.budget_cost_usd_per_ha || 0)
    : exchangeRate > 0
      ? Number(plan?.budget_cost_clp_per_ha || 0) / exchangeRate
      : 0;
  const expectedKg = Number(plan?.expected_production_kg || 0);
  const expectedSalePriceClp = Number(plan?.expected_sale_price_clp_per_kg || 0) > 0
    ? Number(plan?.expected_sale_price_clp_per_kg || 0)
    : exchangeRate > 0
      ? Number(plan?.expected_sale_price_usd_per_kg || 0) * exchangeRate
      : 0;
  const expectedSalePriceUsd = Number(plan?.expected_sale_price_usd_per_kg || 0) > 0
    ? Number(plan?.expected_sale_price_usd_per_kg || 0)
    : exchangeRate > 0
      ? Number(plan?.expected_sale_price_clp_per_kg || 0) / exchangeRate
      : 0;

  return {
    exchangeRate,
    budgetClpPerHa,
    budgetUsdPerHa,
    expectedKg,
    expectedSalePriceClp,
    expectedSalePriceUsd,
    expectedRevenueClp: expectedKg * expectedSalePriceClp,
    expectedRevenueUsd: expectedKg * expectedSalePriceUsd
  };
};

const getSectorSeasonPlan = (sector: Sector, season: string) =>
  (sector.sector_budget_season_plans || []).find((plan) => plan.season === season) || null;

const getErrorMessage = (error: unknown, fallback: string) => {
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
};

const getFieldHectareSummary = (field: Field) => {
  const total = Number(field.total_hectares || 0);
  const assigned = Number(
    (field.sectors || []).reduce((sum, sector) => sum + Number(sector.hectares || 0), 0).toFixed(2)
  );
  const rawAvailable = Number((total - assigned).toFixed(2));
  const overAssigned = rawAvailable < 0 ? Math.abs(rawAvailable) : 0;

  return {
    total,
    assigned,
    available: rawAvailable > 0 ? rawAvailable : 0,
    overAssigned
  };
};

const getFieldBudgetSummary = (field: Field, season: string) => {
  const sectors = field.sectors || [];
  const sectorPlans = sectors.map((sector) => ({ sector, plan: getSectorSeasonPlan(sector, season) }));
  const budgetedSectors = sectorPlans.filter(({ plan }) => resolveSeasonPlanMetrics(plan).budgetClpPerHa > 0);
  const sectorsWithoutBudget = sectorPlans.filter(({ plan }) => resolveSeasonPlanMetrics(plan).budgetClpPerHa <= 0);
  const projectedSectors = sectorPlans.filter(({ plan }) => resolveSeasonPlanMetrics(plan).expectedKg > 0);
  const totalBudgetClp = budgetedSectors.reduce(
    (sum, { sector, plan }) => sum + (resolveSeasonPlanMetrics(plan).budgetClpPerHa * Number(sector.hectares || 0)),
    0
  );
  const totalBudgetUsd = budgetedSectors.reduce(
    (sum, { sector, plan }) => sum + (resolveSeasonPlanMetrics(plan).budgetUsdPerHa * Number(sector.hectares || 0)),
    0
  );
  const totalExpectedProductionKg = sectorPlans.reduce((sum, { plan }) => sum + resolveSeasonPlanMetrics(plan).expectedKg, 0);
  const totalExpectedRevenueClp = sectorPlans.reduce((sum, { plan }) => sum + resolveSeasonPlanMetrics(plan).expectedRevenueClp, 0);
  const totalExpectedRevenueUsd = sectorPlans.reduce((sum, { plan }) => sum + resolveSeasonPlanMetrics(plan).expectedRevenueUsd, 0);
  const budgetedArea = budgetedSectors.reduce((sum, item) => sum + Number(item.sector.hectares || 0), 0);
  const totalArea = sectors.reduce((sum, sector) => sum + Number(sector.hectares || 0), 0);

  return {
    budgetedSectors: budgetedSectors.length,
    projectedSectors: projectedSectors.length,
    sectorsWithoutBudget: sectorsWithoutBudget.length,
    totalSectors: sectors.length,
    totalBudgetClp,
    totalBudgetUsd,
    totalExpectedProductionKg,
    totalExpectedRevenueClp,
    totalExpectedRevenueUsd,
    expectedMarginClp: totalExpectedRevenueClp - totalBudgetClp,
    expectedMarginUsd: totalExpectedRevenueUsd - totalBudgetUsd,
    areaCoveragePct: totalArea > 0 ? (budgetedArea / totalArea) * 100 : 0
  };
};

const SECTOR_PRODUCTIVE_STAGE_OPTIONS = [
  { value: 'productivo', label: 'Productivo' },
  { value: 'en_formacion', label: 'En formacion' },
  { value: 'renovacion', label: 'Renovacion' },
  { value: 'arranque', label: 'Arranque' }
] as const;

const SECTOR_NON_PRODUCTIVE_REASON_OPTIONS = [
  { value: 'plantacion_nueva', label: 'Plantacion nueva' },
  { value: 'replante', label: 'Replante' },
  { value: 'recuperacion', label: 'Recuperacion' },
  { value: 'otro', label: 'Otro' }
] as const;

const isSectorNonProductiveExpected = (sector: Sector) => (
  sector.productive_stage === 'en_formacion' || sector.productive_stage === 'arranque'
);

const formatSectorStage = (value?: Sector['productive_stage']) => {
  switch (value) {
    case 'en_formacion':
      return 'En formacion';
    case 'renovacion':
      return 'Renovacion';
    case 'arranque':
      return 'Arranque';
    case 'productivo':
    default:
      return 'Productivo';
  }
};

const formatSectorNonProductiveReason = (value?: Sector['non_productive_reason'] | null) => {
  switch (value) {
    case 'plantacion_nueva':
      return 'Plantacion nueva';
    case 'replante':
      return 'Replante';
    case 'recuperacion':
      return 'Recuperacion';
    case 'otro':
      return 'Otro';
    default:
      return '';
  }
};

export const Fields: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);

  // Form states
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldHectares, setNewFieldHectares] = useState('');
  const [newFieldFruit, setNewFieldFruit] = useState('');
  const [newFieldLatitude, setNewFieldLatitude] = useState('');
  const [newFieldLongitude, setNewFieldLongitude] = useState('');
  
  const [showSectorForm, setShowSectorForm] = useState<string | null>(null); // Field ID
  const [newSectorName, setNewSectorName] = useState('');
  const [newSectorHectares, setNewSectorHectares] = useState('');
  const [newSectorProductiveStage, setNewSectorProductiveStage] = useState<Sector['productive_stage']>('productivo');
  const [newSectorExpectedSeason, setNewSectorExpectedSeason] = useState('');
  const [newSectorNonProductiveReason, setNewSectorNonProductiveReason] = useState<NonNullable<Sector['non_productive_reason']>>('plantacion_nueva');
  const [newSectorEstablishmentNotes, setNewSectorEstablishmentNotes] = useState('');
  const [newSectorLatitude, setNewSectorLatitude] = useState('');
  const [newSectorLongitude, setNewSectorLongitude] = useState('');

  // Edit Field states
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldName, setEditFieldName] = useState('');
  const [editFieldHectares, setEditFieldHectares] = useState('');
  const [editFieldFruit, setEditFieldFruit] = useState('');
  const [editFieldLatitude, setEditFieldLatitude] = useState('');
  const [editFieldLongitude, setEditFieldLongitude] = useState('');

  // Edit Sector states
  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [editSectorName, setEditSectorName] = useState('');
  const [editSectorHectares, setEditSectorHectares] = useState('');
  const [editSectorProductiveStage, setEditSectorProductiveStage] = useState<Sector['productive_stage']>('productivo');
  const [editSectorExpectedSeason, setEditSectorExpectedSeason] = useState('');
  const [editSectorNonProductiveReason, setEditSectorNonProductiveReason] = useState<NonNullable<Sector['non_productive_reason']>>('plantacion_nueva');
  const [editSectorEstablishmentNotes, setEditSectorEstablishmentNotes] = useState('');
  const [editSectorLatitude, setEditSectorLatitude] = useState('');
  const [editSectorLongitude, setEditSectorLongitude] = useState('');
  const [planEditorSectorId, setPlanEditorSectorId] = useState<string | null>(null);
  const [planEditorPlanId, setPlanEditorPlanId] = useState<string | null>(null);
  const [planSeason, setPlanSeason] = useState(getSeasonFromDate(new Date()));
  const [planBudgetClpPerHa, setPlanBudgetClpPerHa] = useState('');
  const [planBudgetUsdPerHa, setPlanBudgetUsdPerHa] = useState('');
  const [planExpectedKg, setPlanExpectedKg] = useState('');
  const [planExpectedPriceClp, setPlanExpectedPriceClp] = useState('');
  const [planExpectedPriceUsd, setPlanExpectedPriceUsd] = useState('');
  const [planExchangeRate, setPlanExchangeRate] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const currentPlanningSeason = getSeasonFromDate(new Date());

  const loadFields = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const fieldsWithCosts = await fetchFieldsWithLaborCosts({ companyId: selectedCompany.id });
      setFields(fieldsWithCosts || []);
    } catch {
      toast.error('Error al cargar campos.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) {
      void loadFields();
    }
  }, [selectedCompany, loadFields]);

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;

    try {
      const data = await createField({
        companyId: selectedCompany.id,
        payload: {
          name: newFieldName,
          total_hectares: parseFloat(newFieldHectares),
          fruit_type: newFieldFruit,
          latitude: newFieldLatitude ? parseFloat(newFieldLatitude) : null,
          longitude: newFieldLongitude ? parseFloat(newFieldLongitude) : null
        }
      });

      setFields([data, ...fields]);
      setShowFieldForm(false);
      setNewFieldName('');
      setNewFieldHectares('');
      setNewFieldFruit('');
      setNewFieldLatitude('');
      setNewFieldLongitude('');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Error al crear campo.'));
    }
  };

  const startEditingField = (field: Field) => {
    setEditingFieldId(field.id);
    setEditFieldName(field.name);
    setEditFieldHectares(field.total_hectares.toString());
    setEditFieldFruit(field.fruit_type);
    setEditFieldLatitude(field.latitude != null ? String(field.latitude) : '');
    setEditFieldLongitude(field.longitude != null ? String(field.longitude) : '');
  };

  const cancelEditingField = () => {
    setEditingFieldId(null);
    setEditFieldName('');
    setEditFieldHectares('');
    setEditFieldFruit('');
    setEditFieldLatitude('');
    setEditFieldLongitude('');
  };

  const handleUpdateField = async (e: React.FormEvent, fieldId: string) => {
    e.preventDefault();
    try {
      const data = await updateField({
        fieldId,
        patch: {
          name: editFieldName,
          total_hectares: parseFloat(editFieldHectares),
          fruit_type: editFieldFruit,
          latitude: editFieldLatitude ? parseFloat(editFieldLatitude) : null,
          longitude: editFieldLongitude ? parseFloat(editFieldLongitude) : null
        }
      });

      setFields(fields.map(f => f.id === fieldId ? { ...f, ...data, sectors: f.sectors } : f));
      cancelEditingField();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Error al actualizar campo.'));
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este campo? Se eliminarán también todos sus sectores.')) return;

    try {
      await deleteField({ fieldId });

      setFields(fields.filter(f => f.id !== fieldId));
    } catch {
      toast.error('Error al eliminar el campo. Asegúrate de no tener registros asociados importantes.');
    }
  };

  // --- SECTOR MANAGEMENT ---

  const handleCreateSector = async (e: React.FormEvent, fieldId: string) => {
    e.preventDefault();
    try {
      const data = await createSector({
        fieldId,
        payload: {
          name: newSectorName,
          hectares: parseFloat(newSectorHectares),
          productive_stage: newSectorProductiveStage || 'productivo',
          production_expected_from_season: newSectorExpectedSeason.trim() || null,
          non_productive_reason: isSectorNonProductiveExpected({ productive_stage: newSectorProductiveStage } as Sector)
            ? newSectorNonProductiveReason
            : null,
          establishment_notes: newSectorEstablishmentNotes.trim() || null,
          latitude: newSectorLatitude ? parseFloat(newSectorLatitude) : null,
          longitude: newSectorLongitude ? parseFloat(newSectorLongitude) : null
        }
      });

      setFields(fields.map(f => {
        if (f.id === fieldId) {
          return {
            ...f,
            sectors: [...(f.sectors || []), data]
          };
        }
        return f;
      }));

      setShowSectorForm(null);
      setNewSectorName('');
      setNewSectorHectares('');
      setNewSectorProductiveStage('productivo');
      setNewSectorExpectedSeason('');
      setNewSectorNonProductiveReason('plantacion_nueva');
      setNewSectorEstablishmentNotes('');
      setNewSectorLatitude('');
      setNewSectorLongitude('');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Error al crear sector.'));
    }
  };

  const startEditingSector = (sector: Sector) => {
    setEditingSectorId(sector.id);
    setEditSectorName(sector.name);
    setEditSectorHectares(sector.hectares.toString());
    setEditSectorProductiveStage(sector.productive_stage || 'productivo');
    setEditSectorExpectedSeason(sector.production_expected_from_season || '');
    setEditSectorNonProductiveReason(sector.non_productive_reason || 'plantacion_nueva');
    setEditSectorEstablishmentNotes(sector.establishment_notes || '');
    setEditSectorLatitude(sector.latitude != null ? String(sector.latitude) : '');
    setEditSectorLongitude(sector.longitude != null ? String(sector.longitude) : '');
  };

  const cancelEditingSector = () => {
    setEditingSectorId(null);
    setEditSectorName('');
    setEditSectorHectares('');
    setEditSectorProductiveStage('productivo');
    setEditSectorExpectedSeason('');
    setEditSectorNonProductiveReason('plantacion_nueva');
    setEditSectorEstablishmentNotes('');
    setEditSectorLatitude('');
    setEditSectorLongitude('');
  };

  const handleUpdateSector = async (e: React.FormEvent, sectorId: string, fieldId: string) => {
    e.preventDefault();
    try {
      const data = await updateSector({
        sectorId,
        patch: {
          name: editSectorName,
          hectares: parseFloat(editSectorHectares),
          productive_stage: editSectorProductiveStage || 'productivo',
          production_expected_from_season: editSectorExpectedSeason.trim() || null,
          non_productive_reason: isSectorNonProductiveExpected({ productive_stage: editSectorProductiveStage } as Sector)
            ? editSectorNonProductiveReason
            : null,
          establishment_notes: editSectorEstablishmentNotes.trim() || null,
          latitude: editSectorLatitude ? parseFloat(editSectorLatitude) : null,
          longitude: editSectorLongitude ? parseFloat(editSectorLongitude) : null
        }
      });

      setFields(fields.map(f => {
        if (f.id === fieldId) {
          return {
            ...f,
            sectors: f.sectors?.map(s => s.id === sectorId ? data : s)
          };
        }
        return f;
      }));
      cancelEditingSector();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Error al actualizar sector.'));
    }
  };

  const handleDeleteSector = async (sectorId: string, fieldId: string) => {
    if (!window.confirm('¿Eliminar este sector?')) return;

    try {
      await deleteSector({ sectorId });

      setFields(fields.map(f => {
        if (f.id === fieldId) {
          return {
            ...f,
            sectors: f.sectors?.filter(s => s.id !== sectorId)
          };
        }
        return f;
      }));
    } catch {
      toast.error('Error al eliminar sector.');
    }
  };

  const openPlanEditor = (sector: Sector, plan?: SectorBudgetSeasonPlan | null) => {
    setPlanEditorSectorId(sector.id);
    setPlanEditorPlanId(plan?.id || null);
    setPlanSeason(plan?.season || currentPlanningSeason);
    setPlanBudgetClpPerHa(plan?.budget_cost_clp_per_ha ? String(plan.budget_cost_clp_per_ha) : '');
    setPlanBudgetUsdPerHa(plan?.budget_cost_usd_per_ha ? String(plan.budget_cost_usd_per_ha) : '');
    setPlanExpectedKg(plan?.expected_production_kg ? String(plan.expected_production_kg) : '');
    setPlanExpectedPriceClp(plan?.expected_sale_price_clp_per_kg ? String(plan.expected_sale_price_clp_per_kg) : '');
    setPlanExpectedPriceUsd(plan?.expected_sale_price_usd_per_kg ? String(plan.expected_sale_price_usd_per_kg) : '');
    setPlanExchangeRate(plan?.exchange_rate_reference ? String(plan.exchange_rate_reference) : '');
    setPlanNotes(plan?.notes || '');
  };

  const cancelPlanEditor = () => {
    setPlanEditorSectorId(null);
    setPlanEditorPlanId(null);
    setPlanSeason(currentPlanningSeason);
    setPlanBudgetClpPerHa('');
    setPlanBudgetUsdPerHa('');
    setPlanExpectedKg('');
    setPlanExpectedPriceClp('');
    setPlanExpectedPriceUsd('');
    setPlanExchangeRate('');
    setPlanNotes('');
  };

  const handleSaveSectorPlan = async (e: React.FormEvent, fieldId: string, sectorId: string) => {
    e.preventDefault();
    try {
      const payload = {
        season: planSeason.trim(),
        budget_cost_clp_per_ha: planBudgetClpPerHa ? parseFloat(planBudgetClpPerHa) : 0,
        budget_cost_usd_per_ha: planBudgetUsdPerHa ? parseFloat(planBudgetUsdPerHa) : 0,
        expected_production_kg: planExpectedKg ? parseFloat(planExpectedKg) : 0,
        expected_sale_price_clp_per_kg: planExpectedPriceClp ? parseFloat(planExpectedPriceClp) : 0,
        expected_sale_price_usd_per_kg: planExpectedPriceUsd ? parseFloat(planExpectedPriceUsd) : 0,
        exchange_rate_reference: planExchangeRate ? parseFloat(planExchangeRate) : 0,
        notes: planNotes.trim() || null
      };

      const data = planEditorPlanId
        ? await updateSectorBudgetSeasonPlan({ planId: planEditorPlanId, patch: payload })
        : await createSectorBudgetSeasonPlan({ sectorId, payload });

      setFields(fields.map((field) => {
        if (field.id !== fieldId) return field;
        return {
          ...field,
          sectors: (field.sectors || []).map((sector) => {
            if (sector.id !== sectorId) return sector;
            const plans = sector.sector_budget_season_plans || [];
            const nextPlans = planEditorPlanId
              ? plans.map((plan) => (plan.id === planEditorPlanId ? data : plan))
              : [...plans, data].sort((a, b) => String(b.season).localeCompare(String(a.season)));
            return { ...sector, sector_budget_season_plans: nextPlans };
          })
        };
      }));
      cancelPlanEditor();
      toast.success('Plan presupuestario guardado.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Error al guardar el plan presupuestario.'));
    }
  };

  const handleDeleteSectorPlan = async (fieldId: string, sectorId: string, planId: string) => {
    if (!window.confirm('¿Eliminar este plan de temporada?')) return;
    try {
      await deleteSectorBudgetSeasonPlan({ planId });
      setFields(fields.map((field) => {
        if (field.id !== fieldId) return field;
        return {
          ...field,
          sectors: (field.sectors || []).map((sector) => (
            sector.id === sectorId
              ? { ...sector, sector_budget_season_plans: (sector.sector_budget_season_plans || []).filter((plan) => plan.id !== planId) }
              : sector
          ))
        };
      }));
      if (planEditorPlanId === planId) cancelPlanEditor();
      toast.success('Plan presupuestario eliminado.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Error al eliminar el plan presupuestario.'));
    }
  };

  if (!selectedCompany) {
    return <div className="p-8 text-center text-gray-500">Selecciona una empresa para gestionar sus campos.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Campos</h1>
          <p className="text-sm text-gray-500">Administra tus campos, sectores y cultivos</p>
        </div>
        {userRole !== 'viewer' && (
          <button
            onClick={() => setShowFieldForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"
          >
            <Plus className="mr-2 h-4 w-4" /> Nuevo Campo
          </button>
        )}
      </div>

      {/* Create Field Form */}
      {showFieldForm && (
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Agregar Nuevo Campo</h3>
          <form onSubmit={handleCreateField} className="grid grid-cols-1 gap-6 sm:grid-cols-6">
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Nombre del Campo</label>
              <input
                type="text"
                required
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Hectáreas Totales</label>
              <input
                type="number"
                step="0.01"
                required
                value={newFieldHectares}
                onChange={e => setNewFieldHectares(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Tipo de Frutal</label>
              <input
                type="text"
                required
                value={newFieldFruit}
                onChange={e => setNewFieldFruit(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Latitud</label>
              <input
                type="number"
                step="0.000001"
                value={newFieldLatitude}
                onChange={e => setNewFieldLatitude(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Longitud</label>
              <input
                type="number"
                step="0.000001"
                value={newFieldLongitude}
                onChange={e => setNewFieldLongitude(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1 flex items-end space-x-2">
              <button
                type="submit"
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setShowFieldForm(false)}
                className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Fields List */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="animate-spin h-8 w-8 text-green-600" />
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
          <Map className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No hay campos registrados</h3>
          <p className="mt-1 text-sm text-gray-500">Comienza agregando tu primer campo.</p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {fields.map((field) => {
              const hectareSummary = getFieldHectareSummary(field);
              const budgetSummary = getFieldBudgetSummary(field, currentPlanningSeason);
              const hectareTone = hectareSummary.overAssigned > 0.01
                ? 'bg-red-100 text-red-700 border-red-200'
                : hectareSummary.available > 0.01
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-emerald-100 text-emerald-700 border-emerald-200';
              const budgetTone = budgetSummary.sectorsWithoutBudget > 0
                ? budgetSummary.budgetedSectors > 0
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-red-100 text-red-700 border-red-200'
                : 'bg-emerald-100 text-emerald-700 border-emerald-200';

              return (
              <li key={field.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition duration-150 ease-in-out">
                  {editingFieldId === field.id ? (
                    <form onSubmit={(e) => handleUpdateField(e, field.id)} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-5 gap-4 w-full">
                        <input
                          type="text"
                          value={editFieldName}
                          onChange={(e) => setEditFieldName(e.target.value)}
                          className="block w-full border-gray-300 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Nombre del Campo"
                          required
                        />
                         <input
                          type="text"
                          value={editFieldFruit}
                          onChange={(e) => setEditFieldFruit(e.target.value)}
                          className="block w-full border-gray-300 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Tipo de Frutal"
                          required
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={editFieldHectares}
                          onChange={(e) => setEditFieldHectares(e.target.value)}
                          className="block w-full border-gray-300 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Hectáreas"
                          required
                        />
                        <input
                          type="number"
                          step="0.000001"
                          value={editFieldLatitude}
                          onChange={(e) => setEditFieldLatitude(e.target.value)}
                          className="block w-full border-gray-300 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Lat"
                        />
                        <input
                          type="number"
                          step="0.000001"
                          value={editFieldLongitude}
                          onChange={(e) => setEditFieldLongitude(e.target.value)}
                          className="block w-full border-gray-300 rounded-md shadow-sm py-1 px-2 text-sm focus:ring-green-500 focus:border-green-500"
                          placeholder="Lon"
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="submit"
                          className="p-1 text-green-600 hover:bg-green-100 rounded-full"
                          title="Guardar cambios"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditingField}
                          className="p-1 text-red-600 hover:bg-red-100 rounded-full"
                          title="Cancelar"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center flex-1 cursor-pointer" onClick={() => setExpandedFieldId(expandedFieldId === field.id ? null : field.id)}>
                        {expandedFieldId === field.id ? (
                          <ChevronDown className="h-5 w-5 text-gray-400 mr-2" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-gray-400 mr-2" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-green-600 truncate">{field.name}</div>
                          <div className="flex items-center text-sm text-gray-500">
                            <span className="truncate">{field.fruit_type}</span>
                            <span className="mx-2">•</span>
                            <span>{field.total_hectares} ha</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-medium ${hectareTone}`}>
                              {hectareSummary.overAssigned > 0.01
                                ? `Sobreasignado ${hectareSummary.overAssigned.toFixed(2)} ha`
                                : hectareSummary.available > 0.01
                                  ? `Disponible ${hectareSummary.available.toFixed(2)} ha`
                                  : 'Completamente asignado'}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">
                              Asignado {hectareSummary.assigned.toFixed(2)} / {hectareSummary.total.toFixed(2)} ha
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-medium ${budgetTone}`}>
                              {budgetSummary.totalSectors <= 0
                                ? 'Sin sectores'
                                : budgetSummary.sectorsWithoutBudget > 0
                                  ? `${budgetSummary.budgetedSectors}/${budgetSummary.totalSectors} sectores con plan ${currentPlanningSeason}`
                                  : 'Presupuesto completo'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-500 hidden sm:block">
                          {field.sectors?.length || 0} sectores
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => startEditingField(field)}
                            className="text-gray-400 hover:text-green-600 transition-colors"
                            title="Editar campo"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteField(field.id)}
                            className="text-gray-400 hover:text-red-600 transition-colors"
                            title="Eliminar campo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sectors Expansion */}
                  {expandedFieldId === field.id && !editingFieldId && (
                    <div className="mt-4 ml-8 border-l-2 border-gray-200 pl-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Resumen temporada {currentPlanningSeason}</h4>
                      </div>

                      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hectáreas campo</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{hectareSummary.total.toFixed(2)} ha</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Asignadas a sectores</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{hectareSummary.assigned.toFixed(2)} ha</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${
                          hectareSummary.overAssigned > 0.01
                            ? 'border-red-200 bg-red-50'
                            : hectareSummary.available > 0.01
                              ? 'border-amber-200 bg-amber-50'
                              : 'border-emerald-200 bg-emerald-50'
                        }`}>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${
                            hectareSummary.overAssigned > 0.01
                              ? 'text-red-700'
                              : hectareSummary.available > 0.01
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}>
                            Balance disponible
                          </div>
                          <div className={`mt-1 text-lg font-semibold ${
                            hectareSummary.overAssigned > 0.01
                              ? 'text-red-800'
                              : hectareSummary.available > 0.01
                                ? 'text-amber-800'
                                : 'text-emerald-800'
                          }`}>
                            {hectareSummary.overAssigned > 0.01
                              ? `-${hectareSummary.overAssigned.toFixed(2)} ha`
                              : `${hectareSummary.available.toFixed(2)} ha`}
                          </div>
                        </div>
                      </div>

                      {hectareSummary.overAssigned > 0.01 && (
                        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          La suma de sectores supera la superficie del campo. La nueva validación bloqueará más sobreasignación hasta regularizar este balance.
                        </div>
                      )}

                      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Presupuesto total CLP</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{formatCLP(budgetSummary.totalBudgetClp)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Presupuesto total USD</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">US$ {Number(budgetSummary.totalBudgetUsd || 0).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sectores con plan</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{budgetSummary.budgetedSectors} / {budgetSummary.totalSectors}</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${
                          budgetSummary.sectorsWithoutBudget > 0
                            ? budgetSummary.budgetedSectors > 0
                              ? 'border-amber-200 bg-amber-50'
                              : 'border-red-200 bg-red-50'
                            : 'border-emerald-200 bg-emerald-50'
                        }`}>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${
                            budgetSummary.sectorsWithoutBudget > 0
                              ? budgetSummary.budgetedSectors > 0
                                ? 'text-amber-700'
                                : 'text-red-700'
                              : 'text-emerald-700'
                          }`}>
                            Cobertura presupuestaria
                          </div>
                          <div className={`mt-1 text-lg font-semibold ${
                            budgetSummary.sectorsWithoutBudget > 0
                              ? budgetSummary.budgetedSectors > 0
                                ? 'text-amber-800'
                                : 'text-red-800'
                              : 'text-emerald-800'
                          }`}>
                            {budgetSummary.areaCoveragePct.toFixed(1)}%
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Producción esperada</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{Number(budgetSummary.totalExpectedProductionKg || 0).toLocaleString('es-CL')} kg</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ingreso estimado CLP</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{formatCLP(budgetSummary.totalExpectedRevenueClp)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ingreso estimado USD</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">US$ {Number(budgetSummary.totalExpectedRevenueUsd || 0).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${budgetSummary.expectedMarginClp >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${budgetSummary.expectedMarginClp >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>Margen esperado CLP</div>
                          <div className={`mt-1 text-lg font-semibold ${budgetSummary.expectedMarginClp >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>{formatCLP(budgetSummary.expectedMarginClp)}</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${budgetSummary.expectedMarginUsd >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${budgetSummary.expectedMarginUsd >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>Margen esperado USD</div>
                          <div className={`mt-1 text-lg font-semibold ${budgetSummary.expectedMarginUsd >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>US$ {Number(budgetSummary.expectedMarginUsd || 0).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sectores con proyección</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{budgetSummary.projectedSectors} / {budgetSummary.totalSectors}</div>
                        </div>
                      </div>

                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Sectores</h4>
                      
                      <ul className="space-y-3 mb-4">
                        {field.sectors?.map((sector) => {
                          const currentSeasonPlan = getSectorSeasonPlan(sector, currentPlanningSeason);
                          const currentSeasonPlanMetrics = resolveSeasonPlanMetrics(currentSeasonPlan);
                          const seasonPlans = [...(sector.sector_budget_season_plans || [])].sort((a, b) => String(b.season).localeCompare(String(a.season)));

                          return (
                          <li key={sector.id} className="text-sm text-gray-600 group">
                            {editingSectorId === sector.id ? (
                              <form onSubmit={(e) => handleUpdateSector(e, sector.id, field.id)} className="w-full rounded-lg border border-green-200 bg-green-50/40 p-3">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                  <input
                                    type="text"
                                    value={editSectorName}
                                    onChange={(e) => setEditSectorName(e.target.value)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                    placeholder="Nombre"
                                    required
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editSectorHectares}
                                    onChange={(e) => setEditSectorHectares(e.target.value)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                    placeholder="Has"
                                    required
                                  />
                                  <select
                                    value={editSectorProductiveStage || 'productivo'}
                                    onChange={(e) => setEditSectorProductiveStage(e.target.value as Sector['productive_stage'])}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                  >
                                    {SECTOR_PRODUCTIVE_STAGE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    value={editSectorExpectedSeason}
                                    onChange={(e) => setEditSectorExpectedSeason(e.target.value)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                    placeholder="Temp. prod."
                                  />
                                  {isSectorNonProductiveExpected({ productive_stage: editSectorProductiveStage } as Sector) && (
                                    <>
                                      <select
                                        value={editSectorNonProductiveReason}
                                        onChange={(e) => setEditSectorNonProductiveReason(e.target.value as NonNullable<Sector['non_productive_reason']>)}
                                        className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                      >
                                        {SECTOR_NON_PRODUCTIVE_REASON_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        value={editSectorEstablishmentNotes}
                                        onChange={(e) => setEditSectorEstablishmentNotes(e.target.value)}
                                        className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                        placeholder="Notas"
                                      />
                                    </>
                                  )}
                                  <input
                                    type="number"
                                    step="0.000001"
                                    value={editSectorLatitude}
                                    onChange={(e) => setEditSectorLatitude(e.target.value)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                    placeholder="Lat"
                                  />
                                  <input
                                    type="number"
                                    step="0.000001"
                                    value={editSectorLongitude}
                                    onChange={(e) => setEditSectorLongitude(e.target.value)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                    placeholder="Lon"
                                  />
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={cancelEditingSector}
                                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                    title="Cancelar"
                                  >
                                    <X className="mr-1 h-4 w-4" />
                                    Cancelar
                                  </button>
                                  <button
                                    type="submit"
                                    className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                                    title="Guardar"
                                  >
                                    <Check className="mr-1 h-4 w-4" />
                                    Guardar
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="flex items-center justify-between">
                                <div className="flex items-center flex-1">
                                  <MapPin className="h-4 w-4 text-gray-400 mr-2" />
                                  <span className="font-medium mr-2">{sector.name}</span>
                                  <span className="text-gray-400 mr-6">({sector.hectares} ha)</span>
                                  {sector.productive_stage && sector.productive_stage !== 'productivo' && (
                                    <span className="mr-3 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                      {formatSectorStage(sector.productive_stage)}
                                    </span>
                                  )}
                                  {sector.non_productive_reason && (
                                    <span className="mr-3 text-xs text-amber-700">
                                      {formatSectorNonProductiveReason(sector.non_productive_reason)}
                                      {sector.production_expected_from_season ? ` · Produccion esperada ${sector.production_expected_from_season}` : ''}
                                    </span>
                                  )}
                                  
                                  {currentSeasonPlan && (
                                    <div className="hidden sm:flex items-center mr-6 text-sm">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-gray-400 font-bold">Plan {currentPlanningSeason}</span>
                                        <span className="font-medium text-blue-600">{formatCLP(currentSeasonPlanMetrics.budgetClpPerHa * Number(sector.hectares || 0))}</span>
                                      </div>
                                    </div>
                                  )}
                                  {currentSeasonPlanMetrics.expectedKg > 0 && (
                                    <div className="hidden sm:flex items-center mr-6 text-sm">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-gray-400 font-bold">Prod. esperada</span>
                                        <span className="font-medium text-violet-700">{Number(currentSeasonPlanMetrics.expectedKg || 0).toLocaleString('es-CL')} kg</span>
                                      </div>
                                    </div>
                                  )}
                                  {currentSeasonPlanMetrics.expectedRevenueClp > 0 && (
                                    <div className="hidden sm:flex items-center mr-6 text-sm">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-gray-400 font-bold">Ingreso estimado</span>
                                        <span className="font-medium text-violet-700">{formatCLP(currentSeasonPlanMetrics.expectedRevenueClp)}</span>
                                      </div>
                                    </div>
                                  )}

                                  {(sector.total_labor_cost || 0) > 0 && (
                                    <div className="hidden sm:flex items-center space-x-6 text-sm">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase text-gray-400 font-bold">Mano de Obra</span>
                                            <span className="font-medium text-green-600">{formatCLP(sector.total_labor_cost || 0)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase text-gray-400 font-bold">Costo / Ha</span>
                                            <span className="font-medium text-gray-700">{formatCLP((sector.total_labor_cost || 0) / (sector.hectares || 1))}</span>
                                        </div>
                                    </div>
                                  )}
                                </div>
                                {userRole !== 'viewer' && (
                                  <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => openPlanEditor(sector, currentSeasonPlan)}
                                      className="text-gray-400 hover:text-violet-600"
                                      title="Plan por temporada"
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => startEditingSector(sector)}
                                      className="text-gray-400 hover:text-green-600"
                                      title="Editar sector"
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSector(sector.id, field.id)}
                                      className="text-gray-400 hover:text-red-600"
                                      title="Eliminar sector"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                                </div>
                                <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Planificación por temporada</div>
                                    <div className="text-xs text-violet-700">Temporada visible: {currentPlanningSeason}</div>
                                  </div>
                                  {userRole !== 'viewer' && (
                                    <button
                                      type="button"
                                      onClick={() => openPlanEditor(sector, currentSeasonPlan)}
                                      className="inline-flex items-center rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
                                    >
                                      <Plus className="mr-1 h-3.5 w-3.5" />
                                      {currentSeasonPlan ? 'Editar plan actual' : 'Agregar plan'}
                                    </button>
                                  )}
                                </div>

                                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
                                  <div className="rounded-md bg-white px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Ppto CLP</div>
                                    <div className="mt-1 font-semibold text-slate-900">{formatCLP(currentSeasonPlanMetrics.budgetClpPerHa * Number(sector.hectares || 0))}</div>
                                  </div>
                                  <div className="rounded-md bg-white px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Ppto USD</div>
                                    <div className="mt-1 font-semibold text-slate-900">US$ {Number(currentSeasonPlanMetrics.budgetUsdPerHa * Number(sector.hectares || 0)).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
                                  </div>
                                  <div className="rounded-md bg-white px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Prod. esperada</div>
                                    <div className="mt-1 font-semibold text-slate-900">{Number(currentSeasonPlanMetrics.expectedKg || 0).toLocaleString('es-CL')} kg</div>
                                  </div>
                                  <div className="rounded-md bg-white px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Ingreso CLP</div>
                                    <div className="mt-1 font-semibold text-slate-900">{formatCLP(currentSeasonPlanMetrics.expectedRevenueClp)}</div>
                                  </div>
                                  <div className="rounded-md bg-white px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Ingreso USD</div>
                                    <div className="mt-1 font-semibold text-slate-900">US$ {Number(currentSeasonPlanMetrics.expectedRevenueUsd || 0).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
                                  </div>
                                  <div className="rounded-md bg-white px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">TC ref.</div>
                                    <div className="mt-1 font-semibold text-slate-900">{Number(currentSeasonPlanMetrics.exchangeRate || 0).toLocaleString('es-CL')}</div>
                                  </div>
                                </div>

                                <div className="mt-3 space-y-2">
                                  {seasonPlans.map((plan) => {
                                    const planMetrics = resolveSeasonPlanMetrics(plan);
                                    return (
                                      <div key={plan.id} className="flex flex-col gap-2 rounded-md border border-violet-100 bg-white px-3 py-2 md:flex-row md:items-center md:justify-between">
                                        <div>
                                          <div className="text-sm font-medium text-slate-900">{plan.season}</div>
                                          <div className="text-xs text-slate-500">
                                            {formatCLP(planMetrics.budgetClpPerHa * Number(sector.hectares || 0))} · US$ {Number(planMetrics.budgetUsdPerHa * Number(sector.hectares || 0)).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} · {Number(planMetrics.expectedKg || 0).toLocaleString('es-CL')} kg
                                          </div>
                                        </div>
                                        {userRole !== 'viewer' && (
                                          <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => openPlanEditor(sector, plan)} className="text-violet-700 hover:text-violet-900" title="Editar plan">
                                              <Edit2 className="h-3.5 w-3.5" />
                                            </button>
                                            <button type="button" onClick={() => handleDeleteSectorPlan(field.id, sector.id, plan.id)} className="text-red-600 hover:text-red-800" title="Eliminar plan">
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {seasonPlans.length === 0 && (
                                    <div className="rounded-md border border-dashed border-violet-200 bg-white/70 px-3 py-2 text-xs text-violet-700">
                                      No hay planes cargados todavía para este sector.
                                    </div>
                                  )}
                                </div>

                                  {planEditorSectorId === sector.id && userRole !== 'viewer' && (
                                    <form onSubmit={(e) => handleSaveSectorPlan(e, field.id, sector.id)} className="mt-3 rounded-md border border-violet-200 bg-white p-3">
                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                        <input type="text" value={planSeason} onChange={(e) => setPlanSeason(e.target.value)} placeholder="Temporada 2025-2026" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" required />
                                        <input type="number" step="0.01" value={planBudgetClpPerHa} onChange={(e) => setPlanBudgetClpPerHa(e.target.value)} placeholder="Ppto CLP / Ha" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                        <input type="number" step="0.01" value={planBudgetUsdPerHa} onChange={(e) => setPlanBudgetUsdPerHa(e.target.value)} placeholder="Ppto USD / Ha" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                        <input type="number" step="0.01" value={planExpectedKg} onChange={(e) => setPlanExpectedKg(e.target.value)} placeholder="Prod. esperada (kg)" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                        <input type="number" step="0.01" value={planExpectedPriceClp} onChange={(e) => setPlanExpectedPriceClp(e.target.value)} placeholder="Precio venta CLP/kg" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                        <input type="number" step="0.01" value={planExpectedPriceUsd} onChange={(e) => setPlanExpectedPriceUsd(e.target.value)} placeholder="Precio venta USD/kg" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                        <input type="number" step="0.01" value={planExchangeRate} onChange={(e) => setPlanExchangeRate(e.target.value)} placeholder="TC referencia" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                        <input type="text" value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} placeholder="Notas del plan" className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm" />
                                      </div>
                                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                        <button type="button" onClick={cancelPlanEditor} className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
                                        <button type="submit" className="inline-flex items-center rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">Guardar plan</button>
                                      </div>
                                    </form>
                                  )}
                                </div>
                              </>
                            )}
                          </li>
                        );
                        })}
                      </ul>

                      {userRole !== 'viewer' && (
                        showSectorForm === field.id ? (
                          <form onSubmit={(e) => handleCreateSector(e, field.id)} className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <input
                                type="text"
                                placeholder="Nombre Sector"
                                required
                                value={newSectorName}
                                onChange={e => setNewSectorName(e.target.value)}
                                className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                              />
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Has"
                                required
                                value={newSectorHectares}
                                onChange={e => setNewSectorHectares(e.target.value)}
                                className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                              />
                              <select
                                value={newSectorProductiveStage || 'productivo'}
                                onChange={e => setNewSectorProductiveStage(e.target.value as Sector['productive_stage'])}
                                className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                              >
                                {SECTOR_PRODUCTIVE_STAGE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                placeholder="Temp. prod."
                                value={newSectorExpectedSeason}
                                onChange={e => setNewSectorExpectedSeason(e.target.value)}
                                className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                              />
                              {isSectorNonProductiveExpected({ productive_stage: newSectorProductiveStage } as Sector) && (
                                <>
                                  <select
                                    value={newSectorNonProductiveReason}
                                    onChange={e => setNewSectorNonProductiveReason(e.target.value as NonNullable<Sector['non_productive_reason']>)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                  >
                                    {SECTOR_NON_PRODUCTIVE_REASON_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    placeholder="Notas"
                                    value={newSectorEstablishmentNotes}
                                    onChange={e => setNewSectorEstablishmentNotes(e.target.value)}
                                    className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                                  />
                                </>
                              )}
                              <input
                                type="number"
                                step="0.000001"
                                placeholder="Lat"
                                value={newSectorLatitude}
                                onChange={e => setNewSectorLatitude(e.target.value)}
                                className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                              />
                              <input
                                type="number"
                                step="0.000001"
                                placeholder="Lon"
                                value={newSectorLongitude}
                                onChange={e => setNewSectorLongitude(e.target.value)}
                                className="block w-full border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                              />
                            </div>
                            <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                              El presupuesto y la proyección comercial se cargan después por temporada dentro del sector.
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setShowSectorForm(null)}
                                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Cancelar
                              </button>
                              <button
                                type="submit"
                                className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                              >
                                Guardar
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            onClick={() => setShowSectorForm(field.id)}
                            className="flex items-center text-sm text-green-600 hover:text-green-800"
                          >
                            <Plus className="h-4 w-4 mr-1" /> Agregar Sector
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
