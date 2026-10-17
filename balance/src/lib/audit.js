// --- MOTOR DE AUDITORÍA ---
// Devuelve datos, no JSX: el motor calcula y la interfaz solo dibuja.
//
// La herramienta hace dos preguntas distintas — cómo está construido el
// balance y cuánto de tu vida sostiene — y antes las fundía en un único
// número, así que una estructura sólida que aún no te mantiene y una
// estructura floja con algo de alquiler aterrizaban en el mismo 68. Ahora
// son dos ejes; el número combinado se deriva de ellos.

// Interpola linealmente entre puntos de anclaje, saturando en los extremos.
// Antes eran escalones: 5,99 meses de colchón puntuaban 14 y 6,00 puntuaban
// 20, un salto de seis puntos por un céntimo.
export function scoreFromAnchors(value, anchors) {
  if (!Number.isFinite(value)) value = anchors[anchors.length - 1].at;
  if (value <= anchors[0].at) return anchors[0].score;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    if (value <= cur.at) {
      const span = cur.at - prev.at;
      if (span <= 0) return cur.score;
      const t = (value - prev.at) / span;
      return prev.score + t * (cur.score - prev.score);
    }
  }
  return anchors[anchors.length - 1].score;
}

// Primer anclaje por encima del valor actual que además puntúa más. Es lo que
// convierte "te faltan 1,4 puntos" en una frase verdadera.
function nextTargetFrom(value, anchors) {
  const current = scoreFromAnchors(value, anchors);
  for (const a of anchors) {
    if (a.at > value && a.score > current + 0.05) {
      return { value: a.at, points: a.score, gain: a.score - current };
    }
  }
  return null;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Lo que ya está bien en una dimensión. Sale de los mismos números que la
// nota, así que no puede decir «tu apalancamiento es bajo» mientras el
// apalancamiento descuenta puntos. Cada entrada lleva su unidad para que la
// interfaz sepa formatearla sin tener que adivinar qué es cada cifra.
const bien = (id, value = null, unit = null) => ({ id, value, unit });

// De entre las acciones posibles de una dimensión, la que más puntos devuelve.
// Todas salen de la misma fórmula que produjo la nota, así que la ganancia
// prometida es exacta y no puede desincronizarse de ella.
function bestOf(candidates) {
  const real = candidates.filter(c => c && c.gain > 0.05);
  if (real.length === 0) return null;
  return real.sort((a, b) => b.gain - a.gain)[0];
}

const ANCHORS = {
  solvencyYears:  [{ at: 0, score: 0 }, { at: 1, score: 10 }, { at: 3, score: 18 }, { at: 10, score: 30 }],
  solvencyAbs:    [{ at: 0, score: 0 }, { at: 10000, score: 10 }, { at: 30000, score: 20 }, { at: 100000, score: 30 }],
  leverageLtv:    [{ at: 0, score: 25 }, { at: 30, score: 25 }, { at: 50, score: 18 }, { at: 70, score: 8 }, { at: 100, score: 0 }],
  // El colchón dejaba de sumar a los 24 meses y BAJABA hasta los 48: pasar de
  // 23 a 25 meses de reservas costaba puntos. Ahorrar de más empeoraba la nota
  // sin que la herramienta lo dijera en ninguna parte, y encima el exceso de
  // liquidez ya se penaliza aparte —y explicado— en eficiencia, con su propio
  // criterio (más del 35% del balance en caja). Eran dos castigos por lo
  // mismo, uno de ellos invisible. Ahora satura: a partir de seis meses la
  // dimensión está al máximo y no se mueve.
  runwayMonths:   [{ at: 0, score: 0 }, { at: 1, score: 8 }, { at: 3, score: 20 }, { at: 6, score: 45 }],
  coveragePct:    [{ at: 0, score: 0 }, { at: 25, score: 16 }, { at: 50, score: 30 }, { at: 100, score: 55 }],
  concentration:  [{ at: 0, score: 1 }, { at: 40, score: 1 }, { at: 65, score: 0.6 }, { at: 85, score: 0.25 }, { at: 100, score: 0 }]
};

export function buildAudit(input) {
  const {
    totalAssets = 0, totalLiabilities = 0, netWorth = 0, ltv = 0,
    liquidCash = 0, runwayMonths = 0,
    totalAnnualExpenses = 0, totalMonthlyExpenses = 0, monthlyDebtPayments = 0,
    // El impuesto sobre el patrimonio es coste obligatorio como la cuota de una
    // deuda, y el motor ya lo cuenta como tal. Aquí faltaba, así que la
    // auditoría medía el coste de la vida con una vara distinta de la que
    // enseña en pantalla y sus consejos salían mal calculados.
    monthlyWealthTax = 0,
    monthlyPassiveCashflow = 0, coveragePct = null,
    assetCategoryTotals = {}, assetClassTotals = null, holdings = [], foreignCurrencyPct = 0,
    expensiveDebt = [], lowYieldPensions = [], unremuneratedCash = [], excessExpenses = [],
    macroParams = {}, effectiveSavingsRatePct
  } = input;

  const empty = totalAssets === 0 && totalLiabilities === 0;
  const insolvent = !empty && netWorth <= 0;
  const dims = [];

  // --- ESTRUCTURA: solvencia ---
  const years = totalAnnualExpenses > 0 ? netWorth / totalAnnualExpenses : null;
  const solvencyAnchors = years === null ? ANCHORS.solvencyAbs : ANCHORS.solvencyYears;
  const solvencyValue = years === null ? netWorth : years;
  let solvencyPoints = (empty || netWorth <= 0) ? 0 : scoreFromAnchors(solvencyValue, solvencyAnchors);
  const solvencyNext = nextTargetFrom(solvencyValue, solvencyAnchors);
  const solvencyStrengths = [];
  if (!empty && netWorth > 0) {
    solvencyStrengths.push(bien('solvency_positive', netWorth, 'currency'));
    if (years !== null && years >= 1) solvencyStrengths.push(bien('solvency_years', round1(years), 'years'));
  }
  dims.push({
    id: 'solvency', axis: 'structure', max: 30,
    applicable: !empty,
    strengths: solvencyStrengths,
    points: round1(solvencyPoints),
    value: years === null ? netWorth : round1(years),
    unit: years === null ? 'currency' : 'years',
    action: solvencyNext && netWorth > 0 ? {
      id: 'grow_net_worth',
      value: solvencyNext.value,
      gain: round1(solvencyNext.gain),
      // Cuánto patrimonio adicional hace falta para llegar al siguiente tramo.
      requiredBase: years === null
        ? Math.max(0, solvencyNext.value - netWorth)
        : Math.max(0, solvencyNext.value * totalAnnualExpenses - netWorth)
    } : null
  });

  // --- ESTRUCTURA: apalancamiento ---
  // Sin deuda el apalancamiento no es una pregunta. Puntuarlo 25/25 lo
  // presentaba como un logro; ahora sale del denominador.
  const leverageApplies = !empty && totalLiabilities > 0;
  const leverageNext = leverageApplies ? nextTargetFrom(-ltv, ANCHORS.leverageLtv.map(a => ({ at: -a.at, score: a.score })).reverse()) : null;
  const leverageStrengths = [];
  if (leverageApplies && !insolvent) {
    if (ltv <= 30) leverageStrengths.push(bien('leverage_low', round1(ltv), 'pct'));
    else if (ltv <= 50) leverageStrengths.push(bien('leverage_moderate', round1(ltv), 'pct'));
  }
  dims.push({
    id: 'leverage', axis: 'structure', max: 25,
    applicable: leverageApplies,
    strengths: leverageStrengths,
    points: leverageApplies ? round1(insolvent ? 0 : scoreFromAnchors(ltv, ANCHORS.leverageLtv)) : null,
    value: round1(ltv), unit: 'pct',
    action: leverageNext ? {
      id: 'repay_debt',
      value: -leverageNext.value,
      gain: round1(leverageNext.gain),
      // Deuda que habría que amortizar para bajar el LTV a ese tramo.
      requiredBase: Math.max(0, totalLiabilities - (-leverageNext.value / 100) * totalAssets)
    } : null
  });

  // --- ESTRUCTURA: diversificación ---
  // Se mide sobre clases, no sobre bloques: la renta fija y el oro viven en el
  // bloque 2 con las acciones, pero son otra apuesta. Sin el desglose del
  // motor, el bloque 2 entero cuenta como renta variable, que es lo que era
  // antes de que existieran los subtipos.
  const classTotals = assetClassTotals
    ?? (({ stocks = 0, ...resto }) => ({ ...resto, equity: stocks }))(assetCategoryTotals);
  const catValues = Object.values(classTotals);
  const maxCat = catValues.length ? Math.max(...catValues) : 0;
  const maxCatPct = totalAssets > 0 ? (maxCat / totalAssets) * 100 : 0;
  const largestHolding = holdings.reduce((m, h) => Math.max(m, Number(h.valueBase) || 0), 0);
  const largestHoldingPct = totalAssets > 0 ? (largestHolding / totalAssets) * 100 : 0;
  const productiveCount = ['equity', 'fixed_income', 'gold', 'real_estate', 'pensions'].filter(k => (classTotals[k] || 0) > 0).length;

  const breadth = [0, 0.4, 0.75, 1][Math.min(3, productiveCount)];
  const fxBonus = foreignCurrencyPct >= 15 ? 1 : foreignCurrencyPct / 15;
  const divFraction =
    0.45 * scoreFromAnchors(maxCatPct, ANCHORS.concentration) +
    0.30 * scoreFromAnchors(largestHoldingPct, ANCHORS.concentration) +
    0.15 * breadth +
    0.10 * fxBonus;
  const divStrengths = [];
  if (totalAssets > 0) {
    if (maxCatPct <= 40) divStrengths.push(bien('div_categories', round1(maxCatPct), 'pct'));
    if (largestHoldingPct <= 40) divStrengths.push(bien('div_holding', round1(largestHoldingPct), 'pct'));
    if (productiveCount >= 2) divStrengths.push(bien('div_classes', productiveCount, 'count'));
    if (foreignCurrencyPct >= 15) divStrengths.push(bien('div_fx', round1(foreignCurrencyPct), 'pct'));
  }
  dims.push({
    id: 'diversification', axis: 'structure', max: 25,
    applicable: totalAssets > 0,
    strengths: divStrengths,
    points: totalAssets > 0 ? round1(25 * divFraction) : null,
    value: round1(maxCatPct), unit: 'pct',
    detail: {
      maxCatPct: round1(maxCatPct),
      largestHoldingPct: round1(largestHoldingPct),
      productiveCount,
      foreignCurrencyPct: round1(foreignCurrencyPct)
    },
    action: totalAssets > 0 ? bestOf([
      // Bajar la concentración por categoría al siguiente tramo bueno.
      (() => {
        const now = scoreFromAnchors(maxCatPct, ANCHORS.concentration);
        const target = maxCatPct > 65 ? 65 : maxCatPct > 40 ? 40 : null;
        if (target === null) return null;
        return {
          id: 'reduce_category_concentration',
          value: target,
          gain: round1(25 * 0.45 * (scoreFromAnchors(target, ANCHORS.concentration) - now))
        };
      })(),
      // Lo mismo para la mayor posición individual.
      (() => {
        const now = scoreFromAnchors(largestHoldingPct, ANCHORS.concentration);
        const target = largestHoldingPct > 65 ? 65 : largestHoldingPct > 40 ? 40 : null;
        if (target === null) return null;
        return {
          id: 'reduce_holding_concentration',
          value: target,
          gain: round1(25 * 0.30 * (scoreFromAnchors(target, ANCHORS.concentration) - now))
        };
      })(),
      // Incorporar una clase productiva más.
      productiveCount < 3 ? {
        id: 'add_productive_class',
        value: productiveCount + 1,
        gain: round1(25 * 0.15 * ([0, 0.4, 0.75, 1][productiveCount + 1] - breadth))
      } : null,
      // Alcanzar el 15% de exposición a divisa extranjera.
      foreignCurrencyPct < 15 ? {
        id: 'add_foreign_exposure',
        value: 15,
        gain: round1(25 * 0.10 * (1 - fxBonus))
      } : null
    ]) : null
  });

  // --- ESTRUCTURA: eficiencia (libro de penalizaciones) ---
  // Las cuatro penalizaciones se calculaban y solo tres se explicaban: el
  // exceso de liquidez descontaba puntos sin aparecer en ninguna parte.
  const penalties = [];
  if (expensiveDebt.length > 0) {
    penalties.push({ id: 'expensive_debt', count: expensiveDebt.length, cost: Math.min(12, expensiveDebt.length * 4), items: expensiveDebt.map(d => d.name) });
  }
  if (totalAssets > 20000 && liquidCash / totalAssets > 0.35) {
    penalties.push({ id: 'cash_drag', count: 1, cost: 4, items: [] });
  }
  // Liquidez que no cobra nada. Es distinto del exceso de liquidez de arriba:
  // aquella penaliza tener demasiada, esta tener la que sea en una cuenta que
  // no paga. El motor ya la venía calculando —mismo sitio que la deuda cara y
  // los planes flojos, con los que comparte fila— pero no la leía nadie y se
  // tiraba. Cuesta menos que las otras porque se arregla en una tarde.
  if (unremuneratedCash.length > 0) {
    penalties.push({ id: 'unremunerated_cash', count: unremuneratedCash.length, cost: Math.min(4, unremuneratedCash.length * 2), items: unremuneratedCash.map(a => a.name) });
  }
  if (lowYieldPensions.length > 0) {
    penalties.push({ id: 'low_yield_pensions', count: lowYieldPensions.length, cost: Math.min(6, lowYieldPensions.length * 3), items: lowYieldPensions.map(p => p.name) });
  }
  if (excessExpenses.length > 0) {
    penalties.push({ id: 'excess_expenses', count: excessExpenses.length, cost: Math.min(6, excessExpenses.length * 2), items: excessExpenses.map(e => e.name) });
  }
  const penaltyTotal = penalties.reduce((sum, p) => sum + p.cost, 0);

  // Una penalización que no salta solo es un mérito si podía saltar: decirle
  // «no tienes deuda cara» a quien no tiene deuda no informa de nada.
  const cashPct = totalAssets > 0 ? (liquidCash / totalAssets) * 100 : 0;
  const effStrengths = [];
  if (!empty) {
    if (totalLiabilities > 0 && expensiveDebt.length === 0) effStrengths.push(bien('eff_debt_cheap'));
    if (totalAssets > 20000 && cashPct <= 35) effStrengths.push(bien('eff_cash_working', round1(cashPct), 'pct'));
    if ((assetCategoryTotals.cash || 0) > 0 && unremuneratedCash.length === 0) effStrengths.push(bien('eff_cash_paid'));
    if ((assetCategoryTotals.pensions || 0) > 0 && lowYieldPensions.length === 0) effStrengths.push(bien('eff_pensions'));
    if (totalAnnualExpenses > 0 && excessExpenses.length === 0) effStrengths.push(bien('eff_expenses'));
  }
  dims.push({
    id: 'efficiency', axis: 'structure', max: 20,
    applicable: !empty,
    strengths: effStrengths,
    points: empty ? null : round1(Math.max(0, 20 - penaltyTotal)),
    value: penaltyTotal, unit: 'points',
    penalties,
    action: bestOf(penalties.map(pen => ({
      id: `clear_${pen.id}`,
      value: null,
      gain: pen.cost,
      items: pen.items
    })))
  });

  // --- SOPORTE: colchón de liquidez ---
  const runwayValue = Number.isFinite(runwayMonths) ? runwayMonths : 60;
  // Mismo coste obligatorio que usa el motor para el colchón y la cobertura.
  // Con dos definiciones distintas, la auditoría decía «consigue X al mes más
  // para cubrir el 50%» y al conseguirlo la pantalla seguía marcando el 35%.
  const burn = totalMonthlyExpenses + monthlyDebtPayments + monthlyWealthTax;
  const runwayNext = nextTargetFrom(runwayValue, ANCHORS.runwayMonths);
  const runwayStrengths = [];
  if (burn > 0) {
    if (runwayValue >= 6) runwayStrengths.push(bien('runway_solid', round1(runwayValue), 'months'));
    else if (runwayValue >= 3) runwayStrengths.push(bien('runway_partial', round1(runwayValue), 'months'));
  }
  dims.push({
    id: 'runway', axis: 'support', max: 45,
    applicable: burn > 0,
    strengths: runwayStrengths,
    points: burn > 0 ? round1(scoreFromAnchors(runwayValue, ANCHORS.runwayMonths)) : null,
    value: Number.isFinite(runwayMonths) ? round1(runwayMonths) : Infinity,
    unit: 'months',
    action: runwayNext && burn > 0 ? {
      id: 'add_cash',
      value: runwayNext.value,
      gain: round1(runwayNext.gain),
      requiredBase: Math.max(0, runwayNext.value * burn - liquidCash)
    } : null
  });

  // --- SOPORTE: cobertura de vida ---
  const covApplies = coveragePct !== null && burn > 0;
  const covNext = covApplies ? nextTargetFrom(coveragePct, ANCHORS.coveragePct) : null;
  const covStrengths = [];
  if (covApplies) {
    if (coveragePct >= 100) covStrengths.push(bien('coverage_full', round1(coveragePct), 'pct'));
    else if (coveragePct >= 50) covStrengths.push(bien('coverage_half', round1(coveragePct), 'pct'));
    else if (coveragePct >= 25) covStrengths.push(bien('coverage_quarter', round1(coveragePct), 'pct'));
    // Que los activos den caja neta positiva es un hito en sí mismo, aunque
    // todavía cubra poco: significa que el balance ya no drena dinero.
    if (monthlyPassiveCashflow > 0) covStrengths.push(bien('coverage_positive', monthlyPassiveCashflow, 'currency'));
  }
  dims.push({
    id: 'coverage', axis: 'support', max: 55,
    applicable: covApplies,
    strengths: covStrengths,
    points: covApplies ? round1(scoreFromAnchors(coveragePct, ANCHORS.coveragePct)) : null,
    value: covApplies ? round1(coveragePct) : null,
    unit: 'pct',
    action: covNext ? {
      id: 'add_cashflow',
      value: covNext.value,
      gain: round1(covNext.gain),
      // Cuánto cashflow mensual adicional hace falta.
      requiredBase: Math.max(0, (covNext.value / 100) * burn - monthlyPassiveCashflow)
    } : null
  });

  // --- AGREGACIÓN ---
  // Cada eje se normaliza sobre las dimensiones que sí aplican, así que
  // excluir una no regala ni penaliza puntos.
  const axisScore = (axis) => {
    const active = dims.filter(d => d.axis === axis && d.applicable && d.points !== null);
    const available = active.reduce((s, d) => s + d.max, 0);
    if (available <= 0) return { score: 0, available: 0, earned: 0 };
    const earned = active.reduce((s, d) => s + d.points, 0);
    return { score: round1((earned / available) * 100), available, earned: round1(earned) };
  };

  let structure = axisScore('structure');
  const support = axisScore('support');

  // Circuit breaker explícito, no un recorte silencioso: antes el total se
  // limitaba a 35 mientras las subpuntuaciones seguían mostrándose enteras y
  // podían sumar más que su propio total.
  let cap = null;
  if (insolvent) {
    cap = { axis: 'structure', limit: 40, reason: 'negative_equity' };
    structure = { ...structure, score: Math.min(40, structure.score) };
  }

  const combined = empty ? 0 : round1((structure.score + support.score) / 2);

  return {
    empty,
    insolvent,
    cap,
    structure,
    support,
    combined,
    dimensions: dims,
    // Los supuestos con los que se ha calculado, para que la nota sea
    // reproducible y se vea qué tocar si no se está de acuerdo.
    assumptions: {
      inflationPct: Number(macroParams.inflationPct) || 0,
      // Tipo medio del ahorro que ha salido de la escala por tramos para esta
      // renta concreta. Si no llega, se informa el plano de los parámetros.
      savingsTaxRatePct: Number(effectiveSavingsRatePct ?? macroParams.savingsTaxRatePct) || 0,
      marginalIncomeTaxPct: Number(macroParams.marginalIncomeTaxPct) || 0,
      realEstateMaintenancePct: Number(macroParams.realEstateMaintenancePct) || 0,
      fireTargetMultiple: Number(macroParams.fireTargetMultiple) || 25
    }
  };
}
