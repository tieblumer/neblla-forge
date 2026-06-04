/**
 * forge-merge.js — el ÚLTIMO diente de la rueda: traer TODO el arbolito de una
 * tarea (los commits de su rama + los cambios sueltos del worktree) al árbol vivo
 * del repo objetivo y COMMITEARLO a master. Determinista de cabo a rabo: el único
 * Claude que interviene es el revisor de conflictos (regla del forge).
 *
 * Flujo de cierre (los dientes, en orden):
 *   1. delta COMPLETO del worktree vs su base  (commits + cambios sin comitear);
 *   2. apply al árbol vivo  (plano y, si no encaja, a 3 vías);
 *   3. add -A + commit a master  (la rama actual del repo; NO push);
 *   4. conflicto → revisor → reintento  (tope MERGE_MAX_REINTENTOS);
 *   5. si tras el tope sigue sin entrar → ERROR (✕) para que el CEO lo vea.
 *
 * Serialización: un MUTEX (cadena de promesas) garantiza que dos tareas que
 * terminan a la vez commitean de una en una, nunca simultáneamente (forge.js es UN
 * proceso, pero el trabajo es async por el revisor).
 *
 * Inyección de dependencias: este módulo NO conoce el servidor ni `claude`. Recibe
 * sus herramientas (git runner, store, resolución de repo, lanzador del revisor) en
 * `createMergeEngine(deps)`. Así el test lo monta con un repo git de verdad y un
 * revisor mockeado, sin arrancar el Express ni invocar a un Claude real.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync as nodeSpawnSync } from 'child_process';

export const MERGE_MAX_REINTENTOS = 3;

// Ficheros con marcadores de conflicto en el árbol vivo (tras un apply --3way que
// chocó). Anclado a columna 0 para no matchear código que contenga la cadena.
export function listConflictFiles(spawnSync, repo) {
  const r = spawnSync('git', ['-C', repo, 'grep', '-lE', '^<<<<<<< '], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

// El parche del delta COMPLETO del worktree respecto a su base:
//   `git add -N .`     → hace visibles los ficheros NUEVOS sin trackear (intent-to-
//                        add: no altera su contenido, solo el índice del worktree);
//   `git diff <base>`  → compara la BASE contra el ÁRBOL DE TRABAJO, cubriendo a la
//                        vez los commits de la rama Y los cambios aún sin comitear.
// El worktree es desechable, así que el `add -N` no daña nada vivo. Devuelve
// { ok, patch, empty } o { ok:false, error }.
export function worktreeFullDeltaPatch(spawnSync, tarea) {
  const wt = tarea.worktree;
  if (!wt || !fs.existsSync(wt)) return { ok: false, error: 'esta tarea no tiene worktree de Miguel (¿la ejecutaste?)' };
  let base = tarea.base;
  if (!base) {
    const mb = spawnSync('git', ['-C', wt, 'merge-base', 'HEAD', '@{u}'], { encoding: 'utf8' });
    base = (mb.status === 0 && mb.stdout.trim()) ? mb.stdout.trim() : 'HEAD';
  }
  spawnSync('git', ['-C', wt, 'add', '-N', '.'], { encoding: 'utf8' });
  const diff = spawnSync('git', ['-C', wt, 'diff', base], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (diff.status !== 0) return { ok: false, error: 'no pude leer el delta del worktree: ' + ((diff.stderr || '').trim() || 'git falló') };
  if (!diff.stdout.trim()) return { ok: true, empty: true, patch: '' };
  return { ok: true, patch: diff.stdout };
}

// Aplica `patch` al árbol vivo de `repo` (plano y, si no encaja, a 3 vías).
// → { applied:true } | { applied:false, ficheros:[...] } | { applied:false, incompatible:true }.
export function applyPatchToLive(spawnSync, repo, patch) {
  const patchPath = path.join(os.tmpdir(), `forge-merge-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
  fs.writeFileSync(patchPath, patch);
  try {
    let ap = spawnSync('git', ['-C', repo, 'apply', patchPath], { encoding: 'utf8' });
    if (ap.status !== 0) ap = spawnSync('git', ['-C', repo, 'apply', '--3way', patchPath], { encoding: 'utf8' });
    if (ap.status === 0) return { applied: true };
    const ficheros = listConflictFiles(spawnSync, repo);
    if (!ficheros.length) return { applied: false, incompatible: true };
    return { applied: false, ficheros };
  } finally { try { fs.unlinkSync(patchPath); } catch {} }
}

// Commit del árbol vivo a MASTER (la rama actual del repo). add -A + commit con un
// mensaje que referencia la tarea (id + título). NO push. → { ok, commit } | { ok:false, error }.
export function commitLiveToMaster(spawnSync, repo, tarea) {
  const add = spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
  if (add.status !== 0) return { ok: false, error: 'git add -A falló: ' + ((add.stderr || '').trim() || '?') };
  const msg = `forge: tarea ${tarea.id} — ${tarea.title || ''}`.trim();
  const c = spawnSync('git', ['-C', repo, 'commit', '-m', msg], { encoding: 'utf8' });
  if (c.status !== 0) return { ok: false, error: 'git commit falló: ' + ((c.stderr || c.stdout || '').trim() || 'nada que commitear') };
  const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return { ok: true, commit: sha.status === 0 ? sha.stdout.trim() : null };
}

/**
 * Monta el motor de merge con sus dependencias inyectadas.
 *   deps.spawnSync(cmd, args, opts)        — runner de git (real o mock)
 *   deps.readTarea(id) → tarea | null      — lee la tarea del store
 *   deps.resolveRepo(tarea) → repoPath     — el repo objetivo (vivo) de la tarea
 *   deps.markBrought(id)                   — marca "terminada en el arbolito" 🌳
 *   deps.markEnMaster(id, commit)          — marca "en master" ✓ (cierre feliz)
 *   deps.markError(id, msg)                — marca error ✕
 *   deps.runReviewer({ tarea, repo, ficheros }) → Promise  — lanza el revisor de
 *                                            conflictos (mockeable). Espera a que termine.
 * Devuelve { mergeTareaCore, mergeTareaToMaster }.
 */
