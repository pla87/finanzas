// --- NÚCLEO FINANCIERO ---
// Funciones puras extraídas de App.jsx. Sin dependencias de React ni del DOM,
// para poder ejercitarlas desde `npm test`.

import { COUNTRY_PRESETS } from './presets.js';

export const DEFAULT_MACRO_PARAMS = {
  inflationPct: 2.0,
  // La revalorización inmobiliaria estaba soldada a la inflación, así que no
  // había forma de modelar un mercado que va por encima o por debajo. Es su
  // propio parámetro. Cuando falta —datos guardados antes de que existiera—
  // se sigue usando la inflación, de modo que ningún balance antiguo cambia.
  realEstateAppreciationPct: 2.0,
  stockGrowthPct: 6.0,
  refDividendYieldPct: 3.0,
  // Rentabilidad de partida de los otros tres subtipos del bloque 2. Mismos
  // valores y mismos nombres en el fichero que en Retiro (`bondYield`,
  // `tipsRealYield`, `goldRealReturn`), para que el supuesto viaje entero.
  // La renta fija ligada a inflación y el oro se expresan en real: lo nominal
  // es la inflación más esto.
  bondYieldPct: 3.0,
  tipsRealYieldPct: 1.0,
  goldRealReturnPct: 0.0,
  realEstateMaintenancePct: 0.60,
  rentalOperatingCostsPct: 15.0,
  marginalIncomeTaxPct: 37.0,
  rentalPrimaryHomeDeductionPct: 50.0,
  // Tipo plano del ahorro. Ningún cálculo de la aplicación lo consulta: el
  // motor saca el tipo medio de la escala por tramos y se lo pasa a cada
  // activo, que es lo que mantiene cuadradas las filas con el total. Sigue
  // aquí porque viaja al fichero —Retiro lo lee— y porque es el respaldo de
  // `assetAnnualCashflow` cuando se la llama sin ese tipo medio.
  savingsTaxRatePct: 21.0,

  // --- Supuestos de liquidación: qué se pierde por el camino si se vende ---
  // todo y se cancela toda la deuda. Solo intervienen en esa lectura.
  //
  // Rescatar un plan de pensiones tributa como renta del trabajo, al marginal,
  // no en la base del ahorro: por eso un plan no vale su saldo.
  pensionWithdrawalTaxPct: 37.0,
  // Agencia, notaría, plusvalía municipal y demás, en un solo porcentaje.
  propertySellingCostsPct: 8.0,
  // Un coche o un reloj no se venden por lo que dice el papel.
  tangiblesHaircutPct: 25.0,
  // Comisión por amortización anticipada, acotada por ley en España.
  earlyRepaymentFeePct: 0.25,
  // Cuando un activo no dice lo que costó, se supone que esta parte de su
  // valor es plusvalía latente. Es lo que permite estimar el impuesto sin
  // obligar a rellenar el coste de cada posición.
  assumedUnrealizedGainPct: 30.0,

  // --- Impuesto sobre el patrimonio ---
  // Anual, por tener. Está cedido a las comunidades, así que la clave elige el
  // régimen y los dos valores de abajo lo afinan. Ver src/lib/wealthTax.js.
  wealthTaxRegion: 'estatal',
  // Cuántos declaran. El impuesto es por contribuyente y no hay declaración
  // conjunta: repartir el patrimonio entre dos no solo dobla el mínimo exento,
  // también manda cada mitad a los tramos bajos de la escala.
  wealthTaxPayers: 1,
  // Vacíos = los de la comunidad elegida. Con un número, mandan estos. Se
  // entienden POR CONTRIBUYENTE: el reparto lo hace ya wealthTaxPayers.
  wealthTaxExemption: null,
  wealthTaxBonificationPct: null,
  // Múltiplo de gasto anual que se considera independencia. 25 corresponde a
  // la regla del 4%; 33 a la del 3%. Antes estaba fijado en 80, un umbral
  // inalcanzable que dejaba el último nivel como adorno.
  fireTargetMultiple: 25
};

const ASSET_SUBCATEGORIES = ['cash', 'stocks', 'real_estate', 'pensions', 'tangibles'];

// --- SUBTIPOS DENTRO DE LOS BLOQUES ---
//
// Retiro tiene diez categorías de activo y esta herramienta cinco bloques. Los
// bloques se quedan —son los mismos cinco numerados de Retiro—, pero dentro
// del 2 y del 4 se distingue lo mismo que allí. Sin esto, la renta fija, el
// oro y los seguros de jubilación de un fichero de Retiro entraban como dinero
// en cuenta: inflaban el colchón y el nivel 0, la auditoría los castigaba como
// caja sin remunerar y la liquidación les quitaba la plusvalía.
export const STOCK_CLASSES = ['growth', 'dividend', 'bonds', 'tips', 'gold'];
export const PENSION_TYPES = ['plan', 'insurance'];

// Subtipo de una posición del bloque 2. Un balance guardado antes de que
// existieran no lo trae, y se deduce con la regla con la que entonces se
// exportaba: una acción suelta que reparte el 2,5% o más es de dividendo.
export function stockClassOf(asset) {
  if (STOCK_CLASSES.includes(asset?.stockClass)) return asset.stockClass;
  return Number(asset?.cashReturnPct) >= 2.5 && asset?.stockType !== 'fund' ? 'dividend' : 'growth';
}

export function pensionTypeOf(asset) {
  return asset?.pensionType === 'insurance' ? 'insurance' : 'plan';
}

// Clase económica de un activo: los cinco bloques, con el 2 partido en renta
// variable, renta fija y oro. Es lo que miran la diversificación de la
// auditoría y la tarta de activos: un balance con la mitad en bolsa y la mitad
// en bonos no está concentrado en una sola cosa.
export const ASSET_CLASSES = ['cash', 'equity', 'fixed_income', 'gold', 'real_estate', 'pensions', 'tangibles'];

export function assetClassOf(asset) {
  if (asset?.subcategory !== 'stocks') return asset?.subcategory;
  const c = stockClassOf(asset);
  if (c === 'bonds' || c === 'tips') return 'fixed_income';
  if (c === 'gold') return 'gold';
  return 'equity';
}

// En Retiro un bono es un fondo que acumula: su cupón se reinvierte y viaja en
// `capitalReturnPct`. Aquí el cupón es renta que entra en la cuenta, así que
// va en `cashReturnPct` y el capital se queda en cero nominal. El fichero
// sigue el criterio de Retiro y la conversión cruza los dos campos al entrar
// y al salir, de modo que la ida y vuelta los deja donde estaban.
const CUPON_EN_CAPITAL_EN_RETIRO = ['bonds', 'tips'];

const CATEGORIA_RETIRO_DEL_SUBTIPO = { growth: 'stocks', dividend: 'divStocks', bonds: 'bonds', tips: 'tips', gold: 'gold' };
const SUBTIPO_DE_LA_CATEGORIA_RETIRO = { stocks: 'growth', divStocks: 'dividend', bonds: 'bonds', tips: 'tips', gold: 'gold' };

// Rentabilidades que siguen a los supuestos: las que aquí no son un dato de la
// posición sino una consecuencia de Parámetros. Un fondo de bolsa crece lo que
// diga el crecimiento de la bolsa; la renta fija ligada a inflación cobra la
// inflación más su tipo real, y el oro se revaloriza con la inflación más el
// suyo. La renta fija normal no está: su cupón es de cada bono.
export function syncAssetRatesToMacro(assets, macroParams) {
  const inflacion = numeroOr(macroParams?.inflationPct, DEFAULT_MACRO_PARAMS.inflationPct);
  return (assets || []).map(a => {
    if (a.subcategory === 'real_estate') {
      const r = calculateRealEstateReturns(a.value, a.monthlyRent, a.useType || 'habitual', macroParams);
      return { ...a, cashReturnPct: r.cashReturnPct, useReturnPct: r.useReturnPct, capitalReturnPct: r.capitalReturnPct };
    }
    if (a.subcategory !== 'stocks') return a;
    const clase = stockClassOf(a);
    if (clase === 'tips') {
      return { ...a, cashReturnPct: inflacion + numeroOr(macroParams?.tipsRealYieldPct, DEFAULT_MACRO_PARAMS.tipsRealYieldPct), capitalReturnPct: 0 };
    }
    if (clase === 'gold') {
      return { ...a, cashReturnPct: 0, capitalReturnPct: inflacion + numeroOr(macroParams?.goldRealReturnPct, DEFAULT_MACRO_PARAMS.goldRealReturnPct) };
    }
    // Solo los fondos de crecimiento: uno de dividendo crece lo que la bolsa menos lo que
    // reparte, que es como lo modela Retiro, y no se le pisa con la bolsa entera.
    if (clase === 'growth' && a.stockType === 'fund') {
      return { ...a, capitalReturnPct: Number(macroParams?.stockGrowthPct) || 0 };
    }
    return a;
  });
}

