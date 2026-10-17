import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAudit, scoreFromAnchors } from './audit.js';

const dim = (audit, id) => audit.dimensions.find(d => d.id === id);

// Un balance sano y corriente que sirve de punto de partida.
const BASE = {
  totalAssets: 230000,
  totalLiabilities: 127000,
  netWorth: 103000,
  ltv: 55.2,
  liquidCash: 18000,
  runwayMonths: 4.8,
  totalAnnualExpenses: 38000,
  totalMonthlyExpenses: 3170,
  monthlyDebtPayments: 530,
  monthlyPassiveCashflow: 74,
  coveragePct: 2.0,
  assetCategoryTotals: { cash: 18000, stocks: 32000, real_estate: 160000, pensions: 10000, tangibles: 10000 },
  holdings: [
    { name: 'Vivienda', valueBase: 160000 },
    { name: 'ETF', valueBase: 20000 },
    { name: 'Inditex', valueBase: 12000 }
  ],
  foreignCurrencyPct: 0,
  expensiveDebt: [],
  lowYieldPensions: [],
  excessExpenses: [],
  macroParams: { inflationPct: 2, savingsTaxRatePct: 21, fireTargetMultiple: 25 }
};

// --- INTERPOLACIÓN (P2.2) ---

test('P2.2: la puntuación interpola en vez de saltar por escalones', () => {
  const anchors = [{ at: 3, score: 20 }, { at: 6, score: 45 }];
  const a = scoreFromAnchors(5.99, anchors);
  const b = scoreFromAnchors(6.0, anchors);
  assert.ok(Math.abs(b - a) < 0.2, `salto de ${b - a} puntos por un céntimo`);
  assert.ok(a > 44 && a < 45, `5,99 meses debería puntuar casi como 6: ${a}`);
});

test('P2.2: la interpolación satura fuera del rango de anclajes', () => {
  const anchors = [{ at: 0, score: 0 }, { at: 10, score: 30 }];
  assert.equal(scoreFromAnchors(-5, anchors), 0);
  assert.equal(scoreFromAnchors(999, anchors), 30);
  assert.equal(scoreFromAnchors(5, anchors), 15);
});

test('P2.2: el colchón de emergencia ya no da un salto de seis puntos', () => {
  const justoAntes = buildAudit({ ...BASE, runwayMonths: 5.99 });
  const justoDespues = buildAudit({ ...BASE, runwayMonths: 6.0 });
  const salto = dim(justoDespues, 'runway').points - dim(justoAntes, 'runway').points;
  assert.ok(salto < 0.5, `salto de ${salto} puntos`);
});

// --- DOS EJES Y NOTA COMBINADA (P2.1) ---

test('P2.1: estructura y soporte se puntúan por separado', () => {
  const a = buildAudit(BASE);
  assert.ok(a.structure.score >= 0 && a.structure.score <= 100);
  assert.ok(a.support.score >= 0 && a.support.score <= 100);
  assert.notEqual(a.structure.score, a.support.score, 'los dos ejes no deberían coincidir aquí');
});

test('P2.1: la nota combinada es la media de los dos ejes', () => {
  const a = buildAudit(BASE);
  assert.ok(Math.abs(a.combined - (a.structure.score + a.support.score) / 2) < 0.1);
});

test('P2.1: una estructura sólida que aún no te mantiene se distingue de lo contrario', () => {
  const soloEstructura = buildAudit({ ...BASE, monthlyPassiveCashflow: 0, coveragePct: 0, runwayMonths: 0.5, liquidCash: 1500 });
  const soloSoporte = buildAudit({
    ...BASE, ltv: 88, netWorth: 27000, totalAssets: 230000, totalLiabilities: 203000,
    coveragePct: 95, runwayMonths: 12, liquidCash: 44000, monthlyPassiveCashflow: 3515
  });
  assert.ok(soloEstructura.structure.score > soloEstructura.support.score);
  assert.ok(soloSoporte.support.score > soloSoporte.structure.score);
});

// --- DELTAS DERIVADOS (P2.3) ---

