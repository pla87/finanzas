import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MACRO_PARAMS,
  assetAnnualCashflow,
  calculateLoanAmortization,
  calculateFamilyLoanPayment,
  calculateFamilyLoanMonths,
  calculateRealEstateReturns,
  syncLiabilitiesAmortization,
  resolveLiability,
  parseLocaleNumber,
  refreshHoldingsFromMarket,
  lifeCoverage,
  summarizeImport,
  convertToBase,
  buildExportPayload,
  parseImportPayload,
  normalizeCurrencyAmount,
  localeSeparators,
  serializeExpenses,
  deserializeExpenses,
  serializeMacro,
  deserializeMacro,
  serializeAssets,
  serializeLiabilities,
  deserializeAssets,
  deserializeLiabilities,
  convertExpensesToBase,
  savingsTaxOnIncome,
  effectiveSavingsTaxPct,
  assetSavingsIncome,
  SAVINGS_TAX_BRACKETS,
  effectiveInterestRatePct,
  paymentForBalance,
  assetAcquisitionCost,
  assetCapitalGain,
  assetGrossLiquidation,
  liabilityCancellationCost,
  stockClassOf,
  pensionTypeOf,
  syncAssetRatesToMacro,
  RETIRED_CURRENCY_RATES
} from './finance.js';
import { ALL_SUPPORTED_CURRENCIES } from './constants.js';

// --- AMORTIZACIÓN ---

test('amortización francesa: cuota y saldo de una hipoteca a mitad de vida', () => {
  // 130.000 € al 2,4% a 300 meses, arrancada 38 meses antes de la fecha de referencia.
  const now = new Date(2026, 8, 1);
  const { monthlyPayment, currentBalance } = calculateLoanAmortization(130000, 2.4, 300, '2023-07', now);

  assert.ok(Math.abs(monthlyPayment - 576.68) < 0.5, `cuota inesperada: ${monthlyPayment}`);
  assert.ok(currentBalance < 130000, 'el saldo debe haber bajado');
  assert.ok(currentBalance > 110000, `saldo demasiado bajo tras 38 meses: ${currentBalance}`);
});

test('amortización: préstamo sin intereses reparte el principal linealmente', () => {
  const now = new Date(2026, 0, 1);
  const { monthlyPayment, currentBalance } = calculateLoanAmortization(1200, 0, 12, '2025-07', now);
  assert.equal(monthlyPayment, 100);
  assert.equal(currentBalance, 600);
});

test('amortización: una fecha de inicio futura deja el principal intacto', () => {
  const now = new Date(2026, 0, 1);
  const { currentBalance } = calculateLoanAmortization(10000, 5, 60, '2027-01', now);
  assert.equal(currentBalance, 10000);
});

test('amortización: pasado el plazo el saldo es cero', () => {
  const now = new Date(2030, 0, 1);
  const { currentBalance } = calculateLoanAmortization(10000, 5, 24, '2023-01', now);
  assert.equal(currentBalance, 0);
});

// P0.6 — un plazo vacío no puede convertirse en un préstamo de un mes.
test('P0.6: una duración de cero no debe amortizar el préstamo entero en un mes', () => {
  const now = new Date(2026, 8, 1);
  const { monthlyPayment, currentBalance } = calculateLoanAmortization(130000, 2.4, 0, '2023-07', now);

  assert.notEqual(
    monthlyPayment, 130000,
    'una duración de cero produjo una cuota igual al principal completo'
  );
  assert.ok(
    !(currentBalance === 0 && monthlyPayment > 1000),
    `saldo 0 con cuota ${monthlyPayment}: la deuda ha desaparecido del balance`
  );
});

// --- PRÉSTAMOS FAMILIARES ---

test('préstamo familiar: sin interés, cuota = principal / meses', () => {
  assert.equal(calculateFamilyLoanPayment(12000, 0, 24), 500);
});

test('préstamo familiar: el plazo derivado de una cuota es coherente con la cuota derivada del plazo', () => {
  const months = calculateFamilyLoanMonths(10000, 3, 300);
  const payment = calculateFamilyLoanPayment(10000, 3, months);
  assert.ok(Math.abs(payment - 300) < 10, `ida y vuelta incoherente: ${months} meses -> ${payment} €`);
});

test('préstamo familiar: una cuota que no cubre el interés no tiene plazo finito', () => {
  assert.equal(calculateFamilyLoanMonths(100000, 12, 100), Infinity);
});

// --- INMUEBLES ---

test('inmueble habitual: la renta imputada va a uso y el mantenimiento a efectivo', () => {
  const r = calculateRealEstateReturns(160000, 750, 'habitual', DEFAULT_MACRO_PARAMS);
  assert.equal(r.useReturnPct, 5.63);          // 750*12/160000
  assert.equal(r.cashReturnPct, -0.6);         // mantenimiento
  assert.equal(r.capitalReturnPct, 2.0);       // inflación
  assert.ok(r.netAnnualCashflow < 0);
});

test('inmueble alquilado: el efectivo es neto de gastos e impuestos, sin renta de uso', () => {
  const r = calculateRealEstateReturns(200000, 1000, 'rented', DEFAULT_MACRO_PARAMS);
  assert.equal(r.useReturnPct, 0);
  assert.ok(r.cashReturnPct > 0, 'un alquiler rentable debe dar efectivo positivo');
  assert.ok(r.netAnnualCashflow < 1000 * 12, 'el neto debe ser menor que la renta bruta');
});

test('suelo: ni mantenimiento ni alquiler ni uso; se revaloriza con la inflación', () => {
  const macro = { ...DEFAULT_MACRO_PARAMS, inflationPct: 2.5, realEstateAppreciationPct: 4 };
  const r = calculateRealEstateReturns(100000, 900, 'land', macro);
  assert.equal(r.cashReturnPct, 0, 'sin mantenimiento ni alquiler');
  assert.equal(r.useReturnPct, 0);
  assert.equal(r.netAnnualCashflow, 0);
  assert.equal(r.capitalReturnPct, 2.5, 'la inflación, no la vivienda');
  // Un vacío de antes sigue siendo un vacío: paga mantenimiento y sigue a la vivienda.
  const vacio = calculateRealEstateReturns(100000, 0, 'vacant', macro);
  assert.ok(vacio.cashReturnPct < 0);
  assert.equal(vacio.capitalReturnPct, 4);
});

test('suelo: viaja como suelo y vuelve como suelo', () => {
  const back = roundTrip({ ...SAMPLE_STATE, assets: [
    { id: 's1', name: 'Finca', subcategory: 'real_estate', useType: 'land', currency: 'EUR', value: 60000 },
    { id: 's2', name: 'Piso cerrado', subcategory: 'real_estate', useType: 'vacant', currency: 'EUR', value: 90000 }
  ] });
  assert.equal(back.assets[0].useType, 'land');
  assert.equal(back.assets[0].capitalReturnPct, SAMPLE_STATE.macroParams.inflationPct);
  assert.equal(back.assets[1].useType, 'vacant');
});

test('inmueble sin valor: no divide por cero', () => {
  const r = calculateRealEstateReturns(0, 500, 'habitual', DEFAULT_MACRO_PARAMS);
  assert.equal(r.useReturnPct, 0);
  assert.equal(r.netAnnualCashflow, 0);
});

// --- FLUJO DE CAJA POR ACTIVO ---
// P1.1: la fila de la tabla y el motor deben partir de la misma cifra.

test('P1.1: dividendos e intereses se declaran brutos y suman netos', () => {
  const macro = { ...DEFAULT_MACRO_PARAMS, savingsTaxRatePct: 21 };
  const accion = { subcategory: 'stocks', value: 12000, cashReturnPct: 3.2 };
  const { gross, net } = assetAnnualCashflow(accion, macro);
  assert.equal(gross, 384);
  assert.ok(Math.abs(net - 303.36) < 0.01, `neto inesperado: ${net}`);
});

test('P1.1: los planes de pensiones no reparten flujo corriente', () => {
  const r = assetAnnualCashflow({ subcategory: 'pensions', value: 10000, cashReturnPct: 5 }, DEFAULT_MACRO_PARAMS);
  assert.equal(r.net, 0);
});

test('P1.1: los tangibles no tributan; su coste pasa íntegro', () => {
  const r = assetAnnualCashflow({ subcategory: 'tangibles', value: 10000, cashReturnPct: -2.5 }, DEFAULT_MACRO_PARAMS);
  assert.equal(r.net, -250);
});

test('P1.1: un rendimiento negativo es un coste y no se le aplica retención', () => {
  const r = assetAnnualCashflow({ subcategory: 'cash', value: 10000, cashReturnPct: -1 }, DEFAULT_MACRO_PARAMS);
  assert.equal(r.net, -100, 'la retención no debe reducir una pérdida');
});

test('P1.1: en inmuebles el impuesto ya viene aplicado por el cálculo inmobiliario', () => {
  const piso = { subcategory: 'real_estate', value: 200000, monthlyRent: 1000, useType: 'rented' };
  const r = assetAnnualCashflow(piso, DEFAULT_MACRO_PARAMS);
  const directo = calculateRealEstateReturns(200000, 1000, 'rented', DEFAULT_MACRO_PARAMS);
  assert.equal(r.net, directo.netAnnualCashflow);
});

// --- SINCRONIZACIÓN DE PASIVOS ---

test('sync: solo recalcula hipotecas y préstamos personales con principal y plazo', () => {
  const items = [
    { subcategory: 'short_term', value: 2500, monthlyPayment: 150 },
    { subcategory: 'mortgages', initialPrincipal: 100000, durationMonths: 240, interestRatePct: 3, startDate: '2020-01', value: 999, monthlyPayment: 999 }
  ];
  const [card, mortgage] = syncLiabilitiesAmortization(items);
  assert.equal(card.value, 2500, 'una tarjeta no se amortiza');
  assert.notEqual(mortgage.value, 999, 'la hipoteca debe recalcularse');
});

// --- DIVISA ---

test('convertToBase: la divisa base se devuelve sin tocar', () => {
  assert.equal(convertToBase(1000, 'EUR', 'EUR', { EUR: 1, USD: 1.16 }), 1000);
});

test('convertToBase: USD -> EUR usa el tipo cruzado', () => {
  const v = convertToBase(1160, 'USD', 'EUR', { EUR: 1, USD: 1.16 });
  assert.ok(Math.abs(v - 1000) < 0.01, `esperado ~1000, obtenido ${v}`);
});

// P0.2 — GBp (peniques) no puede tratarse como si fuera la divisa base.
test('P0.2: una divisa desconocida no debe convertirse a la par', () => {
  const rates = { EUR: 1, GBP: 0.8583 };
  const v = convertToBase(12146, 'GBp', 'EUR', rates);
  assert.ok(
    v < 1000,
    `100 acciones a 121,46 £ deberían valer ~14.151 € por acción-lote, no ${Math.round(v)} € por acción`
  );
});

// --- COPIA DE SEGURIDAD: IDA Y VUELTA ---

const SAMPLE_STATE = {
  baseCurrency: 'EUR',
  selectedCountry: 'es_urban',
  familyMembers: 3,
  exchangeRates: { EUR: 1, USD: 1.16 },
  macroParams: {
    ...DEFAULT_MACRO_PARAMS,
    inflationPct: 2.5,
    marginalIncomeTaxPct: 45,
    savingsTaxRatePct: 26
  },
  assets: [
    { id: 'a1', name: 'Cuenta', subcategory: 'cash', currency: 'EUR', value: 6000, cashReturnPct: 1.5, useReturnPct: 0, capitalReturnPct: 0 },
    { id: 'a2', name: 'ETF', subcategory: 'stocks', stockType: 'fund', currency: 'EUR', value: 20000, cashReturnPct: 1.8, useReturnPct: 0, capitalReturnPct: 6.5 }
  ],
  liabilities: [
    { id: 'l1', name: 'Tarjeta', subcategory: 'short_term', currency: 'EUR', value: 2500, interestRatePct: 12, monthlyPayment: 150 }
  ],
  expenses: {
    person_monthly: { food: 300, clothes: 80, supplies_person: 80, transport: 200, other_person: 100 },
    household_monthly: { supplies: 220, subs: 50, otherHouse: 60 },
    family_annual: { housekeeper: 2000, education: 4000, vacations: 3000, vehicleMaint: 800, otherFixed: 1000 }
  }
};

const roundTrip = (state) => parseImportPayload(JSON.parse(JSON.stringify(buildExportPayload(state))));

// P0.4 — la partida de educación se perdía por el camino.
test('P0.4: la ida y vuelta conserva todas las partidas de gasto', () => {
  const back = roundTrip(SAMPLE_STATE);
  for (const [group, values] of Object.entries(SAMPLE_STATE.expenses)) {
    for (const [key, val] of Object.entries(values)) {
      assert.equal(back.expenses[group][key], val, `se perdió ${group}.${key}`);
    }
  }
});

test('P0.4: la ida y vuelta conserva el gasto mensual total', () => {
  const monthly = (e, members) =>
    Object.values(e.person_monthly).reduce((a, b) => a + b, 0) * members +
    Object.values(e.household_monthly).reduce((a, b) => a + b, 0) +
    Object.values(e.family_annual).reduce((a, b) => a + b, 0) / 12;

  const back = roundTrip(SAMPLE_STATE);
  assert.equal(
    monthly(back.expenses, back.familyMembers),
    monthly(SAMPLE_STATE.expenses, SAMPLE_STATE.familyMembers)
  );
});

