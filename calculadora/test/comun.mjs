// Lo que todas las suites necesitan y no debe depender de dónde esté el repo ni de quién lo
// corra: la página bajo prueba, el Chart.js local y el directorio donde dejar capturas.
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

// La página se abre con file://, sin servidor: la herramienta es un único HTML sin build.
export const PAGINA = new URL('../index.html', import.meta.url).href;

// El CDN de Chart.js no se alcanza desde el entorno de pruebas, así que se sirve el que hay en
// node_modules. Si falta, la página se dibuja igual -renderCharts se calla sin Chart- pero las
// pruebas que miran las gráficas fallarán, y con razón.
export const CHARTJS = fileURLToPath(new URL('../node_modules/chart.js/dist/chart.umd.js', import.meta.url));

// Normalmente Playwright encuentra su propio Chromium tras `npx playwright install`, y entonces
// esto vale undefined y se le deja hacer. Pero los contenedores de Claude Code traen uno ya
// instalado en otro sitio, así que se mira ahí antes de rendirse. CHROMIUM_PATH manda sobre todo.
const PREINSTALADO = '/opt/pw-browsers/chromium';
export const CHROMIUM = process.env.CHROMIUM_PATH
  || (existsSync(PREINSTALADO) ? PREINSTALADO : undefined);

const DIR_SALIDA = fileURLToPath(new URL('./salida/', import.meta.url));

/** Ruta donde dejar una captura. El directorio está fuera del control de versiones. */
export function salida(nombre) {
  mkdirSync(DIR_SALIDA, { recursive: true });
  return DIR_SALIDA + nombre;
}

/** Enruta a la página las dos peticiones externas que hace, y calla la analítica. */
export async function interceptar(page) {
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
  await page.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
}
