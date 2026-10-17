// Tres fallos que encontró el fuzzer (planes aleatorios con semilla, ver el informe de la
// ronda): el informe anual se acumulaba entre planes, una categoría vendida entera se quedaba
// con saldo tras la revalorización de mitad de año, y al importar un plan la edad de retiro
// podía subir sola porque el deslizador conservaba el mínimo del plan anterior.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(buildStateObject()));
      const plan = (edit) => { const s = JSON.parse(JSON.stringify(base)); edit(s); return s; };

      // 1. El informe anual no puede arrastrar años del plan anterior. Se carga un plan de gente
      //    joven (horizonte largo) y después uno de gente mayor (horizonte corto).
      const joven = plan(s => { s.careers[1].age = 30; s.careers[2].age = 28; s.macro.retireAgeP1 = 60; s.macro.retireAgeP2 = 60; });
      applyStateObject(joven); runSimulation();
      const añosJoven = Object.keys(annualReportsData).map(Number);
      const mayor = plan(s => { s.careers[1].age = 60; s.careers[2].age = 58; s.macro.retireAgeP1 = 65; s.macro.retireAgeP2 = 65; });
      applyStateObject(mayor); runSimulation();
      const añosMayor = Object.keys(annualReportsData).map(Number);
      // La proyección llega hasta que el MÁS JOVEN cumple 100; un año de margen por el prorrateo
      // del año en curso. Cualquier año más allá viene del plan anterior.
      const arrastre = añosMayor.filter(y => y > START_YEAR + (100 - 58) + 1);

      // 2. Una categoría vendida entera se queda a cero, con tipo negativo y con tipo positivo.
      const settle = {
        vacíoNegativo: settleAfterReturn([], -50),
        vacíoPositivo: settleAfterReturn([], 50),
        conLotesNegativo: settleAfterReturn([{ value: 10, cost: 5 }], -50),
        conLotes: settleAfterReturn([{ value: 100, cost: 50 }], 120)
      };
      // Y de punta a punta: oro con tipo nominal negativo que se liquida entero para cubrir el
      // déficit. Ninguna categoría puede acabar con saldo negativo.
      const oro = plan(s => {
        s.assetsData = [
          { id: 'g1', name: 'Oro', category: 'gold', owner: 'joint', currency: 'EUR', value: 120000, capitalReturnCoupled: true },
          { id: 'c1', name: 'Caja', category: 'cash', owner: 'joint', currency: 'EUR', value: 5000, cashReturnPct: 0 }
        ];
        s.liabilitiesData = [];
        s.macro.inflation = '0'; s.macro.goldRealReturn = '-3'; s.macro.propertyInflation = '0'; s.macro.rentInflation = '0';
        s.macro.retireAgeP1 = s.careers[1].age; s.macro.retireAgeP2 = s.careers[2].age;
        s.macro.deficitDest = 'gold'; s.macro.countPublicPension = false;
      });
      applyStateObject(oro); runSimulation();
      const cats = ['endCash', 'endGrowth', 'endDiv', 'endBonds', 'endTips', 'endGold', 'endPens', 'endRE', 'endTangibles'];
      const negativos = Object.values(annualReportsData)
        .flatMap(d => cats.filter(k => d[k] < -1).map(k => `${d.year}.${k}=${Math.round(d[k])}`));
      const oroSeries = Object.values(annualReportsData).map(d => d.endGold);
      const seVació = oroSeries.some(v => v === 0);

      // 3. Importar un plan de gente mayor y después uno de gente joven no puede subir la edad
      //    de retiro del segundo: el deslizador conservaba el `min` del primero.
      const mayorRetiro = plan(s => { s.careers[1].age = 60; s.careers[2].age = 58; s.macro.retireAgeP1 = 68; s.macro.retireAgeP2 = 67; });
      applyStateObject(mayorRetiro);
      const jovenRetiro = plan(s => { s.careers[1].age = 30; s.careers[2].age = 28; s.macro.retireAgeP1 = 45; s.macro.retireAgeP2 = 44; });
      applyStateObject(jovenRetiro);
      const edades = { p1: document.getElementById('retireAge').value, p2: document.getElementById('retireAgeP2').value };
      // Y al revés, el mínimo real sigue vigente: nadie puede jubilarse antes de la edad que tiene.
      const imposible = plan(s => { s.careers[1].age = 55; s.careers[2].age = 54; s.macro.retireAgeP1 = 30; s.macro.retireAgeP2 = 30; });
      applyStateObject(imposible);
      const suelo = { p1: document.getElementById('retireAge').value, p2: document.getElementById('retireAgeP2').value };

      // 4. Amortizar deuda con el excedente: la deuda no puede reaparecer al año siguiente. Se
      //    usa un préstamo SIN cuota explícita, que es el que la hacía resucitar: al restar la
      //    amortización extra del principal inicial, la cuota se recalculaba más pequeña.
      const amortiza = plan(s => {
        s.careers[1].stages = [{ type: 'employed', company: 'E', years: 30, salary: 200000, rsus: 0, salaryIncCoupled: true, benefits: 0, tenureBefore: 5, layoffDays: 33, endType: 'layoff', empPensionPct: 0, compPensionPct: 0 }];
        s.careers[2].stages = [{ type: 'employed', company: 'E', years: 30, salary: 60000, rsus: 0, salaryIncCoupled: true, benefits: 0, tenureBefore: 5, layoffDays: 33, endType: 'layoff', empPensionPct: 0, compPensionPct: 0 }];
        s.assetsData = [{ id: 'c1', name: 'Caja', category: 'cash', owner: 'joint', currency: 'EUR', value: 50000, cashReturnPct: 0 }];
        s.liabilitiesData = [
          { id: 'sinCuota', name: 'Sin cuota', subcategory: 'mortgages', propertyLink: '', currency: 'EUR', initialPrincipal: 240000, startDate: '2024-04', durationMonths: 300, interestRatePct: 3.2, noMonthlyPayment: false, monthlyPayment: 0, rateType: 'fixed', spreadPct: 0, balanceOverride: 0 },
          { id: 'conCuota', name: 'Con cuota', subcategory: 'mortgages', propertyLink: '', currency: 'EUR', initialPrincipal: 200000, startDate: '2020-01', durationMonths: 240, interestRatePct: 2.5, noMonthlyPayment: false, monthlyPayment: 1060, rateType: 'fixed', spreadPct: 0, balanceOverride: 0 }
        ];
        s.macro.surplusDest = 'debt';
        s.macro.retireAgeP1 = s.careers[1].age + 25; s.macro.retireAgeP2 = s.careers[2].age + 25;
      });
      applyStateObject(amortiza); runSimulation();
      const deuda = Object.values(annualReportsData).sort((a, b) => a.year - b.year);
      const sube = deuda.slice(1).filter((d, i) => d.endDebt > deuda[i].endDebt + 1).map(d => `${d.year}: ${Math.round(deuda.findIndex(x => x.year === d.year) >= 0 ? deuda[deuda.findIndex(x => x.year === d.year) - 1].endDebt : 0)} → ${Math.round(d.endDebt)}`);
      const amortNegativa = deuda.filter(d => d.debtAmortized < -1).map(d => `${d.year}: ${Math.round(d.debtAmortized)}`);
      const seAmortizó = deuda.some(d => d.debtAmortized > 1000);
      const llegaACero = deuda.some(d => d.endDebt === 0);

      // 5. Aportaciones a jubilación sin destino elegido: se reparten entre los seguros del
      //    titular (sin duplicar) y los DOS motores las ven igual. Antes la proyección se las
      //    sumaba enteras a cada seguro y el optimizador no se las sumaba a ninguno.
      const pens = [
        { id: 'a', owner: 'p1', category: 'pensionIns' }, { id: 'b', owner: 'p1', category: 'pensionIns' },
        { id: 'c', owner: 'p2', category: 'pensionIns' }, { id: 'd', owner: 'p1', category: 'pensions' }
      ];
      const reparto = {
        sinDestino: spreadPensionContributions(pens, {}, 1000, 500),
        conDestinoP1: spreadPensionContributions(pens, { a: 300 }, 1000, 500)
      };
      const sinDestino = plan(s => {
        s.careers[1].stages = [{ type: 'employed', company: 'E', years: 30, salary: 90000, rsus: 0, salaryIncCoupled: true, benefits: 0, tenureBefore: 3, layoffDays: 33, endType: 'layoff', empPensionPct: 10, compPensionPct: 5, targetAssetId: '' }];
        s.careers[2].stages = [{ type: 'employed', company: 'E', years: 30, salary: 40000, rsus: 0, salaryIncCoupled: true, benefits: 0, tenureBefore: 3, layoffDays: 33, endType: 'layoff', empPensionPct: 0, compPensionPct: 0, targetAssetId: '' }];
        s.assetsData = [
          { id: 'seg1', name: 'Seguro 1', category: 'pensionIns', owner: 'p1', currency: 'EUR', value: 20000, capitalReturnPct: 5 },
          { id: 'seg2', name: 'Seguro 2', category: 'pensionIns', owner: 'p1', currency: 'EUR', value: 20000, capitalReturnPct: 5 },
          { id: 'caj', name: 'Caja', category: 'cash', owner: 'joint', currency: 'EUR', value: 60000, cashReturnPct: 0 }
        ];
        s.liabilitiesData = [];
        s.macro.retireAgeP1 = s.careers[1].age + 20; s.macro.retireAgeP2 = s.careers[2].age + 20;
      });
      applyStateObject(sinDestino); runSimulation();
      const pensAño1 = annualReportsData[START_YEAR + 1].endPens;
      const solvText2 = document.getElementById('valCritSolvency').textContent;
      const m2 = solvText2.match(/\b(2[01]\d\d)\b/);
      const proyecta = { solvente: document.getElementById('badgeCritSolvency').textContent.includes('Solvente'), año: m2 ? Number(m2[1]) : null };
      const oo = evaluateRetirementSafety(Number(sinDestino.macro.retireAgeP1), Number(sinDestino.macro.retireAgeP2));
      const optimiza = { solvente: oo.solvency.pass, año: oo.solvency.failYear || null };
      const motoresDeAcuerdo = proyecta.solvente === optimiza.solvente && proyecta.año === optimiza.año;

      // 6. Crecimiento real con patrimonio negativo: reducir deuda cuenta como crecer y
      //    agrandarla como caer. Antes el tipo se forzaba a 0 mientras el patrimonio fuera
      //    negativo, así que el criterio de retiro seguro no se aplicaba a los planes más
      //    endeudados y aprobaban por omisión.
      const tasas = {
        deudaQueBaja: realGrowthRatePct(220, -1000),
        deudaQueSube: realGrowthRatePct(-50, -1000),
        positivo: realGrowthRatePct(100, 1000),
        ceroQueEmpeora: realGrowthRatePct(-5, 0),
        ceroQueMejora: realGrowthRatePct(5, 0)
      };

      applyStateObject(base); runSimulation();
      return { añosJoven: añosJoven.length, arrastre, settle, negativos, seVació, edades, suelo, sube, amortNegativa, seAmortizó, llegaACero,
        reparto, pensAño1, motoresDeAcuerdo, proyecta, optimiza, tasas };
    });

    assert(r.arrastre.length === 0, `el informe anual arrastra años del plan anterior: ${r.arrastre.slice(0, 5).join(', ')}`);
    assert(r.settle.vacíoNegativo === 0 && r.settle.vacíoPositivo === 0, `una categoría sin lotes debería quedar a cero: ${JSON.stringify(r.settle)}`);
    assert(r.settle.conLotesNegativo === 0 && r.settle.conLotes === 120, `con lotes el saldo no se respeta: ${JSON.stringify(r.settle)}`);
    assert(r.seVació, 'el oro no llegó a agotarse: la prueba no ejercita el caso');
    assert(r.negativos.length === 0, `saldos negativos en el balance: ${r.negativos.slice(0, 5).join(', ')}`);
    assert(r.edades.p1 === '45' && r.edades.p2 === '44', `importar un plan tras otro cambió la edad de retiro: ${JSON.stringify(r.edades)}`);
    assert(r.suelo.p1 === '55' && r.suelo.p2 === '54', `la edad de retiro debería subir a la edad actual del participante: ${JSON.stringify(r.suelo)}`);
    assert(r.seAmortizó && r.llegaACero, 'la prueba de amortización extra no llegó a cancelar deuda');
    assert(r.sube.length === 0, `la deuda reaparece tras amortizarla con el excedente: ${r.sube.slice(0, 3).join(', ')}`);
    assert(r.amortNegativa.length === 0, `amortización negativa en el informe: ${r.amortNegativa.slice(0, 3).join(', ')}`);
    assert(r.reparto.sinDestino.a === 500 && r.reparto.sinDestino.b === 500 && r.reparto.sinDestino.c === 500 && r.reparto.sinDestino.d === undefined,
      `sin destino, la aportación debería repartirse entre los seguros del titular: ${JSON.stringify(r.reparto.sinDestino)}`);
    assert(r.reparto.conDestinoP1.a === 300 && r.reparto.conDestinoP1.b === undefined && r.reparto.conDestinoP1.c === 500,
      `con destino elegido no debe haber reparto de reserva para ese titular: ${JSON.stringify(r.reparto.conDestinoP1)}`);
    assert(r.pensAño1 > 40000, `las aportaciones sin destino no llegan a los seguros: ${Math.round(r.pensAño1)} €`);
    assert(r.motoresDeAcuerdo, `los motores discrepan con aportaciones sin destino: proyección ${JSON.stringify(r.proyecta)} vs optimizador ${JSON.stringify(r.optimiza)}`);
    assert(r.tasas.deudaQueBaja === 22 && r.tasas.deudaQueSube === -5 && r.tasas.positivo === 10,
      `el crecimiento real con patrimonio negativo no se mide sobre el valor absoluto: ${JSON.stringify(r.tasas)}`);
    assert(r.tasas.ceroQueEmpeora === -100 && r.tasas.ceroQueMejora === 0, `crecimiento real desde cero: ${JSON.stringify(r.tasas)}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `informe anual sin arrastre · categoría agotada a cero · edad de retiro estable al importar · deuda amortizada que no vuelve · aportaciones sin destino repartidas · crecimiento real con patrimonio negativo`;
  } finally { await browser.close(); }
}
