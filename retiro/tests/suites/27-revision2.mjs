// Segunda ronda de la revisión de noviembre de 2026. Cada bloque dice qué fallaba; todos se
// escribieron antes que el arreglo y se vieron fallar con el código sin arreglar.
export default async function run({ open, assert, near, capturePdf }) {
  const notas = [];
  const dialogos = [];
  const onDialog = async (d) => { dialogos.push(d.message()); await d.accept(); };
  // Cada bloque corre aunque otro falle, para ver todos los fallos de una pasada; al final se lanza el resumen.
  const fallos = [];
  const bloque = async (nombre, fn) => { try { await fn(); } catch (e) { fallos.push(`[bloque ${nombre}] ${e.message}`); } };

  // ---------------------------------------------------------------------------------------------
  // 1. Un fichero de Balance con `familyMembers: 1` entra con el patrimonio a la mitad. Los activos
  // de Balance no traen titular, y «sin titular» se leía como «conjunto»: sin pareja, lo conjunto
  // cuenta el 50%. La regla es una sola: al entrar, un activo, una deuda o un evento sin titular
  // recibe `p1` si no hay pareja y `joint` si la hay, y `soloShare` sólo escala lo que es
  // `joint` de verdad.
  await bloque('1', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const r = await page.evaluate(() => {
        const base = JSON.parse(JSON.stringify(buildStateObject()));
        const mk = (n) => {
          const s = JSON.parse(JSON.stringify(base));
          delete s.hasPartner; delete s.childrenAges; s.familyMembers = n;
          s.macro.retireAgeP2 = s.macro.retireAgeP1;
          s.realEstateEvents = [
            { id: 'ev1', assetId: 're_buy_x', type: 'buy', year: START_YEAR + 3, name: 'Compra', useType: 'rented', priceTodayEUR: 150000, rentTodayEUR: 700, opexPct: 10, downPct: 20, expPct: 10, hasMort: true, mortRate: 3, mortYears: 25 }
          ];
          // Como Balance: ni activos ni deudas ni eventos traen titular.
          s.assetsData = [
            { id: 'a1', name: 'Cuenta', category: 'cash', currency: 'EUR', value: 10000, cashReturnPct: 1, capitalReturnPct: 0 },
            { id: 'a2', name: 'ETF', category: 'stocks', currency: 'EUR', value: 60000, cashReturnPct: 0, capitalReturnPct: 6 },
            { id: 'a3', name: 'Casa', category: 'real_estate', currency: 'EUR', value: 250000, purchasePrice: 200000, purchaseDate: '2018-01', useType: 'habitual', monthlyRent: 0, hasMaint: true, opexPct: 0 },
            { id: 'a4', name: 'Piso', category: 'real_estate', currency: 'EUR', value: 150000, purchasePrice: 120000, purchaseDate: '2020-01', useType: 'rented', monthlyRent: 800, opexPct: 10 }
          ];
          s.liabilitiesData = [
            { id: 'l1', name: 'Hipoteca', propertyLink: 'a3', currency: 'EUR', subcategory: 'mortgages', initialPrincipal: 150000, startDate: '2018-01', durationMonths: 300, interestRatePct: 2, monthlyPayment: 0 },
            { id: 'l2', name: 'Tarjeta', propertyLink: '', currency: 'EUR', subcategory: 'short_term', initialPrincipal: 2000, startDate: CURRENT_START_DATE, durationMonths: 12, interestRatePct: 15, monthlyPayment: 100 }
          ];
          s.chattelEvents = []; s.customYearlyRouting = {};
          return s;
        };
        const corre = (s) => {
          applyStateObject(JSON.parse(JSON.stringify(s)));
          runSimulation();
          const filas = Object.values(annualReportsData).sort((a, b) => a.year - b.year);
          const opt = evaluateRetirementSafety(Number(s.macro.retireAgeP1), Number(s.macro.retireAgeP1), { collect: true }).series;
          return {
            hasPartner, owners: [...new Set(assetsData.map(a => a.owner))], ownersEv: realEstateEvents.map(e => e.owner),
            hoy: filas[0].prevNW, nw: filas.slice(0, 8).map(x => x.endNW), rnw: filas.slice(0, 8).map(x => x.endRealNW), re: filas.slice(0, 8).map(x => x.endRE), debt: filas.slice(0, 8).map(x => x.endDebt),
            opt: opt.slice(0, 8).map(p => p.realNW), pdf: null
          };
        };
        const uno = corre(mk(1)), dos = corre(mk(2));
        return { uno, dos };
      });
      assert(!r.uno.hasPartner && r.dos.hasPartner, 'familyMembers 1 = sin pareja; 2 = con pareja');
      assert(r.uno.owners.length === 1 && r.uno.owners[0] === 'p1', `sin pareja, los activos sin titular entran como p1: ${JSON.stringify(r.uno.owners)}`);
      assert(r.dos.owners.length === 1 && r.dos.owners[0] === 'joint', `con pareja, entran como conjuntos: ${JSON.stringify(r.dos.owners)}`);
      assert(r.uno.ownersEv[0] === 'p1' && r.dos.ownersEv[0] === 'joint', `los eventos sin titular también: ${JSON.stringify([r.uno.ownersEv, r.dos.ownersEv])}`);
      // El patrimonio de hoy es activos − deudas, a tamaño completo, con una persona o con dos.
      near(r.uno.hoy, r.dos.hoy, 1, 'el patrimonio de hoy no depende de cuántos son en el hogar');
      for (let i = 0; i < 8; i++) {
        near(r.uno.re[i], r.dos.re[i], 1, `inmuebles al cierre del año ${i} (una persona = dos)`);
        near(r.uno.debt[i], r.dos.debt[i], 1, `deuda al cierre del año ${i}`);
      }
      // Con los mismos activos, una persona no puede tener la MITAD del patrimonio de dos: las
      // trayectorias se mueven por el gasto (que sí cambia), no por un salto de 126 K a 428 K.
      assert(r.uno.nw[0] > r.uno.hoy * 0.7 && r.uno.nw[0] < r.uno.hoy * 1.5, `el patrimonio no salta del año 0 al cierre del primero: ${r.uno.hoy} → ${r.uno.nw[0]}`);
      // Los dos motores de la proyección, con una persona y todo a nombre de p1.
      for (let i = 0; i < 8; i++) near(r.uno.opt[i], r.uno.rnw[i], 5, `motores en acuerdo con una persona, año ${i}`);
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('Balance con una persona entra completo (activos sin titular = p1)');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 2. Los años de una etapa que no son enteros contaban por exceso: la pensión pública recorría
  // las etapas con `y < años` (techo), así que 8 etapas de 0,25 años eran 8 años cotizados y una
  // de 2,25 eran 3. Cada etapa aporta `min(1, resto)` por vuelta, en los años cotizados, en el
  // devengo de paro y en el salario medio.
  await bloque('2', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const r = await page.evaluate(() => {
        const edad = careers[1].age;
        const prueba = (stages, cotizados, paro) => {
          careers[1].stages = stages.map(([type, years, salary]) => ({ type, years, salary: salary || 0 }));
          careers[1].cotizados = cotizados; careers[1].paroInitMonths = paro;
          return { anos: getParticipantContributedYears(1, edad + 10), sal: getParticipantAvgSalary(1, edad + 10) };
        };
        return {
          ocho: prueba(Array.from({ length: 8 }, () => ['employed', 0.25, 30000]), 0, 0),
          dosVeinticinco: prueba([['employed', 2.25, 30000], ['unemployed', 3, 0]], 0, 0),
          soloParo: prueba([['unemployed', 2.25, 0]], 0, 24),
          pesos: prueba([['employed', 0.5, 40000], ['employed', 1.5, 20000]], 0, 0),
          enteras: prueba([['employed', 3, 30000], ['unemployed', 2, 0], ['employed', 1, 30000]], 5, 12)
        };
      });
      near(r.ocho.anos, 2, 1e-9, '8 etapas de 0,25 años son 2 años cotizados');
      // 2,25 trabajados devengan 0,7425 años de paro (0,33 por año): es lo que se cobra después.
      near(r.dosVeinticinco.anos, 2.25 + 0.33 * 2.25, 1e-9, '2,25 años trabajados + paro: 2,25 + el crédito devengado');
      near(r.soloParo.anos, 2, 1e-9, '2,25 años en paro con 24 meses devengados cuentan 2 (el tope)');
      near(r.pesos.sal, (0.5 * 40000 + 1.5 * 20000) / 2, 1e-6, 'el salario medio pondera por la fracción de año');
      near(r.ocho.sal, 30000, 1e-9, 'salario medio con etapas de un cuarto de año');
      // Con años enteros nada cambia: 5 de partida + 3 + paro (1 + 0,99: 12 meses de partida más
      // 0,99 devengados trabajando) + 1.
      near(r.enteras.anos, 5 + 3 + 1 + 0.99 + 1, 1e-9, 'etapas enteras: igual que antes');
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('años de etapa decimales por fracción, no por techo');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 3. Un seguro de jubilación «Conjunto» perdía las aportaciones por defecto: el reparto filtraba
  // `owner === titular` y un seguro conjunto no es de nadie. `ownerHasTarget` ya aceptaba `joint`.
  // Primero los seguros del titular; si no tiene ninguno, los conjuntos.
  await bloque('3', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const r = await page.evaluate(() => {
        const unit = {
          soloConjunto: spreadPensionContributions([{ id: 'pi', category: 'pensionIns', owner: 'joint' }], {}, 1000, 0),
          dosConjunto: spreadPensionContributions([{ id: 'pi', category: 'pensionIns', owner: 'joint' }], {}, 1000, 500),
          propioGana: spreadPensionContributions([{ id: 'pi', category: 'pensionIns', owner: 'joint' }, { id: 'p1i', category: 'pensionIns', owner: 'p1' }], {}, 1000, 0)
        };
        // De punta a punta: con 0 € de saldo, un seguro conjunto y uno de p1 son equivalentes
        // (sin pareja el conjunto se escala al 50% de cero), así que tienen que dar lo mismo.
        const base = JSON.parse(JSON.stringify(buildStateObject()));
        const out = {};
        for (const pareja of [true, false]) {
          for (const ow of ['joint', 'p1']) {
            const s = JSON.parse(JSON.stringify(base));
            s.hasPartner = pareja; if (!pareja) { s.childrenAges = []; s.familyMembers = 1; s.macro.retireAgeP2 = s.macro.retireAgeP1; }
            s.assetsData = s.assetsData.filter(a => a.category !== 'pensionIns' && a.category !== 'pensions');
            s.assetsData.push({ id: 'pi1', name: 'Seguro', category: 'pensionIns', owner: ow, currency: 'EUR', value: 0, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 3 });
            s.careers[1].stages.forEach(st => { st.targetAssetId = ''; st.empPensionPct = 5; st.compPensionPct = 8; });
            s.careers[2].stages.forEach(st => { st.targetAssetId = ''; st.empPensionPct = 5; st.compPensionPct = 8; });
            applyStateObject(s); runSimulation();
            const rep = Object.values(annualReportsData).sort((a, b) => a.year - b.year);
            const o = evaluateRetirementSafety(Number(s.macro.retireAgeP1), Number(s.macro.retireAgeP2), { collect: true });
            out[(pareja ? 'par_' : 'solo_') + ow] = { pens: rep.slice(0, 4).map(d => d.endPens), opt: o.series.slice(0, 4).map(p => p.realNW), nw: rep.slice(0, 4).map(d => d.endRealNW) };
          }
        }
        return { unit, out };
      });
      near(r.unit.soloConjunto.pi || 0, 1000, 1e-9, 'sin otro destino, la aportación de p1 va al seguro conjunto');
      near(r.unit.dosConjunto.pi || 0, 1500, 1e-9, 'las aportaciones de los dos van al seguro conjunto');
      near(r.unit.propioGana.p1i || 0, 1000, 1e-9, 'con un seguro propio, la aportación va al propio');
      assert(!r.unit.propioGana.pi, 'y no se reparte además al conjunto');
      for (const k of ['par', 'solo']) {
        const j = r.out[k + '_joint'], p = r.out[k + '_p1'];
        assert(p.pens[2] > 1000, `(${k}) el seguro de p1 recibe las aportaciones: ${p.pens[2]}`);
        assert(j.pens[2] > 1000, `(${k}) el seguro conjunto también las recibe: ${j.pens[2]}`);
        for (let i = 0; i < 4; i++) near(j.opt[i], j.nw[i], 5, `(${k}) los dos motores coinciden con seguro conjunto, año ${i}`);
      }
      assert(r.out.par_joint.pens[2] >= r.out.par_p1.pens[2] - 1, 'con pareja, lo conjunto recibe las aportaciones de ambos titulares');
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('seguro conjunto recibe las aportaciones por defecto');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 4. Sin pareja, los activos de P2 entraban en la proyección (inmuebles, ventas programadas,
  // pensiones, hipotecas vinculadas) pero no en el punto de partida: el patrimonio saltaba en el
  // primer año. La propiedad: un plan sin pareja con un inmueble de P2, su hipoteca, una venta y
  // una compra a nombre de P2 tiene que dar EXACTAMENTE lo mismo que el mismo plan sin nada de eso.
  await bloque('4', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const r = await page.evaluate(() => {
        const base = JSON.parse(JSON.stringify(buildStateObject()));
        const mk = (conP2) => {
          const s = JSON.parse(JSON.stringify(base));
          s.hasPartner = false; s.childrenAges = []; s.familyMembers = 1; s.macro.retireAgeP2 = s.macro.retireAgeP1;
          s.assetsData = s.assetsData.filter(a => a.owner !== 'p2' && a.id !== 're_2');
          s.liabilitiesData = s.liabilitiesData.filter(l => l.propertyLink !== 're_2');
          s.realEstateEvents = []; s.chattelEvents = [];
          if (conP2) {
            s.assetsData.push({ id: 'rp2', name: 'Piso de P2', category: 'real_estate', owner: 'p2', currency: 'EUR', value: 180000, purchasePrice: 150000, purchaseDate: '2021-03', useType: 'rented', monthlyRent: 900, opexPct: 15, hasMaint: false });
            s.assetsData.push({ id: 'dp2', name: 'Dividendos P2', category: 'divStocks', owner: 'p2', currency: 'EUR', value: 20000, cashReturnPct: 3.5, capitalReturnPct: 3 });
            s.assetsData.push({ id: 'pp2', name: 'Plan P2', category: 'pensions', owner: 'p2', currency: 'EUR', value: 30000, capitalReturnPct: 4 });
            s.liabilitiesData.push({ id: 'hp2', name: 'Hipoteca P2', propertyLink: 'rp2', currency: 'EUR', subcategory: 'mortgages', initialPrincipal: 100000, startDate: '2021-03', durationMonths: 300, interestRatePct: 2.5, monthlyPayment: 0 });
            s.realEstateEvents = [
              { id: 'bp2', assetId: 're_buy_p2', type: 'buy', year: START_YEAR + 2, name: 'Compra P2', useType: 'rented', owner: 'p2', priceTodayEUR: 250000, rentTodayEUR: 1000, opexPct: 10, downPct: 20, expPct: 10, hasMort: true, mortRate: 3, mortYears: 25 },
              { id: 'sp2', assetId: 'rp2', type: 'sell', year: START_YEAR + 4 }
            ];
          }
          return s;
        };
        const corre = (s) => {
          applyStateObject(JSON.parse(JSON.stringify(s))); runSimulation();
          const filas = Object.values(annualReportsData).sort((a, b) => a.year - b.year).slice(0, 8);
          const opt = evaluateRetirementSafety(Number(s.macro.retireAgeP1), Number(s.macro.retireAgeP1), { collect: true }).series.slice(0, 8);
          return { hoy: filas[0].prevNW, nw: filas.map(x => x.endNW), re: filas.map(x => x.endRE), debt: filas.map(x => x.endDebt), rent: filas.map(x => x.netRental), pens: filas.map(x => x.endPens), opt: opt.map(p => p.realNW) };
        };
        return { con: corre(mk(true)), sin: corre(mk(false)) };
      });
      near(r.con.hoy, r.sin.hoy, 0.01, 'el punto de partida ignora a P2');
      for (let i = 0; i < 8; i++) {
        near(r.con.nw[i], r.sin.nw[i], 0.5, `patrimonio al cierre del año ${i}: lo de P2 no cuenta sin pareja`);
        near(r.con.re[i], r.sin.re[i], 0.5, `inmuebles año ${i}`);
        near(r.con.debt[i], r.sin.debt[i], 0.5, `deuda año ${i}`);
        near(r.con.rent[i], r.sin.rent[i], 0.5, `alquiler neto año ${i}`);
        near(r.con.pens[i], r.sin.pens[i], 0.5, `pensiones año ${i}`);
        near(r.con.opt[i], r.sin.opt[i], 0.5, `optimizador año ${i}`);
      }
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('sin pareja, nada de P2 entra en ningún bucle');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 5. Importar recortaba el dividendo al máximo ANTIGUO del deslizador (que es el crecimiento de
  // antes): un fichero con crecimiento 8 y dividendo 5 volvía con 3 si el crecimiento previo era 3.
  await bloque('5', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const r = await page.evaluate(() => {
        const sl = document.getElementById('stockGrowthParam'); sl.value = 3; sl.dispatchEvent(new Event('input', { bubbles: true }));
        const antes = document.getElementById('divYieldParam').max;
        const s = JSON.parse(JSON.stringify(buildStateObject()));
        s.macro.stockGrowth = 8; s.macro.divYield = 5;
        applyStateObject(s);
        const dentro = { div: document.getElementById('divYieldParam').value, max: document.getElementById('divYieldParam').max, p: readSimParams().divYield };
        // Un dividendo mayor que el crecimiento sigue recortándose al crecimiento.
        const s2 = JSON.parse(JSON.stringify(s)); s2.macro.stockGrowth = 4; s2.macro.divYield = 7;
        applyStateObject(s2);
        return { antes, dentro, mayor: document.getElementById('divYieldParam').value };
      });
      assert(Number(r.antes) <= 3.0001, 'el máximo del deslizador seguía al crecimiento previo (3): ' + r.antes);
      near(Number(r.dentro.div), 5, 1e-9, 'crecimiento 8 y dividendo 5 se quedan en 5');
      near(r.dentro.p, 0.05, 1e-9, 'y la proyección usa 5%');
      near(Number(r.mayor), 4, 1e-9, 'un dividendo por encima del crecimiento se recorta a éste');
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('dividendo importado no se recorta al máximo viejo');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 6a. `familyMembers` mayor que lo representable (pareja y 5 hijos = 7) vuelve recortado; se avisa.
  await bloque('6', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const fichero = (n) => page.evaluate((n) => {
        const s = JSON.parse(JSON.stringify(buildStateObject())); delete s.hasPartner; delete s.childrenAges; s.familyMembers = n;
        return JSON.stringify(s);
      }, n);
      dialogos.length = 0;
      await page.setInputFiles('#fullBackupInput', { name: 'balance.txt', mimeType: 'text/plain', buffer: Buffer.from(await fichero(9)) });
      await page.waitForTimeout(2500);
      const aviso9 = dialogos.join(' | ');
      dialogos.length = 0;
      await page.setInputFiles('#fullBackupInput', { name: 'balance.txt', mimeType: 'text/plain', buffer: Buffer.from(await fichero(7)) });
      await page.waitForTimeout(2500);
      const aviso7 = dialogos.join(' | ');
      assert(/recort/i.test(aviso9) && /9/.test(aviso9), `un hogar de 9 no cabe y debe avisar del recorte: ${aviso9}`);
      assert(!/recort/i.test(aviso7), `un hogar de 7 sí cabe: ${aviso7}`);
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('aviso de hogar recortado');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 6b. En el PDF, la compra programada sin pareja enseñaba el precio entero aunque el cálculo usa el
  // 50%: se muestra la parte que cuenta.
  await bloque('7', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      await capturePdf(page);
      const r = await page.evaluate(() => {
        const s = JSON.parse(JSON.stringify(buildStateObject()));
        s.hasPartner = false; s.childrenAges = []; s.familyMembers = 1; s.macro.retireAgeP2 = s.macro.retireAgeP1;
        s.realEstateEvents = [{ id: 'ev1', assetId: 're_buy_x', type: 'buy', year: START_YEAR + 3, name: 'CompraConjunta', useType: 'rented', owner: 'joint', priceTodayEUR: 250000, rentTodayEUR: 700, opexPct: 10, downPct: 20, expPct: 10, hasMort: false, mortRate: 3, mortYears: 25 }];
        applyStateObject(s); runSimulation(); window.__pdf = null; generatePDFReport();
        const l1 = ((window.__pdf || '').match(/<div>•[^\n]*CompraConjunta[^\n]*<\/div>/) || [''])[0];
        s.hasPartner = true; s.familyMembers = 2;
        applyStateObject(s); runSimulation(); window.__pdf = null; generatePDFReport();
        const l2 = ((window.__pdf || '').match(/<div>•[^\n]*CompraConjunta[^\n]*<\/div>/) || [''])[0];
        return { l1, l2, mitad: fmt(125000), entero: fmt(250000) };
      });
      assert(r.l1.includes(r.entero) && r.l1.includes(r.mitad), `sin pareja, la línea muestra el precio y la parte que cuenta: ${r.l1}`);
      assert(r.l2.includes(r.entero) && !r.l2.includes(r.mitad), `con pareja, el precio entero y nada más: ${r.l2}`);
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('PDF: compra sin pareja muestra la parte que cuenta');
    } finally { await browser.close(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 6c. Escape cerraba la bienvenida sin recordarlo, y reaparecía en cada carga.
  await bloque('8', async () => {
    const { browser, page, errors } = await open({ onDialog });
    try {
      await page.evaluate(() => { try { localStorage.removeItem('fire_simulator_welcome_seen'); } catch (e) {} openGenericModal('welcomeModal'); });
      await page.keyboard.press('Escape');
      const r = await page.evaluate(() => ({
        oculta: document.getElementById('welcomeModal').classList.contains('hidden'),
        visto: (() => { try { return localStorage.getItem('fire_simulator_welcome_seen'); } catch (e) { return 'n/a'; } })()
      }));
      assert(r.oculta, 'Escape cierra la bienvenida');
      assert(r.visto === 'true', `y la marca como vista, igual que el botón: ${r.visto}`);
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('Escape cierra la bienvenida por la vía normal');
    } finally { await browser.close(); }
  });

  if (fallos.length) assert(false, fallos.join('\n    '));
  return notas.join(' · ');
}
