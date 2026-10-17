// Las tres defensas: apagadas son un no-op, y encendidas van en la dirección económica
// correcta. El colchón cuesta patrimonio en calma. La flexibilidad no se activa ningún año en
// calma y sí en una crisis, donde mejora el resultado. El colchón creciente cuesta menos que el
// plano en calma y protege cuando la crisis llega al jubilarse.
export default async function run({ open, assert }) {
  const { browser, page, errors } = await open();
  try {
    const r = await page.evaluate(() => {
      const A1 = 55, A2 = 52, P1 = parseInt(document.getElementById('p1_age').value);
      const at = (res) => (res.series.find(p => p.ageP1 >= 65) || res.series.at(-1)).realNW;
      const base = evaluateRetirementSafety(A1, A2, { collect: true });
      const path = buildStressPath(stressScenarioById('dotcom'), A1 - P1);
      const crisis = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: path });

      const buf24 = evaluateRetirementSafety(A1, A2, { collect: true, defence: { bufferMonths: 24 } });
      const flexCalm = evaluateRetirementSafety(A1, A2, { collect: true, defence: { flex: { returnBelow: -0.10, cut: 0.10 } } });
      const flexCrisis = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: path, defence: { flex: { returnBelow: -0.10, cut: 0.10 } } });
      const glideCalm = evaluateRetirementSafety(A1, A2, { collect: true, defence: { bufferGlide: { years: 10, targetMonths: 24 } } });
      const glideCrisis = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: path, defence: { bufferGlide: { years: 10, targetMonths: 24 } } });

      // Reparto acciones -> renta fija: la proporción llega al objetivo el año del retiro, se
      // paga plusvalía, y en una crisis que empieza al jubilarse el resultado es mejor.
      const gp = { glidepath: { years: 10, targetBondShare: 0.40 } };
      const bondsCalm = evaluateRetirementSafety(A1, A2, { collect: true, defence: gp });
      const bondsCrisis = evaluateRetirementSafety(A1, A2, { collect: true, rateOverrides: path, defence: gp });
      const bondsOff = evaluateRetirementSafety(A1, A2, { collect: true, defence: { glidepath: null } });

      return {
        bondsCalm: at(bondsCalm), bondsCrisis: at(bondsCrisis), bondsMoved: bondsCalm.defence.glideMoved, bondsTax: bondsCalm.defence.glideTax,
        bondsOffSame: JSON.stringify(bondsOff.series) === JSON.stringify(base.series) && bondsOff.defence.glideMoved === 0,
        base: at(base), crisis: at(crisis),
        buf24: at(buf24), buf24Months: buf24.defence.bufferMonths,
        flexCalm: at(flexCalm), flexCalmYears: flexCalm.defence.flexYearsApplied,
        flexCrisis: at(flexCrisis), flexCrisisYears: flexCrisis.defence.flexYearsApplied,
        glideCalm: at(glideCalm), glideMax: glideCalm.defence.maxBufferMonths,
        glideCrisis: at(glideCrisis),
        catalogue: MC_DEFENCES.map(d => d.id)
      };
    });
    assert(r.buf24Months === 24, 'la defensa del colchón no salta el tope de 6 meses');
    assert(r.buf24 < r.base, `el colchón de 24 meses no cuesta patrimonio en calma (${r.buf24} vs ${r.base})`);
    assert(r.flexCalmYears === 0 && r.flexCalm === r.base, `la flexibilidad se activa sin crisis (${r.flexCalmYears} años)`);
    assert(r.flexCrisisYears >= 1, 'la flexibilidad no se activa en la crisis puntocom');
    assert(r.flexCrisis > r.crisis, `la flexibilidad no mejora la crisis (${r.flexCrisis} vs ${r.crisis})`);
    assert(r.glideMax === 24, `el colchón creciente no llega a 24 meses: ${r.glideMax}`);
    assert(r.glideCalm < r.base && r.glideCalm > r.buf24, 'el colchón creciente debería costar menos que el plano en calma');
    assert(r.glideCrisis > r.crisis, `el colchón creciente no protege en la crisis (${r.glideCrisis} vs ${r.crisis})`);
    assert(r.catalogue.join(',') === 'flex,buffer,glide,bonds', `catálogo de defensas: ${r.catalogue}`);
    assert(r.bondsOffSame, 'la defensa de renta fija apagada no es un no-op');
    assert(r.bondsMoved > 0 && r.bondsTax > 0, `el reparto no traslada nada: ${r.bondsMoved} € (impuesto ${r.bondsTax} €)`);
    assert(r.bondsCalm < r.base, `pasar a renta fija no cuesta rentabilidad en calma (${r.bondsCalm} vs ${r.base})`);
    assert(r.bondsCrisis > r.crisis, `pasar a renta fija no protege en la crisis (${r.bondsCrisis} vs ${r.crisis})`);
    assert(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
    return `colchón −${Math.round((r.base - r.buf24) / 1000)}k · flex +${Math.round((r.flexCrisis - r.crisis) / 1000)}k en crisis · creciente −${Math.round((r.base - r.glideCalm) / 1000)}k/+${Math.round((r.glideCrisis - r.crisis) / 1000)}k · renta fija −${Math.round((r.base - r.bondsCalm) / 1000)}k/+${Math.round((r.bondsCrisis - r.crisis) / 1000)}k (mueve ${Math.round(r.bondsMoved / 1000)}k)`;
  } finally { await browser.close(); }
}
