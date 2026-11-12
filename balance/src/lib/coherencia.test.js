// Pruebas de la revisión B1: sitios donde dos caminos del código decían cosas
// distintas del mismo dato (interfaz contra barrido, ficha contra fichero,
// motor contra auditoría) o donde un cero deliberado se leía como ausencia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeBalance, entradaAuditoria } from './engine.js';
import { buildAudit } from './audit.js';
import { buildAssumptions } from './assumptions.js';
import { wealthTaxDue } from './wealthTax.js';
import {
  DEFAULT_MACRO_PARAMS, savingsTaxOnIncome, resolveLiability, syncAssetRatesToMacro, calculateRealEstateReturns,
  assetGrossLiquidation, deserializeMacro, serializeMacro, clampParam,
  parseImportPayload, serializeLiabilities, deserializeLiabilities,
  deserializeAssets, restoreDeleted, listaDeObjetos, summarizeImport, evaluarEntrada, MAX_CONTRIBUYENTES
} from './finance.js';

const RATES = { EUR: 1.0, USD: 1.1621, GBP: 0.8587 };
const base = (extra = {}) => ({
  assets: [], liabilities: [], expenses: {}, familyMembers: 1,
  macroParams: DEFAULT_MACRO_PARAMS, baseCurrency: 'EUR', selectedCountry: 'es_urban',
  exchangeRates: RATES, ...extra
});

// --- 1. La auditoría de la interfaz y la del barrido son la misma ---

test('auditoría: la entrada lleva el desglose por clases, para que un bono no cuente como bolsa', () => {
  const esc = base({ assets: [
    { id: 'b', name: 'Bonos', subcategory: 'stocks', stockClass: 'bonds', stockType: 'fund', currency: 'EUR', value: 45000, cashReturnPct: 3 },
    { id: 'e', name: 'Bolsa', subcategory: 'stocks', stockClass: 'growth', stockType: 'fund', currency: 'EUR', value: 45000, capitalReturnPct: 6 },
    { id: 'c', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 10000, cashReturnPct: 1 }
  ] });
  const c = computeBalance(esc);
  const entrada = entradaAuditoria(c, esc);
  assert.deepEqual(entrada.assetClassTotals, c.assetClassTotals);
  assert.equal(entrada.assetClassTotals.fixed_income, 45000);
  assert.ok(Array.isArray(entrada.unremuneratedCash));
  assert.equal(entrada.holdings.length, 3);
  // Sin el desglose, el bloque 2 entero contaría como renta variable.
  const a = buildAudit(entrada);
  const sin = buildAudit({ ...entrada, assetClassTotals: null });
  assert.notDeepEqual(a.dimensions.find(d => d.id === 'diversification').detail,
    sin.dimensions.find(d => d.id === 'diversification').detail);
});

