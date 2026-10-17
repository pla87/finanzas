# Pruebas

Pruebas de comportamiento sobre `index.html` en un Chromium sin cabeza (Playwright). No hay
framework: cada suite es un módulo que abre la página, opera sobre ella y lanza una excepción
si algo no cuadra. `tests/run.mjs` las ejecuta en orden y sale con código 1 si alguna falla.

```
npm install
npx playwright install chromium   # sólo la primera vez
npm test                          # todas (~8 min: los dos barridos son lentos)
npm run test:quick                # todas menos los barridos (~2 min)
npm test -- --only 04             # las que contengan "04" en el nombre
```

Si ya hay un Chromium en la máquina, `PW_CHROMIUM=/ruta/al/binario npm test` lo usa en vez de
descargar uno. Se lanza con `--allow-file-access-from-files`: bajo `file://` Chromium trata cada
fichero como un origen distinto y sin ese flag no deja leer las reglas de la hoja enlazada.

## Qué cubre cada suite

| Suite | Qué garantiza |
|---|---|
| `01-engine-noop` | El tercer argumento del motor optimizador (trayectoria de tipos, defensas, recogida de la serie) es un no-op **exacto** cuando está apagado, y usar la pestaña Robustez no altera la proyección determinista. |
| `02-age-sweep` (lenta, ~4 min) | ~570 combinaciones de edades de retiro: balance y cash flow pintan lo mismo, el ámbar no cae en superávit, un solo aviso de venta activo, el tachado empieza tras la decisión y no se interrumpe, pensiones no se desbloquean antes de tiempo. |
| `03-chattel-sweep` (lenta, ~2 min) | 300 escenarios aleatorios (con semilla) de compras de bienes muebles: las que caben se descuentan, las que no caben no aparecen, el valor contable nunca sube sin compra ni baja de cero, el mantenimiento no se cobra antes de la primera compra. |
| `04-mc-calibration` | Sacudidas de Monte Carlo con media 0, desviación exactamente 1, colas gruesas y recortadas; semilla reproducible; volatilidad cero reproduce la proyección determinista; volatilidad realizada = pedida; la mediana converge a (1+r)^n según √n. La reversión a la media apagada es la misma matriz; encendida conserva varianza 1 y media 0, tiene autocorrelación ≈ φ, reduce la varianza a 20 años a (1+φ)/(1−φ) y no mueve la mediana. |
| `05-robustness-tab` | La pestaña abre calculada, cambia de escenario, sigue la edad de medida, invalida el análisis al cambiar datos; el sorteo corre entero, marca caducidad al mover el deslizador, pinta defensas y matriz; el indicador de la caja de retiro seguro en sus tres estados. |
| `06-defences` | Cada defensa apagada es idéntica a no tenerla; encendidas van en la dirección económica correcta (el colchón cuesta en calma, la flexibilidad sólo se activa en crisis y mejora, el colchón creciente cuesta menos que el plano y protege, el paso a renta fija traslada y tributa, cuesta en calma y protege en crisis). |
| `07-expense-change` | Deslizador −50..+50, factor 0,5..1,5, etiquetas, efecto en la edad segura, y migración de signo de ficheros guardados con el criterio antiguo. Casilla "Contar con la pensión pública": desmarcada nadie cobra pensión a los 67 en los dos motores y el retiro seguro no se adelanta; viaja en el fichero; marcarla de nuevo deja la proyección idéntica bit a bit. |
| `08-pdf` | Las páginas de robustez y Monte Carlo son condicionales, desaparecen al cambiar datos, las tablas llevan su clase de tipografía y no queda ninguna clase inventada. |
| `09-property` | Inmuebles y alquileres en escenarios y sorteo: a cero son un no-op exacto, 2008 con vivienda cuesta más que sólo bolsa, los alquileres siguen al precio, la correlación bolsa-vivienda es la declarada y la vivienda aleatoria ensancha el abanico sin mover la mediana de su índice. |
| `10-worker` | El Worker de Monte Carlo, montado en tiempo de ejecución a partir de una lista explícita de funciones, da exactamente el mismo resultado que el hilo principal con el mismo sorteo; cancelar lo termina sin dejar estado a medias. |
| `11-css` | Tailwind compilado: la hoja comprometida coincide con una compilación fresca, se carga de verdad, y tras recorrer todas las pestañas, el sorteo y los modales ninguna clase con pinta de utilidad se queda sin regla (el riesgo del purgado). |
| `12-engine-agreement` | Los dos motores (proyección con tablas y optimizador sin DOM) dan el mismo veredicto de solvencia y el mismo año de quiebra para las mismas edades de retiro en nueve escenarios: datos de ejemplo, déficit desde caja y por coste fiscal, gasto alto, retiro temprano, paro a mitad de carrera, carrera autónoma, sin pareja y con renta fija. |
| `13-bonds` | Renta fija, renta fija ligada a inflación y oro como clases de activo. Renta fija: columna en el balance, rinde exactamente su tipo en un año sin movimientos, el excedente puede ir a ella y el déficit salir de ella pagando plusvalía, la posición sigue al parámetro, el fichero guardado lo conserva y el PDF la lista. Ligada a inflación y oro: rinden inflación + tipo real; en la estanflación la ligada a inflación acaba por encima de la misma cantidad en renta fija normal y el oro añade patrimonio; el sorteo lleva sacudida de oro; el oro metido en gramos se valora a gramos × precio de Parámetros, sigue al precio y el modal bloquea su valor. Sin posiciones de estas categorías todo es un no-op (lo cubre la comparación bit a bit frente a la versión anterior). |
| `14-careers` | Etapas laborales en tiempo transcurrido desde hoy: una etapa de 3 años termina dentro de 36 meses (el despido cae en el tercer año natural, se cobran ~2,8 años de sueldo y la indemnización cuenta los 3 años), y los dos motores ven la misma etapa. Una salida voluntaria al jubilarse no cobra paro y un despido pactado sí. Al importar, una cuota menor que la que amortiza el préstamo en su plazo se recalcula, y una mayor se respeta. |
| `15-fuzz-regressions` | Los seis fallos que sacó el fuzzer de planes aleatorios: el informe anual no arrastra años del plan anterior; una categoría vendida entera liquida a cero (con tipo negativo y con tipo positivo); importar dos planes seguidos no cambia la edad de retiro, y el suelo de la edad actual sigue vigente; la deuda amortizada con el excedente no reaparece al año siguiente ni da amortizaciones negativas; las aportaciones a jubilación sin destino elegido se reparten entre los seguros del titular sin duplicarse y las ven los dos motores; y el crecimiento real se mide sobre el valor absoluto cuando el patrimonio neto es negativo. |
| `16-monotonia-edad-segura` | Dos planes reales del fuzzer (fixtures) que rompen la monotonía en la que se apoyaba la búsqueda de la edad segura. El primero cumple jubilándose pronto y no jubilándose más tarde, porque los planes de pensiones no se desbloquean hasta dos años después de dejar de trabajar: la caja de retiro seguro avisa, la edad que anuncia cumple de verdad, la que denuncia falla de verdad, y el aviso señala la PRIMERA que falla. El segundo (semilla 20038, sin un solo plan de pensiones: la monotonía se rompe por el calendario de la carrera) tiene un año suelto que falla en medio del bloque bueno, y engañaba a la bisección, que anunciaba dos años de trabajo de más; el barrido lineal da la mínima real. Con los datos de ejemplo no avisa. |
| `17-deudas-balance` | Formato de deudas compartido con pacolucena.com/balance: una tarjeta, un préstamo familiar sin cuota y una hipoteca importados desde un fichero de balance conservan su saldo de hoy; exportar e importar no mueve nada; un plazo de 0 meses deja la deuda viva en vez de saldarla de golpe; una tarjeta con fecha antigua se normaliza a hoy sin perder saldo; y el recálculo de cuota corrige la hipoteca pero respeta la tarjeta. Además, las dos herramientas piden lo mismo: un préstamo personal descrito desde su alta entra puesto al día sin cambiar la cuota; el formulario pide saldo de hoy y meses que quedan (personal), saldo, interés y cuota (tarjeta) y cuota o plazo (familiar); una hipoteca variable paga euríbor de hoy más diferencial con la misma cuota que en balance, el saldo real del extracto manda, y tipo, diferencial y saldo real viajan en el fichero. |
| `18-eventos-inmuebles` | Compras y ventas programadas, que es donde los dos motores se separaban. La hipoteca de una compra empieza en enero del año siguiente, así que el año de la compra no añade servicio de deuda; el siguiente paga la cuota francesa entera, intereses incluidos (antes la proyección amortizaba principal a secas los treinta años); el año de la venta paga sus cuotas y cancela el saldo de diciembre, no el de enero; y con las dos operaciones los dos motores dan el mismo patrimonio real todos los años. Tras vender un piso alquilado teniendo otro, los dos motores siguen dando el mismo patrimonio: la proyección seguía deduciendo en el IRPF la amortización del piso vendido (fuzzer, semilla 700572). Además, un destino de excedente que el desplegable no reconoce (`pensions`, que es una opción del de déficit y comparte almacén) cae en el de por defecto en los dos motores, en vez de perderse por el camino en uno y acabar en dividendo en el otro. |

