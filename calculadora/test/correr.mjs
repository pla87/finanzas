// Corre todas las suites en fila y resume. Cada una es un proceso aparte con su propio
// navegador: van en serie porque son rápidas y porque un fallo se lee mucho mejor solo.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = fileURLToPath(new URL('./', import.meta.url));

// El orden va de lo más fundamental a lo más accesorio: si el motor no cuadra con la hoja ni
// con la transcripción, lo que diga el resto importa poco.
const SUITES = [
  ['verificar',      'el motor contra los valores de la hoja original'],
  ['cruzar',         'el motor contra la transcripción en Python, siete escenarios'],
  ['repro2',         'los defectos de la primera auditoría siguen corregidos'],
  ['prioridad',      'la caja amortiza la deuda cara antes que la barata'],
  ['orden',          'y el orden lo deciden los tipos, no el tipo de préstamo'],
  ['aportaciones',   'los años en pérdidas piden dinero y entran en la TIR'],
  ['venta-y-vacios', 'interés real del año, meses sin inquilino y vender'],
  ['rupturas',       'el tipo de hipoteca que deja la caja a cero'],
  ['deflactado',     'euros de hoy, el año de referencia y el ROCE partido'],
  ['enlaces',        'candados en cadena y el reparto del alquiler'],
  ['payback',        'el año en que recuperas lo aportado'],
  ['candados',       'los gastos estimados y sus candados'],
  ['faq',            'las preguntas de finanzas y su tabla en vivo'],
  ['v2test',         'formato, idioma y persistencia'],
  ['v3',             'comunidades autónomas y detalles de la interfaz'],
  ['repaso',         'migración, guardado, móvil y tema oscuro'],
  ['compartir',      'recálculo al escribir, casillas y enlace con los cálculos'],
];

const soloEstas = process.argv.slice(2);
const aCorrer = soloEstas.length ? SUITES.filter(([n]) => soloEstas.includes(n)) : SUITES;

// La transcripción en Python genera modelo.json, que es contra lo que cruza el motor. Se
// regenera si hay python3; si no, se usa el que está versionado y se avisa.
if (aCorrer.some(([n]) => n === 'cruzar')) {
  const py = spawnSync('python3', [AQUI + 'modelo.py'], { encoding: 'utf8' });
  console.log(py.status === 0
    ? '· modelo.py regenerado'
    : '· aviso: sin python3, se usa el modelo.json versionado');
}

let fallidas = [];
for (const [nombre, que] of aCorrer) {
  process.stdout.write(`\n${'─'.repeat(72)}\n${nombre}  —  ${que}\n`);
  const r = spawnSync(process.execPath, [AQUI + nombre + '.mjs'], { stdio: 'inherit' });
  if (r.status !== 0) fallidas.push(nombre);
}

console.log('\n' + '─'.repeat(72));
if (fallidas.length === 0) {
  console.log(`${aCorrer.length} suites, todas en verde.`);
} else {
  console.log(`${fallidas.length} de ${aCorrer.length} suites fallan: ${fallidas.join(', ')}`);
}
process.exit(fallidas.length === 0 ? 0 : 1);
