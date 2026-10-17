// Regresión de los defectos que encontró la auditoría. Reescrito tras unificar la financiación:
// la entrada y el dinero aportado ya no son campos, así que sus dos defectos desaparecieron con
// ellos y los cubren ahora los topes de LTV y de préstamo en v3.mjs.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
await p.evaluate(() => localStorage.clear());
let fallos = 0;
const norm = s => s.replace(/\s+/g, ' ').trim();
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(46)} ${d}`); };
const set = (id, v) => p.evaluate(([i,x]) => { document.getElementById(i).value = x; render(); }, [id,v]);

// 1) Con préstamo personal vivo, la tarjeta y la tabla deben decir lo mismo. Antes la tarjeta
//    medía siempre contra el régimen de sólo hipoteca y una operación en pérdidas salía verde.
await p.evaluate(() => { resetDefaults(); document.getElementById('usarPrestamo').checked = true;
  pintarFuente('prestamo'); document.getElementById('importePrestamo').value = '100000'; render(); });
const kpi = await p.textContent('#kpiCaja');
const tab = await p.evaluate(() => [...document.querySelectorAll('#tblCaja tr')].find(r => /Caja neta anual/.test(r.textContent)).textContent);
check('KPI caja = tabla (con préstamo)', norm(tab).includes(norm(kpi)), `KPI ${norm(kpi)} | ${norm(tab)} | ROCE ${norm(await p.textContent('#kpiRoce'))}`);

// 2) Un alquiler o un precio negativo dejaban vacía la rejilla de las tablas y reventaban
//    render() a mitad, con los KPIs nuevos y las tablas viejas.
for (const [id, v] of [['alquiler', '-1000'], ['oferta', '-50000'], ['superficie', '-50']]) {
  errs.length = 0;
  await p.evaluate(() => resetDefaults());
  await set(id, v);
  check(`${id} negativo no rompe`, errs.length === 0, errs[0]?.split('\n')[0] ?? 'sin errores');
}

// 3) Un plazo a cero daba cuota cero: el préstamo no se pagaba nunca y el saldo capitalizaba gratis.
await p.evaluate(() => resetDefaults()); await set('plazoHipoteca', '');
const r3 = await p.evaluate(() => { const d = calcular(); return { cuota: d.cuotaHip, a5: d.filas[4].hipFin }; });
check('plazo vacío no capitaliza gratis', r3.cuota > 0 && r3.a5 < 400000, `cuota ${Math.round(r3.cuota)} €, saldo año 5 ${Math.round(r3.a5)} €`);

// 4) Sin liquidez aportada el ROCE salía "0,0%", que se lee como un resultado neutro.
await p.evaluate(() => { resetDefaults();
  document.getElementById('pctFinanciado').value = '100';
  document.getElementById('usarPrestamo').checked = true; pintarFuente('prestamo');
  document.getElementById('importePrestamo').value = '99999999'; render(); });
const r4 = await p.evaluate(() => calcular().aportado);
check('operación financiada al 100%', r4 === 0, String(r4));
check('sin liquidez el ROCE es un guion', norm(await p.textContent('#kpiRoce')) === '—', norm(await p.textContent('#kpiRoce')));

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODOS LOS DEFECTOS SIGUEN CORREGIDOS');
process.exit(fallos ? 1 : 0);
