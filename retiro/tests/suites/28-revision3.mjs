// Tercera ronda de la revisión. Cada bloque dice qué fallaba; se escribieron antes que el arreglo.
export default async function run({ open, assert }) {
  const notas = [];
  const dialogos = [];
  const onDialog = async (d) => { dialogos.push(d.message()); await d.accept(); };
  const IDS = ['assetModal', 'shareModal', 'debtModal', 'welcomeModal', 'faqModal', 'feedbackModal',
    'yearReportModal', 'reYearPickerModal', 'reEventModal', 'chattelModal'];

  // 1. Modales en móviles bajos: la tarjeta con max-h-[90vh] y centrada dejaba «Cerrar» fuera de la
  // vista sin posibilidad de llegar. Ahora la capa se desplaza: al final del scroll toda la tarjeta
  // se ve por encima de la línea del aviso de móvil (~28 px), y arriba del todo no se corta por arriba.
  for (const [w, h] of [[375, 667], [390, 844]]) {
    const { browser, page, errors } = await open({ onDialog });
    try {
      await page.setViewportSize({ width: w, height: h });
      for (const id of IDS) {
        const r = await page.evaluate((id) => {
          const m = document.getElementById(id);
          m.classList.remove('hidden'); m.classList.add('flex');
          m.scrollTop = 0;
          const card = m.firstElementChild;
          const top = card.getBoundingClientRect().top;
          m.scrollTop = m.scrollHeight;
          const bottom = card.getBoundingClientRect().bottom;
          const out = { top, bottom, vh: innerHeight, ov: getComputedStyle(m).overflowY, mh: getComputedStyle(card).maxHeight };
          m.classList.add('hidden'); m.classList.remove('flex');
          return out;
        }, id);
        assert(r.ov === 'auto', `${id}: la capa debe desplazarse (${w}x${h}): ${r.ov}`);
        assert(r.top >= 0, `${id}: la tarjeta no se corta por arriba (${w}x${h}): ${r.top}`);
        assert(r.bottom <= r.vh - 28, `${id}: el final de la tarjeta queda por encima de la línea de móvil (${w}x${h}): ${r.bottom} > ${r.vh - 28}`);
      }
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
    } finally { await browser.close(); }
  }
  notas.push('10 modales caben o se desplazan a 375x667 y 390x844');

  // 2. El relleno inferior del cuerpo en móvil lo pisaba p-3 (misma especificidad, cargada después).
  {
    const { browser, page } = await open({ onDialog });
    try {
      await page.setViewportSize({ width: 375, height: 667 });
      const pb = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
      assert(pb >= 36, `el cuerpo deja sitio a la línea de móvil: ${pb}px`);
      await page.setViewportSize({ width: 1440, height: 900 });
      const pbD = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
      assert(pbD < 36, `y en escritorio no: ${pbD}px`);
      notas.push('relleno inferior en móvil');
    } finally { await browser.close(); }
  }

  // 3. Pie: el enlace a Balance se llama «Balance Personal», no «Compartir…».
  {
    const { browser, page } = await open({ onDialog });
    try {
      const t = await page.evaluate(() => document.querySelector('footer a[href*="pacolucena.com/balance"]').innerText.trim());
      assert(/^🔗?\s*Balance Personal$/.test(t) || t.includes('Balance Personal') && !/Compartir/.test(t), `texto del enlace: ${t}`);
      notas.push('pie: Balance Personal');
    } finally { await browser.close(); }
  }

  // 4 y 5. Sin pareja: desplegable de titular, nota en la tabla y totales de sección.
  {
    const { browser, page, errors } = await open({ onDialog });
    try {
      await page.evaluate(() => {
        document.getElementById('exp_hasPartner').value = 'no';
        assetsData.push({ id: 'x_p2', name: 'De la pareja', category: 'cash', owner: 'p2', value: 10000, currency: 'EUR', cashReturnPct: 0, capitalReturnPct: 0 });
        assetsData.push({ id: 'x_j', name: 'A medias', category: 'cash', owner: 'joint', value: 20000, currency: 'EUR', cashReturnPct: 0, capitalReturnPct: 0 });
        togglePartnerAndRun();
      });
      const r = await page.evaluate(() => {
        const vis = (id) => Array.from(document.getElementById(id).options).filter(o => !o.hidden && !o.disabled).map(o => o.value);
        openAddAssetModal('cash');
        const nuevo = vis('modalAssetOwner');
        editAssetModal('x_p2'); const p2 = vis('modalAssetOwner');
        editAssetModal('x_j'); const jt = vis('modalAssetOwner');
        openReEventModal(START_YEAR + 1); const compra = vis('reBuyOwner');
        const tabla = document.getElementById('assetsCategorizedTables').innerText;
        const cab = Array.from(document.querySelectorAll('#assetsCategorizedTables strong')).find(s => s.innerText.includes('Liquidez')).innerText;
        const brutoCash = assetsData.filter(a => a.category === 'cash').reduce((s, a) => s + a.value, 0);
        const cuenta = assetsData.filter(a => a.category === 'cash' && enPlan(a)).reduce((s, a) => s + a.value * soloShare(a), 0);
        return { nuevo, p2, jt, compra, tabla, cab, brutoCash, cuenta, fmtC: fmt(cuenta), fmtB: fmt(brutoCash) };
      });
      assert(JSON.stringify(r.nuevo) === '["p1"]', `sin pareja un activo nuevo solo puede ser de P1: ${r.nuevo}`);
      assert(r.p2.includes('p2') && !r.p2.includes('joint'), `uno de P2 conserva su opción: ${r.p2}`);
      assert(r.jt.includes('joint') && !r.jt.includes('p2'), `uno conjunto conserva su opción: ${r.jt}`);
      assert(JSON.stringify(r.compra) === '["p1"]', `la compra programada tampoco ofrece pareja: ${r.compra}`);
      assert(r.tabla.includes('no cuenta: es de la pareja') && r.tabla.includes('cuenta al 50 %'), 'la tabla anota lo que no cuenta');
      assert(r.cab.includes(r.fmtC) && r.cab.includes(r.fmtB) && r.cab.includes('bruto'), `el total de sección enseña lo que cuenta y el bruto: ${r.cab}`);
      assert(r.cuenta < r.brutoCash, 'el ejemplo debe tener diferencia');
      // Con pareja, vuelve todo.
      const c = await page.evaluate(() => {
        document.getElementById('exp_hasPartner').value = 'yes'; togglePartnerAndRun();
        openAddAssetModal('cash');
        const opts = Array.from(document.getElementById('modalAssetOwner').options).filter(o => !o.hidden && !o.disabled).map(o => o.value);
        const cab = Array.from(document.querySelectorAll('#assetsCategorizedTables strong')).find(s => s.innerText.includes('Liquidez')).innerText;
        return { opts, cab };
      });
      assert(c.opts.length === 3, `con pareja, los tres titulares: ${c.opts}`);
      assert(!c.cab.includes('bruto'), `con pareja el total no menciona el bruto: ${c.cab}`);
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('titulares y totales sin pareja');
    } finally { await browser.close(); }
  }

  // 6. Tarjetas FIRE y fin de deuda.
  {
    const { browser, page, errors } = await open({ onDialog });
    try {
      const r = await page.evaluate(() => {
        const out = {};
        out.fin = document.getElementById('kpiDebtFreeAge').innerText + ' | ' + document.getElementById('kpiDebtFreeYear').innerText;
        out.hasPartner = hasPartner;
        return out;
      });
      if (r.hasPartner && !/Permanente/.test(r.fin)) assert(/\(P1\)/.test(r.fin) && /de P1/.test(r.fin), `fin de deuda aclara P1: ${r.fin}`);
      // Gastos desorbitados: FIRE no se alcanza.
      const f = await page.evaluate(() => {
        const el = document.getElementById('exp_hasPartner'); el.value = 'no'; togglePartnerAndRun();
        const g = document.querySelector('input[id^="exp_"]');
        assetsData.forEach(a => { a.value = 1000; }); // nada rinde para cubrir los gastos
        runSimulation();
        return document.getElementById('kpiFireAge').innerText + ' | ' + document.getElementById('kpiFireYear').innerText;
      });
      assert(/^No alcanzado \|/.test(f) && /sin vender/.test(f) && !/100\+/.test(f), `FIRE no alcanzado: ${f}`);
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
      notas.push('tarjetas FIRE y fin de deuda');
    } finally { await browser.close(); }
  }

  // 7. Importar espera al diálogo, no a un reloj: la señal es que el diálogo llegó con el plan ya cargado.
  {
    const { browser, page } = await open({ onDialog });
    try {
      const fichero = await page.evaluate(() => JSON.stringify(buildStateObject()));
      dialogos.length = 0;
      await page.setInputFiles('#fullBackupInput', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(fichero) });
      const t0 = Date.now();
      await (await import('../harness.mjs')).esperaDialogo(page, dialogos);
      assert(dialogos.length === 1 && /cargado correctamente/.test(dialogos[0]), `diálogo de éxito: ${dialogos}`);
      assert(Date.now() - t0 < 10000, 'sin esperas fijas');
      notas.push('espera por diálogo');
    } finally { await browser.close(); }
  }
  return notas.join(' · ');
}
