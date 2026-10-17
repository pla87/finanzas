// --- BALANCES DE FAMILIAS DE VERDAD ---
//
// Cientos de balances generados al azar dentro de rangos plausibles para una
// familia española, para comprobar que lo que sale tiene sentido: que las
// cuentas cuadran, que la caja mensual es la que se deduce de sus partes y
// que los niveles FIRE dicen lo que dicen sus criterios y no otra cosa.
//
// El generador es determinista: si una comprobación falla, la semilla que
// sale en el mensaje reproduce ese balance exacto.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeBalance } from './engine.js';
import { DEFAULT_MACRO_PARAMS, calculateLoanAmortization } from './finance.js';

const RATES = { EUR: 1, USD: 1.16, GBP: 0.86 };
const N = 400;

// PRNG determinista (mulberry32). Math.random no vale: una prueba que falla
// una vez de cada cien y no se puede repetir es peor que no tenerla.
function rng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function familiaAleatoria(semilla) {
  const r = rng(semilla);
  const entre = (min, max) => min + r() * (max - min);
  const enteroEntre = (min, max) => Math.floor(entre(min, max + 1));
  const aVeces = (p) => r() < p;

  const assets = [];
  const liabilities = [];
  const miembros = enteroEntre(1, 5);

  // Sin esto el generador solo producía familias corrientes y los niveles 4 a 6
  // no se ejercitaban nunca: hacen falta carteras que repartan de verdad, no
  // solo patrimonio. Las proporciones no pretenden retratar a la población,
  // solo cubrir la escala entera.
  const dado = r();
  const perfil = dado < 0.75 ? 'corriente' : (dado < 0.93 ? 'acomodada' : 'independiente');
  const factorRenta = perfil === 'independiente' ? entre(14, 30)
                    : perfil === 'acomodada' ? entre(3, 8) : 1;

  // Caja: casi todo el mundo tiene algo.
  assets.push({ id: 'c1', name: 'Cuenta corriente', subcategory: 'cash', currency: 'EUR',
    value: Math.round(entre(500, 25000)), cashReturnPct: Number(entre(0, 0.5).toFixed(2)) });
  if (aVeces(0.7)) assets.push({ id: 'c2', name: 'Cuenta remunerada', subcategory: 'cash', currency: 'EUR',
    value: Math.round(entre(1000, 60000)), cashReturnPct: Number(entre(1, 3.5).toFixed(2)) });

  // Bolsa: fondos indexados y alguna acción con dividendo.
  if (aVeces(0.75)) assets.push({ id: 's1', name: 'Fondo indexado', subcategory: 'stocks', currency: 'EUR',
    value: Math.round(entre(2000, 250000)), cashReturnPct: 0,
    capitalReturnPct: Number(entre(4, 8).toFixed(1)), stockType: 'fund' });
  if (aVeces(0.35) || perfil !== 'corriente') assets.push({ id: 's2', name: 'Acciones con dividendo', subcategory: 'stocks',
    currency: aVeces(0.25) ? 'USD' : 'EUR', value: Math.round(entre(1000, 80000) * factorRenta),
    cashReturnPct: Number(entre(2.5, 5).toFixed(2)), capitalReturnPct: Number(entre(1, 6).toFixed(1)) });
  if (perfil !== 'corriente') assets.push({ id: 's3', name: 'Cartera de reparto', subcategory: 'stocks',
    currency: 'EUR', value: Math.round(entre(40000, 200000) * factorRenta * 0.4),
    cashReturnPct: Number(entre(3, 4.5).toFixed(2)), capitalReturnPct: Number(entre(2, 5).toFixed(1)) });

  // Vivienda habitual, con o sin hipoteca.
  let tieneCasa = aVeces(0.65);
  if (tieneCasa) {
    const valor = Math.round(entre(90000, 600000));
    // `monthlyRent` en una vivienda habitual es el alquiler que NO pagas: de
    // ahí sale la renta de uso imputada. Ponerlo a cero, como hacía antes este
    // generador, dejaba a todas las familias sin ese cálculo.
    assets.push({ id: 're1', name: 'Vivienda habitual', subcategory: 'real_estate', currency: 'EUR',
      value: valor, monthlyRent: Math.round(valor * entre(0.0028, 0.0045)), useType: 'habitual' });
    if (aVeces(0.75)) {
      const principal = Math.round(valor * entre(0.4, 0.85));
      const anios = enteroEntre(15, 30);
      const inicio = enteroEntre(2005, 2024);
      liabilities.push({ id: 'm1', name: 'Hipoteca', subcategory: 'mortgages', currency: 'EUR',
        initialPrincipal: principal, durationMonths: anios * 12,
        startDate: `${inicio}-${String(enteroEntre(1, 12)).padStart(2, '0')}`,
        ...(aVeces(0.55)
          ? { rateType: 'variable', spreadPct: Number(entre(0.5, 1.5).toFixed(2)), interestRatePct: 3 }
          : { interestRatePct: Number(entre(1.2, 4.5).toFixed(2)) }) });
    }
  }

  // Piso en alquiler.
  const pisos = perfil === 'independiente' ? enteroEntre(1, 3) : (aVeces(0.22) ? 1 : 0);
  for (let i = 0; i < pisos; i++) {
    const valor = Math.round(entre(70000, 320000));
    assets.push({ id: `re2_${i}`, name: `Piso alquilado ${i + 1}`, subcategory: 'real_estate', currency: 'EUR',
      value: valor, monthlyRent: Math.round(valor * entre(0.0035, 0.006)), useType: 'rented' });
  }

  if (aVeces(0.55)) assets.push({ id: 'p1', name: 'Plan de pensiones', subcategory: 'pensions',
    currency: 'EUR', value: Math.round(entre(1000, 140000)), capitalReturnPct: Number(entre(1, 7).toFixed(1)) });
  if (aVeces(0.7)) assets.push({ id: 't1', name: 'Coche', subcategory: 'tangibles', currency: 'EUR',
    value: Math.round(entre(2000, 45000)), cashReturnPct: Number(entre(-4, -1).toFixed(1)),
    useReturnPct: Number(entre(0, 5).toFixed(1)), capitalReturnPct: Number(entre(-18, -5).toFixed(1)) });

  if (aVeces(0.3)) liabilities.push({ id: 'pl1', name: 'Préstamo personal', subcategory: 'personal_loans',
    currency: 'EUR', initialPrincipal: Math.round(entre(2000, 35000)), durationMonths: enteroEntre(12, 96),
    startDate: `${enteroEntre(2019, 2025)}-${String(enteroEntre(1, 12)).padStart(2, '0')}`,
    interestRatePct: Number(entre(3, 11).toFixed(2)) });
  if (aVeces(0.2)) liabilities.push({ id: 'cc1', name: 'Tarjeta', subcategory: 'short_term',
    currency: 'EUR', value: Math.round(entre(300, 6000)), interestRatePct: Number(entre(8, 22).toFixed(1)),
    monthlyPayment: Math.round(entre(50, 400)) });

  const expenses = {
    person_monthly: { food: Math.round(entre(180, 450)), clothes: Math.round(entre(30, 150)),
      supplies_person: Math.round(entre(20, 120)), transport: Math.round(entre(40, 350)),
      other_person: Math.round(entre(30, 250)) },
    household_monthly: { supplies: Math.round(entre(100, 400)), subs: Math.round(entre(10, 120)),
      otherHouse: Math.round(entre(0, 300)) },
    family_annual: { housekeeper: aVeces(0.25) ? Math.round(entre(600, 9000)) : 0,
      education: aVeces(0.4) ? Math.round(entre(500, 12000)) : 0,
      vacations: Math.round(entre(0, 8000)), vehicleMaint: Math.round(entre(200, 2500)),
      otherFixed: Math.round(entre(0, 3000)) }
  };
  // Quien no tiene casa, paga alquiler.
  if (!tieneCasa) expenses.household_monthly.otherHouse += Math.round(entre(500, 1400));

  return { assets, liabilities, expenses, familyMembers: miembros,
           macroParams: DEFAULT_MACRO_PARAMS, baseCurrency: 'EUR',
           selectedCountry: 'es_urban', exchangeRates: RATES,
           euriborPct: 2.954 };
}

