# Pruebas

Veinticinco suites que abren la herramienta en un Chromium de verdad y comprueban lo que hace.
No hay unidades ni mocks: el motor vive dentro del HTML, así que se prueba donde vive.

## Correrlas

```sh
cd test
npm install            # sólo la primera vez
npx playwright install chromium   # idem, salvo en contenedores que ya lo traen
npm test               # las veinticinco
npm test -- verificar cruzar      # sólo algunas
```

Playwright está en `test/package.json` y **no** en el del proyecto a propósito: Cloudflare Pages
corre `npm install` en la raíz para desplegar, y no tiene por qué bajarse un navegador para eso.

## El armazón

Las dos primeras son la red de seguridad de verdad; las demás cuidan comportamientos concretos.

**`verificar`** — el motor contra los valores que tenía calculados la hoja de cálculo original,
guardados en `esperado.json`.

**`cruzar`** — el motor contra `modelo.py`, una transcripción independiente del modelo escrita
en Python a partir de las mismas fórmulas, en quince escenarios (con y sin préstamo personal, con
una y otra amortización acelerada, piso barato, sin entrada, deuda que se cancela a mitad de año, cuarenta años sin deuda para agotar la amortización fiscal, comisión de apertura, gastos estimados con las tasas por defecto y tres del tope de intereses y conservación: una comisión que no cabe el año 1 y se arrastra, un interés que choca con el tope y uno que no deja hueco nunca y caduca). Dos implementaciones escritas por
separado que coinciden al céntimo es lo que da confianza en las ramas que el escenario por
defecto no toca. También contrasta el año 1 del resumen (impuesto, caja y lo que se deduce, con la
comisión de apertura) contra la fila 1 de la transcripción. `modelo.py` genera `modelo.json`, que está versionado para que las pruebas
corran sin Python; el ejecutor lo regenera si `python3` está disponible.

Si tocas el motor, **estas dos son las que tienen que seguir cuadrando**.

## Las divergencias deliberadas

La herramienta ya no calcula lo mismo que la hoja original en varios sitios, porque la hoja
estaba mal. No son fallos por corregir: son decisiones, y las pruebas las fijan para que nadie
las deshaga sin querer.

| Qué | La hoja | La herramienta |
|---|---|---|
| **Interés deducible** | la media de toda la vida del préstamo | el que se paga cada año |
| **ROCE** | caja sobre lo aportado | caja + principal amortizado, y aparte con revalorización |
| **Caja negativa** | se arrastraba sin coste | la cubre la caja acumulada y, si no llega, una aportación tuya |
| **Amortización anticipada** | la misma caja se gastaba dos veces con las dos aceleradas | se reparte en un solo sentido |
| **Base amortizable** | 60 % del precio + reforma + gastos de compra enteros | 60 % de (precio + gastos de compra) + reforma: los gastos se reparten entre suelo y construcción como el precio |
| **Amortización fiscal** | sin tope | se agota al deducir toda la base amortizable (al 3 %, a los 33 años) |
| **Año en que una deuda se cancela** | doce cuotas enteras | sólo los meses que hacen falta, con su interés real |
| **Tramo alto del ahorro** | 28 % | 30 % por encima de 300.000 € (Ley 7/2024) |
| **Orden de amortización** | siempre el préstamo personal primero | primero la deuda con el tipo más alto |
| **Payback** | `#N/A` cuando no llegaba | dice cuánto falta y por qué |
| **Año 1** | media anualidad (se suponía la compra a mitad de año), con la deuda bajando doce cuotas | un año completo, como los demás: alquiler, gastos, cuotas, IRPF y amortización fiscal. La caja del año 1 es el doble que la de la hoja |
| **Gastos de financiación y conservación** | se deducían sin tope (la comisión de apertura ni siquiera se modelaba) | intereses + comisión de apertura + mantenimiento no pasan de los ingresos íntegros del año (art. 23.1.a LIRPF); el exceso se arrastra cuatro años, lo más antiguo primero, y lo que no cabe se pierde |
| **Rentabilidad bruta** | alquiler anual cobrado | alquiler de los doce meses, sin descontar los vacíos (los vacíos siguen recortando caja, IRPF y rentabilidades netas) |

La del interés es la que más se nota: en una cuota francesa el interés está casi todo al
principio, así que deducir la media hacía pagar de más los primeros años y de menos los últimos.
`verificar` y `cruzar` comprueban la **dirección** de esa divergencia y el año del cruce —el 15
en el escenario por defecto— en vez de exigir igualdad; en saldos, patrimonio y cuotas siguen
exigiendo igualdad exacta al céntimo.

