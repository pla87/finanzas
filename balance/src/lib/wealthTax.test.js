import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wealthTaxDue, WEALTH_TAX_REGIONS, WEALTH_TAX_AS_OF,
  STATE_WEALTH_TAX_BRACKETS, SOLIDARITY_TAX_BRACKETS, PRIMARY_HOME_EXEMPTION
} from './wealthTax.js';

test('patrimonio: un balance corriente no paga nada', () => {
  const r = wealthTaxDue({ netWorth: 450000, primaryHomeValue: 250000, regionKey: 'estatal' });
  assert.equal(r.annual, 0);
  assert.equal(r.monthly, 0);
  assert.equal(r.taxableBase, 0);
});

test('patrimonio: la vivienda habitual está exenta hasta su tope', () => {
  // 300.000 exentos de la casa + 700.000 de mínimo exento = 1.000.000 libre.
  const justo = wealthTaxDue({ netWorth: 1000000, primaryHomeValue: 300000, regionKey: 'estatal' });
  assert.equal(justo.primaryHomeExempt, PRIMARY_HOME_EXEMPTION);
  assert.equal(justo.taxableBase, 0);
  // Una casa más cara no exime más de la cuenta.
  const casona = wealthTaxDue({ netWorth: 1000000, primaryHomeValue: 800000, regionKey: 'estatal' });
  assert.equal(casona.primaryHomeExempt, PRIMARY_HOME_EXEMPTION);
});

test('patrimonio: por encima del mínimo exento se tributa por tramos', () => {
  const r = wealthTaxDue({ netWorth: 1200000, primaryHomeValue: 0, regionKey: 'estatal' });
  assert.equal(r.taxableBase, 500000);
  // 167.129,45 al 0,2% + 167.123,43 al 0,3% + el resto al 0,5%.
  const esperado = 167129.45 * 0.002
    + (334252.88 - 167129.45) * 0.003
    + (500000 - 334252.88) * 0.005;
  assert.ok(Math.abs(r.annual - esperado) < 0.01, `${r.annual} frente a ${esperado}`);
  assert.ok(Math.abs(r.monthly - r.annual / 12) < 0.001);
});

test('patrimonio: la comunidad cambia lo que se paga', () => {
  const args = { netWorth: 2400000, primaryHomeValue: 400000 };
  const estatal = wealthTaxDue({ ...args, regionKey: 'estatal' });
  const madrid = wealthTaxDue({ ...args, regionKey: 'madrid' });
  const cataluna = wealthTaxDue({ ...args, regionKey: 'cataluna' });

  assert.ok(estatal.annual > 0);
  assert.equal(madrid.annual, 0, 'Madrid bonifica al 100% por debajo de tres millones');
  // Cataluña tiene menos mínimo exento, así que paga más que el régimen estatal.
  assert.ok(cataluna.annual > estatal.annual, `${cataluna.annual} debería superar a ${estatal.annual}`);
});

test('patrimonio: el impuesto de solidaridad no se puede bonificar', () => {
  const madrid = wealthTaxDue({ netWorth: 6000000, primaryHomeValue: 300000, regionKey: 'madrid' });
  assert.ok(madrid.annual > 0, 'bonificar al 100% no deja a cero una fortuna grande');
  assert.equal(madrid.solidarityApplies, true);
  assert.equal(madrid.regionalQuota, 0, 'la cuota autonómica sí queda bonificada');
  assert.ok(Math.abs(madrid.annual - madrid.solidarityQuota) < 0.01, 'lo que se paga es la de solidaridad');
});

test('patrimonio: por debajo de tres millones la solidaridad no entra', () => {
  const r = wealthTaxDue({ netWorth: 3000000, primaryHomeValue: 300000, regionKey: 'madrid' });
  assert.equal(r.solidarityQuota, 0);
  assert.equal(r.annual, 0);
});

