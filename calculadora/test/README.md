# Pruebas

Diecisiete suites que abren la herramienta en un Chromium de verdad y comprueban lo que hace.
No hay unidades ni mocks: el motor vive dentro del HTML, así que se prueba donde vive.

## Correrlas

```sh
cd test
npm install            # sólo la primera vez
npx playwright install chromium   # idem, salvo en contenedores que ya lo traen
npm test               # las diecisiete
npm test -- verificar cruzar      # sólo algunas
```

Playwright está en `test/package.json` y **no** en el del proyecto a propósito: Cloudflare Pages
corre `npm install` en la raíz para desplegar, y no tiene por qué bajarse un navegador para eso.

## El armazón

Las dos primeras son la red de seguridad de verdad; las demás cuidan comportamientos concretos.

**`verificar`** — el motor contra los valores que tenía calculados la hoja de cálculo original,
guardados en `esperado.json`.

**`cruzar`** — el motor contra `modelo.py`, una transcripción independiente del modelo escrita
en Python a partir de las mismas fórmulas, en siete escenarios (con y sin préstamo personal, con
una y otra amortización acelerada, piso barato, sin entrada). Dos implementaciones escritas por
separado que coinciden al céntimo es lo que da confianza en las ramas que el escenario por
defecto no toca. `modelo.py` genera `modelo.json`, que está versionado para que las pruebas
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
| **Orden de amortización** | siempre el préstamo personal primero | primero la deuda con el tipo más alto |
| **Payback** | `#N/A` cuando no llegaba | dice cuánto falta y por qué |

La del interés es la que más se nota: en una cuota francesa el interés está casi todo al
principio, así que deducir la media hacía pagar de más los primeros años y de menos los últimos.
`verificar` y `cruzar` comprueban la **dirección** de esa divergencia y el año del cruce —el 17
en el escenario por defecto— en vez de exigir igualdad; en saldos, patrimonio y cuotas siguen
exigiendo igualdad exacta al céntimo.

## Qué mira cada una

| Suite | Qué defiende |
|---|---|
| `verificar` | paridad con la hoja original |
| `cruzar` | paridad con la transcripción en Python, siete escenarios |
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
| `compartir` | no recalcula con la cifra a medio escribir, casillas de IVA y amortización, y los cálculos que viajan en el enlace |

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
