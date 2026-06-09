import { toast } from 'sonner';
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useCompany } from '../contexts/CompanyContext';
import { formatCLP } from '../lib/utils';
import { Users, UserPlus, Trash2, Briefcase, Loader2, Download, RefreshCcw, Upload } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fetchCompanyFieldsBasic, fetchCompanySectorsBasic } from '../services/companyStructure';
import { createWorker, deleteWorker, deleteWorkerCost, fetchWorkerCosts, fetchWorkers, insertWorkerCosts } from '../services/workers';
import { calculatePayrollChile } from '../lib/payrollChile';
import { importXlsxToJson } from '../lib/excel';
import { createPayrollRateProposal, createWorkerPayrollRun, fetchPayrollRateProposals, fetchPayrollRatesForMonth, updatePayrollRateProposalStatus, upsertPayrollRates } from '../services/payroll';

interface Worker {
  id: string;
  name: string;
  role: string;
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

export const Workers: React.FC = () => {
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [costs, setCosts] = useState<WorkerCost[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  
  // Worker Form State
  const [showWorkerForm, setShowWorkerForm] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerRole, setNewWorkerRole] = useState('');

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
  const [payrollGrossImponible, setPayrollGrossImponible] = useState<number | ''>('');
  const [payrollContractType, setPayrollContractType] = useState<'indefinite' | 'fixed_term' | 'work'>('indefinite');
  const [payrollAfpName, setPayrollAfpName] = useState('');
  const [payrollAfpCommissionRate, setPayrollAfpCommissionRate] = useState<number | ''>('');
  const [payrollHealthType, setPayrollHealthType] = useState<'fonasa' | 'isapre'>('fonasa');
  const [payrollHealthPlanAmount, setPayrollHealthPlanAmount] = useState<number | ''>('');
  const [payrollMutualRate, setPayrollMutualRate] = useState<number | ''>('');
  const [payrollResult, setPayrollResult] = useState<ReturnType<typeof calculatePayrollChile> | null>(null);
  const [payrollSaving, setPayrollSaving] = useState(false);

  const [payrollRatesDraft, setPayrollRatesDraft] = useState<Record<string, number>>({});
  const [payrollRatesLoading, setPayrollRatesLoading] = useState(false);

  const [payrollProposals, setPayrollProposals] = useState<any[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const [bulkFileRows, setBulkFileRows] = useState<Array<Record<string, unknown>>>([]);
  const [bulkRows, setBulkRows] = useState<Array<{ workerId: string; grossImponible: number; contractType: 'indefinite' | 'fixed_term' | 'work'; afpName: string; afpCommissionRate: number; healthType: 'fonasa' | 'isapre'; healthPlanAmount: number; mutualRate: number }>>([]);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

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

  const defaultPayrollRates = useMemo(
    () => ({
      AFP_MANDATORY_RATE: 10,
      SALUD_FONASA_RATE: 7,
      SALUD_ISAPRE_MIN_RATE: 7,
      AFC_WORKER_INDEF_RATE: 0.6,
      AFC_EMP_INDEF_RATE: 2.4,
      AFC_WORKER_FIXED_RATE: 0,
      AFC_EMP_FIXED_RATE: 3,
      REFORMA_EMP_RATE: 0,
      AFP_CAPITAL_COMMISSION_RATE: 1.44,
      AFP_CUPRUM_COMMISSION_RATE: 1.44,
      AFP_HABITAT_COMMISSION_RATE: 1.27,
      AFP_MODELO_COMMISSION_RATE: 0.58,
      AFP_PLANVITAL_COMMISSION_RATE: 1.16,
      AFP_PROVIDA_COMMISSION_RATE: 1.45,
      AFP_UNO_COMMISSION_RATE: 0.46
    }),
    []
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
          await createWorker({ companyId: selectedCompany.id, name: newWorkerName, role: newWorkerRole });
          
          setNewWorkerName('');
          setNewWorkerRole('');
          setShowWorkerForm(false);
          loadWorkers();
      } catch (error: any) {
          toast.error('Error: ' + error.message);
      } finally {
          setLoading(false);
      }
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
      { code: 'UF_CLP', name: 'UF (CLP)', kind: 'amount', payer: 'system' },
      { code: 'TOPE_AFP_UF', name: 'Tope AFP/Salud (UF)', kind: 'cap_uf', payer: 'system' },
      { code: 'TOPE_AFC_UF', name: 'Tope Cesantía (UF)', kind: 'cap_uf', payer: 'system' },
      { code: 'SIS_EMP_RATE', name: 'SIS (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'SANNA_EMP_RATE', name: 'SANNA (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'MUTUAL_EMP_RATE', name: 'Mutual (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'REFORMA_EMP_RATE', name: 'Reforma (Empleador) %', kind: 'rate', payer: 'employer' },
      { code: 'AFC_WORKER_INDEF_RATE', name: 'AFC Trabajador indefinido %', kind: 'rate', payer: 'worker' },
      { code: 'AFC_EMP_INDEF_RATE', name: 'AFC Empleador indefinido %', kind: 'rate', payer: 'employer' },
      { code: 'AFC_WORKER_FIXED_RATE', name: 'AFC Trabajador plazo fijo/obra %', kind: 'rate', payer: 'worker' },
      { code: 'AFC_EMP_FIXED_RATE', name: 'AFC Empleador plazo fijo/obra %', kind: 'rate', payer: 'employer' },
      { code: 'AFP_MANDATORY_RATE', name: 'AFP Obligatoria %', kind: 'rate', payer: 'worker' },
      { code: 'SALUD_FONASA_RATE', name: 'Salud Fonasa %', kind: 'rate', payer: 'worker' },
      { code: 'SALUD_ISAPRE_MIN_RATE', name: 'Salud Isapre mín. %', kind: 'rate', payer: 'worker' },
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
    if (payrollMutualRate !== '') return;
    const v = Number(payrollRatesDraft.MUTUAL_EMP_RATE || 0);
    if (!Number.isFinite(v) || v <= 0) return;
    setPayrollMutualRate(v);
  }, [payrollMutualRate, payrollRatesDraft.MUTUAL_EMP_RATE]);

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
    const gross = Number(payrollGrossImponible || 0);
    if (!payrollWorkerId || gross <= 0) {
      toast('Seleccione trabajador y sueldo imponible');
      return;
    }
    const result = calculatePayrollChile({
      input: {
        month: payrollMonthStart,
        grossImponible: gross,
        contractType: payrollContractType,
        afpCommissionRate: Number(payrollAfpCommissionRate || 0),
        healthType: payrollHealthType,
        healthPlanAmount: Number(payrollHealthPlanAmount || 0),
        mutualRate: Number(payrollMutualRate || 0)
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

    const gross = Number(payrollGrossImponible || 0);
    if (!payrollWorkerId || gross <= 0) return;

    setPayrollSaving(true);
    try {
      const date = payrollMonthStart;
      const monthLabel = payrollMonth;
      const rowsToInsert: any[] = [];

      rowsToInsert.push(
        ...buildDistributedWorkerCostRows({
          workerId: payrollWorkerId,
          date,
          description: `Sueldo Imponible ${monthLabel}`,
          amount: gross
        })
      );

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
          mutual_rate: Number(payrollMutualRate || 0)
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
        const gross = Number((r as any).Imponible ?? (r as any).imponible ?? 0);
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
          errors.push(`Fila ${idx + 2}: imponible inválido`);
          return;
        }

        const contractType = parseContractType((r as any).Contrato ?? (r as any).contrato ?? '');
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

        out.push({
          workerId,
          grossImponible: gross,
          contractType,
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
            afpCommissionRate: row.afpCommissionRate,
            healthType: row.healthType,
            healthPlanAmount: row.healthPlanAmount,
            mutualRate: row.mutualRate
          },
          rates: payrollRatesDraft
        });

        costsRows.push(
          ...buildDistributedWorkerCostRows({
            workerId: row.workerId,
            date,
            description: `Sueldo Imponible ${monthLabel}`,
            amount: row.grossImponible
          })
        );

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
            mutual_rate: row.mutualRate
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
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
                <Briefcase className="mr-2 h-8 w-8 text-indigo-600" />
                Trabajadores de Planta
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gestión de personal fijo y sus costos</p>
        </div>
        <div className="flex gap-2">
            <button
                onClick={generatePayrollPDF}
                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Download className="mr-2 h-5 w-5" />
                Planilla Pagos PDF
            </button>
            <button
                onClick={() => setShowWorkerForm(!showWorkerForm)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
                <UserPlus className="mr-2 h-5 w-5" />
                Nuevo Trabajador
            </button>
        </div>
      </div>

      {/* New Worker Form Modal/Inline */}
      {showWorkerForm && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-indigo-100">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Agregar Trabajador</h3>
              <form onSubmit={handleCreateWorker} className="flex gap-4 items-end">
                  <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre Completo</label>
                      <input
                          type="text"
                          required
                          value={newWorkerName}
                          onChange={e => setNewWorkerName(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                  </div>
                  <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Cargo / Rol</label>
                      <input
                          type="text"
                          value={newWorkerRole}
                          onChange={e => setNewWorkerRole(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                  </div>
                  <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                      Guardar
                  </button>
                  <button
                      type="button"
                      onClick={() => setShowWorkerForm(false)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                  >
                      Cancelar
                  </button>
              </form>
          </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Previsión (Chile)</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Calcula aportes por ley chilena y registra los costos del empleador en líneas separadas.
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
                  onChange={(e) => setPayrollWorkerId(e.target.value)}
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

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sueldo imponible (CLP)</label>
                <input
                  type="number"
                  value={payrollGrossImponible}
                  onChange={(e) => setPayrollGrossImponible(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="0"
                />
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
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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
                ) : (
                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Completa los datos y presiona Calcular.</div>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden border border-gray-200 dark:border-gray-700">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Detalle</div>
                  {payrollResult ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Neto trabajador: {formatCLP(Number(payrollGrossImponible || 0) - payrollResult.workerDeductions)}
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
                Columnas sugeridas: Trabajador, Imponible, Contrato, AFP, ComisionAFP, Salud, PlanSalud, Mutual
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
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Imponible</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contrato</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">AFP</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Com. AFP</th>
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
                        <td className="px-4 py-2 text-sm text-right text-gray-900 dark:text-gray-100">{formatCLP(r.grossImponible)}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{r.contractType}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                          {afpOptions.find((afp) => afp.value === r.afpName)?.label || '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{Number(r.afpCommissionRate || 0).toFixed(2)}%</td>
                        <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{r.healthType}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{formatCLP(Number(r.healthPlanAmount || 0))}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">{Number(r.mutualRate || 0).toFixed(4)}%</td>
                      </tr>
                    ))}
                    {bulkRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Cost Registration Form */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4 border-b pb-2">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                    <Users className="h-5 w-5 mr-2 text-indigo-500" />
                    Registrar Costo
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
                                onChange={e => setSelectedWorkerId(e.target.value)}
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
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Historial de Pagos</h3>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        Total Mostrado: {formatCLP(costs.reduce((sum, c) => sum + Number(c.amount), 0))}
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
                            {costs.map(cost => (
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
                            {costs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">No hay registros de costos.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {/* Workers List Mini */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Personal Registrado</h3>
                </div>
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {workers.map(w => (
                        <li key={w.id} className="px-6 py-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{w.name}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{w.role}</p>
                            </div>
                            <button onClick={() => handleDeleteWorker(w.id)} className="text-gray-400 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {workers.length === 0 && (
                        <li className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">No hay trabajadores registrados.</li>
                    )}
                </ul>
            </div>
        </div>
      </div>
    </div>
  );
};
