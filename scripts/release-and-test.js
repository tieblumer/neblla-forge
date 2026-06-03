#!/usr/bin/env node
//
// scripts/release-and-test.js — one-shot "verify, THEN ship" pipeline.
//
// The gate runs BEFORE anything is exposed to the public: we boot the app
// locally and run the full backbone battery first. Only if it is green do we
// bump the version, commit, push and wait for the deploy. A bug therefore
// never reaches production — if a locally-testable feature is broken, the
// release aborts and nothing is published.
//
//   1. run the test suite  (node tests/run.js) against a locally-booted server
//      — this is the PRE-DEPLOY GATE.
//   2. on failure: save the full run output to .test-failure.log and hand it to
//      a headless Miguel-fix Claude (--allowedTools Read,Edit,Write,Bash) that
//      fixes the CODE (never the tests), then re-run the gate. Repeat until
//      green or NEBLLA_FIX_MAX_ATTEMPTS (default 5). Never greens → exit !=0
//      WITHOUT publishing. (--no-claude disables the loop: first red is fatal.)
//   3. on success: bump  public/version.txt  (a monotonically-increasing build
//      counter served publicly at  <prod>/version.txt ).
//   4. git add -A  →  commit  (short auto-generated message)  →  push.
//   5. poll  <prod>/version.txt  until it reports the new build number
//      (i.e. the deploy is live).
//   6. Otto: re-run the battery in REMOTE mode against the live prod URL
//      (NEBLLA_TEST_BASE_URL=<prod> → only the `remoteSafe` suites, no boot/no
//      Mongo). Local & prod SHARE the DB, so this is environment-only by design
//      (domains/CORS/web/SDK reachable). A prod failure → write a HOTFIX signal
//      (backbone/sprints/.hotfix-needed.json) and exit non-zero. NO auto-fix /
//      re-ship loop, NO auto-revert (CEO-locked): a human opens a hotfix sprint.
//
// Usage:
//   npm run release                         # gate (local battery) → ship → Otto
//   node scripts/release-and-test.js --no-deploy   # just run the local battery (the gate alone)
//   node scripts/release-and-test.js --no-wait     # gate → bump + commit + push (don't poll/Otto)
//   node scripts/release-and-test.js --no-claude   # don't auto-fix on a failure (manual escape hatch)
//   node scripts/release-and-test.js --skip-heavy  # pause load-heavy checks (capacity lever)
//   (env equivalent: NEBLLA_TEST_SKIP_HEAVY=1)
//
// Env:
//   NEBLLA_PROD_URL          base URL of the deployed site   (default: https://neblla.com)
//   NEBLLA_DEPLOY_TIMEOUT_MS how long to wait for the deploy (default: 600000 = 10m)
//   NEBLLA_DEPLOY_POLL_MS    poll interval                   (default: 10000 = 10s)
//   NEBLLA_FIX_MAX_ATTEMPTS  Miguel-fix swings at a red local gate (default: 5)

import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT } from './lib/target.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ROOT = the PRODUCT we build/release (project/), NOT the forge this script lives
// in. Every git / `node tests/run.js` / version / changelog op below rides this.
const ROOT = PROJECT_ROOT;
const VERSION_FILE = path.join(ROOT, 'public', 'version.txt');
const FAILURE_LOG  = path.join(ROOT, '.test-failure.log');
const SPRINTS_DIR  = path.join(ROOT, 'backbone', 'sprints');
// Hotfix signal: when Otto (the from-outside prod re-check) fails after a deploy,
// we DON'T auto-fix-and-re-ship anymore — we drop this file and exit non-zero so
// a human (Iris) opens a `sprint open --hotfix` sprint. sprint.js prioritises a
// hotfix sprint and consumes this file when the hotfix is opened.
const HOTFIX_FILE  = path.join(SPRINTS_DIR, '.hotfix-needed.json');

const PROD_URL = (process.env.NEBLLA_PROD_URL || 'https://neblla.com').replace(/\/+$/, '');
const DEPLOY_TIMEOUT_MS = Number(process.env.NEBLLA_DEPLOY_TIMEOUT_MS || 10 * 60 * 1000);
const POLL_MS = Number(process.env.NEBLLA_DEPLOY_POLL_MS || 10 * 1000);