| `19-cuota-corta` | El aviso de cuota que no cubre los intereses, en la línea de la deuda: con 120.000 € al 7,9% y 696 € de cuota (788 € de interés mensual) avisa y dice cuánto interés se paga; con la cuota que de verdad amortiza, sin intereses, o en una deuda declarada sin cuota -que ya se etiqueta como tal-, calla. Y el plan de prueba enseña la deuda creciendo, así que el aviso describe algo real. |
| `20-rescate-pensiones` | El año en que hay que vaciar un plan de pensiones para cubrir el déficit, lo rescatado deja de ser patrimonio: el balance de ese año cuadra con el saldo ya rescatado, los dos motores ven el mismo patrimonio neto todos los años, y los saldos de jubilación no arrastran decimales por debajo del céntimo. Antes la proyección usaba la foto del saldo ANTERIOR al rescate para el activo total, así que inflaba el patrimonio en lo que se acababa de gastar. |
| `21-tipos-automaticos` | El bloque `<tipos-automaticos>` de `index.html`, que reescribe un workflow semanal con los tipos de cambio y el precio del oro del día: tiene la forma que el workflow espera, sus valores llegan a donde se usan -el campo del precio del oro arranca con el del bloque, no con el del markup- y, cuando los servicios en vivo no contestan (siempre en las pruebas, a veces en producción), la conversión de divisa usa exactamente esos tipos y el estado dice de qué fecha son. |
| `22-escapado-xss` | Nombres con etiquetas HTML en todos los campos de texto que vienen del fichero -activos, deudas, inmuebles, bienes muebles, participantes, empresas- y con identificadores que intentan escaparse de un `onclick`. Tras recorrer las tablas, todas las pestañas y el informe PDF no queda ni un nodo inyectado ni una ejecución; el nombre se sigue LEYENDO como texto; lo que se guarda en el fichero no se toca (lo comparte pacolucena.com/balance); y los identificadores se sanean al importar sin romper las referencias cruzadas. Con el código anterior el mismo plan ejecutaba código 448 veces. |
| `23-suelo` | El suelo como uso propio de un inmueble, compartido con pacolucena.com/balance: con la vivienda desacoplada de la inflación, una finca sigue a la inflación y no a la vivienda; no paga mantenimiento ni da renta (un vacío con mantenimiento sí); una compra programada de suelo se valora con la inflación; los dos motores dan el mismo patrimonio todos los años; el uso viaja en el fichero, y el formulario no pide alquiler y deja el capital en la inflación. |
| `24-euribor` | La subida del euríbor, sexto escenario de Robustez: con hipotecas fijas da exactamente lo mismo que sin crisis y la pestaña dice que no le afecta en vez de pintar una línea repetida; con una variable, todo es igual hasta el año en que empieza, el primer año cuesta justo la cuota francesa del saldo pendiente al tipo nuevo, la cuota baja de su pico cuando el euríbor vuelve, y la pestaña la pinta. |

