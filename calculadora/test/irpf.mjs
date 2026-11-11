// El IRPF del alquiler y el año 1. Cada bloque se escribió primero y se vio fallar con el motor
// de antes (media anualidad en el año 1, deducción sin tope), y aquí se quedan como guardia.
//
//  1  una comisión de apertura que no cabe en los ingresos del año 1 se arrastra y se aprovecha
//  2  un interés que choca con el tope (art. 23.1.a LIRPF) se recorta y el exceso se aprovecha
//  3  lo que no cabe en cuatro años se pierde, y se pierde en el año que toca
//  4  un rendimiento negativo por los demás gastos da impuesto 0: no hay otros ingresos contra los que compensarlo
//  5  el año 1 es un año completo: caja, cuotas, IRPF y reparto cuadran sin media anualidad
//  6  la rentabilidad bruta usa los doce meses, sin descontar los vacíos
//  7  ningún texto ni comentario habla ya de media anualidad
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1300, height: 1100 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.evaluate(() => localStorage.clear()); await p.goto(PAGINA); await p.waitForTimeout(400);
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(84)} ${d}`); };
const cerca = (a, c, tol = 0.01) => Math.abs(a - c) <= tol;

// Mismo armazón que revision.mjs: sin indexar y sin inflación, para que cada año sea
// ingresos − gastos − impuestos − cuotas sin factores de por medio.
const motor = (cfg, lector) => p.evaluate(([cfg, lector]) => {
  resetDefaults();
  const base = { indexar: 'no', inflacion: '0', ...cfg.campos };
  for (const [id, v] of Object.entries(base)) el(id).value = v;
  for (const [id, v] of Object.entries(cfg.casillas || {})) el(id).checked = v;
  for (const id of cfg.abrir || []) el('auto' + capitalizar(id)).checked = false;
  render();
  return new Function('d', 'return (' + lector + ')(d)')(calcular());
}, [cfg, lector]);

// Lo que cada escenario necesita para rehacer la cuenta del tope por su cuenta.
const LECTOR = `(d) => ({
  ingresos: d.alquilerAnual, gastos: d.gastosAnuales, mant: d.mantenimiento, amort: d.amortizacion,
  tipo: d.tipoEfectivo, comision: d.comisionApertura, horizonte: d.horizonte,
  filas: d.filas.map(f => ({ n: f.n, irpf: f.irpf, interes: f.interes, caja: f.cajaAno, ded: f.finDeducido ?? NaN, pend: f.finPendiente ?? NaN, perd: f.finPerdido ?? NaN }))
})`;
// La conservación: todo lo que el tope tiene que repartir acaba deducido, pendiente o perdido.
const conserva = (e) => {
  const entra = e.comision + e.filas.reduce((s, f) => s + f.interes + e.mant, 0);
  const ultima = e.filas[e.filas.length - 1];
  return entra - (e.filas.reduce((s, f) => s + f.ded, 0) + ultima.pend + ultima.perd);
};

// ---------- 1) la comisión que no cabe el año 1 se arrastra ----------
// Alquiler muy bajo (600 €/mes, 7.200 € al año) y apertura del 10 % sobre 90.000 €: la comisión
// sola (9.000 €) ya supera los ingresos del año 1. Sin amortización fiscal, para que la base del
// año 2 siga siendo positiva y se vea cuánto impuesto ahorra lo arrastrado.
const GASTOS = ['comunidad', 'ibi', 'seguroHogar', 'seguroImpagos', 'mantenimiento'];
const A = await motor({
  campos: { oferta: '100000', pctFinanciado: '90', aperturaHip: '10', tipoHipoteca: '1', alquiler: '600', mesesVacios: '0', tasaAmortizacion: '0',
    comunidad: '10', ibi: '100', seguroHogar: '100', seguroImpagos: '350', mantenimiento: '40', horizonte: '10' },
  abrir: GASTOS }, LECTOR);
const a1 = A.filas[0], a2 = A.filas[1];
check('el escenario sirve: la comisión sola supera los ingresos del año 1', A.comision > A.ingresos, `${A.comision.toFixed(0)} > ${A.ingresos.toFixed(0)}`);
check('  y con el interés y la conservación, más todavía',
  A.comision + a1.interes + A.mant > A.ingresos, `${(A.comision + a1.interes + A.mant).toFixed(0)} > ${A.ingresos.toFixed(0)}`);
check('año 1: se deduce como mucho el ingreso íntegro', cerca(a1.ded, A.ingresos), `${a1.ded.toFixed(2)} de ${A.ingresos}`);
check('  el exceso queda pendiente, entero', cerca(a1.pend, A.comision + a1.interes + A.mant - A.ingresos), a1.pend.toFixed(2));
check('  y el IRPF del año 1 es 0', a1.irpf === 0, String(a1.irpf));
check('año 2: se aprovecha todo el pendiente (cabe) además de lo propio', cerca(a2.ded, a2.interes + A.mant + a1.pend), `${a2.ded.toFixed(2)} vs ${(a2.interes + A.mant + a1.pend).toFixed(2)}`);
check('  y ya no queda nada pendiente', a2.pend === 0, String(a2.pend));
const sinArrastre2 = Math.max((A.ingresos - (A.gastos - A.mant) - (a2.interes + A.mant) - A.amort) * A.tipo, 0);
const conArrastre2 = Math.max((A.ingresos - (A.gastos - A.mant) - a2.ded - A.amort) * A.tipo, 0);
check('  el IRPF del año 2 es el de la cuenta con arrastre', cerca(a2.irpf, conArrastre2), `${a2.irpf.toFixed(2)} vs ${conArrastre2.toFixed(2)}`);
check('  y es menor que el que saldría sin arrastre (la comisión se aprovecha)', a2.irpf < sinArrastre2 - 1 && a2.irpf > 0, `${a2.irpf.toFixed(2)} < ${sinArrastre2.toFixed(2)}`);
check('nada se crea ni se pierde: deducido + pendiente + perdido = lo que había que deducir', cerca(conserva(A), 0, 0.01), conserva(A).toFixed(4));
check('ningún año deduce más que sus ingresos', A.filas.every(f => f.ded <= A.ingresos + 1e-6));

// ---------- 2) un interés que choca con el tope ----------
// Hipoteca a 6 años al 6 % sobre un alquiler de 1.800 €/mes: el interés del año 1 se come el ingreso.
const B = await motor({ campos: { oferta: '500000', pctFinanciado: '80', tipoHipoteca: '6', plazoHipoteca: '6', alquiler: '1800', mesesVacios: '0', horizonte: '10' } }, LECTOR);
const b1 = B.filas[0];
check('interés + conservación del año 1 superan el ingreso (el escenario sirve)', b1.interes + B.mant > B.ingresos, `${(b1.interes + B.mant).toFixed(0)} > ${B.ingresos}`);
check('año 1: la deducción se recorta al ingreso íntegro', cerca(b1.ded, B.ingresos));
check('  y el exceso queda pendiente', cerca(b1.pend, b1.interes + B.mant - B.ingresos), b1.pend.toFixed(2));
check('el exceso se aprovecha cuando el interés baja y deja hueco', B.filas.some((f, i) => i > 0 && f.ded > f.interes + B.mant + 1e-6), B.filas.map(f => f.pend.toFixed(0)).join(' '));
check('nada se crea ni se pierde', cerca(conserva(B), 0, 0.01), conserva(B).toFixed(4));
check('ningún año deduce más que sus ingresos', B.filas.every(f => f.ded <= B.ingresos + 1e-6));

// ---------- 3) lo que no cabe en cuatro años se pierde ----------
// Al 8 % ningún año deja hueco: el exceso del año 1 caduca al llegar el sexto.
const C = await motor({ campos: { oferta: '500000', pctFinanciado: '80', tipoHipoteca: '8', alquiler: '2000', mesesVacios: '0', horizonte: '12' } }, LECTOR);
const excesoAno1 = C.filas[0].pend;
check('el exceso del año 1 existe y no hay hueco en los años 2 a 5', excesoAno1 > 0 && C.filas.slice(1, 5).every(f => cerca(f.ded, C.ingresos)), excesoAno1.toFixed(0));
check('hasta el año 5 no se ha perdido nada', C.filas.slice(0, 5).every(f => f.perd === 0), C.filas.slice(0, 6).map(f => f.perd.toFixed(0)).join(' '));
check('en el año 6 se pierde justo el exceso del año 1', cerca(C.filas[5].perd, excesoAno1), `${C.filas[5].perd.toFixed(2)} vs ${excesoAno1.toFixed(2)}`);
const excesoAno2 = C.filas[1].interes + C.mant - C.ingresos;
check('y en el 7 el del año 2', cerca(C.filas[6].perd - C.filas[5].perd, excesoAno2), `${(C.filas[6].perd - C.filas[5].perd).toFixed(2)} vs ${excesoAno2.toFixed(2)}`);
check('nada se crea ni se pierde (lo perdido cuenta)', cerca(conserva(C), 0, 0.01), conserva(C).toFixed(4));

// ---------- 4) pérdida por los demás gastos: impuesto 0, sin compensar ----------
const D = await motor({ campos: { alquiler: '300', mesesVacios: '0', horizonte: '5' }, casillas: { usarHipoteca: false } },
  `(d) => ({ rn: d.alquilerAnual - d.gastosAnuales - d.amortizacion, filas: d.filas.map(f => ({ irpf: f.irpf, caja: f.cajaAno })), caja: d.alquilerAnual - d.gastosAnuales })`);
check('el escenario sirve: gastos y amortización superan el alquiler', D.rn < 0, D.rn.toFixed(0));
check('el impuesto es 0 todos los años, nunca negativo', D.filas.every(f => f.irpf === 0));
check('y la caja es alquiler − gastos, sin crédito fiscal', D.filas.every(f => cerca(f.caja, D.caja)));

// ---------- 5) el año 1 es un año completo ----------
const E = await p.evaluate(() => { resetDefaults(); render(); const d = calcular(), f = d.filas[0];
  return { caja: f.cajaAno, gen: d.regimenInicial.caja, irpf: f.irpf, imp: d.regimenInicial.impuestos,
    cuotas: f.cuotas, cuotasEsp: d.cuotaHip * 12 + (d.principalPre > 0 ? d.cuotaPre * 12 : 0), amort: d.reparto.amortizacion,
    deuda: d.principalHip + d.principalPre, cajaF2: d.filas[1].cajaAno, irpf2: d.filas[1].irpf }; });
check('la caja del año 1 es la del régimen anual, no su mitad', cerca(E.caja, E.gen, 1e-6), `${E.caja.toFixed(2)} vs ${E.gen.toFixed(2)}`);
check('el IRPF del año 1 es el del régimen anual', cerca(E.irpf, E.imp, 1e-6), `${E.irpf.toFixed(2)} vs ${E.imp.toFixed(2)}`);
check('las cuotas del año 1 son doce', cerca(E.cuotas, E.cuotasEsp, 1e-6), `${E.cuotas.toFixed(2)} vs ${E.cuotasEsp.toFixed(2)}`);
check('el año 1 y el 2 se parecen (misma escala, no la mitad)', E.caja / E.cajaF2 > 0.9 && E.caja / E.cajaF2 < 1.1, `${E.caja.toFixed(0)} y ${E.cajaF2.toFixed(0)}`);
check('«A dónde va el alquiler»: el principal amortizado es la deuda inicial', cerca(E.amort, E.deuda, 0.01), `${E.amort.toFixed(2)} vs ${E.deuda}`);
const F = await motor({ campos: { oferta: '247000', pctFinanciado: '50', plazoHipoteca: '10.5' } },
  `(d) => { const r = d.reparto; return { amort: r.amortizacion, deuda: d.principalHip + d.principalPre, cierra: d.ingresosAcum + d.aportacionesExtra - (r.gastos + r.irpf + r.intereses + r.amortizacion + r.caja) }; }`);
check('  también con una deuda que se cancela a mitad de año', cerca(F.amort, F.deuda, 0.01) && Math.abs(F.cierra) < 0.01, `${F.amort.toFixed(2)} vs ${F.deuda}; residuo ${F.cierra.toFixed(4)}`);

// ---------- 6) la bruta usa los doce meses ----------
const lectorBruta = `(d) => ({ bruta: d.rentabilidadBruta, esp: d.alquiler * 12 / d.costeTotal, neta: d.rentabilidadNeta, caja: d.filas[0].cajaAno,
  kpi: el('kpiBruta').textContent, resumen: el('kpiResBruta').textContent, detalle: el('kpiBrutaDetalle').textContent.replace(/\\s+/g, ' '),
  alq: d.alquiler * 12, coste: d.costeTotal })`;
const G0 = await motor({ campos: { mesesVacios: '0' } }, lectorBruta);
const G3 = await motor({ campos: { mesesVacios: '3' } }, lectorBruta);
check('la bruta es alquiler × 12 / coste total', cerca(G3.bruta, G3.esp, 1e-12), `${G3.bruta} vs ${G3.esp}`);
check('  y los meses vacíos no la mueven', cerca(G0.bruta, G3.bruta, 1e-12));
check('  ni el KPI ni el «Bruta sobre el coste total» del resumen', G0.kpi === G3.kpi && G3.kpi === G3.resumen, `${G0.kpi} · ${G3.kpi} · ${G3.resumen}`);
check('  el detalle del KPI enseña el alquiler de doce meses', G3.detalle.replace(/\D/g, '').startsWith(String(Math.round(G3.alq))), G3.detalle);
check('en cambio la neta y la caja sí bajan con los vacíos', G3.neta < G0.neta && G3.caja < G0.caja, `${G0.neta.toFixed(4)} → ${G3.neta.toFixed(4)}`);
const tips = await p.evaluate(() => ({ es: TEXTOS.es.kpiBrutaTip, en: TEXTOS.en.kpiBrutaTip }));
check('el tooltip lo dice en los dos idiomas', /doce meses/.test(tips.es) && /vac/.test(tips.es) && /twelve months/i.test(tips.en) && /empty/i.test(tips.en));

// ---------- 7) ni rastro de la media anualidad ----------
const fuente = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const resto = fuente.match(/media anualidad|mid-year|mitad de año|\bmitad\s*=|half[- ]year/gi) || [];
check('el HTML no habla de media anualidad ni de compra a mitad de año', resto.length === 0, resto.join(' · '));
const modelo = readFileSync(new URL('./modelo.py', import.meta.url), 'utf8');
check('y el modelo en Python tampoco', !/mitad\s*=|media anualidad/i.test(modelo));

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