test('auditoría: la interfaz y el barrido construyen su entrada con la misma función', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const fuzz = readFileSync(new URL('./fuzz.js', import.meta.url), 'utf8');
  for (const [nombre, texto] of [['App.jsx', app], ['fuzz.js', fuzz]]) {
    assert.match(texto, /entradaAuditoria\(/, `${nombre} no usa entradaAuditoria`);
    assert.doesNotMatch(texto, /buildAudit\(\{/, `${nombre} arma la entrada a mano`);
  }
});

// --- 2. Un cero deliberado no es un campo vacío ---

test('inflación 0 se queda en 0, no vuelve a 2', () => {
  const c = computeBalance(base({ macroParams: { ...DEFAULT_MACRO_PARAMS, inflationPct: 0 } }));
  assert.equal(c.expectedInflationRate, 0);
  const vacio = computeBalance(base({ macroParams: { ...DEFAULT_MACRO_PARAMS, inflationPct: '' } }));
  assert.equal(vacio.expectedInflationRate, 2);
});

test('una retirada de pensión al 0 % se cuenta al 100 % del saldo en los supuestos', () => {
  const t = buildAssumptions({ macroParams: { ...DEFAULT_MACRO_PARAMS, pensionWithdrawalTaxPct: 0 } })
    .find(s => s.id === 'pensiones');
  assert.match(t.body_es, /al 100 % de su saldo, con un 0 % de impuesto/);
  assert.match(t.body_en, /at 100 % of balance, with 0 % tax/);
});

// --- 10. La deuda cara se mide como el resto del motor ---

test('deuda cara: usa el tipo efectivo y el saldo resuelto, no los guardados', () => {
  const euriborPct = 3.5;
  // Variable guardada con un tipo viejo del 1 %: hoy es 3,5 + 2,5 = 6 %.
  const variable = { id: 'm', name: 'Variable', subcategory: 'mortgages', currency: 'EUR', rateType: 'variable',
    spreadPct: 2.5, interestRatePct: 1, initialPrincipal: 100000, durationMonths: 240, startDate: '2024-01', value: 0 };
  // Tarjeta con un 9 % pero ya devuelta: saldo 0.
  const tarjeta = { id: 't', name: 'Tarjeta', subcategory: 'short_term', currency: 'EUR', interestRatePct: 9, value: 0 };
  const c = computeBalance(base({ liabilities: [variable, tarjeta], euriborPct }));
  assert.deepEqual(c.expensiveDebt.map(l => l.name), ['Variable']);
});

// --- 11. Impuesto de solidaridad: 700.000 € fijos ---

test('solidaridad: su base resta siempre 700.000 €, no el mínimo de la comunidad', () => {
  // Cataluña (mínimo 500.000) bonificada al 100 % para que mande la solidaridad.
  const r = wealthTaxDue({ netWorth: 3800000, regionKey: 'cataluna', bonificationPct: 100 });
  // Base de solidaridad 3.800.000 − 700.000 = 3.100.000: 1,7 % de los 100.000 que pasan de 3 M.
  assert.ok(Math.abs(r.solidarityQuota - 1700) < 0.01, `cuota ${r.solidarityQuota}`);
  assert.ok(Math.abs(r.annual - 1700) < 0.01);
  assert.equal(r.taxableBase, 3300000, 'la base autonómica sigue usando el mínimo de la comunidad');
});

// --- 12. Planes de pensiones exentos ---

test('patrimonio: los derechos consolidados de un plan de pensiones están exentos', () => {
  const plan = { id: 'p', name: 'Plan', subcategory: 'pensions', currency: 'EUR', value: 2000000, capitalReturnPct: 5 };
  const seguro = { ...plan, id: 's', name: 'Seguro', pensionType: 'insurance' };
  const conPlan = computeBalance(base({ assets: [plan] }));
  assert.equal(conPlan.wealthTax.annual, 0, 'un plan de dos millones no tributa');
  assert.equal(conPlan.netWorth, 2000000, 'el patrimonio neto sigue contándolo');
  assert.equal(conPlan.wealthTax.exemptAssetsTotal, 2000000);
  const conSeguro = computeBalance(base({ assets: [seguro] }));
  assert.ok(conSeguro.wealthTax.annual > 0, 'el seguro de ahorro sí');
});

test('patrimonio: los supuestos explican la exención de los planes', () => {
  const t = buildAssumptions({ macroParams: DEFAULT_MACRO_PARAMS }).find(s => s.id === 'patrimonio');
  assert.match(t.body_es, /planes de pensiones/);
  assert.match(t.body_en, /pension plans/);
});

// --- 13. Una sola base del ahorro ---

test('liquidación: la plusvalía se suma a los dividendos en una sola base del ahorro', () => {
  const esc = base({ assets: [
    { id: 'a', name: 'Dividendos', subcategory: 'stocks', stockType: 'fund', stockClass: 'dividend', currency: 'EUR', value: 400000, cashReturnPct: 5, acquisitionCost: 400000 },
    { id: 'b', name: 'Crecimiento', subcategory: 'stocks', stockType: 'fund', stockClass: 'growth', currency: 'EUR', value: 100000, acquisitionCost: 50000 }
  ] });
  const c = computeBalance(esc);
  assert.equal(c.grossSavingsIncome, 20000);
  assert.equal(c.totalCapitalGain, 50000);
  const esperado = savingsTaxOnIncome(70000) - savingsTaxOnIncome(20000);
  assert.ok(Math.abs(c.capitalGainsTax - esperado) < 0.01, `${c.capitalGainsTax} ≠ ${esperado}`);
  // Más cara que si la plusvalía tributara sola desde el primer tramo.
  assert.ok(c.capitalGainsTax > savingsTaxOnIncome(50000));
});

// --- 14. Hipoteca con la casilla «sin cuota» ---

test('hipoteca marcada «sin cuota»: la exportación dice lo mismo que el motor', () => {
  const l = { id: 'm', name: 'H', subcategory: 'mortgages', initialPrincipal: 130000, startDate: '2022-01',
    durationMonths: 300, interestRatePct: 2.4, noMonthlyPayment: true, monthlyPayment: 600, value: 100000 };
  const r = resolveLiability(l);
  assert.ok(r.monthlyPayment > 0 && r.noMonthlyPayment === false);
  const [s] = serializeLiabilities([l], { baseCurrency: 'EUR' });
  assert.equal(s.noMonthlyPayment, false, 'Retiro leería «sin cuota» en una hipoteca que paga');
  assert.equal(s.monthlyPayment, 0, 'cuota del cuadro: 0 = calcúlala tú');
  const [vuelta] = deserializeLiabilities([{ ...s, noMonthlyPayment: true }]);
  assert.equal(vuelta.noMonthlyPayment, false, 'tampoco al entrar');
});

// --- 3. Los fondos con rentabilidad propia no los pisa Parámetros ---

test('sincronizar: un fondo con rentabilidad propia no se pisa al cambiar un parámetro', () => {
  const antes = { ...DEFAULT_MACRO_PARAMS, stockGrowthPct: 6 };
  const ahora = { ...antes, stockGrowthPct: 5 };
  const propio = { id: 'e', subcategory: 'stocks', stockClass: 'growth', stockType: 'fund', value: 1000, capitalReturnPct: 6.5 };
  const sigue = { ...propio, id: 'f', capitalReturnPct: 6 };
  const acciones = { ...propio, id: 'g', stockType: 'shares', capitalReturnPct: 6 };
  const [a, b, c] = syncAssetRatesToMacro([propio, sigue, acciones], ahora, antes);
  assert.equal(a.capitalReturnPct, 6.5);
  assert.equal(b.capitalReturnPct, 5, 'el que seguía al parámetro sigue siéndolo');
  assert.equal(c.capitalReturnPct, 6, 'las acciones sueltas no siguen a la bolsa');
  // Sin el parámetro anterior no hay forma de saber quién lo seguía: nadie se toca.
  assert.equal(syncAssetRatesToMacro([sigue], ahora)[0].capitalReturnPct, 6);
});

test('la interfaz no sincroniza las rentabilidades al importar', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /omitirSincroniaMacro/);
});

