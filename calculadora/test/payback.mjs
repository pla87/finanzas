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
  return { ano: +c.closest('tr').children[0].textContent, col: [...c.parentNode.children].indexOf(c), titulo: c.title };
});
check('está en el año del payback', fila.ano === dato.n, `año ${fila.ano}`);
check('y en la columna de caja acumulada', fila.col === 9, `columna ${fila.col}`);
check('el globo nombra el importe y el año',
  fila.titulo.includes(String(dato.n)) && /\d{3}/.test(fila.titulo), fila.titulo.slice(0, 60) + '…');
check('ya no queda el filete azul', (await p.$$('.row-payback')).length === 0);

// Más verde que la fila sin deuda, y encima de ella cuando coinciden.
const colores = await p.evaluate(() => {
  const c = document.querySelector('#tblProyeccion td.cell-payback');
  const paid = document.querySelector('#tblProyeccion tr.row-paid td:nth-child(10)');
  const alfa = (s) => { const m = s.match(/rgba?\([^)]*?([\d.]+)\)/); return m && s.includes('rgba') ? +m[1] : 1; };
  return { celda: getComputedStyle(c).backgroundColor, paid: paid ? getComputedStyle(paid).backgroundColor : null,
           a: alfa(getComputedStyle(c).backgroundColor), b: paid ? alfa(getComputedStyle(paid).backgroundColor) : 0 };
});
check('más intenso que el verde de sin deuda', colores.a > colores.b, `${colores.celda} vs ${colores.paid}`);

// El mismo año sin deuda: la celda debe seguir ganando el fondo.
await p.evaluate(() => { document.getElementById('hipotecaAcelerada').checked = true; render(); });
await p.waitForTimeout(200);
const dobles = await p.evaluate(() => {
  const c = document.querySelector('#tblProyeccion td.cell-payback');
  if (!c) return null;
  return { enFilaVerde: c.closest('tr').classList.contains('row-paid'), fondo: getComputedStyle(c).backgroundColor };
});
if (dobles && dobles.enFilaVerde) {
  check('gana a la fila verde cuando coinciden', /0\.3/.test(dobles.fondo), dobles.fondo);
} else {
  console.log('info  el payback no cae en un año sin deuda en este escenario');
}

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
