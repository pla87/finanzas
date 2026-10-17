# finanzas

Tres herramientas de pacolucena.com en un solo repo público. Cada carpeta es un proyecto
independiente: su `package.json`, sus pruebas, su forma de compilar y su proyecto de
Cloudflare Pages (con la carpeta como directorio raíz).

| Carpeta | Qué es | Instrucciones |
| --- | --- | --- |
| `balance/` | Balance Personal: React + Vite + Tailwind 4 | `balance/CLAUDE.md` |
| `retiro/` | Simulador de Retiro: un único `index.html`, Tailwind 3, suites de Playwright | `retiro/README.md` y `retiro/tests/README.md` |
| `calculadora/` | Calculadora de alquiler: un único `index.html`, Tailwind 3 | `calculadora/docs/` y `calculadora/test/README.md` |

## Reglas comunes

- **Autoría.** Todos los commits van a nombre de pla87, con su dirección anónima de GitHub
  (`316149665+pla87@users.noreply.github.com`). Ni Claude como autor ni líneas de coautoría.
- **Comentarios en castellano**, que explican por qué, no qué.
- **Sin Google Analytics, sin etiquetas, sin aviso de cookies.** La única medición es Cloudflare
  Web Analytics, que inyecta Cloudflare en el borde: no hay ningún script suyo en el repo.
- **Los manuales no están aquí.** Viven en pla87/manuales, que es privado: el libro se vende y
  este repo es público. Si un cambio deja viejo un manual (una pestaña nueva, un botón que cambia
  de nombre), hay que decirlo.
- **El fichero de copia lo leen Balance y Retiro.** Un cambio de formato en una toca a la otra,
  y se prueba en las dos.
- **Las rutas son relativas a la carpeta de cada herramienta**: se sirven bajo
  pacolucena.com/balance/, /retiro/ y /calculadora/ a través del proxy de la portada, que vive en
  otro repo (privado).

Los workflows de GitHub están en `.github/workflows/`, uno por tarea y con el nombre de su
herramienta delante; ver su README.
