// El deslizador de cambio de gastos: rango, factor, etiquetas, efecto en los dos motores y la
// migración de signo de los planes guardados con el criterio antiguo (expenseReduction: 20
// significaba gastar un 20% MENOS).
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const sl = document.getElementById('expenseChangeParam');
      const out = { min: sl.min, max: sl.max, factors: {}, labels: {} };
      for (const v of [-50, 0, 50]) {
        sl.value = String(v); syncParamSliders('expenseChangeParam');
        out.factors[v] = getExpenseChangeFactor();
        out.labels[v] = document.getElementById('valExpenseChange').innerText;
      }
      const safeAt = (v) => { sl.value = String(v); syncParamSliders('expenseChangeParam'); runSimulation();
        const s = calculateSimultaneousRetirement(); return s.simul ? s.simul.ageP1 : null; };
      out.safeMinus50 = safeAt(-50); out.safe0 = safeAt(0);
      sl.value = '30'; syncParamSliders('expenseChangeParam');
      const nuevo = JSON.parse(JSON.stringify(buildStateObject()));
      sl.value = '0'; applyStateObject(nuevo); out.reloadNew = sl.value;
      const antiguo = JSON.parse(JSON.stringify(nuevo)); delete antiguo.macro.expenseChange; antiguo.macro.expenseReduction = 20;
      sl.value = '0'; applyStateObject(antiguo); out.reloadOld = sl.value; out.factorOld = getExpenseChangeFactor();
      const vacio = JSON.parse(JSON.stringify(nuevo)); delete vacio.macro.expenseChange;
      sl.value = '15'; applyStateObject(vacio); out.reloadEmpty = sl.value;
      sl.value = '0'; syncParamSliders('expenseChangeParam'); runSimulation();

      // Casilla "Contar con la pensión pública": desmarcada nadie cobra pensión a los 67 en los
      // dos motores, el retiro seguro se retrasa, el fichero la conserva, y volver a marcarla
      // deja la proyección idéntica bit a bit.
      const box = document.getElementById('countPublicPension');
      const p1 = parseInt(document.getElementById('p1_age').value);
      const y67 = START_YEAR + (67 - p1);
      const pensionTipAt67 = () => { const tr = [...document.querySelectorAll('#cashflowTableBody tr')].find(t => t.querySelector('td')?.innerText.trim().startsWith(String(y67))); return tr ? (tr.querySelectorAll('td')[3].getAttribute('title') || '') : ''; };
      const pensionOf = (tip) => { const m = tip.match(/Pensión 67a: ([\d.]+)/); return m ? parseFloat(m[1].replace(/\./g, '')) : 0; };
      const before = JSON.stringify(annualReportsData);
      const safeWith = calculateSimultaneousRetirement().simul?.ageP1 ?? null;
      const evalWith = evaluateRetirementSafety(62, 59, { collect: true }).series.at(-1).realNW;
      out.pensionWith = pensionOf(pensionTipAt67());
      box.checked = false; runSimulation();
      out.pensionWithout = pensionOf(pensionTipAt67());
      out.safeWithout = calculateSimultaneousRetirement().simul?.ageP1 ?? null; out.safeWith = safeWith;
      out.evalWithout = evaluateRetirementSafety(62, 59, { collect: true }).series.at(-1).realNW; out.evalWith = evalWith;
      out.savedUnchecked = buildStateObject().macro.countPublicPension;
      box.checked = true; runSimulation();
      out.identical = JSON.stringify(annualReportsData) === before;
      const st = buildStateObject(); st.macro.countPublicPension = false; applyStateObject(st);
      out.reloadUnchecked = document.getElementById('countPublicPension').checked;
      box.checked = true; runSimulation();
      return out;
    });
    assert(r.pensionWith > 0 && r.pensionWithout === 0, `sin la casilla la pensión a los 67 sigue siendo ${r.pensionWithout} (con ella ${r.pensionWith})`);
    assert(r.safeWithout === null || r.safeWith === null || r.safeWithout >= r.safeWith, `sin pensión pública el retiro seguro debería ser igual o más tardío (${r.safeWithout} vs ${r.safeWith})`);
    assert(r.evalWithout < r.evalWith, 'el optimizador no deja de contar la pensión pública');
    assert(r.savedUnchecked === false && r.reloadUnchecked === false, 'la casilla no viaja en el fichero guardado');
    assert(r.identical, 'marcar de nuevo la casilla no devuelve la proyección idéntica');
    assert(r.min === '-50' && r.max === '50', `rango ${r.min}..${r.max}`);
    near(r.factors[-50], 0.5, 1e-9, 'factor a -50'); near(r.factors[0], 1, 1e-9, 'factor a 0'); near(r.factors[50], 1.5, 1e-9, 'factor a +50');
    assert(r.labels[0] === 'Sin cambio' && r.labels[-50] === '-50%' && r.labels[50] === '+50%', `etiquetas: ${JSON.stringify(r.labels)}`);
    assert(r.safeMinus50 !== null && r.safe0 !== null && r.safeMinus50 < r.safe0, `gastar menos no adelanta el retiro (${r.safeMinus50} vs ${r.safe0})`);
    assert(r.reloadNew === '30', 'el fichero nuevo no se relee');
    assert(r.reloadOld === '-20', `expenseReduction: 20 se cargó como ${r.reloadOld}, no como -20`);
    near(r.factorOld, 0.8, 1e-9, 'factor tras migrar un fichero antiguo');
    assert(r.reloadEmpty === '0', `un fichero sin la clave dejó ${r.reloadEmpty} en vez de 0`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `edad segura ${r.safeMinus50} a −50% · ${r.safe0} a 0% · migración -20 ✓ · sin pensión pública: retiro seguro ${r.safeWithout ?? '--'}`;
  } finally { await browser.close(); }
}
