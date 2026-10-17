import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
await p.evaluate(() => { localStorage.clear(); resetDefaults(); });
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(46)} ${d}`); };
const val = id => p.evaluate(i => document.getElementById(i).value, id);
const txt = s => p.textContent(s);

// 1) separadores de miles siempre, también en cuatro cifras
await p.evaluate(() => { document.getElementById('alquiler').value = '2000'; render(); });
check('separador en 4 cifras (caja anual)', /\d\.\d{3}/.test(await txt('#outAlquilerAnual')) , await txt('#outAlquilerAnual'));
check('separador en los campos', (await val('oferta')) === '500.000', await val('oferta'));

// 2) impuesto por comunidad y obra nueva
const itp = async (ccaa, nueva) => p.evaluate(([c,n]) => {
  document.getElementById('ccaa').value = c; document.getElementById('obraNueva').value = n; render();
  return document.getElementById('pctImpuestos').value; }, [ccaa, nueva]);
check('Madrid usada = 6%', (await itp('madrid','no')) === '6', await itp('madrid','no'));
check('Cataluña usada = 10%', (await itp('cataluna','no')) === '10', await itp('cataluna','no'));
check('Madrid obra nueva = 10 IVA + 0,75 AJD', (await itp('madrid','si')) === '10,75', await itp('madrid','si'));
check('Canarias obra nueva = 7 IGIC + 0,75', (await itp('canarias','si')) === '7,75', await itp('canarias','si'));
await p.evaluate(() => { document.getElementById('ccaa').value='madrid'; document.getElementById('obraNueva').value='no'; render(); });

// 3) el impuesto se puede desbloquear
await p.click('#lockPctImpuestos');
await p.evaluate(() => { document.getElementById('pctImpuestos').value = '4'; render();
  document.getElementById('ccaa').value = 'cataluna'; render(); });
check('tipo manual sobrevive al cambio de comunidad', (await val('pctImpuestos')) === '4', await val('pctImpuestos'));
await p.click('#lockPctImpuestos');
check('al recerrar vuelve al tipo de Cataluña', (await val('pctImpuestos')) === '10', await val('pctImpuestos'));
await p.evaluate(() => { document.getElementById('ccaa').value='madrid'; render(); });

// 4) IBI reducido al menos un 40% desde 0,4
check('multiplicador de IBI ≤ 0,24%', parseFloat((await val('tasaIbi')).replace(',','.')) <= 0.24, await val('tasaIbi'));

// 5) financiación: liquidez derivada, préstamo topado
const fin = await p.evaluate(() => { const r = calcular();
  return { coste: r.costeTotal, hip: r.principalHip, pre: r.principalPre, liq: r.aportado, tope: r.topePrestamo }; });
check('liquidez = coste − hipoteca − préstamo', Math.abs(fin.coste - fin.hip - fin.pre - fin.liq) < 1, JSON.stringify(fin));
await p.click('#lockPrestamo');
await p.evaluate(() => { document.getElementById('importePrestamo').value = '9999999'; render(); });
const fin2 = await p.evaluate(() => { const r = calcular(); return { pre: r.principalPre, tope: r.topePrestamo, liq: r.aportado }; });
check('préstamo topado al hueco que deja la hipoteca', Math.abs(fin2.pre - fin2.tope) < 1 && fin2.liq === 0, JSON.stringify(fin2));
await p.click('#lockPrestamo');

// 6) hipoteca desactivable
await p.click('#lockHipoteca');
const sinHip = await p.evaluate(() => { const r = calcular(); return { hip: r.principalHip, liq: r.aportado, coste: r.costeTotal }; });
check('sin hipoteca la liquidez cubre todo', sinHip.hip === 0 && Math.abs(sinHip.liq - sinHip.coste) < 1, JSON.stringify(sinHip));
await p.click('#lockHipoteca');

// 7) LTV limitado a 0..100
await p.evaluate(() => { document.getElementById('pctFinanciado').value = '150'; render(); });
check('LTV limitado al 100%', (await p.evaluate(() => calcular().pctFinanciado)) === 100);
await p.evaluate(() => { document.getElementById('pctFinanciado').value = '80'; render(); });

// 8) año 0 negativo por los gastos de compra
const a0 = await p.evaluate(() => { const r = calcular(); return { g0: r.fila0.ganancia, gastos: r.gastosCompra, etiquetas: charts.patrimonio.data.labels.slice(0,3) }; });
check('la gráfica arranca en el año 0', a0.etiquetas[0] === 0, JSON.stringify(a0.etiquetas));
check('ganancia año 0 = −gastos de compra', Math.abs(a0.g0 + a0.gastos) < 1, `${Math.round(a0.g0)} vs −${Math.round(a0.gastos)}`);

// 9) idioma
await p.click('#langBtn'); await p.waitForTimeout(200);
check('cambia a inglés', (await txt('[data-i18n="compraTitulo"]')) === 'Purchase', await txt('[data-i18n="compraTitulo"]'));
// El icono es una bandera dibujada, no un emoji: se comprueba el SVG que hay dentro.
check('el icono pasa a la bandera española',
  /#c60b1e/.test(await p.innerHTML('#langIcon')), (await p.innerHTML('#langIcon')).slice(0, 40));
check('formato numérico inglés', (await val('oferta')) === '500,000', await val('oferta'));
await p.reload(); await p.waitForTimeout(600);
check('el idioma se recuerda', (await txt('[data-i18n="compraTitulo"]')) === 'Purchase');
await p.click('#langBtn'); await p.waitForTimeout(200);
check('vuelve a español', (await txt('[data-i18n="compraTitulo"]')) === 'Compra');

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await p.evaluate(() => { localStorage.clear(); }); await p.reload(); await p.waitForTimeout(600);
await p.locator('main').screenshot({ path: salida('v2main.png') });
await p.locator('#proyeccionTab').screenshot({ path: salida('v2proy.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
