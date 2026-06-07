// scripts/lib/target.js — where the machinery aims.
//
// The forge (this repo, github.com/tieblumer/neblla-forge.git) is the reusable
// build machinery; the PRODUCT it builds lives under `project/` and is its OWN
// git repo (github.com/tieblumer/neblla.git). Every operation the machinery
// performs — git add/commit/push, `node tests/run.js`, version bump, changelog,
// sprint state, sandbox worktrees (which get dirtied AND branch-deleted) — must
// land on the PRODUCT, never on the forge. So every script resolves its target
// root through here instead of `path.resolve(__dirname, '..')` (which would be
// the forge, the wrong repo).
//
// Resolution order:
//   1. NEBLLA_PROJECT_ROOT (explicit override — used by the machinery's own
//      tests to point back at a throwaway/forge root, and by anyone who relocates
//      the product).
//   2. <forge>/project  — the default after the forge/product split, when it
//      looks like a real project (has a package.json).
//   3. <forge>          — fallback: no project/ checkout present, so operate in
//      place (self-hosted machinery, or a fresh clone before the product lands).

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/lib/target.js → ../../ is the forge root.
export const FORGE_ROOT = path.resolve(__dirname, '..', '..');

export function resolveProjectRoot() {
  const override = process.env.NEBLLA_PROJECT_ROOT;
  if (override && override.trim()) return path.resolve(override.trim());

  // ── FASE DE PRUEBA (2026-06-05): la maquinaria SE AUTO-HOSPEDA en el forge ──────
  // Mientras validamos la nueva estructura forge/ (forge/backbone · forge/sprint ·
  // forge/tests), la maquinaria apunta al PROPIO forge y NUNCA al producto, para no
  // tocar project/. Para RESTAURAR el objetivo-producto cuando la estructura esté
  // probada: borra este `return` (o exporta NEBLLA_PROJECT_ROOT=./project) y deja que
  // siga el bloque comentado de abajo.
  return FORGE_ROOT;

  /* // objetivo-producto — restaurar cuando la estructura forge/ esté validada:
  const candidate = path.join(FORGE_ROOT, 'project');
  try {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  } catch { // fall through to self
  }
  return FORGE_ROOT;
  */
}

// Resolved once at import. Scripts that mutate the env mid-process (the tests)
// load fresh module instances, so each sees the env in force at its import.
export const PROJECT_ROOT = resolveProjectRoot();