## Qué mira cada una

| Suite | Qué defiende |
|---|---|
| `verificar` | paridad con la hoja original |
| `cruzar` | paridad con la transcripción en Python, doce escenarios |
| `repro2` | los siete defectos de la primera auditoría siguen corregidos |
| `prioridad` | la caja amortiza la deuda cara antes que la barata |
| `orden` | y el orden lo deciden los tipos, no el tipo de préstamo |
| `aportaciones` | los años en pérdidas piden dinero, y una TIR los fecha |
| `venta-y-vacios` | interés real del año, meses sin inquilino, y vender al final de cada año |
| `rupturas` | el tipo de hipoteca que deja la caja a cero |
| `deflactado` | euros de hoy, el año de referencia y el ROCE partido en dos |
| `enlaces` | candados en cadena, y que el círculo del reparto cierre sin residuo |
| `payback` | el año en que recuperas lo aportado |
| `candados` | los gastos estimados y sus multiplicadores |
| `faq` | las preguntas de finanzas y su tabla en vivo |
| `v2test` | formato de cifras, idioma y persistencia |
| `v3` | comunidades autónomas y detalles de la interfaz |
| `repaso` | escenarios viejos que migran, guardado que va y vuelve, móvil y tema oscuro |
| `compartir` | no recalcula con la cifra a medio escribir, casillas de IVA y amortización, el enlace de claves cortas y el texto que lo acompaña, el aviso de tipo alto, la horquilla de revalorización y el sexto indicador |
| `apertura` | la comisión de apertura: sube lo aportado, se deduce en el año 1, y viaja por guardado, enlace y comparador; en % o en € con el conmutador (conserva el importe al alternar) |
| `limites` | límite duro (recorta y redondea al salir del campo y al cargar de guardado o enlace), avisos en rojo con su title, `2,375` leído como decimal en un tipo, tope del horizonte, año de referencia que no se queda pegado y «1 año» |
| `defectos` | IBI 0,2 % y mantenimiento 2 % por defecto; los enlaces sin `ver=2` se leen con 0,24 % y 5 % |
| `irpf` | el tope del art. 23.1.a y su arrastre de cuatro años (comisión que no cabe, interés que choca, lo que caduca), el rendimiento negativo que da impuesto 0, el año 1 como año completo (el reparto amortiza toda la deuda inicial) y la bruta de doce meses |
| `revision2` | la segunda revisión: una deuda se salda en el año de su plazo (sin residuo de coma flotante), el año 1 del resumen es el de la fila 1 de la tabla (con la comisión de apertura), la nota fiscal cuadra con lo deducido de verdad, el ROCE sin liquidez propia, la inflación negativa, la TIR por encima del 1.000 %, la FAQ del apalancamiento después de impuestos, la lectura de importes pegados con texto, el editor de nombre del comparador, el globo de recorte, el guardado al cerrar, los avisos de las deudas apagadas, los campos numéricos en el idioma activo, el ida y vuelta %↔€, los enlaces con basura y la zona táctil del año de referencia |
| `revision` | deuda que se cancela a mitad de año contra una simulación mes a mes, tope de la amortización fiscal, base amortizable, tramo del 30 %, textos del interés sin «media», año 0 con comisión, enlaces parciales, modales accesibles (Escape, foco, aria), unidades y escala autonómica en inglés, «-0», selects inválidos e inflación ≤ −100 % |
| `deshacer` | Ctrl+Z / Ctrl+Y: un paso por cambio confirmado, máximo 100, rehacer que se borra con un cambio nuevo, y Ctrl+Z nativo dentro de un campo con texto sin confirmar |

## Escribirlas

Tres cosas que esta red ha aprendido a base de tropezar:

1. **Buscar las columnas por su cabecera**, no por índice. Cada columna nueva rompía media
   docena de aserciones hasta que dejaron de contar posiciones.
2. **Medir antes de afirmar.** Varias veces lo que parecía un fallo del motor era una aserción
   mía desfasada por un cambio intencionado. Si una prueba falla, mira primero si lo que ha
   cambiado es la herramienta o la expectativa.
3. **Los invariantes valen más que las cifras.** «El reparto cierra sin residuo», «el interés
   decrece todos los años», «sondear no deja ningún campo tocado» sobreviven a los cambios de
   parámetros; «la caja son 2.664 €» no.

`comun.mjs` resuelve la página, el Chart.js local y el navegador. Las capturas van a
`test/salida/`, que no está en control de versiones.
