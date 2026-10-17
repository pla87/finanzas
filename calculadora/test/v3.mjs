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
// Las tres tarjetas estiran por igual: la fila no deja una más corta que las otras.
const alturas = await p.evaluate(() => [1, 2, 3].map(i => Math.round(document.querySelector(`main > div:nth-child(${i})`).getBoundingClientRect().height)));
check('las tres tarjetas tienen la misma altura', alturas[0] === alturas[1] && alturas[1] === alturas[2], alturas.join('/'));
check('van en columnas distintas', compra.l < fin.l && fin.l < expl.l, `${compra.l}/${fin.l}/${expl.l}`);
check('el resumen va debajo', res.t > compra.t, `${res.t} > ${compra.t}`);
check('el resumen ocupa las tres columnas', res.w > expl.l + expl.w - compra.l - 5, `${res.w} vs ${expl.l + expl.w - compra.l}`);

// 2) el máximo del préstamo va en la etiqueta, no en su propia fila
check('no hay fila suelta de máximo', await p.evaluate(() => !document.querySelector('.salida #outTopePrestamo')));
const etq = await p.textContent('label[for="importePrestamo"]');
check('el máximo va en la etiqueta', /Importe.*máx.*99\.390/.test(etq.replace(/\s+/g,' ')), etq.replace(/\s+/g,' ').trim());

// 3) dos decimales en los tipos de interés
check('tipo de hipoteca con dos decimales', (await val('tipoHipoteca')) === '2,80', await val('tipoHipoteca'));
check('tipo de préstamo con dos decimales', (await val('tipoPrestamo')) === '9,00', await val('tipoPrestamo'));
await p.evaluate(() => { const e = document.getElementById('tipoHipoteca'); e.focus(); e.value = '3,5'; e.dispatchEvent(new Event('input')); e.blur(); });
await p.waitForTimeout(100);
check('al salir del campo se completa a dos decimales', (await val('tipoHipoteca')) === '3,50', await val('tipoHipoteca'));
check('y el motor lo lee bien', (await p.evaluate(() => calcular().cuotaHip)) > 750, String(Math.round(await p.evaluate(() => calcular().cuotaHip))));

// 4) desplegables alineados a la derecha
const al = await p.evaluate(() => getComputedStyle(document.getElementById('ccaa')).textAlign);
check('desplegables alineados a la derecha', al === 'right', al);
// La caja cerrada a la derecha, pero la lista desplegada (las options) a la izquierda.
const alOpt = await p.evaluate(() => [...document.querySelectorAll('select.campo')].map(s => [s.id, getComputedStyle(s).textAlign, getComputedStyle(s.options[0]).textAlign]));
check('todos los select.campo: caja a la derecha y opciones a la izquierda', alOpt.length > 0 && alOpt.every(([, c, o]) => c === 'right' && o === 'left'), JSON.stringify(alOpt));

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

// 6) Métricas plegables en móvil y pestañas en una línea (a 1440 todo como siempre)
const ids6 = ['kpiBruta', 'kpiRoce', 'kpiCaja', 'kpiDeuda', 'kpiAnualizada', 'kpiAnosAlquiler'];
const visibles = () => p.evaluate((ids) => ids.map(i => { const r = document.getElementById(i).getBoundingClientRect(); return r.width > 0 && r.height > 0; }), ids6);
check('1440: los seis indicadores se ven sin plegar', (await visibles()).every(Boolean));
check('1440: no hay botón de caja plegable ni explicaciones', await p.evaluate(() => getComputedStyle(document.getElementById('kpiToggle')).display === 'none' && [...document.querySelectorAll('[data-i18n$="Desc"]')].every(e => getComputedStyle(e).display === 'none')));
check('1440: las pestañas enseñan el nombre largo', await p.evaluate(() => document.querySelectorAll('.tab-btn')[1].innerText.trim() === '💵 Flujo de caja'));
const mov = await b.newPage({ viewport: { width: 390, height: 844 } });
await mov.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
const errsM = []; mov.on('pageerror', e => errsM.push(e.message));
await mov.goto(PAGINA); await mov.waitForTimeout(500);
await mov.evaluate(() => localStorage.clear()); await mov.reload(); await mov.waitForTimeout(600);
const visM = () => mov.evaluate((ids) => ids.map(i => { const r = document.getElementById(i).getBoundingClientRect(); return r.width > 0 && r.height > 0; }), ids6);
check('390: la caja de métricas nace plegada', (await visM()).every(v => !v) && await mov.getAttribute('#kpiToggle', 'aria-expanded') === 'false');
check('390: la cabecera lleva bruta y caja', await mov.evaluate(() => /\d/.test(document.getElementById('kpiResBruta').textContent) && /\d/.test(document.getElementById('kpiResCaja').textContent)));
await mov.click('#kpiToggle');
check('390: al abrirla se ven los seis y sus explicaciones', (await visM()).every(Boolean) && await mov.evaluate(() => [...document.querySelectorAll('[data-i18n$="Desc"]')].filter(e => e.getBoundingClientRect().height > 0 && e.textContent.length > 10).length === 6));
check('390: cada explicación cabe en una línea', await mov.evaluate(() => [...document.querySelectorAll('[data-i18n$="Desc"]')].every(e => e.getBoundingClientRect().height < 16)));
await mov.reload(); await mov.waitForTimeout(500);
check('390: tras recargar vuelve a estar plegada', (await visM()).every(v => !v));
await mov.setViewportSize({ width: 360, height: 800 }); await mov.waitForTimeout(200);
const tabs = await mov.evaluate(() => { const c = document.querySelector('.tab-btn').parentElement; return { tops: [...document.querySelectorAll('.tab-btn')].map(e => Math.round(e.getBoundingClientRect().top)), sw: c.scrollWidth, cw: c.clientWidth, txt: [...document.querySelectorAll('.tab-btn')].map(e => e.innerText.trim()) }; });
check('360: las cuatro pestañas en una línea, sin scroll horizontal', new Set(tabs.tops).size === 1 && tabs.sw <= tabs.cw, JSON.stringify(tabs));
check('360: con los nombres cortos', tabs.txt.join('|') === 'Proyección|Caja|Rentabilidad|Parámetros', tabs.txt.join('|'));
await mov.click('#langBtn');
check('360: y en inglés', (await mov.evaluate(() => [...document.querySelectorAll('.tab-btn')].map(e => e.innerText.trim()).join('|'))) === 'Projection|Cash|Returns|Parameters');
check('móvil sin errores de consola', errsM.length === 0, errsM[0] ?? '');
await mov.close();
await p.setViewportSize({ width: 420, height: 900 });
await p.waitForTimeout(400);
await p.locator('main').screenshot({ path: salida('v3movil.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
