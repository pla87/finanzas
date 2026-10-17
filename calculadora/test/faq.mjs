import { chromium } from 'playwright';
import { PAGINA, CHARTJS, CHROMIUM, salida } from './comun.mjs';
const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
await p.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHARTJS, contentType: 'application/javascript' }));
await p.route('**googletagmanager.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(PAGINA); await p.waitForTimeout(500);
await p.evaluate(() => { localStorage.clear(); resetDefaults(); });
let fallos = 0;
const check = (n, ok, d='') => { if (!ok) fallos++; console.log(`${ok?'ok   ':'FALLO'} ${n.padEnd(48)} ${d}`); };

await p.click('#btnFaq'); await p.waitForTimeout(200);
check('el modal se abre', await p.isVisible('#faqModal'));
const preguntas = await p.evaluate(() => [...document.querySelectorAll('#faqCuerpo summary')].map(s => s.textContent));
// Las dos listas, es y en, tienen que llevar las mismas preguntas: una pregunta nueva escrita
// en un solo idioma es el fallo fácil aquí.
const cuantas = await p.evaluate(() => ({ es: FAQ.es.length, en: FAQ.en.length }));
check('el mismo número de preguntas en los dos idiomas', cuantas.es === cuantas.en, `es ${cuantas.es} · en ${cuantas.en}`);
check('y todas pintadas', preguntas.length === cuantas.es, String(preguntas.length));
console.log(preguntas.map((q,i) => `        ${i+1}. ${q}`).join('\n'));

// La tabla en vivo del apalancamiento
await p.evaluate(() => document.querySelectorAll('#faqCuerpo details').forEach(d => d.open = true));
const tabla = await p.evaluate(() => [...document.querySelectorAll('#faqApalancamiento tr')].map(r => [...r.cells].map(c => c.textContent.trim())));
console.log('\n   tabla en vivo:'); tabla.forEach(f => console.log('     ', f.join(' | ')));
check('rinde el piso 6,56%', tabla[0][1] === '6,56%', tabla[0][1]);
check('hipoteca al 2,17% tras deducir', tabla[1][1] === '2,17%', tabla[1][1]);
check('la hipoteca suma', tabla[1][2].includes('suma'), tabla[1][2]);
check('préstamo al 6,98% tras deducir', tabla[2][1] === '6,98%', tabla[2][1]);
check('el préstamo resta', tabla[2][2].includes('resta'), tabla[2][2]);

// Debe seguir al escenario: con la hipoteca al 9% pasa a restar
await p.evaluate(() => { document.getElementById('tipoHipoteca').value = '9'; render(); });
const t2 = await p.evaluate(() => [...document.querySelectorAll('#faqApalancamiento tr')][1].cells[2].textContent);
check('con la hipoteca al 9% pasa a restar', t2.includes('resta'), t2.trim());
await p.evaluate(() => { document.getElementById('tipoHipoteca').value = '2,80'; render(); });

// Idioma. El modal tapa la cabecera, así que se cierra antes, igual que haría cualquiera.
await p.evaluate(() => closeModal('faqModal'));
await p.click('#langBtn'); await p.waitForTimeout(300);
await p.click('#btnFaq'); await p.waitForTimeout(200);
const enq = await p.evaluate(() => document.querySelector('#faqCuerpo summary').textContent);
check('el FAQ cambia de idioma', /Why does the annualised/.test(enq), enq);
const tEn = await p.evaluate(() => { document.querySelectorAll('#faqCuerpo details').forEach(d => d.open = true);
  return [...document.querySelectorAll('#faqApalancamiento tr')][1].cells[2].textContent; });
check('la tabla en vivo también', tEn.includes('adds'), tEn.trim());
await p.evaluate(() => closeModal('faqModal'));
await p.click('#langBtn'); await p.waitForTimeout(300);
await p.click('#btnFaq'); await p.waitForTimeout(200);

check('sin errores de consola', errs.length === 0, errs[0] ?? '');
await p.evaluate(() => { document.querySelectorAll('#faqCuerpo details').forEach((d,i) => d.open = i < 4); });
await p.locator('#faqModal > div').screenshot({ path: salida('faq.png') });
await b.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