// --- FÓRMULAS FINANCIERAS & AMORTIZACIÓN ---

export function calculateLoanAmortization(initialPrincipal, annualRatePct, durationMonths, startDateStr, now = new Date()) {
  const P = Math.max(0, Number(initialPrincipal) || 0);
  const r = Math.max(0, Number(annualRatePct) || 0) / 100 / 12;
  const n = Math.round(Number(durationMonths));

  if (P <= 0) return { monthlyPayment: 0, currentBalance: 0 };

  // Sin un plazo utilizable no hay cuadro de amortización. Devolvemos el
  // principal íntegro: la deuda sigue debiéndose aunque no sepamos el
  // calendario. Amortizarla "en un mes" la borraría del balance.
  if (!Number.isFinite(n) || n < 1) return { monthlyPayment: 0, currentBalance: P };

  let monthlyPayment = 0;
  if (r > 0) {
    monthlyPayment = P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  } else {
    monthlyPayment = P / n;
  }

  const cleanDate = (startDateStr || '2023-01').substring(0, 7);
  const dateParts = cleanDate.split('-');
  const sYear = parseInt(dateParts[0], 10) || 2023;
  const sMonth = Math.min(11, Math.max(0, (parseInt(dateParts[1], 10) || 1) - 1));
  let monthsElapsed = (now.getFullYear() - sYear) * 12 + (now.getMonth() - sMonth);
  monthsElapsed = Math.max(0, Math.min(n, monthsElapsed));

  let currentBalance = 0;
  if (r > 0) {
    currentBalance = P * (Math.pow(1 + r, n) - Math.pow(1 + r, monthsElapsed)) / (Math.pow(1 + r, n) - 1);
  } else {
    currentBalance = P - (P / n) * monthsElapsed;
  }

  return {
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    currentBalance: Math.round(Math.max(0, currentBalance) * 100) / 100,
    monthsElapsed,
    monthsRemaining: Math.max(0, n - monthsElapsed)
  };
}

// Cuota francesa para un saldo y un plazo dados. Es la misma fórmula que usa el
// cuadro de amortización, pero partiendo de un saldo cualquiera en vez del
// principal inicial: es lo que hace falta cuando el usuario fija su saldo real.
export function paymentForBalance(balance, annualRatePct, monthsRemaining) {
  const P = Math.max(0, Number(balance) || 0);
  const r = Math.max(0, Number(annualRatePct) || 0) / 100 / 12;
  const n = Math.max(1, Math.round(Number(monthsRemaining) || 0));
  if (P <= 0) return 0;
  const pmt = r > 0 ? P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : P / n;
  return Math.round(pmt * 100) / 100;
}

// --- TIPO DE INTERÉS EFECTIVO ---

// La mayoría de las hipotecas españolas son variables: se referencian al
// euríbor más un diferencial que se pacta al firmar. El usuario introduce el
// diferencial, que es lo suyo y no cambia; el euríbor lo trae el fichero de
// datos de mercado.
//
// Esto es una foto del patrimonio hoy, no una proyección: el tipo que sale de
// aquí se mantiene constante en todo el cuadro. No se modela la senda futura
// del euríbor a propósito, porque no cambiaría lo que vale el balance hoy.
export function effectiveInterestRatePct(liability, euriborPct) {
  if (!liability || liability.rateType !== 'variable') {
    return Number(liability?.interestRatePct) || 0;
  }
  // Sin euríbor —fichero viejo, descarga caída— se usa el tipo guardado, que es
  // el último que se calculó, en lugar de dejar la hipoteca sin interés.
  // Ojo con `null`: `Number(null)` es 0, que pasa por un euríbor válido y
  // dejaría la hipoteca al diferencial pelado. Hay que descartarlo antes.
  if (euriborPct === null || euriborPct === undefined || euriborPct === '') {
    return Number(liability.interestRatePct) || 0;
  }
  const euribor = Number(euriborPct);
  if (!Number.isFinite(euribor)) return Number(liability.interestRatePct) || 0;
  return euribor + (Number(liability.spreadPct) || 0);
}

export function calculateFamilyLoanPayment(principal, annualRatePct, months) {
  const P = Math.max(0, Number(principal) || 0);
  const r = Math.max(0, Number(annualRatePct) || 0) / 100 / 12;
  const n = Math.max(1, Math.round(Number(months) || 12));
  if (P <= 0) return 0;
  if (r === 0) return Math.round(P / n);
  const pmt = P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return Math.round(pmt);
}

export function calculateFamilyLoanMonths(principal, annualRatePct, payment) {
  const P = Math.max(0, Number(principal) || 0);
  const r = Math.max(0, Number(annualRatePct) || 0) / 100 / 12;
  const pmt = Math.max(0, Number(payment) || 0);
  if (P <= 0 || pmt <= 0) return 1;
  if (r <= 0.00001) return Math.max(1, Math.ceil(P / pmt));
  if (pmt <= P * r) return Infinity;
  const denominator = pmt - P * r;
  if (denominator <= 0) return 360;
  const n = Math.log(pmt / denominator) / Math.log(1 + r);
  return isNaN(n) || !isFinite(n) ? 360 : Math.min(360, Math.max(1, Math.ceil(n)));
}

export function calculateRealEstateReturns(value, monthlyRent, useType, macroParams) {
  const val = Math.max(0, Number(value) || 0);
  const rent = Math.max(0, Number(monthlyRent) || 0);
  const capRate = Math.abs(Number(macroParams.realEstateAppreciationPct ?? macroParams.inflationPct ?? 2.0));
  const maintRate = -Math.abs(Number(macroParams.realEstateMaintenancePct ?? 0.60));

  // El suelo no es una casa: no se deprecia, no lleva mantenimiento, no se
  // alquila ni se habita, y por eso no sigue al mercado de la vivienda sino a
  // la inflación. Lo mismo hace Retiro con este uso.
  if (useType === 'land') {
    const inflacion = Number(macroParams.inflationPct ?? 2.0);
    return { cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: Number.isFinite(inflacion) ? inflacion : 2.0, netAnnualCashflow: 0 };
  }

  if (val <= 0 || isNaN(val)) return { cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: capRate, netAnnualCashflow: 0 };

  const annualGrossRent = rent * 12;

  if (useType === 'habitual') {
    const useReturnPct = (annualGrossRent / val) * 100;
    const netAnnualCashflow = val * (maintRate / 100);
    return { cashReturnPct: maintRate, useReturnPct: Math.round(useReturnPct * 100) / 100, capitalReturnPct: capRate, netAnnualCashflow };
  } else if (useType === 'rented') {
    const opCostPct = Math.abs(Number(macroParams.rentalOperatingCostsPct ?? 15)) / 100;
    const marginalTax = Math.abs(Number(macroParams.marginalIncomeTaxPct ?? 37)) / 100;
    const deductionPct = Math.abs(Number(macroParams.rentalPrimaryHomeDeductionPct ?? 50)) / 100;

    // Deduct statutory depreciation (estimated on 50% construction value at 3%)
    const estimatedDepreciation = val * 0.50 * 0.03;
    const netOperative = annualGrossRent * (1 - opCostPct);
    const taxableBase = Math.max(0, (netOperative - estimatedDepreciation) * (1 - deductionPct));
    const taxAmount = Math.max(0, taxableBase * marginalTax);
    const netAnnualCashflow = netOperative - taxAmount;

    const cashReturnPct = (netAnnualCashflow / val) * 100;
    return { cashReturnPct: Math.round(cashReturnPct * 100) / 100, useReturnPct: 0, capitalReturnPct: capRate, netAnnualCashflow };
  } else {
    const netAnnualCashflow = val * (maintRate / 100);
    return { cashReturnPct: maintRate, useReturnPct: 0, capitalReturnPct: capRate, netAnnualCashflow };
  }
}

export function syncLiabilitiesAmortization(items, { euriborPct } = {}) {
  if (!Array.isArray(items)) return [];
  return items.map(l => {
    const p = Number(l.initialPrincipal) || 0;
    const n = Number(l.durationMonths) || 0;
    if (l.subcategory === 'personal_loans' && p > 0) {
      const r = resolveLiability(l, new Date(), { euriborPct });
      return { ...l, value: r.value, monthlyPayment: r.monthlyPayment };
    }
    if (l.subcategory === 'mortgages' && p > 0 && n > 0) {
      // Un saldo fijado a mano no se toca: era justo lo que esta función hacía
      // mal, recalcular por encima de la cifra que el usuario había traído de
      // su extracto y descartarla en cada guardado.
      const r = resolveLiability(l, new Date(), { euriborPct });
      return { ...l, value: r.value, monthlyPayment: r.monthlyPayment };
    }
    return l;
  });
}

