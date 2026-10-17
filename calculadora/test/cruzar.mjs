import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
import { readFileSync } from 'node:fs';

const modelo = JSON.parse(readFileSync(new URL('modelo.json', import.meta.url), 'utf8'));
const hoja = JSON.parse(readFileSync(new URL('esperado.json', import.meta.url), 'utf8'));

// 1) La transcripción en Python debe reproducir los valores guardados en la hoja original,
//    salvo donde el modelo diverge a propósito.
//
//    La hoja deducía el interés medio de toda la vida del préstamo. El modelo deduce el interés
//    real de cada año, que en una cuota francesa es mucho mayor al principio. Así que todo lo
//    que pasa por la base fiscal diverge, y diverge en un sentido concreto: más deducción es
//    menos impuesto y más caja en los primeros años. Se comprueba esa dirección en vez de la
//    igualdad; los saldos y el patrimonio, que no tocan la base fiscal, siguen cuadrando exactos.
let fallos = 0;
const cerca = (a, b, tol) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;
const DIVERGEN = new Set(['impConPrestamo', 'cajaConPrestamo', 'impConHipoteca', 'cajaConHipoteca']);
console.log('=== transcripción Python vs. hoja original (escenario por defecto) ===');
for (const [k, v] of Object.entries(hoja.escalares)) {
  const g = modelo.defecto.salida.escalares[k];
  if (g === undefined) continue;
  if (DIVERGEN.has(k)) {
    const esperado = k.startsWith('imp') ? g < v : g > v;
    if (!esperado) { fallos++; console.log(`FALLO ${k} diverge al revés: hoja=${v} py=${g}`); }
    else console.log(`  diverge ${k.padEnd(16)} hoja=${v.toFixed(2).padStart(10)} py=${g.toFixed(2).padStart(10)}  (interés real del año)`);
    continue;
  }
  if (!cerca(g, v, 0.02)) { fallos++; console.log(`FALLO ${k}: hoja=${v} py=${g}`); }
}
let divergentes = 0;
for (let i = 0; i < hoja.filas.length; i++) {
  for (const k of ['hipIni', 'hipFin', 'preIni', 'preFin', 'patrimonio', 'aportacion']) {
    if (!cerca(modelo.defecto.salida.filas[i][k], hoja.filas[i][k], 0.02)) {
      fallos++; console.log(`FALLO año ${i + 1} ${k}: hoja=${hoja.filas[i][k]} py=${modelo.defecto.salida.filas[i][k]}`);
    }
  }
  // La caja del año diverge al alza mientras la deducción real supere a la media, y a la baja
  // después. El cruce cae por donde el interés real del año iguala al medio.
  if (Math.abs(modelo.defecto.salida.filas[i].cajaAno - hoja.filas[i].cajaAno) > 0.02) divergentes++;
}
const cruce = modelo.defecto.salida.filas.findIndex((f, i) => f.cajaAno < hoja.filas[i].cajaAno) + 1;
console.log(`  la caja diverge en ${divergentes} de ${hoja.filas.length} años; pasa a ser menor que la de la hoja en el año ${cruce || '—'}`);
if (divergentes !== hoja.filas.length) { fallos++; console.log('FALLO: se esperaba que la caja divergiese todos los años'); }
if (!cruce) { fallos++; console.log('FALLO: la deducción real debería quedarse por debajo de la media en los últimos años'); }
console.log(fallos === 0 ? 'la transcripción cuadra con la hoja donde debe' : `${fallos} discrepancias`);

// 2) El motor de la web debe coincidir con la transcripción en todos los escenarios.
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await page.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
await page.goto(PAGINA);
await page.waitForTimeout(400);

console.log('\n=== motor de la web vs. transcripción ===');
for (const [nombre, esc] of Object.entries(modelo)) {
  const p = esc.params;
  const web = await page.evaluate((p) => {
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
    montar(p);
    const r = calcular();
    return {
      escalares: {
        gastosCompra: r.gastosCompra, aportado: r.aportado,
        cuotaHip: r.cuotaHip, cuotaPre: r.cuotaPre, gastosAnuales: r.gastosAnuales,
        amortizacion: r.amortizacion, impConPrestamo: r.regConPrestamo.impuestos,
        cajaConPrestamo: r.regConPrestamo.caja, impConHipoteca: r.regConHipoteca.impuestos,
        cajaConHipoteca: r.regConHipoteca.caja, impSinDeuda: r.regSinDeuda.impuestos,
        cajaSinDeuda: r.regSinDeuda.caja, costeTotal: r.costeTotal
      },
      filas: r.filas.map(f => ({ n: f.n, hipIni: f.hipIni, hipFin: f.hipFin, preIni: f.preIni, preFin: f.preFin, patrimonio: f.patrimonio, cajaAno: f.cajaAno, aportacion: f.aportacion, cajaAcum: f.cajaAcum, anualizada: f.anualizada, gananciaFiscal: f.gananciaFiscal, impuestoVenta: f.impuestoVenta, netoVenta: f.netoVenta, tirVenta: f.tirVenta }))
    };
  }, p);

  let malos = 0;
  for (const [k, v] of Object.entries(esc.salida.escalares)) {
    if (web.escalares[k] === undefined) continue;  // escalares que sólo tiene la transcripción
    if (!cerca(web.escalares[k], v, 0.02)) { malos++; console.log(`  FALLO ${nombre} ${k}: py=${v} web=${web.escalares[k]}`); }
  }
  for (let i = 0; i < esc.salida.filas.length; i++) {
    for (const k of ['hipIni', 'hipFin', 'preIni', 'preFin', 'patrimonio', 'cajaAno', 'aportacion', 'cajaAcum', 'anualizada', 'gananciaFiscal', 'impuestoVenta', 'netoVenta', 'tirVenta']) {
      if (!cerca(web.filas[i][k], esc.salida.filas[i][k], k.startsWith('tir') || k === 'anualizada' ? 1e-9 : 0.02)) {
        malos++;
        if (malos < 5) console.log(`  FALLO ${nombre} año ${i + 1} ${k}: py=${esc.salida.filas[i][k]} web=${web.filas[i][k]}`);
      }
    }
  }
  fallos += malos;
  const fin = esc.salida.filas.find(f => f.hipFin <= 0 && f.preFin <= 0);
  console.log(`${malos === 0 ? 'ok   ' : 'FALLO'} ${nombre.padEnd(14)} (${malos} discrepancias)  deuda saldada: año ${fin ? fin.n : '>30'}`);
}

await browser.close();
console.log(fallos === 0 ? '\nTODO CUADRA' : `\n${fallos} discrepancias en total`);
process.exit(fallos === 0 ? 0 : 1);
