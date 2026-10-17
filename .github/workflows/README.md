# `.github/workflows`

**Esta carpeta no despliega el sitio.**

El despliegue es **Cloudflare Pages**: un proyecto por herramienta, cada uno con su carpeta
como directorio raíz, que construye en cada push a `main` que toque esa carpeta. No hay nada
que configurar aquí para publicar: basta con que el commit llegue a `main`.

Cada workflow lleva el nombre de su herramienta delante y trabaja dentro de su carpeta
(`working-directory`). Lo que sigue, hasta «Retiro», es de `balance/`.

Hubo un `deploy.yml` que publicaba en GitHub Pages. Estaba deshabilitado, sus
seis ejecuciones fallaron y no desplegaba nada; se borró porque lo único que
hacía era confundir a quien lo leía.

## Lo que sí hay

| Fichero | Qué hace |
| --- | --- |
| `balance-cotizaciones.yml` | Refresca los datos de mercado de Balance. Nada más. |
| `balance-pruebas.yml` | Pasa las pruebas de Balance y compila, en cada empujón o pull request que toque `balance/`. |
| `retiro-tipos.yml` | Refresca los tipos de cambio, el oro y el euríbor que Retiro lleva dentro de su `index.html`. |

`balance-cotizaciones.yml` ejecuta `balance/scripts/update_market_data.py` de lunes a viernes a
las 23:00 UTC (y a mano desde la pestaña Actions). El script descarga
cotizaciones y tipos de cambio, escribe `balance/public/market_data.json` y hace commit
del resultado. Ese commit a `main` es lo que provoca, de rebote, un nuevo
despliegue en Cloudflare con los datos frescos.

`balance-pruebas.yml` existe por culpa del párrafo anterior: si un commit a `main`
provoca un despliegue, hace falta algo que compruebe ese commit antes de que se
publique. Corre `npm ci`, `npm test` y `npm run build`. Compilar es media
prueba más: las pruebas solo tocan `src/lib`, así que un error de sintaxis en
la interfaz no lo ve ninguna.

**Pero `balance-pruebas.yml` no cubre al bot, y por eso `balance-cotizaciones.yml` se comprueba a
sí mismo.** GitHub no dispara workflows desde un push hecho con el
`GITHUB_TOKEN` por defecto —una regla suya, para evitar bucles—, y este trabajo
empuja con él: sus commits van firmados por `github-actions[bot]`. Comprobado
sobre el repositorio: tres commits del bot, cero ejecuciones de `balance-pruebas.yml`.
O sea que el único empujón que se produce solo, cinco veces por semana, y que
es además el que dispara el despliegue, era justo el que nadie miraba.

Así que `balance-cotizaciones.yml` pasa las pruebas y compila él mismo, después de
descargar y antes de hacer commit. Si el fichero recién descargado no pasa, el
trabajo se cae y no se empuja nada.

Si una descarga falla, el script conserva el valor anterior y lo marca en
`staleRates` / `staleTickers`. Si se perdiera más de la mitad de las
cotizaciones, aborta sin escribir y la ejecución sale en rojo: es preferible un
fallo visible a publicar un balance sin valores.

## Retiro

`retiro-tipos.yml` corre los lunes. Reescribe el bloque `<tipos-automaticos>` de
`retiro/index.html` y se comprueba a sí mismo antes de hacer commit, por la misma razón que el
de cotizaciones. Las suites de Retiro (Playwright, unos diez minutos) no están en el CI: se
pasan a mano con `npm test` dentro de `retiro/`.

Los dos bots empujan a `main`, así que los dos hacen `git pull --rebase` antes del push.

## Por qué está aquí y no en otra carpeta

GitHub Actions solo lee los workflows de `.github/workflows/`. Un fichero de
workflow en cualquier otra ruta es YAML inerte: no se ejecuta nunca y nada
avisa de ello. Mover `balance-cotizaciones.yml` fuera de aquí dejaría los datos de
mercado congelados en silencio.
