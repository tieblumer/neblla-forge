/**
 * forge-firme.js — el MOTOR del CICLO del forge (Lane 1, lógica pura).
 *
 * El proceso entero es el **CICLO**, con FASES en orden que se pintan arriba como
 * una miga de pan con la fase actual iluminada:
 *
 *     Spike  >  Grooming  >  Sprint  >  QA
 *
 *   - Spike    — exploración desechable (el antiguo "sandbox", taller de usar y tirar).
 *   - Grooming — planificar: los 4 apóstoles, Anselmo (biblia), Ana Liz (diana); Lina.
 *   - Sprint   — construir: Miguel (el release —subir— une con QA).
 *   - QA       — vigilar producción: Otto.
 *   - Hot Fix  — RAMA condicional: si QA falla, vuelve a Miguel; NO va en la línea recta.
 *
 * El mando de transporte tiene 4 acciones (avanzar / retroceder / pausar / reanudar)
 * que mueven un cursor por las fases lineales. Reversible y repetible (F15): se puede
 * retroceder a corregir el rumbo, y re-avanzar repite la fase desde cero.
 *
 * Este módulo es **lógica pura**: recibe un estado `{cursor, paused}` y devuelve otro.
 * La persistencia (leer/escribir `sprint/cycle.json`) vive en `forge-store.js`; el
 * cableado HTTP, en `forge.js`. Aquí no hay disco ni efectos.
 */

// Las FASES del ciclo. `branch:true` = condicional (Hot Fix), fuera de la línea recta.
export const PHASES = [
  { key: 'spike',    label: 'Spike',    pasos: [] },
  { key: 'grooming', label: 'Grooming', pasos: ['apostoles', 'biblia', 'diana'] },
  { key: 'sprint',   label: 'Sprint',   pasos: ['build'] },
  { key: 'qa',       label: 'QA',       pasos: ['release', 'otto'] },
  { key: 'hotfix',   label: 'Hot Fix',  pasos: ['fix'], branch: true },
];

// La línea recta (lo que se pinta en la miga de pan). Hot Fix queda fuera.
export const LINEAR_PHASES = PHASES.filter((p) => !p.branch);

export const DEFAULT_CYCLE = { cursor: 0, paused: false, target: 'forge' };

// OBJETIVO del ciclo: sobre QUÉ se trabaja. Uno por ciclo, NUNCA los dos a la vez
// (decisión de Tie). Lo saben todos los personajes (Miguel construye, Stevens
// audita, Miyagi aconseja) — "de quién están hablando". Se fija antes del sprint.
export const TARGETS = ['forge', 'project'];

// Sanea un estado venido de disco (o ausente) a algo válido.
export function normalize(state) {
  const s = state && typeof state === 'object' ? state : {};
  let cursor = Number.isInteger(s.cursor) ? s.cursor : 0;
  if (cursor < 0) cursor = 0;
  if (cursor > LINEAR_PHASES.length - 1) cursor = LINEAR_PHASES.length - 1;
  const target = TARGETS.includes(s.target) ? s.target : 'forge';
  return { cursor, paused: !!s.paused, target };
}

// Cambia el objetivo del ciclo (forge | project). Estado → estado (puro).
export function setTarget(state, target) {
  const s = normalize(state);
  return { ...s, target: TARGETS.includes(target) ? target : s.target };
}

// La miga de pan con la fase actual entre [corchetes] (= "iluminada").
export function breadcrumb(state) {
  const { cursor } = normalize(state);
  return LINEAR_PHASES.map((p, i) => (i === cursor ? `[${p.label}]` : p.label)).join(' > ');
}

// La forma que viaja al navegador (GET /api/cycle y las respuestas del transporte).
export function publicState(state) {
  const s = normalize(state);
  return {
    phase: LINEAR_PHASES[s.cursor].key,
    cursor: s.cursor,
    paused: s.paused,
    target: s.target,
    phases: LINEAR_PHASES.map((p) => ({ key: p.key, label: p.label })),
    breadcrumb: breadcrumb(s),
  };
}

// ── transiciones (puras: estado → estado; conservan el objetivo) ─────────────
export function advance(state) {
  const s = normalize(state);
  return { ...s, cursor: Math.min(s.cursor + 1, LINEAR_PHASES.length - 1) };
}
export function back(state) {
  const s = normalize(state);
  return { ...s, cursor: Math.max(s.cursor - 1, 0) };
}
export function pause(state) { return { ...normalize(state), paused: true }; }
export function resume(state) { return { ...normalize(state), paused: false }; }

// ¿Esta transición cruza Spike → Grooming? (el cruce que borra las conversaciones).
// Se mide comparando la fase antes y después; así el efecto vive en forge.js.
export function crossesSpikeToGrooming(prev, next) {
  return LINEAR_PHASES[normalize(prev).cursor].key === 'spike'
    && LINEAR_PHASES[normalize(next).cursor].key === 'grooming';
}

export function phaseKey(state) { return LINEAR_PHASES[normalize(state).cursor].key; }
