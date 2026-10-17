// Segunda barrera, después de que update-rates.mjs haya reescrito el bloque: comprueba que lo que
// ha quedado en index.html es JavaScript válido y que los valores tienen sentido. Es barato y
// corre en el workflow antes de comprometer nada, porque el fallo que hay que evitar -dejar
// index.html roto o con un tipo absurdo en main- no lo notaría nadie hasta que alguien abriera la
// página. También sirve suelto: `node scripts/check-rates-block.mjs`.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fallos = [];

// 1. Todo el JavaScript en línea de la página sigue compilando. Si la reescritura hubiera dejado
//    una llave suelta, la página entera se queda en blanco.
let bloques = 0;
//    Los datos estructurados (application/ld+json) no son JavaScript: se comprueba que sean JSON.
let datos = 0;
for (const m of html.matchAll(/<script(?![^>]*src=)([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/type="application\/ld\+json"/.test(m[1])) {
    datos++;
    try { JSON.parse(m[2]); }
    catch (err) { fallos.push(`los datos estructurados nº ${datos} no son JSON válido: ${err.message}`); }
    continue;
  }
  bloques++;
  try { new Function(m[2]); }
  catch (err) { fallos.push(`el bloque <script> nº ${bloques} no compila: ${err.message}`); }
}
if (bloques === 0) fallos.push('no he encontrado ningún <script> en línea: algo va muy mal');

// 2. El bloque automático está, y sus valores se pueden leer.
const ini = html.indexOf('// <tipos-automaticos>');
const fin = html.indexOf('// </tipos-automaticos>');
if (ini < 0 || fin < 0 || fin < ini) {
  fallos.push('falta el bloque <tipos-automaticos> o está del revés');
} else {
  const bloque = html.slice(ini, fin);
  let leido = null;
  try {
    leido = new Function(`${bloque.replace(/^\s*\/\/.*$/gm, '')}
      return { RATES_UPDATED, DEFAULT_EXCHANGE_RATES, DEFAULT_GOLD_EUR_PER_GRAM, DEFAULT_EURIBOR_12M_PCT, EURIBOR_PERIOD };`)();
  } catch (err) {
    fallos.push(`el bloque no se puede evaluar: ${err.message}`);
  }

  if (leido) {
    const { RATES_UPDATED, DEFAULT_EXCHANGE_RATES: fx, DEFAULT_GOLD_EUR_PER_GRAM: oro } = leido;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(RATES_UPDATED))) {
      fallos.push(`la fecha "${RATES_UPDATED}" no tiene forma de AAAA-MM-DD`);
    } else if (new Date(RATES_UPDATED + 'T00:00:00Z') > new Date(Date.now() + 86400000)) {
      fallos.push(`la fecha ${RATES_UPDATED} está en el futuro`);
    }

    if (Number(fx && fx.EUR) !== 1) {
      fallos.push(`el euro tiene que valer exactamente 1 y vale ${fx && fx.EUR}: la base del resto depende de eso`);
    }
    for (const div of ['USD', 'GBP', 'CHF', 'JPY', 'PHP', 'HKD']) {
      const v = Number(fx && fx[div]);
      if (!Number.isFinite(v) || v <= 0) fallos.push(`${div} vale ${fx && fx[div]}`);
    }

    if (!(Number(oro) > 0)) fallos.push(`el precio del oro vale ${oro}`);

    // El euríbor puede ser negativo, pero no de cualquier cosa: ha ido de -0,5 % a 5,4 %.
    const e = Number(leido.DEFAULT_EURIBOR_12M_PCT);
    if (!Number.isFinite(e) || e < -2 || e > 20) fallos.push(`el euríbor vale ${leido.DEFAULT_EURIBOR_12M_PCT}`);
    if (!/^\d{4}-\d{2}$/.test(String(leido.EURIBOR_PERIOD))) fallos.push(`el mes del euríbor "${leido.EURIBOR_PERIOD}" no tiene forma de AAAA-MM`);
  }
}

if (fallos.length) {
  console.error('✗ index.html no pasa la comprobación:');
  fallos.forEach(f => console.error(`  · ${f}`));
  process.exit(1);
}
console.log(`✓ ${bloques} bloques de script compilan y el bloque de tipos es coherente`);
