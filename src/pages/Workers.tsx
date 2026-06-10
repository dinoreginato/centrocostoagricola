import { toast } from 'sonner';
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { Users, UserPlus, Trash2, Briefcase, Loader2, Download, RefreshCcw, Upload, Pencil, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fetchCompanyFieldsBasic, fetchCompanySectorsBasic } from '../services/companyStructure';
import { createWorker, deleteWorker, deleteWorkerCost, fetchWorkerCosts, fetchWorkers, insertWorkerCosts, updateWorker } from '../services/workers';
import { calculatePayrollChile } from '../lib/payrollChile';
import { importXlsxToJson } from '../lib/excel';
import { createPayrollRateProposal, createWorkerPayrollRun, fetchPayrollRateProposals, fetchPayrollRatesForMonth, updatePayrollRateProposalStatus, upsertPayrollRates } from '../services/payroll';

interface Worker {
  id: string;
  name: string;
  role: string;
  birth_date?: string | null;
  gender?: 'male' | 'female' | 'unspecified';
  is_pensioner?: boolean;
  pension_type?: 'old_age' | 'disability_total' | 'disability_partial' | 'other' | null;
  voluntary_afp_after_legal_age?: boolean;
  art69_exempt?: boolean;
}

interface WorkerCost {
  id: string;
  date: string;
  amount: number;
  description: string;
  worker_id: string;
  sector_id: string;
  workers?: { name: string };
  sectors?: { name: string };
  is_piece_rate?: boolean;
  piece_quantity?: number;
  piece_price?: number;
  worker_name?: string;
  labor_type?: string;
}

interface Sector {
  id: string;
  name: string;
  hectares: number;
  field_id: string;
}

interface Field {
    id: string;
    name: string;
    total_hectares: number;
}

type WorkerCostSummary = {
  worker: Worker;
  count: number;
  lastDate: string | null;
  total: number;
  payroll: number;
  remuneration: number;
  manual: number;
};

const buildWorkerCostSummary = (worker: Worker, workerCosts: WorkerCost[]): WorkerCostSummary => {
  const totals = workerCosts.reduce(
    (acc, cost) => {
      const description = String(cost.description || '');
      const amount = Number(cost.amount || 0);
      if (description.startsWith('Previsión ')) {
        acc.payroll += amount;
      } else if (
        description.startsWith('Sueldo Imponible ') ||
        description.startsWith('Gratificación legal ') ||
        description.startsWith('No imponible ')
      ) {
        acc.remuneration += amount;
      } else {
        acc.manual += amount;
      }
      acc.total += amount;
      return acc;
    },
    { total: 0, payroll: 0, remuneration: 0, manual: 0 }
  );

  return {
    worker,
    count: workerCosts.length,
    lastDate: workerCosts[0]?.date || null,
    ...totals
  };
};