test('P2.3: cada dimensión dice cuánto ganaría y qué hace falta', () => {
  const a = buildAudit(BASE);
  const runway = dim(a, 'runway');
  assert.ok(runway.action, 'el colchón debería tener un siguiente objetivo');
  assert.ok(runway.action.gain > 0);
  // 6 meses de un consumo de 3.700 son 22.200; con 18.000 faltan ~4.200.
  const esperado = 6 * (BASE.totalMonthlyExpenses + BASE.monthlyDebtPayments) - BASE.liquidCash;
  assert.ok(Math.abs(runway.action.requiredBase - esperado) < 1, `esperado ${esperado}, obtenido ${runway.action.requiredBase}`);
});

test('P2.3: el objetivo de solvencia se expresa en patrimonio adicional', () => {
  const a = buildAudit(BASE);
  const s = dim(a, 'solvency');
  assert.ok(s.action.requiredBase > 0);
  assert.equal(s.action.requiredBase, s.action.value * BASE.totalAnnualExpenses - BASE.netWorth);
});

test('P2.3: alcanzado el tramo máximo ya no se promete ninguna ganancia', () => {
  const a = buildAudit({ ...BASE, runwayMonths: 12 });
  assert.equal(dim(a, 'runway').action, null);
});

// --- DIVERSIFICACIÓN MIRA DENTRO DE LAS CATEGORÍAS (P2.4) ---

test('P2.4: una sola posición concentrada no puntúa como cartera diversificada', () => {
  const unSoloETF = buildAudit({
    ...BASE,
    assetCategoryTotals: { cash: 5000, stocks: 195000, real_estate: 0, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'ETF único', valueBase: 195000 }, { name: 'Cuenta', valueBase: 5000 }]
  });
  const repartido = buildAudit({
    ...BASE,
    assetCategoryTotals: { cash: 5000, stocks: 195000, real_estate: 0, pensions: 0, tangibles: 0 },
    holdings: Array.from({ length: 10 }, (_, i) => ({ name: `ETF ${i}`, valueBase: 19500 })).concat([{ name: 'Cuenta', valueBase: 5000 }])
  });
  assert.ok(
    repartido.dimensions.find(d => d.id === 'diversification').points >
    unSoloETF.dimensions.find(d => d.id === 'diversification').points,
    'diez posiciones deberían puntuar más que una sola del mismo tamaño'
  );
});

test('P2.4: la dimensión informa de la mayor posición individual', () => {
  const a = buildAudit(BASE);
  const d = dim(a, 'diversification');
  assert.ok(Math.abs(d.detail.largestHoldingPct - (160000 / 230000) * 100) < 0.1);
});

// --- DIMENSIONES QUE NO APLICAN (P2.5) ---

test('P2.5: sin deuda el apalancamiento no puntúa 25/25, sale del denominador', () => {
  const sinDeuda = buildAudit({ ...BASE, totalLiabilities: 0, netWorth: 230000, ltv: 0, monthlyDebtPayments: 0 });
  const lev = dim(sinDeuda, 'leverage');
  assert.equal(lev.applicable, false);
  assert.equal(lev.points, null);
  assert.equal(sinDeuda.structure.available, 75, 'el eje se normaliza sobre 75, no sobre 100');
});

test('P2.5: excluir una dimensión no regala puntos', () => {
  const sinDeuda = buildAudit({ ...BASE, totalLiabilities: 0, netWorth: 230000, ltv: 0, monthlyDebtPayments: 0 });
  assert.ok(sinDeuda.structure.score <= 100);
  assert.equal(sinDeuda.structure.earned <= sinDeuda.structure.available, true);
});

// --- LIBRO DE PENALIZACIONES (P2.6) ---

test('P2.6: el exceso de liquidez aparece como penalización con su coste', () => {
  const conExceso = buildAudit({ ...BASE, liquidCash: 120000, totalAssets: 230000 });
  const ef = dim(conExceso, 'efficiency');
  const drag = ef.penalties.find(p => p.id === 'cash_drag');
  assert.ok(drag, 'la penalización por exceso de liquidez debe ser visible');
  assert.equal(drag.cost, 4);
});