// Bounded auto-fix loop: how many times the headless Miguel-fix Claude may take
// a swing at a red local gate before we give up (and exit non-zero WITHOUT
// publishing). Default 5 (CEO-locked, sprint montar-la-maquina).
const FIX_MAX_ATTEMPTS = Math.max(1, Number(process.env.NEBLLA_FIX_MAX_ATTEMPTS || 5));

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const NO_DEPLOY = has('--no-deploy');
const NO_WAIT   = has('--no-wait') || NO_DEPLOY;
const NO_CLAUDE = has('--no-claude');
const NO_ANSELMO = has('--no-anselmo');
// Capacity lever: pause load-heavy checks so the gate can't topple a shared DB
// that's near capacity. Flows to `node tests/run.js` via the inherited env.
if (has('--skip-heavy') || has('--light')) process.env.NEBLLA_TEST_SKIP_HEAVY = '1';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const log = (...m) => console.log(...m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// run a git command, capture stdout (throws on non-zero)
function git(a, { inherit = false } = {}) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'] });
}

// ── version helpers ──────────────────────────────────────────────────────────
// Peek the NEXT build number without writing it — so a failed gate leaves the
// working tree untouched (no skipped build numbers, nothing to revert).
function peekNextVersion() {
  let cur = 0;
  try { cur = parseInt(String(fs.readFileSync(VERSION_FILE, 'utf8')).trim(), 10) || 0; } catch { /* no file yet */ }
  return cur + 1;
}
// Commit the bump to disk — only ever called AFTER the gate is green.
function writeVersion(next) {
  fs.mkdirSync(path.dirname(VERSION_FILE), { recursive: true });
  fs.writeFileSync(VERSION_FILE, String(next) + '\n');
}

// ── 3. poll the deployed /version.txt ───────────────────────────────────────
async function waitForDeploy(expected) {
  const base = `${PROD_URL}/version.txt`;
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  let lastReport = Symbol('init');
  while (Date.now() < deadline) {
    let body = null;
    try {
      const res = await fetch(`${base}?_=${Date.now()}`, { headers: { 'cache-control': 'no-cache', pragma: 'no-cache' } });
      if (res.ok) body = (await res.text()).trim();
    } catch { /* network blip — keep polling */ }
    if (body !== lastReport) { lastReport = body; log(`  [${new Date().toLocaleTimeString()}]  ${base}  →  ${body === null ? '(unreachable)' : body}  (want ${expected})`); }
    if (body === String(expected)) return true;
    await sleep(POLL_MS);
  }
  return false;
}

// ── 4. run the test suite ───────────────────────────────────────────────────
function runTests() {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, ['tests/run.js'], { cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (b) => { const s = b.toString(); out += s; process.stdout.write(s); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ code: 1, out: out + `\n[spawn error] ${e.message}\n` }));
    child.on('exit', (code) => resolve({ code: code == null ? 1 : code, out }));
  });
}

// ── helpers shared by the gate + fix loop ────────────────────────────────────
// Persist the full failed-run output for the headless fixer to read, keeping
// the explanatory header block that names the would-be build + when + command.
function writeFailureLog({ version, code, out, context = 'node tests/run.js  (local boot)' }) {
  const header =
    `# Pre-deploy gate FAILED — nothing was committed or pushed.\n` +
    `# would-be build:  ${version}\n` +
    `# when:            ${new Date().toISOString()}\n` +
    `# command:         ${context}\n` +
    `# exit code:       ${code}\n` +
    `#\n# ↓ full output below ↓\n\n`;
  fs.writeFileSync(FAILURE_LOG, header + stripAnsi(out));
}

