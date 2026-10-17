import test from 'node:test';
import assert from 'node:assert/strict';

import { computeBalance } from './engine.js';
import { DEFAULT_MACRO_PARAMS, calculateLoanAmortization, assetAnnualCashflow, savingsTaxOnIncome } from './finance.js';

const RATES = { EUR: 1.0, USD: 1.1621, GBP: 0.8587 };

// Un balance corriente: casa habitual hipotecada, algo de bolsa, un plan de
// pensiones y una tarjeta. Sirve de base para casi todas las pruebas.
function balanceTipico(extra = {}) {
  return {
    assets: [
      { id: 'a1', name: 'Cuenta', subcategory: 'cash', currency: 'EUR', value: 20000, cashReturnPct: 2.0 },
      { id: 'a2', name: 'Indexado', subcategory: 'stocks', currency: 'EUR', value: 50000, cashReturnPct: 0, capitalReturnPct: 6.0, stockType: 'fund' },
      { id: 'a3', name: 'Vivienda', subcategory: 'real_estate', currency: 'EUR', value: 200000, monthlyRent: 900, useType: 'habitual' },
      { id: 'a4', name: 'Plan', subcategory: 'pensions', currency: 'EUR', value: 30000, capitalReturnPct: 5.0 }
    ],
    liabilities: [
      { id: 'l1', name: 'Hipoteca', subcategory: 'mortgages', currency: 'EUR',
        initialPrincipal: 150000, durationMonths: 300, interestRatePct: 2.5, startDate: '2022-01' }
    ],
    expenses: {
      person_monthly: { food: 300, clothes: 60, supplies_person: 50, transport: 150, other_person: 80 },
      household_monthly: { supplies: 200, subs: 40, otherHouse: 50 },
      family_annual: { housekeeper: 0, education: 0, vacations: 2000, vehicleMaint: 500, otherFixed: 500 }
    },
    familyMembers: 2,
    macroParams: DEFAULT_MACRO_PARAMS,
    baseCurrency: 'EUR',
    selectedCountry: 'es_urban',
    exchangeRates: RATES,
    ...extra
  };
}

test('motor: un balance vacío no rompe ni inventa números', () => {
  const r = computeBalance({});
  assert.equal(r.totalAssets, 0);
  assert.equal(r.totalLiabilities, 0);
  assert.equal(r.netWorth, 0);
  assert.equal(r.ltv, 0);
  assert.equal(r.roa, 0);
  assert.equal(r.runwayTotalMonths, 0, 'sin caja y sin gasto el runway es 0, no NaN');
  assert.equal(r.statusLevels.length, 7);
});

test('motor: los totales por categoría suman el activo', () => {
  const r = computeBalance(balanceTipico());
  const suma = Object.values(r.assetCategoryTotals).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(suma - r.totalAssets) < 0.01, `${suma} != ${r.totalAssets}`);
  assert.equal(r.assetCategoryTotals.cash, 20000);
  assert.equal(r.assetCategoryTotals.pensions, 30000);
});

test('motor: el patrimonio neto es activo menos pasivo', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(Math.abs(r.netWorth - (r.totalAssets - r.totalLiabilities)) < 0.01);
});

test('motor: la deuda amortizable entra por su saldo vivo, no por el principal', () => {
  const r = computeBalance(balanceTipico());
  const esperado = calculateLoanAmortization(150000, 2.5, 300, '2022-01').currentBalance;
  assert.ok(Math.abs(r.totalLiabilities - esperado) < 0.01,
    `pasivo ${r.totalLiabilities} frente al saldo amortizado ${esperado}`);
  assert.ok(r.totalLiabilities < 150000);
});

test('motor: la vivienda habitual sale del patrimonio no residencial', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(r.nonPrimaryNetWorth < r.netWorth);
  assert.ok(Math.abs((r.netWorth - r.nonPrimaryNetWorth) - 200000) < 0.01);
});