test('P2.6: las penalizaciones suman exactamente lo que se descuenta', () => {
  const a = buildAudit({
    ...BASE,
    expensiveDebt: [{ name: 'Tarjeta', interestRatePct: 12 }],
    lowYieldPensions: [{ name: 'Plan' }],
    excessExpenses: [{ name: 'Ocio' }]
  });
  const ef = dim(a, 'efficiency');
  const total = ef.penalties.reduce((s, p) => s + p.cost, 0);
  assert.equal(ef.points, 20 - total);
});

test('P2.6: la eficiencia nunca baja de cero', () => {
  const a = buildAudit({
    ...BASE,
    expensiveDebt: Array.from({ length: 9 }, (_, i) => ({ name: `Deuda ${i}` })),
    lowYieldPensions: [{ name: 'A' }, { name: 'B' }],
    excessExpenses: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }],
    liquidCash: 120000
  });
  assert.ok(dim(a, 'efficiency').points >= 0);
});

// --- CIRCUIT BREAKERS (P2.8) ---

test('P2.8: la insolvencia declara el límite en vez de recortar en silencio', () => {
  const a = buildAudit({ ...BASE, netWorth: -12000, totalLiabilities: 242000, ltv: 105 });
  assert.equal(a.insolvent, true);
  assert.equal(a.cap.limit, 40);
  assert.ok(a.structure.score <= 40);
});

test('P2.8: un balance vacío no puntúa', () => {
  const a = buildAudit({ ...BASE, totalAssets: 0, totalLiabilities: 0, netWorth: 0, liquidCash: 0 });
  assert.equal(a.empty, true);
  assert.equal(a.combined, 0);
});

// --- SUPUESTOS (P2.7) ---

test('P2.7: la auditoría declara los supuestos con los que se ha calculado', () => {
  const a = buildAudit(BASE);
  assert.equal(a.assumptions.savingsTaxRatePct, 21);
  assert.equal(a.assumptions.inflationPct, 2);
  assert.equal(a.assumptions.fireTargetMultiple, 25);
});

// --- SALIDA ESTRUCTURADA (P2.9) ---

test('P2.9: cada dimensión trae los campos que la interfaz necesita', () => {
  const a = buildAudit(BASE);
  assert.equal(a.dimensions.length, 6);
  for (const d of a.dimensions) {
    assert.ok(typeof d.id === 'string');
    assert.ok(d.axis === 'structure' || d.axis === 'support');
    assert.ok(typeof d.max === 'number');
    assert.ok(typeof d.applicable === 'boolean');
    assert.ok(d.points === null || typeof d.points === 'number');
  }
});

test('P2.9: ninguna dimensión supera su propio máximo', () => {
  for (const caso of [BASE,
    { ...BASE, runwayMonths: 999, liquidCash: 900000 },
    { ...BASE, coveragePct: 400, monthlyPassiveCashflow: 99999 },
    { ...BASE, ltv: 0, totalLiabilities: 1 }]) {
    for (const d of buildAudit(caso).dimensions) {
      if (d.points !== null) assert.ok(d.points <= d.max, `${d.id}: ${d.points} > ${d.max}`);
      if (d.points !== null) assert.ok(d.points >= 0, `${d.id}: ${d.points} < 0`);
    }
  }
});

test('P2.3: el objetivo de apalancamiento se expresa en deuda a amortizar', () => {
  const a = buildAudit(BASE);
  const lev = dim(a, 'leverage');
  // Bajar de 55,2% a 50% sobre 230.000 de activo son 115.000 de deuda: 12.000 menos.
  assert.equal(lev.action.value, 50);
  assert.ok(Math.abs(lev.action.requiredBase - 12000) < 1, `obtenido ${lev.action.requiredBase}`);
});

// --- LA MEJORA PROPUESTA EN CADA SECCIÓN ---

test('todas las dimensiones aplicables proponen una acción con su ganancia', () => {
  const a = buildAudit(BASE);
  for (const d of a.dimensions) {
    if (!d.applicable || d.points === null) continue;
    if (d.points >= d.max - 0.05) continue;   // ya al máximo: no hay nada que proponer
    assert.ok(d.action, `${d.id} no propone ninguna mejora`);
    assert.ok(d.action.gain > 0, `${d.id} propone una mejora sin ganancia`);
  }
});