// P0.5 — los dos tipos impositivos volvían siempre a su valor por defecto.
test('P0.5: la ida y vuelta conserva todos los parámetros macro', () => {
  const back = roundTrip(SAMPLE_STATE);
  for (const [key, val] of Object.entries(SAMPLE_STATE.macroParams)) {
    assert.equal(back.macroParams[key], val, `se perdió macroParams.${key}`);
  }
});

test('la ida y vuelta conserva activos, pasivos y ajustes de entorno', () => {
  const back = roundTrip(SAMPLE_STATE);
  assert.equal(back.baseCurrency, 'EUR');
  assert.equal(back.selectedCountry, 'es_urban');
  assert.equal(back.familyMembers, 3);
  assert.equal(back.assets.length, 2);
  assert.equal(back.assets[0].value, 6000);
  assert.equal(back.assets[1].capitalReturnPct, 6.5);
  assert.equal(back.liabilities.length, 1);
  assert.equal(back.liabilities[0].value, 2500);
});

test('importar: un archivo sin activos deja las listas vacías, no indefinidas', () => {
  const back = parseImportPayload({ baseCurrency: 'EUR' });
  assert.equal(back.assets, null);
  assert.equal(back.liabilities, null);
});

test('importar: se descartan las compras simuladas y las hipotecas virtuales', () => {
  const back = parseImportPayload({
    assetsData: [
      { id: 'real', name: 'Real', category: 'cash', value: 100 },
      { id: 'sim', name: 'Simulado', category: 'cash', value: 999, isPurchasedInSim: true }
    ],
    liabilitiesData: [
      { id: 'mort_re_buy_1', name: 'Virtual', subcategory: 'mortgages', value: 999 },
      { id: 'l1', name: 'Real', subcategory: 'short_term', value: 100 }
    ]
  });
  assert.deepEqual(back.assets.map(a => a.id), ['real']);
  assert.deepEqual(back.liabilities.map(l => l.id), ['l1']);
});

test('importar: divStocks del formato antiguo vuelve a la categoría de acciones', () => {
  const back = parseImportPayload({
    assetsData: [{ id: 'x', name: 'Inditex', category: 'divStocks', value: 12000 }]
  });
  assert.equal(back.assets[0].subcategory, 'stocks');
});

// --- SALDO VIVO DE UN PASIVO (P1.4) ---

// --- LAS DIEZ CATEGORÍAS DE RETIRO ---
// Retiro distingue diez clases de activo y esta herramienta cinco bloques.
// Antes, todo lo que no reconocía caía a «Liquidez»: la renta fija, el oro y
// los seguros de jubilación entraban como dinero en cuenta.

// Un activo de cada categoría, con los campos tal como los escribe Retiro: el
// cupón de la renta fija va en `capitalReturnPct`, porque allí se reinvierte.
const ACTIVOS_DE_RETIRO = [
  { id: 'r1', name: 'Cuenta', category: 'cash', owner: 'p1', currency: 'EUR', value: 9000, cashReturnPct: 1.5, useReturnPct: 0, capitalReturnPct: 0 },
  { id: 'r2', name: 'Indexado', category: 'stocks', owner: 'p1', currency: 'EUR', value: 40000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 6, capitalReturnCoupled: false },
  { id: 'r3', name: 'Dividendos', category: 'divStocks', owner: 'p2', currency: 'USD', value: 15000, cashReturnPct: 3.5, useReturnPct: 0, capitalReturnPct: 2.5 },
  { id: 'r4', name: 'Bonos', category: 'bonds', owner: 'joint', currency: 'EUR', value: 20000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 3.2, capitalReturnCoupled: true },
  { id: 'r5', name: 'Ligados a inflación', category: 'tips', owner: 'p1', currency: 'EUR', value: 12000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 3 },
  { id: 'r6', name: 'Oro', category: 'gold', owner: 'joint', currency: 'EUR', value: 5000, grams: 50, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 2 },
  { id: 'r7', name: 'Piso', category: 'real_estate', owner: 'joint', currency: 'EUR', value: 250000, useType: 'habitual', monthlyRent: 1000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 2, purchaseDate: '2015-06' },
  { id: 'r8', name: 'Plan', category: 'pensions', owner: 'p1', isActivePP: true, currency: 'EUR', value: 30000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 4 },
  { id: 'r9', name: 'Seguro', category: 'pensionIns', owner: 'p2', currency: 'EUR', value: 8000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 6 },
  { id: 'r10', name: 'Coche', category: 'tangibles', owner: 'p1', currency: 'EUR', value: 18000, cashReturnPct: -2, useReturnPct: 4, capitalReturnPct: -10 }
];

test('Retiro: ninguna de sus diez categorías entra como liquidez si no lo es', () => {
  const { assets } = parseImportPayload({ assetsData: ACTIVOS_DE_RETIRO });
  const porId = Object.fromEntries(assets.map(a => [a.id, a]));
  assert.deepEqual(assets.filter(a => a.subcategory === 'cash').map(a => a.id), ['r1']);
  assert.equal(porId.r2.subcategory, 'stocks'); assert.equal(stockClassOf(porId.r2), 'growth');
  assert.equal(porId.r3.subcategory, 'stocks'); assert.equal(stockClassOf(porId.r3), 'dividend');
  assert.equal(porId.r4.subcategory, 'stocks'); assert.equal(stockClassOf(porId.r4), 'bonds');
  assert.equal(porId.r5.subcategory, 'stocks'); assert.equal(stockClassOf(porId.r5), 'tips');
  assert.equal(porId.r6.subcategory, 'stocks'); assert.equal(stockClassOf(porId.r6), 'gold');
  assert.equal(porId.r8.subcategory, 'pensions'); assert.equal(pensionTypeOf(porId.r8), 'plan');
  assert.equal(porId.r9.subcategory, 'pensions'); assert.equal(pensionTypeOf(porId.r9), 'insurance');
});

test('Retiro: el cupón de la renta fija entra como renta, no como revalorización', () => {
  const { assets } = parseImportPayload({ assetsData: ACTIVOS_DE_RETIRO });
  const bonos = assets.find(a => a.id === 'r4');
  assert.equal(bonos.cashReturnPct, 3.2);
  assert.equal(bonos.capitalReturnPct, 0);
  const oro = assets.find(a => a.id === 'r6');
  assert.equal(oro.cashReturnPct, 0, 'el oro no paga nada');
  assert.equal(oro.capitalReturnPct, 2);
});

test('Retiro → Balance → Retiro: cada activo vuelve con su categoría, su valor, sus rentabilidades y su titular', () => {
  const state = { ...SAMPLE_STATE, assets: parseImportPayload({ assetsData: ACTIVOS_DE_RETIRO }).assets };
  const salida = JSON.parse(JSON.stringify(buildExportPayload(state))).assetsData;
  ACTIVOS_DE_RETIRO.forEach((orig, i) => {
    const vuelta = salida[i];
    assert.equal(vuelta.category, orig.category, `${orig.name}: categoría`);
    assert.equal(vuelta.value, orig.value, `${orig.name}: valor`);
    assert.equal(vuelta.currency, orig.currency, `${orig.name}: divisa`);
    assert.equal(vuelta.owner, orig.owner, `${orig.name}: titular`);
    if (orig.category !== 'real_estate') {
      assert.equal(vuelta.cashReturnPct, orig.cashReturnPct, `${orig.name}: efectivo`);
      assert.equal(vuelta.capitalReturnPct, orig.capitalReturnPct, `${orig.name}: capital`);
    }
    for (const k of ['grams', 'isActivePP', 'purchaseDate', 'capitalReturnCoupled']) {
      assert.equal(vuelta[k], orig[k], `${orig.name}: ${k}`);
    }
  });
});

test('Balance → Retiro → Balance: los subtipos y sus rentabilidades no se mueven', () => {
  const assets = [
    { id: 'b1', name: 'Bonos', subcategory: 'stocks', stockClass: 'bonds', stockType: 'fund', currency: 'EUR', value: 10000, cashReturnPct: 3.1, useReturnPct: 0, capitalReturnPct: 0 },
    { id: 'b2', name: 'Ligados', subcategory: 'stocks', stockClass: 'tips', stockType: 'fund', currency: 'EUR', value: 10000, cashReturnPct: 3.5, useReturnPct: 0, capitalReturnPct: 0 },
    { id: 'b3', name: 'Oro', subcategory: 'stocks', stockClass: 'gold', stockType: 'fund', currency: 'EUR', value: 10000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 2.5 },
    { id: 'b4', name: 'Fondo de dividendos', subcategory: 'stocks', stockClass: 'dividend', stockType: 'fund', currency: 'EUR', value: 10000, cashReturnPct: 1, useReturnPct: 0, capitalReturnPct: 5 },
    { id: 'b5', name: 'Acción de crecimiento', subcategory: 'stocks', stockClass: 'growth', stockType: 'shares', ticker: 'X', market: 'IBEX', sharesCount: 10, sharePrice: 100, currency: 'EUR', value: 1000, cashReturnPct: 4, useReturnPct: 0, capitalReturnPct: 6 },
    { id: 'b6', name: 'Seguro', subcategory: 'pensions', pensionType: 'insurance', currency: 'EUR', value: 10000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 3 }
  ];
  const back = roundTrip({ ...SAMPLE_STATE, assets });
  assets.forEach((a, i) => {
    const b = back.assets[i];
    assert.equal(b.subcategory, a.subcategory, a.name);
    if (a.stockClass) assert.equal(b.stockClass, a.stockClass, a.name);
    if (a.pensionType) assert.equal(b.pensionType, a.pensionType, a.name);
    assert.equal(b.cashReturnPct, a.cashReturnPct, `${a.name}: efectivo`);
    assert.equal(b.capitalReturnPct, a.capitalReturnPct, `${a.name}: capital`);
    if (a.stockType) assert.equal(b.stockType, a.stockType, `${a.name}: forma de meterlo`);
  });
});

test('subtipos: lo elige el usuario, no el dividendo', () => {
  // Antes toda acción que repartía el 2,5% o más salía como «de dividendo» y
  // ningún fondo podía serlo. Ahora manda lo elegido…
  const fondo = { subcategory: 'stocks', stockClass: 'dividend', stockType: 'fund', cashReturnPct: 1, value: 1 };
  const accion = { subcategory: 'stocks', stockClass: 'growth', stockType: 'shares', cashReturnPct: 5, value: 1 };
  const [f, a] = serializeAssets([fondo, accion], { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS });
  assert.equal(f.category, 'divStocks');
  assert.equal(a.category, 'stocks');
  // …y lo guardado antes de que hubiera subtipos se lee con la regla de entonces.
  assert.equal(stockClassOf({ subcategory: 'stocks', stockType: 'shares', cashReturnPct: 3 }), 'dividend');
  assert.equal(stockClassOf({ subcategory: 'stocks', stockType: 'fund', cashReturnPct: 3 }), 'growth');
  assert.equal(pensionTypeOf({ subcategory: 'pensions' }), 'plan');
});

test('Retiro: una posición sin ticker entra para meterse por su importe', () => {
  // Retiro no escribe `stockType`. Entrar como «acciones» con cero títulos
  // hacía que la ficha, al guardarla, recalculara el valor a cero.
  const { assets } = parseImportPayload({ assetsData: ACTIVOS_DE_RETIRO });
  for (const a of assets.filter(x => x.subcategory === 'stocks')) {
    assert.equal(a.stockType, 'fund', a.name);
  }
});

test('supuestos: la ligada a inflación y el oro siguen a la inflación; los bonos, a su cupón', () => {
  const macro = { ...DEFAULT_MACRO_PARAMS, inflationPct: 4, tipsRealYieldPct: 1.5, goldRealReturnPct: 0.5, stockGrowthPct: 7 };
  const [tips, oro, bonos, fondo, accion] = syncAssetRatesToMacro([
    { subcategory: 'stocks', stockClass: 'tips', stockType: 'fund', cashReturnPct: 3, capitalReturnPct: 0 },
    { subcategory: 'stocks', stockClass: 'gold', stockType: 'fund', cashReturnPct: 0, capitalReturnPct: 2 },
    { subcategory: 'stocks', stockClass: 'bonds', stockType: 'fund', cashReturnPct: 3.3, capitalReturnPct: 0 },
    { subcategory: 'stocks', stockClass: 'growth', stockType: 'fund', cashReturnPct: 0, capitalReturnPct: 6 },
    { subcategory: 'stocks', stockClass: 'dividend', stockType: 'shares', cashReturnPct: 4, capitalReturnPct: 3 }
  ], macro);
  assert.equal(tips.cashReturnPct, 5.5);
  assert.equal(oro.capitalReturnPct, 4.5);
  assert.equal(oro.cashReturnPct, 0);
  assert.equal(bonos.cashReturnPct, 3.3, 'el cupón de un bono es suyo');
  assert.equal(fondo.capitalReturnPct, 7);
  assert.equal(accion.capitalReturnPct, 3, 'una acción suelta no sigue al supuesto');
  const [fondoDividendo] = syncAssetRatesToMacro([
    { subcategory: 'stocks', stockClass: 'dividend', stockType: 'fund', cashReturnPct: 3.5, capitalReturnPct: 3 }
  ], macro);
  assert.equal(fondoDividendo.capitalReturnPct, 3, 'un fondo de dividendo crece la bolsa menos lo que reparte, como en Retiro');
});

