// Con las dos amortizaciones aceleradas, la caja acumulada tiene que ir primero contra la deuda
// cara y sólo el sobrante contra la hipoteca, sin gastarse dos veces ni perderse por el camino.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(52)} ${d}`); };

const escenario = (hipAcel, preAcel) => p.evaluate(([ha, pa]) => {
  localStorage.clear(); resetDefaults();
  const set = (id, v) => { document.getElementById(id).value = v; };
  set('oferta', 300000); set('precioAnunciado', 300000); set('valor', 300000);
  set('alquiler', 2500); set('pctFinanciado', 50);
  document.getElementById('usarPrestamo').checked = true; pintarFuente('prestamo');
  set('importePrestamo', 20000); set('plazoPrestamo', 5); set('tipoPrestamo', 11);
  set('hipotecaAcelerada', ha); set('prestamoAcelerado', pa);
  render();
  const d = calcular();
  return d.filas.map((f, i, a) => {
    const prev = i === 0 ? null : a[i - 1];
    return { n: f.n, cajaPrevia: prev ? prev.cajaAcum : 0, preFinPrev: prev ? prev.preFin : 0,
      preIni: f.preIni, hipFinPrev: prev ? prev.hipFin : 0, hipIni: f.hipIni, cajaAcum: f.cajaAcum,
      cajaAno: f.cajaAno };
  });
}, [hipAcel, preAcel]);

// 1) Conservación: lo amortizado de más nunca puede pasar de la caja que había
for (const [ha, pa, etq] of [['si','si','ambas aceleradas'], ['no','si','sólo el préstamo'], ['si','no','sólo la hipoteca'], ['no','no','ninguna']]) {
  const filas = await escenario(ha, pa);
  const malos = [];
  for (const f of filas.slice(1)) {
    const prepago = Math.max(f.preFinPrev - f.preIni, 0) + Math.max(f.hipFinPrev - f.hipIni, 0);
    // Sólo se amortiza contra la deuda cuya aceleración esté activa, y en ese orden.
    let queda = f.cajaPrevia, esperado = 0;
    if (pa === 'si') { const x = Math.min(queda, f.preFinPrev); esperado += x; queda -= x; }
    if (ha === 'si') { const x = Math.min(queda, f.hipFinPrev); esperado += x; queda -= x; }
    // Y lo prepagado más lo que sigue en caja tiene que sumar la caja que había.
    const sobrante = f.cajaAcum - f.cajaAno;
    if (Math.abs(prepago - esperado) > 1 || Math.abs(prepago + sobrante - f.cajaPrevia) > 1) malos.push(f.n);
  }
  check(`conservación del dinero (${etq})`, malos.length === 0,
    malos.length ? `falla en los años ${malos.join(', ')}` : 'ningún año descuadra');
}

// 2) Prioridad: mientras viva el préstamo caro, la hipoteca no recibe nada
const ambas = await escenario('si', 'si');
const conPrestamoVivo = ambas.slice(1).filter(f => f.preFinPrev > 0 && f.cajaPrevia > 0);
const hipotecaIntacta = conPrestamoVivo.filter(f => f.cajaPrevia <= f.preFinPrev)
  .every(f => Math.abs(f.hipIni - f.hipFinPrev) < 1);
check('la hipoteca no recibe nada mientras el préstamo no se cubra', hipotecaIntacta,
  `${conPrestamoVivo.length} años con préstamo vivo`);

// 3) El año en que se cancela el préstamo, el sobrante sí va a la hipoteca
const cancela = ambas.slice(1).find(f => f.preFinPrev > 0 && f.preIni === 0 && f.cajaPrevia > f.preFinPrev);
const sobrante = cancela ? cancela.cajaPrevia - cancela.preFinPrev : 0;
check('el sobrante pasa a la hipoteca al cancelar el préstamo',
  cancela && Math.abs((cancela.hipFinPrev - cancela.hipIni) - sobrante) < 1,
  cancela ? `año ${cancela.n}: préstamo ${Math.round(cancela.preFinPrev).toLocaleString('es-ES')} + hipoteca ${Math.round(sobrante).toLocaleString('es-ES')} = ${Math.round(cancela.cajaPrevia).toLocaleString('es-ES')}` : 'no se encontró el año');

// 4) Sin aceleración, la caja no toca la deuda
const ninguna = await escenario('no', 'no');
check('sin aceleración la caja no amortiza nada',
  ninguna.slice(1).every(f => Math.abs(f.preIni - f.preFinPrev) < 1 && Math.abs(f.hipIni - f.hipFinPrev) < 1));

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
