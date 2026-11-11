// Tercera revisión: lo que encontraron los dos revisores de la segunda. Cada bloque se escribió
// primero y se vio fallar con el código de antes; aquí se quedan como guardia.
//
//  1  leerNumero toma el PRIMER token numérico (no concatena cifras sueltas de un texto con palabras)
//  2  un campo vacío o ilegible al salir recupera el último valor confirmado y lo avisa en el globo
//  3  el ROCE sin liquidez inicial es el del año 1 y no depende del horizonte
//  4  la horquilla de revalorización con inflación negativa sale ordenada y sin duplicados
//  5  «La caja va a amortizar deuda» sólo si queda deuda viva o la caja aún se destina a ella
//  6  el subtítulo de la FAQ no promete lo que sólo cumple la tabla de apalancamiento
//  7  los KPI se leen enteros a 1024, 1280 y 1440 y las seis tarjetas siguen alineadas
//  8  el nombre de una opción del comparador se lee entero a 390 px
//  9  la leyenda del donut y los importes de «Los tres regímenes» no se cortan a 390 px
// 10  el tooltip de Mantenimiento habla del alquiler bruto de doce meses
// 11  el texto de Parámetros en inglés dice lo mismo que el español
// 12  el enlace de «Estos cálculos» lleva el idioma y se aplica al abrir
// 13  el motivo de un campo en rojo sale en el globo al enfocar o tocar
// 14  tras ♻️ el indicador ofrece deshacer
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const errs = [];
const abrir = async (sufijo = '', ancho = 1300, alto = 1100) => {
  const p = await b.newPage({ viewport: { width: ancho, height: alto } });
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGINA + sufijo); await p.waitForTimeout(500);
  return p;
};
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(84)} ${d}`); };
const seccion = async (nombre, fn) => { try { await fn(); } catch (e) { fallos++; console.log(`FALLO ${nombre.padEnd(84)} excepción: ${String(e.message).split('\n')[0]}`); } };

const p = await abrir();
p.setDefaultTimeout(5000);
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(400);

// ---------- 1) el primer token numérico ----------
await seccion('1', async () => {
  const casos = [
    ['80 m2', 80], ['1.250 € (IVA 21%)', 1250], ['Piso 3º 90.000', 3], ['250.000 € - 2 hab', 250000],
    ['12 años, 3 meses', 12], ['1,5e3', 1500], ['1.5e3', 1500], ['2E-2', 0.02], ['1 250', 1250], ['1 250 000', 1250000],
    ['1 250,50', 1250.5], ['1 250 €', 1250], ['-5 grados', -5], ['−5 grados', -5], ['ref-12', 12], ['7 - 3', 7],
    ['1.250,5', 1250.5], ['1,250.50', 1250.5], ['€1.250', 1250], ['$1,250.00', 1250], ['−1.250', -1250],
    ['12 %', 12], ['250.000 €', 250000], ['0,125', 0.125], ['1.250 euros.', 1250], ['5 euros', 5],
  ];
  const mal = await p.evaluate((c) => c.filter(([s, v]) => leerNumero(s) !== v).map(([s, v]) => `«${s}»→${leerNumero(s)} (esperado ${v})`), casos);
  check('lectura de importes con texto: el primer token manda', mal.length === 0, mal.join(' | '));
  const dec = await p.evaluate(() => [['2,5 % (cupón 3)', 2.5], ['2,375 %', 2.375], ['%2.375', 2.375], ['3,5%', 3.5]]
    .filter(([s, v]) => leerNumero(s, true) !== v).map(([s]) => `«${s}»→${leerNumero(s, true)}`));
  check('  y en porcentajes (un único separador es decimal)', dec.length === 0, dec.join(' | '));
  const nan = await p.evaluate(() => ['', 'abc', '   ', '€', '-', '.', ',', null].filter(s => !Number.isNaN(leerNumero(s))));
  check('  sin ningún token numérico, NaN', nan.length === 0, JSON.stringify(nan));
});

// ---------- 2) campo vacío o ilegible ----------
await seccion('2', async () => {
  await p.evaluate(() => { resetDefaults(); });
  await p.waitForTimeout(100);
  const antes = await p.evaluate(() => ({ alq: el('alquiler').value, tir: calcular().resumen?.tir ?? null, kpi: el('kpiCaja')?.textContent ?? '' }));
  for (const [id, texto] of [['alquiler', ''], ['alquiler', 'abc'], ['tipoHipoteca', '   '], ['mesesVacios', '€']]) {
    await p.evaluate(() => resetDefaults());
    const previo = await p.inputValue('#' + id);
    await p.click('#' + id); await p.fill('#' + id, texto);
    await p.keyboard.press('Tab'); await p.waitForTimeout(150);
    const v = await p.inputValue('#' + id);
    const globo = await p.evaluate(() => { const g = document.getElementById('avisoLimite'); return g.hidden ? null : g.textContent; });
    check(`«${texto}» en ${id}: recupera el último valor confirmado (${previo})`, v === previo, `quedó «${v}»`);
    check('  y el globo dice que no se entiende y cuál se mantiene', !!globo && globo.includes('No se entiende el número') && globo.includes(previo), String(globo));
  }
  // El valor confirmado es el de la última vez que se salió del campo, no el de fábrica.
  await p.evaluate(() => resetDefaults());
  await p.click('#alquiler'); await p.fill('#alquiler', '1.234'); await p.keyboard.press('Tab');
  await p.click('#alquiler'); await p.fill('#alquiler', 'sin cifras'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  check('se mantiene lo confirmado (1.234), no el valor de fábrica', await p.inputValue('#alquiler') === '1.234', await p.inputValue('#alquiler'));
  check('  y el cálculo sigue con ese alquiler', await p.evaluate(() => num('alquiler')) === 1234);
  // Un texto con número sigue funcionando: se lee su primer token.
  await p.click('#superficie'); await p.fill('#superficie', '80 m2'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  check('«80 m2» en la superficie queda en 80', await p.inputValue('#superficie') === '80', await p.inputValue('#superficie'));
  // Oferta y descuento enlazados: restaurar uno no deja al otro a medias.
  await p.evaluate(() => resetDefaults());
  const par = await p.evaluate(() => [el('oferta').value, el('descuentoOferta').value]);
  await p.click('#oferta'); await p.fill('#oferta', ''); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  check('oferta vacía: oferta y descuento vuelven juntos', JSON.stringify(await p.evaluate(() => [el('oferta').value, el('descuentoOferta').value])) === JSON.stringify(par));
  // En inglés, el mensaje en inglés.
  await p.evaluate(() => { aplicarIdioma('en'); });
  await p.click('#alquiler'); await p.fill('#alquiler', ''); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  const gl = await p.evaluate(() => document.getElementById('avisoLimite').textContent);
  check('en inglés el globo habla inglés', /Can.t read that number; keeping/.test(gl), gl);
  await p.evaluate(() => { aplicarIdioma('es'); });
});

// ---------- 13) el motivo de un campo en rojo, en el globo ----------
await seccion('13', async () => {
  await p.evaluate(() => { resetDefaults(); ocultarAvisoLimite(); });
  await p.click('#inflacion'); await p.fill('#inflacion', '8'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  const lee = () => p.evaluate(() => { const g = document.getElementById('avisoLimite'); const r = g.getBoundingClientRect();
    return { visible: !g.hidden, texto: g.textContent, top: r.top, bottom: r.bottom }; });
  const titulo = await p.evaluate(() => el('inflacion').title);
  check('el campo en rojo tiene su motivo en el title', titulo.length > 20, titulo);
  await p.evaluate(() => document.activeElement.blur());
  await p.waitForTimeout(100);
  check('sin foco no hay globo', !(await lee()).visible);
  await p.focus('#inflacion'); await p.waitForTimeout(100);
  const g1 = await lee();
  check('al enfocar el campo en rojo, el globo dice su motivo', g1.visible && g1.texto === titulo, g1.texto);
  const campoR = await p.evaluate(() => { const r = el('inflacion').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  check('  y no tapa el campo (queda arriba o abajo, nunca encima)', g1.bottom <= campoR.top + 1 || g1.top >= campoR.bottom - 1, JSON.stringify([g1, campoR]));
  // Al escribir se queda, y cambia si el motivo cambia.
  await p.keyboard.press('End'); await p.keyboard.type('0'); await p.waitForTimeout(150);
  const g2 = await lee();
  check('al escribir se mantiene (80 % de inflación sigue siendo el mismo motivo)', g2.visible && g2.texto === await p.evaluate(() => el('inflacion').title));
  await p.fill('#inflacion', '-2,5'); await p.waitForTimeout(200);
  const g3 = await lee();
  check('  y sigue al motivo cuando cambia (deflación)', g3.visible && g3.texto === await p.evaluate(() => el('inflacion').title) && g3.texto !== titulo, g3.texto);
  await p.fill('#inflacion', '2,5'); await p.waitForTimeout(200);
  check('  y se esconde si el valor deja de avisar', !(await lee()).visible);
  await p.fill('#inflacion', '8,5'); await p.waitForTimeout(200);
  check('  y vuelve si el valor vuelve a avisar', (await lee()).visible);
  await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  check('al salir del campo se esconde', !(await lee()).visible);
  // Un campo que no está en rojo no abre globo.
  await p.focus('#alquiler'); await p.waitForTimeout(100);
  check('un campo sin aviso no abre globo', !(await lee()).visible);
  await p.evaluate(() => document.activeElement.blur());
  // Un recorte (fugaz) no lo pisa el motivo del foco, y éste vuelve cuando el fugaz se va.
  await p.focus('#inflacion'); await p.waitForTimeout(100);
  await p.fill('#inflacion', ''); await p.waitForTimeout(100);
  check('al tocar con el dedo (clic) en el campo en rojo también', await (async () => { await p.evaluate(() => document.activeElement.blur()); await p.fill('#inflacion', '8'); await p.evaluate(() => document.activeElement.blur()); await p.click('#inflacion'); await p.waitForTimeout(100); return (await lee()).visible; })());
  await p.keyboard.press('Tab');
});

// ---------- 3) el ROCE es del año 1: no depende del horizonte ----------
await seccion('3', async () => {
  const motor = (campos, fuentePrestamo) => p.evaluate(([campos, pre]) => {
    resetDefaults();
    for (const [id, v] of Object.entries(campos)) el(id).value = v;
    if (pre) { el('usarPrestamo').checked = true; pintarFuente('prestamo'); el('importePrestamo').value = '99999999'; }
    render(); const d = calcular();
    return { aportado: d.aportado, ap1: d.filas[0].aportacion, extra: d.aportacionesExtra, roce: d.roceSinReval, roceRev: d.roce,
      roceCaja: d.roceCaja, kpi: el('kpiRoce').textContent, detalle: el('kpiRoceDetalle').textContent.replace(/\s+/g, ' ').trim(), titulo: el('kpiRoceDetalle').title,
      caja: d.regimenInicial.caja, amo: d.roceAmortizacion };
  }, [campos, fuentePrestamo]);
  const base = { pctFinanciado: '100', alquiler: '500', oferta: '200000', precioAnunciado: '200000', descuentoOferta: '0', tipoHipoteca: '4' };
  const res = [];
  for (const h of ['3', '10', '30']) res.push(await motor({ ...base, horizonte: h }, true));
  check('sin liquidez inicial, hay aportación el año 1 (el escenario sirve)', res[0].aportado === 0 && res[0].ap1 > 0, `aportado ${res[0].aportado} · año 1 ${res[0].ap1.toFixed(0)}`);
  check('el ROCE es el mismo con horizonte 3, 10 y 30', res.every(r => Math.abs(r.roce - res[0].roce) < 1e-12 && Math.abs(r.roceRev - res[0].roceRev) < 1e-12), res.map(r => (r.roce * 100).toFixed(3) + ' % (extra ' + r.extra.toFixed(0) + ')').join(' | '));
  check('  y es lo realizado del año 1 entre lo aportado ese año', res.every(r => Math.abs(r.roceCaja * (r.aportado + r.ap1) - r.caja) < 1e-6), res.map(r => (r.roceCaja * (r.aportado + r.ap1)).toFixed(2) + ' vs ' + r.caja.toFixed(2)).join(' | '));
  check('  el texto dice sobre qué capital se mide (el del año 1, sin sumar lo posterior)', /aportados en el año 1$/.test(res[0].titulo) && /del año 1$/.test(res[0].detalle) && !/después|later/.test(res[0].titulo + res[0].detalle), res[0].titulo + ' | ' + res[0].detalle);
  // Con liquidez inicial y pérdidas el año 1, el divisor suma las dos cosas.
  const mixto = await motor({ pctFinanciado: '80', alquiler: '300', tipoHipoteca: '5' }, false);
  check('con liquidez y una aportación el año 1 (el escenario sirve)', mixto.aportado > 0 && mixto.ap1 > 0, `aportado ${mixto.aportado.toFixed(0)} · año 1 ${mixto.ap1.toFixed(0)}`);
  check('  el ROCE se mide sobre liquidez + aportación del año 1', Math.abs(mixto.roceCaja * (mixto.aportado + mixto.ap1) - mixto.caja) < 1e-6);
  check('  y el texto dice exactamente esa suma', /aportados en el año 1$/.test(mixto.titulo) && [mixto.titulo, mixto.detalle].every(x => x.includes(Math.round(mixto.ap1).toLocaleString('es-ES')) && x.includes(Math.round(mixto.aportado).toLocaleString('es-ES')) && /\+/.test(x)), mixto.titulo);
  const ctrl = await p.evaluate(() => { resetDefaults(); render(); const d = calcular(); return { roce: d.roceSinReval, aportado: d.aportado, ap1: d.filas[0].aportacion, det: el('kpiRoceDetalle').textContent.replace(/\s+/g, ' ').trim() }; });
  check('con liquidez y sin aportaciones el texto de siempre', ctrl.ap1 === 0 && /^Sobre [\d.]+\s€ aportados$/.test(ctrl.det), ctrl.det);
});

// ---------- 4) horquilla de revalorización con inflación negativa o cero ----------
await seccion('4', async () => {
  const fila = (infl) => p.evaluate((infl) => {
    resetDefaults(); el('inflacion').value = infl; render();
    const f = [...document.querySelectorAll('#tblRentabilidad tr')].find(tr => /según revalorización|by appreciation/.test(tr.textContent));
    const num = (t) => parseFloat(t.replace('%', '').replace(',', '.'));
    const spans = [...f.cells[1].querySelectorAll('span')];
    return { v: spans.map(e => num(e.textContent)), central: spans.filter(e => e.hasAttribute('data-central')).map(e => num(e.textContent)),
      base: calcular().filaRef.anualizada * 100, rev: calcular().revalorizacion };
  }, infl);
  for (const infl of ['-2', '-1', '0', '1', '2,5']) {
    const r = await fila(infl);
    const asc = r.v.every((x, i) => i === 0 || x > r.v[i - 1]);
    check(`inflación ${infl}: la horquilla va de menor a mayor y sin repetidos`, asc && r.v.length >= 2, r.v.join(' · '));
    if (infl === '-2' || infl === '0') {
      check('  y el escenario central (el de la cifra principal) queda marcado', r.central.length === 1 && Math.abs(r.central[0] - r.base) < 0.06, `${r.central} vs ${r.base.toFixed(2)}`);
    }
  }
});

// ---------- 5) «La caja va a amortizar deuda» sólo si hay deuda a la que amortizar ----------
await seccion('5', async () => {
  const kpi = (campos, casillas) => p.evaluate(([campos, casillas]) => {
    resetDefaults();
    for (const [id, v] of Object.entries(campos)) el(id).value = v;
    for (const [id, v] of Object.entries(casillas)) el(id).checked = v;
    pintarFuente('prestamo'); pintarFuente('hipoteca');
    render(); const d = calcular();
    return { txt: el('kpiPayback').textContent, tip: el('kpiPayback').title, hipIni: d.ultima.hipIni, preIni: d.ultima.preIni, fin: d.ultima.deuda, sinDeuda: d.sinDeuda && d.sinDeuda.n };
  }, [campos, casillas]);
  // Hipoteca apagada y préstamo de 20.000 a 5 años: a los 10 ya no se debe nada.
  const saldada = await kpi({ importePrestamo: '20000', plazoPrestamo: '5', tipoPrestamo: '5', horizonte: '10', alquiler: '600' },
    { usarHipoteca: false, usarPrestamo: true, prestamoAcelerado: true });
  check('el escenario sirve: la deuda ya está saldada antes del horizonte', saldada.fin === 0 && saldada.sinDeuda < 10, `saldada el año ${saldada.sinDeuda}`);
  check('con la deuda saldada no dice «La caja va a amortizar deuda»', !/amortizar deuda/.test(saldada.txt) && !/amortizar/.test(saldada.tip), saldada.txt);
  // El control: con deuda viva al final y acelerada, el texto de siempre.
  const viva = await kpi({ importePrestamo: '120000', plazoPrestamo: '30', tipoPrestamo: '5', horizonte: '10', alquiler: '900' },
    { usarHipoteca: false, usarPrestamo: true, prestamoAcelerado: true });
  check('con deuda viva y acelerada sigue diciendo que la caja va a amortizar deuda', viva.fin > 0 && /amortizar deuda/.test(viva.txt), JSON.stringify(viva));
});

// ---------- 6, 10 y 11) textos ----------
await seccion('textos', async () => {
  const T = await p.evaluate(() => ({ es: TEXTOS.es, en: TEXTOS.en }));
  check('6  el subtítulo de la FAQ no dice que todos los ejemplos salen del escenario cargado', !/salen del escenario que tengas cargado/.test(T.es.faqSub) && /apalancamiento/.test(T.es.faqSub) && /ejemplo/.test(T.es.faqSub), T.es.faqSub);
  check('6  en inglés tampoco', !/come from whatever scenario you have loaded/.test(T.en.faqSub) && /leverage/i.test(T.en.faqSub) && /example/i.test(T.en.faqSub), T.en.faqSub);
  check('10 el tooltip de Mantenimiento habla del alquiler bruto de doce meses', /bruto/.test(T.es.mantenimientoTip) && !/cobrado/.test(T.es.mantenimientoTip), T.es.mantenimientoTip);
  check('10 en inglés también', /gross/.test(T.en.mantenimientoTip) && !/collected/.test(T.en.mantenimientoTip), T.en.mantenimientoTip);
  check('11 el texto de Parámetros en inglés ya no habla de la hoja original', !/spreadsheet/i.test(T.en.paramsNota) && /example scenario/.test(T.en.paramsNota), T.en.paramsNota);
});

// ---------- 12) el enlace lleva el idioma ----------
await seccion('12', async () => {
  await p.evaluate(() => { resetDefaults(); aplicarIdioma('en'); });
  const en = await p.evaluate(() => enlaceConCalculos());
  check('el enlace desde la interfaz en inglés lleva lang=en', /[?&]lang=en(&|$)/.test(en), en);
  await p.evaluate(() => aplicarIdioma('es'));
  const es = await p.evaluate(() => enlaceConCalculos());
  check('  y desde la española, lang=es', /[?&]lang=es(&|$)/.test(es), es);
  // Quien abre el enlace en inglés lo ve en inglés aunque tenga guardado el español, y al revés.
  const q = (u) => u.slice(u.indexOf('?'));
  const abre = async (sufijo, guardado) => {
    const pg = await abrir('');
    await pg.evaluate((g) => { localStorage.setItem('calc_pisos_lang', g); }, guardado);
    await pg.goto(PAGINA + sufijo); await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ({ lang: document.documentElement.lang, idioma: IDIOMA, btn: document.getElementById('langBtn').title }));
    await pg.close(); return r;
  };
  check('abrir lang=en con el español guardado lo muestra en inglés', (await abre(q(en), 'es')).idioma === 'en');
  check('  y lang=es con el inglés guardado, en español', (await abre(q(es), 'en')).idioma === 'es');
  // Compatible hacia atrás: un enlace sin idioma no toca el del visitante.
  check('un enlace de antes (sin lang) respeta el idioma del visitante', (await abre('?ver=2&tema=l&p=300000', 'en')).idioma === 'en');
  check('  y con un lang que no existe tampoco lo cambia', (await abre('?lang=xx&ver=2&tema=l', 'en')).idioma === 'en');
  check('  y un enlace sólo con lang=en (sin cifras) también se aplica', (await abre('?lang=en', 'es')).idioma === 'en');
});

// ---------- 14) ♻️ se puede deshacer desde el propio indicador ----------
await seccion('14', async () => {
  const estado = async (pg) => pg.evaluate(() => { const i = document.getElementById('saveIndicator'); const b = i.querySelector('button');
    return { texto: i.textContent.replace(/\s+/g, ' ').trim(), visible: !i.classList.contains('opacity-0'), boton: b ? b.textContent : null, alquiler: document.getElementById('alquiler').value }; });
  const probar = async (pg, etiqueta, esperaHint) => {
    await pg.evaluate(() => localStorage.clear());
    await pg.reload(); await pg.waitForTimeout(400);
    await pg.fill('#alquiler', '1.777'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(900);
    await pg.click('#btnReset'); await pg.waitForTimeout(900);
    const e = await estado(pg);
    check(`${etiqueta}: tras ♻️ el indicador sigue diciendo «Datos reseteados» y se ve`, e.visible && /Datos reseteados/.test(e.texto), e.texto);
    check(`  ${esperaHint ? 'lleva «· Ctrl+Z para deshacer»' : 'sin pantalla con teclado no habla de Ctrl+Z'}`, esperaHint === /Ctrl\+Z para deshacer/.test(e.texto), e.texto);
    check('  y trae un botón «Deshacer» pulsable', e.boton === 'Deshacer', String(e.boton));
    await pg.waitForTimeout(2000);
    check('  que sigue ahí pasados unos segundos (no es un destello de un segundo)', (await estado(pg)).visible && (await estado(pg)).boton === 'Deshacer');
    await pg.click('#saveIndicator button'); await pg.waitForTimeout(300);
    const d = await estado(pg);
    check('  pulsarlo devuelve los datos de antes', d.alquiler === '1.777', d.alquiler);
    check('  y el indicador dice «Deshecho» sin el botón', /Deshecho/.test(d.texto) && d.boton === null, d.texto);
  };
  const pe = await abrir('');
  await probar(pe, 'escritorio', true);
  // Pasados unos segundos el aviso se va y deja de ser pulsable.
  await pe.click('#btnReset'); await pe.waitForTimeout(7000);
  const fin = await estado(pe);
  check('  a los pocos segundos el aviso se esconde y no queda ningún botón pulsable', !fin.visible && fin.boton === null, JSON.stringify(fin));
  await pe.close();
  const pm = await b.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await pm.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await pm.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await pm.goto(PAGINA); await pm.waitForTimeout(500);
  pm.setDefaultTimeout(5000);
  await probar(pm, 'móvil', false);
  await pm.close();
});

// ---------- 7) los KPI se leen enteros a 1024, 1280 y 1440 ----------
await seccion('7', async () => {
  const escenarios = {
    'de fábrica': {}, 'caja baja': { alquiler: '400' }, 'aportación el año 1': { pctFinanciado: '100', alquiler: '500', tipoHipoteca: '4' },
    'acelerada': { alquiler: '1100' }, 'apertura en €': { alquiler: '950', mesesVacios: '1', pctFinanciado: '80' },
  };
  const malos = [], desiguales = [];
  let n = 0;
  for (const w of [1024, 1280, 1440]) {
    const q = await abrir('', w, 900);
    for (const lang of ['es', 'en']) for (const [nom, campos] of Object.entries(escenarios)) {
      const r = await q.evaluate(([campos, lang, nom]) => {
        resetDefaults(); aplicarIdioma(lang);
        for (const [id, v] of Object.entries(campos)) el(id).value = v;
        if (nom === 'aportación el año 1') { el('usarPrestamo').checked = true; pintarFuente('prestamo'); el('importePrestamo').value = '99999999'; }
        if (nom === 'acelerada') el('hipotecaAcelerada').checked = true;
        if (nom === 'apertura en €') { el('aperturaHipEur').checked = true; el('aperturaHip').value = '900'; }
        render();
        const g = el('kpiGrid');
        // Recortado con «…» (una línea) o con el límite de líneas, o cortado por un overflow.
        const hojas = [...g.querySelectorAll('*')].filter(e => e.children.length === 0 && e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.className.split(' ')[0]);
        const clamp = [...g.querySelectorAll('.kpi-detalle')].filter(e => e.scrollHeight > e.clientHeight + 1).map(e => e.id);
        const rot = el('anoRefBtn').closest('.kpi-rotulo-anual');
        const rotulo = rot.querySelector('.kpi-rotulo-texto').scrollWidth > rot.querySelector('.kpi-rotulo-texto').clientWidth + 1 ? ['kpiAnualizada'] : [];
        const alturas = [...g.children].map(c => Math.round(c.getBoundingClientRect().height));
        return { cortes: [...hojas, ...clamp, ...rotulo], alturas };
      }, [campos, lang, nom]);
      n++;
      if (r.cortes.length) malos.push(`${w}/${lang}/${nom}: ${r.cortes.join(',')}`);
      if (new Set(r.alturas).size !== 1) desiguales.push(`${w}/${lang}/${nom}: ${r.alturas.join('/')}`);
    }
    await q.close();
  }
  check(`ningún KPI se recorta a 1024, 1280 ni 1440 (${n} combinaciones, en los dos idiomas)`, malos.length === 0, malos.slice(0, 4).join(' | '));
  check('  y las seis tarjetas miden lo mismo en todas', desiguales.length === 0, desiguales.slice(0, 3).join(' | '));
});

// ---------- 8 y 9) móvil a 390 px ----------
await seccion('8y9', async () => {
  const m = await b.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  await m.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await m.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  m.on('pageerror', e => errs.push(e.message));
  await m.goto(PAGINA); await m.waitForTimeout(500);
  const r8 = await m.evaluate(() => {
    resetDefaults();
    const set = (id, v) => { el(id).value = v; render(); };
    set('pctFinanciado', '80'); el('btnComparar').click();
    set('pctFinanciado', '70'); set('plazoHipoteca', '25'); el('hipotecaAcelerada').checked = true; render(); el('btnComparar').click();
    set('pctFinanciado', '60'); el('hipotecaAcelerada').checked = false; render(); el('btnComparar').click();
    OPCIONES[0].nombre = 'Banco Norte 80 %'; OPCIONES[1].nombre = 'Hipoteca fija 25a'; OPCIONES[2].nombre = 'Mi opción 3'; ultimaTabla = null; render();
    const ths = [...document.querySelectorAll('#tblComparar thead th[data-opcion]')];
    return ths.map(th => { const nom = th.querySelector('.cmp-letra'), tx = th.querySelector('.cmp-letra-txt'), bot = th.querySelector('.cmp-cab .flex');
      return { t: tx.textContent, cortado: tx.scrollWidth > tx.clientWidth + 1, encima: nom.getBoundingClientRect().bottom <= bot.getBoundingClientRect().top + 1 }; });
  });
  check('390: tres opciones renombradas (16 caracteres) se leen enteras en su celda', r8.length === 3 && r8.every(x => !x.cortado), JSON.stringify(r8.map(x => [x.t, x.cortado])));
  check('  con el nombre en su línea, encima de Cargar y ✕', r8.every(x => x.encima), JSON.stringify(r8.map(x => x.encima)));
  // En escritorio no se apila: nombre y botones comparten línea, como siempre.
  const esc = await abrir('', 1300, 1000);
  const r8e = await esc.evaluate(() => {
    resetDefaults(); const set = (id, v) => { el(id).value = v; render(); };
    set('pctFinanciado', '80'); el('btnComparar').click(); set('pctFinanciado', '70'); el('btnComparar').click();
    const th = document.querySelector('#tblComparar thead th[data-opcion="A"]'), n = th.querySelector('.cmp-letra').getBoundingClientRect(), bt = th.querySelector('.cmp-cab .flex').getBoundingClientRect();
    return { mismaLinea: Math.abs((n.top + n.height / 2) - (bt.top + bt.height / 2)) < 4 };
  });
  check('  en escritorio nombre y botones siguen en la misma línea', r8e.mismaLinea, JSON.stringify(r8e));
  await esc.close();

  // 9) leyenda del donut y tabla de regímenes
  await m.evaluate(() => { resetDefaults(); switchTab('cajaTab', document.querySelector('[onclick*="cajaTab"]')); render(); });
  await m.waitForTimeout(600);
  const r9 = await m.evaluate(() => {
    const out = [];
    for (const id of ['chartGastos', 'chartIngresos']) {
      const c = Chart.getChart(document.getElementById(id));
      const hb = c.legend.legendHitBoxes, items = c.legend.legendItems;
      out.push({ id, pos: c.options.plugins.legend.position, dentro: hb.every(h => h.left >= 0 && h.left + h.width <= c.width + 0.5),
        completas: items.every((it, i) => { c.ctx.font = '11px sans-serif'; return /·\s*\d+%$/.test(it.text) && hb[i].width >= 12 + 8 + c.ctx.measureText(it.text).width * 0.9; }) });
    }
    return out;
  });
  check('390: las leyendas de los dos círculos van debajo y caben enteras (con su %)', r9.length === 2 && r9.every(x => x.pos === 'bottom' && x.dentro && x.completas), JSON.stringify(r9));
  const r9b = await m.evaluate(() => {
    resetDefaults(); el('tipoHipoteca').value = '4'; el('alquiler').value = '1100'; render();
    const celdas = [...document.querySelectorAll('#tblRegimenes td')].slice(0).filter((_, i) => i % 4 !== 0);
    const partidas = celdas.filter(td => [...td.querySelectorAll('span')].some(sp => !sp.classList.contains('tooltip-help') && sp.getClientRects().length > 1));
    const filaNeg = [...document.querySelectorAll('#tblRegimenes tr')].find(tr => /Cuotas/.test(tr.cells[0].textContent));
    return { n: celdas.length, partidas: partidas.map(td => td.textContent.trim()), neg: filaNeg.cells[1].textContent };
  });
  check('390: los importes de «Los tres regímenes» no se parten en dos líneas', r9b.partidas.length === 0 && /^−\s?[\d.]+\s€$/.test(r9b.neg.trim()), JSON.stringify(r9b));
  await m.close();
});

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
