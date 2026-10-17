// Interés deducible real, meses sin inquilino y las dos columnas de venta.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1100 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA);
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(700);

let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(56)} ${d}`); };
const eur = v => Math.round(v).toLocaleString('es-ES') + ' €';

// ---------- 1) el interés deducible es el del año ----------
await p.evaluate(() => resetDefaults());
const int = await p.evaluate(() => {
  const d = calcular();
  const real = d.filas.map(f => {
    const cuota = f.hipIni > 0 ? d.cuotaHip * 12 : 0;
    return Math.max(cuota - Math.max(f.hipIni - f.hipFin, 0), 0);
  });
  return { medio: d.interesHipAnual, real, deducido: d.regConHipoteca.interes, n: d.filas.length };
});
check('el primer año deduce su interés, no la media',
  Math.abs(int.deducido - int.real[0]) < 0.01 && int.real[0] > int.medio * 1.5,
  `deduce ${eur(int.deducido)}, media ${eur(int.medio)}`);
check('el interés decrece todos los años',
  int.real.every((v, i) => i === 0 || v <= int.real[i - 1] + 1e-9));
check('empieza por encima de la media y acaba por debajo',
  int.real[0] > int.medio && int.real[int.n - 1] < int.medio,
  `${eur(int.real[0])} → ${eur(int.real[int.n - 1])}`);
// El total deducido a lo largo de la vida del préstamo no cambia: sólo cambia en qué año cae.
const sumaReal = int.real.reduce((a, v) => a + v, 0);
check('el total deducido a 30 años es el mismo', Math.abs(sumaReal - int.medio * 30) < 1,
  `${eur(sumaReal)} vs ${eur(int.medio * 30)}`);

// ---------- 2) meses sin inquilino ----------
const vacios = await p.evaluate(() => [0, 0.5, 1, 3].map(m => {
  document.getElementById('mesesVacios').value = String(m).replace('.', ',');
  const d = calcular();
  return { m, ing: d.alquilerAnual, bruto: d.alquilerAnualBruto, ocup: d.ocupacion,
           gastos: d.gastosAnuales, caja: d.regimenInicial.caja, tir: d.ultima.anualizada };
}));
check('sin meses vacíos se cobra el alquiler entero',
  Math.abs(vacios[0].ing - vacios[0].bruto) < 0.01, eur(vacios[0].ing));
check('medio mes vacío recorta un doceavo de medio',
  Math.abs(vacios[1].ing - vacios[1].bruto * (1 - 0.5 / 12)) < 0.01,
  `${eur(vacios[1].bruto)} → ${eur(vacios[1].ing)}`);
check('los gastos no se abaratan con el piso vacío',
  vacios.every(v => Math.abs(v.gastos - vacios[0].gastos) < 0.01), eur(vacios[0].gastos));
check('cada mes vacío baja la caja y la rentabilidad',
  vacios.every((v, i) => i === 0 || (v.caja < vacios[i - 1].caja && v.tir < vacios[i - 1].tir)),
  vacios.map(v => `${v.m}m: ${Math.round(v.caja)} € / ${(v.tir * 100).toFixed(2)}%`).join(' · '));
check('el ingreso anual enseña la ocupación',
  (await p.textContent('#outAlquilerAnual')).includes('%'), await p.textContent('#outAlquilerAnual'));

// ---------- 3) vender al final de cada año ----------
await p.evaluate(() => resetDefaults());
await p.waitForTimeout(200);
const v = await p.evaluate(() => {
  const d = calcular();
  const f = d.filas;
  return {
    pct: d.pctGastosVenta,
    filas: f.map(x => ({ n: x.n, precio: x.precioVenta, gastos: x.gastosVenta, gan: x.gananciaFiscal,
      imp: x.impuestoVenta, deuda: x.hipFin + x.preFin, caja: x.cajaAcum, neto: x.netoVenta,
      tir: x.tirVenta, tirSin: x.anualizada, patrimonio: x.patrimonio })),
    coste: d.costeTotal, amort: d.amortizacion
  };
});
const u = v.filas[v.filas.length - 1];
check('el neto cuadra con sus partes',
  v.filas.every(f => Math.abs(f.neto - (f.precio - f.gastos - f.imp - f.deuda + f.caja)) < 0.01));
check('los gastos de venta son el porcentaje del precio',
  v.filas.every(f => Math.abs(f.gastos - f.precio * v.pct) < 0.01), `${(v.pct * 100).toFixed(1)}%`);
check('la amortización deducida engorda la ganancia fiscal',
  Math.abs(u.gan - (u.precio - u.gastos - (v.coste - v.amort * u.n))) < 0.01,
  `base de adquisición ${eur(v.coste - v.amort * u.n)} en vez de ${eur(v.coste)}`);
check('vender siempre deja menos que el patrimonio de la columna de al lado',
  v.filas.every(f => f.neto < f.patrimonio + f.caja), `año 30: ${eur(u.neto)} vs ${eur(u.patrimonio + u.caja)}`);
check('y por tanto la TIR vendiendo es menor',
  v.filas.every(f => f.tir === null || f.tir < f.tirSin),
  `año 30: ${(u.tir * 100).toFixed(1)}% vs ${(u.tirSin * 100).toFixed(1)}%`);
check('vender el primer año es ruinoso', v.filas[0].tir < -0.2,
  `${(v.filas[0].tir * 100).toFixed(1)}% · neto ${eur(v.filas[0].neto)} sobre lo aportado`);
check('el primer año no hay ganancia que tributar', v.filas[0].gan === 0 && v.filas[0].imp === 0);

// La escala por tramos: más ganancia, tipo efectivo mayor, y nunca fuera del 19-28%.
const tipos = v.filas.filter(f => f.gan > 0).map(f => f.imp / f.gan);
check('el tipo efectivo crece con la ganancia',
  tipos.every((t, i) => i === 0 || t >= tipos[i - 1] - 1e-12),
  `${(tipos[0] * 100).toFixed(1)}% → ${(tipos[tipos.length - 1] * 100).toFixed(1)}%`);
check('y se queda dentro de la escala', tipos.every(t => t >= 0.19 - 1e-9 && t <= 0.28 + 1e-9));

// Abrir el candado impone un tipo plano. El candado vive en la pestaña de parámetros.
await p.click('text=⚙️ Parámetros'); await p.waitForTimeout(200);
await p.click('#lockPctGananciaVenta');
await p.evaluate(() => { document.getElementById('pctGananciaVenta').value = '19'; render(); });
const plano = await p.evaluate(() => calcular().filas.filter(f => f.gananciaFiscal > 0)
  .map(f => f.impuestoVenta / f.gananciaFiscal));
check('con el candado abierto manda tu tipo',
  plano.every(t => Math.abs(t - 0.19) < 1e-9), `${(plano[0] * 100).toFixed(1)}% en todos los años`);
await p.click('#lockPctGananciaVenta');

// Subir los gastos de venta baja el neto, sin tocar el patrimonio.
const antes = await p.evaluate(() => { const d = calcular(); return { neto: d.ultima.netoVenta, pat: d.ultima.patrimonio }; });
await p.evaluate(() => { document.getElementById('pctGastosVenta').value = '10'; render(); });
const despues = await p.evaluate(() => { const d = calcular(); return { neto: d.ultima.netoVenta, pat: d.ultima.patrimonio }; });
check('más gastos de venta, menos neto', despues.neto < antes.neto, `${eur(antes.neto)} → ${eur(despues.neto)}`);
check('y el patrimonio no se entera', Math.abs(despues.pat - antes.pat) < 0.01);
await p.evaluate(() => { document.getElementById('pctGastosVenta').value = '5'; render(); });

// A horizonte largo la amortización acumulada no puede pasarse de la base amortizable.
await p.evaluate(() => { document.getElementById('horizonte').value = '50'; render(); });
const largo = await p.evaluate(() => {
  const d = calcular();
  return { base: d.baseAmortizable, coste: d.costeTotal, amort: d.amortizacion,
    filas: [30, 40, 50].map(n => { const f = d.filas[n-1];
      return { n, adq: f.precioVenta - f.gastosVenta - f.gananciaFiscal }; }) };
});
const tope = largo.coste - largo.base;
check('el valor de adquisición no baja del suelo',
  largo.filas.every(f => f.adq >= tope - 0.01),
  largo.filas.map(f => `año ${f.n}: ${eur(f.adq)}`).join(' · ') + ` (suelo ${eur(tope)})`);
check('y sin el tope se habría pasado', largo.coste - largo.amort * 50 < tope,
  `sin tope, año 50: ${eur(largo.coste - largo.amort * 50)}`);
await p.evaluate(() => { document.getElementById('horizonte').value = '30'; render(); });
await p.waitForTimeout(200);

// ---------- 4) las columnas están en la tabla y en el resumen ----------
const cols = await p.evaluate(() => {
  const hs = [...document.querySelectorAll('#proyeccionTab thead th')];
  const fila = document.querySelector('#tblProyeccion tr:last-child');
  const i = hs.findIndex(h => h.dataset.i18n === 'colNetoVenta');
  const j = hs.findIndex(h => h.dataset.i18n === 'colTirVenta');
  return { i, j, n: hs.length, celdas: fila.cells.length, neto: fila.cells[i]?.textContent.trim(),
           tir: fila.cells[j]?.textContent.trim(), titulo: hs[i]?.title };
});
check('las dos columnas están al final', cols.i > 0 && cols.j === cols.i + 1, `${cols.i} y ${cols.j} de ${cols.n}`);
check('cada fila tiene tantas celdas como cabeceras', cols.celdas === cols.n, `${cols.celdas} vs ${cols.n}`);
check('con cifras dentro', /\d/.test(cols.neto) && /%/.test(cols.tir), `${cols.neto} · ${cols.tir}`);
check('y su explicación en la cabecera', (cols.titulo || '').length > 60);
check('el resumen enseña la anualizada vendiendo',
  (await p.textContent('#tblRentabilidad')).includes('vendiendo'));

await p.click('text=📈 Proyección'); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('tblProyeccion').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(200);
await p.screenshot({ path: salida('v7-tabla.png') });

check('sin errores de consola', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
