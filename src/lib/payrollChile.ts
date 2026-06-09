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
  workerBirthDate?: string | null;
  workerGender?: 'male' | 'female' | 'unspecified';
  workerIsPensioner?: boolean;
  workerPensionType?: 'old_age' | 'disability_total' | 'disability_partial' | 'other';
  workerVoluntaryAfpAfterLegalAge?: boolean;
  workerArt69Exempt?: boolean;
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
  notes: string[];
  context: {
    ageYears: number | null;
    legalRetirementAgeReached: boolean;
    afpExempt: boolean;
    sisExempt: boolean;
    afcExempt: boolean;
    sspExempt: boolean;
  };
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

const getMonthEnd = (month: string) => {
  const safe = `${String(month || '').slice(0, 7)}-01`;
  const date = new Date(`${safe}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0);
};

const getAgeOnMonth = (birthDate: string | null | undefined, month: string) => {
  if (!birthDate) return null;
  const birth = new Date(`${String(birthDate).slice(0, 10)}T12:00:00`);
  const ref = getMonthEnd(month);
  if (Number.isNaN(birth.getTime()) || !ref) return null;
  let age = ref.getFullYear() - birth.getFullYear();
  const hadBirthday =
    ref.getMonth() > birth.getMonth() || (ref.getMonth() === birth.getMonth() && ref.getDate() >= birth.getDate());
  if (!hadBirthday) age -= 1;
  return age >= 0 ? age : null;
};

const isPensionType = (
  pensionType: PayrollInput['workerPensionType'],
  expected: NonNullable<PayrollInput['workerPensionType']>
) => String(pensionType || '').trim() === expected;

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
  const afcEmployerCicRate =
    params.input.contractType === 'indefinite'
      ? getRate(rates, 'AFC_EMP_CIC_INDEF_RATE', 1.6)
      : getRate(rates, 'AFC_EMP_CIC_FIXED_RATE', 2.8);
  const afcEmployerFcsRate =
    params.input.contractType === 'indefinite'
      ? getRate(rates, 'AFC_EMP_FCS_INDEF_RATE', 0.8)
      : getRate(rates, 'AFC_EMP_FCS_FIXED_RATE', 0.2);
  const afcEmployerLegacyRate =
    params.input.contractType === 'indefinite' ? getRate(rates, 'AFC_EMP_INDEF_RATE', 2.4) : getRate(rates, 'AFC_EMP_FIXED_RATE', 3);

  const sisEmployerRate = getRate(rates, 'SIS_EMP_RATE', 0);
  const sannaEmployerRate = getRate(rates, 'SANNA_EMP_RATE', 0);
  const seguroSocialEmployerRate = getRate(rates, 'SEGURO_SOCIAL_EMP_RATE', 0);
  const seguroSocialAfpEmployerRate = getRate(rates, 'SEGURO_SOCIAL_AFP_EMP_RATE', 0);
  const crpEmployerRate = getRate(rates, 'CRP_EMP_RATE', 0);
  const reformaEmployerRate = getRate(rates, 'REFORMA_EMP_RATE', 0);

  const mutualRate = Number.isFinite(Number(params.input.mutualRate)) ? Number(params.input.mutualRate) : getRate(rates, 'MUTUAL_EMP_RATE', 0);

  const ageYears = getAgeOnMonth(params.input.workerBirthDate, params.input.month);
  const gender = params.input.workerGender || 'unspecified';
  const isPensioner = Boolean(params.input.workerIsPensioner);
  const pensionType = params.input.workerPensionType;
  const voluntaryAfpAfterLegalAge = Boolean(params.input.workerVoluntaryAfpAfterLegalAge);
  const art69Exempt = Boolean(params.input.workerArt69Exempt);
  const legalRetirementAgeReached =
    ageYears !== null && ((gender === 'male' && ageYears >= 65) || (gender === 'female' && ageYears >= 60));
  const afpExemptByLaw =
    legalRetirementAgeReached || (isPensioner && (isPensionType(pensionType, 'old_age') || isPensionType(pensionType, 'disability_total')));
  const afpExempt = afpExemptByLaw && !voluntaryAfpAfterLegalAge;
  const sisExempt = afpExempt;
  const afcExempt = isPensioner;
  const sspExempt =
    (ageYears !== null && ageYears >= 65) ||
    (isPensioner && (isPensionType(pensionType, 'old_age') || isPensionType(pensionType, 'disability_total'))) ||
    (gender === 'female' && ageYears !== null && ageYears >= 60 && art69Exempt && !voluntaryAfpAfterLegalAge);

  const notes: string[] = [];
  if (afpExempt) {
    notes.push('Se aplica exención previsional: no se calculan AFP obligatoria ni comisión AFP por edad legal o pensión de vejez/invalidez total.');
  }
  if (sisEmployerRate > 0 && sisExempt) {
    notes.push('SIS exento para el empleador por la misma exención legal de pensiones.');
  }
  if ((seguroSocialEmployerRate > 0 || seguroSocialAfpEmployerRate > 0 || crpEmployerRate > 0) && sspExempt) {
    notes.push('Seguro Social Previsional exento por edad o pensión, según reglas vigentes informadas por ChileAtiende.');
  }
  if ((afcWorkerRate > 0 || afcEmployerLegacyRate > 0 || afcEmployerCicRate > 0 || afcEmployerFcsRate > 0) && afcExempt) {
    notes.push('Seguro de Cesantía exento por condición de pensionado/a.');
  }
  if (gender === 'female' && ageYears !== null && ageYears >= 60 && ageYears < 65 && !isPensioner && !art69Exempt) {
    notes.push('Trabajadora entre 60 y 64 años: el Seguro Social sigue aplicando salvo que esté acogida a exención del art. 69 y no mantenga cotización voluntaria.');
  }
  if (afpExemptByLaw && voluntaryAfpAfterLegalAge) {
    notes.push('Se mantiene cotización AFP voluntaria luego de la edad legal, por lo que AFP y comisión siguen calculándose.');
  }

  const items: PayrollItem[] = [];

  const afp10 = roundCLP((baseAfpSalud * afpMandatoryRate) / 100);
  if (!afpExempt) {
    items.push({ payer: 'worker', code: 'AFP_MANDATORY', name: 'AFP 10%', rate: afpMandatoryRate, baseAmount: baseAfpSalud, amount: afp10, sortOrder: 10 });
  }

  const afpCommission = roundCLP((baseAfpSalud * Math.max(0, Number(params.input.afpCommissionRate || 0))) / 100);
  if (!afpExempt && afpCommission > 0) {
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
  if (!afcExempt && afcWorkerRate > 0) {
    items.push({
      payer: 'worker',
      code: 'AFC_WORKER',
      name: 'Seguro Cesantía CIC (Trabajador)',
      rate: afcWorkerRate,
      baseAmount: baseAfc,
      amount: afcWorker,
      sortOrder: 30
    });
  }

  const sisEmployer = roundCLP((baseAfpSalud * sisEmployerRate) / 100);
  if (!sisExempt && sisEmployerRate > 0) {
    items.push({ payer: 'employer', code: 'SIS_EMP', name: 'SIS (Empleador)', rate: sisEmployerRate, baseAmount: baseAfpSalud, amount: sisEmployer, sortOrder: 110 });
  }

  if (!afcExempt) {
    const afcEmployerCic = roundCLP((baseAfc * afcEmployerCicRate) / 100);
    const afcEmployerFcs = roundCLP((baseAfc * afcEmployerFcsRate) / 100);
    const useSplitAfc = afcEmployerCicRate > 0 || afcEmployerFcsRate > 0;
    if (useSplitAfc) {
      if (afcEmployerCicRate > 0) {
        items.push({
          payer: 'employer',
          code: 'AFC_EMP_CIC',
          name: 'Cesantía - Cuenta Individual (Empleador)',
          rate: afcEmployerCicRate,
          baseAmount: baseAfc,
          amount: afcEmployerCic,
          sortOrder: 120
        });
      }
      if (afcEmployerFcsRate > 0) {
        items.push({
          payer: 'employer',
          code: 'AFC_EMP_FCS',
          name: 'Fondo Solidario de Cesantía (Empleador)',
          rate: afcEmployerFcsRate,
          baseAmount: baseAfc,
          amount: afcEmployerFcs,
          sortOrder: 121
        });
      }
    } else if (afcEmployerLegacyRate > 0) {
      const afcEmployer = roundCLP((baseAfc * afcEmployerLegacyRate) / 100);
      items.push({
        payer: 'employer',
        code: 'AFC_EMP',
        name: 'Seguro Cesantía (Empleador)',
        rate: afcEmployerLegacyRate,
        baseAmount: baseAfc,
        amount: afcEmployer,
        sortOrder: 120
      });
    }
  }

  const seguroSocialAfpEmployer = roundCLP((baseAfpSalud * seguroSocialAfpEmployerRate) / 100);
  if (!sspExempt && seguroSocialAfpEmployerRate > 0) {
    items.push({
      payer: 'employer',
      code: 'SEGURO_SOCIAL_AFP_EMP',
      name: 'Seguro Social - Cuenta individual AFP',
      rate: seguroSocialAfpEmployerRate,
      baseAmount: baseAfpSalud,
      amount: seguroSocialAfpEmployer,
      sortOrder: 122
    });
  }

  const seguroSocialEmployer = roundCLP((baseAfpSalud * seguroSocialEmployerRate) / 100);
  if (!sspExempt && seguroSocialEmployerRate > 0) {
    items.push({
      payer: 'employer',
      code: 'SEGURO_SOCIAL_EMP',
      name: 'Seguro Social Previsional',
      rate: seguroSocialEmployerRate,
      baseAmount: baseAfpSalud,
      amount: seguroSocialEmployer,
      sortOrder: 123
    });
  }

  const crpEmployer = roundCLP((baseAfpSalud * crpEmployerRate) / 100);
  if (!sspExempt && crpEmployerRate > 0) {
    items.push({
      payer: 'employer',
      code: 'CRP_EMP',
      name: 'Cotización con Rentabilidad Protegida',
      rate: crpEmployerRate,
      baseAmount: baseAfpSalud,
      amount: crpEmployer,
      sortOrder: 124
    });
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
  const hasExplicitSeguroSocial = seguroSocialAfpEmployerRate > 0 || seguroSocialEmployerRate > 0 || crpEmployerRate > 0;
  if (!sspExempt && !hasExplicitSeguroSocial && reformaEmployerRate > 0) {
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
    items: items.sort((a, b) => a.sortOrder - b.sortOrder),
    notes,
    context: {
      ageYears,
      legalRetirementAgeReached,
      afpExempt,
      sisExempt,
      afcExempt,
      sspExempt
    }
  };
}