test('exportar: la cuota de una deuda con cuadro viaja como «calcúlala tú»', () => {
  // Retiro lee 0 como cuota automática. Una cuota redondeada la tomaba por fija y se desviaba.
  const [hip, personal, sinPlazo, tarjeta] = serializeLiabilities([
    { id: 'h', subcategory: 'mortgages', initialPrincipal: 200000, startDate: '2020-01', durationMonths: 300, interestRatePct: 2, monthlyPayment: 847.71 },
    { id: 'p', subcategory: 'personal_loans', value: 9000, initialPrincipal: 9000, durationMonths: 30, interestRatePct: 7, monthlyPayment: 327.89 },
    { id: 's', subcategory: 'mortgages', initialPrincipal: 50000, value: 50000, durationMonths: 0, interestRatePct: 2, monthlyPayment: 400 },
    { id: 't', subcategory: 'short_term', value: 900, interestRatePct: 20, monthlyPayment: 60 }
  ], { baseCurrency: 'EUR' });
  assert.equal(hip.monthlyPayment, 0);
  assert.equal(personal.monthlyPayment, 0);
  assert.equal(sinPlazo.monthlyPayment, 400, 'sin plazo no hay cuadro: la cuota guardada es el dato');
  assert.equal(tarjeta.monthlyPayment, 60, 'la cuota de una tarjeta es lo que paga el usuario');
  // Y aquí, al cargar, sale la misma cuota de antes.
  const back = deserializeLiabilities(JSON.parse(JSON.stringify([hip, personal])));
  assert.ok(Math.abs(back[0].monthlyPayment - 847.71) < 0.01, `hipoteca: ${back[0].monthlyPayment}`);
  assert.equal(back[1].monthlyPayment, paymentForBalance(9000, 7, 30));
});

// --- LAS SIETE DIVISAS DE RETIRO ---

test('divisas: se admiten las siete de Retiro, ni una más', () => {
  assert.deepEqual(ALL_SUPPORTED_CURRENCIES.map(c => c.code).sort(),
    ['CHF', 'EUR', 'GBP', 'HKD', 'JPY', 'PHP', 'USD']);
  for (const retirada of Object.keys(RETIRED_CURRENCY_RATES)) {
    assert.ok(!ALL_SUPPORTED_CURRENCIES.some(c => c.code === retirada), `${retirada} sigue en la lista`);
  }
});

test('divisas: un fichero viejo en yuanes, dólares canadienses o australianos entra en euros, sin perder nada', () => {
  const back = parseImportPayload({
    exchangeRates: { EUR: 1, CNY: 8, CAD: 1.5 },
    assetsData: [
      { id: 'x1', name: 'Fondo China', category: 'stocks', currency: 'CNY', value: 80000, acquisitionCost: 40000 },
      { id: 'x2', name: 'Moutai', category: 'divStocks', currency: 'CNY', value: 16000, stockType: 'shares', market: 'SSE', ticker: '600519', sharesCount: 10, sharePrice: 1600 },
      { id: 'x3', name: 'Cuenta en Sídney', category: 'cash', currency: 'AUD', value: 1617.5 },
      { id: 'x4', name: 'Cuenta en dólares', category: 'cash', currency: 'USD', value: 1000 }
    ],
    liabilitiesData: [
      { id: 'y1', name: 'Tarjeta en Toronto', subcategory: 'short_term', currency: 'CAD', value: 3000, initialPrincipal: 3000, monthlyPayment: 150, durationMonths: 24 }
    ]
  });
  const a = Object.fromEntries(back.assets.map(x => [x.id, x]));
  assert.equal(a.x1.currency, 'EUR'); assert.equal(a.x1.value, 10000, 'con el tipo del fichero');
  assert.equal(a.x1.acquisitionCost, 5000);
  assert.equal(a.x2.value, 2000);
  assert.equal(a.x2.stockType, 'fund', 'la bolsa de Shanghái ya no está: pasa a meterse por su importe');
  assert.equal(a.x2.market, '');
  assert.equal(a.x3.value, 1000, 'sin tipo en el fichero, el último conocido');
  assert.equal(a.x4.currency, 'USD', 'una divisa admitida no se toca');
  assert.equal(back.liabilities[0].currency, 'EUR');
  assert.equal(back.liabilities[0].value, 2000);
  assert.equal(back.liabilities[0].monthlyPayment, 100);
  assert.deepEqual(back.currencyConversions.map(c => c.name).sort(),
    ['Cuenta en Sídney', 'Fondo China', 'Moutai', 'Tarjeta en Toronto']);
});

test('P1.4: tabla y motor coinciden aunque falte el plazo', () => {
  // Antes la tabla recalculaba solo con initialPrincipal y el motor exigía
  // además durationMonths, así que mostraban saldos distintos.
  const sinPlazo = { subcategory: 'mortgages', initialPrincipal: 130000, durationMonths: 0, interestRatePct: 2.4, startDate: '2023-07', value: 118000, monthlyPayment: 577 };
  const r = resolveLiability(sinPlazo, new Date(2026, 8, 1));
  assert.equal(r.value, 118000, 'sin plazo se conserva el saldo guardado');
  assert.equal(r.monthlyPayment, 577);
});

test('P1.4: sin plazo, el saldo real del extracto sigue mandando', () => {
  // El ancla vivía dentro de la rama del cuadro de amortización, así que una
  // hipoteca sin plazo utilizable la descartaba y enseñaba otra cifra.
  const r = resolveLiability({
    subcategory: 'mortgages', initialPrincipal: 320000, durationMonths: 0,
    interestRatePct: 1.6, startDate: '2018-12', value: 320000, balanceOverride: 243058
  }, new Date(2026, 8, 1));
  assert.equal(r.value, 243058);
  assert.equal(r.isAnchored, true);
});

test('ida y vuelta: un plazo de 0 no se convierte en una hipoteca a 20 años', () => {
  // Era el fallo más caro de los encontrados: `Number(x) || 240` daba plazo a
  // una hipoteca que no lo tenía, y al recargarla con su fecha de inicio de
  // 2005 salía amortizada del todo. Trescientos mil euros de deuda que
  // desaparecían del balance sin que nada avisara.
  const antes = [{
    id: 'h1', name: 'Hipoteca', subcategory: 'mortgages', currency: 'EUR',
    initialPrincipal: 417706, durationMonths: 0, startDate: '2005-11',
    interestRatePct: 2.5, value: 417706, monthlyPayment: 0
  }];
  const fichero = JSON.parse(JSON.stringify(serializeLiabilities(antes, { baseCurrency: 'EUR' })));
  assert.equal(fichero[0].durationMonths, 0, 'el fichero no debe inventarse un plazo');

  const despues = deserializeLiabilities(fichero);
  const r0 = resolveLiability(antes[0], new Date(2026, 8, 1));
  const r1 = resolveLiability(despues[0], new Date(2026, 8, 1));
  assert.equal(r1.value, r0.value, 'el saldo no puede cambiar por guardar y volver a cargar');
  assert.equal(r1.monthlyPayment, r0.monthlyPayment);
});

test('ida y vuelta: lo que se debe hoy es lo que vuelve, no lo que se pidió', () => {
  // El fichero llevaba el importe del alta, que se queda congelado en cuanto
  // empiezas a devolver la deuda. Cualquier tarjeta o préstamo familiar
  // amortizado a medias volvía a deber su importe original.
  const ida = [
    { id: 'f1', name: 'De mi hermana', subcategory: 'family_loans', currency: 'EUR',
      initialPrincipal: 10000, value: 4000, monthlyPayment: 200, durationMonths: 36, interestRatePct: 0 },
    { id: 't1', name: 'Visa', subcategory: 'short_term', currency: 'EUR',
      initialPrincipal: 1500, value: 300, monthlyPayment: 150, durationMonths: 36, interestRatePct: 0 },
    { id: 'f2', name: 'Préstamo de mi padre', subcategory: 'family_loans', currency: 'EUR',
      value: 0, initialPrincipal: 200000, monthlyPayment: 0, durationMonths: 120, interestRatePct: 0 }
  ];
  const vuelta = deserializeLiabilities(JSON.parse(JSON.stringify(serializeLiabilities(ida, { baseCurrency: 'EUR' }))));
  assert.equal(vuelta[0].value, 4000, 'el préstamo familiar');
  assert.equal(vuelta[1].value, 300, 'la tarjeta');
  assert.equal(vuelta[2].value, 0, 'una deuda ya devuelta no resucita');
});

test('importar: los importes negativos se quedan en cero', () => {
  // Deber −100 € o tener −5.000 € en el banco no significa nada, y aguas
  // abajo salía un colchón de liquidez de −0,18 meses y una nota de
  // diversificación de −0,3 sobre 25. Las fichas ya no dejan escribirlos;
  // esto cierra la puerta del fichero.
  const [a] = deserializeAssets([{ id: 'a1', name: 'Caja', category: 'cash', value: -5000, monthlyRent: -100, sharePrice: -3 }], DEFAULT_MACRO_PARAMS);
  assert.equal(a.value, 0);
  assert.equal(a.monthlyRent, 0);
  assert.equal(a.sharePrice, 0);

  const [l] = deserializeLiabilities([{ id: 'l1', name: 'Visa', subcategory: 'short_term', value: -100, monthlyPayment: -20 }]);
  assert.equal(l.value, 0);
  assert.equal(l.monthlyPayment, 0);
});

test('importar: un país que no existe no entra', () => {
  // El prefijo del país decide en qué divisa se leen las cifras del baremo,
  // así que una clave desconocida comparaba gastos en euros contra números
  // interpretados en dólares.
  assert.equal(parseImportPayload({ selectedCountry: 'es_avg' }).selectedCountry, 'es_avg');
  assert.equal(parseImportPayload({ selectedCountry: 'us_inventado' }).selectedCountry, undefined);
  assert.equal(parseImportPayload({ selectedCountry: 42 }).selectedCountry, undefined);
});

test('importar: un porcentaje negativo sí se respeta', () => {
  // El arreglo es solo para los importes: un activo que se deprecia tiene
  // revalorización negativa, y el efectivo llegó a tener tipos por debajo de
  // cero. Eso son datos, no errores.
  const [a] = deserializeAssets([{ id: 'a1', name: 'Coche', category: 'tangibles', value: 20000, capitalReturnPct: -12 }], DEFAULT_MACRO_PARAMS);
  assert.equal(a.capitalReturnPct, -12);
});

test('exportar: las deudas sin cuadro llevan la fecha de hoy', () => {
  // Saldo, plazo y cuota describen lo que queda HOY en estas deudas, así que
  // la fecha tiene que decir lo mismo. Con la del alta, quien lea el fichero
  // corre el saldo de hoy desde hace años y lo da por medio devuelto.
  const hoy = new Date();
  const mesHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  const salida = serializeLiabilities([
    { id: 'f1', name: 'Familiar', subcategory: 'family_loans', value: 4000, monthlyPayment: 200, durationMonths: 20, startDate: '2023-01' },
    { id: 't1', name: 'Visa', subcategory: 'short_term', value: 300, monthlyPayment: 150, durationMonths: 2, startDate: '2023-01' },
    { id: 'p1', name: 'Personal', subcategory: 'personal_loans', initialPrincipal: 7283, durationMonths: 34, interestRatePct: 4.9 },
    { id: 'h1', name: 'Hipoteca', subcategory: 'mortgages', initialPrincipal: 130000, durationMonths: 300, startDate: '2019-06', interestRatePct: 2.4 }
  ], { baseCurrency: 'EUR' });

  assert.equal(salida[0].startDate, mesHoy, 'la familiar');
  assert.equal(salida[1].startDate, mesHoy, 'la tarjeta');
  assert.equal(salida[2].startDate, mesHoy, 'el préstamo personal');
  // La hipoteca es la excepción: ahí el histórico es el dato.
  assert.equal(salida[3].startDate, '2019-06', 'la hipoteca conserva la suya');
});

test('importar: una deuda descrita desde su alta se trae al día', () => {
  // Retiro describe cualquier deuda como «tanto, desde tal fecha, en tantos
  // meses»; aquí el saldo es lo que se debe HOY. Sin convertirla, una Visa de
  // 1.500 € abierta en 2023 a 36 meses —ya devuelta— entraba debiendo los
  // 1.500 otra vez.
  const enero2023 = '2023-01';
  const ahora = new Date();
  const meses = (ahora.getFullYear() - 2023) * 12 + ahora.getMonth();

  const [visa, familiar, coche, hipoteca] = deserializeLiabilities([
    { id: 'l1', name: 'Visa', subcategory: 'short_term', initialPrincipal: 1500, startDate: enero2023, durationMonths: 36, interestRatePct: 0 },
    { id: 'l2', name: 'Familiar', subcategory: 'family_loans', initialPrincipal: 8000, startDate: enero2023, durationMonths: 12, interestRatePct: 3, noMonthlyPayment: true },
    { id: 'l3', name: 'Coche', subcategory: 'personal_loans', initialPrincipal: 12000, startDate: enero2023, durationMonths: 60, interestRatePct: 4.5 },
    { id: 'l4', name: 'Hipoteca', subcategory: 'mortgages', initialPrincipal: 220000, startDate: '2019-06', durationMonths: 300, interestRatePct: 2.1 }
  ]);

  if (meses >= 36) assert.equal(visa.value, 0, 'una tarjeta con el plazo cumplido entra saldada');
  assert.ok(visa.value < 1500);
  // Sin cuota la deuda capitaliza, igual que hace Retiro con esa casilla.
  assert.ok(familiar.value > 8000, `esperaba más de 8.000 y salió ${familiar.value}`);
  assert.ok(coche.value > 0 && coche.value < 12000);
  // La hipoteca no pasa por la conversión: su modelo ES el cuadro.
  assert.equal(hipoteca.initialPrincipal, 220000);
  assert.equal(hipoteca.durationMonths, 300);
});

