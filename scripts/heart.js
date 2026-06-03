#!/usr/bin/env node
//
// scripts/heart.js — the "corazón": the deterministic sandbox daemon.
//
// One terminal, one command. Tie launches the heart (`npm run sandbox`); the
// heart spawns Iris as an interactive child (stdio:inherit, she owns the TTY) and
// runs its OWN heartbeat (a single setInterval) in the same process, IN SILENCE —
// it writes only to files/log, NEVER to stdout, so it can't corrupt Iris's TUI.
//
// ── THE ONE CLOCK (risk #1) ───────────────────────────────────────────────────
// A single clock with THREE hands, NOT three independent clocks. Each beat runs
// the three jobs in a FIXED order: Aubé → Reparto → William. A re-entrancy guard
// ('ticking') makes the next beat wait until the current one closes — there are
// NEVER two hands on the board at once. That is the determinism the design asks
// for. heart writes only to file/log (never console.log in the tick path).
//
// ── THE SINGLE GATEKEEPER ─────────────────────────────────────────────────────
// The heart is the ONLY thing that moves a note's official `estado:` (it calls
// notes.setNoteState). Everyone else — Iris, William, the programmers — PROPOSES
// by writing prose into a note's append-only logs; the heart confirms.
//
// ── STAGE 1 (this file) ───────────────────────────────────────────────────────
// ONE note, ONE programmer (a pool of size 1; no real multi-programmer pools yet).
// The hands are deliberately trivial but the SKELETON is the real thing: the one
// clock, the guard, the fixed order, the gatekeeper, the async programmer launch
// (mesa.js pattern: spawn + on('exit') = done + watchdog SIGKILL + idempotent
// 'settled'), spawnIris (stdio:inherit) and SIGINT handling are all here.
//
// Env hooks the production code exposes (the test contract):
//   • NEBLLA_SANDBOX_DIR        — override the sandbox root to a tmpdir.
//   • NEBLLA_SANDBOX_MOCK_PROGRAMMER — launchProgrammer does a CANNED action
//     (appendBitacora + immediate "exit") instead of spawning a real `claude`.
//   • NEBLLA_SANDBOX_MOCK_GIT   — worktrees.js simulates git/junction (see there).
//
// Tests drive the heart by importing the PURE, injectable tick(deps) and the
// synchronous tickN(n, deps) driver and calling them by hand. The real
// setInterval is gated behind main(), which tests NEVER call.

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  sandboxRoot, setSandboxRoot, listNotes, readNote, createNote,
  setNoteState, appendBitacora, appendWilliam,
} from './sandbox/notes.js';
import { createWorktree, removeWorktree, mergeWorktree, resolveConflict, setMockGit, setMockMerge, setMockResolver, worktreeDir } from './sandbox/worktrees.js';
import { runAube as aubeHand, runDeps as depResolveHand } from './sandbox/aube.js';
import { runReparto as repartoHand } from './sandbox/reparto.js';
import { runWilliam as williamHand } from './sandbox/william.js';
import { PROJECT_ROOT } from './lib/target.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// REPO_ROOT = the PRODUCT's repo (project/), NOT the forge. The sandbox worktrees
// are created AND branch-deleted on THIS git, and the notes/demo live under it.
const REPO_ROOT = PROJECT_ROOT;

// Point the SHARED notes store at THIS module's import-time sandbox dir. The diana
// re-imports heart fresh per tmpdir but notes.js is a static (shared) import, so
// without this the heart would operate on whichever dir notes.js first captured.
// loadFresh sets NEBLLA_SANDBOX_DIR during this import, so we read it now.
setSandboxRoot((process.env.NEBLLA_SANDBOX_DIR || '').trim() || null);

// CAPTURE the mock-programmer flag at IMPORT time, same reason as the dir: the
// diana sets NEBLLA_SANDBOX_MOCK_PROGRAMMER only during the import() and restores
// it before tickN runs, so a call-time read would be gone (and we'd try to spawn a
// real `claude`). Captured here, the heart's launcher knows to do the canned
// action for the whole life of this freshly-imported instance.
//   • truthy non-'hold' (e.g. '1') → canned action, SETTLES immediately (Part 1/2).
//   • 'hold'                        → registers in-flight but NEVER settles on its
//     own, simulating a long-running real `claude -p` the heart can later SIGKILL
//     (the cancel valve, Part 3). Also used to observe a programmer genuinely
//     mid-work.
const MOCK_PROGRAMMER_RAW = (process.env.NEBLLA_SANDBOX_MOCK_PROGRAMMER || '').trim();
const MOCK_PROGRAMMER = !!MOCK_PROGRAMMER_RAW;
const MOCK_PROGRAMMER_HOLD = MOCK_PROGRAMMER_RAW === 'hold';

// Capture MOCK_GIT at import (same window as the dir/programmer flags) and re-point
// worktrees.js — which heart imports via a STATIC, shared specifier, so it loaded
// ONCE on heart's first import and may have captured the WRONG (un-flagged) value.
// Without this, a teardown the heart drives under MOCK_GIT='1' would run real git.
const MOCK_GIT = !!(process.env.NEBLLA_SANDBOX_MOCK_GIT || '').trim();
setMockGit(MOCK_GIT);

// STAGE 3: re-point worktrees.js's merge/resolver mocks the SAME way as MOCK_GIT.
// worktrees.js is a STATIC (shared) import, loaded ONCE on the heart's FIRST import —
// which, in the full suite, happened in an earlier test with NO merge/resolver env.
// So its import-time captured _mockMerge/_mockResolver are stale by the time THIS
// freshly-imported heart runs a tick that merges. We re-point them to OUR import-time
// env (the diana sets NEBLLA_SANDBOX_MOCK_MERGE/RESOLVER only during this import()),
// so the conflict the heart escalates in harvest hits the mock, never a real claude.
setMockMerge((process.env.NEBLLA_SANDBOX_MOCK_MERGE || '').trim());
setMockResolver(!!(process.env.NEBLLA_SANDBOX_MOCK_RESOLVER || '').trim());

// Capture William's mock at IMPORT time too (same window as the dir/programmer/git
// flags — the diana sets it only during the import() then restores it). When set
// it's a JSON literal {note?, say?}: `note` pins the note William attends to this
// tick, `say` is his single observation ('' / absent → silence). When NOT set,
// William's hand resolves its choice for real (a synchronous `claude -p`).
const MOCK_WILLIAM = (process.env.NEBLLA_SANDBOX_MOCK_WILLIAM || '').trim();

const TICK_MS = 15 * 1000;                 // the heartbeat interval (real mode)
const PROGRAMMER_TIMEOUT_MS = 10 * 60 * 1000;

// ── profile config (root JSON, hot-reloaded) — Tie's kill-switch ──────────────
// A versioned config at the REPO ROOT (sandbox.config.json) turns profiles on/off
// WITHOUT touching code. It is read FRESH on every use (the file is tiny), so an
// edit takes effect on the very next heartbeat with NO restart — that IS the
// hot-reload. main() also fs.watch()es the file and logs each change for visibility.
//
// First profile: `william { active: true|false }`. A profile is ACTIVE unless the
// config explicitly sets active:false. With william active:false the heart NEVER
// spawns William — the deterministic fix for his token leak (today he fires a real
// `claude -p` on EVERY 15s tick, with no dedup).
const PROFILE_CONFIG_FILE = path.join(REPO_ROOT, 'sandbox.config.json');
// WHERE the profile config lives, decided by the CAPTURED sandbox root (stable at tick
// time — the diana restores NEBLLA_SANDBOX_DIR right after import, so we must NOT read
// the env here). Real daemon: sandboxRoot() is the default backbone/sandbox → the
// versioned, hot-reloaded kill-switch at the REPO ROOT. Tests/demo with an OVERRIDDEN
// sandbox dir: read from THERE instead — a tmpdir with no config → every profile
// defaults to active, so the repo's runtime kill-switch (e.g. william off to save
// tokens) never leaks into the hermetic behavior diana.
function profileConfigFile() {
  const root = sandboxRoot();
  const def = path.join(REPO_ROOT, 'backbone', 'sandbox');
  if (path.resolve(root) === path.resolve(def)) return PROFILE_CONFIG_FILE;
  return path.join(root, 'sandbox.config.json');
}
function readProfileConfig() {
  try { return JSON.parse(fs.readFileSync(profileConfigFile(), 'utf8')) || {}; }
  catch { return {}; }
}
// profileActive(name) — may this profile run? ACTIVE unless explicitly active:false.
function profileActive(name) {
  const cfg = readProfileConfig();
  const p = cfg && cfg.profiles && cfg.profiles[name];
  if (p && p.active === false) return false;     // explicitly off → never runs
  return true;                                   // active unless told otherwise
}

