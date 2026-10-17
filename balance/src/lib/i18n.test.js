import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TRANSLATIONS } from './i18n.js';

const es = TRANSLATIONS.es;
const en = TRANSLATIONS.en;

test('i18n: los dos idiomas tienen exactamente las mismas claves', () => {
  const soloEs = Object.keys(es).filter(k => !(k in en));
  const soloEn = Object.keys(en).filter(k => !(k in es));
  assert.deepEqual(soloEs, [], `claves solo en castellano: ${soloEs.join(', ')}`);
  assert.deepEqual(soloEn, [], `claves solo en inglés: ${soloEn.join(', ')}`);
  assert.equal(Object.keys(es).length, Object.keys(en).length);
});

test('i18n: ninguna cadena está vacía', () => {
  for (const [idioma, tabla] of [['es', es], ['en', en]]) {
    for (const [clave, valor] of Object.entries(tabla)) {
      assert.equal(typeof valor, 'string', `${idioma}.${clave} no es una cadena`);
      assert.ok(valor.trim().length > 0, `${idioma}.${clave} está vacía`);
    }
  }
});

test('i18n: los marcadores coinciden entre idiomas', () => {
  // Si una traducción se deja un {gap} por el camino, el texto sale incompleto
  // y no lo ve nadie hasta que alguien cambia de idioma.
  const marcadores = str => (str.match(/\{[a-zA-Z]+\}/g) || []).slice().sort();
  for (const clave of Object.keys(es)) {
    assert.deepEqual(marcadores(es[clave]), marcadores(en[clave]),
      `los marcadores de "${clave}" no coinciden: ${es[clave]} / ${en[clave]}`);
  }
});

test('i18n: no queda ninguna clave sin usar', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const otros = ['./assumptions.js', './audit.js', './engine.js', './finance.js']
    .map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const fuente = app + otros;

  // Algunas se leen por acceso dinámico y no aparecen literalmente.
  const dinamicos = ['exp_', 'audit_dim_', 'audit_na_', 'audit_read_', 'audit_do_', 'audit_penalty_', 'audit_good_', 'type_'];
  const muertas = Object.keys(es).filter(k =>
    !dinamicos.some(prefijo => k.startsWith(prefijo)) &&
    !new RegExp(`\\bt\\.${k}\\b`).test(fuente)
  );
  assert.deepEqual(muertas, [], `claves definidas y sin usar: ${muertas.join(', ')}`);
});

test('i18n: la interfaz no lleva textos sueltos fuera de la tabla', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const ternarios = (app.match(/lang === 'es' \?/g) || []).length;
  // Los que quedan son legítimos y están contados: dos códigos de idioma para
  // Intl, el orden del símbolo de moneda —dos veces, en la cifra completa y en
  // la abreviada de las tarjetas KPI— y el de la fecha, el propio selector de
  // idioma —qué bandera pinta y a cuál cambia, que no es texto— y tres listas
  // de datos que llevan sus propios campos _es/_en (países, comunidades, FAQ y
  // supuestos).
  assert.ok(ternarios <= 13,
    `hay ${ternarios} ternarios de idioma en App.jsx; los textos de interfaz van en i18n.js`);
});

test('i18n: cada mérito de la auditoría tiene su texto, y al revés', () => {
  // El prefijo audit_good_ se lee por acceso dinámico, así que la prueba de
  // claves muertas no lo vigila. Se contrasta aquí contra los identificadores
  // que el motor puede emitir de verdad, en los dos sentidos: una clave sin
  // mérito es texto muerto, y un mérito sin clave sale en blanco en pantalla.
  const fuente = readFileSync(new URL('./audit.js', import.meta.url), 'utf8');
  const emitidos = [...fuente.matchAll(/bien\('([a-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(emitidos.length >= 15, `esperaba más méritos, encontré ${emitidos.length}`);

  for (const id of emitidos) {
    assert.ok(`audit_good_${id}` in es, `falta el texto castellano de "${id}"`);
    assert.ok(`audit_good_${id}` in en, `falta el texto inglés de "${id}"`);
  }

  const claves = Object.keys(es)
    .filter(k => k.startsWith('audit_good_') && k !== 'audit_good_title')
    .map(k => k.replace('audit_good_', ''));
  const sobran = claves.filter(id => !emitidos.includes(id));
  assert.deepEqual(sobran, [], `textos de mérito que nadie emite: ${sobran.join(', ')}`);
});

test('i18n: cada penalización de la auditoría tiene su texto y su acción, y al revés', () => {
  // Los prefijos audit_penalty_ y audit_do_clear_ se leen por acceso dinámico,
  // así que la prueba de claves muertas no los vigila. Se contrastan aquí
  // contra los identificadores que el motor emite de verdad, en los dos
  // sentidos: sin texto la penalización sale en blanco en pantalla, y un texto
  // que nadie emite es peso muerto.
  const fuente = readFileSync(new URL('./audit.js', import.meta.url), 'utf8');
  const emitidas = [...fuente.matchAll(/penalties\.push\(\{\s*id:\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(emitidas.length >= 4, `esperaba más penalizaciones, encontré ${emitidas.length}`);

  for (const id of emitidas) {
    for (const [idioma, tabla] of [['es', es], ['en', en]]) {
      assert.ok(`audit_penalty_${id}` in tabla, `falta el texto ${idioma} de la penalización "${id}"`);
      assert.ok(`audit_do_clear_${id}` in tabla, `falta la acción ${idioma} de "${id}"`);
    }
  }

  const sobran = Object.keys(es)
    .filter(k => k.startsWith('audit_penalty_'))
    .map(k => k.replace('audit_penalty_', ''))
    .filter(id => !emitidas.includes(id));
  assert.deepEqual(sobran, [], `penalizaciones con texto que nadie emite: ${sobran.join(', ')}`);
});
