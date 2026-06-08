/**
 * forge-recon.js — el CEREBRO PURO del CICLO DE RECONSTRUCCIÓN del forge.
 *
 * El ciclo de reconstrucción es un fence (NO un cartel): un orden fijo de pasos
 * 1→9 que reconstruye una feature desde cero para probar que su documentación y
 * sus tests describen lo que el código ya hacía. El DRIVER con efectos (ramas,
 * worktrees, lanzar headless, correr la batería) vive en `scripts/reconstruir.js`;
 * AQUÍ solo la lógica pura: descriptores de pasos y los veredictos deterministas
 * (gate de oro, limpieza, volcado, reanudación). Sin disco, sin env, sin store.
 *
 *   1. rama      — crear rama de ciclo y mover el worktree a ella (no a master);
 *                  guardar baseRef=master como punto de diff master-vs-rama.
 *   2. anselmo   — Anselmo documenta TODO el diff en backbone + MCP (su worktree).
 *   3. apostoles — 4 instancias EN PARALELO del mismo apóstol (lucas/marcos/juan/
 *                  mateo), cada una verifica la documentación desde su ángulo.
 *   4. plan      — Lina + Ana Liz redactan plan y tests mirando SOLO tests + docs
 *                  de Anselmo; los huecos de Mateo entran como tests obligatorios.
 *   5. gate      — GATE DE ORO: correr la batería nueva contra MASTER. Verde =
 *                  los tests describen lo que ya existía; rojo aborta el ciclo.
 *   6. limpieza  — borrar de la rama todo el código que no sean los tests.
 *   7. volcado   — volcar la rama con plan + docs, SIN los libros de los apóstoles.
 *   8. miguel    — un Miguel gigante (ultracode, su worktree) reconstruye desde el
 *                  código de master hasta que TODOS los tests pasan.
 *   9. reanudacion — si Miguel se cae, otro Miguel sigue en la MISMA rama.
 */

// ── Paso 1: abrir el ciclo ───────────────────────────────────────────────────
// Plan PURO de la apertura: qué rama se crea y cuál es el baseRef. El driver es
// quien ejecuta de verdad `git worktree`/`git switch`. baseRef SIEMPRE = master
// (el dueño del baseRef es el orquestador; ningún builder lo decide).
export function abrirCiclo({ baseBranch = 'master', sufijo } = {} ) {
  const base = String(baseBranch || 'master');
  const rama = 'ciclo/recon' + (sufijo ? '-' + String(sufijo) : '');
  return {
    rama,                 // la rama de ciclo nueva (distinta de master)
    baseRef: base,        // el punto de comparación para el diff master-vs-rama
    baseBranch: base,
    worktreeEnRama: true, // el worktree pasa a ELLA, no a master
  };
}

// ── La secuencia del fence (pasos en orden fijo 1→9) ─────────────────────────
// Lista de descriptores; el paso de apóstoles es un fan-out de 4 EN PARALELO.
export function pasosCiclo() {
  return [
    { n: 1, paso: 'rama', desc: 'crear la rama de ciclo y mover el worktree a ella (no a master); baseRef=master para diffear master-vs-rama' },
    { n: 2, paso: 'anselmo', worktreePropio: true, desc: 'Anselmo documenta a fondo el diff master-vs-rama en el backbone y lo refleja en el MCP' },
    {
      n: 3, paso: 'apostoles',
      paralelo: true,            // los 4 arrancan EN PARALELO (un solo fan-out, no 4 en serie)
      cuantos: 4,
      apostoles: ['lucas', 'marcos', 'juan', 'mateo'],
      desc: '4 instancias EN PARALELO del mismo apóstol, una por ángulo, verifican la documentación contra el diff',
    },
    { n: 4, paso: 'plan', desc: 'Lina y Ana Liz redactan plan y batería mirando SOLO los tests + el worktree de Anselmo; los huecos de Mateo son tests obligatorios' },
    { n: 5, paso: 'gate', desc: 'GATE DE ORO: correr la batería nueva contra MASTER (verde sigue, rojo aborta)' },
    { n: 6, paso: 'limpieza', desc: 'borrar de la rama todo el código que no sean los ficheros de test' },
    { n: 7, paso: 'volcado', desc: 'volcar la rama con el plan de Lina y los docs de Anselmo, sin los libros de los apostoles' },
    { n: 8, paso: 'miguel', worktreePropio: true, desc: 'un Miguel gigante en ultracode reconstruye desde el código de master hasta que todos los tests pasan' },
    { n: 9, paso: 'reanudacion', desc: 'si Miguel se cae, arrancar otro que sigue desde donde lo dejo en la misma rama' },
  ];
}