// ── Miguel-fix: the headless auto-fixer (LOCAL gate only) ────────────────────
// A dedicated headless Claude (role "Miguel", see CLAUDE.md → Empleados) reads
// .test-failure.log, diagnoses, and FIXES THE CODE (never the tests). Unlike
// Anselmo this is NOT best-effort: if `claude` is missing or errors, we THROW —
// the machine must not pretend a red gate got handled. He may iterate with
// `node tests/run.js <filtro>`, but he does NOT commit/push and does NOT bump
// the version; the release machine re-runs the full battery after he's done.
// He only ever fixes the LOCAL pre-deploy gate now — an Otto (prod) failure no
// longer calls him; it drops a hotfix signal instead (CEO decision).
function runMiguelFix({ version, attempt, maxAttempts }) {
  const where = 'La PUERTA pre-deploy (batería local) acaba de fallar ANTES de publicar — no se ha commiteado ni pusheado nada, el público no vio el bug. ';
  const prompt =
    `Eres Miguel (ver la seccion "Empleados" de CLAUDE.md): el lider de implementacion, en modo headless de arreglo. ` +
    where +
    `Intento ${attempt} de ${maxAttempts}. ` +
    `1) Lee el fichero .test-failure.log en la raiz del repo: contiene la salida COMPLETA del run que fallo (node tests/run.js — la bateria del backbone + contract + protocol + infra + externalDb + el resto). ` +
    `2) Diagnostica el/los fallos y ARREGLA EL CODIGO. Nunca falsees la diana: NO toques los tests para que pasen, NO bajes asserts, NO marques skips para esconder el fallo. El objetivo es que el comportamiento real sea correcto. ` +
    `3) Para iterar puedes ejecutar "node tests/run.js <filtro>" (p.ej. node tests/run.js 02) cuantas veces necesites. La suite vive en tests/ (ver tests/README.md). ` +
    `4) NO hagas commit ni push, NO toques public/version.txt, NO toques el CHANGELOG ni el BACKLOG. ` +
    `Termina cuando creas que esta arreglado: la maquina volvera a correr la bateria completa para comprobarlo.`;

  log(`\n→ Miguel-fix (headless): attempt ${attempt}/${maxAttempts} on the local gate failure…\n`);
  const allowed = 'Read,Edit,Write,Bash';
  // Spawn claude with an ARGUMENT ARRAY and NO shell on every platform. claude is
  // a real executable on the PATH (Node's spawn resolves it), so each arg is
  // passed verbatim — no cmd.exe in the loop to mangle the prompt's `<filtro>`
  // (input redirection), `(...)`, or other metacharacters. (A previous win32
  // shell:true branch piped the whole prompt through cmd /c and broke on those.)
  const r = spawnSync('claude', ['-p', prompt, '--allowedTools', allowed], { cwd: ROOT, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  // PROPAGATE failures — the fix loop is not allowed to swallow them.
  if (r.error) throw new Error(`could not run Miguel-fix (\`claude\`): ${r.error.message}`);
  if (typeof r.status === 'number' && r.status !== 0) throw new Error(`Miguel-fix (\`claude\`) exited ${r.status}`);
  log('→ Miguel-fix: returned. Re-running the battery to verify.');
}

// ── Otto: the from-outside prod re-check ─────────────────────────────────────
// After the deploy is confirmed live, re-run the battery in REMOTE mode against
// the real prod URL: NEBLLA_TEST_BASE_URL=<prod> makes tests/run.js skip boot +
// Mongo and run ONLY the `remoteSafe` suites (env/CORS/web/SDK reachability).
// Local & prod SHARE the DB, so this is environment-only by design.
function runOtto() {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, ['tests/run.js'], {
      cwd: ROOT,
      env: { ...process.env, NEBLLA_TEST_BASE_URL: PROD_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (b) => { const s = b.toString(); out += s; process.stdout.write(s); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ code: 1, out: out + `\n[spawn error] ${e.message}\n` }));
    child.on('exit', (code) => resolve({ code: code == null ? 1 : code, out }));
  });
}

// ── sprint frontmatter helpers (shared by the in-doc receipt + the sweep) ────
// Minimal YAML-ish frontmatter reader/writer — same shape as scripts/sprint.js,
// kept tiny and local so the release machine has no dependency on the director.
function readSprintFrontmatter(file) {
  let md;
  try { md = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim();
  }
  return { md, fm };
}

