/**
 * forge-subsidy.js — el CALIBRADOR de subvención de la suscripción (lógica pura).
 *
 * Pregunta que responde: ¿cuántos DÓLARES equivalentes-API cuesta el 100 % de la
 * ventana de 5 h? Es decir, cuánto subvenciona la suscripción frente a pagar la API
 * por token. No hay número fijo publicado: Anthropic solo expone un % de utilización.
 * Así que lo MEDIMOS con datos reales del propio forge.
 *
 * Idea: la ventana de 5 h sube de % a medida que se gasta y se RESETEA en `resetsAt`.
 * Dentro de un MISMO ciclo (mismo resetsAt, el % no baja), cada vez que muestreamos
 * tenemos un delta: el % subió `dPct` y, en ese intervalo, el forge gastó `dCost`
 * dólares equivalentes-API (lo que reporta el CLI, `total_cost_usd`). El "precio" de
 * 1 % de ventana ≈ dCost/dPct, y el del 100 % ≈ eso × 100.
 *
 * Acumulamos MUCHOS deltas (a lo largo de ciclos y días) y estimamos por
 * RATIO-OF-SUMS: valor(100 %) = (Σ dCost / Σ dPct) × 100. Robusto: los saltos grandes
 * (menos ruido) pesan más, y se va afinando solo cuanto más se observa.
 *
 * CAVEAT honesto: la misma suscripción puede gastarse en sesiones interactivas (p.ej.
 * Claude Code a mano) que NO pasan por el log del forge. Ese consumo mueve el % pero
 * no suma a `dCost` → la estimación queda por DEBAJO del valor real. Por eso el número
 * es una COTA INFERIOR: el 100 % real vale al menos esto.
 *
 * Módulo PURO: estado → estado. La persistencia (sprint/subsidy.json) vive en
 * forge-store.js; el muestreo y el cableado HTTP, en forge.js.
 */

export function emptySubsidy() {
  return { last: null, samples: [], feeMonthlyUsd: null };
}

// Sanea un estado venido de disco (o ausente) a algo válido.
export function normalizeSubsidy(state) {
  const o = (state && typeof state === 'object') ? state : {};
  const samples = Array.isArray(o.samples)
    ? o.samples.filter((x) => x && Number.isFinite(Number(x.dPct)) && Number.isFinite(Number(x.dCost)))
        .map((x) => ({ at: x.at || null, dPct: Number(x.dPct), dCost: Number(x.dCost) }))
    : [];
  const last = (o.last && typeof o.last === 'object') ? {
    at: o.last.at || null,
    totalCost: Number(o.last.totalCost) || 0,
    util: (o.last.util == null ? null : Number(o.last.util)),
    resetsAt: o.last.resetsAt || null,
  } : null;
  const fee = Number(o.feeMonthlyUsd);
  return { last, samples, feeMonthlyUsd: (Number.isFinite(fee) && fee > 0) ? fee : null };
}

// Registra una muestra {at, totalCost, util, resetsAt}. Si encadena con la anterior
// DENTRO del mismo ciclo (mismo resetsAt, % no baja, coste no baja) y el % subió al
// menos `minPct`, añade el delta. Siempre actualiza `last`. Poda por antigüedad/cantidad.
// Devuelve { state, appended }.
export function recordSubsidySample(state, sample, opts = {}) {
  const minPct = opts.minPct == null ? 0.5 : opts.minPct;
  const maxSamples = opts.maxSamples == null ? 5000 : opts.maxSamples;
  const maxAgeMs = opts.maxAgeMs == null ? null : opts.maxAgeMs;
  const s = normalizeSubsidy(state);
  const cur = {
    at: sample.at || null,
    totalCost: Number(sample.totalCost) || 0,
    util: (sample.util == null ? null : Number(sample.util)),
    resetsAt: sample.resetsAt || null,
  };
  let appended = null;
  const prev = s.last;
  if (prev && prev.util != null && cur.util != null
      && prev.resetsAt && cur.resetsAt && prev.resetsAt === cur.resetsAt
      && cur.util >= prev.util && cur.totalCost >= prev.totalCost) {
    const dPct = cur.util - prev.util;
    const dCost = cur.totalCost - prev.totalCost;
    if (dPct >= minPct) appended = { at: cur.at, dPct, dCost };
  }
  let samples = appended ? s.samples.concat([appended]) : s.samples;
  if (maxAgeMs && cur.at) {
    const cutoff = Date.parse(cur.at) - maxAgeMs;
    if (Number.isFinite(cutoff)) {
      samples = samples.filter((x) => {
        const t = Date.parse(x.at);
        return !Number.isFinite(t) || t >= cutoff;
      });
    }
  }
  if (samples.length > maxSamples) samples = samples.slice(samples.length - maxSamples);
  return { state: { last: cur, samples, feeMonthlyUsd: s.feeMonthlyUsd }, appended: !!appended };
}

// La estimación: valor API del 100 % de la ventana = (Σ dCost / Σ dPct) × 100.
// `observedPct` (Σ dPct) es la "cantidad de ventana observada": cuanto mayor, más
// fiable (≈100 = un ciclo entero acumulado; varios cientos = sólido).
export function estimateSubsidy(state) {
  const s = normalizeSubsidy(state);
  let sumDCost = 0, sumDPct = 0;
  for (const x of s.samples) { sumDCost += Number(x.dCost) || 0; sumDPct += Number(x.dPct) || 0; }
  const valuePer100 = sumDPct > 0 ? (sumDCost / sumDPct) * 100 : null;
  return {
    valuePer100,
    sampleCount: s.samples.length,
    observedPct: sumDPct,
    observedCost: sumDCost,
  };
}

// Fija (o borra, con null/0) la cuota mensual de la suscripción. Estado → estado.
export function setFee(state, fee) {
  const s = normalizeSubsidy(state);
  const f = Number(fee);
  return { ...s, feeMonthlyUsd: (Number.isFinite(f) && f > 0) ? f : null };
}
