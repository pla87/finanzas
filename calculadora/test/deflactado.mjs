// Patrimonio y caja en euros de hoy: columna nueva de la tabla y las dos columnas del KPI.
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
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(52)} ${d}`); };
const txt = s => p.textContent(s);

// 1) La aritmética: cada año descuenta su propia inflación acumulada.
const filas = await p.evaluate(() => {
  const d = calcular();
  return d.filas.map(f => ({ n: f.n, nom: f.patrimonio, real: f.patrimonioReal, caja: f.cajaAcum, cajaReal: f.cajaAcumReal }))
    .concat([{ infl: d.inflacion }]);
});
const infl = filas.pop().infl;
const malos = filas.filter(f => Math.abs(f.real - f.nom / Math.pow(1 + infl, f.n)) > 0.01);
check('el patrimonio de hoy descuenta la inflación acumulada', malos.length === 0, `${malos.length} años mal`);
const malosCaja = filas.filter(f => Math.abs(f.cajaReal - f.caja / Math.pow(1 + infl, f.n)) > 0.01);
check('la caja de hoy, igual', malosCaja.length === 0, `${malosCaja.length} años mal`);
const u = filas[filas.length - 1];
check('a 30 años y al 2,5% queda por debajo de la mitad', u.real < u.nom * 0.5,
  `${Math.round(u.nom / 1000)}k → ${Math.round(u.real / 1000)}k`);

// 2) Con inflación cero las dos columnas coinciden.
await p.evaluate(() => { document.getElementById('inflacion').value = 0; render(); });
const cero = await p.evaluate(() => { const d = calcular(); return { a: d.ultima.patrimonio, b: d.ultima.patrimonioReal }; });
check('sin inflación nominal y real coinciden', Math.abs(cero.a - cero.b) < 0.01);

// 3) Una inflación imposible no rompe la página.
await p.evaluate(() => { document.getElementById('inflacion').value = -100; render(); });
const limite = await p.evaluate(() => { const d = calcular(); return d.ultima.patrimonioReal; });
check('inflación del -100% no da infinitos', isFinite(limite), String(Math.round(limite)));
await p.evaluate(() => { document.getElementById('inflacion').value = 3; render(); });
await p.waitForTimeout(200);

// 4) La columna está en la tabla, con su cabecera y su globo.
const col = await p.evaluate(() => {
  const hs = [...document.querySelectorAll('#proyeccionTab thead th')];
  const i = hs.findIndex(h => h.dataset.i18n === 'colPatrimonioReal');
  const fila = document.querySelector('#tblProyeccion tr:last-child');
  return { i, titulo: hs[i] ? hs[i].title : null, celda: fila.cells[i].textContent.trim(),
           anterior: fila.cells[i - 1].textContent.trim() };
});
check('la columna va junto al patrimonio nominal', col.i === 6, `columna ${col.i}`);
check('la cabecera lleva su explicación', (col.titulo || '').length > 40, (col.titulo || '').slice(0, 40) + '…');
check('y la cifra es menor que la nominal',
  parseNumES(col.celda) < parseNumES(col.anterior), `${col.anterior} → ${col.celda}`);
function parseNumES(s) { return +s.replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.'); }

// 5) El desplegable del año manda sobre la cifra grande, sin tocar la proyección.
const opciones = await p.evaluate(() => ({
  n: document.getElementById('anoRef').options.length,
  valor: document.getElementById('anoRef').value,
  filas: document.querySelectorAll('#tblProyeccion tr').length
}));
check('el desplegable llega hasta el horizonte', opciones.n === 30, `${opciones.n} opciones`);
check('y arranca en 30', opciones.valor === '30', opciones.valor);
check('ya no queda la tablita de patrimonio', (await p.$('#kpiPatNominal')) === null);

const a30 = await p.textContent('#kpiAnualizada');
await p.selectOption('#anoRef', '5');
await p.waitForTimeout(200);
const a5 = await p.textContent('#kpiAnualizada');
check('cambiar el año cambia la cifra', a5 !== a30, `${a30} → ${a5}`);
check('coincide con la fila 5 de la tabla',
  a5 === (await p.evaluate(() => {
    const col = [...document.querySelectorAll('#proyeccionTab thead th')].findIndex(h => h.dataset.i18n === 'colRentab');
    return document.querySelectorAll('#tblProyeccion tr')[4].cells[col].textContent.trim();
  })), a5);
check('la proyección no se recorta',
  (await p.evaluate(() => document.querySelectorAll('#tblProyeccion tr').length)) === 30);
check('y el resumen mira el mismo año',
  (await p.textContent('#tblRentabilidad')).includes('año 5'));

// Acortar el horizonte por debajo del año elegido lo recorta en vez de romperse.
await p.selectOption('#anoRef', '25');
await p.evaluate(() => { document.getElementById('horizonte').value = 10; render(); });
await p.waitForTimeout(200);
check('acortar el horizonte recorta el año elegido',
  (await p.inputValue('#anoRef')) === '10', await p.inputValue('#anoRef'));
await p.evaluate(() => { document.getElementById('horizonte').value = 30; render(); });
await p.waitForTimeout(200);
await p.selectOption('#anoRef', '30');

// 6) El ROCE va en dos: lo realizado y lo realizado más la plusvalía sobre el papel.
const roce = await p.evaluate(() => {
  const d = calcular();
  return { caja: d.roceCaja, amo: d.roceAmortizacion, sin: d.roceSinReval, rev: d.roceRevalorizacion, total: d.roce };
});
check('el ROCE sin revalorización es caja más amortización',
  Math.abs(roce.sin - (roce.caja + roce.amo)) < 1e-12,
  `${(roce.caja*100).toFixed(1)} + ${(roce.amo*100).toFixed(1)} = ${(roce.sin*100).toFixed(1)}%`);
check('el ROCE con revalorización añade la plusvalía',
  Math.abs(roce.total - (roce.sin + roce.rev)) < 1e-12,
  `${(roce.sin*100).toFixed(1)} + ${(roce.rev*100).toFixed(1)} = ${(roce.total*100).toFixed(1)}%`);
check('la plusvalía pesa más que todo lo realizado', roce.rev > roce.sin);
check('la cifra grande de la tarjeta es la realizada',
  (await p.textContent('#kpiRoce')).trim() === `${(roce.sin*100).toFixed(1).replace('.', ',')}%`, await p.textContent('#kpiRoce'));
check('y la de debajo, la que cuenta la revalorización',
  (await p.textContent('#kpiRoceConReval')).includes(`${(roce.total*100).toFixed(1).replace('.', ',')}%`),
  await p.textContent('#kpiRoceConReval'));
const resumen = await p.textContent('#tblRentabilidad');
check('el resumen enseña los dos subtotales',
  ['ROCE sin revalorización', 'ROCE con revalorización'].every(x => resumen.includes(x)));

// Sin liquidez aportada no hay divisor: guion en vez de infinito.
await p.evaluate(() => { document.getElementById('pctFinanciado').value = 100;
  document.getElementById('usarPrestamo').checked = true; pintarFuente('prestamo');
  document.getElementById('importePrestamo').value = 999999; render(); });
await p.waitForTimeout(200);
check('sin liquidez aportada el ROCE es un guion', (await p.textContent('#kpiRoce')).trim() === '—', await p.textContent('#kpiRoce'));
check('y el de debajo también', (await p.textContent('#kpiRoceConReval')).includes('—'), await p.textContent('#kpiRoceConReval'));

const linea = await p.evaluate(() => {
  const e = document.getElementById('kpiPayback');
  const alto = parseFloat(getComputedStyle(e).lineHeight) || 16;
  return { renglones: Math.round(e.getBoundingClientRect().height / alto), texto: e.textContent, titulo: e.title };
});
check('la frase sigue en un renglón', linea.renglones === 1, `${linea.renglones}: "${linea.texto}"`);
check('el globo lleva la versión larga', linea.titulo.length > linea.texto.length, linea.titulo);

await p.evaluate(() => resetDefaults());
await p.waitForTimeout(300);
await p.screenshot({ path: salida('v5-kpi.png'), clip: { x: 900, y: 120, width: 480, height: 150 } });
await p.evaluate(() => document.getElementById('tblProyeccion').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(200);
await p.screenshot({ path: salida('v4-tabla-real.png') });

check('sin errores de consola', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