// ── C1: write the release receipt INTO the releasing sprint's own .md ────────
// After Otto goes green we stamp `## Recibo de release\n- build <n> — <iso>` into
// the .md of the sprint currently in `status: releasing`. scripts/sprint.js
// (`cierre`) reads THIS section from THAT sprint to close it. No shared
// `.release-ok`: each sprint carries its own receipt, so a stale cross-sprint
// receipt can never close a new sprint. Best-effort: if no releasing sprint is
// found (a release outside the sprint flow), we just log and move on.
function writeReceiptToReleasingSprint(version) {
  let files = [];
  try { files = fs.readdirSync(SPRINTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md'); } catch { return; }
  const releasing = files.filter(f => {
    const r = readSprintFrontmatter(path.join(SPRINTS_DIR, f));
    return r && (r.fm.status || '') === 'releasing';
  });
  if (releasing.length === 0) { log(`• receipt: no sprint in 'releasing' — skipping the in-doc receipt (release outside the sprint flow).`); return; }
  if (releasing.length > 1) log(`• receipt: more than one 'releasing' sprint (${releasing.join(', ')}); stamping all.`);
  const stamp = `build ${version}`;
  const iso = new Date().toISOString();
  for (const f of releasing) {
    const file = path.join(SPRINTS_DIR, f);
    let md;
    try { md = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const section = `## Recibo de release\n- ${stamp} — ${iso} — Otto OK desde fuera contra prod.\n`;
    // Replace an existing receipt section, or append a fresh one at EOF.
    if (/^##\s+Recibo de release\b/m.test(md)) {
      md = md.replace(/^##\s+Recibo de release[\s\S]*?(?=^##\s|\Z)/m, section + '\n');
    } else {
      if (!md.endsWith('\n')) md += '\n';
      md += '\n' + section;
    }
    try { fs.writeFileSync(file, md); log(`• receipt: stamped "${stamp}" into ${path.relative(ROOT, file)} (## Recibo de release).`); }
    catch (e) { log(`• receipt: could not write ${path.relative(ROOT, file)}: ${e.message}`); }
  }
}

// ── C4: lazily sweep CLOSED sprints out of backbone/sprints/ ─────────────────
// Inside Anselmo's pass (before his final git-add), delete the .md (and its
// .state.json sidecar) of any sprint in `status: done` — but ONLY if the .md is
// git-tracked AND clean (tracked by `git ls-files` AND not showing in
// `git status --porcelain`). Untracked or modified → SKIP (no loss). NEVER
// touches README.md, a sprint that isn't done, or the one in `releasing`. Lazy:
// the just-closed sprint is swept on the NEXT release, not this one.
function gitTrackedAndClean(relPath) {
  try {
    const tracked = git(['ls-files', '--', relPath]).trim();
    if (!tracked) return false;                       // untracked → skip
    const dirty = git(['status', '--porcelain', '--', relPath]).trim();
    return dirty === '';                              // any pending change → skip
  } catch { return false; }                           // git error → conservative skip
}

function sweepDoneSprints() {
  let files = [];
  try { files = fs.readdirSync(SPRINTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md'); } catch { return; }
  for (const f of files) {
    const file = path.join(SPRINTS_DIR, f);
    const r = readSprintFrontmatter(file);
    if (!r || (r.fm.status || '') !== 'done') continue;   // only done sprints
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (!gitTrackedAndClean(rel)) { log(`• sweep: '${f}' is done but untracked/modified — skipping (no loss).`); continue; }
    // Safe to remove: tracked + clean. Drop the .md and its ephemeral sidecar.
    try { fs.unlinkSync(file); } catch {}
    const sidecar = file.replace(/\.md$/, '.state.json');
    try { fs.unlinkSync(sidecar); } catch {}
    try { git(['add', '-A', '--', rel]); } catch (e) { log(`• sweep: git add failed for ${rel}: ${e.message}`); }
    log(`• sweep: removed closed sprint ${rel} (tracked + clean).`);
  }
}

// ── C2: non-blocking coherence advisory for Iris ─────────────────────────────
// Anselmo additionally reviews docs/BACKLOG-vs-code coherence. If he finds a real
// contradiction he writes an ADVISORY into the session signal (a small file Iris's
// greeting reads) — but he NEVER stops the release. Anselmo writes
// backbone/sprints/.coherence-advisory.md himself when he finds one; we stage it.
const COHERENCE_ADVISORY = path.join(SPRINTS_DIR, '.coherence-advisory.md');

// ── Anselmo: the changelog scribe (+ non-blocking coherence + sweep) ─────────
// A dedicated headless Claude (role "Anselmo", see CLAUDE.md → Empleados) turns
// backbone/release-pending.md into CHANGELOG entries right before the commit, AND
// (non-blocking) flags any docs/BACKLOG-vs-code contradiction for Iris, AND
// sweeps already-closed sprints. BEST-EFFORT: any failure (claude missing, error,
// timeout) is logged and the release proceeds — the scribe must NEVER block a
// deploy. If he's skipped, the pending notes simply wait for the next release.

// Cheap guard: is there anything for Anselmo to do? (a pending changelog note.)
// Note: even with no changelog note, his sweep + coherence pass still run — see
// runAnselmo, which always sweeps and (if claude is available) reviews coherence.
function hasAnselmoWork() {
  try {
    const pending = fs.readFileSync(path.join(ROOT, 'backbone', 'release-pending.md'), 'utf8');
    if (/^\s*-\s*\[(public|internal)\]/m.test(pending)) return true;
  } catch {}
  return false;
}

function runAnselmo(version) {
  if (NO_ANSELMO) { log('• --no-anselmo: skipping the changelog scribe'); return; }

  // The sweep is deterministic code (no claude) — always run it, even when there
  // is no changelog note to write. It's git-safe (tracked+clean only) so it can
  // never lose work.
  sweepDoneSprints();

  if (!hasAnselmoWork()) { log('• Anselmo: no changelog note pending — skipping the scribe (sweep already done).'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const advisoryRel = path.relative(ROOT, COHERENCE_ADVISORY).replace(/\\/g, '/');
  const prompt =
    `Eres Anselmo (ver la seccion "Empleados" de CLAUDE.md): haz SOLO tu tarea, en silencio, sin responder con texto. ` +
    `Estamos en "npm run release", build ${version}, fecha ${today}. ` +
    `1) Lee backbone/release-pending.md. ` +
    `2) Convierte cada nota pendiente en una entrada formateada al principio de la lista de backbone/CHANGELOG.md, siguiendo el formato de su cabecera, con el release "build ${version}" y fecha ${today}. (NO toques las lineas "[unreleased]" antiguas que ya esten en el fichero.) ` +
    `3) Las notas marcadas [public] anhadelas ademas a public/changelog.md, en una nueva seccion "## Build ${version} — ${today}" al principio, en prosa para devs externos, SIN nada interno ni sensible. ` +
    `4) Vacia backbone/release-pending.md dejando solo su cabecera (hasta el "---"). ` +
    `5) REVISION DE COHERENCIA (no bloqueante): comprueba si la documentacion (docs) y backbone/BACKLOG.md contradicen al codigo real en algo importante. Si encuentras UNA contradiccion real (no estetica), escribe un AVISO breve para Iris en ${advisoryRel} (crealo si no existe): que contradice, donde, y por que. Si no hay contradiccion clara, NO crees ese fichero (y si existe de un release anterior, borralo). Esto NUNCA para el release: solo deja la nota. ` +
    `No toques codigo ni el BACKLOG. Si no hay nada pendiente en el paso 1, salta al paso 5.`;

  log(`• Anselmo: writing the changelog from release-pending.md (+ coherence advisory)…`);
  try {
    const allowed = 'Read,Edit,Write';
    // Same as Miguel-fix: ARRAY of args, NO shell on any platform, so cmd.exe
    // never sees (and mangles) the prompt's metacharacters on win32.
    const r = spawnSync('claude', ['-p', prompt, '--allowedTools', allowed], { cwd: ROOT, stdio: 'inherit', timeout: 5 * 60 * 1000 });
    if (r.error) throw r.error;
    if (typeof r.status === 'number' && r.status !== 0) throw new Error(`claude exited ${r.status}`);
    if (fs.existsSync(COHERENCE_ADVISORY)) log(`• Anselmo: left a coherence advisory for Iris → ${path.relative(ROOT, COHERENCE_ADVISORY)} (non-blocking).`);
    log('• Anselmo: done.');
  } catch (e) {
    log(`• Anselmo skipped (non-fatal — pending notes kept for next release): ${e.message}`);
  }
}

// ── the local pre-deploy gate, with the bounded auto-fix loop ────────────────
// Runs the full local battery. While it is red, hand .test-failure.log to a
// headless Miguel-fix and re-run — up to FIX_MAX_ATTEMPTS. Returns true only on
// a green battery. The INVARIANT the caller relies on: ship code is reachable
// ONLY after this returns true. With --no-claude there is no loop — the first
// red is fatal (the manual escape hatch).
//
// `version` is the build this run WOULD carry — used only to stamp the failure
// log header; nothing is written to disk here.
async function gateUntilGreen(version) {
  for (let attempt = 1; ; attempt++) {
    log('\n━━ pre-deploy gate: local battery (node tests/run.js) ━━━━━━━━━\n');
    const { code, out } = await runTests();

    if (code === 0) {
      log(`\n✓ gate is green — local battery passed. Safe to ship.`);
      try { fs.unlinkSync(FAILURE_LOG); } catch {}
      return true;
    }

    writeFailureLog({ version, code, out });
    log(`\n✗ GATE FAILED (exit ${code}).  NOT publishing — the public never saw this.`);
    log(`  Full output → ${path.relative(ROOT, FAILURE_LOG)}`);

    // Manual escape hatch: no auto-fix, the first red ends the run non-zero.
    if (NO_CLAUDE) { log('• --no-claude: not auto-fixing. Read .test-failure.log and fix it yourself.'); return false; }

    if (attempt >= FIX_MAX_ATTEMPTS) {
      log(`\n✗ exhausted ${FIX_MAX_ATTEMPTS} auto-fix attempt(s) — gate still red. NOT publishing.`);
      return false;
    }

    // Hand off to the headless fixer; a launch/exec failure THROWS (the loop is
    // not best-effort) and bubbles to the top-level catch → exit 1.
    runMiguelFix({ version, attempt, maxAttempts: FIX_MAX_ATTEMPTS });
    // loop: re-run the full battery to confirm Miguel's fix.
  }
}

// ── ship one build: bump → Anselmo → commit → push ───────────────────────────
// Only ever called AFTER a green gate (the invariant). Returns the branch.
function shipBuild(version) {
  writeVersion(version);
  log(`• version bumped → ${version}   (${path.relative(ROOT, VERSION_FILE)})`);

  // Anselmo writes the changelog from release-pending.md BEFORE we stage, so his
  // edits ride this same commit. Best-effort — never blocks the release.
  runAnselmo(version);

  let branch = 'HEAD';
  try { branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(); } catch {}
  git(['add', '-A']);
  const dirty = git(['status', '--porcelain']).trim();
  if (!dirty) {
    log('• nothing to commit — skipping commit/push (will still wait for the current deploy)');
  } else {
    const msg = `chore: release build ${version}`;
    git(['commit', '-m', msg]);
    log(`• committed:  ${msg}`);
    try { git(['push', 'origin', branch], { inherit: true }); }
    catch (e) { log(`✗ git push failed: ${e.message}`); process.exit(1); }
    log(`• pushed → origin/${branch}`);
  }
  return branch;
}

// ── C3: write the hotfix signal when Otto fails ──────────────────────────────
// Otto (the from-outside prod re-check) failing means the deployed build is wrong
// from the outside even though the local gate was green. We DON'T auto-fix and
// re-ship anymore (CEO decision: no SHIP_MAX_ROUNDS, no scope:prod Miguel-fix).
// Instead we drop a hotfix signal and exit non-zero. A human (Iris) opens a
// `sprint open --hotfix` sprint; sprint.js prioritises it and consumes this file.
// NO auto-revert (CEO-locked).
function writeHotfixSignal({ version, otto }) {
  // Name the sprint that was in `releasing` (the one this release was shipping).
  let parent = null;
  try {
    const files = fs.readdirSync(SPRINTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md');
    const releasing = files.filter(f => { const r = readSprintFrontmatter(path.join(SPRINTS_DIR, f)); return r && (r.fm.status || '') === 'releasing'; });
    if (releasing.length) parent = releasing[0].replace(/\.md$/, '');
  } catch {}
  const ottoResumen = stripAnsi(otto.out || '').split('\n').filter(Boolean).slice(-12).join('\n');
  const payload = {
    sprint: parent,
    build: version,
    reason: `Otto (re-test desde fuera contra prod) falló con exit ${otto.code} tras el deploy del build ${version}.`,
    ottoResumen,
    at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(SPRINTS_DIR, { recursive: true });
    fs.writeFileSync(HOTFIX_FILE, JSON.stringify(payload, null, 2) + '\n');
    log(`• hotfix signal written → ${path.relative(ROOT, HOTFIX_FILE)} (Iris: abre un sprint con \`sprint open --hotfix --fixes ${parent || '<sprint>'}\`).`);
  } catch (e) {
    log(`• (could not write the hotfix signal ${path.relative(ROOT, HOTFIX_FILE)}: ${e.message})`);
  }
}

// Exported for the diana (tests/22) — pure, deterministic helpers it can drive
// without spawning the whole release. (No effect on the CLI behavior below.)
export { sweepDoneSprints, writeReceiptToReleasingSprint, writeHotfixSignal, gitTrackedAndClean, readSprintFrontmatter };

// ── main ────────────────────────────────────────────────────────────────────
// Only auto-runs when invoked as the program (node scripts/release-and-test.js);
// an `import` (the test) gets the exports without launching the pipeline.
const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return true; }
})();

async function main() {
  log('━━ release-and-test ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // One linear pass: gate → ship → deploy → Otto. The gate INVARIANT holds:
  // nothing is published until gateUntilGreen() returns true. An Otto failure no
  // longer loops (no auto-fix/re-ship) — it drops a hotfix signal and exits
  // non-zero for a human. NO auto-revert (CEO-locked).
  const version = peekNextVersion();
  log(`• next build would be → ${version}   (gate runs first; nothing is published until it is green)`);

  // ── 1. GATE (with the bounded auto-fix loop) ────────────────────────────────
  const green = await gateUntilGreen(version);
  if (!green) process.exit(1);   // never greened → nothing shipped, non-zero exit

  if (NO_DEPLOY) {
    log('• --no-deploy: gate only, skipping version bump + git + deploy');
    process.exit(0);
  }

  // ── 2. ship ─────────────────────────────────────────────────────────────────
  shipBuild(version);

  // ── 3. confirm the deploy went live ─────────────────────────────────────────
  if (NO_WAIT) {
    log('• --no-wait: skipping the deploy poll + the from-outside (Otto) re-check');
    log(`\n✓ RELEASED   (build ${version})  — gate was green before anything shipped.`);
    process.exit(0);
  }

  log(`• waiting for ${PROD_URL}/version.txt to report ${version}  (timeout ${Math.round(DEPLOY_TIMEOUT_MS / 60000)}m, poll ${Math.round(POLL_MS / 1000)}s)…`);
  const live = await waitForDeploy(version);
  if (!live) { log(`✗ deployed version did not reach ${version} within the timeout — check the host (Render?) build logs.`); process.exit(1); }
  log(`✓ deploy is live:  ${PROD_URL}/version.txt == ${version}`);

  // ── 4. Otto: re-test from outside, against the live prod URL ─────────────────
  log(`\n━━ Otto: from-outside re-check against ${PROD_URL} (remoteSafe suites) ━━\n`);
  const otto = await runOtto();
  if (otto.code === 0) {
    // Stamp the receipt INTO the releasing sprint's own .md — the sprint director
    // reads THAT at `cierre` to close THIS sprint. (No shared `.release-ok`.)
    writeReceiptToReleasingSprint(version);
    log(`\n✓ RELEASED   (build ${version})  — gate green, deploy live, from-outside check green.`);
    process.exit(0);
  }

  // Otto failed: drop the hotfix signal and exit non-zero. NO auto-fix/re-ship,
  // NO auto-revert (CEO-locked) — Iris opens a hotfix sprint from the signal.
  writeFailureLog({ version, code: otto.code, out: otto.out, context: `node tests/run.js  (REMOTE: ${PROD_URL})` });
  log(`\n✗ Otto FAILED (exit ${otto.code}) — the deployed build is wrong from the outside.`);
  log(`  Full output → ${path.relative(ROOT, FAILURE_LOG)}`);
  writeHotfixSignal({ version, otto });
  log(`• NO auto-revert, NO auto-re-ship: open a hotfix sprint to carry the fix to prod.`);
  process.exit(otto.code);
}

if (INVOKED_DIRECTLY) {
  main().catch((e) => { console.error('release-and-test crashed:', e); process.exit(1); });
}
