// El informe PDF: las páginas de robustez y de Monte Carlo sólo aparecen si el análisis se ha
// ejecutado con los datos actuales, desaparecen al cambiar un dato, las tablas de robustez
// llevan su clase de tipografía y no queda ninguna clase inventada.
export default async function run({ open, assert, capturePdf }) {
  const { browser, page, errors } = await open();
  try {
    await capturePdf(page);
    const r = await page.evaluate(async () => {
      const has = (re) => re.test(window.__pdf || '');
      const gen = () => { window.__pdf = null; generatePDFReport(); };
      const out = {};
      gen(); out.baseDet = has(/Robustez ante Crisis/); out.baseMc = has(/Miles de Trayectorias/); out.baseLen = window.__pdf.length;
      openRobustnessTab();
      gen(); out.tabDet = has(/Robustez ante Crisis/); out.tabMc = has(/Miles de Trayectorias/);
      out.robTables = (window.__pdf.match(/<table class="rob-table">/g) || []).length;
      out.fontRule = /\.rob-table td:nth-child\(2\) \{ text-align: right; font-family: monospace; \}/.test(window.__pdf);
      await runMonteCarlo();
      gen(); out.mcDet = has(/Robustez ante Crisis/); out.mcMc = has(/Miles de Trayectorias/); out.mcDef = has(/Qué defensa compensa más/);
      out.invented = /kpi-box|kpi-grid|kpi-label/.test(window.__pdf);
      out.robTablesMc = (window.__pdf.match(/<table class="rob-table">/g) || []).length;
      switchTab('cashflowTab', null);
      document.getElementById('retireAge').value = 58; runSimulation();
      gen(); out.afterDet = has(/Robustez ante Crisis/); out.afterMc = has(/Miles de Trayectorias/);
      document.getElementById('retireAge').value = 55; runSimulation();
      return out;
    });
    assert(!r.baseDet && !r.baseMc && r.baseLen > 100000, 'sin abrir la pestaña el informe no debería llevar robustez');
    assert(r.tabDet && !r.tabMc, 'con la pestaña abierta: página determinista sí, Monte Carlo no');
    assert(r.robTables === 2 && r.fontRule, `tablas de robustez ${r.robTables} (se esperaban 2), regla de tipografía ${r.fontRule}`);
    assert(r.mcDet && r.mcMc && r.mcDef, 'tras el sorteo faltan páginas o la tabla de defensas');
    assert(!r.invented, 'quedan clases CSS inventadas en el PDF');
    assert(r.robTablesMc === 4, `con Monte Carlo se esperaban 4 tablas de robustez, hay ${r.robTablesMc}`);
    assert(!r.afterDet && !r.afterMc, 'tras cambiar datos con la pestaña cerrada el informe conserva análisis caducados');
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return 'páginas condicionales correctas · 2+2 tablas · sin clases inventadas';
  } finally { await browser.close(); }
}