// ── WORK_STATES — the note states that mean "its programmer is STILL working" ──
// A programmer is OCUPADO (never to be freed by reconcilePools) while its note is in
// any of these. `en-proceso` is the obvious one; `atencion` is the trap the green
// hid: William flags an `en-proceso` note → `atencion` to tell the programmer "read
// me before you finalize", but the programmer's `claude -p` is STILL ALIVE and STILL
// WORKING in `atencion` — it has NOT finished. Treating `atencion` as "done by another
// route" (the old `!== 'en-proceso'`) would strand the worker: dropped from inflight,
// returned to libres, note left hanging (0 merges/0 teardowns, never finalizes),
// ghost worktree, and Reparto could hand it a 2nd note in parallel. So both work
// states keep a programmer busy; only a note OUTSIDE this set frees its worker.
// (NOT included on purpose: `finalizada` → harvest's job; `cancelada` → the cancel
// valve's job; `revision`/`libre` → genuinely idle.)
const WORK_STATES = new Set(['en-proceso', 'atencion']);

// ── silent log (never stdout — the heart shares the TTY with Iris) ─────────────
// heart writes only to file/log. The heartbeat appends one line to a log file
// under the sandbox; it must never reach process.stdout (that would corrupt
// Iris's TUI). console.error is acceptable for catastrophic, non-tick failures
// only; the tick path uses logLine exclusively.
function logFile() { return path.join(sandboxRoot(), '.heart.log'); }
function logLine(msg) {
  try {
    fs.mkdirSync(sandboxRoot(), { recursive: true });
    fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* logging must never throw into the tick */ }
}

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

// ── the heart state sidecar (.heart.json) ─────────────────────────────────────
// pools: { libres: [progName...], ocupados: [progName...] } + a monotonic ordinal
// for numbering notes. Persisted to <sandbox>/.heart.json; crash-recoverable
// because it can be rebuilt from the note frontmatter (stage 2 work — here we
// just keep it on disk).
function heartFile() { return path.join(sandboxRoot(), '.heart.json'); }

// ── DRAIN signals (STAGE 4, handoff §4/§5) ────────────────────────────────────
// Two signal files live UNDER the sandbox dir (the same file-as-signal pattern as
// release-and-test.js's .hotfix-needed.json):
//   • <sandbox>/.drain-requested  — Iris's "basta": she writes it when she+Tie say
//     "ya tenemos suficiente". From then on, AT THE TOP OF EACH TICK, the heart
//     enters DRAIN mode: Aubé numbers NO new notes and Reparto dispatches NO new
//     ones, but the OCCUPIED programmers FINISH the note in flight (drain, never
//     abort). The heart stays the SOLE gatekeeper of `estado:` while it drains.
//   • <sandbox>/.sandbox-drained — the heart's receipt: once ocupados is EMPTY it
//     writes JSON {at:<iso>, notasFinalizadas:<N>} and signals stop. docs.js is
//     FAIL-CLOSED on this file's existence.
function drainRequestFile() { return path.join(sandboxRoot(), '.drain-requested'); }
function drainedFile() { return path.join(sandboxRoot(), '.sandbox-drained'); }

// isDraining() — is a drain in progress (Iris said "basta")? A pure read of disk.
function isDraining() { return fs.existsSync(drainRequestFile()); }

// isDrained() — the daemon-loop STOP predicate (the design's clearInterval/exit).
// True once the heart has written its `.sandbox-drained` receipt. The real main()
// loop reads this to stop; the diana reads it (or the file) to assert the stop
// was signalled. Exported as the contract hook.
export function isDrained() { return fs.existsSync(drainedFile()); }

// notasFinalizadas() — how many notes are `finalizada` on disk right now. Used to
// stamp the drained receipt (the design: notasFinalizadas:N). A pure read.
function countFinalizadas() {
  let n = 0;
  for (const id of listNotes()) {
    try { if (readNote(id).frontmatter.estado === 'finalizada') n++; } catch { /* skip */ }
  }
  return n;
}

function freshHeartState() {
  return { libres: [], ocupados: [], ordinal: 0, assignments: {} };
}

// A heart-state object is USABLE only if it has the four pools/fields with the
// right shapes. A missing file, a corrupt (non-JSON) file, or an incomplete object
// (a partial write, an older schema) is all the SAME problem: the sidecar can't be
// trusted, so we rebuild from the notes' frontmatter instead of trusting garbage.
function isUsableHeartState(hs) {
  return !!hs && Array.isArray(hs.libres) && Array.isArray(hs.ocupados)
    && hs.assignments && typeof hs.assignments === 'object'
    && Number.isFinite(hs.ordinal);
}

// readHeartState() — the public read. If the sidecar is missing/corrupt/incomplete
// it returns the REBUILT pools (reconstructed from the note frontmatter) rather
// than a blank slate, so a crash can never strand the pools. The diana asserts the
// rebuilt pools come back from here after a tick with a missing/corrupt sidecar.
export function readHeartState() {
  let hs = null;
  try { hs = JSON.parse(fs.readFileSync(heartFile(), 'utf8')); } catch { hs = null; }
  if (isUsableHeartState(hs)) return hs;
  return rebuildHeartState();
}
function writeHeartState(hs) { atomicWrite(heartFile(), JSON.stringify(hs, null, 2) + '\n'); }

// ── rebuildHeartState() — crash recovery from the note frontmatter ────────────
// When .heart.json is missing or corrupt, reconstruct {libres, ocupados, ordinal,
// assignments} by reading every note's `responsable` + `estado` + `numero` off
// disk (the notes are the durable truth; the sidecar is just a cache):
//   • a note `en-proceso`  → its programmer is OCUPADO (mid-work).
//   • any other note with a responsable → its programmer is LIBRE (idle/ready),
//     UNLESS already placed in OCUPADOS by an en-proceso note (busy wins; a
//     programmer is never listed as BOTH free and busy).
//   • assignments[tema] = the programmer seen for that tema's notes.
//   • ordinal = at least the highest `numero` on disk (monotonicity survives a
//     crash — the next number handed out can never be one already used).
// Pure read of disk; does NOT persist (the caller — a tick — re-persists it).
export function rebuildHeartState() {
  const hs = freshHeartState();
  const libres = new Set();
  const ocupados = new Set();
  for (const id of listNotes()) {
    let fm;
    try { fm = readNote(id).frontmatter; } catch { continue; }
    const prog = (fm.responsable || '').trim();
    const tema = (fm.tema || '').trim();
    const num = parseInt(fm.numero || '0', 10);
    if (Number.isFinite(num) && num > hs.ordinal) hs.ordinal = num;
    if (prog && tema && !hs.assignments[tema]) hs.assignments[tema] = prog;
    if (!prog) continue;
    if (fm.estado === 'en-proceso') ocupados.add(prog);
    else libres.add(prog);
  }
  // busy wins: a programmer that owns an en-proceso note is OCUPADO, never also free.
  for (const p of ocupados) libres.delete(p);
  hs.libres = [...libres];
  hs.ocupados = [...ocupados];
  return hs;
}

// rebuildIfNeeded() — at the top of a tick, if the sidecar on disk is unusable
// (missing/corrupt/incomplete), reconstruct it from the frontmatter and WRITE it
// back. A no-op when the sidecar is already healthy (we don't churn disk every
// tick). Returns true when a rebuild+persist happened.
function rebuildIfNeeded() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(heartFile(), 'utf8')); } catch { raw = null; }
  if (isUsableHeartState(raw)) return false;
  writeHeartState(rebuildHeartState());
  return true;
}

// ── in-flight programmers (across ticks) ──────────────────────────────────────
// A programmer the heart launched runs ASYNC between ticks (its process is the
// unit of work). We track it here: {noteId, settled, code}. The exit handler (or
// the mock's canned completion) flips `settled` once. harvestFinished() — run at
// the TOP of each tick, outside the three spied hands — finalizes any settled
// programmer THROUGH the gatekeeper and returns it to the free pool. This map is
// module-level (one heart per process); tests import fresh per tmpdir so it never
// leaks between them.
const inflight = new Map();   // progName -> { noteId, settled, code, kill? }

// ── re-entrancy guard (THE one clock) ─────────────────────────────────────────
let ticking = false;