test('motor: un activo en divisa se convierte y se cuenta como exposición', () => {
  const base = balanceTipico();
  const conDivisa = computeBalance({
    ...base,
    assets: [...base.assets, { id: 'a5', name: 'Apple', subcategory: 'stocks', currency: 'USD', value: 11621, cashReturnPct: 0.5, capitalReturnPct: 8 }]
  });
  const soloBase = computeBalance(base);
  // 11.621 USD a 1,1621 USD/EUR son 10.000 EUR.
  assert.ok(Math.abs((conDivisa.totalAssets - soloBase.totalAssets) - 10000) < 1);
  assert.ok(Math.abs(conDivisa.foreignCurrencyAssetsBase - 10000) < 1);
  assert.ok(conDivisa.foreignCurrencyPct > 0);
});

test('motor: el gasto personal se multiplica por los miembros de la familia', () => {
  const uno = computeBalance(balanceTipico({ familyMembers: 1 }));
  const cuatro = computeBalance(balanceTipico({ familyMembers: 4 }));
  const personal = 300 + 60 + 50 + 150 + 80;
  assert.ok(Math.abs((cuatro.totalMonthlyExpenses - uno.totalMonthlyExpenses) - personal * 3) < 0.01);
  assert.equal(cuatro.validFamilyMembers, 4);
});

test('motor: cero o menos miembros cuenta como uno', () => {
  assert.equal(computeBalance(balanceTipico({ familyMembers: 0 })).validFamilyMembers, 1);
  assert.equal(computeBalance(balanceTipico({ familyMembers: -3 })).validFamilyMembers, 1);
});

test('motor: el gasto anual es doce veces el mensual', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(Math.abs(r.totalAnnualExpenses - r.totalMonthlyExpenses * 12) < 0.01);
});

test('motor: sin gasto ni deuda el runway es infinito mientras haya caja', () => {
  const r = computeBalance({
    assets: [{ id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 50000, cashReturnPct: 0 }],
    liabilities: [], expenses: {}, exchangeRates: RATES, macroParams: DEFAULT_MACRO_PARAMS
  });
  assert.equal(r.runwayTotalMonths, Infinity);
});

test('motor: el runway solo cuenta la caja, no la bolsa', () => {
  const r = computeBalance(balanceTipico());
  const quemaMensual = r.totalMonthlyExpenses + r.monthlyDebtPayments;
  assert.ok(Math.abs(r.runwayTotalMonths - (20000 / quemaMensual)) < 0.01,
    'el runway debe salir de los 20.000 en cuenta, ignorando los 50.000 del indexado');
  assert.equal(r.liquidCash, 20000);
});

test('motor: los niveles FIRE se cortan en el primero que falla', () => {
  const r = computeBalance(balanceTipico());
  const primerFallo = r.statusLevels.findIndex(s => s !== 'green');
  if (primerFallo !== -1) {
    for (let i = primerFallo + 1; i < r.statusLevels.length; i++) {
      assert.notEqual(r.statusLevels[i], 'green', `el nivel ${i} no puede estar verde tras el corte en ${primerFallo}`);
    }
  }
});

