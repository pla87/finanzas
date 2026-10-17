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
check('la amortización acelerada del préstamo nace marcada, la de la hipoteca no',
  !(await p.isChecked('#hipotecaAcelerada')) && (await p.isChecked('#prestamoAcelerado')));
await p.fill('#comision', '10000'); await p.press('#comision', 'Tab');
const sinIva = await p.evaluate(() => calcular().gastosCompra);
await p.check('#ivaComision');
const conIva = await p.evaluate(() => calcular().gastosCompra);
check('marcarlo suma el 21% de la comisión', Math.abs(conIva - sinIva - 2100) < 0.01, `${sinIva} → ${conIva}`);

// --- compartir: los cálculos viajan en la dirección y vuelven iguales ---
await p.fill('#descuentoOferta', '8'); await p.dispatchEvent('#descuentoOferta', 'input'); await p.press('#descuentoOferta', 'Tab');
await p.fill('#alquiler', '1.750'); await p.press('#alquiler', 'Tab');
const url = await p.evaluate(() => enlaceConCalculos());
check('el enlace lleva solo lo que cambia, con claves cortas',
  url.includes('al=1750') && url.includes('iv=1') && url.includes('de=8') && !url.includes('alquiler=') && !url.includes('ivaComision=') && !/[?&]ib=/.test(url), url);
// La tabla de equivalencias: cada campo y casilla tiene la suya, de 1 a 3 letras, sin repetirse
// ni coincidir con el nombre largo de otro (que también se acepta al leer).
const tabla = await p.evaluate(() => ({ t: CLAVES_CORTAS, ids: [...CAMPOS, ...CASILLAS] }));
const cortas = Object.values(tabla.t);
check('toda entrada tiene clave corta de 1 a 3 letras', tabla.ids.every(id => /^[a-z]{1,3}$/.test(tabla.t[id] ?? '')),
  tabla.ids.filter(id => !/^[a-z]{1,3}$/.test(tabla.t[id] ?? '')).join());
check('y no hay dos iguales', new Set(cortas).size === cortas.length);
check('ninguna coincide con un nombre largo', cortas.every(k => !tabla.ids.includes(k)));
const q = url.slice(url.indexOf('?'));
const p2 = await abrir(q);
const [a, c] = await Promise.all([p, p2].map(x => x.evaluate(() => {
  const d = calcular(); return [d.oferta, d.gastosCompra, d.alquilerAnual, d.ultima.anualizada].map(v => Math.round(v * 1e6));
})));
check('quien abre el enlace ve los mismos cálculos', JSON.stringify(a) === JSON.stringify(c), `${a} / ${c}`);
check('y la dirección queda limpia', !p2.url().includes('?'), p2.url());
// Los enlaces que ya circulan, con los nombres largos, siguen abriéndose igual.
const largo = await abrir('?descuentoOferta=8&oferta=239200&alquiler=1750&comision=10000&ivaComision=1');
const [cl, cc] = await Promise.all([p2, largo].map(x => x.evaluate(() => { const d = calcular(); return [d.oferta, d.gastosCompra, d.alquilerAnual].map(v => Math.round(v * 1e6)); })));
check('los nombres largos de los enlaces antiguos también valen', JSON.stringify(cl) === JSON.stringify(cc), `${cl} / ${cc}`);
const p3 = await abrir('?alquiler=900&inventado=1&ccaa=%3Cimg%3E');
check('las claves que no existen se ignoran', await p3.evaluate(() => parseNum(document.getElementById('alquiler').value)) === 900);

// --- el texto que acompaña al enlace ---
await p.evaluate(() => resetDefaults());
const compartido = await p.evaluate(async () => {
  const envios = [];
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (datos) => { envios.push(datos); } });
  compartir(true); compartir(false);
  const calculos = envios[0], herramienta = envios[1];
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  let copiado = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (x) => { copiado = x; } } });
  compartir(true);
  await new Promise(r => setTimeout(r, 50));
  return { calculos, herramienta, copiado };
});
check('con cálculos, el mensaje lleva las cifras y el enlace va aparte',
  /247\.000.*1\.250.*bruta 5,3%.*caja.*\/mes.*anualizada a 30 años 6,8%/.test(compartido.calculos.text) && compartido.calculos.url.startsWith('https://pacolucena.com/calculadora/'),
  compartido.calculos.text);
