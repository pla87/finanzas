// Calibración de Monte Carlo: las sacudidas estandarizadas tienen media 0, desviación
// exactamente 1, colas más gruesas que una normal y están recortadas; la misma semilla da los
// mismos caminos; volatilidad cero reproduce la proyección determinista; la volatilidad
// realizada es la pedida; y la mediana del multiplicador acumulado converge a (1+r)^n según la
// raíz de n, que es lo que distingue error de muestreo de sesgo.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const rBase = numParam('stockGrowthParam', 6.0) / 100;
      const Z = mcStandardShocks(2000, 63, MC_SEED);
      const flat = []; Z.forEach(row => row.forEach(v => flat.push(v)));
      const n = flat.length;
      const mean = flat.reduce((a, b) => a + b, 0) / n;
      const varr = flat.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
      const m4 = flat.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
      let mn = Infinity, mx = -Infinity;
      for (const v of flat) { if (v < mn) mn = v; if (v > mx) mx = v; }

      const same = JSON.stringify(Array.from(mcStandardShocks(5, 10, MC_SEED)[0])) === JSON.stringify(Array.from(mcStandardShocks(5, 10, MC_SEED)[0]));
      const diff = JSON.stringify(Array.from(mcStandardShocks(5, 10, MC_SEED)[0])) !== JSON.stringify(Array.from(mcStandardShocks(5, 10, MC_SEED + 1)[0]));

      const det = evaluateRetirementSafety(63, 60, { collect: true });
      const zero = evaluateRetirementSafety(63, 60, { collect: true, rateOverrides: mcPathOverrides(Z[0], 0, 63) });
      const sigmaZero = JSON.stringify(det.series) === JSON.stringify(zero.series);

      const realised = (sigma) => {
        const logs = []; Z.forEach(row => { for (let i = 0; i < 63; i++) logs.push(Math.log(1 + rBase) + sigma * row[i]); });
        const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
        return Math.sqrt(logs.reduce((a, b) => a + (b - mu) ** 2, 0) / (logs.length - 1));
      };

      const medDev = (nP, sigma, years) => {
        const Zc = mcStandardShocks(nP, years, MC_SEED);
        const ms = Zc.map(row => { let m = 1; for (let i = 0; i < years; i++) { const d = (1 + rBase) * Math.exp(sigma * row[i]) - 1 - rBase; m *= (1 + rBase + d); } return m; }).sort((a, b) => a - b);
        return Math.abs(ms[Math.floor(ms.length / 2)] / Math.pow(1 + rBase, years) - 1);
      };
      // Reversión a la media: apagada devuelve la misma matriz; encendida conserva varianza 1 y
      // media 0 año a año, tiene autocorrelación a un año ≈ φ, reduce la varianza de la suma a
      // 20 años hacia (1+φ)/(1−φ) y no mueve la mediana del multiplicador acumulado.
      const phi = MC_MEAN_REVERSION_PHI;
      const R = mcMeanRevert(Z, phi);
      const offIsSame = mcMeanRevert(Z, 0) === Z;
      const flatR = []; R.forEach(row => row.forEach(v => flatR.push(v)));
      const meanR = flatR.reduce((a, b) => a + b, 0) / flatR.length;
      const sdR = Math.sqrt(flatR.reduce((a, b) => a + (b - meanR) ** 2, 0) / (flatR.length - 1));
      let cov = 0, cnt = 0;
      R.forEach(row => { for (let y = 1; y < row.length; y++) { cov += row[y] * row[y - 1]; cnt++; } });
      const lag1 = cov / cnt / (sdR * sdR);
      const sumVar = (M) => { const s = M.map(row => { let t = 0; for (let y = 0; y < 20; y++) t += row[y]; return t; }); const mu = s.reduce((a, b) => a + b, 0) / s.length; return s.reduce((a, b) => a + (b - mu) ** 2, 0) / (s.length - 1); };
      const varRatio20 = sumVar(R) / sumVar(Z);
      const medDevR = (() => {
        const ms = R.map(row => { let m = 1; for (let i = 0; i < 30; i++) m *= (1 + rBase) * Math.exp(0.18 * row[i]); return m; }).sort((a, b) => a - b);
        return Math.abs(ms[Math.floor(ms.length / 2)] / Math.pow(1 + rBase, 30) - 1);
      })();
      return {
        n, mean, sd: Math.sqrt(varr), kurt: m4 / varr ** 2, mn, mx, clamp: MC_SHOCK_CLAMP,
        same, diff, sigmaZero,
        sig18: realised(0.18), sig30: realised(0.30),
        dev2000: medDev(2000, 0.18, 30), dev8000: medDev(8000, 0.18, 30),
        portfolioSigma: mcPortfolioSigma(),
        mr: { phi, offIsSame, meanR, sdR, lag1, varRatio20, expectedRatio: (1 + phi) / (1 - phi), medDevR }
      };
    });
    near(r.mean, 0, 0.02, 'media de las sacudidas');
    near(r.sd, 1, 1e-6, 'desviación de las sacudidas');
    assert(r.kurt > 3.5, `curtosis ${r.kurt.toFixed(2)}: las colas no son más gruesas que una normal`);
    assert(Math.abs(r.mn) <= r.clamp + 0.2 && Math.abs(r.mx) <= r.clamp + 0.2, `recorte: min ${r.mn.toFixed(2)} max ${r.mx.toFixed(2)}`);
    assert(r.same, 'la misma semilla no reproduce los mismos caminos');
    assert(r.diff, 'semillas distintas dan los mismos caminos');
    assert(r.sigmaZero, 'volatilidad cero no reproduce la serie determinista');
    near(r.sig18, 0.18, 0.005, 'volatilidad realizada a 18%');
    near(r.sig30, 0.30, 0.008, 'volatilidad realizada a 30%');
    // Error de muestreo de la mediana ≈ 1,25·σ√n/√N: a 8.000 caminos y 30 años, ~1,4%.
    assert(r.dev8000 < 0.04, `desvío de la mediana a 8.000 caminos: ${(100 * r.dev8000).toFixed(2)}%`);
    assert(r.dev8000 <= r.dev2000 * 1.5 + 0.005, `la mediana no converge: ${(100 * r.dev2000).toFixed(2)}% → ${(100 * r.dev8000).toFixed(2)}%`);
    assert(r.portfolioSigma.sigma > 0.05 && r.portfolioSigma.sigma < 0.35, 'sigma deducida de la cartera fuera de rango');
    const m = r.mr;
    assert(m.phi < 0 && m.phi > -0.5, `φ de reversión fuera de lo razonable: ${m.phi}`);
    assert(m.offIsSame, 'mcMeanRevert con φ=0 no devuelve la misma matriz');
    near(m.meanR, 0, 0.02, 'media con reversión');
    near(m.sdR, 1, 0.02, 'desviación año a año con reversión');
    near(m.lag1, m.phi, 0.02, 'autocorrelación a un año con reversión');
    near(m.varRatio20, m.expectedRatio, 0.08, 'ratio de varianza a 20 años con reversión');
    assert(m.medDevR < 0.05, `la reversión mueve la mediana del multiplicador: ${(100 * m.medDevR).toFixed(2)}%`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `sd ${r.sd.toFixed(4)} · curtosis ${r.kurt.toFixed(1)} · recorte ±${Math.abs(r.mn).toFixed(2)} · mediana ${(100 * r.dev8000).toFixed(2)}% a 8k · reversión: lag1 ${m.lag1.toFixed(2)}, varianza 20a ×${m.varRatio20.toFixed(2)}`;
  } finally { await browser.close(); }
}