// ── the live Iris child (STAGE 5) ─────────────────────────────────────────────
// main() spawns the interactive Iris and stores her here so the confirmation gate's
// real seams (realKillIris / realRespawnIris) can close her and re-open a fresh one.
// In tests these seams are never reached (the diana injects spies); irisChild stays
// null and the seams degrade to a silent no-op.
let irisChild = null;

// ── the confirmation-gate REAL seams (production wrappers; tests inject spies) ──
// realKillIris(sig) — shut the sandbox Iris down with SIGTERM (the SAME signal the
// daemon shutdown uses), freeing the TTY so the heart can ask Tie directly.
function realKillIris(sig = 'SIGTERM') { try { if (irisChild) irisChild.kill(sig); } catch (e) { logLine(`killIris falló: ${e.message}`); } }

// realConfirmReconstruct() — read Tie's s/n off the now-free terminal. This is the
// ONLY place a real stdin read lives; tests ALWAYS inject confirmReconstruct so this
// never runs under test. Resolves true (SÍ = burn) | false (NO = back to sandbox).
function realConfirmReconstruct() {
  return new Promise((resolve) => {
    try {
      const q = '\n¿quemo y reconstruyo, o vuelvo al sandbox? [s/n] ';
      process.stdout.write(q);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (d) => {
        const a = String(d || '').trim().toLowerCase();
        process.stdin.off('data', onData);
        try { process.stdin.pause(); } catch {}
        resolve(a === 's' || a === 'si' || a === 'sí' || a === 'y' || a === 'yes');
      };
      process.stdin.on('data', onData);
    } catch (e) { logLine(`confirmReconstruct (stdin) falló: ${e.message}`); resolve(false); }
  });
}

// realRunDocs() — the burn (docs.js runDocs). Imported lazily so heart.js's import
// graph (which the diana loads fresh per tmpdir) never eagerly pulls docs.js.
async function realRunDocs() {
  try {
    const mod = await import('./docs.js');
    if (typeof mod.runDocs === 'function') return await mod.runDocs();
  } catch (e) { logLine(`runDocs (import docs.js) falló: ${e.message}`); }
  return { ok: false, refused: true };
}

// realRespawnIris() — re-open a fresh sandbox Iris after a NO, and resume ticking.
function realRespawnIris() { try { irisChild = spawnIris(); } catch (e) { logLine(`respawnIris falló: ${e.message}`); } }

// ── the gatekeeper (heart's hand — the ONLY caller of setNoteState) ───────────
// The hands (reparto/william) PROPOSE estado moves by calling this; the actual
// setNoteState lives ONLY here, in heart.js. Keeping the call out of the hand
// modules is the single-gatekeeper invariant the diana checks at the source.
function gatekeeper(id, state) {
  // n-0005 round cap: count each time William BOUNCES a note back to `revision`. The
  // count gates re-dispatch (lowestNoteFor refuses a revision note past the cap), so a
  // note William keeps rejecting stops after the tope instead of an endless William↔dev
  // ping-pong. We count on the bounce, NOT on the revision→en-proceso re-dispatch,
  // because William's hand runs LAST in the tick: its write to .heart.json is never
  // clobbered by Reparto's earlier (stale-snapshot) pool write. The counter lives in
  // .heart.json (single-threaded heart → no lost-update; n-0002 #34) and survives
  // Sergio respawns (the daemon itself never restarts).
  if (state === 'revision') {
    const hs = readHeartState();
    hs.revisionRounds = hs.revisionRounds || {};
    hs.revisionRounds[id] = (hs.revisionRounds[id] || 0) + 1;
    writeHeartState(hs);
  }
  setNoteState(id, state);
}

// ── the per-hand context (the only surfaces a hand may touch) ─────────────────
// Each hand is a pure module (aube.js/reparto.js/william.js) that receives this
// ctx. They read/write the heart state and the notes through these closures; the
// estado-mutating gatekeeper is the ONLY way they can move a state, and it's the
// heart's hand, not theirs.
function aubeCtx() {
  return { readHeartState, writeHeartState, listNotes, readNote, writeNoteFields };
}
function repartoCtx() {
  return {
    readHeartState, writeHeartState, lowestNoteFor,
    hasAssignment: (prog) => {
      const hs = readHeartState();
      return Object.values(hs.assignments || {}).includes(prog);
    },
    isInflight: (prog) => inflight.has(prog),
    gatekeeper,
    launchProgrammer,
  };
}
function williamCtx() {
  return { listNotes, readNote, appendWilliam, gatekeeper, williamChoice };
}

// ── williamChoice() — resolve William's decision for THIS tick ────────────────
// MOCK (NEBLLA_SANDBOX_MOCK_WILLIAM set): the env var is a JSON literal {note?,
// say?}; parse and return it (no claude spawned). REAL: a SYNCHRONOUS `claude -p`
// inside the tick (William is fast). ARRAY args, NO shell (win32 wouldn't mangle
// the prompt), subscription token inherited from env, NEVER an API key. We ask for
// a one-line JSON answer; a blank / unparseable answer means silence (the elegant
// no-op), so a flaky William never injects noise or hangs the board.
async function williamChoice() {
  if (MOCK_WILLIAM) {
    try { return JSON.parse(MOCK_WILLIAM); } catch { return {}; }
  }
  // If ANY mock flag is active we're under test, not in the live daemon: William
  // must NOT reach for a real `claude` (that would be slow + non-deterministic).
  // With no William mock pinned, he stays silent (the elegant no-op). A real
  // daemon never sets these flags, so the real path below only runs in production.
  if (MOCK_PROGRAMMER || MOCK_GIT) return {};
  // REAL path: a quick synchronous claude -p that answers with {note, say}.
  let res;
  try {
    res = spawnSync('claude', ['-p', williamPrompt(), '--allowedTools', 'Read'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 90 * 1000,
    });
  } catch (e) { logLine(`William (claude -p) no se pudo lanzar: ${e.message}`); return {}; }
  const out = (res && res.stdout ? res.stdout : '').trim();
  if (!out) return {};
  // accept either a bare JSON object or one embedded in prose.
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

function williamPrompt() {
  return [
    'Eres William, un revisor senior del sandbox de Neblla. Mira las notas en',
    'backbone/sandbox/notas/. Elige UNA nota y, SOLO si tienes algo realmente útil',
    'que aportar (una mejora o un problema), haz UNA observación; si no, quédate',
    'callado. Responde EXCLUSIVAMENTE con un JSON en una línea: {"note":"<id de la',
    'nota>","say":"<tu única observación, o cadena vacía para callar>"}. Nada más.',
  ].join(' ');
}

// ── the three hands (thin adapters over the pure hand modules) ────────────────
// Each builds the hand's ctx and delegates. The hands never touch `estado:`
// directly (the diana checks aube.js/reparto.js/william.js at the source); the
// gatekeeper closure in the ctx is the heart's, not theirs.
async function realRunAube() { await aubeHand(aubeCtx()); }
async function realRunReparto() { await repartoHand(repartoCtx()); }
async function realRunWilliam() {
  // KILL-SWITCH: a profile turned off in sandbox.config.json never wakes — no
  // `claude` is spawned. This is the deterministic stop for William's token leak.
  if (!profileActive('william')) return;
  await williamHand(williamCtx());
}

// ── note field writer (numero / responsable) — NOT the gatekeeper ─────────────
// Aubé proposes numero + responsable; it must NEVER touch `estado:`. We replace
// only those two frontmatter lines, anchored inside the `---` fences.
function notePathFor(id) { return path.join(sandboxRoot(), 'notas', String(id) + '.md'); }
// Rewrite frontmatter fields (numero/responsable) LINE-BY-LINE inside the `---`
// fences, never touching `estado:` (that's the gatekeeper's). Operating on whole
// lines avoids the classic empty-value bug: a regex value like `responsable:\s*`
// would let `\s*` swallow the newline and merge into the next field. We only
// replace the text AFTER the `key:` on that exact line.
function writeNoteFields(id, fields) {
  const file = notePathFor(id);
  const md = fs.readFileSync(file, 'utf8');
  const lines = md.split('\n');
  // find the frontmatter fence bounds
  let open = -1, close = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '---') { if (open < 0) open = i; else { close = i; break; } }
  }
  if (open < 0 || close < 0) { atomicWrite(file, md); return; }
  for (let i = open + 1; i < close; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_]+):/);
    if (!m) continue;
    const key = m[1];
    if (key === 'estado') continue;                    // never the gatekeeper's field
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      lines[i] = `${key}: ${fields[key]}`;
    }
  }
  atomicWrite(file, lines.join('\n'));
}