test('motor: un nivel posterior que cumpliría queda marcado como bloqueado', () => {
  // Mucho capital pero nada de caja: el nivel 0 (colchón) falla y arrastra.
  const r = computeBalance({
    assets: [{ id: 'a1', name: 'Piso', subcategory: 'real_estate', currency: 'EUR', value: 3000000, monthlyRent: 0, useType: 'habitual' }],
    liabilities: [],
    expenses: { person_monthly: { food: 500 }, household_monthly: {}, family_annual: {} },
    familyMembers: 1, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.equal(r.statusLevels[0], 'red', 'sin caja no hay colchón');
  const bloqueados = r.milestoneDetails.filter(m => m.isBlocked);
  assert.ok(bloqueados.length > 0, 'algún nivel posterior cumple lo suyo pero queda bloqueado');
});

test('motor: el múltiplo FIRE es un parámetro, no una constante', () => {
  const laxo = computeBalance(balanceTipico({ macroParams: { ...DEFAULT_MACRO_PARAMS, fireTargetMultiple: 1 } }));
  const exigente = computeBalance(balanceTipico({ macroParams: { ...DEFAULT_MACRO_PARAMS, fireTargetMultiple: 100 } }));
  assert.equal(laxo.fireTargetMultiple, 1);
  assert.equal(exigente.fireTargetMultiple, 100);
  assert.equal(laxo.isAbundanceAchieved, true);
  assert.equal(exigente.isAbundanceAchieved, false);
  assert.ok(Math.abs(laxo.fireAmberMultiple - 0.8) < 1e-9);
});

test('motor: un múltiplo FIRE absurdo cae al mínimo de 1', () => {
  const r = computeBalance(balanceTipico({ macroParams: { ...DEFAULT_MACRO_PARAMS, fireTargetMultiple: 0 } }));
  assert.equal(r.fireTargetMultiple, 25, 'un 0 cae al valor por defecto');
  const neg = computeBalance(balanceTipico({ macroParams: { ...DEFAULT_MACRO_PARAMS, fireTargetMultiple: -5 } }));
  assert.equal(neg.fireAmberMultiple, neg.fireTargetMultiple * 0.8);
  assert.ok(neg.fireTargetMultiple >= 1);
});

test('motor: la deuda cara y la caja sin remunerar se señalan para la auditoría', () => {
  const r = computeBalance(balanceTipico({
    assets: [
      { id: 'a1', name: 'Cuenta parada', subcategory: 'cash', currency: 'EUR', value: 30000, cashReturnPct: 0.1 },
      { id: 'a2', name: 'Plan malo', subcategory: 'pensions', currency: 'EUR', value: 10000, capitalReturnPct: 0.5 }
    ],
    liabilities: [{ id: 'l1', name: 'Tarjeta', subcategory: 'short_term', currency: 'EUR', value: 4000, interestRatePct: 18, monthlyPayment: 200 }]
  }));
  assert.equal(r.expensiveDebt.length, 1);
  assert.equal(r.unremuneratedCash.length, 1);
  assert.equal(r.lowYieldPensions.length, 1, 'un plan por debajo de la inflación se marca');
});

test('motor: el gasto muy por encima de la referencia del país se señala con su nombre', () => {
  const r = computeBalance(balanceTipico({
    expenses: {
      person_monthly: { food: 300, clothes: 60, supplies_person: 50, transport: 2000, other_person: 80 },
      household_monthly: { supplies: 200, subs: 40, otherHouse: 50 },
      family_annual: {}
    },
    expenseLabel: key => ({ transport: 'Transporte' })[key] || key
  }));
  const transporte = r.excessExpensesList.find(e => e.name === 'Transporte');
  assert.ok(transporte, 'los 2.000 de transporte superan con creces la cesta de referencia');
  assert.equal(transporte.isExtreme, true, '2.000 frente a 200 es más del triple');
  assert.ok(transporte.ratio > 300);
});

test('motor: sin etiquetador el gasto desviado se identifica por su clave', () => {
  const r = computeBalance(balanceTipico({
    expenses: { person_monthly: { transport: 2000 }, household_monthly: {}, family_annual: {} }
  }));
  assert.ok(r.excessExpensesList.some(e => e.name === 'transport'));
});

test('motor: la cobertura de vida acompaña al flujo de caja neto', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(r.coverage, 'la cobertura se calcula');
  assert.ok(Number.isFinite(r.monthlyPassiveCashflow));
  assert.ok(Math.abs(r.netMonthlyCashflow - (r.assetCashflowSurplus - r.totalMonthlyExpenses)) < 0.01);
});

test('motor: el país de referencia cambia el listado de desviaciones', () => {
  const gastos = {
    expenses: { person_monthly: { food: 400 }, household_monthly: {}, family_annual: {} },
    familyMembers: 1
  };
  const espana = computeBalance(balanceTipico({ ...gastos, selectedCountry: 'es_avg' }));
  const eeuu = computeBalance(balanceTipico({ ...gastos, selectedCountry: 'us_avg' }));
  // 400 supera la cesta española (250) pero no la estadounidense (450).
  assert.ok(espana.excessExpensesList.length >= eeuu.excessExpensesList.length);
});

test('motor: un país desconocido cae en la cesta española urbana', () => {
  const conocido = computeBalance(balanceTipico({ selectedCountry: 'es_urban' }));
  const inventado = computeBalance(balanceTipico({ selectedCountry: 'atlantida' }));
  assert.deepEqual(inventado.excessExpensesList, conocido.excessExpensesList);
});

// --- SUBTIPOS DEL BLOQUE 2 ---

test('subtipos: la renta fija y el oro no son liquidez, pero sí se pueden vender', () => {
  const base = balanceTipico();
  const r = computeBalance({
    ...base,
    assets: [
      ...base.assets,
      { id: 'b1', name: 'Bonos', subcategory: 'stocks', stockClass: 'bonds', stockType: 'fund', currency: 'EUR', value: 10000, cashReturnPct: 3, capitalReturnPct: 0 },
      { id: 'b2', name: 'Oro', subcategory: 'stocks', stockClass: 'gold', stockType: 'fund', currency: 'EUR', value: 5000, cashReturnPct: 0, capitalReturnPct: 2 }
    ]
  });
  assert.equal(r.liquidCash, 20000, 'el colchón estricto sigue siendo la caja');
  assert.equal(r.liquidSellable, 85000, 'el vendible suma bolsa, bonos y oro');
  assert.equal(r.assetClassTotals.equity, 50000);
  assert.equal(r.assetClassTotals.fixed_income, 10000);
  assert.equal(r.assetClassTotals.gold, 5000);
  assert.equal(r.assetCategoryTotals.stocks, 65000, 'el bloque sigue siendo uno');
});

test('subtipos: el cupón de un bono es un interés, no un dividendo', () => {
  const sinBonos = computeBalance(balanceTipico());
  const base = balanceTipico();
  const conBonos = computeBalance({
    ...base,
    assets: [...base.assets, { id: 'b1', name: 'Bonos', subcategory: 'stocks', stockClass: 'bonds', stockType: 'fund', currency: 'EUR', value: 12000, cashReturnPct: 3, capitalReturnPct: 0 }]
  });
  assert.ok(conBonos.interestCashflowMonthly > sinBonos.interestCashflowMonthly);
  assert.equal(conBonos.dividendCashflowMonthly, sinBonos.dividendCashflowMonthly);
});

// --- A3: LA SEGUNDA LECTURA DEL RUNWAY ---

test('runway: la lectura vendible suma fondos y acciones a la caja', () => {
  const r = computeBalance(balanceTipico());
  assert.equal(r.liquidCash, 20000, 'la estricta solo cuenta la caja');
  assert.equal(r.liquidSellable, 70000, 'la vendible añade los 50.000 del indexado');
  assert.ok(r.runwaySellableMonths > r.runwayTotalMonths);
});

test('runway: la lectura vendible descuenta solo intereses, no la cuota entera', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(r.monthlyDebtInterest > 0);
  assert.ok(r.monthlyDebtInterest < r.monthlyDebtPayments,
    'los intereses son una parte de la cuota, no toda');
  assert.ok(Math.abs(r.relaxedBurn - (r.totalMonthlyExpenses + r.relaxedDebtCost)) < 0.01);
  assert.equal(r.relaxedDebtCost, Math.min(r.monthlyDebtInterest, r.monthlyDebtPayments));
});

