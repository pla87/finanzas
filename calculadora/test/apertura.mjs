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
// El primer año cuenta a medias: la deducción se resta de la base de media anualidad.
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

// Una comisión que la base de media anualidad no absorbe: el impuesto se queda en 0, no se vuelve negativo.
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
