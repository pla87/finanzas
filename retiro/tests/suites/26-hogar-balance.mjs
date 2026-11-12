// Tamaño del hogar en el fichero compartido con pacolucena.com/balance. Balance lo guarda como un
// número (`familyMembers`); Retiro lo guarda como pareja sí/no y la edad de cada hijo. Antes Retiro
// ignoraba el número y conservaba su propio hogar, así que un hogar de 2 de Balance volvía como 4.
//
// Lo que se fija: un fichero con `familyMembers` y sin detalle ajusta el hogar (1 = solo; 2 = pareja;
// N>=3 = pareja y N-2 hijos); las edades que no trae se conservan si Retiro ya tenía hijos y el
// número cuadra, y si no, se avisa; y Retiro escribe `familyMembers` al exportar.
export default async function run({ open, assert }) {
  const dialogos = [];
  const { browser, page, errors } = await open({ onDialog: async (d) => { dialogos.push(d.message()); await d.accept(); } });
  try {
    const r = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(buildStateObject()));
      const hogar = () => ({ pareja: hasPartner, hijos: [...childrenAges],
        selPareja: document.getElementById('exp_hasPartner').value, selHijos: document.getElementById('exp_childrenCount').value });
      const deBalance = (n) => { const s = JSON.parse(JSON.stringify(base)); delete s.hasPartner; delete s.childrenAges; s.familyMembers = n; return s; };
      const out = {};

      out.exportado = buildStateObject().familyMembers;

      // Los datos de ejemplo traen pareja y dos hijos de 5 y 2 años.
      out.base = hogar();
      for (const n of [1, 2, 3, 4, 5, 6]) {
        // Cada caso parte de los datos de ejemplo para que no dependa del anterior.
        applyStateObject(JSON.parse(JSON.stringify(base)));
        const aviso = applyStateObject(deBalance(n));
        out['n' + n] = { ...hogar(), aviso, exp: buildStateObject().familyMembers };
      }

      // Un fichero de Retiro con detalle coherente con el número: las edades del fichero mandan.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      const coherente = JSON.parse(JSON.stringify(base)); coherente.hasPartner = true; coherente.childrenAges = [9, 7, 4]; coherente.familyMembers = 5;
      const avisoCoh = applyStateObject(coherente);
      out.coherente = { ...hogar(), aviso: avisoCoh };

      // Un fichero con detalle que NO cuadra con el número (Balance cambió el hogar): manda el número.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      const incoherente = JSON.parse(JSON.stringify(base)); incoherente.hasPartner = true; incoherente.childrenAges = [9, 7]; incoherente.familyMembers = 2;
      applyStateObject(incoherente);
      out.incoherente = hogar();

      // Un fichero antiguo de Retiro, sin familyMembers: se queda como está.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      const antiguo = JSON.parse(JSON.stringify(base)); delete antiguo.familyMembers; antiguo.hasPartner = false; antiguo.childrenAges = [3];
      applyStateObject(antiguo);
      out.antiguo = hogar();

      // De 2 a 3 con hijos previos: Retiro tenía [5, 2]; un fichero de 4 conserva esas edades.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      applyStateObject(deBalance(4));
      out.conserva = hogar();
      return out;
    });

    assert(r.exportado === 4, `Retiro debe exportar familyMembers = 1 + pareja + hijos (4), da ${r.exportado}`);
    assert(r.base.pareja && r.base.hijos.length === 2, 'los datos de ejemplo parten con pareja y dos hijos');
    const esperado = { 1: [false, 0], 2: [true, 0], 3: [true, 1], 4: [true, 2], 5: [true, 3], 6: [true, 4] };
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const h = r['n' + n];
      assert(h.pareja === esperado[n][0] && h.hijos.length === esperado[n][1],
        `familyMembers ${n} debe dar pareja=${esperado[n][0]} y ${esperado[n][1]} hijos, da ${JSON.stringify(h)}`);
      assert(h.selPareja === (h.pareja ? 'yes' : 'no') && h.selHijos === String(h.hijos.length), `los desplegables siguen al hogar (${n}): ${JSON.stringify(h)}`);
      assert(h.exp === n, `importar ${n} y exportar debe devolver ${n}, da ${h.exp}`);
    }
    // Solo avisa cuando faltan edades que Retiro no tenía de dónde sacar.
    assert(!r.n1.aviso && !r.n2.aviso, 'sin hijos no hay edades que revisar');
    assert(!r.n4.aviso, 'con los mismos hijos que había se conservan las edades y no se avisa');
    assert(r.n3.aviso, 'con distinto número de hijos no se sabe a quién corresponde cada edad: se avisa');
    assert(r.n5.aviso && r.n6.aviso, 'con más hijos que los que había, hay edades inventadas y se avisa');
    assert(JSON.stringify(r.n3.hijos) === '[5]' && JSON.stringify(r.conserva.hijos) === '[5,2]', 'se conservan las edades que Retiro ya tenía');
    assert(JSON.stringify(r.n5.hijos) === '[5,2,1]', 'los hijos nuevos entran con la edad por defecto (1)');
    assert(JSON.stringify(r.coherente.hijos) === '[9,7,4]' && !r.coherente.aviso, 'un detalle coherente con el número se respeta y no avisa');
    assert(r.incoherente.pareja && r.incoherente.hijos.length === 0, 'si el detalle no cuadra con familyMembers, manda familyMembers');
    assert(!r.antiguo.pareja && JSON.stringify(r.antiguo.hijos) === '[3]', 'un fichero antiguo sin familyMembers sigue como antes');
    assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
  } finally {
    await browser.close();
  }

  // Por la vía real del botón: el aviso de las edades sale tras importar un fichero de Balance.
  {
    const { browser, page, errors } = await open({ onDialog: async (d) => { dialogos.push(d.message()); await d.accept(); } });
    try {
      const fichero = await page.evaluate(() => {
        const s = JSON.parse(JSON.stringify(buildStateObject())); delete s.hasPartner; delete s.childrenAges; s.familyMembers = 6;
        return JSON.stringify(s);
      });
      dialogos.length = 0;
      await page.setInputFiles('#fullBackupInput', { name: 'balance.txt', mimeType: 'text/plain', buffer: Buffer.from(fichero) });
      await page.waitForTimeout(3000);
      assert(dialogos.some(m => /edades de los hijos/i.test(m)), 'tras importar un hogar de Balance con hijos sin edades se avisa de revisar las edades: ' + JSON.stringify(dialogos));
      const fichero2 = await page.evaluate(() => {
        const s = JSON.parse(JSON.stringify(buildStateObject())); delete s.hasPartner; delete s.childrenAges; s.familyMembers = 2;
        return JSON.stringify(s);
      });
      dialogos.length = 0;
      await page.setInputFiles('#fullBackupInput', { name: 'balance.txt', mimeType: 'text/plain', buffer: Buffer.from(fichero2) });
      await page.waitForTimeout(3000);
      assert(!dialogos.some(m => /edades de los hijos/i.test(m)), 'sin hijos no se avisa');
      assert(errors.length === 0, 'errores de página: ' + errors.join(' | '));
    } finally {
      await browser.close();
    }
  }
  return 'hogar de Balance -> Retiro, y familyMembers al exportar';
}
