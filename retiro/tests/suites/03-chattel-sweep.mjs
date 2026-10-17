// 300 escenarios aleatorios (con semilla) de compras de bienes muebles, edades, destinos del
// excedente y cambio de gastos. Se comprueba que una compra que cabe se descuenta del
// disponible y una que no cabe no aparece por ningún sitio, que el valor contable nunca sube
// sin compra ni baja de cero, y que el mantenimiento no se cobra antes de la primera compra.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const out = await page.evaluate(() => {
      const n = (s) => { const m = String(s).replace(/ /g, ' ').match(/-?[\d.]+/); return m ? parseFloat(m[0].replace(/\./g, '')) : null; };
      let seed = 987654;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      const intB = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
      const results = [];
      for (let iter = 0; iter < 300; iter++) {
        const a1 = intB(38, 70), a2 = intB(35, 70);
        chattelEvents.length = 0;
        for (let k = 0, m = intB(1, 6); k < m; k++) {
          chattelEvents.push({ id: 'r' + iter + '_' + k, year: intB(START_YEAR, START_YEAR + 55), name: 'Bien ' + k,
            priceTodayEUR: pick([500, 3000, 12000, 25000, 60000, 250000]), lifeYears: pick([1, 3, 5, 10, 20, 40]), maintPct: pick([0, 0.5, 1, 3, 10]) });
        }
        document.getElementById('retireAge').value = a1;
        document.getElementById('retireAgeP2').value = a2;
        document.getElementById('surplusDest').value = pick(['divStocks', 'growthStocks', 'splitStocks', 'cash', 'debt']);
        document.getElementById('deficitDest').value = pick(['divStocks', 'stocks', 'cash', 'taxOptimized']);
        document.getElementById('expenseChangeParam').value = pick([-40, -20, 0, 20, 40]);
        syncParamSliders('expenseChangeParam', false);
        for (const k of Object.keys(customYearlyRouting)) delete customYearlyRouting[k];
        runSimulation();

        const cf = [...document.querySelectorAll('#cashflowTableBody tr')].map(tr => {
          const td = [...tr.querySelectorAll('td')];
          return { year: parseInt(td[0]?.innerText.trim(), 10), investable: n(td[10]?.innerText),
            bought: /🚗 [^(]*\(-/.test(tr.innerText), rejected: tr.innerText.includes('no cabe'),
            investTip: td[10]?.getAttribute('title') || '', expTip: td[8]?.getAttribute('title') || '' };
        }).filter(r => Number.isFinite(r.year));
        const bal = [...document.querySelectorAll('#projectionTableBody tr')].map(tr => {
          const td = [...tr.querySelectorAll('td')];
          // Columna 8: "Bienes Muebles y Alternativos" (oro + bienes muebles); el valor contable de los bienes
          // muebles va en su línea del tooltip.
          return { year: parseInt(td[0]?.innerText.trim().slice(0, 4), 10), tangTip: td[8]?.getAttribute('title') || '', cols: td.length };
        }).filter(r => Number.isFinite(r.year));

        const p = [];
        const headCols = document.querySelectorAll('#projectionTab thead th').length;
        if (bal.some(r => r.cols !== headCols)) p.push('columnas del balance descuadradas');
        cf.filter(r => r.bought).forEach(r => {
          if (!r.investTip.includes('Compra de Bienes Muebles')) p.push(`${r.year}: comprado sin línea en el tooltip`);
          if (r.investable < 0) p.push(`${r.year}: disponible negativo tras una compra que cabía`);
        });
        cf.filter(r => r.rejected && !r.bought).forEach(r => { if (r.investTip.includes('Compra de Bienes Muebles')) p.push(`${r.year}: rechazada pero descontada`); });
        const bookOf = (tip) => { const m = tip.match(/• Bienes muebles: (-?[\d.]+)/); return m ? parseFloat(m[1].replace(/\./g, '')) : null; };
        const boughtYears = new Set(cf.filter(r => r.bought).map(r => r.year));
        let prev = null, booksRead = 0;
        bal.forEach(r => { const b = bookOf(r.tangTip); if (b === null) return; booksRead++;
          if (b < -1) p.push(`${r.year}: valor contable negativo`);
          if (prev !== null && b > prev + 1 && !boughtYears.has(r.year)) p.push(`${r.year}: el valor contable sube sin compra`);
          prev = b; });
        // Si la línea del tooltip cambia de sitio o de texto, el chequeo anterior se queda mudo:
        // que se note.
        if (booksRead === 0) p.push('no se leyó ningún valor contable del tooltip de Bienes Muebles y Alternativos');
        const firstBuy = cf.find(r => r.bought)?.year ?? null;
        const firstMaint = cf.find(r => r.expTip.includes('Mantenimiento Bienes Muebles'))?.year ?? null;
        if (firstMaint !== null && (firstBuy === null || firstMaint <= firstBuy)) p.push(`mantenimiento en ${firstMaint} antes de la primera compra ${firstBuy}`);
        results.push({ a1, a2, p, bought: cf.filter(r => r.bought).length, rejected: cf.filter(r => r.rejected).length });
      }
      chattelEvents.length = 0;
      document.getElementById('expenseChangeParam').value = 0; syncParamSliders('expenseChangeParam', false);
      document.getElementById('retireAge').value = 55; document.getElementById('retireAgeP2').value = 52; runSimulation();
      return { total: results.length, bad: results.filter(r => r.p.length).slice(0, 5),
               bought: results.reduce((s, r) => s + r.bought, 0), rejected: results.reduce((s, r) => s + r.rejected, 0) };
    });
    assert(out.bad.length === 0, `incidencias: ${JSON.stringify(out.bad[0])}`);
    assert(out.bought > 0 && out.rejected > 0, 'el barrido no ejercitó las dos ramas (compra que cabe / que no cabe)');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `${out.total} escenarios · ${out.bought} compras ejecutadas · ${out.rejected} rechazadas`;
  } finally { await browser.close(); }
}
