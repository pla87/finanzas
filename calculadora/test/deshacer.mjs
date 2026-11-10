// Deshacer y rehacer (Ctrl+Z, Ctrl+Y, Ctrl+Mayús+Z, y Cmd en Mac) con un historial de instantáneas
// del estado completo. Se apunta un paso por cada cambio CONFIRMADO, no por tecla; deshacer no
// apunta nada; un cambio nuevo borra el rehacer; dentro de un campo con texto sin confirmar la tecla
// es del navegador.
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
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(70)} ${d}`); };

const p = await abrir();
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
const poner = async (id, v) => { await p.fill('#' + id, String(v)); await p.press('#' + id, 'Tab'); };
const val = (id) => p.inputValue('#' + id);
const hist = () => p.evaluate(() => ({ n: HISTORIAL.length, i: HISTORIAL_I }));
const indicador = () => p.evaluate(() => { const e = document.getElementById('saveIndicator'); return e.classList.contains('opacity-0') ? '' : e.textContent; });
const tecla = async (k) => { await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await p.keyboard.press(k); await p.waitForTimeout(60); };

// ---------- 1) el punto de partida ----------
let h = await hist();
check('al arrancar hay una sola instantánea, el punto de partida', h.n === 1 && h.i === 0, JSON.stringify(h));
await tecla('Control+z');
check('Ctrl+Z sin nada que deshacer lo dice y no toca nada', (await indicador()) === 'Nada que deshacer' && (await val('alquiler')) === '1.250');

// ---------- 2) un paso por cambio confirmado ----------
await poner('alquiler', '1400');
await poner('oferta', '240000');
h = await hist();
check('dos cambios confirmados, dos pasos nuevos', h.n === 3 && h.i === 2, JSON.stringify(h));
await p.focus('#alquiler'); await p.keyboard.press('Tab');
h = await hist();
check('entrar y salir de un campo sin cambiarlo no apunta nada', h.n === 3);
await poner('alquiler', '1.400');
check('  escribir el mismo valor con otro formato tampoco duplica', (await hist()).n === 3);

// Sin ratón ni foco en un campo: la tecla actúa sobre el historial.
await tecla('Control+z');
check('Ctrl+Z deshace la oferta', (await val('oferta')) === '247.000' && (await val('alquiler')) === '1.400', `${await val('oferta')} / ${await val('alquiler')}`);
check('  el aviso dice «Deshecho»', (await indicador()) === 'Deshecho', await indicador());
check('  y deshacer no apunta una instantánea nueva', (await hist()).n === 3 && (await hist()).i === 1);
await tecla('Control+z');
check('un segundo Ctrl+Z deshace el alquiler', (await val('alquiler')) === '1.250');
await tecla('Control+y');
check('Ctrl+Y lo rehace, con el aviso «Rehecho»', (await val('alquiler')) === '1.400' && (await indicador()) === 'Rehecho');
await tecla('Control+Shift+z');
check('Ctrl+Mayús+Z también rehace', (await val('oferta')) === '240.000');
await tecla('Meta+z');
check('Cmd+Z (Mac) deshace', (await val('oferta')) === '247.000');
await tecla('Meta+Shift+z');
check('Cmd+Mayús+Z rehace', (await val('oferta')) === '240.000');
await tecla('Control+y');
check('sin nada que rehacer lo dice', (await indicador()) === 'Nada que rehacer');

// Un cambio nuevo tras deshacer borra el rehacer.
await tecla('Control+z'); await tecla('Control+z');
await poner('alquiler', '1500');
h = await hist();
check('un cambio tras deshacer borra el rehacer', h.n === 2 && h.i === 1 && (await val('alquiler')) === '1.500', JSON.stringify(h));
await tecla('Control+y');
check('  y ya no hay nada que rehacer', (await val('alquiler')) === '1.500' && (await indicador()) === 'Nada que rehacer');
await tecla('Control+z');
check('  deshacer vuelve al ejemplo', (await val('alquiler')) === '1.250' && (await val('oferta')) === '247.000');

// ---------- 3) texto a medias: el navegador, y luego el historial ----------
await poner('alquiler', '1600');
await p.click('#alquiler'); await p.keyboard.press('End'); await p.keyboard.type('9');
const antesTecleo = await hist();
check('teclear no apunta pasos (sólo se apunta al confirmar)', antesTecleo.n === (await hist()).n && (await val('alquiler')) === '1.6009');
await p.keyboard.press('Control+z'); await p.waitForTimeout(80);
check('con texto sin confirmar, Ctrl+Z lo deshace dentro del campo', (await val('alquiler')) === '1.600', await val('alquiler'));
check('  y no toca el historial', JSON.stringify(await hist()) === JSON.stringify(antesTecleo));
await p.keyboard.press('Control+z'); await p.waitForTimeout(80);
check('  con el campo ya sin texto a medias, el siguiente Ctrl+Z es el global', (await val('alquiler')) === '1.250' && (await indicador()) === 'Deshecho', await val('alquiler'));
check('  aunque el foco siga en el campo', await p.evaluate(() => document.activeElement.id === 'alquiler'));
await p.keyboard.press('Control+y'); await p.waitForTimeout(80);
check('  y Ctrl+Y desde el campo rehace', (await val('alquiler')) === '1.600');
await p.keyboard.press('Tab');

// ---------- 4) todo el estado: candados, casillas, modos, desplegables ----------
await p.evaluate(() => resetDefaults());
const base = await hist();
await p.click('#lockIbi');                                  // candado
await p.check('#hipotecaAcelerada');                        // casilla
await p.selectOption('#obraNueva', 'si');                   // desplegable
await p.click('#lockPrestamo');                             // fuente
await p.click('#modoAperturaHip');                          // modo %/€
await p.evaluate(() => { const s = document.getElementById('ccaa'); s.value = 'cataluna'; s.dispatchEvent(new Event('change', { bubbles: true })); });
const tras = await hist();
check('cada acción confirmada es un paso (candado, casilla, desplegable, fuente, modo, comunidad)', tras.n - base.n === 6, JSON.stringify([base, tras]));
const estado = () => p.evaluate(() => ({ ibi: document.getElementById('autoIbi').checked, acel: document.getElementById('hipotecaAcelerada').checked, obra: document.getElementById('obraNueva').value,
  pre: document.getElementById('usarPrestamo').checked, eur: document.getElementById('aperturaHipEur').checked, ccaa: document.getElementById('ccaa').value,
  lock: document.getElementById('lockIbi').textContent, btn: document.getElementById('modoAperturaHip').getAttribute('aria-pressed') }));
const lleno = await estado();
check('el estado completo está puesto', !lleno.ibi && lleno.acel && lleno.obra === 'si' && lleno.pre && lleno.eur && lleno.ccaa === 'cataluna' && lleno.lock === '🔓' && lleno.btn === 'true', JSON.stringify(lleno));
for (let i = 0; i < 6; i++) await tecla('Control+z');
const vacio = await estado();
check('seis Ctrl+Z lo devuelven todo, con los candados y el conmutador repintados', vacio.ibi && !vacio.acel && vacio.obra === 'no' && !vacio.pre && !vacio.eur && vacio.ccaa === 'madrid' && vacio.lock === '🔒' && vacio.btn === 'false', JSON.stringify(vacio));
for (let i = 0; i < 6; i++) await tecla('Control+y');
check('seis Ctrl+Y lo rehacen', JSON.stringify(await estado()) === JSON.stringify(lleno));

// ---------- 5) ♻️ y las opciones del comparador, con nombres y orden ----------
await p.evaluate(() => resetDefaults());
await poner('alquiler', '2600');
await p.evaluate(() => anadirComparacion());
await poner('pctFinanciado', '60');
await p.evaluate(() => anadirComparacion());
await p.evaluate(() => { OPCIONES[1].nombre = 'Mi plan'; });
await p.evaluate(() => confirmarCambio());
await poner('pctFinanciado', '50');
await p.evaluate(() => anadirComparacion());
const nombres = () => p.evaluate(() => OPCIONES.map(o => `${o.letra}:${nombreOpcion(o)}`).join(' '));
const antesQuitar = await nombres();
await p.evaluate(() => quitarComparacion('A'));
const trasQuitar = await nombres();
check('quitar una opción renumera y se apunta', antesQuitar !== trasQuitar && !/A:/.test(trasQuitar), `${antesQuitar} → ${trasQuitar}`);
await tecla('Control+z');
check('Ctrl+Z devuelve la opción quitada, con su orden y su nombre', (await nombres()) === antesQuitar && /Mi plan/.test(await nombres()), await nombres());
check('  y la tabla de comparar vuelve a pintarse con tres columnas', (await p.locator('#tblComparar thead th[data-opcion]').count()) === 3);
await tecla('Control+z');
check('otro Ctrl+Z deshace la tercera opción añadida', (await p.evaluate(() => OPCIONES.length)) === 2);
await tecla('Control+z');
check('otro, el último ajuste del porcentaje financiado', (await val('pctFinanciado')) === '60', await val('pctFinanciado'));
await tecla('Control+z');
check('otro, el renombrado', !/Mi plan/.test(await nombres()), await nombres());
await tecla('Control+y');
check('y Ctrl+Y devuelve el nombre', /Mi plan/.test(await nombres()));
// Renombrar con el lápiz es un paso.
const pasosAntes = (await hist()).i;
await p.evaluate(() => { const e = document.querySelector('#tblComparar [data-renombrar]'); renombrarOpcion(e); });
await p.fill('.cmp-edit', 'Prudente'); await p.press('.cmp-edit', 'Enter');
check('renombrar una opción con el campo es un paso', (await hist()).i === pasosAntes + 1 && /Prudente/.test(await nombres()), await nombres());
await tecla('Control+z');
check('  y se deshace', !/Prudente/.test(await nombres()));
const opcionesAntes = await p.evaluate(() => OPCIONES.length);
await p.evaluate(() => resetDefaults());
check('♻️ borra las opciones y es un paso', (await p.evaluate(() => OPCIONES.length)) === 0);
await tecla('Control+z');
check('  Ctrl+Z recupera lo de antes del ♻️, opciones incluidas', (await p.evaluate(() => OPCIONES.length)) === opcionesAntes && opcionesAntes > 0 && (await val('alquiler')) === '2.600');

// ---------- 6) lo que no entra en el historial ----------
const pasos0 = await hist();
await p.click('#themeToggleBtn'); await p.click('#langBtn'); await p.waitForTimeout(200);
const pasos2 = await hist();
check('cambiar de tema o de idioma no apunta pasos', JSON.stringify(pasos0) === JSON.stringify(pasos2));
await poner('alquiler', '2700');
await tecla('Control+z');
const pref = await p.evaluate(() => ({ tema: document.documentElement.getAttribute('data-theme'), lang: document.documentElement.lang, alq: document.getElementById('alquiler').value }));
check('deshacer no toca el tema ni el idioma', pref.tema === 'dark' && pref.lang === 'en' && pref.alq === '2,600', JSON.stringify(pref));
check('  el aviso sale en inglés', (await indicador()) === 'Undone', await indicador());
await p.click('#themeToggleBtn'); await p.click('#langBtn'); await p.waitForTimeout(200);

// ---------- 7) el límite de 100 pasos ----------
await p.evaluate(() => { for (let i = 0; i < 130; i++) { document.getElementById('alquiler').value = String(1000 + i); confirmarCambio(); } });
h = await hist();
check('el historial guarda como mucho 100 pasos (101 instantáneas)', h.n === 101 && h.i === 100, JSON.stringify(h));
await p.evaluate(() => { for (let i = 0; i < 100; i++) moverHistorial(-1); });
check('  se pueden deshacer los 100', (await hist()).i === 0 && (await val('alquiler')) === '1.029', `${await hist().then(x => x.i)} ${await val('alquiler')}`);
await tecla('Control+z');
check('  y el 101.º ya no hay', (await indicador()) === 'Nothing to undo' || (await indicador()) === 'Nada que deshacer', await indicador());

// ---------- 8) modales y arranque desde un enlace ----------
await p.evaluate(() => resetDefaults());
await poner('alquiler', '1800');
await p.evaluate(() => openModal('helpModal'));
await p.keyboard.press('Control+z'); await p.waitForTimeout(60);
check('con un modal abierto Ctrl+Z no toca el escenario', (await val('alquiler')) === '1.800');
await p.evaluate(() => closeModal('helpModal'));
const pL = await abrir('?a=2222&ver=2');
check('con un enlace, la instantánea inicial ya lleva sus cifras', (await pL.evaluate(() => [HISTORIAL.length, document.getElementById('alquiler').value])).join() === '1,2.222');
await pL.evaluate(() => { document.getElementById('alquiler').value = '3000'; confirmarCambio(); });
await pL.keyboard.press('Control+z'); await pL.waitForTimeout(60);
check('  deshacer vuelve a las cifras del enlace, no al ejemplo', (await pL.inputValue('#alquiler')) === '2.222', await pL.inputValue('#alquiler'));
await pL.close();

check('sin errores de consola', p.errs.length === 0, p.errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
