// scripts/sandbox/worktrees.js — the git-worktree plumbing (one per programmer).
//
// Isolation: each programmer works in its OWN git worktree (a real on-disk copy
// of the shop, sharing the repo's `.git`). Two `claude -p` processes writing the
// same file at once would clobber each other in SILENCE; a worktree turns that
// "invisible catastrophic failure" into a "visible, rare" one (git detects the
// only non-deterministic case — a real line-by-line overlap — and never lets it
// through quietly).
//
// Confirmed on THIS machine (git 2.38.1, PowerShell without admin):
//   • WHERE: a hidden, gitignored root INSIDE the repo, same C: volume →
//     <repo>/.wt/<prog>. One per programmer, disposable. (CEO decision: keep the
//     shops inside the repo for portability/permissions — a path outside the repo
//     like C:\nbla-wt risked drive/permission surprises on other machines.) The
//     `.wt/` dir is in .gitignore, so the release's `git add -A` never sees it.
//   • node_modules: a JUNCTION (`mklink /J`) to the main repo's node_modules
//     (0 disk, instant, no admin; require.resolve verified). NEVER a symlink
//     (needs admin) nor a copy (168 MB × N). Nobody runs `npm install` here. The
//     junction resolves to the real (short) node_modules location, so the extra
//     `.wt/<prog>/` depth doesn't push the junction's target past the 260 limit.
//   • `git config core.longpaths true` so deep paths don't blow the 260 limit.
//   • TEARDOWN, always, in this order: `git worktree remove --force` +
//     `git branch -D <branch>` + rmdir the junction. NEVER delete the folder by
//     hand → that leaves a ghost worktree git still believes in.
//
// NEBLLA_SANDBOX_MOCK_GIT (set in tests): SIMULATE everything on disk — a plain
// dir + a `node_modules` junction MARKER (a real dir so require.resolve-style
// checks find it) + a recorded command log — instead of running git / mklink.
// The mock proves the RIGHT plumbing WOULD run without touching the real repo.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sandboxRoot, setSandboxRoot } from './notes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Point the SHARED notes module at THIS module's import-time sandbox dir. notes.js
// is a static import (one shared instance), so re-pointing it here keeps the
// worktree suite — which re-imports worktrees fresh per tmpdir — aimed at the
// current test's dir even though notes.js was first loaded for an earlier dir.
setSandboxRoot((process.env.NEBLLA_SANDBOX_DIR || '').trim() || null);

// The hidden, gitignored root for real worktrees — INSIDE the repo (CEO
// decision: never outside, for portability/permissions). Same C: volume as the
// repo so the junction works. `.wt/` is in .gitignore so `git add -A` never sees
// it. Disposable.
const WT_ROOT = path.join(REPO_ROOT, '.wt');

// CAPTURE the mock flag at IMPORT time. The diana's loadFresh sets
// NEBLLA_SANDBOX_MOCK_GIT only for the duration of the import() and restores it
// immediately, so a call-time read alone would be gone by the time createWorktree
// runs — and the direct worktree suite (which imports THIS module fresh with the
// flag set) needs the captured value to stay hermetic.
let _mockGit = !!(process.env.NEBLLA_SANDBOX_MOCK_GIT || '').trim();

// setMockGit lets a DEPENDENT module (heart.js) — which imports THIS module via a
// STATIC, non-cache-busted specifier (so it shares ONE instance) — re-point the
// mock flag to ITS OWN import-time env. Same pattern as setSandboxRoot, for the
// same reason: worktrees.js loads ONCE, on heart's FIRST import, which may have
// happened in a test that did NOT set MOCK_GIT. Without this, a heart tick running
// under MOCK_GIT='1' would see a stale captured `false` and run REAL git against
// the repo. heart calls this with its OWN captured flag so the teardown it drives
// always honours the mode heart was imported in.
export function setMockGit(on) { _mockGit = !!on; }
// isMock() is the OR of the (possibly re-pointed) captured flag and the live env,
// so EITHER signal saying "mock" means we never touch real git (fail-safe).
function isMock() { return _mockGit || !!(process.env.NEBLLA_SANDBOX_MOCK_GIT || '').trim(); }

