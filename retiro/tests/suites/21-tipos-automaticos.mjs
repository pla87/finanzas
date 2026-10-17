// El bloque <tipos-automaticos> de index.html lo reescribe un workflow semanal
// (.github/workflows/retiro-tipos.yml) con los tipos de cambio y el precio del oro del día. Esta suite
// comprueba el contrato desde dentro de la página: que los valores que el workflow escribe llegan
// de verdad a donde se usan, y que la página sigue siendo correcta cuando los servicios en vivo
// no contestan, que es lo que pasa siempre en las pruebas y a veces en producción.
//
// Fuera del navegador, scripts/check-rates-block.mjs valida la forma del bloque y
// scripts/test-update-rates.mjs comprueba que el actualizador rechaza datos malos.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(async () => {
      const divisas = ['USD', 'GBP', 'CHF', 'JPY', 'PHP', 'HKD'];

      // 1. El bloque existe y tiene la forma que el workflow espera encontrar para reescribirlo.
      const bloque = {
        fecha: typeof RATES_UPDATED === 'string' ? RATES_UPDATED : null,
        oro: DEFAULT_GOLD_EUR_PER_GRAM,
        euroEsUno: DEFAULT_EXCHANGE_RATES.EUR === 1,
        todasPositivas: divisas.every(d => Number(DEFAULT_EXCHANGE_RATES[d]) > 0),
        etiqueta: ratesUpdatedLabel()
      };

      // 2. Sin servicio en vivo, los tipos que se usan son exactamente los del bloque. En las
      //    pruebas la red está cortada, así que esto es el camino que recorre de verdad.
      await fetchExchangeRates();
      const usados = Object.fromEntries(divisas.map(d => [d, exchangeRates[d]]));
      const coinciden = divisas.every(d => exchangeRates[d] === DEFAULT_EXCHANGE_RATES[d]);
      const estadoFx = document.getElementById('fxStatus').innerText;

      // 3. Y el precio del oro de partida es el del bloque, no el value="" del markup: es lo que
      //    hace que actualizarlo en el fichero sirva de algo.
      const enPantalla = numParam('goldPricePerGramParam', 0);

      // 4. Una posición en divisa se convierte con esos tipos.
      const milDolares = toEUR(1000, 'USD');

      // 5. El euríbor del bloque es el que paga una hipoteca variable: el mismo valor llega al
      //    motor (readSimParams) y a la vista de la deuda que comparten las tablas y el informe.
      const euribor = { pct: DEFAULT_EURIBOR_12M_PCT, periodo: EURIBOR_PERIOD, enMotor: readSimParams().euribor,
        tipoVariable: loanForEngine({ subcategory: 'mortgages', rateType: 'variable', spreadPct: 1, interestRatePct: 99 }).interestRatePct };

      return { bloque, usados, coinciden, estadoFx, enPantalla, milDolares, euribor };
    });

    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.bloque.fecha || ''),
      `RATES_UPDATED debería ser una fecha AAAA-MM-DD y es "${r.bloque.fecha}"`);
    assert(r.bloque.euroEsUno, 'el euro tiene que valer 1: es la base de todos los demás');
    assert(r.bloque.todasPositivas, `alguna divisa del bloque no es positiva: ${JSON.stringify(r.usados)}`);
    assert(Number(r.bloque.oro) > 0, `el precio del oro del bloque es ${r.bloque.oro}`);
    // La etiqueta es lo que ve el usuario cuando el servicio en vivo no contesta.
    assert(/\d{4}/.test(r.bloque.etiqueta) && !/Invalid/.test(r.bloque.etiqueta),
      `la fecha no se formatea para el usuario: "${r.bloque.etiqueta}"`);

    assert(r.coinciden,
      `sin servicio en vivo los tipos usados deberían ser los del bloque: ${JSON.stringify(r.usados)}`);
    assert(/sin conexión/.test(r.estadoFx) && /\d{4}/.test(r.estadoFx),
      `el estado debería decir de cuándo son los tipos: "${r.estadoFx}"`);

    assert(r.enPantalla === Number(r.bloque.oro),
      `el campo del oro debería arrancar en ${r.bloque.oro} y arranca en ${r.enPantalla}`);

    const esperado = Math.round(1000 / r.usados.USD * 100) / 100;
    assert(Math.abs(r.milDolares - esperado) < 0.01,
      `1.000 $ deberían ser ${esperado} € con USD=${r.usados.USD}, y salen ${r.milDolares}`);

    assert(Number.isFinite(r.euribor.pct) && r.euribor.pct > -2 && r.euribor.pct < 20, `el euríbor del bloque es ${r.euribor.pct}`);
    assert(/^\d{4}-\d{2}$/.test(r.euribor.periodo || ''), `el mes del euríbor es "${r.euribor.periodo}"`);
    assert(r.euribor.enMotor === r.euribor.pct, `el motor usa un euríbor de ${r.euribor.enMotor} y el bloque dice ${r.euribor.pct}`);
    assert(Math.abs(r.euribor.tipoVariable - (r.euribor.pct + 1)) < 1e-9,
      `una variable a euríbor + 1 debería pagar ${r.euribor.pct + 1} % y paga ${r.euribor.tipoVariable} %`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `bloque del ${r.bloque.fecha} · oro ${r.bloque.oro} €/g · euríbor ${r.euribor.pct} % (${r.euribor.periodo}) · 1.000 $ = ${Math.round(r.milDolares)} € · sin red usa el bloque`;
  } finally { await browser.close(); }
}
