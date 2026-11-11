// Límites de los campos. Dos niveles: el duro recorta y redondea al salir del campo (y al cargar
// de guardado o enlace, en silencio); el aviso pone en rojo, con su explicación en el title, un
// valor posible pero preocupante, sin tocarlo. Además: la lectura de «2,375» en un tipo, el tope
// del horizonte, el año de referencia que no se queda pegado y el singular de «1 año».
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
const poner = async (id, v) => { await p.evaluate(() => ocultarAvisoLimite()); await p.fill('#' + id, String(v)); await p.press('#' + id, 'Tab'); };
const val = (id) => p.inputValue('#' + id);
const aviso = () => p.evaluate(() => { const e = document.getElementById('avisoLimite'); return e.hidden ? '' : e.textContent; });
const rojo = (id) => p.evaluate((i) => document.getElementById(i).classList.contains('val-neg'), id);
const titulo = (id) => p.evaluate((i) => document.getElementById(i).title, id);
const rojos = () => p.evaluate(() => [...document.querySelectorAll('.campo.val-neg, #outEurM2.val-neg')].map(e => e.id));

// ---------- 1) el escenario de ejemplo no avisa de nada ----------
check('por defecto ningún campo está en rojo', (await rojos()).length === 0, (await rojos()).join());

// ---------- 2) límite duro: paso de medio mes ----------
await poner('mesesVacios', '0,3');
check('«Meses sin inquilino» 0,3 → 0,5', (await val('mesesVacios')) === '0,5', await val('mesesVacios'));
const av = await aviso();
check('  y avisa del rango y del paso, traducido', /0 meses a 12 meses/.test(av) && /de 0,5 en 0,5/.test(av), av);
await poner('mesesVacios', '13');
check('13 se recorta a 12', (await val('mesesVacios')) === '12,0', await val('mesesVacios'));
await poner('mesesVacios', '-2');
check('−2 se recorta a 0', (await val('mesesVacios')) === '0,0', await val('mesesVacios'));
await poner('mesesVacios', '1,5');
check('un valor válido no se toca (1,5)', (await val('mesesVacios')) === '1,5' && (await aviso()) === '');
check('  1,5 meses no está en rojo (el aviso es a partir de 3)', !(await rojo('mesesVacios')));
await poner('mesesVacios', '4');
check('4 meses se quedan en 4 pero en rojo, con su explicación', (await val('mesesVacios')) === '4,0' && (await rojo('mesesVacios')) && /3 meses/.test(await titulo('mesesVacios')), await titulo('mesesVacios'));
await poner('mesesVacios', '0,5');
check('  al volver a un valor sano se apaga el rojo y el title', !(await rojo('mesesVacios')) && (await titulo('mesesVacios')) === '');

// ---------- 3) enteros, sin decimales ----------
await poner('plazoHipoteca', '30,4');
check('plazo de hipoteca 30,4 → 30 (entero)', (await val('plazoHipoteca')) === '30', await val('plazoHipoteca'));
await poner('plazoHipoteca', '45');
check('45 años → 40', (await val('plazoHipoteca')) === '40' && /1 año a 40 años/.test(await aviso()), await aviso());
check('  y 40 años está en rojo (>30)', await rojo('plazoHipoteca'));
await poner('plazoHipoteca', '0');
check('0 años → 1', (await val('plazoHipoteca')) === '1');
await poner('plazoHipoteca', '30');
await p.click('#lockPrestamo');
await poner('plazoPrestamo', '99');
check('plazo del préstamo 99 → 15', (await val('plazoPrestamo')) === '15');
await poner('plazoPrestamo', '5');
await p.click('#lockPrestamo');

// ---------- 4) importes: mínimos y máximos ----------
await poner('precioAnunciado', '5000');
check('precio anunciado 5.000 → 10.000', (await val('precioAnunciado')) === '10.000', await val('precioAnunciado'));
await poner('precioAnunciado', '30000000');
check('precio anunciado 30.000.000 → 20.000.000', (await val('precioAnunciado')) === '20.000.000');
check('  la oferta arrastrada sigue el descuento del 5 %', (await val('oferta')) === '19.000.000', await val('oferta'));
await poner('precioAnunciado', '260000');
await poner('reforma', '-500');
check('un importe negativo se queda en 0', (await val('reforma')) === '0', await val('reforma'));
await poner('reforma', '8000');
await poner('superficie', '3');
check('superficie 3 m² → 10', (await val('superficie')) === '10');
await poner('superficie', '80');