test('la ganancia prometida nunca supera lo que queda por ganar', () => {
  const a = buildAudit(BASE);
  for (const d of a.dimensions) {
    if (!d.action || d.points === null) continue;
    assert.ok(d.action.gain <= d.max - d.points + 0.05,
      `${d.id} promete ${d.action.gain} pts pero solo quedan ${d.max - d.points}`);
  }
});

test('diversificación: propone repartir la posición dominante', () => {
  const a = buildAudit({
    ...BASE,
    assetCategoryTotals: { cash: 5000, stocks: 195000, real_estate: 0, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'ETF único', valueBase: 195000 }, { name: 'Cuenta', valueBase: 5000 }]
  });
  const d = dim(a, 'diversification');
  assert.ok(['reduce_category_concentration', 'reduce_holding_concentration'].includes(d.action.id),
    `propuso ${d.action.id}`);
  assert.ok(d.action.gain > 1);
});

test('diversificación: con la concentración resuelta propone ampliar clases o divisa', () => {
  const a = buildAudit({
    ...BASE,
    assetCategoryTotals: { cash: 60000, stocks: 60000, real_estate: 60000, pensions: 50000, tangibles: 0 },
    holdings: [{ name: 'A', valueBase: 60000 }, { name: 'B', valueBase: 60000 }, { name: 'C', valueBase: 60000 }, { name: 'D', valueBase: 50000 }],
    foreignCurrencyPct: 0
  });
  const d = dim(a, 'diversification');
  assert.equal(d.action.id, 'add_foreign_exposure');
});

test('eficiencia: propone eliminar la penalización más cara', () => {
  const a = buildAudit({
    ...BASE,
    expensiveDebt: [{ name: 'Tarjeta' }, { name: 'Préstamo' }],  // 8 pts
    lowYieldPensions: [{ name: 'Plan' }]                          // 3 pts
  });
  const d = dim(a, 'efficiency');
  assert.equal(d.action.id, 'clear_expensive_debt');
  assert.equal(d.action.gain, 8);
  assert.deepEqual(d.action.items, ['Tarjeta', 'Préstamo']);
});

test('eficiencia: sin penalizaciones no se propone nada', () => {
  assert.equal(dim(buildAudit(BASE), 'efficiency').action, null);
});

test('la acción propuesta es siempre la de mayor ganancia disponible', () => {
  const a = buildAudit({
    ...BASE,
    expensiveDebt: [{ name: 'Tarjeta' }],          // 4 pts
    excessExpenses: [{ name: 'X' }, { name: 'Y' }] // 4 pts
  });
  const d = dim(a, 'efficiency');
  const mayor = Math.max(...d.penalties.map(p => p.cost));
  assert.equal(d.action.gain, mayor);
});

// --- MÉRITOS ---
// La nota decía solo lo que falta. Cada dimensión informa ahora también de lo
// que ya está bien, y tiene que salir de los mismos números que la puntuaron:
// no puede felicitar por algo que a la vez está descontando puntos.

const idsDe = (a, dimId) => (a.dimensions.find(d => d.id === dimId).strengths || []).map(s => s.id);

test('un balance sano acumula méritos en todas las dimensiones', () => {
  const a = buildAudit({
    totalAssets: 900000, totalLiabilities: 120000, netWorth: 780000, ltv: 13.3,
    liquidCash: 60000, runwayMonths: 14,
    totalAnnualExpenses: 42000, totalMonthlyExpenses: 3500, monthlyDebtPayments: 800,
    monthlyPassiveCashflow: 2600, coveragePct: 60,
    assetCategoryTotals: { cash: 60000, stocks: 300000, real_estate: 340000, pensions: 200000, tangibles: 0 },
    holdings: [{ name: 'a', valueBase: 200000 }, { name: 'b', valueBase: 180000 }],
    foreignCurrencyPct: 22, expensiveDebt: [], lowYieldPensions: [], excessExpenses: []
  });

  assert.ok(idsDe(a, 'solvency').includes('solvency_positive'));
  assert.ok(idsDe(a, 'solvency').includes('solvency_years'));
  assert.ok(idsDe(a, 'leverage').includes('leverage_low'));
  assert.ok(idsDe(a, 'diversification').includes('div_fx'));
  assert.ok(idsDe(a, 'diversification').includes('div_classes'));
  assert.ok(idsDe(a, 'efficiency').includes('eff_debt_cheap'));
  assert.ok(idsDe(a, 'efficiency').includes('eff_pensions'));
  assert.ok(idsDe(a, 'runway').includes('runway_solid'));
  assert.ok(idsDe(a, 'coverage').includes('coverage_half'));
  assert.ok(idsDe(a, 'coverage').includes('coverage_positive'));
});

