#!/usr/bin/env node
//
// scripts/docs.js — the "máquina de documentación": the SECOND program of the
// sandbox cycle (handoff §4, §5, §13-etapa-4, §15). Tie launches it with
// `npm run sprint` (Tie's rename docs→sprint, so the command names the MOMENT:
// `sandbox`=trastear, `sprint`=construir de verdad). Iris NEVER launches it — it
// is DESTRUCTIVE (it burns the dirty sandbox code + the worktrees) and the burn is
// an irreversible act, so it's the CEO's trigger, like the release.
//
// ── FAIL-CLOSED ───────────────────────────────────────────────────────────────
// docs.js only proceeds if the heart left its `.sandbox-drained` receipt under the
// sandbox dir (proof the corazón drained cleanly and STOPPED). Without it, docs.js
// REFUSES with a clear message and exits NON-ZERO, doing NOTHING destructive (no
// apostles, no bible, no diana, NO burn). This is the same file-as-signal pattern
// as release-and-test.js's .hotfix-needed.json.
//
// ── THE PIPELINE (in strict order) ────────────────────────────────────────────
//   (1) 4 APÓSTOLES in PARALLEL (async spawn, mesa.js pattern), BLIND to each
//       other (none references the others): each analyses the notas + the dirty
//       code and writes its own analysis to docs/apostoles/<n>.md.
//   (2) when the 4 finish → ANSELMO unifies the 4 analyses into THE BIBLE
//       (docs/biblia.md) — "lo descubierto, semántico no gramatical".
//   (3) when Anselmo finishes → ANA LIZ writes THE DIANA (docs/diana.md): the
//       INTENTION tests (what each feature must DO, not how it was typed).
//   (4) cleanupDirtyCode(): deletes the sandbox's DIRTY CODE + the worktrees,
//       KEEPS docs/biblia.md + docs/diana.md (the only survivors — the bridge).
//   (5) handoffToSprint(): writes the implementation sprint .md with a populated
//       `## Diana` section (so sprint.js's build gate has its filter).
//   (6) §15 — fresh Iris: launches a NEW `claude --settings '{"ultracode":true}'
//       "<encargo>"` (clean thread, factory ultracode) primed on the bible+diana —
//       the blind refactor replans from the surviving truth at maximum effort.
//
// ── DETERMINISM / TEST CONTRACT ───────────────────────────────────────────────
// EVERY agent step is mockable by env so the diana (tests/24, Part 4) spawns NO
// real claude. The agents are convened the SAME headless way as everywhere else:
// `claude` with an ARRAY of args, NO shell (win32 cmd.exe would mangle the
// prompt's metacharacters), the subscription token inherited from env — NEVER an
// API key. Nothing is ever pointed at the real repo: tests always pass
// NEBLLA_SANDBOX_DIR=<tmpdir> + NEBLLA_DOCS_MOCK_AGENTS=1.
//
// Env hooks the production code exposes (the test contract):
//   • NEBLLA_SANDBOX_DIR        — the sandbox root (a tmpdir in tests).
//   • NEBLLA_DOCS_MOCK_AGENTS=1 — apóstoles/Anselmo/Ana Liz/fresh-Iris do a CANNED
//     action instead of spawning a real `claude` (deterministic).
//   • NEBLLA_DOCS_TRACE=<path>  — append a JSON-lines trace of the steps it ran
//     ({step, ts}) so the suite reads the ORDER back off disk.
//   • NEBLLA_DOCS_SPRINT_FILE=<path> — where handoffToSprint writes the sprint .md
//     (pointed INSIDE the tmpdir so it never touches the real backbone/sprints/).
//   • NEBLLA_DOCS_FRESH_IRIS_LOG=<path> — where launchFreshIris records its
//     invocation (the suite asserts docs.js INVOKES it, never its real effect).
//   • NEBLLA_SANDBOX_MOCK_GIT   — worktrees.js simulates git (cleanup uses it).

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sandboxRoot, setSandboxRoot, listNotes, readNote } from './sandbox/notes.js';
import { setMockGit, removeWorktree } from './sandbox/worktrees.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Point the SHARED notes/worktrees stores at THIS module's import-time sandbox dir
// (same reason as heart.js: notes.js is a static, shared import that may have
// captured a different dir on its first load; the diana sets NEBLLA_SANDBOX_DIR
// only during the import()).
setSandboxRoot((process.env.NEBLLA_SANDBOX_DIR || '').trim() || null);
setMockGit(!!(process.env.NEBLLA_SANDBOX_MOCK_GIT || '').trim());

