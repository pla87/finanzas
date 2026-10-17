// --- MOTOR DE CÁLCULO ---
// Todo lo que la aplicación deduce del balance: totales, rendimientos,
// flujos, niveles FIRE y los avisos que alimentan la auditoría.
//
// Vivía dentro de un useMemo de 274 líneas en App.jsx, donde era la última
// pieza de lógica financiera sin prueba posible. Aquí es una función pura de
// sus entradas, así que la cadena entera —motor y auditoría— se puede probar
// de punta a punta.
//
// El cálculo es el mismo, línea por línea. La única dependencia que se ha
// hecho explícita es `expenseLabel`: el memo leía la tabla de traducciones
// directamente para poner nombre a un gasto desviado, y eso ataba el cálculo
// al idioma de la interfaz.

import {
  calculateRealEstateReturns,
  assetAnnualCashflow,
  assetSavingsIncome,
  effectiveSavingsTaxPct,
  savingsTaxOnIncome,
  resolveLiability,
  effectiveInterestRatePct,
  assetGrossLiquidation,
  assetCapitalGain,
  liabilityCancellationCost,
  lifeCoverage,
  convertToBase,
  assetClassOf
} from './finance.js';
import { COUNTRY_PRESETS } from './presets.js';
import { wealthTaxDue } from './wealthTax.js';

