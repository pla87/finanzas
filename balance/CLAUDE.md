# Balance Personal

Herramienta de balance patrimonial en `pacolucena.com/balance`. Vive junto a
`pacolucena.com/retiro`, con la que **comparte el formato del fichero de copia
de seguridad**; son dos aplicaciones distintas del mismo dominio.

## La regla que manda sobre todo lo demás

**La herramienta es indiferente al empleo, a propósito.** No pregunta lo que
ganas trabajando y no va a preguntarlo nunca. Mide la estructura del
patrimonio: qué tienes, qué debes y cuánto de tu vida pagan tus activos por sí
solos. Los gastos existen solo para saber cuánto tienen que cubrir los activos,
no para llevar un presupuesto.

De ahí sale una consecuencia que parece un fallo y no lo es: **la caja neta
mensual sale casi siempre en rojo**. No es un suspenso, es la medición
funcionando, porque la nómina no entra en la cuenta. Si alguien propone «añadir
los ingresos para que cuadre», la respuesta es no.

## Órdenes

Hace falta **Node 22 o más**: `npm test` deja que Node expanda el patrón
`src/lib/*.test.js`, y esa expansión no existe hasta la 21. En Node 20 la suite
no es que falle, es que no encuentra ni un fichero.

```bash
npm run dev      # desarrollo
npm test         # 317 pruebas (node:test, sin dependencias)
npm run build    # compilar a dist/
npm run informe  # comprobar que el PDF dice lo mismo que la pantalla (necesita build)
FUZZ_N=50000 npm test   # apretar el barrido aleatorio antes de tocar el motor
```

`npm run informe` no está en el CI y no puede estarlo: necesita un navegador.
Se pasa a mano después de tocar el informe o cualquier cifra que salga en él.

## Cómo está repartido

`src/App.jsx` es la interfaz entera, un componente grande. Todo el cálculo vive
fuera, en módulos puros sin React ni DOM, para poder ejercitarlo desde
`npm test`:

| Fichero | Qué hace |
| --- | --- |
| `lib/finance.js` | Núcleo: amortización, divisas, impuesto del ahorro, subtipos de activo, serializar y deserializar el fichero |
| `lib/engine.js` | `computeBalance`: todo lo que la aplicación deduce del balance |
| `lib/audit.js` | `buildAudit`: notas, méritos, penalizaciones y la mejora que propone cada dimensión |
| `lib/wealthTax.js` | Impuesto sobre el patrimonio, por contribuyente |
| `lib/assumptions.js` | Los supuestos, en prosa, con las cifras del balance metidas dentro |
| `lib/i18n.js` | Castellano e inglés. Ningún texto de interfaz fuera de aquí |
| `lib/fuzz.js` | Generador de balances al azar y comprobador de invariantes |

Tres pruebas no comprueban un cálculo sino el repositorio entero, y son las que
han encontrado los fallos de verdad: `fuzz.test.js` (el barrido),
`limpieza.test.js` (importaciones y exportaciones sin uso) y
`market-data.test.js` (la forma del fichero que el bot publica cada día).

## Convenciones

**Los comentarios van en castellano** y explican *por qué*, no *qué*. El
codebase entero está escrito así; un comentario en inglés desentona.

**Los dos idiomas, siempre en sincronía.** Una prueba falla si una clave existe
en uno y no en el otro, si un marcador `{x}` se pierde por el camino, o si una
clave deja de usarse. Los textos de la auditoría se leen por acceso dinámico
(`t[`audit_good_${id}`]`), y hay pruebas que contrastan en los dos sentidos que
cada identificador que emite el motor tiene su texto y al revés.

**Las pruebas son guardias, no decoración.** Varias no comprueban un cálculo
sino una propiedad del repositorio: que no haya importaciones sin usar, que no
haya exportaciones sin lector, que la interfaz no lleve textos sueltos fuera de
i18n. Si una de esas falla, el arreglo es el código, no la prueba.

**Nada de dependencias a la ligera.** Producción son React y React-DOM. Las
pruebas y el barrido no usan más que `node:test`. El arnés del informe conduce
el Chromium que ya está instalado y sirve `dist/` con el `http` de Node.

**Verificar en el navegador, no solo con pruebas.** Las pruebas llegan hasta
`src/lib`. La pestaña de auditoría se rompió una vez por una importación que
faltaba: la compilación pasó —Rollup trata un identificador no declarado como
global— y solo explotaba al pintar. Después de tocar la interfaz, hay que
abrirla.

