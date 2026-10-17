// Reescribe el bloque <tipos-automaticos> de index.html con los tipos de cambio, el precio del
// oro y el euríbor a 12 meses de hoy. Lo ejecuta .github/workflows/retiro-tipos.yml una vez por semana; también se puede correr
// a mano con `node scripts/update-rates.mjs` (o con --dry para ver qué saldría sin tocar nada).
//
// Por qué existe: la página pedía los dos datos en vivo desde el navegador de cada visitante. Eso
// depende de que dos servicios ajenos contesten, con CORS, desde todas partes, y cuando no
// contestan la página caía sobre unas constantes escritas a mano sin fecha: nadie sabía si eran
// de hace un mes o de hace dos años. Ahora el valor de partida se refresca solo y viaja en el
// fichero, así que la página es correcta aunque el servicio en vivo no conteste nunca.
//
// El listón para escribir es alto a propósito: un tipo de cambio malo cometido a main corrompe en
// silencio cualquier posición en divisa de cualquiera que abra la página. Ante cualquier duda
// -formato raro, valor imposible, salto grande frente a lo que ya hay- no escribe y sale con
// error para que el workflow se ponga en rojo.
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');

const ABRE = '    // <tipos-automaticos>';
const CIERRA = '    // </tipos-automaticos>';
const TROY_OUNCE_GRAMS = 31.1034768;
// Las mismas divisas que ofrece la aplicación. El euro es la base y siempre vale 1.
const DIVISAS = ['USD', 'GBP', 'CHF', 'JPY', 'PHP', 'HKD'];
// Un tipo nuevo no puede alejarse más de esto del que ya está comprometido. Entre dos ejecuciones
// semanales ninguna divisa normal se mueve tanto: un salto mayor significa que la API ha cambiado
// de base, ha devuelto el inverso o está rota.
const SALTO_MAXIMO = 0.40;
// Banda de cordura del oro en euros por gramo. Es ancha porque el valor de partida comprometido
// es un marcador, no un precio real, así que aquí no sirve una comprobación relativa.
const ORO_MIN = 20, ORO_MAX = 1000;
// El euríbor a 12 meses, del portal de datos del BCE: no pide clave y responde SDMX-JSON. Es la
// misma fuente que usa pacolucena.com/balance, para que las dos herramientas den la misma cuota
// a la misma hipoteca variable. Ha estado en negativo y ha pasado del 5 %, pero no de esto.
const EURIBOR_URL = 'https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA?lastNObservations=1&format=jsondata';
const EURIBOR_MIN = -2, EURIBOR_MAX = 20;
// Se publica una vez al mes: de una semana a otra no se mueve un punto y medio.
const EURIBOR_SALTO_MAXIMO = 1.5;

const morir = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

async function traer(url, queEs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'accept': 'application/json' } });
    if (!res.ok) morir(`${queEs}: el servicio respondió ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    morir(`${queEs}: no se pudo leer (${err && err.message || err})`);
  } finally { clearTimeout(t); }
}

// --- lo que ya hay comprometido, que es contra lo que se compara ------------------------------
const html = readFileSync(INDEX, 'utf8');
const iAbre = html.indexOf(ABRE);
const iCierra = html.indexOf(CIERRA);
if (iAbre < 0 || iCierra < 0 || iCierra < iAbre) {
  morir('no encuentro el bloque <tipos-automaticos> en index.html: ¿se ha renombrado o borrado?');
}
const bloqueActual = html.slice(iAbre, iCierra + CIERRA.length);
const leerActual = (div) => {
  const m = bloqueActual.match(new RegExp(`${div}:\\s*([0-9.]+)`));
  return m ? Number(m[1]) : null;
};
const euriborActual = (() => {
  const v = bloqueActual.match(/DEFAULT_EURIBOR_12M_PCT = (-?[0-9.]+);/);
  const p = bloqueActual.match(/EURIBOR_PERIOD = '([0-9-]+)';/);
  return v ? { pct: Number(v[1]), periodo: p ? p[1] : null } : null;
})();

// --- tipos de cambio ---------------------------------------------------------------------------
const fx = await traer('https://open.er-api.com/v6/latest/EUR', 'tipos de cambio');
if (!fx || typeof fx !== 'object' || !fx.rates || typeof fx.rates !== 'object') {
  morir('tipos de cambio: la respuesta no trae un objeto `rates`; la API ha cambiado de forma');
}
if (Number(fx.rates.EUR) !== 1) {
  morir(`tipos de cambio: la base no es el euro (EUR vale ${fx.rates.EUR}), así que el resto no significa lo que creemos`);
}

const tipos = {};
for (const div of DIVISAS) {
  const v = Number(fx.rates[div]);
  if (!Number.isFinite(v) || v <= 0) morir(`tipos de cambio: ${div} llega como ${fx.rates[div]}`);
  const actual = leerActual(div);
  if (actual !== null && Math.abs(v - actual) / actual > SALTO_MAXIMO) {
    morir(`tipos de cambio: ${div} salta de ${actual} a ${v}, más del ${SALTO_MAXIMO * 100}%. No lo escribo sin que alguien lo mire.`);
  }
  tipos[div] = Math.round(v * 1e6) / 1e6;
}

// --- precio del oro ----------------------------------------------------------------------------
const oro = await traer('https://api.gold-api.com/price/XAU', 'precio del oro');
const usdPorOnza = Number(oro && oro.price);
if (!Number.isFinite(usdPorOnza) || usdPorOnza <= 0) {
  morir(`precio del oro: la respuesta no trae un \`price\` utilizable (${JSON.stringify(oro).slice(0, 200)})`);
}
const eurPorGramo = Math.round(usdPorOnza / tipos.USD / TROY_OUNCE_GRAMS * 100) / 100;
if (!(eurPorGramo >= ORO_MIN && eurPorGramo <= ORO_MAX)) {
  morir(`precio del oro: ${eurPorGramo} €/g queda fuera de la banda de cordura ${ORO_MIN}-${ORO_MAX}`);
}

