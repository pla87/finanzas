// --- BARRIDO ALEATORIO ---
//
// Genera balances al azar y comprueba las propiedades que tienen que
// cumplirse en todos: que el patrimonio cuadre, que la cascada de caja sume,
// que guardar y volver a cargar no mueva una sola cifra, que la auditoría
// aconseje contra el mismo coste de vida que enseña. Es lo que encontró los
// seis fallos de la tanda anterior; los casos concretos que salieron de ahí
// están destilados como pruebas normales en finance.test.js, audit.test.js y
// wealthTax.test.js. Esto vigila lo que todavía no sabemos que se puede
// romper.
//
// Cada escenario sale de una semilla, así que un fallo se reproduce entero
// con el número que imprime el error. Por defecto van 2.000 —medio segundo—;
// con FUZZ_N=50000 npm test se aprieta más antes de tocar el motor.
import { computeBalance } from './engine.js';
import { buildAudit } from './audit.js';
import { convertToBase, buildExportPayload, parseImportPayload, resolveLiability, stockClassOf, pensionTypeOf } from './finance.js';
import { wealthTaxDue } from './wealthTax.js';

// --- GENERADOR ---

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONEDAS = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'GBp'];
const PAISES = ['es_urban', 'es_avg', 'us_avg', 'uk_avg'];
const REGIONES = ['estatal', 'madrid', 'andalucia', 'cataluna', 'baleares', 'valencia', 'otra'];

