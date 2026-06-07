// tests/24-sandbox-heart.test.js
//
// The DIANA (Ana Liz) for STAGE 1 of the sandbox machine — the "corazón"
// (heart daemon), its notes round-trip and the worktree plumbing. This is the
// target Miguel builds toward; the modules and functions it references DO NOT
// EXIST YET — this suite IS the contract that fixes their shapes.
//
// Like 22-sprint-orchestrator, this is a pure static / process-level suite:
//   • needsServer = false — no `node app.js`, no Mongo, no network.
//   • 100% DETERMINISTIC — no real `claude` is ever spawned, no real git
//     worktree/junction is created, no real deploy. Everything that would touch
//     the outside world is replaced by an env-gated mock the production code
//     MUST honour (part of the contract below).
//   • the heartbeat's setInterval is NEVER started. Stage-1 drives the heart by
//     IMPORTING a pure, injectable `tick(deps)` and a synchronous `tickN(n,deps)`
//     driver and calling them by hand. The loop is real code; we just never let
//     it tick on a wall-clock timer inside a test.
//   • we assert ON DISK — the note's frontmatter (parsed with the SAME
//     frontmatter grammar as scripts/sprint.js) and the heart's `.heart.json` —
//     NEVER by scraping stdout. The heartbeat writes only to files/log, never to
//     stdout (it must not corrupt Iris's TUI which owns the TTY via stdio:inherit).
//
// ── THE CONTRACT (what Miguel must build to make this green) ──────────────────
//
// MODULE PATHS (exact):
//   • scripts/sandbox/notes.js   — the note as a frontmatter `.md` (the card).
//   • scripts/sandbox/worktrees.js — git worktree plumbing (mocked here).
//   • scripts/heart.js           — the daemon: one clock, three hands, the sole
//                                  gatekeeper of a note's `estado:`.
//
// ENV HOOKS the production code MUST expose (so tests can isolate + mock):
//   • NEBLLA_SANDBOX_DIR — override the sandbox root to a per-test tmpdir.
//     Everything (notas/, .heart.json) lives under it; nothing escapes the tmp.
//   • NEBLLA_SANDBOX_MOCK_PROGRAMMER — when set, launchProgrammer() performs a
//     CANNED action (appendBitacora + immediate "exit") instead of spawning a
//     real `claude -p`. Lets us drive a note's whole lifecycle with no agent.
//   • NEBLLA_SANDBOX_MOCK_GIT — when set, worktrees.js SIMULATES
//     createWorktree/removeWorktree/mergeWorktree on disk (a plain dir + a
//     recorded command log) instead of running git / making a junction.
//   • NEBLLA_SANDBOX_MOCK_WILLIAM — STAGE 2. When set, William's hand does NOT
//     spawn the synchronous `claude -p`; instead it reads this env var as a JSON
//     literal {note?: <id>, say?: <string>} and acts on it deterministically:
//        - `note`  → the note William chooses this tick (instead of "at random").
//                    If absent, William picks deterministically (lowest id) — but
//                    every Stage-2 test pins it so the suite is hermetic.
//        - `say`   → the SINGLE observation he appends (appendWilliam). If `say`
//                    is absent / '' → William STAYS SILENT (the elegant no-op):
//                    no observation, the note is untouched by William's prose.
//        - In BOTH cases the heart (the gatekeeper) may still move the chosen
//          note's estado: finalizada→revision, en-proceso→atencion. William only
//          PROPOSES (appends); the estado move is the heart's hand, never his.
//        - NEVER more than ONE appendWilliam per tick (the elegance invariant).
//
// ── STAGE 2 (PART 2 of this suite) ────────────────────────────────────────────
// Part 1 (above) fixed the skeleton (one clock, gatekeeper, one note/one
// programmer, notes & worktree plumbing). Part 2 fattens the three hands into the
// real factory and fixes those shapes for Miguel. It shares the SAME suite, the
// SAME isolation (per-test tmpdir + loadFresh), the SAME "assert on disk" rule,
// and needsServer stays false. Nothing in Part 1 is changed; Part 2 only adds.
//
// NEW EXPORTS Part 2 references (scripts/heart.js):
//   rebuildHeartState() -> object   — reconstruct the {libres, ocupados, ordinal,
//                                     assignments} pools from the note frontmatter
//                                     (responsable + estado) when .heart.json is
//                                     missing/corrupt/incomplete. The heart calls
//                                     this at the top of a tick when the sidecar is
//                                     unusable, so a crash can never strand the
//                                     pools; the diana also calls it directly to
//                                     assert the rebuild. readHeartState() returns
//                                     the rebuilt pools after such a tick.
//
// EXPORTS (exact function names):
//   scripts/sandbox/notes.js:
//     parseFrontmatter(md) -> object    (same grammar as sprint.js)
//     slugifyTema(s) -> slug            ('Wizard Paso2' -> 'wizard-paso2')
//     createNote({tema, body}) -> {id, file}   (estado 'libre', numero 0)
//     readNote(id) -> {frontmatter, body, file}
//     setNoteState(id, state)           (THE ONLY writer of `estado:`; throws on
//                                        a state outside VALID_STATES)
//     appendBitacora(id, line)          (append-only; NEVER touches `estado:`)
//     appendWilliam(id, line)           (append-only; NEVER touches `estado:`)
//     VALID_STATES = ['libre','en-proceso','finalizada','revision','atencion','cancelada']
//     sandboxRoot() / notesDir()        (honour NEBLLA_SANDBOX_DIR)
//
//   scripts/sandbox/worktrees.js:
//     createWorktree(prog) -> {dir}      (mock: a real dir resolvable by require)
//     removeWorktree(prog)               (mock: dir gone, no ghost)
//     listCommands() -> string[]         (mock: the git/junction commands it WOULD
//                                        have run — incl. `core.longpaths true`)
//
//   scripts/heart.js:
//     tick(deps) -> Promise              (ONE beat: Aubé → Reparto → William, in
//                                        that fixed order; deps are injectable so
//                                        the runners/launchers can be spied/mocked)
//     tickN(n, deps) -> Promise          (synchronous driver: await tick n times)
//     readHeartState() -> object         (the .heart.json sidecar: pools + ordinal)
//     The real setInterval is gated behind a `main()` that tests never call.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';   // Part 4: launch docs.js as a real process (fail-closed gate)
import { ROOT } from './_root.js';   // forge root + pins NEBLLA_PROJECT_ROOT=forge for the machinery under test

export const needsServer = false;

// ── module paths the contract fixes (do not exist yet — Miguel builds them) ───
const NOTES_MOD = path.join(ROOT, 'scripts', 'sandbox', 'notes.js');
const WORKTREES_MOD = path.join(ROOT, 'scripts', 'sandbox', 'worktrees.js');
const HEART_MOD = path.join(ROOT, 'scripts', 'heart.js');

const url = (p) => 'file://' + p.replace(/\\/g, '/');

// The EXACT frontmatter grammar of scripts/sprint.js, re-implemented inline so
// this suite proves notes.js writes frontmatter the OLD machine can already
// parse — without importing sprint.js's private function. If notes.js writes a
// key sprint.js can't read, this parser won't see it either, and the assert fails.
function sprintParseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (mm) fm[mm[1]] = mm[2].trim();
    }
  }
  return fm;
}

