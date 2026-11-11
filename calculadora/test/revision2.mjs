// Segunda revisión: los fallos que encontraron dos revisores independientes. Cada bloque se
// escribió primero y se vio fallar con el código de antes; aquí se quedan como guardia.
//
//  1  una deuda se salda en el año de su plazo (sin residuo de coma flotante)
//  2  el año 1 del resumen, el KPI, el «va a amortizar» y el ROCE son los de la fila 1 de la tabla
//  3  la nota fiscal y «Interés deducible» enseñan lo deducido de verdad, y la resta cuadra
//  4  sin liquidez propia pero con aportaciones posteriores, la recuperación y el ROCE las cuentan
//  5  con inflación negativa y el candado cerrado, la revalorización la sigue
//  6  la TIR llega por encima del 1.000 %
//  7  la FAQ del apalancamiento compara en la misma base (después de impuestos)
//  8  ningún comentario conserva las cifras viejas del interés del primer año
//  9  una oferta por encima del anunciado sobrevive a recargar, a deshacer y a un enlace
// 10  los importes pegados con texto («247.000 €», «€1.250», «−1.250») se leen bien
// 11  la comisión de apertura en € lee «2.000» como 2.000
// 12  Ctrl+Z dentro del editor de nombre no lo pierde
// 13  ✕ o Cargar de otra opción con el editor abierto repintan la tabla
// 14  el globo de recorte no se esconde por un scroll pequeño: se recoloca
// 15  un cambio se guarda al cerrar o esconder la pestaña sin esperar al debounce
// 16  una deuda apagada no pinta avisos en rojo
// 17  todos los campos numéricos se escriben en el idioma activo y se reformatean al cambiarlo
// 18  alternar %↔€ y volver sin editar restaura el texto original
// 19  basura en un enlace o en lo guardado se ignora
// 20  el botón del año de referencia tiene zona táctil de 32×32
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
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
const cerca = (a, c, tol = 0.01) => Math.abs(a - c) <= tol;
// Una sección con interacción real: si un clic o un campo no existe (el fallo que se vigila) se
// cuenta como fallo y se sigue con las demás, en vez de morir con un timeout de treinta segundos.
const seccion = async (nombre, fn) => { try { await fn(); } catch (e) { fallos++; console.log(`FALLO ${nombre.padEnd(84)} excepción: ${String(e.message).split('\n')[0]}`); } };

const p = await abrir();
p.setDefaultTimeout(5000);
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(400);
const motor = (campos, lector, casillas = {}) => p.evaluate(([campos, lector, casillas]) => {
  resetDefaults();
  for (const [id, v] of Object.entries(campos)) el(id).value = v;
  for (const [id, v] of Object.entries(casillas)) el(id).checked = v;
  render();
  return new Function('d', 'return (' + lector + ')(d)')(calcular());
}, [campos, lector, casillas]);

// ---------- 1) residuo de coma flotante al saldar una deuda ----------
const barrido = await p.evaluate(() => {
  const malos = []; let n = 0;
  const plazos = [1, 2, 3, 4, 5, 7, 10, 15, 20, 25, 30, 40];
  for (const plazo of plazos) for (const tipo of ['0', '1', '1.5', '1.7', '2.8', '4.3', '7.77', '9.99']) for (const pct of ['70', '100', '33.33', '80']) {
    aplicarEstado(DEFECTOS);
    el('plazoHipoteca').value = String(plazo); el('tipoHipoteca').value = tipo; el('pctFinanciado').value = pct;
    el('horizonte').value = String(Math.min(plazo + 3, 60));
    const d = calcular(); n++;
    if (!d.sinDeuda || d.sinDeuda.n !== plazo || d.filas[plazo - 1].hipFin !== 0) malos.push(`${plazo}a ${tipo}% ${pct}% → ${d.sinDeuda && d.sinDeuda.n} (${d.filas[plazo - 1].hipFin})`);
  }
  return { n, malos: malos.length, ejemplos: malos.slice(0, 4).join(' · ') };
});
check(`la hipoteca se salda en el año de su plazo (${barrido.n} combinaciones)`, barrido.malos === 0, `${barrido.malos} fallan: ${barrido.ejemplos}`);
const barridoPre = await p.evaluate(() => {
  const malos = []; let n = 0;
  for (const plazo of [1, 2, 3, 5, 8, 10, 15]) for (const tipo of ['0', '3', '4.3', '9', '14.5']) for (const imp of ['20000', '33333', '50000']) {
    aplicarEstado(DEFECTOS);
    el('usarPrestamo').checked = true; el('pctFinanciado').value = '60';
    el('plazoPrestamo').value = String(plazo); el('tipoPrestamo').value = tipo; el('importePrestamo').value = imp;
    el('horizonte').value = String(plazo + 3);
    const d = calcular(); n++;
    if (d.filas[plazo - 1].preFin !== 0) malos.push(`${plazo}a ${tipo}% ${imp}: ${d.filas[plazo - 1].preFin}`);
  }
  return { n, malos: malos.length, ejemplos: malos.slice(0, 4).join(' · ') };
});
check(`el préstamo también (${barridoPre.n} combinaciones)`, barridoPre.malos === 0, `${barridoPre.malos} fallan: ${barridoPre.ejemplos}`);
const k1 = await motor({ plazoHipoteca: '10', tipoHipoteca: '1,5', pctFinanciado: '70', horizonte: '10' },
  `(d) => ({ kpi: el('kpiDeuda').textContent.trim(), fin: d.filas[9].hipFin })`);
