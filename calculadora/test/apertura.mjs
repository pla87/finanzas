// Comisión de apertura de la hipoteca y del préstamo personal: se paga al firmar (sube lo
// aportado), se deduce entera en el primer año como gasto de financiación, no toca el coste ni
// el valor de adquisición del piso, y viaja por guardado, enlace, reset y comparador.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const abrir = async (sufijo = '', ancho = 1440) => {
  const p = await b.newPage({ viewport: { width: ancho, height: 1300 } });
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  await p.goto(PAGINA + sufijo); await p.waitForTimeout(400);
  return p;
};
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(64)} ${d}`); };
const cerca = (a, b2, tol = 0.01) => Math.abs(a - b2) <= tol;

const p = await abrir();
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
const poner = async (id, v) => { await p.fill('#' + id, String(v)); await p.press('#' + id, 'Tab'); };
const resumen = () => p.evaluate(() => {
  const d = calcular();
  return { aportado: d.aportado, coste: d.costeTotal, amort: d.amortizacion, base: d.baseAmortizable,
    principalHip: d.principalHip, principalPre: d.principalPre, comision: d.comisionApertura,
    tipo: d.tipoEfectivo, irpf1: d.filas[0].irpf, caja1: d.filas[0].cajaAno, irpf2: d.filas[1].irpf,
    adq: d.filas[4].gananciaFiscal, neto5: d.filas[4].netoVenta, payback: d.payback ? d.payback.n : null,
    roceCaja: d.roceCaja, reparto: d.reparto, ingresos: d.ingresosAcum, extra: d.aportacionesExtra,
    desembolso: document.getElementById('tblDesembolso').textContent.replace(/\s+/g, ' ') };
});

// ---------- 1) por defecto es 0 y no cambia nada ----------
check('el campo de la hipoteca arranca a 0', (await p.inputValue('#aperturaHip')) === '0,00');
check('y el del préstamo, también', (await p.inputValue('#aperturaPre')) === '0,00');
// Un alquiler holgado, para que la base fiscal del primer año sea positiva y la deducción se vea.
await poner('alquiler', 2600);
const base0 = await resumen();
check('con comisión 0 no hay comisión en el motor', base0.comision === 0);
check('  y lo aportado es el coste menos la deuda', cerca(base0.aportado, base0.coste - base0.principalHip - base0.principalPre));
check('  y el desglose no enseña ninguna fila de comisión', !/Comisión apertura/.test(base0.desembolso));
check('  y no se muestra el importe junto al campo', (await p.textContent('#outAperturaHip')) === '');
check('la base fiscal del primer año es positiva (el escenario sirve)', base0.irpf1 > 0, `IRPF año 1: ${base0.irpf1.toFixed(0)}`);

// ---------- 2) el 1 % sobre la hipoteca ----------
await poner('aperturaHip', '1');
const h = await resumen();
const X = h.principalHip;
check('la hipoteca es la misma', cerca(X, base0.principalHip));
check('el coste total no cambia (no es precio del piso)', cerca(h.coste, base0.coste));
check('ni la base amortizable (no forma parte del valor de adquisición)', cerca(h.base, base0.base) && cerca(h.amort, base0.amort));
check('la comisión es el 1 % del principal', cerca(h.comision, X * 0.01), `${h.comision.toFixed(2)} de ${X}`);
check('la liquidez aportada sube exactamente X·1 %', cerca(h.aportado - base0.aportado, X * 0.01), `+${(h.aportado - base0.aportado).toFixed(2)}`);
const ahorro = base0.irpf1 - h.irpf1;
// El año 1 es un año completo: la deducción se resta de la base anual de ese año.
check('el impuesto del año 1 baja comisión × tipo efectivo', cerca(ahorro, h.comision * h.tipo, 0.01),
  `baja ${ahorro.toFixed(2)}; esperado ${(h.comision * h.tipo).toFixed(2)}`);
check('  y esa rebaja pasa entera a la caja del año 1', cerca(h.caja1 - base0.caja1, ahorro, 0.01));
check('el año 2 no se entera', cerca(h.irpf2, base0.irpf2));
check('la ganancia fiscal al vender no cambia', cerca(h.adq, base0.adq));
check('el desglose de entrada la enseña, con su importe', /Comisión apertura \+ 1\.729 €|Comisión apertura ⓘ \+ [\d.]+ €/.test(h.desembolso), h.desembolso.slice(-120));
check('junto al campo aparece el importe entre paréntesis', /^\([\d.]+\s?€\)$/.test((await p.textContent('#outAperturaHip')).trim()), await p.textContent('#outAperturaHip'));
check('la liquidez de pantalla la lleva', (await p.textContent('#outLiquidez')).replace(/\D/g, '') === String(Math.round(h.aportado)));
check('el reparto sigue cerrando sin residuo',
  cerca(h.ingresos + h.extra, h.reparto.gastos + h.reparto.irpf + h.reparto.intereses + h.reparto.amortizacion + h.reparto.caja, 0.5));
check('la caja recuperada tarda lo mismo o más', h.payback === null || base0.payback === null || h.payback >= base0.payback,
  `${base0.payback} → ${h.payback}`);

// Una comisión que la base del año no absorbe: el impuesto se queda en 0, no se vuelve negativo.
await poner('aperturaHip', '20');
const grande = await resumen();
check('una comisión enorme deja el impuesto del año 1 en 0, no en negativo', grande.irpf1 === 0, String(grande.irpf1));
await poner('aperturaHip', '1');

// ---------- 3) préstamo personal ----------
await p.click('#lockPrestamo');
await poner('importePrestamo', '30000');
await poner('aperturaPre', '2');
const pr = await resumen();
check('la comisión del préstamo es el 2 % de su principal', cerca(pr.comision, pr.principalHip * 0.01 + pr.principalPre * 0.02),
  `${pr.comision.toFixed(2)}`);
check('y se suma a lo aportado', cerca(pr.aportado, pr.coste + pr.comision - pr.principalHip - pr.principalPre));
check('el desglose de entrada suma las dos comisiones en una fila', (pr.desembolso.match(/Comisión apertura/g) || []).length === 1);
// Apagada la hipoteca, su porcentaje deja de contar aunque el campo siga escrito.
await p.click('#lockHipoteca');
const sinHip = await resumen();
check('sin hipoteca, su comisión no cuenta', cerca(sinHip.comision, sinHip.principalPre * 0.02));
await p.click('#lockHipoteca');

// ---------- 4) la clave viaja por la dirección ----------
const enlace = await p.evaluate(() => enlaceConCalculos());
check('el enlace lleva ch=1 y cp=2', /[?&]ch=1(&|$)/.test(enlace) && /[?&]cp=2(&|$)/.test(enlace), enlace);
const q = enlace.slice(enlace.indexOf('?'));
const p2 = await abrir(q);
const viaje = await p2.evaluate(() => ({ h: document.getElementById('aperturaHip').value, pr: document.getElementById('aperturaPre').value,
  com: calcular().comisionApertura }));
check('al abrir ese enlace los dos campos vuelven', viaje.h === '1,00' && viaje.pr === '2,00', JSON.stringify(viaje));
await p2.close();
const p3 = await abrir('?p=260000');
const sinClave = await p3.evaluate(() => ({ h: document.getElementById('aperturaHip').value, pr: document.getElementById('aperturaPre').value }));
check('una dirección sin las claves deja 0 (compatible hacia atrás)', sinClave.h === '0,00' && sinClave.pr === '0,00', JSON.stringify(sinClave));
await p3.close();
const claves = await p.evaluate(() => ({ ch: CLAVES_CORTAS.aperturaHip, cp: CLAVES_CORTAS.aperturaPre,
  repetidas: Object.values(CLAVES_CORTAS).length - new Set(Object.values(CLAVES_CORTAS)).size }));
check('las claves cortas no chocan con ninguna otra', claves.ch === 'ch' && claves.cp === 'cp' && claves.repetidas === 0, JSON.stringify(claves));

// ---------- 5) se guarda en el navegador ----------
await p.waitForTimeout(900);
await p.reload(); await p.waitForTimeout(500);
const guardado = await p.evaluate(() => [document.getElementById('aperturaHip').value, document.getElementById('aperturaPre').value]);
check('recargar conserva las dos comisiones', guardado.join() === '1,00,2,00', guardado.join(' · '));

// ---------- 6) «datos de ejemplo» las pone a 0 ----------
await p.evaluate(() => resetDefaults());
const reset = await p.evaluate(() => [document.getElementById('aperturaHip').value, document.getElementById('aperturaPre').value, calcular().comisionApertura]);
check('restablecer deja las dos a 0', reset.join() === '0,00,0,00,0', reset.join(' · '));

// ---------- 7) el comparador las distingue ----------
await p.evaluate(() => resetDefaults());
await poner('alquiler', 2600);
await p.evaluate(() => { anadirComparacion(); });
await poner('aperturaHip', '1');
await p.evaluate(() => { anadirComparacion(); });
const cmp = await p.evaluate(() => ({ n: OPCIONES.length, ap: OPCIONES.map(o => o.aperturaHip),
  cab: [...document.querySelectorAll('#tblComparar thead .cmp-nombre')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
  liq: [...document.querySelectorAll('#tblComparar tr[data-fila="liquidez"] td')].map(e => e.textContent.replace(/\D/g, '')) }));
check('dos opciones que sólo difieren en la comisión no se toman por duplicadas', cmp.n === 2 && cmp.ap.join() === '0,1', JSON.stringify(cmp.ap));
check('  sólo la que tiene comisión la nombra en su descripción', !/apertura/.test(cmp.cab[0]) && /apertura 1 %/.test(cmp.cab[1]), cmp.cab.join(' | '));
check('  y la liquidez de la segunda es mayor', +cmp.liq[1] > +cmp.liq[0], cmp.liq.join(' vs '));
const trasComparar = await p.evaluate(() => [document.getElementById('aperturaHip').value, document.getElementById('aperturaPre').value]);
check('calcular las opciones no deja los campos tocados', trasComparar.join() === '1,00,0,00', trasComparar.join(' · '));
const dup = await p.evaluate(() => { const antes = OPCIONES.length; anadirComparacion(); return OPCIONES.length === antes; });
check('la misma comisión otra vez sí es duplicado', dup);
// Una opción guardada antes de que existiera la comisión carga con 0.
const vieja = await p.evaluate(() => leerOpciones([{ letra: 'A', usarHipoteca: true, pctFinanciado: 70, plazoHipoteca: 30, tipoHipoteca: 2.8 }])[0]);
check('una opción antigua, sin el campo, se lee con comisión 0', vieja.aperturaHip === 0 && vieja.aperturaPre === 0);
await p.evaluate(() => cargarOpcion('A'));
check('cargar una opción repone su comisión', (await p.inputValue('#aperturaHip')) === '0,00');

// ---------- 9) conmutador %/€ ----------
await p.evaluate(() => resetDefaults());
await poner('alquiler', 2600);
const modo = (suf) => p.evaluate((x) => { const b = document.getElementById('modoApertura' + x); return { pulsado: b.getAttribute('aria-pressed'), title: b.title, txt: b.textContent.replace(/\s/g, '') }; }, suf);
const m0 = await modo('Hip');
check('hay un conmutador %/€ junto a cada comisión, en % y con title', m0.pulsado === 'false' && m0.txt === '%€' && /porcentaje/.test(m0.title), JSON.stringify(m0));
check('  también el del préstamo', (await modo('Pre')).pulsado === 'false');
await poner('aperturaHip', '1');
const antes = await resumen();
await p.click('#modoAperturaHip');
const e1 = await resumen();
check('al pasar a € el campo enseña el importe (1 % de 172.900)', (await p.inputValue('#aperturaHip')) === '1.729,00', await p.inputValue('#aperturaHip'));
check('  el conmutador queda pulsado y su title lo dice', (await modo('Hip')).pulsado === 'true' && /euros/.test((await modo('Hip')).title));
check('  y el importe de la comisión no cambia', cerca(e1.comision, antes.comision, 0.005) && cerca(e1.aportado, antes.aportado, 0.005), `${antes.comision} → ${e1.comision}`);
check('  el paréntesis gris enseña ahora el % equivalente', /^\(1,00%\)$/.test((await p.textContent('#outAperturaHip')).trim()), await p.textContent('#outAperturaHip'));
await p.click('#modoAperturaHip');
check('al volver a % vuelve el 1 %', (await p.inputValue('#aperturaHip')) === '1,00' && cerca((await resumen()).comision, antes.comision, 0.005), await p.inputValue('#aperturaHip'));
check('  y el paréntesis vuelve a enseñar euros', /€/.test(await p.textContent('#outAperturaHip')));
// Un importe que no es un porcentaje redondo: ir y volver no puede mover el importe.
await p.click('#modoAperturaHip');
await poner('aperturaHip', '2000');
await p.click('#modoAperturaHip');
const pct = await p.inputValue('#aperturaHip');
check('2.000 € de 172.900 son un 1,156738 %', pct === '1,156738', pct);
check('  y el importe sigue siendo 2.000 € al céntimo', cerca((await resumen()).comision, 2000, 0.01), String((await resumen()).comision));
await p.click('#modoAperturaHip');
check('  y de vuelta a € quedan los 2.000,00', (await p.inputValue('#aperturaHip')) === '2.000,00', await p.inputValue('#aperturaHip'));
// Avisos: más del 10 % del principal, en cualquiera de los dos modos.
const rojoAp = (id) => p.evaluate((i) => document.getElementById(i).classList.contains('val-neg'), id);
await poner('aperturaHip', '17000');
check('en €: 17.000 (9,8 % del principal) no avisa', !(await rojoAp('aperturaHip')));
await poner('aperturaHip', '18000');
check('en €: 18.000 (más del 10 %) avisa en rojo con su title', (await rojoAp('aperturaHip')) && /10 %/.test(await p.evaluate(() => document.getElementById('aperturaHip').title)));
// Límite duro en €: no puede pasar del principal.
await poner('aperturaHip', '999999');
check('en €: 999.999 se recorta al principal (172.900,00)', (await p.inputValue('#aperturaHip')) === '172.900,00', await p.inputValue('#aperturaHip'));
check('  y avisa del rango en euros', /de 0,00\s€ a 172\.900,00\s€/.test(await p.evaluate(() => { const e = document.getElementById('avisoLimite'); return e.hidden ? '' : e.textContent; })));
await p.click('#modoAperturaHip');
await poner('aperturaHip', '10');
check('en %: el 10 % exacto no avisa', !(await rojoAp('aperturaHip')));
await poner('aperturaHip', '11');
check('en %: el 11 % avisa', await rojoAp('aperturaHip'));
await poner('aperturaHip', '150');
check('en %: 150 se recorta a 100', (await p.inputValue('#aperturaHip')) === '100,00');
await poner('aperturaHip', '1');
// Sin principal, pasar de modo deja 0.
await poner('pctFinanciado', '0');
await p.click('#modoAperturaHip');
check('sin principal, pasar a € pone 0', (await p.inputValue('#aperturaHip')) === '0,00');
await p.click('#modoAperturaHip');
await poner('pctFinanciado', '70');
// Préstamo personal.
await p.click('#lockPrestamo');
await poner('importePrestamo', '30000');
await poner('aperturaPre', '2');
await p.click('#modoAperturaPre');
check('el conmutador del préstamo convierte con el principal del préstamo (2 % de 30.000 = 600)', (await p.inputValue('#aperturaPre')) === '600,00', await p.inputValue('#aperturaPre'));
// ---------- 10) el modo viaja: enlace, guardado, comparador y restablecer ----------
await p.click('#modoAperturaHip');           // la hipoteca, en €
await poner('aperturaHip', '1729');
const url2 = await p.evaluate(() => enlaceConCalculos());
check('el enlace lleva chm=e y cpm=e, y los importes', /[?&]chm=e(&|$)/.test(url2) && /[?&]cpm=e(&|$)/.test(url2) && /[?&]ch=1729(&|$)/.test(url2) && /[?&]cp=600(&|$)/.test(url2), url2);
const pU = await abrir(url2.slice(url2.indexOf('?')));
const viaje2 = await pU.evaluate(() => ({ h: document.getElementById('aperturaHip').value, he: document.getElementById('aperturaHipEur').checked,
  pr: document.getElementById('aperturaPre').value, pe: document.getElementById('aperturaPreEur').checked, com: calcular().comisionApertura,
  btn: document.getElementById('modoAperturaHip').getAttribute('aria-pressed') }));
check('al abrir el enlace los dos modos y los importes vuelven', viaje2.he && viaje2.pe && viaje2.btn === 'true' && viaje2.h === '1.729,00' && viaje2.pr === '600,00' && cerca(viaje2.com, 2329, 0.01), JSON.stringify(viaje2));
await pU.close();
const pP = await abrir('?ch=1');
check('un enlace sin chm deja el modo en %', await pP.evaluate(() => !document.getElementById('aperturaHipEur').checked && document.getElementById('aperturaHip').value === '1,00'));
await pP.close();
const pD = await abrir('?chm=e&ch=999999999');
check('un enlace con € fuera de rango se recorta al principal, en silencio', await pD.evaluate(() => document.getElementById('aperturaHip').value === '172.900,00' && document.getElementById('avisoLimite').hidden));
await pD.close();
await p.waitForTimeout(900);
await p.reload(); await p.waitForTimeout(500);
const gu2 = await p.evaluate(() => [document.getElementById('aperturaHipEur').checked, document.getElementById('aperturaHip').value, document.getElementById('modoAperturaHip').getAttribute('aria-pressed')]);
check('recargar conserva el modo y el importe', gu2.join() === 'true,1.729,00,true', gu2.join());
// Comparador: la misma cifra en % y en € son opciones distintas, y la descripción dice cuál.
await p.evaluate(() => resetDefaults());
await poner('alquiler', 2600);
await poner('aperturaHip', '1');
await p.evaluate(() => { anadirComparacion(); });
await p.click('#modoAperturaHip');
await poner('aperturaHip', '2000');
await p.evaluate(() => { anadirComparacion(); });
const cmp2 = await p.evaluate(() => ({ n: OPCIONES.length, eur: OPCIONES.map(o => o.aperturaHipEur),
  cab: [...document.querySelectorAll('#tblComparar thead .cmp-nombre')].map(e => e.textContent.replace(/\s+/g, ' ').trim()), opc: codificarOpciones(OPCIONES) }));
check('una opción en % y otra en € son distintas', cmp2.n === 2 && cmp2.eur.join() === 'false,true', JSON.stringify(cmp2.eur));
check('  la descripción dice «apertura 1 %» o «apertura 2.000 €»', /apertura 1 %/.test(cmp2.cab[0]) && /apertura 2\.000\s€/.test(cmp2.cab[1]), cmp2.cab.join(' | '));
check('  y «opc» lleva el modo (chm-1) y se decodifica igual', /chm-1/.test(cmp2.opc) && await p.evaluate((o) => { const l = decodificarOpciones(o); return l[1].aperturaHipEur === true && l[1].aperturaHip === 2000 && l[0].aperturaHipEur === false; }, cmp2.opc), cmp2.opc);
await p.evaluate(() => cargarOpcion('A'));
check('cargar la opción en % repone el modo %', await p.evaluate(() => !document.getElementById('aperturaHipEur').checked && document.getElementById('aperturaHip').value === '1,00'));
await p.evaluate(() => cargarOpcion('B'));
check('cargar la opción en € repone el modo € y su importe', await p.evaluate(() => document.getElementById('aperturaHipEur').checked && document.getElementById('aperturaHip').value === '2.000,00'));
check('calcular las opciones no deja tocados los campos ni los conmutadores', await p.evaluate(() => document.getElementById('modoApertura' + 'Hip').getAttribute('aria-pressed') === 'true'));
await p.evaluate(() => resetDefaults());
check('restablecer vuelve a % y a 0', await p.evaluate(() => !document.getElementById('aperturaHipEur').checked && document.getElementById('aperturaHip').value === '0,00' && document.getElementById('modoAperturaHip').getAttribute('aria-pressed') === 'false'));
await p.click('#langBtn'); await p.waitForTimeout(300);
check('el title del conmutador va en inglés', /percentage/.test((await modo('Hip')).title), (await modo('Hip')).title);
await p.click('#langBtn'); await p.waitForTimeout(300);

// ---------- 8) inglés y sin errores ----------
await p.click('#langBtn'); await p.waitForTimeout(300);
check('el rótulo se traduce', /Arrangement fee/.test(await p.textContent('#bloqueHipoteca')));
check('sin errores de consola', p.errs.length === 0, p.errs[0] ?? '');

await p.click('#langBtn'); await p.waitForTimeout(300);
await p.evaluate(() => resetDefaults());
await poner('aperturaHip', '1');
await p.locator('#bloqueHipoteca').screenshot({ path: salida('apertura.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