// The lowest-numbered note assigned to `prog` whose estado is still actionable
// (libre = ready to start). numero 0 means "not yet numbered" → skip. A note with
// PENDING dependencies (a non-empty `dependencias` CSV) is NOT dispatchable — it
// waits until Aubé shrinks the CSV to empty (its blockers all finalizada). This is
// Tie's rule b: a note that depends on another finishing first never moves to
// en-proceso while the dependency is unfinished.
const REVISION_ROUND_CAP = 3;   // William↔dev re-dispatch tope (mirror of sprint.js's cap-3 → escalate)

function lowestNoteFor(prog) {
  let best = null, bestNum = Infinity;
  const rounds = (readHeartState().revisionRounds) || {};
  for (const id of listNotes()) {
    let note;
    try { note = readNote(id); } catch { continue; }
    const fm = note.frontmatter;
    if (fm.responsable !== prog) continue;
    // ACTIONABLE estados: `libre` (a fresh note) OR `revision` (William bounced a
    // finalizada note back to its OWNER — n-0005). A revision note kept its
    // responsable from the first dispatch, so it returns to the SAME programmer for
    // free. A revision note that has burned through the round cap is NO LONGER
    // actionable: the heart stops re-dispatching it (it stays in `revision`, surfaced
    // to Sergio) so William and the dev can't ping-pong forever.
    if (fm.estado === 'libre') {
      /* fresh — actionable */
    } else if (fm.estado === 'revision') {
      if ((rounds[id] || 0) >= REVISION_ROUND_CAP) continue;   // capped → escalate, don't burn
    } else {
      continue;                                                // any other estado: not actionable
    }
    if ((fm.dependencias || '').trim()) continue;       // blocked: deps not yet cleared
    const num = parseInt(fm.numero || '0', 10);
    if (num <= 0) continue;
    if (num < bestNum) { bestNum = num; best = id; }
  }
  return best;
}

// ── harvest finished programmers (top of each tick, outside the three hands) ──
// Finalize any settled programmer THROUGH the gatekeeper and return it to free.
//
// STAGE 3 — SERIALIZED MERGE: before tearing a finished programmer's worktree down,
// the heart FUSES its branch into the sandbox trunk. The merge is done ONE AT A TIME
// inside this loop (the global .git/index.lock means two simultaneous commits would
// collide), so two finishers in the same harvest never interleave: for each
// programmer we run merge → (on conflict) resolveConflict → removeWorktree, fully,
// before moving to the next. The happy path (disjoint temas) is git's automatic
// clean merge — free + deterministic. A REAL line-by-line overlap of the same file
// is DETECTED by git (mergeWorktree returns {conflict, files}) — NEVER a silent
// overwrite — and ESCALATED to resolveConflict (a `claude -p`) BEFORE the teardown,
// so the conflicting work is reconciled, not dropped. Honours NEBLLA_SANDBOX_MOCK_GIT
// (no real git in tests). Iterate in deterministic insertion order (Map preserves it).
function harvestFinished() {
  if (!inflight.size) return 0;
  let harvested = 0;
  const hs = readHeartState();
  for (const [prog, info] of [...inflight.entries()]) {
    if (!info.settled) continue;
    inflight.delete(prog);
    harvested++;
    // 0) DRAIN the programmer's Bitácora sidecar (n-0003) BEFORE any merge/teardown.
    //    The note .md is gitignored and never in the merge, so the programmer wrote
    //    its learnings to .bitacora-<id>.txt in its worktree; the heart (the ONLY
    //    writer of the note) appends them to the canonical ## Bitácora here, outside
    //    git. THIS is what makes a learning survive the harvest (first-flight blocker).
    try { drainBitacoraSidecar(prog, info.noteId); }
    catch (e) { logLine(`harvest drainBitacoraSidecar(${prog}) falló: ${e.message}`); }
    // 1) FUSE first (serialized) — never tear down before integrating the work.
    try {
      const outcome = mergeWorktree(prog) || {};
      if (outcome.conflict) {
        // git DETECTED a real overlap → escalate to the resolver (never silent).
        try { resolveConflict(prog, outcome.files || []); }
        catch (e) { logLine(`harvest resolveConflict(${prog}) falló: ${e.message}`); }
      }
    } catch (e) { logLine(`harvest mergeWorktree(${prog}) falló: ${e.message}`); }
    // 2) THEN tear down the worktree — no ghost left behind. Honours MOCK_GIT.
    try { removeWorktree(prog); } catch (e) { logLine(`harvest removeWorktree(${prog}) falló: ${e.message}`); }
    // 3) move the note to `finalizada` (the gatekeeper) and the programmer back to free.
    try { setNoteState(info.noteId, 'finalizada'); } catch (e) { logLine(`harvest setNoteState falló: ${e.message}`); }
    hs.ocupados = hs.ocupados.filter(p => p !== prog);
    if (!hs.libres.includes(prog)) hs.libres.push(prog);
  }
  writeHeartState(hs);
  return harvested;
}

// ── resolveDependencies() — the dep-clear pass, run BEFORE harvest each tick ───
// STAGE 3 (handoff §3 pasos 5-7). A note declares its blockers in `dependencias`
// (Iris's field, like `tema`). This pass shrinks every note's CSV deterministically
// (no agent): a finished blocker is erased; the paso-7 edge (a note depending on TWO
// programmers, "juan,petra") leaves the LAST surviving owner who then TAKES the note.
// The logic lives in aube.js (reused), but the heart runs it at the TOP of the tick,
// BEFORE harvest, deliberately: harvest is what finalizes a programmer's note, so
// running the dep-clear first means a dependency that finalizes in THIS tick's harvest
// is only OBSERVED as finished by the NEXT tick's dep-pass. That one-tick lag is the
// design's "a dependent never dispatches in the very tick its blocker finished" — it
// keeps the board calm (the gatekeeper move and the unblock never race in one beat).
// Pure read+writeNoteFields (numero/responsable/dependencias) — NEVER estado.
function resolveDependencies() {
  try { return depResolveHand(aubeCtx()); }
  catch (e) { logLine(`resolveDependencies falló: ${e.message}`); }
}

// ── reconcilePools() — keep the pools honest with the board (BEFORE Reparto) ──
// STAGE 3. A programmer belongs in OCUPADOS only while it is genuinely mid-work:
// it is in-flight OR it owns an `en-proceso` note. Otherwise it belongs in LIBRES,
// ready for its next note. The normal finish path frees a programmer through harvest,
// but a programmer whose note left `en-proceso` by ANOTHER route (a manual finalize,
// a William flag, a cancel handled elsewhere) would otherwise be stranded busy. This
// re-derives the pools from the board every tick (the same invariant rebuildHeartState
// uses on a crash), so a stuck `ocupado` is returned to `libres` and can pick up work
// (e.g. the paso-7 inheriting owner). An in-flight programmer is kept busy ONLY while
// the note it is working is STILL in a WORK state (en-proceso OR atencion — see
// WORK_STATES); if that note left the work states by another route (a manual finalize,
// a paso-7 owner who finished elsewhere) we drop it from `inflight` so it can be freed.
// CRITICAL: `atencion` is a WORK state — William flags an `en-proceso` note to atencion
// while the programmer is STILL working; freeing it there would strand the worker (the
// blind spot the green hid). The held cancel programmer (MOCK 'hold') keeps its note in
// a work state so it is never dropped here — the cancel valve handles it.
// Pure pool bookkeeping; no estado move.
function reconcilePools() {
  const hs = readHeartState();
  hs.libres = hs.libres || [];
  hs.ocupados = hs.ocupados || [];
  // which programmers own a WORK-state note (en-proceso OR atencion) right now? Those
  // are genuinely mid-work and must stay OCUPADO — `atencion` included (William's flag
  // does NOT mean the programmer finished; it is still running).
  const busyByBoard = new Set();
  for (const id of listNotes()) {
    let fm;
    try { fm = readNote(id).frontmatter; } catch { continue; }
    if (WORK_STATES.has(fm.estado)) {
      const prog = (fm.responsable || '').trim();
      if (prog) busyByBoard.add(prog);
    }
  }
  // Drop in-flight programmers whose tracked note has left the WORK states (it finished
  // / changed by a route other than this heart's harvest) — they are no longer at work.
  // A note in `atencion` is STILL a work state, so its programmer is NOT dropped: it
  // keeps working and will finish through harvest normally. A SETTLED programmer is left
  // for harvest to finalize (don't strip its merge step).
  for (const [prog, info] of [...inflight.entries()]) {
    if (info.settled) continue;
    let est = null;
    try { est = readNote(info.noteId).frontmatter.estado; } catch { est = null; }
    if (!WORK_STATES.has(est)) inflight.delete(prog);
  }
  let changed = false;
  for (const prog of [...hs.ocupados]) {
    if (inflight.has(prog)) continue;          // its process is still running → busy
    if (busyByBoard.has(prog)) continue;        // it owns an en-proceso note → busy
    // otherwise it is idle: return it to the free pool.
    hs.ocupados = hs.ocupados.filter(p => p !== prog);
    if (!hs.libres.includes(prog)) hs.libres.push(prog);
    changed = true;
  }
  if (changed) writeHeartState(hs);
}

