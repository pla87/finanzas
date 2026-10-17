import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAssumptions } from './assumptions.js';
import { DEFAULT_MACRO_PARAMS, SAVINGS_TAX_BRACKETS } from './finance.js';

const fmtEs = (v, d = 2) => new Intl.NumberFormat('es-ES', {
  useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: d
}).format(Number(v) || 0);

test('supuestos: hay una sección por cada pieza del motor', () => {
  const secciones = buildAssumptions({ macroParams: DEFAULT_MACRO_PARAMS });
  const ids = secciones.map(s => s.id);
  for (const esperado of ['premisa', 'divisa', 'inflacion', 'bolsa', 'caja', 'inmuebles',
                          'pensiones', 'muebles', 'ahorro', 'deuda', 'runway', 'cobertura',
                          'fire', 'liquidacion', 'datos']) {
    assert.ok(ids.includes(esperado), `falta la sección ${esperado}`);
  }
  assert.equal(new Set(ids).size, ids.length, 'los identificadores no se repiten');
});

test('supuestos: los dos idiomas están completos', () => {
  for (const s of buildAssumptions({ macroParams: DEFAULT_MACRO_PARAMS })) {
    for (const campo of ['title_es', 'title_en', 'body_es', 'body_en']) {
      assert.ok(s[campo] && s[campo].trim().length > 0, `${s.id} sin ${campo}`);
    }
    assert.ok(s.body_es.length > 80, `${s.id}: el texto en castellano se queda corto`);
    assert.ok(s.body_en.length > 80, `${s.id}: el texto en inglés se queda corto`);
  }
});

test('supuestos: el texto lleva los valores en vigor, no los de por defecto', () => {
  const secciones = buildAssumptions({
    macroParams: { ...DEFAULT_MACRO_PARAMS, inflationPct: 7.5, realEstateAppreciationPct: 0.5 },
    formatNumber: fmtEs
  });
  const inflacion = secciones.find(s => s.id === 'inflacion');
  const inmuebles = secciones.find(s => s.id === 'inmuebles');
  assert.ok(inflacion.body_es.includes('7,5'), inflacion.body_es);
  assert.ok(inmuebles.body_es.includes('0,5'), inmuebles.body_es);
  assert.ok(!inflacion.body_es.includes('2 %'), 'no debe colarse el valor por defecto');
});

test('supuestos: el separador decimal sigue al idioma', () => {
  const conFormato = buildAssumptions({
    macroParams: DEFAULT_MACRO_PARAMS,
    euribor: { ratePct: 2.954, period: '2026-08' },
    formatNumber: fmtEs
  }).find(s => s.id === 'deuda');
  assert.ok(conFormato.body_es.includes('2,954'), 'en castellano la coma decimal');
  assert.ok(!conFormato.body_es.includes('2.954 %'), 'un punto se leería como millares');
});

test('supuestos: la escala del ahorro se lista entera y sale del código, no de una copia', () => {
  const ahorro = buildAssumptions({ macroParams: DEFAULT_MACRO_PARAMS, formatNumber: fmtEs })
    .find(s => s.id === 'ahorro');
  for (const b of SAVINGS_TAX_BRACKETS) {
    assert.ok(ahorro.body_es.includes(`${b.ratePct} %`), `falta el tramo al ${b.ratePct}%`);
  }
  assert.ok(ahorro.body_es.includes('del resto'), 'el último tramo se nombra aparte');
});

test('supuestos: sin euríbor descargado se dice, en vez de callarlo', () => {
  const sin = buildAssumptions({ macroParams: DEFAULT_MACRO_PARAMS }).find(s => s.id === 'deuda');
  assert.ok(/no hay euríbor descargado/i.test(sin.body_es));
  assert.ok(/No Euribor has been downloaded/i.test(sin.body_en));

  const con = buildAssumptions({
    macroParams: DEFAULT_MACRO_PARAMS, euribor: { ratePct: 2.954, period: '2026-08' }, formatNumber: fmtEs
  }).find(s => s.id === 'deuda');
  assert.ok(con.body_es.includes('2026-08'));
});

test('supuestos: un euríbor no refrescado se advierte', () => {
  const s = buildAssumptions({
    macroParams: DEFAULT_MACRO_PARAMS,
    euribor: { ratePct: 2.954, period: '2026-08', stale: true }, formatNumber: fmtEs
  }).find(x => x.id === 'deuda');
  assert.ok(/no refrescado/i.test(s.body_es));
  assert.ok(/not refreshed/i.test(s.body_en));
});

test('supuestos: el tipo medio del ahorro refleja el balance real', () => {
  const conRenta = buildAssumptions({
    macroParams: DEFAULT_MACRO_PARAMS,
    calculations: { grossSavingsIncome: 18000, effectiveSavingsRatePct: 19.8 }, formatNumber: fmtEs
  }).find(s => s.id === 'ahorro');
  assert.ok(conRenta.body_es.includes('19,8'), conRenta.body_es);

  const sinRenta = buildAssumptions({ macroParams: DEFAULT_MACRO_PARAMS, formatNumber: fmtEs })
    .find(s => s.id === 'ahorro');
  assert.ok(/no genera dividendos ni intereses/i.test(sinRenta.body_es));
});

test('supuestos: la parte neta del plan de pensiones cuadra con su impuesto', () => {
  const s = buildAssumptions({
    macroParams: { ...DEFAULT_MACRO_PARAMS, pensionWithdrawalTaxPct: 40 }, formatNumber: fmtEs
  }).find(x => x.id === 'pensiones');
  assert.ok(s.body_es.includes('60 %'), 'si el impuesto es del 40%, queda el 60%');
  assert.ok(s.body_es.includes('40 %'));
});

test('supuestos: sin argumentos no revienta', () => {
  const secciones = buildAssumptions();
  assert.ok(secciones.length > 10);
  assert.ok(secciones.every(s => s.body_es && s.body_en));
});
