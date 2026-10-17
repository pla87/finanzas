// Los nombres que escribe el usuario -activos, deudas, inmuebles, bienes muebles, participantes,
// empresas- se pintan con literales de plantilla dentro de innerHTML. Sin escapar, un nombre como
// <img src=x onerror=...> se ejecutaba al dibujar la tabla.
//
// No era "el usuario se ataca a sí mismo": el fichero de copia de seguridad se IMPORTA, y el
// autoguardado lo persiste en localStorage, así que un .txt ajeno dejaba código ejecutándose en
// cada carga de la página hasta borrar los datos del navegador.
//
// Dos defensas, y las dos se comprueban aquí:
//   · escHtml() al PINTAR, nunca al guardar: los nombres tienen que viajar tal cual en el fichero,
//     que comparte formato con pacolucena.com/balance.
//   · los identificadores se sanean al IMPORTAR, porque acaban dentro de manejadores en línea
//     (onclick="editAssetModal('id')"), que es contexto JavaScript: ahí el escapado HTML no
//     protege, el navegador deshace las entidades antes de evaluar el código.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    page.on('dialog', d => d.dismiss());
    const r = await page.evaluate(async () => {
      const P = `<img src=x onerror="window.__pwned=(window.__pwned||0)+1">`;
      const Q = `" onmouseover="window.__pwned=(window.__pwned||0)+1" x="`;
      window.__pwned = 0;
      const base = JSON.parse(JSON.stringify(buildStateObject()));
      const s = JSON.parse(JSON.stringify(base));

      s.assetsData = [
        { id: `a'),alert(1);//`, name: P, category: 'cash', owner: 'p1', currency: 'EUR', value: 50000 },
        { id: 'pp9', name: Q, category: 'pensions', owner: 'p1', currency: 'EUR', value: 90000 },
        { id: 're9', name: P, category: 'real_estate', owner: 'p1', currency: 'EUR', value: 300000,
          useType: 'rented', monthlyRent: 900, opexPct: 10 },
        { id: 'g9', name: Q, category: 'gold', owner: 'p1', currency: 'EUR', value: 5000, grams: 50 }
      ];
      s.liabilitiesData = [{ id: `l'),alert(2);//`, name: P, subcategory: 'mortgages', propertyLink: 're9',
        currency: 'EUR', initialPrincipal: 100000, startDate: '2020-01', durationMonths: 240,
        interestRatePct: 2, monthlyPayment: 0, noMonthlyPayment: false }];
      s.realEstateEvents = [
        { id: 'ev9', assetId: 're_buy_z', type: 'buy', year: START_YEAR + 3, name: P, useType: 'vacant',
          owner: 'p1', priceTodayEUR: 200000, rentTodayEUR: 0, opexPct: 10, downPct: 30, expPct: 10,
          hasMort: false, mortRate: 0, mortYears: 0 },
        { id: 'ev10', assetId: 're9', type: 'sell', year: START_YEAR + 6 }
      ];
      s.chattelEvents = [{ id: 'ch9', year: START_YEAR + 2, name: P, priceTodayEUR: 12000, lifeYears: 8, maintPct: 2 }];
      s.careers[1].name = P;
      s.careers[2].name = Q;
      Object.values(s.careers).forEach(c => (c.stages || []).forEach(st => { st.company = P; }));

      applyStateObject(s);
      runSimulation();
      await new Promise(res => setTimeout(res, 300));
      // Todas las pestañas y el informe PDF, que es otro sumidero de innerHTML.
      document.querySelectorAll('[onclick*="showTab"]').forEach(b => { try { b.click(); } catch (e) {} });
      await new Promise(res => setTimeout(res, 400));
      const abrirAntes = window.open;
      window.open = () => ({ document: { write() {}, close() {} }, focus() {}, close() {} });
      try { generatePDFReport(); } catch (e) {}
      window.open = abrirAntes;
      await new Promise(res => setTimeout(res, 200));

      // Un payload que quedó como TEXTO no crea ningún nodo ni ningún atributo de evento: eso es
      // exactamente lo que distingue "escapado" de "ejecutado".
      const inyectados = [...document.querySelectorAll('img[onerror], [onmouseover], [onload]')];
      const donde = [...new Set(inyectados.map(el => {
        let n = el; while (n && !n.id) n = n.parentElement; return n ? n.id : '(sin id)';
      }))];

      // El nombre sigue viéndose entero, solo que como texto.
      const seVe = document.body.innerText.includes('<img src=x onerror=');

      // Y en el fichero viaja tal cual: escapar al guardar corrompería el formato compartido.
      const exportado = buildStateObject();
      const nombreIntacto = exportado.assetsData[0].name === P;
      const empresaIntacta = exportado.careers[1].stages[0].company === P;

      // Identificadores saneados, y las referencias cruzadas siguen apuntando a donde apuntaban.
      const ids = exportado.assetsData.map(a => a.id).concat(exportado.liabilitiesData.map(l => l.id));
      const idsLimpios = ids.every(id => /^[A-Za-z0-9_-]+$/.test(id));
      const enlace = exportado.liabilitiesData[0].propertyLink;
      const enlaceValido = exportado.assetsData.some(a => a.id === enlace);

      applyStateObject(base); runSimulation();
      return { pwned: window.__pwned, inyectados: inyectados.length, donde, seVe,
               nombreIntacto, empresaIntacta, ids, idsLimpios, enlace, enlaceValido };
    });

    assert(r.pwned === 0, `se ha ejecutado código del usuario ${r.pwned} vez/veces`);
    assert(r.inyectados === 0,
      `han quedado ${r.inyectados} nodos inyectados en: ${r.donde.join(', ')}`);
    // Escapar no es esconder: el nombre tiene que seguir leyéndose.
    assert(r.seVe, 'el nombre con etiquetas debería verse como texto, no desaparecer');
    // Y no se toca lo que se guarda, que es lo que lee pacolucena.com/balance.
    assert(r.nombreIntacto, 'el nombre guardado no puede salir escapado del fichero');
    assert(r.empresaIntacta, 'la empresa guardada no puede salir escapada del fichero');
    assert(r.idsLimpios, `algún identificador importado no se ha saneado: ${r.ids.join(', ')}`);
    assert(r.enlaceValido,
      `la hipoteca se ha quedado sin inmueble al sanear los identificadores: apunta a "${r.enlace}"`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `0 ejecuciones y 0 nodos inyectados en tablas, pestañas y PDF · nombres intactos en el fichero · ids saneados`;
  } finally { await browser.close(); }
}