export function createMergeEngine(deps) {
  const {
    spawnSync = nodeSpawnSync,
    readTarea, resolveRepo, markBrought, markEnMaster, markError, runReviewer,
    log = () => {}, errlog = () => {},
  } = deps;

  // El corazón determinista del cierre de UNA tarea.
  async function mergeTareaCore(tareaId) {
    const tarea = readTarea(tareaId);
    if (!tarea) return { ok: false, error: 'tarea no encontrada' };
    const repo = resolveRepo(tarea);

    const delta = worktreeFullDeltaPatch(spawnSync, tarea);
    if (!delta.ok) { markError(tareaId, delta.error); return { ok: false, error: delta.error }; }
    if (delta.empty) {
      markBrought(tareaId);
      return { ok: true, empty: true, message: 'El build no dejó ningún cambio.' };
    }

    const ap = applyPatchToLive(spawnSync, repo, delta.patch);
    if (ap.incompatible) {
      const msg = 'el build no encaja con el árbol actual (base incompatible)';
      markError(tareaId, msg);
      return { ok: false, incompatible: true, error: msg };
    }

    if (ap.applied) {
      markBrought(tareaId);   // vivió en el arbolito antes de subir
      const cm = commitLiveToMaster(spawnSync, repo, tarea);
      if (!cm.ok) { markError(tareaId, cm.error); return { ok: false, error: cm.error }; }
      markEnMaster(tareaId, cm.commit);
      log(`tarea ${tareaId} → EN MASTER (commit ${cm.commit ? cm.commit.slice(0, 8) : '?'}).`);
      return { ok: true, enMaster: true, repo, commit: cm.commit };
    }

    // CONFLICTO → revisor + reintento con tope.
    markBrought(tareaId);
    let ficheros = ap.ficheros;
    for (let intento = 1; intento <= MERGE_MAX_REINTENTOS; intento++) {
      log(`tarea ${tareaId}: conflicto al subir a master, revisor intento ${intento}/${MERGE_MAX_REINTENTOS}.`);
      await runReviewer({ tarea, repo, ficheros });
      ficheros = listConflictFiles(spawnSync, repo);   // verificación determinista
      if (!ficheros.length) {
        const cm = commitLiveToMaster(spawnSync, repo, tarea);
        if (!cm.ok) { markError(tareaId, cm.error); return { ok: false, error: cm.error }; }
        markEnMaster(tareaId, cm.commit);
        log(`tarea ${tareaId} → EN MASTER tras revisor (intento ${intento}).`);
        return { ok: true, enMaster: true, repo, commit: cm.commit, intentos: intento };
      }
    }
    const msg = `el revisor no resolvió el conflicto tras ${MERGE_MAX_REINTENTOS} intentos`;
    markError(tareaId, msg);
    errlog(`tarea ${tareaId}: ${msg}. Queda en ERROR.`);
    return { ok: false, error: msg, agotado: true };
  }

  // El MUTEX: una cadena de promesas serializa los merges (uno commitea a la vez).
  let mergeQueue = Promise.resolve();
  function mergeTareaToMaster(tareaId) {
    const run = mergeQueue.then(() => mergeTareaCore(tareaId), () => mergeTareaCore(tareaId));
    mergeQueue = run.then(() => {}, () => {});   // la cola avanza pase lo que pase
    return run;
  }

  return { mergeTareaCore, mergeTareaToMaster };
}
