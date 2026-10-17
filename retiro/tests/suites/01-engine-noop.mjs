// El tercer argumento del motor optimizador (trayectoria de tipos, recogida de la serie,
// defensas) tiene que ser un no-op exacto cuando está apagado, y nada de la pestaña Robustez
// puede tocar la proyección determinista. Es la garantía sobre la que descansa todo lo demás.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const nY = 63;
      const Z = mcStandardShocks(3, nY, MC_SEED);
      const key = (x) => JSON.stringify([x.passAll, x.realGrowth.minRate, x.realGrowth.failYear, x.solvency.failYear, x.ruin.pass, x.ruin.failYear, x.series]);
      const diffs = [];
      let pairs = 0;
      for (let a1 = 40; a1 <= 70; a1 += 3) {
        for (let a2 = 37; a2 <= 67; a2 += 6) {
          pairs++;
          const base = key(evaluateRetirementSafety(a1, a2, { collect: true }));
          const variants = {
            'sin opts (collect aparte)': key({ ...evaluateRetirementSafety(a1, a2), series: JSON.parse(base)[6] }),
            'rateOverrides vacío': key(evaluateRetirementSafety(a1, a2, { collect: true, rateOverrides: [] })),
            'defence vacío': key(evaluateRetirementSafety(a1, a2, { collect: true, defence: {} })),
            'sigma cero': key(evaluateRetirementSafety(a1, a2, { collect: true, rateOverrides: mcPathOverrides(Z[0], 0, nY) })),
            'flex sin activar (calma)': key(evaluateRetirementSafety(a1, a2, { collect: true, defence: { flex: { returnBelow: -0.99, cut: 0.10 } } }))
          };
          for (const [name, v] of Object.entries(variants)) if (v !== base) diffs.push(`${a1}/${a2} ${name}`);
        }
      }
      const s1 = calculateSimultaneousRetirement();
      const s2 = calculateSimultaneousRetirement({});
      const optSame = JSON.stringify(s1) === JSON.stringify(s2);

      // La proyección determinista no cambia por usar la pestaña Robustez.
      // textContent y no innerText: el segundo se toma con la pestaña oculta, y en un subárbol
      // con display:none innerText incluye texto que en pantalla no se ve. Aquí se compara el
      // contenido, no el render.
      const tableBefore = document.getElementById('cashflowTableBody').textContent;
      openRobustnessTab();
      selectStressScenario('stagflation');
      runSimulation();
      const tableAfter = document.getElementById('cashflowTableBody').textContent;
      return { pairs, diffs, optSame, tableSame: tableBefore === tableAfter, safe: s1.simul };
    });
    assert(r.diffs.length === 0, `variantes que no son no-op: ${r.diffs.slice(0, 5).join('; ')}`);
    assert(r.optSame, 'calculateSimultaneousRetirement({}) difiere de sin argumentos');
    assert(r.tableSame, 'la tabla de cash flow cambió tras usar la pestaña Robustez');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `${r.pairs} pares × 5 variantes idénticas · edad segura ${r.safe ? r.safe.ageP1 + '/' + r.safe.ageP2 : 'ninguna'}`;
  } finally { await browser.close(); }
}