// ---------- 5) porcentajes con decimales ----------
await poner('tipoHipoteca', '25');
check('tipo de hipoteca 25 → 20,00', (await val('tipoHipoteca')) === '20,00', await val('tipoHipoteca'));
await poner('tipoHipoteca', '2,8');
await poner('inflacion', '-9');
check('inflación −9 → −5,00', (await val('inflacion')) === '-5,00', await val('inflacion'));
check('  y la inflación negativa avisa en rojo', await rojo('inflacion'));
await poner('inflacion', '2,5');
await p.click('#lockPctImpuestos');
await poner('pctImpuestos', '40');
check('impuesto de compra 40 → 15', (await val('pctImpuestos')) === '15', await val('pctImpuestos'));
await p.click('#lockPctImpuestos');

// ---------- 6) descuento y oferta, enlazados ----------
await poner('descuentoOferta', '95');
check('descuento 95 → 90 y la oferta se ajusta a él', (await val('descuentoOferta')) === '90' && (await val('oferta')) === '26.000', `${await val('descuentoOferta')} / ${await val('oferta')}`);
check('  el descuento del 90 % avisa (>40)', await rojo('descuentoOferta'));
await poner('descuentoOferta', '35');
check('  uno del 35 % ya no avisa (el umbral es el 40 %)', !(await rojo('descuentoOferta')));
await poner('descuentoOferta', '40');
check('  ni el 40 % exacto', !(await rojo('descuentoOferta')));
await poner('descuentoOferta', '41');
check('  pero el 41 % sí, y el aviso habla del 40 %', (await rojo('descuentoOferta')) && /40 %/.test(await titulo('descuentoOferta')), await titulo('descuentoOferta'));
await poner('descuentoOferta', '-3');
check('descuento −3 → 0', (await val('descuentoOferta')) === '0');
await poner('descuentoOferta', '5');
await poner('oferta', '300000');
check('oferta mayor que el anunciado: se respeta, en rojo y con title', (await val('oferta')) === '300.000' && (await rojo('oferta')) && /anunciado/.test(await titulo('oferta')));
await poner('oferta', '247000');
check('  al bajarla se apaga', !(await rojo('oferta')));
await poner('oferta', '10');
check('oferta 10 € → 1.000', (await val('oferta')) === '1.000');
await poner('descuentoOferta', '5');

// ---------- 7) avisos que no tocan el valor ----------
// Los parámetros fiscales viven en su pestaña.
await p.evaluate(() => { switchTab('paramsTab', document.querySelectorAll('.tab-btn')[3]); });
await poner('superficie', '1000');
check('€/m² bajo 300: avisa en la superficie y en el €/m²', (await rojo('superficie')) && (await rojo('outEurM2')) && /300/.test(await titulo('superficie')), await titulo('superficie'));
await poner('superficie', '10');
check('€/m² por encima de 15.000 también', await rojo('superficie') && /15\.000/.test(await titulo('superficie')));
await poner('superficie', '80');
await poner('pctFinanciado', '85');
// El máximo del campo es 100, así que no hay valor por encima que avisar: 85 y 100 se quedan sin rojo.
check('85 % financiado: se queda y no avisa', (await val('pctFinanciado')) === '85' && !(await rojo('pctFinanciado')));
await poner('pctFinanciado', '100');
check('  y el 100 % tampoco (es el máximo del campo)', (await val('pctFinanciado')) === '100' && !(await rojo('pctFinanciado')));
await poner('pctFinanciado', '70');
await poner('alquiler', '300');
check('rentabilidad bruta < 2 %: el alquiler avisa', (await rojo('alquiler')) && /2 %/.test(await titulo('alquiler')), await titulo('alquiler'));
await poner('alquiler', '5000');
check('rentabilidad bruta > 15 %: también', (await rojo('alquiler')) && /15 %/.test(await titulo('alquiler')));
await poner('alquiler', '1250');
check('  alquiler normal, sin aviso', !(await rojo('alquiler')));
await p.click('#lockMantenimiento');
await poner('mantenimiento', '9000');
check('gastos anuales > 50 % del alquiler: avisan los cinco campos', (await Promise.all(['comunidad', 'ibi', 'seguroHogar', 'seguroImpagos', 'mantenimiento'].map(rojo))).every(Boolean));
await p.click('#lockMantenimiento');
check('  y al reestimar se apagan', (await rojos()).length === 0, (await rojos()).join());
await poner('tipoMarginal', '60');
check('tipo marginal 60: se queda y avisa (>54)', (await val('tipoMarginal')) === '60' && await rojo('tipoMarginal'));
await poner('tipoMarginal', '150');
check('tipo marginal 150 → 100', (await val('tipoMarginal')) === '100');
await poner('tipoMarginal', '45');
await poner('tasaMantenimiento', '20');
check('mantenimiento 20 % del alquiler: avisa (>15)', await rojo('tasaMantenimiento'));
await poner('tasaMantenimiento', '2');
await poner('tasaIbi', '2');
check('IBI 2 % del precio: avisa (>1,5)', await rojo('tasaIbi'));
await poner('tasaIbi', '0.2');
check('un tipo de préstamo del 10 % marca «ALTO» y el title', await (async () => { await p.click('#lockPrestamo'); await poner('tipoPrestamo', '12'); return (await rojo('tipoPrestamo')) && /10 %/.test(await titulo('tipoPrestamo')); })());
await poner('tipoPrestamo', '9');
await p.click('#lockPrestamo');
check('tras todo eso no queda nada en rojo', (await rojos()).length === 0, (await rojos()).join());