test('un balance en apuros no recibe felicitaciones que no ha ganado', () => {
  const a = buildAudit({
    totalAssets: 40000, totalLiabilities: 60000, netWorth: -20000, ltv: 150,
    liquidCash: 500, runwayMonths: 0.2,
    totalAnnualExpenses: 30000, totalMonthlyExpenses: 2500, monthlyDebtPayments: 900,
    monthlyPassiveCashflow: -50, coveragePct: 0,
    assetCategoryTotals: { cash: 500, stocks: 0, real_estate: 39500, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'piso', valueBase: 39500 }],
    foreignCurrencyPct: 0,
    expensiveDebt: [{ name: 'tarjeta' }], lowYieldPensions: [], excessExpenses: [{ name: 'ocio' }]
  });

  assert.deepEqual(idsDe(a, 'solvency'), []);
  assert.deepEqual(idsDe(a, 'leverage'), []);
  assert.deepEqual(idsDe(a, 'runway'), []);
  assert.deepEqual(idsDe(a, 'coverage'), []);
  // Ni deuda barata ni gasto contenido: las dos penalizaciones han saltado.
  assert.ok(!idsDe(a, 'efficiency').includes('eff_debt_cheap'));
  assert.ok(!idsDe(a, 'efficiency').includes('eff_expenses'));
  // Concentrado en un solo piso: tampoco hay mérito de diversificación.
  assert.ok(!idsDe(a, 'diversification').includes('div_categories'));
  assert.ok(!idsDe(a, 'diversification').includes('div_holding'));
});

test('un mérito de eficiencia solo aparece si la penalización podía saltar', () => {
  // Sin deuda no hay mérito en no tener deuda cara; sin planes de pensiones no
  // lo hay en que rindan. Felicitar por lo que no existe es ruido.
  const a = buildAudit({
    totalAssets: 300000, totalLiabilities: 0, netWorth: 300000, ltv: 0,
    liquidCash: 20000, runwayMonths: 10,
    totalAnnualExpenses: 24000, totalMonthlyExpenses: 2000, monthlyDebtPayments: 0,
    monthlyPassiveCashflow: 300, coveragePct: 15,
    assetCategoryTotals: { cash: 20000, stocks: 130000, real_estate: 150000, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'a', valueBase: 150000 }],
    foreignCurrencyPct: 0, expensiveDebt: [], lowYieldPensions: [], excessExpenses: []
  });
  assert.ok(!idsDe(a, 'efficiency').includes('eff_debt_cheap'));
  assert.ok(!idsDe(a, 'efficiency').includes('eff_pensions'));
  assert.ok(idsDe(a, 'efficiency').includes('eff_expenses'));
});

test('los méritos no contradicen a la puntuación de su dimensión', () => {
  // Regla dura: si una dimensión ha sacado menos de la mitad de sus puntos, no
  // puede estar presumiendo de nada en esa misma dimensión.
  const flojo = buildAudit({
    totalAssets: 100000, totalLiabilities: 75000, netWorth: 25000, ltv: 75,
    liquidCash: 800, runwayMonths: 0.4,
    totalAnnualExpenses: 30000, totalMonthlyExpenses: 2500, monthlyDebtPayments: 1200,
    monthlyPassiveCashflow: 0, coveragePct: 0,
    assetCategoryTotals: { cash: 800, stocks: 0, real_estate: 99200, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'piso', valueBase: 99200 }],
    foreignCurrencyPct: 0, expensiveDebt: [], lowYieldPensions: [], excessExpenses: []
  });
  for (const d of flojo.dimensions) {
    if (!d.applicable || d.points === null) continue;
    if (d.points < d.max / 2 && d.id !== 'efficiency' && d.id !== 'solvency') {
      assert.deepEqual(d.strengths || [], [],
        `${d.id} saca ${d.points}/${d.max} y aun así presume de ${JSON.stringify(d.strengths)}`);
    }
  }
});

