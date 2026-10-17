// Un plan real que sacó el fuzzer (semilla 21978) y que rompe la monotonía en la que se apoya la
// búsqueda de la edad de retiro segura: cumple jubilándose pronto y NO cumple jubilándose más
// tarde. La causa es el reloj que desbloquea los planes de pensiones (dos años seguidos sin
// trabajar, o los 67): retrasar el retiro lo retrasa más de lo que alarga el dinero líquido, y
// queda una ventana sin nada que rescatar. La caja de retiro seguro tiene que avisar.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(DIR, '..', 'fixtures-plan-no-monotono.json'), 'utf8'));
// Segundo plan del fuzzer (semilla 20038), el que de verdad engañaba a la bisección: su mapa de
// edades desde los 51 es FFFFFFFFFFFFFTFTTTTT, con los 64 cumpliendo, los 65 fallando y los 66 en
// adelante cumpliendo otra vez. La bisección caía en el bloque de arriba, se paraba en los 66 al
// ver que los 65 fallan, y anunciaba dos años de trabajo de más. Aquí no hay ni un plan de
// pensiones: la monotonía se rompe por el calendario de la carrera, no solo por el reloj que
// desbloquea los planes.
const FIXTURE_BISEC = JSON.parse(readFileSync(path.join(DIR, '..', 'fixtures-plan-biseccion-falla.json'), 'utf8'));