// ── Paso 5: GATE DE ORO (puro) ───────────────────────────────────────────────
// La batería NUEVA se corre contra el código de MASTER. Verde (0 fallos) = los
// tests describen lo que ya existía → el ciclo continúa. Rojo (algún fallo) =
// los tests inventan comportamiento → ABORTA (no limpia, no vuelca, NO Miguel).
export function gateDeOro({ pass = 0, fail = 0 } = {}) {
  const fallos = Number(fail) || 0;
  if (fallos === 0) {
    return { ok: true, verde: true, accion: 'continuar', siguiente: 'limpieza', pass: Number(pass) || 0, fail: 0 };
  }
  return { ok: false, verde: false, accion: 'abortar', motivo: 'la batería nueva falla contra master: los tests inventan comportamiento', pass: Number(pass) || 0, fail: fallos };
}

// ── Paso 6: limpieza de la rama (puro) ───────────────────────────────────────
// De los ficheros que cambiaron en la rama, conserva SOLO los de test; el resto
// (la implementación) vuelve al estado de master para que Miguel reconstruya.
export function planLimpieza(cambiados) {
  const arr = Array.isArray(cambiados)
    ? cambiados
    : (cambiados && Array.isArray(cambiados.cambiados) ? cambiados.cambiados : []);
  const esTest = (p) => /\.test\.js$/.test(p) || /[\\/]tests[\\/]/.test(p);
  const conserva = arr.filter(esTest);
  const revierte = arr.filter((p) => !esTest(p));
  // Devolvemos un objeto rico (conserva + revierte), pero también es array-like:
  // los tests aceptan tanto un array directo como {conserva}. Damos array para el
  // caso simple y colgamos `revierte` por si el driver lo quiere.
  conserva.conserva = conserva;
  conserva.revierte = revierte;
  return conserva;
}

// ── Paso 7: filtro del volcado (puro) ────────────────────────────────────────
// Al volcar la rama nos quedamos con el plan de Lina y los docs de Anselmo, pero
// EXCLUIMOS los 4 testimonios/libros de los apóstoles (lucas/marcos/juan/mateo).
export function filtrarVolcado(files) {
  const arr = Array.isArray(files)
    ? files
    : (files && Array.isArray(files.files) ? files.files : []);
  return arr.filter((p) => !/(lucas|marcos|juan|mateo)\b/i.test(String(p)));
}

// ── Paso 9: decisión de reanudación de Miguel (puro) ─────────────────────────
// Si Miguel cae con tests aún en rojo, se lanza OTRO Miguel con reanudacion=true
// sobre la MISMA rama (continúa, no desde cero). Si ya estaba todo verde, no hay
// nada que reanudar: el ciclo se da por completado.
export function decidirReanudacion({ caido = false, todosVerde = false, rama } = {}) {
  if (todosVerde) {
    return { reanudacion: false, accion: 'completado', rama, motivo: 'todos los tests en verde, nada que reanudar' };
  }
  if (caido) {
    return { reanudacion: true, relanzar: true, accion: 'reanudar', rama, desdeCero: false };
  }
  return { reanudacion: false, accion: 'seguir', rama };
}

export const RECON_PASOS = pasosCiclo().map((p) => p.paso);