export function computeBalance({
  assets = [],
  liabilities = [],
  expenses = {},
  familyMembers = 1,
  macroParams = {},
  baseCurrency = 'EUR',
  selectedCountry = 'es_urban',
  exchangeRates = {},
  // Euríbor a 12 meses del fichero de datos de mercado. Solo lo usan las
  // hipotecas variables; sin él caen a su tipo guardado.
  euriborPct = null,
  expenseLabel = key => key
} = {}) {
  const toBase = (val, fromCurr) => convertToBase(val, fromCurr, baseCurrency, exchangeRates);

  let totalAssets = 0;
  let capGrowthBase = 0;
  let useRetBase = 0;
  let cashRetBase = 0;

  let primaryHomeAssetVal = 0;
  // Qué activos son la vivienda habitual, para saber qué hipotecas pesan
  // sobre ella cuando el fichero trae el vínculo (`propertyLink`, que escribe
  // Retiro) y para repartir la deuda a prorrata cuando no lo trae.
  const primaryHomeIds = new Set();
  let rentalCashflowMonthly = 0;
  let dividendCashflowMonthly = 0;
  let interestCashflowMonthly = 0;
  let tangiblesCashflowMonthly = 0;
  let foreignCurrencyAssetsBase = 0;

  const assetCategoryTotals = { cash: 0, stocks: 0, real_estate: 0, pensions: 0, tangibles: 0 };
  // Lo mismo con el bloque 2 partido en renta variable, renta fija y oro. Es
  // lo que miran la diversificación y la tarta: los bloques siguen siendo
  // cinco, pero un bono no es una acción.
  const assetClassTotals = { cash: 0, equity: 0, fixed_income: 0, gold: 0, real_estate: 0, pensions: 0, tangibles: 0 };

  // La escala del ahorro es progresiva, así que no se puede aplicar activo a
  // activo: hay que sumar primero toda la renta del ahorro del balance
  // —dividendos e intereses—, sacar de ahí la cuota, y repartirla después
  // entre los activos que la generan usando el tipo medio resultante. Hacerlo
  // así es lo que mantiene cuadradas la columna de cada fila y el total.
  const grossSavingsIncome = assets.reduce(
    (sum, a) => sum + toBase(assetSavingsIncome(a, macroParams), a.currency), 0
  );
  const savingsTaxDue = savingsTaxOnIncome(grossSavingsIncome);
  const effectiveSavingsRatePct = effectiveSavingsTaxPct(grossSavingsIncome);

  assets.forEach(a => {
    const valBase = toBase(a.value, a.currency);
    totalAssets += valBase;
    if (assetCategoryTotals[a.subcategory] !== undefined) {
      assetCategoryTotals[a.subcategory] += valBase;
      assetClassTotals[assetClassOf(a)] += valBase;
    }

    if (a.currency && a.currency !== baseCurrency) {
      foreignCurrencyAssetsBase += valBase;
    }

    if (a.subcategory === 'real_estate' && a.useType === 'habitual') {
      primaryHomeAssetVal += valBase;
      if (a.id !== undefined && a.id !== null) primaryHomeIds.add(String(a.id));
    }

    let itemCapPct = Number(a.capitalReturnPct) || 0;
    let itemUsePct = Number(a.useReturnPct) || 0;
    let itemCashPct = Number(a.cashReturnPct) || 0;

    if (a.subcategory === 'real_estate') {
      const reReturns = calculateRealEstateReturns(a.value, a.monthlyRent, a.useType || 'habitual', macroParams);
      itemCashPct = reReturns.cashReturnPct;
      itemUsePct = reReturns.useReturnPct;
      itemCapPct = reReturns.capitalReturnPct;
    }

    // Misma función que usa la tabla de activos, para que la columna de
    // una fila y el total de la tarjeta no puedan divergir.
    const netCashflowBase = toBase(assetAnnualCashflow(a, macroParams, effectiveSavingsRatePct).net, a.currency);
    cashRetBase += netCashflowBase;

    // El cupón de un bono es un interés, no un dividendo, aunque el bono
    // viva en el mismo bloque que las acciones.
    if (a.subcategory === 'real_estate') {
      rentalCashflowMonthly += netCashflowBase / 12;
    } else if (a.subcategory === 'stocks' && assetClassOf(a) !== 'fixed_income') {
      dividendCashflowMonthly += netCashflowBase / 12;
    } else if (a.subcategory === 'cash' || a.subcategory === 'stocks') {
      interestCashflowMonthly += netCashflowBase / 12;
    } else if (a.subcategory === 'tangibles') {
      tangiblesCashflowMonthly += netCashflowBase / 12;
    }

    capGrowthBase += valBase * (itemCapPct / 100);
    useRetBase += valBase * (itemUsePct / 100);
  });

  const foreignCurrencyPct = totalAssets > 0 ? (foreignCurrencyAssetsBase / totalAssets) * 100 : 0;

  const weightedCashPct = totalAssets > 0 ? (cashRetBase / totalAssets) * 100 : 0;
  const weightedUsePct = totalAssets > 0 ? (useRetBase / totalAssets) * 100 : 0;
  const weightedCapPct = totalAssets > 0 ? (capGrowthBase / totalAssets) * 100 : 0;
  const totalGrossReturnBase = capGrowthBase + cashRetBase + useRetBase;
  const totalGrossReturnPct = totalAssets > 0 ? (totalGrossReturnBase / totalAssets) * 100 : 0;

  // --- Valor de liquidación ---
  // Cuánto dinero quedaría si se vendiera todo y se cancelara toda la deuda.
  // El impuesto sobre la plusvalía se calcula sobre la ganancia agregada, no
  // activo a activo, porque la escala del ahorro es progresiva igual que con
  // los dividendos.
  const grossLiquidation = assets.reduce(
    (sum, a) => sum + toBase(assetGrossLiquidation(a, macroParams), a.currency), 0
  );
  const totalCapitalGain = assets.reduce(
    (sum, a) => sum + toBase(assetCapitalGain(a, macroParams), a.currency), 0
  );
  const capitalGainsTax = savingsTaxOnIncome(totalCapitalGain);

  let totalLiabilities = 0;
  let debtInterestBase = 0;
  let monthlyDebtPayments = 0;
  let debtCancellationCost = 0;
  let mortgageDebtBase = 0;
  let mortgageDebtOnPrimaryHome = 0;
  let algunaHipotecaVinculada = false;

  const liabilityCategoryTotals = { short_term: 0, personal_loans: 0, family_loans: 0, mortgages: 0 };


  liabilities.forEach(l => {
    let currentVal = Number(l.value) || 0;
    let currentMonthly = Number(l.monthlyPayment) || 0;

    ({ value: currentVal, monthlyPayment: currentMonthly } = resolveLiability(l, new Date(), { euriborPct }));

    const valBase = toBase(currentVal, l.currency);
    totalLiabilities += valBase;
    if (liabilityCategoryTotals[l.subcategory] !== undefined) {
      liabilityCategoryTotals[l.subcategory] += valBase;
    }
    // El interés de una hipoteca variable es euríbor más diferencial, no el
    // tipo que quedó guardado la última vez.
    debtInterestBase += valBase * (effectiveInterestRatePct(l, euriborPct) / 100);
    monthlyDebtPayments += toBase(currentMonthly, l.currency);
    debtCancellationCost += toBase(
      liabilityCancellationCost(l, macroParams, { value: currentVal }), l.currency
    );

    if (l.subcategory === 'mortgages') {
      mortgageDebtBase += valBase;
      if (l.propertyLink) {
        algunaHipotecaVinculada = true;
        if (primaryHomeIds.has(String(l.propertyLink))) mortgageDebtOnPrimaryHome += valBase;
      }
    }
  });

  // Cuánta hipoteca pesa sobre la vivienda habitual. Si alguna deuda trae el
  // vínculo al inmueble, mandan los vínculos y punto. Si no —las fichas de
  // aquí no piden ese dato—, se reparte la deuda hipotecaria entre los
  // inmuebles a prorrata de su valor: con una casa y una hipoteca, que es el
  // caso corriente, sale exacto.
  const realEstateBase = assetCategoryTotals.real_estate;
  const primaryHomeDebt = algunaHipotecaVinculada
    ? mortgageDebtOnPrimaryHome
    : (realEstateBase > 0 ? mortgageDebtBase * (primaryHomeAssetVal / realEstateBase) : 0);

  // Lo que de verdad quedaría en la cuenta al final de todo.
  const liquidationValue = grossLiquidation - capitalGainsTax - debtCancellationCost;

  const weightedInterestPct = totalLiabilities > 0 ? (debtInterestBase / totalLiabilities) * 100 : 0;
  const annualDebtPayments = monthlyDebtPayments * 12;

  const netWorth = totalAssets - totalLiabilities;
  const nonPrimaryNetWorth = (totalAssets - primaryHomeAssetVal) - totalLiabilities;

  // Impuesto sobre el patrimonio: un coste anual obligatorio por tener, no por
  // ganar. No lo genera ningún activo en concreto, así que se calcula sobre el
  // patrimonio entero —como la escala del ahorro sobre la renta entera— y entra
  // en el coste obligatorio junto al gasto y las cuotas de deuda. Para la
  // inmensa mayoría de los balances sale cero y no cambia nada.
  const wealthTax = wealthTaxDue({
    netWorth,
    primaryHomeValue: primaryHomeAssetVal,
    primaryHomeDebt,
    regionKey: macroParams.wealthTaxRegion,
    exemption: macroParams.wealthTaxExemption,
    bonificationPct: macroParams.wealthTaxBonificationPct,
    taxpayers: macroParams.wealthTaxPayers
  });
  const monthlyWealthTax = wealthTax.monthly;


  const ltv = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : (totalLiabilities > 0 ? 100 : 0);
  // Rendimiento Integral (con Uso)
  const netReturnBase = totalGrossReturnBase - debtInterestBase;
  const roa = totalAssets > 0 ? (netReturnBase / totalAssets) * 100 : 0;
  const roe = netWorth > 0 ? (netReturnBase / netWorth) * 100 : 0;

  // Rendimiento Financiero Puro (sin Uso)
  const netFinancialReturnBase = (capGrowthBase + cashRetBase) - debtInterestBase;
  const roaFinancial = totalAssets > 0 ? (netFinancialReturnBase / totalAssets) * 100 : 0;
  const roeFinancial = netWorth > 0 ? (netFinancialReturnBase / netWorth) * 100 : 0;

  // Gastos
  const sumPersonMonthly = Object.values(expenses.person_monthly || {}).reduce((acc, v) => acc + Number(v), 0);
  const sumHouseholdMonthly = Object.values(expenses.household_monthly || {}).reduce((acc, v) => acc + Number(v), 0);
  const sumFamilyAnnual = Object.values(expenses.family_annual || {}).reduce((acc, v) => acc + Number(v), 0);

  const validFamilyMembers = Math.max(1, Number(familyMembers) || 1);
  const totalMonthlyExpenses = (sumPersonMonthly * validFamilyMembers) + sumHouseholdMonthly + (sumFamilyAnnual / 12);
  const totalAnnualExpenses = totalMonthlyExpenses * 12;

  const leanMonthlyExpenses = totalMonthlyExpenses * 0.60;

  const monthlyPassiveCashflow = cashRetBase / 12;
  const liquidCash = assetCategoryTotals.cash;
  const assetCashflowSurplus = monthlyPassiveCashflow - monthlyDebtPayments - monthlyWealthTax;
  const netMonthlyCashflow = assetCashflowSurplus - totalMonthlyExpenses;

  const expectedInflationRate = Number(macroParams.inflationPct || 2.0);

  // Runway Calculation: Strictly liquid assets divided by mandatory burn (debt service + living costs)
  const totalBurn = monthlyDebtPayments + totalMonthlyExpenses + monthlyWealthTax;
  const runwayTotalMonths = totalBurn > 0 ? liquidCash / totalBurn : (liquidCash > 0 ? Infinity : 0);
  const runwayNetMonths = runwayTotalMonths;

  // El runway estricto es conservador dos veces: solo cuenta la categoría de
  // caja —deja fuera fondos y acciones, que se venden en días— y trata la
  // cuota entera de la deuda como gasto, cuando la parte de principal no
  // desaparece: se convierte en patrimonio. Cada decisión por separado se
  // defiende; juntas subestiman bastante.
  //
  // Esta segunda lectura afloja las dos: suma lo realmente vendible y cuenta
  // solo los intereses, que es lo que de verdad se va. Lo vendible es el
  // bloque 2 entero, renta fija y oro incluidos: también se venden en días.
  // No sustituye a la estricta ni toca los niveles FIRE, que siguen mirando
  // la de arriba: se informa al lado para que se vea el rango.
  const liquidSellable = liquidCash + assetCategoryTotals.stocks;
  const monthlyDebtInterest = debtInterestBase / 12;
  // De la cuota se cuenta la parte que se consume de verdad: los intereses,
  // porque el principal no se pierde, se convierte en patrimonio. Pero nunca
  // más de lo que sale de la cuenta: una tarjeta que se paga a 50 al mes
  // mientras genera 110 de intereses no saca 110 de la cuenta, saca 50 —y la
  // deuda crece, que es otro problema y lo recoge el saldo—. Sin este tope,
  // esa tarjeta hacía que la lectura «menos estricta» saliera más estricta que
  // la otra, que es justo lo contrario de lo que dice ser.
  const relaxedDebtCost = Math.min(monthlyDebtInterest, monthlyDebtPayments);
  const relaxedBurn = totalMonthlyExpenses + relaxedDebtCost + monthlyWealthTax;
  const runwaySellableMonths = relaxedBurn > 0
    ? liquidSellable / relaxedBurn
    : (liquidSellable > 0 ? Infinity : 0);

  // Qué parte de la vida pagan hoy los activos. Misma magnitud que la
  // caja neta mensual, leída como proporción en lugar de como déficit.
  const coverage = lifeCoverage(monthlyPassiveCashflow, totalMonthlyExpenses, monthlyDebtPayments + monthlyWealthTax, useRetBase / 12);

  // Criterios de niveles FIRE
  const isRoa150BpsAboveInflation = roaFinancial >= (expectedInflationRate + 1.50);
  const yearsOfExpensesCovered = totalAnnualExpenses > 0 ? netWorth / totalAnnualExpenses : 0;
  // Nivel 6 mide el stock de capital; el nivel 5 ya mide el flujo de caja.
  // Encadenar ambas condiciones aquí dejaba el último nivel inalcanzable.
  const fireTargetMultiple = Math.max(1, Number(macroParams.fireTargetMultiple) || 25);
  const fireAmberMultiple = fireTargetMultiple * 0.8;
  const isAbundanceAchieved = yearsOfExpensesCovered >= fireTargetMultiple;

  let rawL0 = 0;
  if (runwayNetMonths >= 6) rawL0 = 2;
  else if (runwayNetMonths >= 3) rawL0 = 1;

  let rawL1 = nonPrimaryNetWorth > 0 ? 2 : 0;
  let rawL2 = totalAssets > 0 && netWorth > 0 ? (isRoa150BpsAboveInflation ? 2 : (roaFinancial >= expectedInflationRate ? 1 : 0)) : 0;
  let rawL3 = (monthlyDebtPayments === 0 && totalAssets > 0 && monthlyPassiveCashflow >= 0) || (monthlyPassiveCashflow > 0 && assetCashflowSurplus >= 0)
  ? 2 
  : (monthlyPassiveCashflow > 0 && monthlyDebtPayments > 0 && monthlyPassiveCashflow >= monthlyDebtPayments * 0.5 ? 1 : 0);

  let rawL4 = 0;
  if (assetCashflowSurplus >= leanMonthlyExpenses && monthlyPassiveCashflow > 0) rawL4 = 2;
  else if (assetCashflowSurplus >= (leanMonthlyExpenses * 0.5) && monthlyPassiveCashflow > 0) rawL4 = 1;

  let rawL5 = 0;
  if (netMonthlyCashflow >= 0 && monthlyPassiveCashflow > 0) rawL5 = 2;
  else if (assetCashflowSurplus >= leanMonthlyExpenses && monthlyPassiveCashflow > 0) rawL5 = 1;

  let rawL6 = 0;
  if (isAbundanceAchieved) {
    rawL6 = 2; // Verde: el patrimonio cubre el múltiplo objetivo de gasto anual
  } else if (yearsOfExpensesCovered >= fireAmberMultiple) {
    rawL6 = 1; // Amarillo: dentro del 80% del objetivo
  }

  const rawLevels = [rawL0, rawL1, rawL2, rawL3, rawL4, rawL5, rawL6];
  const statusLevels = [];
  const milestoneDetails = [];

  let blockerLevel = null;

  for (let i = 0; i < rawLevels.length; i++) {
    const raw = rawLevels[i];
    const meetsCriteria = raw === 2;
    const partialCriteria = raw === 1;

    if (blockerLevel !== null) {
      statusLevels.push('red');
      milestoneDetails.push({
        status: 'red',
      isBlocked: meetsCriteria || partialCriteria,
      blockedBy: blockerLevel,
        meetsOwnCriteria: meetsCriteria || partialCriteria
      });
    } else if (meetsCriteria) {
      statusLevels.push('green');
      milestoneDetails.push({
        status: 'green',
        isBlocked: false,
        blockedBy: null,
        meetsOwnCriteria: true
      });
    } else if (partialCriteria) {
      statusLevels.push('yellow');
      milestoneDetails.push({
        status: 'yellow',
        isBlocked: false,
        blockedBy: null,
        meetsOwnCriteria: true
      });
      blockerLevel = i;
    } else {
      statusLevels.push('red');
      milestoneDetails.push({
        status: 'red',
        isBlocked: false,
        blockedBy: null,
        meetsOwnCriteria: false
      });
      blockerLevel = i;
    }
  }

  // Puntuaciones Auditoría
  const expensiveDebt = liabilities.filter(l => Number(l.interestRatePct) > 5.0 && Number(l.value) > 0);
  const lowYieldPensions = assets.filter(a => a.subcategory === 'pensions' && Number(a.capitalReturnPct) < expectedInflationRate && Number(a.value) > 0);
  const unremuneratedCash = assets.filter(a => a.subcategory === 'cash' && Number(a.cashReturnPct) <= 0.5 && Number(a.value) > 0);

  const currentBenchmark = COUNTRY_PRESETS[selectedCountry] || COUNTRY_PRESETS.es_urban;
  const excessExpensesList = [];
  const benchmarkCurrency = selectedCountry.startsWith('us_') ? 'USD' : selectedCountry.startsWith('uk_') ? 'GBP' : 'EUR';

  const checkExpenseDeviation = (key, val, benchVal) => {
    const convertedBench = toBase(benchVal, benchmarkCurrency);
    if (convertedBench > 0 && val >= convertedBench * 1.5) {
      const isExtreme = val >= convertedBench * 3.0;
      excessExpensesList.push({
        name: expenseLabel(key),
        actual: val,
        bench: Math.round(convertedBench),
        ratio: Math.round((val / convertedBench) * 100),
        isExtreme
      });
    }
  };

  Object.entries(expenses.person_monthly || {}).forEach(([k, val]) => {
    checkExpenseDeviation(k, val, currentBenchmark.person_monthly[k] || 0);
  });
  Object.entries(expenses.household_monthly || {}).forEach(([k, val]) => {
    checkExpenseDeviation(k, val, currentBenchmark.household_monthly[k] || 0);
  });
  Object.entries(expenses.family_annual || {}).forEach(([k, val]) => {
    checkExpenseDeviation(k, val, currentBenchmark.family_annual[k] || 0);
  });



  return {
    totalAssets, totalLiabilities, netWorth, nonPrimaryNetWorth, ltv, roa, roe,
    roaFinancial, roeFinancial, netFinancialReturnBase,
    capGrowthBase, useRetBase, cashRetBase,
    weightedCashPct, weightedUsePct, weightedCapPct,
    totalGrossReturnBase, totalGrossReturnPct,
    debtInterestBase, weightedInterestPct,
    monthlyDebtPayments, annualDebtPayments,
    monthlyPassiveCashflow, totalMonthlyExpenses, totalAnnualExpenses,
    leanMonthlyExpenses,
    assetCashflowSurplus, netMonthlyCashflow, expectedInflationRate,
    yearsOfExpensesCovered, isAbundanceAchieved,
    fireTargetMultiple, fireAmberMultiple,
    liquidCash, runwayTotalMonths, runwayNetMonths, coverage,
    grossSavingsIncome, savingsTaxDue, effectiveSavingsRatePct,
    wealthTax, monthlyWealthTax,
    totalCapitalGain, capitalGainsTax, debtCancellationCost, liquidationValue,
    liquidSellable, monthlyDebtInterest, relaxedDebtCost, relaxedBurn, runwaySellableMonths,
    statusLevels,
    milestoneDetails,
    netReturnBase, sumPersonMonthly, sumHouseholdMonthly, sumFamilyAnnual, validFamilyMembers,
    assetCategoryTotals, assetClassTotals, liabilityCategoryTotals,
    expensiveDebt, lowYieldPensions, unremuneratedCash, excessExpensesList,
    foreignCurrencyAssetsBase, foreignCurrencyPct,
    rentalCashflowMonthly, dividendCashflowMonthly, interestCashflowMonthly, tangiblesCashflowMonthly
  };
}
