import test from 'node:test';
import assert from 'node:assert/strict';

import { COUNTRY_PRESETS, isPresetBasket } from './presets.js';

const cesta = clave => ({
  person_monthly: { ...COUNTRY_PRESETS[clave].person_monthly },
  household_monthly: { ...COUNTRY_PRESETS[clave].household_monthly },
  family_annual: { ...COUNTRY_PRESETS[clave].family_annual }
});

test('isPresetBasket: la cesta sin tocar se reconoce', () => {
  assert.equal(isPresetBasket(cesta('es_urban'), 'es_urban'), true);
});

test('isPresetBasket: un importe que viene como texto del almacenamiento sigue contando como igual', () => {
  const g = cesta('es_urban');
  g.person_monthly.food = '300';
  assert.equal(isPresetBasket(g, 'es_urban'), true);
});

test('isPresetBasket: un solo campo cambiado ya son gastos propios', () => {
  const g = cesta('es_urban');
  g.family_annual.vacations = 2999;
  assert.equal(isPresetBasket(g, 'es_urban'), false);
});

test('isPresetBasket: la cesta de otro país no cuenta como la del país elegido', () => {
  assert.equal(isPresetBasket(cesta('es_avg'), 'es_urban'), false);
});

test('isPresetBasket: un campo de más o de menos cuenta como tocado', () => {
  const sobra = cesta('es_urban');
  sobra.household_monthly.extra = 0;
  assert.equal(isPresetBasket(sobra, 'es_urban'), false);
  const falta = cesta('es_urban');
  delete falta.person_monthly.food;
  assert.equal(isPresetBasket(falta, 'es_urban'), false);
});

test('isPresetBasket: sin gastos o con un país desconocido, no hay cesta que reconocer', () => {
  assert.equal(isPresetBasket(null, 'es_urban'), false);
  assert.equal(isPresetBasket(cesta('es_urban'), 'marte'), false);
});