## Trampas que ya han mordido

**`Number(x) || porDefecto` confunde un cero deliberado con un campo vacío.**
Ha costado tres tandas de fallos: unos costes operativos al 0% que volvían del
fichero convertidos en 15%, un plazo de 0 meses que se convertía en 240 y hacía
desaparecer una hipoteca entera, una tarjeta bajada a 300 € que volvía debiendo
1.500. Para leer un número que puede ser cero está `numeroOr(valor, defecto)`
en `finance.js`; para un ajuste que puede estar vacío, `nullOrNumber`; para un
importe, `importe`, que además no admite negativos.

**Los importes no admiten negativos; los porcentajes sí.** Deber −100 € no
significa nada, pero un activo que se deprecia tiene revalorización negativa y
el efectivo llegó a tener tipos por debajo de cero. Las fichas ponen suelo en
los importes y en el tipo de las deudas, y la importación recorta lo que venga
de fuera.

**El impuesto sobre el patrimonio es por contribuyente**, no por hogar: no hay
declaración conjunta. El reparto se hace antes de exenciones y escala. Y la
hipoteca de la vivienda habitual no se deduce en la parte exenta (art. 25.1 de
la Ley 19/1991), o la casa se descontaría dos veces.

**El coste obligatorio incluye el impuesto sobre el patrimonio.** El motor y la
auditoría tienen que usar el mismo: cuando no lo hacían, la auditoría aconsejaba
contra un coste de vida más pequeño del que enseñaba en pantalla.

## El fichero, que lo leen las dos herramientas

Una deuda **sin cuadro de amortización** —tarjeta, préstamo personal, familiar—
se declara por lo que se debe HOY. Al exportar viaja con el saldo de hoy en
`initialPrincipal`, **el mes en curso** en `startDate` y los meses que quedan en
`durationMonths`. Al importar se corre ese cuadro hasta hoy, así que un fichero
de Retiro —que describe las deudas desde su alta— entra ya puesto al día, y uno
propio no se mueve un euro.

La **hipoteca** es la excepción: conserva su principal original y su fecha de
firma, porque ahí el saldo sale precisamente de correr el cuadro.

Los **activos** viajan con la categoría de Retiro (`stocks`, `divStocks`,
`bonds`, `tips`, `gold`, `pensions`, `pensionIns`…), que manda al importar;
aquí se guardan como bloque más subtipo (`stockClass`, `pensionType`). En la
renta fija el cupón va en `capitalReturnPct` en el fichero —en Retiro se
reinvierte— y aquí en `cashReturnPct`: la conversión cruza los dos campos al
entrar y al salir. Lo que solo usa Retiro (titular, gramos de oro, vínculo al
estándar) se conserva tal cual. La cuota de una deuda con cuadro viaja como 0,
que en Retiro quiere decir «calcúlala tú».

No cambies el formato sin decirlo: al otro lado hay otra aplicación leyéndolo.

## El manual

El manual de uso se vende en Amazon y vive en **pla87/manuales, que es privado**: este repo
es público y el libro no puede estarlo. La franja de arriba, el aviso de móvil y el botón de
Preguntas Frecuentes enlazan a su ficha (`MANUAL_URL` en `lib/constants.js`, con el
identificador de afiliado). Si cambias la interfaz de forma que el manual quede viejo —una
pestaña nueva, un botón que cambia de nombre—, dilo: hay que rehacer allí capturas y texto.

## Analítica

**No hay Google Analytics, ni etiquetas, ni eventos.** La única medición es
Cloudflare Web Analytics, que Cloudflare Pages inyecta en el borde: no hay
ningún script suyo en el repositorio y no hay que añadirlo. Cuenta páginas
vistas anónimas y no usa cookies, así que no hace falta banner de
consentimiento. Si alguien propone volver a medir eventos o meter otra
herramienta de analítica, eso trae de vuelta las cookies y el banner: la
respuesta es no. Lo que sí se guarda en `localStorage` y `sessionStorage`
(datos, tema, idioma, avisos ya vistos) es funcional y se queda.

## Despliegue

Cloudflare Pages construye desde el código en cada empujón a `main`. No hay
nada que configurar para publicar. `balance-cotizaciones.yml` refresca las cotizaciones
de lunes a viernes y su commit a `main` provoca, de rebote, un despliegue con
los datos frescos.