// ---------- 8) el aviso de recorte del préstamo (lo recorta el motor) ----------
await p.click('#lockPrestamo');
await poner('importePrestamo', '99999999');
check('el préstamo por encima de su tope se recorta y lo dice', /de 0\s€ a/.test(await aviso()), await aviso());
await p.click('#lockPrestamo');

// ---------- 9) lectura de decimales: «2,375» no son 2.375 ----------
await p.fill('#tipoHipoteca', '2,375');
check('«2,375» en un tipo se lee como 2,375 y no como 2.375', await p.evaluate(() => num('tipoHipoteca')) === 2.375);
await p.press('#tipoHipoteca', 'Tab');
const cuota = await p.evaluate(() => calcular().cuotaHip);
check('  y la cuota es la de una hipoteca normal (no 342.198 €)', cuota > 500 && cuota < 1000, cuota.toFixed(0));
await poner('inflacion', '1,125');
check('«1,125» en la inflación = 1,13 (tras redondear al paso)', (await val('inflacion')) === '1,13', await val('inflacion'));
const lectura = await p.evaluate(() => ({
  precio: parseNum('260.000'), cero: parseNum('0,125'), cero2: parseNum('0.125'), punto: parseNum('0.24', true),
  miles: parseNum('1.250'), decimal: parseNum('1.250', true), mixto: parseNum('1.234,5'), dos: parseNum('1.234.567') }));
check('importes: «260.000» son miles y «0,125» y «0.125» son decimales', lectura.precio === 260000 && lectura.cero === 0.125 && lectura.cero2 === 0.125, JSON.stringify(lectura));
check('decimales: «0.24» es 0,24; «1.250» es 1,25 en un tipo pero 1250 en un importe', lectura.punto === 0.24 && lectura.decimal === 1.25 && lectura.miles === 1250);
check('  y los casos con varios separadores siguen igual', lectura.mixto === 1234.5 && lectura.dos === 1234567);
await poner('inflacion', '2,5');
await poner('tipoHipoteca', '2,8');
await poner('oferta', '247.000');
check('un importe con punto de miles se sigue leyendo bien', (await p.evaluate(() => num('oferta'))) === 247000);

