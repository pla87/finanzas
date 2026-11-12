// Hay dos motores: runSimulation() (proyección con tablas) y evaluateRetirementSafety()
// (optimizador, sin DOM, usado por la edad segura, Robustez y Monte Carlo). Comparten los
// parámetros (readSimParams), el orden de desinversión y el rescate de pensiones, pero el bucle
// anual sigue escrito dos veces. Esta prueba obliga a que, para las mismas edades de retiro,
// los dos den el mismo veredicto de solvencia y el mismo año de quiebra en varios escenarios
// distintos, de modo que una divergencia futura salte aquí y no en la caja de edad segura.
//
// El veredicto y el año de quiebra son una vara gruesa: dos motores que se separan unos euros al año
// dan el mismo veredicto durante décadas. Por eso además se compara el patrimonio real de cada año
// de la proyección con el del optimizador. El ruido de fondo es de céntimos (redondeos); lo que se
// persigue es lo que crece, y se tolera como mucho 2 €.
const SCENARIOS = {
  'datos de ejemplo': () => {},
  'déficit desde caja': () => { document.getElementById('deficitDest').value = 'cash'; },
  'déficit por coste fiscal': () => { document.getElementById('deficitDest').value = 'taxOptimized'; },
  'gasto alto y retiro temprano': () => {
    familyExpenses.food = 900; document.getElementById('exp_food').value = 900;
    document.getElementById('retireAge').value = 50; document.getElementById('retireAgeP2').value = 47;
  },
  'gastos +40% retiro 45/43': () => {
    document.getElementById('expenseChangeParam').value = 40;
    document.getElementById('retireAge').value = 45; document.getElementById('retireAgeP2').value = 43;
  },
  'paro a mitad de carrera': () => {
    careers[1].stages[0].years = 2;
    careers[1].stages.splice(1, 0, { type: 'unemployed', company: 'Paro', years: 3, salary: 0, salaryIncCoupled: true });
  },
  'carrera autónoma': () => {
    careers[1].stages[0].type = 'freelance'; careers[1].stages[0].freelanceExpenses = 6000;
  },
  'sin pareja': () => { document.getElementById('exp_hasPartner').value = 'no'; togglePartnerAndRun(); },
  // Un plan con acciones de crecimiento que pagan dividendo propio (cashReturnPct > 0) y un inmueble
  // programado para venderse. Los datos de ejemplo traen RSUs, que entran en la cartera de
  // crecimiento el año que se entregan: el optimizador los sumaba ANTES de calcular qué parte de la
  // cartera sigue viva (de la que cuelga el dividendo) y la proyección DESPUÉS, así que el
  // optimizador cobraba de más dividendo -unos 35 € el primer año, y creciendo- desde entonces.
  'acciones de crecimiento con dividendo y venta programada': () => {
    assetsData.filter(a => a.category === 'stocks').forEach(a => { a.cashReturnPct = 2; });
    const alquilado = assetsData.find(a => a.category === 'real_estate' && a.useType === 'rented');
    realEstateEvents = [{ id: 'ev_venta_12', assetId: alquilado.id, type: 'sell', year: START_YEAR + 4 }];
  },
  'con renta fija y déficit desde ella': () => {
    assetsData.push({ id: 'bond_test', name: '(EJEMPLO) Fondo Renta Fija', category: 'bonds', owner: 'joint', currency: 'EUR', value: 150000 });
    document.getElementById('deficitDest').value = 'bonds';
    document.getElementById('retireAge').value = 50; document.getElementById('retireAgeP2').value = 47;
  },
};

export default async function run({ open, assert }) {
  const rows = [];
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate((fnSrc) => {
        (new Function('return ' + fnSrc))()();
        runSimulation();
        const solvText = document.getElementById('valCritSolvency').textContent;
        const yearMatch = solvText.match(/\b(20\d\d)\b/);
        const projection = {
          solvent: document.getElementById('badgeCritSolvency').textContent.includes('Solvente'),
          failYear: yearMatch ? Number(yearMatch[1]) : null
        };
        const rA = parseInt(document.getElementById('retireAge').value);
        const rB = parseInt(document.getElementById('retireAgeP2').value);
        const o = evaluateRetirementSafety(rA, rB);
        const optimizer = { solvent: o.solvency.pass, failYear: o.solvency.failYear || null };
        // Patrimonio real año a año en los dos motores.
        const optNW = {};
        evaluateRetirementSafety(rA, rB, { collect: true }).series.forEach(p => { optNW[p.year] = p.realNW; });
        const nwGap = Object.values(annualReportsData).filter(d => optNW[d.year] !== undefined)
          .reduce((m, d) => { const g = Math.abs(d.endRealNW - optNW[d.year]); return g > m.gap ? { gap: g, year: d.year } : m; }, { gap: 0, year: null });
        return { projection, optimizer, nwGap, ages: `${rA}/${rB}` };
      }, fn.toString());
      assert(errors.length === 0, `${name}: errores de consola: ${errors.join(' | ')}`);
      const agree = r.projection.solvent === r.optimizer.solvent && r.projection.failYear === r.optimizer.failYear;
      rows.push({ name, agree: agree && r.nwGap.gap < 2, ...r });
    } finally { await browser.close(); }
  }
  const bad = rows.filter(r => !r.agree);
  assert(bad.length === 0, 'los motores discrepan: ' + bad.map(r =>
    `${r.name} (${r.ages}) proyección=${JSON.stringify(r.projection)} optimizador=${JSON.stringify(r.optimizer)} mayor desvío de patrimonio real=${r.nwGap.gap.toFixed(2)} € en ${r.nwGap.year}`).join('; '));
  const insolv = rows.filter(r => !r.projection.solvent).length;
  return `${rows.length} escenarios de acuerdo · ${insolv} con quiebra en el mismo año`;
}
