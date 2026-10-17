// El año en que hay que vaciar un plan de pensiones para tapar un agujero, lo rescatado deja de
// ser patrimonio. La proyección tomaba la foto del saldo ANTES del bloque de déficit y la usaba
// para el activo total, así que ese año el patrimonio neto salía inflado justo en lo que se
// acababa de gastar, y con él la gráfica, el informe anual y el PDF. El optimizador, que no
// pinta tablas, leía el saldo bueno: era la última discrepancia entre los dos motores.
//
// También se comprueba que los dos redondean los saldos de jubilación a céntimos. Antes solo lo
// hacía la proyección -son saldos que salen en el balance- y el optimizador arrastraba decimales
// que, compuestos, llegaban a mover el año de quiebra.
export default async function run({ open, assert, near }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(buildStateObject()));

      // Un plan que se queda sin líquido con un plan de pensiones ya desbloqueado detrás: gasto
      // alto, retiro temprano y casi todo el patrimonio en el plan.
      const s = JSON.parse(JSON.stringify(base));
      s.assetsData = [
        { id: 'c1', name: 'Caja', category: 'cash', owner: 'p1', currency: 'EUR', value: 30000 },
        { id: 'pp1', name: 'Plan', category: 'pensions', owner: 'p1', currency: 'EUR', value: 400000, capitalReturnPct: 2, capitalReturnCoupled: false }
      ];
      s.liabilitiesData = [];
      s.realEstateEvents = [];
      s.chattelEvents = [];
      s.customYearlyRouting = {};
      s.macro.retireAgeP1 = 61;
      s.macro.retireAgeP2 = 58;
      applyStateObject(s);
      runSimulation();

      // Primer año en el que el saldo de jubilación baja: ahí hubo rescate.
      const filas = Object.values(annualReportsData).sort((a, b) => a.year - b.year);
      let añoRescate = null;
      for (let i = 1; i < filas.length; i++) {
        if (filas[i].endPens < filas[i - 1].endPens - 100) { añoRescate = filas[i].year; break; }
      }

      // El balance del año tiene que cuadrar: activo − deuda = patrimonio neto, con el saldo de
      // jubilación POSTERIOR al rescate.
      const f = filas.find(x => x.year === añoRescate);
      const cuadra = f ? Math.abs((f.endCash + f.endGrowth + f.endDiv + f.endBonds + f.endTips + f.endGold
        + f.endPens + f.endRE + f.endTangibles - f.endDebt) - f.endNW) : null;

      // Y los dos motores tienen que ver el mismo patrimonio ese año.
      const A1 = Number(s.macro.retireAgeP1), A2 = Number(s.macro.retireAgeP2);
      const opt = evaluateRetirementSafety(A1, A2, { collect: true });
      const optPunto = opt.series.find(p => p.year === añoRescate);
      const peor = opt.series.reduce((m, p) => {
        const proj = filas.find(x => x.year === p.year);
        if (!proj) return m;
        const d = Math.abs(proj.endRealNW - p.realNW);
        return d > m.d ? { d, y: p.year } : m;
      }, { d: 0, y: null });

      // Redondeo a céntimos: el saldo de jubilación que sale en el balance no puede arrastrar
      // decimales por debajo del céntimo, ni en el año del rescate ni en ninguno.
      const decimalesProj = filas.map(x => x.endPens).filter(b => Math.abs(b * 100 - Math.round(b * 100)) > 1e-6).length;

      applyStateObject(base); runSimulation();
      return {
        añoRescate,
        pensAntes: f ? filas[filas.indexOf(f) - 1].endPens : null,
        pensDespues: f ? f.endPens : null,
        cuadra,
        optNW: optPunto ? optPunto.realNW : null,
        projNW: f ? f.endRealNW : null,
        peor, decimalesProj
      };
    });

    assert(r.añoRescate !== null,
      'el plan de prueba debería llegar a rescatar el plan de pensiones: si no, no se ejercita el caso');
    assert(r.pensDespues < r.pensAntes,
      `el saldo de jubilación tiene que bajar en ${r.añoRescate}: ${r.pensAntes} → ${r.pensDespues}`);
    // 1. El balance del año del rescate cuadra con el saldo ya rescatado.
    near(r.cuadra, 0, 1, `el balance de ${r.añoRescate} no cuadra`);
    // 2. Los dos motores ven el mismo patrimonio, ese año y todos.
    near(r.projNW, r.optNW, 1,
      `los dos motores discrepan en el año del rescate (${r.añoRescate})`);
    assert(r.peor.d < 1,
      `los dos motores se separan ${Math.round(r.peor.d)} € en ${r.peor.y}`);
    // 3. Los saldos de jubilación están redondeados a céntimos.
    assert(r.decimalesProj === 0,
      `${r.decimalesProj} saldos de jubilación con más de dos decimales`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `rescate en ${r.añoRescate}: ${Math.round(r.pensAntes / 1000)}k → ${Math.round(r.pensDespues / 1000)}k · balance cuadra · motores a ${r.peor.d.toFixed(2)} €`;
  } finally { await browser.close(); }
}