const escenarios = Array.from({ length: N }, (_, i) => {
  const entrada = familiaAleatoria(i + 1);
  return { semilla: i + 1, entrada, r: computeBalance(entrada) };
});

// --- Las cuentas cuadran ---

test(`escenarios: ${N} balances y ningún número roto`, () => {
  for (const { semilla, r } of escenarios) {
    for (const [clave, valor] of Object.entries(r)) {
      if (typeof valor !== 'number') continue;
      // El runway puede ser infinito de verdad: sin gasto no se acaba nunca.
      if (clave.startsWith('runway') && valor === Infinity) continue;
      assert.ok(Number.isFinite(valor), `semilla ${semilla}: ${clave} = ${valor}`);
    }
  }
});

test('escenarios: el patrimonio neto es activo menos pasivo', () => {
  for (const { semilla, r } of escenarios) {
    assert.ok(Math.abs(r.netWorth - (r.totalAssets - r.totalLiabilities)) < 0.01, `semilla ${semilla}`);
  }
});

test('escenarios: las categorías suman el activo', () => {
  for (const { semilla, r } of escenarios) {
    const suma = Object.values(r.assetCategoryTotals).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(suma - r.totalAssets) < 0.01, `semilla ${semilla}: ${suma} != ${r.totalAssets}`);
  }
});

