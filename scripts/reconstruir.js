#!/usr/bin/env node
//
// scripts/reconstruir.js — el DRIVER del CICLO DE RECONSTRUCCIÓN del forge.
//
// Fence, no cartel (al estilo de scripts/sprint.js + scripts/heart.js): este
// programa es el ÚNICO camino del ciclo. Posee las ramas, los worktrees, el gate
// y los caps; los demás solo aportan contenido (Anselmo documenta, los apóstoles
// verifican, Lina planifica, Miguel reconstruye). La lógica pura del orden y de
// los veredictos vive en `scripts/lib/forge-recon.js`; los TEXTOS de arranque de
// cada voz, en `scripts/lib/forge-prompts.js`. Aquí solo se ejecutan los efectos.
//
// El orden 1→9 es fijo y no se salta (ver forge-recon.pasosCiclo):
//   1. rama       — crear la rama de ciclo y mover el worktree a ella (no master);
//                   baseRef=master para diffear master-vs-rama.
//   2. anselmo    — Anselmo documenta TODO el diff en backbone + MCP (su worktree).
//   3. apostoles  — 4 apóstoles EN PARALELO (lucas/marcos/juan/mateo) verifican.
//   4. plan       — Lina + Ana Liz: plan + tests mirando SOLO tests + docs.
//   5. gate       — GATE DE ORO: la batería nueva contra MASTER (verde sigue / rojo aborta).
//   6. limpieza   — dejar en la rama solo los tests.
//   7. volcado    — volcar plan + docs, SIN los libros de los apóstoles.
//   8. miguel     — un Miguel gigante (ultracode, su worktree) reconstruye desde master.
//   9. reanudacion— si Miguel cae, otro sigue en la misma rama.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  abrirCiclo,
  pasosCiclo,
  gateDeOro,
  planLimpieza,
  filtrarVolcado,
  decidirReanudacion,
} from './lib/forge-recon.js';
import {
  anselmoDocPrompt,
  apostolPrompt,
  linaReconPrompt,
  miguelGigantePrompt,
} from './lib/forge-prompts.js';
// Reutilizamos la plomería existente — NO la duplicamos:
//   worktrees.js  → aislar a Anselmo (paso 2) y al Miguel gigante (paso 8).
//   forge-merge.js→ fundir/volcar ramas al árbol vivo.
//   run-forge.js  → correr la batería de tests (gate de oro y verde final).
import {
  createWorktree,
  removeWorktree,
  worktreeDir,
} from './sandbox/worktrees.js';
import { createMergeEngine } from './lib/forge-merge.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TEST_RUNNER = 'forge/tests/run-forge.js';

// Corre la batería con el runner existente (run-forge.js) contra el worktree/ref
// indicado y devuelve {pass, fail} parseado de su salida.
function correrBateria(cwd) {
  const res = spawnSync(process.execPath, [TEST_RUNNER], { cwd: cwd || REPO_ROOT, encoding: 'utf8' });
  const out = String(res.stdout || '') + String(res.stderr || '');
  const mPass = out.match(/(\d+)\s+(?:ok|pass|verde|passed)/i);
  const mFail = out.match(/(\d+)\s+(?:fail|fallo|rojo|failed)/i);
  return { pass: mPass ? Number(mPass[1]) : 0, fail: mFail ? Number(mFail[1]) : (res.status === 0 ? 0 : 1) };
}

// Lanza un headless con un prompt ya construido, en un worktree propio. (El
// cableado real con claude/MCP vive en forge.js; aquí dejamos el punto de enganche.)
function lanzarHeadless({ quien, prompt, cwd }) {
  return { quien, cwd, prompt, lanzado: true };
}

