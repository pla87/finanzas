// Etapas laborales en tiempo transcurrido desde hoy, salida voluntaria sin paro, y cuota de
// préstamo recalculada al importar cuando no amortiza el capital en su plazo.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const yearFrac0 = getRemainingYearFraction(); // 0,31 en las pruebas
      const p1 = parseInt(document.getElementById('p1_age').value);
      const st0 = careers[1].stages[0];
      st0.years = 3; st0.endType = 'layoff'; st0.tenureBefore = 10; st0.layoffDays = 33; st0.salary = 60000; st0.salaryIncCoupled = true;
      document.getElementById('retireAge').value = 60; document.getElementById('retireAgeP2').value = 57;
      runSimulation();
      const rows = [...document.querySelectorAll('#cashflowTableBody tr')];
      const tipOf = (year) => { const tr = rows.find(t => t.querySelector('td')?.innerText.trim().startsWith(String(year))); return tr ? (tr.querySelectorAll('td')[2].getAttribute('title') || '') : ''; };
      const sevYear = [START_YEAR, START_YEAR + 1, START_YEAR + 2, START_YEAR + 3, START_YEAR + 4].find(y => /Indemnización por Despido/.test(tipOf(y)));
      // Sueldo base P1 de cada año (euros de hoy): año 0 a yearFrac0, dos enteros, el del despido a medias.
      const salP1 = (year) => { const m = tipOf(year).match(/Tú \(P1\):[\s\S]*?Salario Base Dinerario: ([\d.]+)/); return m ? parseFloat(m[1].replace(/\./g, '')) : 0; };
      const inf = numParam('inflationParam', 2.0) / 100;
      const real = (year) => salP1(year) / Math.pow(1 + inf, year - START_YEAR);
      const paidYears = [0, 1, 2, 3].reduce((s, k) => s + real(START_YEAR + k) / 60000, 0);
      // Tenure de la indemnización: los 10 años previos más los 3 de la etapa.
      const sev = (() => { const m = tipOf(sevYear || START_YEAR).match(/Indemnización por Despido: ([\d.]+)/); return m ? parseFloat(m[1].replace(/\./g, '')) : 0; })();
      const salNominalLayoffYear = 60000 * Math.pow(1 + inf, (sevYear || START_YEAR) - START_YEAR);
      const sevExpected = Math.min(salNominalLayoffYear * 2, 33 * 13 * salNominalLayoffYear / 365);
      // Los dos motores ven la misma etapa: el optimizador también pone el despido ese año.
      const at = stageAtYear(careers[1].stages, sevYear - START_YEAR, yearFrac0);

      // Salida voluntaria al jubilarse: sin paro. Con despido pactado: con paro.
      const paroAt = (endType) => {
        careers[1].stages[0].years = 30; careers[1].stages[0].endType = endType;
        careers[2].stages[0].years = 30; careers[2].stages[0].endType = endType;
        document.getElementById('retireAge').value = 50; document.getElementById('retireAgeP2').value = 47;
        runSimulation();
        const y = START_YEAR + (50 - p1) + 1;
        const tr = [...document.querySelectorAll('#cashflowTableBody tr')].find(t => t.querySelector('td')?.innerText.trim().startsWith(String(y)));
        const tip = tr ? (tr.querySelectorAll('td')[3].getAttribute('title') || '') : '';
        const m = tip.match(/Total Pensión \/ Paro Percibido: ([\d.]+)/);
        const eval_ = evaluateRetirementSafety(50, 47, { collect: true });
        return { paro: m ? parseFloat(m[1].replace(/\./g, '')) : 0, evalRealNW: Math.round(eval_.series.find(p => p.year === y)?.realNW || 0) };
      };
      const voluntary = paroAt('voluntary');
      const layoff = paroAt('layoff');

      // Cuota incoherente con el plazo: al importar se recalcula; una cuota mayor se respeta.
      const state = buildStateObject();
      const loan = state.liabilitiesData.find(l => l.subcategory === 'mortgages' && !l.noMonthlyPayment);
      const due = annuityPayment(loan.initialPrincipal, loan.interestRatePct, loan.durationMonths);
      loan.monthlyPayment = Math.round(due * 0.9 * 100) / 100;
      const bigger = state.liabilitiesData.filter(l => l.subcategory === 'mortgages' && !l.noMonthlyPayment && l.id !== loan.id)[0];
      if (bigger) bigger.monthlyPayment = Math.round(annuityPayment(bigger.initialPrincipal, bigger.interestRatePct, bigger.durationMonths) * 1.2 * 100) / 100;
      applyStateObject(state);
      const fixed = liabilitiesData.find(l => l.id === loan.id).monthlyPayment;
      const kept = bigger ? liabilitiesData.find(l => l.id === bigger.id).monthlyPayment : null;
      return { yearFrac0, startYear: START_YEAR, sevYear, paidYears, sev, sevExpected, atNatural: !!at && at.isNaturalStageEnd, atWorked: at ? at.yearsWorked : null,
        voluntary, layoff, fixed, due: Math.round(due * 100) / 100, kept, biggerSet: bigger ? bigger.monthlyPayment : null };
    });
    assert(r.sevYear === r.startYear + 3, `una etapa de 3 años desde hoy debería terminar en ${r.startYear + 3}, no en ${r.sevYear}`);
    near(r.paidYears, r.yearFrac0 + 2 + 0.5, 0.02, 'años de sueldo cobrados en una etapa de 3 años');
    near(r.sev, r.sevExpected, 2, 'indemnización con 10 años previos más los 3 de la etapa');
    assert(r.atNatural && r.atWorked === 3, `stageAtYear no ve el fin natural con 3 años trabajados: ${JSON.stringify({ n: r.atNatural, w: r.atWorked })}`);
    assert(r.voluntary.paro === 0, `salida voluntaria con paro: ${r.voluntary.paro} €`);
    assert(r.layoff.paro > 0, 'el despido pactado al jubilarse no cobra paro');
    assert(r.layoff.evalRealNW > r.voluntary.evalRealNW, 'el optimizador no distingue la salida voluntaria del despido');
    assert(r.fixed === r.due, `la cuota corta no se recalcula al importar: ${r.fixed} vs ${r.due}`);
    assert(r.kept === null || r.kept === r.biggerSet, `una cuota mayor que la francesa debería respetarse: ${r.kept} vs ${r.biggerSet}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `despido en ${r.sevYear} · ${r.paidYears.toFixed(2)} años de sueldo · sin paro voluntario · cuota ${r.fixed} €`;
  } finally { await browser.close(); }
}
