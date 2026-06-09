export type PayrollRate = {
  code: string;
  value: number;
};

export type PayrollInput = {
  month: string;
  grossImponible: number;
  contractType: 'indefinite' | 'fixed_term' | 'work';
  afpCommissionRate: number;
  healthType: 'fonasa' | 'isapre';
  healthPlanAmount: number;
  mutualRate: number;
  ccafEnabled?: boolean;
  ccafName?: string;
};

export type PayrollItem = {
  payer: 'worker' | 'employer';
  code: string;
  name: string;
  rate: number;
  baseAmount: number;
  amount: number;
  sortOrder: number;
};

export type PayrollResult = {
  baseAfpSalud: number;
  baseAfc: number;
  workerDeductions: number;
  employerContrib: number;
  employerTotalCost: number;
  items: PayrollItem[];
};

const roundCLP = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 1) / 1;

const getRate = (rates: Record<string, number>, code: string, fallback: number) => {
  const v = rates[code];
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : fallback;
};

const getCapClp = (rates: Record<string, number>, capUfCode: string, ufClpCode: string) => {
  const capUf = Number(rates[capUfCode] || 0);
  const ufClp = Number(rates[ufClpCode] || 0);
  if (!Number.isFinite(capUf) || !Number.isFinite(ufClp) || capUf <= 0 || ufClp <= 0) return null;
  return capUf * ufClp;
};

