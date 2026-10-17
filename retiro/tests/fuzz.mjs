// Fuzzer: genera planes aleatorios completos (con semilla, para poder reproducirlos), los carga
// por la vía de importación real y comprueba invariantes que deben cumplirse SIEMPRE, sean cuales
// sean los datos: ningún número no finito, el balance cuadra, el cash flow cuadra, ningún saldo
// negativo, las dos tablas pintan los mismos años, los dos motores dan el mismo veredicto, no hay
// nómina después del retiro, la deuda no sube sin pedir prestado, el veredicto es monótono en la
// edad de retiro, la proyección es determinista y exportar e importar no la cambia.
//
// No entra en `npm test`: tarda lo que le eches y sus hallazgos no son todos fallos (hay casos
// legítimos, como un préstamo cuya cuota no cubre los intereses). Se pasa a mano cuando se toca
// el motor, y lo que saca se convierte en una suite de regresión: de aquí salieron la 15, la 18
// y la 19.
//
//   node tests/fuzz.mjs                          # 100 escenarios desde la semilla 1
//   node tests/fuzz.mjs 700000 1200 4 --round    # 1200 desde 700000, 4 pestañas, con ida y vuelta
//   node tests/fuzz.mjs --dump=700027            # vuelca el plan de esa semilla a un .json
//
// Los ficheros que escribe van a tests/.fuzz-out/ (ignorado por git), o a donde diga FUZZ_OUT.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { ROOT, INDEX, launchOptions } from './harness.mjs';

const D = process.env.FUZZ_OUT || path.join(ROOT, 'tests', '.fuzz-out');
mkdirSync(D, { recursive: true });
const chartJs = readFileSync(path.join(ROOT, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const annotationJs = readFileSync(path.join(ROOT, 'node_modules/chartjs-plugin-annotation/dist/chartjs-plugin-annotation.js'), 'utf8');

const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const seed0 = parseInt(pos[0] || '1', 10);
const total = parseInt(pos[1] || '100', 10);
const nPages = parseInt(pos[2] || '4', 10);
const doRound = process.argv.includes('--round');
const BATCH = 25;

async function openPage() {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();
  await page.route('**/npm/chart.js**', r => r.fulfill({ contentType: 'application/javascript', body: chartJs }));
  await page.route('**chartjs-plugin-annotation**', r => r.fulfill({ contentType: 'application/javascript', body: annotationJs }));
  await page.route('**api.gold-api.com/**', r => r.abort());
  await page.route('**open.er-api.com/**', r => r.abort());
  await page.goto(INDEX);
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    getRemainingYearFraction = () => 0.31;
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(String(e.message || e.error)));
    window.onunhandledrejection = e => window.__errs.push('rejection: ' + String(e.reason));
    window.confirm = () => true;
    runSimulation();
  });
  page.setDefaultTimeout(20 * 60 * 1000);
  return { browser, page };
}