// `duro` es la proporción de casos raros: ceros, cifras enormes, campos
// ausentes. Todo lo que genera es alcanzable desde las fichas —los importes
// negativos ya no lo son, así que tampoco se sortean.
export function escenarioAleatorio(seed, { duro = 0.15 } = {}) {
  const r = mulberry32(seed);
  const uni = (a, b) => a + r() * (b - a);
  const ent = (a, b) => Math.floor(uni(a, b + 1));
  const elige = arr => arr[ent(0, arr.length - 1)];
  const prob = p => r() < p;
  const raro = () => prob(duro);

  const baseCurrency = 'EUR'; // la aplicación la fija en constants.js
  const exchangeRates = { EUR: 1, USD: uni(0.8, 1.4), GBP: uni(0.7, 0.95), CHF: uni(0.9, 1.1), JPY: uni(120, 190) };

  const assets = [];
  for (let i = 0, n = raro() ? ent(0, 1) : ent(1, 9); i < n; i++) {
    const sub = elige(['cash', 'stocks', 'real_estate', 'pensions', 'tangibles']);
    const a = {
      id: `a${i}`, name: `activo ${i}`, subcategory: sub,
      currency: prob(0.8) ? baseCurrency : elige(MONEDAS),
      value: raro() ? elige([0, 0.01, 1e9]) : Math.round(uni(500, 900000)),
      cashReturnPct: raro() ? elige([0, 100]) : Math.round(uni(0, 8) * 100) / 100,
      useReturnPct: 0,
      capitalReturnPct: raro() ? elige([-20, 0, 50]) : Math.round(uni(-2, 9) * 100) / 100,
      monthlyRent: 0,
      useType: 'habitual'
    };
    if (sub === 'real_estate') {
      a.useType = elige(['habitual', 'rented', 'vacant', 'land', 'second']);
      a.monthlyRent = a.useType === 'rented' ? Math.round(uni(0, 3500)) : (prob(0.2) ? Math.round(uni(0, 1200)) : 0);
    }
    if (sub === 'stocks') {
      // A veces sin subtipo, como un balance guardado antes de que existiera.
      if (!raro()) a.stockClass = elige(['growth', 'dividend', 'bonds', 'tips', 'gold']);
      const cotiza = !a.stockClass || a.stockClass === 'growth' || a.stockClass === 'dividend';
      a.stockType = cotiza && prob(0.6) ? 'shares' : 'fund';
      if (a.stockType === 'shares') a.ticker = `T${i}`;
      a.sharesCount = Math.round(uni(1, 500));
      a.sharePrice = Math.round(uni(1, 400) * 100) / 100;
    }
    if (sub === 'pensions' && !raro()) a.pensionType = elige(['plan', 'insurance']);
    if (prob(0.35)) a.acquisitionCost = Math.round(a.value * uni(0.3, 1.4));
    assets.push(a);
  }

  const liabilities = [];
  for (let i = 0, n = raro() ? ent(0, 1) : ent(0, 5); i < n; i++) {
    const sub = elige(['short_term', 'personal_loans', 'family_loans', 'mortgages']);
    const l = {
      id: `l${i}`, name: `deuda ${i}`, subcategory: sub,
      currency: prob(0.85) ? baseCurrency : elige(MONEDAS),
      interestRatePct: raro() ? elige([0, 30]) : Math.round(uni(0, 12) * 100) / 100,
      rateType: 'fixed', spreadPct: 0
    };
    if (sub === 'mortgages') {
      l.initialPrincipal = raro() ? elige([0, 1e9]) : Math.round(uni(20000, 600000));
      l.durationMonths = raro() ? elige([0, 1, 600]) : ent(60, 420);
      l.startDate = `${ent(1995, 2026)}-${String(ent(1, 12)).padStart(2, '0')}`;
      if (prob(0.3)) { l.rateType = 'variable'; l.spreadPct = Math.round(uni(0.3, 2) * 100) / 100; }
      if (prob(0.25)) l.balanceOverride = Math.round(uni(1000, l.initialPrincipal || 1000));
      if (prob(0.2)) l.propertyLink = `a${ent(0, 3)}`;
      l.value = l.initialPrincipal;
      l.monthlyPayment = 0;
    } else if (sub === 'personal_loans') {
      l.initialPrincipal = raro() ? elige([0, 1e9]) : Math.round(uni(500, 60000));
      l.durationMonths = raro() ? elige([0, 1]) : ent(6, 120);
      l.value = l.initialPrincipal;
      l.monthlyPayment = 0;
    } else {
      l.value = raro() ? elige([0, 1e9]) : Math.round(uni(200, 80000));
      l.monthlyPayment = prob(0.3) ? 0 : Math.round(uni(0, 1500));
      l.durationMonths = ent(1, 240);
      l.initialPrincipal = prob(0.4) ? Math.round(l.value * uni(1, 3)) : l.value;
      if (sub === 'family_loans' && prob(0.4)) l.noMonthlyPayment = true;
    }
    liabilities.push(l);
  }

  const gasto = (lo, hi) => raro() ? elige([0, 1e6]) : Math.round(uni(lo, hi));
  const expenses = {
    person_monthly: { food: gasto(0, 700), clothes: gasto(0, 300), supplies_person: gasto(0, 200), transport: gasto(0, 500), other_person: gasto(0, 400) },
    household_monthly: { supplies: gasto(0, 600), subs: gasto(0, 200), otherHouse: gasto(0, 400) },
    family_annual: { housekeeper: gasto(0, 12000), education: gasto(0, 20000), vacations: gasto(0, 15000), vehicleMaint: gasto(0, 6000), otherFixed: gasto(0, 8000) }
  };

  const macroParams = {
    inflationPct: Math.round(uni(0, 8) * 10) / 10,
    realEstateAppreciationPct: Math.round(uni(-2, 8) * 10) / 10,
    stockGrowthPct: Math.round(uni(0, 12) * 10) / 10,
    refDividendYieldPct: Math.round(uni(0, 6) * 10) / 10,
    realEstateMaintenancePct: Math.round(uni(0, 2) * 100) / 100,
    rentalOperatingCostsPct: Math.round(uni(0, 35)),
    marginalIncomeTaxPct: Math.round(uni(0, 50)),
    rentalPrimaryHomeDeductionPct: Math.round(uni(0, 60)),
    savingsTaxRatePct: Math.round(uni(15, 30)),
    pensionWithdrawalTaxPct: Math.round(uni(0, 50)),
    propertySellingCostsPct: Math.round(uni(0, 15)),
    tangiblesHaircutPct: Math.round(uni(0, 60)),
    earlyRepaymentFeePct: Math.round(uni(0, 2) * 100) / 100,
    assumedUnrealizedGainPct: Math.round(uni(0, 80)),
    wealthTaxRegion: elige(REGIONES),
    wealthTaxPayers: prob(0.6) ? 1 : ent(1, 4),
    wealthTaxExemption: prob(0.85) ? null : Math.round(uni(0, 1500000)),
    wealthTaxBonificationPct: prob(0.9) ? null : Math.round(uni(0, 100)),
    fireTargetMultiple: prob(0.8) ? 25 : ent(1, 60)
  };

  return {
    assets, liabilities, expenses, macroParams, exchangeRates, baseCurrency,
    familyMembers: ent(1, 5),
    selectedCountry: elige(PAISES),
    euriborPct: prob(0.7) ? Math.round(uni(1.5, 4.5) * 1000) / 1000 : null
  };
}