test('escenarios: la caja mensual es la suma de sus partes', () => {
  for (const { semilla, r } of escenarios) {
    // El impuesto sobre el patrimonio es coste obligatorio, como las cuotas.
    assert.ok(Math.abs(r.assetCashflowSurplus - (r.monthlyPassiveCashflow - r.monthlyDebtPayments - r.monthlyWealthTax)) < 0.01, `semilla ${semilla}`);
    assert.ok(Math.abs(r.netMonthlyCashflow - (r.assetCashflowSurplus - r.totalMonthlyExpenses)) < 0.01, `semilla ${semilla}`);
  }
});

test('escenarios: la deuda amortizable entra por su saldo vivo, nunca por más del principal', () => {
  for (const { semilla, entrada, r } of escenarios) {
    for (const l of entrada.liabilities) {
      if (l.subcategory !== 'mortgages' && l.subcategory !== 'personal_loans') continue;
      const calc = calculateLoanAmortization(l.initialPrincipal, l.interestRatePct, l.durationMonths, l.startDate);
      assert.ok(calc.currentBalance <= l.initialPrincipal + 0.01,
        `semilla ${semilla}: ${l.name} debe más que el principal`);
    }
    assert.ok(r.totalLiabilities >= 0, `semilla ${semilla}`);
  }
});

// --- Lo que la herramienta afirma se sostiene ---

test('escenarios: la cobertura es lo que dice ser', () => {
  for (const { semilla, r } of escenarios) {
    const coste = r.totalMonthlyExpenses + r.monthlyDebtPayments + r.monthlyWealthTax;
    if (coste <= 0) continue;
    const esperada = (r.monthlyPassiveCashflow / coste) * 100;
    assert.ok(Math.abs(r.coverage.pct - Math.max(0, esperada)) < 0.5,
      `semilla ${semilla}: cobertura ${r.coverage.pct} frente a ${esperada}`);
  }
});

test('escenarios: si los activos pagan la vida entera, la cobertura llega al 100%', () => {
  for (const { semilla, r } of escenarios) {
    const cubre = r.monthlyPassiveCashflow >= r.totalMonthlyExpenses + r.monthlyDebtPayments + r.monthlyWealthTax;
    if (cubre) assert.ok(r.coverage.pct >= 99.9, `semilla ${semilla}: cubre pero marca ${r.coverage.pct}%`);
    else assert.ok(r.coverage.pct < 100.1, `semilla ${semilla}: no cubre pero marca ${r.coverage.pct}%`);
  }
});