// ── STAGE 3 mock hooks (captured at import, like MOCK_GIT) ─────────────────────
// NEBLLA_SANDBOX_MOCK_MERGE — a JSON map prog -> {clean:true} | {conflict:true,
//   files:[...]}. mergeWorktree(prog) returns the canned outcome for `prog` (a
//   missing entry → {clean:true}, the disjoint happy path) instead of running real
//   git. Captured at import so the diana's loadFresh (which sets it only during
//   import) is honoured for the life of this instance.
// NEBLLA_SANDBOX_MOCK_RESOLVER — when set, resolveConflict(prog, files) does NOT
//   spawn `claude`: it records the invocation (prog + files) to listResolverCalls()
//   and returns {resolved:true}. Captured the same way.
let _mockMerge = (process.env.NEBLLA_SANDBOX_MOCK_MERGE || '').trim();
let _mockResolver = !!(process.env.NEBLLA_SANDBOX_MOCK_RESOLVER || '').trim();
export function setMockMerge(json) { _mockMerge = (json || '').trim(); }
export function setMockResolver(on) { _mockResolver = !!on; }
function mockMergeMap() {
  const raw = _mockMerge || (process.env.NEBLLA_SANDBOX_MOCK_MERGE || '').trim();
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}
function isMockResolver() { return _mockResolver || !!(process.env.NEBLLA_SANDBOX_MOCK_RESOLVER || '').trim(); }

// ── command log ───────────────────────────────────────────────────────────────
// In MOCK mode we record the git/junction commands we WOULD have run (the diana
// reads this back to prove `core.longpaths true`, `worktree add`, `worktree
// remove --force` and `branch -D` are all there). The log is persisted to disk
// under the sandbox so it survives the fresh per-call module import the tests do.
function logFile() { return path.join(sandboxRoot(), '.worktree-commands.json'); }

function readLog() {
  try { return JSON.parse(fs.readFileSync(logFile(), 'utf8')); }
  catch { return []; }
}
function record(cmd) {
  const log = readLog();
  log.push(cmd);
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.writeFileSync(logFile(), JSON.stringify(log, null, 2) + '\n');
  } catch { /* best-effort log */ }
}

// The recorded commands so far (mock-mode introspection for the diana).
export function listCommands() { return readLog(); }

// ── silent runner ─────────────────────────────────────────────────────────────
// EVERY git / junction invocation goes through here. It NEVER inherits the console:
// it CAPTURES stdout+stderr (pipe) so a stray git message can't bleed into the TTY.
// In the real daemon removeWorktree runs inside tick() WHILE the interactive Iris
// child owns the terminal (spawnIris → stdio:inherit); a `fatal:`/`error:` line on
// the console would corrupt her TUI (same class of bug we fixed for the programmer
// child). We tee the captured output into the worktree log file (never console),
// so it's there to inspect but never on screen. Returns {status, stdout, stderr}.
function runQuiet(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
  const out = (res.stdout || '') + (res.stderr || '');
  if (out.trim()) {
    try {
      fs.mkdirSync(path.dirname(logFile()), { recursive: true });
      fs.appendFileSync(logFile().replace(/\.json$/, '.out.log'), `[${new Date().toISOString()}] ${cmd} ${args.join(' ')}\n${out}\n`);
    } catch { /* best-effort; NEVER throw into a tick */ }
  }
  return res;
}

// A short branch name for a programmer's worktree.
function branchFor(prog) { return 'sandbox/' + String(prog).replace(/[^a-zA-Z0-9_-]/g, '-'); }

// Where a programmer's worktree lives (real mode = the hidden, gitignored
// <repo>/.wt root; mock mode = under the sandbox tmpdir so it's isolated and
// cleaned with the rest). Exported
// so the demo narration can show the REAL path (the single source of truth) rather
// than hand-building one that drifts from what create/removeWorktree actually use.
export function worktreeDir(prog) {
  const safe = String(prog).replace(/[^a-zA-Z0-9_-]/g, '-');
  if (isMock()) return path.join(sandboxRoot(), 'worktrees', safe);
  return path.join(WT_ROOT, safe);
}