check('plazo 10, 1,5 %, 70 %, horizonte 10: el KPI dice «10 años»', k1.kpi === '10 años', `${k1.kpi} (saldo ${k1.fin})`);

// ---------- 2) el año 1 de todo el resumen es el de la tabla ----------
const LECTOR2 = `(d) => { const f = d.filas[0], f2 = d.filas[1], cj = cajaDelAno(d);
  return { cajaReg: d.regimenInicial.caja, caja1: f.cajaAno, impReg: d.regimenInicial.impuestos, imp1: f.irpf, cuotasReg: d.regimenInicial.cuotas, cuotas1: f.cuotas,
    gen: cj.generada, amortiza: cj.amortiza, motor: (f.hipFin + f.preFin) - (f2.hipIni + f2.preIni), aportado: d.aportado,
    roceCaja: d.roceCaja, roceEsp: f.cajaAno / d.aportado, roceSin: d.roceSinReval, roceSinEsp: (f.cajaAno + d.amortizadoAno1) / d.aportado,
    mes: el('kpiCajaMes').textContent.replace(/\\s+/g, ' '), tbl: el('tblCaja').textContent.replace(/\\s+/g, ' '), com: d.comisionApertura,
    ayuda: document.getElementById('regimenesAyuda')?.textContent ?? '', conHip: d.regConHipoteca.caja }; }`;
const A2 = await motor({ aperturaHip: '1,5' }, LECTOR2, { hipotecaAcelerada: true });
check('con comisión, la caja del año 1 del resumen es la de la fila 1', A2.com > 0 && cerca(A2.cajaReg, A2.caja1, 1e-6), `${A2.cajaReg.toFixed(2)} vs ${A2.caja1.toFixed(2)}`);
check('  el IRPF y las cuotas también', cerca(A2.impReg, A2.imp1, 1e-6) && cerca(A2.cuotasReg, A2.cuotas1, 1e-6), `${A2.impReg.toFixed(2)} vs ${A2.imp1.toFixed(2)}`);
check('  lo que dice que va a amortizar es lo que el motor amortiza', A2.amortiza > 0 && cerca(A2.amortiza, A2.motor, 0.01), `${A2.amortiza.toFixed(2)} vs ${A2.motor.toFixed(2)}`);
check('  el texto del KPI lo dice con esa cifra', A2.mes.replace(/\D/g, '') === String(Math.round(A2.motor)), A2.mes);
check('  el ROCE usa esa caja', cerca(A2.roceCaja, A2.roceEsp, 1e-9) && cerca(A2.roceSin, A2.roceSinEsp, 1e-9), `${A2.roceCaja} vs ${A2.roceEsp}`);
const B2 = await motor({ aperturaHip: '2', aperturaPre: '1,5', importePrestamo: '30000', plazoPrestamo: '4', alquiler: '2200', tasaAmortizacion: '0' }, LECTOR2, { usarPrestamo: true });
check('  (el escenario con préstamo paga IRPF, así que la comisión pesa)', B2.impReg > 0, B2.impReg.toFixed(0));
check('  y con préstamo (y su propia comisión) también', B2.com > 0 && cerca(B2.cajaReg, B2.caja1, 1e-6) && cerca(B2.impReg, B2.imp1, 1e-6), `${B2.cajaReg.toFixed(2)} vs ${B2.caja1.toFixed(2)}`);
const C2 = await motor({ aperturaHip: '0' }, LECTOR2);
check('las tres columnas de regímenes describen un año tipo sin la comisión: no cambian con ella', cerca(C2.conHip, (await motor({ aperturaHip: '2' }, LECTOR2)).conHip, 1e-6));
check('  y la ayuda de la tabla lo rotula cuando hay comisión', /apertura/i.test(A2.ayuda) && !/apertura/i.test(C2.ayuda), A2.ayuda.slice(-90));
// Sin amortización fiscal el IRPF sigue siendo positivo al tipo de ruptura, así que la comisión (que
// se deduce) mueve la caja del año 1 y la prueba distingue contarla de no contarla.
const R2 = await motor({ aperturaHip: '2', tasaAmortizacion: '0' }, `(d) => d.rupturaCaja`);
check('la ruptura de caja cuenta la comisión: a ese tipo la caja del año 1 es 0', Number.isFinite(R2) && R2 > 0, String(R2));
const R2b = await p.evaluate((r) => { el('tipoHipoteca').value = (r * 100).toFixed(8).replace('.', ','); render(); const d = calcular(); return { caja: d.filas[0].cajaAno, kpi: d.regimenInicial.caja }; }, R2);
check('  (comprobado poniendo ese tipo en el campo)', Math.abs(R2b.caja) < 0.5 && Math.abs(R2b.kpi) < 0.5, `${R2b.caja.toFixed(3)} · ${R2b.kpi.toFixed(3)}`);