// --- COBERTURA DE VIDA ---

// Qué parte de tu vida pagan hoy tus activos: flujo de caja pasivo dividido
// entre el coste obligatorio mensual (gastos de vida más servicio de la deuda).
// Es la misma magnitud que la caja neta mensual, pero expresada como una
// proporción en lugar de como un déficit: la caja neta es casi siempre un
// número rojo grande, y eso parece un suspenso cuando en realidad es la
// medición funcionando. La herramienta no conoce ingresos del trabajo a
// propósito, así que esta es la lectura honesta del balance.
// `monthlyImputedUse` es el ahorro por uso propio: el alquiler que no pagas
// por vivir en tu casa, o el coche que no alquilas. No es dinero que entre en
// la cuenta, así que no se mezcla con el titular, pero sí reduce el coste de
// tu vida y por eso se informa aparte.
export function lifeCoverage(monthlyPassiveCashflow, totalMonthlyExpenses, monthlyDebtPayments, monthlyImputedUse = 0) {
  const passive = Number(monthlyPassiveCashflow) || 0;
  const use = Number(monthlyImputedUse) || 0;
  const burn = (Number(totalMonthlyExpenses) || 0) + (Number(monthlyDebtPayments) || 0);

  if (burn <= 0) {
    // Sin coste que cubrir la cobertura no está definida; declararla 100%
    // sería premiar un balance vacío.
    return { ratio: null, pct: null, usePct: null, combinedPct: null, burn: 0, passive, use, gap: 0 };
  }

  const ratio = passive / burn;
  const pct = Math.max(0, ratio) * 100;
  const usePct = Math.max(0, use / burn) * 100;

  return {
    ratio,
    pct,
    usePct,
    combinedPct: pct + usePct,
    burn,
    passive,
    use,
    gap: Math.max(0, burn - passive)
  };
}

// --- SALDO VIVO DE UN PASIVO ---

// Saldo y cuota actuales de una deuda. Única definición: la tabla de pasivos,
// el motor de cálculo y el informe PDF la comparten, porque antes cada uno
// aplicaba una condición distinta y podían mostrar cifras diferentes para la
// misma deuda.
export function resolveLiability(l, now = new Date(), { euriborPct } = {}) {
  const p = Number(l.initialPrincipal) || 0;
  const n = Math.round(Number(l.durationMonths));
  const ratePct = effectiveInterestRatePct(l, euriborPct);

  // Un préstamo personal no arrastra fecha de inicio: lo que se escribe es el
  // saldo que queda hoy, y el plazo es lo que falta. La cuota sale de esos dos
  // números, sin cuadro que reconstruir hacia atrás. La hipoteca sí la lleva,
  // porque ahí el histórico importa y el usuario tiene el cuadro del banco.
  if (l.subcategory === 'personal_loans') {
    return {
      value: p,
      monthlyPayment: p > 0 && Number.isFinite(n) && n >= 1 ? paymentForBalance(p, ratePct, n) : 0,
      ratePct,
      isAnchored: false,
      noMonthlyPayment: false
    };
  }

  const amortizable = l.subcategory === 'mortgages';

  // El cuadro supone un préstamo de manual: tipo constante, ni una cuota
  // saltada, ni una amortización anticipada. La vida real se desvía, y el
  // extracto del banco es la verdad. Si el usuario lo escribe, manda él y el
  // cuadro pasa a ser lo que siempre debió ser: una estimación alrededor.
  const anchor = Number(l.balanceOverride);
  const anclado = amortizable && Number.isFinite(anchor) && anchor > 0;

  if (amortizable && p > 0 && Number.isFinite(n) && n >= 1) {
    const calc = calculateLoanAmortization(p, ratePct, n, l.startDate, now);

    if (anclado) {
      return {
        value: anchor,
        monthlyPayment: paymentForBalance(anchor, ratePct, Math.max(1, calc.monthsRemaining)),
        ratePct,
        isAnchored: true,
        noMonthlyPayment: false
      };
    }

    return { value: calc.currentBalance, monthlyPayment: calc.monthlyPayment, ratePct, isAnchored: false, noMonthlyPayment: false };
  }

  // Sin plazo utilizable no hay cuadro que correr y se conserva lo guardado
  // (P1.4), pero el saldo real sigue mandando: este camino lo descartaba, así
  // que una hipoteca sin plazo enseñaba otra cifra que la que el usuario había
  // copiado de su extracto.
  if (anclado) {
    return {
      value: anchor,
      monthlyPayment: l.noMonthlyPayment ? 0 : numeroOr(l.monthlyPayment, 0),
      ratePct,
      isAnchored: true,
      noMonthlyPayment: !!l.noMonthlyPayment
    };
  }

  return {
    value: numeroOr(l.value, 0),
    monthlyPayment: l.noMonthlyPayment ? 0 : numeroOr(l.monthlyPayment, 0),
    ratePct,
    isAnchored: false,
    noMonthlyPayment: !!l.noMonthlyPayment
  };
}

// --- FLUJO DE CAJA POR ACTIVO ---

// Flujo de caja anual de un activo, en su propia divisa. Única definición:
// la usan tanto el motor de cálculo como la tabla de activos, de modo que la
// columna de una fila y el total de la tarjeta no puedan divergir.
// `gross` es el rendimiento declarado; `net` es lo que queda tras impuestos y
// es lo que suma al total.
// --- IMPUESTO DEL AHORRO ---

// Escala del ahorro en España. Dividendos e intereses tributan aquí, y lo hacen
// por tramos: no es un tipo plano, sino que cada tramo grava solo la parte de
// la renta que cae dentro de él.
export const SAVINGS_TAX_BRACKETS = [
  { upTo: 6000, ratePct: 19 },
  { upTo: 50000, ratePct: 21 },
  { upTo: 200000, ratePct: 23 },
  { upTo: 300000, ratePct: 27 },
  { upTo: Infinity, ratePct: 30 }
];

// Cuota total sobre una renta del ahorro anual, tramo a tramo.
export function savingsTaxOnIncome(grossAnnualIncome, brackets = SAVINGS_TAX_BRACKETS) {
  const income = Math.max(0, Number(grossAnnualIncome) || 0);
  if (income <= 0) return 0;

  let tax = 0;
  let previousCeiling = 0;
  for (const { upTo, ratePct } of brackets) {
    if (income <= previousCeiling) break;
    const slice = Math.min(income, upTo) - previousCeiling;
    tax += slice * (ratePct / 100);
    previousCeiling = upTo;
  }
  return tax;
}

// Tipo medio que resulta de aplicar la escala a esa renta. Es lo que permite
// repartir la cuota entre los activos que la generan: si cada fila aplica este
// mismo porcentaje, la suma de las filas cuadra con el total de la tarjeta.
export function effectiveSavingsTaxPct(grossAnnualIncome, brackets = SAVINGS_TAX_BRACKETS) {
  const income = Math.max(0, Number(grossAnnualIncome) || 0);
  if (income <= 0) return 0;
  return (savingsTaxOnIncome(income, brackets) / income) * 100;
}

// Renta del ahorro que genera un activo: dividendos e intereses. Los inmuebles
// tributan en su propio cálculo y las pensiones no reparten nada, así que
// ninguno entra en esta base.
export function assetSavingsIncome(asset, macroParams) {
  const sub = asset.subcategory;
  if (sub !== 'stocks' && sub !== 'cash') return 0;
  const gross = (Number(asset.value) || 0) * ((Number(asset.cashReturnPct) || 0) / 100);
  return gross > 0 ? gross : 0;
}

