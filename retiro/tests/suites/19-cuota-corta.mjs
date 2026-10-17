// Aviso de cuota que no cubre los intereses. El fuzzer lo sacaba una y otra vez como "la deuda
// sube sin pedir prestado", y cada vez era legítimo: un préstamo de 120.000 € al 7,9% con una
// cuota de 696 € al mes tiene 788 € de interés mensual, así que el saldo crece para siempre y el
// préstamo no se amortiza nunca. La aritmética es correcta; lo que faltaba era decírselo a quien
// teclea esos números, porque casi siempre es una errata que envenena la proyección entera.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(buildStateObject()));
      const hoy = CURRENT_START_DATE;
      const fila = (id) => {
        const celdas = [...document.querySelectorAll('#liabilitiesCategorizedTables td')];
        const c = celdas.find(td => td.getAttribute('onclick') === `editDebtModal('${id}')`);
        return c ? c.innerText : null;
      };
      const pinta = (deudas) => {
        const s = JSON.parse(JSON.stringify(base));
        s.liabilitiesData = JSON.parse(JSON.stringify(deudas));
        applyStateObject(s);
        runSimulation();
      };

      // El caso del fuzzer: 120.000 € al 7,88% con 696,32 € de cuota. Interés mensual 788 €.
      const ahogado = { id: 'd1', name: 'Préstamo ahogado', subcategory: 'personal_loans', propertyLink: '',
        currency: 'EUR', initialPrincipal: 120000, startDate: hoy, durationMonths: 240,
        interestRatePct: 7.879423763602972, monthlyPayment: 696.32, noMonthlyPayment: false };
      // El mismo préstamo con la cuota que de verdad lo amortiza en su plazo.
      const sano = { ...ahogado, id: 'd2', name: 'Préstamo sano',
        monthlyPayment: Math.ceil(annuityPayment(120000, 7.879423763602972, 240)) };
      // Sin intereses no hay forma de ahogarse, por corta que sea la cuota.
      const sinInteres = { ...ahogado, id: 'd3', name: 'Sin interés', interestRatePct: 0, monthlyPayment: 10 };
      // Una deuda declarada sin cuota ya se etiqueta como tal: ese no es el aviso de este caso.
      const sinCuota = { ...ahogado, id: 'd4', name: 'Sin cuota', subcategory: 'family_loans',
        monthlyPayment: 0, noMonthlyPayment: true };

      // El recálculo al importar corrige las cuotas cortas de las deudas amortizables, así que
      // para ver el aviso hay que meterlo por donde entra a mano: directamente en el array.
      pinta([]);
      liabilitiesData = [ahogado, sano, sinInteres, sinCuota].map(l => JSON.parse(JSON.stringify(l)));
      runSimulation();

      const textos = { d1: fila('d1'), d2: fila('d2'), d3: fila('d3'), d4: fila('d4') };

      // Y el aviso tiene que describir lo que de verdad pasa: la deuda crece en la proyección.
      const saldoHoy = calculateLoanAmortizationExact(ahogado.initialPrincipal, ahogado.interestRatePct,
        ahogado.durationMonths, ahogado.startDate, START_YEAR, new Date().getMonth() + 1,
        ahogado.monthlyPayment, 'EUR', false).balance;
      const saldos = Object.values(annualReportsData).map(d => d.endDebt);
      const crece = saldos.length > 2 && saldos[2] > saldos[0];

      applyStateObject(base); runSimulation();
      return { textos, saldoHoy, crece };
    });

    const avisa = (t) => /no cubre los intereses/.test(t || '');
    assert(avisa(r.textos.d1), `el préstamo ahogado debería avisar: "${r.textos.d1}"`);
    assert(/788/.test(r.textos.d1), `el aviso debería decir cuánto interés se paga al mes: "${r.textos.d1}"`);
    assert(!avisa(r.textos.d2), `el préstamo con cuota suficiente no debe avisar: "${r.textos.d2}"`);
    assert(!avisa(r.textos.d3), `sin intereses no hay nada de lo que avisar: "${r.textos.d3}"`);
    assert(!avisa(r.textos.d4), `una deuda sin cuota ya se etiqueta como tal, no lleva este aviso: "${r.textos.d4}"`);
    assert(r.crece, 'el plan de prueba debería mostrar la deuda creciendo: si no, el aviso no describe nada');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `avisa con 696 € de cuota y 788 € de interés · calla con cuota suficiente, sin interés y sin cuota`;
  } finally { await browser.close(); }
}