test('escenarios: ningún nivel FIRE está verde después de uno que falla', () => {
  for (const { semilla, r } of escenarios) {
    const corte = r.statusLevels.findIndex(s => s !== 'green');
    if (corte === -1) continue;
    for (let i = corte + 1; i < r.statusLevels.length; i++) {
      assert.notEqual(r.statusLevels[i], 'green', `semilla ${semilla}: nivel ${i} verde tras el corte en ${corte}`);
    }
  }
});

test('escenarios: la abundancia (nivel 6) exige de verdad el múltiplo de gasto', () => {
  for (const { semilla, r } of escenarios) {
    if (r.totalAnnualExpenses <= 0) continue;
    const multiplo = r.netWorth / r.totalAnnualExpenses;
    assert.equal(r.isAbundanceAchieved, multiplo >= r.fireTargetMultiple,
      `semilla ${semilla}: ${multiplo.toFixed(1)}x frente a objetivo ${r.fireTargetMultiple}x`);
  }
});

test('escenarios: el colchón se corresponde con los meses de runway', () => {
  for (const { semilla, r } of escenarios) {
    const esperado = r.runwayTotalMonths >= 6 ? 'green' : (r.runwayTotalMonths >= 3 ? 'yellow' : 'red');
    // El nivel 0 no está bloqueado por nadie, así que su color es directo.
    assert.equal(r.statusLevels[0], esperado,
      `semilla ${semilla}: ${r.runwayTotalMonths.toFixed(1)} meses -> ${r.statusLevels[0]}, se esperaba ${esperado}`);
  }
});

test('escenarios: la lectura vendible del runway nunca es peor que la estricta', () => {
  for (const { semilla, r } of escenarios) {
    if (r.runwayTotalMonths === Infinity) continue;
    assert.ok(r.runwaySellableMonths >= r.runwayTotalMonths - 0.01,
      `semilla ${semilla}: vendible ${r.runwaySellableMonths} < estricta ${r.runwayTotalMonths}`);
  }
});

test('escenarios: liquidar siempre deja menos que el patrimonio sobre el papel', () => {
  for (const { semilla, r } of escenarios) {
    if (r.totalAssets <= 0) continue;
    assert.ok(r.liquidationValue <= r.netWorth + 0.01,
      `semilla ${semilla}: liquidación ${r.liquidationValue} > neto ${r.netWorth}`);
  }
});

test('escenarios: el muestreo llega de verdad a todos los niveles', () => {
  // Sin esto, el generador podría degradarse a producir solo familias
  // corrientes y las pruebas de arriba seguirían pasando sin ejercitar nada
  // por encima del nivel 1. Pasó: la primera versión no llegaba al 4.
  for (let nivel = 0; nivel <= 6; nivel++) {
    const cuantas = escenarios.filter(e => e.r.statusLevels[nivel] === 'green').length;
    assert.ok(cuantas >= 5, `solo ${cuantas} familias alcanzan el nivel ${nivel}; el muestreo no lo cubre`);
  }
  // Y que haya de todo: quien no llega al colchón y quien vive de rentas.
  assert.ok(escenarios.some(e => e.r.statusLevels[0] === 'red'), 'ninguna familia se queda sin colchón');
  assert.ok(escenarios.some(e => e.r.coverage.pct >= 100), 'ninguna familia se paga la vida entera');
  assert.ok(escenarios.some(e => e.r.netMonthlyCashflow > 0), 'ninguna familia sale en positivo');
});

