// Abre index.html en un Chromium sin cabeza con las dependencias de CDN servidas desde
// node_modules. Así las pruebas no dependen de la red, y en entornos que bloquean los CDN
// (como el sandbox donde se escribieron) funcionan igual.
//
// Tailwind es un fichero compilado (tailwind.css) que se carga como cualquier otro fichero local.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX = 'file://' + path.join(ROOT, 'index.html');

const chartJs = readFileSync(path.join(ROOT, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const annotationJs = readFileSync(path.join(ROOT, 'node_modules/chartjs-plugin-annotation/dist/chartjs-plugin-annotation.js'), 'utf8');

// Chromium: el que Playwright tenga instalado, o el que indique PW_CHROMIUM, o el
// preinstalado del sandbox si existe.
export function launchOptions() {
  const exe = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
  // Bajo file:// Chromium trata cada fichero como un origen distinto y no deja leer las reglas de
  // una hoja enlazada (cssRules lanza SecurityError). La suite 11 necesita leerlas.
  const args = ['--allow-file-access-from-files'];
  return exe ? { executablePath: exe, args } : { args };
}

// pinClock: getRemainingYearFraction() lee el reloj en cada llamada, así que dos ejecuciones
// separadas por segundos ya difieren en el octavo decimal. Se congela para que las pruebas
// midan el código y no el paso del tiempo, y se recalcula una vez para que las tablas queden
// coherentes con esa fracción.
export async function open({ waitMs = 1500, onDialog = null, pinClock = true } = {}) {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (onDialog) page.on('dialog', onDialog);
  await page.route('**/npm/chart.js**', r => r.fulfill({ contentType: 'application/javascript', body: chartJs }));
  await page.route('**chartjs-plugin-annotation**', r => r.fulfill({ contentType: 'application/javascript', body: annotationJs }));
  await page.goto(INDEX);
  await page.waitForTimeout(waitMs);
  if (pinClock) {
    await page.evaluate(() => {
      getRemainingYearFraction = () => 0.31;
      runSimulation();
    });
  }
  page.setDefaultTimeout(30 * 60 * 1000);
  return { browser, page, errors };
}

export class AssertionFailed extends Error {}

export function assert(cond, msg) {
  if (!cond) throw new AssertionFailed(msg);
}

export function near(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new AssertionFailed(`${msg}: ${actual} no está a ±${tol} de ${expected}`);
  }
}

// Intercepta window.open para leer el HTML del informe PDF sin abrir ventanas.
export async function capturePdf(page) {
  await page.evaluate(() => {
    window.__pdf = null;
    window.open = () => ({
      document: { open() {}, write(h) { window.__pdf = h; }, close() {} },
      focus() {}, print() {}, set onload(f) {}, get onload() { return null; }
    });
  });
}