// ── createWorktree ────────────────────────────────────────────────────────────
// Real: git worktree add (under <repo>/.wt/<prog>) + core.longpaths true + a
// node_modules junction to the main repo. Mock: a real dir + a node_modules
// marker dir + the same recorded commands.
export function createWorktree(prog) {
  const dir = worktreeDir(prog);
  const branch = branchFor(prog);
  const nodeModulesTarget = path.join(REPO_ROOT, 'node_modules');
  const nodeModulesLink = path.join(dir, 'node_modules');

  // The plumbing we run (recorded in both modes so the log is the contract).
  record('git config core.longpaths true');
  record(`git worktree add ${dir} -b ${branch}`);
  record(`mklink /J "${nodeModulesLink}" "${nodeModulesTarget}"`);

  if (isMock()) {
    // Simulate on disk: a real worktree dir + a node_modules junction MARKER (a
    // real dir, so a require.resolve-style existence check passes the way the
    // real junction would). Nothing touches the actual repo or git.
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(nodeModulesLink, { recursive: true });
    // a tiny marker file makes the junction unmistakable in the diana
    try { fs.writeFileSync(path.join(dir, '.nbla-junction'), nodeModulesTarget); } catch {}
    return { dir };
  }

  // ── real mode ──────────────────────────────────────────────────────────────
  // ALL invocations CAPTURE their output (runQuiet) — never inherit the console —
  // so nothing git/mklink says can corrupt Iris's TUI in the live daemon.
  fs.mkdirSync(WT_ROOT, { recursive: true });
  runQuiet('git', ['config', 'core.longpaths', 'true'], { cwd: REPO_ROOT });
  const add = runQuiet('git', ['worktree', 'add', dir, '-b', branch], { cwd: REPO_ROOT });
  if (add.status !== 0 && add.error) {
    throw new Error(`git worktree add falló para ${prog}: ${add.error.message}`);
  }
  // node_modules junction (/J) — no admin, 0 disk. cmd's mklink, ARRAY args.
  runQuiet('cmd', ['/c', 'mklink', '/J', nodeModulesLink, nodeModulesTarget], { cwd: REPO_ROOT });
  return { dir };
}

// ── removeWorktree ────────────────────────────────────────────────────────────
// Full teardown — no ghost left. Real: git worktree remove --force + branch -D +
// rmdir the junction (NEVER delete the folder by hand). Mock: record the same
// commands + actually remove the simulated dir.
export function removeWorktree(prog) {
  const dir = worktreeDir(prog);
  const branch = branchFor(prog);
  const nodeModulesLink = path.join(dir, 'node_modules');

  record(`rmdir "${nodeModulesLink}"`);
  record(`git worktree remove --force ${dir}`);
  record(`git branch -D ${branch}`);

  if (isMock()) {
    // Remove the simulated dir entirely (no ghost). The junction marker goes with it.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    return;
  }

  // ── real mode ──────────────────────────────────────────────────────────────
  // IDEMPOTENT teardown: a worktree/branch that was never created (e.g. the
  // programmer was mocked and createWorktree was skipped) or already cleaned is
  // treated as "already clean" — NO error, NO noise. We CHECK existence before each
  // step (git is the source of truth, not the folder), and even the destructive
  // calls go through runQuiet so a residual "not a working tree" / "branch not
  // found" is captured to the log, never printed and never thrown.

  // 1) rmdir the junction FIRST (removes the link, not the target's contents) —
  //    only if the link is actually there.
  if (fs.existsSync(nodeModulesLink)) {
    runQuiet('cmd', ['/c', 'rmdir', nodeModulesLink], { cwd: REPO_ROOT });
  }

  // 2) git worktree remove --force — only if git still tracks this worktree path.
  //    `git worktree list` is the authority (the folder may be gone yet git still
  //    believe in it, or never have existed at all).
  if (gitKnowsWorktree(dir)) {
    runQuiet('git', ['worktree', 'remove', '--force', dir], { cwd: REPO_ROOT });
  }
  // prune any stale bookkeeping (harmless if there's nothing to prune).
  runQuiet('git', ['worktree', 'prune'], { cwd: REPO_ROOT });

  // 3) drop the branch — only if it exists.
  if (gitBranchExists(branch)) {
    runQuiet('git', ['branch', '-D', branch], { cwd: REPO_ROOT });
  }
}