// --- COMPROBACIONES ---

const cerca = (a, b, tol = 1e-6) =>
  a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)));
const fin = v => typeof v === 'number' && Number.isFinite(v);

function entradaAuditoria(esc, c) {
  return {
    totalAssets: c.totalAssets, totalLiabilities: c.totalLiabilities, netWorth: c.netWorth, ltv: c.ltv,
    liquidCash: c.liquidCash, runwayMonths: c.runwayTotalMonths,
    totalAnnualExpenses: c.totalAnnualExpenses, totalMonthlyExpenses: c.totalMonthlyExpenses,
    monthlyDebtPayments: c.monthlyDebtPayments, monthlyWealthTax: c.monthlyWealthTax,
    monthlyPassiveCashflow: c.monthlyPassiveCashflow, coveragePct: c.coverage.pct,
    assetCategoryTotals: c.assetCategoryTotals,
    assetClassTotals: c.assetClassTotals,
    holdings: esc.assets.map(a => ({ name: a.name, valueBase: convertToBase(a.value, a.currency, esc.baseCurrency, esc.exchangeRates) })),
    foreignCurrencyPct: c.foreignCurrencyPct, expensiveDebt: c.expensiveDebt,
    lowYieldPensions: c.lowYieldPensions, excessExpenses: c.excessExpensesList,
    macroParams: esc.macroParams, effectiveSavingsRatePct: c.effectiveSavingsRatePct
  };
}

