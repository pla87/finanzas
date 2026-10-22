// Repaso final: migración de escenarios viejos, ida y vuelta del guardado, móvil y tema oscuro.
import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
let fallos = 0;
const check = (n, ok, d = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok   ' : 'FALLO'} ${n.padEnd(58)} ${d}`); };
const nueva = async (w = 1440, h = 1100) => {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  return p;
};

// 1) Un escenario guardado antes de que existieran los campos nuevos tiene que cargar limpio.
{
  const p = await nueva();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGINA);
  // Estado de una versión vieja: sin mesesVacios, sin venta, sin anoRef, sin candados nuevos.
  await p.evaluate(() => localStorage.setItem('calc_pisos_v2', JSON.stringify({
    precioAnunciado: '300.000', oferta: '280.000', valor: '300.000', superficie: '80',
    pctFinanciado: '70', plazoHipoteca: '25', tipoHipoteca: '3,00', alquiler: '1.200',
    horizonte: '25', inflacion: '2', indexar: 'si', ccaa: 'cataluna', autoIbi: false, ibi: '900'
  })));
  await p.reload(); await p.waitForTimeout(700);
  const r = await p.evaluate(() => {
    const d = calcular();
    return { oferta: d.oferta, mesesVacios: d.mesesVacios, anoRef: d.anoRef, horizonte: d.horizonte,
      gastosVenta: d.pctGastosVenta, ibi: d.ibi, tir: d.ultima.anualizada, neto: d.ultima.netoVenta };
  });
  check('un escenario viejo carga sin romperse', errs.length === 0, errs.join(' | '));
  check('  conserva lo que traía', r.oferta === 280000 && r.horizonte === 25 && r.ibi === 900,
    `oferta ${r.oferta} · horizonte ${r.horizonte} · IBI ${r.ibi}`);
  check('  y estrena los campos nuevos con su valor de fábrica',
    r.mesesVacios === 0.5 && r.gastosVenta === 0.05 && r.anoRef === 25,
    `${r.mesesVacios} meses · ${r.gastosVenta * 100}% venta · año ${r.anoRef}`);
  check('  el año de referencia se recorta al horizonte guardado', r.anoRef <= r.horizonte);
  check('  y todo calcula', isFinite(r.tir) && isFinite(r.neto), `TIR ${(r.tir * 100).toFixed(2)}%`);
  await p.close();
}

// 2) Ida y vuelta del guardado con todos los campos nuevos.
{
  const p = await nueva();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGINA);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(600);
  const ida = await p.evaluate(() => {
    document.getElementById('mesesVacios').value = '1,5';
    document.getElementById('pctGastosVenta').value = '7';
    document.getElementById('horizonte').value = '40';
    render();
    document.getElementById('anoRef').value = '12';
    alternarBloqueo('pctGananciaVenta');
    document.getElementById('pctGananciaVenta').value = '23,00';
    render();
    return JSON.stringify(leerEstado());
  });
  const vuelta = await p.evaluate((estado) => {
    resetDefaults();                       // se ensucia entero
    aplicarEstado(JSON.parse(estado)); render();
    return { estado: JSON.stringify(leerEstado()), d: (() => { const d = calcular();
      return { meses: d.mesesVacios, venta: d.pctGastosVenta, anoRef: d.anoRef, horizonte: d.horizonte }; })() };
  }, ida);
  check('el escenario guardado vuelve idéntico', vuelta.estado === ida,
    vuelta.estado === ida ? '' : 'difieren');
  check('  con los campos nuevos en su sitio',
    vuelta.d.meses === 1.5 && vuelta.d.venta === 0.07 && vuelta.d.anoRef === 12 && vuelta.d.horizonte === 40,
    `${vuelta.d.meses} meses · ${vuelta.d.venta * 100}% · año ${vuelta.d.anoRef} de ${vuelta.d.horizonte}`);
  check('  sin errores', errs.length === 0, errs.join(' | '));
  await p.close();
}

// 3) Móvil y tema oscuro, con todo lo que ha crecido la página.
for (const [nombre, w] of [['móvil', 390], ['tableta', 768], ['escritorio', 1440]]) {
  const p = await nueva(w, 900);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGINA);
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(700);
  const desborda = await p.evaluate(() => {
    const malos = [];
    // La tabla ancha vive en su propio contenedor con scroll; el cuerpo no debe desbordar.
    if (document.documentElement.scrollWidth > window.innerWidth + 1) malos.push('body');
    for (const s of ['header', 'main', 'footer']) {
      const e = document.querySelector(s);
      if (e && e.scrollWidth > e.clientWidth + 1) malos.push(s);
    }
    return malos;
  });
  check(`${nombre}: nada desborda a lo ancho`, desborda.length === 0, desborda.join(', '));
  if (w === 1440) {
    await p.evaluate(() => toggleTheme());
    await p.waitForTimeout(300);
    const contraste = await p.evaluate(() => {
      const fondo = getComputedStyle(document.body).backgroundColor;
      const texto = getComputedStyle(document.body).color;
      return { fondo, texto, oscuro: document.documentElement.dataset.theme };
    });
    check('tema oscuro se aplica', contraste.oscuro === 'dark', `${contraste.fondo} / ${contraste.texto}`);
    await p.click('text=💵 Flujo de caja'); await p.waitForTimeout(400);
    await p.click('text=🔥 Tablas'); await p.waitForTimeout(300);
    await p.click('.tab-btn >> text=⚙️ Parámetros >> visible=true'); await p.waitForTimeout(300);
    await p.click('#btnFaq'); await p.waitForTimeout(300);
    await p.click('#faqModal button'); await p.waitForTimeout(200);
    await p.click('#btnAyuda'); await p.waitForTimeout(300);
    await p.click('#helpModal button'); await p.waitForTimeout(200);
  }
  check(`${nombre}: sin errores de consola`, errs.length === 0, errs.join(' | '));
  await p.close();
}

await b.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