test('importar: una copia de esta herramienta no se mueve al ir y volver', () => {
  // Es lo que hace segura la conversión de arriba: al exportar, estas deudas
  // llevan la fecha de hoy, así que el cuadro se corre cero meses.
  const mias = [
    { id: 'f1', name: 'Familiar', subcategory: 'family_loans', value: 4000, initialPrincipal: 10000, monthlyPayment: 200, durationMonths: 20, startDate: '2023-01', interestRatePct: 0 },
    { id: 't1', name: 'Visa', subcategory: 'short_term', value: 300, initialPrincipal: 1500, monthlyPayment: 150, durationMonths: 2, startDate: '2023-01', interestRatePct: 0 },
    { id: 'p1', name: 'Personal', subcategory: 'personal_loans', value: 7283, initialPrincipal: 7283, monthlyPayment: 230, durationMonths: 34, interestRatePct: 4.9 }
  ];
  const vuelta = deserializeLiabilities(JSON.parse(JSON.stringify(serializeLiabilities(mias, { baseCurrency: 'EUR' }))));
  for (let i = 0; i < mias.length; i++) {
    assert.equal(vuelta[i].value, mias[i].value, `${mias[i].subcategory}: el saldo`);
    assert.equal(vuelta[i].durationMonths, mias[i].durationMonths, `${mias[i].subcategory}: el plazo`);
  }
});

test('ida y vuelta: la hipoteca sí conserva su principal original', () => {
  // Es la excepción: ahí el principal es un dato propio y el saldo sale de
  // correr el cuadro, así que no puede sobrescribirse con el saldo de hoy.
  const [f] = serializeLiabilities([{
    id: 'h1', name: 'Hipoteca', subcategory: 'mortgages', currency: 'EUR',
    initialPrincipal: 130000, value: 118000, durationMonths: 300, startDate: '2023-07', interestRatePct: 2.4
  }], { baseCurrency: 'EUR' });
  assert.equal(f.initialPrincipal, 130000);
});

test('ida y vuelta: un plazo ausente de verdad sí toma el valor por defecto', () => {
  // El arreglo no puede irse al otro extremo: un fichero de otra herramienta
  // que no traiga el campo necesita un plazo con el que trabajar.
  const [f] = serializeLiabilities([{ id: 'x', name: 'Sin plazo', subcategory: 'mortgages', value: 1000 }], { baseCurrency: 'EUR' });
  assert.equal(f.durationMonths, 240);
  assert.equal(deserializeLiabilities([{ id: 'y', name: 'Sin plazo', subcategory: 'mortgages', value: 1000 }])[0].durationMonths, 240);
});

test('P1.4: una tarjeta nunca se amortiza', () => {
  const r = resolveLiability({ subcategory: 'short_term', value: 2500, monthlyPayment: 150, initialPrincipal: 2500, durationMonths: 36 });
  assert.equal(r.value, 2500);
});

test('P1.4: una hipoteca con datos completos se recalcula', () => {
  const r = resolveLiability({ subcategory: 'mortgages', initialPrincipal: 130000, durationMonths: 300, interestRatePct: 2.4, startDate: '2023-07', value: 1, monthlyPayment: 1 }, new Date(2026, 8, 1));
  assert.ok(Math.abs(r.monthlyPayment - 576.68) < 0.5);
  assert.ok(r.value > 110000 && r.value < 130000);
});

// --- LECTURA DE NÚMEROS SEGÚN EL IDIOMA (P1.6) ---

test('P1.6: en inglés el punto es decimal y la coma son miles', () => {
  assert.equal(parseLocaleNumber('1000.50', 'en-US', 2), 1000.5);
  assert.equal(parseLocaleNumber('1,000', 'en-US', 0), 1000);
  assert.equal(parseLocaleNumber('1,234,567', 'en-US', 0), 1234567);
});

test('P1.6: en español la coma es decimal y el punto son miles', () => {
  assert.equal(parseLocaleNumber('1.000', 'es-ES', 0), 1000);
  assert.equal(parseLocaleNumber('1000,50', 'es-ES', 2), 1000.5);
  assert.equal(parseLocaleNumber('1.234.567', 'es-ES', 0), 1234567);
});

test('P1.6: con ambos separadores manda el último', () => {
  assert.equal(parseLocaleNumber('1.234,56', 'es-ES', 2), 1234.56);
  assert.equal(parseLocaleNumber('1,234.56', 'en-US', 2), 1234.56);
});

test('P1.6: un campo sin decimales redondea en vez de multiplicar por mil', () => {
  // El fallo original: "1000.50" en un campo de importes daba 100050.
  assert.equal(parseLocaleNumber('1000.50', 'en-US', 0), 1001);
});

test('P1.6: el texto que aún no es un número no se convierte en cero', () => {
  for (const t of ['', '-', ',', '.', 'abc']) {
    assert.equal(parseLocaleNumber(t, 'es-ES', 2), null, `"${t}" debería quedar pendiente`);
  }
});

test('P1.6: los negativos se conservan', () => {
  assert.equal(parseLocaleNumber('-2,5', 'es-ES', 2), -2.5);
  assert.equal(parseLocaleNumber('-2.5', 'en-US', 2), -2.5);
});

// --- ACTUALIZACIÓN DE COTIZACIONES (P4.9) ---

const TICKERS = {
  NASDAQ: [
    { ticker: 'AAPL', name: 'Apple Inc.', price: 328.21, divYield: 0.35, currency: 'USD' },
    { ticker: 'MSFT', name: 'Microsoft', price: 510.12, divYield: 0.76, currency: 'USD' }
  ],
  LSE: [{ ticker: 'AZN', name: 'AstraZeneca', price: 120.5, divYield: 2.02, currency: 'GBP' }]
};

test('P4.9: revaluar actualiza precio, valor y dividendo de una posición', () => {
  const antes = [{ id: 'x', subcategory: 'stocks', stockType: 'shares', market: 'NASDAQ', ticker: 'AAPL', sharesCount: 10, sharePrice: 230, value: 2300, cashReturnPct: 0.5, currency: 'USD' }];
  const { assets, changes } = refreshHoldingsFromMarket(antes, TICKERS);
  assert.equal(assets[0].sharePrice, 328.21);
  assert.equal(assets[0].value, 3282.1);
  assert.equal(assets[0].cashReturnPct, 0.35);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].previousValue, 2300);
});

// La razón por la que esta función es correctiva y no solo cómoda.
test('P4.9: revaluar corrige un dividendo guardado con el fallo de las cotizaciones', () => {
  const corrupto = [{ id: 'x', subcategory: 'stocks', stockType: 'shares', market: 'NASDAQ', ticker: 'MSFT', sharesCount: 5, sharePrice: 450, value: 2250, cashReturnPct: 73, currency: 'USD' }];
  const { assets } = refreshHoldingsFromMarket(corrupto, TICKERS);
  assert.equal(assets[0].cashReturnPct, 0.76, 'el 73% guardado debe quedar corregido');
});

test('P4.9: revaluar corrige también la divisa de una posición en peniques', () => {
  const enPeniques = [{ id: 'x', subcategory: 'stocks', stockType: 'shares', market: 'LSE', ticker: 'AZN', sharesCount: 100, sharePrice: 12050, value: 1205000, cashReturnPct: 2.02, currency: 'GBp' }];
  const { assets } = refreshHoldingsFromMarket(enPeniques, TICKERS);
  assert.equal(assets[0].currency, 'GBP');
  assert.equal(assets[0].value, 12050);
});

test('P4.9: fondos, efectivo e inmuebles no se tocan', () => {
  const otros = [
    { id: 'f', subcategory: 'stocks', stockType: 'fund', value: 20000, cashReturnPct: 1.8 },
    { id: 'c', subcategory: 'cash', value: 6000, cashReturnPct: 1.5 }
  ];
  const { assets, changes } = refreshHoldingsFromMarket(otros, TICKERS);
  assert.deepEqual(assets, otros);
  assert.equal(changes.length, 0);
});

test('P4.9: un ticker que ya no está en la base se deja intacto y se informa', () => {
  const desconocido = [{ id: 'x', subcategory: 'stocks', stockType: 'shares', market: 'NASDAQ', ticker: 'ZZZZ', sharesCount: 10, sharePrice: 100, value: 1000, cashReturnPct: 1, currency: 'USD' }];
  const { assets, changes, notFound } = refreshHoldingsFromMarket(desconocido, TICKERS);
  assert.equal(assets[0].sharePrice, 100);
  assert.equal(changes.length, 0);
  assert.deepEqual(notFound.map(n => n.ticker), ['ZZZZ']);
});

test('P4.9: sin cambios reales no se declara ningún cambio', () => {
  const igual = [{ id: 'x', subcategory: 'stocks', stockType: 'shares', market: 'NASDAQ', ticker: 'AAPL', sharesCount: 10, sharePrice: 328.21, value: 3282.1, cashReturnPct: 0.35, currency: 'USD' }];
  const { changes } = refreshHoldingsFromMarket(igual, TICKERS);
  assert.equal(changes.length, 0);
});

// --- COBERTURA DE VIDA (P3.1) ---

test('P3.1: la cobertura es el flujo pasivo sobre el coste obligatorio', () => {
  const c = lifeCoverage(500, 1500, 500);
  assert.equal(c.burn, 2000);
  assert.equal(c.pct, 25);
  assert.equal(c.gap, 1500);
});

test('P3.1: cubrir el coste entero es el 100%', () => {
  assert.equal(lifeCoverage(2000, 1500, 500).pct, 100);
  assert.equal(lifeCoverage(2000, 1500, 500).gap, 0);
});

test('P3.1: un flujo pasivo negativo no produce una cobertura negativa', () => {
  const c = lifeCoverage(-200, 1000, 0);
  assert.equal(c.pct, 0);
  assert.equal(c.gap, 1200, 'la brecha sí crece con el flujo negativo');
});

test('P3.1: sin coste que cubrir la cobertura queda sin definir, no al 100%', () => {
  const c = lifeCoverage(500, 0, 0);
  assert.equal(c.ratio, null);
  assert.equal(c.pct, null);
});

test('P3.1: la cobertura y la caja neta mensual cuentan la misma historia', () => {
  const passive = 800, expenses = 1600, debt = 400;
  const c = lifeCoverage(passive, expenses, debt);
  const cajaNeta = passive - debt - expenses;
  assert.equal(Math.sign(cajaNeta), c.ratio >= 1 ? 0 : -1);
  assert.equal(c.gap, -cajaNeta);
});

// --- COBERTURA CON RENTA DE USO IMPUTADA (P3.1) ---

test('P3.1: la renta de uso se informa aparte, no dentro del titular', () => {
  const c = lifeCoverage(-26.57, 3179, 527, 784);
  assert.equal(c.pct, 0, 'el titular sigue siendo solo caja');
  assert.ok(Math.abs(c.usePct - 21.16) < 0.2, `uso inesperado: ${c.usePct}`);
  assert.ok(c.combinedPct > c.pct, 'la lectura combinada es mayor');
});

test('P3.1: sin uso imputado la lectura combinada iguala al titular', () => {
  const c = lifeCoverage(500, 1500, 500, 0);
  assert.equal(c.combinedPct, c.pct);
  assert.equal(c.usePct, 0);
});

// --- MÚLTIPLO OBJETIVO (P3.2) ---

test('P3.2: el múltiplo por defecto es 25x, no 80x', () => {
  assert.equal(DEFAULT_MACRO_PARAMS.fireTargetMultiple, 25);
});

test('P3.2: el múltiplo sobrevive a la ida y vuelta de la copia de seguridad', () => {
  const estado = { ...SAMPLE_STATE, macroParams: { ...SAMPLE_STATE.macroParams, fireTargetMultiple: 33 } };
  const back = parseImportPayload(JSON.parse(JSON.stringify(buildExportPayload(estado))));
  assert.equal(back.macroParams.fireTargetMultiple, 33);
});

test('P3.2: una copia antigua sin múltiplo adopta el valor por defecto', () => {
  const back = parseImportPayload({ macro: { inflation: 2 } });
  assert.equal(back.macroParams.fireTargetMultiple, 25);
});

// --- RESUMEN PREVIO A LA CARGA (P4.4) ---

const RATES = { EUR: 1, USD: 1.16 };

