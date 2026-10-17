// Barrido amplio de edades de retiro. Para cada combinación se comprueban invariantes de las
// dos tablas: que balance y cash flow pinten lo mismo, que el ámbar no caiga en años de
// superávit, que sólo haya un aviso de venta activo, que las filas tachadas empiecen después
// del año de decisión y no se interrumpan, y que las pensiones no se desbloqueen antes de
// tiempo.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const result = await page.evaluate(() => {
      const n = (s) => { const m = String(s).replace(/ /g, ' ').match(/-?[\d.]+/); return m ? parseFloat(m[0].replace(/\./g, '')) : null; };
      const p1Init = parseInt(document.getElementById('p1_age').value);
      const p2Init = parseInt(document.getElementById('p2_age').value);

      const runOne = (a1, a2) => {
        document.getElementById('retireAge').value = a1;
        document.getElementById('retireAgeP2').value = a2;
        runSimulation();
        const rows = [...document.querySelectorAll('#cashflowTableBody tr')].map(tr => {
          const td = [...tr.querySelectorAll('td')].map(x => x.innerText.trim());
          return {
            year: parseInt(td[0], 10), surplus: n(td[9]),
            amber: tr.className.includes('amber'), red: tr.className.includes('rose'), void: tr.className.includes('row-void'),
            sale: tr.innerText.includes('Necesaria Venta'), saleDisabled: !!tr.querySelector('div.cursor-not-allowed'),
            quiebra: tr.innerText.includes('QUIEBRA'),
            surplusSelect: !!tr.querySelector('select option[value="splitStocks"]'),
            deficitSelect: !!tr.querySelector('select option[value="pensions"]'),
            pensionEnabled: [...tr.querySelectorAll('select option')].some(o => o.value === 'pensions' && !o.disabled)
          };
        }).filter(r => Number.isFinite(r.year));
        const bal = [...document.querySelectorAll('#projectionTableBody tr')].map(tr => ({
          year: parseInt([...tr.querySelectorAll('td')][0]?.innerText.trim().slice(0, 4), 10),
          amber: tr.className.includes('amber'), red: tr.className.includes('rose'), void: tr.className.includes('row-void')
        })).filter(r => Number.isFinite(r.year));

        const problems = [];
        const sig = (a) => a.map(r => `${r.year}${r.red ? 'R' : r.amber ? 'A' : '-'}${r.void ? 'X' : ''}`).join(',');
        if (sig(rows) !== sig(bal)) problems.push('balance y cash flow no coinciden');
        const amberSurplus = rows.filter(r => r.amber && r.surplus > 0 && r.surplusSelect);
        if (amberSurplus.length) problems.push(`${amberSurplus.length} años ámbar con superávit`);
        const sales = rows.filter(r => r.sale);
        const active = sales.filter(r => !r.saleDisabled);
        if (active.length > 1) problems.push(`${active.length} avisos de venta activos`);
        if (active.length && sales.some(r => r.saleDisabled && r.year < active[0].year)) problems.push('aviso desactivado antes del activo');
        const firstVoid = rows.find(r => r.void);
        const decision = active[0]?.year ?? rows.find(r => r.quiebra)?.year ?? null;
        if (firstVoid && decision && firstVoid.year <= decision) problems.push(`tachado en ${firstVoid.year} <= decisión ${decision}`);
        if (firstVoid && !decision) problems.push(`tachado en ${firstVoid.year} sin año de decisión`);
        if (firstVoid && !rows.filter(r => r.year > firstVoid.year).every(r => r.void)) problems.push('el tachado se interrumpe');
        if (rows.some(r => r.quiebra && (r.surplusSelect || r.deficitSelect))) problems.push('desplegable vivo en fila de quiebra');
        const firstPension = rows.find(r => r.pensionEnabled);
        if (firstPension) {
          const okP1 = START_YEAR + Math.min(Math.max(a1 + 2 - p1Init, 0), 67 - p1Init);
          const okP2 = START_YEAR + Math.min(Math.max(a2 + 2 - p2Init, 0), 67 - p2Init);
          if (firstPension.year < Math.min(okP1, okP2) - 1) problems.push(`pensiones en ${firstPension.year} demasiado pronto`);
        }
        return problems;
      };

      const out = [];
      for (let a1 = p1Init; a1 <= 70; a1++) {
        for (let a2 = p2Init; a2 <= 70; a2++) {
          if ((a1 + a2) % 3 !== 0 && !(a1 % 8 === 0 || a2 % 9 === 0)) continue;
          const problems = runOne(a1, a2);
          if (problems.length) out.push({ a1, a2, problems });
          out.total = (out.total || 0) + 1;
        }
      }
      document.getElementById('retireAge').value = 55; document.getElementById('retireAgeP2').value = 52; runSimulation();
      return { total: out.total, bad: out.slice(0, 8) };
    });
    assert(result.bad.length === 0, `${result.bad.length} combinaciones con incidencias, p.ej. ${JSON.stringify(result.bad[0])}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `${result.total} combinaciones limpias`;
  } finally { await browser.close(); }
}