// `savingsTaxRatePctOverride` es el tipo medio que sale de la escala aplicada a
// la renta del ahorro de TODO el balance. Se pasa desde fuera porque los tramos
// no se pueden calcular activo a activo: dependen de la suma. Sin él se
// recurre al tipo plano guardado, que es lo que hacían los balances antiguos.
export function assetAnnualCashflow(asset, macroParams, savingsTaxRatePctOverride) {
  const value = Number(asset.value) || 0;
  const sub = asset.subcategory;

  if (sub === 'real_estate') {
    // El impuesto ya está aplicado dentro del cálculo inmobiliario.
    const r = calculateRealEstateReturns(value, asset.monthlyRent, asset.useType || 'habitual', macroParams);
    return { gross: r.netAnnualCashflow, net: r.netAnnualCashflow, taxRatePct: 0 };
  }

  // Los planes de pensiones no reparten flujo corriente.
  if (sub === 'pensions') return { gross: 0, net: 0, taxRatePct: 0 };

  const gross = value * ((Number(asset.cashReturnPct) || 0) / 100);

  // Dividendos e intereses tributan en la base del ahorro. Un rendimiento
  // negativo es un coste, no una renta: no se le aplica retención.
  if ((sub === 'stocks' || sub === 'cash') && gross > 0) {
    const taxRatePct = savingsTaxRatePctOverride !== undefined && savingsTaxRatePctOverride !== null
      ? Math.abs(Number(savingsTaxRatePctOverride) || 0)
      : Math.abs(Number(macroParams.savingsTaxRatePct ?? 21));
    return { gross, net: gross * (1 - taxRatePct / 100), taxRatePct };
  }

  return { gross, net: gross, taxRatePct: 0 };
}

// --- VALOR DE LIQUIDACIÓN ---

// Lo que costó un activo. Si no se ha dicho, se estima a partir del porcentaje
// de plusvalía latente que se supone por defecto: un activo que vale 130 con un
// 30% supuesto de plusvalía costó 100.
export function assetAcquisitionCost(asset, macroParams) {
  const value = Math.max(0, Number(asset.value) || 0);
  const declared = Number(asset.acquisitionCost);
  if (Number.isFinite(declared) && declared > 0) return declared;

  const gainPct = Math.max(0, Number(macroParams.assumedUnrealizedGainPct ?? 30));
  return value / (1 + gainPct / 100);
}

// Plusvalía latente de un activo: lo que tributaría al venderlo. Solo bolsa e
// inmuebles; la caja no genera ganancia y las pensiones tributan por otra vía.
export function assetCapitalGain(asset, macroParams) {
  const sub = asset.subcategory;
  if (sub !== 'stocks' && sub !== 'real_estate') return 0;
  const value = Math.max(0, Number(asset.value) || 0);
  return Math.max(0, value - assetAcquisitionCost(asset, macroParams));
}

// Lo que quedaría de un activo tras venderlo, sin contar el impuesto sobre la
// plusvalía: ese se calcula aparte porque la escala es progresiva y depende de
// la ganancia de todo el balance, no de la de cada pieza.
export function assetGrossLiquidation(asset, macroParams) {
  const value = Math.max(0, Number(asset.value) || 0);
  const pct = (key, fallback) => Math.abs(Number(macroParams[key] ?? fallback)) / 100;

  switch (asset.subcategory) {
    case 'real_estate':
      return value * (1 - pct('propertySellingCostsPct', 8));
    case 'pensions':
      // El rescate tributa como renta del trabajo, al tipo marginal.
      return value * (1 - pct('pensionWithdrawalTaxPct', 37));
    case 'tangibles':
      return value * (1 - pct('tangiblesHaircutPct', 25));
    default:
      // Caja y bolsa salen por su valor; a la bolsa se le resta después el
      // impuesto sobre la plusvalía.
      return value;
  }
}

// Lo que cuesta quitarse una deuda de encima hoy: el saldo vivo más la comisión
// por amortización anticipada, que solo se aplica a préstamos amortizables.
export function liabilityCancellationCost(liability, macroParams, resolved) {
  const balance = Math.max(0, Number(resolved?.value ?? liability.value) || 0);
  const amortizable = liability.subcategory === 'mortgages' || liability.subcategory === 'personal_loans';
  if (!amortizable) return balance;
  const feePct = Math.abs(Number(macroParams.earlyRepaymentFeePct ?? 0.25)) / 100;
  return balance * (1 + feePct);
}

// --- CONVERSIÓN DE DIVISA ---
// Los tipos de cambio tienen EUR como base: rates[X] = unidades de X por 1 EUR.

// Algunas fuentes cotizan en la unidad menor (yfinance devuelve GBp, peniques,
// para el LSE). Sin esto, 12.146 peniques se tratarían como 12.146 libras.
const MINOR_UNIT_CURRENCIES = {
  GBp: { parent: 'GBP', per: 100 },
  ZAc: { parent: 'ZAR', per: 100 },
  ILA: { parent: 'ILS', per: 100 }
};

export function normalizeCurrencyAmount(val, currency) {
  const minor = MINOR_UNIT_CURRENCIES[currency];
  if (!minor) return { value: Number(val || 0), currency };
  return { value: Number(val || 0) / minor.per, currency: minor.parent };
}

export function convertToBase(val, fromCurr, baseCurrency, exchangeRates) {
  const { value: valNum, currency: curr } = normalizeCurrencyAmount(val, fromCurr || baseCurrency);
  if (curr === baseCurrency) return valNum;

  const rawFrom = Number(exchangeRates[curr]);
  if (!rawFrom) {
    // Antes se caía a 1.0 en silencio, tratando cualquier divisa desconocida
    // como si estuviera a la par con la base.
    console.warn(`[balance] Sin tipo de cambio para ${curr}; el importe se deja sin convertir.`);
  }
  const rateFrom = rawFrom || 1.0;
  const rateBase = Number(exchangeRates[baseCurrency]) || 1.0;

  return (valNum / rateFrom) * rateBase;
}

// --- DIVISAS QUE YA NO SE ADMITEN ---

// Balance admitía diez divisas y Retiro siete. Para que un fichero valga en
// las dos, Balance se quedó con las de Retiro y dejó fuera estas tres. Este es
// el último tipo que publicó el bot antes de dejar de pedirlas; solo se usa si
// el fichero no trae el suyo.
export const RETIRED_CURRENCY_RATES = { CNY: 7.5252, CAD: 1.6032, AUD: 1.6175 };

const IMPORTES_DE_ACTIVO = ['value', 'acquisitionCost', 'monthlyRent', 'sharePrice'];
const IMPORTES_DE_DEUDA = ['value', 'initialPrincipal', 'monthlyPayment', 'balanceOverride'];

// Pasa a euros lo que venga en una divisa retirada, con el tipo del fichero si
// lo trae y si no con el último conocido. No se pierde nada: el activo sigue
// ahí, en euros, y la lista de lo convertido es lo que permite avisar. Una
// acción de Shanghái o Toronto se queda sin bolsa —esas dos se fueron con sus
// divisas— y pasa a meterse por su importe, como un fondo.
export function retireUnsupportedCurrencies(items, fileRates, kind = 'asset') {
  const converted = [];
  const campos = kind === 'asset' ? IMPORTES_DE_ACTIVO : IMPORTES_DE_DEUDA;
  const out = (items || []).map(it => {
    const cur = it?.currency;
    if (!cur || !(cur in RETIRED_CURRENCY_RATES)) return it;
    const delFichero = Number(fileRates?.[cur]);
    const rate = Number.isFinite(delFichero) && delFichero > 0 ? delFichero : RETIRED_CURRENCY_RATES[cur];
    const next = { ...it, currency: 'EUR' };
    campos.forEach(k => {
      if (next[k] !== undefined && next[k] !== null && next[k] !== '' && Number.isFinite(Number(next[k]))) {
        next[k] = Math.round((Number(next[k]) / rate) * 100) / 100;
      }
    });
    if (kind === 'asset' && next.subcategory === 'stocks' && next.stockType === 'shares') {
      next.stockType = 'fund';
      next.market = '';
      next.ticker = '';
      next.sharesCount = 0;
      next.sharePrice = 0;
    }
    converted.push({ name: it.name, currency: cur, rate });
    return next;
  });
  return { items: out, converted };
}

// --- ACTUALIZACIÓN DE COTIZACIONES ---

// Revalúa las posiciones en acciones con los datos de mercado del día.
// Una posición guarda el precio del momento en que se creó, así que sin esto
// nunca se actualiza: ni el precio, ni la divisa, ni el dividendo. Es también
// la única vía por la que se corrige un dividendo guardado con un valor
// erróneo antes de que se arreglara el origen de los datos.
// Pasa un bloque de gastos de la divisa en la que se guardó a la divisa base.
// Solo hace falta al importar: los activos llevan su propia divisa y se
// convierten solos, pero los gastos no la llevan, así que un fichero guardado
// en dólares traería cifras en dólares que se leerían como euros.
export function convertExpensesToBase(expenses, fromCurrency, baseCurrency, exchangeRates) {
  if (!expenses) return expenses;
  if (!fromCurrency || fromCurrency === baseCurrency) return expenses;
  const grupo = (obj) => Object.fromEntries(
    Object.entries(obj || {}).map(([k, v]) => [k, convertToBase(Number(v) || 0, fromCurrency, baseCurrency, exchangeRates)])
  );
  return {
    person_monthly: grupo(expenses.person_monthly),
    household_monthly: grupo(expenses.household_monthly),
    family_annual: grupo(expenses.family_annual)
  };
}