Hay **dos** guardias, y no una por gusto: `balance-pruebas.yml` mira lo que empujan las
personas, y `balance-cotizaciones.yml` se comprueba a sí mismo —pruebas y compilación
después de descargar, antes de hacer commit— porque GitHub no dispara workflows
desde un push hecho con el `GITHUB_TOKEN` por defecto, que es con el que empuja
el bot. Si algún día se añade otro trabajo que empuje a `main`, tendrá el mismo
problema y necesitará el mismo remedio.

## Dónde se quedó esto

La herramienta se da por terminada. Lo que sigue no es una lista de tareas: es
lo que alguien tiene que saber antes de decidir tocar algo.

### Lo que está comprobado, y hasta dónde

- **El motor**, con un barrido aleatorio de decenas de miles de balances que no
  encuentra ninguna discrepancia. Lo que vigila son propiedades, no cifras: si
  alguien cambia una fórmula a propósito, el barrido no se entera. Para eso
  están las pruebas normales.
- **El informe en PDF**, contrastado cifra a cifra contra la pantalla en dos
  balances. A mano, con `npm run informe`.
- **El fichero compartido con Retiro, en los dos sentidos**, y de verdad: con
  las dos aplicaciones abiertas en un navegador, guardando en una y cargando en
  la otra por sus botones. Un plan de Retiro con las diez categorías, suelo,
  hipoteca variable y saldo real vuelve de aquí con la misma proyección al euro
  (restituyendo lo que solo es de Retiro: carreras, edades de retiro, eventos),
  y un balance de aquí vuelve de Retiro con las mismas cifras. Ese viaje sacó
  tres desviaciones que las pruebas con datos de ejemplo no veían; están
  arregladas y cada una tiene su prueba en `finance.test.js`. El guion del viaje
  no está en el repositorio, porque necesita las dos aplicaciones a la vez: si
  se toca el formato, hay que repetirlo a mano.

### Lo que lleva fecha y se va a quedar viejo

`WEALTH_TAX_AS_OF` marca a qué momento corresponden los mínimos exentos y las
bonificaciones autonómicas del impuesto sobre el patrimonio. La normativa
cambia cada año y esto no consulta nada en vivo. **No lo actualices a ojo**: o
se contrasta con el BOE de la comunidad, o se deja como está, que la
herramienta enseña la fecha precisamente para que nadie dé por hecho que está
al día. Los dos valores se pueden ajustar a mano desde Parámetros.

### Decisiones tomadas a propósito, que parecen fallos

Alguien las va a encontrar y va a querer «arreglarlas». Están discutidas y
descartadas:

- **Todas las comunidades usan la escala estatal.** Lo que cambia por comunidad
  es el mínimo exento y la bonificación, que sí están. Modelar ocho escalas
  casi iguales daría una falsa sensación de precisión.
- **Un cambio mínimo en el rendimiento puede tumbar varios niveles FIRE de
  golpe.** Añadir liquidez al 0% diluye el rendimiento medio, y un nivel que no
  está en verde bloquea a los siguientes. La interfaz lo explica («bloqueado
  por el nivel N · pero cumple su propio criterio»). Es un umbral afilado, no
  un error de cálculo.
- **Con más de veintiocho años de colchón, añadir liquidez lo acorta.** El
  impuesto sobre el patrimonio del euro marginal, sostenido durante ese
  horizonte, cuesta más que el euro. Es coherente con el modelo y solo se ve en
  balances absurdos.
- **`App.jsx` es un componente de más de cinco mil líneas.** Partirlo se lee
  mejor sobre el papel y arriesga mucho por poco: las guardias y el barrido ya
  sujetan lo que de verdad se rompe.

### Cómo se trabajó aquí

Los seis fallos que encontró el barrido aleatorio tenían todos la misma pinta:
no rompían nada visible, y por eso llevaban meses. Un cero que volvía del
fichero convertido en otra cosa, una hipoteca que desaparecía al guardar, una
auditoría que aconsejaba contra un coste de vida distinto del que enseñaba.

Si vas a cambiar algo del cálculo, la secuencia que ha funcionado es: escribir
primero la propiedad que tiene que cumplirse siempre, comprobar que la prueba
**falla** con el código roto a propósito, y solo entonces arreglarlo. Una
prueba que no se ha visto fallar no sujeta nada — eso también se aprendió aquí,
con unas semillas clavadas que pasaban con el fallo reintroducido.
