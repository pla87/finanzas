// El suelo como uso propio de un inmueble (`useType: 'land'`), compartido con
// pacolucena.com/balance. Un solar o una finca no es un piso vacío: no se deprecia, no paga el
// mantenimiento del 0,6 %, no da alquiler ni uso, y su valor sigue a la inflación, no al mercado
// de la vivienda. Para que eso se vea, el plan de prueba desacopla la revalorización inmobiliaria
// (5 %) de la inflación (2 %): con las dos acopladas, como vienen por defecto, darían lo mismo.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const clon = (o) => JSON.parse(JSON.stringify(o));
      const base = clon(buildStateObject());
      base.macro.inflation = 2;
      base.macro.propertyInflation = 5;
      base.macro.propertyInflationCoupled = false;
      const A1 = Number(base.macro.retireAgeP1), A2 = Number(base.macro.retireAgeP2);

      const finca = { id: 'suelo1', name: 'Finca', category: 'real_estate', owner: 'joint', currency: 'EUR',
        value: 100000, purchasePrice: 60000, monthlyRent: 0, useType: 'land',
        cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 2, opexPct: 0, hasMaint: false };
      // Un solar comprado dentro de cuatro años, al contado, para ver que la compra también lo
      // valora con la inflación.
      const añoCompra = START_YEAR + 4;
      const compra = { id: 'evl', assetId: 're_buy_suelo', type: 'buy', year: añoCompra, name: 'Solar',
        useType: 'land', owner: 'joint', priceTodayEUR: 50000, rentTodayEUR: 0,
        opexPct: 0, downPct: 100, expPct: 10, hasMort: false, mortRate: 0, mortYears: 0 };

      const correr = (plan) => {
        applyStateObject(clon(plan));
        runSimulation();
        const filas = {};
        Object.values(annualReportsData).forEach(d => { filas[d.year] = d; });
        const opt = {};
        evaluateRetirementSafety(A1, A2, { collect: true }).series.forEach(p => { opt[p.year] = p.realNW; });
        return { filas, opt };
      };

      const sin = correr(base);
      const conSuelo = clon(base); conSuelo.assetsData.push(finca);
      const suelo = correr(conSuelo);
      const conVacio = clon(base); conVacio.assetsData.push({ ...finca, id: 'vacio1', useType: 'vacant', hasMaint: true, capitalReturnPct: 5 });
      const vacio = correr(conVacio);
      const conCompra = clon(conSuelo); conCompra.realEstateEvents = [compra];
      const compraR = correr(conCompra);

      // Valor de la finca al cierre de cada año: lo que añade al inmobiliario frente al plan sin ella.
      const años = Object.keys(sin.filas).map(Number).sort((a, b) => a - b);
      let acumulado = 100000;
      const valorFinca = {};
      años.forEach(y => { acumulado += suelo.filas[y].diffRE - sin.filas[y].diffRE; valorFinca[y] = acumulado; });
      const y10 = START_YEAR + 10;

      // Lo que la compra del solar añade al inmobiliario el año en que se compra.
      const añadeCompra = compraR.filas[añoCompra].diffRE - suelo.filas[añoCompra].diffRE;

      // Los dos motores cuentan lo mismo, año a año, con la finca y con la compra.
      const desvio = (x) => años
        .filter(y => x.opt[y] !== undefined && sin.opt[y] !== undefined)
        .reduce((m, y) => {
          const d = Math.abs((x.filas[y].endRealNW - sin.filas[y].endRealNW) - (x.opt[y] - sin.opt[y]));
          return d > m.d ? { d, y } : m;
        }, { d: 0, y: null });

      // Ida y vuelta por el fichero: el uso viaja tal cual.
      applyStateObject(clon(conSuelo));
      const vuelta = clon(buildStateObject());
      applyStateObject(clon(vuelta));
      const usoTrasVuelta = assetsData.find(a => a.id === 'suelo1')?.useType;

      // El formulario: elegir «Suelo» oculta el alquiler y deja el capital en la inflación.
      openAddAssetModal();
      document.getElementById('modalAssetCategory').value = 'real_estate';
      toggleAssetModalFields();
      document.getElementById('modalAssetUseType').value = 'land';
      handleUseTypeChange();
      const modal = {
        alquilerOculto: document.getElementById('reRentField').classList.contains('hidden'),
        mantenimientoOculto: document.getElementById('reVacantMaintField').classList.contains('hidden'),
        capital: Number(document.getElementById('modalAssetCapReturn').value),
        efectivo: Number(document.getElementById('modalAssetCashReturn').value)
      };
      closeAssetModal();

      applyStateObject(clon(base)); runSimulation();
      return {
        y10, valorY10: valorFinca[y10], yearFrac0: getRemainingYearFraction(),
        salidasSuelo: suelo.filas[START_YEAR + 1].totalOutflows, salidasSin: sin.filas[START_YEAR + 1].totalOutflows,
        salidasVacio: vacio.filas[START_YEAR + 1].totalOutflows,
        entradasSuelo: suelo.filas[START_YEAR + 1].totalInflows, entradasSin: sin.filas[START_YEAR + 1].totalInflows,
        añoCompra, añadeCompra,
        desvioSuelo: desvio(suelo), desvioCompra: desvio(compraR),
        usoTrasVuelta, modal
      };
    });

    // 1. Sigue a la inflación (2 %), no a la vivienda (5 %).
    const esperado = 100000 * Math.pow(1.02, r.yearFrac0 + 10);
    near(r.valorY10, esperado, 1, `la finca en ${r.y10} debería valer lo que da la inflación`);
    assert(r.valorY10 < 100000 * Math.pow(1.05, r.yearFrac0 + 10) - 10000, 'la finca no puede seguir a la vivienda');
    // 2. Ni mantenimiento ni alquiler: no mueve un euro de caja. Un vacío con mantenimiento sí.
    near(r.salidasSuelo, r.salidasSin, 0.01, 'el suelo no paga mantenimiento');
    near(r.entradasSuelo, r.entradasSin, 0.01, 'el suelo no da renta');
    assert(r.salidasVacio > r.salidasSin + 100, `un vacío con mantenimiento sí paga: ${r.salidasVacio} frente a ${r.salidasSin}`);
    // 3. Una compra de suelo se valora con la inflación hasta el año de la compra.
    near(r.añadeCompra, 50000 * Math.pow(1.02, r.añoCompra - (r.añoCompra - 4)), 1, `el solar comprado en ${r.añoCompra}`);
    // 4. Los dos motores cuentan lo mismo.
    assert(r.desvioSuelo.d < 1, `con la finca los motores se separan ${r.desvioSuelo.d} € en ${r.desvioSuelo.y}`);
    assert(r.desvioCompra.d < 1, `con la compra de suelo los motores se separan ${r.desvioCompra.d} € en ${r.desvioCompra.y}`);
    // 5. Viaja en el fichero.
    assert(r.usoTrasVuelta === 'land', `tras exportar e importar el uso es ${r.usoTrasVuelta}`);
    // 6. El formulario.
    assert(r.modal.alquilerOculto && r.modal.mantenimientoOculto, 'el suelo no pide alquiler ni mantenimiento');
    near(r.modal.capital, 2, 1e-9, 'el capital del suelo es la inflación');
    near(r.modal.efectivo, 0, 1e-9, 'el suelo no rinde en efectivo');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `finca a ${Math.round(r.valorY10)} € en ${r.y10} (inflación, no vivienda) · sin mantenimiento ni renta · compra a ${Math.round(r.añadeCompra)} € · motores a ${r.desvioSuelo.d.toFixed(2)} €`;
  } finally { await browser.close(); }
}