export function refreshHoldingsFromMarket(assets, tickersDb) {
  const changes = [];
  const notFound = [];

  const next = (assets || []).map(a => {
    if (a.subcategory !== 'stocks' || a.stockType !== 'shares') return a;
    if (!a.market || !a.ticker) return a;

    const list = (tickersDb && tickersDb[a.market]) || [];
    const wanted = String(a.ticker).trim().toLowerCase();
    const quote = list.find(item => String(item.ticker).trim().toLowerCase() === wanted);

    if (!quote) {
      notFound.push({ name: a.name, ticker: a.ticker, market: a.market });
      return a;
    }

    const shares = Number(a.sharesCount) || 0;
    const newPrice = Number(quote.price) || 0;
    const newValue = Math.round(shares * newPrice * 100) / 100;
    const newYield = Number(quote.divYield) || 0;
    const newCurrency = quote.currency || a.currency;

    const priceChanged = Math.abs(newPrice - (Number(a.sharePrice) || 0)) > 0.0001;
    const yieldChanged = Math.abs(newYield - (Number(a.cashReturnPct) || 0)) > 0.0001;
    const currencyChanged = newCurrency !== a.currency;

    if (!priceChanged && !yieldChanged && !currencyChanged) return a;

    changes.push({
      name: a.name,
      ticker: a.ticker,
      previousPrice: Number(a.sharePrice) || 0,
      price: newPrice,
      previousValue: Number(a.value) || 0,
      value: newValue,
      previousYieldPct: Number(a.cashReturnPct) || 0,
      yieldPct: newYield,
      previousCurrency: a.currency,
      currency: newCurrency
    });

    return {
      ...a,
      sharePrice: newPrice,
      value: newValue,
      cashReturnPct: newYield,
      currency: newCurrency
    };
  });

  return { assets: next, changes, notFound };
}

// --- SERIALIZACIÓN DE COPIAS DE SEGURIDAD ---
// Formato de intercambio compatible con Retire. Las claves planas de
// `familyExpenses` y `macro` son las que viajan en el archivo.

const EXPENSE_FILE_KEYS = {
  person_monthly: {
    food: 'food',
    clothes: 'clothes',
    supplies_person: 'supplies_p',
    transport: 'transport',
    other_person: 'other_p'
  },
  household_monthly: {
    supplies: 'supplies_h',
    subs: 'subs',
    otherHouse: 'otherHouse'
  },
  family_annual: {
    housekeeper: 'housekeeper',
    education: 'education',
    vacations: 'vacations',
    vehicleMaint: 'vehicle',
    otherFixed: 'otherFixed'
  }
};

export function serializeExpenses(expenses) {
  const out = {};
  Object.entries(EXPENSE_FILE_KEYS).forEach(([group, keyMap]) => {
    const src = expenses[group] || {};
    Object.entries(keyMap).forEach(([stateKey, fileKey]) => {
      out[fileKey] = Number(src[stateKey]) || 0;
    });
  });
  return out;
}

export function deserializeExpenses(familyExpenses) {
  const fe = familyExpenses || {};
  const out = {};
  Object.entries(EXPENSE_FILE_KEYS).forEach(([group, keyMap]) => {
    out[group] = {};
    Object.entries(keyMap).forEach(([stateKey, fileKey]) => {
      out[group][stateKey] = Number(fe[fileKey]) || 0;
    });
  });
  return out;
}

