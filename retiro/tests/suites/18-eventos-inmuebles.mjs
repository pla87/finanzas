// Las compras y ventas programadas de inmuebles, que es donde los dos motores se separaban.
// El fuzzer con eventos sacó tres desacuerdos, los tres en el dinero, no en la presentación:
//
//   1. La hipoteca que nace de una compra empieza en enero del año siguiente (se compra en
//      diciembre). El optimizador le cobraba un año entero de cuotas ya en el año de la compra,
//      porque el amortizador devuelve el principal íntegro para una fecha anterior al inicio y
//      "saldo > 0" se tomaba por "hay cuota que pagar".
//   2. La proyección, en cambio, no le cobraba intereses NUNCA: montaba el préstamo con
//      `monthlyEUR: 0`, así que amortizaba principal a secas durante los treinta años.
//   3. El año de una venta, la proyección cancelaba la hipoteca ANTES de correr el cuadro de
//      amortización, así que ese año salía sin cuota y cancelando el saldo de enero en vez del
//      de diciembre. El optimizador lo hacía al revés, que es lo correcto.
//
// Y un cuarto, sin inmuebles de por medio: el desplegable de destino comparte
// `customYearlyRouting` con el de origen del déficit, así que un año fijado a mano a "Plan
// Pensiones" que luego pasa a tener excedente llegaba con un destino que la proyección no
// reconocía -y se dejaba el excedente entero por el camino- mientras el optimizador lo metía
// en acciones de dividendo.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(buildStateObject()));
      // Las mismas edades que usa la proyección, o los dos motores mirarían planes distintos.
      const A1 = Number(document.getElementById('retireAge').value);
      const A2 = Number(document.getElementById('retireAgeP2').value);

      // Un plan con una compra financiada dentro de cinco años y su venta doce años después.
      const añoCompra = START_YEAR + 5, añoVenta = START_YEAR + 17;
      const conEventos = JSON.parse(JSON.stringify(base));
      conEventos.realEstateEvents = [
        { id: 'evb', assetId: 're_buy_test', type: 'buy', year: añoCompra, name: 'Piso de prueba',
          useType: 'vacant', owner: 'joint', priceTodayEUR: 300000, rentTodayEUR: 0,
          opexPct: 10, downPct: 20, expPct: 10, hasMort: true, mortRate: 3.5, mortYears: 25 },
        { id: 'evs', assetId: 're_buy_test', type: 'sell', year: añoVenta }
      ];
      applyStateObject(JSON.parse(JSON.stringify(conEventos)));
      runSimulation();

      const svcCon = {}, deudaCon = {}, projNW = {};
      Object.values(annualReportsData).forEach(d => {
        svcCon[d.year] = d.debtService; deudaCon[d.year] = d.endDebt; projNW[d.year] = d.endRealNW;
      });

      // Los datos de ejemplo ya traen una hipoteca, así que lo que interesa es lo que AÑADE la
      // compra: el mismo plan sin eventos da la línea base de la que restar.
      const sinEventos = JSON.parse(JSON.stringify(conEventos));
      sinEventos.realEstateEvents = [];
      applyStateObject(sinEventos);
      runSimulation();
      const svcSin = {}, deudaSin = {};
      Object.values(annualReportsData).forEach(d => { svcSin[d.year] = d.debtService; deudaSin[d.year] = d.endDebt; });
      const svc = {}, deuda = {};
      Object.keys(svcCon).forEach(y => { svc[y] = svcCon[y] - (svcSin[y] || 0); deuda[y] = deudaCon[y] - (deudaSin[y] || 0); });

      // Vuelta al plan con eventos para lo que sigue.
      applyStateObject(JSON.parse(JSON.stringify(conEventos)));
      runSimulation();

      // La cuota francesa que le corresponde a esa hipoteca, en euros del año de la compra.
      const inflInm = readSimParams().propertyInflation;
      const principal = 300000 * Math.pow(1 + inflInm, 5) * 0.80;
      const cuotaAnual = annuityPayment(principal, 3.5, 25 * 12) * 12;

      // Y lo mismo visto por el optimizador, año a año.
      const optNW = {};
      evaluateRetirementSafety(A1, A2, { collect: true }).series.forEach(p => { optNW[p.year] = p.realNW; });
      const peorDesvio = Object.keys(optNW).map(Number)
        .filter(y => projNW[y] !== undefined)
        .reduce((m, y) => { const d = Math.abs(projNW[y] - optNW[y]); return d > m.d ? { d, y } : m; }, { d: 0, y: null });

      // 4. Un año con destino "pensions" (opción del desplegable de déficit) que resulta tener
      // excedente: el dinero tiene que acabar en el destino por defecto, no evaporarse.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      runSimulation();
      const añoRuta = Object.values(annualReportsData)
        .filter(d => d.investableAvailable > 1000).map(d => d.year).sort((a, b) => a - b)[0];
      const conRuta = JSON.parse(JSON.stringify(base));
      conRuta.customYearlyRouting = { [añoRuta]: 'pensions' };
      applyStateObject(JSON.parse(JSON.stringify(conRuta)));
      runSimulation();
      const rutaProj = annualReportsData[añoRuta];
      const rutaOpt = evaluateRetirementSafety(A1, A2, { collect: true }).series.find(p => p.year === añoRuta);

      // El mismo plan sin la ruta forzada: si el destino se normaliza al de por defecto, la
      // proyección tiene que dar exactamente lo mismo.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      runSimulation();
      const sinRuta = annualReportsData[añoRuta];

      // 5. Vender el piso ALQUILADO de hoy: desde la venta deja de amortizarse en el IRPF. La
      // proyección seguía deduciendo su amortización para siempre y los motores se separaban
      // unos euros al año, hasta discrepar en el año de quiebra (fuzzer, semilla 700572).
      const ventaAlquilado = JSON.parse(JSON.stringify(base));
      const alquilado = ventaAlquilado.assetsData.find(a => a.category === 'real_estate' && a.useType === 'rented');
      // Hace falta otro piso alquilado que siga en cartera: sin renta que reducir, una
      // amortización de más no cambia nada y la prueba no vería el fallo.
      ventaAlquilado.assetsData.push({ ...alquilado, id: 're_otro', name: 'Otro alquilado' });
      ventaAlquilado.realEstateEvents = [{ id: 'eva', assetId: alquilado.id, type: 'sell', year: START_YEAR + 4 }];
      applyStateObject(JSON.parse(JSON.stringify(ventaAlquilado)));
      runSimulation();
      const optVenta = {};
      evaluateRetirementSafety(A1, A2, { collect: true }).series.forEach(p => { optVenta[p.year] = p.realNW; });
      const desvioVenta = Object.keys(optVenta).map(Number).filter(y => annualReportsData[y])
        .reduce((m, y) => { const d = Math.abs(annualReportsData[y].endRealNW - optVenta[y]); return d > m.d ? { d, y } : m; }, { d: 0, y: null });

      applyStateObject(base); runSimulation();
      return { desvioVenta,
        añoCompra, añoVenta,
        svcCompra: svc[añoCompra], svcSiguiente: svc[añoCompra + 1],
        svcVenta: svc[añoVenta], svcPrevio: svc[añoVenta - 1],
        deudaVenta: deuda[añoVenta], deudaPrevia: deuda[añoVenta - 1],
        cuotaAnual, peorDesvio,
        rutaExcedente: rutaProj ? rutaProj.investableAvailable : null,
        rutaNWProj: rutaProj ? rutaProj.endRealNW : null,
        rutaNWOpt: rutaOpt ? rutaOpt.realNW : null,
        sinRutaNW: sinRuta ? sinRuta.endRealNW : null
      };
    });

    // 1. El año de la compra no paga ni un céntimo de hipoteca: empieza en enero del siguiente.
    assert(Math.abs(r.svcCompra) < 0.01,
      `en ${r.añoCompra} se compra y la hipoteca arranca en enero de ${r.añoCompra + 1}: no puede añadir servicio de deuda, y añade ${r.svcCompra}`);
    // 2. El año siguiente paga la cuota francesa entera, intereses incluidos.
    near(r.svcSiguiente, r.cuotaAnual, r.cuotaAnual * 0.02,
      `en ${r.añoCompra + 1} debería pagar la cuota anual completa`);
    // 3. El año de la venta sí paga sus cuotas -se vende en diciembre- y cierra sin la hipoteca.
    assert(r.svcVenta > 0, `el año de la venta (${r.añoVenta}) tiene que pagar sus cuotas, no ${r.svcVenta}`);
    near(r.svcVenta, r.svcPrevio, Math.max(1, Math.abs(r.svcPrevio) * 0.001),
      `el año de la venta paga lo mismo que el anterior`);
    assert(Math.abs(r.deudaVenta) < 1 && r.deudaPrevia > 1000,
      `tras la venta de ${r.añoVenta} la hipoteca del piso tiene que desaparecer: ${Math.round(r.deudaPrevia)} → ${Math.round(r.deudaVenta)}`);
    // 4. Y los dos motores cuentan la misma historia en todo el recorrido.
    assert(r.peorDesvio.d < 1000,
      `los dos motores se separan ${Math.round(r.peorDesvio.d)} € en ${r.peorDesvio.y} con una compra y una venta programadas`);
    // 5. Un destino de excedente que no existe se normaliza al de por defecto en los dos motores.
    assert(r.rutaExcedente > 0, 'el año de la prueba de enrutamiento debería tener excedente');
    near(r.rutaNWProj, r.sinRutaNW, 1e-6,
      `un destino no reconocido ('pensions') tiene que caer en el de por defecto`);
    near(r.rutaNWProj, r.rutaNWOpt, 1,
      `los dos motores resuelven distinto un destino de excedente no reconocido`);
    // 6. Tras vender un piso alquilado, los dos motores siguen contando lo mismo.
    assert(r.desvioVenta.d < 1,
      `tras vender el piso alquilado los motores se separan ${Math.round(r.desvioVenta.d)} € en ${r.desvioVenta.y}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `compra ${r.añoCompra} sin cuota · ${r.añoCompra + 1} paga ${Math.round(r.cuotaAnual)} € · venta ${r.añoVenta} paga y cancela · motores a ${Math.round(r.peorDesvio.d)} €`;
  } finally { await browser.close(); }
}
