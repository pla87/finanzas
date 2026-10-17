// El orden de amortización anticipada lo deciden los tipos, no el tipo de préstamo: primero la
// deuda más cara. Antes el préstamo personal iba siempre primero aunque fuese el barato.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(56)} ${d}`); };

const prueba = (tipoHip, tipoPre, hipAcel = 'si', preAcel = 'si') => p.evaluate(([th, tp, ha, pa]) => {
  localStorage.clear(); resetDefaults();
  // IVA y amortización acelerada son casillas: 'si'/'no' las marca o desmarca.
  const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox') e.checked = (v === 'si' || v === true); else e.value = v; };
  set('oferta', 300000); set('precioAnunciado', 300000); set('valor', 300000);
  set('alquiler', 2500); set('pctFinanciado', 50);
  document.getElementById('usarPrestamo').checked = true; pintarFuente('prestamo');
  set('importePrestamo', 40000); set('plazoPrestamo', 15);
  set('tipoHipoteca', th); set('tipoPrestamo', tp);
  set('hipotecaAcelerada', ha); set('prestamoAcelerado', pa);
  render();
  const d = calcular();
  const a = d.filas[0], s = d.filas[1];
  return { caja: a.cajaAcum, pre: Math.max(a.preFin - s.preIni, 0), hip: Math.max(a.hipFin - s.hipIni, 0) };
}, [tipoHip, tipoPre, hipAcel, preAcel]);

const casos = [
  [2.2, 11, 'pre', 'préstamo al 11% frente a hipoteca al 2,20%'],
  [8, 3,    'hip', 'préstamo al 3% frente a hipoteca al 8%'],
  [5, 5,    'pre', 'mismo tipo: manda el préstamo, de plazo más corto'],
  [4, 4.01, 'pre', 'diferencia mínima a favor del préstamo'],
  [4.01, 4, 'hip', 'diferencia mínima a favor de la hipoteca']
];
for (const [th, tp, esperado, etq] of casos) {
  const r = await prueba(th, tp);
  const gana = r.pre > r.hip ? 'pre' : 'hip';
  check(etq, gana === esperado && Math.abs(r.pre + r.hip - Math.min(r.caja, 1e12)) < 1,
    `préstamo ${Math.round(r.pre).toLocaleString('es-ES')} € / hipoteca ${Math.round(r.hip).toLocaleString('es-ES')} € de ${Math.round(r.caja).toLocaleString('es-ES')} €`);
}

// Con una sola aceleración activa, el orden no manda: paga la que esté activada
const soloHip = await prueba(2.2, 11, 'si', 'no');
check('sólo la hipoteca acelerada: cobra ella aunque sea la barata',
  soloHip.hip > 0 && soloHip.pre === 0, `hipoteca ${Math.round(soloHip.hip).toLocaleString('es-ES')} €`);
const soloPre = await prueba(8, 3, 'no', 'si');
check('sólo el préstamo acelerado: cobra él aunque sea el barato',
  soloPre.pre > 0 && soloPre.hip === 0, `préstamo ${Math.round(soloPre.pre).toLocaleString('es-ES')} €`);

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