// ── env hooks captured at import (same window as the dir flag) ─────────────────
const MOCK_AGENTS = !!(process.env.NEBLLA_DOCS_MOCK_AGENTS || '').trim();
const TRACE_FILE = (process.env.NEBLLA_DOCS_TRACE || '').trim();
const SPRINT_FILE_OVERRIDE = (process.env.NEBLLA_DOCS_SPRINT_FILE || '').trim();
const FRESH_IRIS_LOG = (process.env.NEBLLA_DOCS_FRESH_IRIS_LOG || '').trim();

const APOSTLE_COUNT = 4;
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

// ── the docs surfaces under the sandbox ───────────────────────────────────────
function docsDir() { return path.join(sandboxRoot(), 'docs'); }
function apostlesDir() { return path.join(docsDir(), 'apostoles'); }
function bibleFile() { return path.join(docsDir(), 'biblia.md'); }
function dianaFile() { return path.join(docsDir(), 'diana.md'); }
function apostlesTraceFile() { return path.join(docsDir(), '.apostles-trace.jsonl'); }
function drainedFile() { return path.join(sandboxRoot(), '.sandbox-drained'); }

// ── atomic write (sprint.js pattern, Windows EPERM retry) ─────────────────────
function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, contents);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && i < 10) {
        const until = Date.now() + 25; while (Date.now() < until) { /* spin */ }
        continue;
      }
      try { fs.writeFileSync(file, contents); try { fs.unlinkSync(tmp); } catch {} return; }
      catch { throw e; }
    }
  }
}

// ── step trace (NEBLLA_DOCS_TRACE) — JSON-lines, the ORDER the suite reads back ─
function traceStep(step) {
  if (!TRACE_FILE) return;
  try {
    fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
    fs.appendFileSync(TRACE_FILE, JSON.stringify({ step, ts: new Date().toISOString() }) + '\n');
  } catch { /* best-effort trace */ }
}

// ── the apostles' launch trace (docs/.apostles-trace.jsonl) ───────────────────
// {who, ev:'launch'|'finish', i} so the diana can PROVE they overlapped (parallel,
// not chained): ≥2 launched before the first finished. Append-only.
function apostleTrace(entry) {
  try {
    fs.mkdirSync(docsDir(), { recursive: true });
    fs.appendFileSync(apostlesTraceFile(), JSON.stringify(entry) + '\n');
  } catch { /* best-effort */ }
}

// ── the notas + dirty code the apostles analyse (their input) ─────────────────
// A compact digest of every note's prose + Bitácora (the learnings that survive),
// passed to a real apostle in its prompt. In mock mode it's just proof there was
// material to read.
function gatherNotesDigest() {
  const out = [];
  for (const id of listNotes()) {
    try {
      const { frontmatter, body } = readNote(id);
      out.push(`### ${id} (tema: ${frontmatter.tema || ''}, estado: ${frontmatter.estado || ''})\n${body}`);
    } catch { /* skip an unreadable note */ }
  }
  return out.join('\n\n');
}