// --- Lo que corre DENTRO de la página ---------------------------------------------------------
function inPage({ seedFrom, n, doRound, dump }) {
  const mul = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const out = { fails: [], stats: { insolvent: 0, ruin: 0, noSafeAge: 0, forcedSale: 0 } };

  for (let k = 0; k < n; k++) {
    const seed = seedFrom + k;
    const R = mul(seed);
    const ri = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
    const rf = (lo, hi) => lo + R() * (hi - lo);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const chance = (p) => R() < p;

    // --- generador de plan -------------------------------------------------------------------
    const hasPartner = chance(0.75);
    const p1Age = ri(25, 60);
    const p2Age = Math.max(22, p1Age + ri(-8, 8));
    const stagesFor = (age) => {
      const st = [];
      const nSt = ri(1, 3);
      for (let s = 0; s < nSt; s++) {
        const type = s === 0 ? pick(['employed', 'employed', 'employed', 'freelance']) : pick(['employed', 'freelance', 'unemployed']);
        st.push({
          type, company: 'E' + s, years: ri(1, 25),
          salary: type === 'unemployed' ? 0 : ri(0, 12) * 20000,
          rsus: type === 'employed' && chance(0.4) ? ri(0, 5) * 10000 : 0,
          salaryInc: rf(0, 5), salaryIncCoupled: chance(0.7),
          benefits: chance(0.5) ? ri(0, 12000) : 0, otherKind: 0,
          tenureBefore: s === 0 ? ri(0, 25) : 0,
          layoffDays: pick([0, 20, 33, 45]),
          freelanceExpenses: type === 'freelance' ? ri(0, 20000) : 0,
          empPensionPct: type === 'employed' ? pick([0, 0, 5, 10, 30]) : 0,
          compPensionPct: type === 'employed' ? pick([0, 0, 3, 8]) : 0,
          targetAssetId: '', endType: pick(['layoff', 'layoff', 'voluntary']),
          pensionPlanEnabled: chance(0.3), planTargetAssetId: ''
        });
      }
      return st;
    };
    const careers = {
      1: { name: 'Tú', age: p1Age, cotizados: ri(0, Math.max(0, p1Age - 20)), paroInitMonths: pick([0, 6, 12, 24]), stages: stagesFor(p1Age) },
      2: { name: 'Pareja', age: p2Age, cotizados: ri(0, Math.max(0, p2Age - 20)), paroInitMonths: pick([0, 6, 12, 24]), stages: stagesFor(p2Age) }
    };

    const nKids = ri(0, 4);
    const childrenAges = Array.from({ length: nKids }, () => ri(0, 24));

    const familyExpenses = {
      food: ri(0, 600), clothes: ri(0, 200), supplies_p: ri(0, 200), transport: ri(0, 300), other_p: ri(0, 400),
      supplies_h: ri(0, 500), subs: ri(0, 200), otherHouse: ri(0, 400), housekeeper: chance(0.3) ? ri(0, 20000) : 0,
      education: 0, vacations: ri(0, 20000), vehicle: ri(0, 1500), otherFixed: chance(0.3) ? ri(0, 10000) : 0,
      rent_imputed: ri(0, 2500)
    };

    // Activos: al menos uno, hasta ~10, de cualquier categoría y divisa.
    const CURR = ['EUR', 'EUR', 'EUR', 'USD', 'GBP', 'JPY', 'PHP', 'HKD', 'CHF'];
    const assetsData = [];
    const nAssets = ri(1, 10);
    let habitualUsed = false;
    for (let a = 0; a < nAssets; a++) {
      const cat = pick(['cash', 'cash', 'stocks', 'stocks', 'divStocks', 'bonds', 'tips', 'gold', 'real_estate', 'real_estate', 'pensions', 'pensionIns', 'tangibles']);
      const base = { id: 'a' + a, name: 'A' + a, category: cat, owner: pick(['p1', 'p2', 'joint']), currency: pick(CURR), value: ri(0, 40) * 25000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: rf(0, 8), cashReturnCoupled: chance(0.7), capitalReturnCoupled: chance(0.7) };
      if (cat === 'real_estate') {
        const useType = (!habitualUsed && chance(0.4)) ? 'habitual' : pick(['rented', 'rented', 'vacant']);
        if (useType === 'habitual') habitualUsed = true;
        base.useType = useType;
        base.value = ri(1, 20) * 50000;
        base.monthlyRent = useType === 'rented' ? ri(0, 4000) : 0;
        base.opexPct = ri(0, 40); base.hasMaint = chance(0.7);
        base.purchasePrice = chance(0.8) ? Math.round(base.value * rf(0.3, 1.2)) : undefined;
        base.cashReturnPct = rf(0, 6); base.useReturnPct = useType === 'habitual' ? rf(0, 5) : 0;
      } else if (cat === 'gold') {
        if (chance(0.5)) { base.grams = ri(1, 2000); }
      } else if (cat === 'stocks' || cat === 'divStocks' || cat === 'bonds' || cat === 'tips') {
        if (chance(0.7)) base.purchasePrice = Math.round(base.value * rf(0.2, 1.5));
        if (cat === 'divStocks') base.cashReturnPct = rf(0, 6);
      } else if (cat === 'pensions') {
        base.isActivePP = chance(0.3);
      } else if (cat === 'cash') {
        base.cashReturnPct = rf(0, 4);
      }
      assetsData.push(base);
    }
    // Préstamos: hipotecas ligadas o no a un inmueble, y préstamos familiares sin cuota.
    const liabilitiesData = [];
    const reIds = assetsData.filter(a => a.category === 'real_estate').map(a => a.id);
    const nLiab = ri(0, 5);
    for (let l = 0; l < nLiab; l++) {
      const isMort = chance(0.7);
      const principal = ri(1, 30) * 20000;
      const months = pick([12, 60, 120, 180, 240, 300, 360, 420]);
      const rate = rf(0, 8);
      const noMonthly = !isMort && chance(0.5);
      const lia = {
        id: 'l' + l, name: 'L' + l, subcategory: isMort ? 'mortgages' : pick(['personal_loans', 'family_loans']),
        propertyLink: isMort && reIds.length && chance(0.8) ? pick(reIds) : '',
        currency: 'EUR', initialPrincipal: principal,
        startDate: `${ri(2005, 2026)}-${String(ri(1, 12)).padStart(2, '0')}`,
        durationMonths: months, interestRatePct: rate, noMonthlyPayment: noMonthly,
        rateType: 'fixed', spreadPct: 0, balanceOverride: 0
      };
      // Cuota: la francesa, una mayor, una menor (que el importador debe corregir) o vacía.
      const due = annuityPayment(principal, rate, months);
      lia.monthlyPayment = noMonthly ? 0 : pick([Math.round(due * 100) / 100, Math.round(due * 1.3 * 100) / 100, Math.round(due * 0.7 * 100) / 100, 0]);
      liabilitiesData.push(lia);
    }

    // --- Eventos: compras y ventas de inmuebles, compras de bienes muebles y enrutamiento por año.
    // Son los caminos que mutan assetsData y liabilitiesData DENTRO de la simulación, y los que
    // el generador dejaba vacíos.
    const HORIZON = 100 - p1Age;
    const realEstateEvents = [];
    const boughtIds = [];
    const nBuys = chance(0.45) ? ri(1, 3) : 0;
    for (let b = 0; b < nBuys; b++) {
      const year = START_YEAR + ri(0, Math.min(30, Math.max(1, HORIZON - 2)));
      const assetId = 're_buy_f' + b;
      const useType = pick(['rented', 'rented', 'habitual', 'vacant']);
      const hasMort = chance(0.7);
      realEstateEvents.push({
        id: 'evb' + b, assetId, type: 'buy', year,
        name: 'Piso ' + b, useType, owner: pick(['p1', 'p2', 'joint']),
        priceTodayEUR: ri(1, 16) * 50000,
        rentTodayEUR: useType === 'rented' ? ri(0, 3000) : 0,
        opexPct: ri(0, 40), downPct: ri(0, 100), expPct: ri(0, 15),
        hasMort, mortRate: hasMort ? rf(0, 7) : 0, mortYears: hasMort ? pick([5, 10, 20, 25, 30]) : 0
      });
      boughtIds.push({ assetId, year });
    }
    // Ventas: de un inmueble inicial, o de uno comprado dentro de la simulación (después de comprarlo).
    const initialReIds = assetsData.filter(a => a.category === 'real_estate').map(a => a.id);
    const nSells = chance(0.35) ? ri(1, 2) : 0;
    for (let s = 0; s < nSells; s++) {
      const deCompra = boughtIds.length && chance(0.4);
      if (deCompra) {
        const b = pick(boughtIds);
        realEstateEvents.push({ id: 'evs' + s, assetId: b.assetId, type: 'sell', year: b.year + ri(1, 10) });
      } else if (initialReIds.length) {
        realEstateEvents.push({ id: 'evs' + s, assetId: pick(initialReIds), year: START_YEAR + ri(0, Math.min(30, Math.max(1, HORIZON - 2))), type: 'sell' });
      }
    }

    const chattelEvents = [];
    const nChattels = chance(0.4) ? ri(1, 3) : 0;
    for (let c = 0; c < nChattels; c++) {
      chattelEvents.push({
        id: 'ch' + c, year: START_YEAR + ri(0, Math.min(30, Math.max(1, HORIZON - 2))),
        name: 'Coche ' + c, priceTodayEUR: ri(1, 12) * 5000,
        lifeYears: ri(1, 20), maintPct: rf(0, 8)
      });
    }

    // Enrutamiento por año: sobreescribe el destino del excedente o el origen del déficit.
    const customYearlyRouting = {};
    if (chance(0.35)) {
      const n = ri(1, 6);
      for (let k = 0; k < n; k++) {
        customYearlyRouting[START_YEAR + ri(0, Math.min(40, Math.max(1, HORIZON - 1)))] =
          pick(['divStocks', 'stocks', 'growthStocks', 'splitStocks', 'growth90_cash10', 'growth50_cash50',
            'bonds', 'tips', 'gold', 'cash', 'debt', 'taxOptimized', 'pensions', 'pensionIns']);
      }
    }

    const retireAgeP1 = Math.max(p1Age, ri(p1Age, 70));
    const retireAgeP2 = Math.max(p2Age, ri(p2Age, 70));
    const macro = {
      stockGrowth: rf(0, 12).toFixed(2), divYield: rf(0, 5).toFixed(2), cashYield: rf(0, 5).toFixed(2),
      bondYield: rf(0, 8).toFixed(2), tipsRealYield: rf(-1, 4).toFixed(2), goldRealReturn: rf(-3, 5).toFixed(2),
      goldPricePerGram: ri(30, 200), inflation: rf(0, 8).toFixed(2),
      propertyInflation: rf(0, 8).toFixed(2), propertyInflationCoupled: chance(0.6),
      pensionGrowthCoupled: chance(0.6), pensionGrowth: rf(0, 5).toFixed(2),
      expenseChange: pick([-50, -25, 0, 0, 25, 50]), countPublicPension: chance(0.8),
      rentInflation: rf(0, 8).toFixed(2), rentInflationCoupled: chance(0.6),
      reRentalYield: rf(1, 8).toFixed(2), reMaint: rf(0, 3).toFixed(2), reOpex: ri(0, 40), reDeduction: ri(0, 90),
      bufferMonths: ri(3, 6), retireAgeP1, retireAgeP2,
      surplusDest: pick(['divStocks', 'growthStocks', 'splitStocks', 'growth90_cash10', 'growth50_cash50', 'bonds', 'tips', 'gold', 'cash', 'debt']),
      deficitDest: pick(['divStocks', 'stocks', 'bonds', 'tips', 'gold', 'cash', 'taxOptimized']),
      ccaa: pick(['madrid', 'andalucia', 'catalunya', 'galicia', 'pais_vasco', 'valencia', 'canarias', 'ceuta_melilla']),
      eduGuarderia: pick(['publica', 'privada']), eduColegio: pick(['publico', 'concertado', 'privado']),
      eduUniversidad: pick(['publica', 'privada_std', 'prestigio']), chartHorizon: 'auto',
      ppContribution: pick([0, 1500, 4250, 8500]), elderCareMonthly: ri(0, 3000), elderCareAge: ri(70, 95),
      childrenEmancipationAge: ri(16, 30), robHorizonAge: 65
    };

    const state = { version: '10.0', careers, familyExpenses, hasPartner, childrenAges, customYearlyRouting,
      realEstateEvents, chattelEvents, assetsData, liabilitiesData, macro };

    if (dump) {
      applyStateObject(JSON.parse(JSON.stringify(state)));
      runSimulation();
      return { dump: {
        state,
        reports: Object.values(annualReportsData).map(d => Object.fromEntries(Object.entries(d).filter(([k, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 100) / 100]))),
        cf: [...document.querySelectorAll('#cashflowTableBody tr')].map(tr => [...tr.querySelectorAll('td')].map(x => x.innerText.replace(/\s+/g, ' ').trim()).slice(0, 11).join(' | ')),
        solv: document.getElementById('valCritSolvency').textContent + ' / ' + document.getElementById('badgeCritSolvency').textContent,
        opt: (() => { const o = evaluateRetirementSafety(state.macro.retireAgeP1, state.macro.retireAgeP2, { collect: true }); return { pass: o.passAll, solv: o.solvency, ruin: o.ruin, series: o.series.map(p => ({ y: p.year, nw: Math.round(p.realNW) })) }; })()
      } };
    }

    const fail = (code, detail) => out.fails.push({ seed, code, detail });
    const errsBefore = window.__errs.length;

    try {
      applyStateObject(JSON.parse(JSON.stringify(state)));
      runSimulation();
    } catch (e) {
      fail('EXCEPCIÓN', String(e && e.message || e));
      continue;
    }
    if (window.__errs.length > errsBefore) fail('ERROR_CONSOLA', window.__errs.slice(errsBefore).join(' | '));

    const reports = Object.values(annualReportsData);
    if (!reports.length) { fail('SIN_INFORMES', 'annualReportsData vacío'); continue; }

    // 1. Ningún número no finito.
    for (const d of reports) {
      for (const [key, v] of Object.entries(d)) {
        if (typeof v === 'number' && !Number.isFinite(v)) { fail('NO_FINITO', `${d.year}.${key}=${v}`); break; }
      }
    }
    // 2. Identidad del balance: patrimonio = activos − deuda.
    for (const d of reports) {
      const sum = d.endCash + d.endGrowth + d.endDiv + d.endBonds + d.endTips + d.endGold + d.endTangibles + d.endPens + d.endRE - d.endDebt;
      if (Math.abs(sum - d.endNW) > 5) { fail('BALANCE', `${d.year}: suma ${Math.round(sum)} vs endNW ${Math.round(d.endNW)}`); break; }
    }
    // 3. Identidad del cash flow: entradas − salidas = excedente.
    for (const d of reports) {
      if (Math.abs((d.totalInflows - d.totalOutflows) - d.netSurplus) > 2) {
        fail('CASHFLOW', `${d.year}: ${Math.round(d.totalInflows)}−${Math.round(d.totalOutflows)} ≠ ${Math.round(d.netSurplus)}`); break;
      }
    }
    // 4. Ningún saldo negativo (la deuda es su propia columna).
    for (const d of reports) {
      const negs = ['endCash', 'endGrowth', 'endDiv', 'endBonds', 'endTips', 'endGold', 'endPens', 'endRE', 'endTangibles']
        .filter(k => d[k] < -1);
      if (negs.length) { fail('NEGATIVO', `${d.year}: ${negs.map(k => k + '=' + Math.round(d[k])).join(', ')}`); break; }
    }
    // 5. Las dos tablas pintan los mismos años.
    const balRows = document.querySelectorAll('#projectionTableBody tr').length;
    const cfRows = document.querySelectorAll('#cashflowTableBody tr').length;
    if (balRows !== cfRows + 1) fail('FILAS', `balance ${balRows} (incluye Hoy) vs cash flow ${cfRows}`);
    // 6. Columnas cuadradas con la cabecera.
    const headCols = document.querySelectorAll('#projectionTab thead th').length;
    const badCols = [...document.querySelectorAll('#projectionTableBody tr')].filter(tr => tr.querySelectorAll('td').length !== headCols).length;
    if (badCols) fail('COLUMNAS', `${badCols} filas del balance con distinto número de columnas que la cabecera (${headCols})`);

    // 7. Los dos motores, mismo veredicto de solvencia y mismo año de quiebra.
    const solvText = document.getElementById('valCritSolvency').textContent;
    const ym = solvText.match(/\b(2[01]\d\d)\b/);
    const proj = { solvent: document.getElementById('badgeCritSolvency').textContent.includes('Solvente'), failYear: ym ? Number(ym[1]) : null };
    const o = evaluateRetirementSafety(retireAgeP1, retireAgeP2);
    const opt = { solvent: o.solvency.pass, failYear: o.solvency.failYear || null };
    if (proj.solvent !== opt.solvent || proj.failYear !== opt.failYear) {
      fail("MOTORES", `proyección=${JSON.stringify(proj)} optimizador=${JSON.stringify(opt)} edades=${retireAgeP1}/${retireAgeP2} compras=${realEstateEvents.filter(e=>e.type==="buy").length} ventas=${realEstateEvents.filter(e=>e.type==="sell").length} muebles=${chattelEvents.length} rutas=${Object.keys(customYearlyRouting).length}`);
    }
    if (!proj.solvent) out.stats.insolvent++;
    if (!o.ruin.pass) out.stats.ruin++;

    // 8. Impuestos nunca negativos y las salidas con impuestos nunca por debajo de las salidas.
    for (const d of reports) {
      if (d.capTaxesPaid < -0.01) { fail('IMPUESTO_NEGATIVO', `${d.year}: ${Math.round(d.capTaxesPaid)}`); break; }
      if (d.totalOutflowsWithTaxes < d.totalOutflows - 0.01) { fail('SALIDAS', `${d.year}: con impuestos ${Math.round(d.totalOutflowsWithTaxes)} < sin ellos ${Math.round(d.totalOutflows)}`); break; }
    }
    // 9. Sin bruto laboral después de que los dos se hayan jubilado (el año del retiro va a
    //    medias y puede llevar indemnización, así que se mira a partir del siguiente).
    //    Se lee la columna del cash flow: el campo netLabor del informe incluye paro y pensión.
    const lastWorkYear = START_YEAR + Math.max(retireAgeP1 - p1Age, hasPartner ? retireAgeP2 - p2Age : 0);
    const eur = (s) => { const t = String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'); const v = parseFloat(t); return Number.isFinite(v) ? v : 0; };
    const cfRowsArr = [...document.querySelectorAll('#cashflowTableBody tr')];
    for (const tr of cfRowsArr) {
      const td = tr.querySelectorAll('td');
      const y = parseInt(td[0]?.innerText.trim(), 10);
      if (Number.isFinite(y) && y > lastWorkYear && eur(td[2]?.innerText) > 1) {
        fail('NÓMINA_TRAS_RETIRO', `${y}: bruto laboral ${Math.round(eur(td[2].innerText))} € con retiro en ${lastWorkYear} (${retireAgeP1}/${retireAgeP2})`);
        break;
      }
    }
    // 10. Sin compras nuevas, la deuda solo puede bajar (salvo préstamos sin cuota, que capitalizan,
    //     y salvo una compra de inmueble con hipoteca, que es deuda nueva legítima).
    const capitalizing = liabilitiesData.some(l => l.noMonthlyPayment && l.interestRatePct > 0)
      || realEstateEvents.some(ev => ev.type === 'buy');
    if (!capitalizing) {
      for (let x = 1; x < reports.length; x++) {
        if (reports[x].endDebt > reports[x - 1].endDebt + 1) { fail('DEUDA_SUBE', `${reports[x].year}: ${Math.round(reports[x - 1].endDebt)} → ${Math.round(reports[x].endDebt)}`); break; }
      }
    }

    // 10b. Bienes muebles: el valor contable de las COMPRAS solo puede subir el año de una compra;
    //      el resto de años se amortiza. Solo se comprueba cuando no hay "otros activos" iniciales,
    //      porque esos se revalorizan al IPC todos los años y taparían la señal.
    const añosCompra = new Set(chattelEvents.map(ev => ev.year));
    const sinTangiblesIniciales = !assetsData.some(a => a.category === 'tangibles' && a.value > 0);
    for (let x = 1; sinTangiblesIniciales && x < reports.length; x++) {
      if (reports[x].endTangibles > reports[x - 1].endTangibles + 1 && !añosCompra.has(reports[x].year)) {
        fail('MUEBLES_SUBEN', `${reports[x].year}: ${Math.round(reports[x - 1].endTangibles)} → ${Math.round(reports[x].endTangibles)} sin compra`);
        break;
      }
    }
    // 10c. Los inmuebles comprados dentro de la simulación no pueden sobrevivir a un
    //      buildStateObject: se regeneran desde su evento en cada cálculo. Si se colaran, cada
    //      exportación duplicaría el piso.
    const colados = buildStateObject().assetsData.filter(a => String(a.id).startsWith('re_buy_')).length
      + buildStateObject().liabilitiesData.filter(l => String(l.id).startsWith('mort_re_buy_')).length;
    if (colados) fail('COMPRA_DUPLICADA', `${colados} activos o hipotecas de compra simulada se cuelan en el fichero exportado`);

    // 11. Monotonía: trabajar más años nunca puede empeorar el veredicto (la edad segura se
    //     busca por bisección y da por hecho justo esto).
    const a1 = retireAgeP1, a2 = retireAgeP2;
    if (seed % 2 === 0 && a1 + 3 <= 70 && a2 + 3 <= 70) {
      const now = evaluateRetirementSafety(a1, a2).passAll;
      const later = evaluateRetirementSafety(a1 + 3, a2 + 3).passAll;
      if (now && !later) fail('MONOTONÍA', `pasa a ${a1}/${a2} pero no a ${a1 + 3}/${a2 + 3}`);
    }

    // 12. Determinismo y, más de vez en cuando, ida y vuelta por el fichero guardado.
    if (seed % 4 === 0) {
      const snap = JSON.stringify(annualReportsData);
      runSimulation();
      if (JSON.stringify(annualReportsData) !== snap) fail('DETERMINISMO', 'dos runSimulation() seguidos difieren');
      if (doRound && seed % 8 === 0) {
        applyStateObject(JSON.parse(JSON.stringify(buildStateObject())));
        runSimulation();
        if (JSON.stringify(annualReportsData) !== snap) fail('IDA_Y_VUELTA', 'exportar e importar cambia la proyección');
      }
    }

    if (document.getElementById('kpiSimulRetireAge').innerText.includes('--')) out.stats.noSafeAge++;
    if (document.getElementById('cashflowTableBody').innerText.includes('Necesaria Venta')) out.stats.forcedSale++;
  }
  return out;
}

// --- orquestación ------------------------------------------------------------------------------
const dumpArg = process.argv.find(a => a.startsWith('--dump='));
if (dumpArg) {
  const seed = parseInt(dumpArg.split('=')[1], 10);
  const { browser, page } = await openPage();
  const r = await page.evaluate(inPage, { seedFrom: seed, n: 1, doRound: false, dump: true });
  writeFileSync(`${D}/dump_${seed}.json`, JSON.stringify(r.dump, null, 1));
  console.log(`escrito ${D}/dump_${seed}.json`);
  await browser.close();
  process.exit(0);
}

const t0 = Date.now();
const perPage = Math.ceil(total / nPages);
const results = await Promise.all(Array.from({ length: nPages }, async (_, p) => {
  const { browser, page } = await openPage();
  const fails = [], stats = { insolvent: 0, ruin: 0, noSafeAge: 0, forcedSale: 0 };
  let done = 0;
  const from = seed0 + p * perPage;
  try {
    while (done < perPage) {
      const n = Math.min(BATCH, perPage - done);
      const r = await page.evaluate(inPage, { seedFrom: from + done, n, doRound });
      fails.push(...r.fails);
      for (const k of Object.keys(stats)) stats[k] += r.stats[k];
      done += n;
      // Persistencia incremental: si el proceso muere, lo recorrido no se pierde.
      appendFileSync(`${D}/fuzz_run.jsonl`, r.fails.map(f => JSON.stringify(f)).join('\n') + (r.fails.length ? '\n' : '')
        + JSON.stringify({ page: p, done, stats: r.stats }) + '\n');
      if (p === 0) process.stdout.write(`\r${done * nPages}/${total} · ${((Date.now() - t0) / 1000).toFixed(0)}s · ${fails.length} fallos en esta página   `);
    }
  } finally { await browser.close(); }
  return { fails, stats };
}));

const fails = results.flatMap(r => r.fails);
const stats = results.reduce((a, r) => { for (const k of Object.keys(r.stats)) a[k] = (a[k] || 0) + r.stats[k]; return a; }, {});
const byCode = {};
for (const f of fails) (byCode[f.code] = byCode[f.code] || []).push(f);
console.log(`\n\n${total} escenarios en ${((Date.now() - t0) / 1000).toFixed(0)}s · ${fails.length} incidencias`);
console.log('estadísticas:', JSON.stringify(stats));
for (const [code, list] of Object.entries(byCode).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n### ${code}: ${list.length}`);
  list.slice(0, 6).forEach(f => console.log(`  semilla ${f.seed}: ${f.detail}`));
}
writeFileSync(`${D}/fuzz_${seed0}_${total}.json`, JSON.stringify({ total, stats, fails }, null, 1));