test('P4.4: el resumen compara lo que hay con lo que entraría', () => {
  const actual = {
    assets: [{ value: 1000, currency: 'EUR' }],
    liabilities: [],
    familyMembers: 2,
    expenses: { person_monthly: { food: 100 }, household_monthly: {}, family_annual: {} }
  };
  const entrante = {
    assets: [{ value: 5000, currency: 'EUR' }, { value: 1160, currency: 'USD' }],
    liabilities: [{ value: 2000, currency: 'EUR' }],
    familyMembers: 3,
    expenses: { person_monthly: { food: 300 }, household_monthly: { supplies: 100 }, family_annual: { vacations: 1200 } }
  };
  const r = summarizeImport(entrante, actual, 'EUR', RATES);

  assert.deepEqual(r.assets, { from: 1, to: 2 });
  assert.deepEqual(r.liabilities, { from: 0, to: 1 });
  assert.equal(Math.round(r.assetValue.to), 6000, 'los USD deben convertirse a la base');
  assert.equal(r.liabilityValue.to, 2000);
  assert.equal(r.expenses.from, 100);
  assert.equal(r.expenses.to, 500);
  assert.deepEqual(r.familyMembers, { from: 2, to: 3 });
});

test('P4.4: si el archivo no trae gastos, no se anuncia ningún cambio de gastos', () => {
  const r = summarizeImport({ assets: [], liabilities: [] }, { assets: [], liabilities: [], familyMembers: 1 }, 'EUR', RATES);
  assert.equal(r.expenses, null);
  assert.equal(r.baseCurrency, null);
  assert.equal(r.familyMembers, null);
});

test('P4.4: un cambio de divisa base se anuncia', () => {
  const r = summarizeImport({ baseCurrency: 'USD', assets: [], liabilities: [] }, { assets: [], liabilities: [], familyMembers: 1 }, 'EUR', RATES);
  assert.deepEqual(r.baseCurrency, { from: 'EUR', to: 'USD' });
});

// --- C3: LOS DIEZ AYUDANTES SIN PRUEBA PROPIA ---
// Las de arriba los recorren de pasada en los viajes de ida y vuelta del
// backup, pero ninguno tenía una prueba que fijara su comportamiento. Un
// cambio en cualquiera de ellos rompía el formato sin que nada avisara.

test('normalizeCurrencyAmount: los peniques del LSE entran como libras', () => {
  const gbp = normalizeCurrencyAmount(1214.6, 'GBp');
  assert.equal(gbp.currency, 'GBP');
  assert.ok(Math.abs(gbp.value - 12.146) < 1e-9, `valor inesperado: ${gbp.value}`);
  assert.deepEqual(normalizeCurrencyAmount(500, 'ZAc'), { value: 5, currency: 'ZAR' });
});

test('normalizeCurrencyAmount: una divisa normal pasa intacta', () => {
  assert.deepEqual(normalizeCurrencyAmount(1214.6, 'EUR'), { value: 1214.6, currency: 'EUR' });
  assert.deepEqual(normalizeCurrencyAmount(null, 'USD'), { value: 0, currency: 'USD' });
});

test('localeSeparators: el inglés usa punto decimal y el resto coma', () => {
  assert.deepEqual(localeSeparators('en-US'), { decimal: '.', group: ',' });
  assert.deepEqual(localeSeparators('en-GB'), { decimal: '.', group: ',' });
  assert.deepEqual(localeSeparators('es-ES'), { decimal: ',', group: '.' });
  assert.deepEqual(localeSeparators(undefined), { decimal: ',', group: '.' });
});

test('serializeExpenses: los gastos salen con los nombres del fichero', () => {
  const out = serializeExpenses({
    person_monthly: { food: 300, transport: 80 },
    household_monthly: { supplies: 120 },
    family_annual: { vacations: 2000 }
  });
  assert.equal(out.food, 300);
  assert.equal(out.transport, 80);
  assert.equal(out.supplies_h, 120);
  assert.equal(out.vacations, 2000);
  // Lo que no se rellena viaja como cero, no como hueco.
  assert.equal(out.clothes, 0);
  assert.equal(out.housekeeper, 0);
});

test('deserializeExpenses: vuelven a los nombres del estado', () => {
  const back = deserializeExpenses({ food: 300, supplies_h: 120, vacations: 2000, basura: 999 });
  assert.equal(back.person_monthly.food, 300);
  assert.equal(back.household_monthly.supplies, 120);
  assert.equal(back.family_annual.vacations, 2000);
  assert.equal(back.person_monthly.clothes, 0);
  // Una clave que no reconocemos no se cuela en el estado.
  assert.equal(back.basura, undefined);
});

test('gastos: ida y vuelta sin pérdida', () => {
  const original = {
    person_monthly: { food: 310, clothes: 40, supplies_person: 25, transport: 90, other_person: 15 },
    household_monthly: { supplies: 130, subs: 45, otherHouse: 20 },
    family_annual: { housekeeper: 3000, education: 1200, vacations: 2500, vehicleMaint: 600, otherFixed: 400 }
  };
  assert.deepEqual(deserializeExpenses(serializeExpenses(original)), original);
});

test('macro: ida y vuelta conserva los parámetros', () => {
  const original = { ...DEFAULT_MACRO_PARAMS, inflationPct: 3.1, savingsTaxRatePct: 23, fireTargetMultiple: 33 };
  const back = deserializeMacro(serializeMacro(original));
  assert.equal(back.inflationPct, 3.1);
  assert.equal(back.savingsTaxRatePct, 23);
  assert.equal(back.fireTargetMultiple, 33);
});

test('deserializeMacro: acepta tanto los nombres cortos como los largos', () => {
  assert.equal(deserializeMacro({ inflation: 4 }).inflationPct, 4);
  assert.equal(deserializeMacro({ inflationPct: 4 }).inflationPct, 4);
  // Sin fuente, los valores por defecto.
  assert.equal(deserializeMacro(null).inflationPct, DEFAULT_MACRO_PARAMS.inflationPct);
  assert.equal(deserializeMacro({}).fireTargetMultiple, DEFAULT_MACRO_PARAMS.fireTargetMultiple);
});

test('serializeMacro: un 0 escrito a propósito sobrevive al fichero', () => {
  // Era el día que este fichero anticipaba: `Number(x) || defecto` no
  // distinguía un cero deliberado de un campo vacío, así que una inflación
  // del 0% se exportaba como 2%. Ahora solo cae al defecto lo que de verdad
  // no hay.
  assert.equal(serializeMacro({ ...DEFAULT_MACRO_PARAMS, inflationPct: 0 }).inflation, 0);
  assert.equal(deserializeMacro({ inflation: 0 }).inflationPct, 0);
});

test('serializeMacro: ningún parámetro pierde el cero al ir y volver', () => {
  // La comprobación de arriba con una sola clave se quedaba corta: el fallo
  // estaba repetido en diecisiete campos. Aquí se recorren todos.
  const numericos = Object.keys(DEFAULT_MACRO_PARAMS).filter(
    k => typeof DEFAULT_MACRO_PARAMS[k] === 'number' && k !== 'wealthTaxPayers'
  );
  assert.ok(numericos.length >= 14, `esperaba más parámetros numéricos, encontré ${numericos.length}`);

  for (const clave of numericos) {
    const puestoACero = { ...DEFAULT_MACRO_PARAMS, [clave]: 0 };
    const vuelta = deserializeMacro(serializeMacro(puestoACero));
    assert.equal(vuelta[clave], 0, `"${clave}" vuelve del fichero como ${vuelta[clave]} en vez de 0`);
  }
});

test('serializeMacro: lo que falta de verdad sí cae al valor por defecto', () => {
  // El arreglo no puede irse al otro extremo: un campo ausente, vacío o
  // ilegible no es un cero, y ahí el valor por defecto es lo correcto.
  for (const vacio of [undefined, null, '', 'no es un número', NaN]) {
    const m = serializeMacro({ ...DEFAULT_MACRO_PARAMS, inflationPct: vacio });
    assert.equal(m.inflation, 2.0, `con ${String(vacio)} esperaba el defecto`);
  }
  assert.equal(deserializeMacro({ inflation: '' }).inflationPct, DEFAULT_MACRO_PARAMS.inflationPct);
  assert.equal(deserializeMacro({}).inflationPct, DEFAULT_MACRO_PARAMS.inflationPct);
});

test('serializeAssets: unos costes operativos del 0% viajan como 0', () => {
  // `opexPct` lo lee Retiro. Llevaba el mismo `|| 15` que el bloque macro.
  const [a] = serializeAssets(
    [{ id: 'p1', name: 'Piso', subcategory: 'real_estate', value: 200000, useType: 'rented', monthlyRent: 900 }],
    { baseCurrency: 'EUR', macroParams: { ...DEFAULT_MACRO_PARAMS, rentalOperatingCostsPct: 0 } }
  );
  assert.equal(a.opexPct, 0);
});

test('serializeAssets: una acción que reparte mucho se marca como divStocks', () => {
  const [dividendera, fondo, poco] = serializeAssets([
    { id: 'x1', name: 'Repsol', subcategory: 'stocks', value: 1000, cashReturnPct: 5.0 },
    { id: 'x2', name: 'Indexado', subcategory: 'stocks', value: 1000, cashReturnPct: 5.0, stockType: 'fund' },
    { id: 'x3', name: 'Growth', subcategory: 'stocks', value: 1000, cashReturnPct: 1.0 }
  ], { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS });

  assert.equal(dividendera.category, 'divStocks');
  assert.equal(fondo.category, 'stocks', 'un fondo nunca es divStocks');
  assert.equal(poco.category, 'stocks');
});

test('serializeAssets: rellena los campos que espera Retire', () => {
  const [a] = serializeAssets(
    [{ id: 'x1', name: 'Casa', subcategory: 'real_estate', value: 200000, useType: 'habitual' }],
    { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS }
  );
  // El formato compartido con Retire espera estas claves aunque esta
  // herramienta no las lea: purchasePrice se inventa al 75% del valor.
  assert.equal(a.purchasePrice, 150000);
  assert.equal(a.hasMaint, true);
  assert.equal(a.opexPct, DEFAULT_MACRO_PARAMS.rentalOperatingCostsPct);
  assert.equal(a.currency, 'EUR', 'sin divisa propia hereda la base');
});

test('serializeLiabilities: sin principal se usa el saldo vivo', () => {
  const [tarjeta] = serializeLiabilities(
    [{ id: 'l1', name: 'Tarjeta', subcategory: 'short_term', value: 2500 }],
    { baseCurrency: 'EUR' }
  );
  assert.equal(tarjeta.initialPrincipal, 2500);
  assert.equal(tarjeta.durationMonths, 240, 'plazo por defecto');
  assert.equal(tarjeta.noMonthlyPayment, false);
});

test('deserializeAssets: divStocks vuelve a ser stocks y lo desconocido es cash', () => {
  const out = deserializeAssets([
    { id: 'a1', name: 'Repsol', category: 'divStocks', value: 1000 },
    { id: 'a2', name: 'Raro', category: 'cripto_ninja', value: 500 }
  ], DEFAULT_MACRO_PARAMS);

  assert.equal(out[0].subcategory, 'stocks');
  assert.equal(out[1].subcategory, 'cash', 'una categoría que no existe cae en cash');
});

test('deserializeAssets: descarta lo comprado dentro de una simulación', () => {
  const out = deserializeAssets([
    { id: 'a1', name: 'Real', category: 'cash', value: 1000 },
    { id: 'a2', name: 'Simulado', category: 'cash', value: 9999, isPurchasedInSim: true }
  ], DEFAULT_MACRO_PARAMS);

  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Real');
});

test('deserializeAssets: un inmueble recalcula sus rendimientos, no los importa', () => {
  const [casa] = deserializeAssets([
    { id: 'a1', name: 'Piso', category: 'real_estate', value: 200000, monthlyRent: 900, useType: 'rented',
      cashReturnPct: 99, useReturnPct: 99, capitalReturnPct: 99 }
  ], DEFAULT_MACRO_PARAMS);

  const esperado = calculateRealEstateReturns(200000, 900, 'rented', DEFAULT_MACRO_PARAMS);
  assert.equal(casa.cashReturnPct, esperado.cashReturnPct);
  assert.equal(casa.capitalReturnPct, esperado.capitalReturnPct);
  assert.notEqual(casa.cashReturnPct, 99, 'los porcentajes del fichero no mandan');
});

test('deserializeAssets: sin lista devuelve null', () => {
  assert.equal(deserializeAssets(null, DEFAULT_MACRO_PARAMS), null);
  assert.equal(deserializeAssets('no soy una lista', DEFAULT_MACRO_PARAMS), null);
});

test('deserializeLiabilities: descarta las hipotecas de compra simulada', () => {
  const out = deserializeLiabilities([
    { id: 'l1', name: 'Hipoteca', subcategory: 'mortgages', initialPrincipal: 130000, durationMonths: 300, interestRatePct: 2.4, startDate: '2023-07' },
    { id: 'mort_re_buy_123', name: 'Simulada', subcategory: 'mortgages', initialPrincipal: 500000, durationMonths: 300 }
  ]);

  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Hipoteca');
});

test('deserializeLiabilities: el saldo llega ya amortizado a día de hoy', () => {
  const [hipoteca] = deserializeLiabilities([
    { id: 'l1', name: 'Hipoteca', subcategory: 'mortgages', value: 999999,
      initialPrincipal: 130000, durationMonths: 300, interestRatePct: 2.4, startDate: '2023-07' }
  ]);

  // El saldo del fichero se sustituye por el del cuadro de amortización.
  assert.notEqual(hipoteca.value, 999999);
  assert.ok(hipoteca.value < 130000 && hipoteca.value > 100000, `saldo inesperado: ${hipoteca.value}`);
  assert.ok(hipoteca.monthlyPayment > 0);
});