export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate((fixtures) => {
      const fixture = fixtures.fixture;
      const base = JSON.parse(JSON.stringify(buildStateObject()));

      // 1. Con los datos de ejemplo la monotonía se cumple: ni aviso ni laterFails.
      applyStateObject(JSON.parse(JSON.stringify(base)));
      runSimulation();
      const ejemplo = {
        laterFails: calculateSimultaneousRetirement().laterFails,
        avisoVisible: !document.getElementById('kpiLaterWarning').classList.contains('hidden')
      };

      // 2. El plan que rompe la monotonía.
      const s = JSON.parse(JSON.stringify(base));
      Object.assign(s, fixture);
      applyStateObject(s);
      runSimulation();
      const res = calculateSimultaneousRetirement();
      // Mapa COMPLETO desde la edad de hoy, no desde la que anuncia: así se puede comprobar que
      // la anunciada es de verdad la mínima y no una que la búsqueda se saltó.
      const p1Hoy = parseInt(document.getElementById('p1_age').value);
      const mapaCompleto = [];
      for (let a = p1Hoy; a <= 70; a++) mapaCompleto.push([a, evaluateRetirementSafety(a, 0).passAll]);
      const minimaReal = (mapaCompleto.find(([, ok]) => ok) || [null])[0];
      const primeraQueFallaDespues = (mapaCompleto.filter(([a]) => a > res.simul.ageP1).find(([, ok]) => !ok) || [null])[0];
      const mapa = mapaCompleto.filter(([a]) => a >= res.simul.ageP1).map(([, ok]) => ok);
      const el = document.getElementById('kpiLaterWarning');
      const roto = {
        edadSegura: res.simul.ageP1,
        laterFails: res.laterFails,
        avisoVisible: !el.classList.contains('hidden'),
        avisoTexto: el.innerText,
        avisoTitulo: el.title,
        // ¿Cumple de verdad la edad que anuncia, y falla de verdad la que denuncia?
        cumpleLaSuya: evaluateRetirementSafety(res.simul.ageP1, 0).passAll,
        fallaLaDenunciada: res.laterFails ? !evaluateRetirementSafety(res.laterFails.ageP1, res.laterFails.ageP2).passAll : null,
        hayAlgunaQueFalla: mapa.some(v => !v),
        minimaReal,
        primeraQueFallaDespues
      };

      // 3. El plan que engañaba a la bisección: la mínima real está por debajo del bloque en el
      //    que la bisección aterrizaba, con un año suelto que falla en medio.
      const sb = JSON.parse(JSON.stringify(base));
      Object.assign(sb, fixtures.bisec);
      applyStateObject(sb);
      runSimulation();
      const rb = calculateSimultaneousRetirement();
      const p1b = parseInt(document.getElementById('p1_age').value);
      const p2b = hasPartner ? parseInt(document.getElementById('p2_age').value) : 0;
      const db = p1b - p2b;
      const okb = {};
      for (let a = p1b; a <= 70; a++) okb[a] = evaluateRetirementSafety(a, hasPartner ? a - db : 0).passAll;
      const edades = Object.keys(okb).map(Number).sort((x, y) => x - y);
      const minRealB = edades.find(a => okb[a]);
      // La bisección de antes, simulada sobre ese mismo mapa.
      let lo = p1b, hi = 70, bis = null;
      while (lo <= hi) { const mid = Math.floor((lo + hi) / 2); if (okb[mid]) { bis = mid; hi = mid - 1; } else lo = mid + 1; }
      while (bis !== null && bis > p1b && okb[bis - 1]) bis--;
      const biseccion = {
        anunciada: rb.simul && rb.simul.ageP1,
        minimaReal: minRealB,
        loQueHabriaDichoLaBiseccion: bis,
        mapa: edades.map(a => (okb[a] ? 'T' : 'F')).join(''),
        desde: p1b
      };

      applyStateObject(base); runSimulation();
      return { ejemplo, roto, biseccion };
    }, { fixture: FIXTURE, bisec: FIXTURE_BISEC });

    assert(r.ejemplo.laterFails === null && !r.ejemplo.avisoVisible,
      `con los datos de ejemplo no debería avisar: ${JSON.stringify(r.ejemplo)}`);
    assert(r.roto.hayAlgunaQueFalla,
      'el plan de la semilla 21978 ya no rompe la monotonía: la prueba dejó de ejercitar el caso');
    assert(r.roto.laterFails !== null && r.roto.avisoVisible,
      `el plan no monótono debería avisar: ${JSON.stringify(r.roto)}`);
    assert(r.roto.cumpleLaSuya, `la edad segura anunciada (${r.roto.edadSegura}) no cumple`);
    // El barrido lineal no supone monotonía: la edad que anuncia tiene que ser la mínima del
    // mapa completo, justo lo que la bisección no podía garantizar en un plan como este.
    assert(r.roto.edadSegura === r.roto.minimaReal,
      `la edad anunciada (${r.roto.edadSegura}) no es la mínima que cumple (${r.roto.minimaReal})`);
    // Y el aviso señala la PRIMERA que falla, no una cualquiera del sondeo de dos en dos.
    assert(r.roto.laterFails.ageP1 === r.roto.primeraQueFallaDespues,
      `el aviso señala los ${r.roto.laterFails.ageP1} y la primera que falla es ${r.roto.primeraQueFallaDespues}`);
    assert(r.roto.fallaLaDenunciada === true,
      `la edad que el aviso denuncia sí cumple: ${JSON.stringify(r.roto.laterFails)}`);
    assert(/no siempre es más seguro/.test(r.roto.avisoTexto) && /planes y seguros/.test(r.roto.avisoTitulo),
      `el aviso no explica el motivo: "${r.roto.avisoTexto}" / "${r.roto.avisoTitulo}"`);
    // El plan de la semilla 20038: el barrido da la mínima y la bisección daba dos años de más.
    const b = r.biseccion;
    assert(b.loQueHabriaDichoLaBiseccion !== b.minimaReal,
      `este plan ya no engaña a la bisección (mapa ${b.mapa} desde ${b.desde}): la prueba dejó de ejercitar el caso`);
    assert(b.anunciada === b.minimaReal,
      `el barrido tiene que dar la mínima real (${b.minimaReal}) y da ${b.anunciada} · mapa ${b.mapa} desde ${b.desde}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `edad segura ${r.roto.edadSegura}, pero falla a los ${r.roto.laterFails.ageP1}: la caja lo avisa · `
      + `semilla 20038: el barrido da ${b.minimaReal}, la bisección daba ${b.loQueHabriaDichoLaBiseccion}`;
  } finally { await browser.close(); }
}
