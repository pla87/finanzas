# Balance Personal

Una radiografía de tu patrimonio: qué tienes, qué debes y **cuánto de tu vida
pagan tus activos por sí solos**.

En marcha: **[pacolucena.com/balance](https://pacolucena.com/balance/)**

Todo se calcula en tu navegador. No hay cuenta ni base de datos: lo que guardas
se queda en el almacenamiento local, y la copia de seguridad es un fichero que
descargas tú. **Tus cifras financieras no salen de ahí.** No hay Google
Analytics. La web solo cuenta visitas anónimas con Cloudflare Web Analytics, que
no usa cookies, así que no hace falta banner de consentimiento. El formulario de
sugerencias envía solo lo que escribes en él.

## Qué mide, y qué no

**No pregunta lo que ganas trabajando, y no va a preguntarlo.** Es la decisión
de diseño que ordena todo lo demás. La herramienta mide la estructura de tu
patrimonio, no tu presupuesto: los gastos están aquí solo para saber cuánto
tienen que cubrir los activos.

De ahí sale una cifra que sorprende la primera vez: **la caja neta mensual sale
casi siempre en rojo**. No es un suspenso. Es la medición funcionando, porque
la nómina no entra en la cuenta. El día que ese número llegue a cero, tus
activos pagan tu vida entera y la nómina es opcional. Eso es exactamente lo que
la herramienta quiere que veas.

## Qué hay dentro

- **Balance integral.** Activos y pasivos por categorías, en diez divisas, con
  las cotizaciones refrescadas cada día laborable y las hipotecas variables
  siguiendo al euríbor.
- **Flujo de caja.** De lo que rinden los activos a lo que queda en la cuenta,
  paso a paso: impuesto del ahorro por tramos, cuotas de deuda, impuesto sobre
  el patrimonio y coste de vida.
- **Auditoría patrimonial.** Dos ejes —cómo está construido el balance y cuánto
  de tu vida sostiene— con seis dimensiones, y en cada una lo que ya está bien,
  lo que descuenta puntos y la mejora concreta que más puntos devuelve.
- **Camino FIRE.** Siete niveles, del colchón de emergencia a la independencia,
  cada uno con su criterio y lo que te falta para el siguiente.
- **Informe en PDF**, copia de seguridad en un fichero, castellano e inglés y
  tema claro y oscuro.

Los supuestos con los que calcula están escritos en prosa dentro de la propia
herramienta, con tus cifras metidas dentro, y todos se pueden cambiar.

El formato de la copia de seguridad lo comparte con
[pacolucena.com/retiro](https://pacolucena.com/retiro/), el simulador de
jubilación: un balance hecho aquí se abre allí y al revés.

## Cómo se trabaja con esto

Hace falta **Node 22 o más**.

```bash
npm install
npm run dev        # desarrollo
npm test           # 294 pruebas, sin dependencias (node:test)
npm run build      # compilar a dist/
npm run informe    # comprobar que el PDF dice lo mismo que la pantalla
```

`src/App.jsx` es la interfaz. Todo el cálculo vive en `src/lib/`, en módulos
puros sin React ni DOM, para poder ejercitarlo desde las pruebas: el motor
(`engine.js`), el núcleo financiero (`finance.js`), la auditoría (`audit.js`),
el impuesto sobre el patrimonio (`wealthTax.js`) y los dos idiomas
(`i18n.js`).

### Lo que vigila que las cifras no mientan

Las pruebas no son solo de cálculo. Varias comprueban propiedades del
repositorio entero, y son las que han encontrado los fallos de verdad:

- **Un barrido aleatorio** (`fuzz.js`) genera balances al azar y exige que se
  cumplan siempre las mismas propiedades: que el patrimonio cuadre, que la
  cascada de caja sume, que la auditoría aconseje contra el mismo coste de vida
  que enseña, y que **guardar y volver a cargar no mueva una sola cifra**. Con
  `FUZZ_N=50000 npm test` se aprieta más antes de tocar el motor.
- **`npm run informe`** abre la aplicación compilada y contrasta las 48 cifras
  del informe en PDF contra las mismas cifras en pantalla, en dos balances
  distintos.
- **Guardias de higiene**: fallan si algún fichero importa algo que no usa, si
  una exportación se queda sin lector, si una clave de idioma existe en un
  idioma y no en el otro, o si la interfaz lleva un texto suelto fuera de
  `i18n.js`.

### Despliegue

Cloudflare Pages construye desde el código en cada empujón a `main`. Dos
workflows lo protegen: `balance-pruebas.yml` mira lo que empujan las personas, y
`balance-cotizaciones.yml` —que refresca las cotizaciones de lunes a viernes— se
comprueba a sí mismo antes de hacer commit, porque GitHub no dispara workflows
desde el push de un bot.

## Aviso

Esto es una herramienta de simulación cuantitativa con fines informativos. No
es asesoramiento financiero, fiscal ni legal. Las cifras fiscales son
orientativas, llevan fecha dentro de la propia herramienta y se pueden ajustar
a mano.

---

Si vas a tocar el código, lee antes [`CLAUDE.md`](CLAUDE.md): están las
convenciones, las trampas que ya han mordido y dónde se quedó cada cosa.
