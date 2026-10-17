import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Guardia de higiene. Una importación que ya no se usa o una constante que no
// lee nadie no rompen nada: compilan, pasan las pruebas y se quedan ahí años
// haciendo creer que algo depende de ellas. Esta prueba las saca a la luz en
// el momento en que aparecen, que es cuando cuesta un minuto quitarlas.

const RAIZ = new URL('../', import.meta.url);

function ficheros(dir = '') {
  const salida = [];
  for (const e of readdirSync(new URL(dir, RAIZ), { withFileTypes: true })) {
    const ruta = dir + e.name;
    if (e.isDirectory()) salida.push(...ficheros(ruta + '/'));
    else if (/\.jsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const fuentes = ficheros().map(ruta => ({ ruta, texto: readFileSync(new URL(ruta, RAIZ), 'utf8') }));
const codigo = fuentes.filter(f => !f.ruta.endsWith('.test.js'));

// Nombres que trae cada `import`, incluidos los que ocupan varias líneas.
function importados(texto) {
  const nombres = [];
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s+from/g;
  for (const m of texto.matchAll(re)) {
    if (m[1]) nombres.push(m[1]);
    if (m[3]) nombres.push(m[3]);
    if (m[2]) {
      for (const trozo of m[2].split(',')) {
        const n = trozo.trim().split(/\s+as\s+/).pop().trim();
        if (n) nombres.push(n);
      }
    }
  }
  return nombres;
}

const sinImports = texto => texto.replace(/import[\s\S]*?from\s+'[^']+';/g, '');
const apariciones = (texto, nombre) => (texto.match(new RegExp(`\\b${nombre}\\b`, 'g')) || []).length;

test('limpieza: ningún fichero importa algo que no usa', () => {
  const sobras = [];
  for (const { ruta, texto } of fuentes) {
    const cuerpo = sinImports(texto);
    for (const nombre of importados(texto)) {
      if (apariciones(cuerpo, nombre) === 0) sobras.push(`${ruta}: ${nombre}`);
    }
  }
  assert.deepEqual(sobras, [], `importaciones sin usar:\n  ${sobras.join('\n  ')}`);
});

test('limpieza: ninguna exportación se queda sin lector', () => {
  // Se cuentan las apariciones en TODO el código, pruebas incluidas: una
  // función que solo usan sus pruebas sigue siendo código vivo —así se prueban
  // los ayudantes internos—, pero una que no aparece en ningún sitio salvo su
  // propia declaración no la lee nadie.
  const todo = fuentes.map(f => f.texto).join('\n');
  const huerfanas = [];
  for (const { ruta, texto } of codigo) {
    for (const m of texto.matchAll(/^export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (apariciones(todo, m[1]) <= 1) huerfanas.push(`${ruta}: ${m[1]}`);
    }
  }
  assert.deepEqual(huerfanas, [], `exportadas y sin usar:\n  ${huerfanas.join('\n  ')}`);
});