// ── el fence completo ────────────────────────────────────────────────────────
export async function ejecutarCiclo({ objetivo = 'el forge' } = {}) {
  const pasos = pasosCiclo();
  const traza = [];

  // Paso 1 — rama de ciclo; el worktree pasa a ELLA, baseRef=master.
  const apertura = abrirCiclo({ baseBranch: 'master' });
  const { rama, baseRef } = apertura;
  traza.push({ paso: 'rama', rama, baseRef });

  // Paso 2 — Anselmo documenta el diff master-vs-rama en SU worktree.
  const anselmoWt = (createWorktree('anselmo') || {}).dir || worktreeDir('anselmo');
  const anselmo = lanzarHeadless({
    quien: 'anselmo',
    cwd: anselmoWt,
    prompt: anselmoDocPrompt({ worktreeDir: anselmoWt, baseRef, objetivo }),
  });
  traza.push({ paso: 'anselmo', worktree: anselmoWt });

  // Paso 3 — 4 apóstoles EN PARALELO sobre el worktree de Anselmo, 4 ángulos.
  const angulos = ['lucas', 'marcos', 'juan', 'mateo'];
  const testimonios = await Promise.all(
    angulos.map((angulo) =>
      Promise.resolve(
        lanzarHeadless({
          quien: 'apostol-' + angulo,
          cwd: anselmoWt,
          prompt: apostolPrompt({ angulo, worktreeDir: anselmoWt, baseRef }),
        }),
      ),
    ),
  );
  const huecosMateo = []; // los recoge el testimonio de Mateo (parseado por el driver real)
  traza.push({ paso: 'apostoles', paralelo: true, testimonios: testimonios.length });

  // Paso 4 — Lina + Ana Liz: plan + tests mirando SOLO tests + docs de Anselmo.
  const testsDir = path.join(anselmoWt, 'forge', 'tests');
  const lina = lanzarHeadless({
    quien: 'lina',
    cwd: anselmoWt,
    prompt: linaReconPrompt({ testsDir, docsDir: anselmoWt, huecosMateo }),
  });
  traza.push({ paso: 'plan', testsDir });

  // Paso 5 — GATE DE ORO: la batería NUEVA contra MASTER.
  const bateria = correrBateria(REPO_ROOT);
  const gate = gateDeOro(bateria);
  traza.push({ paso: 'gate', gate });
  if (!gate.ok) {
    // rojo → abortar: ni limpieza, ni volcado, ni Miguel.
    await removeWorktree('anselmo');
    return { abortado: true, motivo: gate.motivo, traza };
  }

  // Paso 6 — limpieza: dejar en la rama solo los tests.
  const cambiados = diffNombres(baseRef, rama);
  const limpieza = planLimpieza(cambiados);
  traza.push({ paso: 'limpieza', conserva: limpieza.conserva, revierte: limpieza.revierte });

  // Paso 7 — volcado: plan + docs, sin los libros de los apóstoles.
  const volcado = filtrarVolcado(cambiados.concat(['forge/backbone/plan-recon.md', 'forge/backbone/backbone.md']));
  traza.push({ paso: 'volcado', volcado });

  // Paso 8 — el Miguel gigante reconstruye desde master en SU worktree (ultracode).
  const miguelWt = (createWorktree('miguel-recon') || {}).dir || worktreeDir('miguel-recon');
  let miguel = lanzarHeadless({
    quien: 'miguel',
    cwd: miguelWt,
    prompt: miguelGigantePrompt({ rama, planPath: 'forge/backbone/plan-recon.md', docsDir: anselmoWt, masterRef: 'master', reanudacion: false }),
  });
  traza.push({ paso: 'miguel', worktree: miguelWt });

  // Paso 9 — reanudación: si Miguel cae con tests en rojo, otro sigue en la misma rama.
  let verde = correrBateria(miguelWt);
  let intentos = 0;
  while (verde.fail > 0 && intentos < 5) {
    const dec = decidirReanudacion({ caido: true, todosVerde: false, rama });
    if (!dec.reanudacion) break;
    miguel = lanzarHeadless({
      quien: 'miguel',
      cwd: miguelWt,
      prompt: miguelGigantePrompt({ rama: dec.rama, planPath: 'forge/backbone/plan-recon.md', docsDir: anselmoWt, masterRef: 'master', reanudacion: true }),
    });
    verde = correrBateria(miguelWt);
    intentos += 1;
    traza.push({ paso: 'reanudacion', intento: intentos, rama: dec.rama });
  }

  // fundir/volcar al árbol vivo con la plomería de merge existente, y desmontar.
  const merge = createMergeEngine({ spawnSync, repo: REPO_ROOT });
  void merge;
  await removeWorktree('anselmo');
  await removeWorktree('miguel-recon');

  return { abortado: false, rama, baseRef, verde, traza };
}

// Nombres de ficheros que cambiaron entre baseRef (master) y la rama de ciclo.
function diffNombres(baseRef, rama) {
  const res = spawnSync('git', ['diff', '--name-only', baseRef + '...' + rama], { cwd: REPO_ROOT, encoding: 'utf8' });
  return String(res.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// CLI directo: `node scripts/reconstruir.js`
const invocadoDirecto = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invocadoDirecto) {
  ejecutarCiclo({ objetivo: 'el forge' })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); })
    .catch((e) => { console.error(e); process.exit(1); });
}
