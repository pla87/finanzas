// Renta fija como clase de activo. Sin posiciones de renta fija todo es un no-op (lo cubre la
// comparación bit a bit frente a la versión anterior, fuera de esta suite). Con una posición:
// aparece en el balance y crece a su tipo, el excedente se le puede destinar y el déficit puede
// salir de ella con su impuesto, la matriz de tipos la vincula al parámetro, el PDF la lista, y
// el fichero guardado conserva el parámetro.
export default async function run({ open, assert, near, capturePdf }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const rBond = numParam('bondYieldParam', 3.0) / 100;
      const before = document.querySelectorAll('#projectionTableBody tr')[1].querySelectorAll('td').length;
      assetsData.push({ id: 'bond_t', name: '(EJEMPLO) Fondo Renta Fija', category: 'bonds', owner: 'joint', currency: 'EUR', value: 100000 });
      runSimulation();
      const rows = [...document.querySelectorAll('#projectionTableBody tr')];
      const cols = rows[1].querySelectorAll('td').length;
      const num = (td) => { const t = td.innerText.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'); return parseFloat(t); };
      // Columna 5 (0: año, 1: edad, 2: caja, 3: crecimiento, 4: dividendo, 5: renta fija).
      const hoy = rows[0].querySelectorAll('td')[5].innerText.trim();
      const bondsY1 = annualReportsData[START_YEAR + 1].endBonds;
      const bondsY0 = annualReportsData[START_YEAR].endBonds;
      // Sin aportar ni retirar, un año entero rinde exactamente el tipo.
      const growthOk = Math.abs(bondsY1 / bondsY0 - (1 + rBond)) < 1e-9
        && annualReportsData[START_YEAR + 1].bondAdded === 0 && annualReportsData[START_YEAR + 1].bondWithdrawn === 0;

      // Excedente a renta fija: el primer año con superávit la aportación entra entera.
      document.getElementById('surplusDest').value = 'bonds'; runSimulation();
      const surplusYear = Object.values(annualReportsData).find(d => d.investableAvailable > 0);
      const surplusOk = surplusYear && Math.abs(surplusYear.bondAdded - surplusYear.investableAvailable) < 1;
      document.getElementById('surplusDest').value = 'divStocks';

      // Déficit desde renta fija: retiro temprano; el primer año con déficit vende renta fija y
      // paga plusvalía (5% latente por defecto).
      document.getElementById('deficitDest').value = 'bonds';
      document.getElementById('retireAge').value = 45; document.getElementById('retireAgeP2').value = 43;
      runSimulation();
      const deficitYear = Object.values(annualReportsData).find(d => d.investableAvailable < -1000 && d.bondWithdrawn > 0);
      const deficitOk = !!deficitYear && deficitYear.capTaxesPaid > 0;
      const selHasBonds = [...document.querySelectorAll('#cashflowTableBody select')].some(s => [...s.options].some(o => o.value === 'bonds'));

      // Vinculación al parámetro: mover el deslizador cambia el tipo efectivo de la posición.
      document.getElementById('bondYieldParam').value = '5'; syncParamSliders('bondYieldParam');
      const effAt5 = effectiveAssetRatePct(assetsData.find(a => a.id === 'bond_t'), 'capital');
      const label = document.getElementById('valBondYieldParam').innerText;
      const stateHasBond = buildStateObject().macro.bondYield;
      document.getElementById('bondYieldParam').value = '3'; syncParamSliders('bondYieldParam');
      document.getElementById('deficitDest').value = 'stocks';
      document.getElementById('retireAge').value = 55; document.getElementById('retireAgeP2').value = 52;
      runSimulation();
      const summary = document.getElementById('categoriesSummaryGrid').innerText;
      return { before, cols, hoy, growthOk, surplusOk, deficitOk, selHasBonds, effAt5: effAt5.pct, coupled: effAt5.coupled, label, stateHasBond, summaryHasBonds: summary.includes('Renta Fija') };
    });
    assert(r.cols === r.before + 0 && r.cols === 12, `la tabla de balance tiene ${r.cols} columnas (antes ${r.before}), se esperaban 12`);
    assert(r.hoy !== '0' && r.hoy !== '--', `la fila Hoy no muestra la renta fija: "${r.hoy}"`);
    assert(r.growthOk, 'la renta fija no rinde exactamente su tipo en un año sin movimientos');
    assert(r.surplusOk, 'el excedente no entra entero en renta fija cuando es el destino');
    assert(r.deficitOk, 'el déficit no sale de renta fija (o no paga plusvalía) cuando es el origen');
    assert(r.selHasBonds, 'el desplegable de déficit no ofrece la renta fija');
    assert(r.coupled && Math.abs(r.effAt5 - 5) < 1e-9 && r.label === '5.0%', `la posición no sigue al parámetro: ${r.effAt5}% (${r.label})`);
    assert(String(r.stateHasBond) === '5', `el fichero guardado no lleva el tipo de renta fija: ${r.stateHasBond}`);
    assert(r.summaryHasBonds, 'el resumen de categorías no lista la renta fija');

    // Renta fija ligada a inflación y oro: rinden inflación + tipo real en la proyección; en la
    // estanflación la ligada a inflación sigue a la inflación del escenario (acaba por encima de
    // la misma cantidad en renta fija normal) y el oro hace lo que hizo en los 70.
    const t = await page.evaluate(() => {
      const inf = numParam('inflationParam', 2.0) / 100, tipsReal = numParam('tipsRealYieldParam', 1.0) / 100, goldReal = numParam('goldRealReturnParam', 0.0) / 100;
      assetsData.push({ id: 'tips_t', name: '(EJEMPLO) Bonos ligados a inflación', category: 'tips', owner: 'joint', currency: 'EUR', value: 50000 });
      assetsData.push({ id: 'gold_t', name: '(EJEMPLO) Oro', category: 'gold', owner: 'joint', currency: 'EUR', value: 50000 });
      runSimulation();
      const y1 = annualReportsData[START_YEAR + 1], y0 = annualReportsData[START_YEAR];
      const tipsOk = Math.abs(y1.endTips / y0.endTips - (1 + inf + tipsReal)) < 1e-9;
      const goldOk = Math.abs(y1.endGold / y0.endGold - (1 + inf + goldReal)) < 1e-9;
      const cols = document.querySelectorAll('#projectionTableBody tr')[1].querySelectorAll('td').length;
      // El oro va dentro de "Bienes Muebles y Alternativos" (columna 8): la celda suma oro y bienes muebles y el
      // tooltip lleva el desglose y la variación anual.
      const otherCell = document.querySelectorAll('#projectionTableBody tr')[2].querySelectorAll('td')[8];
      const otherTip = otherCell.getAttribute('title') || '';
      const otherTipOk = /Oro y metales preciosos: /.test(otherTip) && /Bienes muebles: /.test(otherTip) && /Variación vs \d{4}: [+-]/.test(otherTip) && /\(\s*[+-][\d,.]+%\)/.test(otherTip);
      const A1 = 55, A2 = 52;
      const stag = buildStressPath(stressScenarioById('stagflation'), 0);
      const at = (r) => (r.series.find(p => p.ageP1 >= 65) || r.series.at(-1)).realNW;
      const withTips = at(evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: stag }));
      // Misma cantidad en renta fija normal en vez de ligada a inflación.
      assetsData.find(a => a.id === 'tips_t').category = 'bonds';
      const withBonds = at(evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: stag }));
      assetsData.find(a => a.id === 'tips_t').category = 'tips';
      // Sin oro, la estanflación deja menos patrimonio real que con él.
      const gold = assetsData.find(a => a.id === 'gold_t'); const saved = gold.value; gold.value = 0;
      const withoutGold = at(evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: stag }));
      gold.value = saved;
      const seed = MC_SEED; const Z = mcStandardShocks(50, 30, seed);
      const ov = mcPathOverrides(Z[0], 0.18, 30, null, Z[1]);
      const goldShockPresent = ov.every(o => typeof o.goldLogShock === 'number');
      assetsData.splice(assetsData.findIndex(a => a.id === 'tips_t'), 1);
      assetsData.splice(assetsData.findIndex(a => a.id === 'gold_t'), 1);
      runSimulation();
      return { tipsOk, goldOk, cols, otherTipOk, otherTip, withTips, withBonds, withoutGold, goldShockPresent };
    });
    assert(t.tipsOk, 'la renta fija ligada a inflación no rinde inflación + tipo real');
    assert(t.goldOk, 'el oro no rinde inflación + tipo real en la proyección determinista');
    assert(t.cols === 12, `columnas con oro: ${t.cols}`);
    assert(t.otherTipOk, `el tooltip de Bienes Muebles y Alternativos no lleva desglose y variación anual:\n${t.otherTip}`);
    assert(t.withTips > t.withBonds, `en estanflación la ligada a inflación no supera a la normal (${t.withTips} vs ${t.withBonds})`);
    assert(t.withTips > t.withoutGold, `en estanflación el oro no añade patrimonio (${t.withTips} vs ${t.withoutGold})`);
    assert(t.goldShockPresent, 'el sorteo no lleva sacudida de oro');

    // Oro en gramos: el valor sale de gramos × precio (Parámetros), en euros, y sigue al precio
    // en cada cálculo; el modal enseña los gramos y bloquea el valor sólo para el oro.
    const g = await page.evaluate(() => {
      const price0 = numParam('goldPricePerGramParam', 100);
      assetsData.push({ id: 'gold_g', name: '(EJEMPLO) Monedas', category: 'gold', owner: 'joint', currency: 'USD', grams: 20, value: 1 });
      runSimulation();
      const a = assetsData.find(x => x.id === 'gold_g');
      const v0 = a.value, c0 = a.currency;
      document.getElementById('goldPricePerGramParam').value = '150'; syncParamSliders('goldPricePerGramParam');
      const v1 = a.value;
      const sample = assetsData.find(x => x.id === 'gold_1');
      const sampleAt150 = sample.value;
      const stateHas = buildStateObject().macro.goldPricePerGram;
      editAssetModal('gold_g');
      const modal = { grams: document.getElementById('modalAssetGrams').value, value: parseFloat(document.getElementById('modalAssetValue').value), ro: document.getElementById('modalAssetValue').readOnly, shown: !document.getElementById('goldGramsField').classList.contains('hidden') };
      closeAssetModal();
      editAssetModal('bond_t');
      const bondModal = { shown: !document.getElementById('goldGramsField').classList.contains('hidden'), ro: document.getElementById('modalAssetValue').readOnly };
      closeAssetModal();
      document.getElementById('goldPricePerGramParam').value = String(price0); syncParamSliders('goldPricePerGramParam');
      assetsData.splice(assetsData.findIndex(x => x.id === 'gold_g'), 1); runSimulation();
      return { price0, v0, c0, v1, sampleValue: sampleAt150, sampleGrams: sample.grams, stateHas, modal, bondModal };
    });
    assert(g.v0 === 20 * g.price0 && g.c0 === 'EUR', `el oro en gramos no se valora a gramos × precio en euros: ${g.v0} ${g.c0}`);
    assert(g.v1 === 20 * 150 && g.sampleValue === g.sampleGrams * 150, `el oro en gramos no sigue al precio: ${g.v1}, ejemplo ${g.sampleValue}`);
    assert(String(g.stateHas) === '150', `el fichero guardado no lleva el precio del oro: ${g.stateHas}`);
    assert(g.modal.shown && g.modal.ro && g.modal.grams === '20' && g.modal.value === 3000, `modal de oro: ${JSON.stringify(g.modal)}`);
    assert(!g.bondModal.shown && !g.bondModal.ro, `el modal de renta fija enseña gramos o bloquea el valor: ${JSON.stringify(g.bondModal)}`);

    // Precio online: con una respuesta de gold-api (dólares por onza troy) el campo pasa a
    // euros por gramo con el tipo USD cargado y las posiciones en gramos se revalorizan; sin
    // respuesta se queda el precio del campo.
    await page.route('**/api.gold-api.com/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'Gold', price: 3110.35, symbol: 'XAU' }) }));
    const f = await page.evaluate(async () => {
      const usd = exchangeRates.USD;
      const expected = Math.round(3110.35 / usd / 31.1034768 * 100) / 100;
      await fetchGoldPrice();
      const price = numParam('goldPricePerGramParam', 0);
      const sample = assetsData.find(x => x.id === 'gold_1');
      const status = document.getElementById('goldPriceStatus').innerText;
      return { expected, price, sampleValue: sample.value, sampleGrams: sample.grams, status };
    });
    assert(f.price === f.expected && f.expected > 0, `el precio online no llega en €/g: ${f.price} vs ${f.expected}`);
    assert(Math.abs(f.sampleValue - f.sampleGrams * f.expected) < 0.01, `la posición en gramos no se revaloriza con el precio online: ${f.sampleValue}`);
    assert(/online/.test(f.status), `estado del precio del oro: ${f.status}`);
    await page.unroute('**/api.gold-api.com/**');
    await page.route('**/api.gold-api.com/**', r => r.abort());
    const f2 = await page.evaluate(async () => { await fetchGoldPrice(); return { price: numParam('goldPricePerGramParam', 0), status: document.getElementById('goldPriceStatus').innerText }; });
    // Sin red el precio no se mueve y el estado dice de cuándo es el que se está usando: el valor
    // de partida lo refresca el workflow semanal, así que ya tiene fecha que enseñar.
    assert(f2.price === f.expected, `sin red el precio debería quedarse: ${f2.price} (${f2.status})`);
    assert(/sin conexión/.test(f2.status) && /\d{4}/.test(f2.status),
      `sin red el estado debería decir la fecha de los valores de partida: ${f2.status}`);
    await page.evaluate((p) => { document.getElementById('goldPricePerGramParam').value = String(p); syncParamSliders('goldPricePerGramParam'); }, g.price0);

    await capturePdf(page);
    const pdf = await page.evaluate(() => { generatePDFReport(); return { hasCol: window.__pdf.includes('<th>Renta Fija</th>'), hasRow: window.__pdf.includes('Fondo Renta Fija') }; });
    assert(pdf.hasCol && pdf.hasRow, `el PDF no lleva la renta fija (columna ${pdf.hasCol}, fila ${pdf.hasRow})`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `columna en balance · rinde su tipo · excedente y déficit por renta fija · vinculada al parámetro · en el PDF · ligada a inflación y oro: estanflación ${Math.round(t.withBonds / 1000)}k → ${Math.round(t.withTips / 1000)}k · oro en gramos a ${g.price0} €/g`;
  } finally { await browser.close(); }
}
