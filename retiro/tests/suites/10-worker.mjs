// El Worker de Monte Carlo se monta en tiempo de ejecución a partir de una lista explícita de
// funciones y constantes. Esta prueba es la que vuelve esa lista segura: el mismo sorteo, con
// los mismos datos, tiene que dar EXACTAMENTE lo mismo en el Worker que en el hilo principal.
// Si falta una función de la lista, el Worker lanza ReferenceError y se ve aquí.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(async () => {
      openRobustnessTab();
      const small = { paths: 120, defencePaths: 60, matrixPaths: 40 };
      const strip = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.ranAt; delete c.engine; return JSON.stringify(c); };

      const t0 = performance.now();
      await runMonteCarlo(small);
      const worker = { engine: mcLastResult.engine, key: strip(mcLastResult), ms: Math.round(performance.now() - t0),
                       label: document.getElementById('mcSeedLabel').innerText };
      const t1 = performance.now();
      await runMonteCarlo({ ...small, mainThread: true });
      const main = { engine: mcLastResult.engine, key: strip(mcLastResult), ms: Math.round(performance.now() - t1) };

      // El código fuente del Worker no puede depender de la interfaz: ninguna de las funciones
      // que llama de verdad toca document. Las tres que lo hacen (numParam, isCoupled,
      // getAnnualEducationCost sin opciones) no se invocan con parámetros pre-leídos.
      const src = buildMcWorkerSource();
      const fns = MC_WORKER_FUNCTIONS().map(f => f.name);
      const domInSrc = (src.match(/document\./g) || []).length;

      // Cancelar termina el Worker y no deja resultado a medias.
      const before = mcLastResult;
      const p = runMonteCarlo(small);
      await new Promise(res => setTimeout(res, 60));
      cancelMonteCarlo();
      await p;
      const afterCancel = { unchanged: mcLastResult === before, running: mcRunning, workerNull: mcActiveWorker === null,
                            btn: document.getElementById('mcRunBtn').innerText };
      return { worker, main, fns: fns.length, srcLen: src.length, domInSrc, afterCancel };
    });
    assert(r.worker.engine === 'worker', `el sorteo no corrió en el Worker: ${r.worker.engine}`);
    assert(r.main.engine === 'main', 'el forzado al hilo principal no se respetó');
    assert(r.worker.key === r.main.key, 'Worker e hilo principal no dan el mismo resultado');
    assert(r.worker.label.includes('segundo plano'), `la etiqueta no dice que fue en segundo plano: ${r.worker.label}`);
    assert(r.domInSrc <= 6, `demasiadas referencias a document en el código del Worker: ${r.domInSrc}`);
    assert(r.afterCancel.unchanged && !r.afterCancel.running && r.afterCancel.workerNull, `cancelar dejó estado a medias: ${JSON.stringify(r.afterCancel)}`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `${r.fns} funciones · ${Math.round(r.srcLen / 1024)} KB · worker ${r.worker.ms} ms vs hilo ${r.main.ms} ms · idénticos`;
  } finally { await browser.close(); }
}
