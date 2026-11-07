import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA);
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(700);

let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(50)} ${d}`); };

const dato = await p.evaluate(() => { const d = calcular(); return { n: d.payback.n, ap: d.ultima.aportadoAcum }; });
const celdas = await p.$$('#tblProyeccion td.cell-payback');
check('hay una sola celda marcada', celdas.length === 1, String(celdas.length));
const fila = await p.evaluate(() => {
  const c = document.querySelector('#tblProyeccion td.cell-payback');
  const cab = [...document.querySelectorAll('#proyeccionTab thead th')].findIndex(h => h.dataset.i18n === 'colCajaAcum');
  return { ano: +c.closest('tr').children[0].textContent, col: [...c.parentNode.children].indexOf(c), cab, titulo: c.title };
});
check('está en el año del payback', fila.ano === dato.n, `año ${fila.ano}`);
check('y en la columna de caja acumulada', fila.col === fila.cab && fila.cab > 0, `columna ${fila.col}`);
check('el globo nombra el importe y el año',
  fila.titulo.includes(String(dato.n)) && /\d{3}/.test(fila.titulo), fila.titulo.slice(0, 60) + '…');
check('ya no queda el filete azul', (await p.$$('.row-payback')).length === 0);

// La celda se ve (tiene fondo propio) y los años sin deuda ya no pintan la fila entera de verde:
// se marcan en la celda de deuda, así que el verde de la celda del payback es el único.
const colores = await p.evaluate(() => {
  const c = document.querySelector('#tblProyeccion td.cell-payback');
  const alfa = (s) => { const m = s.match(/rgba?\([^)]*?([\d.]+)\)/); return m && s.includes('rgba') ? +m[1] : 1; };
  const otra = document.querySelector('#tblProyeccion tr:first-child td:nth-child(3)');
  return { celda: getComputedStyle(c).backgroundColor, a: alfa(getComputedStyle(c).backgroundColor),
           filaPintada: !!document.querySelector('#tblProyeccion tr.row-paid'),
           otra: alfa(getComputedStyle(otra).backgroundColor) };
});
check('la celda del payback tiene fondo propio', colores.a > 0.05 && colores.a < 0.3, colores.celda);
check('y la fila sin deuda ya no se rellena de verde', !colores.filaPintada && colores.otra === 0);

// El mismo año sin deuda: la celda debe seguir ganando el fondo.
await p.evaluate(() => { document.getElementById('hipotecaAcelerada').checked = true; render(); });
await p.waitForTimeout(200);
const dobles = await p.evaluate(() => {
  const c = document.querySelector('#tblProyeccion td.cell-payback');
  if (!c) return null;
  return { fondo: getComputedStyle(c).backgroundColor };
});
if (dobles) check('la celda conserva su fondo con la deuda acelerada', /0\.1/.test(dobles.fondo), dobles.fondo);
else console.log('info  el payback no cae en este escenario');

await p.evaluate(() => { document.getElementById('hipotecaAcelerada').checked = false; render(); });
await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector('#tblProyeccion td.cell-payback').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(200);
await p.screenshot({ path: salida('v4-payback.png') });

// Inglés
await p.click('#langBtn'); await p.waitForTimeout(400);
const tituloEn = await p.evaluate(() => document.querySelector('#tblProyeccion td.cell-payback').title);
check('el globo se traduce', tituloEn.startsWith('This is where'), tituloEn.slice(0, 40) + '…');

check('sin errores de consola', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