test('patrimonio: doblar el mínimo exento baja la cuota, como con dos contribuyentes', () => {
  const uno = wealthTaxDue({ netWorth: 2000000, primaryHomeValue: 0, regionKey: 'estatal' });
  const dos = wealthTaxDue({ netWorth: 2000000, primaryHomeValue: 0, regionKey: 'estatal', exemption: 1400000 });
  assert.ok(dos.annual < uno.annual);
  assert.equal(dos.exemptionApplied, 1400000);
});

test('patrimonio: un ajuste vacío no anula lo que dice la comunidad', () => {
  // `Number(null)` es 0 y pasa por finito: sin descartarlo, Madrid habría
  // pagado como si no bonificara nada.
  const conNulos = wealthTaxDue({ netWorth: 2400000, primaryHomeValue: 0, regionKey: 'madrid', exemption: null, bonificationPct: null });
  assert.equal(conNulos.bonificationPct, 100);
  assert.equal(conNulos.exemptionApplied, WEALTH_TAX_REGIONS.madrid.exemption);
  assert.equal(conNulos.annual, 0);

  for (const vacio of [undefined, '', NaN]) {
    const r = wealthTaxDue({ netWorth: 2400000, primaryHomeValue: 0, regionKey: 'madrid', bonificationPct: vacio });
    assert.equal(r.bonificationPct, 100, `bonificación con ${String(vacio)}`);
  }
  // Pero un 0 escrito a propósito sí manda.
  const sinBonificar = wealthTaxDue({ netWorth: 2400000, primaryHomeValue: 0, regionKey: 'madrid', bonificationPct: 0 });
  assert.ok(sinBonificar.annual > 0);
});

test('patrimonio: una comunidad desconocida cae en el régimen estatal', () => {
  const inventada = wealthTaxDue({ netWorth: 2000000, primaryHomeValue: 0, regionKey: 'atlantida' });
  const estatal = wealthTaxDue({ netWorth: 2000000, primaryHomeValue: 0, regionKey: 'estatal' });
  assert.equal(inventada.annual, estatal.annual);
});

