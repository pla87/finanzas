// Ejecuta todas las suites de tests/suites en orden y sale con código 1 si alguna falla.
//   npm test                 todas
//   npm test -- --only 04    sólo las que contengan "04" en el nombre
//   npm run test:quick       todas menos los dos barridos largos (02 y 03, ~7 min)
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { open, assert, near, capturePdf, AssertionFailed } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const skipIdx = process.argv.indexOf('--skip');
const skip = skipIdx >= 0 ? process.argv[skipIdx + 1].split(',') : [];

const files = readdirSync(path.join(HERE, 'suites'))
  .filter(f => f.endsWith('.mjs'))
  .sort()
  .filter(f => !only || f.includes(only))
  .filter(f => !skip.some(sk => f.startsWith(sk)));

let failed = 0;
const t0 = Date.now();
for (const f of files) {
  const t1 = Date.now();
  process.stdout.write(`${f.padEnd(34)} `);
  try {
    const mod = await import(pathToFileURL(path.join(HERE, 'suites', f)).href);
    const summary = await mod.default({ open, assert, near, capturePdf });
    console.log(`OK   ${((Date.now() - t1) / 1000).toFixed(1)}s  ${summary || ''}`);
  } catch (e) {
    failed++;
    const kind = e instanceof AssertionFailed ? 'FALLO' : 'ERROR';
    console.log(`${kind} ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    console.log('    ' + String(e.stack || e).split('\n').slice(0, 6).join('\n    '));
  }
}
console.log(`\n${files.length - failed}/${files.length} suites en ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
