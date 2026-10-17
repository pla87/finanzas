// --- IMPUESTO SOBRE EL PATRIMONIO ---
//
// Un impuesto anual por tener, no por ganar. No aparece en ningún flujo de
// caja de los activos porque no lo genera ninguno en concreto: se calcula
// sobre el patrimonio entero, igual que la escala del ahorro se calcula sobre
// la renta entera.
//
// Está cedido a las comunidades autónomas, así que dos personas con el mismo
// patrimonio pagan cosas muy distintas según dónde vivan. Las cifras de aquí
// son ORIENTATIVAS y llevan fecha: la normativa autonómica cambia cada año y
// esto no consulta nada en vivo. Tanto el mínimo exento como la bonificación
// se pueden ajustar a mano desde Variables si tu comunidad no está o si ha
// cambiado desde esa fecha.

// A qué momento corresponden los datos autonómicos de este fichero. Se enseña
// en Variables y en los supuestos para que nadie dé por hecho que están al día.
export const WEALTH_TAX_AS_OF = '2024-12-31';

// Escala estatal (Ley 19/1991). Se aplica cuando la comunidad no ha aprobado
// la suya, y aquí se usa para todas: modelar ocho escalas autonómicas casi
// iguales daría una falsa sensación de precisión.
export const STATE_WEALTH_TAX_BRACKETS = [
  { upTo: 167129.45, ratePct: 0.2 },
  { upTo: 334252.88, ratePct: 0.3 },
  { upTo: 668499.75, ratePct: 0.5 },
  { upTo: 1336999.51, ratePct: 0.9 },
  { upTo: 2673999.01, ratePct: 1.3 },
  { upTo: 5347998.03, ratePct: 1.7 },
  { upTo: 10695996.06, ratePct: 2.1 },
  { upTo: Infinity, ratePct: 3.5 }
];

// Impuesto Temporal de Solidaridad de las Grandes Fortunas. Es estatal y no se
// puede bonificar, así que actúa de suelo: en las comunidades que bonifican el
// patrimonio al 100%, un patrimonio grande sigue pagando esto. Sin él, Madrid
// o Andalucía saldrían a cero con cualquier fortuna, que no es el caso.
export const SOLIDARITY_TAX_BRACKETS = [
  { upTo: 3000000, ratePct: 0 },
  { upTo: 5347998.03, ratePct: 1.7 },
  { upTo: 10695996.06, ratePct: 2.1 },
  { upTo: Infinity, ratePct: 3.5 }
];

// Exención de la vivienda habitual, estatal y por contribuyente.
export const PRIMARY_HOME_EXEMPTION = 300000;

// Mínimo exento y bonificación por comunidad. Solo están las que se han podido
// contrastar; el resto usa el régimen estatal y se ajusta a mano.
export const WEALTH_TAX_REGIONS = {
  estatal:     { name_es: 'Régimen estatal (por defecto)', name_en: 'State regime (default)', exemption: 700000, bonificationPct: 0 },
  madrid:      { name_es: 'Madrid', name_en: 'Madrid', exemption: 700000, bonificationPct: 100 },
  andalucia:   { name_es: 'Andalucía', name_en: 'Andalusia', exemption: 700000, bonificationPct: 100 },
  extremadura: { name_es: 'Extremadura', name_en: 'Extremadura', exemption: 700000, bonificationPct: 100 },
  murcia:      { name_es: 'Murcia', name_en: 'Murcia', exemption: 700000, bonificationPct: 100 },
  cataluna:    { name_es: 'Cataluña', name_en: 'Catalonia', exemption: 500000, bonificationPct: 0 },
  valencia:    { name_es: 'Comunidad Valenciana', name_en: 'Valencia', exemption: 500000, bonificationPct: 0 },
  aragon:      { name_es: 'Aragón', name_en: 'Aragon', exemption: 400000, bonificationPct: 0 },
  baleares:    { name_es: 'Illes Balears', name_en: 'Balearic Islands', exemption: 3000000, bonificationPct: 0 },
  otra:        { name_es: 'Otra comunidad (ajústalo abajo)', name_en: 'Other region (adjust below)', exemption: 700000, bonificationPct: 0 }
};

function cuotaPorEscala(base, brackets) {
  const b = Math.max(0, Number(base) || 0);
  if (b <= 0) return 0;
  let cuota = 0, techoPrevio = 0;
  for (const { upTo, ratePct } of brackets) {
    if (b <= techoPrevio) break;
    cuota += (Math.min(b, upTo) - techoPrevio) * (ratePct / 100);
    techoPrevio = upTo;
  }
  return cuota;
}

