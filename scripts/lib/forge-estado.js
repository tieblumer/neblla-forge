/**
 * forge-estado.js — el ESTADO de una tarea, derivado de las señales que el ciclo
 * YA emite (lógica pura: tarea → estado; sin disco, sin efectos).
 *
 * Es el "pulso antes que el rostro" (Miyagi): el icono no se inventa, se LEE de
 * las marcas que el motor del forge ya escribe en la tarea —`builtAt` (Ejecutar
 * creó el worktree), `brought` (Traer aplicó el código), `error` (petó al
 * traer)— para que el icono no mienta nunca.
 *
 * Modelo: una tarea es siempre tarea → subtareas. Sin paralelizar todavía: si la
 * tarea no trae `subtareas`, el motor sintetiza UNA sola de alcance completo
 * llamada `main`, cuyo estado se lee de las marcas de build de la propia tarea.
 * La paralelización real (partir el plan en varias subtareas) es otro sprint.
 *
 * La escalera de estados (de menos a más avanzado), con su icono:
 *     pendiente ▢ → cogida ⏳ → terminada 🌳 → en master ✓
 * y, FUERA de la escalera, error ✕ (rojo) = petó/revisar.
 *
 * Los peldaños se LEEN de las marcas que el motor escribe en la tarea:
 *   - `builtAt`  → Ejecutar creó el worktree y Miguel está/estuvo construyendo;
 *   - `brought`  → el build TERMINÓ y vive en el worktree (árbol aislado), pero
 *                  todavía NO está en master → peldaño 'terminada' 🌳;
 *   - `enMaster` → el delta del worktree YA se commiteó a master → 'enMaster' ✓
 *                  (cierre feliz, verde);
 *   - `error`    → petó / agotó reintentos → 'error' ✕ (rojo, fuera de la escalera).
 *
 * Reglas del padre:
 *   - la tarea asume el estado de su subtarea MENOS avanzada;
 *   - el ROJO siempre gana: si alguna subtarea petó, el padre es 'error'
 *     (un fallo nunca queda escondido tras un hermano terminado: se arregla antes
 *     que nada).
 */

// La escalera. `rank` ordena de menos a más avanzado (para la regla del padre).
// `grupo` es el cajón del panel derecho. `rojo` = error (siempre gana).
// `verde` = cierre feliz (en master), para que el front lo pinte distinto.
export const ESTADOS = {
  pendiente: { icon: '▢',  rank: 0, grupo: 'porhacer',   label: 'pendiente' },
  cogida:    { icon: '⏳', rank: 1, grupo: 'encurso',    label: 'cogida' },
  terminada: { icon: '🌳', rank: 2, grupo: 'terminadas', label: 'terminada' },
  enMaster:  { icon: '✓',  rank: 3, grupo: 'terminadas', label: 'en master', verde: true },
  error:     { icon: '✕',  rank: -1, grupo: 'revisar',   label: 'error', rojo: true },
};

export function iconOf(estado)  { return (ESTADOS[estado] || ESTADOS.pendiente).icon; }
export function grupoOf(estado) { return (ESTADOS[estado] || ESTADOS.pendiente).grupo; }
export function esRojo(estado)  { return !!(ESTADOS[estado] && ESTADOS[estado].rojo); }
export function esVerde(estado) { return !!(ESTADOS[estado] && ESTADOS[estado].verde); }

// El estado de la subtarea `main` leído de las marcas de la tarea. El orden de los
// `if` ES la escalera: rojo primero, luego de más a menos avanzado.
function mainEstado(tarea) {
  if (tarea.error)              return 'error';
  if (tarea.enMaster)           return 'enMaster';
  if (tarea.brought)            return 'terminada';
  if (tarea.builtAt)            return 'cogida';
  return 'pendiente';
}

// Las subtareas de una tarea: las que traiga (saneadas) o la sintética `main`.
export function subtareasDe(tarea) {
  const t = tarea || {};
  const arr = Array.isArray(t.subtareas) ? t.subtareas : null;
  if (arr && arr.length) {
    // Si la subtarea trae su PROPIO estado (build en paralelo, un Miguel por carril),
    // se respeta. Si NO lo trae, hereda el estado GLOBAL de la tarea (mainEstado): así
    // una tarea partida pero construida/traída de una pieza no se queda en ▢ pendiente.
    const fallback = mainEstado(t);
    return arr.map((s, i) => {
      const estado = ESTADOS[s && s.estado] ? s.estado : fallback;
      const out = { name: (s && s.name) || (i === 0 ? 'main' : 'sub-' + (i + 1)), estado, icon: iconOf(estado) };
      // el ALCANCE (carril) viaja al front si lo trae: archivos/frontera/noTocar.
      // Lo escribe Aubé al partir (forge-trocear.js); el motor solo lo transporta.
      if (s && s.alcance && typeof s.alcance === 'object') out.alcance = s.alcance;
      return out;
    });
  }
  const estado = mainEstado(t);
  return [{ name: 'main', estado, icon: iconOf(estado) }];
}