export const Workers: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [costs, setCosts] = useState<WorkerCost[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  
  // Worker Form State
  const [workersMainTab, setWorkersMainTab] = useState<'trabajadores' | 'costos'>('trabajadores');
  const [workerWorkspaceId, setWorkerWorkspaceId] = useState('');
  const [workerSummaryMonth, setWorkerSummaryMonth] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [showWorkerForm, setShowWorkerForm] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerRole, setNewWorkerRole] = useState('');
  const [newWorkerBirthDate, setNewWorkerBirthDate] = useState('');
  const [newWorkerGender, setNewWorkerGender] = useState<'male' | 'female' | 'unspecified'>('unspecified');
  const [newWorkerIsPensioner, setNewWorkerIsPensioner] = useState(false);
  const [newWorkerPensionType, setNewWorkerPensionType] = useState<'old_age' | 'disability_total' | 'disability_partial' | 'other'>('old_age');
  const [newWorkerVoluntaryAfp, setNewWorkerVoluntaryAfp] = useState(false);
  const [newWorkerArt69Exempt, setNewWorkerArt69Exempt] = useState(false);

  // Cost Form State
  const [distributeBy, setDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [selectedFieldId, setSelectedFieldId] = useState('');
  
  // Piece-rate State
  const [isPieceRate, setIsPieceRate] = useState(false);
  const [pieceQuantity, setPieceQuantity] = useState<number | ''>('');
  const [piecePrice, setPiecePrice] = useState<number | ''>('');
  const [workerName, setWorkerName] = useState('');
  const [laborType, setLaborType] = useState('');

  const [payrollTab, setPayrollTab] = useState<'individual' | 'masivo' | 'parametros'>('individual');
  const [payrollMonth, setPayrollMonth] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  const payrollMonthStart = useMemo(() => `${payrollMonth}-01`, [payrollMonth]);

  const [payrollDistributeBy, setPayrollDistributeBy] = useState<'sector' | 'field' | 'company'>('sector');
  const [payrollSectorId, setPayrollSectorId] = useState('');
  const [payrollFieldId, setPayrollFieldId] = useState('');
  const [payrollWorkerId, setPayrollWorkerId] = useState('');
  const [payrollBaseSalary, setPayrollBaseSalary] = useState<number | ''>('');
  const [payrollImponibleBonuses, setPayrollImponibleBonuses] = useState<Array<{ id: string; label: string; amount: number | '' }>>([
    { id: 'bonus_1', label: '', amount: '' }
  ]);
  const [payrollLegalGratificationEnabled, setPayrollLegalGratificationEnabled] = useState(true);
  const [payrollNonImponibles, setPayrollNonImponibles] = useState<Array<{ id: string; label: string; amount: number | '' }>>([
    { id: 'nonimp_1', label: 'Colación', amount: '' },
    { id: 'nonimp_2', label: 'Movilización', amount: '' }
  ]);
  const [payrollContractType, setPayrollContractType] = useState<'indefinite' | 'fixed_term' | 'work'>('indefinite');
  const [payrollWorkerGender, setPayrollWorkerGender] = useState<'male' | 'female' | 'unspecified'>('unspecified');
  const [payrollWorkerBirthDate, setPayrollWorkerBirthDate] = useState('');
  const [payrollWorkerIsPensioner, setPayrollWorkerIsPensioner] = useState(false);
  const [payrollWorkerPensionType, setPayrollWorkerPensionType] = useState<'old_age' | 'disability_total' | 'disability_partial' | 'other'>('old_age');
  const [payrollWorkerVoluntaryAfp, setPayrollWorkerVoluntaryAfp] = useState(false);
  const [payrollWorkerArt69Exempt, setPayrollWorkerArt69Exempt] = useState(false);
  const [payrollAfpName, setPayrollAfpName] = useState('');
  const [payrollAfpCommissionRate, setPayrollAfpCommissionRate] = useState<number | ''>('');
  const [payrollHealthType, setPayrollHealthType] = useState<'fonasa' | 'isapre'>('fonasa');
  const [payrollHealthPlanAmount, setPayrollHealthPlanAmount] = useState<number | ''>('');
  const [payrollCcafEnabled, setPayrollCcafEnabled] = useState(false);
  const [payrollCcafName, setPayrollCcafName] = useState('los_andes');
  const [payrollMutualRate, setPayrollMutualRate] = useState<number | ''>('');
  const [payrollResult, setPayrollResult] = useState<ReturnType<typeof calculatePayrollChile> | null>(null);
  const [payrollSaving, setPayrollSaving] = useState(false);

  const [payrollRatesDraft, setPayrollRatesDraft] = useState<Record<string, number>>({});
  const [payrollRatesLoading, setPayrollRatesLoading] = useState(false);

  const [payrollProposals, setPayrollProposals] = useState<any[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const [bulkFileRows, setBulkFileRows] = useState<Array<Record<string, unknown>>>([]);
  const [bulkRows, setBulkRows] = useState<
    Array<{
      workerId: string;
      baseSalary: number;
      imponibleBonuses: number;
      legalGratification: number;
      nonImponibles: number;
      grossImponible: number;
      contractType: 'indefinite' | 'fixed_term' | 'work';
      workerGender: 'male' | 'female' | 'unspecified';
      workerBirthDate: string;
      workerIsPensioner: boolean;
      workerPensionType: 'old_age' | 'disability_total' | 'disability_partial' | 'other';
      workerVoluntaryAfp: boolean;
      workerArt69Exempt: boolean;
      afpName: string;
      afpCommissionRate: number;
      healthType: 'fonasa' | 'isapre';
      healthPlanAmount: number;
      mutualRate: number;
    }>
  >([]);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const payrollImponibleBeforeGratification = useMemo(() => {
    const base = Number(payrollBaseSalary || 0);
    const bonuses = payrollImponibleBonuses.reduce((sum, b) => sum + Number(b.amount || 0), 0);
    return Math.max(0, base + bonuses);
  }, [payrollBaseSalary, payrollImponibleBonuses]);

  const calculateLegalGratification = useCallback(
    (imponibleBase: number) => {
      if (!payrollLegalGratificationEnabled) return 0;
      const base = Math.max(0, Number(imponibleBase || 0));
      if (base <= 0) return 0;
      const rate = Number(payrollRatesDraft.GRAT_LEGAL_RATE || 25);
      const imm = Number(payrollRatesDraft.IMM_CLP || 539000);
      const topeImmAnnual = Number(payrollRatesDraft.GRAT_LEGAL_TOPE_IMM_ANNUAL || 4.75);
      const raw = (base * rate) / 100;
      const monthlyCap = imm > 0 && topeImmAnnual > 0 ? (imm * topeImmAnnual) / 12 : raw;
      return Math.max(0, Math.round(Math.min(raw, monthlyCap)));
    },
    [payrollLegalGratificationEnabled, payrollRatesDraft.GRAT_LEGAL_RATE, payrollRatesDraft.GRAT_LEGAL_TOPE_IMM_ANNUAL, payrollRatesDraft.IMM_CLP]
  );

  const payrollLegalGratificationAmount = useMemo(
    () => calculateLegalGratification(payrollImponibleBeforeGratification),
    [calculateLegalGratification, payrollImponibleBeforeGratification]
  );

  const payrollImponibleTotal = useMemo(
    () => Math.max(0, payrollImponibleBeforeGratification + payrollLegalGratificationAmount),
    [payrollImponibleBeforeGratification, payrollLegalGratificationAmount]
  );

  const payrollNonImponibleTotal = useMemo(
    () => payrollNonImponibles.reduce((sum, b) => sum + Number(b.amount || 0), 0),
    [payrollNonImponibles]
  );

  const payrollTotalEarned = useMemo(
    () => Math.max(0, payrollImponibleTotal + payrollNonImponibleTotal),
    [payrollImponibleTotal, payrollNonImponibleTotal]
  );

  const workerCostSummaries = useMemo(
    () => workers.map((worker) => buildWorkerCostSummary(worker, costs.filter((cost) => cost.worker_id === worker.id))),
    [costs, workers]
  );

  const workerMonthlyCostSummaries = useMemo(
    () =>
      workers.map((worker) =>
        buildWorkerCostSummary(
          worker,
          costs.filter((cost) => cost.worker_id === worker.id && String(cost.date || '').slice(0, 7) === workerSummaryMonth)
        )
      ),
    [costs, workerSummaryMonth, workers]
  );

  const activeWorker = useMemo(
    () => workers.find((worker) => worker.id === workerWorkspaceId) || null,
    [workerWorkspaceId, workers]
  );

  const activeWorkerCosts = useMemo(
    () => (workerWorkspaceId ? costs.filter((cost) => cost.worker_id === workerWorkspaceId) : costs),
    [costs, workerWorkspaceId]
  );

  const activeWorkerCostSummary = useMemo(() => {
    if (!activeWorker) return null;
    return (
      workerCostSummaries.find((summary) => summary.worker.id === activeWorker.id) || {
        worker: activeWorker,
        count: 0,
        lastDate: null,
        total: 0,
        payroll: 0,
        remuneration: 0,
        manual: 0
      }
    );
  }, [activeWorker, workerCostSummaries]);

  const activeWorkerMonthCostSummary = useMemo(() => {
    if (!activeWorker) return null;
    return (
      workerMonthlyCostSummaries.find((summary) => summary.worker.id === activeWorker.id) || {
        worker: activeWorker,
        count: 0,
        lastDate: null,
        total: 0,
        payroll: 0,
        remuneration: 0,
        manual: 0
      }
    );
  }, [activeWorker, workerMonthlyCostSummaries]);

  const workerSummaryMonthLabel = useMemo(() => {
    const parsed = new Date(`${workerSummaryMonth}-01T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return workerSummaryMonth;
    return parsed.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  }, [workerSummaryMonth]);

  const afpOptions = useMemo(
    () => [
      { value: 'capital', label: 'Capital', rateCode: 'AFP_CAPITAL_COMMISSION_RATE', aliases: ['capital', 'afp capital'] },
      { value: 'cuprum', label: 'Cuprum', rateCode: 'AFP_CUPRUM_COMMISSION_RATE', aliases: ['cuprum', 'afp cuprum'] },
      { value: 'habitat', label: 'Habitat', rateCode: 'AFP_HABITAT_COMMISSION_RATE', aliases: ['habitat', 'hábitat', 'afp habitat', 'afp hábitat'] },
      { value: 'modelo', label: 'Modelo', rateCode: 'AFP_MODELO_COMMISSION_RATE', aliases: ['modelo', 'afp modelo'] },
      { value: 'planvital', label: 'PlanVital', rateCode: 'AFP_PLANVITAL_COMMISSION_RATE', aliases: ['planvital', 'plan vital', 'afp planvital', 'afp plan vital'] },
      { value: 'provida', label: 'ProVida', rateCode: 'AFP_PROVIDA_COMMISSION_RATE', aliases: ['provida', 'pro vida', 'afp provida', 'afp pro vida'] },
      { value: 'uno', label: 'Uno', rateCode: 'AFP_UNO_COMMISSION_RATE', aliases: ['uno', 'afp uno'] }
    ],
    []
  );

  const ccafOptions = useMemo(
    () => [
      { value: 'los_andes', label: 'Los Andes' },
      { value: 'la_araucana', label: 'La Araucana' },
      { value: '18_de_septiembre', label: '18 de Septiembre' },
      { value: 'gabriela_mistral', label: 'Gabriela Mistral' }
    ],
    []
  );

  const defaultPayrollRates = useMemo(
    () => {
      const hasSeguroSocial = payrollMonthStart >= '2025-08-01';
      const crpRate = payrollMonthStart >= '2027-08-01' ? 1.5 : payrollMonthStart >= '2026-08-01' ? 0.9 : 0;
      return {
        IMM_CLP: 539000,
        AFP_MANDATORY_RATE: 10,
        SALUD_FONASA_RATE: 7,
        SALUD_ISAPRE_MIN_RATE: 7,
        SALUD_CCAF_RATE: 4.2,
        SALUD_CCAF_FONASA_RATE: 2.8,
        GRAT_LEGAL_RATE: 25,
        GRAT_LEGAL_TOPE_IMM_ANNUAL: 4.75,
        AFC_WORKER_INDEF_RATE: 0.6,
        AFC_WORKER_FIXED_RATE: 0,
        AFC_EMP_INDEF_RATE: 2.4,
        AFC_EMP_FIXED_RATE: 3,
        AFC_EMP_CIC_INDEF_RATE: 1.6,
        AFC_EMP_FCS_INDEF_RATE: 0.8,
        AFC_EMP_CIC_FIXED_RATE: 2.8,
        AFC_EMP_FCS_FIXED_RATE: 0.2,
        SEGURO_SOCIAL_AFP_EMP_RATE: hasSeguroSocial ? 0.1 : 0,
        SEGURO_SOCIAL_EMP_RATE: hasSeguroSocial ? 0.9 : 0,
        CRP_EMP_RATE: crpRate,
        REFORMA_EMP_RATE: 0,
        AFP_CAPITAL_COMMISSION_RATE: 1.44,
        AFP_CUPRUM_COMMISSION_RATE: 1.44,
        AFP_HABITAT_COMMISSION_RATE: 1.27,
        AFP_MODELO_COMMISSION_RATE: 0.58,
        AFP_PLANVITAL_COMMISSION_RATE: 1.16,
        AFP_PROVIDA_COMMISSION_RATE: 1.45,
        AFP_UNO_COMMISSION_RATE: 0.46
      };
    },
    [payrollMonthStart]
  );

  const loadWorkers = useCallback(async () => {
      if (!selectedCompany) return;
      const data = await fetchWorkers({ companyId: selectedCompany.id });
      setWorkers(data || []);
  }, [selectedCompany]);

  const loadSectorsAndFields = useCallback(async () => {
    if (!selectedCompany) return;
    
    const [fieldsData, sectorsData] = await Promise.all([
      fetchCompanyFieldsBasic({ companyId: selectedCompany.id }),
      fetchCompanySectorsBasic({ companyId: selectedCompany.id })
    ]);
    setFields(fieldsData || []);
    setSectors(sectorsData || []);
  }, [selectedCompany]);

  const loadCosts = useCallback(async () => {
    if (!selectedCompany) return;
    const data = await fetchWorkerCosts({ companyId: selectedCompany.id });
    setCosts(data || []);
  }, [selectedCompany]);

  const loadPayrollRates = useCallback(async () => {
    if (!selectedCompany) return;
    setPayrollRatesLoading(true);
    try {
      const rows = await fetchPayrollRatesForMonth({ companyId: selectedCompany.id, monthStart: payrollMonthStart });
      const sorted = [...rows].sort((a: any, b: any) => {
        const da = String(a.effective_from || '');
        const db = String(b.effective_from || '');
        if (da !== db) return db.localeCompare(da);
        const pa = a.company_id ? 0 : 1;
        const pb = b.company_id ? 0 : 1;
        return pa - pb;
      });
      const map: Record<string, number> = { ...defaultPayrollRates };
      const seenCodes = new Set<string>();
      sorted.forEach((r: any) => {
        const code = String(r.code || '');
        if (!code) return;
        if (seenCodes.has(code)) return;
        map[code] = Number(r.value || 0);
        seenCodes.add(code);
      });
      setPayrollRatesDraft(map);
    } finally {
      setPayrollRatesLoading(false);
    }
  }, [defaultPayrollRates, payrollMonthStart, selectedCompany]);

  const loadPayrollProposals = useCallback(async () => {
    if (!selectedCompany) return;
    const data = await fetchPayrollRateProposals({ companyId: selectedCompany.id });
    setPayrollProposals(data || []);
  }, [selectedCompany]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadWorkers(), loadSectorsAndFields(), loadCosts(), loadPayrollRates(), loadPayrollProposals()]);
    } catch {
      toast.error('Error al cargar trabajadores.');
    } finally {
      setLoading(false);
    }
  }, [loadCosts, loadPayrollProposals, loadPayrollRates, loadSectorsAndFields, loadWorkers]);

  useEffect(() => {
    if (selectedCompany) {
      void loadData();
    }
  }, [selectedCompany, loadData]);

  useEffect(() => {
    if (selectedCompany) {
      void loadPayrollRates();
    }
  }, [loadPayrollRates, selectedCompany]);

  const handleCreateWorker = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newWorkerName || !selectedCompany) return;

      setLoading(true);
      try {
          const payload = {
            name: newWorkerName,
            role: newWorkerRole,
            birthDate: newWorkerBirthDate || null,
            gender: newWorkerGender,
            isPensioner: newWorkerIsPensioner,
            pensionType: newWorkerIsPensioner ? newWorkerPensionType : null,
            voluntaryAfpAfterLegalAge: newWorkerVoluntaryAfp,
            art69Exempt: newWorkerArt69Exempt
          } as const;

          if (editingWorkerId) {
            await updateWorker({ workerId: editingWorkerId, ...payload });
          } else {
            await createWorker({ companyId: selectedCompany.id, ...payload });
          }

          setEditingWorkerId(null);
          setNewWorkerName('');
          setNewWorkerRole('');
          setNewWorkerBirthDate('');
          setNewWorkerGender('unspecified');
          setNewWorkerIsPensioner(false);
          setNewWorkerPensionType('old_age');
          setNewWorkerVoluntaryAfp(false);
          setNewWorkerArt69Exempt(false);
          setShowWorkerForm(false);
          await loadWorkers();
      } catch (error: any) {
          toast.error('Error: ' + error.message);
      } finally {
          setLoading(false);
      }
  };

  const resetWorkerForm = () => {
    setEditingWorkerId(null);
    setNewWorkerName('');
    setNewWorkerRole('');
    setNewWorkerBirthDate('');
    setNewWorkerGender('unspecified');
    setNewWorkerIsPensioner(false);
    setNewWorkerPensionType('old_age');
    setNewWorkerVoluntaryAfp(false);
    setNewWorkerArt69Exempt(false);
  };

  const openCreateWorkerForm = () => {
    resetWorkerForm();
    setShowWorkerForm(true);
  };

  const openEditWorkerForm = (worker: Worker) => {
    setEditingWorkerId(worker.id);
    setNewWorkerName(worker.name || '');
    setNewWorkerRole(worker.role || '');
    setNewWorkerBirthDate(worker.birth_date || '');
    setNewWorkerGender(worker.gender || 'unspecified');
    setNewWorkerIsPensioner(Boolean(worker.is_pensioner));
    setNewWorkerPensionType((worker.pension_type as 'old_age' | 'disability_total' | 'disability_partial' | 'other' | null) || 'old_age');
    setNewWorkerVoluntaryAfp(Boolean(worker.voluntary_afp_after_legal_age));
    setNewWorkerArt69Exempt(Boolean(worker.art69_exempt));
    setShowWorkerForm(true);
  };

  const handleDeleteWorker = async (id: string) => {
      if (!confirm('¿Eliminar trabajador? Se borrarán sus registros de costos.')) return;
      try {
        await deleteWorker({ workerId: id });
        loadWorkers();
      } catch {
        toast.error('Error al eliminar');
      }
  };

  const handleSaveCost = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedCompany) return;

    if (isPieceRate) {
        if (!pieceQuantity || !piecePrice || !workerName || !laborType) {
            toast('Complete todos los campos del trato');
            return;
        }
        if (distributeBy === 'sector' && !selectedSectorId) {
            toast('Seleccione un sector');
            return;
        }
    } else {
        if (!amount || !selectedWorkerId || !description) {
            toast('Complete todos los campos obligatorios');
            return;
        }
        if (distributeBy === 'sector' && !selectedSectorId) {
            toast('Seleccione un sector');
            return;
        }
        if (distributeBy === 'field' && !selectedFieldId) {
            toast('Seleccione un campo');
            return;
        }
    }

    setLoading(true);
    try {
        const totalAmount = isPieceRate ? (Number(pieceQuantity) * Number(piecePrice)) : Number(amount);
        
        if (distributeBy === 'company') {
            // Distribute by Company (All Fields)
            const allSectors = sectors;
            const totalHa = allSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            
            if (totalHa === 0) {
                toast('La empresa no tiene hectáreas definidas en ningún sector.');
                setLoading(false);
                return;
            }

            const costsToInsert = allSectors.map(s => {
                const sectorAmount = (Number(s.hectares) / totalHa) * totalAmount;
                return {
                    company_id: selectedCompany.id,
                    worker_id: selectedWorkerId,
                    date,
                    description: `${description} (Dist. Empresa)`,
                    amount: sectorAmount,
                    sector_id: s.id
                };
            });

            await insertWorkerCosts({ rows: costsToInsert });

        } else if (distributeBy === 'field') {
            // Distribute by Field Logic
            const fieldSectors = sectors.filter(s => s.field_id === selectedFieldId);
            if (fieldSectors.length === 0) {
                toast('El campo seleccionado no tiene sectores asociados.');
                setLoading(false);
                return;
            }

            const totalHa = fieldSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
            if (totalHa === 0) {
                toast('Los sectores del campo no tienen hectáreas definidas.');
                setLoading(false);
                return;
            }

            const costsToInsert = fieldSectors.map(s => {
                const sectorAmount = (Number(s.hectares) / totalHa) * totalAmount;
                return {
                    company_id: selectedCompany.id,
                    worker_id: selectedWorkerId,
                    date,
                    description: `${description} (Dist. Campo)`,
                    amount: sectorAmount,
                    sector_id: s.id
                };
            });

            await insertWorkerCosts({ rows: costsToInsert });

        } else {
            // Single Sector Logic
            await insertWorkerCosts({ rows: [{
                    company_id: selectedCompany.id,
                    worker_id: isPieceRate ? null : selectedWorkerId,
                    date,
                    description: isPieceRate ? `Trato: ${laborType} - ${workerName} (${pieceQuantity} x $${piecePrice})` : description,
                    amount: totalAmount,
                    sector_id: selectedSectorId,
                    is_piece_rate: isPieceRate,
                    piece_quantity: isPieceRate ? Number(pieceQuantity) : null,
                    piece_price: isPieceRate ? Number(piecePrice) : null,
                    worker_name: isPieceRate ? workerName : null,
                    labor_type: isPieceRate ? laborType : null
                }] });
        }

        // Reset form partial
        setAmount('');
        setDescription('');
        setPieceQuantity('');
        setPiecePrice('');
        setWorkerName('');
        setLaborType('');
        
        // Reload
        await loadCosts();
        toast('Costo registrado exitosamente');

    } catch (error: any) {
        toast.error('Error: ' + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteCost = async (id: string) => {
      if (!confirm('¿Eliminar este registro de costo?')) return;
      try {
        await deleteWorkerCost({ costId: id });
        loadCosts();
      } catch {
        toast.error('Error al eliminar');
      }
  };

  const generatePayrollPDF = () => {
    if (costs.length === 0) {
      toast('No hay registros de costos o tratos para exportar.');
      return;
    }

    const doc = new jsPDF();
    const companyName = selectedCompany?.name || 'Empresa';
    
    // Header
    doc.setFontSize(18);
    doc.text('Planilla de Pagos y Tratos', 14, 22);
    doc.setFontSize(11);
    doc.text(`Empresa: ${companyName}`, 14, 30);
    doc.text(`Fecha Emisión: ${new Date().toLocaleDateString('es-CL')}`, 14, 36);

    // Group costs by worker
    const workerTotals = new Map<string, { total: number, name: string, details: string[] }>();
    
    costs.forEach(cost => {
        const workerName = cost.worker_name || cost.workers?.name || 'Trabajador Externo';
        if (!workerTotals.has(workerName)) {
            workerTotals.set(workerName, { total: 0, name: workerName, details: [] });
        }
        
        const w = workerTotals.get(workerName)!;
        w.total += cost.amount;
        
        const dateStr = new Date(cost.date).toLocaleDateString('es-CL');
        if (cost.is_piece_rate) {
            w.details.push(`${dateStr} - ${cost.description} (${cost.piece_quantity} un. x ${formatCLP(cost.piece_price || 0)}) = ${formatCLP(cost.amount)}`);
        } else {
            w.details.push(`${dateStr} - ${cost.description} = ${formatCLP(cost.amount)}`);
        }
    });

    const tableData: any[] = [];
    let grandTotal = 0;

    workerTotals.forEach(data => {
        tableData.push([{ content: data.name, styles: { fontStyle: 'bold' } }, { content: formatCLP(data.total), styles: { fontStyle: 'bold', halign: 'right' } }]);
        data.details.forEach(detail => {
            tableData.push([{ content: `  • ${detail}`, colSpan: 2, styles: { fontSize: 9, textColor: [100, 100, 100] } }]);
        });
        grandTotal += data.total;
    });

    // Add Grand Total row
    tableData.push([
        { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, 
        { content: formatCLP(grandTotal), styles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 240, 240] } }
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Trabajador / Detalle', 'Monto a Pagar']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }, // indigo-600
      styles: { fontSize: 10 }
    });

    doc.save(`Planilla_Pagos_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const payrollRateFields = useMemo(
    () => [
      { code: 'IMM_CLP', name: 'Ingreso Mínimo Mensual (CLP)', kind: 'amount', payer: 'system' },
      { code: 'UF_CLP', name: 'UF (CLP)', kind: 'amount', payer: 'system' },
      { code: 'GRAT_LEGAL_RATE', name: 'Gratificación legal Art. 50 %', kind: 'rate', payer: 'worker' },
      { code: 'GRAT_LEGAL_TOPE_IMM_ANNUAL', name: 'Tope gratificación anual (IMM)', kind: 'amount', payer: 'system' },
      { code: 'TOPE_AFP_UF', name: 'Tope AFP/Salud (UF)', kind: 'cap_uf', payer: 'system' },
      { code: 'TOPE_AFC_UF', name: 'Tope Cesantía (UF)', kind: 'cap_uf', payer: 'system' },
      { code: 'SIS_EMP_RATE', name: 'SIS (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'SANNA_EMP_RATE', name: 'SANNA (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'MUTUAL_EMP_RATE', name: 'Mutual (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'AFC_WORKER_INDEF_RATE', name: 'AFC Trabajador indefinido %', kind: 'rate', payer: 'worker' },
      { code: 'AFC_WORKER_FIXED_RATE', name: 'AFC Trabajador plazo fijo/obra %', kind: 'rate', payer: 'worker' },
      { code: 'AFC_EMP_CIC_INDEF_RATE', name: 'Cesantía CIC empleador indefinido %', kind: 'rate', payer: 'employer' },
      { code: 'AFC_EMP_FCS_INDEF_RATE', name: 'Fondo Solidario empleador indefinido %', kind: 'rate', payer: 'employer' },
      { code: 'AFC_EMP_CIC_FIXED_RATE', name: 'Cesantía CIC empleador plazo fijo/obra %', kind: 'rate', payer: 'employer' },
      { code: 'AFC_EMP_FCS_FIXED_RATE', name: 'Fondo Solidario empleador plazo fijo/obra %', kind: 'rate', payer: 'employer' },
      { code: 'SEGURO_SOCIAL_AFP_EMP_RATE', name: 'Seguro Social cuenta AFP %', kind: 'rate', payer: 'employer' },
      { code: 'SEGURO_SOCIAL_EMP_RATE', name: 'Seguro Social Previsional %', kind: 'rate', payer: 'employer' },
      { code: 'CRP_EMP_RATE', name: 'CRP %', kind: 'rate', payer: 'employer' },
      { code: 'REFORMA_EMP_RATE', name: 'Reforma (legacy) %', kind: 'rate', payer: 'employer' },
      { code: 'AFP_MANDATORY_RATE', name: 'AFP Obligatoria %', kind: 'rate', payer: 'worker' },
      { code: 'SALUD_FONASA_RATE', name: 'Salud Fonasa %', kind: 'rate', payer: 'worker' },
      { code: 'SALUD_ISAPRE_MIN_RATE', name: 'Salud Isapre mín. %', kind: 'rate', payer: 'worker' },
      { code: 'SALUD_CCAF_RATE', name: 'Caja Compensación (de 7% Salud) %', kind: 'rate', payer: 'worker' },
      { code: 'SALUD_CCAF_FONASA_RATE', name: 'Fonasa (de 7% Salud con CCAF) %', kind: 'rate', payer: 'worker' },
      ...afpOptions.map((afp) => ({
        code: afp.rateCode,
        name: `Comisión AFP ${afp.label} %`,
        kind: 'rate',
        payer: 'worker'
      }))
    ],
    [afpOptions]
  );

  const getAfpCommissionRateByName = useCallback(
    (afpName: string) => {
      const option = afpOptions.find((afp) => afp.value === afpName);
      if (!option) return 0;
      return Number(payrollRatesDraft[option.rateCode] || 0);
    },
    [afpOptions, payrollRatesDraft]
  );

  const getCcafLabel = useCallback(
    (ccafName: string) => ccafOptions.find((ccaf) => ccaf.value === ccafName)?.label || ccafName || '',
    [ccafOptions]
  );

  const normalizeAfpName = useCallback(
    (value: unknown) => {
      const normalized = String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!normalized) return '';
      const found = afpOptions.find((afp) =>
        afp.aliases.some(
          (alias) =>
            alias
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .trim() === normalized
        )
      );
      return found?.value || '';
    },
    [afpOptions]
  );

  useEffect(() => {
    if (!payrollAfpName) return;
    const rate = getAfpCommissionRateByName(payrollAfpName);
    setPayrollAfpCommissionRate(rate);
  }, [getAfpCommissionRateByName, payrollAfpName]);

  useEffect(() => {
    if (payrollCcafName) return;
    setPayrollCcafName('los_andes');
  }, [payrollCcafName]);

  useEffect(() => {
    if (payrollMutualRate !== '') return;
    const v = Number(payrollRatesDraft.MUTUAL_EMP_RATE || 0);
    if (!Number.isFinite(v) || v <= 0) return;
    setPayrollMutualRate(v);
  }, [payrollMutualRate, payrollRatesDraft.MUTUAL_EMP_RATE]);

  useEffect(() => {
    if (!payrollWorkerId) return;
    const worker = workers.find((w) => w.id === payrollWorkerId);
    if (!worker) return;
    setPayrollWorkerBirthDate(worker.birth_date || '');
    setPayrollWorkerGender(worker.gender || 'unspecified');
    setPayrollWorkerIsPensioner(Boolean(worker.is_pensioner));
    setPayrollWorkerPensionType((worker.pension_type as 'old_age' | 'disability_total' | 'disability_partial' | 'other' | null) || 'old_age');
    setPayrollWorkerVoluntaryAfp(Boolean(worker.voluntary_afp_after_legal_age));
    setPayrollWorkerArt69Exempt(Boolean(worker.art69_exempt));
  }, [payrollWorkerId, workers]);

  useEffect(() => {
    if (workers.length === 0) {
      setWorkerWorkspaceId('');
      return;
    }
    if (!workerWorkspaceId || !workers.some((worker) => worker.id === workerWorkspaceId)) {
      const firstWorkerId = workers[0]?.id || '';
      setWorkerWorkspaceId(firstWorkerId);
      setSelectedWorkerId(firstWorkerId);
      setPayrollWorkerId(firstWorkerId);
    }
  }, [workerWorkspaceId, workers]);

  useEffect(() => {
    if (!workerWorkspaceId) return;
    setSelectedWorkerId(workerWorkspaceId);
    setPayrollWorkerId(workerWorkspaceId);
  }, [workerWorkspaceId]);

  const handleScanPayrollRates = async () => {
    setScanLoading(true);
    try {
      const url = `/api/payroll/scan?effective_from=${encodeURIComponent(payrollMonthStart)}`;
      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Error al buscar actualización');
      setScanResult(data);
      toast('Propuesta cargada');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setScanLoading(false);
    }
  };

  const handleCreateProposalFromScan = async () => {
    if (!selectedCompany || !scanResult) return;
    try {
      await createPayrollRateProposal({
        companyId: selectedCompany.id,
        effectiveFrom: payrollMonthStart,
        sources: scanResult.sources || [],
        proposedItems: scanResult.items || []
      });
      setScanResult(null);
      await loadPayrollProposals();
      toast('Propuesta guardada');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const handleApplyProposal = async (proposal: any) => {
    if (!selectedCompany) return;
    const items = Array.isArray(proposal?.proposed_items) ? proposal.proposed_items : [];
    if (items.length === 0) {
      toast('La propuesta no tiene ítems');
      return;
    }
    try {
      await upsertPayrollRates({
        rows: items.map((i: any) => ({
          company_id: selectedCompany.id,
          code: String(i.code || ''),
          name: String(i.name || i.code || ''),
          kind: String(i.kind || 'rate'),
          payer: String(i.payer || 'system'),
          value: Number(i.value || 0),
          effective_from: String(i.effective_from || proposal.effective_from),
          source_url: String(i.source_url || '') || null,
          source_note: null
        }))
      });
      await updatePayrollRateProposalStatus({ proposalId: proposal.id, status: 'applied' });
      await Promise.all([loadPayrollRates(), loadPayrollProposals()]);
      toast('Parámetros actualizados');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const handleDismissProposal = async (proposal: any) => {
    if (!proposal?.id) return;
    try {
      await updatePayrollRateProposalStatus({ proposalId: proposal.id, status: 'dismissed' });
      await loadPayrollProposals();
      toast('Propuesta descartada');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const handleSavePayrollRatesDraft = async () => {
    if (!selectedCompany) return;
    try {
      await upsertPayrollRates({
        rows: payrollRateFields.map((f: any) => ({
          company_id: selectedCompany.id,
          code: f.code,
          name: f.name,
          kind: f.kind,
          payer: f.payer,
          value: Number(payrollRatesDraft[f.code] || 0),
          effective_from: payrollMonthStart,
          source_url: null,
          source_note: null
        }))
      });
      await loadPayrollRates();
      toast('Parámetros guardados');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const getPayrollDistributionSectors = () => {
    if (payrollDistributeBy === 'company') return sectors;
    if (payrollDistributeBy === 'field') return sectors.filter((s) => s.field_id === payrollFieldId);
    return sectors.filter((s) => s.id === payrollSectorId);
  };

  const buildDistributedWorkerCostRows = (params: { workerId: string; date: string; description: string; amount: number }) => {
    if (!selectedCompany) return [];
    const totalAmount = Number(params.amount || 0);
    if (payrollDistributeBy === 'sector') {
      return [
        {
          company_id: selectedCompany.id,
          worker_id: params.workerId,
          date: params.date,
          description: params.description,
          amount: totalAmount,
          sector_id: payrollSectorId
        }
      ];
    }

    const distSectors = getPayrollDistributionSectors();
    const totalHa = distSectors.reduce((sum, s) => sum + Number(s.hectares), 0);
    if (totalHa <= 0) return [];

    return distSectors.map((s) => ({
      company_id: selectedCompany.id,
      worker_id: params.workerId,
      date: params.date,
      description: params.description,
      amount: (Number(s.hectares) / totalHa) * totalAmount,
      sector_id: s.id
    }));
  };

  const handleCalculatePayroll = () => {
    const gross = Number(payrollImponibleTotal || 0);
    if (!payrollWorkerId || gross <= 0) {
      toast('Seleccione trabajador e ingrese sueldo base/bonos imponibles');
      return;
    }
    const result = calculatePayrollChile({
      input: {
        month: payrollMonthStart,
        grossImponible: gross,
        contractType: payrollContractType,
        workerBirthDate: payrollWorkerBirthDate || null,
        workerGender: payrollWorkerGender,
        workerIsPensioner: payrollWorkerIsPensioner,
        workerPensionType: payrollWorkerIsPensioner ? payrollWorkerPensionType : undefined,
        workerVoluntaryAfpAfterLegalAge: payrollWorkerVoluntaryAfp,
        workerArt69Exempt: payrollWorkerArt69Exempt,
        afpCommissionRate: Number(payrollAfpCommissionRate || 0),
        healthType: payrollHealthType,
        healthPlanAmount: Number(payrollHealthPlanAmount || 0),
        mutualRate: Number(payrollMutualRate || 0),
        ccafEnabled: payrollCcafEnabled,
        ccafName: getCcafLabel(payrollCcafName)
      },
      rates: payrollRatesDraft
    });
    setPayrollResult(result);
  };

  const handleRegisterPayrollIndividual = async () => {
    if (!selectedCompany) return;
    if (!payrollResult) {
      toast('Primero calcula la previsión');
      return;
    }
    if (payrollDistributeBy === 'sector' && !payrollSectorId) {
      toast('Seleccione un sector');
      return;
    }
    if (payrollDistributeBy === 'field' && !payrollFieldId) {
      toast('Seleccione un campo');
      return;
    }

    const base = Number(payrollBaseSalary || 0);
    const bonuses = payrollImponibleBonuses
      .map((b) => ({ label: String(b.label || '').trim(), amount: Number(b.amount || 0) }))
      .filter((b) => Number.isFinite(b.amount) && b.amount > 0);
    const nonImponibles = payrollNonImponibles
      .map((b) => ({ label: String(b.label || '').trim(), amount: Number(b.amount || 0) }))
      .filter((b) => Number.isFinite(b.amount) && b.amount > 0);
    const gratification = Number(payrollLegalGratificationAmount || 0);
    const gross = Math.max(0, base + bonuses.reduce((sum, b) => sum + b.amount, 0) + gratification);
    if (!payrollWorkerId || gross <= 0) return;

    setPayrollSaving(true);
    try {
      const date = payrollMonthStart;
      const monthLabel = payrollMonth;
      const rowsToInsert: any[] = [];

      if (base > 0) {
        rowsToInsert.push(
          ...buildDistributedWorkerCostRows({
            workerId: payrollWorkerId,
            date,
            description: `Sueldo base ${monthLabel}`,
            amount: base
          })
        );
      }

      bonuses.forEach((b) => {
        rowsToInsert.push(
          ...buildDistributedWorkerCostRows({
            workerId: payrollWorkerId,
            date,
            description: b.label ? `Bono imponible ${monthLabel} - ${b.label}` : `Bono imponible ${monthLabel}`,
            amount: b.amount
          })
        );
      });

      if (gratification > 0) {
        rowsToInsert.push(
          ...buildDistributedWorkerCostRows({
            workerId: payrollWorkerId,
            date,
            description: `Gratificación legal ${monthLabel}`,
            amount: gratification
          })
        );
      }

      nonImponibles.forEach((b) => {
        rowsToInsert.push(
          ...buildDistributedWorkerCostRows({
            workerId: payrollWorkerId,
            date,
            description: b.label ? `No imponible ${monthLabel} - ${b.label}` : `No imponible ${monthLabel}`,
            amount: b.amount
          })
        );
      });

      payrollResult.items
        .filter((i) => i.payer === 'employer')
        .forEach((i) => {
          rowsToInsert.push(
            ...buildDistributedWorkerCostRows({
              workerId: payrollWorkerId,
              date,
              description: `Previsión ${monthLabel} - ${i.name}`,
              amount: i.amount
            })
          );
        });

      if (rowsToInsert.length === 0) {
        toast('No hay hectáreas definidas para distribuir en el destino seleccionado.');
        return;
      }

      await insertWorkerCosts({ rows: rowsToInsert });

      const healthRate =
        payrollHealthType === 'fonasa'
          ? Number(payrollRatesDraft.SALUD_FONASA_RATE || 7)
          : Number(payrollRatesDraft.SALUD_ISAPRE_MIN_RATE || 7);

      await createWorkerPayrollRun({
        run: {
          company_id: selectedCompany.id,
          worker_id: payrollWorkerId,
          month: payrollMonthStart,
          field_id: payrollDistributeBy === 'field' ? payrollFieldId : null,
          sector_id: payrollDistributeBy === 'sector' ? payrollSectorId : null,
          gross_imponible: gross,
          contract_type: payrollContractType,
          afp_name: payrollAfpName || null,
          afp_commission_rate: Number(payrollAfpCommissionRate || 0),
          health_type: payrollHealthType,
          health_rate: healthRate,
          health_plan_amount: Number(payrollHealthPlanAmount || 0),
          ccaf_enabled: payrollCcafEnabled,
          ccaf_name: payrollCcafEnabled ? getCcafLabel(payrollCcafName) : null,
          mutual_rate: Number(payrollMutualRate || 0),
          worker_birth_date: payrollWorkerBirthDate || null,
          worker_gender: payrollWorkerGender,
          worker_is_pensioner: payrollWorkerIsPensioner,
          worker_pension_type: payrollWorkerIsPensioner ? payrollWorkerPensionType : null,
          worker_art69_exempt: payrollWorkerArt69Exempt,
          worker_voluntary_afp: payrollWorkerVoluntaryAfp
        },
        items: payrollResult.items.map((i) => ({
          run_id: '',
          company_id: selectedCompany.id,
          payer: i.payer,
          code: i.code,
          name: i.name,
          rate: i.rate,
          base_amount: i.baseAmount,
          amount: i.amount,
          sort_order: i.sortOrder
        }))
      });

      await loadCosts();
      toast('Previsión registrada');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setPayrollSaving(false);
    }
  };

  const parseContractType = (v: unknown): 'indefinite' | 'fixed_term' | 'work' => {
    const t = String(v || '').toLowerCase().trim();
    if (t.includes('plazo')) return 'fixed_term';
    if (t.includes('obra')) return 'work';
    if (t.includes('fijo')) return 'fixed_term';
    return 'indefinite';
  };

  const parseHealthType = (v: unknown): 'fonasa' | 'isapre' => {
    const t = String(v || '').toLowerCase().trim();
    if (t.includes('isap')) return 'isapre';
    return 'fonasa';
  };

  const parseGender = (v: unknown): 'male' | 'female' | 'unspecified' => {
    const t = String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    if (['m', 'masculino', 'hombre', 'male'].includes(t)) return 'male';
    if (['f', 'femenino', 'mujer', 'female'].includes(t)) return 'female';
    return 'unspecified';
  };

  const parseBooleanCell = (v: unknown) => {
    const t = String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return ['1', 'si', 'sí', 'true', 'x', 'yes', 'y', 'activo'].includes(t);
  };

  const parsePensionType = (v: unknown): 'old_age' | 'disability_total' | 'disability_partial' | 'other' => {
    const t = String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    if (t.includes('vejez')) return 'old_age';
    if (t.includes('invalidez total')) return 'disability_total';
    if (t.includes('invalidez parcial')) return 'disability_partial';
    return 'other';
  };

  const parseBirthDate = (v: unknown) => {
    if (!v) return '';
    if (typeof v === 'object' && v !== null && 'result' in (v as any)) {
      return parseBirthDate((v as any).result);
    }
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return v.toISOString().slice(0, 10);
    }
    const raw = String(v).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [d, m, y] = raw.split('/');
      return `${y}-${m}-${d}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  };

  const handleBulkFile = async (file: File) => {
    try {
      const rows = await importXlsxToJson({ file, maxRows: 2000 });
      setBulkFileRows(rows);
      const errors: string[] = [];
      const out: any[] = [];
      const findWorkerId = (name: string) => {
        const n = name.toLowerCase().trim();
        const w = workers.find((x) => x.name.toLowerCase().trim() === n);
        return w?.id || '';
      };

      rows.forEach((r, idx) => {
        const workerName = String((r as any).Trabajador ?? (r as any).trabajador ?? (r as any).Nombre ?? (r as any).nombre ?? '').trim();
        const baseSalary = Number(
          (r as any).SueldoBase ??
            (r as any).sueldoBase ??
            (r as any).sueldo_base ??
            (r as any).Base ??
            (r as any).base ??
            0
        );
        const imponibleBonuses = Number(
          (r as any).BonosImponibles ??
            (r as any).bonosImponibles ??
            (r as any).bonos_imponibles ??
            (r as any).Bonos ??
            (r as any).bonos ??
            0
        );
        const nonImponibles = Number(
          (r as any).NoImponibles ??
            (r as any).noImponibles ??
            (r as any).no_imponibles ??
            (r as any).NoImponible ??
            (r as any).noImponible ??
            0
        );
        const colacion = Number((r as any).Colacion ?? (r as any).colacion ?? (r as any).Colación ?? (r as any).colación ?? 0);
        const movilizacion = Number((r as any).Movilizacion ?? (r as any).movilizacion ?? (r as any).Movilización ?? (r as any).movilización ?? 0);
        const nonImponiblesTotal =
          Number.isFinite(nonImponibles) && nonImponibles > 0
            ? nonImponibles
            : (Number.isFinite(colacion) ? colacion : 0) + (Number.isFinite(movilizacion) ? movilizacion : 0);
        const grossFromImponible = Number((r as any).Imponible ?? (r as any).imponible ?? 0);
        const gratificationInput = Number(
          (r as any).GratificacionLegal ??
            (r as any).gratificacionLegal ??
            (r as any).gratificacion_legal ??
            (r as any).GratificaciónLegal ??
            (r as any).gratificaciónLegal ??
            0
        );
        const hasImponibleColumn = Number.isFinite(grossFromImponible) && grossFromImponible > 0;
        const legalGratification =
          hasImponibleColumn
            ? Number.isFinite(gratificationInput) && gratificationInput > 0
              ? gratificationInput
              : 0
            : Number.isFinite(gratificationInput) && gratificationInput > 0
              ? gratificationInput
              : calculateLegalGratification(baseSalary + imponibleBonuses);
        const gross = hasImponibleColumn ? grossFromImponible : baseSalary + imponibleBonuses + legalGratification;
        if (!workerName) {
          errors.push(`Fila ${idx + 2}: falta Trabajador`);
          return;
        }
        const workerId = findWorkerId(workerName);
        if (!workerId) {
          errors.push(`Fila ${idx + 2}: trabajador no encontrado (${workerName})`);
          return;
        }
        if (!Number.isFinite(gross) || gross <= 0) {
          errors.push(`Fila ${idx + 2}: imponible inválido (usa Imponible o SueldoBase+BonosImponibles)`);
          return;
        }

        const contractType = parseContractType((r as any).Contrato ?? (r as any).contrato ?? '');
        const workerGender = parseGender((r as any).Sexo ?? (r as any).sexo ?? (r as any).Genero ?? (r as any).género ?? (r as any).genero ?? '');
        const workerBirthDate = parseBirthDate(
          (r as any).FechaNacimiento ??
            (r as any).fechaNacimiento ??
            (r as any).fecha_nacimiento ??
            (r as any).Nacimiento ??
            (r as any).nacimiento ??
            ''
        );
        const workerIsPensioner = parseBooleanCell(
          (r as any).Pensionado ??
            (r as any).pensionado ??
            (r as any).EsPensionado ??
            (r as any).esPensionado ??
            (r as any).es_pensionado ??
            ''
        );
        const workerPensionType = parsePensionType(
          (r as any).TipoPension ??
            (r as any).tipoPension ??
            (r as any).tipo_pension ??
            (r as any).Pension ??
            (r as any).pension ??
            ''
        );
        const workerVoluntaryAfp = parseBooleanCell(
          (r as any).CotizacionVoluntariaAFP ??
            (r as any).cotizacionVoluntariaAFP ??
            (r as any).cotizacion_voluntaria_afp ??
            (r as any).MantieneAFP ??
            (r as any).mantieneAFP ??
            ''
        );
        const workerArt69Exempt = parseBooleanCell(
          (r as any).ExencionArt69 ??
            (r as any).exencionArt69 ??
            (r as any).exencion_art69 ??
            (r as any).Art69 ??
            (r as any).art69 ??
            ''
        );
        const afpNameRaw = (r as any).AFP ?? (r as any).afp ?? (r as any).Administradora ?? (r as any).administradora ?? '';
        const afpName = normalizeAfpName(afpNameRaw);
        const afpCommissionInput = Number((r as any).ComisionAFP ?? (r as any).comisionAFP ?? (r as any).comision_afp ?? 0);
        const afpCommissionRate =
          Number.isFinite(afpCommissionInput) && afpCommissionInput > 0
            ? afpCommissionInput
            : getAfpCommissionRateByName(afpName);
        const healthType = parseHealthType((r as any).Salud ?? (r as any).salud ?? '');
        const healthPlanAmount = Number((r as any).PlanSalud ?? (r as any).planSalud ?? (r as any).plan_salud ?? 0);
        const mutualRate = Number((r as any).Mutual ?? (r as any).mutual ?? 0);

        const baseOut = Number.isFinite(baseSalary) ? baseSalary : 0;
        const bonusOut = Number.isFinite(imponibleBonuses) ? imponibleBonuses : 0;
        const finalBase = hasImponibleColumn && baseOut + bonusOut <= 0 ? gross : baseOut;
        const finalBonuses = hasImponibleColumn && baseOut + bonusOut <= 0 ? 0 : bonusOut;
        const finalGratification = hasImponibleColumn && baseOut + bonusOut <= 0 ? 0 : legalGratification;

        out.push({
          workerId,
          baseSalary: finalBase,
          imponibleBonuses: finalBonuses,
          legalGratification: Number.isFinite(finalGratification) ? finalGratification : 0,
          nonImponibles: Number.isFinite(nonImponiblesTotal) ? nonImponiblesTotal : 0,
          grossImponible: gross,
          contractType,
          workerGender,
          workerBirthDate,
          workerIsPensioner,
          workerPensionType,
          workerVoluntaryAfp,
          workerArt69Exempt,
          afpName,
          afpCommissionRate: Number.isFinite(afpCommissionRate) ? afpCommissionRate : 0,
          healthType,
          healthPlanAmount: Number.isFinite(healthPlanAmount) ? healthPlanAmount : 0,
          mutualRate: Number.isFinite(mutualRate) ? mutualRate : 0
        });
      });

      setBulkRows(out);
      setBulkErrors(errors);
      toast(errors.length > 0 ? 'Carga con observaciones' : 'Archivo cargado');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const handleRegisterPayrollBulk = async () => {
    if (!selectedCompany) return;
    if (bulkRows.length === 0) {
      toast('No hay filas para registrar');
      return;
    }
    if (payrollDistributeBy === 'sector' && !payrollSectorId) {
      toast('Seleccione un sector');
      return;
    }
    if (payrollDistributeBy === 'field' && !payrollFieldId) {
      toast('Seleccione un campo');
      return;
    }
    setPayrollSaving(true);
    try {
      const monthLabel = payrollMonth;
      const date = payrollMonthStart;
      const costsRows: any[] = [];
      const runPayloads: any[] = [];

      for (const row of bulkRows) {
        const result = calculatePayrollChile({
          input: {
            month: payrollMonthStart,
            grossImponible: row.grossImponible,
            contractType: row.contractType,
            workerBirthDate: row.workerBirthDate || null,
            workerGender: row.workerGender,
            workerIsPensioner: row.workerIsPensioner,
            workerPensionType: row.workerIsPensioner ? row.workerPensionType : undefined,
            workerVoluntaryAfpAfterLegalAge: row.workerVoluntaryAfp,
            workerArt69Exempt: row.workerArt69Exempt,
            afpCommissionRate: row.afpCommissionRate,
            healthType: row.healthType,
            healthPlanAmount: row.healthPlanAmount,
            mutualRate: row.mutualRate,
            ccafEnabled: payrollCcafEnabled,
            ccafName: getCcafLabel(payrollCcafName)
          },
          rates: payrollRatesDraft
        });

        if (Number(row.baseSalary || 0) > 0) {
          costsRows.push(
            ...buildDistributedWorkerCostRows({
              workerId: row.workerId,
              date,
              description: `Sueldo base ${monthLabel}`,
              amount: Number(row.baseSalary || 0)
            })
          );
        }
        if (Number(row.imponibleBonuses || 0) > 0) {
          costsRows.push(
            ...buildDistributedWorkerCostRows({
              workerId: row.workerId,
              date,
              description: `Bonos imponibles ${monthLabel}`,
              amount: Number(row.imponibleBonuses || 0)
            })
          );
        }
        if (Number(row.legalGratification || 0) > 0) {
          costsRows.push(
            ...buildDistributedWorkerCostRows({
              workerId: row.workerId,
              date,
              description: `Gratificación legal ${monthLabel}`,
              amount: Number(row.legalGratification || 0)
            })
          );
        }
        if (Number(row.nonImponibles || 0) > 0) {
          costsRows.push(
            ...buildDistributedWorkerCostRows({
              workerId: row.workerId,
              date,
              description: `No imponibles ${monthLabel}`,
              amount: Number(row.nonImponibles || 0)
            })
          );
        }

        result.items
          .filter((i) => i.payer === 'employer')
          .forEach((i) => {
            costsRows.push(
              ...buildDistributedWorkerCostRows({
                workerId: row.workerId,
                date,
                description: `Previsión ${monthLabel} - ${i.name}`,
                amount: i.amount
              })
            );
          });

        const healthRate =
          row.healthType === 'fonasa'
            ? Number(payrollRatesDraft.SALUD_FONASA_RATE || 7)
            : Number(payrollRatesDraft.SALUD_ISAPRE_MIN_RATE || 7);

        runPayloads.push({
          run: {
            company_id: selectedCompany.id,
            worker_id: row.workerId,
            month: payrollMonthStart,
            field_id: payrollDistributeBy === 'field' ? payrollFieldId : null,
            sector_id: payrollDistributeBy === 'sector' ? payrollSectorId : null,
            gross_imponible: row.grossImponible,
            contract_type: row.contractType,
            afp_name: row.afpName || null,
            afp_commission_rate: row.afpCommissionRate,
            health_type: row.healthType,
            health_rate: healthRate,
            health_plan_amount: row.healthPlanAmount,
            ccaf_enabled: payrollCcafEnabled,
            ccaf_name: payrollCcafEnabled ? getCcafLabel(payrollCcafName) : null,
            mutual_rate: row.mutualRate,
            worker_birth_date: row.workerBirthDate || null,
            worker_gender: row.workerGender,
            worker_is_pensioner: row.workerIsPensioner,
            worker_pension_type: row.workerIsPensioner ? row.workerPensionType : null,
            worker_art69_exempt: row.workerArt69Exempt,
            worker_voluntary_afp: row.workerVoluntaryAfp
          },
          items: result.items.map((i) => ({
            run_id: '',
            company_id: selectedCompany.id,
            payer: i.payer,
            code: i.code,
            name: i.name,
            rate: i.rate,
            base_amount: i.baseAmount,
            amount: i.amount,
            sort_order: i.sortOrder
          }))
        });
      }

      if (costsRows.length === 0) {
        toast('No hay hectáreas definidas para distribuir en el destino seleccionado.');
        return;
      }

      const runWithConcurrencyLimit = async (limit: number, tasks: Array<() => Promise<unknown>>) => {
        const pool = new Array(Math.max(1, limit)).fill(0).map(async () => {
          while (tasks.length > 0) {
            const t = tasks.shift();
            if (!t) return;
            await t();
          }
        });
        await Promise.all(pool);
      };

      const tasks = runPayloads.map((p) => () => createWorkerPayrollRun(p));
      await runWithConcurrencyLimit(5, tasks);
      await insertWorkerCosts({ rows: costsRows });
      await loadCosts();
      toast('Previsión masiva registrada');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setPayrollSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 -mx-2 px-2 pt-1 pb-4 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:supports-[backdrop-filter]:bg-gray-900/80 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
                  <Briefcase className="mr-2 h-8 w-8 text-indigo-600" />
                  Trabajadores de Planta
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Gestión de personal fijo y sus costos</p>
          </div>
          <div className="flex flex-wrap gap-2">
              <button
                  onClick={generatePayrollPDF}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                  <Download className="mr-2 h-5 w-5" />
                  Planilla Pagos PDF
              </button>
              <button
                  onClick={openCreateWorkerForm}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                  <UserPlus className="mr-2 h-5 w-5" />
                  Nuevo Trabajador
              </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="px-6 pt-4 border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex space-x-6 overflow-x-auto">
              <button
                type="button"
                onClick={() => setWorkersMainTab('trabajadores')}
                className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                  workersMainTab === 'trabajadores'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                Trabajadores
              </button>
              <button
                type="button"
                onClick={() => setWorkersMainTab('costos')}
                className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                  workersMainTab === 'costos'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                Costos
              </button>
            </nav>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="hidden px-6 pt-4 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-6">
            <button
              type="button"
              onClick={() => setWorkersMainTab('trabajadores')}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                workersMainTab === 'trabajadores'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
              }`}
            >
              Trabajadores
            </button>
            <button
              type="button"
              onClick={() => setWorkersMainTab('costos')}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                workersMainTab === 'costos'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
              }`}
            >
              Costos
            </button>
          </nav>
        </div>

        <div className="p-6">
          {workersMainTab === 'trabajadores' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Personal Registrado</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Edita la ficha una vez y se autocompleta en previsión.</p>
                </div>
              </div>
              <div className="max-h-[650px] overflow-y-auto">
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {workers.map((w) => (
                    <li key={w.id} className="px-6 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{w.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{w.role}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {[
                            w.birth_date || 'Sin fecha nac.',
                            w.gender === 'male' ? 'Hombre' : w.gender === 'female' ? 'Mujer' : 'Sexo no esp.',
                            w.is_pensioner
                              ? `Pensionado: ${
                                  w.pension_type === 'old_age'
                                    ? 'Vejez'
                                    : w.pension_type === 'disability_total'
                                      ? 'Inv. total'
                                      : w.pension_type === 'disability_partial'
                                        ? 'Inv. parcial'
                                        : 'Otra'
                                }`
                              : 'No pensionado',
                            w.voluntary_afp_after_legal_age ? 'AFP voluntaria' : null,
                            w.art69_exempt ? 'Art. 69' : null
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEditWorkerForm(w)} className="text-gray-400 hover:text-indigo-600">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDeleteWorker(w.id)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {workers.length === 0 && (
                    <li className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">No hay trabajadores registrados.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {workersMainTab === 'costos' && (
      <div className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Costo por trabajador</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Selecciona una ficha para ingresar remuneraciones, previsión y revisar el costo total.</p>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Mes resumido</label>
                <input
                  type="month"
                  value={workerSummaryMonth}
                  onChange={(e) => setWorkerSummaryMonth(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
            </div>
            <div className="max-h-[560px] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
              {workerCostSummaries.map((summary) => {
                const monthSummary =
                  workerMonthlyCostSummaries.find((item) => item.worker.id === summary.worker.id) || buildWorkerCostSummary(summary.worker, []);
                const isActive = summary.worker.id === workerWorkspaceId;
                return (
                  <button
                    key={summary.worker.id}
                    type="button"
                    onClick={() => setWorkerWorkspaceId(summary.worker.id)}
                    className={`w-full px-5 py-4 text-left transition ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/40'
                        : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{summary.worker.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{summary.worker.role || 'Sin cargo'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCLP(monthSummary.total)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatCLP(summary.total)} acumulado</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-gray-50 dark:bg-gray-900 px-2 py-2">
                        <div className="text-gray-500 dark:text-gray-400">Mes</div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{monthSummary.count} mov.</div>
                      </div>
                      <div className="rounded-md bg-gray-50 dark:bg-gray-900 px-2 py-2">
                        <div className="text-gray-500 dark:text-gray-400">Previsión mes</div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{formatCLP(monthSummary.payroll)}</div>
                      </div>
                      <div className="rounded-md bg-gray-50 dark:bg-gray-900 px-2 py-2">
                        <div className="text-gray-500 dark:text-gray-400">Acumulado</div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{summary.count} mov.</div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      {summary.lastDate ? `Último movimiento: ${new Date(summary.lastDate + 'T12:00:00').toLocaleDateString('es-CL')}` : 'Sin movimientos registrados'}
                    </p>
                  </button>
                );
              })}
              {workerCostSummaries.length === 0 && (
                <div className="px-5 py-6 text-sm text-center text-gray-500 dark:text-gray-400">
                  No hay trabajadores para consolidar costos.
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
            {activeWorker ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{activeWorker.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{activeWorker.role || 'Sin cargo definido'}</p>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {[
                        activeWorker.birth_date || 'Sin fecha nac.',
                        activeWorker.gender === 'male' ? 'Hombre' : activeWorker.gender === 'female' ? 'Mujer' : 'Sexo no esp.',
                        activeWorker.is_pensioner ? 'Pensionado/a' : 'No pensionado/a',
                        activeWorker.voluntary_afp_after_legal_age ? 'AFP voluntaria' : null,
                        activeWorker.art69_exempt ? 'Art. 69' : null
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-full lg:min-w-[460px]">
                    <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Costo del mes</div>
                      <div className="mt-1 text-2xl font-semibold text-indigo-700 dark:text-indigo-200">
                        {formatCLP(activeWorkerMonthCostSummary?.total || 0)}
                      </div>
                      <div className="mt-1 text-xs text-indigo-600/80 dark:text-indigo-300/80">
                        {workerSummaryMonthLabel} · {activeWorkerMonthCostSummary?.count || 0} registros
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Costo acumulado</div>
                      <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                        {formatCLP(activeWorkerCostSummary?.total || 0)}
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {activeWorkerCostSummary?.count || 0} registros acumulados
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-indigo-100 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Mes seleccionado</div>
                        <div className="mt-1 text-sm font-medium text-indigo-700 dark:text-indigo-200">{workerSummaryMonthLabel}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-indigo-600/80 dark:text-indigo-300/80">Total</div>
                        <div className="text-lg font-semibold text-indigo-700 dark:text-indigo-200">{formatCLP(activeWorkerMonthCostSummary?.total || 0)}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900 p-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Remuneración</div>
                        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerMonthCostSummary?.remuneration || 0)}</div>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900 p-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Previsión</div>
                        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerMonthCostSummary?.payroll || 0)}</div>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900 p-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Manual</div>
                        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerMonthCostSummary?.manual || 0)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Acumulado</div>
                        <div className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">Histórico completo del trabajador</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerCostSummary?.total || 0)}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Remuneración</div>
                        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerCostSummary?.remuneration || 0)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Previsión</div>
                        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerCostSummary?.payroll || 0)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Manual</div>
                        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{formatCLP(activeWorkerCostSummary?.manual || 0)}</div>
                      </div>
                    </div>
                    <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                      Último movimiento:{' '}
                      {activeWorkerCostSummary?.lastDate
                        ? new Date(activeWorkerCostSummary.lastDate + 'T12:00:00').toLocaleDateString('es-CL')
                        : 'Sin registros'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">Selecciona un trabajador para ver su costo consolidado.</div>
            )}
          </div>
        </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Previsión del trabajador</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Calcula aportes por ley chilena y los suma al costo total de la ficha seleccionada.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mes</label>
              <input
                type="month"
                value={payrollMonth}
                onChange={(e) => setPayrollMonth(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadPayrollRates()}
              disabled={payrollRatesLoading}
              className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 disabled:opacity-50"
            >
              <RefreshCcw className={`mr-2 h-4 w-4 ${payrollRatesLoading ? 'animate-spin' : ''}`} />
              Recargar parámetros
            </button>
          </div>
        </div>

        <div className="mt-4 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-6">
            <button
              type="button"
              onClick={() => setPayrollTab('individual')}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                payrollTab === 'individual'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
              }`}
            >
              Individual
            </button>
            <button
              type="button"
              onClick={() => setPayrollTab('masivo')}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                payrollTab === 'masivo'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
              }`}
            >
              Masivo
            </button>
            <button
              type="button"
              onClick={() => setPayrollTab('parametros')}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                payrollTab === 'parametros'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
              }`}
            >
              Parámetros
            </button>
          </nav>
        </div>

        {payrollTab !== 'parametros' && (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asignar A</label>
              <div className="mt-1 flex rounded-md shadow-sm">
                <button
                  type="button"
                  onClick={() => setPayrollDistributeBy('sector')}
                  className={`relative inline-flex items-center px-4 py-2 rounded-l-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                    payrollDistributeBy === 'sector'
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                  }`}
                >
                  Un Sector
                </button>
                <button
                  type="button"
                  onClick={() => setPayrollDistributeBy('field')}
                  className={`-ml-px relative inline-flex items-center px-4 py-2 border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                    payrollDistributeBy === 'field'
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                  }`}
                >
                  Todo un Campo
                </button>
                <button
                  type="button"
                  onClick={() => setPayrollDistributeBy('company')}
                  className={`-ml-px relative inline-flex items-center px-4 py-2 rounded-r-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                    payrollDistributeBy === 'company'
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                  }`}
                >
                  Empresa General
                </button>
              </div>
            </div>

            {payrollDistributeBy === 'sector' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sector Destino</label>
                <select
                  value={payrollSectorId}
                  onChange={(e) => setPayrollSectorId(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                >
                  <option value="">Seleccione Sector...</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : payrollDistributeBy === 'field' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Campo Destino</label>
                <select
                  value={payrollFieldId}
                  onChange={(e) => setPayrollFieldId(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                >
                  <option value="">Seleccione Campo...</option>
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Se distribuye proporcionalmente por hectárea.</p>
              </div>
            ) : (
              <div className="flex items-end">
                <div className="w-full p-2 bg-indigo-50 border border-indigo-200 rounded text-sm text-indigo-700">
                  Se distribuye proporcionalmente entre todos los campos y sectores.
                </div>
              </div>
            )}
          </div>
        )}

        {payrollTab === 'individual' && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Trabajador</label>
                <select
                  value={payrollWorkerId}
                  onChange={(e) => {
                    setPayrollWorkerId(e.target.value);
                    setWorkerWorkspaceId(e.target.value);
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                >
                  <option value="">Seleccione...</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sueldo base (CLP)</label>
                    <input
                      type="number"
                      value={payrollBaseSalary}
                      onChange={(e) => setPayrollBaseSalary(e.target.value === '' ? '' : Number(e.target.value))}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Total imponible (calculado)</label>
                    <input
                      type="number"
                      value={payrollImponibleTotal}
                      readOnly
                      className="mt-1 block w-full rounded-md border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shadow-sm sm:text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Imponible antes de gratificación</label>
                    <input
                      type="number"
                      value={payrollImponibleBeforeGratification}
                      readOnly
                      className="mt-1 block w-full rounded-md border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shadow-sm sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Gratificación legal</label>
                    <input
                      type="number"
                      value={payrollLegalGratificationAmount}
                      readOnly
                      className="mt-1 block w-full rounded-md border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shadow-sm sm:text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={payrollLegalGratificationEnabled}
                        onChange={(e) => setPayrollLegalGratificationEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Aplicar gratificación legal Art. 50
                    </label>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bonos imponibles</label>
                    <button
                      type="button"
                      onClick={() =>
                        setPayrollImponibleBonuses((prev) => [
                          ...prev,
                          { id: `bonus_${Date.now()}`, label: '', amount: '' }
                        ])
                      }
                      className="text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      Agregar bono
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {payrollImponibleBonuses.map((b) => (
                      <div key={b.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-7">
                          <input
                            type="text"
                            value={b.label}
                            onChange={(e) =>
                              setPayrollImponibleBonuses((prev) =>
                                prev.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x))
                              )
                            }
                            placeholder="Ej: Bono producción"
                            className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <input
                            type="number"
                            value={b.amount}
                            onChange={(e) =>
                              setPayrollImponibleBonuses((prev) =>
                                prev.map((x) => (x.id === b.id ? { ...x, amount: e.target.value === '' ? '' : Number(e.target.value) } : x))
                              )
                            }
                            placeholder="0"
                            className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        <div className="sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setPayrollImponibleBonuses((prev) => prev.filter((x) => x.id !== b.id))}
                            className="text-gray-400 hover:text-red-600"
                            disabled={payrollImponibleBonuses.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">No imponibles</label>
                    <button
                      type="button"
                      onClick={() =>
                        setPayrollNonImponibles((prev) => [
                          ...prev,
                          { id: `nonimp_${Date.now()}`, label: '', amount: '' }
                        ])
                      }
                      className="text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      Agregar no imponible
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {payrollNonImponibles.map((b) => (
                      <div key={b.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-7">
                          <input
                            type="text"
                            value={b.label}
                            onChange={(e) =>
                              setPayrollNonImponibles((prev) =>
                                prev.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x))
                              )
                            }
                            placeholder="Ej: Colación"
                            className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <input
                            type="number"
                            value={b.amount}
                            onChange={(e) =>
                              setPayrollNonImponibles((prev) =>
                                prev.map((x) => (x.id === b.id ? { ...x, amount: e.target.value === '' ? '' : Number(e.target.value) } : x))
                              )
                            }
                            placeholder="0"
                            className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        <div className="sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setPayrollNonImponibles((prev) => prev.filter((x) => x.id !== b.id))}
                            className="text-gray-400 hover:text-red-600"
                            disabled={payrollNonImponibles.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Los no imponibles no afectan AFP/Salud/AFC, pero sí forman parte del total pagado.
                  </p>
                </div>

                <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-800">
                  La gratificación legal Art. 50 se calcula sobre las remuneraciones imponibles del mes previas a la gratificación, con tope anual de 4,75 IMM prorrateado mensualmente.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Total no imponible</label>
                    <input
                      type="number"
                      value={payrollNonImponibleTotal}
                      readOnly
                      className="mt-1 block w-full rounded-md border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shadow-sm sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Total ganado (imponible + no imponible)</label>
                    <input
                      type="number"
                      value={payrollTotalEarned}
                      readOnly
                      className="mt-1 block w-full rounded-md border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shadow-sm sm:text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Contrato</label>
                  <select
                    value={payrollContractType}
                    onChange={(e) => setPayrollContractType(e.target.value as any)}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    <option value="indefinite">Indefinido</option>
                    <option value="fixed_term">Plazo fijo</option>
                    <option value="work">Por obra</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">AFP</label>
                  <select
                    value={payrollAfpName}
                    onChange={(e) => setPayrollAfpName(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    <option value="">Seleccione AFP...</option>
                    {afpOptions.map((afp) => (
                      <option key={afp.value} value={afp.value}>
                        {afp.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Condición previsional</div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Sirve para aplicar exenciones por edad legal, pensión, art. 69 y Seguro Social Previsional.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sexo</label>
                    <select
                      value={payrollWorkerGender}
                      onChange={(e) => setPayrollWorkerGender(e.target.value as 'male' | 'female' | 'unspecified')}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    >
                      <option value="unspecified">No especificado</option>
                      <option value="male">Hombre</option>
                      <option value="female">Mujer</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha de nacimiento</label>
                    <input
                      type="date"
                      value={payrollWorkerBirthDate}
                      onChange={(e) => setPayrollWorkerBirthDate(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={payrollWorkerIsPensioner}
                      onChange={(e) => setPayrollWorkerIsPensioner(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                    />
                    La persona ya está pensionada
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={payrollWorkerVoluntaryAfp}
                      onChange={(e) => setPayrollWorkerVoluntaryAfp(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                    />
                    Mantiene cotización AFP voluntaria
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de pensión</label>
                    <select
                      value={payrollWorkerPensionType}
                      onChange={(e) =>
                        setPayrollWorkerPensionType(
                          e.target.value as 'old_age' | 'disability_total' | 'disability_partial' | 'other'
                        )
                      }
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      disabled={!payrollWorkerIsPensioner}
                    >
                      <option value="old_age">Vejez</option>
                      <option value="disability_total">Invalidez total</option>
                      <option value="disability_partial">Invalidez parcial</option>
                      <option value="other">Otra</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={payrollWorkerArt69Exempt}
                        onChange={(e) => setPayrollWorkerArt69Exempt(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Acogida a exención art. 69
                    </label>
                  </div>
                </div>
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  AFP y SIS se eximen por edad legal o pensión de vejez/invalidez total. El Seguro Social se exime a los 65 años, por pensión de vejez/invalidez total, y en mujeres de 60 a 64 años solo si está acogida al art. 69.
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Comisión AFP (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={payrollAfpCommissionRate}
                    onChange={(e) => setPayrollAfpCommissionRate(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="0"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {payrollAfpName
                      ? `Se completa automáticamente según ${afpOptions.find((afp) => afp.value === payrollAfpName)?.label || 'la AFP seleccionada'}, pero puedes ajustarla si cambió.`
                      : 'Puedes seleccionar una AFP para completar la comisión automáticamente.'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Salud</label>
                  <select
                    value={payrollHealthType}
                    onChange={(e) => setPayrollHealthType(e.target.value as any)}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    <option value="fonasa">Fonasa</option>
                    <option value="isapre">Isapre</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Caja de Compensación</label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={payrollCcafEnabled}
                      onChange={(e) => setPayrollCcafEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                      disabled={payrollHealthType !== 'fonasa'}
                    />
                    <span className={`text-sm ${payrollHealthType !== 'fonasa' ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                      Empresa afiliada a CCAF (aplica solo si Salud = Fonasa)
                    </span>
                  </div>
                  {payrollCcafEnabled && payrollHealthType === 'fonasa' && (
                    <div className="mt-2">
                      <select
                        value={payrollCcafName}
                        onChange={(e) => setPayrollCcafName(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      >
                        {ccafOptions.map((ccaf) => (
                          <option key={ccaf.value} value={ccaf.value}>
                            {ccaf.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Se desglosa el 7% de salud en Caja (4,2%) + Fonasa (2,8%) según parámetros del mes. Por defecto queda `Los Andes`.
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Plan Isapre (CLP)</label>
                  <input
                    type="number"
                    value={payrollHealthPlanAmount}
                    onChange={(e) => setPayrollHealthPlanAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="0"
                    disabled={payrollHealthType !== 'isapre'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mutual (%)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={payrollMutualRate}
                  onChange={(e) => setPayrollMutualRate(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="0"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCalculatePayroll}
                  disabled={payrollSaving || payrollRatesLoading}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {payrollRatesLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                  Calcular
                </button>
                <button
                  type="button"
                  onClick={() => void handleRegisterPayrollIndividual()}
                  disabled={payrollSaving || !payrollResult}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  {payrollSaving ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                  Registrar previsión
                </button>
              </div>

              {Number(payrollRatesDraft.UF_CLP || 0) <= 0 && (
                <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200 text-sm text-yellow-800">
                  Falta UF para convertir topes en UF. Puedes cargarla en Parámetros.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <div className="text-sm text-gray-700 dark:text-gray-200 font-medium">Resumen</div>
                {payrollResult ? (
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Imponible antes gratificación</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollImponibleBeforeGratification)}</div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Gratificación legal</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollLegalGratificationAmount)}</div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Base AFP/Salud</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollResult.baseAfpSalud)}</div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Base Cesantía</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollResult.baseAfc)}</div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Descuentos trabajador</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollResult.workerDeductions)}</div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Aportes empleador</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollResult.employerContrib)}</div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 sm:col-span-2">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Costo total empleador (imponible + aportes)</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatCLP(payrollResult.employerTotalCost)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Edad calculada al mes</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">
                          {payrollResult.context.ageYears === null ? 'Sin dato' : `${payrollResult.context.ageYears} años`}
                        </div>
                      </div>
                      <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Reglas aplicadas</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">
                          {[
                            payrollResult.context.afpExempt ? 'AFP exenta' : 'AFP normal',
                            payrollResult.context.sisExempt ? 'SIS exento' : 'SIS normal',
                            payrollResult.context.afcExempt ? 'Cesantía exenta' : 'Cesantía normal',
                            payrollResult.context.sspExempt ? 'Seguro Social exento' : 'Seguro Social normal'
                          ].join(' · ')}
                        </div>
                      </div>
                    </div>
                    {payrollResult.notes.length > 0 && (
                      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                        {payrollResult.notes.map((note) => (
                          <div key={note}>- {note}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Completa los datos y presiona Calcular.</div>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Detalle</div>
                  {payrollResult ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Neto trabajador: {formatCLP(Number(payrollTotalEarned || 0) - payrollResult.workerDeductions)}
                    </div>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Paga</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Concepto</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tasa</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Base</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {(payrollResult?.items || []).map((i) => (
                        <tr key={`${i.payer}-${i.code}`}>
                          <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                            {i.payer === 'worker' ? 'Trabajador' : 'Empleador'}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{i.name}</td>
                          <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{Number(i.rate || 0).toFixed(2)}%</td>
                          <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(i.baseAmount)}</td>
                          <td className="px-4 py-2 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">{formatCLP(i.amount)}</td>
                        </tr>
                      ))}
                      {!payrollResult && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                            Sin cálculo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {payrollTab === 'masivo' && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Columnas sugeridas: Trabajador, SueldoBase, BonosImponibles, GratificacionLegal opcional, Imponible opcional, NoImponibles (o Colacion+Movilizacion), Contrato, Sexo, FechaNacimiento, Pensionado, TipoPension, CotizacionVoluntariaAFP, ExencionArt69, AFP, ComisionAFP, Salud, PlanSalud, Mutual
              </div>
              <label className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                Cargar Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleBulkFile(f);
                  }}
                />
              </label>
            </div>

            {bulkErrors.length > 0 && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                <div className="font-medium mb-1">Observaciones</div>
                <ul className="list-disc pl-5 space-y-1">
                  {bulkErrors.slice(0, 10).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                {bulkErrors.length > 10 && <div className="mt-2">... y {bulkErrors.length - 10} más</div>}
              </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Previsualización</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Filas válidas: {bulkRows.length} / Archivo: {bulkFileRows.length}
                </div>
              </div>
              <div className="overflow-x-auto max-h-[420px]">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Trabajador</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Base</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Bonos</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Gratificación</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Imponible</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">No imponible</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contrato</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">AFP</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Com. AFP</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Perfil legal</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Salud</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Plan</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Mutual</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {bulkRows.map((r, idx) => (
                      <tr key={`${r.workerId}-${idx}`}>
                        <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">
                          {workers.find((w) => w.id === r.workerId)?.name || r.workerId}
                        </td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(Number(r.baseSalary || 0))}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(Number(r.imponibleBonuses || 0))}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(Number(r.legalGratification || 0))}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-900 dark:text-gray-100">{formatCLP(r.grossImponible)}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(Number(r.nonImponibles || 0))}</td>
                        <td className="px-4 py-2 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">
                          {formatCLP(Number(r.grossImponible || 0) + Number(r.nonImponibles || 0))}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{r.contractType}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                          {afpOptions.find((afp) => afp.value === r.afpName)?.label || '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{Number(r.afpCommissionRate || 0).toFixed(2)}%</td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                          {[
                            r.workerBirthDate ? r.workerBirthDate : 'Sin fecha',
                            r.workerGender === 'male' ? 'H' : r.workerGender === 'female' ? 'M' : 'S/E',
                            r.workerIsPensioner ? `Pensionado: ${r.workerPensionType}` : 'No pensionado',
                            r.workerVoluntaryAfp ? 'AFP voluntaria' : null,
                            r.workerArt69Exempt ? 'Art. 69' : null
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{r.healthType}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(Number(r.healthPlanAmount || 0))}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{Number(r.mutualRate || 0).toFixed(4)}%</td>
                      </tr>
                    ))}
                    {bulkRows.length === 0 && (
                      <tr>
                        <td colSpan={14} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                          Carga un archivo para ver filas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleRegisterPayrollBulk()}
                disabled={payrollSaving || bulkRows.length === 0}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                {payrollSaving ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Registrar masivo
              </button>
            </div>
          </div>
        )}

        {payrollTab === 'parametros' && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Parámetros del mes</div>
                <button
                  type="button"
                  onClick={() => void handleSavePayrollRatesDraft()}
                  disabled={payrollRatesLoading}
                  className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Código</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Nombre</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {payrollRateFields.map((f: any) => (
                      <tr key={f.code}>
                        <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{f.code}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{f.name}</td>
                        <td className="px-4 py-2 text-sm text-right">
                          <input
                            type="number"
                            step={f.code === 'UF_CLP' ? '1' : f.kind === 'rate' ? '0.0001' : '0.01'}
                            value={(payrollRatesDraft as any)[f.code] ?? ''}
                            onChange={(e) =>
                              setPayrollRatesDraft((prev) => ({
                                ...prev,
                                [f.code]: e.target.value === '' ? 0 : Number(e.target.value)
                              }))
                            }
                            className="w-40 text-right rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </td>
                      </tr>
                    ))}
                    {payrollRateFields.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                          Sin parámetros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Buscar actualización</div>
                  <button
                    type="button"
                    onClick={() => void handleScanPayrollRates()}
                    disabled={scanLoading}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 disabled:opacity-50"
                  >
                    {scanLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                    Buscar
                  </button>
                </div>

                {scanResult ? (
                  <div className="mt-3 space-y-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Fuentes: {(scanResult.sources || []).length}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Código</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Nombre</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {(scanResult.items || []).map((i: any) => (
                            <tr key={String(i.code || '')}>
                              <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{String(i.code || '')}</td>
                              <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{String(i.name || '')}</td>
                              <td className="px-3 py-2 text-sm text-right text-gray-900 dark:text-gray-100">{Number(i.value || 0)}</td>
                            </tr>
                          ))}
                          {(scanResult.items || []).length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                                Sin ítems detectados.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setScanResult(null)}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                      >
                        Cerrar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateProposalFromScan()}
                        className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                      >
                        Crear propuesta
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Busca en internet y genera una propuesta para aprobar.</div>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Propuestas</div>
                  <button
                    type="button"
                    onClick={() => void loadPayrollProposals()}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                  >
                    Recargar
                  </button>
                </div>
                <div className="overflow-x-auto max-h-[340px]">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Mes</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Estado</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ítems</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {payrollProposals
                        .filter((p: any) => String(p.status || '') === 'proposed')
                        .map((p: any) => (
                          <tr key={p.id}>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{String(p.effective_from || '')}</td>
                            <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{String(p.status || '')}</td>
                            <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">
                              {Array.isArray(p.proposed_items) ? p.proposed_items.length : 0}
                            </td>
                            <td className="px-4 py-2 text-sm text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleApplyProposal(p)}
                                  className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                                >
                                  Aplicar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDismissProposal(p)}
                                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                                >
                                  Descartar
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      {payrollProposals.filter((p: any) => String(p.status || '') === 'proposed').length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                            Sin propuestas pendientes.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
          )}
        </div>
      </div>

      {workersMainTab === 'costos' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Cost Registration Form */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4 border-b pb-2">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                    <Users className="h-5 w-5 mr-2 text-indigo-500" />
                    Registrar costo manual
                </h3>
                <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Jornal</span>
                    <button
                        type="button"
                        onClick={() => setIsPieceRate(!isPieceRate)}
                        className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isPieceRate ? 'bg-indigo-600' : 'bg-gray-200'}`}
                    >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-800 shadow ring-0 transition duration-200 ease-in-out ${isPieceRate ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                    <span className="text-xs text-indigo-600 font-bold">Trato</span>
                </div>
            </div>

            <form onSubmit={handleSaveCost} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha</label>
                    <input 
                        type="date" 
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                </div>

                {!isPieceRate ? (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Trabajador Fijo</label>
                            <select
                                value={selectedWorkerId}
                                onChange={e => {
                                  setSelectedWorkerId(e.target.value);
                                  setWorkerWorkspaceId(e.target.value);
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            >
                                <option value="">Seleccione...</option>
                                {workers.map(w => (
                                    <option key={w.id} value={w.id}>{w.name} ({w.role})</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción</label>
                            <input
                                type="text"
                                placeholder="Ej: Sueldo Enero 2026"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del Contratista / Trabajador</label>
                            <input
                                type="text"
                                placeholder="Ej: Cuadrilla Juan Pérez"
                                value={workerName}
                                onChange={e => setWorkerName(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Labor / Tipo de Trato</label>
                            <input
                                type="text"
                                placeholder="Ej: Cosecha de Pera"
                                value={laborType}
                                onChange={e => setLaborType(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Cantidad</label>
                                <input
                                    type="number"
                                    placeholder="Ej: 50"
                                    value={pieceQuantity}
                                    onChange={e => setPieceQuantity(Number(e.target.value))}
                                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Precio x Unidad</label>
                                <input
                                    type="number"
                                    placeholder="Ej: 500"
                                    value={piecePrice}
                                    onChange={e => setPiecePrice(Number(e.target.value))}
                                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>
                        </div>
                    </>
                )}
                
                {/* Distribution Logic */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asignar A</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <button
                            type="button"
                            onClick={() => setDistributeBy('sector')}
                            className={`relative inline-flex items-center px-4 py-2 rounded-l-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'sector'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                            }`}
                        >
                            Un Sector
                        </button>
                        <button
                            type="button"
                            onClick={() => setDistributeBy('field')}
                            className={`-ml-px relative inline-flex items-center px-4 py-2 border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'field'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                            }`}
                        >
                            Todo un Campo
                        </button>
                        <button
                            type="button"
                            onClick={() => setDistributeBy('company')}
                            className={`-ml-px relative inline-flex items-center px-4 py-2 rounded-r-md border text-sm font-medium focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
                                distributeBy === 'company'
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900'
                            }`}
                        >
                            Empresa General
                        </button>
                    </div>
                </div>

                {distributeBy === 'sector' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sector Destino</label>
                        <select
                            value={selectedSectorId}
                            onChange={e => setSelectedSectorId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="">Seleccione Sector...</option>
                            {sectors.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                ) : distributeBy === 'field' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Campo Destino</label>
                        <select
                            value={selectedFieldId}
                            onChange={e => setSelectedFieldId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                            <option value="">Seleccione Campo...</option>
                            {fields.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">El costo se distribuirá proporcionalmente por hectárea.</p>
                    </div>
                ) : (
                    <div>
                        <div className="p-2 bg-indigo-50 border border-indigo-200 rounded text-sm text-indigo-700">
                            El costo se distribuirá proporcionalmente entre <strong>TODOS</strong> los campos y sectores de la empresa.
                        </div>
                    </div>
                )}

                {!isPieceRate && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Monto Total (CLP)</label>
                        <div className="mt-1 relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <span className="text-gray-500 dark:text-gray-400 sm:text-sm">$</span>
                            </div>
                            <input
                                type="number"
                                value={amount}
                                onChange={e => setAmount(Number(e.target.value))}
                                className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-7 pr-12 sm:text-sm border-gray-300 dark:border-gray-600 rounded-md"
                                placeholder="0"
                            />
                        </div>
                    </div>
                )}

                <div className="pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Registrar Costo'}
                    </button>
                </div>
            </form>
        </div>

        {/* Right: History Log */}
        <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Historial del trabajador</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {activeWorker ? `${activeWorker.name} (${activeWorker.role || 'Sin cargo'})` : 'Sin trabajador seleccionado'}
                        </p>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        Total acumulado: {formatCLP(activeWorkerCostSummary?.total || 0)}
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[600px]">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Trabajador</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Descripción</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Sector</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monto</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {activeWorkerCosts.map(cost => (
                                <tr key={cost.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {new Date(cost.date + 'T12:00:00').toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {cost.is_piece_rate ? (
                                            <div className="flex flex-col">
                                                <span>{cost.worker_name} <span className="text-xs font-normal text-indigo-600">(Trato)</span></span>
                                            </div>
                                        ) : (
                                            cost.workers?.name
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {cost.description}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {cost.sectors?.name || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100 font-bold">
                                        {formatCLP(cost.amount)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => handleDeleteCost(cost.id)} className="text-red-600 hover:text-red-900">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {activeWorkerCosts.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">No hay registros para este trabajador.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
        </div>
      </div>
      )}

      {showWorkerForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowWorkerForm(false)} />
          <div className="relative w-full max-w-3xl bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {editingWorkerId ? 'Editar Trabajador' : 'Agregar Trabajador'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  resetWorkerForm();
                  setShowWorkerForm(false);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <form onSubmit={handleCreateWorker} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={newWorkerName}
                      onChange={(e) => setNewWorkerName(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Cargo / Rol</label>
                    <input
                      type="text"
                      value={newWorkerRole}
                      onChange={(e) => setNewWorkerRole(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha de nacimiento</label>
                    <input
                      type="date"
                      value={newWorkerBirthDate}
                      onChange={(e) => setNewWorkerBirthDate(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sexo</label>
                    <select
                      value={newWorkerGender}
                      onChange={(e) => setNewWorkerGender(e.target.value as 'male' | 'female' | 'unspecified')}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    >
                      <option value="unspecified">No especificado</option>
                      <option value="male">Hombre</option>
                      <option value="female">Mujer</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Perfil previsional base</div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Estos datos se usarán para autocompletar la previsión mensual al seleccionar el trabajador.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={newWorkerIsPensioner}
                        onChange={(e) => setNewWorkerIsPensioner(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Está pensionado/a
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={newWorkerVoluntaryAfp}
                        onChange={(e) => setNewWorkerVoluntaryAfp(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Mantiene AFP voluntaria
                    </label>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de pensión</label>
                      <select
                        value={newWorkerPensionType}
                        onChange={(e) =>
                          setNewWorkerPensionType(e.target.value as 'old_age' | 'disability_total' | 'disability_partial' | 'other')
                        }
                        disabled={!newWorkerIsPensioner}
                        className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      >
                        <option value="old_age">Vejez</option>
                        <option value="disability_total">Invalidez total</option>
                        <option value="disability_partial">Invalidez parcial</option>
                        <option value="other">Otra</option>
                      </select>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 md:items-end">
                      <input
                        type="checkbox"
                        checked={newWorkerArt69Exempt}
                        onChange={(e) => setNewWorkerArt69Exempt(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Acogido/a a exención art. 69
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                    {editingWorkerId ? 'Guardar cambios' : 'Guardar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetWorkerForm();
                      setShowWorkerForm(false);
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