// ── mergeWorktree ───────────────────────────────────────────────────────────
// Fuse a finished programmer's branch into the sandbox trunk. The heart calls
// this — SERIALIZED, one at a time inside a tick — BEFORE removeWorktree, because
// the global .git/index.lock means two simultaneous commits collide. The happy
// path (disjoint temas) is git's automatic clean merge: free + deterministic. The
// ONLY non-deterministic case is a REAL line-by-line overlap of the same file,
// which git DETECTS and marks (it never overwrites in silence) → we return
// {conflict, files} and the heart escalates to resolveConflict.
//
// Returns {clean:true} | {conflict:true, files:string[]}.
//
// MOCK (NEBLLA_SANDBOX_MOCK_MERGE): no real git — return the canned outcome for
// `prog` (a missing entry → {clean}, the disjoint default). We STILL record the
// `git merge <branch>` line so the diana can read the serial order back off disk.
export function mergeWorktree(prog) {
  const branch = branchFor(prog);
  // record the merge in the SAME command log the diana reads, so the serialized
  // order (merge → remove, never two merges interleaved) is verifiable on disk.
  record(`git merge ${branch}`);

  if (isMock()) {
    const map = mockMergeMap();
    const canned = map && map[prog];
    if (canned && canned.conflict) {
      return { conflict: true, files: Array.isArray(canned.files) ? canned.files : [] };
    }
    return { clean: true };
  }

  // ── real mode ──────────────────────────────────────────────────────────────
  // Merge the programmer's branch into whatever HEAD the sandbox trunk is on. We
  // capture the output (runQuiet) so a `CONFLICT` line never bleeds into Iris's
  // TUI. A non-zero status with conflict markers → parse the conflicted files from
  // `git diff --name-only --diff-filter=U`; never a silent clean.
  const res = runQuiet('git', ['merge', '--no-edit', branch], { cwd: REPO_ROOT });
  if (res.status === 0) return { clean: true };
  // a conflict (or any failure): collect the unmerged files git flagged.
  let files = [];
  try {
    const diff = runQuiet('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: REPO_ROOT });
    files = (diff.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
  } catch { /* best-effort */ }
  return { conflict: true, files };
}

// ── resolveConflict ─────────────────────────────────────────────────────────
// A REAL conflict that git detected → escalate to a `claude -p` resolver. This is
// the ONLY non-deterministic point in the worktree plumbing, and it's rare (Aubé
// reparts by tema so same-file overlaps are unusual). Returns {resolved:true}.
//
// MOCK (NEBLLA_SANDBOX_MOCK_RESOLVER): no real claude — record the invocation
// (prog + files) to listResolverCalls() and return resolved. The diana asserts the
// resolver was invoked exactly once with the conflicting programmer + files.
//
// REAL: a `claude -p` with ARRAY args, NO shell (win32 cmd.exe would mangle the
// prompt's metacharacters), the subscription token inherited from env — NEVER an
// API key. Its job is to resolve the marked conflict in the trunk and commit.
export function resolveConflict(prog, files) {
  recordResolverCall(prog, Array.isArray(files) ? files : []);

  if (isMockResolver() || isMock()) {
    return { resolved: true };
  }

  // ── real mode ──────────────────────────────────────────────────────────────
  const fileList = (Array.isArray(files) ? files : []).join(', ');
  const prompt = [
    'Eres el resolutor de conflictos del sandbox de Neblla. Al fundir la rama del',
    `programador "${prog}" en el tronco, git marcó un conflicto línea-a-línea en`,
    `estos ficheros: ${fileList}. Resuelve los marcadores de conflicto (<<<<<<< /`,
    '======= / >>>>>>>) conservando la intención de AMBOS lados de forma coherente,',
    'y deja el merge cerrado (git add + git commit --no-edit). NO toques nada fuera',
    'de los ficheros en conflicto. Cuando termines, sal.',
  ].join(' ');
  runQuiet('claude', ['-p', prompt, '--allowedTools', 'Read,Edit,Bash'], { cwd: REPO_ROOT });
  return { resolved: true };
}

// ── resolver-call log (mock introspection for the diana) ──────────────────────
// Persisted to disk under the sandbox (like the command log) so it survives the
// fresh per-call module import the tests do. Each entry = {prog, files}.
function resolverLogFile() { return path.join(sandboxRoot(), '.resolver-calls.json'); }
function recordResolverCall(prog, files) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(resolverLogFile(), 'utf8')); } catch { log = []; }
  log.push({ prog, files });
  try {
    fs.mkdirSync(path.dirname(resolverLogFile()), { recursive: true });
    fs.writeFileSync(resolverLogFile(), JSON.stringify(log, null, 2) + '\n');
  } catch { /* best-effort log */ }
}
export function listResolverCalls() {
  try { return JSON.parse(fs.readFileSync(resolverLogFile(), 'utf8')); }
  catch { return []; }
}

// Does git currently track a worktree at `dir`? Compares resolved paths so a
// drive-letter / separator mismatch doesn't cause a false negative. On any error
// (no repo, git missing) we answer "no" → the teardown becomes a clean no-op.
function gitKnowsWorktree(dir) {
  try {
    const res = runQuiet('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT });
    if (res.status !== 0 || !res.stdout) return false;
    const want = path.resolve(dir).toLowerCase();
    for (const line of res.stdout.split('\n')) {
      const m = line.match(/^worktree\s+(.*)$/);
      if (m && path.resolve(m[1].trim()).toLowerCase() === want) return true;
    }
    return false;
  } catch { return false; }
}

// Does the branch exist? `git branch --list <b>` prints the name when present,
// nothing when absent. Any error → "no" (clean no-op).
function gitBranchExists(branch) {
  try {
    const res = runQuiet('git', ['branch', '--list', branch], { cwd: REPO_ROOT });
    return res.status === 0 && !!(res.stdout && res.stdout.trim());
  } catch { return false; }
}