// El estado del PADRE a partir de sus subtareas: rojo gana; si no, la menos avanzada.
export function estadoPadre(subs) {
  if (!subs || !subs.length) return 'pendiente';
  if (subs.some((s) => esRojo(s.estado))) return 'error';
  let min = subs[0].estado;
  for (const s of subs) {
    if ((ESTADOS[s.estado] || ESTADOS.pendiente).rank < (ESTADOS[min] || ESTADOS.pendiente).rank) min = s.estado;
  }
  return min;
}

// ¿Divergen los iconos de las subtareas? → el panel despliega el contenedor solo.
export function diverge(subs) {
  return new Set((subs || []).map((s) => s.estado)).size > 1;
}

// ── EL PASO RECOMENDADO de una tarea (la secuencia natural del ciclo) ─────────
// Vive AQUÍ, en la forja (no en el navegador), a propósito: cuando una IA tome el
// papel de orquestador leerá `next` por API y sabrá qué toca SIN mirar la pantalla.
// Es PURA: decide solo desde el estado PERSISTENTE de la tarea (no del runtime).
// Devuelve { key, label } o null si la tarea ya está hecha (en master).
//   rev → plan(Aubé) · aprobar → definir → escribir → ejecutar → probar → completar
const PASO_LABEL = {
  rev: 'Revisar con Aubé (crear el plan)',
  aprobar: 'Aprobar el plan',
  definir: 'Definir los tests (Ana Liz)',
  escribir: 'Escribir los tests en código (Ana Liz)',
  ejecutar: 'Ejecutar — Miguel construye',
  probar: 'Probar la batería de tests',
  completar: 'Completar la tarea (subir a master)',
};
export function pasoRecomendado(tarea) {
  const t = tarea || {};
  const tests = (t.testsPlan && Array.isArray(t.testsPlan.tests)) ? t.testsPlan.tests : [];
  const hayEscritos = tests.some((x) => x.id && x.estado && x.estado !== 'definido');
  const seCorrieron = !!(t.testsPlan && t.testsPlan.ultimaCorrida);
  let key = null;
  if (!t.plan) key = 'rev';                       // 1 sin plan → Aubé
  else if (!t.plan.aprobado) key = 'aprobar';     // 2 plan → aprobarlo
  else if (!tests.length) key = 'definir';        // 3 → definir tests
  else if (!hayEscritos) key = 'escribir';        // 4 → escribir tests
  else if (!t.builtAt) key = 'ejecutar';          // 5 → Miguel construye
  else if (!seCorrieron) key = 'probar';          // 6 → probar la batería
  else if (!t.enMaster) key = 'completar';        // 7 → completar
  return key ? { key, label: PASO_LABEL[key] } : null;
}

// Decora una tarea con su estado computado + subtareas + el paso recomendado (lo
// que viaja al front Y a una IA orquestadora vía /api/tareas).
export function decorar(tarea) {
  const subtareas = subtareasDe(tarea);
  const estado = estadoPadre(subtareas);
  return {
    ...tarea,
    estado,
    icon: iconOf(estado),
    grupo: grupoOf(estado),
    diverge: diverge(subtareas),
    subtareas,
    next: pasoRecomendado(tarea),
  };
}

// El orden de los cajones del panel: lo roto primero, luego en curso, por hacer y
// al final lo terminado (decisión de Tie: los errores se arreglan antes que nada).
export const GRUPOS = [
  { key: 'revisar',    label: 'Revisar',    orden: 0 },
  { key: 'encurso',    label: 'En curso',   orden: 1 },
  { key: 'porhacer',   label: 'Por hacer',  orden: 2 },
  { key: 'terminadas', label: 'Terminadas', orden: 3 },
];
const GRUPO_ORDEN = Object.fromEntries(GRUPOS.map((g) => [g.key, g.orden]));

// Decora + ordena una lista de tareas: por cajón y, dentro, la más nueva arriba.
export function ordenar(tareas) {
  return (tareas || []).map(decorar).sort((a, b) => {
    const g = (GRUPO_ORDEN[a.grupo] ?? 9) - (GRUPO_ORDEN[b.grupo] ?? 9);
    if (g !== 0) return g;
    return (b.num || 0) - (a.num || 0);
  });
}