test('escenarios: la vivienda habitual genera renta de uso imputada', () => {
  // El alquiler que no pagas no es dinero que entre, pero sí reduce lo que tu
  // vida cuesta, y va en su propia línea. Si esto se rompiera, todas las
  // familias con casa parecerían más pobres de lo que están.
  const conCasa = escenarios.filter(e => e.entrada.assets.some(a => a.useType === 'habitual'));
  assert.ok(conCasa.length > 50, 'el muestreo trae pocas familias con vivienda');
  for (const { semilla, r } of conCasa) {
    assert.ok(r.useRetBase > 0, `semilla ${semilla}: vivienda habitual sin renta de uso`);
    // Y nunca se mezcla con el dinero que entra en la cuenta.
    assert.ok(r.coverage.usePct >= 0, `semilla ${semilla}`);
  }
});

test('escenarios: quien no tiene nada no aparece como libre', () => {
  const vacio = computeBalance({
    assets: [], liabilities: [],
    expenses: { person_monthly: { food: 400 }, household_monthly: { supplies: 300 }, family_annual: {} },
    familyMembers: 2, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.equal(vacio.statusLevels[0], 'red');
  assert.equal(vacio.coverage.pct, 0);
  assert.equal(vacio.isAbundanceAchieved, false);
  assert.ok(vacio.netMonthlyCashflow < 0);
});

test('escenarios: el impuesto del ahorro decide si una cartera llega o no', () => {
  // 1.020.000 € rentando un 3,9% de media dan 39.600 € brutos al año, un 110%
  // de un gasto de 36.000. Pero la escala del ahorro se lleva 8.196, así que la
  // cobertura real se queda en el 87%. Es la diferencia entre lo que parece que
  // cubre una cartera y lo que cubre de verdad, y es justo lo que la
  // herramienta existe para enseñar.
  const r = computeBalance({
    assets: [
      { id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 120000, cashReturnPct: 3 },
      { id: 'a2', name: 'Dividendos', subcategory: 'stocks', currency: 'EUR', value: 900000, cashReturnPct: 4, capitalReturnPct: 5 }
    ],
    liabilities: [],
    expenses: { person_monthly: { food: 1500 }, household_monthly: { supplies: 1500 }, family_annual: {} },
    familyMembers: 1, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });

  assert.equal(r.grossSavingsIncome, 39600);
  assert.ok(r.grossSavingsIncome / 12 > r.totalMonthlyExpenses, 'en bruto daría de sobra');
  assert.ok(r.savingsTaxDue > 8000, `la escala se lleva ${r.savingsTaxDue.toFixed(0)} €`);
  assert.ok(r.coverage.pct < 100, `y por eso la cobertura real se queda en ${r.coverage.pct.toFixed(1)}%`);
  assert.ok(r.coverage.pct > 80, 'pero cerca');
  // Con tanto capital, el nivel 6 sí se alcanza: mide stock, no flujo.
  assert.equal(r.isAbundanceAchieved, true);
});

test('escenarios: una familia forrada y sin deudas sí llega arriba', () => {
  const rico = computeBalance({
    assets: [
      { id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 150000, cashReturnPct: 3 },
      { id: 'a2', name: 'Dividendos', subcategory: 'stocks', currency: 'EUR', value: 1400000, cashReturnPct: 4.5, capitalReturnPct: 5 }
    ],
    liabilities: [],
    expenses: { person_monthly: { food: 1500 }, household_monthly: { supplies: 1500 }, family_annual: {} },
    familyMembers: 1, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.ok(Math.abs(rico.totalAnnualExpenses - 36000) < 1);
  assert.ok(rico.netWorth / rico.totalAnnualExpenses >= 25, 'supera el múltiplo objetivo');
  assert.equal(rico.isAbundanceAchieved, true);
  // Y esta vez el flujo NETO, ya pagado el impuesto, cubre la vida entera.
  assert.ok(rico.coverage.pct > 100, `cobertura neta ${rico.coverage.pct.toFixed(1)}%`);
  assert.ok(rico.netMonthlyCashflow > 0, 'le sobra dinero cada mes');
  assert.ok(rico.statusLevels.every(s => s === 'green'), `niveles: ${rico.statusLevels.join(',')}`);
});