check('la herramienta sola lleva un texto genérico y su dirección',
  /alquiler residencial/.test(compartido.herramienta.text) && compartido.herramienta.url === 'https://pacolucena.com/calculadora/', compartido.herramienta.text);
check('sin navigator.share se copia texto y enlace juntos',
  compartido.copiado && compartido.copiado.startsWith(compartido.calculos.text) && compartido.copiado.includes('https://pacolucena.com/calculadora/'), String(compartido.copiado).replace('\n', ' ⏎ '));
await p.evaluate(() => { document.getElementById('langBtn').click(); });
const enTexto = await p.evaluate(() => textoCompartido(true));
check('el mensaje sale en el idioma activo', /flat rented at .*\/month: gross yield/.test(enTexto), enTexto);
await p.evaluate(() => { document.getElementById('langBtn').click(); });

// --- el tipo alto del préstamo se pone en rojo por encima del 10% ---
const alto = async (tipo) => p.evaluate((x) => {
  document.getElementById('tipoPrestamo').value = x; render();
  const rojo = (e) => e.classList.contains('val-neg');
  return { visible: !document.getElementById('altoPrestamo').classList.contains('hidden'),
    etiqueta: rojo(document.getElementById('lblTipoPrestamo')), caja: rojo(document.getElementById('tipoPrestamo')),
    color: getComputedStyle(document.getElementById('tipoPrestamo')).color,
    rosa: getComputedStyle(document.documentElement).getPropertyValue('--brand-rose').trim(),
    texto: document.getElementById('altoPrestamo').textContent.trim() };
}, tipo);
const a9 = await alto('9,00'), a10 = await alto('10,00'), a11 = await alto('11,00');
check('al 9% y al 10% no hay aviso', !a9.visible && !a10.visible && !a9.etiqueta && !a10.caja);
check('por encima del 10% aparece (ALTO) y etiqueta y caja se ponen en rojo',
  a11.visible && a11.etiqueta && a11.caja && a11.texto === '(ALTO)', JSON.stringify(a11));
check('el texto de la caja es de verdad rojo', a11.color === `rgb(${a11.rosa.split(' ').join(', ')})`, `${a11.color} / ${a11.rosa}`);
check('al volver a 9% desaparece', !(await alto('9,00')).visible);
await p.evaluate(() => document.getElementById('langBtn').click());
check('en inglés es (HIGH)', (await alto('12,00')).texto === '(HIGH)');
await p.evaluate(() => document.getElementById('langBtn').click());
await alto('9,00');

