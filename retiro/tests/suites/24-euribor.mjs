// La subida del euríbor como sexto escenario de Robustez. En la proyección principal el euríbor
// se queda congelado en el de hoy (igual que en pacolucena.com/balance); el escenario lo sube 4
// puntos en dos años, lo deja arriba dos y lo baja un punto por año, y cada deuda variable revisa
// su cuota cada año con el euríbor de ese año.
//
// Se comprueba que solo toca las deudas variables -con una hipoteca fija el resultado es idéntico
// bit a bit al de sin crisis, y la pestaña lo dice en vez de pintar una línea repetida-; que hasta
// el año en que empieza todo es igual que sin crisis; que el primer año de la subida cuesta
// exactamente la cuota francesa del saldo pendiente al nuevo tipo; que cuando el euríbor vuelve al
// de hoy la cuota también vuelve; y que el indicador de la caja de retiro seguro la cuenta.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const clon = (o) => JSON.parse(JSON.stringify(o));
      const base = clon(buildStateObject());
      const A1 = Number(base.macro.retireAgeP1), A2 = Number(base.macro.retireAgeP2);
      const sc = stressScenarioById('euribor');
      const k = 3;                                   // la subida empieza dentro de tres años
      const ruta = buildStressPath(sc, k);
      const serie = (ov) => evaluateRetirementSafety(A1, A2, { rateOverrides: ov, collect: true }).series;

      // 1. El plan de ejemplo, con sus dos hipotecas fijas: no le afecta.
      applyStateObject(clon(base)); runSimulation();
      const fijo = { aplica: scenarioApplies(sc), igual: JSON.stringify(serie(null)) === JSON.stringify(serie(ruta)) };
      robSelectedScenarioId = 'euribor';
      openRobustnessTab();
      fijo.detalle = document.getElementById('robScenarioDetail').innerText;
      fijo.titular = document.getElementById('robDelayHeadline').innerText;
      fijo.lineas = robPathsChartInstance.data.datasets.map(d => d.label);

      // 2. La misma vivienda con hipoteca variable: euríbor de hoy + 0,8.
      const conVariable = clon(base);
      const hip = conVariable.liabilitiesData.find(l => l.subcategory === 'mortgages');
      Object.assign(hip, { rateType: 'variable', spreadPct: 0.8 });
      applyStateObject(clon(conVariable)); runSimulation();
      const sin = serie(null), con = serie(ruta);
      const tipoHoy = DEFAULT_EURIBOR_12M_PCT + 0.8;

      // Saldo y meses al empezar el año k según el cuadro de siempre, para calcular a mano la
      // cuota del primer año de la subida (2 puntos más).
      const le = loanForEngine(liabilitiesData.find(l => l.id === hip.id));
      const añoK = START_YEAR + k;
      const alEmpezar = calculateLoanAmortizationExact(le.initialPrincipal, le.interestRatePct, le.durationMonths, le.startDate, añoK, 1, null, le.currency, false);
      const cuotaAntes = annuityPayment(alEmpezar.balance, tipoHoy, alEmpezar.monthsRemaining) * 12;
      const cuotaSubida = annuityPayment(alEmpezar.balance, tipoHoy + 2, alEmpezar.monthsRemaining) * 12;

      const por = (ser) => Object.fromEntries(ser.map(p => [p.year, p]));
      const S = por(sin), C = por(con);
      const antesIguales = sin.filter(p => p.year < añoK).every(p => C[p.year] && C[p.year].realNW === p.realNW && C[p.year].debtService === p.debtService);
      const extraPrimerAño = C[añoK].debtService - S[añoK].debtService;
      // Siete años de escenario: en el octavo el euríbor ya es el de hoy y la cuota baja de su pico.
      // No vuelve del todo a la de siempre, y es lo correcto: con el tipo alto la cuota amortizaba
      // menos principal, así que queda más saldo por pagar en los mismos meses.
      const añoVuelta = añoK + 7;
      const vuelta = { con: C[añoVuelta]?.debtService, sin: S[añoVuelta]?.debtService, pico: C[añoK + 2]?.debtService };
      const pierde = C[START_YEAR + 15].realNW < S[START_YEAR + 15].realNW;

      // 3. La pestaña y el indicador con la variable.
      robSelectedScenarioId = 'euribor';
      openRobustnessTab();
      const variable = {
        aplica: scenarioApplies(sc),
        lineas: robPathsChartInstance.data.datasets.map(d => d.label),
        detalle: document.getElementById('robScenarioDetail').innerText
      };

      robSelectedScenarioId = STRESS_SCENARIOS[0].id;
      applyStateObject(clon(base)); runSimulation();
      return { fijo, variable, antesIguales, extraPrimerAño, esperadoPrimerAño: cuotaSubida - cuotaAntes, vuelta, pierde, añoK };
    });

    // 1. Sin deudas variables no hace nada, y se dice.
    assert(!r.fijo.aplica, 'con hipotecas fijas el escenario no debería aplicar');
    assert(r.fijo.igual, 'con hipotecas fijas el escenario tiene que dar exactamente lo mismo que sin crisis');
    assert(/No te afecta/.test(r.fijo.detalle) && /No te afecta/.test(r.fijo.titular),
      `la pestaña debería decir que no le afecta: «${r.fijo.detalle}» / «${r.fijo.titular}»`);
    assert(!r.fijo.lineas.includes('Subida del euríbor'), `no debería pintarse una línea idéntica: ${r.fijo.lineas.join(', ')}`);
    // 2. Con una variable: igual hasta que empieza, y el primer año cuesta lo que dice la cuota francesa.
    assert(r.antesIguales, `antes de ${r.añoK} el escenario no puede cambiar nada`);
    near(r.extraPrimerAño, r.esperadoPrimerAño, Math.max(1, r.esperadoPrimerAño * 0.01),
      `el primer año de la subida la hipoteca cuesta ${Math.round(r.esperadoPrimerAño)} € más`);
    assert(r.esperadoPrimerAño > 500, `dos puntos más sobre una hipoteca viva deberían notarse: ${r.esperadoPrimerAño}`);
    assert(r.vuelta.con < r.vuelta.pico && r.vuelta.con > r.vuelta.sin && r.vuelta.con < r.vuelta.sin * 1.15,
      `cuando el euríbor vuelve, la cuota baja de su pico (${Math.round(r.vuelta.pico)}) y queda algo por encima de la de siempre (${Math.round(r.vuelta.sin)}), no en ${Math.round(r.vuelta.con)}`);
    assert(r.pierde, 'la subida tiene que costar patrimonio');
    // 3. La pestaña sí la pinta.
    assert(r.variable.aplica && r.variable.lineas.includes('Subida del euríbor'), `con una variable el escenario se pinta: ${r.variable.lineas.join(', ')}`);
    assert(!/No te afecta/.test(r.variable.detalle), 'con una variable no puede decir que no le afecta');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `fija: idéntica y avisa · variable: igual hasta ${r.añoK}, +${Math.round(r.extraPrimerAño)} € el primer año (esperado ${Math.round(r.esperadoPrimerAño)}) · vuelve con el euríbor`;
  } finally { await browser.close(); }
}