// ---------- 10) horizonte: tope, año de referencia y singular ----------
await poner('horizonte', '500');
check('horizonte 500 → 60', (await val('horizonte')) === '60');
await poner('horizonte', '10');
check('con horizonte 10 el año de referencia se recorta a 10', (await val('anoRef')) === '10');
await poner('horizonte', '30');
check('  al subirlo a 30 vuelve a 30 (no se queda pegado en 10)', (await val('anoRef')) === '30', await val('anoRef'));
await poner('horizonte', '');
check('  vaciar el horizonte lo deja en 1', (await val('horizonte')) === '1');
await poner('horizonte', '30');
check('  y recuperarlo devuelve el año 30', (await val('anoRef')) === '30', await val('anoRef'));
await p.evaluate(() => { const s = document.getElementById('anoRef'); s.value = '12'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await poner('horizonte', '5');
await poner('horizonte', '30');
check('un año elegido a mano (12) se recuerda aunque el horizonte se recorte', (await val('anoRef')) === '12', await val('anoRef'));
await poner('horizonte', '1');
const uno = await p.evaluate(() => ({ unidad: document.getElementById('horizonte').closest('.control').querySelector('.unidad').textContent,
  rotulo: document.querySelector('.kpi-rotulo-fin').textContent, reparto: document.getElementById('desgloseIngresosSub').textContent }));
check('horizonte 1: «año» y no «años»', uno.unidad === 'año' && uno.rotulo === 'AÑO' && /en 1 año proyectado|1 año/.test(uno.reparto) && !/1 años/.test(uno.reparto), JSON.stringify(uno));
await p.click('#langBtn'); await p.waitForTimeout(300);
const unoEn = await p.evaluate(() => ({ unidad: document.getElementById('horizonte').closest('.control').querySelector('.unidad').textContent, rotulo: document.querySelector('.kpi-rotulo-fin').textContent }));
check('  y en inglés «year»', unoEn.unidad === 'year' && unoEn.rotulo === 'YEAR', JSON.stringify(unoEn));
await poner('mesesVacios', '0,3');
check('  el aviso de recorte también va en inglés', /Adjusted to the allowed range: 0 months to 12 months \(in steps of 0\.5\)/.test(await aviso()), await aviso());
await p.click('#langBtn'); await p.waitForTimeout(300);
await poner('mesesVacios', '0,5');
await poner('horizonte', '30');

// ---------- 11) carga con valores fuera de rango (enlace y guardado) ----------
const t0 = Date.now();
const p2 = await abrir('?p=5&z=5000&h=99&l=77&m=20&t=50&f=150&a=-30&n=-40&ch=500&x=999&gs=-3');
const url = await p2.evaluate(() => Object.fromEntries(['precioAnunciado', 'horizonte', 'plazoHipoteca', 'plazoPrestamo', 'mesesVacios', 'tipoHipoteca', 'pctFinanciado', 'alquiler', 'inflacion', 'aperturaHip', 'tipoMarginal', 'pctGastosVenta'].map(i => [i, document.getElementById(i).value])));
check('un enlace con todo fuera de rango carga recortado, sin colgarse', Date.now() - t0 < 8000 && p2.errs.length === 0, `${Date.now() - t0} ms ${p2.errs[0] ?? ''}`);
check('  precio 10.000, horizonte 60, plazo 40, meses 12', url.precioAnunciado === '10.000' && url.horizonte === '60' && url.plazoHipoteca === '40' && url.mesesVacios === '12,0', JSON.stringify(url));
check('  tipo 20, financiado 100, alquiler 0, inflación −5, apertura 100', url.tipoHipoteca === '20,00' && url.pctFinanciado === '100' && url.alquiler === '0' && url.inflacion === '-5,00' && url.aperturaHip === '100,00', JSON.stringify(url));
check('  marginal 100, gastos de venta 0', url.tipoMarginal === '100' && url.pctGastosVenta === '0', JSON.stringify(url));
check('  y no se avisa de nada al cargar', await p2.evaluate(() => document.getElementById('avisoLimite').hidden));
await p2.close();
const p3 = await abrir();
await p3.evaluate(() => { const e = JSON.parse(localStorage.getItem('calc_pisos_v2') || '{}'); Object.assign(e, { mesesVacios: '99', plazoHipoteca: '77', horizonte: '900', superficie: '1', tasaIbi: '500' }); localStorage.setItem('calc_pisos_v2', JSON.stringify(e)); });
await p3.reload(); await p3.waitForTimeout(500);
const gu = await p3.evaluate(() => Object.fromEntries(['mesesVacios', 'plazoHipoteca', 'horizonte', 'superficie', 'tasaIbi'].map(i => [i, document.getElementById(i).value])));
check('lo guardado fuera de rango también se recorta', gu.mesesVacios === '12,0' && gu.plazoHipoteca === '40' && gu.horizonte === '60' && gu.superficie === '10' && gu.tasaIbi === '100', JSON.stringify(gu));
await p3.close();

// ---------- 12) opciones del comparador, de guardado o enlace ----------
const op = await p.evaluate(() => leerOpciones([{ letra: 'A', usarHipoteca: true, pctFinanciado: 500, plazoHipoteca: 99, tipoHipoteca: 77, aperturaHip: 900,
  usarPrestamo: true, importePrestamo: 5e9, plazoPrestamo: 99.4, tipoPrestamo: 99, aperturaPre: 5, aperturaPreEur: true }])[0]);
check('una opción fuera de rango se recorta con los mismos límites', op.pctFinanciado === 100 && op.plazoHipoteca === 40 && op.tipoHipoteca === 20 && op.aperturaHip === 100
  && op.importePrestamo === 20000000 && op.plazoPrestamo === 15 && op.tipoPrestamo === 30 && op.aperturaPre === 5 && op.aperturaPreEur === true, JSON.stringify(op));

// ---------- 13) y el motor no se cuelga con plazos disparatados ----------
const ms = await p.evaluate(() => { const t1 = performance.now(); document.getElementById('plazoHipoteca').value = '99999999'; document.getElementById('horizonte').value = '99999999'; calcular(); const r = performance.now() - t1; document.getElementById('plazoHipoteca').value = '30'; document.getElementById('horizonte').value = '30'; return r; });
check('calcular() con plazo y horizonte de 99.999.999 sigue siendo instantáneo', ms < 1500, `${ms.toFixed(0)} ms`);

check('sin errores de consola', p.errs.length === 0, p.errs[0] ?? '');
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