// --- 4. Negativos admitidos donde significan algo ---

test('revalorización y crecimiento admiten negativos y el cálculo los respeta', () => {
  const m = { ...DEFAULT_MACRO_PARAMS, realEstateAppreciationPct: -3 };
  assert.equal(calculateRealEstateReturns(100000, 0, 'habitual', m).capitalReturnPct, -3);
  assert.equal(clampParam('realEstateAppreciationPct', -3), -3);
  assert.equal(clampParam('stockGrowthPct', -4.5), -4.5);
  assert.equal(clampParam('inflationPct', -1), -1);
  const vuelta = deserializeMacro(serializeMacro(m));
  assert.equal(vuelta.realEstateAppreciationPct, -3);
});

test('los costes mantienen el suelo en 0 y campo y cálculo coinciden', () => {
  assert.equal(clampParam('rentalOperatingCostsPct', -5), 0);
  assert.equal(clampParam('pensionWithdrawalTaxPct', -5), 0);
  const d = deserializeMacro({ reOpex: -10, tangiblesHaircut: -1, reMaint: -0.5 });
  assert.equal(d.rentalOperatingCostsPct, 0);
  assert.equal(d.tangiblesHaircutPct, 0);
  assert.equal(d.realEstateMaintenancePct, 0);
});

// --- 9. Rangos razonables ---

test('los parámetros tienen techo: ni 1e21 ni una retirada de pensión del 150 %', () => {
  assert.equal(clampParam('pensionWithdrawalTaxPct', 150), 100);
  assert.equal(clampParam('stockGrowthPct', 1e21), 100);
  assert.equal(clampParam('marginalIncomeTaxPct', 1e21), 100);
  const d = deserializeMacro({ pensionWithdrawalTax: 150, stockGrowth: 1e21 });
  assert.equal(d.pensionWithdrawalTaxPct, 100);
  assert.equal(d.stockGrowthPct, 100);
  const liquidacion = assetGrossLiquidation({ subcategory: 'pensions', value: 1000 }, { pensionWithdrawalTaxPct: 150 });
  assert.ok(liquidacion >= 0);
});