// ---------- 3) el interés deducible que se enseña es el que se resta ----------
const num = (s) => parseFloat(String(s).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
const D3 = await motor({ alquiler: '400', tipoHipoteca: '5', pctFinanciado: '80', horizonte: '8' },
  `(d) => { const fila = (txt) => [...document.querySelectorAll('#tblRegimenes tr')].find(tr => tr.cells[0].textContent.includes(txt));
    const cols = (txt) => [...fila(txt).cells].slice(1).map(c => c.textContent.replace(/\\s+/g, ' ').trim());
    return { ing: cols('Alquiler cobrado'), gas: cols('Gastos del piso'), ded: cols('Interés deducible'), base: cols('Base fiscal'), amort: d.amortizacion,
      nota: el('notaFiscal').textContent.replace(/\\s+/g, ' '), tope: d.regimenInicial.topeAplicado, pagado: d.regimenInicial.interes }; }`);
const cuadra = D3.ing.map((_, i) => num(D3.ing[i]) - Math.abs(num(D3.gas[i])) - num(D3.ded[i]) - D3.amort - num(D3.base[i]));
check('el escenario sirve: el tope muerde (se paga más interés que lo deducible)', D3.tope === true && D3.pagado > 0, `pagado ${D3.pagado.toFixed(0)}`);
check('en la tabla de regímenes, alquiler − gastos − interés deducible − amortización = base (3 columnas)', cuadra.every(x => Math.abs(x) < 2.5), cuadra.map(x => x.toFixed(1)).join(' · '));
check('  y las columnas con deuda dicen «tope aplicado»', /tope/i.test(D3.ded[0]) && /tope/i.test(D3.ded[1]) && !/tope/i.test(D3.ded[2]), D3.ded.join(' | '));
const importes = (D3.nota.match(/-?\d[\d.]*(?=\s?€)/g) || []).map(s => parseFloat(s.replace(/\./g, '')));
check('en la nota fiscal la resta también cuadra', importes.length >= 5 && Math.abs(importes[0] - importes[1] - importes[2] - importes[3] - importes[4]) < 2.5, D3.nota.slice(0, 150));
check('  y la nota dice que el tope se aplica y cuánto se arrastra', /tope/i.test(D3.nota) && /arrastr/i.test(D3.nota), D3.nota.slice(-170));
const N3 = await motor({}, `(d) => ({ nota: el('notaFiscal').textContent, ded: [...document.querySelectorAll('#tblRegimenes tr')].find(tr => tr.cells[0].textContent.includes('Interés deducible')).textContent })`);
check('sin tope no aparece ni «tope» ni «arrastr» en la nota ni en la fila', !/tope|arrastr/i.test(N3.nota) && !/tope/i.test(N3.ded.replace('Interés deducible', '')), N3.nota.slice(0, 120));

// ---------- 4) sin liquidez propia, las aportaciones posteriores cuentan ----------
const K4 = await motor({ pctFinanciado: '100', importePrestamo: '1000000000', tipoPrestamo: '5', plazoPrestamo: '10', alquiler: '700' },
  `(d) => { const T = id => el(id).textContent.replace(/\\s+/g, ' '); return { aportado: d.aportado, extra: d.aportacionesExtra, payback: T('kpiPayback'), roce: T('kpiRoce'), detalle: T('kpiRoceDetalle'), roceN: d.roce }; }`,
  { usarPrestamo: true });
check('el escenario sirve: aportado 0 y aportaciones después', K4.aportado === 0 && K4.extra > 0, `aportado ${K4.aportado} · después ${K4.extra.toFixed(0)}`);
check('el KPI de recuperación no dice «Sin aportación que recuperar»', !/Sin aportación/.test(K4.payback), K4.payback);
check('el ROCE no es «—»', K4.roce !== '—' && K4.roceN !== null && Number.isFinite(K4.roceN), `${K4.roce} · ${K4.detalle}`);

// ---------- 5) inflación negativa y revalorización «a la par» ----------
const I5 = await motor({ inflacion: '-2' }, `(d) => ({ rev: d.revalorizacion, campo: el('revalorizacion').value })`);
check('con inflación −2 % y el candado cerrado la revalorización es −2 %', cerca(I5.rev, -0.02, 1e-12) && /^-2,00$/.test(I5.campo), `${I5.rev} · «${I5.campo}»`);
const I5b = await motor({ inflacion: '20' }, `(d) => ({ rev: d.revalorizacion })`);
check('  y con +20 % sigue siendo +20 %', cerca(I5b.rev, 0.20, 1e-12));

// ---------- 6) la TIR por encima del 1.000 % ----------
const T6 = await p.evaluate(() => ({ a: tir([-1000, 50000]), b: tir([-1000, 0, 0, 300000]), c: tir([-1000, 3000]) }));
check('tir([−1.000, 50.000]) es 4.900 %', T6.a !== null && cerca(T6.a, 49, 1e-6), String(T6.a));
check('  y a tres años, la raíz cúbica', T6.b !== null && cerca(Math.pow(1 + T6.b, 3), 300, 1e-3), String(T6.b));
check('  sin romper la de siempre (200 %)', cerca(T6.c, 2, 1e-9), String(T6.c));

// ---------- 7) FAQ del apalancamiento: misma base en las dos columnas ----------
const F7 = await p.evaluate(() => { resetDefaults(); el('tipoMarginal').value = '45'; render();
  const d = calcular(); const fila = [...document.querySelectorAll('#faqApalancamiento tr')][0];
  return { piso: fila.cells[1].textContent.trim(), esperado: fmtPct(d.rentabilidadNeta + d.revalorizacion, 2), antes: fmtPct((d.alquilerAnual - d.gastosAnuales) / d.costeTotal + d.revalorizacion, 2),
    desglose: fila.cells[2].textContent.trim(), neta: fmtPct(d.rentabilidadNeta, 2),
    es: FAQ.es[0].a + TEXTOS.es.faqNotaDeduccion, en: FAQ.en[0].a + TEXTOS.en.faqNotaDeduccion }; });
check('lo que rinde el piso es la rentabilidad neta tras IRPF + revalorización', F7.piso === F7.esperado && F7.piso !== F7.antes, `${F7.piso} (antes ${F7.antes})`);
check('  y el desglose lo dice', F7.desglose.startsWith(F7.neta), F7.desglose);
check('  los textos hablan de después de impuestos en los dos idiomas', /después de impuestos/.test(F7.es) && /after tax/i.test(F7.en));

// ---------- 8) comentarios sin cifras viejas ----------
const fuente = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('ningún comentario conserva «8.704 €» ni «4.892 €»', !/8\.704|4\.892/.test(fuente));

// ---------- 9) una oferta por encima del anunciado sobrevive ----------
const q = await abrir();
await q.evaluate(() => localStorage.clear()); await q.reload(); await q.waitForTimeout(400);
const val = (pg, id) => pg.inputValue('#' + id);
await q.fill('#oferta', '300000'); await q.press('#oferta', 'Tab');
const desc0 = await val(q, 'descuentoOferta');
check('el descuento sale negativo al ofertar por encima', /^-/.test(desc0) && (await val(q, 'oferta')) === '300.000', `${desc0} · ${await val(q, 'oferta')}`);
await q.waitForTimeout(800);
await q.reload(); await q.waitForTimeout(500);
check('recargando la página la oferta sigue', (await val(q, 'oferta')) === '300.000' && /^-/.test(await val(q, 'descuentoOferta')), `${await val(q, 'oferta')} · ${await val(q, 'descuentoOferta')}`);
await q.fill('#alquiler', '1300'); await q.press('#alquiler', 'Tab');
await q.evaluate(() => document.activeElement.blur());
await q.keyboard.press('Control+z'); await q.waitForTimeout(100);
check('deshacer un cambio posterior no toca la oferta', (await val(q, 'oferta')) === '300.000' && (await val(q, 'alquiler')) === '1.250', `${await val(q, 'oferta')} · ${await val(q, 'alquiler')}`);
await q.keyboard.press('Control+y'); await q.waitForTimeout(100);
check('  ni rehacerlo', (await val(q, 'oferta')) === '300.000' && (await val(q, 'alquiler')) === '1.300', `${await val(q, 'oferta')} · ${await val(q, 'alquiler')}`);
const enlace = new URL(await q.evaluate(() => enlaceConCalculos())).search;
const q2 = await abrir(enlace);
check('abrir un enlace con esa oferta la conserva', (await val(q2, 'oferta')) === '300.000' && /^-/.test(await val(q2, 'descuentoOferta')), `${await val(q2, 'oferta')} · ${await val(q2, 'descuentoOferta')}`);
await q2.fill('#descuentoOferta', '-10'); await q2.press('#descuentoOferta', 'Tab');
check('lo que teclea el usuario sí se recorta: un descuento negativo vuelve a 0', (await val(q2, 'descuentoOferta')) === '0' && (await val(q2, 'oferta')) === '260.000', `${await val(q2, 'descuentoOferta')} · ${await val(q2, 'oferta')}`);
await q.close(); await q2.close();

// ---------- 10) importes pegados con texto ----------
const P10 = await p.evaluate(() => {
  const casos = [['247.000 €', 247000], ['1.250 €', 1250], ['1.250 euros', 1250], ['1.250/mes', 1250], ['€1.250', 1250], ['€ 247.000', 247000],
    ['$1,250.00', 1250], ['−1.250', -1250], ['1.250,50 €', 1250.5], ['1,250.50', 1250.5], ['0,125 €', 0.125], ['abc', 0], ['', 0], ['1e6', 1e6]];
  const mal = casos.filter(([s, v]) => parseNum(s) !== v).map(([s, v]) => `«${s}»→${parseNum(s)} (esperado ${v})`);
  const dec = [['2,375 %', 2.375], ['%2.375', 2.375], ['3,5%', 3.5], ['−2,5', -2.5]].filter(([s, v]) => parseNum(s, true) !== v).map(([s, v]) => `«${s}»→${parseNum(s, true)}`);
  return { mal, dec };
});
check('importes con texto o símbolos se leen enteros', P10.mal.length === 0, P10.mal.join(' · '));
check('  y los porcentajes con símbolo, como decimales', P10.dec.length === 0, P10.dec.join(' · '));
await p.evaluate(() => resetDefaults());
await p.fill('#alquiler', '€1.250/mes'); await p.press('#alquiler', 'Tab');
check('  pegado en un campo: «€1.250/mes» queda en 1.250', (await val(p, 'alquiler')) === '1.250', await val(p, 'alquiler'));

// ---------- 11) comisión de apertura en € ----------
const E11 = await p.evaluate(() => { resetDefaults(); el('aperturaHipEur').checked = true; render(); return true; });
await p.fill('#aperturaHip', '2.000'); await p.press('#aperturaHip', 'Tab');
const E11b = await p.evaluate(() => ({ campo: el('aperturaHip').value, com: calcular().comisionHip, n: num('aperturaHip') }));
check('en modo € la comisión «2.000» son 2.000 €, no 2 €', E11b.n === 2000 && cerca(E11b.com, 2000, 1e-9) && E11b.campo === '2.000,00', JSON.stringify(E11b));

await seccion('12-13 comparador', async () => {
// ---------- 12 y 13) el editor de nombre del comparador ----------
await p.evaluate(() => {
  resetDefaults();
  for (const pct of ['60', '50', '40']) { el('pctFinanciado').value = pct; anadirComparacion(); }
  el('pctFinanciado').value = '70'; render();
});
const nombres = () => p.evaluate(() => OPCIONES.map(o => o.nombre || '·').join());
check('el escenario sirve: tres opciones en la comparación', (await p.evaluate(() => OPCIONES.length)) === 3);
await p.dblclick('[data-renombrar="A"]');
await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
check('Ctrl+Z con el editor abierto no toca el historial global', (await p.evaluate(() => OPCIONES.length)) === 3 && !!(await p.$('.cmp-edit')));
await p.keyboard.press('Control+a'); await p.keyboard.type('Banco Norte'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
check('  y el nombre escrito se guarda en la opción actual', (await nombres()).split(',')[0] === 'Banco Norte', await nombres());
check('  y se ve en la cabecera', (await p.evaluate(() => document.querySelector('#tblComparar thead [data-renombrar="A"]').textContent)).includes('Banco Norte'));
// 13: con el editor abierto, ✕ de otra opción repinta la tabla
await p.dblclick('[data-renombrar="A"]');
await p.keyboard.press('Control+a'); await p.keyboard.type('Cambiado');
await p.click('[data-quitar="C"]'); await p.waitForTimeout(150);
const Q13 = await p.evaluate(() => ({ cols: document.querySelectorAll('#tblComparar thead th[data-opcion]').length, editor: !!document.querySelector('.cmp-edit'), n: OPCIONES.length, nom: OPCIONES[0].nombre }));
check('✕ de otra opción con el editor abierto: la tabla se repinta y el editor se confirma', Q13.cols === 2 && !Q13.editor && Q13.n === 2 && Q13.nom === 'Cambiado', JSON.stringify(Q13));
await p.evaluate(() => { el('pctFinanciado').value = '55'; anadirComparacion(); el('pctFinanciado').value = '70'; render(); });
await p.dblclick('[data-renombrar="A"]');
await p.click('[data-cargar="B"]'); await p.waitForTimeout(150);
const L13 = await p.evaluate(() => ({ editor: !!document.querySelector('.cmp-edit'), pct: el('pctFinanciado').value, cols: document.querySelectorAll('#tblComparar thead th[data-opcion]').length }));
check('Cargar otra opción con el editor abierto lo cierra y carga', !L13.editor && L13.pct === '50' && L13.cols === 3, JSON.stringify(L13));
await p.dblclick('[data-renombrar="A"]');
await p.click('[data-renombrar="B"] .cmp-lapiz'); await p.waitForTimeout(150);
const Lp = await p.evaluate(() => ({ editores: document.querySelectorAll('.cmp-edit').length, dentro: !!document.querySelector('[data-renombrar="B"] .cmp-edit') }));
check('el lápiz de otra opción con el editor abierto abre el de esa, en la tabla viva', Lp.editores === 1 && Lp.dentro, JSON.stringify(Lp));
await p.keyboard.press('Escape');
await p.evaluate(() => { OPCIONES = []; resetDefaults(); });

});

await seccion('14 globo', async () => {
// ---------- 14) el globo de recorte se recoloca al desplazar ----------
await p.evaluate(() => { window.scrollTo(0, 0); resetDefaults(); });
await p.fill('#plazoHipoteca', '99'); await p.press('#plazoHipoteca', 'Tab'); await p.waitForTimeout(50);
const g0 = await p.evaluate(() => ({ visible: !el('avisoLimite').hidden }));
check('el recorte enseña su globo', g0.visible);
await p.evaluate(() => window.scrollBy(0, 40)); await p.waitForTimeout(200);
const g1 = await p.evaluate(() => { const c = el('avisoLimite'), f = el('plazoHipoteca').getBoundingClientRect(), r = c.getBoundingClientRect();
  return { visible: !c.hidden, scroll: window.scrollY, junto: Math.abs(r.top - (f.bottom + 6)) < 3 || Math.abs(r.bottom - (f.top - 6)) < 3, derecha: Math.abs(r.right - f.right) < 12 }; });
check('un scroll pequeño no lo esconde', g1.visible && g1.scroll > 0, JSON.stringify(g1));
check('  y lo deja pegado a su campo', g1.junto, JSON.stringify(g1));
await p.evaluate(() => window.scrollBy(0, 4000)); await p.waitForTimeout(200);
check('si el campo sale de la pantalla sí se esconde', await p.evaluate(() => el('avisoLimite').hidden));
await p.evaluate(() => window.scrollTo(0, 0));

});

// ---------- 15) guardar al esconder o cerrar la pestaña ----------
const S15 = await p.evaluate(() => {
  const KEY = 'calc_pisos_v2', leer = () => JSON.parse(localStorage.getItem(KEY) || '{}').alquiler;
  resetDefaults(); localStorage.removeItem(KEY);
  el('alquiler').value = '1333'; el('alquiler').dispatchEvent(new Event('change'));
  const antes = leer();
  window.dispatchEvent(new Event('pagehide'));
  const trasPagehide = leer();
  el('alquiler').value = '1444'; el('alquiler').dispatchEvent(new Event('change'));
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  const trasHidden = leer();
  delete document.visibilityState;
  return { antes, trasPagehide, trasHidden };
});
check('un cambio dentro del debounce se guarda en pagehide', S15.antes === undefined && S15.trasPagehide === '1333', JSON.stringify(S15));
check('  y al esconderse la pestaña (visibilitychange)', S15.trasHidden === '1444', JSON.stringify(S15));

// ---------- 16) deudas apagadas sin avisos en rojo ----------
const V16 = await p.evaluate(() => {
  resetDefaults();
  const ids = ['plazoHipoteca', 'tipoHipoteca', 'plazoPrestamo', 'tipoPrestamo'];
  el('plazoHipoteca').value = '35'; el('tipoHipoteca').value = '8'; el('plazoPrestamo').value = '12'; el('tipoPrestamo').value = '12';
  const rojo = () => ids.filter(id => el(id).classList.contains('val-neg'));
  el('usarHipoteca').checked = false; el('usarPrestamo').checked = false; render();
  const apagadas = rojo(), alto = !el('altoPrestamo').classList.contains('hidden');
  el('usarHipoteca').checked = true; el('usarPrestamo').checked = true; render();
  const encendidas = rojo();
  return { apagadas, alto, encendidas };
});
check('con las dos deudas apagadas ningún campo suyo está en rojo ni dice (ALTO)', V16.apagadas.length === 0 && !V16.alto, JSON.stringify(V16));
check('  y encendidas, los cuatro avisan', V16.encendidas.length === 4, JSON.stringify(V16.encendidas));

await seccion('17 idioma', async () => {
// ---------- 17) todos los campos numéricos en el idioma activo ----------
const L17 = await p.evaluate(() => {
  document.activeElement.blur();
  resetDefaults(); aplicarIdioma('es');
  const campos = CAMPOS.filter(id => el(id).tagName === 'INPUT' && el(id).type === 'text');
  const lee = () => Object.fromEntries(campos.map(id => [id, el(id).value]));
  const es = lee();
  aplicarIdioma('en'); const en = lee();
  aplicarIdioma('es');
  const sueltos = (v, sep) => campos.filter(id => !esMoneda(id) && v[id].includes(sep === ',' ? '.' : ','));
  return { es: sueltos(es, ','), en: sueltos(en, '.'), n: campos.length };
});
check(`en español ningún campo no monetario lleva punto decimal (${L17.n} campos)`, L17.es.length === 0, L17.es.join());
check('  y en inglés ninguno lleva coma decimal', L17.en.length === 0, L17.en.join());
await p.evaluate(() => { resetDefaults(); aplicarIdioma('es'); document.querySelectorAll('.tab-btn')[3].click(); });
await p.fill('#pctFinanciado', '66.5'); await p.press('#pctFinanciado', 'Tab');
await p.fill('#descuentoOferta', '7,5'); await p.press('#descuentoOferta', 'Tab');
await p.fill('#tasaIbi', '0.35'); await p.press('#tasaIbi', 'Tab');
check('al salir de un campo sin formato fijo, «66.5» queda «66,5» (y «0.35», «0,35»)', (await val(p, 'pctFinanciado')) === '66,5' && (await val(p, 'tasaIbi')) === '0,35', `${await val(p, 'pctFinanciado')} · ${await val(p, 'tasaIbi')}`);
await p.click('#langBtn'); await p.waitForTimeout(200);
check('al cambiar a inglés se reformatean (66.5, 7.5, 0.35)', (await val(p, 'pctFinanciado')) === '66.5' && (await val(p, 'descuentoOferta')) === '7.5' && (await val(p, 'tasaIbi')) === '0.35',
  `${await val(p, 'pctFinanciado')} · ${await val(p, 'descuentoOferta')} · ${await val(p, 'tasaIbi')}`);
await p.click('#langBtn'); await p.waitForTimeout(200);
check('  y de vuelta a castellano', (await val(p, 'pctFinanciado')) === '66,5' && (await val(p, 'descuentoOferta')) === '7,5', `${await val(p, 'pctFinanciado')} · ${await val(p, 'descuentoOferta')}`);
await p.evaluate(() => { resetDefaults(); document.querySelectorAll('.tab-btn')[0].click(); });

});

await seccion('18 apertura', async () => {
// ---------- 18) %↔€ de la apertura restaura el texto original ----------
await p.evaluate(() => { resetDefaults(); });
await p.fill('#aperturaHip', '3,3656'); await p.press('#aperturaHip', 'Tab');
await p.click('#modoAperturaHip');
const euros = await val(p, 'aperturaHip');
await p.click('#modoAperturaHip');
const vuelta = await val(p, 'aperturaHip');
check('«3,3656» % → € → % vuelve a «3,3656», no a «3,365601»', euros !== '3,3656' && vuelta === '3,3656', `${euros} → ${vuelta}`);
await p.click('#modoAperturaHip');
await p.fill('#aperturaHip', '2.500,00'); await p.press('#aperturaHip', 'Tab');
await p.click('#modoAperturaHip'); const pct = await val(p, 'aperturaHip');
await p.click('#modoAperturaHip'); const eur2 = await val(p, 'aperturaHip');
check('€ → % → € restaura los euros escritos', eur2 === '2.500,00', `2.500,00 → ${pct} → ${eur2}`);
await p.click('#modoAperturaHip'); await p.fill('#aperturaHip', '1'); await p.press('#aperturaHip', 'Tab');
await p.click('#modoAperturaHip'); await p.fill('#aperturaHip', '2'); await p.press('#aperturaHip', 'Tab');
await p.click('#modoAperturaHip');
check('si se edita entre medias no se restaura nada viejo', (await val(p, 'aperturaHip')) !== '1', await val(p, 'aperturaHip'));
await p.evaluate(() => resetDefaults());

});

// ---------- 19) basura en un enlace o en lo guardado ----------
const g = await abrir('?z=NaN&p=abc&f=Infinity&h=%20&t=1e999&a=--');
const G19 = { horizonte: await val(g, 'horizonte'), precio: await val(g, 'precioAnunciado'), f: await val(g, 'pctFinanciado'), h: await val(g, 'plazoHipoteca'), t: await val(g, 'tipoHipoteca'), a: await val(g, 'alquiler') };
check('en un enlace, lo no numérico deja el valor por defecto', G19.horizonte === '30' && G19.precio === '260.000' && G19.f === '70' && G19.h === '30' && G19.t === '2,80' && G19.a === '1.250', JSON.stringify(G19));
await g.close();
const g2 = await abrir();
await g2.waitForTimeout(900);   // que el guardado del arranque ya haya salido: pagehide no pise lo que se escribe a mano
await g2.evaluate(() => localStorage.setItem('calc_pisos_v2', JSON.stringify({ horizonte: 'NaN', alquiler: 'Infinity', pctFinanciado: 'abc', tipoHipoteca: 'x', plazoHipoteca: '12' })));
await g2.reload(); await g2.waitForTimeout(500);
const G19b = { horizonte: await val(g2, 'horizonte'), alquiler: await val(g2, 'alquiler'), f: await val(g2, 'pctFinanciado'), t: await val(g2, 'tipoHipoteca'), h: await val(g2, 'plazoHipoteca') };
check('en lo guardado también, y lo válido de al lado se respeta', G19b.horizonte === '30' && G19b.alquiler === '1.250' && G19b.f === '70' && G19b.t === '2,80' && G19b.h === '12', JSON.stringify(G19b));
await g2.close();

// ---------- 20) zona táctil del año de referencia ----------
const m = await abrir('', 390, 844);
await m.evaluate(() => { if (el('kpiGrid').classList.contains('hidden')) alternarKpis(); el('anoRefBtn').scrollIntoView({ block: 'center' }); });
await m.waitForTimeout(200);
const T20 = await m.evaluate(() => {
  const r = el('anoRefBtn').getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const toca = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && !!e.closest('#anoRefBtn'); };
  return { w: r.width, h: r.height, esquinas: [[-15, -15], [15, -15], [-15, 15], [15, 15]].map(([dx, dy]) => toca(cx + dx, cy + dy)),
    lados: [[-15, 0], [15, 0], [0, -15], [0, 15]].map(([dx, dy]) => toca(cx + dx, cy + dy)), fuera: toca(cx + 40, cy + 40) };
});
check('el botón mide lo mismo que antes (no cambia su aspecto)', T20.w < 45 && T20.h < 22, `${T20.w.toFixed(0)}×${T20.h.toFixed(0)}`);
check('  y se acierta a 15 px de su centro en vertical y en horizontal (zona de 32×32)', T20.lados.every(Boolean) && T20.esquinas.every(Boolean) && !T20.fuera, JSON.stringify(T20));
await m.close();

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
