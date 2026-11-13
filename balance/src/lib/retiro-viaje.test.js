import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseImportPayload, buildExportPayload, serializeMacro,
  serializeAssets, DEFAULT_MACRO_PARAMS, calculateRealEstateReturns,
  conRendimientosCalculados, leerExtrasDeRetiro, miembrosDelHogar, MAX_MIEMBROS
} from './finance.js';

// El viaje Retiro -> Balance -> Retiro. Lo que Balance no usa no es suyo para
// tirarlo: tiene que volver tal como llegó, y lo que sí gestiona manda sobre
// lo que traía el fichero. El fichero de abajo es el que exporta Retiro con su
// ejemplo (35 claves de `macro`, `rent_imputed` entre los gastos).

const MACRO_RETIRO = {
  stockGrowth: '6', divYield: '3', cashYield: '1.5', bondYield: '3', tipsRealYield: '1',
  goldRealReturn: '0', goldPricePerGram: '118.74', inflation: '2', propertyInflation: '2',
  propertyInflationCoupled: true, pensionGrowthCoupled: true, expenseChange: 0,
  countPublicPension: true, rentInflation: '2', rentInflationCoupled: true, pensionGrowth: '2',
  reRentalYield: '3.8', reMaint: '0.6', reOpex: '15.0', reDeduction: '50.0', bufferMonths: '6',
  retireAgeP1: '55', retireAgeP2: '52', surplusDest: 'divStocks', deficitDest: 'stocks',
  ccaa: 'madrid', eduGuarderia: 'publica', eduColegio: 'concertado', eduUniversidad: 'publica',
  chartHorizon: 'auto', ppContribution: '1500', elderCareMonthly: '500', elderCareAge: '80',
  childrenEmancipationAge: '25', robHorizonAge: '65'
};
const GASTOS_RETIRO = {
  food: 200, clothes: 70, supplies_p: 80, transport: 200, other_p: 100, supplies_h: 250,
  subs: 50, otherHouse: 0, rent_imputed: 1200, housekeeper: 0, vacations: 3000, vehicle: 2000, otherFixed: 0
};
const serializeNada = { person_monthly: {}, household_monthly: {}, family_annual: {} };
const ficheroDeRetiro = () => ({
  version: '9.7', hasPartner: true, childrenAges: [5, 2], familyMembers: 4,
  familyExpenses: { ...GASTOS_RETIRO },
  assetsData: [
    { id: 're_1', name: 'Casa', category: 'real_estate', owner: 'joint', currency: 'EUR', value: 400000, purchasePrice: 280000, purchaseDate: '2019-06', monthlyRent: 0, useType: 'habitual', cashReturnPct: 0, useReturnPct: 3.5, opexPct: 0, hasMaint: true },
    { id: 're_2', name: 'Alquilado', category: 'real_estate', owner: 'joint', currency: 'EUR', value: 180000, purchasePrice: 150000, purchaseDate: '2021-03', monthlyRent: 900, useType: 'rented', cashReturnPct: 3.8, useReturnPct: 0, opexPct: 25, hasMaint: false },
    { id: 're_3', name: 'Vacío', category: 'real_estate', owner: 'joint', currency: 'EUR', value: 200000, purchasePrice: 150000, purchaseDate: '2020-01', monthlyRent: 0, useType: 'vacant', cashReturnPct: 0, useReturnPct: 0, opexPct: 7, hasMaint: true }
  ],
  liabilitiesData: [],
  exchangeRates: { USD: 1.1 },
  macro: { ...MACRO_RETIRO }
});

function ida_y_vuelta(fichero) {
  const n = parseImportPayload(fichero, {});
  return buildExportPayload({
    assets: n.assets || [], liabilities: n.liabilities || [], expenses: n.expenses || serializeNada,
    macroParams: n.macroParams || DEFAULT_MACRO_PARAMS, baseCurrency: 'EUR', selectedCountry: 'es_urban',
    familyMembers: n.familyMembers || 1, householdDetail: n.householdDetail, retiroExtras: n.retiroExtras,
    exchangeRates: fichero.exchangeRates
  });
}