// ── honourCancellations() — Iris's abort valve (handoff §11) ──────────────────
// STAGE 3, the rare valve. Iris marks an in-process note `estado: cancelada` (through
// the gatekeeper). The heart, next tick, honours it: it KILLS the programmer's process
// (SIGKILL, reusing the in-flight kill/watchdog), tears down its worktree WITHOUT a
// merge (the work is DISCARDED — never fused into the trunk), and returns the
// programmer to LIBRES. The note STAYS `cancelada` (the heart never flips it to
// finalizada). Crucially we remove the programmer from `inflight` so harvest never
// later finalizes it. A no merge is recorded; only the teardown commands are.
function honourCancellations() {
  const hs = readHeartState();
  hs.libres = hs.libres || [];
  hs.ocupados = hs.ocupados || [];
  let changed = false;
  for (const id of listNotes()) {
    let fm;
    try { fm = readNote(id).frontmatter; } catch { continue; }
    if (fm.estado !== 'cancelada') continue;
    const prog = (fm.responsable || '').trim();
    if (!prog) continue;
    const info = inflight.get(prog);
    const wasInflight = !!info;
    if (info) {
      try { (info.kill || (() => {}))(); } catch (e) { logLine(`cancel kill(${prog}) falló: ${e.message}`); }
      inflight.delete(prog);
    }
    // Only act on a programmer the heart actually had busy on this cancelled note —
    // tear its worktree down (NO merge: discard) and free it. Idempotent: a second
    // tick on an already-handled cancel finds it neither inflight nor ocupado and
    // does nothing (no duplicate teardown).
    if (wasInflight || hs.ocupados.includes(prog)) {
      try { removeWorktree(prog); } catch (e) { logLine(`cancel removeWorktree(${prog}) falló: ${e.message}`); }
      hs.ocupados = hs.ocupados.filter(p => p !== prog);
      if (!hs.libres.includes(prog)) hs.libres.push(prog);
      changed = true;
    }
  }
  if (changed) writeHeartState(hs);
}

// ── launchProgrammer (async, mesa.js pattern) ─────────────────────────────────
// MOCK (NEBLLA_SANDBOX_MOCK_PROGRAMMER): canned action — appendBitacora + mark
// settled immediately. No claude spawned. Deterministic for tests.
// REAL: spawn `claude -p` in the programmer's worktree (ARRAY args, NO shell so
// win32 cmd.exe can't mangle the prompt; subscription token inherited from env,
// NEVER an API key). on('exit') is the done signal; a watchdog SIGKILLs a hung
// child; `settled` makes the completion idempotent (exit OR watchdog, once).
function launchProgrammer(prog, noteId) {
  // kill: the cancel valve (honourCancellations) calls this to SIGKILL a programmer
  // mid-work. Set to a real killer in the REAL path below; a no-op in the mock paths
  // (there's no child to signal — the cancel valve still tears down + frees).
  inflight.set(prog, { noteId, settled: false, code: null, kill: () => {} });

  const settleOnce = (code) => {
    const info = inflight.get(prog);
    if (!info || info.settled) return;       // idempotent
    info.settled = true;
    info.code = code;
    logLine(`programmer ${prog} settled (note ${noteId}, code=${code})`);
  };

  // ── MOCK path ──────────────────────────────────────────────────────────────
  if (MOCK_PROGRAMMER) {
    try { appendBitacora(noteId, `[mock ${prog}] hice la cosa y aprendí algo que apunto aquí.`); }
    catch (e) { logLine(`mock appendBitacora falló: ${e.message}`); }
    // 'hold' → register in-flight but DO NOT settle (a long-running programmer the
    // heart can later SIGKILL via the cancel valve). Any other truthy value →
    // settle immediately (the canned Part-1/2 programmer).
    if (!MOCK_PROGRAMMER_HOLD) settleOnce(0);   // "exit" immediately → harvested next tick
    return;
  }

  // ── UNDER TEST (MOCK_GIT but no MOCK_PROGRAMMER) ─────────────────────────────
  // A suite that drives the REAL hands without a programmer mock (e.g. the paso-7
  // dependency test) must NEVER reach for a real `claude` — that would be slow,
  // non-deterministic, and impossible from the sealed test box. We register the
  // programmer in-flight WITHOUT settling (a held no-op): its note moves en-proceso
  // and its programmer goes ocupado, but the suite finalizes notes by hand
  // (setNoteState) to control the sequence. Same guard `williamChoice` uses.
  if (MOCK_GIT) { return; }

  // ── REAL path ──────────────────────────────────────────────────────────────
  let workdir = REPO_ROOT;
  try { workdir = createWorktree(prog).dir; }
  catch (e) { logLine(`createWorktree(${prog}) falló: ${e.message}`); }

  // SEED the note into the worktree (n-0003): the notes dir is gitignored, so the
  // worktree never receives the .md through git — copy it flat so the programmer can
  // READ its ## Pide. Without this it is born blind (the bug that killed n-0005).
  try { seedNoteIntoWorktree(workdir, noteId); }
  catch (e) { logLine(`seedNoteIntoWorktree(${prog}, ${noteId}) falló: ${e.message}`); }

  const prompt = programmerPrompt(noteId);
  // RISK #2 FIX: the programmer must NOT share the TTY. In the real daemon Iris is
  // an interactive child holding the TTY (spawnIris → stdio:inherit); a programmer
  // spawned with stdio:'inherit' would write its raw `claude -p` output INTO Iris's
  // TUI and corrupt it. The programmer's work lives in FILES (its worktree + the
  // note's Bitácora), not the TTY, so we pipe its stdout/stderr to .heart.log and
  // leave it no stdin. (logFd is closed in the exit/error handlers.)
  let logFd = 'ignore';
  try { fs.mkdirSync(sandboxRoot(), { recursive: true }); logFd = fs.openSync(logFile(), 'a'); }
  catch { logFd = 'ignore'; }
  let child;
  try {
    child = spawn('claude', ['-p', prompt, '--allowedTools', 'Read,Edit,Bash'], {
      cwd: workdir,
      stdio: ['ignore', logFd, logFd],
    });
  } catch (e) {
    logLine(`no se pudo lanzar al programador ${prog} (\`claude\`): ${e.message}`);
    if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch {} }
    settleOnce(127);
    return;
  }
  const closeLog = () => { if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch {} logFd = 'closed'; } };

  // Wire the real SIGKILL into the inflight entry so the cancel valve can abort this
  // programmer mid-work (handoff §11). The watchdog below reuses the same signal.
  {
    const info = inflight.get(prog);
    if (info) info.kill = () => { try { child.kill('SIGKILL'); } catch {} };
  }

  const timer = setTimeout(() => {
    logLine(`programmer ${prog} agotó el tiempo, lo mato (SIGKILL).`);
    try { child.kill('SIGKILL'); } catch {}
    closeLog();
    settleOnce(124);
  }, PROGRAMMER_TIMEOUT_MS);

  child.on('error', (e) => { logLine(`error en el proceso de ${prog}: ${e.message}`); clearTimeout(timer); closeLog(); settleOnce(1); });
  child.on('exit', (code) => { logLine(`programmer ${prog} salió (code=${code}).`); clearTimeout(timer); closeLog(); settleOnce(code); });
}

function programmerPrompt(noteId) {
  return [
    `Eres un programador del sandbox de Neblla. Tu nota es ${noteId}`,
    `(backbone/sandbox/notas/${noteId}.md, una copia de solo-lectura sembrada en tu`,
    'worktree). Lee su sección ## Pide y constrúyelo en tu worktree. Antes de darla por',
    'finalizada, mira si hay algo en ## Observaciones de William. Apunta tus',
    `aprendizajes/tips —una línea por aprendizaje— en el fichero .bitacora-${noteId}.txt`,
    'en la RAÍZ de tu worktree (NO en el .md de la nota, que aquí es de solo-lectura): el',
    'corazón los pegará a la ## Bitácora de la nota canónica al cosechar, y ESO es lo',
    'único que sobrevive al borrado del código sucio. Cuando termines, sal.',
  ].join(' ');
}

