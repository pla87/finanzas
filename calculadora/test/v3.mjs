import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(600);
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(46)} ${d}`); };
const val = id => p.evaluate(i => document.getElementById(i).value, id);

// 1) maquetación de escritorio: tres tarjetas arriba en la misma fila, resumen debajo a lo ancho
const caja = s => p.evaluate(sel => { const e = document.querySelector(sel); const r = e.getBoundingClientRect();
  return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width) }; }, s);
const compra = await caja('main > div:nth-child(1)');
const fin = await caja('main > div:nth-child(2)');
const expl = await caja('main > div:nth-child(3)');
const res = await caja('main > div:nth-child(4)');
check('las tres primeras tarjetas comparten fila', compra.t === fin.t && fin.t === expl.t, `${compra.t}/${fin.t}/${expl.t}`);
check('van en columnas distintas', compra.l < fin.l && fin.l < expl.l, `${compra.l}/${fin.l}/${expl.l}`);
check('el resumen va debajo', res.t > compra.t, `${res.t} > ${compra.t}`);
check('el resumen ocupa las tres columnas', res.w > expl.l + expl.w - compra.l - 5, `${res.w} vs ${expl.l + expl.w - compra.l}`);

// 2) el máximo del préstamo va en la etiqueta, no en su propia fila
check('no hay fila suelta de máximo', await p.evaluate(() => !document.querySelector('.salida #outTopePrestamo')));
const etq = await p.textContent('label[for="importePrestamo"]');
check('el máximo va en la etiqueta', /Importe.*máx.*135\.000/.test(etq.replace(/\s+/g,' ')), etq.replace(/\s+/g,' ').trim());

// 3) dos decimales en los tipos de interés
check('tipo de hipoteca con dos decimales', (await val('tipoHipoteca')) === '2,20', await val('tipoHipoteca'));
check('tipo de préstamo con dos decimales', (await val('tipoPrestamo')) === '11,00', await val('tipoPrestamo'));
await p.evaluate(() => { const e = document.getElementById('tipoHipoteca'); e.focus(); e.value = '3,5'; e.dispatchEvent(new Event('input')); e.blur(); });
await p.waitForTimeout(100);
check('al salir del campo se completa a dos decimales', (await val('tipoHipoteca')) === '3,50', await val('tipoHipoteca'));
check('y el motor lo lee bien', (await p.evaluate(() => calcular().cuotaHip)) > 1700, String(Math.round(await p.evaluate(() => calcular().cuotaHip))));

// 4) desplegables alineados a la derecha
const al = await p.evaluate(() => getComputedStyle(document.getElementById('ccaa')).textAlign);
check('desplegables alineados a la derecha', al === 'right', al);

// 5) comunidades en castellano
const opts = await p.evaluate(() => [...document.getElementById('ccaa').options].map(o => o.textContent));
check('Valencia, no Comunitat Valenciana', opts.includes('Valencia') && !opts.some(o => /Comunitat/.test(o)), opts.filter(o=>/Valen/.test(o)).join());
check('Baleares, no Illes Balears', opts.includes('Baleares') && !opts.some(o => /Illes/.test(o)), opts.filter(o=>/Bale/.test(o)).join());
check('Canarias', opts.includes('Canarias'));
check('ordenadas alfabéticamente', opts.join('|') === [...opts].sort((a,b)=>a.localeCompare(b,'es')).join('|'), opts.slice(0,4).join(', '));
await p.click('#langBtn'); await p.waitForTimeout(200);
const optsEn = await p.evaluate(() => [...document.getElementById('ccaa').options].map(o => o.textContent));
check('siguen en castellano en inglés', optsEn.includes('Cataluña') && optsEn.includes('País Vasco'), optsEn.slice(0,3).join(', '));
await p.click('#langBtn'); await p.waitForTimeout(200);

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await p.evaluate(() => { localStorage.clear(); }); await p.reload(); await p.waitForTimeout(700);
await p.locator('main').screenshot({ path: salida('v3main.png') });
await p.setViewportSize({ width: 420, height: 900 });
await p.waitForTimeout(400);
await p.locator('main').screenshot({ path: salida('v3movil.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
