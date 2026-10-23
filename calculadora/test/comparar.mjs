// Amortización acelerada y caja, comparación de financiaciones y la tarjeta de cabecera de la
// rentabilidad anualizada. Las tres cosas tocan la misma zona de la interfaz y comparten escenario.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const abrir = async (ancho, alto = 1300) => {
  const p = await b.newPage({ viewport: { width: ancho, height: alto } });
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  await p.goto(PAGINA); await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
  return p;
};
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(60)} ${d}`); };
const limpio = (s) => String(s).replace(/\s+/g, ' ').trim();

const p = await abrir(1440);
await p.evaluate(() => resetDefaults());
const poner = async (id, v) => { await p.fill('#' + id, String(v)); await p.press('#' + id, 'Tab'); };
const txt = (sel) => p.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);

/* ---------- 2) amortización acelerada y caja ---------- */
const sin = { caja: await txt('#kpiCaja'), mes: await txt('#kpiCajaMes'), roce: await txt('#kpiRoce'),
  filas: await p.evaluate(() => [...document.querySelectorAll('#tblCaja tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim())) };
const generada = await p.evaluate(() => calcular().regimenInicial.caja);
check('sin acelerada el indicador enseña la caja generada', generada > 0 && sin.caja.replace(/\D/g, '') !== '0', `${sin.caja} · ${sin.mes}`);
check('  y el detalle sigue diciendo «con la deuda viva»', /con la deuda viva/.test(sin.mes), sin.mes);
check('  y la tabla no lleva las filas de amortizar', !sin.filas.some(f => /A amortizar|Caja que te queda/.test(f)));

await p.check('#hipotecaAcelerada');
const con = { caja: await txt('#kpiCaja'), mes: await txt('#kpiCajaMes'), roce: await txt('#kpiRoce'),
  cls: await p.getAttribute('#kpiCaja', 'class'), res: await txt('#kpiResCaja'),
  filas: await p.evaluate(() => [...document.querySelectorAll('#tblCaja tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim())) };
check('con la hipoteca acelerada la caja que te queda es 0', con.caja.replace(/[^\d-]/g, '') === '0', con.caja);
check('  en gris neutro', /val-muted/.test(con.cls) && !/val-pos|val-neg/.test(con.cls), con.cls);
check('  y el detalle dice cuánto va a amortizar deuda', /^[\d.]+\s?€\/año van a amortizar deuda$/.test(con.mes.replace(/ /g, ' ')) && con.mes.replace(/\D/g, '') === String(Math.round(generada)), con.mes);
check('  la cabecera plegable de móvil también dice 0', con.res.replace(/[^\d-]/g, '') === '0', con.res);
check('  la tabla añade «− A amortizar deuda» y «= Caja que te queda»', con.filas.some(f => /^− A amortizar deuda/.test(f)) && con.filas.some(f => /^= Caja que te queda/.test(f)), con.filas.join(' | '));
const iNeta = con.filas.findIndex(f => /^Caja neta anual/.test(f));
check('  van justo después de la caja neta anual y llevan la mensual coherente', /A amortizar/.test(con.filas[iNeta + 1]) && /Caja que te queda/.test(con.filas[iNeta + 2]) && /al mes/.test(con.filas[iNeta + 3]) && /^Caja que te queda al mes\D*0/.test(con.filas[iNeta + 3]), con.filas.slice(iNeta).join(' | '));
check('  el ROCE no cambia (la caja generada sigue siendo retorno)', con.roce === sin.roce, `${sin.roce} → ${con.roce}`);
const tip = await p.getAttribute('[data-i18n="kpiCaja"]', 'title');
check('  el globo de CAJA ANUAL explica las dos lecturas', /amortización acelerada/.test(tip) && /ROCE/.test(tip));
const compartido = await p.evaluate(() => textoCompartido(true));
check('  el texto compartido dice 0 €/mes y cuánto va a deuda', /caja 0\s?€\/mes/.test(compartido.replace(/ /g, ' ')) && /amortizar deuda/.test(compartido), compartido);
await p.click('#langBtn');
check('  en inglés: «goes to pay down debt»', /yr goes to pay down debt/.test(await txt('#kpiCajaMes')), await txt('#kpiCajaMes'));
await p.click('#langBtn');
await p.uncheck('#hipotecaAcelerada');
const de = { caja: await txt('#kpiCaja'), mes: await txt('#kpiCajaMes') };
check('al desmarcarla todo vuelve a como estaba', de.caja === sin.caja && de.mes === sin.mes, `${de.caja} · ${de.mes}`);
// Con la caja negativa no hay nada que adelantar: el indicador no cambia aunque esté marcada.
await poner('alquiler', 400);
const negSin = await txt('#kpiCaja');
await p.check('#hipotecaAcelerada');
const neg = { caja: await txt('#kpiCaja'), mes: await txt('#kpiCajaMes') };
check('con la caja negativa marcar la acelerada no cambia nada', neg.caja === negSin && /\/mes con la deuda viva/.test(neg.mes), `${negSin} · ${neg.mes}`);
await p.evaluate(() => resetDefaults());

/* ---------- 4) la tarjeta de la rentabilidad anualizada ---------- */
const alt = await p.evaluate(() => {
  const g = document.getElementById('kpiGrid'), cs = [...g.children];
  const estirado = cs.map(c => c.getBoundingClientRect().height);
  g.style.alignItems = 'start';
  const natural = cs.map(c => c.getBoundingClientRect().height);
  g.style.alignItems = '';
  const rot = document.querySelector('#kpiAnualizada').closest('.border-2').querySelector('.uppercase').getBoundingClientRect().height;
  return { estirado, natural, rot };
});
const dentro = (a, tol = 2) => Math.max(...a) - Math.min(...a) <= tol;
check('1440: las seis tarjetas de cabecera, misma altura', dentro(alt.estirado), alt.estirado.map(Math.round).join('/'));
// Ya ninguna lleva dos líneas de detalle (el «sobre X aportados» del ROCE va en su rótulo): aun
// sin estirarlas, las seis miden lo mismo y lo menos posible.
check('  y sin estirar también: ninguna es más alta por contenido', dentro(alt.natural), alt.natural.map(Math.round).join('/'));
check('  y su rótulo cabe en una línea', alt.rot < 20, `${alt.rot}px`);
check('  con el rótulo corto «ANUALIZADA A … AÑOS»', await p.evaluate(() => /^ANUALIZADA A\s*[\d\s]*AÑOS$/i.test(document.querySelector('#kpiAnualizada').closest('.border-2').querySelector('.uppercase').textContent.replace(/\s+/g, ' ').trim())));
await p.click('#langBtn');
const altEn = await p.evaluate(() => { const l = document.querySelector('#kpiAnualizada').closest('.border-2').querySelector('.uppercase'); return { h: l.getBoundingClientRect().height, sw: l.scrollWidth, cw: l.clientWidth, t: l.textContent.replace(/\s+/g, ' ').trim() }; });
check('  en inglés también en una línea y sin recortar', altEn.h < 20 && altEn.sw <= altEn.cw, JSON.stringify(altEn));
await p.click('#langBtn');

// Cada indicador cabe en una línea: rótulo, cifra y detalle, ninguno partido. Se mira con el
// ejemplo de fábrica, con uno que no recupera la caja, con aportaciones posteriores y en inglés.
const lineas = () => p.evaluate(() => {
  const ids = ['kpiBrutaDetalle', 'kpiRoceConReval', 'kpiCajaMes', 'kpiDeudaDetalle', 'kpiPayback', 'kpiAnosAlquilerDetalle'];
  const g = document.getElementById('kpiGrid');
  const alturas = [...g.children].map(c => c.getBoundingClientRect().height);
  const r = document.getElementById('kpiRoce').closest('.bg-brand-card').querySelector('.uppercase');
  const rd = document.getElementById('kpiRoceDetalle');
  return { alturas, partidos: ids.filter(id => { const e = document.getElementById(id); return e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) * 1.5; }),
    rotRoce: r.getBoundingClientRect().height, roceDet: rd.textContent.trim(), roceTitle: rd.title, payback: document.getElementById('kpiPayback').textContent, paybackTitle: document.getElementById('kpiPayback').title,
    anual: document.getElementById('kpiAnualizada').parentElement.textContent.replace(/\s+/g, ' ').trim() };
});
const l0 = await lineas();
check('1440 de fábrica: seis tarjetas iguales y sin detalles partidos', dentro(l0.alturas) && l0.partidos.length === 0, l0.alturas.map(Math.round).join('/') + ' ' + l0.partidos);
check('  ROCE lleva «· sobre X € aportados» en la línea del rótulo', l0.rotRoce < 20 && /^· sobre [\d.]+\s€ aportados$/.test(l0.roceDet), l0.roceDet);
check('  anualizada: «rentabilidad» detrás de la cifra y recuperación corta', /^[\d,.-]+%\s*rentabilidad$/.test(l0.anual) && /^Caja recuperada en \d+ años$/.test(l0.payback) && /^Recuperas los .* aportados en el año \d+/.test(l0.paybackTitle), `${l0.anual} | ${l0.payback} | ${l0.paybackTitle}`);
await poner('alquiler', 300);
const l1 = await lineas();
check('  sin recuperación: cifras iguales, una línea, tooltip largo', dentro(l1.alturas) && l1.partidos.length === 0 && /^Caja: .* de .* aportados$/.test(l1.payback) && l1.paybackTitle.length > l1.payback.length, l1.alturas.map(Math.round).join('/') + ' ' + l1.payback);
await p.screenshot({ path: salida('calc4-1440-sin-recuperacion.png'), clip: { x: 0, y: 0, width: 1440, height: 330 } });
await p.evaluate(() => resetDefaults());
await p.click('#langBtn');
const l2 = await lineas();
check('  en inglés también', dentro(l2.alturas) && l2.partidos.length === 0 && /^Cash recovered in \d+ years$/.test(l2.payback) && /^[\d,.-]+%\s*return$/.test(l2.anual) && /^· on [^\d]*[\d,]+ put in$/.test(l2.roceDet), `${l2.alturas.map(Math.round).join('/')} ${l2.payback} | ${l2.anual} | ${l2.roceDet}`);
await p.click('#langBtn');

/* ---------- 5) las tres tarjetas de datos llenan lo mismo ---------- */
const tar = await p.evaluate(() => {
  const ult = ['outCosteTotal', 'outLiquidez', 'inflacion'].map(id => document.getElementById(id).closest('.salida, .fila'));
  const cards = ult.map(e => e.closest('.bg-brand-card'));
  return { h: cards.map(c => c.getBoundingClientRect().height), fondo: ult.map(e => e.getBoundingClientRect().bottom) };
});
check('1440: Compra, Financiación y Explotación miden lo mismo', dentro(tar.h), tar.h.map(Math.round).join('/'));
check('  y su último elemento queda alineado abajo (±3 px)', dentro(tar.fondo, 3), tar.fondo.map(Math.round).join('/'));
await p.screenshot({ path: salida('calc4-1440-tarjetas.png'), clip: { x: 0, y: 330, width: 1440, height: 700 } });

/* ---------- 3) comparar financiaciones ---------- */
const sinOpciones = await p.evaluate(() => ({ oculto: document.getElementById('bloqueComparar').classList.contains('hidden'), tabla: !!document.getElementById('tblComparar') }));
check('con 0 opciones no hay nada', sinOpciones.oculto && !sinOpciones.tabla);
check('el botón está en la cabecera de la tarjeta de Financiación, junto a «Deuda»', await p.evaluate(() => { const c = document.getElementById('btnComparar').closest('.bg-brand-card'); const cab = c.querySelector('h2').parentElement; return c.querySelector('h2').textContent === 'Financiación' && cab.contains(document.getElementById('btnComparar')) && /Deuda/.test(cab.textContent); }));
check('  se llama «➕ Comparar» y lleva el texto largo en title y aria-label', await p.evaluate(() => { const b = document.getElementById('btnComparar'); return b.textContent.trim() === '➕ Comparar' && b.title.length > 30 && b.getAttribute('aria-label') === b.title; }));
check('  y es rojo de financiación, como el distintivo', await p.evaluate(() => /text-brand-rose/.test(document.getElementById('btnComparar').className) && /bg-brand-rose\/10/.test(document.getElementById('btnComparar').className)));

// A: hipoteca 80 % a 30 años al 3,10 %
await poner('pctFinanciado', 80); await poner('plazoHipoteca', 30); await poner('tipoHipoteca', '3,10');
await p.click('#btnComparar');
check('con 1 opción, el aviso va en la cabecera del resumen, con su ✕ y sin tabla', (await txt('#compararUna')).startsWith('1 opción de financiación guardada. Añade otra para comparar.') && await p.evaluate(() => { const h = document.getElementById('compararUna').closest('.bg-brand-card').querySelector('h2'); return h.parentElement.parentElement.contains(document.getElementById('compararUna')) && h.parentElement.contains(document.getElementById('compararUna')); }) && !(await p.$('#tblComparar')) && !!(await p.$('[data-quitar="A"]')));
await p.screenshot({ path: salida('calc4-1440-resumen-1op.png'), clip: { x: 0, y: 0, width: 1440, height: 1300 } });
check('  y la cabecera de Financiación no se descuadra con el aviso de duplicado', await (async () => {
  const antes = await p.evaluate(() => document.getElementById('btnComparar').closest('.bg-brand-card').getBoundingClientRect().height);
  await p.click('#btnComparar');
  const aviso = await p.evaluate(() => { const a = document.getElementById('avisoComparar'), c = document.getElementById('btnComparar').closest('.bg-brand-card'); return { h: c.getBoundingClientRect().height, vis: a.getBoundingClientRect().height > 0 }; });
  return aviso.h === antes && aviso.vis; })());
await p.click('#btnComparar');
check('añadir la misma financiación no la duplica y avisa', (await p.evaluate(() => OPCIONES.length)) === 1 && /ya está/i.test(await txt('#avisoComparar')), await txt('#avisoComparar'));
// B: 70 % a 25 años acelerada
await poner('pctFinanciado', 70); await poner('plazoHipoteca', 25); await p.check('#hipotecaAcelerada');
await p.click('#btnComparar');
const t2 = await p.evaluate(() => ({
  cols: document.querySelectorAll('#tblComparar thead th[data-opcion]').length,
  letras: [...document.querySelectorAll('#tblComparar thead th[data-opcion]')].map(e => e.dataset.opcion).join(''),
  filas: [...document.querySelectorAll('#tblComparar tbody tr')].map(r => r.dataset.fila),
  nombres: [...document.querySelectorAll('#tblComparar .cmp-nombre')].map(e => [...e.children].map(c => c.textContent).join(' / ')),
  titulo: document.getElementById('compararTitulo').textContent, visible: !document.getElementById('compararTitulo').classList.contains('hidden'),
  dentroDelResumen: document.getElementById('bloqueComparar').closest('.bg-brand-card').querySelector('h2').textContent
}));
check('con 2 opciones aparece la tabla con 2 columnas A y B', t2.cols === 2 && t2.letras === 'AB' && t2.visible && t2.titulo === 'Comparar financiación', JSON.stringify(t2));
check('  dentro de «Resumen de la operación»', t2.dentroDelResumen === 'Resumen de la operación');
check('  con los nombres automáticos', limpio(t2.nombres[0]) === 'Hipoteca 80 % · 30 a · 3,10 %' && limpio(t2.nombres[1]) === 'Hipoteca 70 % · 25 a · 3,10 % / acelerada', t2.nombres.join(' || '));
check('  y las filas pedidas, con «caja que te queda» al haber acelerada', ['liquidez', 'cuota', 'cajaGenerada', 'cajaQueda', 'roce', 'anualizada', 'tirVenta', 'anosDeuda', 'intereses', 'ganancia'].join() === t2.filas.join(), t2.filas.join());
// C: 80 % + préstamo de 20.000 € sin acelerar (la casilla del préstamo nace marcada)
await poner('pctFinanciado', 80); await poner('plazoHipoteca', 30); await p.uncheck('#hipotecaAcelerada');
await p.click('#lockPrestamo'); await poner('importePrestamo', 20000); await p.uncheck('#prestamoAcelerado');
await p.click('#btnComparar');
// D: el mismo con el préstamo acelerado
await p.check('#prestamoAcelerado');
await p.click('#btnComparar');
const t4 = await p.evaluate(() => ({ cols: document.querySelectorAll('#tblComparar thead th[data-opcion]').length, dis: document.getElementById('btnComparar').disabled,
  tip: document.getElementById('btnComparar').title, nombres: [...document.querySelectorAll('#tblComparar .cmp-nombre')].map(e => [...e.children].map(c => c.textContent).join(' / ')) }));
check('con 4 opciones el botón se desactiva y explica por qué', t4.cols === 4 && t4.dis && /4 opciones/.test(t4.tip), `${t4.cols} · ${t4.tip}`);
check('  nombres del préstamo', limpio(t4.nombres[2]) === 'Hipoteca 80 % · 30 a · 3,10 % / + préstamo 20.000 € al 9 %' && /\+ préstamo 20.000 € al 9 % \/ préstamo acelerado$/.test(limpio(t4.nombres[3])), t4.nombres.slice(2).join(' || '));
await p.evaluate(() => document.getElementById('btnComparar').click());
check('  y no admite una quinta', (await p.evaluate(() => OPCIONES.length)) === 4);
await p.uncheck('#prestamoAcelerado');

// El mejor valor de cada fila: en verde y es de verdad el extremo.
const num = (s) => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.'));
const mejores = await p.evaluate(() => [...document.querySelectorAll('#tblComparar tbody tr')].map(r => ({
  id: r.dataset.fila, valores: [...r.querySelectorAll('td')].map(td => td.textContent), marcadas: [...r.querySelectorAll('td')].map(td => td.classList.contains('mejor')) })));
const regla = { liquidez: 'min', cuota: 'min', cajaGenerada: 'max', cajaQueda: 'max', roce: 'max', anualizada: 'max', tirVenta: 'max', intereses: 'min', ganancia: 'max' };
let malas = [];
for (const f of mejores) {
  if (!regla[f.id]) continue;
  const v = f.valores.map(num); const ext = regla[f.id] === 'max' ? Math.max(...v) : Math.min(...v);
  const dif = new Set(v).size > 1;
  f.marcadas.forEach((m, i) => { if (m !== (dif && v[i] === ext)) malas.push(`${f.id}[${i}]`); });
}
check('en cada fila se resalta el mejor valor (más o menos, según la fila)', malas.length === 0 && mejores.filter(f => f.marcadas.some(Boolean)).length >= 6, malas.join(',') + ' · ' + mejores.filter(f => f.marcadas.some(Boolean)).length + ' filas con verde');
const fAnos = mejores.find(f => f.id === 'anosDeuda');
check('  los años de deuda: gana el menor', fAnos.valores.map(num).every((v, i) => fAnos.marcadas[i] === (v === Math.min(...fAnos.valores.map(num)))) || new Set(fAnos.valores).size === 1, fAnos.valores.join(' | '));
check('  la liquidez la gana quien menos pone (la que más financia)', mejores.find(f => f.id === 'liquidez').marcadas.some(Boolean));

// Los campos no se ensucian: el estado leído es idéntico tras pintar la comparación.
const intacto = await p.evaluate(() => {
  const foto = () => ({ e: leerEstado(), dis: CAMPOS.concat(CASILLAS).map(id => document.getElementById(id).disabled), foco: document.activeElement && document.activeElement.id });
  const a = foto(); pintarComparacion(); const b2 = foto();
  return { igual: JSON.stringify(a) === JSON.stringify(b2) };
});
check('leerEstado() queda idéntico tras pintar la comparación', intacto.igual);
// Con otras opciones (una fuente apagada y el campo con un máximo recortado) también.
await p.evaluate(() => { OPCIONES[1].importePrestamo = 5e6; OPCIONES[1].usarPrestamo = true; });
const intacto2 = await p.evaluate(() => { const a = JSON.stringify(leerEstado()); pintarComparacion(); return a === JSON.stringify(leerEstado()); });
check('  incluso con una opción cuyo préstamo supera el máximo', intacto2);
await p.evaluate(() => { OPCIONES[1].importePrestamo = 0; OPCIONES[1].usarPrestamo = false; });
// Escribiendo en un campo con el cursor en medio, el cursor no salta.
await p.click('#pctFinanciado'); await p.evaluate(() => { const c = document.getElementById('pctFinanciado'); c.value = '80'; c.setSelectionRange(1, 1); pintarComparacion(); });
check('  ni el cursor de un campo en el que se está escribiendo', await p.evaluate(() => document.getElementById('pctFinanciado').selectionStart) === 1);
await p.press('#pctFinanciado', 'Tab');

// Se recalcula con los datos actuales.
const cajaA = () => p.evaluate(() => document.querySelector('#tblComparar tr[data-fila="cajaGenerada"] td').textContent);
const antesAlq = await cajaA();
await poner('alquiler', 1800);
const despuesAlq = await cajaA();
check('al cambiar el alquiler las opciones se recalculan', antesAlq !== despuesAlq, `${antesAlq} → ${despuesAlq}`);
await poner('alquiler', 1250);

// Cargar una opción en los campos.
await p.click('[data-cargar="B"]');
const cargada = await p.evaluate(() => ({ pct: document.getElementById('pctFinanciado').value, plazo: document.getElementById('plazoHipoteca').value, acel: document.getElementById('hipotecaAcelerada').checked, pre: document.getElementById('usarPrestamo').checked }));
check('«Cargar» pone la opción en los campos de financiación', cargada.pct === '70' && cargada.plazo === '25' && cargada.acel && !cargada.pre, JSON.stringify(cargada));

// Quitar, y la letra libre se reutiliza.
await p.click('[data-quitar="B"]');
const q = await p.evaluate(() => ({ letras: [...document.querySelectorAll('#tblComparar thead th[data-opcion]')].map(e => e.dataset.opcion).join(''), dis: document.getElementById('btnComparar').disabled }));
check('quitar una opción deja las demás y reactiva el botón', q.letras === 'ACD' && !q.dis, JSON.stringify(q));
await p.click('#btnComparar');
check('  y la nueva ocupa la letra libre', (await p.evaluate(() => OPCIONES.map(o => o.letra).join(''))) === 'ABCD');

/* ---------- 7) renombrar opciones con doble clic ---------- */
const nombres = () => p.evaluate(() => [...document.querySelectorAll('#tblComparar thead .cmp-letra')].map(e => e.textContent));
check('por defecto se llaman «Opción 1» … «Opción 4», con la descripción debajo', (await nombres()).join() === 'Opción 1,Opción 2,Opción 3,Opción 4' && /Hipoteca/.test(await txt('#tblComparar thead th[data-opcion="A"] .cmp-nombre')));
check('  y el nombre dice «Doble clic para cambiar el nombre»', (await p.getAttribute('[data-renombrar="A"]', 'title')) === 'Doble clic para cambiar el nombre');
await p.dblclick('[data-renombrar="A"]');
const ed = await p.evaluate(() => { const i = document.querySelector('#tblComparar .cmp-edit'); return i && { v: i.value, ini: i.selectionStart, fin: i.selectionEnd, foco: document.activeElement === i, max: i.maxLength }; });
check('doble clic: campo de texto en su sitio, con el texto seleccionado y enfocado', ed && ed.v === 'Opción 1' && ed.ini === 0 && ed.fin === 8 && ed.foco && ed.max === 30, JSON.stringify(ed));
// Mientras se escribe, un repintado no debe llevarse el campo ni lo escrito.
await p.keyboard.type('Banco Norte');
await p.evaluate(() => { pintarComparacion(); render(); });
check('  un repintado a medias no pierde la edición en curso', await p.evaluate(() => { const i = document.querySelector('#tblComparar .cmp-edit'); return !!i && i.value === 'Banco Norte' && document.activeElement === i; }));
await p.keyboard.press('Enter');
check('  Enter guarda el nombre', (await nombres())[0] === 'Banco Norte' && !(await p.$('.cmp-edit')), (await nombres()).join());
await p.dblclick('[data-renombrar="B"]'); await p.keyboard.type('Descartado'); await p.keyboard.press('Escape');
check('  Escape cancela', (await nombres())[1] === 'Opción 2' && !(await p.$('.cmp-edit')), (await nombres()).join());
await p.dblclick('[data-renombrar="A"]'); await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace'); await p.keyboard.press('Enter');
check('  vacío vuelve a «Opción 1»', (await nombres())[0] === 'Opción 1');
await p.dblclick('[data-renombrar="A"]'); await p.keyboard.press('Control+A'); await p.keyboard.type('Fuera del campo');
await p.click('h1, header', { position: { x: 5, y: 5 } }).catch(() => {}); await p.evaluate(() => document.activeElement && document.activeElement.blur());
check('  salir del campo también guarda', (await nombres())[0] === 'Fuera del campo', (await nombres()).join());
await p.dblclick('[data-renombrar="B"]'); await p.keyboard.press('Control+A'); await p.keyboard.type('x'.repeat(50)); await p.keyboard.press('Enter');
check('  máximo 30 caracteres', (await nombres())[1] === 'x'.repeat(30));
// Nombre con HTML: se ve como texto y no crea elementos.
const xss = '<img src=x onerror=alert(1)>';
await p.evaluate(() => { window.__alertas = 0; window.alert = () => { window.__alertas++; }; });
await p.dblclick('[data-renombrar="C"]'); await p.keyboard.press('Control+A'); await p.keyboard.type(xss); await p.keyboard.press('Enter');
await p.waitForTimeout(200);
const seg = await p.evaluate(() => ({ imgs: document.querySelectorAll('#comparar img, #tblComparar img').length, texto: document.querySelector('#tblComparar thead [data-renombrar="C"]').textContent, alertas: window.__alertas,
  guardado: OPCIONES.find(o => o.letra === 'C').nombre }));
check('un nombre con HTML sale como texto y no crea ningún <img>', seg.imgs === 0 && seg.texto === xss && seg.alertas === 0 && seg.guardado === xss, JSON.stringify(seg));
check('  ni al editarlo de nuevo (el campo lleva el texto tal cual)', await (async () => { await p.dblclick('[data-renombrar="C"]'); const v = await p.evaluate(() => document.querySelector('.cmp-edit').value); await p.keyboard.press('Escape'); return v === xss && !(await p.$('#comparar img')); })());
// Cargar y quitar siguen funcionando con nombres propios.
await p.click('[data-cargar="A"]');
check('  «Cargar» sigue funcionando con una opción renombrada', (await p.evaluate(() => document.getElementById('pctFinanciado').value)) === '80');
await p.click('[data-quitar="D"]');
check('  y ✕ quita la opción y respeta los nombres de las demás', (await nombres()).join().startsWith('Fuera del campo,xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,' + xss) && (await nombres()).length === 3, (await nombres()).join());
await poner('pctFinanciado', 55); await p.click('#btnComparar');
check('  la opción nueva ocupa el número libre más bajo', (await nombres()).at(-1) === 'Opción 4', (await nombres()).join());

// Persistencia tras recargar.
await p.waitForTimeout(900);
await p.reload(); await p.waitForTimeout(700);
const rec = await p.evaluate(() => ({ cols: document.querySelectorAll('#tblComparar thead th[data-opcion]').length, letras: OPCIONES.map(o => o.letra).join('') }));
check('las opciones sobreviven a recargar la página', rec.cols === 4 && rec.letras === 'ABCD', JSON.stringify(rec));
check('  y los nombres propios también (validados al leer)', (await nombres()).join() === ['Fuera del campo', 'x'.repeat(30), xss, 'Opción 4'].join(), (await nombres()).join());
const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('calc_pisos_v2')).comparar.length);
check('  se guardan junto al resto del estado', guardado === 4);
check('  pero no viajan en el enlace compartido', !(await p.evaluate(() => enlaceConCalculos())).includes('compar'));
// Un guardado manipulado no rompe nada.
await p.evaluate(() => localStorage.setItem('calc_pisos_v2', JSON.stringify({ ...JSON.parse(localStorage.getItem('calc_pisos_v2')), comparar: [{ letra: 'Z' }, { letra: 'A', pctFinanciado: 'x' }, 7, null, { letra: 'A' }] })));
await p.reload(); await p.waitForTimeout(600);
check('  y un guardado con basura se filtra sin errores', (await p.evaluate(() => OPCIONES.length)) === 1 && p.errs.length === 0, p.errs[0] ?? '');
await p.evaluate(() => { OPCIONES = []; });
// Captura de la cabecera
await p.evaluate(() => resetDefaults()); await p.waitForTimeout(300);

// Reseteo.
await poner('pctFinanciado', 80); await p.click('#btnComparar'); await poner('pctFinanciado', 60); await p.click('#btnComparar');
check('hay dos opciones antes de resetear', (await p.evaluate(() => OPCIONES.length)) === 2);
await p.dblclick('[data-renombrar="A"]'); await p.keyboard.type('Banco Norte 80 %'); await p.keyboard.press('Enter');
await p.locator('#bloqueComparar').scrollIntoViewIfNeeded();
await p.locator('#bloqueComparar').screenshot({ path: salida('calc4-1440-comparar.png') });
await p.click('#btnReset'); await p.waitForTimeout(900);
const trasReset = await p.evaluate(() => ({ n: OPCIONES.length, oculto: document.getElementById('bloqueComparar').classList.contains('hidden'), g: JSON.parse(localStorage.getItem('calc_pisos_v2')).comparar.length }));
check('el reseteo ♻️ las borra, también de lo guardado', trasReset.n === 0 && trasReset.oculto && trasReset.g === 0, JSON.stringify(trasReset));
check('1440: sin errores de consola', p.errs.length === 0, p.errs[0] ?? '');
await p.close();

/* ---------- móvil ---------- */
const m = await abrir(390, 844);
await m.evaluate(() => resetDefaults());
const mponer = async (id, v) => { await m.fill('#' + id, String(v)); await m.press('#' + id, 'Tab'); };
await mponer('pctFinanciado', 80); await m.click('#btnComparar');
await mponer('pctFinanciado', 70); await mponer('plazoHipoteca', 25); await m.check('#hipotecaAcelerada'); await m.click('#btnComparar');
await mponer('pctFinanciado', 80); await mponer('plazoHipoteca', 30); await m.uncheck('#hipotecaAcelerada'); await m.click('#lockPrestamo'); await mponer('importePrestamo', 20000); await m.uncheck('#prestamoAcelerado'); await m.click('#btnComparar');
const mv = await m.evaluate(() => { const c = document.querySelector('.comparar-caja'); const de = document.documentElement;
  return { scrollCaja: c.scrollWidth, anchoCaja: c.clientWidth, pagina: de.scrollWidth, ventana: de.clientWidth, cols: document.querySelectorAll('#tblComparar thead th[data-opcion]').length }; });
check('390: la tabla tiene 3 columnas y se desplaza dentro de su caja', mv.cols === 3 && mv.scrollCaja > mv.anchoCaja, JSON.stringify(mv));
check('390: la página no se desborda', mv.pagina <= mv.ventana, `${mv.pagina} <= ${mv.ventana}`);
await m.click('#kpiToggle');
const rotM = await m.evaluate(() => { const l = document.querySelector('#kpiAnualizada').closest('.border-2').querySelector('.uppercase'); return { h: l.getBoundingClientRect().height, sw: l.scrollWidth, cw: l.clientWidth }; });
check('390: el rótulo de la anualizada sigue en una línea', rotM.h < 20 && rotM.sw <= rotM.cw, JSON.stringify(rotM));
await m.click('#kpiToggle');
await m.setViewportSize({ width: 360, height: 800 }); await m.waitForTimeout(200);
await m.click('#langBtn');
const tabsEn = await m.evaluate(() => { const c = document.querySelector('.tab-btn').parentElement; return { tops: new Set([...document.querySelectorAll('.tab-btn')].map(e => Math.round(e.getBoundingClientRect().top))).size, ok: c.scrollWidth <= c.clientWidth }; });
check('360: las pestañas con emoji caben en una línea también en inglés', tabsEn.tops === 1 && tabsEn.ok, JSON.stringify(tabsEn));
check('móvil sin errores de consola', m.errs.length === 0, m.errs[0] ?? '');
await m.close();

await b.close();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