test('patrimonio: las escalas están ordenadas y llevan fecha', () => {
  for (const escala of [STATE_WEALTH_TAX_BRACKETS, SOLIDARITY_TAX_BRACKETS]) {
    let previo = 0;
    for (const b of escala) { assert.ok(b.upTo > previo); previo = b.upTo; }
    assert.equal(escala[escala.length - 1].upTo, Infinity);
  }
  // La fecha se enseña en Variables y en los supuestos: sin ella, nadie sabe
  // a qué año corresponden las bonificaciones autonómicas.
  assert.match(WEALTH_TAX_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
});

test('patrimonio: todas las comunidades listadas están completas', () => {
  for (const [clave, r] of Object.entries(WEALTH_TAX_REGIONS)) {
    assert.ok(r.name_es && r.name_en, `${clave} sin nombre`);
    assert.ok(Number.isFinite(r.exemption) && r.exemption >= 0, `${clave} sin mínimo exento`);
    assert.ok(r.bonificationPct >= 0 && r.bonificationPct <= 100, `${clave} con bonificación fuera de rango`);
  }
});

// --- POR CONTRIBUYENTE ---
// El impuesto no es del hogar, es de cada uno. Repartirlo no solo dobla el
// mínimo exento: manda cada mitad a los tramos bajos de la escala, que es de
// donde sale la mayor parte del ahorro.

test('repartir entre dos sale más barato que doblar el mínimo exento a mano', () => {
  const uno = wealthTaxDue({ netWorth: 3000000, primaryHomeValue: 0, regionKey: 'estatal' });
  const dobleExento = wealthTaxDue({ netWorth: 3000000, primaryHomeValue: 0, regionKey: 'estatal', exemption: 1400000 });
  const dos = wealthTaxDue({ netWorth: 3000000, primaryHomeValue: 0, regionKey: 'estatal', taxpayers: 2 });

  assert.ok(dos.annual < dobleExento.annual,
    `repartir (${dos.annual}) debe salir por debajo de doblar el exento (${dobleExento.annual})`);
  assert.ok(dobleExento.annual < uno.annual);
  assert.equal(dos.taxpayers, 2);
  // La cuota del hogar es la de una persona multiplicada por dos.
  assert.ok(Math.abs(dos.annual - dos.annualPerTaxpayer * 2) < 1e-6);
});

test('la base y el mínimo exento que se devuelven son por contribuyente', () => {
  const r = wealthTaxDue({ netWorth: 2400000, primaryHomeValue: 0, regionKey: 'estatal', taxpayers: 2 });
  // 1.200.000 cada uno menos 700.000 de mínimo exento.
  assert.ok(Math.abs(r.taxableBase - 500000) < 1e-6);
  assert.ok(Math.abs(r.taxableBaseTotal - 1000000) < 1e-6);
  assert.ok(Math.abs(r.exemptionAppliedTotal - 1400000) < 1e-6);
});

test('la vivienda habitual se exenta por cotitular, hasta el tope de cada uno', () => {
  // Un piso de 600.000 a medias: cada uno exenta 300.000, el tope por cabeza.
  const dos = wealthTaxDue({ netWorth: 2000000, primaryHomeValue: 600000, regionKey: 'estatal', taxpayers: 2 });
  assert.ok(Math.abs(dos.primaryHomeExempt - 300000) < 1e-6);
  assert.ok(Math.abs(dos.primaryHomeExemptTotal - 600000) < 1e-6);
  // A nombre de uno solo, la exención se corta en 300.000 y no en 600.000.
  const uno = wealthTaxDue({ netWorth: 2000000, primaryHomeValue: 600000, regionKey: 'estatal' });
  assert.ok(Math.abs(uno.primaryHomeExempt - 300000) < 1e-6);
  assert.ok(uno.annual > dos.annual);
});

test('el umbral de solidaridad también es de cada uno', () => {
  // 5 millones a medias son 2,5 por cabeza: por debajo de los tres millones,
  // así que en Madrid no queda nada que pagar.
  const dos = wealthTaxDue({ netWorth: 5000000, primaryHomeValue: 0, regionKey: 'madrid', taxpayers: 2 });
  assert.equal(dos.annual, 0);
  // A nombre de uno, el de solidaridad entra y la bonificación no lo evita.
  const uno = wealthTaxDue({ netWorth: 5000000, primaryHomeValue: 0, regionKey: 'madrid' });
  assert.ok(uno.annual > 0);
  assert.equal(uno.solidarityApplies, true);
});

test('un número de contribuyentes absurdo no rompe nada', () => {
  const base = wealthTaxDue({ netWorth: 2000000, regionKey: 'estatal' });
  for (const raro of [0, -3, null, undefined, '', NaN, 1.4]) {
    const r = wealthTaxDue({ netWorth: 2000000, regionKey: 'estatal', taxpayers: raro });
    assert.equal(r.taxpayers, 1, `taxpayers=${String(raro)} debe caer a 1`);
    assert.ok(Math.abs(r.annual - base.annual) < 1e-9);
    assert.ok(Number.isFinite(r.annual));
  }
  // 2,6 redondea a 3, no se trunca.
  assert.equal(wealthTaxDue({ netWorth: 2000000, taxpayers: 2.6 }).taxpayers, 3);
});

test('la hipoteca de la vivienda no se deduce en la parte exenta', () => {
  // Art. 25.1 de la Ley 19/1991. El patrimonio neto ya llega con la hipoteca
  // restada, así que exentar además la vivienda entera la descontaba dos
  // veces. Casa de 400.000 hipotecada por 350.000 y 1.200.000 en cartera:
  // patrimonio neto 1.250.000, de los que 300.000 de vivienda quedan exentos
  // y el 75% de la hipoteca (262.500) vuelve a la base.
  const r = wealthTaxDue({ netWorth: 1250000, primaryHomeValue: 400000, primaryHomeDebt: 350000, regionKey: 'estatal' });
  assert.equal(Math.round(r.taxableBase), 512500);
  assert.equal(Math.round(r.nonDeductibleHomeDebt), 262500);

  // Sin el dato de la hipoteca sale lo de antes, que era menos de la mitad.
  const antes = wealthTaxDue({ netWorth: 1250000, primaryHomeValue: 400000, regionKey: 'estatal' });
  assert.equal(Math.round(antes.taxableBase), 250000);
  assert.ok(r.annual > antes.annual * 2);
});

test('una vivienda entera por debajo del tope: su hipoteca no se deduce nada', () => {
  // Casa de 250.000 con 200.000 de hipoteca y 1.000.000 en cartera. La casa
  // está exenta al completo, así que su préstamo no es deducible en absoluto:
  // patrimonio bruto 1.250.000 − 250.000 exentos − 700.000 de mínimo = 300.000.
  const r = wealthTaxDue({ netWorth: 1050000, primaryHomeValue: 250000, primaryHomeDebt: 200000, regionKey: 'estatal' });
  assert.equal(Math.round(r.taxableBase), 300000);
  assert.equal(Math.round(r.nonDeductibleHomeDebt), 200000);
});

test('una vivienda sin hipoteca no cambia respecto a antes', () => {
  const con = wealthTaxDue({ netWorth: 1600000, primaryHomeValue: 400000, primaryHomeDebt: 0, regionKey: 'estatal' });
  const sin = wealthTaxDue({ netWorth: 1600000, primaryHomeValue: 400000, regionKey: 'estatal' });
  assert.equal(con.taxableBase, sin.taxableBase);
  assert.equal(Math.round(con.taxableBase), 600000);
});

test('la deuda de la vivienda también se reparte entre contribuyentes', () => {
  const uno = wealthTaxDue({ netWorth: 2500000, primaryHomeValue: 800000, primaryHomeDebt: 700000, regionKey: 'estatal', taxpayers: 1 });
  const dos = wealthTaxDue({ netWorth: 2500000, primaryHomeValue: 800000, primaryHomeDebt: 700000, regionKey: 'estatal', taxpayers: 2 });

  // Las cifras del objeto son de UNA persona; el total del hogar es su suma.
  assert.equal(Math.round(dos.nonDeductibleHomeDebtTotal), Math.round(dos.nonDeductibleHomeDebt * 2));
  // Cada uno exenta su mitad de vivienda, hasta el tope por cabeza.
  assert.equal(Math.round(dos.primaryHomeExempt), 300000);
  // Y repartir sigue sin poder salir más caro que declarar de uno solo.
  assert.ok(dos.annual <= uno.annual + 1e-6);
});

test('una deuda de vivienda absurda no puede inflar la base', () => {
  // Más hipoteca que casa: la parte no deducible nunca pasa de la deuda.
  const r = wealthTaxDue({ netWorth: 900000, primaryHomeValue: 200000, primaryHomeDebt: 500000, regionKey: 'estatal' });
  assert.ok(r.nonDeductibleHomeDebt <= 500000);
  assert.ok(r.taxableBase >= 0);
  assert.ok(Number.isFinite(r.annual) && r.annual >= 0);
});

test('la deuda atribuida a la vivienda nunca pasa de lo que vale la vivienda', () => {
  // Lo encontró el barrido aleatorio: cuando la hipoteca se reparte a prorrata
  // entre varios inmuebles, una deuda enorme le colgaba a la vivienda mucho
  // más de lo que vale y la base se iba a las nubes. Lo que se está
  // deshaciendo es un doble descuento de la casa, y no puede ser mayor que la
  // casa.
  const r = wealthTaxDue({ netWorth: 1782503, primaryHomeValue: 532090, primaryHomeDebt: 420962448, regionKey: 'estatal' });
  assert.ok(r.nonDeductibleHomeDebt <= 532090, `no deducible ${r.nonDeductibleHomeDebt}`);
  assert.ok(r.annual < 1782503, 'la cuota no puede llevarse el patrimonio entero');
  // Con la vivienda exenta por su tope, la base queda en el patrimonio menos
  // el mínimo exento: el doble descuento se ha deshecho exactamente.
  assert.equal(Math.round(r.taxableBase), 1782503 - 700000);
});
