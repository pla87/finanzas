// Inmuebles y alquileres en los escenarios y en el sorteo. Apagados son un no-op exacto; la
// crisis de 2008 con vivienda cuesta más patrimonio que la misma crisis sólo en bolsa; los
// alquileres siguen al precio; la deuda no se toca; y en el sorteo la vivienda abre el abanico
// sin mover la mediana de su propio índice.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const A1 = 55, A2 = 52, P1 = parseInt(document.getElementById('p1_age').value);
      const idx = A1 - P1;
      const at = (res, age = 65) => (res.series.find(p => p.ageP1 >= age) || res.series.at(-1)).realNW;
      const key = (x) => JSON.stringify([x.realGrowth.minRate, x.series]);

      // No-op exacto: overrides de vivienda vacíos o con sacudida cero.
      const base = evaluateRetirementSafety(A1, A2, { collect: true });
      const zeroProp = [];
      for (let k = 0; k < 70; k++) zeroProp[k] = { propertyLogShock: 0, rentLogShock: 0 };
      const same = key(base) === key(evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: zeroProp }));
      // Y un escenario sólo de bolsa no toca los inmuebles: con o sin las claves prop/rent
      // ausentes debe dar lo mismo.
      const crashOnly = buildStressPath(stressScenarioById('crash35'), idx);
      const crashKeys = crashOnly.filter(Boolean).some(o => 'propertyReturn' in o || 'rentReturn' in o);

      // 2008 con vivienda frente a 2008 sólo bolsa.
      const gfc = stressScenarioById('gfc2008');
      const gfcFull = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: buildStressPath(gfc, idx) });
      const equityOnly = buildStressPath({ years: gfc.years.map(y => ({ ret: y.ret })).filter(y => y.ret !== undefined) }, idx);
      const gfcEq = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: equityOnly });

      // La vivienda vale menos justo tras la crisis, y la deuda es la misma.
      const yrAfter = START_YEAR + idx + 4;
      const ptFull = gfcFull.series.find(p => p.year === yrAfter), ptBase = base.series.find(p => p.year === yrAfter);

      // Sorteo: con vivienda el abanico es más ancho; el índice de vivienda tiene mediana ~1.
      const Z = mcStandardShocks(400, 63, MC_SEED);
      const ZP = mcPropertyShocks(Z, 63, MC_SEED + 7919);
      const corr = (() => { let sxy = 0, sxx = 0, syy = 0, n = 0;
        for (let p = 0; p < 400; p++) for (let y = 0; y < 63; y++) { sxy += Z[p][y] * ZP[p][y]; sxx += Z[p][y] ** 2; syy += ZP[p][y] ** 2; n++; }
        return sxy / Math.sqrt(sxx * syy); })();
      const propMult = ZP.map(row => { let m = 1; for (let i = 0; i < 30; i++) m *= Math.exp(MC_SIGMA_PROPERTY * row[i]); return m; }).sort((a, b) => a - b);
      const propMedian = propMult[200];
      const spread = (withProp) => {
        const f = [];
        for (let p = 0; p < 150; p++) {
          const res = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: mcPathOverrides(Z[p], 0.18, 63, withProp ? ZP[p] : null) });
          f.push(at(res));
        }
        f.sort((a, b) => a - b);
        return { p10: f[15], p50: f[75], p90: f[135] };
      };
      const noProp = spread(false), withProp = spread(true);

      return {
        same, crashKeys,
        base65: at(base), gfcFull65: at(gfcFull), gfcEq65: at(gfcEq),
        nwAfter: ptFull ? ptFull.realNW : null, nwBaseAfter: ptBase ? ptBase.realNW : null,
        corr, propMedian,
        noProp, withProp
      };
    });
    assert(r.same, 'sacudidas de vivienda a cero no son un no-op');
    assert(!r.crashKeys, 'un escenario sólo de bolsa lleva claves de vivienda');
    assert(r.gfcFull65 < r.gfcEq65, `2008 con vivienda (${r.gfcFull65}) no cuesta más que sólo bolsa (${r.gfcEq65})`);
    assert(r.gfcEq65 < r.base65, 'la parte de bolsa de 2008 no cuesta nada');
    assert(r.nwAfter !== null && r.nwAfter < r.nwBaseAfter, 'el patrimonio no baja tras la caída de la vivienda');
    near(r.corr, 0.4, 0.05, 'correlación bolsa-vivienda');
    near(r.propMedian, 1, 0.08, 'mediana del índice de vivienda a 30 años');
    assert((r.withProp.p90 - r.withProp.p10) > (r.noProp.p90 - r.noProp.p10), 'la vivienda aleatoria no ensancha el abanico');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `2008: −${Math.round((r.base65 - r.gfcFull65) / 1000)}k con vivienda vs −${Math.round((r.base65 - r.gfcEq65) / 1000)}k sólo bolsa · ρ=${r.corr.toFixed(2)}`;
  } finally { await browser.close(); }
}