// Cuota anual estimada. `netWorth` es el patrimonio neto y `primaryHomeValue`
// el valor de la vivienda habitual, que está exenta hasta cierto tope.
//
// El impuesto es POR CONTRIBUYENTE, no por hogar: no hay declaración conjunta.
// Un matrimonio con dos millones no declara dos millones, declara un millón
// cada uno, y eso cambia la cuota dos veces —cada uno se resta su mínimo
// exento y cada uno recorre la escala desde abajo, con lo que la mitad del
// patrimonio cae en tramos más baratos—. Por eso `taxpayers` reparte el
// patrimonio, calcula la cuota de una persona y la multiplica: se supone el
// reparto a partes iguales, que es lo habitual en gananciales.
export function wealthTaxDue({
  netWorth = 0,
  primaryHomeValue = 0,
  // Deuda hipotecaria que pesa sobre la vivienda habitual. Hace falta porque
  // `netWorth` ya viene neto de ella: sin este dato, una casa muy hipotecada
  // se descontaba dos veces —una al restar el préstamo del patrimonio y otra
  // al exentar la vivienda entera— y la cuota salía muy por debajo.
  primaryHomeDebt = 0,
  regionKey = 'estatal',
  exemption,
  bonificationPct,
  taxpayers = 1
} = {}) {
  const region = WEALTH_TAX_REGIONS[regionKey] || WEALTH_TAX_REGIONS.estatal;
  // Ojo con `null`: `Number(null)` es 0 y pasa por finito, así que sin
  // descartarlo antes un ajuste «vacío» se leía como «exento cero, bonificación
  // cero» y anulaba lo que dice la comunidad. Es el mismo tropiezo que con el
  // euríbor, y aquí habría hecho pagar a Madrid como si no bonificara.
  const dado = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const minimoExento = dado(exemption) ? Math.max(0, Number(exemption)) : region.exemption;
  const bonificacion = dado(bonificationPct)
    ? Math.min(100, Math.max(0, Number(bonificationPct)))
    : region.bonificationPct;

  // Cuántos declaran. Solo enteros y al menos uno: medio contribuyente no
  // existe, y un cero convertiría el reparto en una división por cero.
  const contribuyentes = Math.max(1, Math.round(Number(taxpayers) || 1));

  // El reparto se hace ANTES de exenciones y escala, que es donde está la
  // diferencia. La vivienda habitual también: cada cotitular exenta su parte,
  // hasta el tope por cabeza.
  const patrimonioPorPersona = (Number(netWorth) || 0) / contribuyentes;
  const viviendaPorPersona = Math.max(0, Number(primaryHomeValue) || 0) / contribuyentes;

  const viviendaExenta = Math.min(viviendaPorPersona, PRIMARY_HOME_EXEMPTION);

  // Art. 25.1 de la Ley 19/1991: las deudas contraídas para adquirir un bien
  // exento no se deducen, y si el bien está exento solo en parte, tampoco la
  // deuda en esa misma proporción. Como el patrimonio neto ya llega con la
  // hipoteca restada, hay que devolver a la base la parte no deducible.
  //
  // Con una vivienda de 400.000 € hipotecada por 350.000 y 1.200.000 € en
  // cartera, la cuota pasa de 583 € a 1.665 € al año: antes la casa salía
  // exenta por sus 300.000 € completos mientras su préstamo seguía restando
  // del patrimonio, que es contarlo dos veces.
  // Acotada por el valor de la propia vivienda: lo que se está deshaciendo es
  // un doble descuento de la casa, y ese doble descuento no puede ser mayor
  // que la casa. Sin el tope, repartir a prorrata una hipoteca enorme entre
  // varios inmuebles le colgaba a la vivienda una deuda de cientos de veces
  // su valor y la base se iba a las nubes.
  const deudaViviendaPorPersona = Math.min(
    Math.max(0, Number(primaryHomeDebt) || 0) / contribuyentes,
    viviendaPorPersona
  );
  const proporcionExenta = viviendaPorPersona > 0 ? viviendaExenta / viviendaPorPersona : 0;
  const deudaNoDeducible = Math.min(deudaViviendaPorPersona, deudaViviendaPorPersona * proporcionExenta);

  const patrimonioComputable = Math.max(0, patrimonioPorPersona - viviendaExenta + deudaNoDeducible);
  const base = Math.max(0, patrimonioComputable - minimoExento);

  const cuotaIntegra = cuotaPorEscala(base, STATE_WEALTH_TAX_BRACKETS);
  const cuotaAutonomica = cuotaIntegra * (1 - bonificacion / 100);

  // El impuesto de solidaridad no se bonifica: lo que ahorra la comunidad se
  // lo lleva el Estado a partir de tres millones. También es por contribuyente,
  // así que el umbral de los tres millones es el de cada uno.
  const cuotaSolidaridad = cuotaPorEscala(base, SOLIDARITY_TAX_BRACKETS);
  const aPagarPorPersona = Math.max(cuotaAutonomica, cuotaSolidaridad);
  const aPagar = aPagarPorPersona * contribuyentes;

  return {
    taxpayers: contribuyentes,
    // Las cifras por contribuyente: base, cuota y exenciones son de UNA
    // persona. Los totales del hogar llevan el sufijo del hogar.
    taxableBase: base,
    primaryHomeExempt: viviendaExenta,
    // La parte de la hipoteca de la vivienda que no se puede deducir.
    nonDeductibleHomeDebt: deudaNoDeducible,
    exemptionApplied: minimoExento,
    bonificationPct: bonificacion,
    grossQuota: cuotaIntegra,
    regionalQuota: cuotaAutonomica,
    solidarityQuota: cuotaSolidaridad,
    annualPerTaxpayer: aPagarPorPersona,
    taxableBaseTotal: base * contribuyentes,
    exemptionAppliedTotal: minimoExento * contribuyentes,
    primaryHomeExemptTotal: viviendaExenta * contribuyentes,
    nonDeductibleHomeDebtTotal: deudaNoDeducible * contribuyentes,
    // Cuando manda el de solidaridad es porque la bonificación autonómica se
    // ha quedado sin efecto; se informa para que se entienda de dónde sale.
    solidarityApplies: cuotaSolidaridad > cuotaAutonomica + 0.001,
    annual: aPagar,
    monthly: aPagar / 12,
    effectivePct: netWorth > 0 ? (aPagar / netWorth) * 100 : 0
  };
}
