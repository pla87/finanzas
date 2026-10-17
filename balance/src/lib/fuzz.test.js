// Las pruebas del barrido aleatorio. El generador y las comprobaciones viven
// en fuzz.js, que se puede importar desde una consola para investigar una
// semilla concreta sin arrancar la suite entera.
import test from 'node:test';
import assert from 'node:assert/strict';

import { escenarioAleatorio, comprobarEscenario } from './fuzz.js';

// Por defecto van 2.000 por tanda —medio segundo—; con FUZZ_N=50000 npm test
// se aprieta más antes de tocar el motor.
const N = Math.max(50, Number(process.env.FUZZ_N) || 2000);

// --- LAS PRUEBAS ---

const barrido = (nombre, dureza, semilla0) => test(nombre, () => {
  const avisar = console.warn;
  console.warn = () => {};   // el aviso de divisa sin tipo de cambio, ya probado aparte
  try {
    for (let i = 0; i < N; i++) {
      const seed = semilla0 + i;
      const fallos = comprobarEscenario(escenarioAleatorio(seed, { duro: dureza }));
      assert.deepEqual(fallos, [], `semilla ${seed}:\n  ${fallos.join('\n  ')}`);
    }
  } finally {
    console.warn = avisar;
  }
});

barrido(`barrido: ${N} balances corrientes`, 0, 5000000);
barrido(`barrido: ${N} balances con cifras raras`, 0.15, 6000000);
barrido(`barrido: ${N} balances con cifras muy raras`, 0.4, 3000000);

test('barrido: las semillas que destapan cada arreglo siguen limpias', () => {
  // Cada una de estas semillas produce un balance que FALLA si se revierte el
  // arreglo que tiene al lado: las busqué rompiendo el código a propósito, una
  // por una, y quedándome con la primera que lo detectaba. Son un aviso
  // temprano, no la prueba de fondo: los casos concretos están destilados, sin
  // depender de ninguna semilla, en finance.test.js y audit.test.js.
  //
  // Valen mientras el generador de fuzz.js no se toque. Si cambia, dejan de
  // significar lo que significaban y hay que volver a buscarlas rompiendo el
  // código otra vez; no basta con que sigan pasando.
  //
  // El sexto arreglo —que la hipoteca de la vivienda no se deduzca en la parte
  // exenta— no tiene semilla aquí: cambia CUÁNTO sale el impuesto, no rompe
  // ninguna propiedad, y el barrido solo vigila propiedades. Ese vive entero
  // en wealthTax.test.js.
  const avisar = console.warn;
  console.warn = () => {};
  try {
    const historial = [
      [6000005, 0.15, 'un plazo de 0 que el fichero convertía en 240 meses'],
      [5000001, 0, 'el principal congelado del alta en vez del saldo de hoy'],
      [5000172, 0, 'un parámetro puesto a 0 que volvía con su valor por defecto'],
      [5000008, 0, 'la auditoría aconsejando sin contar el impuesto sobre el patrimonio']
    ];
    for (const [seed, dureza, qué] of historial) {
      const fallos = comprobarEscenario(escenarioAleatorio(seed, { duro: dureza }));
      assert.deepEqual(fallos, [], `semilla ${seed} (${qué}):\n  ${fallos.join('\n  ')}`);
    }
  } finally {
    console.warn = avisar;
  }
});
