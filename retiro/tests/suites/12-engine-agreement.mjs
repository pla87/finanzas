// Hay dos motores: runSimulation() (proyección con tablas) y evaluateRetirementSafety()
// (optimizador, sin DOM, usado por la edad segura, Robustez y Monte Carlo). Comparten los
// parámetros (readSimParams), el orden de desinversión y el rescate de pensiones, pero el bucle
// anual sigue escrito dos veces. Esta prueba obliga a que, para las mismas edades de retiro,
// los dos den el mismo veredicto de solvencia y el mismo año de quiebra en varios escenarios
// distintos, de modo que una divergencia futura salte aquí y no en la caja de edad segura.
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
        return { projection, optimizer, ages: `${rA}/${rB}` };
      }, fn.toString());
      assert(errors.length === 0, `${name}: errores de consola: ${errors.join(' | ')}`);
      const agree = r.projection.solvent === r.optimizer.solvent && r.projection.failYear === r.optimizer.failYear;
      rows.push({ name, agree, ...r });
    } finally { await browser.close(); }
  }
  const bad = rows.filter(r => !r.agree);
  assert(bad.length === 0, 'los motores discrepan: ' + bad.map(r =>
    `${r.name} (${r.ages}) proyección=${JSON.stringify(r.projection)} optimizador=${JSON.stringify(r.optimizer)}`).join('; '));
  const insolv = rows.filter(r => !r.projection.solvent).length;
  return `${rows.length} escenarios de acuerdo · ${insolv} con quiebra en el mismo año`;
}
