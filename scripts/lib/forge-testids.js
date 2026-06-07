/**
 * forge-testids.js — sellado y reparto de IDs de test (Fase D).
 *
 * Cuando se aprueban los tests en papel de Ana Liz, cada uno recibe un ID ESTABLE
 * (`T-<tareaNum>-NN`) que viajará: (a) al fichero de test real que escribe Ana Liz
 * (cada caso lleva su `[T-14-01]` en el label → el runner lo filtra con --only),
 * y (b) a cada subtarea, que recibe los IDs que DEBE cubrir su Miguel.
 *
 * Lógica PURA (Contrato B): NO lee disco, NO importa el store, NO toca env.
 */

import { normalizarTestsPlan, REF_GENERAL } from './forge-tests.js';

// Sella IDs en el plan de tests. Idempotente: respeta los IDs que ya existan
// (estables entre Reanalizar parciales) y solo asigna a los que falten, con el
// siguiente número libre. `tareaNum` es el número de la tarea (entero). Devuelve un
// plan NUEVO normalizado con cada test con su `id`.
export function sellarTestIds(testsPlan, tareaNum) {
  const p = normalizarTestsPlan(testsPlan);
  const num = Number(tareaNum) || 0;
  const prefix = 'T-' + num + '-';
  // máximo correlativo ya usado bajo este prefijo (para no repetir).
  let max = 0;
  for (const t of p.tests) {
    const m = (t && typeof t.id === 'string') ? t.id.match(/-(\d+)$/) : null;
    if (m && t.id.startsWith(prefix)) max = Math.max(max, parseInt(m[1], 10));
  }
  const usados = new Set(p.tests.map((t) => t && t.id).filter(Boolean));
  const tests = p.tests.map((t) => {
    if (t.id && usados.has(t.id) && t.id.startsWith(prefix)) return { ...t };  // ya sellado, lo dejamos
    let id;
    do { id = prefix + String(++max).padStart(2, '0'); } while (usados.has(id));
    usados.add(id);
    return { ...t, id };
  });
  return { ...p, tests };
}

// Reparte los IDs por destino: { general: [ids], <subtarea>: [ids] }. Lo que cada
// Miguel (por subtarea) recibe = su grupo; lo "general" valida la tarea entera.
export function testIdsPorRef(testsPlan) {
  const p = normalizarTestsPlan(testsPlan);
  const out = {};
  for (const t of p.tests) {
    if (!t.id) continue;
    const ref = t.ref || REF_GENERAL;
    (out[ref] = out[ref] || []).push(t.id);
  }
  return out;
}

// Los IDs que le tocan a UNA subtarea concreta = los suyos + los generales (la
// subtarea también ayuda a que la tarea entera pase). `subName` null/'' → solo los
// generales (caso de tarea sin partir).
export function testIdsParaSubtarea(testsPlan, subName) {
  const porRef = testIdsPorRef(testsPlan);
  const generales = porRef[REF_GENERAL] || [];
  const suyos = subName ? (porRef[subName] || []) : [];
  return [...new Set([...suyos, ...generales])];
}
