// tests/26-forge-merge.test.js
//
// La diana del ÚLTIMO diente: el cierre de una tarea sube de verdad a MASTER.
// Suite que monta un repo git de VERDAD (init + worktree-rama con commit + cambios
// sueltos) y ejercita scripts/lib/forge-merge.js con el revisor MOCKEADO (jamás un
// `claude` real). Comprueba, empíricamente:
//   1. recoger-TODO: el delta captura un commit de la rama Y un cambio sin comitear
//      Y un fichero nuevo sin trackear → todo aterriza commiteado en master;
//   2. auto-cierre: tras el merge la tarea queda `enMaster` (✓), no en el arbolito;
//   3. cola/mutex: dos tareas que terminan a la vez commitean de una en una;
//   4. reintento: un conflicto que el revisor resuelve al 2º intento → en master;
//   5. error: un conflicto que el revisor NUNCA resuelve → ERROR tras 3 intentos.
//
// NO necesita servidor, ni Mongo, ni el launcher roto (tests/run.js). Se ejecuta
// directo:  node tests/26-forge-merge.test.js
//
// `needsServer = false` para cuando el launcher (futuro, sano) lo recoja.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createMergeEngine } from '../../scripts/lib/forge-merge.js';

export const needsServer = false;

// ── utilidades de git para el escenario ──────────────────────────────────────
function git(repo, args, opts = {}) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...opts });
}
function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'forge@test']);
  git(dir, ['config', 'user.name', 'forge-test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}
function write(repo, rel, content) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function read(repo, rel) {
  try { return fs.readFileSync(path.join(repo, rel), 'utf8'); } catch { return null; }
}
function head(repo) { return git(repo, ['rev-parse', 'HEAD']).stdout.trim(); }
function logCount(repo) { return git(repo, ['rev-list', '--count', 'HEAD']).stdout.trim(); }

// Un "store" en memoria que imita los setters del forge (markBrought/markEnMaster/
// markError) sobre objetos-tarea planos. El motor solo necesita estas manos.
function makeStore(tareas) {
  const byId = new Map(tareas.map((t) => [t.id, t]));
  return {
    readTarea: (id) => byId.get(id) || null,
    markBrought: (id) => { const t = byId.get(id); if (t) { t.brought = true; delete t.error; } },
    markEnMaster: (id, commit) => { const t = byId.get(id); if (t) { t.brought = true; t.enMaster = true; t.masterCommit = commit; delete t.error; } },
    markError: (id, msg) => { const t = byId.get(id); if (t) t.error = String(msg); },
  };
}

// Crea un repo "vivo" (master) en `base` + un worktree-rama con: un COMMIT, un
// cambio SIN comitear y un fichero NUEVO sin trackear. Devuelve { repo, wt, base, tarea }.
function scenarioWithCommitAndDirty(rootTmp, idSuffix) {
  const repo = path.join(rootTmp, 'live-' + idSuffix);
  initRepo(repo);
  write(repo, 'f.txt', 'a\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
  const base = head(repo);

  const wt = path.join(rootTmp, 'wt-' + idSuffix);
  git(repo, ['worktree', 'add', '-q', '-b', 'miguel/' + idSuffix, wt, base]);
  // (1) un COMMIT en la rama
  write(wt, 'f.txt', 'a\nb\n');
  git(wt, ['add', '-A']); git(wt, ['commit', '-qm', 'commit en la rama']);
  // (2) un cambio SIN comitear sobre un fichero trackeado
  write(wt, 'f.txt', 'a\nb\nc\n');
  // (3) un fichero NUEVO sin trackear
  write(wt, 'g.txt', 'nuevo\n');

  const tarea = { id: idSuffix, title: 'Tarea ' + idSuffix, worktree: wt, buildRepo: repo, base };
  return { repo, wt, base, tarea };
}

export async function run({ reporter: r }) {
  r.suite('26 — forge: cierre a master (traer-todo + commit, mutex, reintento)');
  const tmp = mkTmp('forge-merge-test-');

  try {
    // ── 1+2+3: recoger TODO + auto-cierre a master (sin conflicto) ─────────────
    {
      const s = scenarioWithCommitAndDirty(tmp, 'A');
      const store = makeStore([s.tarea]);
      let reviewerCalls = 0;
      const engine = createMergeEngine({
        ...store,
        resolveRepo: (t) => t.buildRepo,
        runReviewer: async () => { reviewerCalls++; },
      });
      const before = logCount(s.repo);
      const res = await engine.mergeTareaToMaster('A');

      r.ok('merge sin conflicto → ok+enMaster', res.ok === true && res.enMaster === true);
      r.eq('la tarea quedó enMaster (✓)', store.readTarea('A').enMaster, true);
      r.ok('NO se llamó al revisor (no había conflicto)', reviewerCalls === 0);
      // el commit a master subió el nº de commits en 1
      r.eq('hizo UN commit a master', String(Number(logCount(s.repo)) - Number(before)), '1');
      // recoger-TODO: el commit de la rama (b), el cambio suelto (c) y el fichero nuevo (g)
      r.eq('master tiene el COMMIT de la rama + el cambio suelto', read(s.repo, 'f.txt'), 'a\nb\nc\n');
      r.eq('master tiene el fichero NUEVO sin trackear', read(s.repo, 'g.txt'), 'nuevo\n');
      // el mensaje del commit referencia la tarea
      const msg = git(s.repo, ['log', '-1', '--pretty=%s']).stdout.trim();
      r.ok('el commit referencia la tarea (id+título)', msg.includes('A') && /tarea/i.test(msg));
    }

    // ── 4: cola/mutex — dos tareas a la vez commitean de una en una ────────────
    // Las dos pasan por el revisor (conflicto), que es el único punto async del
    // core. Si el mutex NO serializara, las dos invocaciones del revisor se
    // solaparían en su await; con mutex, nunca. Medimos el solape ahí.
    function conflictScenario(idSuffix) {
      const repo = path.join(tmp, 'live-' + idSuffix);
      initRepo(repo);
      write(repo, 'f.txt', 'l1\nl2\nl3\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
      const base = head(repo);
      const wt = path.join(tmp, 'wt-' + idSuffix);
      git(repo, ['worktree', 'add', '-q', '-b', 'miguel/' + idSuffix, wt, base]);
      write(wt, 'f.txt', 'l1\nBUILD\nl3\n');
      write(repo, 'f.txt', 'l1\nMASTER\nl3\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'div']);
      return { repo, wt, tarea: { id: idSuffix, title: 'T ' + idSuffix, worktree: wt, buildRepo: repo, base } };
    }
    {
      const s1 = conflictScenario('Q1');
      const s2 = conflictScenario('Q2');
      const store = makeStore([s1.tarea, s2.tarea]);
      let activos = 0, maxSolape = 0;
      const engine = createMergeEngine({
        ...store,
        resolveRepo: (t) => t.buildRepo,
        // el revisor es el punto async del core: medimos solape alrededor de su await
        // y, de paso, resolvemos el conflicto (escribimos la versión del build).
        runReviewer: async ({ repo: rp }) => {
          activos++; maxSolape = Math.max(maxSolape, activos);
          await new Promise((ok) => setTimeout(ok, 15)); // ventana para detectar carrera
          write(rp, 'f.txt', 'l1\nBUILD\nl3\n');
          activos--;
        },
      });
      const [rA, rB] = await Promise.all([engine.mergeTareaToMaster('Q1'), engine.mergeTareaToMaster('Q2')]);
      r.ok('ambas llegaron a master', rA.ok && rB.ok && rA.enMaster && rB.enMaster);
      r.eq('NUNCA dos merges a la vez (mutex serializa)', maxSolape, 1);
      r.ok('cada repo tiene su commit limpio', read(s1.repo, 'f.txt') === 'l1\nBUILD\nl3\n' && read(s2.repo, 'f.txt') === 'l1\nBUILD\nl3\n');
    }

    // ── 5: conflicto resuelto al 2º intento → enMaster ─────────────────────────
    {
      // master diverge del build: el mismo fichero cambia distinto en cada lado →
      // el apply --3way deja MARCADORES de conflicto, y el revisor los limpia.
      const repo = path.join(tmp, 'live-conf');
      initRepo(repo);
      write(repo, 'f.txt', 'linea1\nlinea2\nlinea3\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
      const base = head(repo);
      const wt = path.join(tmp, 'wt-conf');
      git(repo, ['worktree', 'add', '-q', '-b', 'miguel/conf', wt, base]);
      // build cambia linea2 → BUILD
      write(wt, 'f.txt', 'linea1\nBUILD\nlinea3\n');
      // master (vivo) cambia linea2 → MASTER (divergencia incompatible en la misma línea)
      write(repo, 'f.txt', 'linea1\nMASTER\nlinea3\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'cambio en master']);

      const tarea = { id: 'C', title: 'Conflicto', worktree: wt, buildRepo: repo, base };
      const store = makeStore([tarea]);
      let intentos = 0;
      const engine = createMergeEngine({
        ...store,
        resolveRepo: (t) => t.buildRepo,
        // revisor MOCK: falla el 1º intento (deja los marcadores), resuelve el 2º
        // (reescribe el fichero limpio = la versión del build).
        runReviewer: async ({ repo: rp }) => {
          intentos++;
          if (intentos >= 2) write(rp, 'f.txt', 'linea1\nBUILD\nlinea3\n');
        },
      });
      const res = await engine.mergeTareaToMaster('C');
      r.ok('hubo conflicto → entró el revisor', intentos >= 1);
      r.ok('resuelto al 2º intento → ok+enMaster', res.ok === true && res.enMaster === true);
      r.eq('necesitó 2 intentos', res.intentos, 2);
      r.eq('master quedó con la versión limpia (sin marcadores)', read(repo, 'f.txt'), 'linea1\nBUILD\nlinea3\n');
      r.ok('no quedan marcadores de conflicto', !/^<<<<<<< /m.test(read(repo, 'f.txt') || ''));
      r.eq('la tarea quedó enMaster', store.readTarea('C').enMaster, true);
    }

    // ── 6: conflicto IRRESOLUBLE → ERROR (✕) tras 3 intentos ──────────────────
    {
      const repo = path.join(tmp, 'live-err');
      initRepo(repo);
      write(repo, 'f.txt', 'x1\nx2\nx3\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
      const base = head(repo);
      const wt = path.join(tmp, 'wt-err');
      git(repo, ['worktree', 'add', '-q', '-b', 'miguel/err', wt, base]);
      write(wt, 'f.txt', 'x1\nBUILD\nx3\n');
      write(repo, 'f.txt', 'x1\nMASTER\nx3\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'cambio en master']);

      const tarea = { id: 'E', title: 'Irresoluble', worktree: wt, buildRepo: repo, base };
      const store = makeStore([tarea]);
      let intentos = 0;
      const engine = createMergeEngine({
        ...store,
        resolveRepo: (t) => t.buildRepo,
        runReviewer: async () => { intentos++; /* nunca limpia los marcadores */ },
      });
      const res = await engine.mergeTareaToMaster('E');
      r.ok('agotó los reintentos', res.ok === false && res.agotado === true);
      r.eq('exactamente 3 intentos (tope)', intentos, 3);
      r.ok('la tarea quedó en ERROR (✕)', !!store.readTarea('E').error);
      r.ok('NO quedó enMaster', !store.readTarea('E').enMaster);
    }

    // ── 7: worktree sin cambios → "empty", no commitea, no error ───────────────
    {
      const repo = path.join(tmp, 'live-empty');
      initRepo(repo);
      write(repo, 'f.txt', 'z\n');
      git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
      const base = head(repo);
      const wt = path.join(tmp, 'wt-empty');
      git(repo, ['worktree', 'add', '-q', '-b', 'miguel/empty', wt, base]);
      const tarea = { id: 'Z', title: 'Vacía', worktree: wt, buildRepo: repo, base };
      const store = makeStore([tarea]);
      const before = logCount(repo);
      const engine = createMergeEngine({ ...store, resolveRepo: (t) => t.buildRepo, runReviewer: async () => {} });
      const res = await engine.mergeTareaToMaster('Z');
      r.ok('sin cambios → ok+empty', res.ok === true && res.empty === true);
      r.eq('no añadió ningún commit', logCount(repo), before);
      r.ok('no marcó error', !store.readTarea('Z').error);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── ejecución directa (el launcher tests/run.js está roto: socket.io-client) ──
// Un reporter mínimo para correr standalone:  node tests/26-forge-merge.test.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('26-forge-merge.test.js')) {
  const rep = {
    passed: 0, failed: 0,
    suite(n) { console.log('\n━━ ' + n); },
    ok(label, cond, detail) { cond ? (this.passed++, console.log('  ✓ ' + label)) : (this.failed++, console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''))); return cond; },
    eq(label, actual, expected) {
      const same = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
      same ? (this.passed++, console.log('  ✓ ' + label + ' = ' + JSON.stringify(expected)))
           : (this.failed++, console.log('  ✗ ' + label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)));
      return same;
    },
  };
  run({ reporter: rep }).then(() => {
    console.log(`\n${rep.passed + rep.failed} checks   ${rep.passed} passed   ${rep.failed} failed`);
    process.exit(rep.failed ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