// --- la horquilla de revalorización ---
const hor = await p.evaluate(() => {
  const fila = [...document.querySelectorAll('#tblRentabilidad tr')].find(tr => /según revalorización/.test(tr.textContent));
  const antes = JSON.stringify(leerEstado());
  render();
  const despues = JSON.stringify(leerEstado());
  const num = (t) => parseFloat(t.replace('%', '').replace(',', '.'));
  const valores = fila ? [...fila.cells[1].querySelectorAll('span')].map(e => num(e.textContent)) : [];
  const d = calcular();
  return { hay: !!fila, etiqueta: fila?.cells[0].textContent, valores, titulo: fila?.cells[0].querySelector('span').title,
    base: d.filaRef.anualizada * 100, intacto: antes === despues };
});
check('hay una fila de anualizada según revalorización', hor.hay, hor.etiqueta);
check('con tres valores, de menor a mayor', hor.valores.length === 3 && hor.valores[0] < hor.valores[1] && hor.valores[1] < hor.valores[2], hor.valores.join(' · '));
check('el del medio coincide con la anualizada del año de referencia (revalorización = inflación)', Math.abs(hor.valores[1] - hor.base) < 0.06, `${hor.valores[1]} vs ${hor.base.toFixed(2)}`);
check('lleva su explicación', /pesimista/.test(hor.titulo ?? '') && /2,50%/.test(hor.titulo ?? ''), hor.titulo);
check('sondear no deja ningún campo ni casilla tocado', hor.intacto);
// Con la revalorización desbloqueada y en otro valor, la horquilla sigue anclada a 0 · inflación · +2 puntos
// y el campo no se mueve.
const libre = await p.evaluate(() => {
  alternarBloqueo('revalorizacion'); document.getElementById('revalorizacion').value = '6,00'; render();
  const fila = [...document.querySelectorAll('#tblRentabilidad tr')].find(tr => /según revalorización/.test(tr.textContent));
  const v = [...fila.cells[1].querySelectorAll('span')].map(e => e.textContent);
  const r = { v, campo: document.getElementById('revalorizacion').value, auto: document.getElementById('autoRevalorizacion').checked,
    roce: [...document.querySelectorAll('#tblRentabilidad tr')].find(tr => /ROCE con/.test(tr.textContent)).cells[0].textContent };
  alternarBloqueo('revalorizacion');
  return r;
});
check('con la revalorización suelta el campo y la casilla no se tocan', libre.campo === '6,00' && libre.auto === false, `${libre.campo} · auto ${libre.auto}`);
check('y la fila del ROCE nombra la revalorización usada', /\(\+ 6,00%\)/.test(libre.roce), libre.roce.replace(/\s+/g, ' '));
check('ya no hay fila de revalorización suelta ni de multiplicador', await p.evaluate(() => !/^\+ Revalorización|Multiplicador|Multiple/m.test([...document.querySelectorAll('#tblRentabilidad tr')].map(tr => tr.cells[0].textContent.trim()).join('\n'))));

// --- el sexto indicador ---
const anos = await p.evaluate(() => ({
  valor: document.getElementById('kpiAnosAlquiler').textContent.trim(),
  detalle: document.getElementById('kpiAnosAlquilerDetalle').textContent.replace(/\s/g, ' '),
  titulo: document.querySelector('[data-i18n="kpiAnosAlquiler"]').title, etiqueta: document.querySelector('[data-i18n="kpiAnosAlquiler"]').textContent,
  tarjetas: document.querySelectorAll('section.grid > div').length,
  anchos: [...document.querySelectorAll('section.grid > div')].map(d => Math.round(d.getBoundingClientRect().width)),
  tops: [...document.querySelectorAll('section.grid > div')].map(d => Math.round(d.getBoundingClientRect().top)) }));
check('seis indicadores en una sola fila y del mismo ancho', anos.tarjetas === 6 && new Set(anos.tops).size === 1 && new Set(anos.anchos).size === 1, `${anos.anchos} · ${anos.tops}`);
check('AÑOS DE ALQUILER = oferta / alquiler anual bruto, con un decimal', anos.etiqueta === 'AÑOS DE ALQUILER' && anos.valor === '16,5', anos.valor);
check('con su detalle y su explicación', /247\.000 € \/ 15\.000 €/.test(anos.detalle) && /15 a 25/.test(anos.titulo), anos.detalle);
await p.evaluate(() => { document.getElementById('alquiler').value = '0'; render(); });
check('sin alquiler no hay cifra', (await p.textContent('#kpiAnosAlquiler')).trim() === '—');
await p.evaluate(() => resetDefaults());

// --- la cabecera ya no guarda ni carga ficheros ---
check('sin botones de guardar ni cargar, y el de compartir va el último con dos iconos',
  await p.evaluate(() => !document.getElementById('btnGuardar') && !document.getElementById('btnCargar') && !document.getElementById('backupInput')
    && typeof exportData === 'undefined' && typeof importData === 'undefined'
    && document.querySelector('header button:last-of-type').id === 'btnCompartir'
    && document.getElementById('btnCompartir').textContent.trim() === '🔗💾'));
check('el modal de compartir lleva 🧮 y 💾', await p.evaluate(() => {
  const m = [...document.querySelectorAll('#shareModal button[onclick^="compartir"]')].map(b => b.textContent);
  return m[0].includes('🧮') && m[1].includes('💾'); }));

check('sin errores de consola', [p, p2, p3, largo].every(x => x.errs.length === 0), [p, p2, p3, largo].flatMap(x => x.errs).join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