test('el consejo cuenta el impuesto sobre el patrimonio, igual que el motor', () => {
  // El motor mete el impuesto sobre el patrimonio en el coste obligatorio —es
  // un pago anual por tener, como la cuota de una deuda— y de ahí salen la
  // cobertura y el colchón que se ven en pantalla. La auditoría lo ignoraba,
  // así que aconsejaba contra un coste de vida más pequeño del que enseñaba:
  // «consigue X al mes más para cubrir el 50%», lo conseguías, y la pantalla
  // seguía marcando el 35%.
  const gastos = 5388, cuotas = 0, patrimonio = 5553, pasivo = 3858;
  const burnReal = gastos + cuotas + patrimonio;
  const coberturaEnPantalla = (pasivo / burnReal) * 100;

  const a = buildAudit({
    totalAssets: 3000000, totalLiabilities: 0, netWorth: 3000000, ltv: 0,
    liquidCash: 50000, runwayMonths: 50000 / burnReal,
    totalAnnualExpenses: gastos * 12, totalMonthlyExpenses: gastos,
    monthlyDebtPayments: cuotas, monthlyWealthTax: patrimonio,
    monthlyPassiveCashflow: pasivo, coveragePct: coberturaEnPantalla,
    assetCategoryTotals: { cash: 50000, stocks: 1500000, real_estate: 1450000, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'cartera', valueBase: 1500000 }, { name: 'piso', valueBase: 1450000 }],
    foreignCurrencyPct: 0, expensiveDebt: [], lowYieldPensions: [], excessExpenses: []
  });

  const cobertura = a.dimensions.find(d => d.id === 'coverage');
  assert.ok(cobertura.action.requiredBase > 0, 'sin importe la frase sale con un hueco en medio');

  // Consigue exactamente lo que le piden y la pantalla tiene que marcar la meta.
  const despues = ((pasivo + cobertura.action.requiredBase) / burnReal) * 100;
  assert.ok(Math.abs(despues - cobertura.action.value) < 0.01,
    `pide ${cobertura.action.requiredBase.toFixed(0)} para llegar al ${cobertura.action.value}% y se queda en ${despues.toFixed(1)}%`);

  // Lo mismo con el colchón.
  const colchon = a.dimensions.find(d => d.id === 'runway');
  const meses = (50000 + colchon.action.requiredBase) / burnReal;
  assert.ok(Math.abs(meses - colchon.action.value) < 0.01,
    `pide ${colchon.action.requiredBase.toFixed(0)} para llegar a ${colchon.action.value} meses y se queda en ${meses.toFixed(2)}`);
});

test('ahorrar más nunca baja la nota del colchón', () => {
  // La curva subía hasta los 24 meses y luego bajaba, así que un balance con
  // 25 meses de reservas puntuaba menos que otro con 23. El exceso de liquidez
  // ya lo penaliza eficiencia, explicándolo.
  const nota = (meses) => {
    const a = buildAudit({
      totalAssets: 200000, totalLiabilities: 0, netWorth: 200000, ltv: 0,
      liquidCash: meses * 2000, runwayMonths: meses,
      totalAnnualExpenses: 24000, totalMonthlyExpenses: 2000, monthlyDebtPayments: 0,
      monthlyPassiveCashflow: 0, coveragePct: 0,
      assetCategoryTotals: { cash: meses * 2000, stocks: 200000, real_estate: 0, pensions: 0, tangibles: 0 },
      holdings: [{ name: 'cartera', valueBase: 200000 }],
      foreignCurrencyPct: 0, expensiveDebt: [], lowYieldPensions: [], excessExpenses: []
    });
    return a.dimensions.find(d => d.id === 'runway').points;
  };

  let anterior = -1;
  for (const meses of [0, 1, 3, 6, 12, 23, 24, 25, 36, 48, 120, 600]) {
    const puntos = nota(meses);
    assert.ok(puntos >= anterior, `con ${meses} meses la nota baja de ${anterior} a ${puntos}`);
    anterior = puntos;
  }
  assert.equal(nota(6), 45, 'seis meses siguen siendo el máximo de la dimensión');
  assert.equal(nota(600), 45);
});