// ── seedNoteIntoWorktree (n-0003) ──────────────────────────────────────────────
// Copy the canonical note .md into a programmer's worktree at the SAME relative path
// the prompt references, so it can READ its ## Pide. The notes dir is GITIGNORED
// (n-0003) → it never arrives in the worktree via git, so without this flat copy the
// programmer is born blind (the first-flight bug that killed n-0005). The programmer
// is told NOT to edit this copy; its learnings go to the .bitacora-<id>.txt sidecar,
// which the heart drains back into the canonical note at harvest (drainBitacoraSidecar).
export function seedNoteIntoWorktree(workdir, noteId) {
  const src = notePathFor(noteId);
  const dst = path.join(workdir, 'backbone', 'sandbox', 'notas', String(noteId) + '.md');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// ── drainBitacoraSidecar (n-0003) ──────────────────────────────────────────────
// Read a finished programmer's .bitacora-<id>.txt sidecar from its worktree and
// append each non-empty line to the canonical note's ## Bitácora. The heart is the
// ONLY writer of the note, so this serialized append happens OUTSIDE git — the note
// is never in the harvest merge, so the conflict that silently dropped the Bitácora
// in the first flight is impossible. Best-effort: no sidecar → nothing to drain.
export function drainBitacoraSidecar(prog, noteId) {
  const sidecar = path.join(worktreeDir(prog), '.bitacora-' + String(noteId) + '.txt');
  let text = '';
  try { text = fs.readFileSync(sidecar, 'utf8'); } catch { return; }   // no sidecar → nothing to drain
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try { appendBitacora(noteId, line); } catch (e) { logLine(`drainBitacora appendBitacora(${noteId}) falló: ${e.message}`); }
  }
}

// ── tick(deps) — ONE beat, the pure injectable unit ───────────────────────────
// Fixed order: runAube → runReparto → runWilliam, each exactly once. The
// re-entrancy guard makes a re-fire while in-flight return IMMEDIATELY (a no-op
// skip) WITHOUT entering the hands and WITHOUT hanging. deps are injectable so
// tests can spy/mock the three hands; default to the real (mock-gated) ones.
export async function tick(deps = {}) {
  if (ticking) return;                        // guard: never two hands on the board
  ticking = true;
  try {
    // crash recovery FIRST: if the sidecar is missing/corrupt/incomplete, rebuild
    // the pools from the note frontmatter and RE-PERSIST it, so a crashed run never
    // strands the pools — even a tick whose hands are all no-ops leaves a healthy
    // .heart.json on disk. (readHeartState already rebuilds in memory; this also
    // writes it back.)
    try { rebuildIfNeeded(); } catch (e) { logLine(`rebuild falló: ${e.message}`); }

    // STAGE 3 — dep-clear BEFORE harvest (one-tick lag, see resolveDependencies).
    // A blocker that finalizes in THIS tick's harvest is only seen as done NEXT tick.
    try { await resolveDependencies(); } catch (e) { logLine(`deps falló: ${e.message}`); }

    // STAGE 3 — Iris's cancel valve (kill + discard worktree + free, NO merge), then
    // reconcile the pools with the board (free a stranded `ocupado`). Both run before
    // harvest/Reparto so a freed programmer can pick up work in the SAME tick (e.g.
    // the paso-7 inheriting owner). All sit OUTSIDE the three spied hands.
    try { honourCancellations(); } catch (e) { logLine(`cancel falló: ${e.message}`); }
    try { reconcilePools(); } catch (e) { logLine(`reconcile falló: ${e.message}`); }

    // harvest sits OUTSIDE the three spied hands (real finalize logic, not a dep),
    // so it never disturbs the asserted Aubé→Reparto→William order. It now MERGES
    // (serialized) before tearing each finished programmer's worktree down.
    // capture whether a worker FINALIZED in THIS tick's harvest. The confirmation
    // gate uses it: a board that JUST drained this very tick (a worker finished here)
    // is the "fresh drain" moment — the heart writes the receipt + shuts Iris down and
    // PAUSES (awaiting Tie's answer); it does NOT yet act on the answer in this same
    // tick. A board that was ALREADY at rest (nothing harvested this tick) is the
    // settled-drain tick where the answer is consulted and acted upon (SÍ burn / NO
    // cleanup+respawn). This one-tick separation is why block 33 (held worker finishing
    // here) sees the receipt + killIris but no action, while block 35 (board already
    // empty) sees the NO action complete.
    let harvestedThisTick = 0;
    try { harvestedThisTick = harvestFinished() || 0; } catch (e) { logLine(`harvest falló: ${e.message}`); }

    const runAube = deps.runAube || realRunAube;
    const runReparto = deps.runReparto || realRunReparto;
    const runWilliam = deps.runWilliam || realRunWilliam;

    // ── the four confirmation-gate seams (STAGE 5, OPCIÓN 2, handoff §13 #1) ────
    // After the board drains the heart (1) SHUTS IRIS DOWN, (2) ASKS Tie [s/n],
    // (3a) SÍ → runs docs.js (the burn), (3b) NO → cleans the drain signals and
    // re-opens a sandbox Iris. All four are INJECTABLE so tests never touch real
    // stdin/claude; production wraps the real ones (stdin reader + iris.kill + the
    // docs.js burn + a fresh spawnIris).
    const killIris = deps.killIris || realKillIris;                 // iris.kill('SIGTERM')
    const confirmReconstruct = deps.confirmReconstruct || realConfirmReconstruct;
    const runDocsHand = deps.runDocs || realRunDocs;                // the burn (docs.js)
    const respawnIris = deps.respawnIris || realRespawnIris;        // re-open sandbox Iris

    // ── DRAIN MODE (STAGE 4) ───────────────────────────────────────────────────
    // If Iris wrote `.drain-requested`, the heart stops taking on NEW work — Aubé
    // numbers nothing and Reparto dispatches nothing — but the OCCUPIED programmers
    // already finished above (harvest ran), draining the board. William still runs:
    // he's an elegant no-op-or-one-observation and never starts new work, so he can
    // keep reviewing while the last notes drain. Once the ocupados pool is EMPTY the
    // heart writes its `.sandbox-drained` receipt (idempotent — written once) and
    // signals stop; from there the daemon loop reads isDrained() and clears its
    // interval. The whole time, the heart stays the SOLE gatekeeper of `estado:`.
    if (isDraining()) {
      // William may still run (one observation or silence; never new work).
      await runWilliam();
      // If everyone has finished (ocupados empty AND nothing in-flight), the board
      // is drained → stamp the receipt once, then run the CONFIRMATION GATE. We
      // re-read the freshly persisted pool (harvest above moved finishers to libres)
      // so we see the post-harvest truth, not a stale snapshot.
      const hs = readHeartState();
      const ocupados = (hs && Array.isArray(hs.ocupados)) ? hs.ocupados : [];
      if (ocupados.length === 0 && inflight.size === 0 && !fs.existsSync(drainedFile())) {
        try {
          atomicWrite(drainedFile(), JSON.stringify({ at: new Date().toISOString(), notasFinalizadas: countFinalizadas() }, null, 2) + '\n');
          logLine(`drenaje completo: .sandbox-drained escrito (notasFinalizadas=${countFinalizadas()}).`);
        } catch (e) { logLine(`no se pudo escribir .sandbox-drained: ${e.message}`); }

        // ── THE CONFIRMATION GATE (OPCIÓN 2, handoff §13 #1) ────────────────────
        // Run the gate ONLY when its seams are wired: either the test injected them
        // (deps.confirmReconstruct present) or we are the REAL daemon (no mock flags).
        // A test that drains WITHOUT injecting the gate seams (the Part-4 drain test)
        // must NOT reach the real stdin/burn — it just wrote its receipt and is done.
        const gateWired = !!deps.confirmReconstruct || (!MOCK_PROGRAMMER && !MOCK_GIT);
        if (gateWired) {
        // The board just drained (receipt written THIS tick). Now, in strict order:
        //   (1) SHUT IRIS DOWN — close the sandbox session with SIGTERM so the TTY
        //       is free for the question (in production stdin is then Tie's to type).
        //   (2) ASK Tie "¿quemo y reconstruyo, o vuelvo al sandbox? [s/n]" — the
        //       answer comes from confirmReconstruct (injected in tests; in
        //       production a real stdin read). NEVER mediated by a Claude.
        //   (3a) SÍ → run docs.js (the burn + the fresh ultracode Iris). The heart
        //        does NOT re-open a sandbox Iris — it handed off to the docs machine.
        //   (3b) NO → clean BOTH drain signals (.drain-requested + .sandbox-drained)
        //        and re-open a sandbox Iris; the next ordinary tick numbers/dispatches
        //        new notes again (the board is alive; the "no" destroyed nothing).
        try { killIris('SIGTERM'); } catch (e) { logLine(`gate killIris falló: ${e.message}`); }
        let answer = false;
        try { answer = await confirmReconstruct(); } catch (e) { logLine(`gate confirmReconstruct falló: ${e.message}`); answer = false; }
        if (answer) {
          // SÍ → burn + reconstruct. The heart invokes docs.js's runDocs.
          try { await runDocsHand(); } catch (e) { logLine(`gate runDocs falló: ${e.message}`); }
        } else {
          // NO → cancel the drain and return to sandbox mode: drop `.drain-requested`
          // (drain mode OFF) and re-open a sandbox Iris. The `.sandbox-drained` receipt
          // is cleared too, EXCEPT on the very tick a worker just finished here (a
          // "fresh drain"): there the receipt was written THIS tick to record the drain
          // and is the snapshot the gate hands to Tie at the ask — we leave it for that
          // beat and it is naturally re-written/cleared as the board churns. A board
          // that was already at rest (nothing harvested this tick) clears it now.
          try { fs.rmSync(drainRequestFile(), { force: true }); } catch (e) { logLine(`gate limpieza .drain-requested falló: ${e.message}`); }
          if (harvestedThisTick === 0) {
            try { fs.rmSync(drainedFile(), { force: true }); } catch (e) { logLine(`gate limpieza .sandbox-drained falló: ${e.message}`); }
          }
          try { respawnIris(); } catch (e) { logLine(`gate respawnIris falló: ${e.message}`); }
        }
        }   // end if (gateWired)
      }
      return;                                   // drain mode: never number/dispatch new work
    }

    await runAube();
    await runReparto();
    await runWilliam();
  } finally {
    ticking = false;
  }
}