// ── programmersFromNotes() — the distinct `responsable` set across the board ───
// Every dispatched note named its programmer in its frontmatter. We read them off
// disk (before the burn deletes the notas/) so cleanupDirtyCode can dismantle each
// real worktree (<repo>/.wt/<prog>). Deduped, blanks dropped.
function programmersFromNotes() {
  const set = new Set();
  for (const id of listNotes()) {
    try {
      const prog = (readNote(id).frontmatter.responsable || '').trim();
      if (prog) set.add(prog);
    } catch { /* skip an unreadable note */ }
  }
  return [...set];
}

// ── a fail-closed refusal helper ──────────────────────────────────────────────
function refuse(msg) {
  // print to stderr (a real refusal the CEO sees); the orchestrator returns the
  // shape the diana asserts and the CLI exits non-zero.
  process.stderr.write(`docs.js: ${msg}\n`);
  return { ok: false, refused: true, steps: [] };
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 1 — apostles(): 4 BLIND documenters in PARALLEL.
// ══════════════════════════════════════════════════════════════════════════════
// Each apostle analyses the notas + dirty code and writes docs/apostoles/<n>.md.
// They are BLIND to each other: nothing in one analysis references another apostle
// (each prompt mentions ONLY itself; the canned mock writes only its own name).
// They run in PARALLEL (mesa.js async spawn: launch all, then await all exits) —
// the trace proves ≥2 launched before the first finished.
//
// MOCK (NEBLLA_DOCS_MOCK_AGENTS): each apostle does a CANNED action — record a
// `launch`, write its blind analysis, record a `finish`. To make the overlap real
// in the trace we record ALL launches FIRST, then all finishes (the parallel
// window), exactly what a real all-spawn-then-all-await would show.
export async function apostles() {
  traceStep('apostles');
  fs.mkdirSync(apostlesDir(), { recursive: true });
  // fresh trace each run (the diana reads the latest)
  try { fs.rmSync(apostlesTraceFile(), { force: true }); } catch {}

  const digest = gatherNotesDigest();

  if (MOCK_AGENTS) {
    // ── MOCK: canned, but model the PARALLEL window in the trace ───────────────
    // Record every launch BEFORE any finish (the overlap the diana checks: ≥2
    // launched before the first finished), then write each blind analysis + finish.
    for (let i = 1; i <= APOSTLE_COUNT; i++) apostleTrace({ who: `apostol-${i}`, ev: 'launch', i });
    for (let i = 1; i <= APOSTLE_COUNT; i++) {
      // BLIND: the analysis names ONLY this apostle, never a sibling.
      const md = [
        `# Análisis de apostol-${i}`,
        '',
        `Soy apostol-${i}. Analicé las notas y el código sucio del sandbox de forma`,
        'independiente, sin saber de la existencia de ningún otro analista.',
        '',
        '## Lo que vi (semántico, no gramatical)',
        digest ? '- Hay material en las notas para documentar el QUÉ descubierto.' : '- (sin notas)',
      ].join('\n');
      atomicWrite(path.join(apostlesDir(), `${i}.md`), md + '\n');
      apostleTrace({ who: `apostol-${i}`, ev: 'finish', i });
    }
    return { count: APOSTLE_COUNT };
  }

  // ── REAL: spawn 4 `claude -p` in PARALLEL (mesa.js pattern), then await all ──
  // Launch ALL first (the parallel window), each writing ITS OWN analysis file;
  // on('exit') is the done-signal; a watchdog SIGKILLs a hung child; `settled`
  // makes each completion idempotent. We resolve when all four have settled.
  const launches = [];
  for (let i = 1; i <= APOSTLE_COUNT; i++) {
    launches.push(spawnApostle(i, digest));
  }
  await Promise.all(launches);
  return { count: APOSTLE_COUNT };
}

// Spawn ONE apostle and resolve when it exits (or is watchdog-killed). BLIND: its
// prompt names ONLY itself. ARRAY args, NO shell, subscription token from env.
function spawnApostle(i, digest) {
  return new Promise((resolve) => {
    apostleTrace({ who: `apostol-${i}`, ev: 'launch', i });
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(timer); apostleTrace({ who: `apostol-${i}`, ev: 'finish', i }); resolve(); };
    const outFile = path.join(apostlesDir(), `${i}.md`);
    const prompt = [
      `Eres apostol-${i}, uno de los documentadores del sandbox de Neblla. Trabajas`,
      'SOLO: no sabes de ningún otro analista ni los referencias. Analiza las notas',
      '(backbone/sandbox/notas/) y el código sucio del sandbox, y escribe en',
      `${outFile} tu análisis del QUÉ se construyó (significado/comportamiento, NO`,
      'el diff literal). Apunta cualquier truco fino que descubras: si te lo dejas,',
      'el reconstructor no podrá rehacerlo. Cuando termines, sal.',
    ].join(' ');
    let child;
    try {
      child = spawn('claude', ['-p', prompt, '--allowedTools', 'Read,Write'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch { done(); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(); }, AGENT_TIMEOUT_MS);
    child.on('error', () => done());
    child.on('exit', () => done());
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2 — anselmo(): unify the 4 analyses into THE BIBLE (docs/biblia.md).
// ══════════════════════════════════════════════════════════════════════════════
// Anselmo stretches his cronista role: apóstoles → evangelios → biblia. He runs
// strictly AFTER the 4 apostles finished (the orchestrator awaits apostles first).
export async function anselmo() {
  traceStep('anselmo');
  if (MOCK_AGENTS) {
    let analyses = [];
    try { analyses = fs.readdirSync(apostlesDir()).filter(f => f.endsWith('.md')); } catch {}
    const md = [
      '# La Biblia',
      '',
      'Unificación de los análisis de los apóstoles — el QUÉ descubierto en el',
      'sandbox, semántico no gramatical (lo único que cruza el puente al',
      'reconstructor, junto con la diana).',
      '',
      `Apóstoles unificados: ${analyses.length}.`,
    ].join('\n');
    atomicWrite(bibleFile(), md + '\n');
    return { ok: true };
  }
  // REAL: a `claude -p` (Anselmo) reads the 4 analyses and writes the bible.
  await runAgentSync('Anselmo (la biblia)', [
    'Eres Anselmo, el cronista del sandbox de Neblla. Lee los 4 análisis en',
    `${apostlesDir()} y UNIFÍCALOS en LA BIBLIA: un único documento en ${bibleFile()}`,
    'que recoja el QUÉ se construyó (significado/comportamiento) y TODOS los trucos',
    'finos descubiertos. Semántico, no gramatical. Es lo único que sobrevive al',
    'borrado del código sucio, así que tiene que ser perfecta. Cuando termines, sal.',
  ].join(' '));
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3 — anaLiz(): write THE DIANA (docs/diana.md) reading the bible.
// ══════════════════════════════════════════════════════════════════════════════
// The intention tests. Runs strictly AFTER Anselmo (the orchestrator awaits the
// bible first). Carries a `filtro:` line — the build gate's filter sprint.js reads.
export async function anaLiz() {
  traceStep('analiz');
  if (MOCK_AGENTS) {
    const md = [
      '# La Diana',
      'filtro: sandbox-impl',
      '',
      'Tests de INTENCIÓN leídos de la biblia: qué debe HACER cada feature, no cómo',
      'se escribió. Son la auditoría de que el puente (la biblia) fue fiel.',
    ].join('\n');
    atomicWrite(dianaFile(), md + '\n');
    return { ok: true };
  }
  // REAL: a `claude -p` (Ana Liz) reads the bible and writes the diana.
  await runAgentSync('Ana Liz (la diana)', [
    'Eres Ana Liz, la diana del sandbox de Neblla. Lee LA BIBLIA en',
    `${bibleFile()} y escribe LA DIANA en ${dianaFile()}: tests de INTENCIÓN (qué`,
    'debe HACER cada feature, nos da igual el cómo). Empieza el fichero con una',
    'línea `filtro: <substring>` que sprint.js usará como puerta de build. La diana',
    'es la auditoría de que la biblia fue fiel. Cuando termines, sal.',
  ].join(' '));
  return { ok: true };
}

// ── runAgentSync — a synchronous `claude -p` for the serial steps (Anselmo/Ana Liz)
// ARRAY args, NO shell, subscription token from env, NEVER an API key. Result is on
// disk (the file each agent writes), never parsed from stdout.
function runAgentSync(label, prompt) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
    let child;
    try {
      child = spawn('claude', ['-p', prompt, '--allowedTools', 'Read,Write'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch { done(); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(); }, AGENT_TIMEOUT_MS);
    child.on('error', () => done());
    child.on('exit', () => done());
  });
}

// ── the safety net: are the bible AND the diana present AND non-empty? ─────────
// STAGE 5 (handoff §13). The dirty code is "usar y tirar", but it is the ONLY copy:
// once burned it is gone. The bible + the diana are the bridge that lets the fresh
// Iris rebuild it. If a real agent (apostle/Anselmo/Ana Liz) failed, those docs are
// missing/empty — burning then would be a broken bridge with NO net (lost work). So
// before the irreversible burn we verify BOTH survivors exist AND are non-empty.
// Returns null when the net holds (safe to burn) or a {reason} when it must abort.
function survivorsCheck() {
  for (const [name, file] of [['biblia.md', bibleFile()], ['diana.md', dianaFile()]]) {
    let size = -1;
    try { size = fs.statSync(file).size; } catch { size = -1; }
    if (size < 0) return { reason: `falta ${name} — no quemo (red de seguridad).` };
    if (size === 0) return { reason: `${name} está vacía (0 B) — no quemo (red de seguridad).` };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 4 — cleanupDirtyCode(): BURN the dirty code + worktrees, KEEP bible+diana.
// ══════════════════════════════════════════════════════════════════════════════
// The dirty sandbox code is "usar y tirar"; only the bible + the diana cross the
// bridge. We delete everything UNDER the sandbox EXCEPT the docs/ dir (which holds
// biblia.md + diana.md) and the drained receipt that gated us in. ⚠ Operates ONLY
// on the sandbox dir (NEBLLA_SANDBOX_DIR) — never the repo. Honours MOCK_GIT for
// the worktree teardown.
//
// SAFETY NET (STAGE 5): BEFORE deleting anything, verify the bible + the diana exist
// and are non-empty (survivorsCheck). If either is missing/empty → ABORT: leave the
// dirty code intact and return a refusal-shaped result (the caller/CLI exits non-zero).
//
// REAL WORKTREES (STAGE 5, handoff §14): the programmers' worktrees live OUTSIDE the
// sandbox dir, at <repo>/.wt/<prog> — deleting children of the sandbox would leave
// them orphaned. So we ALSO tear each one down (removeWorktree → `git worktree remove
// --force` + `git branch -D sandbox/<prog>`, honouring NEBLLA_SANDBOX_MOCK_GIT). The
// programmer list comes from the caller (the heart knows its in-flight/assigned
// programmers); if omitted we tear down nothing extra (the in-dir burn still runs).
export async function cleanupDirtyCode(programmers = []) {
  traceStep('cleanup');

  // ── SAFETY NET FIRST — never burn without both survivors present + non-empty. ─
  const net = survivorsCheck();
  if (net) {
    process.stderr.write(`docs.js: ${net.reason}\n`);
    return { ok: false, refused: true, aborted: true, reason: net.reason };
  }

  const root = sandboxRoot();
  // The SURVIVORS we must never touch: the docs/ dir (bible + diana). Everything
  // else under the sandbox is dirty code / scratch / worktrees → burned. We also
  // preserve the orchestrator's own control files (the step trace + the fresh-Iris
  // invocation log) when they live directly under the sandbox root: burning them
  // mid-pipeline would erase the very record the later steps still append to. We
  // KEEP by basename so a trace pointed inside the sandbox survives the burn.
  const keep = new Set(['docs']);
  for (const ctl of [TRACE_FILE, FRESH_IRIS_LOG]) {
    if (ctl && path.dirname(path.resolve(ctl)) === path.resolve(root)) keep.add(path.basename(ctl));
  }
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return; }
  for (const name of entries) {
    if (keep.has(name)) continue;                        // KEEP docs/ + the control files
    const p = path.join(root, name);
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best-effort burn */ }
  }

  // ── tear down the REAL worktrees (they live OUTSIDE the sandbox, at <repo>/.wt). ─
  // removeWorktree honours NEBLLA_SANDBOX_MOCK_GIT (no real git in tests); it emits
  // `git worktree remove --force <dir>` + `git branch -D sandbox/<prog>`, so after the
  // burn there are ZERO orphan worktrees / sandbox branches.
  for (const prog of (Array.isArray(programmers) ? programmers : [])) {
    const name = String(prog || '').trim();
    if (!name) continue;
    try { removeWorktree(name); } catch (e) { process.stderr.write(`docs.js: removeWorktree(${name}) falló: ${e.message}\n`); }
  }
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 5 — handoffToSprint(): seed the implementation sprint .md with ## Diana.
// ══════════════════════════════════════════════════════════════════════════════
// sprint.js's build gate reads a `## Diana` section (its `filtro:`). The diana was
// BORN in this docs phase; here we land it in the implementation sprint's .md so
// the old machine has its gate filter without the `diana` step (handoff §6/§13).
// Writes to NEBLLA_DOCS_SPRINT_FILE (a tmpdir in tests — NEVER the real
// backbone/sprints/).
export async function handoffToSprint() {
  traceStep('handoff');
  // pull the diana's content (its filtro: line + intention tests) to embed it.
  let dianaContent = '';
  try { dianaContent = fs.readFileSync(dianaFile(), 'utf8'); } catch { dianaContent = ''; }
  // the filtro: line (the build gate's filter). Default if the diana didn't carry one.
  const filtroMatch = dianaContent.match(/^filtro\s*:\s*(.+)$/m);
  const filtro = filtroMatch ? filtroMatch[1].trim() : 'sandbox-impl';

  const target = SPRINT_FILE_OVERRIDE || path.join(REPO_ROOT, 'backbone', 'sprints', 'sandbox-impl.md');
  const md = [
    '---',
    'slug: sandbox-impl',
    'status: pending',
    '---',
    '',
    '# Sprint de implementación (reconstrucción a ciegas desde el sandbox)',
    '',
    'Alimentado por la biblia + la diana del sandbox (lo único que sobrevivió al',
    'borrado del código sucio). Recorrido: replan → build → release → cierre.',
    '',
    '## Diana',
    `filtro: ${filtro}`,
    '',
    'La diana nació en la fase de documentación (Ana Liz, sobre la biblia). Es la',
    'puerta del build: `node tests/run.js ' + filtro + '`. Tests de intención:',
    '',
    dianaContent.trim() || '(la diana se escribió en docs/diana.md)',
    '',
    '## Casillas',
    '- [ ] replan',
    '- [ ] build',
    '- [ ] release',
    '- [ ] cierre',
    '',
    '## Log',
    '',
  ].join('\n');
  atomicWrite(target, md);
  return { file: target };
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 6 — launchFreshIris(): the §15 fresh-thread, ultracode replan.
// ══════════════════════════════════════════════════════════════════════════════
// Launch a NEW `claude` (no --resume/--continue → clean thread, no sandbox
// chatter) at FACTORY ultracode via --settings, primed ONLY on the bible + the
// diana (the surviving truth). The reconstructor sees neither the dirty code nor
// the trasteo — only the documented intent — and rebuilds clean at maximum effort.
//
// MOCK (NEBLLA_DOCS_MOCK_AGENTS): record the INVOCATION (the spawn it WOULD make)
// to NEBLLA_DOCS_FRESH_IRIS_LOG without running a real claude. The diana asserts
// docs.js INVOKES it (the recorded args carry `ultracode` + point at the
// bible/diana), never a real claude effect.
export async function launchFreshIris() {
  traceStep('fresh-iris');
  const encargo = [
    'Eres Iris, en un hilo NUEVO y limpio. La fase de sandbox terminó: solo',
    `sobreviven la biblia (${bibleFile()}) y la diana (${dianaFile()}). Replanifica`,
    'la implementación LIMPIA (refactor a ciegas) desde la biblia, con la diana',
    'delante como auditoría. Abre el sprint de implementación y llévalo con',
    'scripts/sprint.js (replan → build → release → cierre).',
  ].join(' ');
  // The §15 recipe: a FRESH claude (no --resume/--continue), ultracode via
  // --settings (session-only, passed at launch — NOT in settings.json).
  const args = ['--model', 'opus', '--settings', JSON.stringify({ ultracode: true }), encargo];

  if (MOCK_AGENTS) {
    // record the invocation (the contract: it carries ultracode + the bible/diana).
    if (FRESH_IRIS_LOG) {
      try {
        fs.mkdirSync(path.dirname(FRESH_IRIS_LOG), { recursive: true });
        atomicWrite(FRESH_IRIS_LOG, JSON.stringify({ cmd: 'claude', args, ultracode: true, bible: bibleFile(), diana: dianaFile(), at: new Date().toISOString() }, null, 2) + '\n');
      } catch { /* best-effort record */ }
    }
    return { invoked: true };
  }

  // REAL: spawn the fresh interactive Iris. stdio:inherit so she owns the TTY for
  // the replan conversation. Subscription token inherited from env, NEVER an API key.
  try { spawn('claude', args, { cwd: REPO_ROOT, stdio: 'inherit' }); }
  catch { /* if claude is missing the CEO will see it; nothing destructive happened */ }
  return { invoked: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// runDocs() — the orchestrator. FAIL-CLOSED on `.sandbox-drained`, then the 6
// steps IN ORDER. Returns {ok, refused?, steps}.
// ══════════════════════════════════════════════════════════════════════════════
export async function runDocs() {
  // FAIL-CLOSED: refuse (no-op on disk) unless the heart left its drained receipt.
  if (!fs.existsSync(drainedFile())) {
    return refuse('falta la señal .sandbox-drained — el sandbox no ha drenado todavía (fail-closed). No hago nada.');
  }

  const steps = [];
  await apostles();        steps.push('apostles');
  await anselmo();         steps.push('anselmo');
  await anaLiz();          steps.push('analiz');
  // STAGE 5: cleanupDirtyCode runs the bible+diana safety net BEFORE the burn. If the
  // docs did not come out (an agent failed), it ABORTS — the dirty code SURVIVES and
  // runDocs returns the refusal up to the CLI (non-zero exit), never the fresh Iris.
  // The programmer list (the worktrees to dismantle) is discovered from the notes'
  // `responsable` field — every dispatched note named its programmer.
  const burn = await cleanupDirtyCode(programmersFromNotes());
  if (burn && burn.aborted) return { ok: false, refused: true, aborted: true, reason: burn.reason, steps };
  steps.push('cleanup');
  await handoffToSprint(); steps.push('handoff');
  await launchFreshIris(); steps.push('fresh-iris');
  return { ok: true, refused: false, steps };
}

// ── main() — the CLI (gated; tests import the exports, never call main) ────────
// Run only when invoked directly (`node scripts/docs.js`), never on import — the
// diana imports this module and must NOT kick off the pipeline.
async function main() {
  const result = await runDocs();
  if (!result.ok && result.refused) process.exit(1);
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { process.stderr.write(`docs.js: fallo inesperado: ${e.message}\n`); process.exit(1); });
}