test('runway: sin deuda las dos quemas coinciden y solo cambia lo líquido', () => {
  const r = computeBalance(balanceTipico({ liabilities: [] }));
  assert.equal(r.monthlyDebtInterest, 0);
  assert.ok(Math.abs(r.relaxedBurn - r.totalMonthlyExpenses) < 0.01);
  assert.ok(Math.abs(r.runwaySellableMonths - (r.liquidSellable / r.totalMonthlyExpenses)) < 0.01);
});

test('runway: sin bolsa ni deuda las dos lecturas son la misma', () => {
  const r = computeBalance({
    assets: [{ id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 12000, cashReturnPct: 0 }],
    liabilities: [],
    expenses: { person_monthly: { food: 1000 }, household_monthly: {}, family_annual: {} },
    familyMembers: 1, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.ok(Math.abs(r.runwayTotalMonths - r.runwaySellableMonths) < 1e-9);
  assert.ok(Math.abs(r.runwayTotalMonths - 12) < 0.01);
});

test('runway: la lectura vendible no toca el nivel del colchón', () => {
  // Poca caja pero mucha bolsa: la vendible es holgada y aun así el nivel 0
  // sigue en rojo, porque lo marca la estricta.
  const r = computeBalance({
    assets: [
      { id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 500, cashReturnPct: 0 },
      { id: 'a2', name: 'Indexado', subcategory: 'stocks', currency: 'EUR', value: 400000, capitalReturnPct: 6, stockType: 'fund' }
    ],
    liabilities: [],
    expenses: { person_monthly: { food: 2000 }, household_monthly: {}, family_annual: {} },
    familyMembers: 1, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.ok(r.runwayTotalMonths < 3, `estricta ${r.runwayTotalMonths}`);
  assert.ok(r.runwaySellableMonths > 6, `vendible ${r.runwaySellableMonths}`);
  assert.equal(r.statusLevels[0], 'red', 'el nivel 0 lo marca la estricta');
});

test('runway: sin nada que quemar la lectura vendible también es infinita', () => {
  const r = computeBalance({
    assets: [{ id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 5000, cashReturnPct: 0 }],
    liabilities: [], expenses: {}, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.equal(r.runwaySellableMonths, Infinity);
});

// --- LA ESCALA DEL AHORRO DENTRO DEL MOTOR ---

test('ahorro: el motor suma la renta de todo el balance antes de aplicar la escala', () => {
  const r = computeBalance(balanceTipico({
    assets: [
      { id: 'a1', name: 'Depósito', subcategory: 'cash', currency: 'EUR', value: 200000, cashReturnPct: 3 },
      { id: 'a2', name: 'Dividendos', subcategory: 'stocks', currency: 'EUR', value: 300000, cashReturnPct: 4 }
    ]
  }));
  // 6.000 de intereses + 12.000 de dividendos = 18.000 de base.
  assert.equal(r.grossSavingsIncome, 18000);
  assert.equal(r.savingsTaxDue, savingsTaxOnIncome(18000));
  assert.ok(r.effectiveSavingsRatePct > 19 && r.effectiveSavingsRatePct < 21);
});

test('ahorro: partir la renta en dos activos no cambia la cuota', () => {
  const uno = computeBalance(balanceTipico({
    assets: [{ id: 'a1', name: 'Todo junto', subcategory: 'cash', currency: 'EUR', value: 400000, cashReturnPct: 5 }]
  }));
  const dos = computeBalance(balanceTipico({
    assets: [
      { id: 'a1', name: 'Mitad', subcategory: 'cash', currency: 'EUR', value: 200000, cashReturnPct: 5 },
      { id: 'a2', name: 'Otra mitad', subcategory: 'cash', currency: 'EUR', value: 200000, cashReturnPct: 5 }
    ]
  }));
  // Lo contrario sería el fallo clásico de aplicar tramos activo a activo.
  assert.equal(uno.grossSavingsIncome, dos.grossSavingsIncome);
  assert.equal(uno.savingsTaxDue, dos.savingsTaxDue);
  assert.ok(Math.abs(uno.cashRetBase - dos.cashRetBase) < 0.01);
});

test('ahorro: la suma de las filas cuadra con el total del motor', () => {
  const entrada = balanceTipico({
    assets: [
      { id: 'a1', name: 'Depósito', subcategory: 'cash', currency: 'EUR', value: 150000, cashReturnPct: 3.5 },
      { id: 'a2', name: 'Dividendera', subcategory: 'stocks', currency: 'EUR', value: 250000, cashReturnPct: 4.2 },
      { id: 'a3', name: 'Piso', subcategory: 'real_estate', currency: 'EUR', value: 180000, monthlyRent: 800, useType: 'rented' }
    ]
  });
  const r = computeBalance(entrada);
  // Cada fila de la tabla usa el mismo tipo medio que el motor.
  const sumaFilas = entrada.assets.reduce(
    (acc, a) => acc + assetAnnualCashflow(a, entrada.macroParams, r.effectiveSavingsRatePct).net, 0
  );
  assert.ok(Math.abs(sumaFilas - r.cashRetBase) < 0.01,
    `filas ${sumaFilas} frente a total ${r.cashRetBase}`);
});

test('ahorro: una renta mayor paga un tipo medio mayor', () => {
  const modesto = computeBalance(balanceTipico({
    assets: [{ id: 'a1', name: 'Depósito', subcategory: 'cash', currency: 'EUR', value: 100000, cashReturnPct: 3 }]
  }));
  const grande = computeBalance(balanceTipico({
    assets: [{ id: 'a1', name: 'Depósito', subcategory: 'cash', currency: 'EUR', value: 5000000, cashReturnPct: 3 }]
  }));
  assert.ok(grande.effectiveSavingsRatePct > modesto.effectiveSavingsRatePct,
    `${grande.effectiveSavingsRatePct} debería superar a ${modesto.effectiveSavingsRatePct}`);
  assert.equal(Math.round(modesto.effectiveSavingsRatePct * 100) / 100, 19);
});

test('ahorro: un balance sin dividendos ni intereses no genera cuota', () => {
  const r = computeBalance(balanceTipico({
    assets: [{ id: 'a1', name: 'Piso', subcategory: 'real_estate', currency: 'EUR', value: 200000, monthlyRent: 0, useType: 'habitual' }]
  }));
  assert.equal(r.grossSavingsIncome, 0);
  assert.equal(r.savingsTaxDue, 0);
  assert.equal(r.effectiveSavingsRatePct, 0);
});

test('ahorro: la renta en divisa entra en la base ya convertida', () => {
  const r = computeBalance(balanceTipico({
    assets: [{ id: 'a1', name: 'Bono USD', subcategory: 'cash', currency: 'USD', value: 116210, cashReturnPct: 10 }]
  }));
  // 11.621 USD de intereses a 1,1621 son 10.000 EUR de base.
  assert.ok(Math.abs(r.grossSavingsIncome - 10000) < 1, `base ${r.grossSavingsIncome}`);
});

// --- HIPOTECAS VARIABLES EN EL MOTOR ---

function conHipotecaVariable(extra = {}) {
  return balanceTipico({
    liabilities: [{
      id: 'l1', name: 'Hipoteca variable', subcategory: 'mortgages', currency: 'EUR',
      initialPrincipal: 200000, durationMonths: 300, startDate: '2022-01',
      rateType: 'variable', spreadPct: 0.9, interestRatePct: 2.5
    }],
    ...extra
  });
}

test('variable: un euríbor mayor encarece la cuota y el interés del balance', () => {
  const barato = computeBalance(conHipotecaVariable({ euriborPct: 1.0 }));
  const caro = computeBalance(conHipotecaVariable({ euriborPct: 4.0 }));
  assert.ok(caro.monthlyDebtPayments > barato.monthlyDebtPayments);
  assert.ok(caro.debtInterestBase > barato.debtInterestBase);
  assert.ok(caro.totalLiabilities > barato.totalLiabilities, 'a más tipo, amortiza más despacio');
});

test('variable: sin euríbor el motor usa el tipo guardado, no el diferencial suelto', () => {
  // `null` es lo que llega cuando el fichero de mercado aún no ha cargado.
  const sinDato = computeBalance(conHipotecaVariable({ euriborPct: null }));
  const comoFija = computeBalance(balanceTipico({
    liabilities: [{ id: 'l1', name: 'Fija', subcategory: 'mortgages', currency: 'EUR',
      initialPrincipal: 200000, durationMonths: 300, startDate: '2022-01', interestRatePct: 2.5 }]
  }));
  assert.ok(Math.abs(sinDato.totalLiabilities - comoFija.totalLiabilities) < 0.01);
  assert.ok(Math.abs(sinDato.monthlyDebtPayments - comoFija.monthlyDebtPayments) < 0.01);
});

test('variable: el interés del balance usa el tipo efectivo, no el guardado', () => {
  const r = computeBalance(conHipotecaVariable({ euriborPct: 3.0 }));
  // 3,0 + 0,9 = 3,9% sobre el saldo vivo, no el 2,5% que quedó guardado.
  const esperado = r.totalLiabilities * 0.039;
  assert.ok(Math.abs(r.debtInterestBase - esperado) < 1,
    `interés ${r.debtInterestBase} frente a ${esperado}`);
});

test('variable: una fija no se inmuta con el euríbor', () => {
  const base = balanceTipico();
  const a = computeBalance({ ...base, euriborPct: 1.0 });
  const b = computeBalance({ ...base, euriborPct: 5.0 });
  assert.equal(a.totalLiabilities, b.totalLiabilities);
  assert.equal(a.monthlyDebtPayments, b.monthlyDebtPayments);
});

test('saldo real: el motor cuenta el saldo fijado, no el del cuadro', () => {
  const entrada = conHipotecaVariable({ euriborPct: 2.3 });
  const sinAncla = computeBalance(entrada);
  const conAncla = computeBalance({
    ...entrada,
    liabilities: [{ ...entrada.liabilities[0], balanceOverride: 150000 }]
  });

  assert.equal(conAncla.totalLiabilities, 150000, 'manda el saldo del extracto');
  assert.notEqual(sinAncla.totalLiabilities, 150000, 'sin ancla sale el del cuadro');
  // Y la cuota se recalcula sobre ese saldo, no se hereda la del cuadro.
  assert.notEqual(conAncla.monthlyDebtPayments, sinAncla.monthlyDebtPayments);
  assert.ok(conAncla.monthlyDebtPayments > 0);
});

// --- VALOR DE LIQUIDACIÓN EN EL MOTOR ---

test('liquidación: siempre queda menos de lo que dice el patrimonio neto', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(r.liquidationValue < r.netWorth, `${r.liquidationValue} debería quedar por debajo de ${r.netWorth}`);
  assert.ok(r.liquidationValue > 0);
});

test('liquidación: un balance de pura caja sin deuda no pierde nada', () => {
  const r = computeBalance({
    assets: [{ id: 'a1', name: 'Caja', subcategory: 'cash', currency: 'EUR', value: 80000, cashReturnPct: 0 }],
    liabilities: [], expenses: {}, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  });
  assert.equal(r.totalCapitalGain, 0);
  assert.equal(r.capitalGainsTax, 0);
  assert.equal(r.debtCancellationCost, 0);
  assert.ok(Math.abs(r.liquidationValue - r.netWorth) < 0.01, 'la caja vale lo que vale');
});

test('liquidación: el plan de pensiones es lo que más se lleva el impuesto', () => {
  const conPlan = computeBalance({
    assets: [{ id: 'a1', name: 'Plan', subcategory: 'pensions', currency: 'EUR', value: 100000, capitalReturnPct: 5 }],
    liabilities: [], expenses: {},
    macroParams: { ...DEFAULT_MACRO_PARAMS, pensionWithdrawalTaxPct: 37 }, exchangeRates: RATES
  });
  assert.ok(Math.abs(conPlan.liquidationValue - 63000) < 0.01, `${conPlan.liquidationValue}`);
  assert.equal(conPlan.netWorth, 100000, 'en el balance sigue valiendo su saldo');
});

test('liquidación: declarar el coste de adquisición cambia el impuesto', () => {
  const base = {
    liabilities: [], expenses: {}, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES
  };
  const supuesto = computeBalance({ ...base,
    assets: [{ id: 'a1', name: 'Indexado', subcategory: 'stocks', currency: 'EUR', value: 200000 }] });
  const declarado = computeBalance({ ...base,
    assets: [{ id: 'a1', name: 'Indexado', subcategory: 'stocks', currency: 'EUR', value: 200000, acquisitionCost: 195000 }] });

  assert.ok(declarado.totalCapitalGain < supuesto.totalCapitalGain);
  assert.ok(declarado.capitalGainsTax < supuesto.capitalGainsTax);
  assert.ok(declarado.liquidationValue > supuesto.liquidationValue, 'menos ganancia, menos impuesto, más neto');
});

test('liquidación: la plusvalía tributa por la escala, no activo a activo', () => {
  const base = { liabilities: [], expenses: {}, macroParams: DEFAULT_MACRO_PARAMS, exchangeRates: RATES };
  const junto = computeBalance({ ...base,
    assets: [{ id: 'a1', name: 'Todo', subcategory: 'stocks', currency: 'EUR', value: 1000000 }] });
  const partido = computeBalance({ ...base,
    assets: [
      { id: 'a1', name: 'Mitad', subcategory: 'stocks', currency: 'EUR', value: 500000 },
      { id: 'a2', name: 'Otra', subcategory: 'stocks', currency: 'EUR', value: 500000 }
    ] });
  assert.ok(Math.abs(junto.capitalGainsTax - partido.capitalGainsTax) < 0.01);
});

test('liquidación: cancelar la deuda cuesta más que su saldo', () => {
  const r = computeBalance(balanceTipico());
  assert.ok(r.debtCancellationCost > r.totalLiabilities, 'la comisión de cancelación suma');
  const comision = r.debtCancellationCost - r.totalLiabilities;
  assert.ok(comision > 0 && comision < r.totalLiabilities * 0.01);
});