test('el opex de cada inmueble y el mantenimiento de los vacíos vuelven a Retiro como llegaron', () => {
  const vuelta = ida_y_vuelta(ficheroDeRetiro());
  const por = Object.fromEntries(vuelta.assetsData.map(a => [a.id, a]));
  assert.equal(por.re_1.opexPct, 0);
  assert.equal(por.re_2.opexPct, 25);
  assert.equal(por.re_3.opexPct, 7);
  assert.equal(por.re_3.hasMaint, true);
  assert.equal(por.re_2.hasMaint, false);
  assert.equal(por.re_1.hasMaint, true);
});

test('un inmueble que cambia de uso en Balance no arrastra el mantenimiento del uso anterior', () => {
  const n = parseImportPayload(ficheroDeRetiro(), {});
  const vacio = { ...n.assets.find(a => a.id === 're_3'), useType: 'habitual' };
  const rentado = { ...n.assets.find(a => a.id === 're_3'), useType: 'rented' };
  const [h, r] = serializeAssets([vacio, rentado], { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS });
  assert.equal(h.hasMaint, true);
  assert.equal(r.hasMaint, false);
});

test('un inmueble de Balance sin opex propio sigue llevando el de Parámetros', () => {
  const [a] = serializeAssets(
    [{ id: 'x', subcategory: 'real_estate', value: 1, useType: 'rented', monthlyRent: 1 }],
    { baseCurrency: 'EUR', macroParams: { ...DEFAULT_MACRO_PARAMS, rentalOperatingCostsPct: 12 } }
  );
  assert.equal(a.opexPct, 12);
});

test('el opex y el mantenimiento ilegibles del fichero se sanean al entrar', () => {
  const f = ficheroDeRetiro();
  f.assetsData[1].opexPct = -5;
  f.assetsData[2].opexPct = 'basura';
  f.assetsData[2].hasMaint = 'sí';
  const n = parseImportPayload(f, {});
  assert.equal(n.assets.find(a => a.id === 're_2').opexPct, 0);
  assert.equal(n.assets.find(a => a.id === 're_3').opexPct, undefined);
  assert.equal(n.assets.find(a => a.id === 're_3').hasMaint, undefined);
});

test('las claves de `macro` que Balance no gestiona vuelven idénticas', () => {
  const vuelta = ida_y_vuelta(ficheroDeRetiro());
  const gestionadas = new Set(Object.keys(serializeMacro(DEFAULT_MACRO_PARAMS)));
  const ajenas = Object.keys(MACRO_RETIRO).filter(k => !gestionadas.has(k));
  assert.ok(ajenas.length >= 25, `deberían ser al menos 25 y son ${ajenas.length}`);
  for (const k of ajenas) assert.deepEqual(vuelta.macro[k], MACRO_RETIRO[k], k);
});

test('lo que Balance sí gestiona de `macro` manda sobre lo que traía el fichero', () => {
  const n = parseImportPayload(ficheroDeRetiro(), {});
  const cambiado = { ...n.macroParams, inflationPct: 3.3 };
  const vuelta = buildExportPayload({
    assets: n.assets, liabilities: [], expenses: n.expenses, macroParams: cambiado,
    baseCurrency: 'EUR', selectedCountry: 'es_urban', familyMembers: 4, retiroExtras: n.retiroExtras, exchangeRates: {}
  });
  assert.equal(vuelta.macro.inflation, 3.3);
  assert.equal(vuelta.macro.ccaa, 'madrid');
});

