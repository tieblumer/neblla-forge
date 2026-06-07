// tests/run-forge.js
//
// El lanzador de tests DEL FORGE. Hermano de run.js pero SIN Mongo, sin servidor,
// sin _harness.js (que arrastra socket.io-client + controllers/* del producto, que
// no viven en el forge). Corre las suites PURAS: las que exportan
//   export const needsServer = false;
//   export async function run({ reporter }) { ... }
//
// Uso:
//   node tests/run-forge.js                  todas las suites puras
//   node tests/run-forge.js 27 28            solo las suites cuyo fichero case con esos tokens
//   node tests/run-forge.js --only 27,28     igual (filtro por SUITE; el filtro fino por id de test queda para más adelante)
//   node tests/run-forge.js --json           imprime al final una línea JSON con {results,totals}
//
// Sale con código 1 si algún check falla, 0 si todo verde.

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Reporter } from './_reporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const json = argv.includes('--json');
// --only <csv>  o tokens sueltos (27 28) → filtro a nivel de SUITE (nombre de fichero).
let only = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--only') { only.push(...String(argv[++i] || '').split(',')); continue; }
  if (a.startsWith('--')) continue;
  only.push(...a.split(','));
}
only = only.map((s) => s.trim()).filter(Boolean);

function discover() {
  let files = [];
  try { files = fs.readdirSync(__dirname); } catch { return []; }
  return files
    .filter((f) => /\.test\.js$/.test(f))
    .filter((f) => !only.length || only.some((t) => f.includes(t)))
    .sort()
    .map((f) => path.join(__dirname, f));
}

const reporter = new Reporter();
const perSuite = [];   // { suite, file, pass, fail, skip, error? }
const skippedImport = [];

for (const file of discover()) {
  const name = path.basename(file);
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    // suite que arrastra maquinaria que no vive en el forge (p.ej. _harness): se salta.
    skippedImport.push({ file: name, reason: (e && e.message) || String(e) });
    continue;
  }
  if (mod.needsServer !== false || typeof mod.run !== 'function') continue;   // no es una suite pura del forge

  const before = { pass: reporter.passed, fail: reporter.failed, skip: reporter.skipped };
  let error = null;
  try {
    await mod.run({ reporter });
  } catch (e) {
    // un throw fuera de los checks (p.ej. setup roto): cuéntalo como fallo de la suite.
    error = (e && (e.stack || e.message)) || String(e);
    reporter.fail(`[${name}] la suite lanzó fuera de un check`, e);
  }
  perSuite.push({
    suite: name,
    pass: reporter.passed - before.pass,
    fail: reporter.failed - before.fail,
    skip: reporter.skipped - before.skip,
    ...(error ? { error } : {}),
  });
}

reporter.summary();
if (skippedImport.length && !json) {
  console.log('\n\x1b[90m  Suites saltadas (no importables fuera del producto):\x1b[0m');
  for (const s of skippedImport) console.log(`\x1b[90m    ∅ ${s.file}\x1b[0m`);
}

if (json) {
  console.log(JSON.stringify({
    results: perSuite,
    totals: { pass: reporter.passed, fail: reporter.failed, skip: reporter.skipped },
    skippedImport,
  }));
}

process.exit(reporter.failed ? 1 : 0);
