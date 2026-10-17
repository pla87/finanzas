// Prueba de update-rates.mjs sin salir a la red: cada caso monta una respuesta mala con la forma
// que podría devolver una API que ha cambiado o se ha roto, y comprueba que el actualizador se
// NIEGA a escribir. Es la parte que importa del script: escribir un tipo malo en main corrompe en
// silencio cualquier posición en divisa de cualquiera que abra la página, y nadie lo notaría.
// El último caso es el control: con datos buenos sí escribiría.
//
//   node scripts/test-update-rates.mjs
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTUALIZADOR = path.join(ROOT, 'scripts', 'update-rates.mjs');
const D = mkdtempSync(path.join(tmpdir(), 'tipos-'));
// La respuesta del BCE con un euríbor dado, con la forma SDMX-JSON de verdad.
const bce = (pct, periodo = '2026-09') => ({
  dataSets: [{ series: { '0:0:0:0:0:0:0': { observations: { '0': [pct] } } } }],
  structure: { dimensions: { observation: [{ values: [{ id: periodo }] }] } }
});
const FX_BIEN = { EUR: 1, USD: 1.09, GBP: 0.84, CHF: 0.93, JPY: 158, PHP: 61, HKD: 8.5 };
const casos = {
  'base invertida (USD como base)': { fx: { EUR: 0.9157, USD: 1 }, gold: { price: 2687 } },
  'sin objeto rates':               { fx: { result: 'error' },      gold: { price: 2687 }, crudo: true },
  'salto enorme en el yen':         { fx: { EUR: 1, USD: 1.09, GBP: 0.84, CHF: 0.93, JPY: 15.9, PHP: 61, HKD: 8.5 }, gold: { price: 2687 } },
  'divisa a cero':                  { fx: { EUR: 1, USD: 0, GBP: 0.84, CHF: 0.93, JPY: 158, PHP: 61, HKD: 8.5 }, gold: { price: 2687 } },
  'oro sin price':                  { fx: { EUR: 1, USD: 1.09, GBP: 0.84, CHF: 0.93, JPY: 158, PHP: 61, HKD: 8.5 }, gold: { error: 'nope' } },
  'oro absurdo':                    { fx: { EUR: 1, USD: 1.09, GBP: 0.84, CHF: 0.93, JPY: 158, PHP: 61, HKD: 8.5 }, gold: { price: 9 } },
  'euríbor absurdo':                { fx: FX_BIEN, gold: { price: 2687 }, euribor: bce(45) },
  'euríbor con salto enorme':       { fx: FX_BIEN, gold: { price: 2687 }, euribor: bce(0.2) },
  'euríbor sin forma SDMX':         { fx: FX_BIEN, gold: { price: 2687 }, euribor: { error: 'nope' } },
  'euríbor caído (conserva)':       { fx: FX_BIEN, gold: { price: 2687 }, euribor: null, debePasar: true },
  'todo bien (control)':            { fx: FX_BIEN, gold: { price: 2687 }, euribor: bce(3.1), debePasar: true }
};
let mal = 0;
for (const [nombre, c] of Object.entries(casos)) {
  const cuerpo = c.crudo ? JSON.stringify(c.fx) : JSON.stringify({ result: 'success', rates: c.fx });
  // El euríbor por defecto es uno bueno; null simula que el BCE no contesta.
  const euribor = 'euribor' in c ? c.euribor : bce(3.1);
  writeFileSync(path.join(D, '_fake.mjs'), `
    globalThis.fetch = async (url) => String(url).includes('er-api')
      ? { ok: true, status: 200, json: async () => (${cuerpo}) }
      : String(url).includes('ecb.europa.eu')
        ? (${JSON.stringify(euribor)} === null ? { ok: false, status: 503, statusText: 'caído' } : { ok: true, status: 200, json: async () => (${JSON.stringify(euribor)}) })
        : { ok: true, status: 200, json: async () => (${JSON.stringify(c.gold)}) };
    await import(${JSON.stringify(pathToFileURL(ACTUALIZADOR).href)});`);
  const r = spawnSync('node', [path.join(D, '_fake.mjs'), '--dry'], { encoding: 'utf8', cwd: ROOT });
  const paso = r.status === 0;
  const ok = c.debePasar ? paso : !paso;
  if (!ok) mal++;
  const motivo = (r.stderr || r.stdout).trim().split('\n').pop();
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${nombre.padEnd(32)} ${paso ? 'escribiría' : 'rechaza'} · ${motivo}`);
}
rmSync(D, { recursive: true, force: true });
if (mal) { console.error(`\n✗ ${mal} caso(s) no se comportan como deben`); process.exit(1); }
console.log(`\n✓ ${Object.keys(casos).length} casos: las barreras aguantan`);