## Dos detalles que conviene saber

**El reloj se congela.** `getRemainingYearFraction()` lee `new Date()` en cada llamada, así que
dos ejecuciones separadas por segundos ya difieren en el octavo decimal. El arnés la fija en
0,31 y recalcula una vez antes de empezar, para que las pruebas midan el código y no el paso
del tiempo.

**Hay un fuzzer, y no entra en `npm test`.** Las suites de arriba prueban casos elegidos a mano.
`tests/fuzz.mjs` hace lo contrario: genera planes completos al azar con semilla (edades, etapas
laborales, hijos, gastos, activos de todas las categorías y divisas, préstamos con cuotas
incoherentes, compras y ventas de inmuebles, compras de bienes muebles, enrutamiento del
excedente año a año y todos los parámetros), los carga por la vía de importación real y comprueba
invariantes que deben cumplirse siempre: ningún número no finito, el balance cuadra, el cash
flow cuadra, ningún saldo negativo, las dos tablas pintan los mismos años, los dos motores dan
el mismo veredicto, no hay nómina después del retiro, la deuda no sube sin pedir prestado, el
veredicto es monótono en la edad de retiro, la proyección es determinista y exportar e importar
no la cambia.

```
node tests/fuzz.mjs                          # 100 escenarios desde la semilla 1
node tests/fuzz.mjs 700000 1200 4 --round    # 1200 desde 700000, 4 pestañas, con ida y vuelta
node tests/fuzz.mjs --dump=700027            # vuelca el plan de esa semilla a un .json
```