test('deserializeLiabilities: sin lista devuelve null', () => {
  assert.equal(deserializeLiabilities(null), null);
});

// --- DIVISA BASE FIJA EN EUROS ---

test('convertExpensesToBase: un backup en dólares trae sus gastos a euros', () => {
  const enDolares = {
    person_monthly: { food: 1160, transport: 232 },
    household_monthly: { supplies: 116 },
    family_annual: { vacations: 2320 }
  };
  const r = convertExpensesToBase(enDolares, 'USD', 'EUR', RATES);
  // 1,16 USD por euro: 1.160 USD son 1.000 EUR.
  assert.ok(Math.abs(r.person_monthly.food - 1000) < 0.01, `${r.person_monthly.food}`);
  assert.ok(Math.abs(r.person_monthly.transport - 200) < 0.01);
  assert.ok(Math.abs(r.household_monthly.supplies - 100) < 0.01);
  assert.ok(Math.abs(r.family_annual.vacations - 2000) < 0.01);
});

test('convertExpensesToBase: si ya está en la base no toca nada', () => {
  const enEuros = { person_monthly: { food: 300 }, household_monthly: {}, family_annual: {} };
  assert.equal(convertExpensesToBase(enEuros, 'EUR', 'EUR', RATES), enEuros, 'devuelve el mismo objeto');
  assert.equal(convertExpensesToBase(enEuros, undefined, 'EUR', RATES), enEuros, 'sin divisa declarada no se toca');
  assert.equal(convertExpensesToBase(null, 'USD', 'EUR', RATES), null);
});

test('convertExpensesToBase: no redondea, para que ir y volver no desvíe', () => {
  // El cambio de divisa base redondeaba a dos decimales en cada salto, así
  // que EUR -> USD -> EUR dejaba las cifras movidas. Aquí no se redondea.
  const original = { person_monthly: { food: 333.33 }, household_monthly: {}, family_annual: {} };
  const ida = convertExpensesToBase(original, 'EUR', 'USD', RATES);
  const vuelta = convertExpensesToBase(ida, 'USD', 'EUR', RATES);
  assert.ok(Math.abs(vuelta.person_monthly.food - 333.33) < 1e-9,
    `tras ida y vuelta: ${vuelta.person_monthly.food}`);
});

// --- A4: LA REVALORIZACIÓN INMOBILIARIA, DESLIGADA DE LA INFLACIÓN ---

test('inmuebles: la revalorización usa su propio parámetro', () => {
  const params = { ...DEFAULT_MACRO_PARAMS, inflationPct: 5, realEstateAppreciationPct: 1 };
  const r = calculateRealEstateReturns(200000, 0, 'habitual', params);
  assert.equal(r.capitalReturnPct, 1, 'manda la revalorización, no la inflación');
});

test('inmuebles: sin el parámetro se hereda la inflación, como antes', () => {
  // Un balance guardado antes de que el parámetro existiera no debe moverse.
  const antiguo = { inflationPct: 4.5, realEstateMaintenancePct: 0.6 };
  assert.equal(calculateRealEstateReturns(200000, 0, 'habitual', antiguo).capitalReturnPct, 4.5);
  assert.equal(calculateRealEstateReturns(200000, 800, 'rented', antiguo).capitalReturnPct, 4.5);
  assert.equal(calculateRealEstateReturns(200000, 0, 'otro', antiguo).capitalReturnPct, 4.5);
});

test('inmuebles: la revalorización puede ir por debajo de la inflación', () => {
  const params = { ...DEFAULT_MACRO_PARAMS, inflationPct: 3, realEstateAppreciationPct: 0 };
  assert.equal(calculateRealEstateReturns(200000, 0, 'habitual', params).capitalReturnPct, 0);
});

test('macro: la revalorización sobrevive al viaje de ida y vuelta', () => {
  const original = { ...DEFAULT_MACRO_PARAMS, inflationPct: 3, realEstateAppreciationPct: 1.25 };
  assert.equal(deserializeMacro(serializeMacro(original)).realEstateAppreciationPct, 1.25);
});

test('macro: un fichero sin el parámetro hereda la inflación al deserializar', () => {
  assert.equal(deserializeMacro({ inflation: 4 }).realEstateAppreciationPct, 4);
  assert.equal(deserializeMacro({ inflationPct: 3.3 }).realEstateAppreciationPct, 3.3);
  // Y sin nada de nada, el valor por defecto.
  assert.equal(deserializeMacro({}).realEstateAppreciationPct, DEFAULT_MACRO_PARAMS.realEstateAppreciationPct);
});

// --- ESCALA DEL AHORRO POR TRAMOS ---

test('ahorro: cada tramo grava solo la parte que le toca', () => {
  // 6.000 al 19% = 1.140.
  assert.equal(savingsTaxOnIncome(6000), 1140);
  // 6.000 al 19% + 4.000 al 21% = 1.140 + 840.
  assert.equal(savingsTaxOnIncome(10000), 1980);
  // Hasta 50.000: 1.140 + 44.000 al 21% = 10.380.
  assert.equal(savingsTaxOnIncome(50000), 10380);
  // Hasta 200.000: 10.380 + 150.000 al 23% = 44.880.
  assert.equal(savingsTaxOnIncome(200000), 44880);
  // 350.000: 44.880 + 100.000 al 27% + 50.000 al 30% = 86.880.
  assert.equal(savingsTaxOnIncome(350000), 86880);
});

test('ahorro: sin renta no hay cuota', () => {
  assert.equal(savingsTaxOnIncome(0), 0);
  assert.equal(savingsTaxOnIncome(-5000), 0, 'una renta negativa no genera cuota');
  assert.equal(effectiveSavingsTaxPct(0), 0);
});

test('ahorro: el tipo medio sube con la renta, sin saltos bruscos', () => {
  const rentas = [1000, 6000, 20000, 60000, 150000, 250000, 400000];
  const tipos = rentas.map(r => effectiveSavingsTaxPct(r));
  for (let i = 1; i < tipos.length; i++) {
    assert.ok(tipos[i] >= tipos[i - 1], `el tipo medio baja de ${rentas[i-1]} a ${rentas[i]}`);
  }
  assert.equal(Math.round(tipos[0] * 100) / 100, 19, 'la primera renta va toda al 19%');
  assert.ok(tipos[tipos.length - 1] < 30, 'el tipo medio nunca llega al marginal máximo');
});

test('ahorro: el tipo medio nunca sale de la horquilla de la escala', () => {
  for (const renta of [500, 7000, 80000, 1000000]) {
    const tipo = effectiveSavingsTaxPct(renta);
    assert.ok(tipo >= 19 && tipo <= 30, `${renta} -> ${tipo}%`);
  }
});

test('ahorro: solo bolsa y caja generan renta del ahorro', () => {
  const p = DEFAULT_MACRO_PARAMS;
  assert.equal(assetSavingsIncome({ subcategory: 'cash', value: 10000, cashReturnPct: 3 }, p), 300);
  assert.equal(assetSavingsIncome({ subcategory: 'stocks', value: 10000, cashReturnPct: 2 }, p), 200);
  // Los inmuebles tributan en su propio cálculo y las pensiones no reparten.
  assert.equal(assetSavingsIncome({ subcategory: 'real_estate', value: 200000, cashReturnPct: 4 }, p), 0);
  assert.equal(assetSavingsIncome({ subcategory: 'pensions', value: 50000, cashReturnPct: 4 }, p), 0);
  assert.equal(assetSavingsIncome({ subcategory: 'tangibles', value: 10000, cashReturnPct: 4 }, p), 0);
  // Un rendimiento negativo es un coste, no una renta.
  assert.equal(assetSavingsIncome({ subcategory: 'cash', value: 10000, cashReturnPct: -1 }, p), 0);
});

test('ahorro: el tipo medio inyectado manda sobre el plano guardado', () => {
  const activo = { subcategory: 'cash', value: 100000, cashReturnPct: 5 };
  const conPlano = assetAnnualCashflow(activo, { ...DEFAULT_MACRO_PARAMS, savingsTaxRatePct: 21 });
  const conEscala = assetAnnualCashflow(activo, { ...DEFAULT_MACRO_PARAMS, savingsTaxRatePct: 21 }, 19.8);
  assert.equal(conPlano.taxRatePct, 21);
  assert.equal(conEscala.taxRatePct, 19.8);
  assert.ok(conEscala.net > conPlano.net, 'un tipo menor deja más neto');
});

test('ahorro: sin tipo inyectado se conserva el comportamiento anterior', () => {
  const activo = { subcategory: 'stocks', value: 10000, cashReturnPct: 4 };
  const r = assetAnnualCashflow(activo, { ...DEFAULT_MACRO_PARAMS, savingsTaxRatePct: 21 });
  assert.equal(r.gross, 400);
  assert.equal(r.taxRatePct, 21);
  assert.ok(Math.abs(r.net - 316) < 0.01);
});

test('ahorro: la escala está ordenada y termina en infinito', () => {
  let previo = 0;
  for (const b of SAVINGS_TAX_BRACKETS) {
    assert.ok(b.upTo > previo, 'los techos suben');
    previo = b.upTo;
  }
  assert.equal(SAVINGS_TAX_BRACKETS[SAVINGS_TAX_BRACKETS.length - 1].upTo, Infinity);
});

// --- HIPOTECAS VARIABLES Y SALDO REAL (A1) ---

test('tipo efectivo: una hipoteca fija ignora el euríbor', () => {
  const fija = { subcategory: 'mortgages', interestRatePct: 2.5 };
  assert.equal(effectiveInterestRatePct(fija, 3.0), 2.5);
  assert.equal(effectiveInterestRatePct(fija, null), 2.5);
});

test('tipo efectivo: una variable es euríbor más diferencial', () => {
  const variable = { subcategory: 'mortgages', rateType: 'variable', spreadPct: 0.9, interestRatePct: 2.5 };
  assert.ok(Math.abs(effectiveInterestRatePct(variable, 2.3) - 3.2) < 1e-9);
  assert.ok(Math.abs(effectiveInterestRatePct(variable, 0) - 0.9) < 1e-9);
  // El euríbor estuvo años en negativo: tiene que restar de verdad.
  assert.ok(Math.abs(effectiveInterestRatePct(variable, -0.5) - 0.4) < 1e-9);
});

test('tipo efectivo: sin euríbor la variable cae al tipo guardado', () => {
  const variable = { subcategory: 'mortgages', rateType: 'variable', spreadPct: 0.9, interestRatePct: 3.1 };
  assert.equal(effectiveInterestRatePct(variable, null), 3.1);
  assert.equal(effectiveInterestRatePct(variable, undefined), 3.1);
  assert.equal(effectiveInterestRatePct(variable, NaN), 3.1);
});

test('saldo real: el que escribe el usuario manda sobre el cuadro', () => {
  const ahora = new Date(2026, 8, 1);
  const base = { subcategory: 'mortgages', initialPrincipal: 150000, durationMonths: 300, interestRatePct: 2.5, startDate: '2022-01' };
  const calculado = resolveLiability(base, ahora);
  const anclado = resolveLiability({ ...base, balanceOverride: 120000 }, ahora);

  assert.equal(anclado.value, 120000);
  assert.equal(anclado.isAnchored, true);
  assert.equal(calculado.isAnchored, false);
  assert.notEqual(calculado.value, 120000, 'sin ancla sale el saldo del cuadro');
});

test('saldo real: la cuota se recalcula sobre el saldo fijado', () => {
  const ahora = new Date(2026, 8, 1);
  const base = { subcategory: 'mortgages', initialPrincipal: 150000, durationMonths: 300, interestRatePct: 2.5, startDate: '2022-01' };
  const calc = calculateLoanAmortization(150000, 2.5, 300, '2022-01', ahora);
  const anclado = resolveLiability({ ...base, balanceOverride: 120000 }, ahora);

  const esperada = paymentForBalance(120000, 2.5, calc.monthsRemaining);
  assert.equal(anclado.monthlyPayment, esperada);
  // Un saldo menor que el del cuadro da una cuota menor sobre el mismo plazo.
  assert.ok(anclado.monthlyPayment < calc.monthlyPayment);
});

test('saldo real: un cero o un negativo no cuentan como ancla', () => {
  const ahora = new Date(2026, 8, 1);
  const base = { subcategory: 'mortgages', initialPrincipal: 150000, durationMonths: 300, interestRatePct: 2.5, startDate: '2022-01' };
  for (const v of [0, -5000, null, undefined, NaN]) {
    assert.equal(resolveLiability({ ...base, balanceOverride: v }, ahora).isAnchored, false, `ancla ${v}`);
  }
});

test('saldo real: la sincronización ya no lo pisa', () => {
  const [hipoteca] = syncLiabilitiesAmortization([
    { subcategory: 'mortgages', initialPrincipal: 150000, durationMonths: 300, interestRatePct: 2.5, startDate: '2022-01', balanceOverride: 111111 }
  ]);
  assert.equal(hipoteca.value, 111111, 'el saldo del extracto sobrevive al guardado');
});

