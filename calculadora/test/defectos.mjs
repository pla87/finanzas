// Los valores por defecto de las tasas de gasto cambiaron (IBI 0,24 → 0,2 % del precio;
// mantenimiento 5 → 2 % del alquiler). Un enlace sólo lleva lo que difiere del ejemplo, así que un
// enlace antiguo que los omitía cambiaría de significado: por eso los enlaces nuevos llevan «ver=2»
// y, sin esa marca, se leen con los defectos de antes.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const abrir = async (sufijo = '') => {
  const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(PAGINA + sufijo); await p.waitForTimeout(400);
  return p;
};
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(72)} ${d}`); };
const leer = (p) => p.evaluate(() => ({ ibi: document.getElementById('tasaIbi').value, man: document.getElementById('tasaMantenimiento').value,
  ibiE: document.getElementById('ibi').value, manE: document.getElementById('mantenimiento').value, alq: document.getElementById('alquiler').value }));

const nueva = await abrir();
await nueva.evaluate(() => localStorage.clear()); await nueva.reload(); await nueva.waitForTimeout(400);
let v = await leer(nueva);
check('el escenario de ejemplo trae IBI 0,2 % y mantenimiento 2 %', v.ibi === '0,2' && v.man === '2', JSON.stringify(v));
check('  y de ahí salen 494 € de IBI y 300 € de mantenimiento', v.ibiE === '494' && v.manE === '300', JSON.stringify(v));
const enlace = await nueva.evaluate(() => { document.getElementById('alquiler').value = '1500'; render(); return enlaceConCalculos(); });
check('los enlaces nuevos llevan ver=2 y no repiten los defectos', /[?&]ver=2(&|$)/.test(enlace) && !/[?&]xb=/.test(enlace) && !/[?&]xm=/.test(enlace), enlace);
const consulta = enlace.slice(enlace.indexOf('?'));
await nueva.close();

let p = await abrir(consulta);
v = await leer(p);
check('un enlace nuevo se abre con los defectos nuevos', v.ibi === '0,2' && v.man === '2' && v.alq === '1.500', JSON.stringify(v));
await p.close();

p = await abrir('?a=1500');
v = await leer(p);
check('un enlace antiguo (sin ver) conserva el 0,24 % y el 5 %', v.ibi === '0,24' && v.man === '5', JSON.stringify(v));
check('  y las cifras que de ellos salen (IBI 593 €, mantenimiento 900 €)', v.ibiE === '593' && v.manE === '900', JSON.stringify(v));
await p.close();

p = await abrir('?a=1500&ver=1');
check('ver=1 explícito se lee igual que sin marca', (await leer(p)).ibi === '0,24');
await p.close();

p = await abrir('?a=1500&xb=0.3');
v = await leer(p);
check('un enlace antiguo que fija una sola tasa respeta la suya y la antigua de la otra', v.ibi === '0,3' && v.man === '5', JSON.stringify(v));
await p.close();

p = await abrir('?a=1500&xb=0.24&xm=5&ver=2');
v = await leer(p);
check('un enlace nuevo con 0,24 y 5 escritos a propósito los respeta', v.ibi === '0,24' && v.man === '5', JSON.stringify(v));
await p.close();

p = await abrir('?a=1500&zb=0');
v = await leer(p);
check('un enlace antiguo con el IBI desbloqueado y su valor de defecto sigue en 593 €', v.ibiE === '593', JSON.stringify(v));
await p.close();

p = await abrir('?tema=d');
v = await leer(p);
check('un enlace sin cifras (sólo el tema) no cambia nada: defectos nuevos', v.ibi === '0,2' && v.man === '2', JSON.stringify(v));
await p.close();

p = await abrir('?a=1500&ibi=0.5');
check('los nombres largos antiguos se siguen aceptando junto a los defectos antiguos', (await leer(p)).ibi === '0,24');
await p.close();

// Ida y vuelta: quien ponga 0,24 a mano lo conserva al compartir.
p = await abrir();
const enlace2 = await p.evaluate(() => { document.getElementById('tasaIbi').value = '0.24'; document.getElementById('alquiler').value = '1500'; render(); return enlaceConCalculos(); });
check('0,24 puesto a mano viaja en el enlace (ya no es el defecto)', /[?&]xb=0\.24(&|$)/.test(enlace2), enlace2);
await p.close();
p = await abrir(enlace2.slice(enlace2.indexOf('?')));
check('  y vuelve como 0,24', (await leer(p)).ibi === '0,24');
await p.close();

// Lo guardado en el navegador es explícito (guarda todos los campos), no «las diferencias»: no hay
// nada que reinterpretar, y quien tenía 0,24 guardado lo sigue teniendo hasta que pulse ♻️.
p = await abrir();
await p.waitForTimeout(800);   // que el guardado del arranque ya haya salido (pagehide no pisa lo escrito a mano)
await p.evaluate(() => { const e = JSON.parse(localStorage.getItem('calc_pisos_v2') || '{}'); Object.assign(e, { tasaIbi: '0.24', tasaMantenimiento: '5' }); localStorage.setItem('calc_pisos_v2', JSON.stringify(e)); });
await p.reload(); await p.waitForTimeout(400);
v = await leer(p);
check('lo guardado en el navegador con las tasas antiguas se conserva', v.ibi === '0,24' && v.man === '5', JSON.stringify(v));
await p.evaluate(() => resetDefaults());
v = await leer(p);
check('  y ♻️ trae los defectos nuevos', v.ibi === '0,2' && v.man === '2', JSON.stringify(v));
check('sin errores de consola', p.errs.length === 0, p.errs[0] ?? '');
await p.close();

await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
