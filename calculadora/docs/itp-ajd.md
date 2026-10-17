# Tipos de ITP y AJD por comunidad — auditoría

Qué tipos trae la calculadora, de dónde salen y qué falta por confirmar.

**Última revisión: septiembre de 2026.**

## Procedencia, y por qué importa

La primera versión de esta tabla salió **de memoria**, sin fuente. En la revisión de
septiembre de 2026 se contrastó contra agregadores fiscales (rankia, guiafiscal, hipotecas.me,
calculadoraitp y similares) a través de un buscador. **No se ha podido leer ningún boletín
oficial autonómico**: el entorno donde se construye esto sólo alcanza a GitHub y al buscador,
y la lectura directa de páginas está bloqueada.

Así que estas cifras son **mejores que las de partida pero no son una fuente fiscal**. Lo que
falta es contrastar cada una contra la Agencia Tributaria o Consejería de Hacienda de su
comunidad, y anotar aquí la fuente y la fecha.

## La tabla

`ITP` es el tipo general de vivienda usada. `AJD` es el de Actos Jurídicos Documentados, que
se paga en obra nueva junto al IVA del 10% (IGIC del 7% en Canarias).

| Comunidad | ITP | AJD | Cambió en la revisión | Confianza | Fuente oficial y fecha |
|---|---|---|---|---|---|
| Andalucía | 7 % | 1,2 % | — | corroborado | |
| Aragón | 8 % | 1,5 % | — | corroborado | |
| Asturias | 8 % | 1,2 % | — | **tramos** 8/9/10 | |
| Baleares | 8 % | 1,2 % | — | **tramos** 8/9/10/12/13 | |
| Canarias | 6,5 % | 0,75 % | — | corroborado (una búsqueda dijo 7 %) | |
| Cantabria | 9 % | 1,5 % | — | corroborado | |
| Castilla y León | 8 % | 1,5 % | — | corroborado (una búsqueda dijo 7 %) | |
| Castilla-La Mancha | 9 % | 1,5 % | — | corroborado | |
| Cataluña | 10 % | 1,5 % | — | **tramos** 10/11/12/13 | |
| Ceuta y Melilla | 6 % | 0,5 % | — | **sin corroborar** | |
| Extremadura | 8 % | 1,5 % | — | corroborado | |
| Galicia | 8 % | 1,5 % | **9 → 8** | corroborado | |
| Madrid | 6 % | 0,75 % | — | corroborado | |
| Murcia | 7,75 % | 1,5 % | **8 → 7,75** | una sola fuente | |
| Navarra | 6 % | 0,5 % | — | corroborado | |
| País Vasco | 7 % | 0 % | — | ver nota | |
| La Rioja | 7 % | 1 % | — | corroborado | |
| Valencia | 9 % | 1,5 % | **10 → 9** | corroborado, cambio de junio de 2026 | |

### Notas

**Comunidades con escala por tramos.** Cuatro no tienen un tipo único sino tramos por valor.
La tabla trae el del primer tramo, que es el que aplica a un piso corriente, y la herramienta
avisa al elegirlas. Los cortes que se encontraron:

- **Baleares** — 8 % hasta 400.000 €, 9 % hasta 600.000, 10 % hasta 1.000.000, 12 % hasta
  2.000.000 y 13 % por encima.
- **Cataluña** — 10 % hasta 600.000 €, 11 % hasta 900.000, 12 % hasta 1.500.000 y 13 % por
  encima. Cambió con el Decreto ley 5/2025, que además metió un recargo para grandes tenedores
  que la herramienta no recoge.
- **Valencia** — 9 % general y 11 % por encima de 1.000.000 €. La bajada del 10 % al 9 % entró
  el 1 de junio de 2026.
- **Asturias** — tramos del 8 %, 9 % y 10 %; no se han podido confirmar los cortes.

**País Vasco.** El 4 % que aparece en muchas tablas es el tipo reducido de **vivienda
habitual**. Un piso comprado para alquilar no es vivienda habitual del comprador, así que lo
que aplica es el general del 7 %, que es el que trae la tabla. Conviene confirmarlo.

**Tipos reducidos que la herramienta no recoge.** Casi todas las comunidades tienen tipos
rebajados (entre 2 y 4 puntos) para menores de 35 años, familia numerosa, personas con
discapacidad, VPO o zonas despobladas, cada una con sus requisitos. Meterlos sería un pozo sin
fondo; el campo tiene candado para que quien tenga derecho a uno ponga el suyo.

## Cómo actualizar esto

1. Confirmar cada fila contra la web de la Agencia Tributaria o Consejería de Hacienda de su
   comunidad, y rellenar la columna de fuente y fecha.
2. Llevar los cambios a la constante `CCAA` de `index.html`, que es la única copia de estos
   datos en el código.
3. Actualizar la fecha de esta página y la del aviso que sale en la pestaña de Parámetros
   (clave `avisoImpuestos` del diccionario de textos).
