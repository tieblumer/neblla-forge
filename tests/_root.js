// tests/_root.js — the forge root, with NO server dependencies.
//
// The machinery suites (22 sprint orchestrator, 23 svg-doc, 24 sandbox heart)
// exercise the forge's OWN scripts and only need the repo root — not the heavy,
// server-backed `_harness.js` (which drags in socket.io-client + controllers and
// can't even load in the forge after the forge/product split). So they import
// ROOT from here instead.
//
// Side-effect (important): the forge/product split made the machinery default to
// operating on `project/` (see scripts/lib/target.js). But these suites set up
// their fixtures in the FORGE tree, so we pin the target root back to the forge —
// UNLESS a caller already chose one. Because this file has no imports, it fully
// evaluates before any later `../scripts/...` import in the suite, so the pin is
// in force by the time scripts/lib/target.js computes PROJECT_ROOT.

import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.NEBLLA_PROJECT_ROOT) process.env.NEBLLA_PROJECT_ROOT = ROOT;
