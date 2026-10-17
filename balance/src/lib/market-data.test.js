// --- LOS DATOS DE MERCADO QUE SE PUBLICAN ---
//
// `public/market_data.json` lo reescribe un bot de lunes a viernes y su commit
// a main provoca, de rebote, un despliegue. De ahí salen los tipos de cambio,
// las cotizaciones del selector y el euríbor de las hipotecas variables, o sea
// que un fichero mal formado no rompe la compilación: rompe las cifras, que es
// peor porque no se nota.
//
// Esto comprueba su FORMA, no su contenido: los precios cambian cada día y no
// hay nada que comparar contra ellos. Lo que no puede cambiar es que estén
// todas las divisas, que un precio sea un número positivo o que el euríbor
// tenga cara de euríbor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ALL_SUPPORTED_CURRENCIES, STOCK_MARKETS, DEFAULT_EXCHANGE_RATES } from './constants.js';

const datos = JSON.parse(readFileSync(new URL('../../public/market_data.json', import.meta.url), 'utf8'));

const finitoPositivo = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

test('datos de mercado: el fichero trae lo que la aplicación busca', () => {
  for (const clave of ['generatedAt', 'rates', 'tickers', 'euribor', 'staleRates', 'staleTickers']) {
    assert.ok(clave in datos, `falta "${clave}"`);
  }
  assert.ok(!Number.isNaN(Date.parse(datos.generatedAt)), `generatedAt no es una fecha: ${datos.generatedAt}`);
  // Las marcas de rancio no fallan la prueba: una descarga caída es una
  // situación prevista y la interfaz la enseña. Solo tienen que ser listas.
  assert.ok(Array.isArray(datos.staleRates) && Array.isArray(datos.staleTickers));
});

test('datos de mercado: están todas las divisas que la aplicación ofrece', () => {
  // `data.rates` se fusiona sobre los valores por defecto, así que una divisa
  // que falte no deja un hueco: se queda con un tipo congelado que parece
  // fresco. Por eso tienen que estar todas.
  for (const { code } of ALL_SUPPORTED_CURRENCIES) {
    assert.ok(finitoPositivo(datos.rates[code]), `el tipo de ${code} es ${datos.rates[code]}`);
  }
  assert.equal(datos.rates.EUR, 1, 'todos los tipos van con el euro como base');
});

test('datos de mercado: el bot no publica divisas que la aplicación no ofrece', () => {
  // Son las siete de Retiro. Una de más es una descarga que nadie lee y un
  // punto más por el que el trabajo puede fallar.
  const ofrecidas = new Set(ALL_SUPPORTED_CURRENCIES.map(c => c.code));
  for (const divisa of Object.keys(datos.rates)) {
    assert.ok(ofrecidas.has(divisa), `el fichero trae ${divisa}, que la aplicación no ofrece`);
  }
});

test('datos de mercado: ningún tipo de cambio se ha ido de madre', () => {
  // Banda anchísima a propósito: una divisa no se mueve cuatro veces en la
  // vida de esta herramienta, pero un error de unidad —el yen a 1,78 en vez de
  // a 178— salta enseguida. Es el fallo que de verdad puede colarse.
  for (const [divisa, referencia] of Object.entries(DEFAULT_EXCHANGE_RATES)) {
    const hoy = datos.rates[divisa];
    if (!finitoPositivo(hoy)) continue;   // ya lo cubre la prueba de arriba
    const factor = hoy / referencia;
    assert.ok(factor > 0.25 && factor < 4,
      `${divisa} está a ${hoy} y la referencia es ${referencia}: ${factor.toFixed(2)} veces`);
  }
});

test('datos de mercado: están todos los mercados del selector', () => {
  // `data.tickers` SUSTITUYE la base entera, no la fusiona: un mercado que
  // falte deja su desplegable vacío.
  for (const { id } of STOCK_MARKETS) {
    if (id === 'OTRO') continue;   // el mercado a mano no tiene cotizaciones
    assert.ok(Array.isArray(datos.tickers[id]) && datos.tickers[id].length > 0,
      `el mercado ${id} viene vacío o no viene`);
  }
});

test('datos de mercado: cada cotización es usable', () => {
  const porMercado = Object.fromEntries(STOCK_MARKETS.map(m => [m.id, m.currency]));

  for (const [mercado, lista] of Object.entries(datos.tickers)) {
    for (const q of lista) {
      const dónde = `${mercado}/${q.ticker || '(sin ticker)'}`;
      assert.ok(typeof q.ticker === 'string' && q.ticker.trim(), `${dónde}: sin ticker`);
      assert.ok(finitoPositivo(q.price), `${dónde}: precio ${q.price}`);
      assert.ok(typeof q.currency === 'string' && q.currency.trim(), `${dónde}: sin divisa`);

      // El dividendo entra directo como rendimiento del activo al refrescar.
      // Un 100% ya no es un dividendo, es una unidad equivocada.
      if (q.divYield !== undefined && q.divYield !== null) {
        assert.ok(Number.isFinite(q.divYield) && q.divYield >= 0 && q.divYield <= 100,
          `${dónde}: dividendo ${q.divYield}`);
      }

      // La divisa de una cotización tiene que ser la del mercado, o su unidad
      // menor: el LSE cotiza en peniques (GBp) y normalizeCurrencyAmount lo
      // convierte. Cualquier otra cosa entraría sin convertir.
      const esperada = porMercado[mercado];
      if (esperada) {
        const menor = esperada === 'GBP' ? 'GBp' : esperada === 'ZAR' ? 'ZAc' : esperada === 'ILS' ? 'ILA' : null;
        assert.ok(q.currency === esperada || q.currency === menor,
          `${dónde}: cotiza en ${q.currency} y el mercado es ${esperada}`);
      }
    }
  }
});

test('datos de mercado: el euríbor tiene cara de euríbor', () => {
  const e = datos.euribor;
  assert.ok(e && typeof e === 'object', 'no viene el euríbor');
  assert.ok(Number.isFinite(e.ratePct), `ratePct es ${e.ratePct}`);
  // Ha estado en -0,5% y en 5,4%. Fuera de esa horquilla larga hay un error.
  assert.ok(e.ratePct > -2 && e.ratePct < 15, `un euríbor del ${e.ratePct}% no es un euríbor`);
  assert.match(String(e.period), /^\d{4}-\d{2}$/, `el periodo es ${e.period}`);
  assert.equal(typeof e.stale, 'boolean');
});
