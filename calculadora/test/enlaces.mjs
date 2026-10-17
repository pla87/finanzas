// Candados en cadena (anunciado → oferta → valor, inflación → revalorización) y el círculo
// nuevo de reparto del alquiler.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);

let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(52)} ${d}`); };
const n = async id => p.evaluate(i => parseNum(document.getElementById(i).value), id);
const bloqueado = async id => p.evaluate(i => document.getElementById(i).disabled, id);

await p.evaluate(() => resetDefaults());
await p.waitForTimeout(200);

// La oferta no lleva candado: va enlazada al descuento sobre el anunciado, en los dos sentidos.
const teclear = (id, v) => p.evaluate(([i, x]) => {
  const e = document.getElementById(i);
  e.value = x; e.dispatchEvent(new Event('input')); render();
}, [id, v]);

check('la oferta nace editable', !(await bloqueado('oferta')));
check('la oferta no tiene candado', (await p.$('#lockOferta')) === null);
check('el valor nace bloqueado', await bloqueado('valor'));
check('la revalorización nace bloqueada', await bloqueado('revalorizacion'));

await teclear('precioAnunciado', 420000);
check('con descuento 0, el anunciado iguala la oferta', (await n('oferta')) === 420000, String(await n('oferta')));
check('el valor sigue a la oferta', (await n('valor')) === 420000, String(await n('valor')));
check('sin descuento mientras coinciden', (await n('descuentoOferta')) === 0, String(await n('descuentoOferta')));

await p.evaluate(() => { document.getElementById('inflacion').value = 4; render(); });
check('la revalorización sigue a la inflación', (await n('revalorizacion')) === 4, String(await n('revalorizacion')));

// --- bajar la oferta no necesita permiso, y el descuento la sigue ---
await teclear('oferta', 400000);
check('la oferta se queda donde la pongas', (await n('oferta')) === 400000, String(await n('oferta')));
check('el valor sigue a la oferta, no al anunciado', (await n('valor')) === 400000, String(await n('valor')));
check('ahora sí hay descuento', (await n('descuentoOferta')) === 4.76, String(await n('descuentoOferta')));
await teclear('precioAnunciado', 380000);
check('cambiar el anunciado conserva el descuento', (await n('oferta')) === 361905, String(await n('oferta')));
await teclear('precioAnunciado', 420000);
check('y sin desviarse por el redondeo', (await n('oferta')) === 400000, String(await n('oferta')));
await teclear('descuentoOferta', 10);
check('escribir el descuento ajusta la oferta', (await n('oferta')) === 378000, String(await n('oferta')));

await p.click('#lockValor');
await p.evaluate(() => { document.getElementById('valor').value = 460000; render(); });
await p.evaluate(() => { document.getElementById('oferta').value = 390000; render(); });
check('el valor suelto no se mueve al cambiar la oferta', (await n('valor')) === 460000, String(await n('valor')));

// El año 0 arranca en la diferencia entre lo que vale y lo que cuesta entero.
const g0 = await p.evaluate(() => { const d = calcular(); return { g: d.fila0.ganancia, valor: d.valor, coste: d.costeTotal }; });
check('comprar por debajo de valor levanta el año 0',
  Math.abs(g0.g - (g0.valor - g0.coste)) < 0.01, `${Math.round(g0.g)} €`);

// --- la revalorización manda sobre el patrimonio, la inflación sobre el alquiler ---
await p.click('#lockRevalorizacion');
const antes = await p.evaluate(() => { const d = calcular(); return { pat: d.ultima.patrimonio, ing: d.ingresosAcum }; });
await p.evaluate(() => { document.getElementById('revalorizacion').value = 7; render(); });
const despues = await p.evaluate(() => { const d = calcular(); return { pat: d.ultima.patrimonio, ing: d.ingresosAcum }; });
check('subir la revalorización sube el patrimonio', despues.pat > antes.pat * 1.5,
  `${Math.round(antes.pat / 1000)}k → ${Math.round(despues.pat / 1000)}k`);
check('y no toca el alquiler cobrado', Math.abs(despues.ing - antes.ing) < 0.01, `${Math.round(antes.ing)} €`);

await p.evaluate(() => { document.getElementById('inflacion').value = 8; render(); });
const inflado = await p.evaluate(() => { const d = calcular(); return { pat: d.ultima.patrimonio, ing: d.ingresosAcum }; });
check('subir la inflación sube el alquiler', inflado.ing > despues.ing * 1.2,
  `${Math.round(despues.ing / 1000)}k → ${Math.round(inflado.ing / 1000)}k`);
check('y ya no arrastra la revalorización', Math.abs(inflado.pat - despues.pat) < 0.01);

// --- el reparto del círculo cierra por construcción ---
async function cuadraReparto(nombre) {
  const d = await p.evaluate(() => {
    const r = calcular();
    return { r: r.reparto, ing: r.ingresosAcum, extra: r.aportacionesExtra };
  });
  const suma = d.r.gastos + d.r.irpf + d.r.intereses + d.r.amortizacion + d.r.caja;
  const total = d.ing + d.extra;
  check(`el reparto cuadra: ${nombre}`, Math.abs(suma - total) < 1,
    `${Math.round(suma)} vs ${Math.round(total)}`);
  check(`ninguna porción negativa: ${nombre}`, Object.values(d.r).every(v => v >= -1e-6));
}

await p.evaluate(() => resetDefaults());
await cuadraReparto('por defecto');
await p.evaluate(() => {
  document.getElementById('usarPrestamo').checked = true; pintarFuente('prestamo');
  document.getElementById('importePrestamo').value = 80000;
  document.getElementById('hipotecaAcelerada').checked = true;
  render();
});
await cuadraReparto('las dos deudas y las dos aceleradas');
await p.evaluate(() => { document.getElementById('pctFinanciado').value = 95; document.getElementById('alquiler').value = 700; render(); });
await cuadraReparto('con años en pérdidas que piden dinero');

// --- el círculo se pinta y lleva porcentajes ---
await p.click('text=💵 Flujo de caja');
await p.waitForTimeout(400);
const leyendas = await p.evaluate(() => charts.ingresos.legend.legendItems.map(i => i.text));
check('la leyenda del círculo lleva el porcentaje', leyendas.every(x => /%$/.test(x)), leyendas[0]);
const leyendaGastos = await p.evaluate(() => charts.gastos.legend.legendItems.map(i => i.text));
check('la de gastos también', leyendaGastos.every(x => /%$/.test(x)), leyendaGastos[0]);
check('el subtítulo dice cuánto entra y en cuántos años',
  /\d.*\d/.test(await p.textContent('#desgloseIngresosSub')), await p.textContent('#desgloseIngresosSub'));

await p.screenshot({ path: salida('circulos.png'), clip: { x: 0, y: 400, width: 1440, height: 800 } });

check('sin errores de consola', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