// --- 5. Qué se acepta como copia ---

test('un JSON que no es una copia se rechaza en vez de vaciar el balance', () => {
  for (const malo of [{}, [], 5, null, 'hola', { foo: 1 }, { version: '9.7' }]) {
    assert.throws(() => parseImportPayload(malo), /archivo no válido/, JSON.stringify(malo));
  }
});

test('una sección ausente en una copia válida no vacía lo que hay', () => {
  const solo = parseImportPayload({ assetsData: [{ id: 'a', name: 'X', category: 'cash', value: 10 }] });
  assert.equal(solo.liabilities, undefined);
  assert.equal(solo.expenses, undefined);
  assert.equal(solo.macroParams, undefined);
  const resumen = summarizeImport(solo, { assets: [{ value: 5, currency: 'EUR' }], liabilities: [{ value: 7, currency: 'EUR' }] }, 'EUR', RATES);
  assert.equal(resumen.liabilities.to, 1, 'las deudas siguen como estaban');
  assert.equal(resumen.liabilityValue.to, 7);
});

test('una sección reconocida con el tipo equivocado no vale como copia', () => {
  for (const malo of [
    { liabilitiesData: 'x' }, { assetsData: {} }, { assets: 3 }, { macro: [] }, { familyExpenses: 'x' },
    { baseCurrency: 5 }, { familyMembers: '2' }, { hasPartner: 'si' }, { selectedCountry: null }
  ]) {
    assert.throws(() => parseImportPayload(malo), /archivo no válido/, JSON.stringify(malo));
  }
  // Con una sección buena al lado, la mala se ignora sin más.
  const r = parseImportPayload({ assetsData: {}, liabilitiesData: [] });
  assert.deepEqual(r.liabilities, []);
  assert.equal(r.assets, undefined);
});

test('wealthTaxPayers de un fichero lleva el mismo tope que el campo', () => {
  assert.equal(deserializeMacro({ wealthPayers: 1e9 }).wealthTaxPayers, MAX_CONTRIBUYENTES);
  assert.equal(deserializeMacro({ wealthTaxPayers: 50 }).wealthTaxPayers, 20);
  assert.equal(deserializeMacro({ wealthPayers: 3 }).wealthTaxPayers, 3);
});

test('un macro parcial conserva los parámetros en vigor, no los de fábrica', () => {
  const vigente = { ...DEFAULT_MACRO_PARAMS, wealthTaxRegion: 'madrid', wealthTaxPayers: 3,
    wealthTaxExemption: 500000, wealthTaxBonificationPct: 50, marginalIncomeTaxPct: 45, fireTargetMultiple: 33 };
  const r = parseImportPayload({ macro: { inflation: 4 } }, { macroFallback: vigente });
  assert.equal(r.macroParams.inflationPct, 4);
  for (const k of ['wealthTaxRegion', 'wealthTaxPayers', 'wealthTaxExemption', 'wealthTaxBonificationPct', 'marginalIncomeTaxPct', 'fireTargetMultiple']) {
    assert.equal(r.macroParams[k], vigente[k], k);
  }
  // Un null explícito sigue significando «los de la comunidad».
  const n = parseImportPayload({ macro: { wealthExemption: null } }, { macroFallback: vigente });
  assert.equal(n.macroParams.wealthTaxExemption, null);
  // Sin macroFallback, lo ausente vuelve a fábrica como siempre.
  assert.equal(parseImportPayload({ macro: { inflation: 4 } }).macroParams.wealthTaxPayers, DEFAULT_MACRO_PARAMS.wealthTaxPayers);
});

test('el resumen de importación cuenta los parámetros cuando el fichero los trae', () => {
  const next = parseImportPayload({ macro: { inflation: 4 } }, { macroFallback: DEFAULT_MACRO_PARAMS });
  const res = summarizeImport(next, { assets: [], liabilities: [], macroParams: DEFAULT_MACRO_PARAMS }, 'EUR', RATES);
  assert.equal(res.params.changed, 2, "la inflación y la revalorización del ladrillo, que la hereda");
  const igual = summarizeImport(parseImportPayload({ macro: {} }, { macroFallback: DEFAULT_MACRO_PARAMS }), { assets: [], liabilities: [], macroParams: DEFAULT_MACRO_PARAMS }, 'EUR', RATES);
  assert.equal(igual.params.changed, 0);
  assert.equal(summarizeImport(parseImportPayload({ assetsData: [] }), { assets: [], liabilities: [] }, 'EUR', RATES).params, null);
});

