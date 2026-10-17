// Tailwind ya no se compila en el navegador: tailwind.css lleva sólo las utilidades que el
// escáner encontró en index.html. El riesgo de compilar es que una clase construida en JS se
// le escape al escáner y la interfaz la pierda en silencio. Esta prueba abre la aplicación con
// la hoja real, recorre todas las pestañas, el sorteo y varios modales para que el DOM dinámico
// exista, y comprueba que cada clase con pinta de utilidad de Tailwind tiene al menos una
// regla. También que la hoja comprometida está al día con lo que generaría el compilador.
import { execFileSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Prefijos de utilidades de Tailwind. Una clase que empiece así y no tenga regla es un purgado.
const TW_LIKE = '^(sm:|md:|lg:|xl:|hover:|focus:|active:|disabled:|group-hover:)*(text|bg|border|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min|max|gap|space|flex|grid|items|justify|self|rounded|shadow|opacity|font|leading|tracking|uppercase|lowercase|capitalize|truncate|whitespace|overflow|cursor|transition|duration|accent|col|row|inline|block|hidden|relative|absolute|fixed|sticky|inset|top|left|right|bottom|z|order|underline|list|divide|ring|outline|select|pointer|resize|align|table|sr|animate|scale|translate|rotate|break|object|place|content|shrink|grow|basis|scroll|snap|appearance|tabular)(-|$)';

export default async function run({ open, assert }) {
  // 1. La hoja comprometida coincide con una compilación fresca.
  const committed = readFileSync(path.join(ROOT, 'tailwind.css'), 'utf8');
  // Se compila a un fichero temporal: `-o -` no significa stdout para este CLI, crea un fichero
  // llamado "-", y lo que va a stdout puede llevar mensajes de estado.
  const tmp = path.join(os.tmpdir(), `tw-fresh-${process.pid}.css`);
  execFileSync(path.join(ROOT, 'node_modules/.bin/tailwindcss'),
    ['-c', 'tailwind.config.js', '-i', 'src/tailwind.css', '-o', tmp, '--minify'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
  const fresh = readFileSync(tmp, 'utf8');
  try { unlinkSync(tmp); } catch (e) {}
  assert(committed.trim() === fresh.trim(), 'tailwind.css no está al día: ejecuta `npm run css` y vuelve a comprometerlo');

  // 2. Con la hoja cargada, ninguna clase de utilidad se queda sin regla.
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(async (twLikeSrc) => {
      const twLike = new RegExp(twLikeSrc);
      const sheets = [...document.styleSheets];
      const twSheet = sheets.find(sh => (sh.href || '').endsWith('tailwind.css'));
      const twRules = twSheet ? twSheet.cssRules.length : 0;
      // Y que se aplica: una pestaña oculta tiene display:none sólo si la utilidad .hidden existe.
      const hiddenPanel = [...document.querySelectorAll('.tab-content.hidden')][0];
      const hiddenApplies = hiddenPanel ? getComputedStyle(hiddenPanel).display === 'none' : false;
      const cardBg = getComputedStyle(document.querySelector('.bg-brand-card')).backgroundColor;

      // Que aparezca todo el DOM dinámico antes de mirar las clases.
      for (const b of document.querySelectorAll('.tab-btn')) {
        if ((b.getAttribute('onclick') || '').startsWith('switchTab')) b.click();
      }
      openRobustnessTab();
      await runMonteCarlo({ paths: 60, defencePaths: 30, matrixPaths: 20 });
      try { openChattelModal(START_YEAR + 5); } catch (e) {}
      try { openReEventModal(START_YEAR + 5); } catch (e) {}

      const selectors = [];
      for (const sh of sheets) {
        let rules = []; try { rules = [...sh.cssRules]; } catch (e) { continue; }
        const walk = (rs) => rs.forEach(rl => { if (rl.selectorText) selectors.push(rl.selectorText); if (rl.cssRules) walk([...rl.cssRules]); });
        walk(rules);
      }
      const allSel = selectors.join('\n');
      const esc = (c) => c.replace(/[.:/\[\]%!#(),]/g, ch => '\\' + ch);
      const used = new Set();
      document.querySelectorAll('*').forEach(el => el.classList.forEach(c => used.add(c)));
      const missing = [...used].filter(c => twLike.test(c) && !allSel.includes('.' + esc(c)));
      return { twRules, usedTotal: used.size, missing, hiddenApplies, cardBg };
    }, TW_LIKE);
    assert(r.twRules > 200, `tailwind.css no se cargó o está vacío (${r.twRules} reglas)`);
    assert(r.hiddenApplies, 'la hoja enlazada no se aplica: un panel .hidden no tiene display:none');
    assert(/rgb\(/.test(r.cardBg) && r.cardBg !== 'rgba(0, 0, 0, 0)', `bg-brand-card no pinta: ${r.cardBg}`);
    assert(r.missing.length === 0, `clases de Tailwind sin regla en la hoja compilada: ${r.missing.slice(0, 12).join(' ')}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `${r.twRules} reglas · ${r.usedTotal} clases en uso · ninguna sin regla · hoja al día`;
  } finally { await browser.close(); }
}