Queda fuera de `npm test` porque tarda lo que se le eche y porque no todo lo que saca es un
fallo: hay hallazgos legítimos, como un préstamo cuya cuota no cubre los intereses (`DEUDA_SUBE`),
que es justo lo que ahora avisa la suite 19. Se pasa a mano al tocar el motor, y lo que saca se
convierte en una suite de regresión: de ahí salieron los seis fallos de la 15, los cuatro de la
18 y el aviso de la 19. Escribe en `tests/.fuzz-out/` (ignorado por git) o donde diga `FUZZ_OUT`,
y las semillas son reproducibles: la misma semilla da el mismo plan en cualquier máquina.

**Los tipos de cambio y el precio del oro se actualizan solos.** La página los pedía en vivo desde
el navegador de cada visitante a dos servicios ajenos, y cuando no contestaban caía sobre unas
constantes escritas a mano sin fecha. Ahora `.github/workflows/retiro-tipos.yml` los refresca una vez por
semana dentro de `index.html`, así que el valor de partida viaja en el fichero y es correcto aunque
el servicio en vivo no conteste nunca. Fuera del navegador lo cubren dos scripts que el propio
workflow ejecuta: `scripts/test-update-rates.mjs` comprueba que el actualizador RECHAZA datos malos
-base cambiada, divisa a cero, saltos de más del 40%, oro imposible-, y `scripts/check-rates-block.mjs`
que lo que queda en `index.html` compila y es coherente. Para probarlo a mano sin escribir nada:
`node scripts/update-rates.mjs --dry`.

**Los CDN se sirven en local.** Chart.js y el plugin de anotaciones se cargan desde
`node_modules`; Tailwind ya no es un CDN sino `tailwind.css`, compilado y comprometido, que se
carga como cualquier fichero local. Por eso las pruebas funcionan sin red. Ninguna prueba mide
el aspecto: lo que se ve en un móvil hay que mirarlo en un móvil.
