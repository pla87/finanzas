import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
await p.evaluate(() => { localStorage.clear(); resetDefaults(); });
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(48)} ${d}`); };

await p.click('#btnFaq'); await p.waitForTimeout(200);
check('el modal se abre', await p.isVisible('#faqModal'));
const preguntas = await p.evaluate(() => [...document.querySelectorAll('#faqCuerpo summary')].map(s => s.textContent));
// Las dos listas, es y en, tienen que llevar las mismas preguntas: una pregunta nueva escrita
// en un solo idioma es el fallo fácil aquí.
const cuantas = await p.evaluate(() => ({ es: FAQ.es.length, en: FAQ.en.length }));
check('el mismo número de preguntas en los dos idiomas', cuantas.es === cuantas.en, `es ${cuantas.es} · en ${cuantas.en}`);
check('y todas pintadas', preguntas.length === cuantas.es, String(preguntas.length));
console.log(preguntas.map((q,i) => `        ${i+1}. ${q}`).join('\n'));

// La tabla en vivo del apalancamiento
await p.evaluate(() => document.querySelectorAll('#faqCuerpo details').forEach(d => d.open = true));
const tabla = await p.evaluate(() => [...document.querySelectorAll('#faqApalancamiento tr')].map(r => [...r.cells].map(c => c.textContent.trim())));
console.log('\n   tabla en vivo:'); tabla.forEach(f => console.log('     ', f.join(' | ')));
// Después de impuestos, como el coste de la deuda: la rentabilidad neta tras IRPF (3,72 %) más la
// revalorización (2,50 %). Antes era la renta antes de IRPF, un 6,76 %.
check('rinde el piso 6,22% después de impuestos', tabla[0][1] === '6,22%', tabla[0][1]);
check('hipoteca al 2,17% tras deducir', tabla[1][1] === '2,17%', tabla[1][1]);
check('la hipoteca suma', tabla[1][2].includes('suma'), tabla[1][2]);
check('préstamo al 6,98% tras deducir', tabla[2][1] === '6,98%', tabla[2][1]);
check('el préstamo resta', tabla[2][2].includes('resta'), tabla[2][2]);

// Debe seguir al escenario: con la hipoteca al 9% pasa a restar
await p.evaluate(() => { document.getElementById('tipoHipoteca').value = '9'; render(); });
const t2 = await p.evaluate(() => [...document.querySelectorAll('#faqApalancamiento tr')][1].cells[2].textContent);
check('con la hipoteca al 9% pasa a restar', t2.includes('resta'), t2.trim());
await p.evaluate(() => { document.getElementById('tipoHipoteca').value = '2,80'; render(); });

// Las cifras que el texto de las preguntas cita del escenario de ejemplo. Se calculan con la
// propia página -motor y formato- y se buscan en el texto, en los dos idiomas: si alguien cambia
// un valor por defecto o corrige el motor y no repasa la FAQ, falla aquí y no en la cabeza de un
// lector. Las preguntas se localizan por su posición (las dos listas llevan el mismo orden, y el
// recuento de arriba lo vigila): 0 apalancamiento, 2 caja, 3 ruptura, 5 amortizar, 8 vender.
const cifrasFaq = (idioma) => p.evaluate((idioma) => {
  aplicarIdioma(idioma);
  resetDefaults();
  const llano = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/[-−]/g, '−');
  // El espacio de «10.117 €» es un espacio duro: se normaliza igual que el texto.
  const norm = (x) => x.replace(/\s+/g, ' ').replace(/[-−]/g, '−');
  const texto = (i) => llano(FAQ[idioma][i].a);
  const financiando = (pct) => { el('pctFinanciado').value = String(pct); render(); return calcular(); };
  const e = idioma === 'es'
    ? { a: ' a ', al: ' al ', veces: (a, b, n) => `${a} veces el primer año a ${b} el último, y el pico cae sobre el año ${n}`,
        sobre: (n) => `por encima del ${n}%`, venta1: (v) => `vender el primer año deja una anualizada del ${v}`,
        pos: (n) => `no se pone en positivo hasta el año ${n}`, pico: (n, v) => `máximo sobre el año ${n} con un ${v}`,
        brecha: (n) => `Empieza en ${n} puntos`, base: (c, v, d) => `ha bajado de ${c} a ${v}, y la ganancia que tributa es esos ${d} mayor`,
        tipo: (a, b) => `al ${a}% y el piso rinde más que eso, cada euro que metes en amortizar renta un ${b}%` }
    : { a: ' to ', al: ' to ', veces: (a, b, n) => `${a}× in year one to ${b} in the last, and the peak lands around year ${n}`,
        sobre: (n) => `above ${n}%`, venta1: (v) => `selling in year one gives an annualised ${v}`,
        pos: (n) => `does not turn positive until year ${n}`, pico: (n, v) => `peaks around year ${n} at ${v}`,
        brecha: (n) => `starts at ${n} points`, base: (c, v, d) => `fallen from ${c} to ${v}, and the taxable gain is ${d} larger`,
        tipo: (a, b) => `at ${a}% and the flat earns more than that, every euro you put into repayment earns ${b}%` };
  const obtenidas = [];
  const hay = (nombre, i, esperado) => obtenidas.push({ nombre, esperado: norm(esperado), ok: texto(i).includes(norm(esperado)) });

  // Pregunta 2: la caja, el ROCE y la anualizada del año de referencia (30) al 0, 70 y 100 % financiado.
  const k = [0, 70, 100].map(financiando);
  const roce = (d) => fmtPct(d.roceSinReval), anual = (d) => fmtPct(d.filaRef.anualizada);
  hay('caja 0 → 70 %', 2, `${fmt(k[0].regimenInicial.caja)}${e.a}${fmt(k[1].regimenInicial.caja)}`);
  hay('ROCE sin revalorización 0 → 70 %', 2, `${roce(k[0])}${e.al}${roce(k[1])}`);
  hay('anualizada 0 → 70 %', 2, `${anual(k[0])}${e.al}${anual(k[1])}`);
  hay('caja al 100 %', 2, fmt(k[2].regimenInicial.caja));
  hay('anualizada al 100 %', 2, anual(k[2]));

  // Pregunta 3: el porcentaje financiado a partir del cual la caja del primer año se vuelve negativa.
  let bajo = 0, alto = 100;
  for (let i = 0; i < 40; i++) { const m = (bajo + alto) / 2; if (financiando(m).regimenInicial.caja > 0) bajo = m; else alto = m; }
  hay('ruptura de caja', 3, e.sobre(Math.floor(bajo)));

  // Preguntas 0, 5 y 8, con el escenario tal cual viene.
  const d = financiando(70);
  const act = (f) => (d.valor + d.reforma) * Math.pow(1 + d.revalorizacion, f.n);
  const apal = (f) => fmtNum(act(f) / (act(f) - f.deuda), 1);
  const pico = (clave) => d.filas.reduce((m, f) => f[clave] > m[clave] ? f : m);
  hay('apalancamiento y año del pico', 0, e.veces(apal(d.filas[0]), apal(d.ultima), pico('anualizada').n));
  const neto = d.tipoHip * (1 - d.tipoEfectivo);
  hay('tipo de la hipoteca y su coste neto', 5, e.tipo(fmtNum(d.tipoHip * 100, 1), fmtNum(neto * 100, 1)));
  hay('venta en el año 1', 8, e.venta1(fmtPct(d.filas[0].tirVenta)));
  hay('primer año en positivo vendiendo', 8, e.pos(d.filas.find(f => f.tirVenta > 0).n));
  hay('óptimo de venta', 8, e.pico(pico('tirVenta').n, fmtPct(pico('tirVenta').tirVenta)));
  const brecha = (f) => (f.anualizada - f.tirVenta) * 100;
  hay('brecha del año 1', 8, e.brecha(Math.round(brecha(d.filas[0]))));
  obtenidas.push({ nombre: 'brecha a los 30 años, menos de un punto', esperado: '< 1', ok: brecha(d.ultima) < 1 });
  const deducido = Math.min(d.amortizacion * 30, d.baseAmortizable);
  hay('valor de adquisición tras 30 años', 8, e.base(fmt(d.costeTotal), fmt(d.costeTotal - deducido), fmt(deducido)));
  // La ayuda: el punto de partida de la parte que tributa es el campo de fábrica.
  const ayuda = llano(t('ayudaIrpf'));
  const base = fmtNum(num('baseTributable'));
  obtenidas.push({ nombre: 'ayuda: la parte que tributa arranca en el valor de fábrica', esperado: base,
    ok: ayuda.includes(idioma === 'es' ? `arranca en el ${base} %` : `starts at ${base}%`) });

  aplicarIdioma('es');
  resetDefaults();
  return obtenidas;
}, idioma);
for (const idioma of ['es', 'en']) {
  for (const c of await cifrasFaq(idioma)) check(`FAQ ${idioma}: ${c.nombre}`, c.ok, c.ok ? c.esperado : `no aparece «${c.esperado}»`);
}
await p.evaluate(() => { document.querySelectorAll('#faqCuerpo details').forEach(d => d.open = true); });

// Idioma. El modal tapa la cabecera, así que se cierra antes, igual que haría cualquiera.
await p.evaluate(() => closeModal('faqModal'));
await p.click('#langBtn'); await p.waitForTimeout(300);
await p.click('#btnFaq'); await p.waitForTimeout(200);
const enq = await p.evaluate(() => document.querySelector('#faqCuerpo summary').textContent);
check('el FAQ cambia de idioma', /Why does the annualised/.test(enq), enq);
const tEn = await p.evaluate(() => { document.querySelectorAll('#faqCuerpo details').forEach(d => d.open = true);
  return [...document.querySelectorAll('#faqApalancamiento tr')][1].cells[2].textContent; });
check('la tabla en vivo también', tEn.includes('adds'), tEn.trim());
await p.evaluate(() => closeModal('faqModal'));
await p.click('#langBtn'); await p.waitForTimeout(300);
await p.click('#btnFaq'); await p.waitForTimeout(200);

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await p.evaluate(() => { document.querySelectorAll('#faqCuerpo details').forEach((d,i) => d.open = i < 4); });
await p.locator('#faqModal > div').screenshot({ path: salida('faq.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