// --- euríbor ------------------------------------------------------------------------------------
// A diferencia de los tipos de cambio, que el euríbor no llegue no para la actualización: se
// conserva el que ya hay, con su mes, y la página dice de cuándo es. Un dato que llega mal sí la
// para, igual que un tipo de cambio malo: no se escribe una hipoteca equivocada en main.
async function traerEuribor() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(EURIBOR_URL, { signal: ctrl.signal, headers: { 'accept': 'application/json' } });
    if (!res.ok) { console.warn(`euríbor: el BCE respondió ${res.status}; se conserva el anterior`); return null; }
    return await res.json();
  } catch (err) {
    console.warn(`euríbor: no se pudo leer (${err && err.message || err}); se conserva el anterior`);
    return null;
  } finally { clearTimeout(t); }
}
let euribor = euriborActual;
const doc = await traerEuribor();
if (doc) {
  let valor = null, periodo = null;
  try {
    const obs = Object.values(doc.dataSets[0].series)[0].observations;
    const ultimo = Object.keys(obs).map(Number).sort((a, b) => b - a)[0];
    valor = Number(obs[ultimo][0]);
    periodo = doc.structure.dimensions.observation[0].values[ultimo].id;
  } catch {
    morir('euríbor: la respuesta del BCE no tiene la forma de siempre; la API ha cambiado');
  }
  if (!Number.isFinite(valor) || valor < EURIBOR_MIN || valor > EURIBOR_MAX) {
    morir(`euríbor: ${valor} no es un euríbor`);
  }
  if (!/^\d{4}-\d{2}$/.test(String(periodo))) morir(`euríbor: el periodo "${periodo}" no tiene forma de AAAA-MM`);
  if (euriborActual && Math.abs(valor - euriborActual.pct) > EURIBOR_SALTO_MAXIMO) {
    morir(`euríbor: salta de ${euriborActual.pct} a ${valor}, más de ${EURIBOR_SALTO_MAXIMO} puntos. No lo escribo sin que alguien lo mire.`);
  }
  euribor = { pct: Math.round(valor * 1000) / 1000, periodo };
}
if (!euribor) morir('euríbor: ni dato nuevo ni anterior en el bloque');

// --- reescribir el bloque ----------------------------------------------------------------------
const hoy = new Date().toISOString().slice(0, 10);
const bloqueNuevo = [
  ABRE,
  '    // BLOQUE AUTOMÁTICO. Lo reescribe .github/workflows/retiro-tipos.yml una vez por semana y no hay que',
  '    // tocarlo a mano: cualquier edición se pierde en la siguiente actualización. Son los valores',
  '    // con los que arranca la página, así que siguen siendo correctos aunque las APIs en vivo no',
  '    // contesten -que es lo que pasaba antes, con unos tipos congelados sin fecha ni forma de',
  '    // saber de cuándo eran-. Los tipos van en unidades de divisa por EURO (USD: 1.085 = un euro',
  '    // son 1,085 dólares), el oro en euros por gramo y el euríbor a 12 meses en %, con su mes.',
  `    const RATES_UPDATED = '${hoy}';`,
  '    const DEFAULT_EXCHANGE_RATES = {',
  ...DIVISAS.map(d => `      ${d}: ${tipos[d]},`),
  '      EUR: 1.0',
  '    };',
  `    const DEFAULT_GOLD_EUR_PER_GRAM = ${eurPorGramo};`,
  `    const DEFAULT_EURIBOR_12M_PCT = ${euribor.pct};`,
  `    const EURIBOR_PERIOD = '${euribor.periodo}';`,
  CIERRA
].join('\n');

const salida = html.slice(0, iAbre) + bloqueNuevo + html.slice(iCierra + CIERRA.length);

console.log(DIVISAS.map(d => `${d} ${tipos[d]}`).join(' · '));
console.log(`oro ${eurPorGramo} €/g (${usdPorOnza} $/oz)`);
console.log(`euríbor ${euribor.pct} % (${euribor.periodo})${doc ? '' : ' · el anterior'}`);

if (salida === html) { console.log('· sin cambios'); process.exit(0); }
if (DRY) { console.log('· --dry: no escribo nada'); process.exit(0); }
writeFileSync(INDEX, salida);
console.log(`✓ index.html actualizado (${hoy})`);
