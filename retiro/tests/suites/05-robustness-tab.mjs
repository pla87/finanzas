// La pestaña Robustez de punta a punta: se abre calculada, cambia de escenario, respeta la
// edad de medida, invalida el análisis cuando cambian los datos, y el sorteo de Monte Carlo
// corre entero, marca caducidad al mover el deslizador y pinta la tabla de defensas y la
// matriz. También el indicador de la caja de retiro seguro en sus tres estados.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const a = await page.evaluate(() => {
      openRobustnessTab();
      const tab = document.getElementById('robustnessTab');
      return {
        visible: !tab.classList.contains('hidden'),
        otras: [...document.querySelectorAll('.tab-content')].filter(e => e.id !== 'robustnessTab' && !e.classList.contains('hidden')).length,
        chips: document.querySelectorAll('#robScenarioChips button').length,
        pathsDatasets: robPathsChartInstance.data.datasets.length,
        timingType: robTimingChartInstance.config.type,
        timingBars: robTimingChartInstance.data.labels.length,
        delayRows: document.querySelectorAll('#robDelayBody tr').length,
        headline: document.getElementById('robDelayHeadline').innerText.trim().length,
        analysis: !!robLastAnalysis,
        horizon: robustnessHorizonAge()
      };
    });
    assert(a.visible && a.otras === 0, 'la pestaña no se muestra sola');
    assert(a.chips === 6, `${a.chips} escenarios, se esperaban 6`);
    // Sin crisis más las cinco de mercado: el plan de ejemplo no tiene deudas variables, así que
    // la subida del euríbor no se pinta (sería idéntica a la de sin crisis).
    assert(a.pathsDatasets === 6, `${a.pathsDatasets} series en el gráfico de trayectorias, se esperaban 6`);
    assert(a.timingType === 'bar', `el gráfico de crisis por año es ${a.timingType}, no barras`);
    assert(a.timingBars > 5 && a.delayRows >= 1 && a.headline > 20 && a.analysis, 'bloques deterministas incompletos');
    assert(a.horizon === 65, `edad de medida por defecto ${a.horizon}, se esperaba 65`);

    // La tabla de "¿cuánto compra trabajar unos años más?" va de año en año, salvo con un retiro
    // temprano en el que nueve años más no llegan a compensar la crisis: ahí los escalones son de
    // dos años, para que la tabla alcance el punto de equilibrio en vez de morir diciendo "ni
    // trabajando hasta los 45".
    const paso = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(buildStateObject()));
      const edadesCon = (edadP1, retiro) => {
        const s = JSON.parse(JSON.stringify(base));
        s.careers[1].age = edadP1; s.careers[2].age = edadP1 - 3;
        s.macro.retireAgeP1 = retiro; s.macro.retireAgeP2 = retiro - 3;
        applyStateObject(s); runSimulation(); openRobustnessTab();
        return [...document.querySelectorAll('#robDelayBody tr')]
          .map(tr => parseInt(tr.querySelectorAll('td')[0].innerText, 10));
      };
      const temprano = edadesCon(38, 44);   // < 45 y sin compensar: escalones de dos
      const tardio = edadesCon(38, 46);     // >= 45: escalones de uno
      applyStateObject(base); runSimulation(); openRobustnessTab();
      return { temprano, tardio };
    });
    const salto = (v) => v.length > 1 ? v[1] - v[0] : 0;
    assert(salto(paso.temprano) === 2, `con retiro a los 44 los escalones deberían ser de dos años: ${paso.temprano.join(' ')}`);
    assert(salto(paso.tardio) === 1, `con retiro a los 46 los escalones deberían ser de un año: ${paso.tardio.join(' ')}`);
    assert(paso.temprano[paso.temprano.length - 1] > paso.tardio[paso.tardio.length - 1],
      `la tabla del retiro temprano debería llegar más lejos: ${paso.temprano.at(-1)} vs ${paso.tardio.at(-1)}`);

    const b = await page.evaluate(() => {
      const barsAt65 = robTimingChartInstance.data.labels.length;
      document.getElementById('robHorizonInput').value = '85'; onRobHorizonInput();
      const barsAt85 = robTimingChartInstance.data.labels.length;
      const label85 = [...document.querySelectorAll('.robHorizonAge')].every(e => e.innerText === '85');
      document.getElementById('robHorizonInput').value = '10'; onRobHorizonInput();
      const clampedLow = robustnessHorizonAge();
      document.getElementById('robHorizonInput').value = '65'; onRobHorizonInput();
      selectStressScenario('stagflation');
      const activeChip = [...document.querySelectorAll('#robScenarioChips button')].filter(x => x.className.includes('bg-brand-accent/15')).length;
      // Con la pestaña cerrada, tocar un dato anula el análisis guardado.
      switchTab('cashflowTab', null);
      document.getElementById('retireAge').value = 56; runSimulation();
      const invalidated = robLastAnalysis === null;
      document.getElementById('retireAge').value = 55; runSimulation();
      openRobustnessTab();
      return { barsAt65, barsAt85, label85, clampedLow, activeChip, invalidated, p1: parseInt(document.getElementById('p1_age').value) };
    });
    assert(b.barsAt85 < b.barsAt65 || b.barsAt85 > 0, 'el gráfico de crisis no sigue la edad de medida');
    assert(b.label85, 'las etiquetas de la edad de medida no se actualizan');
    assert(b.clampedLow === b.p1 + 1, `edad de medida 10 no se acota a ${b.p1 + 1}: ${b.clampedLow}`);
    assert(b.activeChip === 1, 'el chip del escenario elegido no se resalta');
    assert(b.invalidated, 'cambiar datos con la pestaña cerrada no anula robLastAnalysis');

    const ind = await page.evaluate(() => {
      const read = () => document.getElementById('kpiRobustnessText').innerText.trim();
      const out = {};
      updateRobustnessIndicator({ ageP1: 50, ageP2: 47 }); out.rojo = read();
      updateRobustnessIndicator({ ageP1: 62, ageP2: 59 }); out.verde = read();
      updateRobustnessIndicator(null); out.oculto = read();
      runSimulation();
      return out;
    });
    assert(ind.rojo.startsWith('🔴'), `indicador a 50/47 debería ser rojo: ${ind.rojo}`);
    assert(ind.verde.startsWith('🟢'), `indicador a 62/59 debería ser verde: ${ind.verde}`);
    assert(ind.oculto === '', 'el indicador oculto conserva texto');

    const mc = await page.evaluate(async () => {
      openRobustnessTab();
      document.getElementById('mcSigma').value = '18'; onMcSigmaInput();
      // Sorteo acortado: aquí se prueba la interfaz, no la precisión; 10-worker cubre el cálculo.
      const t0 = performance.now();
      await runMonteCarlo({ paths: 300, defencePaths: 150, matrixPaths: 60 });
      const ms = Math.round(performance.now() - t0);
      const r = mcLastResult;
      const out = {
        ms, visible: !document.getElementById('mcResults').classList.contains('hidden'),
        paths: r.nPaths, success: r.successRate, ciOk: r.ci.lo <= r.successRate && r.successRate <= r.ci.hi,
        years: r.years.length, bands: Object.keys(r.bands).length,
        fanDatasets: mcFanChartInstance.data.datasets.length, fanScale: mcFanChartInstance.options.scales.y.type,
        matrixRows: r.matrix.length, matrixCols: r.matrixSigmas.length,
        defences: r.defenceRuns.length, defenceRows: document.querySelectorAll('#mcDefenceBody tr').length,
        p10leP50: r.bands.p10[r.hIdx] <= r.bands.p50[r.hIdx] && r.bands.p50[r.hIdx] <= r.bands.p90[r.hIdx]
      };
      document.getElementById('mcSigma').value = '25'; onMcSigmaInput();
      out.staleShown = !document.getElementById('mcStaleWarning').classList.contains('hidden');
      document.getElementById('mcSigma').value = '18'; onMcSigmaInput();
      out.staleHidden = document.getElementById('mcStaleWarning').classList.contains('hidden');
      const again = JSON.stringify(mcLastResult.bands.p50.slice(0, 5));
      await runMonteCarlo({ paths: 300, defencePaths: 150, matrixPaths: 60 });
      out.reproducible = again === JSON.stringify(mcLastResult.bands.p50.slice(0, 5));

      // Reversión a la media: marcar la casilla caduca el resultado; el nuevo sorteo la registra,
      // lo dice en el titular y estrecha el abanico a largo plazo sin tocar la mediana apenas.
      const iid = mcLastResult;
      const cb = document.getElementById('mcMeanRev');
      cb.checked = true; onMcSigmaInput();
      out.mrStale = !document.getElementById('mcStaleWarning').classList.contains('hidden');
      await runMonteCarlo({ paths: 300, defencePaths: 150, matrixPaths: 60 });
      const mr = mcLastResult;
      const last = mr.years.length - 1;
      out.mrPhi = mr.phi;
      out.mrHeadline = document.getElementById('mcHeadline').innerText.includes('reversión a la media');
      out.mrSpreadIid = Math.log(iid.bands.p90[last] / Math.max(1, iid.bands.p10[last]));
      out.mrSpread = Math.log(mr.bands.p90[last] / Math.max(1, mr.bands.p10[last]));
      out.mrMedianShift = Math.abs(mr.bands.p50[last] / iid.bands.p50[last] - 1);
      cb.checked = false; onMcSigmaInput();
      out.mrStaleBack = !document.getElementById('mcStaleWarning').classList.contains('hidden');
      return out;
    });
    assert(mc.visible && mc.paths === 300 && mc.years > 20 && mc.bands === 5, 'el sorteo no produjo resultados completos');
    assert(mc.ciOk && mc.p10leP50, 'percentiles o intervalo incoherentes');
    assert(mc.fanDatasets === 5 && (mc.fanScale === 'logarithmic' || mc.fanScale === 'linear'), 'abanico mal construido');
    assert(mc.matrixRows >= 1 && mc.matrixCols === 5, 'matriz incompleta');
    assert(mc.defences === 4 && mc.defenceRows === 5, `defensas: ${mc.defences} calculadas, ${mc.defenceRows} filas`);
    assert(mc.staleShown && mc.staleHidden, 'el aviso de caducidad no sigue al deslizador');
    assert(mc.reproducible, 'dos sorteos con la misma semilla difieren');
    assert(mc.mrStale && mc.mrStaleBack, 'la casilla de reversión a la media no caduca el resultado');
    assert(mc.mrPhi < 0 && mc.mrHeadline, `el sorteo con reversión no la registra (φ=${mc.mrPhi}, titular ${mc.mrHeadline})`);
    assert(mc.mrSpread < mc.mrSpreadIid, `la reversión no estrecha el abanico final: ${mc.mrSpread.toFixed(2)} vs ${mc.mrSpreadIid.toFixed(2)} (log p90/p10)`);
    assert(mc.mrMedianShift < 0.25, `la reversión mueve demasiado la mediana final: ${(100 * mc.mrMedianShift).toFixed(0)}%`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `sorteo de ${mc.paths} caminos en ${(mc.ms / 1000).toFixed(1)}s · éxito ${(100 * mc.success).toFixed(1)}% · reversión estrecha el abanico ${mc.mrSpreadIid.toFixed(2)}→${mc.mrSpread.toFixed(2)}`;
  } finally { await browser.close(); }
}
