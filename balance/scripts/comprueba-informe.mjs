// --- EL INFORME CONTRA LA PANTALLA ---
//
// El informe en PDF pinta sesenta y pico cifras con su propio JSX y su propio
// formateo, en paralelo a las pestañas. Es el último sitio donde un número
// puede mentir sin que salte nada: las pruebas de `npm test` llegan hasta
// src/lib, y el barrido aleatorio comprueba el motor, pero nadie mira si lo
// que sale impreso coincide con lo que se ve en pantalla.
//
// Esto abre la aplicación compilada, lee las dos versiones de cada cifra y las
// compara. Sin dependencias: sirve dist/ con el http de Node y conduce el
// Chromium que ya viene instalado.
//
//   npm run build && node scripts/comprueba-informe.mjs
//
// Sale con código 1 si alguna pareja no cuadra, para poder encadenarlo.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const RAIZ = new URL('../dist/', import.meta.url).pathname;
const PUERTO = 8791;
const DEPURACION = 9333;

if (!existsSync(join(RAIZ, 'index.html'))) {
  console.error('No hay nada en dist/. Ejecuta antes `npm run build`.');
  process.exit(1);
}

// --- servidor mínimo para dist/ ---
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const servidor = createServer(async (req, res) => {
  const ruta = join(RAIZ, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  try {
    if ((await stat(ruta)).isDirectory()) throw new Error('directorio');
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    res.end(await readFile(ruta));
  } catch {
    res.writeHead(404); res.end('no está');
  }
});
await new Promise(r => servidor.listen(PUERTO, '127.0.0.1', r));

// --- navegador ---
function buscarChromium() {
  const candidatos = ['/opt/pw-browsers', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const c of candidatos) {
    if (!existsSync(c)) continue;
    if (!c.startsWith('/opt')) return c;
    for (const d of readdirSync(c)) {
      const bin = join(c, d, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}
const binario = buscarChromium();
if (!binario) {
  console.error('No encuentro un Chromium. Instálalo o exporta CHROME=/ruta/al/binario.');
  process.exit(1);
}
const navegador = spawn(process.env.CHROME || binario, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${DEPURACION}`, '--user-data-dir=/tmp/comprueba-informe', 'about:blank'
], { stdio: 'ignore' });

const limpiar = () => { try { navegador.kill(); } catch {} servidor.close(); };
process.on('exit', limpiar);

// --- protocolo ---
const esperar = ms => new Promise(r => setTimeout(r, ms));
let pestana = null;
for (let i = 0; i < 40 && !pestana; i++) {
  await esperar(250);
  try { pestana = await (await fetch(`http://127.0.0.1:${DEPURACION}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {}
}
if (!pestana) { console.error('El navegador no ha levantado.'); process.exit(1); }

const ws = new WebSocket(pestana.webSocketDebuggerUrl);
let id = 0; const pendientes = new Map(); const errores = [];
const enviar = (m, q = {}) => new Promise(r => { const i = ++id; pendientes.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m.result); pendientes.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
await enviar('Runtime.enable'); await enviar('Page.enable');
await enviar('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
// Dos balances: el de ejemplo, y uno grande que enciende filas que aquel deja
// apagadas —el impuesto sobre el patrimonio, una deuda familiar sin cuota—.
// Con uno solo, el informe podría estar mintiendo justo donde no se mira.
const ESCENARIOS = [
  { nombre: 'el balance de ejemplo', estado: null },
  {
    nombre: 'un patrimonio grande, con impuesto y deuda familiar',
    estado: {
      v14_assets: [
        { id: 'a1', name: 'Cuenta', subcategory: 'cash', currency: 'EUR', value: 120000, cashReturnPct: 2.5, useReturnPct: 0, capitalReturnPct: 0, monthlyRent: 0, useType: 'habitual' },
        { id: 'a2', name: 'Cartera', subcategory: 'stocks', currency: 'EUR', value: 1400000, cashReturnPct: 2.1, useReturnPct: 0, capitalReturnPct: 6, monthlyRent: 0, useType: 'habitual', stockType: 'fund' },
        { id: 'a3', name: 'Vivienda', subcategory: 'real_estate', currency: 'EUR', value: 620000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 2, monthlyRent: 1400, useType: 'habitual' }
      ],
      v14_liabilities: [
        { id: 'l1', name: 'Hipoteca', subcategory: 'mortgages', currency: 'EUR', initialPrincipal: 300000, startDate: '2019-06', durationMonths: 300, interestRatePct: 2.1, rateType: 'fixed', value: 300000, monthlyPayment: 0 },
        { id: 'l2', name: 'De mi madre', subcategory: 'family_loans', currency: 'EUR', value: 25000, initialPrincipal: 25000, monthlyPayment: 0, noMonthlyPayment: true, durationMonths: 60, interestRatePct: 0 }
      ],
      v14_expenses: {
        person_monthly: { food: 420, clothes: 110, supplies_person: 90, transport: 260, other_person: 150 },
        household_monthly: { supplies: 310, subs: 70, otherHouse: 120 },
        family_annual: { housekeeper: 6000, education: 9000, vacations: 7000, vehicleMaint: 1500, otherFixed: 2000 }
      },
      v14_macro_params: { wealthTaxRegion: 'estatal', wealthTaxPayers: 1 },
      fire_members_v14: 3
    }
  }
];

async function cargar(estado) {
  const semilla = `
    localStorage.clear();
    localStorage.setItem('patrimonio_onboarding_shown', 'true');
    localStorage.setItem('fire_lang_v14', 'es');
    ${Object.entries(estado || {}).map(([k, v]) =>
      `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'number' ? String(v) : JSON.stringify(v))});`).join('\n    ')}
  `;
  await enviar('Page.addScriptToEvaluateOnNewDocument', { source: semilla });
  await enviar('Page.navigate', { url: `http://127.0.0.1:${PUERTO}/index.html?t=${Date.now()}` });
  await esperar(5000);
}

const ev = async expr => (await enviar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const irA = async nombre => {
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes(${JSON.stringify(nombre)}) && x.innerText.length < 45); if (b) b.click(); })()`);
  await esperar(900);
};

// Lee la tabla que haya en pantalla: por cada fila, el nombre es la primera
// celda con letras —saltando flechas y lápiz— y el importe la que va justo
// antes del porcentaje. Sirve igual para activos y para pasivos, y no depende
// de cuántas columnas tenga cada sección.
const filasConImporte = () => ev(`(() => {
  const salida = {};
  for (const fila of document.querySelectorAll('tr')) {
    const celdas = Array.from(fila.querySelectorAll('td')).map(c => c.innerText.replace(/\\s+/g, ' ').trim());
    const iTipo = celdas.findIndex(c => /^-?[\\d.,]+ ?%$/.test(c));
    if (iTipo < 1) continue;
    const cruda = celdas.slice(0, iTipo).find(c => (c.match(/\\p{L}/gu) || []).length >= 3 && !/^-?[\\d.,]+ ?(€|%|meses)/.test(c));
    if (!cruda) continue;
    const nombre = cruda.replace(/^[^\\p{L}(]+/u, '').trim();
    if (nombre && !(nombre in salida)) salida[nombre] = celdas[iTipo - 1];
  }
  return salida;
})()`);

// Un número en castellano: 1.234,56 € → 1234.56
const aNumero = t => {
  const v = Number(String(t).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
// El primer IMPORTE que aparece tras una etiqueta. Pide el símbolo de moneda a
// propósito: en varios sitios el número que va antes es un porcentaje.
const trasImporte = (texto, etiqueta, ventana = 120, desdeElFinal = false) => {
  const i = desdeElFinal ? texto.lastIndexOf(etiqueta) : texto.indexOf(etiqueta);
  if (i < 0) return null;
  const m = texto.slice(i + etiqueta.length, i + etiqueta.length + ventana).match(/(-?[\d.]+(?:,\d+)?)\s*€/);
  return m ? aNumero(m[1]) : null;
};
// El primer número a secas, para puntuaciones y meses.
const trasNumero = (texto, etiqueta, ventana = 60) => {
  const i = texto.indexOf(etiqueta);
  if (i < 0) return null;
  const m = texto.slice(i + etiqueta.length, i + etiqueta.length + ventana).match(/-?[\d.]+(?:,\d+)?/);
  return m ? aNumero(m[0]) : null;
};

async function comprobarEscenario() {
  const parejas = [];
  const comparar = (qué, enInforme, enPantalla, tolerancia = 1) => parejas.push({ qué, enInforme, enPantalla, tolerancia });

  // El informe vive siempre en el DOM, oculto hasta que se imprime.
  const textoInforme = await ev(`(() => {
    const r = document.querySelector('.print-only-report');
    if (!r) return '';
    const antes = r.style.display; r.style.display = 'block';
    const t = r.innerText; r.style.display = antes;
    return t;
  })()`);
  const textoPantalla = async pestanaNombre => { await irA(pestanaNombre); return ev(`document.querySelector('#root').innerText`); };

const neto = await textoPantalla('Patrimonio Neto');
  comparar('patrimonio neto', trasImporte(textoInforme, 'Patrimonio Neto'), trasImporte(neto, 'ESTADO DE PATRIMONIO NETO'));
  comparar('total de activos', trasImporte(textoInforme, 'TOTAL ACTIVOS'), trasImporte(neto, '1. RESUMEN CONSOLIDADO DE ACTIVOS'));
  comparar('total de pasivos', trasImporte(textoInforme, 'TOTAL PASIVOS (DEUDA)'), trasImporte(neto, '2. RESUMEN CONSOLIDADO DE PASIVOS'));
  comparar('colchón de emergencia', trasNumero(textoInforme, 'Runway de Emergencia'), trasNumero(neto, 'RUNWAY DE EMERGENCIA Ⓘ'), 0.05);
  
  // La cascada de caja, fila por fila: es donde más veces se ha descuadrado algo.
  for (const fila of ['(=) Total Cashflow Pasivo Neto', '(-) Cuotas Mensuales de Deuda', '(-) Gastos familiares']) {
    comparar(`cascada · ${fila}`, trasImporte(textoInforme, fila), trasImporte(neto, fila));
  }
  // La última: en pantalla hay antes un subtotal, «(=) Caja neta mensual del
  // balance», que es lo mismo sin restar los gastos de vida. La etiqueta corta es
  // prefijo de la larga, así que se lee desde el final.
  comparar('cascada · (=) Caja neta mensual',
    trasImporte(textoInforme, '(=) Caja neta mensual', 120, true),
    trasImporte(neto, '(=) Caja neta mensual', 120, true));
  
  const gastos = await textoPantalla('Gastos');
  comparar('gasto mensual total', trasImporte(textoInforme, 'Total Gastos Mensuales'), trasImporte(gastos, 'Total Gastos Mensuales'));
  
  const auditoria = await textoPantalla('Auditoría');
  for (const dim of ['Solvencia y colchón de capital', 'Estructura de capital y apalancamiento',
    'Diversificación y concentración', 'Eficiencia y coste de oportunidad',
    'Colchón de liquidez', 'Cobertura de tu coste de vida']) {
    comparar(`auditoría · ${dim.toLowerCase()}`, trasNumero(textoInforme, dim), trasNumero(auditoria, dim), 0.05);
  }
  comparar('nota combinada', trasNumero(textoInforme, 'Puntuación de Salud Financiera:'), trasNumero(auditoria, 'PUNTUACIÓN DE SALUD FINANCIERA'), 0.05);
  
  // Los saldos, leídos de la tabla: en el texto plano de una fila hay varias
  // cifras y cuál es el saldo depende de la sección. Se comparan las deudas
  // que haya, sean cuales sean, para que esto valga con cualquier balance.
  await irA('Pasivos');
  const saldosPasivos = await filasConImporte();
  await irA('Activos');
  const saldosActivos = await filasConImporte();
  const saldosEnPantalla = { ...saldosActivos, ...saldosPasivos };

  for (const [nombre, saldo] of Object.entries(saldosEnPantalla)) {
    const enInforme = trasImporte(textoInforme, nombre + 'EUR');
    if (enInforme === null) continue;   // el informe no lista esa fila
    comparar(`saldo · ${nombre.toLowerCase()}`, enInforme, aNumero((saldo.match(/-?[\d.]+(?:,\d+)?/) || [])[0]));
  }

  // El impuesto sobre el patrimonio solo sale en la cascada cuando toca pagar.
  const impuestoInforme = trasImporte(textoInforme, '(-) Impuesto sobre el Patrimonio');
  if (impuestoInforme !== null) {
    comparar('cascada · (-) Impuesto sobre el Patrimonio', impuestoInforme, trasImporte(neto, '(-) Impuesto sobre el Patrimonio'));
  }

  return parejas;
}

// --- resultado ---
let fallosTotales = 0, cifrasTotales = 0;
for (const { nombre, estado } of ESCENARIOS) {
  await cargar(estado);
  const parejas = await comprobarEscenario();
  console.log(`\n── ${nombre} ──`);
  console.log('cifra                                          informe        pantalla');
  const fallos = [];
  for (const { qué, enInforme, enPantalla, tolerancia } of parejas) {
    const falta = enInforme === null || enPantalla === null;
    const cuadra = !falta && Math.abs(enInforme - enPantalla) <= tolerancia;
    if (!cuadra) fallos.push(qué);
    const f = v => v === null ? '(no la encuentro)' : String(v);
    console.log(`${cuadra ? '  ' : '✗ '}${qué.padEnd(44)} ${f(enInforme).padStart(12)} ${f(enPantalla).padStart(15)}`);
  }
  cifrasTotales += parejas.length;
  fallosTotales += fallos.length;
  if (fallos.length) console.log(`   ${fallos.length} de ${parejas.length} no cuadran`);
}

if (errores.length) console.log('\nerrores de consola:', errores.map(e => String(e).split('\n')[0]).join(' | '));

console.log('');
if (fallosTotales) {
  console.log(`${fallosTotales} de ${cifrasTotales} cifras del informe no coinciden con la pantalla`);
  process.exit(1);
}
console.log(`las ${cifrasTotales} cifras del informe coinciden con las de la pantalla`);
process.exit(errores.length ? 1 : 0);
