// Interoperabilidad con pacolucena.com/balance, que comparte el formato del fichero. En balance
// una deuda sin cuadro de amortización se declara por lo que se debe HOY: saldo, meses que quedan
// y cuota, con la fecha de hoy. La hipoteca conserva su principal y su fecha de firma reales.
// Aquí se comprueba que retiro lee eso sin desviarse, que la vuelta no cambia nada, y que un
// plazo inutilizable deja la deuda viva en vez de hacerla desaparecer.
//
// Y la segunda mitad: las dos herramientas piden lo mismo para cada tipo de deuda. El formulario
// de retiro declara el préstamo personal por su saldo de hoy y los meses que quedan, la tarjeta
// por su saldo, interés y cuota, la familiar por cuota o plazo (uno saca el otro), y la hipoteca
// puede ser variable -euríbor de hoy, congelado, más diferencial- y llevar el saldo real del
// extracto. La cuota de una variable sale igual que en balance para el mismo préstamo.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const hoy = CURRENT_START_DATE;
      const [hoyY, hoyM] = hoy.split('-').map(Number);
      const saldoHoy = (l) => calculateLoanAmortizationExact(
        l.initialPrincipal, l.interestRatePct, l.durationMonths, l.startDate,
        hoyY, hoyM, l.monthlyPayment, l.currency, !!l.noMonthlyPayment).balance;

      // Un fichero como los que escribe balance: tarjeta y préstamo familiar por su saldo de hoy,
      // hipoteca por su principal original y su fecha de firma.
      const deBalance = [
        { id: 'b1', name: 'Visa', subcategory: 'short_term', propertyLink: '', currency: 'EUR',
          initialPrincipal: 1500, startDate: hoy, durationMonths: 24, interestRatePct: 0, monthlyPayment: 40, noMonthlyPayment: false },
        { id: 'b2', name: 'Préstamo familiar', subcategory: 'family_loans', propertyLink: '', currency: 'EUR',
          initialPrincipal: 8000, startDate: hoy, durationMonths: 12, interestRatePct: 0, monthlyPayment: 0, noMonthlyPayment: true },
        { id: 'b3', name: 'Hipoteca', subcategory: 'mortgages', propertyLink: '', currency: 'EUR',
          initialPrincipal: 200000, startDate: '2020-01', durationMonths: 300, interestRatePct: 2.0, monthlyPayment: 847.71, noMonthlyPayment: false }
      ];

      const base = JSON.parse(JSON.stringify(buildStateObject()));
      const conDeudas = JSON.parse(JSON.stringify(base));
      conDeudas.liabilitiesData = JSON.parse(JSON.stringify(deBalance));
      applyStateObject(conDeudas);
      runSimulation();
      const leidas = liabilitiesData.map(l => ({ ...l }));
      const saldos = Object.fromEntries(leidas.map(l => [l.id, Math.round(saldoHoy(l) * 100) / 100]));

      // La vuelta: exportar e importar otra vez no puede mover nada.
      const exportado = JSON.parse(JSON.stringify(buildStateObject()));
      applyStateObject(JSON.parse(JSON.stringify(exportado)));
      runSimulation();
      const ida = JSON.stringify(leidas.map(l => [l.id, l.initialPrincipal, l.startDate, l.durationMonths, l.monthlyPayment, !!l.noMonthlyPayment]));
      const vuelta = JSON.stringify(liabilitiesData.map(l => [l.id, l.initialPrincipal, l.startDate, l.durationMonths, l.monthlyPayment, !!l.noMonthlyPayment]));

      // Una deuda con el plazo inutilizable (0 meses) no puede evaporarse.
      const cero = { id: 'c0', name: 'Sin plazo', subcategory: 'short_term', propertyLink: '', currency: 'EUR',
        initialPrincipal: 3000, startDate: hoy, durationMonths: 0, interestRatePct: 0, monthlyPayment: 0, noMonthlyPayment: false };
      const dentroDeDiezAños = calculateLoanAmortizationExact(cero.initialPrincipal, 0, 0, cero.startDate, hoyY + 10, hoyM, 0, 'EUR', false);

      // Una tarjeta con fecha antigua: normalizeLiability la pone a hoy, así que no se amortiza
      // sola hasta desaparecer antes siquiera de empezar la proyección.
      const vieja = JSON.parse(JSON.stringify(base));
      vieja.liabilitiesData = [{ ...deBalance[0], id: 'v1', startDate: '2015-01' }];
      applyStateObject(vieja);
      const tarjetaVieja = liabilitiesData[0];
      const saldoVieja = Math.round(saldoHoy(tarjetaVieja) * 100) / 100;

      // El recálculo de cuota solo debe tocar las deudas con cuadro real: en una tarjeta la cuota
      // es el dato de verdad y el plazo una estimación.
      const revolving = JSON.parse(JSON.stringify(base));
      revolving.liabilitiesData = [
        { ...deBalance[0], id: 'r1' },                                   // 1500 en 24 meses a 40 €: no cuadra, y da igual
        { ...deBalance[2], id: 'r2', monthlyPayment: 500 }               // hipoteca con cuota corta: sí se recalcula
      ];
      applyStateObject(revolving);
      const cuotas = Object.fromEntries(liabilitiesData.map(l => [l.id, l.monthlyPayment]));
      const cuotaHipotecaDebida = Math.round(annuityPayment(200000, 2.0, 300) * 100) / 100;

      // --- Un préstamo personal de un fichero de antes, descrito desde su alta hace tres años ---
      const hace3 = `${hoyY - 3}-${String(hoyM).padStart(2, '0')}`;
      const antiguo = { id: 'p1', name: 'Coche', subcategory: 'personal_loans', propertyLink: '', currency: 'EUR',
        initialPrincipal: 20000, startDate: hace3, durationMonths: 60, interestRatePct: 5, monthlyPayment: 0, noMonthlyPayment: false };
      const cuotaAntes = annuityPayment(20000, 5, 60);
      const saldoAntes = calculateLoanAmortizationExact(20000, 5, 60, hace3, hoyY, hoyM, null, 'EUR', false).balance;
      const conPersonal = JSON.parse(JSON.stringify(base));
      conPersonal.liabilitiesData = [antiguo];
      applyStateObject(conPersonal);
      const personal = { ...liabilitiesData[0] };
      const cuotaDespues = annuityPayment(personal.initialPrincipal, personal.interestRatePct, personal.durationMonths);

      // --- El formulario ---
      const formulario = {};
      openAddDebtModal('personal_loans');
      formulario.personal = {
        sinFecha: document.getElementById('modalDebtStartField').classList.contains('hidden'),
        etiquetaSaldo: document.getElementById('modalDebtPrincipalLabel').innerText,
        etiquetaMeses: document.getElementById('modalDebtMonthsLabel').innerText,
        sinCuota: document.getElementById('modalDebtPaymentField').classList.contains('hidden')
      };
      document.getElementById('modalDebtName').value = 'Préstamo del formulario';
      document.getElementById('modalDebtPrincipal').value = 9000;
      document.getElementById('modalDebtMonths').value = 30;
      document.getElementById('modalDebtRate').value = 7;
      saveDebtModal({ preventDefault() {} });
      formulario.personalGuardado = { ...liabilitiesData.find(l => l.name === 'Préstamo del formulario') };

      openAddDebtModal('short_term');
      formulario.tarjeta = {
        sinMeses: document.getElementById('modalDebtMonthsField').classList.contains('hidden'),
        conCuota: !document.getElementById('modalDebtPaymentField').classList.contains('hidden')
      };
      document.getElementById('modalDebtName').value = 'Tarjeta del formulario';
      document.getElementById('modalDebtPrincipal').value = 1200;
      document.getElementById('modalDebtRate').value = 18;
      document.getElementById('modalDebtPayment').value = 100;
      saveDebtModal({ preventDefault() {} });
      formulario.tarjetaGuardada = { ...liabilitiesData.find(l => l.name === 'Tarjeta del formulario') };

      openAddDebtModal('family_loans');
      document.getElementById('modalDebtNoPayment').checked = false; toggleNoPaymentUI();
      document.getElementById('modalDebtPrincipal').value = 6000;
      document.getElementById('modalDebtRate').value = 0;
      document.getElementById('modalDebtPayment').value = 250; onDebtModalInput('payment');
      formulario.familiarMeses = Number(document.getElementById('modalDebtMonths').value);
      document.getElementById('modalDebtMonths').value = 12; onDebtModalInput('months');
      formulario.familiarCuota = Number(document.getElementById('modalDebtPayment').value);
      closeDebtModal();

      // --- Hipoteca variable y saldo real ---
      const variable = { id: 'v1', name: 'Variable', subcategory: 'mortgages', propertyLink: '', currency: 'EUR',
        initialPrincipal: 200000, startDate: '2020-01', durationMonths: 300, interestRatePct: 9.99, monthlyPayment: 0,
        noMonthlyPayment: false, rateType: 'variable', spreadPct: 0.9, balanceOverride: 0 };
      const anclada = { ...variable, id: 'v2', name: 'Anclada', rateType: 'fixed', spreadPct: 0, interestRatePct: 2.5, balanceOverride: 150000 };
      const conHipotecas = JSON.parse(JSON.stringify(base));
      conHipotecas.liabilitiesData = [variable, anclada];
      applyStateObject(conHipotecas);
      runSimulation();
      const le1 = loanForEngine(liabilitiesData.find(l => l.id === 'v1'));
      const a1 = calculateLoanAmortizationExact(le1.initialPrincipal, le1.interestRatePct, le1.durationMonths, le1.startDate, hoyY, hoyM, le1.monthlyPayment, 'EUR', false);
      const le2 = loanForEngine(liabilitiesData.find(l => l.id === 'v2'));
      const a2 = calculateLoanAmortizationExact(le2.initialPrincipal, le2.interestRatePct, le2.durationMonths, le2.startDate, hoyY, hoyM, le2.monthlyPayment, 'EUR', false);
      // Balance, para el mismo préstamo: cuota francesa del principal original al euríbor + diferencial
      // (calculateLoanAmortization de su finance.js), y con saldo real, la francesa de ese saldo en
      // los meses que le quedan al cuadro (paymentForBalance).
      const francesa = (P, pct, n) => { const r = pct / 1200; return P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1); };
      const transcurridos = (hoyY - 2020) * 12 + (hoyM - 1);
      const balance = {
        cuotaVariable: Math.round(francesa(200000, DEFAULT_EURIBOR_12M_PCT + 0.9, 300) * 100) / 100,
        cuotaAnclada: Math.round(francesa(150000, 2.5, 300 - transcurridos) * 100) / 100
      };
      const vueltaHip = JSON.parse(JSON.stringify(buildStateObject())).liabilitiesData;

      applyStateObject(base); runSimulation();
      return { saldos, ida, vuelta, dentroDeDiezAños, fechaVieja: tarjetaVieja.startDate, saldoVieja, cuotas, cuotaHipotecaDebida, hoy,
        personal, cuotaAntes, cuotaDespues, saldoAntes, formulario,
        variable: { tipo: le1.interestRatePct, cuota: a1.monthlyPayment }, anclada: { saldo: a2.balance, cuota: a2.monthlyPayment },
        balance, euribor: DEFAULT_EURIBOR_12M_PCT, vueltaHip };
    });

    // 1. Los saldos de hoy son exactamente los declarados: leer el fichero de balance no desvía nada.
    assert(r.saldos.b1 === 1500, `la tarjeta debería valer hoy 1500 €, no ${r.saldos.b1}`);
    assert(r.saldos.b2 === 8000, `el préstamo familiar debería valer hoy 8000 €, no ${r.saldos.b2}`);
    assert(Math.abs(r.saldos.b3 - 155000) < 3000, `la hipoteca de 2020 debería rondar los 155.000 € hoy, no ${r.saldos.b3}`);
    // 2. La vuelta no mueve nada.
    assert(r.ida === r.vuelta, `exportar e importar cambia las deudas:\n  ida    ${r.ida}\n  vuelta ${r.vuelta}`);
    // 3. Un plazo de 0 deja la deuda viva, sin cuota, en vez de saldarla de golpe.
    assert(r.dentroDeDiezAños.balance === 3000 && r.dentroDeDiezAños.monthlyPayment === 0,
      `un plazo de 0 meses no puede hacer desaparecer la deuda: ${JSON.stringify(r.dentroDeDiezAños)}`);
    // 4. Una tarjeta con fecha antigua se normaliza a hoy y conserva su saldo.
    assert(r.fechaVieja === r.hoy, `la fecha de una tarjeta debería quedar en ${r.hoy}, no en ${r.fechaVieja}`);
    assert(r.saldoVieja === 1500, `la tarjeta con fecha antigua debería seguir debiendo 1500 €, no ${r.saldoVieja}`);
    // 5. El recálculo de cuota respeta la tarjeta y corrige la hipoteca.
    assert(r.cuotas.r1 === 40, `la cuota de la tarjeta no se toca: ${r.cuotas.r1}`);
    assert(r.cuotas.r2 === r.cuotaHipotecaDebida, `la hipoteca con cuota corta debería recalcularse a ${r.cuotaHipotecaDebida}, no ${r.cuotas.r2}`);
    // 6. Un préstamo personal descrito desde el alta entra puesto al día, sin moverse un euro.
    assert(r.personal.startDate === r.hoy, `el préstamo personal debería quedar con fecha de hoy, no ${r.personal.startDate}`);
    assert(r.personal.durationMonths === 24, `le quedan 24 de 60 meses, no ${r.personal.durationMonths}`);
    assert(Math.abs(r.personal.initialPrincipal - r.saldoAntes) < 0.01, `el saldo de hoy es ${r.saldoAntes}, no ${r.personal.initialPrincipal}`);
    assert(Math.abs(r.cuotaDespues - r.cuotaAntes) < 0.05, `la cuota no puede cambiar al ponerlo al día: ${r.cuotaAntes} → ${r.cuotaDespues}`);
    // 7. El formulario pide lo mismo que balance.
    const f = r.formulario;
    assert(f.personal.sinFecha && /Saldo de Hoy/.test(f.personal.etiquetaSaldo) && /Quedan/.test(f.personal.etiquetaMeses) && f.personal.sinCuota,
      `el préstamo personal pide saldo de hoy y meses que quedan, sin fecha ni cuota: ${JSON.stringify(f.personal)}`);
    assert(f.personalGuardado.startDate === r.hoy && f.personalGuardado.durationMonths === 30 && f.personalGuardado.initialPrincipal === 9000 && f.personalGuardado.monthlyPayment === 0,
      `el préstamo del formulario se guarda con fecha de hoy y cuota automática: ${JSON.stringify(f.personalGuardado)}`);
    assert(f.tarjeta.sinMeses && f.tarjeta.conCuota, 'la tarjeta pide saldo, interés y cuota, sin plazo');
    assert(f.tarjetaGuardada.monthlyPayment === 100 && f.tarjetaGuardada.durationMonths === 14,
      `una tarjeta de 1200 € al 18% con 100 € de cuota se salda en 14 meses: ${JSON.stringify(f.tarjetaGuardada)}`);
    assert(f.familiarMeses === 24, `6000 € a 250 € al mes son 24 meses, no ${f.familiarMeses}`);
    assert(f.familiarCuota === 500, `6000 € en 12 meses son 500 € al mes, no ${f.familiarCuota}`);
    // 8. Hipoteca variable: euríbor de hoy más diferencial, y la misma cuota que en balance.
    assert(Math.abs(r.variable.tipo - (r.euribor + 0.9)) < 1e-9, `la variable paga euríbor + 0,9, no ${r.variable.tipo}`);
    assert(Math.abs(r.variable.cuota - r.balance.cuotaVariable) < 0.01, `la cuota de la variable es ${r.variable.cuota} y en balance ${r.balance.cuotaVariable}`);
    // 9. Saldo real: manda el del extracto, y la cuota es la de balance.
    assert(r.anclada.saldo === 150000, `con saldo real la hipoteca debe 150.000 € hoy, no ${r.anclada.saldo}`);
    assert(Math.abs(r.anclada.cuota - r.balance.cuotaAnclada) < 0.01, `la cuota anclada es ${r.anclada.cuota} y en balance ${r.balance.cuotaAnclada}`);
    // 10. Y todo viaja: tipo, diferencial y saldo real vuelven tal cual.
    const v1 = r.vueltaHip.find(l => l.id === 'v1'), v2 = r.vueltaHip.find(l => l.id === 'v2');
    assert(v1.rateType === 'variable' && v1.spreadPct === 0.9 && v1.initialPrincipal === 200000 && v1.startDate === '2020-01',
      `la variable vuelve cambiada: ${JSON.stringify(v1)}`);
    assert(v2.balanceOverride === 150000 && v2.initialPrincipal === 200000, `la anclada vuelve cambiada: ${JSON.stringify(v2)}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `tarjeta 1500 € · familiar 8000 € · hipoteca ${Math.round(r.saldos.b3 / 1000)}k · ida y vuelta idéntica · plazo 0 no evapora · personal al día · formulario como balance · variable a ${r.variable.tipo.toFixed(3)}% = balance`;
  } finally { await browser.close(); }
}
