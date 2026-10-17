import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(44)} ${d}`); };
const val = id => p.evaluate(i => document.getElementById(i).value, id);
const n = async id => p.evaluate(i => parseNum(document.getElementById(i).value), id);

await p.evaluate(() => resetDefaults());
// Escenario por defecto: 500.000 €, 100 m², 2.000 €/mes
const est = await p.evaluate(() => ({
  comunidad: parseNum(document.getElementById('comunidad').value), ibi: parseNum(document.getElementById('ibi').value),
  seguroHogar: parseNum(document.getElementById('seguroHogar').value), seguroImpagos: parseNum(document.getElementById('seguroImpagos').value),
  mantenimiento: parseNum(document.getElementById('mantenimiento').value),
  gastos: document.getElementById('outGastosAnuales').textContent, peso: document.getElementById('outPesoGastos').textContent }));
console.log('estimados:', est);
check('comunidad = 1 €/m²·mes x 100', est.comunidad === 100, String(est.comunidad));
check('IBI = 0,24% x 500.000', est.ibi === 1200, String(est.ibi));
check('seguro hogar = 2,5 €/m² x 100', est.seguroHogar === 250, String(est.seguroHogar));
check('impagos = 0,5 x 2.000', est.seguroImpagos === 1000, String(est.seguroImpagos));
check('mantenimiento = 5% x 24.000', est.mantenimiento === 1200, String(est.mantenimiento));
check('todos deshabilitados con candado cerrado',
  await p.evaluate(() => ['comunidad','ibi','seguroHogar','seguroImpagos','mantenimiento'].every(i => document.getElementById(i).disabled)));

// Los estimados siguen a sus impulsores
await p.evaluate(() => { document.getElementById('superficie').value = 200; document.getElementById('alquiler').value = 3000; render(); });
check('comunidad sigue a los m²', (await n('comunidad')) === 200, await val('comunidad'));
check('mantenimiento sigue al alquiler', (await n('mantenimiento')) === 1800, await val('mantenimiento'));

// Abrir un candado: el campo se vuelve editable y deja de recalcularse
await p.click('#lockIbi');
check('candado abierto habilita el campo', !(await p.evaluate(() => document.getElementById('ibi').disabled)));
check('icono cambia a abierto', (await p.textContent('#lockIbi')) === '🔓', await p.textContent('#lockIbi'));
await p.evaluate(() => { document.getElementById('ibi').value = 777; render();
  const pa = document.getElementById('precioAnunciado');
  pa.value = 900000; pa.dispatchEvent(new Event('input')); render(); });
check('IBI manual sobrevive a un cambio de precio', (await n('ibi')) === 777, await val('ibi'));
check('los demás sí se recalculan', (await n('seguroImpagos')) === 1500, await val('seguroImpagos'));

// Persistencia del candado
await p.waitForTimeout(900); // el autoguardado va con 600 ms de rebote
await p.reload(); await p.waitForTimeout(500);
check('el candado abierto se guarda', (await p.textContent('#lockIbi')) === '🔓', await p.textContent('#lockIbi'));
check('el valor manual se guarda', (await n('ibi')) === 777, await val('ibi'));

// Reestimar todo
await p.click('text=Reestimar todo'); await p.waitForTimeout(200);
check('reestimar cierra todos los candados',
  await p.evaluate(() => ['comunidad','ibi','seguroHogar','seguroImpagos','mantenimiento'].every(i => document.getElementById(i).disabled)));
check('reestimar recalcula el IBI', (await n('ibi')) === 0.24/100*900000, await val('ibi'));

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await p.evaluate(() => resetDefaults()); await p.waitForTimeout(300);
await p.locator('main').screenshot({ path: salida('gastos.png') });
await p.click('text=⚙️ Parámetros'); await p.waitForTimeout(300);
await p.locator('#paramsTab').screenshot({ path: salida('params.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