test('la liquidez que no cobra nada descuenta puntos y se explica', () => {
  // El motor venía calculando esta lista desde siempre —en la misma línea que
  // la deuda cara y los planes flojos— y no la leía nadie: se calculaba y se
  // tiraba. Es distinta del exceso de liquidez: aquella penaliza tener
  // demasiada, esta tener la que sea en una cuenta que no paga.
  const base = {
    totalAssets: 300000, totalLiabilities: 0, netWorth: 300000, ltv: 0,
    liquidCash: 30000, runwayMonths: 12,
    totalAnnualExpenses: 30000, totalMonthlyExpenses: 2500, monthlyDebtPayments: 0,
    monthlyPassiveCashflow: 500, coveragePct: 20,
    assetCategoryTotals: { cash: 30000, stocks: 270000, real_estate: 0, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'cartera', valueBase: 270000 }],
    foreignCurrencyPct: 0, expensiveDebt: [], lowYieldPensions: [], excessExpenses: []
  };

  const conCuentaMuerta = buildAudit({ ...base, unremuneratedCash: [{ name: 'Cuenta nómina' }] });
  const efi = conCuentaMuerta.dimensions.find(d => d.id === 'efficiency');
  const pen = (efi.penalties || []).find(p => p.id === 'unremunerated_cash');
  assert.ok(pen, 'la penalización tiene que estar en el libro');
  assert.deepEqual(pen.items, ['Cuenta nómina'], 'y decir qué cuenta es');
  assert.ok(efi.points < 20, `esperaba menos de 20 puntos y saca ${efi.points}`);

  // Sin ella, mérito: pero solo si hay efectivo del que hablar.
  const limpio = buildAudit({ ...base, unremuneratedCash: [] });
  const meritos = limpio.dimensions.find(d => d.id === 'efficiency').strengths.map(s => s.id);
  assert.ok(meritos.includes('eff_cash_paid'), `esperaba el mérito y hay ${JSON.stringify(meritos)}`);

  const sinEfectivo = buildAudit({
    ...base, liquidCash: 0, unremuneratedCash: [],
    assetCategoryTotals: { cash: 0, stocks: 300000, real_estate: 0, pensions: 0, tangibles: 0 }
  });
  const sinMeritos = sinEfectivo.dimensions.find(d => d.id === 'efficiency').strengths.map(s => s.id);
  assert.ok(!sinMeritos.includes('eff_cash_paid'), 'sin efectivo no hay nada que felicitar');
});

// --- SUBTIPOS ---

test('diversificación: bolsa y bonos a medias no es una sola apuesta', () => {
  const base = {
    totalAssets: 200000, netWorth: 200000, totalAnnualExpenses: 24000, totalMonthlyExpenses: 2000,
    liquidCash: 0, runwayMonths: 0,
    assetCategoryTotals: { cash: 0, stocks: 200000, real_estate: 0, pensions: 0, tangibles: 0 },
    holdings: [{ name: 'Bolsa', valueBase: 100000 }, { name: 'Bonos', valueBase: 100000 }]
  };
  const todoBolsa = buildAudit(base).dimensions.find(d => d.id === 'diversification');
  const partido = buildAudit({
    ...base,
    assetClassTotals: { cash: 0, equity: 100000, fixed_income: 100000, gold: 0, real_estate: 0, pensions: 0, tangibles: 0 }
  }).dimensions.find(d => d.id === 'diversification');
  assert.equal(todoBolsa.detail.maxCatPct, 100);
  assert.equal(partido.detail.maxCatPct, 50);
  assert.equal(partido.detail.productiveCount, 2, 'la renta fija cuenta como clase productiva');
  assert.ok(partido.points > todoBolsa.points);
});

test('diversificación: el oro también es una clase', () => {
  const d = buildAudit({
    totalAssets: 100000, netWorth: 100000,
    assetClassTotals: { cash: 0, equity: 40000, fixed_income: 30000, gold: 30000, real_estate: 0, pensions: 0, tangibles: 0 },
    holdings: []
  }).dimensions.find(x => x.id === 'diversification');
  assert.equal(d.detail.productiveCount, 3);
});
