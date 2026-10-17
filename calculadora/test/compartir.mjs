// Lo que cambió en la interfaz de la versión con casillas y enlace para compartir: el recálculo
// que espera a tener una cifra razonable, la casilla del IVA y los cálculos que viajan en la
// dirección.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const abrir = async (sufijo = '') => {
  const p = await ctx.newPage();
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(PAGINA + sufijo); await p.waitForTimeout(500);
  return p;
};
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(56)} ${d}`); };

const p = await abrir();
await p.evaluate(() => { localStorage.clear(); resetDefaults(); });
const kpi = () => p.textContent('#kpiBruta');

// --- no recalcula con la cifra a medio escribir ---
const antes = await kpi();
await p.fill('#alquiler', ''); await p.type('#alquiler', '9');
check('con una cifra de alquiler no recalcula', (await kpi()) === antes, `${antes} → ${await kpi()}`);
await p.type('#alquiler', '50');
const con950 = await kpi();
check('con tres cifras sí', con950 !== antes, `${antes} → ${con950}`);
await p.fill('#alquiler', ''); await p.type('#alquiler', '2');
await p.press('#alquiler', 'Tab');
check('y al salir del campo, aunque sea una', (await kpi()) !== con950, await kpi());
await p.evaluate(() => resetDefaults());

// --- el IVA de la comisión es una casilla, desmarcada de partida ---
check('el IVA nace desmarcado', !(await p.isChecked('#ivaComision')));
check('las amortizaciones aceleradas nacen desmarcadas',
  !(await p.isChecked('#hipotecaAcelerada')) && !(await p.isChecked('#prestamoAcelerado')));
await p.fill('#comision', '10000'); await p.press('#comision', 'Tab');
const sinIva = await p.evaluate(() => calcular().gastosCompra);
await p.check('#ivaComision');
const conIva = await p.evaluate(() => calcular().gastosCompra);
check('marcarlo suma el 21% de la comisión', Math.abs(conIva - sinIva - 2100) < 0.01, `${sinIva} → ${conIva}`);

// --- compartir: los cálculos viajan en la dirección y vuelven iguales ---
await p.fill('#descuentoOferta', '8'); await p.dispatchEvent('#descuentoOferta', 'input'); await p.press('#descuentoOferta', 'Tab');
await p.fill('#alquiler', '1.750'); await p.press('#alquiler', 'Tab');
const url = await p.evaluate(() => enlaceConCalculos());
check('el enlace lleva solo lo que cambia', !url.includes('ibi=') && url.includes('alquiler=1750') && url.includes('ivaComision=1'), url);
const q = url.slice(url.indexOf('?'));
const p2 = await abrir(q);
const [a, c] = await Promise.all([p, p2].map(x => x.evaluate(() => {
  const d = calcular(); return [d.oferta, d.gastosCompra, d.alquilerAnual, d.ultima.anualizada].map(v => Math.round(v * 1e6));
})));
check('quien abre el enlace ve los mismos cálculos', JSON.stringify(a) === JSON.stringify(c), `${a} / ${c}`);
check('y la dirección queda limpia', !p2.url().includes('?'), p2.url());
const p3 = await abrir('?alquiler=900&inventado=1&ccaa=%3Cimg%3E');
check('las claves que no existen se ignoran', await p3.evaluate(() => parseNum(document.getElementById('alquiler').value)) === 900);

check('sin errores de consola', [p, p2, p3].every(x => x.errs.length === 0), [p, p2, p3].flatMap(x => x.errs).join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