export function calculatePayrollChile(params: { input: PayrollInput; rates: Record<string, number> }): PayrollResult {
  const gross = Math.max(0, Number(params.input.grossImponible || 0));
  const rates = params.rates || {};

  const capAfpClp = getCapClp(rates, 'TOPE_AFP_UF', 'UF_CLP');
  const capAfcClp = getCapClp(rates, 'TOPE_AFC_UF', 'UF_CLP');

  const baseAfpSalud = roundCLP(capAfpClp ? Math.min(gross, capAfpClp) : gross);
  const baseAfc = roundCLP(capAfcClp ? Math.min(gross, capAfcClp) : gross);

  const afpMandatoryRate = getRate(rates, 'AFP_MANDATORY_RATE', 10);
  const healthRate = params.input.healthType === 'fonasa' ? getRate(rates, 'SALUD_FONASA_RATE', 7) : getRate(rates, 'SALUD_ISAPRE_MIN_RATE', 7);
  const ccafRate = getRate(rates, 'SALUD_CCAF_RATE', 4.2);
  const ccafFonasaRate = getRate(rates, 'SALUD_CCAF_FONASA_RATE', 2.8);

  const afcWorkerRate =
    params.input.contractType === 'indefinite' ? getRate(rates, 'AFC_WORKER_INDEF_RATE', 0.6) : getRate(rates, 'AFC_WORKER_FIXED_RATE', 0);
  const afcEmployerRate =
    params.input.contractType === 'indefinite' ? getRate(rates, 'AFC_EMP_INDEF_RATE', 2.4) : getRate(rates, 'AFC_EMP_FIXED_RATE', 3);

  const sisEmployerRate = getRate(rates, 'SIS_EMP_RATE', 0);
  const sannaEmployerRate = getRate(rates, 'SANNA_EMP_RATE', 0);
  const reformaEmployerRate = getRate(rates, 'REFORMA_EMP_RATE', 0);

  const mutualRate = Number.isFinite(Number(params.input.mutualRate)) ? Number(params.input.mutualRate) : getRate(rates, 'MUTUAL_EMP_RATE', 0);

  const items: PayrollItem[] = [];

  const afp10 = roundCLP((baseAfpSalud * afpMandatoryRate) / 100);
  items.push({ payer: 'worker', code: 'AFP_MANDATORY', name: 'AFP 10%', rate: afpMandatoryRate, baseAmount: baseAfpSalud, amount: afp10, sortOrder: 10 });

  const afpCommission = roundCLP((baseAfpSalud * Math.max(0, Number(params.input.afpCommissionRate || 0))) / 100);
  if (afpCommission > 0) {
    items.push({
      payer: 'worker',
      code: 'AFP_COMMISSION',
      name: 'Comisión AFP',
      rate: Math.max(0, Number(params.input.afpCommissionRate || 0)),
      baseAmount: baseAfpSalud,
      amount: afpCommission,
      sortOrder: 11
    });
  }

  const saludBaseAmount = roundCLP((baseAfpSalud * healthRate) / 100);
  const salud = params.input.healthType === 'isapre' ? roundCLP(Math.max(saludBaseAmount, Number(params.input.healthPlanAmount || 0))) : saludBaseAmount;

  const useCcaf =
    params.input.healthType === 'fonasa' &&
    Boolean(params.input.ccafEnabled) &&
    ccafRate > 0 &&
    ccafFonasaRate > 0 &&
    Math.abs(ccafRate + ccafFonasaRate - healthRate) < 0.001;

  if (useCcaf) {
    const ccafAmount = roundCLP((baseAfpSalud * ccafRate) / 100);
    const fonasaAmount = roundCLP((baseAfpSalud * ccafFonasaRate) / 100);
    const nameSuffix = params.input.ccafName ? ` (${params.input.ccafName})` : '';
    items.push({
      payer: 'worker',
      code: 'SALUD_CCAF',
      name: `Caja de Compensación${nameSuffix}`,
      rate: ccafRate,
      baseAmount: baseAfpSalud,
      amount: ccafAmount,
      sortOrder: 20
    });
    items.push({
      payer: 'worker',
      code: 'SALUD_FONASA',
      name: 'Fonasa',
      rate: ccafFonasaRate,
      baseAmount: baseAfpSalud,
      amount: fonasaAmount,
      sortOrder: 21
    });
  } else {
    items.push({
      payer: 'worker',
      code: 'SALUD',
      name: params.input.healthType === 'isapre' ? 'Salud (Isapre)' : 'Salud (Fonasa)',
      rate: healthRate,
      baseAmount: baseAfpSalud,
      amount: salud,
      sortOrder: 20
    });
  }

  const afcWorker = roundCLP((baseAfc * afcWorkerRate) / 100);
  if (afcWorkerRate > 0) {
    items.push({ payer: 'worker', code: 'AFC_WORKER', name: 'Seguro Cesantía (Trabajador)', rate: afcWorkerRate, baseAmount: baseAfc, amount: afcWorker, sortOrder: 30 });
  }

  const sisEmployer = roundCLP((baseAfpSalud * sisEmployerRate) / 100);
  if (sisEmployerRate > 0) {
    items.push({ payer: 'employer', code: 'SIS_EMP', name: 'SIS (Empleador)', rate: sisEmployerRate, baseAmount: baseAfpSalud, amount: sisEmployer, sortOrder: 110 });
  }

  const afcEmployer = roundCLP((baseAfc * afcEmployerRate) / 100);
  if (afcEmployerRate > 0) {
    items.push({ payer: 'employer', code: 'AFC_EMP', name: 'Seguro Cesantía (Empleador)', rate: afcEmployerRate, baseAmount: baseAfc, amount: afcEmployer, sortOrder: 120 });
  }

  const mutual = roundCLP((baseAfpSalud * Math.max(0, mutualRate)) / 100);
  if (mutualRate > 0) {
    items.push({ payer: 'employer', code: 'MUTUAL_EMP', name: 'Mutual (Ley 16.744)', rate: Math.max(0, mutualRate), baseAmount: baseAfpSalud, amount: mutual, sortOrder: 130 });
  }

  const sannaEmployer = roundCLP((baseAfpSalud * sannaEmployerRate) / 100);
  if (sannaEmployerRate > 0) {
    items.push({ payer: 'employer', code: 'SANNA_EMP', name: 'Ley SANNA (Empleador)', rate: sannaEmployerRate, baseAmount: baseAfpSalud, amount: sannaEmployer, sortOrder: 140 });
  }

  const reformaEmployer = roundCLP((baseAfpSalud * reformaEmployerRate) / 100);
  if (reformaEmployerRate > 0) {
    items.push({ payer: 'employer', code: 'REFORMA_EMP', name: 'Reforma Previsional (Empleador)', rate: reformaEmployerRate, baseAmount: baseAfpSalud, amount: reformaEmployer, sortOrder: 150 });
  }

  const workerDeductions = roundCLP(items.filter((i) => i.payer === 'worker').reduce((sum, i) => sum + i.amount, 0));
  const employerContrib = roundCLP(items.filter((i) => i.payer === 'employer').reduce((sum, i) => sum + i.amount, 0));
  const employerTotalCost = roundCLP(gross + employerContrib);

  return {
    baseAfpSalud,
    baseAfc,
    workerDeductions,
    employerContrib,
    employerTotalCost,
    items: items.sort((a, b) => a.sortOrder - b.sortOrder)
  };
}