// Un cero es un cero, no la ausencia de un dato. `Number(x) || porDefecto`
// confunde las dos cosas, y por eso unos costes operativos puestos a 0% salían
// del fichero convertidos en 15%: el usuario los había fijado a cero a
// propósito y la copia de seguridad se los devolvía cambiados sin avisar.
// Aquí solo cae al valor por defecto lo que de verdad no hay: vacío, ausente o
// ilegible.
function numeroOr(v, porDefecto) {
  if (v === null || v === undefined || v === '') return porDefecto;
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

// Un ajuste vacío no es un cero. Se conserva la diferencia al ir y volver.
const nullOrNumber = (v) => numeroOr(v, null);

// Los importes no admiten negativos: deber −100 € o tener −5.000 € en el banco
// no significa nada, y aguas abajo salen colchones de liquidez negativos y
// notas de auditoría por debajo de cero. Las fichas ya no dejan escribirlos;
// esto cierra la otra puerta, la de un fichero traído de fuera.
const importe = (v, porDefecto = 0) => Math.max(0, numeroOr(v, porDefecto));

export function serializeMacro(macroParams) {
  return {
    stockGrowth: numeroOr(macroParams.stockGrowthPct, 6.0),
    divYield: numeroOr(macroParams.refDividendYieldPct, 3.0),
    bondYield: numeroOr(macroParams.bondYieldPct, 3.0),
    tipsRealYield: numeroOr(macroParams.tipsRealYieldPct, 1.0),
    goldRealReturn: numeroOr(macroParams.goldRealReturnPct, 0.0),
    inflation: numeroOr(macroParams.inflationPct, 2.0),
    reAppreciation: numeroOr(macroParams.realEstateAppreciationPct, 2.0),
    // Retiro llama a esto `propertyInflation`. Se escriben los dos nombres para
    // que la revalorización del ladrillo no se pierda al pasar de una
    // herramienta a la otra; leemos ambos al importar.
    propertyInflation: numeroOr(macroParams.realEstateAppreciationPct, 2.0),
    reMaint: numeroOr(macroParams.realEstateMaintenancePct, 0.6),
    reOpex: numeroOr(macroParams.rentalOperatingCostsPct, 15.0),
    reDeduction: numeroOr(macroParams.rentalPrimaryHomeDeductionPct, 50.0),
    marginalTax: numeroOr(macroParams.marginalIncomeTaxPct, 37.0),
    savingsTax: numeroOr(macroParams.savingsTaxRatePct, 21.0),
    fireMultiple: numeroOr(macroParams.fireTargetMultiple, 25),

    // Parámetros que solo existen en Balance. Retiro lee campos con nombre y
    // pasa de los que no conoce, así que añadirlos no le afecta; sin ellos, al
    // guardar y volver a cargar se perdían la comunidad, el número de
    // contribuyentes y todos los supuestos de liquidación.
    wealthRegion: macroParams.wealthTaxRegion || 'estatal',
    wealthPayers: Math.max(1, Math.round(Number(macroParams.wealthTaxPayers) || 1)),
    // Vacíos van como null a propósito: es lo que significa «usa los de la
    // comunidad». Un 0 querría decir «sin mínimo exento», que no es lo mismo.
    wealthExemption: macroParams.wealthTaxExemption ?? null,
    wealthBonification: macroParams.wealthTaxBonificationPct ?? null,
    pensionWithdrawalTax: numeroOr(macroParams.pensionWithdrawalTaxPct, 37.0),
    propertySellingCosts: numeroOr(macroParams.propertySellingCostsPct, 8.0),
    tangiblesHaircut: numeroOr(macroParams.tangiblesHaircutPct, 25.0),
    earlyRepaymentFee: numeroOr(macroParams.earlyRepaymentFeePct, 0.25),
    assumedUnrealizedGain: numeroOr(macroParams.assumedUnrealizedGainPct, 30.0)
  };
}

export function deserializeMacro(macroSrc) {
  const src = macroSrc || {};
  return {
    ...DEFAULT_MACRO_PARAMS,
    inflationPct: numeroOr(src.inflation ?? src.inflationPct, DEFAULT_MACRO_PARAMS.inflationPct),
    // Un fichero anterior a este parámetro no lo trae: se hereda la inflación,
    // que es exactamente lo que la herramienta usaba entonces.
    realEstateAppreciationPct: numeroOr(
      src.reAppreciation ?? src.realEstateAppreciationPct ?? src.propertyInflation ?? src.inflation ?? src.inflationPct,
      DEFAULT_MACRO_PARAMS.realEstateAppreciationPct
    ),
    stockGrowthPct: numeroOr(src.stockGrowth ?? src.stockGrowthPct, DEFAULT_MACRO_PARAMS.stockGrowthPct),
    refDividendYieldPct: numeroOr(src.divYield ?? src.refDividendYieldPct, DEFAULT_MACRO_PARAMS.refDividendYieldPct),
    bondYieldPct: numeroOr(src.bondYield ?? src.bondYieldPct, DEFAULT_MACRO_PARAMS.bondYieldPct),
    tipsRealYieldPct: numeroOr(src.tipsRealYield ?? src.tipsRealYieldPct, DEFAULT_MACRO_PARAMS.tipsRealYieldPct),
    goldRealReturnPct: numeroOr(src.goldRealReturn ?? src.goldRealReturnPct, DEFAULT_MACRO_PARAMS.goldRealReturnPct),
    realEstateMaintenancePct: numeroOr(src.reMaint ?? src.realEstateMaintenancePct, DEFAULT_MACRO_PARAMS.realEstateMaintenancePct),
    rentalOperatingCostsPct: numeroOr(src.reOpex ?? src.rentalOperatingCostsPct, DEFAULT_MACRO_PARAMS.rentalOperatingCostsPct),
    rentalPrimaryHomeDeductionPct: numeroOr(src.reDeduction ?? src.rentalPrimaryHomeDeductionPct, DEFAULT_MACRO_PARAMS.rentalPrimaryHomeDeductionPct),
    marginalIncomeTaxPct: numeroOr(src.marginalTax ?? src.marginalIncomeTaxPct, DEFAULT_MACRO_PARAMS.marginalIncomeTaxPct),
    savingsTaxRatePct: numeroOr(src.savingsTax ?? src.savingsTaxRatePct, DEFAULT_MACRO_PARAMS.savingsTaxRatePct),
    fireTargetMultiple: numeroOr(src.fireMultiple ?? src.fireTargetMultiple, DEFAULT_MACRO_PARAMS.fireTargetMultiple),

    // Solo de Balance. Un fichero de Retiro no los trae y se quedan con el
    // valor por defecto, que es justo lo que se quiere.
    wealthTaxRegion: src.wealthRegion ?? src.wealthTaxRegion ?? DEFAULT_MACRO_PARAMS.wealthTaxRegion,
    wealthTaxPayers: Math.max(1, Math.round(Number(src.wealthPayers ?? src.wealthTaxPayers ?? DEFAULT_MACRO_PARAMS.wealthTaxPayers) || 1)),
    // `null` significa «los de la comunidad», así que no puede pasar por
    // Number(): lo convertiría en un cero que anularía el mínimo exento.
    wealthTaxExemption: nullOrNumber(src.wealthExemption ?? src.wealthTaxExemption),
    wealthTaxBonificationPct: nullOrNumber(src.wealthBonification ?? src.wealthTaxBonificationPct),
    pensionWithdrawalTaxPct: numeroOr(src.pensionWithdrawalTax ?? src.pensionWithdrawalTaxPct, DEFAULT_MACRO_PARAMS.pensionWithdrawalTaxPct),
    propertySellingCostsPct: numeroOr(src.propertySellingCosts ?? src.propertySellingCostsPct, DEFAULT_MACRO_PARAMS.propertySellingCostsPct),
    tangiblesHaircutPct: numeroOr(src.tangiblesHaircut ?? src.tangiblesHaircutPct, DEFAULT_MACRO_PARAMS.tangiblesHaircutPct),
    earlyRepaymentFeePct: numeroOr(src.earlyRepaymentFee ?? src.earlyRepaymentFeePct, DEFAULT_MACRO_PARAMS.earlyRepaymentFeePct),
    assumedUnrealizedGainPct: numeroOr(src.assumedUnrealizedGain ?? src.assumedUnrealizedGainPct, DEFAULT_MACRO_PARAMS.assumedUnrealizedGainPct)
  };
}

export function serializeAssets(assets, { baseCurrency, macroParams }) {
  return assets.map(a => {
    let cat = a.subcategory || 'cash';
    let cashPct = Number(a.cashReturnPct) || 0;
    let capPct = Number(a.capitalReturnPct) || 0;
    // El subtipo lo elige el usuario. Antes se adivinaba: toda acción con un
    // dividendo del 2,5% o más salía como de dividendo, y un fondo nunca.
    if (cat === 'stocks') {
      const clase = stockClassOf(a);
      cat = CATEGORIA_RETIRO_DEL_SUBTIPO[clase];
      if (CUPON_EN_CAPITAL_EN_RETIRO.includes(clase)) [cashPct, capPct] = [capPct, cashPct];
    } else if (cat === 'pensions' && pensionTypeOf(a) === 'insurance') {
      cat = 'pensionIns';
    }
    return {
      id: a.id,
      name: a.name,
      category: cat,
      currency: a.currency || baseCurrency,
      value: Number(a.value) || 0,
      cashReturnPct: cashPct,
      useReturnPct: Number(a.useReturnPct) || 0,
      capitalReturnPct: capPct,
      // Este campo lo lee Retiro. Si el usuario ha dicho lo que costó, se manda
      // lo de verdad. Si no, en un inmueble se manda el 75% del valor, que es
      // lo mismo que supondría Retiro; en lo demás no se manda nada, para que
      // Retiro aplique su propia plusvalía latente de cada categoría. Antes se
      // inventaba el 75% también ahí, y una cartera de Retiro que pasaba por
      // aquí volvía con más plusvalía de la que tenía: pagaba más impuesto en
      // cada venta y la proyección entera se movía.
      ...(Number(a.acquisitionCost) > 0
        ? { purchasePrice: Number(a.acquisitionCost) }
        : (a.purchasePrice
            ? { purchasePrice: a.purchasePrice }
            : (cat === 'real_estate' ? { purchasePrice: Number(a.value) * 0.75 } : {}))),
      acquisitionCost: Number(a.acquisitionCost) || 0,
      monthlyRent: Number(a.monthlyRent) || 0,
      useType: a.useType || 'habitual',
      opexPct: numeroOr(macroParams.rentalOperatingCostsPct, 15.0),
      hasMaint: a.useType === 'habitual',
      // `land` lo entiende Retiro desde que existe el suelo; un fichero
      // anterior con `vacant` sigue siendo un inmueble vacío en las dos.
      // Atributos de mercado propios de sample_share
      stockType: a.stockType,
      sharesCount: a.sharesCount,
      sharePrice: a.sharePrice,
      market: a.market,
      ticker: a.ticker,
      // Campos que esta herramienta no usa pero Retiro sí: el titular de la
      // posición, si un plan de pensiones sigue aportando, la fecha de compra
      // del inmueble, los gramos de oro y si cada rentabilidad sigue al valor
      // estándar de sus Parámetros. Se conservan tal cual para que abrir una
      // copia aquí y volver a guardarla no se los lleve por delante.
      ...pick(a, CAMPOS_SOLO_DE_RETIRO)
    };
  });
}

const CAMPOS_SOLO_DE_RETIRO = ['owner', 'isActivePP', 'purchaseDate', 'grams', 'cashReturnCoupled', 'capitalReturnCoupled'];

function pick(obj, campos) {
  const out = {};
  campos.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

// Meses corridos entre una fecha «AAAA-MM» y ahora, nunca negativos.
function mesesTranscurridos(startDateStr, now = new Date()) {
  const partes = String(startDateStr || '').substring(0, 7).split('-');
  const anio = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  if (!Number.isFinite(anio) || !Number.isFinite(mes)) return 0;
  return Math.max(0, (now.getFullYear() - anio) * 12 + (now.getMonth() - (mes - 1)));
}

// Año y mes de hoy, en el formato que usan las fichas.
function mesActual(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function cuotaDelCuadro(l) {
  const n = Math.round(Number(l.durationMonths));
  if (!Number.isFinite(n) || n < 1) return false;
  if (l.subcategory === 'personal_loans') return true;
  return l.subcategory === 'mortgages' && numeroOr(l.initialPrincipal, 0) > 0 && !l.noMonthlyPayment;
}

export function serializeLiabilities(liabilities, { baseCurrency }) {
  return liabilities.map(l => ({
    id: l.id,
    name: l.name,
    subcategory: l.subcategory || 'mortgages',
    propertyLink: l.propertyLink || '',
    currency: l.currency || baseCurrency,
    // En una deuda que no se amortiza —una tarjeta, un préstamo familiar— el
    // saldo ES `value`: no hay cuadro del que derivarlo, y `initialPrincipal`
    // es el único campo del fichero que puede llevarlo. Escribía el importe
    // del alta, que se queda congelado en cuanto empiezas a devolver: una Visa
    // bajada de 1.500 € a 300 € volvía del fichero debiendo 1.500 otra vez.
    // La hipoteca es la excepción de verdad: ahí el principal original es un
    // dato propio, y el saldo sale de correr el cuadro.
    initialPrincipal: l.subcategory === 'mortgages'
      ? numeroOr(l.initialPrincipal, numeroOr(l.value, 0))
      : numeroOr(l.value, numeroOr(l.initialPrincipal, 0)),
    // La fecha de hoy en todo lo que no lleva cuadro de amortización, que aquí
    // es todo menos la hipoteca. En esas deudas el trío que mantiene el
    // usuario —saldo, plazo y cuota— describe lo que queda HOY, así que la
    // fecha tiene que decir lo mismo o la ficha se contradice a sí misma: con
    // la del alta, quien la lea corre el saldo de hoy desde hace tres años y
    // lo da por medio devuelto. Y una deuda familiar sin cuota se capitaliza
    // desde esa fecha, así que además le caían tres años de intereses encima.
    //
    // La hipoteca es la excepción: ahí el histórico es el dato y el saldo sale
    // precisamente de correr el cuadro desde el día que se firmó.
    startDate: l.subcategory === 'mortgages'
      ? (l.startDate || `${new Date().getFullYear()}-01`)
      : mesActual(),
    // Un plazo de 0 no es un plazo ausente. Escribir 240 en su lugar convertía
    // una hipoteca sin cuadro —que aquí vale su principal y no paga cuota— en
    // una hipoteca de veinte años que, con su fecha de inicio antigua, volvía
    // del fichero completamente amortizada: cientos de miles de euros de deuda
    // desaparecían del balance al guardar y volver a cargar.
    durationMonths: numeroOr(l.durationMonths, 240),
    interestRatePct: numeroOr(l.interestRatePct, 0),
    // En una deuda con cuadro —hipoteca con plazo, préstamo personal— la cuota no es un dato:
    // sale del cuadro, y aquí se recalcula al cargar. Va como 0, que en Retiro quiere decir
    // «calcúlala tú». Cuando viajaba redondeada a céntimos, Retiro la leía como una cuota fija
    // declarada y el saldo se le desviaba unos céntimos al año; en una variable, calculada
    // además con el tipo del día en que se guardó, la desviación era de euros.
    monthlyPayment: cuotaDelCuadro(l) ? 0 : numeroOr(l.monthlyPayment, 0),
    noMonthlyPayment: !!l.noMonthlyPayment,
    // Campos propios de esta herramienta. Retire los ignora, pero si no
    // viajaran, una hipoteca variable volvería convertida en fija.
    rateType: l.rateType === 'variable' ? 'variable' : 'fixed',
    spreadPct: Number(l.spreadPct) || 0,
    balanceOverride: Number(l.balanceOverride) || 0
  }));
}

export function deserializeAssets(rawAssets, importedMacro) {
  if (!Array.isArray(rawAssets)) return null;
  return rawAssets
    .filter(a => !a.isPurchasedInSim)
    .map((a, idx) => {
      // `category` es la clave del fichero, la que escriben las dos
      // herramientas, y manda sobre cualquier subtipo que venga al lado: si
      // alguien cambia un bono a acciones en Retiro, el `stockClass` que
      // dejó esta herramienta se ha quedado viejo.
      const raw = a.category || a.subcategory || 'cash';
      let sub = raw;
      let stockClass;
      let pensionType;
      if (SUBTIPO_DE_LA_CATEGORIA_RETIRO[raw]) {
        sub = 'stocks';
        stockClass = SUBTIPO_DE_LA_CATEGORIA_RETIRO[raw];
      } else if (raw === 'pensionIns') {
        sub = 'pensions';
        pensionType = 'insurance';
      } else if (raw === 'pensions') {
        pensionType = 'plan';
      }
      // Un fichero que solo trae `subcategory: 'stocks'` es de esta misma
      // herramienta y puede llevar su subtipo.
      if (sub === 'stocks' && !SUBTIPO_DE_LA_CATEGORIA_RETIRO[a.category] && STOCK_CLASSES.includes(a.stockClass)) {
        stockClass = a.stockClass;
      }

      let cashPct = Number(a.cashReturnPct) || 0;
      let usePct = Number(a.useReturnPct) || 0;
      let capPct = Number(a.capitalReturnPct) || 0;

      if (sub === 'real_estate') {
        const r = calculateRealEstateReturns(a.value, a.monthlyRent, a.useType || 'habitual', importedMacro);
        cashPct = r.cashReturnPct;
        usePct = r.useReturnPct;
        capPct = r.capitalReturnPct;
      }
      // Ver CUPON_EN_CAPITAL_EN_RETIRO: lo que Retiro reinvierte, aquí se cobra.
      if (CUPON_EN_CAPITAL_EN_RETIRO.includes(stockClass) && SUBTIPO_DE_LA_CATEGORIA_RETIRO[a.category]) {
        [cashPct, capPct] = [capPct, cashPct];
      }

      return {
        id: a.id || `asset_${Date.now()}_${idx}`,
        name: String(a.name || 'Activo'),
        subcategory: ASSET_SUBCATEGORIES.includes(sub) ? sub : 'cash',
        currency: a.currency || 'EUR',
        value: importe(a.value),
        cashReturnPct: cashPct,
        useReturnPct: usePct,
        capitalReturnPct: capPct,
        monthlyRent: importe(a.monthlyRent),
        useType: a.useType || 'habitual',
        // Sin ticker no hay cotización de la que sacar el valor: es una
        // posición que se mete por su importe, como un fondo. Retiro no
        // escribe `stockType`, y entrar como «acciones» con cero títulos hacía
        // que la ficha, al guardar, recalculara el valor a cero. La renta fija
        // y el oro, además, nunca van por acciones de la lista.
        stockType: (a.stockType === 'shares' || a.stockType === 'fund') ? a.stockType
          : (a.ticker && (!stockClass || stockClass === 'growth' || stockClass === 'dividend') ? 'shares' : 'fund'),
        sharesCount: importe(a.sharesCount),
        sharePrice: importe(a.sharePrice),
        market: a.market || '',
        ticker: a.ticker || '',
        ...(stockClass ? { stockClass } : {}),
        ...(pensionType ? { pensionType } : {}),
        // Ver el comentario de serializeAssets: no se usan aquí, se conservan.
        ...pick(a, CAMPOS_SOLO_DE_RETIRO),
        // Un cero significa «no lo sé», no «me costó cero».
        //
        // `purchasePrice` es como Retiro llama a este mismo dato, así que sirve
        // de respaldo, pero solo cuando el fichero no trae `acquisitionCost`:
        // esa clave solo la escribe Balance, y su presencia identifica el
        // origen. Sin esa condición, el `purchasePrice` que Balance se inventa
        // al 75% del valor cuando no hay coste declarado volvía a entrar como
        // si fuera un coste real, convirtiendo una estimación en un dato.
        ...(Number(a.acquisitionCost) > 0
          ? { acquisitionCost: Number(a.acquisitionCost) }
          : (a.acquisitionCost === undefined && Number(a.purchasePrice) > 0
              ? { acquisitionCost: Number(a.purchasePrice) }
              : {}))
      };
    });
}

export function deserializeLiabilities(rawLiabs) {
  if (!Array.isArray(rawLiabs)) return null;
  const ahora = new Date();
  const sanitized = rawLiabs
    .filter(l => !String(l.id).startsWith('mort_re_buy_'))
    .map((l, idx) => {
      // Las deudas sin cuadro —tarjeta, préstamo personal, familiar— se
      // convierten al modelo de aquí: aquí el saldo es lo que se debe HOY, y
      // fuera puede venir descrito como «tanto, desde tal fecha, en tantos
      // meses». Se corre ese cuadro hasta hoy y lo que queda es lo que se
      // guarda. Un fichero escrito por esta herramienta trae la fecha de hoy,
      // así que no se mueve nada; uno de Retiro trae la del alta, y sin esto
      // una Visa de 1.500 € abierta en 2023 y ya devuelta entraba debiendo los
      // 1.500 otra vez.
      //
      // La hipoteca no pasa por aquí: su modelo ES el cuadro, y de correrlo se
      // encarga resolveLiability cada vez que hace falta.
      if (l.subcategory !== 'mortgages') {
        const principal = Number(l.initialPrincipal) || Number(l.value) || 0;
        const plazo = Number(l.durationMonths) || 0;

        if (l.noMonthlyPayment) {
          // Sin cuota no hay cuadro que correr: la deuda capitaliza, que es lo
          // mismo que hace Retiro con esta casilla.
          const r = (Math.max(0, Number(l.interestRatePct) || 0) / 100) / 12;
          const meses = mesesTranscurridos(l.startDate, ahora);
          if (principal > 0 && r > 0 && meses > 0) {
            const capitalizado = Math.round(principal * Math.pow(1 + r, meses) * 100) / 100;
            l = { ...l, initialPrincipal: capitalizado, value: capitalizado };
          }
        } else if (principal > 0 && plazo > 0 && l.startDate) {
          const c = calculateLoanAmortization(principal, Number(l.interestRatePct) || 0, plazo, l.startDate, ahora);
          l = {
            ...l,
            initialPrincipal: c.currentBalance,
            value: c.currentBalance,
            durationMonths: Math.max(1, c.monthsRemaining)
          };
        }
      }
      return l;
    })
    .map((l, idx) => ({
      id: l.id || `liab_${Date.now()}_${idx}`,
      name: String(l.name || 'Deuda'),
      subcategory: l.subcategory || 'mortgages',
      currency: l.currency || 'EUR',
      // Un saldo de 0 es una deuda ya devuelta, no un dato que falte. Al
      // caer al principal, un préstamo saldado resucitaba por su importe
      // original en cuanto se recargaba la copia.
      value: importe(l.value, importe(l.initialPrincipal)),
      interestRatePct: numeroOr(l.interestRatePct, 0),
      monthlyPayment: importe(l.monthlyPayment),
      initialPrincipal: importe(l.initialPrincipal, importe(l.value)),
      startDate: l.startDate || `${new Date().getFullYear()}-01`,
      durationMonths: importe(l.durationMonths, 240),
      noMonthlyPayment: !!l.noMonthlyPayment,
      // Qué inmueble hipoteca esta deuda. Balance no lo usa; Retiro sí, y sin
      // conservarlo una ida y vuelta dejaba sus hipotecas sin vincular.
      propertyLink: l.propertyLink || '',
      rateType: l.rateType === 'variable' ? 'variable' : 'fixed',
      spreadPct: Number(l.spreadPct) || 0,
      // Un cero guardado significa «sin ancla», no «saldo cero».
      ...(Number(l.balanceOverride) > 0 ? { balanceOverride: Number(l.balanceOverride) } : {})
    }));
  return syncLiabilitiesAmortization(sanitized);
}

export function buildExportPayload(state) {
  const { assets, liabilities, expenses, macroParams, baseCurrency, selectedCountry, familyMembers, exchangeRates } = state;
  return {
    version: '9.7',
    exportDate: new Date().toISOString(),
    baseCurrency,
    selectedCountry,
    familyMembers,
    assetsData: serializeAssets(assets, { baseCurrency, macroParams }),
    liabilitiesData: serializeLiabilities(liabilities, { baseCurrency }),
    familyExpenses: serializeExpenses(expenses),
    macro: serializeMacro(macroParams),
    exchangeRates
  };
}

// Devuelve solo los campos presentes en el archivo. El llamante decide
// cómo aplicarlos al estado.
export function parseImportPayload(parsed, { expenseFallback } = {}) {
  const out = {};

  if (parsed.baseCurrency === 'USD' || parsed.baseCurrency === 'EUR') {
    out.baseCurrency = parsed.baseCurrency;
  }
  // El país elige la cesta de gasto de referencia, y el motor deduce de su
  // prefijo la divisa en la que están esas cifras. Una clave desconocida caía
  // a la cesta española conservando la divisa del prefijo, así que un
  // `us_loquesea` comparaba gastos en euros contra un baremo leído en dólares.
  // Solo entra lo que existe.
  if (typeof parsed.selectedCountry === 'string' && COUNTRY_PRESETS[parsed.selectedCountry]) {
    out.selectedCountry = parsed.selectedCountry;
  }
  if (parsed.familyMembers !== undefined) {
    out.familyMembers = Math.max(1, Number(parsed.familyMembers) || 1);
  } else if (parsed.hasPartner !== undefined) {
    const numChildren = Array.isArray(parsed.childrenAges) ? parsed.childrenAges.length : 0;
    out.familyMembers = (parsed.hasPartner ? 2 : 1) + numChildren;
  }

  out.macroParams = deserializeMacro(parsed.macro || parsed.macroParams);
  out.assets = deserializeAssets(parsed.assetsData || parsed.assets, out.macroParams);
  out.liabilities = deserializeLiabilities(parsed.liabilitiesData || parsed.liabilities);

  // Ver retireUnsupportedCurrencies. Lo convertido se devuelve para avisar.
  out.currencyConversions = [];
  for (const [clave, kind] of [['assets', 'asset'], ['liabilities', 'liability']]) {
    if (!out[clave]) continue;
    const r = retireUnsupportedCurrencies(out[clave], parsed.exchangeRates, kind);
    out[clave] = r.items;
    out.currencyConversions.push(...r.converted);
  }

  if (parsed.familyExpenses) {
    out.expenses = deserializeExpenses(parsed.familyExpenses);
  } else if (parsed.expenses && typeof parsed.expenses === 'object') {
    const sanitizeGroup = (grp, fallback) => {
      const res = { ...fallback };
      Object.entries(grp || {}).forEach(([k, v]) => {
        res[k] = Math.max(0, Number(v) || 0);
      });
      return res;
    };
    const fb = expenseFallback || { person_monthly: {}, household_monthly: {}, family_annual: {} };
    out.expenses = {
      person_monthly: sanitizeGroup(parsed.expenses.person_monthly, fb.person_monthly),
      household_monthly: sanitizeGroup(parsed.expenses.household_monthly, fb.household_monthly),
      family_annual: sanitizeGroup(parsed.expenses.family_annual, fb.family_annual)
    };
  }

  return out;
}

// --- LECTURA DE NÚMEROS SEGÚN EL IDIOMA ---

// Separadores por idioma. La entrada se escribía siempre como es-ES aunque la
// interfaz estuviera en inglés, así que "1000.50" se leía como 100050.
export function localeSeparators(locale) {
  return (locale || 'es-ES').startsWith('en')
    ? { decimal: '.', group: ',' }
    : { decimal: ',', group: '.' };
}

// Convierte lo que el usuario escribe en un número.
//   - Si aparecen ambos separadores, el último manda: es el decimal.
//   - Si solo aparece uno, es decimal cuando el idioma lo dice así, o cuando
//     el campo admite decimales; en otro caso se trata como separador de miles.
// Devuelve null si el texto todavía no es un número (por ejemplo "-" o "1,").
export function parseLocaleNumber(text, locale = 'es-ES', decimals = 0) {
  if (typeof text !== 'string') return null;
  const raw = text.replace(/\s/g, '');
  if (raw === '' || raw === '-' || raw === '.' || raw === ',') return null;

  const { decimal, group } = localeSeparators(locale);
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');

  let decimalSep = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1) {
    decimalSep = (decimal === '.' || decimals > 0) ? '.' : null;
  } else if (lastComma !== -1) {
    decimalSep = (decimal === ',' || decimals > 0) ? ',' : null;
  }

  let clean = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') clean += ch;
    else if (ch === '-' && clean === '') clean += ch;
    else if (decimalSep && ch === decimalSep) clean += '.';
    // cualquier otro separador son miles y se descarta
  }

  const parts = clean.split('.');
  if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');

  const num = parseFloat(clean);
  if (!Number.isFinite(num)) return null;
  return decimals === 0 ? Math.round(num) : num;
}

// --- RESUMEN DE UNA COPIA ANTES DE CARGARLA ---

// Cargar una copia reemplaza todo el balance. Este resumen es lo que se
// enseña antes de hacerlo, para que la sustitución no sea a ciegas.
export function summarizeImport(next, current, baseCurrency, exchangeRates) {
  const sum = (items) => (items || []).reduce(
    (acc, i) => acc + convertToBase(i.value, i.currency, baseCurrency, exchangeRates), 0
  );
  const monthly = (e) => {
    if (!e) return null;
    const g = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    return g(e.person_monthly) + g(e.household_monthly) + g(e.family_annual) / 12;
  };

  return {
    assets:      { from: (current.assets || []).length,      to: next.assets ? next.assets.length : 0 },
    liabilities: { from: (current.liabilities || []).length, to: next.liabilities ? next.liabilities.length : 0 },
    assetValue:      { from: sum(current.assets),      to: sum(next.assets) },
    liabilityValue:  { from: sum(current.liabilities), to: sum(next.liabilities) },
    // Los gastos solo cambian si el archivo los trae.
    expenses: next.expenses
      ? { from: monthly(current.expenses), to: monthly(next.expenses) }
      : null,
    baseCurrency: next.baseCurrency && next.baseCurrency !== baseCurrency
      ? { from: baseCurrency, to: next.baseCurrency }
      : null,
    familyMembers: next.familyMembers !== undefined && next.familyMembers !== current.familyMembers
      ? { from: current.familyMembers, to: next.familyMembers }
      : null
  };
}