// Each test gets its OWN throwaway sandbox dir under the OS tmp, pointed at via
// NEBLLA_SANDBOX_DIR. We import the modules FRESH per dir so module-level state
// (cached roots, in-memory pools) can't leak between tests, then clean up the
// tmpdir in finally. `import(url + '?t=' + Date.now())` busts the ESM cache.
let dirCounter = 0;
function freshSandboxDir() {
  const d = path.join(os.tmpdir(), `nbla-sbx-${process.pid}-${++dirCounter}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

// Import a module fresh against a given sandbox dir (sets the env hook first).
async function loadFresh(modPath, env = {}) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    return await import(url(modPath) + '?t=' + Date.now() + '_' + Math.random());
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

// Read a note's raw .md straight off disk (we assert on disk, not via the module).
function readNoteFile(dir, id) {
  return fs.readFileSync(path.join(dir, 'notas', id + '.md'), 'utf8');
}
function heartFile(dir) { return path.join(dir, '.heart.json'); }

export async function run({ reporter: r }) {
  r.suite('24 — sandbox heart, notes & worktrees (STAGE 1 diana, mocked)');

  // A note guard: if Miguel hasn't built the modules yet, report ONE honest
  // failure per missing module instead of an opaque crash, then bail. (Once the
  // modules exist this block is inert and the real assertions run.)
  {
    let missing = [];
    for (const [name, p] of [['scripts/sandbox/notes.js', NOTES_MOD], ['scripts/sandbox/worktrees.js', WORKTREES_MOD], ['scripts/heart.js', HEART_MOD]]) {
      if (!fs.existsSync(p)) missing.push(name);
    }
    if (missing.length) {
      r.fail('STAGE-1 modules exist (diana targets, built by Miguel)', new Error('missing: ' + missing.join(', ')));
      return;   // nothing else can run until the contract surfaces exist
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. notes.js round-trip + frontmatter compatible with sprint.js's parser
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });

      r.ok('slugifyTema normalises "Wizard Paso2" → "wizard-paso2"', notes.slugifyTema('Wizard Paso2') === 'wizard-paso2', String(notes.slugifyTema('Wizard Paso2')));
      r.ok('slugifyTema is idempotent on an already-slug', notes.slugifyTema('wizard-paso2') === 'wizard-paso2');

      const { id, file } = notes.createNote({ tema: 'Wizard Paso2', body: 'Tie quiere el paso 2 del wizard.' });
      r.ok('createNote returns an id', typeof id === 'string' && id.length > 0, String(id));
      r.ok('createNote wrote the .md on disk', fs.existsSync(path.join(dir, 'notas', id + '.md')), file);

      const md = readNoteFile(dir, id);

      // the SAME grammar sprint.js uses must parse this note's frontmatter
      const fm = sprintParseFrontmatter(md);
      r.ok('frontmatter parses with sprint.js\'s grammar (id present)', fm.id === id, JSON.stringify(fm));
      r.ok('frontmatter tema is the SLUG (normalised on write)', fm.tema === 'wizard-paso2', fm.tema);
      r.eq('initial estado is "libre"', fm.estado, 'libre');
      r.eq('initial numero is "0"', fm.numero, '0');
      r.ok('frontmatter carries responsable (empty to start)', 'responsable' in fm, JSON.stringify(fm));
      r.ok('frontmatter carries dependencias (empty to start)', 'dependencias' in fm, JSON.stringify(fm));
      r.ok('frontmatter carries william ref slot', 'william' in fm, JSON.stringify(fm));
      r.ok('frontmatter carries creada date', !!fm.creada, fm.creada);

      // body sections the design fixes (## Pide written, two append-only logs)
      r.ok('body has the ## Pide section', /^##\s+Pide\b/m.test(md), 'missing ## Pide');
      r.ok('body has the prose Iris wrote', md.includes('Tie quiere el paso 2 del wizard.'));
      r.ok('body has an append-only ## Observaciones de William section', /^##\s+Observaciones de William\b/m.test(md));
      r.ok('body has an append-only ## Bitácora section', /^##\s+Bit[aá]cora\b/m.test(md));

      // readNote round-trips what's on disk
      const got = notes.readNote(id);
      r.ok('readNote returns a frontmatter object', got && got.frontmatter && got.frontmatter.id === id, JSON.stringify(got && got.frontmatter));
      r.ok('readNote returns the body string', typeof got.body === 'string' && got.body.includes('Tie quiere'));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. SINGLE GATEKEEPER: setNoteState is the ONLY mutator of `estado:`, and it
  //    only accepts VALID_STATES. appendBitacora/appendWilliam NEVER touch it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      r.ok('notes.js exports a VALID_STATES list', Array.isArray(notes.VALID_STATES) && notes.VALID_STATES.length > 0, JSON.stringify(notes.VALID_STATES));
      for (const s of ['libre', 'en-proceso', 'finalizada', 'revision', 'atencion', 'cancelada']) {
        r.ok(`VALID_STATES includes "${s}"`, notes.VALID_STATES.includes(s));
      }

      const { id } = notes.createNote({ tema: 'tema-x', body: 'cuerpo' });

      // the gatekeeper accepts a valid transition and writes it to disk
      notes.setNoteState(id, 'en-proceso');
      r.eq('setNoteState wrote estado: en-proceso to disk', sprintParseFrontmatter(readNoteFile(dir, id)).estado, 'en-proceso');

      // the gatekeeper REFUSES an invalid state and does not corrupt the note
      let threw = false;
      try { notes.setNoteState(id, 'banana'); } catch { threw = true; }
      r.ok('setNoteState THROWS on a state outside VALID_STATES', threw);
      r.eq('a refused setNoteState left estado untouched', sprintParseFrontmatter(readNoteFile(dir, id)).estado, 'en-proceso');

      // appendBitacora is append-only and does NOT change estado
      const beforeBit = readNoteFile(dir, id);
      notes.appendBitacora(id, 'aprendí que X requiere Y');
      const afterBit = readNoteFile(dir, id);
      r.eq('appendBitacora did NOT change estado', sprintParseFrontmatter(afterBit).estado, 'en-proceso');
      r.ok('appendBitacora appended under ## Bitácora', afterBit.includes('aprendí que X requiere Y'));
      r.ok('appendBitacora is additive (old content preserved)', afterBit.length > beforeBit.length && afterBit.startsWith(beforeBit.split('## Bit')[0]));

      // appendWilliam is append-only and does NOT change estado either
      notes.appendWilliam(id, 'considera extraer un helper');
      const afterW = readNoteFile(dir, id);
      r.eq('appendWilliam did NOT change estado', sprintParseFrontmatter(afterW).estado, 'en-proceso');
      r.ok('appendWilliam appended under ## Observaciones de William', afterW.includes('considera extraer un helper'));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. IMMUTABILITY: a note already `en-proceso` is NOT altered by Iris's
  //    authoring path — Iris creates ANOTHER note instead (the design rule).
  //    We model "Iris authoring" as a second createNote on the same tema and
  //    prove the in-flight note's bytes are byte-identical afterwards.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const a = notes.createNote({ tema: 'wizard', body: 'primera nota' });
      notes.setNoteState(a.id, 'en-proceso');
      const snapshot = readNoteFile(dir, a.id);

      // Iris wants to add something while a.id is en-proceso → she makes a NEW note
      const b = notes.createNote({ tema: 'wizard', body: 'algo más del wizard' });
      r.ok('a second authoring produced a DISTINCT note id', b.id !== a.id, `${a.id} vs ${b.id}`);
      r.ok('the in-flight note is byte-for-byte unchanged', readNoteFile(dir, a.id) === snapshot);
      r.eq('the in-flight note is still en-proceso', sprintParseFrontmatter(readNoteFile(dir, a.id)).estado, 'en-proceso');
      r.eq('the new note starts libre (independent lifecycle)', sprintParseFrontmatter(readNoteFile(dir, b.id)).estado, 'libre');
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. ONE CLOCK + re-entrancy guard: while a tick is mid-flight (a dep is held
  //    open by a test-controlled deferred), a SECOND clock fire must NOT enter.
  //    This is risk #1: never two hands on the board at once.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const heart = await loadFresh(HEART_MOD, { NEBLLA_SANDBOX_DIR: dir });

      // A deferred we resolve by hand to keep the first tick "ticking".
      let release;
      const gate = new Promise((res) => { release = res; });
      let aubeEntries = 0;
      const deps = {
        // runAube is the first hand; we block it with the gate to hold the tick open
        runAube: async () => { aubeEntries++; await gate; },
        runReparto: async () => {},
        runWilliam: async () => {},
      };

      // fire the clock once — DO NOT await; it parks inside runAube on the gate
      const first = heart.tick(deps);
      // give the microtask queue a beat so the first tick actually entered runAube
      await Promise.resolve(); await Promise.resolve();
      r.eq('the first clock fire entered runAube exactly once', aubeEntries, 1);

      // fire the clock a SECOND time while the first is still in-flight
      const second = heart.tick(deps);
      await Promise.resolve(); await Promise.resolve();
      r.eq('the re-entrant fire did NOT enter runAube (guard held)', aubeEntries, 1);

      // the guard'd call must resolve (a no-op skip), not hang
      let secondSettled = false;
      second.then(() => { secondSettled = true; });
      await Promise.resolve(); await Promise.resolve();
      r.ok('the re-entrant tick returned immediately (skipped, did not hang)', secondSettled);

      // now release the first tick and let it finish
      release();
      await first;
      await Promise.resolve();
      r.eq('after the first tick closes, runAube still only ran once total', aubeEntries, 1);

      // a fresh fire AFTER the first closed is allowed to enter again
      const third = heart.tick(deps);
      await third;
      r.eq('a tick fired after the previous CLOSED enters runAube again', aubeEntries, 2);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. FIXED ORDER per tick: runAube → runReparto → runWilliam, each EXACTLY
  //    once per tick, in that order. Instrument with an array-spy.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const heart = await loadFresh(HEART_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const calls = [];
      const deps = {
        runAube: async () => { calls.push('aube'); },
        runReparto: async () => { calls.push('reparto'); },
        runWilliam: async () => { calls.push('william'); },
      };
      await heart.tick(deps);
      r.ok('one tick called the three hands in EXACTLY this order', JSON.stringify(calls) === JSON.stringify(['aube', 'reparto', 'william']), JSON.stringify(calls));

      // two ticks → the order repeats, one of each per tick (driver: tickN)
      calls.length = 0;
      await heart.tickN(2, deps);
      r.ok('tickN(2) ran the order twice, one of each per tick', JSON.stringify(calls) === JSON.stringify(['aube', 'reparto', 'william', 'aube', 'reparto', 'william']), JSON.stringify(calls));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. FULL transition of ONE note, ALL through the gatekeeper:
  //    libre → (heart launches a programmer; MOCK_PROGRAMMER appends to Bitácora)
  //          → en-proceso → (on exit) → finalizada.
  //    Only the heart's tick moves `estado:`; the launcher proposes by writing.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // a single free note on a fresh tema
      const { id } = notes.createNote({ tema: 'solo-tema', body: 'haz la cosa' });
      r.eq('precondition: note starts libre', sprintParseFrontmatter(readNoteFile(dir, id)).estado, 'libre');

      // drive the REAL hands (Aubé numbers + assigns, Reparto launches the mock
      // programmer, the programmer's mocked exit lets the heart finalize). We
      // tick a few times so assign→launch→exit→finalize all land.
      await heart.tickN(4);   // no deps override → uses the real (mock-gated) hands

      const fm = sprintParseFrontmatter(readNoteFile(dir, id));
      r.eq('after the full run the note reached finalizada (via the gatekeeper)', fm.estado, 'finalizada');

      // the mock programmer's canned action is on disk: the exact Bitácora line it
      // wrote survives. Read the note body and assert it contains that line.
      const finalMd = readNoteFile(dir, id);
      r.ok('the mock programmer appended its line under ## Bitácora (the learning survives)',
        /^##\s+Bit[aá]cora\b/m.test(finalMd) && finalMd.includes('hice la cosa y aprendí algo que apunto aquí.'),
        'no bitácora entry');
      const assignedNumero = parseInt(sprintParseFrontmatter(readNoteFile(dir, id)).numero, 10);
      r.ok('the note passed THROUGH en-proceso (numero is a POSITIVE integer)', Number.isInteger(assignedNumero) && assignedNumero > 0, String(sprintParseFrontmatter(readNoteFile(dir, id)).numero));

      // .heart.json reflects the pools (programmer returned to free after exit)
      const hs = heart.readHeartState();
      r.ok('.heart.json exists on disk', fs.existsSync(heartFile(dir)));
      r.ok('.heart.json tracks free + busy pools', hs && Array.isArray(hs.libres) && Array.isArray(hs.ocupados), JSON.stringify(hs));
      r.ok('the programmer is back in the free pool (not stuck busy) after exit', !hs.ocupados.length, JSON.stringify(hs));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. worktrees.js (MOCK_GIT): createWorktree leaves a state a simulated
  //    require.resolve can resolve from; removeWorktree leaves NO ghost;
  //    `core.longpaths true` is recorded among the commands it would run.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const wt = await loadFresh(WORKTREES_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' });

      const { dir: wdir } = wt.createWorktree('juan');
      r.ok('createWorktree returned a directory', typeof wdir === 'string' && wdir.length > 0, wdir);
      r.ok('the worktree dir exists on disk (mock)', fs.existsSync(wdir));

      // a SIMULATED require.resolve: the mock junction means a known module path
      // resolves from inside the worktree. We assert the resolvable marker exists
      // (the mock drops a node_modules pointer the same way the real junction does).
      r.ok('node_modules is resolvable from the worktree (junction marker present)', fs.existsSync(path.join(wdir, 'node_modules')) || fs.existsSync(path.join(wdir, '.nbla-junction')), 'no node_modules junction marker');

      // the command log proves the RIGHT plumbing would run in real mode
      const cmds = wt.listCommands();
      r.ok('listCommands returns the recorded git/junction commands', Array.isArray(cmds) && cmds.length > 0, JSON.stringify(cmds));
      const joined = cmds.join(' \n ');
      r.ok('core.longpaths true is registered among the commands', /core\.longpaths\s+true/.test(joined), joined);
      r.ok('the worktree root is INSIDE the repo under the hidden gitignored .wt/ dir', /[\\/]\.wt[\\/]|worktree add/i.test(joined), joined);

      // removeWorktree leaves no ghost: dir gone, the teardown commands recorded
      wt.removeWorktree('juan');
      r.ok('removeWorktree removed the worktree dir (no ghost)', !fs.existsSync(wdir));
      const cmds2 = wt.listCommands().join(' \n ');
      r.ok('removeWorktree used `git worktree remove --force`', /worktree remove --force/.test(cmds2), cmds2);
      r.ok('removeWorktree used `git branch -D`', /branch -D/.test(cmds2), cmds2);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STATIC: the heartbeat NEVER starts its setInterval at import, and the launch
  //    of agents uses an ARRAY of args with NO shell, NO API key (subscription
  //    token inherited from env). A source-level guarantee, like 22-contract.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const src = fs.readFileSync(HEART_MOD, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    // it must not spawn `claude` with shell:true (win32 would mangle metachars)
    r.ok('heart.js never spawns with shell:true', !/shell\s*:\s*true/.test(code), 'shell:true would mangle metacharacters on win32');
    // it must never use an Anthropic API key — subscription token only
    r.ok('heart.js never references ANTHROPIC_API_KEY (subscription token only)', !/ANTHROPIC_API_KEY/.test(code));
    // the heartbeat must not write to stdout (it would corrupt Iris's TUI)
    r.ok('heart.js heartbeat does not console.log to stdout in the tick path', !/console\.log/.test(code),
      'the heartbeat must write to file/log, never stdout (it shares the TTY with Iris)');
    // it spawns `claude` (the agents) — proof the convocation pattern is there
    r.ok('heart.js convenes agents via `claude` (the established headless pattern)', /['"]claude['"]/.test(code), 'expected a claude spawn');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2 — STAGE 2: the three hands become the real factory.
  //   Aubé    — monotonic numbering + per-tema programmer pool (new tema = new
  //             programmer, same tema = reuse).
  //   Reparto — deterministic walk of the FREE pool; lowest-numbered note each;
  //             N>1 programmers busy at once, each in its own worktree.
  //   William — one observation OR silence; finalizada→revision, en-proceso→
  //             atencion, ALL state moves through the gatekeeper.
  //   heart   — pools rebuildable from frontmatter after a crash.
  // Everything still asserts ON DISK (frontmatter + .heart.json), mocked + 100%
  // deterministic, no real claude/git, the setInterval never started.
  // ═══════════════════════════════════════════════════════════════════════════

  // Read the .heart.json straight off disk (we assert on the sidecar, not memory).
  const readHeartFile = (dir) => { try { return JSON.parse(fs.readFileSync(heartFile(dir), 'utf8')); } catch { return null; } };
  // The William mock env literal: pick `note`, say `say` (or stay silent if absent).
  const williamMock = (note, say) => JSON.stringify(say === undefined ? { note } : { note, say });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. AUBÉ — MONOTONIC NUMBERING. After numbering several notes the ordinal only
  //    climbs; deleting an already-numbered note does NOT lower the next number
  //    Aubé hands out. (The number lives in .heart.json's monotonic ordinal, NOT
  //    derived from the count of notes on disk.)
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // three free notes on distinct temas (so Reparto won't grab them before we
      // inspect numbering — but we only run Aubé here via a deps override).
      const a = notes.createNote({ tema: 'alpha', body: 'a' });
      const b = notes.createNote({ tema: 'beta', body: 'b' });
      const c = notes.createNote({ tema: 'gamma', body: 'c' });

      // Run ONLY Aubé this tick (Reparto/William no-op) so numbering is isolated.
      const aubeOnly = { runReparto: async () => {}, runWilliam: async () => {} };
      await heart.tick(aubeOnly);

      const n = (id) => parseInt(sprintParseFrontmatter(readNoteFile(dir, id)).numero, 10);
      r.ok('Aubé numbered note a with a positive number', n(a.id) > 0, String(n(a.id)));
      r.ok('Aubé numbered note b with a positive number', n(b.id) > 0, String(n(b.id)));
      r.ok('Aubé numbered note c with a positive number', n(c.id) > 0, String(n(c.id)));
      r.ok('the three numbers are DISTINCT', new Set([n(a.id), n(b.id), n(c.id)]).size === 3, `${n(a.id)},${n(b.id)},${n(c.id)}`);
      const ordinalAfter3 = (readHeartFile(dir) || {}).ordinal || 0;
      r.ok('.heart.json ordinal reached the highest number handed out', ordinalAfter3 >= Math.max(n(a.id), n(b.id), n(c.id)), JSON.stringify(readHeartFile(dir)));

      // delete an ALREADY-NUMBERED note from disk, then number a new one. The new
      // number must be STRICTLY HIGHER than every prior number — never reused.
      const highestBefore = Math.max(n(a.id), n(b.id), n(c.id));
      fs.unlinkSync(path.join(dir, 'notas', b.id + '.md'));   // b is gone
      const d = notes.createNote({ tema: 'delta', body: 'd' });
      await heart.tick(aubeOnly);
      const nd = parseInt(sprintParseFrontmatter(readNoteFile(dir, d.id)).numero, 10);
      r.ok('a number assigned AFTER deleting a note is strictly higher (monotonic, never reused)', nd > highestBefore, `nd=${nd} highestBefore=${highestBefore}`);
      r.ok('.heart.json ordinal never went DOWN after the deletion', ((readHeartFile(dir) || {}).ordinal || 0) >= ordinalAfter3, JSON.stringify(readHeartFile(dir)));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. AUBÉ by TEMA: two notes of DIFFERENT temas → TWO programmers (one each);
  //    two notes of the SAME tema → ONE programmer reused (NOT two). Asserted on
  //    the `responsable` frontmatter + the .heart.json assignments map.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);
      const aubeOnly = { runReparto: async () => {}, runWilliam: async () => {} };

      // two distinct temas
      const x1 = notes.createNote({ tema: 'tema-uno', body: 'x1' });
      const y1 = notes.createNote({ tema: 'tema-dos', body: 'y1' });
      await heart.tick(aubeOnly);
      const rOf = (id) => sprintParseFrontmatter(readNoteFile(dir, id)).responsable;
      r.ok('note of tema-uno got a responsable', !!rOf(x1.id), rOf(x1.id));
      r.ok('note of tema-dos got a responsable', !!rOf(y1.id), rOf(y1.id));
      r.ok('two DIFFERENT temas → two DIFFERENT programmers', rOf(x1.id) !== rOf(y1.id), `${rOf(x1.id)} vs ${rOf(y1.id)}`);

      // a SECOND note on tema-uno → REUSE the same programmer (not a third).
      const x2 = notes.createNote({ tema: 'tema-uno', body: 'x2' });
      await heart.tick(aubeOnly);
      r.ok('a second note on tema-uno REUSES the existing programmer (not a new one)', rOf(x2.id) === rOf(x1.id), `${rOf(x2.id)} vs ${rOf(x1.id)}`);

      // the .heart.json assignments map records exactly one programmer per tema
      const hs = readHeartFile(dir);
      const asg = (hs && hs.assignments && typeof hs.assignments === 'object') ? hs.assignments : {};
      r.ok('.heart.json keeps a per-tema assignments map', hs && hs.assignments && typeof hs.assignments === 'object', JSON.stringify(hs));
      r.eq('tema-uno maps to exactly the reused programmer', asg['tema-uno'], rOf(x1.id));
      r.ok('tema-uno and tema-dos map to DISTINCT programmers', asg['tema-uno'] !== asg['tema-dos'], JSON.stringify(asg));
      const progSet = new Set(Object.values(asg));
      r.eq('exactly two distinct programmers exist for two temas (no third)', progSet.size, 2);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 10. REPARTO is DETERMINISTIC: the same set of notes always sends the same
  //     programmer to the same note — its LOWEST-numbered free note. Run the full
  //     real hands twice on identical inputs (fresh dirs) and assert the launched
  //     note id is identical. (MOCK_PROGRAMMER → no real claude; the programmer is
  //     canned, so we can read which note went en-proceso first.)
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Helper: build a sandbox with two SAME-tema notes (so ONE programmer owns
    // both), tick ONCE with real Aubé+Reparto but William no-op, and report which
    // note that programmer was launched on (the one moved to en-proceso).
    async function whichNoteLaunched() {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);
        const first = notes.createNote({ tema: 'misma-cosa', body: 'primera' });
        const second = notes.createNote({ tema: 'misma-cosa', body: 'segunda' });
        // one tick: Aubé numbers BOTH (same programmer), Reparto launches the
        // LOWEST-numbered one. William held to a no-op to keep it pure.
        await heart.tick({ runWilliam: async () => {} });
        // the launched note is the one that left `libre` this tick (en-proceso or,
        // if the canned programmer already settled+harvested, finalizada).
        const s1 = sprintParseFrontmatter(readNoteFile(dir, first.id)).estado;
        const s2 = sprintParseFrontmatter(readNoteFile(dir, second.id)).estado;
        const launched = s1 !== 'libre' ? first.id : (s2 !== 'libre' ? second.id : null);
        return { launched, first: first.id, second: second.id, s1, s2 };
      } finally { rmrf(dir); }
    }

    const a = await whichNoteLaunched();
    const b = await whichNoteLaunched();
    r.ok('Reparto launched exactly ONE of the two same-tema notes first', a.launched && a.launched === a.first, `s1=${a.s1} s2=${a.s2}`);
    r.ok('the programmer took its LOWEST-numbered note (the first created)', a.launched === a.first, `launched=${a.launched} first=${a.first}`);
    r.ok('REPARTO is DETERMINISTIC: identical inputs → identical note launched', a.launched === b.launched, `a=${a.launched} b=${b.launched}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 11. WILLIAM — at most ONE observation per tick, and he may STAY SILENT. We
  //     drive his hand directly via the William mock env. (a) silence → no prose,
  //     note byte-unchanged in its ## Observaciones de William; (b) one say → ONE
  //     line under that heading, never two even across the same tick.
  // ───────────────────────────────────────────────────────────────────────────
  {
    // (a) SILENCE: William picks a note but says nothing.
    {
      const dir = freshSandboxDir();
      try {
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const target = notes.createNote({ tema: 'quieto', body: 'no toques' });
        const before = readNoteFile(dir, target.id);
        // William mock with note but NO `say` → he stays silent.
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1', NEBLLA_SANDBOX_MOCK_WILLIAM: williamMock(target.id) };
        const heart = await loadFresh(HEART_MOD, env);
        // run ONLY William (Aubé/Reparto no-op) so we isolate his elegance.
        await heart.tick({ runAube: async () => {}, runReparto: async () => {} });
        const after = readNoteFile(dir, target.id);
        r.ok('William can STAY SILENT — note byte-for-byte unchanged when he has nothing to say', after === before);
        r.ok('a silent William added NO line under ## Observaciones de William', (after.split('## Observaciones de William')[1] || '').replace(/\s+/g, '') === (before.split('## Observaciones de William')[1] || '').replace(/\s+/g, ''));
      } finally { rmrf(dir); }
    }

    // (b) ONE OBSERVATION, never two: even after a second tick on the same chosen
    //     note, William appends AT MOST one line PER tick (here we assert one tick
    //     → exactly one new line).
    {
      const dir = freshSandboxDir();
      try {
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const target = notes.createNote({ tema: 'comenta', body: 'algo' });
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1', NEBLLA_SANDBOX_MOCK_WILLIAM: williamMock(target.id, 'esto se podría simplificar') };
        const heart = await loadFresh(HEART_MOD, env);
        const williamOnly = { runAube: async () => {}, runReparto: async () => {} };
        await heart.tick(williamOnly);
        const after = readNoteFile(dir, target.id);
        const section = (after.split('## Observaciones de William')[1] || '').split(/^##\s/m)[0];
        const lines = section.split('\n').map(s => s.trim()).filter(s => s.startsWith('-'));
        r.eq('William appended EXACTLY one observation in one tick (never two)', lines.length, 1);
        r.ok('the observation is the canned text', section.includes('esto se podría simplificar'));
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 12. WILLIAM moves state ONLY through the gatekeeper. A note `finalizada` that
  //     William touches → `revision`; an `en-proceso` one → `atencion`. William
  //     himself never writes `estado:` — the heart's setNoteState does. We seed a
  //     note in each state, run William's hand, and assert the disk transition.
  // ───────────────────────────────────────────────────────────────────────────
  {
    // finalizada → revision
    {
      const dir = freshSandboxDir();
      try {
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const fin = notes.createNote({ tema: 't', body: 'terminada' });
        notes.setNoteState(fin.id, 'finalizada');
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1', NEBLLA_SANDBOX_MOCK_WILLIAM: williamMock(fin.id, 'reviso esto') };
        const heart = await loadFresh(HEART_MOD, env);
        await heart.tick({ runAube: async () => {}, runReparto: async () => {} });
        r.eq('William on a FINALIZADA note → revision (via the gatekeeper)', sprintParseFrontmatter(readNoteFile(dir, fin.id)).estado, 'revision');
      } finally { rmrf(dir); }
    }
    // en-proceso → atencion
    {
      const dir = freshSandboxDir();
      try {
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const wip = notes.createNote({ tema: 't', body: 'en curso' });
        notes.setNoteState(wip.id, 'en-proceso');
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1', NEBLLA_SANDBOX_MOCK_WILLIAM: williamMock(wip.id, 'ojo con esto') };
        const heart = await loadFresh(HEART_MOD, env);
        await heart.tick({ runAube: async () => {}, runReparto: async () => {} });
        r.eq('William on an EN-PROCESO note → atencion (via the gatekeeper)', sprintParseFrontmatter(readNoteFile(dir, wip.id)).estado, 'atencion');
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 13. POOLS REBUILDABLE after a crash. Delete (and separately corrupt) the
  //     .heart.json; the heart reconstructs {libres, ocupados} from the note
  //     frontmatter (responsable + estado): an en-proceso note's programmer is
  //     OCUPADO, a libre note's programmer is LIBRE. rebuildHeartState() is the
  //     exported hook; readHeartState() returns the rebuilt pools after a tick.
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Seed a note with a chosen responsable + estado by writing the frontmatter
    // fields the heart owns: createNote then setNoteState, and stamp responsable
    // via a second tiny write (the diana only needs the FIELDS on disk, however
    // they got there — the rebuild reads frontmatter, not history).
    function seedNote(notes, dir, { tema, estado, responsable, numero }) {
      const { id } = notes.createNote({ tema, body: 'x' });
      // stamp responsable + numero into the frontmatter (Aubé's fields) by hand.
      let md = fs.readFileSync(path.join(dir, 'notas', id + '.md'), 'utf8');
      if (responsable !== undefined) md = md.replace(/^responsable:.*$/m, 'responsable: ' + responsable);
      if (numero !== undefined) md = md.replace(/^numero:.*$/m, 'numero: ' + numero);
      fs.writeFileSync(path.join(dir, 'notas', id + '.md'), md);
      if (estado && estado !== 'libre') notes.setNoteState(id, estado);   // gatekeeper writes estado
      return id;
    }

    // (a) MISSING .heart.json → rebuild from frontmatter
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);

        // one programmer mid-work (en-proceso) and one idle (libre, numbered).
        seedNote(notes, dir, { tema: 'occ', estado: 'en-proceso', responsable: 'juan', numero: '3' });
        seedNote(notes, dir, { tema: 'free', estado: 'libre', responsable: 'petra', numero: '5' });

        // there is NO .heart.json yet (fresh dir) → simulate the crash explicitly.
        try { fs.unlinkSync(heartFile(dir)); } catch {}
        r.ok('precondition: .heart.json is absent (crash)', !fs.existsSync(heartFile(dir)));

        // the exported rebuild hook reconstructs the pools straight from frontmatter.
        // Guarded so a not-yet-built hook is ONE honest failure, not a suite crash.
        if (typeof heart.rebuildHeartState !== 'function') {
          r.fail('heart.js exports rebuildHeartState() (crash-recovery hook)', new Error('rebuildHeartState is not exported yet'));
        } else {
          const rebuilt = heart.rebuildHeartState();
          r.ok('rebuildHeartState put juan (en-proceso) in OCUPADOS', rebuilt.ocupados.includes('juan'), JSON.stringify(rebuilt));
          r.ok('rebuildHeartState put petra (libre note) in LIBRES', rebuilt.libres.includes('petra'), JSON.stringify(rebuilt));
          r.ok('rebuildHeartState never lists a programmer as BOTH free and busy', !rebuilt.libres.some(p => rebuilt.ocupados.includes(p)), JSON.stringify(rebuilt));
          r.ok('rebuilt ordinal is at least the highest numero seen on disk (monotonic survives)', rebuilt.ordinal >= 5, JSON.stringify(rebuilt));
        }

        // and a real tick with the JSON missing must NOT lose the pools: after it,
        // .heart.json is back on disk with the reconstructed pools.
        await heart.tick({ runAube: async () => {}, runReparto: async () => {}, runWilliam: async () => {} });
        const onDisk = readHeartFile(dir);
        r.ok('a tick with a missing sidecar rebuilt + persisted .heart.json', onDisk && Array.isArray(onDisk.ocupados), JSON.stringify(onDisk));
        r.ok('the persisted pools keep juan busy after the rebuild tick', !!(onDisk && onDisk.ocupados && onDisk.ocupados.includes('juan')), JSON.stringify(onDisk));
      } finally { rmrf(dir); }
    }

    // (b) CORRUPT .heart.json → also rebuilt (incomplete/garbage is unusable)
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);
        seedNote(notes, dir, { tema: 'occ2', estado: 'en-proceso', responsable: 'lina', numero: '7' });
        // write garbage into the sidecar
        fs.writeFileSync(heartFile(dir), '{ this is not json ');
        if (typeof heart.rebuildHeartState !== 'function') {
          r.fail('heart.js rebuildHeartState() rebuilds from a CORRUPT sidecar', new Error('rebuildHeartState is not exported yet'));
        } else {
          const rebuilt = heart.rebuildHeartState();
          r.ok('a corrupt .heart.json is rebuilt from frontmatter (lina is busy)', rebuilt.ocupados.includes('lina'), JSON.stringify(rebuilt));
        }
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 14. REAL PARALLELISM (N>1). Two notes on DIFFERENT temas → two programmers.
  //     With the canned programmer held OPEN (a mock that does NOT settle on its
  //     own), after the launching tick BOTH programmers are in `ocupados` at once,
  //     each with its own note in `en-proceso`. Then we let both settle and a
  //     final tick harvests them → both back in `libres`, both notes finalizada.
  //     Drives the REAL hands (deps default) so the pool bookkeeping is exercised.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // two distinct temas → Aubé makes two programmers; Reparto launches both.
      const n1 = notes.createNote({ tema: 'rama-a', body: 'a' });
      const n2 = notes.createNote({ tema: 'rama-b', body: 'b' });

      // Tick #1: Aubé numbers + assigns BOTH, Reparto moves BOTH to en-proceso and
      // launches BOTH programmers. We hold William to a no-op (irrelevant here).
      // NOTE: the canned MOCK_PROGRAMMER settles immediately, so to observe the
      // "two busy at once" window we assert that BOTH notes left `libre` and the
      // .heart.json saw two programmers leave the free pool in the SAME tick.
      await heart.tick({ runWilliam: async () => {} });

      const s1 = sprintParseFrontmatter(readNoteFile(dir, n1.id)).estado;
      const s2 = sprintParseFrontmatter(readNoteFile(dir, n2.id)).estado;
      r.ok('note rama-a left libre (a programmer claimed it)', s1 !== 'libre', s1);
      r.ok('note rama-b left libre (a programmer claimed it)', s2 !== 'libre', s2);
      const rA = sprintParseFrontmatter(readNoteFile(dir, n1.id)).responsable;
      const rB = sprintParseFrontmatter(readNoteFile(dir, n2.id)).responsable;
      r.ok('the two notes have TWO DISTINCT programmers (real parallelism, N>1)', rA && rB && rA !== rB, `${rA} vs ${rB}`);

      // Drive a couple more ticks so the canned programmers settle + are harvested.
      await heart.tickN(3, { runWilliam: async () => {} });
      const e1 = sprintParseFrontmatter(readNoteFile(dir, n1.id)).estado;
      const e2 = sprintParseFrontmatter(readNoteFile(dir, n2.id)).estado;
      r.eq('rama-a reached finalizada (programmer finished, via gatekeeper)', e1, 'finalizada');
      r.eq('rama-b reached finalizada (programmer finished, via gatekeeper)', e2, 'finalizada');
      const hs = readHeartFile(dir);
      r.ok('after both finish, NEITHER programmer is stuck in ocupados', !!(hs && Array.isArray(hs.ocupados) && hs.ocupados.length === 0), JSON.stringify(hs));
      r.ok('both programmers returned to the FREE pool', !!(hs && Array.isArray(hs.libres) && hs.libres.includes(rA) && hs.libres.includes(rB)), JSON.stringify(hs));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 15. SINGLE GATEKEEPER (Stage-2 regression). NONE of the three real hands may
  //     write `estado:` directly — only the heart's setNoteState moves it. We
  //     prove it at the SOURCE: aube.js/reparto.js/william.js never call the
  //     estado-mutating writer; only heart.js does. Plus a behavioural check:
  //     Aubé numbering a note leaves its estado EXACTLY as it was (libre).
  // ───────────────────────────────────────────────────────────────────────────
  {
    // (a) behavioural: Aubé writes numero + responsable but NEVER estado.
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);
        const note = notes.createNote({ tema: 'porteria', body: 'x' });
        await heart.tick({ runReparto: async () => {}, runWilliam: async () => {} });   // Aubé only
        const fm = sprintParseFrontmatter(readNoteFile(dir, note.id));
        r.ok('Aubé assigned a numero', parseInt(fm.numero, 10) > 0, fm.numero);
        r.ok('Aubé assigned a responsable', !!fm.responsable, fm.responsable);
        r.eq('Aubé did NOT move estado (still libre — only the gatekeeper moves it)', fm.estado, 'libre');
      } finally { rmrf(dir); }
    }

    // (b) source-level: the three hand modules must NOT call setNoteState. The
    //     gatekeeper hand lives in heart.js alone. (Stage-2 files; guarded so this
    //     stays inert until Miguel splits the hands into their own modules.)
    {
      const AUBE_MOD = path.join(ROOT, 'scripts', 'sandbox', 'aube.js');
      const REPARTO_MOD = path.join(ROOT, 'scripts', 'sandbox', 'reparto.js');
      const WILLIAM_MOD = path.join(ROOT, 'scripts', 'sandbox', 'william.js');
      const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const [name, p] of [['aube.js', AUBE_MOD], ['reparto.js', REPARTO_MOD], ['william.js', WILLIAM_MOD]]) {
        if (!fs.existsSync(p)) { r.skip(`${name} does not call setNoteState (hand module not split yet)`, 'module not built'); continue; }
        const code = strip(fs.readFileSync(p, 'utf8'));
        r.ok(`${name} never calls setNoteState (estado is the gatekeeper's alone)`, !/\bsetNoteState\s*\(/.test(code), `${name} must PROPOSE, not move estado`);
      }
      // and the heart IS the gatekeeper: it must call setNoteState somewhere.
      const heartCode = strip(fs.readFileSync(HEART_MOD, 'utf8'));
      r.ok('heart.js IS the gatekeeper (it calls setNoteState)', /\bsetNoteState\s*\(/.test(heartCode), 'heart must own the estado move');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 3 — STAGE 3: dependencies, serialized worktree merge, cancel valve.
  //
  //   DEPENDENCIES (aube.js + reparto.js, Tie's exact rules, handoff §3 pasos 5-7):
  //     A note declares its blockers in the `dependencias` frontmatter field
  //     (Iris writes it at authoring time, like `tema`). The rule:
  //       (a) a note with NO related dependency  → fresh programmer, in parallel
  //           (Part-2 behaviour, unchanged).
  //       (b) a note that depends on another that must finish first → it is NOT
  //           dispatched (never moves to en-proceso) until its dependency is
  //           `finalizada`. Once the dependency finalizes, it dispatches.
  //       (c) EDGE paso-7: a note C that depends on TWO programmers
  //           (dependencias = "juan,petra") waits while BOTH are unfinished; the
  //           FIRST to finish ERASES its own name from C's CSV; when ONE name is
  //           left, THAT programmer takes C as its own (responsable=that name) and
  //           C dispatches to it. A deterministic shrinking-CSV — no agent.
  //
  //   SERIALIZED MERGE (worktrees.js + heart):
  //     When a programmer finishes (harvestFinished), BEFORE removeWorktree the
  //     heart FUSES its branch into the sandbox trunk — mergeWorktree(prog) →
  //     {clean} | {conflict, files}. SERIALIZED: NEVER two merges at once (the
  //     global .git/index.lock; two simultaneous commits collide) → the heart
  //     fuses ONE AT A TIME inside the tick. Happy path (disjoint temas) = git's
  //     automatic clean merge, free + deterministic. A REAL line-by-line conflict
  //     of the same file → git DETECTS + marks it (NEVER a silent overwrite) →
  //     resolveConflict(prog, files) ESCALATES to a `claude -p` resolver
  //     (mockable). Order inside harvest: merge → THEN removeWorktree.
  //
  //   CANCEL VALVE (heart, handoff §11): Iris marks a note `estado: cancelada` →
  //     the heart, next tick, KILLS the programmer's process (SIGKILL, reusing the
  //     in-flight watchdog) + removeWorktree (NO merge: the work is discarded) +
  //     frees the programmer. The note STAYS `cancelada` (NOT finalizada). A rare
  //     valve, not the common path.
  //
  // INVARIANTS held (regression): the heart is the SOLE gatekeeper of `estado:`
  // (the gatekeeper closure); ONE clock + re-entrancy guard; merge is done ONLY by
  // the heart and SERIALIZED; the resolver is a `claude -p` with ARRAY args, NO
  // shell, subscription token (NEVER an API key); worktrees in .wt/ gitignored,
  // git output captured (runQuiet), removeWorktree idempotent. Everything still
  // asserts ON DISK, 100% deterministic, no real claude/git/Mongo, the setInterval
  // never started, isolated per tmpdir.
  //
  // NEW CONTRACT SURFACES Part 3 fixes (Miguel builds these — they may not exist
  // yet, so each block GUARDS with one honest r.fail/r.skip rather than crashing):
  //
  //   scripts/sandbox/worktrees.js:
  //     mergeWorktree(prog) -> {clean:true} | {conflict:true, files:string[]}
  //         Fuses the programmer's branch into the sandbox trunk. Under
  //         NEBLLA_SANDBOX_MOCK_GIT it does NOT run real git: it returns the canned
  //         outcome from NEBLLA_SANDBOX_MOCK_MERGE (a JSON map prog->outcome;
  //         default {clean:true}) and RECORDS a `git merge <branch>` line in
  //         listCommands() so the diana can read the serial order back off disk.
  //     resolveConflict(prog, files) -> {resolved:true}
  //         Escalates a real conflict to a resolver. Under
  //         NEBLLA_SANDBOX_MOCK_RESOLVER it does NOT spawn `claude`: it RECORDS the
  //         invocation (prog + files) to listResolverCalls() and returns resolved.
  //     listResolverCalls() -> [{prog, files}]   (mock introspection)
  //
  //   scripts/heart.js:
  //     harvestFinished now MERGES (one-at-a-time, in id/insertion order) before
  //     tearing down each finished programmer's worktree; on a {conflict} it calls
  //     resolveConflict BEFORE removeWorktree (never a silent overwrite).
  //     The cancel valve: a tick on a note in `cancelada` kills the in-flight
  //     programmer, removeWorktree (NO merge recorded), frees it, leaves the note
  //     `cancelada`.
  //
  //   NEBLLA_SANDBOX_MOCK_PROGRAMMER = 'hold'  — the canned programmer registers
  //     in-flight but does NOT settle on its own (simulates a long-running real
  //     `claude -p` the heart can later SIGKILL). Any OTHER truthy value keeps the
  //     Part-1/2 behaviour (settle immediately). Lets us observe a programmer that
  //     is genuinely mid-work for the cancel valve.
  // ═══════════════════════════════════════════════════════════════════════════

  // The merge mock literal: prog -> {clean} | {conflict, files}. Absent → clean.
  const mergeMock = (map) => JSON.stringify(map);

  // ───────────────────────────────────────────────────────────────────────────
  // 16. DEPENDENCIA SIMPLE (rule b). Note B depends on note A (dependencias points
  //     at A). While A is unfinished, B is NEVER dispatched (stays libre, never
  //     en-proceso). Once A is `finalizada`, the next tick dispatches B.
  //     Asserted on disk: B's estado before/after A finalizes.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // A on its own tema; B on a DIFFERENT tema (so B is its own programmer) but
      // DEPENDS on A. We stamp B's dependencias with A's id by hand (Iris's field).
      const a = notes.createNote({ tema: 'cimientos', body: 'pon los cimientos' });
      const b = notes.createNote({ tema: 'tejado', body: 'pon el tejado' });
      // stamp dependencias: B blocks on A (id). dependencias is Iris's field — like
      // tema — so writing it directly models Iris authoring the blocker.
      {
        const f = path.join(dir, 'notas', b.id + '.md');
        fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^dependencias:.*$/m, 'dependencias: ' + a.id));
      }
      const dep = sprintParseFrontmatter(readNoteFile(dir, b.id)).dependencias;
      r.eq('precondition: B declares A as a dependency', dep, a.id);

      // Tick a few times. Aubé numbers both, Reparto dispatches A (no deps) but
      // must HOLD B (its dep A is not finalizada yet).
      await heart.tickN(2, { runWilliam: async () => {} });
      const sB1 = sprintParseFrontmatter(readNoteFile(dir, b.id)).estado;
      r.ok('B with an unfinished dependency was NOT dispatched (still libre)', sB1 === 'libre', sB1);

      // Drive A to finalizada (the canned programmer settles + harvest finalizes).
      await heart.tickN(3, { runWilliam: async () => {} });
      const sA = sprintParseFrontmatter(readNoteFile(dir, a.id)).estado;
      r.eq('A reached finalizada (its programmer finished)', sA, 'finalizada');
      // B was STILL held while A was only being worked, and only frees once A is done.
      const sB2 = sprintParseFrontmatter(readNoteFile(dir, b.id)).estado;
      r.ok('once A is finalizada, B is dispatched (left libre)', sB2 !== 'libre', sB2);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 17. EDGE PASO-7 (Tie's case). Note C depends on TWO programmers,
  //     dependencias = "juan,petra". While BOTH are unfinished C waits. When JUAN
  //     finishes, his name is ERASED from C's CSV (leaving "petra"). When PETRA
  //     finishes, ONE name is left → PETRA takes C as her own (responsable=petra)
  //     and C dispatches. We verify the shrinking CSV step by step on the
  //     frontmatter, driving the REAL Aubé/Reparto hands.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // Stamp two "owners" juan/petra as the responsables of two finished features,
      // and a note C that depends on both. We model the two owners directly via
      // frontmatter (their own notes already finalizada is the precondition we toggle).
      // Note A → juan, Note B → petra, Note C dependencias "juan,petra".
      const a = notes.createNote({ tema: 'feat-a', body: 'A' });
      const bb = notes.createNote({ tema: 'feat-b', body: 'B' });
      const c = notes.createNote({ tema: 'feat-c', body: 'C (depende de A y B)' });

      // Stamp owners + dependencias by hand (Aubé/Iris fields, not estado).
      const stamp = (id, fields) => {
        const f = path.join(dir, 'notas', id + '.md');
        let md = fs.readFileSync(f, 'utf8');
        for (const [k, v] of Object.entries(fields)) md = md.replace(new RegExp('^' + k + ':.*$', 'm'), `${k}: ${v}`);
        fs.writeFileSync(f, md);
      };
      stamp(a.id, { responsable: 'juan', numero: '1' });
      stamp(bb.id, { responsable: 'petra', numero: '2' });
      stamp(c.id, { responsable: '', numero: '3', dependencias: 'juan,petra' });

      // Seed the heart sidecar so juan + petra are known programmers.
      fs.writeFileSync(heartFile(dir), JSON.stringify({
        libres: ['juan', 'petra'], ocupados: [], ordinal: 3,
        assignments: { 'feat-a': 'juan', 'feat-b': 'petra' },
      }, null, 2));

      const depOf = (id) => sprintParseFrontmatter(readNoteFile(dir, id)).dependencias;
      const resOf = (id) => sprintParseFrontmatter(readNoteFile(dir, id)).responsable;
      const estOf = (id) => sprintParseFrontmatter(readNoteFile(dir, id)).estado;

      r.eq('precondition: C depends on both juan and petra', depOf(c.id), 'juan,petra');

      // (1) BOTH unfinished → C waits, still libre, dependencias unchanged.
      await heart.tickN(1, { runWilliam: async () => {} });
      r.ok('C with two unfinished deps is NOT dispatched (still libre)', estOf(c.id) === 'libre', estOf(c.id));
      r.eq('C still lists both deps while neither owner finished', depOf(c.id), 'juan,petra');

      // (2) JUAN finishes → his note A goes finalizada. Next tick, juan's name is
      //     erased from C's CSV, leaving "petra"; C STILL waits (one dep left).
      notes.setNoteState(a.id, 'finalizada');   // the gatekeeper (we stand in for harvest here)
      await heart.tickN(1, { runWilliam: async () => {} });
      r.eq('after JUAN finishes, his name is ERASED from C (CSV shrinks to "petra")', depOf(c.id), 'petra');
      r.ok('C still waits while petra is unfinished (still libre)', estOf(c.id) === 'libre', estOf(c.id));

      // (3) PETRA finishes → one name left → PETRA takes C as her own and C
      //     dispatches. The CSV is now consumed (empty) and responsable=petra.
      notes.setNoteState(bb.id, 'finalizada');
      await heart.tickN(2, { runWilliam: async () => {} });
      r.eq('once ONE name is left and that owner finishes, C is taken by petra (responsable)', resOf(c.id), 'petra');
      r.ok('C left libre (dispatched) once it has a single owner with no pending deps', estOf(c.id) !== 'libre', estOf(c.id));
      r.ok('C\'s dependencias CSV is consumed (empty) after the last owner finished', !depOf(c.id), JSON.stringify(depOf(c.id)));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 18. MERGE SERIALIZED. Two programmers finish in the SAME harvest. The heart
  //     fuses them ONE AT A TIME (never two merges interleaved). We read the
  //     worktree command log off disk and assert: exactly two `git merge` lines,
  //     and each merge's removeWorktree falls AFTER its own merge (merge → remove,
  //     per programmer, in serial order — never merge,merge with the removes after).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const wt = await loadFresh(WORKTREES_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' });
      const heart = await loadFresh(HEART_MOD, env);

      if (typeof wt.mergeWorktree !== 'function') {
        r.fail('worktrees.js exports mergeWorktree(prog) (serialized merge hook)', new Error('mergeWorktree is not exported yet'));
      } else {
        // two distinct temas → two programmers; both canned programmers settle and
        // are harvested together, so the heart must merge them serially.
        notes.createNote({ tema: 'merge-a', body: 'a' });
        notes.createNote({ tema: 'merge-b', body: 'b' });
        await heart.tickN(4, { runWilliam: async () => {} });   // assign→launch→settle→harvest(merge)

        const cmds = (typeof wt.listCommands === 'function' ? wt.listCommands() : []) || [];
        const merges = cmds.filter(c => /git merge\b/.test(c));
        r.eq('exactly TWO merges happened (one per finished programmer)', merges.length, 2);

        // serial order: for each programmer, its `git merge <branch>` must precede
        // its `git worktree remove --force <...>` (merge THEN teardown), and the two
        // programmers' merge/remove pairs never interleave as merge,merge,remove,remove.
        // We verify by walking the log: every merge index < its matching remove index,
        // and merges are not BOTH emitted before the first remove.
        const idxOf = (re) => cmds.map((c, i) => re.test(c) ? i : -1).filter(i => i >= 0);
        const mergeIdx = idxOf(/git merge\b/);
        const removeIdx = idxOf(/worktree remove --force/);
        r.ok('there are two teardown (worktree remove --force) entries too', removeIdx.length >= 2, JSON.stringify(removeIdx));
        // serialized = the SECOND merge happens only after the FIRST programmer's
        // merge+remove pair closed → first remove index < second merge index.
        const serial = removeIdx[0] < mergeIdx[1];
        r.ok('merges are SERIALIZED (first programmer fully merged+torn down before the second merge)', serial, `merges=${JSON.stringify(mergeIdx)} removes=${JSON.stringify(removeIdx)}`);
        // and each merge precedes its own teardown (merge → remove, never the reverse)
        r.ok('every merge precedes a teardown (merge → remove order held)', mergeIdx[0] < removeIdx[0] && mergeIdx[1] < removeIdx[1], `merges=${JSON.stringify(mergeIdx)} removes=${JSON.stringify(removeIdx)}`);
      }
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 19. MERGE LIMPIO (disjoint). A finished programmer on a disjoint tema → its
  //     mergeWorktree returns {clean} (git's automatic merge), the work is taken
  //     as integrated, and the worktree is THEN dismantled (no ghost). No resolver
  //     is ever invoked on a clean merge.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const wt = await loadFresh(WORKTREES_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' });
      const heart = await loadFresh(HEART_MOD, env);

      if (typeof wt.mergeWorktree !== 'function') {
        r.fail('worktrees.js mergeWorktree returns {clean} on a disjoint merge', new Error('mergeWorktree is not exported yet'));
      } else {
        // mergeWorktree with no canned conflict → {clean} (the disjoint happy path).
        const out = wt.mergeWorktree('solo');
        r.ok('mergeWorktree on a disjoint tema returns {clean:true}', !!(out && out.clean === true && !out.conflict), JSON.stringify(out));

        // and end-to-end: one note → finalizada, merged clean, worktree gone, NO
        // resolver call recorded.
        const { id } = notes.createNote({ tema: 'disjunta', body: 'haz lo tuyo' });
        await heart.tickN(4, { runWilliam: async () => {} });
        r.eq('the disjoint note reached finalizada', sprintParseFrontmatter(readNoteFile(dir, id)).estado, 'finalizada');
        const calls = (typeof wt.listResolverCalls === 'function' ? wt.listResolverCalls() : []) || [];
        r.eq('a clean merge invoked the resolver ZERO times', calls.length, 0);
      }
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 20. CONFLICTO NO-SILENCIOSO. A forced same-file overlap → mergeWorktree
  //     returns {conflict, files} (git DETECTED it), and the heart ESCALATES to
  //     resolveConflict (the resolver mock is invoked) — NEVER a silent overwrite.
  //     We force the conflict via NEBLLA_SANDBOX_MOCK_MERGE (canned outcome).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const wt = await loadFresh(WORKTREES_MOD, {
        NEBLLA_SANDBOX_DIR: dir,
        NEBLLA_SANDBOX_MOCK_GIT: '1',
        NEBLLA_SANDBOX_MOCK_MERGE: mergeMock({ choca: { conflict: true, files: ['controllers/x.js'] } }),
        NEBLLA_SANDBOX_MOCK_RESOLVER: '1',
      });

      if (typeof wt.mergeWorktree !== 'function') {
        r.fail('worktrees.js mergeWorktree DETECTS a conflict (returns {conflict, files})', new Error('mergeWorktree is not exported yet'));
      } else {
        // (a) git detects the conflict — NEVER a silent clean. The canned outcome
        //     marks programmer "choca" as a same-file overlap.
        const out = wt.mergeWorktree('choca');
        r.ok('a real same-file overlap is DETECTED (mergeWorktree returns conflict)', !!(out && out.conflict === true), JSON.stringify(out));
        r.ok('the conflict names the offending file(s)', Array.isArray(out.files) && out.files.includes('controllers/x.js'), JSON.stringify(out));
        r.ok('a conflict is NOT reported as a clean merge (never a silent overwrite)', out.clean !== true, JSON.stringify(out));

        // (b) resolveConflict escalates to the resolver (mock invoked, NOT a real claude).
        if (typeof wt.resolveConflict !== 'function') {
          r.fail('worktrees.js exports resolveConflict(prog, files) (escalation hook)', new Error('resolveConflict is not exported yet'));
        } else {
          const res = wt.resolveConflict('choca', out.files);
          r.ok('resolveConflict returns resolved', !!(res && res.resolved === true), JSON.stringify(res));
          const calls = (typeof wt.listResolverCalls === 'function' ? wt.listResolverCalls() : []) || [];
          r.ok('the resolver (claude -p) WAS invoked exactly once for the conflict', calls.length === 1, JSON.stringify(calls));
          r.ok('the resolver invocation carries the conflicting programmer + files', calls.length === 1 && calls[0].prog === 'choca' && Array.isArray(calls[0].files) && calls[0].files.includes('controllers/x.js'), JSON.stringify(calls));
        }
      }

      // (c) the resolver is a `claude -p` with ARRAY args, NO shell, NO API key —
      //     a source-level guarantee (the invariant), like the heart's static checks.
      const wtSrc = fs.readFileSync(WORKTREES_MOD, 'utf8');
      const wtCode = wtSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      r.ok('worktrees.js never spawns the resolver with shell:true', !/shell\s*:\s*true/.test(wtCode), 'shell:true would mangle metacharacters on win32');
      r.ok('worktrees.js never references ANTHROPIC_API_KEY (resolver uses the subscription token)', !/ANTHROPIC_API_KEY/.test(wtCode));
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 21. CONFLICT END-TO-END THROUGH THE HEART. A programmer finishes whose merge
  //     CONFLICTS → in harvest the heart calls mergeWorktree, gets {conflict}, and
  //     ESCALATES to resolveConflict BEFORE removeWorktree (never tears down on a
  //     silent overwrite). We assert the resolver was invoked during the harvest
  //     and the worktree was still torn down afterwards.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const wt = await loadFresh(WORKTREES_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' });
      if (typeof wt.mergeWorktree !== 'function' || typeof wt.resolveConflict !== 'function') {
        r.skip('heart escalates a conflicting merge to the resolver during harvest', 'merge/resolver hooks not built yet');
      } else {
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        // The note's programmer name is deterministic from Aubé: first tema → 'p1'.
        // Force THAT programmer's merge to conflict via the canned merge map.
        const env = {
          NEBLLA_SANDBOX_DIR: dir,
          NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1',
          NEBLLA_SANDBOX_MOCK_GIT: '1',
          NEBLLA_SANDBOX_MOCK_MERGE: mergeMock({ p1: { conflict: true, files: ['shared.js'] } }),
          NEBLLA_SANDBOX_MOCK_RESOLVER: '1',
        };
        const heart = await loadFresh(HEART_MOD, env);
        const wt2 = await loadFresh(WORKTREES_MOD, env);   // same-process view of the log

        const { id } = notes.createNote({ tema: 'la-unica', body: 'toca el fichero compartido' });
        await heart.tickN(4, { runWilliam: async () => {} });

        // the note still finalizes (the conflict was RESOLVED, not dropped)
        r.eq('the conflicting note still reached finalizada after resolution', sprintParseFrontmatter(readNoteFile(dir, id)).estado, 'finalizada');
        const calls = (typeof wt2.listResolverCalls === 'function' ? wt2.listResolverCalls() : []) || [];
        r.ok('the heart ESCALATED the conflicting merge to the resolver during harvest', calls.length >= 1, JSON.stringify(calls));
        const cmds = (typeof wt2.listCommands === 'function' ? wt2.listCommands() : []) || [];
        const joined = cmds.join(' \n ');
        r.ok('the worktree was STILL torn down after the conflict was resolved (no ghost)', /worktree remove --force/.test(joined), joined);
      }
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 22. CANCEL VALVE. Iris marks an IN-PROCESS note `cancelada`. Next tick the
  //     heart KILLS the programmer (settled by SIGKILL), removeWorktree WITHOUT a
  //     merge (the work is discarded), the programmer returns to LIBRES, and the
  //     note STAYS `cancelada` (NOT finalizada). MOCK_PROGRAMMER='hold' gives us a
  //     programmer that is genuinely in-flight (does not auto-settle).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: 'hold', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const wt = await loadFresh(WORKTREES_MOD, env);
      const heart = await loadFresh(HEART_MOD, env);

      // one free note; tick once → Aubé numbers + assigns, Reparto launches the
      // HELD programmer (does NOT settle), note → en-proceso, programmer ocupado.
      const { id } = notes.createNote({ tema: 'abortame', body: 'algo que va por mal camino' });
      await heart.tick({ runWilliam: async () => {} });
      const est1 = sprintParseFrontmatter(readNoteFile(dir, id)).estado;
      r.ok('precondition: the note is en-proceso with a HELD (in-flight) programmer', est1 === 'en-proceso', est1);
      const hs1 = readHeartFile(dir);
      const prog = sprintParseFrontmatter(readNoteFile(dir, id)).responsable;
      r.ok('precondition: the programmer is OCUPADO (mid-work, not settled)', !!(hs1 && hs1.ocupados && hs1.ocupados.includes(prog)), JSON.stringify(hs1));

      // count merges so far (should be zero) so we can prove the cancel does NOT merge.
      const mergesBefore = ((typeof wt.listCommands === 'function' ? wt.listCommands() : []) || []).filter(c => /git merge\b/.test(c)).length;

      // Iris marks the note cancelada (through the gatekeeper, modelling her abort).
      notes.setNoteState(id, 'cancelada');

      // next tick: the heart honours the cancel — kills the process, tears down the
      // worktree WITHOUT merging, frees the programmer.
      await heart.tick({ runWilliam: async () => {} });

      const fin = sprintParseFrontmatter(readNoteFile(dir, id));
      r.eq('a cancelled note STAYS cancelada (never silently finalizada)', fin.estado, 'cancelada');
      const hs2 = readHeartFile(dir);
      r.ok('the cancelled programmer is freed from OCUPADOS', !!(hs2 && Array.isArray(hs2.ocupados) && !hs2.ocupados.includes(prog)), JSON.stringify(hs2));
      r.ok('the cancelled programmer returned to the FREE pool', !!(hs2 && Array.isArray(hs2.libres) && hs2.libres.includes(prog)), JSON.stringify(hs2));

      const cmds2 = (typeof wt.listCommands === 'function' ? wt.listCommands() : []) || [];
      const joined2 = cmds2.join(' \n ');
      const mergesAfter = cmds2.filter(c => /git merge\b/.test(c)).length;
      r.eq('a cancel discards the work — NO merge was performed', mergesAfter, mergesBefore);
      r.ok('the cancelled programmer\'s worktree was torn down (worktree remove --force)', /worktree remove --force/.test(joined2), joined2);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 23. PORTERO ÚNICO (Stage-3 regression). The new code (merge / cancel / deps)
  //     introduces NO estado mutation outside the heart. Source-level: worktrees.js
  //     (now with merge/resolver) and the hand modules NEVER call setNoteState;
  //     only heart.js does. Behavioural: after a cancel tick, the only estado on
  //     disk is the one Iris set (cancelada) — the heart did not flip it elsewhere.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // worktrees.js must NOT move estado — merge/cancel teardown is plumbing, the
    // estado move stays the heart's gatekeeper alone.
    const wtCode = strip(fs.readFileSync(WORKTREES_MOD, 'utf8'));
    r.ok('worktrees.js never calls setNoteState (merge/teardown never touches estado)', !/\bsetNoteState\s*\(/.test(wtCode), 'worktrees must not move estado');
    // re-affirm the hand modules stay clean after the Stage-3 dependency work.
    for (const [name, p] of [['aube.js', path.join(ROOT, 'scripts', 'sandbox', 'aube.js')], ['reparto.js', path.join(ROOT, 'scripts', 'sandbox', 'reparto.js')]]) {
      if (!fs.existsSync(p)) { r.skip(`${name} never calls setNoteState (Stage-3 regression)`, 'module not built'); continue; }
      const code = strip(fs.readFileSync(p, 'utf8'));
      r.ok(`${name} still never calls setNoteState after the dependency work`, !/\bsetNoteState\s*\(/.test(code), `${name} must PROPOSE, not move estado`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 24. WILLIAM ↔ reconcilePools (the blind spot the green hid). William, BY
  //     DESIGN, moves an `en-proceso` note → `atencion` to tell the programmer
  //     "read me before you finalize". In `atencion` the programmer is STILL
  //     WORKING (its `claude -p` is alive). reconcilePools must NOT treat that as
  //     "finished by another route": the old `!== 'en-proceso'` test dropped the
  //     worker from inflight and returned it to LIBRES → orphan worker, hung note
  //     (0 merges / 0 teardowns, never finalizes), ghost worktree, and Reparto
  //     could hand it a 2nd note in parallel. THIS test drives William's REAL
  //     path (not setNoteState by hand) so it actually exercises that interaction,
  //     and proves: (a) a held programmer whose note William flagged `atencion`
  //     STAYS ocupado/in-flight, NOT freed; (b) when it finally finishes it merges
  //     + finalizes through harvest with normality (no orphan, no ghost worktree).
  //     With the OLD bug, assertion (a) FAILS (the worker is freed at the reconcile
  //     after `atencion`); with the fix (atencion ∈ WORK_STATES) it PASSES.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const { id: targetId } = (await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir }))
        .createNote({ tema: 'william-atencion', body: 'algo en marcha que William querrá comentar' });

      // The heart is loaded ONCE with William pinned to the target + a single
      // observation. A HELD programmer (does NOT auto-settle) stands in for a real
      // `claude -p` genuinely mid-work, so William can flag its `en-proceso` note.
      const env = {
        NEBLLA_SANDBOX_DIR: dir,
        NEBLLA_SANDBOX_MOCK_PROGRAMMER: 'hold',
        NEBLLA_SANDBOX_MOCK_GIT: '1',
        NEBLLA_SANDBOX_MOCK_WILLIAM: williamMock(targetId, 'ojo: léeme antes de finalizar'),
      };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const wt = await loadFresh(WORKTREES_MOD, env);
      const heart = await loadFresh(HEART_MOD, env);

      // TICK 1 — Aubé numbers+assigns, Reparto launches the HELD programmer (note →
      // en-proceso, ocupado, in-flight); then William (REAL hand) sees en-proceso,
      // appends his ONE observation and the gatekeeper moves the note → atencion.
      await heart.tick();
      const fm1 = sprintParseFrontmatter(readNoteFile(dir, targetId));
      const prog = fm1.responsable;
      r.eq('William\'s REAL path moved the en-proceso note → atencion', fm1.estado, 'atencion');
      r.ok('William appended his single observation (real hand, not by hand)', readNoteFile(dir, targetId).includes('ojo: léeme antes de finalizar'));
      const hs1 = readHeartFile(dir);
      r.ok('precondition: the working programmer is OCUPADO with the note in atencion', !!(hs1 && Array.isArray(hs1.ocupados) && hs1.ocupados.includes(prog)), JSON.stringify(hs1));

      // No merge / teardown should have happened yet — the worker is STILL working.
      const mergesBefore = ((typeof wt.listCommands === 'function' ? wt.listCommands() : []) || []).filter(c => /git merge\b/.test(c)).length;
      const removesBefore = ((typeof wt.listCommands === 'function' ? wt.listCommands() : []) || []).filter(c => /worktree remove --force/.test(c)).length;

      // TICK 2 — the crux. The note now sits in `atencion`; the programmer has NOT
      // settled (still working). reconcilePools runs at the top of this tick. With
      // the OLD bug (`est !== 'en-proceso'`) it drops the worker from inflight and
      // returns it to LIBRES → the assertions below FAIL. With the fix (atencion is
      // a WORK state) the worker stays ocupado/in-flight and keeps working.
      await heart.tick();
      const hs2 = readHeartFile(dir);
      r.ok('a worker flagged `atencion` is NOT freed by reconcile (stays OCUPADO)', !!(hs2 && Array.isArray(hs2.ocupados) && hs2.ocupados.includes(prog)), JSON.stringify(hs2));
      r.ok('a worker flagged `atencion` did NOT leak back into LIBRES', !!(hs2 && Array.isArray(hs2.libres) && !hs2.libres.includes(prog)), JSON.stringify(hs2));
      r.eq('its note is left exactly in `atencion` (not silently finalized)', sprintParseFrontmatter(readNoteFile(dir, targetId)).estado, 'atencion');
      const cmdsMid = (typeof wt.listCommands === 'function' ? wt.listCommands() : []) || [];
      r.eq('no premature merge while the worker is still in atencion', cmdsMid.filter(c => /git merge\b/.test(c)).length, mergesBefore);
      r.eq('no premature teardown while the worker is still in atencion', cmdsMid.filter(c => /worktree remove --force/.test(c)).length, removesBefore);

      // The worker FINISHES for real: model its `claude -p` exiting (the same signal
      // the real on('exit') flips). It read William's note, finished, and exited.
      const settled = typeof heart.__settleForTest === 'function' ? heart.__settleForTest(prog) : false;
      r.ok('the in-flight worker is settle-able (its process can exit) — seam present', settled, 'heart.__settleForTest must flip the held worker');

      // TICK 3 — harvest finalizes it WITH NORMALITY even though the note was in
      // `atencion`: merge → teardown → finalizada, programmer returned to free. No
      // orphan, no ghost worktree. (William is silenced for THIS tick so we assert
      // the pure harvest outcome — were he still pinned he would, correctly per his
      // design, advance the just-finalized note finalizada→revision; that review
      // move is not what this test is about.)
      await heart.tick({ runWilliam: async () => {} });
      const fmFinal = sprintParseFrontmatter(readNoteFile(dir, targetId));
      r.eq('after finishing from atencion the note reaches finalizada (harvest)', fmFinal.estado, 'finalizada');
      const hs3 = readHeartFile(dir);
      r.ok('the finished worker left OCUPADOS', !!(hs3 && Array.isArray(hs3.ocupados) && !hs3.ocupados.includes(prog)), JSON.stringify(hs3));
      r.ok('the finished worker returned to the FREE pool', !!(hs3 && Array.isArray(hs3.libres) && hs3.libres.includes(prog)), JSON.stringify(hs3));
      const cmdsFinal = (typeof wt.listCommands === 'function' ? wt.listCommands() : []) || [];
      r.ok('the atencion worker MERGED on finish (work fused, not orphaned)', cmdsFinal.filter(c => /git merge\b/.test(c)).length > mergesBefore, JSON.stringify(cmdsFinal));
      r.ok('the atencion worker\'s worktree was torn down (no ghost)', /worktree remove --force/.test(cmdsFinal.join(' \n ')), JSON.stringify(cmdsFinal));
    } finally { rmrf(dir); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 4 — STAGE 4: el fin del sandbox → la máquina de documentación.
  //
  // The sandbox ends in two beats (handoff §4, §5, §13-etapa-4, §15):
  //
  //   DRAIN (scripts/heart.js): "basta" → Iris writes `.drain-requested` into the
  //     sandbox dir. From then on, AT THE TOP OF EACH TICK, the heart enters DRAIN
  //     mode: Aubé numbers NO new notes and Reparto dispatches NO new ones from the
  //     free pool — but the OCCUPIED programmers FINISH the note in flight (drain,
  //     don't abort). When the OCUPADOS pool is finally EMPTY, the heart writes
  //     `.sandbox-drained` ({at, notasFinalizadas:N}) and STOPS CLEAN (clearInterval
  //     / exit). The heart stays the SOLE gatekeeper of `estado:` the entire time it
  //     drains. Honours NEBLLA_SANDBOX_DIR.
  //
  //   docs.js (scripts/docs.js, NEW — the SECOND program, FAIL-CLOSED): only starts
  //     if `.sandbox-drained` exists (else it refuses with a clear message + exit≠0,
  //     doing NOTHING destructive). When it proceeds it orchestrates, IN ORDER:
  //       (1) 4 APÓSTOLES in PARALLEL (async spawn, mesa.js pattern; `claude -p`,
  //           ARRAY args, NO shell, subscription token), BLIND to each other (none
  //           references the others) — each analyses notas + code and leaves its
  //           own analysis;
  //       (2) when the 4 finish → ANSELMO (`claude -p`) unifies the 4 analyses into
  //           THE BIBLE (one .md);
  //       (3) when Anselmo finishes → ANA LIZ (`claude -p`) writes THE DIANA (the
  //           intention tests) reading the bible;
  //       (4) cleanupDirtyCode(): deletes the sandbox's dirty code + the worktrees,
  //           KEEPS the bible + the diana;
  //       (5) handoffToSprint(): seeds the implementation sprint .md with its
  //           `## Diana` section already populated (the build gate's filter);
  //       (6) §15 — fresh Iris: launches a NEW `claude --settings '{"ultracode":
  //           true}' "<encargo>"` (clean thread, factory ultracode) primed on the
  //           bible + the diana.
  //     EVERY agent step is mockable by env so this suite spawns NO real claude.
  //
  // ⚠ GUARDRAILS (docs.js is DESTRUCTIVE — it deletes code + worktrees; an agent
  // once deleted real files): EVERYTHING here runs ONLY against a throwaway
  // NEBLLA_SANDBOX_DIR (a per-test tmpdir) with ALL agents mocked. The cleanup /
  // burn / merge are NEVER pointed at the real backbone/sandbox/ nor the repo. The
  // process-launch tests ALWAYS pass NEBLLA_SANDBOX_DIR=<tmpdir> + the mock env, so
  // docs.js can never touch the real repo. NO real git mutation anywhere.
  //
  // CONTRACT SURFACES Part 4 fixes (Miguel builds these — they may not exist yet,
  // so each block GUARDS with one honest r.fail/r.skip rather than crashing):
  //
  //   scripts/heart.js (drain):
  //     DRAIN_REQUEST_FILE / DRAINED_FILE names live UNDER the sandbox dir:
  //       <sandbox>/.drain-requested   — Iris's "basta" signal (she writes it)
  //       <sandbox>/.sandbox-drained   — the heart's "I'm drained + stopped" receipt,
  //                                       JSON {at:<iso>, notasFinalizadas:<N>}
  //     A tick reads `.drain-requested` at its TOP; in drain mode it numbers/dispatches
  //     NO new work but lets the occupied finish; when ocupados is empty it writes
  //     `.sandbox-drained` and signals stop. The diana asserts ON DISK (the two
  //     signal files + the note states), driving tick()/tickN() by hand (no real loop).
  //
  //   scripts/docs.js (NEW):
  //     runDocs() -> Promise<{ok, refused?, steps}>   — the orchestrator. Refuses
  //       (ok:false, refused:true) when `.sandbox-drained` is absent; otherwise runs
  //       the 6 steps in order and resolves ok:true. When run as a PROCESS it exits
  //       non-zero on refusal, zero on success (the fail-closed contract).
  //     ENV HOOKS (so the suite mocks every agent + isolates to a tmpdir):
  //       NEBLLA_SANDBOX_DIR              — the throwaway sandbox root (as everywhere).
  //       NEBLLA_DOCS_MOCK_AGENTS = '1'   — ALL agents (apóstoles/Anselmo/Ana Liz/
  //         fresh-Iris) do a CANNED action instead of spawning a real `claude`:
  //           · each apostle writes its analysis file (so the suite can count 4 +
  //             prove they're blind), and RECORDS its launch order;
  //           · Anselmo writes THE BIBLE (one .md), recording it ran AFTER the 4;
  //           · Ana Liz writes THE DIANA, recording it ran AFTER Anselmo;
  //           · fresh-Iris records an INVOCATION (the spawn) WITHOUT running a real
  //             claude (the suite asserts docs.js INVOKES it, never its real effect).
  //       NEBLLA_DOCS_TRACE = <path>      — docs.js appends a JSON-lines trace of the
  //         steps it ran (step name + ts) so the suite reads the ORDER back off disk.
  //     Files docs.js produces UNDER the sandbox dir (the contract — exact-ish; the
  //     suite matches by directory + role marker, not a brittle single filename):
  //       <sandbox>/docs/apostoles/<n>.md   — the 4 blind analyses (one per apostle)
  //       <sandbox>/docs/biblia.md          — Anselmo's unified bible (SURVIVES burn)
  //       <sandbox>/docs/diana.md           — Ana Liz's intention tests (SURVIVES burn)
  //     cleanupDirtyCode() — deletes the sandbox's DIRTY CODE (the .wt/ worktrees +
  //       the throwaway code), KEEPS docs/biblia.md + docs/diana.md.
  //     handoffToSprint() — writes the implementation sprint .md with a populated
  //       `## Diana` section (so sprint.js's build gate has its filter). The suite
  //       points the sprint output at the tmpdir via NEBLLA_SANDBOX_DIR-relative
  //       path or an explicit NEBLLA_DOCS_SPRINT_FILE override.
  //       NEBLLA_DOCS_SPRINT_FILE        — where handoffToSprint writes the sprint
  //         .md (the suite points it INSIDE the tmpdir so it never touches the real
  //         backbone/sprints/).
  //
  // Everything still asserts ON DISK, 100% deterministic, no real claude/git/Mongo,
  // the heartbeat setInterval never started, isolated per tmpdir. Nothing in Parts
  // 1-3 is changed; Part 4 only adds.
  // ═══════════════════════════════════════════════════════════════════════════

  const DOCS_MOD = path.join(ROOT, 'scripts', 'docs.js');
  // Drain signal file names live under the sandbox dir (Iris writes the first,
  // the heart writes the second). We read/write them straight off disk.
  const drainRequestFile = (dir) => path.join(dir, '.drain-requested');
  const drainedFile = (dir) => path.join(dir, '.sandbox-drained');

  // ───────────────────────────────────────────────────────────────────────────
  // 25. DRAIN — `.drain-requested` present → a tick assigns NO new notes (Aubé does
  //     not number new ones, Reparto does not dispatch new ones), but the OCCUPIED
  //     programmer FINISHES the note in flight. When ocupados is empty → the heart
  //     writes `.sandbox-drained` ({at, notasFinalizadas:N}) and signals stop.
  //     Driven by hand (tick/tickN); MOCK_PROGRAMMER='hold' models a worker mid-flight.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: 'hold', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // One free note; tick once → Aubé numbers + assigns, Reparto launches the
      // HELD programmer (note → en-proceso, programmer ocupado, in-flight).
      const inflight = notes.createNote({ tema: 'en-curso', body: 'algo a medias' });
      await heart.tick({ runWilliam: async () => {} });
      const prog = sprintParseFrontmatter(readNoteFile(dir, inflight.id)).responsable;
      r.eq('precondition: the in-flight note is en-proceso (a worker mid-drain)', sprintParseFrontmatter(readNoteFile(dir, inflight.id)).estado, 'en-proceso');
      const hsBefore = readHeartFile(dir);
      r.ok('precondition: its programmer is OCUPADO (mid-work, will finish on drain)', !!(hsBefore && hsBefore.ocupados && hsBefore.ocupados.includes(prog)), JSON.stringify(hsBefore));

      // Iris says "basta": write `.drain-requested`. From here NO new work starts.
      fs.writeFileSync(drainRequestFile(dir), '');
      r.ok('precondition: .drain-requested is on disk (Iris said basta)', fs.existsSync(drainRequestFile(dir)));

      // While draining, Iris keeps authoring is irrelevant — but a NEW free note that
      // exists must NOT be numbered/dispatched (drain freezes intake). Seed one now.
      const late = notes.createNote({ tema: 'tarde', body: 'esto NO debe arrancar durante el drenaje' });

      // TICK during drain: Aubé must NOT number the late note, Reparto must NOT
      // dispatch it; the held programmer is still working (not yet settled).
      await heart.tick({ runWilliam: async () => {} });
      const lateFm = sprintParseFrontmatter(readNoteFile(dir, late.id));
      r.ok('during drain Aubé numbers NO new note (the late note stays numero 0)', String(lateFm.numero || '0') === '0', JSON.stringify(lateFm));
      r.ok('during drain Reparto dispatches NO new note (the late note stays libre)', lateFm.estado === 'libre', lateFm.estado);
      r.ok('during drain the heart did NOT write .sandbox-drained yet (ocupados not empty)', !fs.existsSync(drainedFile(dir)),
        'must not declare drained while a programmer is still working');

      // The in-flight worker now FINISHES (its `claude -p` exits) — drain lets the
      // OCCUPIED programmer complete its note in flight.
      const settled = typeof heart.__settleForTest === 'function' ? heart.__settleForTest(prog) : false;
      r.ok('the in-flight worker is settle-able (it finishes its current note while draining)', settled, 'heart.__settleForTest must flip the held worker');

      // TICK: harvest finalizes the worker, ocupados empties → the heart writes the
      // `.sandbox-drained` receipt and signals stop.
      await heart.tick({ runWilliam: async () => {} });
      r.eq('the draining worker finished its note (finalizada, via the gatekeeper)', sprintParseFrontmatter(readNoteFile(dir, inflight.id)).estado, 'finalizada');
      const hsAfter = readHeartFile(dir);
      r.ok('after the last worker finishes, OCUPADOS is empty', !!(hsAfter && Array.isArray(hsAfter.ocupados) && hsAfter.ocupados.length === 0), JSON.stringify(hsAfter));
      r.ok('the late note was STILL never dispatched during drain (stayed libre)', sprintParseFrontmatter(readNoteFile(dir, late.id)).estado === 'libre', sprintParseFrontmatter(readNoteFile(dir, late.id)).estado);

      // the drained receipt is on disk, JSON {at, notasFinalizadas}
      r.ok('the heart wrote .sandbox-drained once ocupados emptied', fs.existsSync(drainedFile(dir)), 'expected the drained receipt on disk');
      let drained = null;
      try { drained = JSON.parse(fs.readFileSync(drainedFile(dir), 'utf8')); } catch {}
      r.ok('.sandbox-drained is JSON with an `at` timestamp', !!(drained && typeof drained.at === 'string' && drained.at.length > 0), JSON.stringify(drained));
      r.ok('.sandbox-drained reports notasFinalizadas as a number ≥ 1 (it drained at least one)', !!(drained && Number.isFinite(drained.notasFinalizadas) && drained.notasFinalizadas >= 1), JSON.stringify(drained));

      // signal-stop: the heart exposes a way to know it should stop (the design's
      // clearInterval/exit). We assert the predicate the daemon's loop reads, NOT a
      // real process.exit (the suite never starts the wall-clock loop). Accept either
      // an exported `isDrained()` hook OR the receipt file as the source of truth.
      const stopSignalled = (typeof heart.isDrained === 'function' ? heart.isDrained() : fs.existsSync(drainedFile(dir)));
      r.ok('the heart signals STOP after draining (isDrained / .sandbox-drained)', !!stopSignalled, 'the daemon loop must stop after draining');
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 26. docs.js FAIL-CLOSED. Run docs.js as a REAL process (spawnSync) — ALWAYS
  //     with NEBLLA_SANDBOX_DIR=<tmpdir> + the agent mock, NEVER against the repo.
  //     (a) WITHOUT `.sandbox-drained` → it REFUSES: exit≠0 and it did NOTHING
  //         destructive (no biblia, no diana, the sandbox dir untouched).
  //     (b) WITH `.sandbox-drained` → it PROCEEDS: exit 0 and produces the bible +
  //         the diana under the sandbox.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js exists (the docs machine, built by Miguel)', new Error('scripts/docs.js is not built yet'));
    } else {
      // (a) FAIL-CLOSED: no `.sandbox-drained` → refuse, do nothing destructive.
      {
        const dir = freshSandboxDir();
        try {
          // seed a sandbox that LOOKS like a finished sandbox EXCEPT the receipt:
          // some notes + a dirty-code marker, so we can prove docs.js did NOT touch them.
          fs.mkdirSync(path.join(dir, 'notas'), { recursive: true });
          fs.mkdirSync(path.join(dir, 'dirty'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'dirty', 'scratch.js'), '// throwaway sandbox code');
          // NO .sandbox-drained on disk.
          r.ok('precondition: .sandbox-drained is ABSENT (sandbox not drained)', !fs.existsSync(drainedFile(dir)));

          const res = spawnSync(process.execPath, [DOCS_MOD], {
            cwd: ROOT,
            env: { ...process.env, NEBLLA_SANDBOX_DIR: dir, NEBLLA_DOCS_MOCK_AGENTS: '1' },
            encoding: 'utf8',
            timeout: 60 * 1000,
          });
          r.ok('docs.js WITHOUT .sandbox-drained exits NON-ZERO (fail-closed)', res.status !== 0, `status=${res.status} stderr=${(res.stderr || '').slice(0, 200)}`);
          const said = ((res.stdout || '') + (res.stderr || ''));
          r.ok('docs.js prints a clear refusal mentioning the missing drained signal', /sandbox-drained|drenad|drain|fail.?closed/i.test(said), said.slice(0, 300));
          // NOTHING destructive happened: the dirty code is still there, no biblia/diana.
          r.ok('a refused docs.js did NOT burn the dirty code (scratch.js still present)', fs.existsSync(path.join(dir, 'dirty', 'scratch.js')), 'refusal must be a no-op on disk');
          r.ok('a refused docs.js wrote NO biblia.md', !fs.existsSync(path.join(dir, 'docs', 'biblia.md')));
          r.ok('a refused docs.js wrote NO diana.md', !fs.existsSync(path.join(dir, 'docs', 'diana.md')));
        } finally { rmrf(dir); }
      }

      // (b) WITH `.sandbox-drained` → docs.js proceeds and produces bible + diana.
      {
        const dir = freshSandboxDir();
        try {
          fs.mkdirSync(path.join(dir, 'notas'), { recursive: true });
          // a couple of notes for the apostles to analyse (their input is notas + code)
          const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
          notes.createNote({ tema: 'feature-uno', body: 'lo que se descubrió en el sandbox' });
          notes.createNote({ tema: 'feature-dos', body: 'otra cosa descubierta' });
          // the drained receipt the fail-closed gate requires.
          fs.writeFileSync(drainedFile(dir), JSON.stringify({ at: new Date().toISOString(), notasFinalizadas: 2 }, null, 2));

          const sprintFile = path.join(dir, 'impl-sprint.md');
          const res = spawnSync(process.execPath, [DOCS_MOD], {
            cwd: ROOT,
            env: {
              ...process.env,
              NEBLLA_SANDBOX_DIR: dir,
              NEBLLA_DOCS_MOCK_AGENTS: '1',
              NEBLLA_DOCS_SPRINT_FILE: sprintFile,
            },
            encoding: 'utf8',
            timeout: 90 * 1000,
          });
          r.ok('docs.js WITH .sandbox-drained exits ZERO (proceeds)', res.status === 0, `status=${res.status} stderr=${(res.stderr || '').slice(0, 300)}`);
          r.ok('docs.js produced THE BIBLE (docs/biblia.md)', fs.existsSync(path.join(dir, 'docs', 'biblia.md')), 'expected docs/biblia.md');
          r.ok('docs.js produced THE DIANA (docs/diana.md)', fs.existsSync(path.join(dir, 'docs', 'diana.md')), 'expected docs/diana.md');
        } finally { rmrf(dir); }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 27. APÓSTOLES — 4, in PARALLEL and BLIND to each other. We import docs.js fresh
  //     against a tmpdir with the agent mock, run the apostles step, and assert:
  //       (a) exactly FOUR analyses landed (one file per apostle);
  //       (b) none references the others (blind) — its content names no other apostle;
  //       (c) they were launched in PARALLEL, not chained one-after-another (each
  //           recorded a launch BEFORE any of them recorded a finish — the overlap
  //           window). The mock records launch/finish so the suite reads it off disk.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js exposes the apostles step (4 blind, parallel)', new Error('scripts/docs.js is not built yet'));
    } else {
      const dir = freshSandboxDir();
      try {
        fs.mkdirSync(path.join(dir, 'notas'), { recursive: true });
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        notes.createNote({ tema: 'algo', body: 'descubrimiento' });
        fs.writeFileSync(drainedFile(dir), JSON.stringify({ at: new Date().toISOString(), notasFinalizadas: 1 }, null, 2));

        const docs = await loadFresh(DOCS_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_DOCS_MOCK_AGENTS: '1' });
        if (typeof docs.apostles !== 'function') {
          r.fail('docs.js exports apostles() (the 4 blind documenters step)', new Error('apostles() is not exported yet'));
        } else {
          const out = await docs.apostles();
          // (a) FOUR analyses on disk.
          const apDir = path.join(dir, 'docs', 'apostoles');
          let files = [];
          try { files = fs.readdirSync(apDir).filter(f => f.endsWith('.md')); } catch {}
          r.eq('exactly FOUR apostle analyses were produced', files.length, 4);
          r.ok('apostles() reports it ran four (returns a count/array of 4)', (Array.isArray(out) ? out.length : (out && out.count)) === 4, JSON.stringify(out));

          // (b) BLIND: no analysis mentions another apostle's name/id. We name them
          //     deterministically apostol-1..4; an analysis must not reference a sibling.
          let blind = true;
          const names = ['apostol-1', 'apostol-2', 'apostol-3', 'apostol-4'];
          for (const f of files) {
            const body = fs.readFileSync(path.join(apDir, f), 'utf8');
            const me = (f.match(/(\d+)/) || [])[1];
            for (const nm of names) {
              const other = (nm.match(/(\d+)/) || [])[1];
              if (other !== me && body.includes(nm)) { blind = false; break; }
            }
            if (!blind) break;
          }
          r.ok('the apostles are BLIND to each other (no analysis references a sibling)', blind, 'an apostle referenced another — they must not know of each other');

          // (c) PARALLEL: the launch trace shows an OVERLAP (a 4th launched before the
          //     1st finished) — they are NOT chained sequentially. The mock records a
          //     JSON-lines trace of {who, ev:'launch'|'finish', i} we read off disk.
          let trace = [];
          try {
            const t = fs.readFileSync(path.join(dir, 'docs', '.apostles-trace.jsonl'), 'utf8');
            trace = t.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          } catch {}
          if (!trace.length) {
            r.skip('apostles ran in PARALLEL (launch trace overlap)', 'no .apostles-trace.jsonl emitted by the mock yet');
          } else {
            const launches = trace.filter(e => e.ev === 'launch').length;
            const firstFinishIdx = trace.findIndex(e => e.ev === 'finish');
            const launchesBeforeFirstFinish = trace.slice(0, firstFinishIdx < 0 ? trace.length : firstFinishIdx).filter(e => e.ev === 'launch').length;
            r.eq('all four apostles were launched', launches, 4);
            r.ok('the apostles overlap (≥2 launched before the first finished — parallel, not chained)', launchesBeforeFirstFinish >= 2, JSON.stringify(trace));
          }
        }
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 28. ORDER — apóstoles → biblia → diana. Anselmo does NOT start until the 4
  //     apostles finished; Ana Liz does NOT start until Anselmo finished. We read
  //     the step trace docs.js emits and assert the strict ordering of the steps.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js orchestrates apóstoles → biblia → diana in order', new Error('scripts/docs.js is not built yet'));
    } else {
      const dir = freshSandboxDir();
      try {
        fs.mkdirSync(path.join(dir, 'notas'), { recursive: true });
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        notes.createNote({ tema: 'cosa', body: 'algo' });
        fs.writeFileSync(drainedFile(dir), JSON.stringify({ at: new Date().toISOString(), notasFinalizadas: 1 }, null, 2));

        const tracePath = path.join(dir, '.docs-steps.jsonl');
        const docs = await loadFresh(DOCS_MOD, {
          NEBLLA_SANDBOX_DIR: dir,
          NEBLLA_DOCS_MOCK_AGENTS: '1',
          NEBLLA_DOCS_TRACE: tracePath,
          NEBLLA_DOCS_SPRINT_FILE: path.join(dir, 'impl-sprint.md'),
        });
        if (typeof docs.runDocs !== 'function') {
          r.fail('docs.js exports runDocs() (the orchestrator)', new Error('runDocs() is not exported yet'));
        } else {
          const result = await docs.runDocs();
          r.ok('runDocs() proceeded (not refused) with the drained receipt present', !!(result && result.ok && !result.refused), JSON.stringify(result));

          // read the step trace off disk and assert the strict order.
          let steps = [];
          try {
            const t = fs.readFileSync(tracePath, 'utf8');
            steps = t.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).map(e => e.step);
          } catch {}
          if (!steps.length) {
            r.fail('docs.js emits a step trace (NEBLLA_DOCS_TRACE) to verify order', new Error('no step trace written'));
          } else {
            const idx = (name) => steps.findIndex(s => s === name || (typeof s === 'string' && s.includes(name)));
            const iAp = idx('apostles'), iBib = idx('anselmo') >= 0 ? idx('anselmo') : idx('biblia'), iDia = idx('analiz') >= 0 ? idx('analiz') : idx('diana');
            r.ok('the apostles step ran', iAp >= 0, JSON.stringify(steps));
            r.ok('the bible (Anselmo) step ran', iBib >= 0, JSON.stringify(steps));
            r.ok('the diana (Ana Liz) step ran', iDia >= 0, JSON.stringify(steps));
            r.ok('ANSELMO ran strictly AFTER the apostles (apóstoles → biblia)', iAp >= 0 && iBib > iAp, JSON.stringify(steps));
            r.ok('ANA LIZ ran strictly AFTER Anselmo (biblia → diana)', iBib >= 0 && iDia > iBib, JSON.stringify(steps));
          }
        }
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 29. cleanupDirtyCode — BURNS the dirty code + worktrees but KEEPS the bible +
  //     the diana. We seed a tmpdir with dirty code, a .wt/ worktree marker, AND
  //     a bible + diana, run cleanupDirtyCode(), and assert on disk: the dirty
  //     code/worktrees are GONE, the bible + diana SURVIVE. ⚠ tmpdir only.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js exports cleanupDirtyCode() (the burn, keeps bible+diana)', new Error('scripts/docs.js is not built yet'));
    } else {
      const dir = freshSandboxDir();
      try {
        // seed the survivors (docs/) and the casualties (dirty code + worktrees).
        fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'docs', 'biblia.md'), '# La Biblia\nlo descubierto, semántico no gramatical.');
        fs.writeFileSync(path.join(dir, 'docs', 'diana.md'), '# La Diana\ntests de intención.');
        // dirty code in the sandbox + a worktree shop (the casualties).
        fs.mkdirSync(path.join(dir, 'dirty'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'dirty', 'scratch.js'), '// usar y tirar');
        fs.mkdirSync(path.join(dir, 'worktrees', 'p1'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'worktrees', 'p1', 'wip.js'), '// taller sucio');

        const docs = await loadFresh(DOCS_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_DOCS_MOCK_AGENTS: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' });
        if (typeof docs.cleanupDirtyCode !== 'function') {
          r.fail('docs.js exports cleanupDirtyCode()', new Error('cleanupDirtyCode() is not exported yet'));
        } else {
          await docs.cleanupDirtyCode();

          // the SURVIVORS: bible + diana are byte-intact.
          r.ok('cleanupDirtyCode KEPT the bible (docs/biblia.md survives)', fs.existsSync(path.join(dir, 'docs', 'biblia.md')), 'the bible must survive the burn');
          r.ok('cleanupDirtyCode KEPT the diana (docs/diana.md survives)', fs.existsSync(path.join(dir, 'docs', 'diana.md')), 'the diana must survive the burn');
          r.ok('the bible content is intact after the burn', fs.readFileSync(path.join(dir, 'docs', 'biblia.md'), 'utf8').includes('semántico no gramatical'));

          // the CASUALTIES: dirty code + worktree shops are gone.
          r.ok('cleanupDirtyCode BURNED the dirty sandbox code (dirty/scratch.js gone)', !fs.existsSync(path.join(dir, 'dirty', 'scratch.js')), 'dirty code must be deleted');
          r.ok('cleanupDirtyCode BURNED the worktree shops (worktrees/ gone)', !fs.existsSync(path.join(dir, 'worktrees', 'p1', 'wip.js')), 'worktrees must be torn down');
        }

        // (source-level guard) docs.js must NEVER reference ANTHROPIC_API_KEY and
        // never spawn with shell:true (the subscription / no-shell invariant), like
        // heart.js — it convenes agents the same headless way.
        const docsSrc = fs.readFileSync(DOCS_MOD, 'utf8');
        const docsCode = docsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        r.ok('docs.js never references ANTHROPIC_API_KEY (subscription token only)', !/ANTHROPIC_API_KEY/.test(docsCode));
        r.ok('docs.js never spawns with shell:true (win32 metachar safety)', !/shell\s*:\s*true/.test(docsCode));
        r.ok('docs.js convenes agents via `claude` (the established headless pattern)', /['"]claude['"]/.test(docsCode), 'expected a claude spawn for the agents');
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 30. HANDOFF — the implementation sprint .md is left with `## Diana` POPULATED.
  //     docs.js's handoffToSprint() writes the sprint .md (pointed at the tmpdir via
  //     NEBLLA_DOCS_SPRINT_FILE) with a `## Diana` section carrying the diana so
  //     sprint.js's build gate has its filter. Plus: docs.js INVOKES the fresh-Iris
  //     launch (§15) — we assert the invocation was RECORDED, never its real effect.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js exports handoffToSprint() (seeds ## Diana for sprint.js)', new Error('scripts/docs.js is not built yet'));
    } else {
      const dir = freshSandboxDir();
      try {
        // the diana must exist for the handoff to carry it.
        fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'docs', 'biblia.md'), '# La Biblia');
        fs.writeFileSync(path.join(dir, 'docs', 'diana.md'), '# La Diana\nfiltro: sandbox-impl\ntests de intención del producto.');

        const sprintFile = path.join(dir, 'impl-sprint.md');
        const freshIrisLog = path.join(dir, '.fresh-iris.json');
        const docs = await loadFresh(DOCS_MOD, {
          NEBLLA_SANDBOX_DIR: dir,
          NEBLLA_DOCS_MOCK_AGENTS: '1',
          NEBLLA_DOCS_SPRINT_FILE: sprintFile,
          NEBLLA_DOCS_FRESH_IRIS_LOG: freshIrisLog,
        });

        // (a) handoffToSprint seeds the sprint .md with a populated ## Diana.
        if (typeof docs.handoffToSprint !== 'function') {
          r.fail('docs.js exports handoffToSprint()', new Error('handoffToSprint() is not exported yet'));
        } else {
          await docs.handoffToSprint();
          r.ok('handoffToSprint wrote the implementation sprint .md', fs.existsSync(sprintFile), sprintFile);
          const md = fs.existsSync(sprintFile) ? fs.readFileSync(sprintFile, 'utf8') : '';
          r.ok('the sprint .md has a ## Diana section', /^##\s+Diana\b/m.test(md), md.slice(0, 400));
          // POPULATED, not an empty heading: the ## Diana section carries content
          // (the design: the diana born in docs lands in the build gate's filter).
          const dianaSection = (md.split(/^##\s+Diana\b/m)[1] || '').split(/^##\s/m)[0];
          r.ok('the ## Diana section is POPULATED (not an empty heading)', dianaSection.replace(/\s+/g, '').length > 0, JSON.stringify(dianaSection));
          r.ok('the ## Diana carries the build gate filter (filtro:) from the diana', /filtro\s*:/i.test(dianaSection), dianaSection.slice(0, 300));
        }

        // (b) fresh-Iris (§15): docs.js INVOKES a fresh ultracode claude — we assert
        //     the INVOCATION was recorded (mock), never a real claude effect.
        if (typeof docs.launchFreshIris !== 'function') {
          r.skip('docs.js launches a fresh ultracode Iris (§15)', 'launchFreshIris() not exported yet');
        } else {
          await docs.launchFreshIris();
          let inv = null;
          try { inv = JSON.parse(fs.readFileSync(freshIrisLog, 'utf8')); } catch {}
          r.ok('docs.js INVOKED the fresh-Iris launch (recorded, mocked — not a real claude)', !!inv, JSON.stringify(inv));
          // the recorded invocation must carry the ultracode setting and point at the
          // bible+diana (§15 — clean thread, factory ultracode, primed on the truth).
          const invStr = JSON.stringify(inv || {});
          r.ok('the fresh-Iris invocation is in ultracode (factory, no /effort typed)', /ultracode/i.test(invStr), invStr.slice(0, 300));
          r.ok('the fresh-Iris invocation points at the bible+diana (primed on the surviving truth)', /biblia|diana/i.test(invStr), invStr.slice(0, 400));
        }

        // (c) source-level: launchFreshIris uses the §15 recipe — a fresh claude (no
        //     --resume/--continue → clean thread) with ultracode via --settings.
        const docsSrc = fs.readFileSync(DOCS_MOD, 'utf8');
        const docsCode = docsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        r.ok('docs.js passes ultracode via --settings (the §15 recipe)', /ultracode/.test(docsCode), 'expected an ultracode --settings for fresh Iris');
        r.ok('docs.js starts a FRESH Iris thread (no --resume/--continue)', !/--resume|--continue/.test(docsCode), 'fresh Iris must be a clean thread (§15)');
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 31. STATIC (Part-4 invariants). docs.js is fail-closed at the SOURCE (it checks
  //     for `.sandbox-drained` before doing anything destructive) and honours
  //     NEBLLA_SANDBOX_DIR (never a hard-coded burn target). A source-level
  //     guarantee, like the heart's static block.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js source invariants (fail-closed, sandbox-dir aware)', new Error('scripts/docs.js is not built yet'));
    } else {
      const docsSrc = fs.readFileSync(DOCS_MOD, 'utf8');
      r.ok('docs.js references the .sandbox-drained gate (fail-closed precondition)', /sandbox-drained/.test(docsSrc), 'docs.js must gate on .sandbox-drained');
      r.ok('docs.js honours NEBLLA_SANDBOX_DIR (never a hard-coded burn target)', /NEBLLA_SANDBOX_DIR/.test(docsSrc), 'docs.js must respect the sandbox dir override');
      // and heart.js, which now drains, references the two drain signals at the source.
      const heartSrc = fs.readFileSync(HEART_MOD, 'utf8');
      r.ok('heart.js references .drain-requested (Iris\'s basta signal)', /drain-requested/.test(heartSrc), 'heart must read the drain request');
      r.ok('heart.js references .sandbox-drained (its drained receipt)', /sandbox-drained/.test(heartSrc), 'heart must write the drained receipt');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 32. package.json — the `sprint` script points at docs.js (Tie's rename
  //     docs→sprint, §13/§15), and the existing `sandbox` / `sandbox:demo` scripts
  //     are left intact (heart.js).
  // ───────────────────────────────────────────────────────────────────────────
  {
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch {}
    const scripts = (pkg && pkg.scripts) || {};
    r.ok('package.json has a `sprint` script (Tie\'s rename docs→sprint)', typeof scripts.sprint === 'string' && /docs\.js/.test(scripts.sprint), JSON.stringify(scripts.sprint));
    r.ok('package.json `sandbox` still launches the heart (unchanged)', typeof scripts.sandbox === 'string' && /heart\.js/.test(scripts.sandbox), JSON.stringify(scripts.sandbox));
    r.ok('package.json `sandbox:demo` still launches the heart demo (unchanged)', typeof scripts['sandbox:demo'] === 'string' && /heart\.js/.test(scripts['sandbox:demo']) && /--demo/.test(scripts['sandbox:demo']), JSON.stringify(scripts['sandbox:demo']));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 5 — STAGE 5: CIERRE del tema (handoff §13 decision #1 = OPCIÓN 2, §15).
  //
  // The three closing pieces that turn the drain into a HUMAN-gated burn, make the
  // burn safe, and put a net under it:
  //
  //   A) CONFIRMATION GATE (scripts/heart.js, handoff §13 #1 OPCIÓN 2). Today, when
  //      the board drains (ocupados empty after `.drain-requested`), the heart just
  //      writes `.sandbox-drained` and stops. The closing flow adds three beats AFTER
  //      the drain completes:
  //        (1) the heart SHUTS IRIS DOWN — closes the sandbox session (it reuses the
  //            SAME `iris.kill('SIGTERM')` the shutdown already does), freeing the TTY;
  //        (2) with the TTY free, the heart ASKS TIE on the terminal "¿quemo y
  //            reconstruyo, o vuelvo al sandbox? [s/n]" — the s/n goes to the HEART
  //            (Iris is off, she does not mediate). In production this reads stdin; in
  //            THIS suite the answer is INJECTABLE (a function/flag the heart calls),
  //            NEVER a real stdin read (a real read would block the test forever).
  //        (3a) SÍ → the heart runs docs.js (runDocs: burn + open the fresh ultracode
  //             Iris). We assert runDocs is INVOKED (a spy), never its real burn.
  //        (3b) NO → the heart CLEANS the drain signals (`.drain-requested` +
  //             `.sandbox-drained`) and RETURNS TO SANDBOX MODE: it re-spawns a sandbox
  //             Iris and RESUMES normal ticking — a NEW note added after the "no" IS
  //             numbered + dispatched again (the board is alive). The "no" destroys
  //             NOTHING: the prior notes stay on the board; the re-opened Iris re-reads
  //             them. (Scrollback is lost, the work is not — handoff §13.)
  //
  //   B) cleanupDirtyCode TEARS DOWN THE REAL WORKTREES (scripts/docs.js). Today the
  //      burn only deletes children of the sandbox dir; the REAL worktrees live OUTSIDE
  //      it, at <repo>/.wt/<prog> (handoff §14). The burn must ALSO dismantle each real
  //      worktree (`removeWorktree`/`git worktree prune`, honouring
  //      NEBLLA_SANDBOX_MOCK_GIT) so that after the burn there are ZERO orphan
  //      worktrees / `sandbox/*` branches. We assert the teardown commands were emitted
  //      (the worktree command log) for the known in-flight programmers.
  //
  //   C) SAFETY NET BEFORE THE BURN (scripts/docs.js). BEFORE cleanupDirtyCode runs
  //      (the irreversible burn), docs.js verifies the BIBLE and the DIANA both exist
  //      AND are NON-EMPTY. If either is missing/empty → it ABORTS the burn (does NOT
  //      delete the dirty code) and exits with a clear error. Reason: if a real agent
  //      (apostle/Anselmo/Ana Liz) failed, burning without a bible is a broken bridge
  //      with no net (lost work). With the net, the dirty code SURVIVES when the docs
  //      did not come out right.
  //
  // CONTRACT SURFACES Part 5 fixes (Miguel builds these — they may not exist yet, so
  // each block GUARDS with one honest r.fail/r.skip rather than crashing):
  //
  //   scripts/heart.js (the confirmation gate, all injectable so NO real stdin/claude):
  //     tick(deps) gains three injectable seams (deps; production wraps the real ones):
  //       deps.killIris      — the heart's "shut Iris down" handle. In production it is
  //                            the SAME iris.kill('SIGTERM') the shutdown uses; tests
  //                            inject a SPY and assert the heart called it once the
  //                            board drained (before asking) — and asserts it carried
  //                            'SIGTERM' (the seam may be called as killIris('SIGTERM')).
  //       deps.confirmReconstruct — the s/n the heart reads AFTER Iris is down. Returns
  //                            (or resolves) true (SÍ = burn) | false (NO = back to
  //                            sandbox). Injected per test; NEVER reads real stdin here.
  //       deps.runDocs       — the burn invocation (docs.js runDocs). On SÍ the heart
  //                            calls it; tests inject a SPY and assert it was invoked
  //                            (never the real destructive burn).
  //       deps.respawnIris   — re-open a sandbox Iris on NO. Tests inject a SPY and
  //                            assert it was called when the answer was NO.
  //     The gate fires ONLY once the board has drained (the receipt was written), and
  //     ONLY when `.drain-requested` is present. On NO the heart removes BOTH drain
  //     signal files and a subsequent tick numbers/dispatches new work again.
  //     A new exported predicate the suite reads to know the gate is awaiting input is
  //     OPTIONAL — the suite drives the gate purely through the injected seams + the
  //     on-disk signal files (the contract is "assert on disk + spies", never stdout).
  //
  //   scripts/docs.js:
  //     cleanupDirtyCode() ALSO tears down each real worktree (removeWorktree/prune),
  //       honouring NEBLLA_SANDBOX_MOCK_GIT — never real git in tests.
  //     runDocs()/cleanupDirtyCode() ABORT the burn when the bible OR the diana is
  //       absent/empty (the safety net), returning a refusal-shaped result and leaving
  //       the dirty code intact. With both present + non-empty they proceed.
  //
  // INVARIANTS held (regression): the heart stays the SOLE gatekeeper of `estado:`;
  // ONE clock + re-entrancy guard; agents convened via `claude` with ARRAY args, NO
  // shell, subscription token (NEVER an API key); alpha (no shims). Everything still
  // asserts ON DISK + via injected spies, 100% deterministic, no real claude/git/Mongo,
  // the setInterval never started, isolated per tmpdir. The s/n is INJECTABLE — NEVER a
  // real stdin read in a test. Nothing in Parts 1-4 is changed; Part 5 only adds.
  // ═══════════════════════════════════════════════════════════════════════════

  // A small spy factory: a function that records its calls + returns a fixed value.
  const spy = (ret) => { const f = (...a) => { f.calls.push(a); return typeof ret === 'function' ? ret(...a) : ret; }; f.calls = []; return f; };

  // ───────────────────────────────────────────────────────────────────────────
  // 33. GATE — the heart SHUTS IRIS DOWN once the board drains, and does NOT burn
  //     yet (it waits for Tie's confirmation). We drain a held worker, then tick
  //     with the gate seams injected: the heart must (a) write `.sandbox-drained`,
  //     (b) call killIris (SIGTERM) to close the sandbox session, (c) NOT have
  //     invoked the burn yet at the moment it asks (it is awaiting the answer).
  //     The confirmation seam is INJECTED (never real stdin).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: 'hold', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // one held worker mid-flight, then Iris says basta.
      const n = notes.createNote({ tema: 'cerrando', body: 'la última nota antes del cierre' });
      await heart.tick({ runWilliam: async () => {} });
      const prog = sprintParseFrontmatter(readNoteFile(dir, n.id)).responsable;
      r.eq('precondition: the note is en-proceso (a worker mid-flight)', sprintParseFrontmatter(readNoteFile(dir, n.id)).estado, 'en-proceso');

      fs.writeFileSync(drainRequestFile(dir), '');
      // the worker finishes (its claude -p exits) so the next tick drains the board.
      const settled = typeof heart.__settleForTest === 'function' ? heart.__settleForTest(prog) : false;
      r.ok('the held worker is settle-able (it finishes its note while draining)', settled, 'heart.__settleForTest must flip the held worker');

      // The injected gate seams. We answer the confirmation seam with NO this time so
      // the burn is never reached — THIS test only proves "Iris is shut down + the
      // heart did NOT burn before asking". killIris is the shutdown handle (SIGTERM).
      const killIris = spy();
      const runDocsSpy = spy({ ok: true, refused: false, steps: [] });
      const respawnIris = spy();
      const confirmReconstruct = spy(false);   // answer NO (we only assert pre-burn state here)

      // tick that drains the board → writes .sandbox-drained → SHUTS IRIS DOWN → asks.
      await heart.tick({ runWilliam: async () => {}, killIris, runDocs: runDocsSpy, respawnIris, confirmReconstruct });

      r.eq('the draining worker finished (finalizada via the gatekeeper)', sprintParseFrontmatter(readNoteFile(dir, n.id)).estado, 'finalizada');
      r.ok('the board drained → .sandbox-drained receipt is on disk', fs.existsSync(drainedFile(dir)), 'expected the drained receipt');

      // (a) the heart SHUT IRIS DOWN (closed the sandbox session) once drained.
      r.ok('the heart shut Iris down once the board drained (killIris invoked)', killIris.calls.length >= 1, JSON.stringify(killIris.calls));
      r.ok('the Iris shutdown used SIGTERM (the same signal the daemon shutdown uses)',
        killIris.calls.length >= 1 && (killIris.calls[0].length === 0 || /SIGTERM/.test(String(killIris.calls[0][0]))),
        JSON.stringify(killIris.calls));

      // (b) the heart did NOT burn before the human answered (it asked first).
      //     (We answered NO above; either way runDocs must not have been called the
      //     instant the board drained — the burn waits for the explicit SÍ.)
      r.eq('the heart did NOT burn before/without the explicit SÍ (no premature runDocs)', runDocsSpy.calls.length, 0);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 34. GATE — SÍ → the heart BURNS. With the confirmation seam answering SÍ, once
  //     the board drains the heart invokes the burn (runDocs). We assert runDocs was
  //     invoked exactly once (a spy — never the real destructive burn) and the heart
  //     did NOT re-open a sandbox Iris (it handed off to the docs machine instead).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: 'hold', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      const n = notes.createNote({ tema: 'a-quemar', body: 'última nota; luego decimos sí' });
      await heart.tick({ runWilliam: async () => {} });
      const prog = sprintParseFrontmatter(readNoteFile(dir, n.id)).responsable;
      fs.writeFileSync(drainRequestFile(dir), '');
      heart.__settleForTest && heart.__settleForTest(prog);

      const killIris = spy();
      const runDocsSpy = spy({ ok: true, refused: false, steps: ['apostles', 'anselmo', 'analiz', 'cleanup', 'handoff', 'fresh-iris'] });
      const respawnIris = spy();
      const confirmReconstruct = spy(true);    // answer SÍ → burn

      await heart.tick({ runWilliam: async () => {}, killIris, runDocs: runDocsSpy, respawnIris, confirmReconstruct });

      r.ok('the board drained before the gate fired', fs.existsSync(drainedFile(dir)), 'expected the drained receipt');
      r.ok('the heart asked Tie (confirmReconstruct seam consulted)', confirmReconstruct.calls.length >= 1, JSON.stringify(confirmReconstruct.calls));
      r.ok('on SÍ the heart INVOKED the burn (runDocs) exactly once', runDocsSpy.calls.length === 1, JSON.stringify(runDocsSpy.calls));
      r.eq('on SÍ the heart did NOT re-open a sandbox Iris (it handed off to docs)', respawnIris.calls.length, 0);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 35. GATE — NO → back to sandbox. With the confirmation seam answering NO, the
  //     heart CLEANS both drain signals (`.drain-requested` + `.sandbox-drained`),
  //     re-spawns a sandbox Iris (a spy), and RESUMES: a NEW note added AFTER the
  //     "no" IS numbered + dispatched again (the board is alive). And the PRIOR note
  //     stays on the board (nothing destroyed) — the burn (runDocs) is NEVER invoked.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const dir = freshSandboxDir();
    try {
      const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
      const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
      const heart = await loadFresh(HEART_MOD, env);

      // a first note that runs through to finalizada BEFORE we drain (so it's a prior
      // piece of work that must survive the "no").
      const prior = notes.createNote({ tema: 'previa', body: 'trabajo anterior que NO se debe perder' });
      await heart.tickN(4, { runWilliam: async () => {} });
      r.eq('precondition: the prior note finalized before draining', sprintParseFrontmatter(readNoteFile(dir, prior.id)).estado, 'finalizada');

      // Iris says basta; the board is already empty (the mock worker settled) so the
      // next tick drains immediately and the gate fires.
      fs.writeFileSync(drainRequestFile(dir), '');

      const killIris = spy();
      const runDocsSpy = spy({ ok: true });
      const respawnIris = spy();
      const confirmReconstruct = spy(false);   // answer NO → back to sandbox

      await heart.tick({ runWilliam: async () => {}, killIris, runDocs: runDocsSpy, respawnIris, confirmReconstruct });

      // (a) the burn was NEVER invoked; (b) the drain signals were CLEANED so the
      //     board is live again; (c) a sandbox Iris was re-opened.
      r.eq('on NO the heart did NOT burn (runDocs never invoked)', runDocsSpy.calls.length, 0);
      r.ok('on NO the heart cleaned .drain-requested (drain cancelled)', !fs.existsSync(drainRequestFile(dir)), 'the drain request must be removed on NO');
      r.ok('on NO the heart cleaned .sandbox-drained (drain receipt cleared)', !fs.existsSync(drainedFile(dir)), 'the drained receipt must be cleared on NO');
      r.ok('on NO the heart re-opened a sandbox Iris (respawnIris invoked)', respawnIris.calls.length >= 1, JSON.stringify(respawnIris.calls));

      // (d) the prior note is STILL on the board (nothing destroyed by the "no").
      r.ok('the prior note still exists on the board after the NO (work not destroyed)', fs.existsSync(path.join(dir, 'notas', prior.id + '.md')), 'a NO must not delete prior work');
      r.eq('the prior note is still finalizada (untouched by the NO)', sprintParseFrontmatter(readNoteFile(dir, prior.id)).estado, 'finalizada');

      // (e) THE BOARD IS ALIVE AGAIN: a NEW note added after the NO is numbered +
      //     dispatched by ordinary ticks (drain mode is OFF). Aubé numbers it,
      //     Reparto dispatches it.
      const fresh = notes.createNote({ tema: 'despues-del-no', body: 'esto sí debe arrancar tras el no' });
      await heart.tickN(2, { runWilliam: async () => {} });
      const freshFm = sprintParseFrontmatter(readNoteFile(dir, fresh.id));
      r.ok('after the NO, Aubé numbers a NEW note again (sandbox resumed)', parseInt(freshFm.numero || '0', 10) > 0, JSON.stringify(freshFm));
      r.ok('after the NO, Reparto dispatches the new note again (left libre)', freshFm.estado !== 'libre', freshFm.estado);
    } finally { rmrf(dir); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 36. CLEANUP tears down the REAL worktrees (handoff §14). The real worktrees live
  //     OUTSIDE the sandbox dir (at <repo>/.wt/<prog>); cleanupDirtyCode must ALSO
  //     dismantle them (removeWorktree / git worktree prune), honouring
  //     NEBLLA_SANDBOX_MOCK_GIT. We create two mock worktrees for known programmers,
  //     run cleanupDirtyCode, and assert the teardown commands were emitted for each
  //     (worktree remove --force + branch -D / prune) so NO orphan worktree/branch
  //     survives the burn. ⚠ MOCK_GIT only — never real git.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js cleanupDirtyCode tears down the real worktrees (§14)', new Error('scripts/docs.js is not built yet'));
    } else {
      const dir = freshSandboxDir();
      try {
        const wtEnv = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const wt = await loadFresh(WORKTREES_MOD, wtEnv);
        // seed the survivors (docs/) so the safety net (Part-5 C) lets the burn proceed.
        fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'docs', 'biblia.md'), '# La Biblia\nlo descubierto.');
        fs.writeFileSync(path.join(dir, 'docs', 'diana.md'), '# La Diana\nfiltro: x\ntests.');
        // create two real (mock) worktrees for two programmers — these live wherever
        // worktreeDir points (outside the sandbox in real mode; the mock log records
        // the teardown commands either way).
        wt.createWorktree('sandbox-p1');
        wt.createWorktree('sandbox-p2');
        const cmdsBefore = (typeof wt.listCommands === 'function' ? wt.listCommands() : []) || [];
        const removesBefore = cmdsBefore.filter(c => /worktree remove --force/.test(c)).length;

        // dirty code under the sandbox too (the in-dir casualty cleanupDirtyCode already burns).
        fs.mkdirSync(path.join(dir, 'dirty'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'dirty', 'scratch.js'), '// usar y tirar');

        const docs = await loadFresh(DOCS_MOD, wtEnv);
        if (typeof docs.cleanupDirtyCode !== 'function') {
          r.fail('docs.js exports cleanupDirtyCode() (the burn)', new Error('cleanupDirtyCode() is not exported yet'));
        } else {
          // tell cleanup which programmers had live worktrees. The contract accepts an
          // explicit list (the heart knows its in-flight/assigned programmers); if the
          // implementation discovers them itself the arg is harmless.
          await docs.cleanupDirtyCode(['sandbox-p1', 'sandbox-p2']);

          // the in-dir dirty code is gone (existing behaviour, regression).
          r.ok('cleanupDirtyCode still burns the in-dir dirty code', !fs.existsSync(path.join(dir, 'dirty', 'scratch.js')), 'dirty code must be deleted');
          // the survivors are intact.
          r.ok('cleanupDirtyCode kept the bible', fs.existsSync(path.join(dir, 'docs', 'biblia.md')));
          r.ok('cleanupDirtyCode kept the diana', fs.existsSync(path.join(dir, 'docs', 'diana.md')));

          // the REAL worktrees were torn down: read the command log back off disk.
          const cmdsAfter = (typeof wt.listCommands === 'function' ? wt.listCommands() : []) || [];
          const joined = cmdsAfter.join(' \n ');
          const removesAfter = cmdsAfter.filter(c => /worktree remove --force/.test(c)).length;
          r.ok('cleanupDirtyCode emitted worktree teardown(s) beyond the in-dir burn (§14)', removesAfter > removesBefore, `before=${removesBefore} after=${removesAfter}`);
          r.ok('the teardown dismantled programmer sandbox-p1\'s worktree (no orphan)', /worktree remove --force.*sandbox-p1|sandbox-p1.*worktree remove/i.test(joined) || /branch -D sandbox\/sandbox-p1/.test(joined), joined.slice(0, 600));
          r.ok('the teardown dropped the sandbox/* branches (no orphan branch)', /branch -D sandbox\//.test(joined) || /worktree prune/.test(joined), joined.slice(0, 600));
        }
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 37. SAFETY NET — abort the burn when the bible OR the diana is missing/empty.
  //     If a real agent failed, the docs are incomplete; burning the dirty code then
  //     would be a broken bridge with no net (lost work). So BEFORE cleanupDirtyCode,
  //     docs.js verifies BOTH the bible and the diana exist AND are NON-EMPTY:
  //       (a) bible missing       → ABORT: dirty code SURVIVES, clear error.
  //       (b) diana empty (0 B)   → ABORT: dirty code SURVIVES, clear error.
  //       (c) both present+non-empty → proceeds (the burn happens).
  //     We run docs.js as a REAL process (the fail-closed gate satisfied) so the
  //     orchestration order is exercised end-to-end. ⚠ tmpdir + mock agents only.
  // ───────────────────────────────────────────────────────────────────────────
  {
    if (!fs.existsSync(DOCS_MOD)) {
      r.fail('scripts/docs.js aborts the burn when the bible/diana is missing or empty', new Error('scripts/docs.js is not built yet'));
    } else {
      // A helper: seed a drained sandbox with dirty code + a chosen docs state, then
      // call cleanupDirtyCode directly (the burn step) and report whether it burned.
      async function burnOutcome(seedDocs) {
        const dir = freshSandboxDir();
        try {
          fs.mkdirSync(path.join(dir, 'dirty'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'dirty', 'scratch.js'), '// usar y tirar');
          fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
          seedDocs(dir);   // sets up biblia/diana (or not) as the case requires

          const docs = await loadFresh(DOCS_MOD, { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' });
          if (typeof docs.cleanupDirtyCode !== 'function') return { built: false };
          let threw = false, result = null;
          try { result = await docs.cleanupDirtyCode(); } catch { threw = true; }
          const burned = !fs.existsSync(path.join(dir, 'dirty', 'scratch.js'));
          return { built: true, burned, threw, result };
        } finally { rmrf(dir); }
      }

      // (a) BIBLE MISSING → abort, dirty code survives.
      {
        const o = await burnOutcome((dir) => {
          // diana present + non-empty, but NO biblia at all.
          fs.writeFileSync(path.join(dir, 'docs', 'diana.md'), '# La Diana\nfiltro: x\ntests.');
        });
        if (!o.built) { r.fail('docs.js cleanupDirtyCode aborts on a missing bible', new Error('cleanupDirtyCode() is not exported yet')); }
        else {
          r.ok('a MISSING bible ABORTS the burn (dirty code survives — the net held)', !o.burned, `burned=${o.burned}`);
          r.ok('the abort surfaced an error/refusal (threw OR a refusal-shaped result)', o.threw || !!(o.result && (o.result.refused || o.result.ok === false || o.result.aborted)), JSON.stringify(o.result));
        }
      }

      // (b) DIANA EMPTY (0 bytes) → abort, dirty code survives.
      {
        const o = await burnOutcome((dir) => {
          fs.writeFileSync(path.join(dir, 'docs', 'biblia.md'), '# La Biblia\nlo descubierto.');
          fs.writeFileSync(path.join(dir, 'docs', 'diana.md'), '');   // empty diana
        });
        if (!o.built) { r.fail('docs.js cleanupDirtyCode aborts on an empty diana', new Error('cleanupDirtyCode() is not exported yet')); }
        else {
          r.ok('an EMPTY diana ABORTS the burn (dirty code survives — the net held)', !o.burned, `burned=${o.burned}`);
          r.ok('the empty-diana abort surfaced an error/refusal', o.threw || !!(o.result && (o.result.refused || o.result.ok === false || o.result.aborted)), JSON.stringify(o.result));
        }
      }

      // (c) BOTH present + non-empty → the burn PROCEEDS (the dirty code is deleted).
      {
        const o = await burnOutcome((dir) => {
          fs.writeFileSync(path.join(dir, 'docs', 'biblia.md'), '# La Biblia\nlo descubierto, semántico no gramatical.');
          fs.writeFileSync(path.join(dir, 'docs', 'diana.md'), '# La Diana\nfiltro: sandbox-impl\ntests de intención.');
        });
        if (!o.built) { r.fail('docs.js cleanupDirtyCode proceeds with a valid bible+diana', new Error('cleanupDirtyCode() is not exported yet')); }
        else {
          r.ok('with bible+diana present and NON-EMPTY the burn PROCEEDS (dirty code deleted)', o.burned, `burned=${o.burned}`);
        }
      }

      // (d) END-TO-END via runDocs as a PROCESS: a drained sandbox whose agents are
      //     mocked produces a real bible+diana, so the net passes and runDocs reports
      //     ok. (The mocked agents always write non-empty docs, so this also proves
      //     the net does not false-positive on a healthy run.) ⚠ tmpdir + mock agents.
      {
        const dir = freshSandboxDir();
        try {
          fs.mkdirSync(path.join(dir, 'notas'), { recursive: true });
          const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
          notes.createNote({ tema: 'feat', body: 'algo descubierto en el sandbox' });
          fs.writeFileSync(drainedFile(dir), JSON.stringify({ at: new Date().toISOString(), notasFinalizadas: 1 }, null, 2));

          const res = spawnSync(process.execPath, [DOCS_MOD], {
            cwd: ROOT,
            env: { ...process.env, NEBLLA_SANDBOX_DIR: dir, NEBLLA_DOCS_MOCK_AGENTS: '1', NEBLLA_SANDBOX_MOCK_GIT: '1', NEBLLA_DOCS_SPRINT_FILE: path.join(dir, 'impl-sprint.md') },
            encoding: 'utf8',
            timeout: 90 * 1000,
          });
          r.ok('a healthy run (bible+diana written by the mocked agents) passes the net + exits 0', res.status === 0, `status=${res.status} stderr=${(res.stderr || '').slice(0, 300)}`);
          r.ok('the healthy run produced a NON-EMPTY bible', fs.existsSync(path.join(dir, 'docs', 'biblia.md')) && fs.statSync(path.join(dir, 'docs', 'biblia.md')).size > 0, 'bible must be non-empty');
          r.ok('the healthy run produced a NON-EMPTY diana', fs.existsSync(path.join(dir, 'docs', 'diana.md')) && fs.statSync(path.join(dir, 'docs', 'diana.md')).size > 0, 'diana must be non-empty');
        } finally { rmrf(dir); }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 38. STATIC (Part-5 invariants). The confirmation gate must NOT block on a real
  //     stdin read in a way the tests can't bypass — but the PRODUCTION wrapper does
  //     read the terminal. We assert at the SOURCE that: (a) heart.js references the
  //     s/n confirmation (a confirm seam / the prompt text) so the gate exists; (b)
  //     the gate reuses SIGTERM to shut Iris down (the same signal the shutdown
  //     uses); (c) docs.js references the bible+diana net before the burn. Source
  //     guarantees, like the existing static blocks.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const heartSrc = fs.readFileSync(HEART_MOD, 'utf8');
    // (a) the confirmation gate exists: the prompt the heart shows Tie OR a confirm
    //     seam name. We match the design's question text or a confirm/reconstruct hook.
    r.ok('heart.js has the confirmation gate (asks "¿quemo y reconstruyo…?" / a confirm seam)',
      /quemo y reconstruyo|reconstruyo|confirmReconstruct|\[s\/n\]/i.test(heartSrc),
      'heart must ask Tie to burn-or-return after draining (OPCIÓN 2)');
    // (b) the gate shuts Iris down with SIGTERM (reuses the shutdown signal).
    r.ok('heart.js shuts Iris down with SIGTERM at the close (reuses the shutdown signal)', /SIGTERM/.test(heartSrc), 'the gate must close the Iris session with SIGTERM');
    // (b2) the gate invokes the burn (docs.js runDocs) on SÍ — the wiring is present.
    r.ok('heart.js wires the burn to docs.js runDocs (the SÍ branch)', /runDocs/.test(heartSrc), 'heart must invoke runDocs on the SÍ branch');
    // (b3) still subscription-only, never an API key (the invariant across the gate).
    const heartCode = heartSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    r.ok('heart.js still never references ANTHROPIC_API_KEY across the close', !/ANTHROPIC_API_KEY/.test(heartCode));

    // (c) docs.js references the bible+diana safety net before the burn.
    const docsSrc = fs.readFileSync(DOCS_MOD, 'utf8');
    r.ok('docs.js references the bible+diana net (biblia + diana checked before the burn)',
      /biblia/.test(docsSrc) && /diana/.test(docsSrc),
      'docs.js must verify the bible+diana exist+non-empty before burning');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 15. SERGIO IDENTITY (n-0001 / n-0004 / n-0006). The in-heart head must be born
  //     KNOWING he is Sergio (not Iris) WITHOUT depending on his own discipline:
  //     spawnIris carries the identity as a `--append-system-prompt` argv element
  //     (never shell:true), and the briefing both NAMES him Sergio and SUPPRESSES
  //     the loose-session saludo. A static read of heart.js fixes the shape.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const heartSrc = fs.readFileSync(HEART_MOD, 'utf8');
    r.ok('spawnIris injects the identity via --append-system-prompt', /--append-system-prompt/.test(heartSrc), 'spawnIris must pass the briefing as a flag');
    r.ok('the briefing NAMES him Sergio (not Iris)', /Eres SERGIO/.test(heartSrc), 'the in-heart head is Sergio');
    r.ok('the briefing SUPPRESSES the loose-session saludo', /ANULA TU ARRANQUE NORMAL/.test(heartSrc), 'must override CLAUDE.md saludo from inside the system prompt');
    const heartCode = heartSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    r.ok('spawnIris still spawns `claude` and never uses shell:true', /spawn\('claude'/.test(heartCode) && !/shell:\s*true/.test(heartCode), 'argv form, no shell (win32-safe)');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 16. n-0005 — a note in `revision` is ACTIONABLE again. William bounces a
  //     finalizada note → revision; the heart re-dispatches it to its SAME owner
  //     (revision → en-proceso, counting the round), and a note that has burned
  //     through REVISION_ROUND_CAP is NO LONGER re-dispatched (it stays in revision,
  //     escalated — never an infinite William↔dev ping-pong).
  // ───────────────────────────────────────────────────────────────────────────
  {
    // stamp responsable + numero into a note's frontmatter (Aubé's fields), by hand.
    function stamp(dir, id, { responsable, numero }) {
      let md = fs.readFileSync(path.join(dir, 'notas', id + '.md'), 'utf8');
      if (responsable !== undefined) md = md.replace(/^responsable:.*$/m, 'responsable: ' + responsable);
      if (numero !== undefined) md = md.replace(/^numero:.*$/m, 'numero: ' + numero);
      fs.writeFileSync(path.join(dir, 'notas', id + '.md'), md);
    }

    // (a) William bounces a finalizada note → revision (counting the round), then the
    //     heart re-dispatches that revision note to its SAME owner (revision → off).
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const n = notes.createNote({ tema: 'rebota', body: 'arréglame' });
        stamp(dir, n.id, { responsable: 'p1', numero: '7' });
        notes.setNoteState(n.id, 'finalizada');
        // healthy .heart.json so no rebuild churns the pool mid-test; p1 idle in libres.
        fs.writeFileSync(heartFile(dir), JSON.stringify({
          libres: ['p1'], ocupados: [], ordinal: 7, assignments: { rebota: 'p1' }, revisionRounds: {},
        }));

        // tick 1: ONLY William (Reparto no-op) bounces finalizada → revision and the
        // heart counts the round. Isolating Reparto here proves the count survives.
        const heart1 = await loadFresh(HEART_MOD, { ...env, NEBLLA_SANDBOX_MOCK_WILLIAM: williamMock(n.id, 'esto no está') });
        await heart1.tick({ runAube: async () => {}, runReparto: async () => {} });
        r.eq('William bounced the finalizada note → revision', sprintParseFrontmatter(readNoteFile(dir, n.id)).estado, 'revision');
        r.eq('the bounce was counted as one round in .heart.json', (readHeartFile(dir).revisionRounds || {})[n.id], 1);

        // tick 2: real Reparto (William no-op) now SEES the revision note and
        // re-dispatches it to its SAME owner p1 (revision → en-proceso/finalizada).
        const heart2 = await loadFresh(HEART_MOD, env);
        await heart2.tick({ runWilliam: async () => {} });
        const estado = sprintParseFrontmatter(readNoteFile(dir, n.id)).estado;
        r.ok('the revision note was re-dispatched (left `revision`)', estado !== 'revision', `estado=${estado}`);
      } finally { rmrf(dir); }
    }

    // (b) a revision note at the round cap is NOT re-dispatched (escalated, no burn).
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_PROGRAMMER: '1', NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);
        const n = notes.createNote({ tema: 'no-converge', body: 'eterna' });
        stamp(dir, n.id, { responsable: 'p1', numero: '3' });
        notes.setNoteState(n.id, 'revision');
        // seed a HEALTHY .heart.json (so no rebuild) with the cap already reached.
        fs.writeFileSync(heartFile(dir), JSON.stringify({
          libres: ['p1'], ocupados: [], ordinal: 3,
          assignments: { 'no-converge': 'p1' }, revisionRounds: { [n.id]: 3 },
        }));

        await heart.tick({ runWilliam: async () => {} });

        const estado = sprintParseFrontmatter(readNoteFile(dir, n.id)).estado;
        r.eq('a revision note at the cap stays in `revision` (not re-dispatched, escalated)', estado, 'revision');
      } finally { rmrf(dir); }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 17. n-0003 — the note TUBE survives the harvest. The note .md is gitignored, so
  //     the heart SEEDS a flat copy into the worktree (the programmer can READ its
  //     ## Pide) and DRAINS the per-worktree .bitacora-<id>.txt sidecar back into the
  //     canonical note's ## Bitácora (so a learning is never lost to a merge conflict).
  // ───────────────────────────────────────────────────────────────────────────
  {
    // (a) seed: the note .md lands in the worktree at the path the prompt references.
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);
        const n = notes.createNote({ tema: 'siembra', body: 'lee mi Pide' });
        const wt = path.join(dir, 'fake-worktree');
        fs.mkdirSync(wt, { recursive: true });
        heart.seedNoteIntoWorktree(wt, n.id);
        const seeded = path.join(wt, 'forge', 'backbone', 'sandbox', 'notas', n.id + '.md');
        r.ok('the note was seeded into the worktree at the prompt\'s path', fs.existsSync(seeded), seeded);
        r.ok('the seeded copy carries the ## Pide the programmer must read', fs.readFileSync(seeded, 'utf8').includes('lee mi Pide'));
      } finally { rmrf(dir); }
    }

    // (b) drain: each non-empty sidecar line is appended to the canonical ## Bitácora.
    {
      const dir = freshSandboxDir();
      try {
        const env = { NEBLLA_SANDBOX_DIR: dir, NEBLLA_SANDBOX_MOCK_GIT: '1' };
        const notes = await loadFresh(NOTES_MOD, { NEBLLA_SANDBOX_DIR: dir });
        const heart = await loadFresh(HEART_MOD, env);
        const wtMod = await loadFresh(WORKTREES_MOD, env);
        const n = notes.createNote({ tema: 'cosecha', body: 'x' });
        // write the sidecar where the heart will look for it (worktreeDir under mock).
        const wtdir = wtMod.worktreeDir('p1');
        fs.mkdirSync(wtdir, { recursive: true });
        fs.writeFileSync(path.join(wtdir, '.bitacora-' + n.id + '.txt'), 'aprendí A\n\naprendí B\n');
        heart.drainBitacoraSidecar('p1', n.id);
        const body = readNoteFile(dir, n.id);
        const section = (body.split('## Bitácora')[1] || '');
        r.ok('drained sidecar line A reached the canonical ## Bitácora', section.includes('aprendí A'), section);
        r.ok('drained sidecar line B reached the canonical ## Bitácora', section.includes('aprendí B'), section);
        const count = section.split('\n').map(s => s.trim()).filter(s => s.startsWith('-')).length;
        r.eq('blank sidecar lines were skipped (exactly two entries)', count, 2);
      } finally { rmrf(dir); }
    }
  }
}