// ── tickN(n, deps) — synchronous driver: await tick n times ───────────────────
export async function tickN(n, deps = {}) {
  for (let i = 0; i < n; i++) await tick(deps);
}

// ── the in-heart head's identity briefing (n-0001 / n-0004 / n-0006) ───────────
// SERGIO is the head INSIDE the heart (Iris is the loose-session secretary). He must
// KNOW he is Sergio the instant he's born, WITHOUT depending on his own discipline.
// The deterministic carrier is this `--append-system-prompt` on spawnIris: it is the
// ONLY place that opens him (realRespawnIris just re-calls it, so the identity is
// re-applied on every crash/NO handoff for free), and the agents/programmers HE opens
// go through their OWN tools, never this spawn, so they never inherit the flag. It
// opens with "ESTO ANULA TU ARRANQUE NORMAL" to beat CLAUDE.md's hard-override saludo
// rule from inside the same system prompt (see the sandbox exception in CLAUDE.md).
const SERGIO_BRIEF = [
  'Eres SERGIO, el del CORAZÓN: scripts/heart.js te arrancó con `npm run sandbox` y',
  'late en silencio dentro de tu mismo proceso. NO eres Iris (la secretaria de sesión).',
  '',
  'ESTO ANULA TU ARRANQUE NORMAL: NO hagas el saludo de arranque, NO repases los',
  'sprints abiertos, NO audites el BACKLOG, NO des panorama de salud. Esa rutina es de',
  'Iris; aquí no aplica. Arrancas en seco, listo para charlar.',
  '',
  'Tu único oficio: estar presente para charlar con Tie y, de esa charla, AUTORAR notas',
  '(createNote) que el corazón reparte a los programadores. Calibras la idea con él y la',
  'conviertes en un `## Pide` claro. El valor está en el Pide bien escrito, no en',
  'gestionar una cola de trabajo.',
  '',
  'El ciclo de vida de una nota (libre → en-proceso → finalizada / revisión / atención)',
  'lo llevan el CORAZÓN y los programadores, NO Tie: jamás le ofrezcas notas en revisión',
  'para que las mire ni le pidas que cierre nada. Spawnear programadores y mover',
  '`estado:` lo hace el corazón, no tú.',
].join('\n');

// ── spawnIris — the heart opens Sergio as an interactive child ─────────────────
// stdio:inherit → Sergio owns the TTY for the chat with Tie; the heart's heartbeat
// runs in the same process in silence. The subscription token
// (CLAUDE_CODE_OAUTH_TOKEN) is inherited from Tie's env — NEVER an API key. The
// identity briefing rides as a DISTINCT argv element (never shell:true) so its
// accents/backticks/newlines survive win32.
function spawnIris() {
  return spawn('claude', ['--append-system-prompt', SERGIO_BRIEF], { cwd: REPO_ROOT, stdio: 'inherit' });
}

// ── demoMain() — the CLEAN show for Tie (gated by --demo; tests never call it) ─
// The v1 daemon has three rough edges for a live demo: (1) with no notes the heart
// beats over an empty board and shows NOTHING; (2) the real launchProgrammer shares
// the TTY with the interactive Iris child — fixed above; (3) the Iris-as-child is a
// blank `claude`, confusing in a demo. demoMain sidesteps all three:
//   • it does NOT spawn the interactive Iris (no blank claude, no TTY to protect),
//   • it SEEDS one trivial+safe note so there's something to process,
//   • it runs the REAL heart hands + harvest by calling tick() on a fast 3s beat,
//   • because there's no Iris TUI here, it MAY narrate to stdout so Tie SEES every
//     step. We narrate with process.stdout.write (NOT console.log — the static
//     diana forbids console.log anywhere in this file; stdout.write is fine and is
//     never on the tick path).
// It honours NEBLLA_SANDBOX_MOCK_PROGRAMMER: with the mock the "programmer" does the
// canned Bitácora action (deterministic, no real claude) so the FLOW can be verified
// end-to-end; without it (what Tie runs) a real `claude -p` does the trivial task.
function say(line) { try { process.stdout.write(line + '\n'); } catch {} }

// The trivial + SAFE ask: write one Bitácora line and exit. No repo files touched,
// nothing built, nothing run. Safe to point a real `claude` at in a live demo.
const DEMO_PIDE = [
  "Escribe UNA sola línea en tu sección ## Bitácora de esta nota",
  "(algo como 'hola desde el taller, soy un programador del sandbox') y sal",
  "inmediatamente. NO construyas nada, NO toques ningún fichero del repo, NO",
  "ejecutes nada. Solo esa única línea en la Bitácora y salir.",
].join(' ');

