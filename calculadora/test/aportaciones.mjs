import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
await p.evaluate(() => { localStorage.clear(); resetDefaults(); });
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(52)} ${d}`); };

// 1) Sin años en pérdidas, la TIR tiene que dar exactamente la fórmula compuesta de antes.
//    Se quitan los meses vacíos de fábrica: con ellos el escenario base se queda a -76 € de caja
//    y pide 38 € el primer año, que es realista pero rompe el caso degenerado que se quiere medir.
const base = await p.evaluate(() => {
  document.getElementById('mesesVacios').value = '0'; render();
  const d = calcular();
  const u = d.ultima;
  const compuesta = Math.pow((u.patrimonio + u.cajaAcum) / d.aportado, 1 / u.n) - 1;
  return { tir: u.anualizada, compuesta, aportaciones: d.aportacionesExtra,
    negativos: d.filas.filter(f => f.cajaAno < 0).length };
});
check('el escenario base no pide dinero extra', base.aportaciones === 0 && base.negativos === 0, `${base.negativos} años en pérdidas`);
check('sin aportaciones, TIR = rentabilidad compuesta', Math.abs(base.tir - base.compuesta) < 1e-9,
  `${(base.tir*100).toFixed(6)}% vs ${(base.compuesta*100).toFixed(6)}%`);

// 2) Un escenario que sí pide dinero: 95% de LTV
const alto = await p.evaluate(() => {
  document.getElementById('mesesVacios').value = '0,5';
  document.getElementById('pctFinanciado').value = '95'; render();
  const d = calcular();
  const conAporte = d.filas.filter(f => f.aportacion > 0);
  return { aportaciones: d.aportacionesExtra, nAnos: conAporte.length, primer: conAporte[0]?.n,
    aportado: d.aportado, aportadoAcum: d.ultima.aportadoAcum, tir: d.ultima.anualizada,
    cajaMin: Math.min(...d.filas.map(f => f.cajaAcum)) };
});
console.log(`   al 95% de LTV: ${alto.nAnos} años piden dinero, ${Math.round(alto.aportaciones).toLocaleString('es-ES')} € en total`);
check('hay años que piden dinero', alto.nAnos > 0, `${alto.nAnos} años, el primero el ${alto.primer}`);
check('la caja nunca se queda en negativo', alto.cajaMin >= 0, `mínimo ${Math.round(alto.cajaMin)}`);
check('el capital total sube con las aportaciones', Math.abs(alto.aportadoAcum - alto.aportado - alto.aportaciones) < 1,
  `${Math.round(alto.aportado)} + ${Math.round(alto.aportaciones)} = ${Math.round(alto.aportadoAcum)}`);

// 3) Las aportaciones bajan la rentabilidad frente a ignorarlas (que es lo que hacía antes)
const comparativa = await p.evaluate(() => {
  const d = calcular();
  const u = d.ultima;
  // La fórmula vieja: caja arrastrada en negativo y dividida sólo entre la liquidez inicial.
  let cajaVieja = 0;
  for (const f of d.filas) cajaVieja += f.cajaAno;
  const vieja = Math.pow(1 + (u.patrimonio - d.aportado + cajaVieja) / d.aportado, 1 / u.n) - 1;
  return { nueva: u.anualizada, vieja };
});
check('la TIR queda por debajo de la cifra que ignoraba las aportaciones',
  comparativa.nueva < comparativa.vieja,
  `${(comparativa.nueva*100).toFixed(2)}% frente a ${(comparativa.vieja*100).toFixed(2)}%`);

// 4) Descontar por fecha: la misma aportación duele más cuanto antes llega
const tiempo = await p.evaluate(() => {
  const pronto = tir([-100000, -20000, 0, 0, 0, 0, 0, 0, 0, 0, 200000]);
  const tarde  = tir([-100000, 0, 0, 0, 0, 0, 0, 0, 0, -20000, 200000]);
  return { pronto, tarde };
});
check('una aportación temprana penaliza más que una tardía', tiempo.pronto < tiempo.tarde,
  `año 1: ${(tiempo.pronto*100).toFixed(2)}% | año 9: ${(tiempo.tarde*100).toFixed(2)}%`);

// 5) La columna aparece y la fila va marcada
await p.evaluate(() => { document.getElementById('pctFinanciado').value = '95'; render(); });
const tabla = await p.evaluate(() => {
  const filaRoja = document.querySelector('#tblProyeccion tr.row-aporta');
  // La columna se busca por su cabecera: así una columna nueva en medio no rompe la prueba.
  const cabeceras = [...document.querySelectorAll('#proyeccionTab thead th')];
  const col = cabeceras.findIndex(h => h.dataset.i18n === 'colAportacion');
  return { columnas: cabeceras.length, col,
    hayFilaRoja: !!filaRoja, celda: filaRoja ? filaRoja.cells[col].textContent.trim() : null };
});
check('la tabla tiene la columna de aportación', tabla.col > 0, `columna ${tabla.col} de ${tabla.columnas}`);
check('las filas que piden dinero van marcadas', tabla.hayFilaRoja && /\d/.test(tabla.celda), tabla.celda);

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await p.locator('#proyeccionTab').screenshot({ path: salida('aportaciones.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
