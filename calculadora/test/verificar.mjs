import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
import { readFileSync } from 'node:fs';

const esperado = JSON.parse(readFileSync(new URL('esperado.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--allow-file-access-from-files']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errores = [];
page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
page.on('pageerror', e => errores.push('pageerror: ' + e.message));

// Sin red en el entorno de pruebas: el CDN se sirve desde node_modules.
await page.route('**/cdn.jsdelivr.net/**/chart.umd.min.js', route =>
  route.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await page.route('**googletagmanager.com/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));

await page.goto(PAGINA);
await page.waitForFunction(() => document.getElementById('kpiBruta').textContent !== '--');
// El escenario por defecto es el de la hoja; localStorage podría traer otro de una carga previa.
await page.evaluate((p) => {
// La hoja no estimaba nada: se abren todos los candados y se escriben sus cifras. El modelo
// nuevo financia por porcentaje, así que la entrada de la hoja se traduce a un LTV y el
// préstamo personal al hueco que dejaba entre desembolso y dinero aportado.
const montar = (p) => {
  // IVA y amortización acelerada son casillas: 'si'/'no' las marca o desmarca.
  const set = (id, v) => { const e = document.getElementById(id); e.disabled = false; if (e.type === 'checkbox') e.checked = (v === 'si' || v === true); else e.value = v; };
  for (const c of ['autoComunidad','autoIbi','autoSeguroHogar','autoSeguroImpagos','autoMantenimiento','autoPctImpuestos','autoPctNotaria','autoValor','autoRevalorizacion'])
    document.getElementById(c).checked = false;
  set('pctImpuestos', 10);
  // La hoja cobraba 1.000 € fijos de notaría; el modelo nuevo la lleva en porcentaje, así que
  // se traduce al tipo que da ese mismo importe para el precio de cada escenario.
  set('pctNotaria', 1000 / p.C4 * 100);
  set('precioAnunciado', p.C2); set('valor', p.C3); set('oferta', p.C4);
  set('superficie', 100);
  set('comision', p.C7); set('ivaComision', p.C8 === 'Sí' ? 'si' : 'no');
  set('reforma', p.C10);
  document.getElementById('usarHipoteca').checked = true;
  set('pctFinanciado', (p.C4 - p.C11) / p.C4 * 100);
  set('plazoHipoteca', p.C15); set('tipoHipoteca', p.C16 * 100);
  set('hipotecaAcelerada', p.C19 === 'Sí' ? 'si' : 'no');
  const gastosHoja = 0.1 * p.C4 + 1000 + p.C7 * (p.C8 === 'Sí' ? 1.21 : 1);
  const desembolsoHoja = p.C11 + gastosHoja + p.C10;
  const prestamo = Math.max(desembolsoHoja - p.C13, 0);
  document.getElementById('usarPrestamo').checked = prestamo > 0;
  set('importePrestamo', prestamo);
  set('plazoPrestamo', p.C21); set('tipoPrestamo', p.C22 * 100);
  set('prestamoAcelerado', p.C24 === 'Sí' ? 'si' : 'no');
  set('alquiler', p.C30); set('mesesVacios', 0);
  set('comunidad', p.C27); set('ibi', p.C26); set('seguroHogar', p.C28);
  set('seguroImpagos', p.C30 / 2); set('mantenimiento', p.C31);
  set('inflacion', p.C49 * 100); set('revalorizacion', p.C49 * 100); set('horizonte', p.horizonte);
  set('indexar', 'no');
  set('tipoMarginal', 45); set('baseTributable', 40);
  set('pctConstruccion', 60); set('tasaAmortizacion', 3);
  set('pctGastosVenta', 5);
};
montar(p); }, {C2:500000,C3:500000,C4:500000,C7:0,C8:'No',C10:0,C11:100000,C13:151000,C15:30,C16:0.022,C19:'No',C21:5,C22:0.11,C24:'Sí',C26:250,C27:30,C28:250,C30:2000,C31:50,C49:0.03,horizonte:30});

const d = await page.evaluate(() => {
  const r = calcular();
  return {
    escalares: {
      gastosCompra: r.gastosCompra, aportado: r.aportado,
      cuotaHip: r.cuotaHip, cuotaPre: r.cuotaPre, gastosAnuales: r.gastosAnuales,
      amortizacion: r.amortizacion,
      impConPrestamo: r.regConPrestamo.impuestos, cajaConPrestamo: r.regConPrestamo.caja,
      impConHipoteca: r.regConHipoteca.impuestos, cajaConHipoteca: r.regConHipoteca.caja,
      impSinDeuda: r.regSinDeuda.impuestos, cajaSinDeuda: r.regSinDeuda.caja,
      costeTotal: r.costeTotal, bruta: r.rentabilidadBruta,
      // La hoja llamaba ROCE a la caja sobre lo aportado; ese cociente es ahora roceCaja,
      // un escalón del ROCE nuevo, y es contra él contra el que hay que medir la paridad.
      roce: r.roceCaja
    },
    filas: r.filas.map(f => ({ n: f.n, hipIni: f.hipIni, hipFin: f.hipFin, preIni: f.preIni, preFin: f.preFin, patrimonio: f.patrimonio, cajaAno: f.cajaAno, cajaAcum: f.cajaAcum, anualizada: f.anualizada }))
  };
});

let fallos = 0;
const cerca = (a, b, tol = 0.02) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;

// La hoja deducía el interés medio de la vida del préstamo; el modelo deduce el del año. Todo
// lo que pasa por la base fiscal diverge a propósito, y siempre en el mismo sentido mientras el
// interés real supere al medio: menos impuesto y más caja. Lo demás tiene que cuadrar exacto.
// roce entra aquí porque es caja sobre aportado: la tolerancia absoluta de 0,02 no distingue
// un 1,76% de un 2,22%, y esta divergencia hay que verla, no dejarla pasar por el redondeo.
const DIVERGEN = new Set(['impConPrestamo', 'cajaConPrestamo', 'impConHipoteca', 'cajaConHipoteca', 'roce']);
console.log('--- escalares ---');
for (const [k, v] of Object.entries(esperado.escalares)) {
  const got = d.escalares[k];
  if (DIVERGEN.has(k)) {
    const ok = k.startsWith('imp') ? got < v : got > v;
    if (!ok) fallos++;
    console.log(`${ok ? 'dif ' : 'FALLO'} ${k.padEnd(18)} hoja=${Number(v).toFixed(4).padStart(14)} web=${Number(got).toFixed(4).padStart(14)}  (interés real del año)`);
    continue;
  }
  const ok = cerca(got, v, Math.max(0.02, Math.abs(v) * 1e-9));
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLO'} ${k.padEnd(18)} hoja=${Number(v).toFixed(4).padStart(14)} web=${Number(got).toFixed(4).padStart(14)}`);
}

console.log('--- filas ---');
let divergentes = 0;
for (let i = 0; i < esperado.filas.length; i++) {
  const e = esperado.filas[i], g = d.filas[i];
  for (const k of ['hipIni', 'hipFin', 'preIni', 'preFin', 'patrimonio']) {
    if (!cerca(g[k], e[k], 0.02)) {
      fallos++;
      console.log(`FALLO año ${e.n} ${k}: hoja=${e[k]} web=${g[k]}`);
    }
  }
  if (Math.abs(g.cajaAno - e.cajaAno) > 0.02) divergentes++;
}
const cruce = d.filas.findIndex((f, i) => f.cajaAno < esperado.filas[i].cajaAno) + 1;
console.log(`dif  la caja diverge los ${divergentes} años y se queda por debajo de la hoja desde el año ${cruce || '—'}`);
if (divergentes !== esperado.filas.length) { fallos++; console.log('FALLO: se esperaba divergencia en todos los años'); }
if (!cruce) { fallos++; console.log('FALLO: falta el cruce en que la deducción real baja de la media'); }
console.log(fallos === 0 ? 'TODO CUADRA' : `${fallos} discrepancias`);
if (errores.length) console.log('ERRORES DE CONSOLA:', errores);

await page.screenshot({ path: salida('claro.png'), fullPage: false });
await page.evaluate(() => toggleTheme());
await page.waitForTimeout(300);
await page.screenshot({ path: salida('oscuro.png'), fullPage: false });
await page.evaluate(() => toggleTheme());
await page.click('text=🔥 Tablas de rentabilidad');
await page.waitForTimeout(200);
await page.screenshot({ path: salida('tablas.png'), fullPage: false });
await page.click('text=💵 Flujo de caja');
await page.waitForTimeout(200);
await page.screenshot({ path: salida('caja.png'), fullPage: false });

await browser.close();
process.exit(fallos === 0 && errores.length === 0 ? 0 : 1);