test('un campo con rango no aplica lo vacío ni lo fuera de rango; al salir lo recorta', () => {
  const r = (t) => evaluarEntrada(t, 'es-ES', 2, [0, 100]);
  assert.equal(r('').estado, 'vacio');
  assert.equal(r('-').estado, 'vacio');
  assert.equal(r('250').estado, 'fuera');
  assert.equal(r('250').recortado, 100);
  assert.equal(r('-5').recortado, 0);
  assert.equal(r('12,5').estado, 'ok');
  assert.equal(evaluarEntrada('50', 'es-ES', 0, [1, MAX_CONTRIBUYENTES]).recortado, 20);
});

test('todo campo de parámetros de la interfaz declara su rango', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const campos = [...app.matchAll(/onChange=\{v => setMacroParams\(\{ \.\.\.macroParams, (\w+): /g)].map(m => m[1]);
  assert.ok(campos.length >= 20);
  for (const k of campos) {
    assert.match(app, new RegExp(`range=\\{[^\\n]*${k === 'wealthTaxPayers' ? 'MAX_CONTRIBUYENTES' : k === 'fireTargetMultiple' ? '200' : k}[^\\n]*\\}\\s*\\n[^\\n]*onChange=\\{v => setMacroParams\\(\\{ \\.\\.\\.macroParams, ${k}:`), k);
  }
});

// --- 6. Elementos raros ---

test('elementos nulos o de otro tipo no rompen la importación', () => {
  const r = parseImportPayload({ assetsData: [null, 3, 'x', [], { id: 'a', name: 'Bien', category: 'cash', value: 5 }], liabilitiesData: [null, { id: 'l', name: 'D', subcategory: 'short_term', value: 3 }] });
  assert.equal(r.assets.length, 1);
  assert.equal(r.liabilities.length, 1);
  assert.deepEqual(listaDeObjetos([null, 1, { a: 1 }]), [{ a: 1 }]);
  assert.equal(listaDeObjetos({ a: 1 }), null);
  assert.equal(listaDeObjetos('x'), null);
});

// --- 7. Deshacer sin perder lo añadido después ---

test('deshacer devuelve lo borrado y conserva lo añadido después', () => {
  const antes = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }];
  const ahora = [{ id: 'nuevo', n: 9 }];
  assert.deepEqual(restoreDeleted(antes, ahora).map(x => x.id), ['a', 'b', 'c', 'nuevo']);
  // Borrado suelto con una edición posterior de otro elemento: la edición se queda.
  const tras = [{ id: 'a', n: 100 }, { id: 'c', n: 3 }];
  const r = restoreDeleted(antes, tras);
  assert.deepEqual(r.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(r[0].n, 100);
});

// --- 9. Ids únicos al importar ---

test('los ids duplicados de un fichero se reasignan', () => {
  const a = deserializeAssets([{ id: 'x', name: 'A', category: 'cash', value: 1 }, { id: 'x', name: 'B', category: 'cash', value: 2 }], DEFAULT_MACRO_PARAMS);
  assert.equal(new Set(a.map(i => i.id)).size, 2);
  assert.equal(a[0].id, 'x');
  const l = deserializeLiabilities([{ id: 'y', name: 'A', subcategory: 'short_term', value: 1 }, { id: 'y', name: 'B', subcategory: 'short_term', value: 2 }]);
  assert.equal(new Set(l.map(i => i.id)).size, 2);
});

test('las rentabilidades y los tipos de un fichero ajeno entran con rango', () => {
  const [a] = deserializeAssets([{ id: 'x', name: 'A', category: 'cash', value: 1, cashReturnPct: 1e21, capitalReturnPct: -500 }], DEFAULT_MACRO_PARAMS);
  assert.equal(a.cashReturnPct, 1000);
  assert.equal(a.capitalReturnPct, -100);
  const [l] = deserializeLiabilities([{ id: 'y', name: 'D', subcategory: 'short_term', value: 1, interestRatePct: 1e21 }]);
  assert.equal(l.interestRatePct, 100);
});