test('los gastos que Balance no usa (el alquiler imputado) vuelven y los suyos no se pisan', () => {
  const vuelta = ida_y_vuelta(ficheroDeRetiro());
  assert.equal(vuelta.familyExpenses.rent_imputed, 1200);
  const { rent_imputed, ...resto } = GASTOS_RETIRO;
  for (const [k, v] of Object.entries(resto)) assert.equal(vuelta.familyExpenses[k], v, k);

  const n = parseImportPayload(ficheroDeRetiro(), {});
  const editados = { ...n.expenses, person_monthly: { ...n.expenses.person_monthly, food: 999 } };
  const v2 = buildExportPayload({
    assets: [], liabilities: [], expenses: editados, macroParams: n.macroParams, baseCurrency: 'EUR',
    selectedCountry: 'es_urban', familyMembers: 4, retiroExtras: n.retiroExtras, exchangeRates: {}
  });
  assert.equal(v2.familyExpenses.food, 999);
  assert.equal(v2.familyExpenses.rent_imputed, 1200);
});

test('un fichero de Balance no inventa claves ajenas, y uno sin macro no borra las que ya hay', () => {
  const propio = ida_y_vuelta({ macro: { inflation: 3 }, familyExpenses: { food: 5 } });
  assert.equal(propio.macro.ccaa, undefined);
  assert.equal(propio.familyExpenses.rent_imputed, undefined);
  const sinSecciones = parseImportPayload({ familyMembers: 3 });
  assert.equal(sinSecciones.retiroExtras, undefined);
});

test('las claves ajenas leídas de localStorage se validan', () => {
  assert.deepEqual(leerExtrasDeRetiro(null), { macro: {}, familyExpenses: {} });
  assert.deepEqual(leerExtrasDeRetiro('x'), { macro: {}, familyExpenses: {} });
  assert.deepEqual(leerExtrasDeRetiro({ macro: [1], familyExpenses: { a: 1 } }), { macro: {}, familyExpenses: { a: 1 } });
});

test('una vivienda habitual guardada con uso 0 se calcula con el 3,5 % del motor', () => {
  const vieja = { id: 'h', subcategory: 'real_estate', value: 200000, monthlyRent: 0, useType: 'habitual', cashReturnPct: -0.6, useReturnPct: 0, capitalReturnPct: 2 };
  const v = conRendimientosCalculados(vieja, DEFAULT_MACRO_PARAMS);
  assert.equal(v.useReturnPct, calculateRealEstateReturns(200000, 0, 'habitual', DEFAULT_MACRO_PARAMS).useReturnPct);
  assert.equal(v.useReturnPct, 3.5);
  const caja = { id: 'c', subcategory: 'cash', value: 1, useReturnPct: 0 };
  assert.equal(conRendimientosCalculados(caja, DEFAULT_MACRO_PARAMS), caja);
  // y al exportar sale lo mismo que enseña la pantalla
  const [fila] = serializeAssets([vieja], { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS });
  assert.equal(fila.useReturnPct, 3.5);
});

test('los miembros del hogar son un entero entre 1 y 20, venga de donde venga', () => {
  assert.equal(MAX_MIEMBROS, 20);
  assert.equal(miembrosDelHogar(1e9), 20);
  assert.equal(miembrosDelHogar(2.5), 3);
  assert.equal(miembrosDelHogar(0), 1);
  assert.equal(miembrosDelHogar(-4), 1);
  assert.equal(miembrosDelHogar('x'), 1);
  assert.equal(parseImportPayload({ familyMembers: 1e9 }).familyMembers, 20);
  assert.equal(parseImportPayload({ familyMembers: 2.5 }).familyMembers, 3);
});

test('un vacío hecho en Balance sale con mantenimiento, porque Balance se lo cuenta', () => {
  const [a] = serializeAssets(
    [{ id: 'v', subcategory: 'real_estate', value: 100000, useType: 'vacant' }],
    { baseCurrency: 'EUR', macroParams: DEFAULT_MACRO_PARAMS }
  );
  assert.equal(a.hasMaint, true);
});
