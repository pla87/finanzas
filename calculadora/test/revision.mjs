// Los fallos que dejó una revisión del motor y de la interfaz, uno por bloque. Cada comprobación
// se escribió primero y se vio fallar con el código de entonces; aquí se quedan como guardia.
//
//  1  deuda que se cancela a mitad de año: se cobran los meses que quedan, no doce cuotas
//  2  la amortización fiscal topa en la base amortizable también durante la explotación
//  3  la base amortizable lleva los gastos de compra sólo en la proporción de construcción
//  4  el último tramo del ahorro es el 30 % desde 2025
//  5  los textos no hablan de «interés medio»: el motor deduce el interés de cada año
//  6  el año 0 resta la comisión de apertura
//  7  un enlace parcial recalcula oferta y descuento, y el descuento se lee con coma
//  8  modales accesibles, textos traducidos, «-0», selects inválidos y deflactor protegido
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const abrir = async (sufijo = '', antes = null) => {
  const p = await b.newPage({ viewport: { width: 1300, height: 1100 } });
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(PAGINA);
  await p.evaluate(() => localStorage.clear());
  if (antes) await p.evaluate(antes);
  await p.goto(PAGINA + sufijo); await p.waitForTimeout(400);
  return p;
};
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(76)} ${d}`); };
const p = await abrir();
const norm = s => String(s).replace(/[\s  ]+/g, ' ').trim();

// Escribe campos y casillas y devuelve lo que se pida del balance. Sin indexar y sin inflación por
// defecto, para que la caja de cada año sea ingresos − gastos − impuestos − cuotas sin factores.
const motor = (cfg, lector) => p.evaluate(([cfg, lector]) => {
  resetDefaults();
  const base = { indexar: 'no', inflacion: '0', ...cfg.campos };
  for (const [id, v] of Object.entries(base)) el(id).value = v;
  for (const [id, v] of Object.entries(cfg.casillas || {})) el(id).checked = v;
  for (const id of cfg.abrir || []) el('auto' + capitalizar(id)).checked = false;
  render();
  return new Function('d', 'return (' + lector + ')(d)')(calcular());
}, [cfg, lector]);

// Simulador de una deuda mes a mes, independiente del motor: devuelve lo pagado y el interés de un
// año a partir del saldo con que entra. El último pago es sólo lo que queda más su interés.
const SIM = `
  const sim = (ini, tipo, cuota) => {
    let s = ini, pagado = 0, interes = 0;
    for (let m = 0; m < 12 && s > 1e-9; m++) {
      const i = s * tipo / 12, pago = Math.min(cuota, s + i);
      s = s + i - pago; pagado += pago; interes += i;
    }
    return { pagado, interes, fin: s };
  };`;

// ---------- 1) deuda que se cancela a mitad de año ----------
// La cuota que cobró el año se saca de lo que ve cualquiera: alquiler − gastos − IRPF − caja.
const lectorCuotas = `(d) => { ${SIM}
  return d.filas.map(f => {
    const implicita = d.alquilerAnual - d.gastosAnuales - f.irpf - f.cajaAno;
    const h = sim(f.hipIni, d.tipoHip, d.cuotaHip), q = sim(f.preIni, d.tipoPre, d.cuotaPre);
    return { n: f.n, implicita, esperada: h.pagado + q.pagado, interesEsperado: h.interes + q.interes, interes: f.interes, hipIni: f.hipIni, hipFin: f.hipFin };
  });
}`;
const verCuotas = async (nombre, cfg, anoCancela) => {
  const filas = await motor(cfg, lectorCuotas);
  // El año 1 cuenta a medias y no se compara. Del 2 en adelante, la caja implícita tiene que dar
  // las cuotas del simulador al céntimo.
  const malas = filas.filter(f => f.n >= 2 && !(Math.abs(f.implicita - f.esperada) < 0.5));
  check(`${nombre}: cuotas cobradas = simulación mes a mes`, malas.length === 0,
    malas.slice(0, 2).map(f => `año ${f.n}: cobra ${f.implicita.toFixed(0)}, debería ${f.esperada.toFixed(0)}`).join(' · '));
  const f = filas[anoCancela - 1];
  check(`${nombre}: el año ${anoCancela} no cobra más de lo que se debe`, f.implicita <= f.hipIni * 1.05 + 1,
    `cobra ${f.implicita.toFixed(0)} con ${f.hipIni.toFixed(0)} de saldo`);
  const malosInt = filas.filter(x => !(Math.abs(x.interes - x.interesEsperado) < 0.5));
  check(`${nombre}: el interés de cada año es el de la simulación`, malosInt.length === 0,
    malosInt.slice(0, 2).map(x => `año ${x.n}: ${x.interes} vs ${x.interesEsperado.toFixed(0)}`).join(' · '));
};
await verCuotas('hipoteca a 10,5 años', { campos: { oferta: '247000', pctFinanciado: '50', plazoHipoteca: '10.5' } }, 11);
await verCuotas('amortización acelerada', {
  campos: { pctFinanciado: '40', alquiler: '1800', tipoHipoteca: '2.8', plazoHipoteca: '25' },
  casillas: { hipotecaAcelerada: true } }, 9);
await verCuotas('préstamo personal a 3,5 años', {
  campos: { importePrestamo: '20000', plazoPrestamo: '3.5', tipoPrestamo: '8' }, casillas: { usarPrestamo: true } }, 5);

// El reparto del dinero sigue cerrando sin residuo con el año partido.
const cierra = await motor({ campos: { oferta: '247000', pctFinanciado: '50', plazoHipoteca: '10.5' } },
  `(d) => { const r = d.reparto; return d.ingresosAcum + d.aportacionesExtra - (r.gastos + r.irpf + r.intereses + r.amortizacion + r.caja); }`);
check('el reparto cierra con una deuda que acaba a mitad de año', Math.abs(cierra) < 0.01, cierra.toFixed(4));

// ---------- 2) la amortización fiscal topa en la base amortizable ----------
// Sin deuda y todo construcción, la base fiscal del año n es ingresos − gastos − lo que se deduzca.
const tope = await motor({
  campos: { pctConstruccion: '100', tasaAmortizacion: '3', horizonte: '40', alquiler: '2500', reforma: '0', tipoMarginal: '40', baseTributable: '100' },
  casillas: { usarHipoteca: false } },
  `(d) => ({ base: d.baseAmortizable, am: d.amortizacion, tipo: d.tipoEfectivo,
     deduce: d.filas.map(f => (d.alquilerAnual - d.gastosAnuales) - f.irpf * (f.n === 1 ? 2 : 1) / d.tipoEfectivo) })`);
const esperadoDeduce = (n) => Math.min(tope.am, Math.max(tope.base - tope.am * (n - 1), 0));
const malaDeduccion = tope.deduce.map((x, i) => ({ n: i + 1, x, e: esperadoDeduce(i + 1) })).filter(o => Math.abs(o.x - o.e) > 0.01);
check('la deducción por amortización no pasa de la base restante', malaDeduccion.length === 0,
  malaDeduccion.slice(0, 2).map(o => `año ${o.n}: ${o.x.toFixed(0)} vs ${o.e.toFixed(0)}`).join(' · '));
check('y a partir del año 35 no se deduce nada', Math.abs(tope.deduce[39]) < 0.01, tope.deduce[39].toFixed(2));
check('la suma deducida es la base amortizable, ni un euro más', Math.abs(tope.deduce.reduce((a, x) => a + x, 0) - tope.base) < 0.05,
  `${tope.deduce.reduce((a, x) => a + x, 0).toFixed(0)} vs ${tope.base.toFixed(0)}`);

// ---------- 3) la base amortizable ----------
const baseA = await motor({ campos: { reforma: '20000', pctConstruccion: '60' } },
  `(d) => ({ base: d.baseAmortizable, esperada: 0.6 * (d.oferta + d.gastosCompra) + d.reforma, gastos: d.gastosCompra, am: d.amortizacion })`);
check('base = 60 % de (precio + gastos de compra) + reforma entera', Math.abs(baseA.base - baseA.esperada) < 0.01,
  `${baseA.base.toFixed(0)} vs ${baseA.esperada.toFixed(0)}`);
const baseB = await motor({ campos: { reforma: '20000', pctConstruccion: '0' } }, `(d) => ({ base: d.baseAmortizable, reforma: d.reforma })`);
check('sin construcción sólo se amortiza la reforma', Math.abs(baseB.base - baseB.reforma) < 0.01, baseB.base.toFixed(0));
// Coherencia con la venta: ahí los gastos de compra entran enteros en el valor de adquisición, y
// lo amortizado es lo que se resta de él.
const venta = await motor({ campos: { reforma: '20000' } },
  `(d) => d.filas.slice(0, 5).map(f => Math.abs(f.gananciaFiscal - Math.max(f.precioVenta - f.gastosVenta - (d.costeTotal - Math.min(d.amortizacion * f.n, d.baseAmortizable)), 0)))`);
check('la ganancia fiscal de la venta sigue la misma cuenta', venta.every(x => x < 0.01), venta.map(x => x.toFixed(2)).join(','));

// ---------- 4) el tramo del 30 % ----------
const tramos = await motor({ campos: { inflacion: '3' } }, `(d) => {
  const escala = (g) => { let c = 0, ant = 0; for (const [tope, tipo] of [[6000, .19], [50000, .21], [200000, .23], [300000, .27], [Infinity, .30]]) {
    const parte = Math.min(g - ant, tope - ant); if (parte <= 0) break; c += parte * tipo; ant = tope; } return c; };
  return d.filas.map(f => ({ n: f.n, g: f.gananciaFiscal, got: f.impuestoVenta, esp: escala(f.gananciaFiscal) }));
}`);
const malosTramos = tramos.filter(f => Math.abs(f.got - f.esp) > 0.01);
check('el impuesto de la venta sigue la escala con el 30 % arriba', malosTramos.length === 0,
  malosTramos.slice(0, 2).map(f => `año ${f.n} (${f.g.toFixed(0)}): ${f.got.toFixed(0)} vs ${f.esp.toFixed(0)}`).join(' · '));
check('hay años que superan los 300.000 € de ganancia (la prueba cubre el tramo)', tramos.some(f => f.g > 300000));
const avisoTipo = (v) => p.evaluate((v) => {
  resetDefaults(); el('autoPctGananciaVenta').checked = false; el('pctGananciaVenta').value = v; render();
  return el('pctGananciaVenta').classList.contains('val-neg');
}, v);
check('un tipo plano del 30 % no avisa', !(await avisoTipo('30')));
check('uno del 31 % sí', await avisoTipo('31'));
const textos28 = await p.evaluate(() => ['es', 'en'].flatMap(l => ['tipoGananciaTip', 'avisoGananciaVenta'].map(k => TEXTOS[l][k]))
  .concat([FAQ.es, FAQ.en].map(a => a.map(x => x.a).join(' '))));
check('ningún texto cita el 28 % como último tramo', textos28.every(s => !/\b28\s?%/.test(s)));
check('los textos de la escala citan el 30 %', textos28.slice(0, 4).every(s => /30\s?%/.test(s)));

// ---------- 5) los textos del interés ----------
const tx = await p.evaluate(() => {
  const claves = ['notaFiscal', 'baseFiscalTip', 'interesDeducibleTip', 'ayuda4'];
  return { es: claves.map(k => TEXTOS.es[k]), en: claves.map(k => TEXTOS.en[k]),
    faqEs: FAQ.es.map(x => x.a).join(' '), faqEn: FAQ.en.map(x => x.a).join(' '),
    clavesMuertas: ['interesMedioHip'].filter(k => k in TEXTOS.es || k in TEXTOS.en) };
});
check('en castellano ninguno habla de interés medio ni de aproximar', tx.es.every(s => !/interés medio|su media|la media/i.test(s)));
check('en inglés tampoco', tx.en.every(s => !/average|approximated/i.test(s)));
check('las FAQ no dicen que el interés deducible es una media', !/El interés deducible es la media/.test(tx.faqEs) && !/Deductible interest is an average/.test(tx.faqEn));
check('y dicen que se deduce el de cada año', /interés (que se paga|pagado|de cada año)/i.test(tx.faqEs) && /(each year|year's own|paid each year|paid that year)/i.test(tx.faqEn));
check('no queda la clave interesMedioHip, que nadie lee', tx.clavesMuertas.length === 0, tx.clavesMuertas.join());
const nota = await p.evaluate(() => { resetDefaults(); render(); return el('notaFiscal').textContent; });
check('la nota fiscal enseña «interés» a secas', /de interés/.test(nota) && !/medio/.test(nota), nota.slice(0, 80));

// ---------- 6) el año 0 resta la comisión de apertura ----------
const f0 = await motor({ campos: { aperturaHip: '1' } },
  `(d) => ({ g: d.fila0.ganancia, esperada: d.fila0.patrimonio - d.aportado, com: d.comisionApertura })`);
check('con comisión de apertura, ganancia del año 0 = patrimonio − aportado', f0.com > 0 && Math.abs(f0.g - f0.esperada) < 0.01,
  `${f0.g.toFixed(0)} vs ${f0.esperada.toFixed(0)} (comisión ${f0.com.toFixed(0)})`);

// ---------- 7) enlaces parciales ----------
const enlace = async (q, antes) => {
  const d = await abrir(q, antes);
  const r = await d.evaluate(() => ({ of: el('oferta').value, de: el('descuentoOferta').value, pr: el('precioAnunciado').value }));
  await d.close(); return r;
};
let r = await enlace('?pr=300000&of=280000');
check('?pr=300000&of=280000 → descuento 6,67', r.de === '6,67', JSON.stringify(r));
r = await enlace('?pr=300000');
check('?pr=300000 (sin oferta) → el descuento sale de la oferta que quedó', r.de === '17,67' && r.of === '247.000', JSON.stringify(r));
r = await enlace('?pr=300000&d=7.5');
check('?pr=300000&d=7.5 → oferta 277.500 y descuento «7,5» con coma', r.of === '277.500' && r.de === '7,5', JSON.stringify(r));
r = await enlace('?pr=300000&of=277500&d=7.5');
check('con oferta y descuento a la vez, el descuento también lleva coma', r.de === '7,5' && r.of === '277.500', JSON.stringify(r));
r = await enlace('?pr=300000&of=280000&ver=1');
check('un enlace antiguo (sin ver) se arregla igual', r.de === '6,67', JSON.stringify(r));
r = await enlace('?h=20');
check('un enlace que no toca la compra deja el 5 % de siempre', r.de === '5' && r.of === '247.000', JSON.stringify(r));

// ---------- 8) pequeños ----------
// 8a) modales
const modales = [['btnFaq', 'faqModal'], ['btnAyuda', 'helpModal'], ['btnCompartir', 'shareModal']];
for (const [boton, id] of modales) {
  await p.evaluate(() => resetDefaults());
  await p.click('#' + boton); await p.waitForTimeout(100);
  const e = await p.evaluate((id) => {
    const m = document.getElementById(id), d = m.querySelector('[role="dialog"]');
    const rotulo = d && d.getAttribute('aria-labelledby') && document.getElementById(d.getAttribute('aria-labelledby'));
    return { abierto: m.classList.contains('flex'), rol: !!d, aria: d && d.getAttribute('aria-modal') === 'true',
      rotulo: !!rotulo && rotulo.textContent.trim().length > 0, foco: m.contains(document.activeElement) && document.activeElement !== m,
      x: m.querySelector('button[aria-label]')?.getAttribute('aria-label') };
  }, id);
  check(`${id}: abre con role=dialog, aria-modal y título`, e.abierto && e.rol && e.aria && e.rotulo, JSON.stringify(e));
  check(`${id}: el foco entra en el modal`, e.foco);
  check(`${id}: el ✕ lleva aria-label`, !!e.x && e.x.length > 0, String(e.x));
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  check(`${id}: el tabulador no se escapa del modal`, await p.evaluate((id) => document.getElementById(id).contains(document.activeElement), id));
  await p.keyboard.press('Escape'); await p.waitForTimeout(80);
  const c = await p.evaluate((boton) => ({ cerrados: !document.querySelector('[id$="Modal"].flex'), foco: document.activeElement.id === boton }), boton);
  check(`${id}: Escape lo cierra`, c.cerrados);
  check(`${id}: y el foco vuelve al botón que lo abrió`, c.foco);
  await p.evaluate((id) => closeModal(id), id);   // si Escape no lo cerró, que el resto de la prueba siga
}
await p.click('#btnFaq'); await p.waitForTimeout(80);
await p.click('#faqModal button[aria-label]'); await p.waitForTimeout(80);
check('el ✕ también cierra y devuelve el foco', await p.evaluate(() => !document.querySelector('[id$="Modal"].flex') && document.activeElement.id === 'btnFaq'));
const etiquetas = await p.evaluate(() => { const r = {};
  aplicarIdioma('es'); r.es = [...document.querySelectorAll('[id$="Modal"] button[aria-label]')].map(x => x.getAttribute('aria-label'));
  aplicarIdioma('en'); r.en = [...document.querySelectorAll('[id$="Modal"] button[aria-label]')].map(x => x.getAttribute('aria-label'));
  aplicarIdioma('es'); return r; });
check('el aria-label del ✕ está traducido', etiquetas.es.length === 3 && etiquetas.en.length === 3 && etiquetas.es[0] !== etiquetas.en[0], JSON.stringify(etiquetas));

// 8b) textos fijos en español
const unidades = await p.evaluate(() => {
  aplicarIdioma('en');
  const ids = ['tasaSeguroHogar', 'tasaMantenimiento', 'tasaComunidad', 'tasaImpagos', 'tasaIbi'];
  const r = { uds: ids.map(i => el(i).closest('.control').querySelector('.unidad').textContent),
    lim: ids.map(i => fmtLimite(5, LIMITES[i])) };
  el('ccaa').value = 'cataluna'; render(); r.escala = el('notaEscala').textContent;
  aplicarIdioma('es'); render(); r.escalaEs = el('notaEscala').textContent;
  el('ccaa').value = 'madrid'; render();
  return r;
});
const resto = /\b(año|alquiler|precio|mensualid|hasta|luego| y )\b/i;
check('en inglés las unidades de los campos no quedan en español', unidades.uds.every(s => !resto.test(s)), unidades.uds.join(' | '));
check('ni las de los avisos de límite', unidades.lim.every(s => !resto.test(s)), unidades.lim.join(' | '));
check('la nota de la escala autonómica va en inglés', /up to €600,000/.test(unidades.escala) && !/hasta|luego/.test(unidades.escala), unidades.escala);
check('y en castellano conserva el suyo', /hasta 600\.000/.test(unidades.escalaEs), unidades.escalaEs);

// 8c) el cero negativo
const ceros = await p.evaluate(() => ({
  eur: fmt(-0.4), pct: fmtPct(-0.0004), num: fmtNum(-0.2), pct2: fmtPct(-0.000004, 2), menos: fmt(-0.6), menosPct: fmtPct(-0.0006), neg0: fmt(-0)
}));
check('fmt(-0,4) sale sin signo', !/[-−]/.test(ceros.eur), ceros.eur);
check('fmtPct(-0,0004) sale sin signo', !/[-−]/.test(ceros.pct) && /^0,0%$/.test(norm(ceros.pct)), ceros.pct);
check('fmtNum(-0,2) y fmtPct con dos decimales también', !/[-−]/.test(ceros.num) && !/[-−]/.test(ceros.pct2), `${ceros.num} / ${ceros.pct2}`);
check('pero −0,6 € y −0,06 % conservan el signo', /[-−]/.test(ceros.menos) && /[-−]/.test(ceros.menosPct), `${ceros.menos} / ${ceros.menosPct}`);

// 8d) un select con valor inválido cae al valor por defecto visible
const sel = async (q, antes) => {
  const d = await abrir(q, antes);
  const r = await d.evaluate(() => ({ ccaa: el('ccaa').value, texto: el('ccaa').selectedOptions[0]?.textContent, obra: el('obraNueva').value,
    obraSel: el('obraNueva').selectedIndex, idx: el('indexar').selectedIndex }));
  await d.close(); return r;
};
let s = await sel('?c=xyz&nu=raro');
check('?c=xyz cae a Madrid, visible', s.ccaa === 'madrid' && s.texto === 'Madrid' && s.obraSel >= 0, JSON.stringify(s));
s = await sel('', () => localStorage.setItem('calc_pisos_v2', JSON.stringify({ ccaa: 'inventada', obraNueva: 'quizá', indexar: 'tal vez' })));
check('un guardado manipulado también', s.ccaa === 'madrid' && s.texto === 'Madrid' && s.obraSel >= 0 && s.idx >= 0, JSON.stringify(s));
// y la selección válida no se toca
s = await sel('?c=galicia');
check('una comunidad válida sigue siendo la elegida', s.ccaa === 'galicia', JSON.stringify(s));

// 8e) el deflactor con una inflación de -100 % o peor
const defl2 = await p.evaluate(() => { resetDefaults(); el('inflacion').value = '-150'; el('indexar').value = 'si'; render();
  const d = calcular(); return d.filas.every(f => [f.cajaAno, f.irpf, f.cajaAcum, f.patrimonio, f.netoVenta].every(Number.isFinite)); });
check('indexar con inflación −150 % no produce NaN', defl2 === true);

check('sin errores de consola', p.errs.length === 0, p.errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
