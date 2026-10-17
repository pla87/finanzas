// El tipo de ruptura: el de hipoteca al que la caja del primer año se queda en cero.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA);
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(700);
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(56)} ${d}`); };
const pc = v => (v * 100).toFixed(2) + '%';

await p.evaluate(() => resetDefaults());
await p.waitForTimeout(400);

// --- la de caja: por definición, a ese tipo la caja del primer año es cero ---
const caja = await p.evaluate(() => {
  const d = calcular();
  const t = d.rupturaCaja;
  const set = v => { document.getElementById('tipoHipoteca').value = String(v).replace('.', ','); };
  const cajaA = v => { set(v * 100); const r = calcular().regimenInicial.caja; return r; };
  const justo = cajaA(t), antes = cajaA(t - 0.0005), despues = cajaA(t + 0.0005);
  set(2.8);
  return { t, justo, antes, despues, actual: d.regimenInicial.caja };
});
check('a ese tipo la caja del primer año es cero', Math.abs(caja.justo) < 1, `${pc(caja.t)} → ${caja.justo.toFixed(2)} €`);
check('un pelo por debajo es positiva y por encima negativa',
  caja.antes > 0 && caja.despues < 0, `${caja.antes.toFixed(0)} € / ${caja.despues.toFixed(0)} €`);
// El ejemplo (hipoteca al 70%, 2,80%) deja margen: su caja es positiva y la raya queda por encima
// del tipo puesto, así que el dato sale en verde. La subida que aguanta es lo que enseña la caja.
check('el escenario de ejemplo aguanta una subida de tipos',
  caja.t > 0.028 && caja.actual > 0, `raya ${pc(caja.t)} · tipo 2,80% · caja ${Math.round(caja.actual)} €`);
check('y la cifra de la raya sale en verde',
  await p.evaluate(() => document.getElementById('outRupturaCaja').classList.contains('val-pos')));
check('pasado ese tipo, en rojo', await p.evaluate(() => {
  document.getElementById('tipoHipoteca').value = '6,00'; render();
  const rojo = document.getElementById('outRupturaCaja').classList.contains('val-neg');
  document.getElementById('tipoHipoteca').value = '2,80'; render();
  return rojo;
}));

// --- casos límite ---
const limites = await p.evaluate(() => {
  const r = {};
  document.getElementById('usarHipoteca').checked = false; pintarFuente('hipoteca');
  r.sinHipoteca = calcular().rupturaCaja;
  document.getElementById('usarHipoteca').checked = true; pintarFuente('hipoteca');
  // Alquiler ridículo: no se paga sola ni con la hipoteca regalada.
  document.getElementById('alquiler').value = '200';
  r.nunca = calcular().rupturaCaja;
  document.getElementById('alquiler').value = '2.000';
  // Alquiler enorme: aguanta cualquier tipo.
  document.getElementById('alquiler').value = '20.000';
  r.siempre = calcular().rupturaCaja;
  document.getElementById('alquiler').value = '2.000';
  render();
  return r;
});
check('sin hipoteca no hay tipo que romper', limites.sinHipoteca === undefined);
check('con un alquiler ridículo la raya es "nunca"', limites.nunca === null);
check('con un alquiler enorme aguanta cualquier tipo', limites.siempre === Infinity);

// --- el aviso de las comunidades con escala por tramos ---
const escalas = await p.evaluate(() => {
  const r = {};
  for (const c of ['madrid', 'cataluna', 'baleares', 'valencia', 'asturias']) {
    document.getElementById('ccaa').value = c; render();
    const n = document.getElementById('notaEscala');
    r[c] = { oculto: n.classList.contains('hidden'), texto: n.textContent, tipo: parseNum(document.getElementById('pctImpuestos').value) };
  }
  document.getElementById('ccaa').value = 'madrid'; render();
  return r;
});
check('Madrid no avisa de tramos', escalas.madrid.oculto, String(escalas.madrid.tipo) + '%');
check('las cuatro con escala sí avisan',
  ['cataluna', 'baleares', 'valencia', 'asturias'].every(c => !escalas[c].oculto && escalas[c].texto.includes('%')),
  escalas.cataluna.texto);
check('y traen el tipo del primer tramo',
  escalas.cataluna.tipo === 10 && escalas.baleares.tipo === 8 && escalas.valencia.tipo === 9,
  `Cataluña ${escalas.cataluna.tipo}% · Baleares ${escalas.baleares.tipo}% · Valencia ${escalas.valencia.tipo}%`);
check('Valencia ya está en el 9% de junio de 2026', escalas.valencia.tipo === 9);

await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('outRupturaCaja').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(200);
await p.screenshot({ path: salida('v8-ruptura.png') });
check('sin errores de consola', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