test('saldo real: sin ancla la sincronización sigue calculando como antes', () => {
  const [hipoteca] = syncLiabilitiesAmortization([
    { subcategory: 'mortgages', initialPrincipal: 130000, durationMonths: 300, interestRatePct: 2.4, startDate: '2023-07' }
  ]);
  assert.ok(hipoteca.value < 130000 && hipoteca.value > 100000);
});

test('variable: un euríbor mayor deja más saldo vivo y más cuota', () => {
  const ahora = new Date(2026, 8, 1);
  const l = { subcategory: 'mortgages', initialPrincipal: 200000, durationMonths: 300, rateType: 'variable', spreadPct: 0.9, interestRatePct: 2, startDate: '2022-01' };
  const barato = resolveLiability(l, ahora, { euriborPct: 1.0 });
  const caro = resolveLiability(l, ahora, { euriborPct: 4.0 });
  assert.ok(caro.monthlyPayment > barato.monthlyPayment);
  assert.ok(caro.value > barato.value, 'a más tipo, más lento amortiza');
});

test('paymentForBalance: sin intereses reparte el saldo entre los meses', () => {
  assert.equal(paymentForBalance(12000, 0, 12), 1000);
  assert.equal(paymentForBalance(0, 3, 12), 0);
});

test('cuadro: informa de los meses transcurridos y los que quedan', () => {
  const c = calculateLoanAmortization(150000, 2.5, 300, '2022-01', new Date(2026, 8, 1));
  assert.equal(c.monthsElapsed, 56);
  assert.equal(c.monthsRemaining, 244);
  assert.equal(c.monthsElapsed + c.monthsRemaining, 300);
});

test('backup: el tipo variable y el ancla sobreviven al viaje', () => {
  const original = [{ id: 'l1', name: 'Variable', subcategory: 'mortgages', currency: 'EUR',
    initialPrincipal: 200000, durationMonths: 300, startDate: '2022-01', interestRatePct: 3.2,
    rateType: 'variable', spreadPct: 0.9, balanceOverride: 172500 }];
  const [vuelta] = deserializeLiabilities(serializeLiabilities(original, { baseCurrency: 'EUR' }));
  assert.equal(vuelta.rateType, 'variable');
  assert.equal(vuelta.spreadPct, 0.9);
  assert.equal(vuelta.balanceOverride, 172500);
  assert.equal(vuelta.value, 172500, 'el ancla manda también al importar');
});

test('backup: una hipoteca de un fichero antiguo vuelve como fija', () => {
  const [vuelta] = deserializeLiabilities([
    { id: 'l1', name: 'Antigua', subcategory: 'mortgages', initialPrincipal: 100000, durationMonths: 240, startDate: '2020-06', interestRatePct: 1.9 }
  ]);
  assert.equal(vuelta.rateType, 'fixed');
  assert.equal(vuelta.balanceOverride, undefined, 'un cero guardado no es un ancla');
  assert.ok(vuelta.value > 0 && vuelta.value < 100000);
});

// --- VALOR DE LIQUIDACIÓN ---

test('liquidación: el coste declarado manda sobre el supuesto', () => {
  const p = { ...DEFAULT_MACRO_PARAMS, assumedUnrealizedGainPct: 30 };
  assert.equal(assetAcquisitionCost({ value: 130000, acquisitionCost: 90000 }, p), 90000);
  // Sin declararlo: 130.000 con un 30% supuesto de plusvalía costó 100.000.
  assert.ok(Math.abs(assetAcquisitionCost({ value: 130000 }, p) - 100000) < 0.01);
});

test('liquidación: un cero declarado no cuenta como coste', () => {
  const p = { ...DEFAULT_MACRO_PARAMS, assumedUnrealizedGainPct: 30 };
  assert.ok(Math.abs(assetAcquisitionCost({ value: 130000, acquisitionCost: 0 }, p) - 100000) < 0.01);
});

test('liquidación: solo bolsa e inmuebles tienen plusvalía', () => {
  const p = DEFAULT_MACRO_PARAMS;
  assert.ok(assetCapitalGain({ subcategory: 'stocks', value: 130000 }, p) > 0);
  assert.ok(assetCapitalGain({ subcategory: 'real_estate', value: 200000 }, p) > 0);
  assert.equal(assetCapitalGain({ subcategory: 'cash', value: 50000 }, p), 0);
  assert.equal(assetCapitalGain({ subcategory: 'pensions', value: 50000 }, p), 0);
  assert.equal(assetCapitalGain({ subcategory: 'tangibles', value: 12000 }, p), 0);
});

test('liquidación: una posición en pérdidas no genera plusvalía negativa', () => {
  const p = DEFAULT_MACRO_PARAMS;
  assert.equal(assetCapitalGain({ subcategory: 'stocks', value: 50000, acquisitionCost: 80000 }, p), 0);
});

test('liquidación: cada clase pierde lo suyo al venderse', () => {
  const p = { ...DEFAULT_MACRO_PARAMS, propertySellingCostsPct: 8, pensionWithdrawalTaxPct: 37, tangiblesHaircutPct: 25 };
  assert.equal(assetGrossLiquidation({ subcategory: 'cash', value: 20000 }, p), 20000, 'la caja sale entera');
  assert.equal(assetGrossLiquidation({ subcategory: 'stocks', value: 100000 }, p), 100000, 'la bolsa paga solo la plusvalía, aparte');
  assert.ok(Math.abs(assetGrossLiquidation({ subcategory: 'real_estate', value: 200000 }, p) - 184000) < 0.01);
  assert.ok(Math.abs(assetGrossLiquidation({ subcategory: 'pensions', value: 50000 }, p) - 31500) < 0.01);
  assert.ok(Math.abs(assetGrossLiquidation({ subcategory: 'tangibles', value: 12000 }, p) - 9000) < 0.01);
});

test('liquidación: cancelar una hipoteca cuesta el saldo más la comisión', () => {
  const p = { ...DEFAULT_MACRO_PARAMS, earlyRepaymentFeePct: 0.25 };
  const hipoteca = { subcategory: 'mortgages' };
  assert.ok(Math.abs(liabilityCancellationCost(hipoteca, p, { value: 100000 }) - 100250) < 0.01);
  // Una tarjeta se paga y ya: no hay comisión de amortización anticipada.
  assert.equal(liabilityCancellationCost({ subcategory: 'short_term' }, p, { value: 3000 }), 3000);
});

test('liquidación: el coste de adquisición sobrevive al backup y llena purchasePrice', () => {
  const original = [{ id: 'a1', name: 'Indexado', subcategory: 'stocks', value: 130000, acquisitionCost: 90000 }];
  const fichero = serializeAssets(original, { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS });
  assert.equal(fichero[0].acquisitionCost, 90000);
  assert.equal(fichero[0].purchasePrice, 90000, 'el campo que lee Retire deja de inventarse');

  const [vuelta] = deserializeAssets(fichero, DEFAULT_MACRO_PARAMS);
  assert.equal(vuelta.acquisitionCost, 90000);
});

test('liquidación: sin coste declarado, Retiro aplica su propia plusvalía latente', () => {
  // Antes se inventaba el 75% del valor también en bolsa. Retiro supone el 85% (crecimiento),
  // el 90% (dividendo) o el 95% (renta fija), así que una cartera suya que pasaba por aquí
  // volvía con más plusvalía de la que tenía, pagaba más impuesto en cada venta y movía la
  // proyección entera. Lo encontró la ida y vuelta real entre las dos aplicaciones.
  const fichero = serializeAssets(
    [
      { id: 'a1', name: 'Indexado', subcategory: 'stocks', value: 100000 },
      { id: 'a2', name: 'Piso', subcategory: 'real_estate', value: 200000, useType: 'rented' }
    ],
    { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS }
  );
  assert.equal(fichero[0].purchasePrice, undefined, 'en bolsa no se inventa: decide Retiro');
  assert.equal(fichero[1].purchasePrice, 150000, 'en un inmueble, el 75% que supondría Retiro de todos modos');
  const [vuelta] = deserializeAssets(fichero, DEFAULT_MACRO_PARAMS);
  assert.equal(vuelta.acquisitionCost, undefined);
});

// --- COMPATIBILIDAD CON RETIRO ---
// El formato de copia se comparte con Retiro (pacolucena.com/retiro). Estas
// pruebas fijan lo que cada herramienta necesita de la otra, para que un
// cambio aquí no rompa allí en silencio: Retiro no tiene pruebas que avisen.

// Una copia de Retiro con su forma real, incluidos los campos que aquí no se
// usan. Los valores son los de su balance de ejemplo.
function copiaDeRetiro() {
  return {
    version: '12.4',
    familyExpenses: { food: 200, clothes: 70, supplies_p: 80, transport: 200, other_p: 100,
                      supplies_h: 250, subs: 50, otherHouse: 0, rent_imputed: 1200,
                      housekeeper: 0, vacations: 3000, vehicle: 2000, otherFixed: 0 },
    assetsData: [
      { id: 'cash_1', name: 'Cuenta Conjunta', category: 'cash', owner: 'joint', currency: 'EUR', value: 15000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 0 },
      { id: 'stock_4', name: 'Cartera Dividendo', category: 'divStocks', owner: 'joint', currency: 'EUR', value: 8000, cashReturnPct: 3.5, useReturnPct: 0, capitalReturnPct: 4 },
      { id: 're_1', name: 'Vivienda Habitual', category: 'real_estate', owner: 'joint', currency: 'EUR', value: 400000, purchasePrice: 280000, purchaseDate: '2019-06', monthlyRent: 0, useType: 'habitual', opexPct: 0, hasMaint: true },
      { id: 'pen_2', name: 'Plan Individual', category: 'pensions', owner: 'p2', currency: 'EUR', value: 6000, capitalReturnPct: 5, isActivePP: true },
      { id: 'sim_1', name: 'Comprado en simulación', category: 'stocks', owner: 'p1', currency: 'EUR', value: 99999, isPurchasedInSim: true }
    ],
    liabilitiesData: [
      { id: 'liab_1', name: 'Hipoteca Habitual', propertyLink: 're_1', currency: 'EUR', subcategory: 'mortgages', initialPrincipal: 220000, startDate: '2019-06', durationMonths: 300, interestRatePct: 2.1, monthlyPayment: 0 },
      { id: 'mort_re_buy_2032', name: 'Hipoteca simulada', propertyLink: 're_1', currency: 'EUR', subcategory: 'mortgages', initialPrincipal: 500000, durationMonths: 300 }
    ],
    exchangeRates: { EUR: 1 },
    macro: { stockGrowth: '7', divYield: '3', cashYield: '1.5', inflation: '2.5', propertyInflation: '3', rentInflation: '2.5' }
  };
}

const estadoBalance = (extra = {}) => ({
  assets: [
    { id: 'a1', name: 'Cuenta', subcategory: 'cash', currency: 'EUR', value: 20000, cashReturnPct: 2 },
    { id: 'a2', name: 'Piso', subcategory: 'real_estate', currency: 'EUR', value: 180000, monthlyRent: 900, useType: 'rented' },
    { id: 'a3', name: 'Repsol', subcategory: 'stocks', currency: 'EUR', value: 9000, cashReturnPct: 5.2, capitalReturnPct: 3 }
  ],
  liabilities: [
    { id: 'l1', name: 'Hipoteca', subcategory: 'mortgages', currency: 'EUR', initialPrincipal: 150000, startDate: '2022-01', durationMonths: 300, interestRatePct: 2.5 }
  ],
  expenses: { person_monthly: { food: 300 }, household_monthly: { supplies: 200 }, family_annual: { vacations: 2000 } },
  macroParams: DEFAULT_MACRO_PARAMS, baseCurrency: 'EUR', selectedCountry: 'es_urban',
  familyMembers: 2, exchangeRates: { EUR: 1 },
  ...extra
});

test('Retiro: un export de Balance trae lo que Retiro lee de cada activo', () => {
  const f = buildExportPayload(estadoBalance());
  for (const a of f.assetsData) {
    for (const campo of ['id', 'name', 'category', 'currency', 'value',
                         'cashReturnPct', 'useReturnPct', 'capitalReturnPct']) {
      assert.ok(campo in a, `al activo ${a.id} le falta ${campo}`);
    }
  }
  const piso = f.assetsData.find(a => a.category === 'real_estate');
  for (const campo of ['purchasePrice', 'monthlyRent', 'useType', 'opexPct', 'hasMaint']) {
    assert.ok(campo in piso, `al inmueble le falta ${campo}`);
  }
});

test('Retiro: un export de Balance trae lo que Retiro lee de cada deuda', () => {
  const f = buildExportPayload(estadoBalance());
  for (const l of f.liabilitiesData) {
    for (const campo of ['id', 'name', 'propertyLink', 'currency', 'subcategory', 'initialPrincipal',
                         'startDate', 'durationMonths', 'interestRatePct', 'monthlyPayment', 'noMonthlyPayment']) {
      assert.ok(campo in l, `a la deuda ${l.id} le falta ${campo}`);
    }
  }
});

test('Retiro: las claves de nivel superior son las que Retiro busca', () => {
  const f = buildExportPayload(estadoBalance());
  for (const clave of ['assetsData', 'liabilitiesData', 'familyExpenses', 'macro', 'exchangeRates']) {
    assert.ok(clave in f, `falta ${clave}`);
  }
});

