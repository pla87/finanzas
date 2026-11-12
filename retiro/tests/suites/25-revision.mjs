// Arreglos de la revisión de noviembre de 2026. Cada bloque dice qué fallaba; todos se escribieron
// antes que el arreglo y se vieron fallar con el código roto.
export default async function run({ open, assert, near, capturePdf }) {
  const notas = [];

  // ---------------------------------------------------------------------------------------------
  // 1. «Sin pareja» y activos «Conjunto (50/50)»: el punto de partida contaba lo conjunto al 50%
  // pero la proyección contaba al 100% el inmueble, su alquiler, su mantenimiento, su
  // amortización fiscal, la hipoteca vinculada y las compras programadas (patrimonio de 126 K hoy
  // a 428 K al cierre del primer año con los datos de ejemplo).
  //
  // La propiedad que lo fija: un plan con todo «conjunto» a tamaño completo tiene que dar EXACTAMENTE
  // lo mismo que el mismo plan con todo a nombre de uno solo y a la mitad de tamaño. Se comprueba en
  // los dos motores, año a año.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const base = JSON.parse(JSON.stringify(buildStateObject()));
        const mk = (conjunto) => {
          const f = conjunto ? 1 : 0.5, owner = conjunto ? 'joint' : 'p1';
          const s = JSON.parse(JSON.stringify(base));
          s.hasPartner = false;
          s.childrenAges = [];
          s.assetsData = [
            { id: 'c1', name: 'Caja', category: 'cash', owner, currency: 'EUR', value: 40000 * f, cashReturnPct: 1, capitalReturnPct: 0 },
            { id: 's1', name: 'Bolsa', category: 'stocks', owner, currency: 'EUR', value: 90000 * f, cashReturnPct: 1.5, capitalReturnPct: 5 },
            { id: 'b1', name: 'Renta fija', category: 'bonds', owner, currency: 'EUR', value: 20000 * f },
            // El plan propio no se escala; el plan conjunto sí (cuenta el 50% sin pareja).
            { id: 'p1', name: 'Plan', category: 'pensions', owner: 'p1', currency: 'EUR', value: 30000, capitalReturnPct: 4 },
            { id: 'pj', name: 'Plan conjunto', category: 'pensions', owner, currency: 'EUR', value: 20000 * f, capitalReturnPct: 3 },
            { id: 're1', name: 'Casa', category: 'real_estate', owner, currency: 'EUR', value: 300000 * f, purchasePrice: 220000 * f, purchaseDate: '2018-01', useType: 'habitual', monthlyRent: 0, hasMaint: true, opexPct: 0 },
            { id: 're2', name: 'Piso', category: 'real_estate', owner, currency: 'EUR', value: 200000 * f, purchasePrice: 150000 * f, purchaseDate: '2020-01', useType: 'rented', monthlyRent: 1000 * f, opexPct: 10 },
            { id: 're3', name: 'Otro piso', category: 'real_estate', owner, currency: 'EUR', value: 160000 * f, purchasePrice: 120000 * f, purchaseDate: '2020-01', useType: 'rented', monthlyRent: 0, opexPct: 10 }
          ];
          s.liabilitiesData = [
            { id: 'h1', name: 'Hipoteca casa', propertyLink: 're1', currency: 'EUR', subcategory: 'mortgages', initialPrincipal: 200000 * f, startDate: '2018-01', durationMonths: 300, interestRatePct: 2, monthlyPayment: 0 },
            { id: 'h2', name: 'Hipoteca piso', propertyLink: 're2', currency: 'EUR', subcategory: 'mortgages', initialPrincipal: 120000 * f, startDate: '2020-01', durationMonths: 300, interestRatePct: 2.5, monthlyPayment: 0 },
            // Sin vínculo: no tiene titular y se cuenta entera en los dos planes.
            { id: 'l1', name: 'Préstamo', propertyLink: '', currency: 'EUR', subcategory: 'personal_loans', initialPrincipal: 6000, startDate: CURRENT_START_DATE, durationMonths: 24, interestRatePct: 5, monthlyPayment: 0 }
          ];
          s.realEstateEvents = [
            { id: 'ev1', assetId: 're_buy_x', type: 'buy', year: START_YEAR + 3, name: 'Compra', useType: 'rented', owner, priceTodayEUR: 150000 * f, rentTodayEUR: 700 * f, opexPct: 10, downPct: 20, expPct: 10, hasMort: true, mortRate: 3, mortYears: 25 },
            { id: 'ev2', assetId: 're3', type: 'sell', year: START_YEAR + 6 }
          ];
          s.chattelEvents = [];
          s.customYearlyRouting = {};
          return s;
        };
        const corre = (s) => {
          applyStateObject(JSON.parse(JSON.stringify(s)));
          runSimulation();
          const filas = Object.values(annualReportsData).sort((a, b) => a.year - b.year);
          const A1 = Number(s.macro.retireAgeP1), A2 = Number(s.macro.retireAgeP2);
          const opt = evaluateRetirementSafety(A1, A2, { collect: true }).series;
          return { filas: filas.map(x => ({ y: x.year, nw: x.endNW, re: x.endRE, debt: x.endDebt, prev: x.prevNW, rent: x.netRental })), opt: opt.map(p => ({ y: p.year, nw: p.realNW })) };
        };
        const a = corre(mk(true)), b = corre(mk(false));
        applyStateObject(JSON.parse(JSON.stringify(base))); runSimulation();
        return { a, b };
      });
      assert(errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, `errores de consola: ${errors.join(' | ')}`);
      const n = Math.min(r.a.filas.length, r.b.filas.length);
      assert(n > 30, `la proyección no tiene años: ${n}`);
      let peor = { d: 0 };
      for (let i = 0; i < n; i++) {
        for (const k of ['nw', 're', 'debt', 'rent']) {
          const d = Math.abs(r.a.filas[i][k] - r.b.filas[i][k]);
          if (d > peor.d) peor = { d, k, y: r.a.filas[i].y, a: r.a.filas[i][k], b: r.b.filas[i][k] };
        }
      }
      assert(peor.d < 0.5, `sin pareja, lo conjunto a tamaño completo no equivale a lo mismo a nombre de uno a la mitad: ${JSON.stringify(peor)}`);
      let peorOpt = { d: 0 };
      const m = Math.min(r.a.opt.length, r.b.opt.length);
      for (let i = 0; i < m; i++) {
        const d = Math.abs(r.a.opt[i].nw - r.b.opt[i].nw);
        if (d > peorOpt.d) peorOpt = { d, y: r.a.opt[i].y, a: r.a.opt[i].nw, b: r.b.opt[i].nw };
      }
      assert(peorOpt.d < 0.5, `lo mismo en el optimizador: ${JSON.stringify(peorOpt)}`);
      notas.push(`sin pareja: conjunto = mitad a nombre de uno (${n} años, ≤ ${peor.d.toFixed(2)} €)`);
    } finally { await browser.close(); }
  }

  // Con los datos de ejemplo y Pareja = No, el patrimonio del primer año no salta más que lo que
  // explican un año de ahorro y de revalorización.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        document.getElementById('exp_hasPartner').value = 'no'; togglePartnerAndRun();
        const filas = Object.values(annualReportsData).sort((a, b) => a.year - b.year);
        // Y los dos motores ven el mismo patrimonio real todos los años.
        const opt = evaluateRetirementSafety(parseInt(document.getElementById('retireAge').value), parseInt(document.getElementById('retireAgeP2').value), { collect: true }).series;
        let motores = 0;
        for (const p of opt) { const f = filas.find(x => x.year === p.year); if (f) motores = Math.max(motores, Math.abs(f.endRealNW - p.realNW)); }
        return { prev: filas[0].prevNW, fin: filas[0].endNW, motores };
      });
      const salto = r.fin - r.prev;
      assert(Math.abs(salto) < 0.15 * Math.abs(r.prev) + 40000, `sin pareja el patrimonio salta de ${Math.round(r.prev)} a ${Math.round(r.fin)} en el primer año`);
      assert(r.motores < 1, `sin pareja los dos motores discrepan en ${r.motores.toFixed(2)} €`);
      notas.push(`datos de ejemplo sin pareja: ${Math.round(r.prev / 1000)} K hoy → ${Math.round(r.fin / 1000)} K al cierre del año 1`);
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 2. «Patrimonio al retiro»: era el año en que el MAYOR cumple la edad más alta de retiro, no el
  // cierre del año en que se jubila el ÚLTIMO de los dos. Con P1 de 40 años que se jubila a los 50
  // y P2 de 30 que se jubila a los 45, el último en jubilarse es P2 (dentro de 15 años) y el KPI
  // enseñaba el cierre del año 10 (cuando P1 llega a 50). El PDF lee el mismo KPI.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const casos = [
          { a1: 40, a2: 30, r1: 50, r2: 45 },   // el último es P2 aunque su edad sea menor
          { a1: 40, a2: 38, r1: 55, r2: 50 },   // el último es P1
          { a1: 36, a2: 40, r1: 46, r2: 52 },   // el último es P2 y además el mayor
        ];
        return casos.map(c => {
          document.getElementById('p1_age').value = c.a1; document.getElementById('p2_age').value = c.a2;
          document.getElementById('retireAge').value = c.r1; document.getElementById('retireAgeP2').value = c.r2;
          runSimulation();
          const idx = Math.max(c.r1 - c.a1, c.r2 - c.a2);
          const fila = annualReportsData[START_YEAR + idx];
          return {
            c, idx,
            kpi: document.getElementById('kpiRetireNW').innerText,
            esperado: fmtCompact(fila.endNW),
            real: document.getElementById('kpiRetireRealNW').innerText,
            esperadoReal: 'Real: ' + fmtCompact(fila.endRealNW),
            etiqueta: document.getElementById('kpiRetireAgeText').innerText
          };
        });
      });
      for (const x of r) {
        assert(x.kpi === x.esperado, `patrimonio al retiro ${JSON.stringify(x.c)}: el KPI dice ${x.kpi} y el cierre del año en que se jubila el último (año +${x.idx}) es ${x.esperado}`);
        assert(x.real === x.esperadoReal, `patrimonio real al retiro ${JSON.stringify(x.c)}: ${x.real} y debería ser ${x.esperadoReal}`);
        assert(x.etiqueta.includes(String(x.c.r1)) && x.etiqueta.includes(String(x.c.r2)), `la etiqueta del KPI no nombra las dos edades de retiro: «${x.etiqueta}»`);
      }
      assert(errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, `errores de consola: ${errors.join(' | ')}`);
      notas.push('KPI patrimonio al retiro = cierre del año del último en jubilarse');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Campo vacío en la aportación al plan, el coste de cuidados o el crecimiento de la pensión:
  // `parseFloat(x) ?? defecto` no atrapa NaN (un campo vacío da NaN, no null), así que toda la
  // proyección salía NaN y el autoguardado lo escribía. Un cero deliberado sigue siendo cero.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const out = {};
        const fija = (id, v) => { document.getElementById(id).value = v; };
        const finito = () => {
          const filas = Object.values(annualReportsData);
          return filas.length > 0 && filas.every(f => Number.isFinite(f.endNW) && Number.isFinite(f.endRealNW));
        };
        for (const id of ['param_ppContribution', 'exp_elderCareMonthly']) {
          const antes = document.getElementById(id).value;
          fija(id, '');
          const P = readSimParams();
          runSimulation();
          const o = evaluateRetirementSafety(parseInt(document.getElementById('retireAge').value), parseInt(document.getElementById('retireAgeP2').value));
          out[id] = { vacio: { p: [P.ppContribution, P.elderCareMonthly, P.pensionGrowth], finito: finito(), solv: typeof o.solvency.pass } };
          fija(id, '0');
          const P0 = readSimParams();
          out[id].cero = [P0.ppContribution, P0.elderCareMonthly, P0.pensionGrowth];
          fija(id, antes);
        }
        // El crecimiento de la pensión es un deslizador y no admite vacío, pero un 0 deliberado
        // tampoco puede convertirse en otra cosa.
        fija('pensionGrowthParam', '0');
        out.pg0 = readSimParams().pensionGrowth;
        // Con el campo de meses de paro vacío, lo que se guarda tiene que ser un número.
        document.getElementById('p1_paro_init').value = '';
        document.getElementById('p2_paro_init').value = '';
        const st = buildStateObject();
        out.paro = [st.careers[1].paroInitMonths, st.careers[2].paroInitMonths];
        return out;
      });
      const [pp, ec] = [r.param_ppContribution, r.exp_elderCareMonthly];
      assert(pp.vacio.p[0] === 1500 && ec.vacio.p[1] === 500,
        `un campo vacío no vuelve a su valor por defecto: ${JSON.stringify({ pp: pp.vacio.p, ec: ec.vacio.p })}`);
      assert(pp.vacio.finito && ec.vacio.finito, 'con un campo vacío la proyección tiene valores no finitos');
      assert(pp.cero[0] === 0 && ec.cero[1] === 0 && r.pg0 === 0, `un cero deliberado deja de serlo: ${JSON.stringify({ pp: pp.cero, ec: ec.cero, pg: r.pg0 })}`);
      assert(r.paro.every(Number.isFinite), `meses de paro vacíos se guardan como ${JSON.stringify(r.paro)}`);
      notas.push('campos vacíos: valor por defecto y no NaN');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 4. Importar un fichero con ceros DELIBERADOS en números (Balance exporta números, no cadenas):
  // `x || defecto` los convertía en el valor por defecto (costes operativos 0% → 15%, deducción
  // 0% → 50%, rendimiento de dividendos 0% → 3%...). Lo que debe quedar es lo que quedaría al
  // teclear ese cero en el campo, con el mínimo del deslizador si lo tiene.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const mapa = {
          stockGrowth: 'stockGrowthParam', divYield: 'divYieldParam', cashYield: 'cashYieldParam', inflation: 'inflationParam',
          reMaint: 'param_reMaint', reOpex: 'param_reOpex', reDeduction: 'param_reDeduction', bufferMonths: 'bufferMonthsParam',
          childrenEmancipationAge: 'exp_childrenEmancipationAge', reRentalYield: 'reRentalYieldParam'
        };
        const st = JSON.parse(JSON.stringify(buildStateObject()));
        for (const k of Object.keys(mapa)) st.macro[k] = 0;
        // Lo que daría teclear el cero a mano (con el mínimo del campo).
        const esperado = {};
        for (const id of Object.values(mapa)) { const el = document.getElementById(id); el.value = '0'; let v = el.value; if (el.type === 'number' && el.min !== '') v = String(Math.max(Number(el.min), Number(v))); esperado[id] = v; }
        applyStateObject(JSON.parse(JSON.stringify(st)));
        const tras = {};
        for (const id of Object.values(mapa)) tras[id] = document.getElementById(id).value;
        // La inflación inmobiliaria y la de rentas heredan la general cuando el fichero no las trae.
        const st2 = JSON.parse(JSON.stringify(st));
        st2.macro.inflation = 0; delete st2.macro.propertyInflation; delete st2.macro.rentInflation;
        applyStateObject(st2);
        const el = document.getElementById('inflationParam');
        const hereda = { inflacion: el.value, propiedad: document.getElementById('propertyInflationParam').value, rentas: document.getElementById('rentInflationParam').value };
        // Edad de retiro 0 en el fichero: no puede volver como 45.
        const st3 = JSON.parse(JSON.stringify(buildStateObject()));
        st3.macro.retireAgeP1 = 0; st3.macro.retireAgeP2 = 0;
        applyStateObject(st3);
        const retiro = [parseInt(document.getElementById('retireAge').value), Number(careers[1].age)];
        return { esperado, tras, hereda, retiro };
      });
      const malos = Object.keys(r.esperado).filter(id => r.esperado[id] !== r.tras[id]);
      assert(malos.length === 0, `ceros del fichero convertidos en el valor por defecto: ` + malos.map(id => `${id}: ${r.tras[id]} (debía ser ${r.esperado[id]})`).join('; '));
      assert(r.hereda.propiedad === r.hereda.inflacion && r.hereda.rentas === r.hereda.inflacion, `la inflación inmobiliaria no hereda la general con un 0: ${JSON.stringify(r.hereda)}`);
      assert(r.retiro[0] !== 45 || r.retiro[1] === 45, `una edad de retiro 0 vuelve como 45: ${JSON.stringify(r.retiro)}`);
      notas.push('ceros del fichero se respetan al importar');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 5. Guardar un activo desde el modal recortaba a 0 los porcentajes negativos (el efectivo con
  // tipo por debajo de cero, un activo que se deprecia). Los importes siguen sin admitir negativos.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        editAssetModal('cash_4');
        for (const [chk, inp, v] of [['modalAssetCashReturnCoupled', 'modalAssetCashReturn', '-1.5'], ['modalAssetCapReturnCoupled', 'modalAssetCapReturn', '-2.25']]) {
          document.getElementById(chk).checked = false;
          document.getElementById(inp).readOnly = false;
          document.getElementById(inp).value = v;
        }
        document.getElementById('modalAssetUseReturn').value = '-1';
        document.getElementById('modalAssetValue').value = '-500';
        saveAssetModal({ preventDefault() {} });
        const a = assetsData.find(x => x.id === 'cash_4');
        return { cash: a.cashReturnPct, cap: a.capitalReturnPct, use: a.useReturnPct, value: a.value };
      });
      assert(r.cash === -1.5 && r.cap === -2.25 && r.use === -1, `los porcentajes negativos se recortan al guardar: ${JSON.stringify(r)}`);
      assert(r.value === 0, `un importe negativo debe quedar en 0: ${r.value}`);
      notas.push('porcentajes negativos se conservan al guardar un activo');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 6. Importar: aceptaba cualquier JSON (un `[]` o un fichero de otra cosa «cargaba» sin
  // cambiar nada y decía que bien, o dejaba a medias el estado), no era atómico (si algo fallaba
  // a mitad, medio plan nuevo y medio viejo) y no dejaba volver a elegir el mismo fichero.
  {
    const mensajes = [];
    const { browser, page, errors } = await open({ onDialog: (d) => { mensajes.push(d.message()); d.accept(); } });
    try {
      const importa = async (texto, antesDeImportar) => {
        const n0 = mensajes.length;
        const r = await page.evaluate(async ({ texto, antesDeImportar }) => {
          if (antesDeImportar) (new Function(antesDeImportar))();
          const input = { files: [new File([texto], 'copia.json')], value: 'C:\\fakepath\\copia.json' };
          importData({ target: input });
          // La lectura es asíncrona: se espera a que el valor se limpie o a que pase un rato.
          for (let i = 0; i < 100 && input.value !== ''; i++) await new Promise(res => setTimeout(res, 20));
          return { valor: input.value };
        }, { texto, antesDeImportar });
        for (let i = 0; i < 100 && mensajes.length === n0; i++) await page.waitForTimeout(20);
        return { ...r, mensaje: mensajes[mensajes.length - 1] || '' };
      };
      const foto = () => page.evaluate(() => { const s = buildStateObject(); delete s.exportDate; return JSON.stringify(s); });
      const antes = await foto();

      // a) Formas que no son una copia de seguridad.
      const basura = ['[]', 'null', '"hola"', '42', '{}', '{"foo":1}', '{"careers":{"1":{"stages":5}}}', '{"careers":5}',
        '{"assetsData":"x"}', '{"liabilitiesData":{}}', '{"assetsData":[1,2]}', '{"macro":[1]}', 'esto no es json'];
      for (const t of basura) {
        const x = await importa(t);
        assert(x.mensaje.startsWith('❌'), `«${t}» no se rechaza con un mensaje de error: «${x.mensaje}»`);
        assert(x.valor === '', `tras importar «${t}» no se puede volver a elegir el mismo fichero (value = «${x.valor}»)`);
        assert((await foto()) === antes, `importar «${t}» cambió el estado`);
      }
      assert(/copia|formato|reconoc/i.test(mensajes.find(m => m.startsWith('❌')) || ''), 'el mensaje de rechazo no dice qué pasa');

      // b) Un fallo a mitad de la aplicación deja el estado como estaba.
      const buena = await page.evaluate(() => {
        const s = JSON.parse(JSON.stringify(buildStateObject()));
        s.assetsData = s.assetsData.slice(0, 3);
        s.liabilitiesData = [];
        s.macro.stockGrowth = '9';
        return JSON.stringify(s);
      });
      const x = await importa(buena, `window.__orig = loadExpensesToInputs; let n = 0; loadExpensesToInputs = function () { if (n++ === 0) throw new Error('fallo de prueba'); return window.__orig.apply(this, arguments); };`);
      assert(x.mensaje.startsWith('❌'), `un fallo a mitad no avisa: «${x.mensaje}»`);
      assert(x.valor === '', 'tras el fallo no se puede volver a elegir el mismo fichero');
      const despues = await foto();
      if (despues !== antes) {
        const A = JSON.parse(antes), B = JSON.parse(despues);
        const difs = Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
        const det = difs.map(k => k + (typeof A[k] === 'object' && A[k] && !Array.isArray(A[k]) ? '{' + Object.keys(A[k]).filter(q => JSON.stringify(A[k][q]) !== JSON.stringify(B[k][q])).join(',') + '}' : '')).join(', ');
        assert(false, `tras un fallo a mitad de importar el estado no es el de antes (importación no atómica): difiere ${det}`);
      }

      // c) Una copia buena entra, avisa y deja elegir otra vez el mismo fichero.
      const ok = await importa(buena);
      assert(ok.mensaje.startsWith('✅'), `una copia válida no se carga: «${ok.mensaje}»`);
      assert(ok.valor === '', 'tras importar bien no se puede volver a elegir el mismo fichero');
      const tras = await page.evaluate(() => ({ n: assetsData.length, g: document.getElementById('stockGrowthParam').value }));
      assert(tras.n === 3 && tras.g === '9', `la copia válida no se aplicó: ${JSON.stringify(tras)}`);
      assert(errors.filter(e => !/ERR_FAILED|fallo de prueba/.test(e)).length === 0, `errores de consola: ${errors.join(' | ')}`);
      notas.push(`importar valida la forma (${basura.length} entradas rechazadas), es atómico y deja repetir fichero`);
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 7. Años de etapa laboral, antigüedad previa y días de despido: los campos aceptan decimales
  // (step="any") y el motor los admite (las etapas se miden en años transcurridos), pero el
  // manejador hacía `parseInt`: tecleando 1,5 se guardaba 1 sin avisar.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const campo = (field) => document.querySelector(`input[onchange*="'${field}'"][onchange*="updateStage(1, 0"]`);
        const pon = (field, v) => { const el = campo(field); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
        pon('years', '1.5');
        const a = careers[1].stages[0].years;
        pon('tenureBefore', '2.5');
        const b = careers[1].stages[0].tenureBefore;
        pon('layoffDays', '33.5');
        const c = careers[1].stages[0].layoffDays;
        // Un mínimo razonable: no se admite una etapa de cero años (ni vacía).
        pon('years', '0');
        const d = careers[1].stages[0].years;
        pon('years', '');
        const e = careers[1].stages[0].years;
        // Y la proyección sigue sana con una etapa de año y medio.
        pon('years', '1.5');
        const filas = Object.values(annualReportsData);
        return { a, b, c, d, e, sana: filas.every(f => Number.isFinite(f.endNW)), min: campo('years').min };
      });
      assert(r.a === 1.5, `una etapa de 1,5 años se guarda como ${r.a}`);
      assert(r.b === 2.5, `una antigüedad previa de 2,5 años se guarda como ${r.b}`);
      assert(r.c === 33.5, `33,5 días de despido por año se guardan como ${r.c}`);
      assert(r.d >= 0.25 && r.e >= 0.25, `una etapa de cero años o vacía debe quedar con un mínimo razonable: ${r.d}, ${r.e}`);
      assert(r.sana, 'con una etapa de 1,5 años la proyección tiene valores no finitos');
      assert(errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, `errores de consola: ${errors.join(' | ')}`);
      notas.push('etapas con decimales (años, antigüedad, días de despido)');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 8. Los rótulos «55 (2043)» de la edad de retiro sólo se refrescaban al mover el deslizador:
  // cambiar la edad actual movía el año de verdad pero dejaba el rótulo con el de antes.
  {
    const { browser, page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const lee = () => [document.getElementById('valRetireAge').innerText, document.getElementById('valRetireAgeP2').innerText];
        const antes = lee();
        document.getElementById('p1_age').value = '45'; document.getElementById('p2_age').value = '30';
        runSimulation();
        const despues = lee();
        const r1 = parseInt(document.getElementById('retireAge').value), r2 = parseInt(document.getElementById('retireAgeP2').value);
        return { antes, despues, esperado: [`${r1} (${START_YEAR + r1 - 45})`, `${r2} (${START_YEAR + r2 - 30})`] };
      });
      assert(r.despues[0] === r.esperado[0] && r.despues[1] === r.esperado[1],
        `los rótulos de edad de retiro no siguen a la edad actual: «${r.despues.join('» «')}» y deberían ser «${r.esperado.join('» «')}» (antes: «${r.antes.join('» «')}»)`);
      notas.push('rótulos de edad de retiro siguen a la edad actual');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 9. Escape cerraba todos los modales menos el de bienes muebles. Se comprueban TODOS los modales
  // del documento, para que el próximo que se añada no se quede fuera de la lista.
  {
    const { browser, page, errors } = await open();
    try {
      const ids = await page.evaluate(() => [...document.querySelectorAll('div[id$="Modal"]')].filter(d => d.classList.contains('fixed') && d.classList.contains('inset-0')).map(d => d.id));
      assert(ids.includes('chattelModal') && ids.length >= 10, `no se encontraron los modales: ${ids.join(',')}`);
      const abiertosTrasEscape = [];
      for (const id of ids) {
        await page.evaluate((id) => { const m = document.getElementById(id); m.classList.remove('hidden'); m.classList.add('flex'); }, id);
        await page.keyboard.press('Escape');
        const abierto = await page.evaluate((id) => !document.getElementById(id).classList.contains('hidden'), id);
        if (abierto) abiertosTrasEscape.push(id);
        await page.evaluate((id) => { const m = document.getElementById(id); m.classList.add('hidden'); m.classList.remove('flex'); }, id);
      }
      assert(abiertosTrasEscape.length === 0, `Escape no cierra: ${abiertosTrasEscape.join(', ')}`);
      notas.push(`Escape cierra los ${ids.length} modales`);
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 10. Con el almacenamiento local bloqueado (navegación privada estricta, política del
  // navegador) `localStorage` lanza: checkFirstVisit y closeWelcomeModal no estaban protegidos, así
  // que checkFirstVisit abortaba el arranque (setupShareLinks no llegaba a ejecutarse) y cerrar la
  // bienvenida lanzaba antes de cerrarla.
  {
    const { browser, page, errors } = await open({ pinClock: false });
    try {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } });
      });
      errors.length = 0;
      await page.reload();
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const bienvenida = !document.getElementById('welcomeModal').classList.contains('hidden');
        const share = document.getElementById('shareUrlInput').value;
        let cierra = null;
        try { closeWelcomeModal(); cierra = document.getElementById('welcomeModal').classList.contains('hidden'); } catch (e) { cierra = 'lanza: ' + e.message; }
        return { bienvenida, share, cierra, nw: document.getElementById('kpiStartingNW').innerText };
      });
      assert(errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, `con localStorage bloqueado el arranque lanza: ${errors.join(' | ')}`);
      assert(r.bienvenida, 'con localStorage bloqueado la bienvenida no se abre');
      assert(r.share.startsWith('http') || r.share.startsWith('file'), `con localStorage bloqueado no se llegó a preparar el enlace de compartir: «${r.share}»`);
      assert(r.cierra === true, `cerrar la bienvenida con localStorage bloqueado: ${r.cierra}`);
      assert(r.nw !== '€0', 'con localStorage bloqueado no se calculó la proyección');
      notas.push('arranque y bienvenida con localStorage bloqueado');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 11. Autoguardado dañado (las carreras sin etapas): applyStateObject lanzaba a mitad, la
  // restauración fallaba y la herramienta seguía con el estado roto. Ahora se descarta el
  // autoguardado y se carga el ejemplo.
  {
    const { browser, page, errors } = await open({ pinClock: false });
    try {
      await page.evaluate(() => {
        const s = JSON.parse(JSON.stringify(buildStateObject()));
        s.careers = { 1: { name: 'Roto', age: 40, stages: 5 }, 2: { name: 'Roto 2', age: 35 } };
        localStorage.setItem('fire_v26_autosave', JSON.stringify(s));
      });
      errors.length = 0;
      await page.reload();
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({
        etapas: Array.isArray(careers[1].stages) && careers[1].stages.length > 0 && Array.isArray(careers[2].stages),
        nombre: careers[1].name,
        nw: document.getElementById('kpiStartingNW').innerText,
        filas: Object.keys(annualReportsData).length,
        guardado: localStorage.getItem('fire_v26_autosave')
      }));
      assert(r.etapas, `con un autoguardado dañado las carreras siguen rotas (${r.nombre})`);
      assert(r.filas > 30 && r.nw !== '€0', `con un autoguardado dañado no hay proyección: ${r.filas} años, ${r.nw}`);
      assert(r.guardado === null || !r.guardado.includes('Roto'), 'el autoguardado dañado sigue ahí');
      assert(errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, `errores de consola: ${errors.join(' | ')}`);
      notas.push('autoguardado dañado: vuelve al ejemplo');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 13. Si Chart.js no carga (CDN bloqueado, red de empresa, extensión), `new Chart` lanzaba
  // «Chart is not defined» dentro de runSimulation y el resto del arranque (pestañas, tipos,
  // bienvenida, compartir) no se ejecutaba. Ahora la herramienta funciona sin gráficas y avisa en
  // el sitio de cada una.
  {
    const { chromium } = await import('playwright');
    const { launchOptions, INDEX } = await import('../harness.mjs');
    const browser = await chromium.launch(launchOptions());
    try {
      const page = await browser.newPage();
      const errores = [];
      page.on('pageerror', (e) => errores.push(String(e)));
      page.on('dialog', (d) => d.accept());
      await page.route('**/npm/chart.js**', r => r.abort());
      await page.route('**chartjs-plugin-annotation**', r => r.abort());
      await page.route(/open\.er-api\.com|api\.gold-api\.com/, r => r.abort());
      await page.goto(INDEX);
      await page.waitForTimeout(1500);
      const r = await page.evaluate(async () => {
        const out = { chart: typeof Chart };
        out.nw = document.getElementById('kpiStartingNW').innerText;
        out.filas = Object.keys(annualReportsData).length;
        out.share = document.getElementById('shareUrlInput').value;
        out.bienvenida = !document.getElementById('welcomeModal').classList.contains('hidden');
        // Las pestañas se abren.
        const pestañas = ['careersTab', 'cashflowTab', 'balanceTab', 'robustnessTab'].filter(id => document.getElementById(id));
        out.pestañas = [];
        for (const id of pestañas) {
          try { openTab(id); out.pestañas.push(id + ':' + !document.getElementById(id).classList.contains('hidden')); } catch (e) { out.pestañas.push(id + ':lanza ' + e.message); }
        }
        // Un cambio de datos recalcula sin lanzar, y el aviso aparece donde iba la gráfica.
        try { document.getElementById('inflationParam').value = '2.5'; syncParamSliders('inflationParam'); out.recalcula = true; } catch (e) { out.recalcula = 'lanza ' + e.message; }
        const aviso = document.querySelector('#nwChart')?.parentElement?.querySelector('[data-chart-fallback]');
        out.aviso = aviso ? aviso.innerText : null;
        // El informe PDF se genera sin gráficas.
        window.__pdf = null;
        window.open = () => ({ document: { open() {}, write(h) { window.__pdf = h; }, close() {} }, focus() {}, print() {}, set onload(f) {}, get onload() { return null; } });
        try { generatePDFReport(); out.pdf = !!window.__pdf; } catch (e) { out.pdf = 'lanza ' + e.message; }
        return out;
      });
      assert(r.chart === 'undefined', 'la prueba no dejó a Chart sin cargar');
      assert(errores.filter(e => !/ERR_FAILED/.test(e)).length === 0, `sin Chart.js la página lanza: ${errores.join(' | ')}`);
      assert(r.nw !== '€0' && r.filas > 30, `sin Chart.js no hay proyección: ${r.nw}, ${r.filas} años`);
      assert(r.share.length > 0, 'sin Chart.js no se llegó a preparar el enlace de compartir (el arranque se cortó)');
      assert(r.bienvenida, 'sin Chart.js no se abre la bienvenida (el arranque se cortó)');
      assert(r.pestañas.every(x => x.endsWith(':true')), `sin Chart.js las pestañas no abren: ${r.pestañas.join(', ')}`);
      assert(r.recalcula === true, `sin Chart.js recalcular lanza: ${r.recalcula}`);
      assert(r.aviso && /gr[aá]fica/i.test(r.aviso), `no hay aviso donde iba la gráfica: «${r.aviso}»`);
      assert(r.pdf === true, `sin Chart.js el informe PDF no se genera: ${r.pdf}`);
      notas.push('sin Chart.js: calcula, abre pestañas, avisa y genera el PDF');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 14. Pequeños. a) El título del informe PDF decía «FIRE & Balance Personal», que es el nombre
  // de otra herramienta; el encabezado de la misma página dice «Simulador de Retiro FIRE». b) Un
  // fichero sin el tipo de una divisa la dejaba a 1:1 (1.200 USD valían 1.200 €): se conserva el
  // tipo vigente de esa divisa.
  {
    const { browser, page, errors } = await open();
    try {
      await capturePdf(page);
      const r = await page.evaluate(() => {
        generatePDFReport();
        const html = window.__pdf || '';
        const titulo = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
        const h1 = (html.match(/<h1>([^<]*)<\/h1>/) || [])[1];
        exchangeRates.USD = 1.2;                       // el tipo vigente (p. ej. el que trajo el servicio en vivo)
        const s = JSON.parse(JSON.stringify(buildStateObject()));
        s.exchangeRates = { GBP: 0.9, EUR: 1 };        // el fichero no trae USD
        s.assetsData = [{ id: 'u1', name: 'Dólares', category: 'cash', owner: 'p1', currency: 'USD', value: 1200, cashReturnPct: 0, capitalReturnPct: 0 }];
        applyStateObject(s);
        const eur = toEUR(1200, 'USD');
        // Un tipo que el fichero sí trae manda sobre el vigente.
        const s2 = JSON.parse(JSON.stringify(s)); s2.exchangeRates = { USD: 1.5 };
        applyStateObject(s2);
        return { titulo, h1, eur, conTipo: toEUR(1200, 'USD'), gbp: exchangeRates.GBP };
      });
      assert(r.titulo && !/Balance/i.test(r.titulo) && /Simulador de Retiro/.test(r.titulo), `título del informe PDF: «${r.titulo}»`);
      assert(r.h1 && /Simulador de Retiro/.test(r.h1), `el encabezado del informe cambió: «${r.h1}»`);
      near(r.eur, 1000, 1e-9, '1.200 USD con el tipo vigente 1,2 (el fichero no trae USD)');
      near(r.conTipo, 800, 1e-9, '1.200 USD con el tipo 1,5 que sí trae el fichero');
      notas.push('título del PDF y divisa ausente del fichero');
    } finally { await browser.close(); }
  }

  // ---------------------------------------------------------------------------------------------
  // 12. Fiscalidad y Seguridad Social a 2026, con fuente oficial:
  //  - Reducción por rendimientos del trabajo, art. 20 LIRPF (redacción vigente desde 2023; la
  //    AEAT la publica en su manual de la renta): 7.302 € hasta 14.852 €; 7.302 − 1,75·(RN − 14.852)
  //    hasta 17.673,52 €; 2.364,34 − 1,14·(RN − 17.673,52) hasta 19.747,50 €; 0 por encima. El
  //    código tenía los importes de 2018 (6.498 / 14.047,50 / 1,14).
  //  - Orden PJC/297/2026 (BOE-A-2026-7296): base máxima 5.101,20 €/mes; trabajador 4,70% +
  //    desempleo 1,55% + formación 0,10% + MEI 0,15% = 6,50%.
  //  - Real Decreto 39/2026 (BOE-A-2026-1484): pensión máxima 3.359,60 €/mes, 47.034,40 €/año.
  {
    const { browser, page } = await open();
    try {
      const r = await page.evaluate(() => {
        // getGeneralBaseBreakdown recibe el bruto: se le suman los 2.000 € de gastos deducibles
        // para entrar con el rendimiento neto que se quiere.
        const red = (rn) => getGeneralBaseBreakdown(rn + 2000).workReduction;
        return {
          r1: red(10000), r2: red(14852), r3: red(16000), r4: red(17673.52), r5: red(18000), r6: red(19747.5), r7: red(25000),
          ss: calculateWorkerSocialSecurity(34000), ssTope: calculateWorkerSocialSecurity(100000),
          pensionTope: calculatePublicPensionDetails(40, 200000).grossAnnual,
          base: BASE_MAX_COTIZACION_ANUAL
        };
      });
      near(r.r1, 7302, 0.01, 'reducción con RN 10.000');
      near(r.r2, 7302, 0.01, 'reducción con RN 14.852');
      near(r.r3, 7302 - 1.75 * (16000 - 14852), 0.01, 'reducción con RN 16.000');
      near(r.r4, 2364.34, 0.01, 'reducción con RN 17.673,52');
      near(r.r5, 2364.34 - 1.14 * (18000 - 17673.52), 0.01, 'reducción con RN 18.000');
      near(r.r6, 0, 0.01, 'reducción con RN 19.747,50');
      near(r.r7, 0, 0.01, 'reducción con RN 25.000');
      near(r.ss, 34000 * 0.065, 0.01, 'cuota obrera con 34.000 € (6,35% + 0,15% de MEI)');
      near(r.ssTope, 5101.20 * 12 * 0.065, 0.01, 'cuota obrera por encima de la base máxima');
      near(r.pensionTope, 47034.40, 0.01, 'pensión máxima');
      near(r.base, 5101.20 * 12, 0.01, 'base máxima anual de cotización');
      notas.push('IRPF art. 20 y Seguridad Social a 2026');
    } finally { await browser.close(); }
  }

  return notas.join(' · ');
}