// Devuelve la lista de propiedades rotas. Vacía es lo que se espera siempre.
export function comprobarEscenario(esc) {
  const fallos = [];
  const mal = (qué) => fallos.push(qué);
  const c = computeBalance(esc);

  // Identidad contable y nada sin número.
  if (!cerca(c.netWorth, c.totalAssets - c.totalLiabilities)) mal(`patrimonio ${c.netWorth} ≠ ${c.totalAssets} − ${c.totalLiabilities}`);
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'number' && Number.isNaN(v)) mal(`${k} sale NaN`);
  }

  // Los totales por categoría suman el total, y por clase también.
  const sumaAct = Object.values(c.assetCategoryTotals).reduce((s, v) => s + v, 0);
  if (!cerca(sumaAct, c.totalAssets, 1e-8)) mal(`las categorías de activo suman ${sumaAct} y el total es ${c.totalAssets}`);
  const sumaClases = Object.values(c.assetClassTotals).reduce((s, v) => s + v, 0);
  if (!cerca(sumaClases, c.totalAssets, 1e-8)) mal(`las clases de activo suman ${sumaClases} y el total es ${c.totalAssets}`);
  const sumaPas = Object.values(c.liabilityCategoryTotals).reduce((s, v) => s + v, 0);
  if (!cerca(sumaPas, c.totalLiabilities, 1e-8)) mal(`las categorías de pasivo suman ${sumaPas} y el total es ${c.totalLiabilities}`);

  // La cascada de caja cuadra de arriba abajo.
  if (!cerca(c.assetCashflowSurplus, c.monthlyPassiveCashflow - c.monthlyDebtPayments - c.monthlyWealthTax)) mal('el superávit de los activos no cuadra');
  if (!cerca(c.netMonthlyCashflow, c.assetCashflowSurplus - c.totalMonthlyExpenses)) mal('la caja neta mensual no cuadra');
  const desglose = c.rentalCashflowMonthly + c.dividendCashflowMonthly + c.interestCashflowMonthly + c.tangiblesCashflowMonthly;
  if (!cerca(desglose, c.monthlyPassiveCashflow, 1e-8)) mal('el desglose de flujos no suma el flujo pasivo');
  if (!cerca(c.totalGrossReturnBase, c.capGrowthBase + c.cashRetBase + c.useRetBase, 1e-8)) mal('el rendimiento bruto no cuadra');

  // Colchón: ni negativo, ni la lectura «vendible» por debajo de la estricta.
  if (fin(c.runwayTotalMonths) && c.runwayTotalMonths < 0) mal(`colchón negativo: ${c.runwayTotalMonths}`);
  if (fin(c.runwaySellableMonths) && fin(c.runwayTotalMonths) && c.runwaySellableMonths < c.runwayTotalMonths - 1e-9) {
    mal(`el colchón vendible (${c.runwaySellableMonths}) sale por debajo del estricto (${c.runwayTotalMonths})`);
  }

  // Impuesto del ahorro y del patrimonio.
  if (c.savingsTaxDue < 0 || c.effectiveSavingsRatePct < 0 || c.effectiveSavingsRatePct > 30.0001) mal(`tipo del ahorro fuera de escala: ${c.effectiveSavingsRatePct}`);
  const wt = c.wealthTax;
  if (!(wt.annual >= 0) || !cerca(wt.monthly, wt.annual / 12)) mal(`cuota de patrimonio rara: ${wt.annual}`);
  if (!cerca(wt.annualPerTaxpayer * wt.taxpayers, wt.annual)) mal('la cuota por contribuyente no suma el total');
  if (c.netWorth > 0 && wt.annual > c.netWorth) mal('el impuesto se lleva más que el patrimonio entero');
  const sub = (nw) => wealthTaxDue({ netWorth: nw, primaryHomeValue: 0, regionKey: esc.macroParams.wealthTaxRegion, taxpayers: esc.macroParams.wealthTaxPayers }).annual;
  if (sub(c.netWorth + 100000) < sub(c.netWorth) - 1e-6) mal('más patrimonio paga menos');
  if (c.netWorth > 0) {
    const uno = wealthTaxDue({ netWorth: c.netWorth, primaryHomeValue: 0, regionKey: esc.macroParams.wealthTaxRegion, taxpayers: 1 }).annual;
    const dos = wealthTaxDue({ netWorth: c.netWorth, primaryHomeValue: 0, regionKey: esc.macroParams.wealthTaxRegion, taxpayers: 2 }).annual;
    if (dos > uno + 1e-6) mal('repartir el patrimonio entre dos sale más caro');
  }

  // Cada deuda, por sí sola.
  for (const l of esc.liabilities) {
    const r = resolveLiability(l, new Date(), { euriborPct: esc.euriborPct });
    if (!fin(r.value) || r.value < 0) mal(`saldo imposible en ${l.subcategory}: ${r.value}`);
    if (!fin(r.monthlyPayment) || r.monthlyPayment < 0) mal(`cuota imposible en ${l.subcategory}: ${r.monthlyPayment}`);
  }

  // Auditoría: notas dentro de su rango y consejos que llevan a su meta.
  const a = buildAudit(entradaAuditoria(esc, c));
  for (const d of a.dimensions) {
    if (d.points === null) continue;
    if (!fin(d.points) || d.points < -1e-9 || d.points > d.max + 1e-9) mal(`${d.id} puntúa ${d.points} sobre ${d.max}`);
  }
  for (const eje of ['structure', 'support']) {
    if (!fin(a[eje].score) || a[eje].score < -1e-9 || a[eje].score > 100.0001) mal(`el eje ${eje} sale ${a[eje].score}`);
  }
  const burn = c.totalMonthlyExpenses + c.monthlyDebtPayments + c.monthlyWealthTax;
  const cobertura = a.dimensions.find(d => d.id === 'coverage');
  if (cobertura && cobertura.action && cobertura.action.requiredBase > 0 && burn > 0) {
    const tras = ((c.monthlyPassiveCashflow + cobertura.action.requiredBase) / burn) * 100;
    if (Math.abs(tras - cobertura.action.value) > 0.5) mal(`la meta de cobertura no se alcanza: pide llegar al ${cobertura.action.value}% y deja el ${tras.toFixed(1)}%`);
  }
  const colchon = a.dimensions.find(d => d.id === 'runway');
  if (colchon && colchon.action && colchon.action.requiredBase > 0 && burn > 0) {
    const tras = (c.liquidCash + colchon.action.requiredBase) / burn;
    if (Math.abs(tras - colchon.action.value) > 0.05) mal(`la meta del colchón no se alcanza: pide ${colchon.action.value} meses y deja ${tras.toFixed(2)}`);
  }

  // Guardar y volver a cargar no puede mover una cifra.
  const vuelta = parseImportPayload(JSON.parse(JSON.stringify(buildExportPayload(esc))));
  const c2 = computeBalance({
    ...esc,
    assets: vuelta.assets, liabilities: vuelta.liabilities,
    expenses: vuelta.expenses, macroParams: vuelta.macroParams,
    familyMembers: vuelta.familyMembers ?? esc.familyMembers
  });
  for (const k of ['totalAssets', 'totalLiabilities', 'netWorth', 'monthlyDebtPayments',
    'monthlyPassiveCashflow', 'totalMonthlyExpenses', 'liquidCash', 'monthlyWealthTax',
    'liquidSellable', 'capGrowthBase', 'interestCashflowMonthly', 'dividendCashflowMonthly']) {
    if (!cerca(c[k], c2[k], 1e-6)) mal(`${k} cambia al guardar y volver a cargar: ${c[k]} → ${c2[k]}`);
  }
  for (const k of Object.keys(c.assetClassTotals)) {
    if (!cerca(c.assetClassTotals[k], c2.assetClassTotals[k], 1e-6)) mal(`la clase ${k} cambia al guardar y volver a cargar`);
  }
  // Y cada activo vuelve con su bloque, su subtipo y sus rentabilidades.
  esc.assets.forEach((a, i) => {
    const b = vuelta.assets[i];
    if (!b || b.subcategory !== a.subcategory) { mal(`el activo ${i} vuelve en otro bloque`); return; }
    if (a.subcategory === 'stocks' && stockClassOf(a) !== stockClassOf(b)) mal(`el activo ${i} vuelve como ${stockClassOf(b)} y era ${stockClassOf(a)}`);
    if (a.subcategory === 'pensions' && pensionTypeOf(a) !== pensionTypeOf(b)) mal(`el activo ${i} vuelve como ${pensionTypeOf(b)}`);
    if (a.subcategory !== 'real_estate' && (!cerca(Number(a.cashReturnPct) || 0, b.cashReturnPct) || !cerca(Number(a.capitalReturnPct) || 0, b.capitalReturnPct))) {
      mal(`el activo ${i} (${a.subcategory}) vuelve con otras rentabilidades`);
    }
  });

  return fallos;
}