test('Retiro: una acción que reparte mucho sale como divStocks, que Retiro entiende', () => {
  const f = buildExportPayload(estadoBalance());
  assert.equal(f.assetsData.find(a => a.name === 'Repsol').category, 'divStocks');
  // Y al volver es otra vez una acción normal.
  const vuelta = deserializeAssets(f.assetsData, DEFAULT_MACRO_PARAMS);
  assert.equal(vuelta.find(a => a.name === 'Repsol').subcategory, 'stocks');
});

test('Retiro: la revalorización del ladrillo viaja con los dos nombres', () => {
  const f = buildExportPayload(estadoBalance({
    macroParams: { ...DEFAULT_MACRO_PARAMS, realEstateAppreciationPct: 3.4 }
  }));
  // Retiro lee `propertyInflation`; Balance, `reAppreciation`.
  assert.equal(f.macro.propertyInflation, 3.4);
  assert.equal(f.macro.reAppreciation, 3.4);
  assert.equal(deserializeMacro({ inflation: 2, propertyInflation: 3.4 }).realEstateAppreciationPct, 3.4);
});

test('Retiro: importar una copia suya descarta lo que solo existe en su simulación', () => {
  const r = parseImportPayload(copiaDeRetiro(), { expenseFallback: {} });
  assert.equal(r.assets.length, 4, 'el activo comprado en simulación no entra');
  assert.ok(!r.assets.some(a => a.name.includes('simulación')));
  assert.equal(r.liabilities.length, 1, 'la hipoteca de una compra simulada tampoco');
  assert.ok(!r.liabilities.some(l => String(l.id).startsWith('mort_re_buy_')));
});

test('Retiro: importar una copia suya no deja ningún número roto', () => {
  const r = parseImportPayload(copiaDeRetiro(), { expenseFallback: {} });
  const rotos = [];
  const recorrer = (o, ruta = '') => Object.entries(o || {}).forEach(([k, v]) => {
    if (v && typeof v === 'object') recorrer(v, ruta + k + '.');
    else if (typeof v === 'number' && !Number.isFinite(v)) rotos.push(ruta + k);
  });
  recorrer(r);
  assert.deepEqual(rotos, [], `valores no finitos: ${rotos.join(', ')}`);
});

test('Retiro: ida y vuelta por Balance sin perder lo que solo usa Retiro', () => {
  const original = copiaDeRetiro();
  const dentro = parseImportPayload(original, { expenseFallback: {} });
  const fuera = buildExportPayload({
    assets: dentro.assets, liabilities: dentro.liabilities, expenses: dentro.expenses,
    macroParams: dentro.macroParams, baseCurrency: 'EUR', selectedCountry: 'es_urban',
    familyMembers: dentro.familyMembers ?? 2, exchangeRates: { EUR: 1 }
  });

  const piso = fuera.assetsData.find(a => a.id === 're_1');
  assert.equal(piso.owner, 'joint', 'el titular no se pierde');
  assert.equal(piso.purchaseDate, '2019-06', 'la fecha de compra no se pierde');
  assert.equal(piso.purchasePrice, 280000, 'el coste real no se sustituye por la estimación del 75%');

  const plan = fuera.assetsData.find(a => a.id === 'pen_2');
  assert.equal(plan.owner, 'p2');
  assert.equal(plan.isActivePP, true, 'si el plan sigue aportando no se pierde');

  const hipoteca = fuera.liabilitiesData.find(l => l.id === 'liab_1');
  assert.equal(hipoteca.propertyLink, 're_1', 'el vínculo con el inmueble no se pierde');

  assert.equal(fuera.macro.propertyInflation, 3);
  assert.equal(fuera.familyExpenses.food, 200);
  assert.equal(fuera.familyExpenses.vehicle, 2000);
});

test('Retiro: la estimación del 75% no se cuela como coste declarado', () => {
  // Un export de Balance sin coste declarado lleva purchasePrice inventado.
  const f = buildExportPayload(estadoBalance());
  const piso = f.assetsData.find(a => a.category === 'real_estate');
  assert.equal(piso.purchasePrice, 180000 * 0.75);
  assert.equal(piso.acquisitionCost, 0, 'el cero dice «no lo sé»');
  // Al volver a entrar no debe convertirse en un dato real.
  const [vuelta] = deserializeAssets([piso], DEFAULT_MACRO_PARAMS);
  assert.equal(vuelta.acquisitionCost, undefined);
});

// --- IDA Y VUELTA DE LOS PARÁMETROS PROPIOS DE BALANCE ---
// Retiro no conoce estos campos y no pasan por su formato, así que hay que
// comprobar que sobreviven al guardar y volver a cargar.

test('la comunidad y el número de contribuyentes sobreviven al exportar e importar', () => {
  const antes = {
    ...DEFAULT_MACRO_PARAMS,
    wealthTaxRegion: 'cataluna',
    wealthTaxPayers: 2,
    wealthTaxExemption: 450000,
    wealthTaxBonificationPct: 15,
    pensionWithdrawalTaxPct: 45,
    tangiblesHaircutPct: 40
  };
  const despues = deserializeMacro(serializeMacro(antes));
  assert.equal(despues.wealthTaxRegion, 'cataluna');
  assert.equal(despues.wealthTaxPayers, 2);
  assert.equal(despues.wealthTaxExemption, 450000);
  assert.equal(despues.wealthTaxBonificationPct, 15);
  assert.equal(despues.pensionWithdrawalTaxPct, 45);
  assert.equal(despues.tangiblesHaircutPct, 40);
});

test('un ajuste vacío vuelve vacío, no convertido en cero', () => {
  // Es la diferencia entre «usa el mínimo exento de tu comunidad» y «no tienes
  // mínimo exento». Number(null) da 0 y se llevaría por delante lo segundo.
  const despues = deserializeMacro(serializeMacro({
    ...DEFAULT_MACRO_PARAMS, wealthTaxExemption: null, wealthTaxBonificationPct: null
  }));
  assert.equal(despues.wealthTaxExemption, null);
  assert.equal(despues.wealthTaxBonificationPct, null);

  // Un cero explícito sí es un cero.
  const cero = deserializeMacro(serializeMacro({ ...DEFAULT_MACRO_PARAMS, wealthTaxBonificationPct: 0 }));
  assert.equal(cero.wealthTaxBonificationPct, 0);
});

test('un fichero de Retiro, sin estos campos, cae en los valores por defecto', () => {
  const deRetiro = { inflation: 2.5, stockGrowth: 7, marginalTax: 30 };
  const m = deserializeMacro(deRetiro);
  assert.equal(m.wealthTaxRegion, DEFAULT_MACRO_PARAMS.wealthTaxRegion);
  assert.equal(m.wealthTaxPayers, 1);
  assert.equal(m.wealthTaxExemption, null);
  assert.equal(m.inflationPct, 2.5);
});

// --- PRÉSTAMO FAMILIAR SIN CUOTA MENSUAL ---
// Una fianza de alquiler o un préstamo de un familiar no se devuelven a
// plazos. Aquí no hay fecha de inicio ni cuadro de amortización: lo que se
// escribe es el saldo que queda hoy, y marcada la casilla no se paga nada.

test('un préstamo familiar sin cuota conserva su saldo y no paga nada', () => {
  const r = resolveLiability({
    subcategory: 'family_loans', value: 5500, interestRatePct: 0,
    monthlyPayment: 458, noMonthlyPayment: true
  });
  assert.equal(r.value, 5500, 'el saldo escrito es el saldo, no se amortiza');
  assert.equal(r.monthlyPayment, 0, 'una cuota heredada no debe sobrevivir a la casilla');
  assert.equal(r.noMonthlyPayment, true);
});

test('sin la casilla, el préstamo familiar sigue pagando su cuota', () => {
  const r = resolveLiability({
    subcategory: 'family_loans', value: 5500, interestRatePct: 0, monthlyPayment: 458
  });
  assert.equal(r.value, 5500);
  assert.equal(r.monthlyPayment, 458);
  assert.equal(r.noMonthlyPayment, false);
});

test('la casilla no toca a hipotecas ni a préstamos personales', () => {
  // Se marcaba antes en la ficha equivocada. Estas dos siguen pagando cuota
  // aunque el campo venga puesto en un fichero antiguo.
  const hoy = new Date(2026, 0, 1);
  const personal = resolveLiability({
    subcategory: 'personal_loans', initialPrincipal: 8000,
    durationMonths: 36, interestRatePct: 4.9, noMonthlyPayment: true
  }, hoy);
  assert.ok(personal.monthlyPayment > 0, `debería pagar cuota, paga ${personal.monthlyPayment}`);
  assert.equal(personal.noMonthlyPayment, false);

  const hipoteca = resolveLiability({
    subcategory: 'mortgages', initialPrincipal: 130000, startDate: '2022-01',
    durationMonths: 300, interestRatePct: 2.4, noMonthlyPayment: true
  }, hoy);
  assert.ok(hipoteca.monthlyPayment > 0);
  assert.ok(hipoteca.value < 130000, 'la hipoteca sigue amortizando');
});

// --- PRÉSTAMO PERSONAL: SALDO DE HOY, NO CUADRO DESDE EL PRINCIPIO ---
// Ya no arrastra fecha de inicio. Lo que se escribe es lo que se debe hoy y el
// plazo es lo que falta; la cuota sale de esos dos números.

test('el préstamo personal vale lo que se ha escrito, sin amortizar hacia atrás', () => {
  const r = resolveLiability({
    subcategory: 'personal_loans', initialPrincipal: 8000,
    durationMonths: 36, interestRatePct: 4.9
  }, new Date(2026, 0, 1));
  assert.equal(r.value, 8000, 'el saldo escrito es el saldo');
  // Cuota francesa de 8.000 a 36 meses al 4,9%: 239,63 €.
  assert.ok(Math.abs(r.monthlyPayment - 239.63) < 0.5, `cuota ${r.monthlyPayment}`);
  assert.equal(r.isAnchored, false);
});

test('el préstamo personal ignora fecha y saldo real si vienen de antes', () => {
  // Un balance guardado con el modelo anterior trae los dos campos. No pueden
  // cambiar el resultado, o la misma deuda valdría cosas distintas según la
  // antigüedad del fichero.
  const base = { subcategory: 'personal_loans', initialPrincipal: 8000, durationMonths: 36, interestRatePct: 4.9 };
  const limpio = resolveLiability(base, new Date(2026, 0, 1));
  const conRestos = resolveLiability(
    { ...base, startDate: '2020-01', balanceOverride: 3000 }, new Date(2026, 0, 1));
  assert.equal(conRestos.value, limpio.value);
  assert.equal(conRestos.monthlyPayment, limpio.monthlyPayment);
});

test('sin plazo el préstamo personal sigue debiéndose, pero no paga cuota', () => {
  const r = resolveLiability({ subcategory: 'personal_loans', initialPrincipal: 8000, durationMonths: 0 });
  assert.equal(r.value, 8000, 'la deuda no desaparece por no saber el plazo');
  assert.equal(r.monthlyPayment, 0);
});

test('un préstamo personal que llega de fuera se traduce a saldo de hoy', () => {
  // Retiro manda el principal ORIGINAL y su fecha. Aquí initialPrincipal
  // significa otra cosa, así que hay que correr su cuadro hasta hoy o la deuda
  // entraría inflada.
  const hace24Meses = new Date();
  hace24Meses.setMonth(hace24Meses.getMonth() - 24);
  const inicio = `${hace24Meses.getFullYear()}-${String(hace24Meses.getMonth() + 1).padStart(2, '0')}`;

  const [out] = deserializeLiabilities([{
    id: 'l1', name: 'Préstamo coche', subcategory: 'personal_loans',
    initialPrincipal: 20000, startDate: inicio, durationMonths: 48, interestRatePct: 5
  }]);
  assert.ok(out.initialPrincipal < 20000, `debería entrar el saldo de hoy, entró ${out.initialPrincipal}`);
  assert.ok(out.initialPrincipal > 8000, 'y no un saldo absurdo');
  assert.equal(out.durationMonths, 24, 'con los meses que quedan, no los originales');
  assert.equal(out.value, out.initialPrincipal);
});

test('al exportar, el préstamo personal lleva la fecha de hoy', () => {
  // Fuera de aquí un préstamo sin fecha se coloca en enero y se da por medio
  // amortizado. Escribiendo la de hoy, el saldo y el plazo que van en el
  // fichero significan lo mismo a los dos lados.
  const hoy = new Date();
  const esperada = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const [out] = serializeLiabilities(
    [{ name: 'x', subcategory: 'personal_loans', initialPrincipal: 8000, durationMonths: 36, interestRatePct: 4.9 }],
    { baseCurrency: 'EUR' });
  assert.equal(out.startDate, esperada);
  assert.equal(out.initialPrincipal, 8000);

  // La hipoteca conserva la suya.
  const [hip] = serializeLiabilities(
    [{ name: 'h', subcategory: 'mortgages', initialPrincipal: 130000, startDate: '2022-03', durationMonths: 300 }],
    { baseCurrency: 'EUR' });
  assert.equal(hip.startDate, '2022-03');
});

test('un préstamo familiar sin plazo no rompe la sincronización', () => {
  const [out] = syncLiabilitiesAmortization([{
    id: 'x', subcategory: 'family_loans', value: 5500,
    interestRatePct: 0, monthlyPayment: 0, noMonthlyPayment: true
  }]);
  assert.equal(out.value, 5500);
  assert.equal(out.monthlyPayment, 0);
});