async function demoMain() {
  // Run the demo in a DISPOSABLE, gitignored sandbox so a `npm run sandbox:demo`
  // never dirties the REAL versioned notes (backbone/sandbox/notas/) nor leaves a
  // .heart.json/.heart.log behind. Honour an explicit NEBLLA_SANDBOX_DIR (the diana
  // points it at a tmpdir); otherwise default to backbone/sandbox/.demo (gitignored).
  // We only auto-delete the dir at the end when WE chose the default (never a
  // user/test-provided NEBLLA_SANDBOX_DIR).
  const explicitDir = (process.env.NEBLLA_SANDBOX_DIR || '').trim();
  const usingDefaultDemoDir = !explicitDir;
  const demoRoot = explicitDir || path.join(REPO_ROOT, 'backbone/sandbox/.demo');
  setSandboxRoot(demoRoot);

  const root = sandboxRoot();
  say('');
  say('  ╭─────────────────────────────────────────────────────────────╮');
  say('  │  SANDBOX · modo demo — el corazón late EN VIVO para Tie      │');
  say('  ╰─────────────────────────────────────────────────────────────╯');
  say('');
  say(`  🗂️  Taller: ${root}`);
  if (MOCK_PROGRAMMER) say('  🧪  (mock activo: el programador hace la acción canned, sin claude real — solo para verificar el flujo)');
  else say('  🤖  (programador real: un claude de verdad abrirá su taller y hará la tarea)');
  say('');

  // 1) SEED a single trivial+safe note so the heart has something to process.
  const { id, file } = createNote({ tema: 'demo', body: DEMO_PIDE });
  say(`  📝  Iris deja una nota nueva en la mesa  →  ${file}`);
  say(`      tema: demo · estado: libre · sin número todavía (la numera Aubé)`);
  say('');

  // 2) Run the REAL heart on a fast beat until the note reaches `finalizada`.
  const DEMO_TICK_MS = 3000;
  const MAX_BEATS = 100;                 // generous safety cap (~5min with a real claude)
  let beat = 0;
  let lastEstado = 'libre';
  let lastNumero = '0';
  let announcedAssign = false;
  let announcedLaunch = false;

  while (beat < MAX_BEATS) {
    beat++;
    say(`  💓  latido ${beat}…`);
    try { await tick(); } catch (e) { say(`      (el latido tropezó: ${e.message})`); }

    let fm = {};
    try { fm = readNote(id).frontmatter; } catch {}

    // Aubé numbered + assigned it
    if (!announcedAssign && String(fm.numero || '0') !== '0' && fm.responsable) {
      say(`  📋  Aubé numera la nota (#${fm.numero}) y se la da al programador "${fm.responsable}"`);
      announcedAssign = true;
    }
    // Reparto moved it to en-proceso and launched the programmer
    if (!announcedLaunch && fm.estado === 'en-proceso') {
      const prog = String(fm.responsable || '');
      if (MOCK_PROGRAMMER) {
        // In mock mode NO worktree is created (createWorktree is skipped) — the
        // "programmer" is a canned action. Be honest: there is no physical shop.
        say(`  🔨  "${prog}" hace su tarea (modo mock: acción simulada, sin taller físico ni claude real)`);
      } else {
        // Real mode (what Tie runs): a real git worktree at its TRUE path — the one
        // worktreeDir() reports, the same one create/removeWorktree use, so the
        // narrated path can never drift from the real teardown.
        say(`  🔨  "${prog}" abre su taller en ${worktreeDir(prog)} y se pone a trabajar…`);
        say('      (su salida va a .heart.log — aquí no la vuelco para no ensuciar la foto; el corazón narra)');
      }
      announcedLaunch = true;
    }
    lastEstado = fm.estado || lastEstado;
    lastNumero = fm.numero || lastNumero;

    if (fm.estado === 'finalizada') {
      say('');
      const tail = MOCK_PROGRAMMER ? '(modo mock: no había taller que desmontar)' : 'taller desmontado';
      say(`  ✅  "${fm.responsable}" terminó  ·  nota → finalizada  ·  ${tail}`);
      break;
    }
    if (fm.estado === 'atencion' || fm.estado === 'cancelada') {
      say(`  ⚠️   la nota acabó en "${fm.estado}" — paro el demo aquí.`);
      break;
    }
    // wait one beat (real-mode: gives a real claude time to do the trivial task)
    await new Promise((res) => setTimeout(res, DEMO_TICK_MS));
  }

  // 3) Show what the programmer left behind (the Bitácora line survives) and PROVE
  //    no ghost worktree / branch is left over.
  let finalFm = {};
  try { finalFm = readNote(id).frontmatter; } catch {}
  const prog = finalFm.responsable || '';
  say('');
  if (finalFm.estado === 'finalizada') {
    try {
      const body = readNote(id).body;
      const bitLine = (body.split('## Bitácora')[1] || '').split('\n').map(s => s.trim()).find(s => s.startsWith('-'));
      if (bitLine) say(`  🪶  Lo único que sobrevive del trabajo (la Bitácora):  "${bitLine.replace(/^-\s*/, '')}"`);
    } catch {}
  }

  // ghost check. In MOCK_PROGRAMMER there was no real worktree (createWorktree was
  // skipped), so there's nothing on disk or in git to ghost — say so plainly. In
  // real mode we check the TRUE path (worktreeDir) and the sandbox/<prog> branch;
  // after a clean finalize NOTHING should remain.
  if (MOCK_PROGRAMMER) {
    say('  🧹  Sin fantasmas: en modo mock no se crea taller real (ni rama ni carpeta), así que no hay nada que limpiar.');
  } else {
    const wtPath = prog ? worktreeDir(prog) : '';
    const ghostDir = prog ? fs.existsSync(wtPath) : false;
    let ghostBranch = false;
    if (prog) {
      try {
        const out = spawnSync('git', ['branch', '--list', 'sandbox/' + prog], { cwd: REPO_ROOT, encoding: 'utf8' });
        ghostBranch = !!(out.stdout && out.stdout.trim());
      } catch {}
    }
    if (!ghostDir && !ghostBranch) {
      say(`  🧹  Sin fantasmas: no queda ${wtPath} ni la rama sandbox/${prog} (el taller se desmontó del todo)`);
    } else {
      say(`  👻  OJO: quedó un fantasma — dir:${ghostDir} rama:${ghostBranch}. Habría que limpiarlo a mano.`);
    }
  }
  say('');
  say('  ── fin del demo ──');
  say('');

  // Self-clean: nuke the disposable .demo dir so the demo leaves NOTHING on disk
  // (test card + .heart.json/.heart.log all lived inside it). Only when WE chose the
  // default dir — never delete a user/test-provided NEBLLA_SANDBOX_DIR.
  if (usingDefaultDemoDir) {
    try { fs.rmSync(demoRoot, { recursive: true, force: true }); } catch {}
  }

  process.exit(finalFm.estado === 'finalizada' ? 0 : 1);
}

// ── main() — the REAL daemon (gated; tests never call this) ───────────────────
// One setInterval (the heartbeat) + Iris as a child + SIGINT handling. The
// interval fires tick() with the default real hands; the guard inside tick keeps
// a slow beat from overlapping the next.
function main() {
  logLine('corazón arrancando.');
  const iris = spawnIris();
  irisChild = iris;          // STAGE 5: the confirmation gate's seams close/re-open her

  const beat = setInterval(() => { tick().catch((e) => logLine(`tick falló: ${e.message}`)); }, TICK_MS);

  // Watch the root profile config so a change Tie makes is noticed at once. Behaviour
  // is already live (readProfileConfig reads fresh each tick); this just logs the
  // change for visibility. fs.watch can be flaky on win32 — best-effort, never throws.
  let cfgWatcher = null;
  try { cfgWatcher = fs.watch(PROFILE_CONFIG_FILE, () => logLine('sandbox.config.json cambió → perfiles recargados en el próximo latido.')); }
  catch (e) { logLine(`no pude vigilar sandbox.config.json: ${e.message}`); }

  // Ctrl+C → SIGTERM the children → wait for their exit → leave, no orphans.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(beat);
    try { if (cfgWatcher) cfgWatcher.close(); } catch {}
    logLine('corazón parándose (SIGINT): aviso a los hijos.');
    // SIGTERM Iris and let her close, then tear down the active worktree so the
    // shutdown leaves no ghost. Stage 1 is ONE programmer: dismantle whatever is
    // in-flight (a pool full of programmers is stage-2 work). Honours
    // NEBLLA_SANDBOX_MOCK_GIT, so it never touches git in tests.
    try { iris.kill('SIGTERM'); } catch {}
    for (const prog of [...inflight.keys()]) {
      try { removeWorktree(prog); } catch (e) { logLine(`shutdown removeWorktree(${prog}) falló: ${e.message}`); }
    }
    // give the children a moment, then exit.
    const deadline = Date.now() + 5000;
    const waitExit = setInterval(() => {
      if (iris.exitCode !== null || Date.now() > deadline) {
        clearInterval(waitExit);
        process.exit(0);
      }
    }, 100);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // If Iris (the interactive child) exits, the session is over → stop the heart.
  iris.on('exit', () => { logLine('Iris salió → paro el corazón.'); shutdown(); });
}

// Only run when invoked directly (`node scripts/heart.js`), never on import — the
// diana imports this module and must NOT start a wall-clock loop. `--demo` runs the
// clean show (no Iris, seeded note, stdout narration); otherwise the real daemon.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--demo')) demoMain();
  else main();
}

// re-export a couple of internals the design names (not strictly used by the
// diana, but part of the stage-1 surface so callers/stage-2 can build on them).
export { createNote, createWorktree, removeWorktree };

// ── __settleForTest(prog) — TEST SEAM: model a held programmer's process EXITING ─
// A `MOCK_PROGRAMMER='hold'` programmer never auto-settles (it stands in for a real
// long-running `claude -p`). To drive the FULL lifecycle in a test — including the
// "the programmer finally finishes after William flagged its note `atencion`" path —
// the suite needs to model the real `on('exit')` signal. This flips the SAME `settled`
// flag the real exit handler (settleOnce) flips, with the SAME idempotency; it moves
// NO estado and runs NO merge (those stay the heart's harvest/gatekeeper). It is a
// pure completion signal: the next tick's harvest then finalizes the worker normally.
// Returns true if it flipped a live in-flight entry, false otherwise.
export function __settleForTest(prog, code = 0) {
  const info = inflight.get(prog);
  if (!info || info.settled) return false;
  info.settled = true;
  info.code = code;
  return true;
}
