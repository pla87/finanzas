// --- SUPUESTOS DEL MOTOR ---
//
// Todo lo que la herramienta da por hecho para calcular, en un solo sitio y en
// castellano llano. No es documentación del código: es lo que hay que poder
// leer para saber si te crees el número que sale.
//
// Cada sección recibe los valores que están en vigor ahora mismo, así que el
// texto dice lo que la herramienta está haciendo de verdad, no lo que haría
// con los valores por defecto. Si algo no te convence, se cambia en Variables
// y esta página se recalcula sola.

import { SAVINGS_TAX_BRACKETS } from './finance.js';
import { WEALTH_TAX_REGIONS, WEALTH_TAX_AS_OF, PRIMARY_HOME_EXEMPTION } from './wealthTax.js';

// Redondeo corto para meter números en prosa sin que canten. El formateador
// entra desde fuera porque el separador decimal depende del idioma: en
// castellano «2,954 %», no «2.954 %», que además se lee como otro número.
function makeFormatter(formatNumber) {
  if (typeof formatNumber === 'function') {
    return (value, decimals = 2) => formatNumber(Number(value) || 0, decimals);
  }
  return (value, decimals = 2) => {
    const fixed = (Number(value) || 0).toFixed(decimals);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  };
}

export function buildAssumptions({ macroParams = {}, calculations = {}, euribor = null, formatNumber, lang = 'es' } = {}) {
  const n = makeFormatter(formatNumber);
  const p = (key, fallback) => n(macroParams[key] ?? fallback);
  const escala = SAVINGS_TAX_BRACKETS;

  const tipoAhorro = calculations.grossSavingsIncome > 0
    ? {
        es: `Con los ${n(calculations.grossSavingsIncome, 0)} € al año de dividendos e intereses que genera tu balance, el tipo medio sale al ${n(calculations.effectiveSavingsRatePct)} %.`,
        en: `On the ${n(calculations.grossSavingsIncome, 0)} € a year of dividends and interest your balance sheet generates, the average rate works out at ${n(calculations.effectiveSavingsRatePct)} %.`
      }
    : {
        es: 'Ahora mismo tu balance no genera dividendos ni intereses, así que no hay cuota que repartir.',
        en: 'Your balance sheet currently generates no dividends or interest, so there is no tax to apportion.'
      };

  const ipContribuyentes = Math.max(1, Math.round(Number(macroParams.wealthTaxPayers) || 1));
  const regimenPatrimonio = WEALTH_TAX_REGIONS[macroParams.wealthTaxRegion] || WEALTH_TAX_REGIONS.estatal;
  const ip = calculations.wealthTax;
  const cuotaPatrimonio = ip && ip.annual > 0
    ? {
        es: `Con tu patrimonio salen ${n(ip.annual, 0)} € al año, unos ${n(ip.monthly, 0)} € al mes${ip.solidarityApplies ? ', y manda el impuesto de solidaridad' : ''}.`,
        en: `On your estate that comes to ${n(ip.annual, 0)} € a year, about ${n(ip.monthly, 0)} € a month${ip.solidarityApplies ? ', with the solidarity tax governing' : ''}.`
      }
    : {
        es: 'Con tu patrimonio actual no pagarías nada por este impuesto.',
        en: 'On your current estate you would pay nothing under this tax.'
      };

  const euriborTexto = euribor && Number.isFinite(Number(euribor.ratePct))
    ? {
        es: `El último euríbor a 12 meses descargado es ${n(euribor.ratePct, 3)} % (${euribor.period || 'sin fecha'})${euribor.stale ? ', y viene marcado como no refrescado' : ''}.`,
        en: `The latest 12-month Euribor downloaded is ${n(euribor.ratePct, 3)} % (${euribor.period || 'undated'})${euribor.stale ? ', and it is flagged as not refreshed' : ''}.`
      }
    : {
        es: 'Todavía no hay euríbor descargado, así que una hipoteca variable usa el último tipo que se le calculó.',
        en: 'No Euribor has been downloaded yet, so a variable mortgage falls back to the last rate calculated for it.'
      };

  return [
    {
      id: 'premisa',
      title_es: 'Qué mide esta herramienta, y qué no',
      title_en: 'What this tool measures, and what it does not',
      body_es: 'Mide la estructura de tu patrimonio: qué tienes, qué debes y cuánto de tu vida pagan tus activos por sí solos. No sabe lo que ganas trabajando y no va a preguntártelo. Los gastos están aquí solo para medir cuánto tienen que cubrir los activos, no para llevarte un presupuesto. Por eso la caja neta mensual sale casi siempre en rojo: no es un suspenso, es la medición funcionando, porque la nómina no entra en la cuenta.',
      body_en: 'It measures the structure of your wealth: what you own, what you owe, and how much of your life your assets pay for on their own. It does not know what you earn from working and will not ask. Expenses are here only to measure what the assets have to cover, not to budget for you. That is why net monthly cash is almost always red: it is not a failing grade, it is the measurement working, because your salary is not part of it.'
    },
    {
      id: 'divisa',
      title_es: 'Divisa',
      title_en: 'Currency',
      body_es: 'Todo se presenta en euros; la herramienta es para España y la base no se cambia. Cada activo y cada deuda sí pueden estar en su propia divisa, y se convierten a euros para mostrarlos con los tipos de cambio que se descargan a diario. Los gastos no llevan divisa: son euros. Si importas una copia de seguridad guardada en otra divisa base, sus gastos se convierten al entrar.',
      body_en: 'Everything is shown in euros; the tool is for Spain and the base does not change. Each asset and liability can carry its own currency, converted to euros for display using exchange rates downloaded daily. Expenses have no currency: they are euros. If you import a backup saved with a different base currency, its expenses are converted on the way in.'
    },
    {
      id: 'inflacion',
      title_es: 'Inflación',
      title_en: 'Inflation',
      body_es: `Se supone un ${p('inflationPct', 2)} % anual. No se usa para inflar nada: es el listón. Un activo que renta por debajo de esa cifra está perdiendo poder adquisitivo aunque su número suba, y la auditoría lo penaliza por eso.`,
      body_en: `Assumed at ${p('inflationPct', 2)} % a year. It is not used to inflate anything: it is the bar. An asset returning below that figure is losing purchasing power even though its number goes up, and the audit penalises it accordingly.`
    },
    {
      id: 'bolsa',
      title_es: 'Inversión cotizada',
      title_en: 'Listed investments',
      body_es: `El bloque tiene cinco subtipos, los mismos que Retiro. Las acciones, de crecimiento o de dividendo, se revalorizan por defecto un ${p('stockGrowthPct', 6)} % anual, que se aplica solo a los fondos; en acciones sueltas pones la que quieras posición a posición, y el dividendo con el que arranca una nueva es el de referencia, ${p('refDividendYieldPct', 3)} %. La renta fija paga su cupón —un ${p('bondYieldPct', 3)} % para empezar, luego el de cada bono— y no se revaloriza: un bono a vencimiento devuelve lo que costó. La renta fija ligada a inflación paga la inflación más un tipo real del ${p('tipsRealYieldPct', 1)} %. El oro no paga nada y se revaloriza con la inflación más un ${p('goldRealReturnPct', 0)} % real. Dividendos y cupones tributan en la base del ahorro.`,
      body_en: `The block has five sub-types, the same as Retiro. Equities, growth or dividend, appreciate by default at ${p('stockGrowthPct', 6)} % a year, applied automatically to funds; for individual shares you set it position by position, and a new one starts with the reference dividend yield, ${p('refDividendYieldPct', 3)} %. Bonds pay their coupon — ${p('bondYieldPct', 3)} % to start with, then each bond's own — and do not appreciate: a bond held to maturity returns what it cost. Inflation-linked bonds pay inflation plus a real yield of ${p('tipsRealYieldPct', 1)} %. Gold pays nothing and appreciates with inflation plus ${p('goldRealReturnPct', 0)} % real. Dividends and coupons are taxed in the savings base.`
    },
    {
      id: 'caja',
      title_es: 'Caja y depósitos',
      title_en: 'Cash and deposits',
      body_es: 'Valen su saldo y no se revalorizan. Los intereses que declares tributan en la base del ahorro, igual que los dividendos. Una cuenta que no remunera nada es lo único que la auditoría penaliza aquí, porque la inflación se la come.',
      body_en: 'Worth their balance, with no appreciation. Any interest you declare is taxed in the savings base, like dividends. An account paying nothing is the one thing the audit penalises here, because inflation eats it.'
    },
    {
      id: 'inmuebles',
      title_es: 'Inmuebles',
      title_en: 'Property',
      body_es: `Se revalorizan un ${p('realEstateAppreciationPct', 2)} % anual, que es su propio parámetro y ya no va pegado a la inflación. El mantenimiento de la vivienda propia —IBI, comunidad, seguros— se estima en un ${p('realEstateMaintenancePct', 0.6)} % del valor al año y sale como rendimiento negativo. Un piso alquilado descuenta un ${p('rentalOperatingCostsPct', 15)} % de costes operativos sobre el alquiler bruto; sobre lo que queda se aplica una amortización fiscal estimada del 3 % sobre el 50 % del valor, se reduce la base un ${p('rentalPrimaryHomeDeductionPct', 50)} % y se grava el resto a tu marginal del ${p('marginalIncomeTaxPct', 37)} %. La vivienda en la que vives genera renta de uso imputada: el alquiler que no pagas. Se informa aparte y nunca se mezcla con el dinero que entra en la cuenta. El suelo es la excepción: no se deprecia, no lleva mantenimiento ni da alquiler, y se revaloriza con la inflación, un ${p('inflationPct', 2)} %, no con la vivienda.`,
      body_en: `They appreciate at ${p('realEstateAppreciationPct', 2)} % a year, which is now its own parameter rather than tracking inflation. Maintenance on a home you live in — council tax, service charges, insurance — is estimated at ${p('realEstateMaintenancePct', 0.6)} % of value per year and shows as a negative return. A rented flat deducts ${p('rentalOperatingCostsPct', 15)} % operating costs from gross rent; on what remains, an estimated tax depreciation of 3 % on 50 % of the value is applied, the base is reduced by ${p('rentalPrimaryHomeDeductionPct', 50)} %, and the rest is taxed at your ${p('marginalIncomeTaxPct', 37)} % marginal rate. The home you live in generates imputed use: the rent you do not pay. It is reported separately and never mixed with money arriving in your account. Land is the exception: it does not depreciate, carries no maintenance or rent, and appreciates with inflation, ${p('inflationPct', 2)} %, not with housing.`
    },
    {
      id: 'pensiones',
      title_es: 'Planes de pensiones y seguros de jubilación',
      title_en: 'Pension plans and retirement insurance',
      body_es: `Los dos se tratan igual. No reparten nada mientras están vivos: no generan flujo de caja corriente, solo se revalorizan. En el patrimonio neto valen su saldo, que es lo que dice tu extracto. En el valor de liquidación no, porque rescatarlos tributa como renta del trabajo a tu tipo marginal: ahí se cuentan al ${n(100 - (Number(macroParams.pensionWithdrawalTaxPct) || 37))} % de su saldo, con un ${p('pensionWithdrawalTaxPct', 37)} % de impuesto. Es la diferencia más grande entre las dos lecturas para quien tenga un plan gordo.`,
      body_en: `Both are treated the same. They pay out nothing while they run: no current cashflow, only appreciation. In net worth they are worth their balance, which is what your statement says. In liquidation value they are not, because cashing them in is taxed as earned income at your marginal rate: there they count at ${n(100 - (Number(macroParams.pensionWithdrawalTaxPct) || 37))} % of balance, with ${p('pensionWithdrawalTaxPct', 37)} % tax. For anyone with a large pot this is the biggest gap between the two readings.`
    },
    {
      id: 'muebles',
      title_es: 'Bienes muebles',
      title_en: 'Physical goods',
      body_es: `Coches, relojes, lo que sea. Suelen tener revalorización negativa —se deprecian— y pueden tener renta de uso si te ahorran alquilar algo. Al liquidar se les aplica un descuento del ${p('tangiblesHaircutPct', 25)} %, porque no se venden por lo que dice el papel.`,
      body_en: `Cars, watches, whatever. They usually have negative appreciation — they depreciate — and can carry imputed use if they save you renting something. On liquidation a ${p('tangiblesHaircutPct', 25)} % haircut applies, because they do not sell for what the paper says.`
    },
    {
      id: 'ahorro',
      title_es: 'Impuesto sobre el ahorro',
      title_en: 'Savings tax',
      body_es: `Dividendos e intereses tributan en la base del ahorro, que en España va por tramos: ${escala.map(b => b.upTo === Infinity ? `del resto, ${n(b.ratePct, 0)} %` : `hasta ${n(b.upTo, 0)} €, ${n(b.ratePct, 0)} %`).join('; ')}. No es un tipo que se elija. Se aplica al total de tu balance y no activo a activo, porque los tramos dependen de la suma: partir la misma renta en dos posiciones no puede salir más barato. ${tipoAhorro.es}`,
      body_en: `Dividends and interest are taxed in the savings base, which in Spain is banded: ${escala.map(b => b.upTo === Infinity ? `on the rest, ${n(b.ratePct, 0)} %` : `up to ${n(b.upTo, 0)} €, ${n(b.ratePct, 0)} %`).join('; ')}. It is not a rate you pick. It applies to your balance sheet as a whole rather than asset by asset, because the bands depend on the total: splitting the same income across two positions cannot come out cheaper. ${tipoAhorro.en}`
    },
    {
      id: 'deuda',
      title_es: 'Deuda e hipotecas',
      title_en: 'Debt and mortgages',
      body_es: `Una hipoteca o un préstamo se amortizan a la francesa desde su fecha de inicio. Puede ser a tipo fijo o variable; en variable el tipo es el euríbor a 12 meses más tu diferencial. ${euriborTexto.es} Ese tipo se mantiene constante en todo el cuadro: esto es una foto de tu patrimonio hoy, no una proyección, y lo que haga el euríbor dentro de tres años no cambia lo que vale tu balance ahora. El cuadro supone además un préstamo de manual, sin cuotas saltadas ni amortizaciones anticipadas; si tu extracto dice otra cosa, escribe el saldo real en la ficha y manda el tuyo.`,
      body_en: `A mortgage or loan amortises on a French schedule from its start date. It can be fixed or variable; on variable the rate is the 12-month Euribor plus your spread. ${euriborTexto.en} That rate is held constant across the schedule: this is a snapshot of your wealth today, not a projection, and what Euribor does in three years does not change what your balance sheet is worth now. The schedule also assumes a textbook loan, with no missed payments or early repayments; if your statement says otherwise, enter the actual balance and yours wins.`
    },
    {
      id: 'runway',
      title_es: 'Runway de emergencia',
      title_en: 'Emergency runway',
      body_es: 'Se dan dos lecturas. La estricta, que es la que manda y la que marca el nivel del colchón, cuenta solo la caja y trata la cuota entera de la deuda como gasto. La segunda afloja las dos cosas: suma lo que se vende en días —caja y todo el bloque de inversión cotizada: acciones, fondos, renta fija y oro— y descuenta solo los intereses, porque la parte de la cuota que amortiza principal no se pierde, se convierte en patrimonio. La verdad está entre las dos.',
      body_en: 'Two readings are given. The strict one, which is the headline and sets the buffer level, counts only cash and treats the full debt payment as burn. The second loosens both: it adds what sells within days — cash and the whole listed-investments block: shares, funds, bonds and gold — and subtracts only interest, because the principal part of a payment is not lost, it becomes equity. The truth sits between the two.'
    },
    {
      id: 'cobertura',
      title_es: 'Cobertura de vida',
      title_en: 'Life coverage',
      body_es: 'Qué parte de tu coste obligatorio —gastos más cuotas de deuda— pagan hoy tus activos sin vender nada. Cuenta solo el dinero que entra en la cuenta. La renta de uso imputada, el alquiler que no pagas por vivir en tu casa, se informa en una línea aparte y nunca se suma al titular: reduce tu coste de vida, pero no es dinero que puedas gastar.',
      body_en: 'How much of your mandatory cost — expenses plus debt payments — your assets pay today without selling anything. It counts only money arriving in your account. Imputed use, the rent you do not pay by living in your own home, is reported on a separate line and never added to the headline: it lowers your cost of living, but it is not money you can spend.'
    },
    {
      id: 'fire',
      title_es: 'Niveles FIRE',
      title_en: 'FIRE levels',
      body_es: `Siete niveles encadenados: el primero que falla corta los siguientes, aunque cumplan lo suyo por separado, y se marcan como bloqueados para que se vea. Los niveles bajos miden flujo —si el cashflow paga las facturas— y el último mide stock: si el capital llega al múltiplo de gasto anual que hayas fijado, ahora ${p('fireTargetMultiple', 25)} veces. Veinticinco equivale a la regla del 4 %; treinta y tres, a la del 3 %.`,
      body_en: `Seven chained levels: the first that fails cuts off the ones after it, even where they meet their own criteria, and those are flagged as blocked so you can see it. The lower levels measure flow — whether cashflow pays the bills — and the last measures stock: whether capital reaches the multiple of annual expenses you set, currently ${p('fireTargetMultiple', 25)}×. Twenty-five matches the 4 % rule; thirty-three, the 3 % rule.`
    },
    {
      id: 'patrimonio',
      title_es: 'Impuesto sobre el patrimonio',
      title_en: 'Wealth tax',
      body_es: `Se paga por tener, no por ganar, y se calcula sobre el patrimonio entero, no activo a activo. La vivienda habitual está exenta hasta ${n(PRIMARY_HOME_EXEMPTION, 0)} €, y en esa misma proporción su hipoteca deja de ser deducible —si no, la casa se descontaría dos veces—; sobre el resto hay un mínimo exento —${n(regimenPatrimonio.exemption, 0)} € con el régimen que tienes elegido (${lang === 'en' ? regimenPatrimonio.name_en : regimenPatrimonio.name_es})—; lo que pase de ahí tributa por la escala estatal, del 0,2% al 3,5%. La bonificación de tu comunidad, ahora del ${n(regimenPatrimonio.bonificationPct, 0)}%, se descuenta después. ${cuotaPatrimonio.es}

El impuesto es por contribuyente, no por hogar, y eso cambia mucho la cuota: un patrimonio a medias no recorre una escala, recorre dos desde abajo, y cada uno se resta su propio mínimo exento y exenta su parte de la vivienda. El balance es del hogar entero y no sabe de quién es cada cosa —Retiro sí lo sabe, y si cargas un fichero suyo el titular de cada activo se conserva para la vuelta, pero aquí no se usa—. Por eso, con ${n(ipContribuyentes, 0)} ${ipContribuyentes === 1 ? 'contribuyente declarado' : 'contribuyentes declarados'} en Variables, el patrimonio se reparte a partes iguales entre ellos. Si en tu caso no es así —todo a nombre de uno, o en proporciones distintas—, la cuota real será mayor que esta.

Bonificar al 100% no deja la cuota en cero por encima de tres millones: ahí entra el impuesto de solidaridad, que es estatal y no se puede bonificar. Por eso Madrid y Andalucía no son gratis para un patrimonio grande.

La escala es SIEMPRE la estatal, también en las comunidades que han aprobado la suya. Lo que de verdad decide la factura es el mínimo exento y la bonificación —a dos millones, la diferencia entre unas comunidades y otras va de cero a casi doce mil euros—, y esos dos sí están y se pueden cambiar. Las escalas autonómicas se separan poco de la estatal, así que modelar ocho casi iguales daría una precisión que los datos no tienen. Pero conviene saberlo: si tu comunidad tiene escala propia, esa parte es una aproximación, y es la única que no puedes corregir a mano. En patrimonios de un par de millones se juegan unos cientos de euros; en los grandes, algunos miles.

Las cifras autonómicas son ORIENTATIVAS y están a ${WEALTH_TAX_AS_OF}. La normativa cambia cada año, esto no consulta nada en vivo y no están todas las comunidades: si la tuya falta o ha cambiado, ajusta a mano el mínimo exento y la bonificación en Variables.`,
      body_en: `Paid for owning, not for earning, and computed on the estate as a whole rather than asset by asset. Your home is exempt up to ${n(PRIMARY_HOME_EXEMPTION, 0)} €, and in that same proportion its mortgage stops being deductible — otherwise the house would be discounted twice; on the rest there is a tax-free allowance — ${n(regimenPatrimonio.exemption, 0)} € under the regime you have selected (${lang === 'en' ? regimenPatrimonio.name_en : regimenPatrimonio.name_es}); anything above that is taxed on the state scale, 0.2% to 3.5%. Your region's rebate, currently ${n(regimenPatrimonio.bonificationPct, 0)}%, is applied afterwards. ${cuotaPatrimonio.en}

The tax is per taxpayer, not per household, and that moves the bill a lot: an estate held in halves does not run up one scale, it runs up two from the bottom, and each holder deducts their own allowance and exempts their share of the home. The balance sheet belongs to the whole household and does not know who owns what — Retiro does, and if you load one of its files each asset's owner is kept for the return trip, but it is not used here. So with ${n(ipContribuyentes, 0)} taxpayer${ipContribuyentes === 1 ? '' : 's'} declared under Parameters, the estate is split evenly between them. If yours is not even — everything in one name, or in different proportions — the real bill will be higher than this.

A 100% rebate does not mean zero above three million: the state solidarity tax takes over there, and that one cannot be rebated. That is why Madrid and Andalusia are not free for a large estate.

The scale used is ALWAYS the state one, including in regions that have approved their own. What really decides the bill is the allowance and the rebate — at two million, the gap between regions runs from zero to nearly twelve thousand euros — and those two are here and can be changed. Regional scales depart little from the state one, so modelling eight near-identical scales would claim a precision the data does not have. Worth knowing all the same: if your region has its own scale, that part is an approximation, and it is the one thing you cannot correct by hand. On estates of a couple of million it is worth a few hundred euros; on large ones, a few thousand.

The regional figures are INDICATIVE and stand as of ${WEALTH_TAX_AS_OF}. The rules change every year, nothing here is looked up live, and not every region is listed: if yours is missing or has changed, set the allowance and rebate by hand in Parameters.`
    },
    {
      id: 'liquidacion',
      title_es: 'Valor de liquidación',
      title_en: 'Liquidation value',
      body_es: `Cuánto dinero quedaría si vendieras todo y cancelaras toda la deuda hoy. Los inmuebles pierden un ${p('propertySellingCostsPct', 8)} % en agencia, notaría y plusvalía municipal; los bienes muebles, un ${p('tangiblesHaircutPct', 25)} %; los planes de pensiones, el ${p('pensionWithdrawalTaxPct', 37)} % de su saldo. La plusvalía de bolsa e inmuebles tributa por la escala del ahorro, sobre la ganancia agregada. Cancelar hipotecas y préstamos cuesta un ${p('earlyRepaymentFeePct', 0.25)} % de comisión sobre el saldo. Cuando una posición no dice lo que costó se supone que ha ganado un ${p('assumedUnrealizedGainPct', 30)} % sobre su coste (con un 30 %, lo que hoy vale 130 costó 100); si rellenas su coste de adquisición, manda ese.`,
      body_en: `How much money would be left if you sold everything and cleared all debt today. Property loses ${p('propertySellingCostsPct', 8)} % to agency, notary and municipal capital-gains tax; physical goods, ${p('tangiblesHaircutPct', 25)} %; pension plans, ${p('pensionWithdrawalTaxPct', 37)} % of balance. Gains on equities and property are taxed through the savings bands, on the aggregate gain. Clearing mortgages and loans costs a ${p('earlyRepaymentFeePct', 0.25)} % fee on the balance. Where a position does not say what it cost, it is assumed to have gained ${p('assumedUnrealizedGainPct', 30)} % over its cost (at 30 %, what is worth 130 today cost 100); fill in its acquisition cost and that wins.`
    },
    {
      id: 'datos',
      title_es: 'Datos de mercado',
      title_en: 'Market data',
      body_es: 'Las cotizaciones, los tipos de cambio y el euríbor se descargan de lunes a viernes por la noche. Si una descarga falla se conserva el valor anterior y queda marcado como no refrescado, en lugar de desaparecer o quedarse a cero. Todo lo demás —tus activos, tus deudas, tus gastos— vive solo en este navegador y no sale de aquí.',
      body_en: 'Quotes, exchange rates and Euribor are downloaded Monday to Friday at night. If a download fails the previous value is kept and flagged as not refreshed, rather than vanishing or going to zero. Everything else — your assets, debts and expenses — lives only in this browser and never leaves it.'
    }
  ];
}
