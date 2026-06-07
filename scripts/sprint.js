#!/usr/bin/env node
//
// scripts/sprint.js — the deterministic sprint director.
//
// Turns the Neblla work-cycle from PROSE (a contract in CLAUDE.md that Iris
// honors by hand) into CODE that is the only path possible. Iris drives it with
// ONE verb + two levers; the program owns the order, the counters, the caps, it
// summons the workers AND the challenger (Iris talks to neither), and it ticks
// the sprint checkboxes. Iris only supplies content + judgement.
//
// State machine (fixed order, none skippable):
//     replan → build → release → cierre
//
// (The `diana` step is gone from the director: the test diana is now BORN in the
// documentation phase — the docs workflow fills the `## Diana` section of the
// implementation sprint's .md — so it is no longer a director step. Only WHO
// fills the diana changed; the build-step gate that RUNS it is untouched. Iris +
// Lina REPLAN from the docs "biblia" at the `replan` step.)
//
// (Coherencia used to be a blocking step here; it moved OUT of the director and
// into Anselmo at release time — a NON-blocking docs/BACKLOG-vs-code review that
// only leaves an advisory for Iris, never halts. See release-and-test.js.)
//
// Interface:
//   node scripts/sprint.js open --slug <s> --topic "<t>"   create the .md + JSON
//   node scripts/sprint.js open --slug <s> --topic "<t>" --hotfix --fixes <parent>  open a one-pass hotfix sprint
//   node scripts/sprint.js next                            READ-ONLY: where am I, what is it waiting for, last rejections
//   node scripts/sprint.js next --file <artifact> [--impose]  submit the current step's artifact; advance on approval
//   node scripts/sprint.js retry                           rewind the current step and re-run it clean
//
// Design (locked — see backbone/sprints/sprint-orchestrator.md):
//   • STATE = sidecar JSON  backbone/sprints/<slug>.state.json  (NOT in the .md).
//     The .md is the human whiteboard (replan/diana/log + the visible checkboxes;
//     the `## Diana` section is filled by the docs phase, not a director step).
//     The program ticks checkboxes by a SAFE bounded round-trip: it only flips
//     `- [ ] `→`- [x] ` lines inside the `## Casillas` section, by index, and
//     appends to `## Log`. It never rewrites the prose sections.
//   • Counters live ONLY in the JSON and the CLI NEVER prints them (promise model,
//     CEO-locked: the state must stay hand-editable to fix a broken loop — no seal).
//   • Atomic writes (tmp + rename).
//   • Crash-recovery: `next` (empty) reads the JSON; if it is missing, it rebuilds
//     a DEGRADED state from the .md (frontmatter status + ticked checkboxes).
//   • Adversarial steps: on a Tomás reject, blocks++; at the 3rd block AUTO-APPROVE
//     (backstop; a HOTFIX caps at 1 — single pass). `--impose` is rejected if
//     attempts<1 at this step.
//   • build: runs the diana subset as a deterministic gate (`node tests/run.js
//     <filtro>` — the `## Diana` section declares the filter). RED → do NOT
//     advance, "back to Miguel" (the fix-loop of 5 lives in release-and-test.js;
//     not duplicated here). GREEN → summon Tomás as an honesty check.
//   • release: assert all prior approved, set frontmatter status: releasing, and
//     PRINT "pídele a Tie que lance `npm run release`". The program NEVER launches
//     the release.
//   • cierre: close only if release green + Otto OK — read the receipt written
//     INTO THIS sprint's own .md (the `## Recibo de release` section, stamped
//     `build <n>` by release-and-test.js after Otto goes green). Each sprint reads
//     ITS OWN receipt — no shared `.release-ok`, so a stale cross-sprint receipt
//     can never close a new sprint. No receipt → reject close, stay in release.
//
// Hotfix variant (`open --hotfix`): when Otto fails after a deploy, release-and-
// test.js exits non-zero and drops backbone/sprints/.hotfix-needed.json. Iris
// opens a HOTFIX sprint (flag state.hotfix=true): single-pass adversary (Tomás
// passes once, no 3-block cap), findActiveSlug prioritises it, and closing it
// marks the parent sprint done with a `fixes:` pointer.
//
// Validator verdict capture (the fragile point — sentinel+file contract, NOT
// prose scraping): the headless validator writes backbone/sprints/.verdict.json
// (`{verdict:"ok|reject", blocking:[], menor:[]}`) and prints a sentinel line; the
// parent reads the FILE. FAIL-CLOSED: missing/unparseable → INVALID (not approved,
// not counted as a block) → tell Iris to retry. `.verdict.json` is deleted before
// each invocation; atomic write.
//
// Testability: set NEBLLA_SPRINT_MOCK_VERDICT (a JSON object, or a path to a JSON
// file) to make the Tomás/Ana Liz call return a canned verdict instead of spawning
// `claude`. The diana test suite (tests/22-sprint-orchestrator.test.js) uses this.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT } from './lib/target.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ROOT = the PRODUCT this sprint builds (project/), NOT the forge. Sprint state,
// the diana gate (`node tests/run.js`), worker cwd and version all ride this.
const ROOT = PROJECT_ROOT;
const SPRINTS_DIR = path.join(ROOT, 'forge', 'backbone', 'sprints');
const VERDICT_FILE = path.join(SPRINTS_DIR, '.verdict.json');
const HOTFIX_FILE = path.join(SPRINTS_DIR, '.hotfix-needed.json');
const VERSION_FILE = path.join(ROOT, 'public', 'version.txt');
const README_TEMPLATE = path.join(SPRINTS_DIR, 'README.md');

// Mirror of release-and-test.js `peekNextVersion`: the build number the NEXT
// release WOULD carry, without writing it. Kept byte-for-byte identical in logic
// so the two scripts never disagree about which build a release ships. We peek
// this at the release transition and stamp it as the EXPECTED build for the
// receipt that closes the sprint — binding the in-doc `## Recibo de release` to
// THIS cycle's release, so a receipt with the wrong build can never close it.
function peekNextVersion() {
  let cur = 0;
  try { cur = parseInt(String(fs.readFileSync(VERSION_FILE, 'utf8')).trim(), 10) || 0; } catch { /* no file yet */ }
  return cur + 1;
}

// ── the fixed pipeline ───────────────────────────────────────────────────────
// Each step names its worker (the role that produces the artifact). The
// challenger that adversarially reviews each gated step is always Tomás (the
// honesty check). Coherencia is no longer a director step — it moved to Anselmo
// at release time as a non-blocking advisory.
const STEPS = ['replan', 'build', 'release', 'cierre'];
const STEP_WORKER = {
  replan: 'Lina Bo Bardi + Iris (replan desde la biblia)',
  build: 'Miguel',
  release: '(el CEO lanza el release)',
  cierre: '(recibo de Otto)',
};
// In plain Spanish, what the program is waiting for at each pending step.
const STEP_WAIT = {
  replan: 'el plan de acción replanificado desde la biblia (Lina + Iris), con la diana ya documentada. Pásalo con `next --file <plan>`.',
  build: 'lo construido por Miguel. Pásalo con `next --file <resumen-build>`; correré la diana como puerta antes de pasarlo a Tomás.',
  release: 'que el CEO lance `npm run release`. Yo no lo lanzo.',
  cierre: 'el recibo de un release verde (Otto OK). Cierra con `next` cuando exista.',
};

const CAP_BLOCKS = 3;          // at the 3rd block, AUTO-APPROVE (backstop).

// ── small utilities ──────────────────────────────────────────────────────────
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readFile = (p) => fs.readFileSync(p, 'utf8');

function atomicWrite(file, contents) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, contents);
  // rename is atomic, but on Windows a virus scanner / indexer can briefly hold
  // a transient lock on the just-written tmp file → EPERM/EBUSY. Retry a few
  // times with a tiny backoff; fall back to a direct (non-atomic) write only if
  // rename keeps failing, so a single flake never aborts a sprint command.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && i < 10) {
        const until = Date.now() + 25; while (Date.now() < until) { /* spin briefly */ }
        continue;
      }
      // last resort: overwrite in place, then drop the tmp.
      try { fs.writeFileSync(file, contents); try { fs.unlinkSync(tmp); } catch {} return; }
      catch { throw e; }
    }
  }
}

function die(msg) { console.error(msg); process.exit(2); }

// ── arg parsing (tiny, dependency-free) ──────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      // boolean flags vs --key value
      if (['impose', 'hotfix'].includes(key)) { out.flags[key] = true; }
      else { out.flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    } else out._.push(a);
  }
  return out;
}

// ── frontmatter + .md section helpers ────────────────────────────────────────
// Parse the YAML-ish frontmatter (key: value) between the leading `---` fences.
function parseFrontmatter(md) {
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
// Replace `status:` in the frontmatter, preserving everything else.
function setFrontmatterStatus(md, status) {
  return md.replace(/^(---\n[\s\S]*?\nstatus:\s*)([^\n]*)(\n[\s\S]*?\n---)/, `$1${status}$3`);
}

// Locate the `## Casillas …` section and return {start,end} line indices of its
// body (the lines AFTER the heading, up to the next `## ` or EOF).
function casillasRange(lines) {
  let head = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Casillas\b/i.test(lines[i])) { head = i; break; }
  }
  if (head < 0) return null;
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { head, bodyStart: head + 1, end };
}

// The checkbox lines (in order) inside `## Casillas`, with their absolute index.
function checkboxLines(lines) {
  const r = casillasRange(lines);
  if (!r) return [];
  const out = [];
  for (let i = r.bodyStart; i < r.end; i++) {
    if (/^- \[[ xX]\]\s/.test(lines[i])) out.push({ idx: i, checked: /^- \[[xX]\]/.test(lines[i]) });
  }
  return out;
}

// SAFE round-trip: flip exactly the checkbox at ordinal `n` (0-based, among the
// checkbox lines in `## Casillas`) from `- [ ] `→`- [x] `. Touches nothing else.
function tickCheckbox(md, n) {
  const lines = md.split('\n');
  const boxes = checkboxLines(lines);
  if (n < 0 || n >= boxes.length) return md;   // out of range → no-op (degraded sprints may have fewer)
  const { idx } = boxes[n];
  lines[idx] = lines[idx].replace(/^- \[ \]/, '- [x]');
  return lines.join('\n');
}

// Append a dated line to the `## Log` section (at its end, before the next `## `
// or EOF). If there is no `## Log`, append one.
function appendLog(md, line) {
  const lines = md.split('\n');
  let head = -1;
  for (let i = 0; i < lines.length; i++) if (/^##\s+Log\b/i.test(lines[i])) { head = i; break; }
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `- ${stamp} — ${line}`;
  if (head < 0) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push('## Log', entry);
    return lines.join('\n');
  }
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  // insert just before `end`, trimming a trailing blank inside the section
  let insertAt = end;
  while (insertAt - 1 > head && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, entry);
  return lines.join('\n');
}

// Parse the test filter out of the `## Diana` section: a line like
// `filtro: 22` or `node tests/run.js 22`. Falls back to the slug.
function dianaFilter(md, slug) {
  const m = md.match(/^##\s+Diana[\s\S]*?(?=^##\s|\Z)/m);
  const section = m ? m[0] : md;
  let mm = section.match(/^\s*filtro:\s*([^\n]+)$/im);
  if (mm) return mm[1].trim();
  mm = section.match(/node\s+tests\/run\.js\s+([^\n`]+)/i);
  if (mm) return mm[1].trim();
  return slug;
}

// Read the release receipt written INTO this sprint's own .md by release-and-
// test.js after Otto goes green. The receipt lives in a `## Recibo de release`
// section and contains the literal stamp `build <n>`. Returns the build number
// (string) or null if there is no receipt yet / no parseable build. This is the
// in-doc replacement for the old shared `.release-ok`: each sprint reads ITS OWN
// receipt, so a stale cross-sprint receipt can never close a new sprint.
function readReceiptBuild(slug) {
  let md;
  try { md = readFile(mdPath(slug)); } catch { return null; }
  const m = md.match(/^##\s+Recibo de release[\s\S]*?(?=^##\s|\Z)/m);
  if (!m) return null;
  const mm = m[0].match(/build\s*[:=]?\s*(\d+)/i);
  return mm ? mm[1] : null;
}

// ── state file (sidecar JSON) ────────────────────────────────────────────────
function statePath(slug) { return path.join(SPRINTS_DIR, slug + '.state.json'); }
function mdPath(slug) { return path.join(SPRINTS_DIR, slug + '.md'); }

function freshState(slug, { hotfix = false, fixes = null } = {}) {
  const steps = {};
  for (const s of STEPS) steps[s] = { status: 'locked', attempts: 0, blocks: 0, imposed: false };
  steps[STEPS[0]].status = 'pending';
  const st = {
    slug,
    step: STEPS[0],          // resume pointer = the first non-approved step
    steps,
    verdicts: [],            // auditable trail: {step, verdict, blocking, menor, at, imposed?, auto?, invalid?}
    checkboxes: [],          // ordinals ticked, in order
    release: {},             // {requestedAt, receiptBuild}
  };
  // Hotfix sprints: single-pass adversary (Tomás passes ONCE, no 3-block cap),
  // findActiveSlug prioritises them, and closing one marks the parent done.
  if (hotfix) { st.hotfix = true; if (fixes) st.fixes = fixes; }
  return st;
}

function loadState(slug) {
  const p = statePath(slug);
  if (exists(p)) {
    try { return JSON.parse(readFile(p)); }
    catch { /* corrupt → fall through to degraded rebuild */ }
  }
  // ── crash-recovery: degraded rebuild from the .md ──────────────────────────
  // No JSON (or it is corrupt). Reconstruct what we can from the whiteboard: the
  // frontmatter status + which checkboxes are ticked. We cannot recover the
  // per-step counters (they only ever lived in the JSON) — so we rebuild a state
  // that is SAFE to resume: every step up to the implied phase is `approved`, the
  // current phase is `pending` with zeroed counters. This is the "reabrir +
  // next() reengancha" path.
  const md = readFile(mdPath(slug));
  const fm = parseFrontmatter(md);
  // Preserve the hotfix marks across a degraded rebuild — they live in the
  // frontmatter (hotfix: true / fixes: <parent>) so the .md alone can recover them.
  const st = freshState(slug, {
    hotfix: String(fm.hotfix || '').toLowerCase() === 'true',
    fixes: fm.fixes && fm.fixes !== 'true' ? fm.fixes : null,
  });
  st._degraded = true;
  // Record which checkboxes are already ticked (so we never re-tick).
  const boxes = checkboxLines(md.split('\n'));
  st.checkboxes = boxes.map((b, i) => (b.checked ? i : -1)).filter(i => i >= 0);
  // Resume pointer: the README says any role resumes "mirando la primera casilla
  // sin marcar". The default template has ONE checkbox per step in order, so the
  // count of ticked checkboxes is the most faithful resume signal. We also read
  // the frontmatter status (which only advances at release) and take the FURTHER
  // of the two — so a crash mid-build (status still `planning`, but replan
  // ticked) resumes at build, not at replan.
  // `verifying` resumes at build now that coherencia is gone from the director.
  const phaseByStatus = { planning: 'replan', building: 'build', verifying: 'build', releasing: 'release', done: 'cierre' };
  const fmIdx = STEPS.indexOf(phaseByStatus[(fm.status || 'planning')] || 'replan');
  const tickedCount = st.checkboxes.length;                 // 1 per approved step (default template)
  const boxIdx = Math.min(tickedCount, STEPS.length - 1);   // first unticked = how many are ticked
  const resumeIdx = (fm.status === 'done') ? STEPS.length - 1 : Math.max(fmIdx, boxIdx);
  for (let i = 0; i < STEPS.length; i++) {
    if (i < resumeIdx) st.steps[STEPS[i]].status = 'approved';
    else if (i === resumeIdx) st.steps[STEPS[i]].status = (fm.status === 'done') ? 'approved' : 'pending';
    else st.steps[STEPS[i]].status = 'locked';
  }
  st.step = STEPS[resumeIdx];
  return st;
}

function saveState(st) { atomicWrite(statePath(st.slug), JSON.stringify(st, null, 2) + '\n'); }

// ── find the active sprint ───────────────────────────────────────────────────
// Active = the only .md whose frontmatter status != done. If several, require
// --slug. If a --slug is given, use it directly.
function findActiveSlug(explicitSlug) {
  if (explicitSlug) {
    if (!exists(mdPath(explicitSlug))) die(`no existe el sprint '${explicitSlug}' (falta ${path.relative(ROOT, mdPath(explicitSlug))}).`);
    return explicitSlug;
  }
  let mds = [];
  try { mds = fs.readdirSync(SPRINTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md'); } catch {}
  const open = [];
  const openHotfix = [];
  for (const f of mds) {
    const fm = parseFrontmatter(readFile(path.join(SPRINTS_DIR, f)));
    if ((fm.status || 'planning') === 'done') continue;
    const slug = f.replace(/\.md$/, '');
    open.push(slug);
    if (String(fm.hotfix || '').toLowerCase() === 'true') openHotfix.push(slug);
  }
  // A hotfix sprint jumps the queue: it's the urgent thing in flight (Otto just
  // failed). If exactly one hotfix is open, that's the active sprint regardless
  // of any parked parent.
  if (openHotfix.length === 1) return openHotfix[0];
  if (openHotfix.length > 1) die(`hay varios hotfix abiertos (${openHotfix.join(', ')}). Indica cuál con --slug <s>.`);
  if (open.length === 0) die('no hay ningún sprint abierto (todos están en status: done). Abre uno con `sprint open --slug <s> --topic "<t>"`.');
  if (open.length > 1) die(`hay varios sprints abiertos (${open.join(', ')}). Indica cuál con --slug <s>.`);
  return open[0];
}

// ── headless validator (Tomás / Ana Liz) ─────────────────────────────────────
// Reuses the proven runAnselmo/runMiguelFix pattern from release-and-test.js:
// spawnSync with an args array and NO shell on every platform (so cmd.exe can't
// mangle the prompt's metacharacters on win32). Validators get
// --allowedTools Read,Bash (they must NOT edit code or
// checkboxes). Verdict is captured via the sentinel+FILE contract, never prose.
//
// FAIL-CLOSED: a missing / unparseable .verdict.json → returned as invalid:true
// (NOT approved, NOT counted as a block).
//
// MOCK: NEBLLA_SPRINT_MOCK_VERDICT short-circuits the spawn and returns a canned
// verdict (a JSON literal, or a path to a JSON file). Used by the diana suite so
// no real `claude` is summoned.
function readVerdictFile() {
  if (!exists(VERDICT_FILE)) return { invalid: true, reason: 'no se escribió forge/backbone/sprints/.verdict.json' };
  let raw;
  try { raw = readFile(VERDICT_FILE); } catch (e) { return { invalid: true, reason: 'no se pudo leer .verdict.json: ' + e.message }; }
  let v;
  try { v = JSON.parse(raw); } catch { return { invalid: true, reason: '.verdict.json no es JSON válido' }; }
  if (v.verdict !== 'ok' && v.verdict !== 'reject') return { invalid: true, reason: `.verdict.json sin verdict ok|reject (vi: ${JSON.stringify(v.verdict)})` };
  return { verdict: v.verdict, blocking: Array.isArray(v.blocking) ? v.blocking : [], menor: Array.isArray(v.menor) ? v.menor : [] };
}

function runValidator({ role, slug, step, file }) {
  // Always start from a clean slate so we never read a stale verdict.
  try { fs.unlinkSync(VERDICT_FILE); } catch {}

  // ── MOCK path (tests) ──────────────────────────────────────────────────────
  const mock = process.env.NEBLLA_SPRINT_MOCK_VERDICT;
  if (mock) {
    let v;
    try { v = exists(mock) ? JSON.parse(readFile(mock)) : JSON.parse(mock); }
    catch { return { invalid: true, reason: 'NEBLLA_SPRINT_MOCK_VERDICT no parsea' }; }
    // Honor fail-closed even in mock: an explicit {invalid:true} mock returns invalid.
    if (v && v.invalid) return { invalid: true, reason: v.reason || 'mock invalid' };
    // Mirror the real contract: the validator "writes" the file, the parent reads it.
    atomicWrite(VERDICT_FILE, JSON.stringify(v));
    return readVerdictFile();
  }

  // ── real headless spawn ────────────────────────────────────────────────────
  const verdictRel = path.relative(ROOT, VERDICT_FILE).replace(/\\/g, '/');
  const fileRel = file ? path.relative(ROOT, path.resolve(ROOT, file)).replace(/\\/g, '/') : '(sin artefacto)';
  const prompt =
    `Eres ${role} (ver la seccion "Empleados" de CLAUDE.md): el abogado del diablo / la verdad del estado, en modo headless. ` +
    `Estas verificando la etapa "${step}" del sprint "${slug}" (forge/backbone/sprints/${slug}.md). ` +
    `El artefacto a juzgar esta en: ${fileRel}. Lee tambien la casilla correspondiente en ## Casillas y la ## Diana del sprint: ese es tu reglamento, NO inventes requisitos nuevos. ` +
    `Ponte incredulo e intenta tumbar la etapa SOLO contra la diana y la definicion escrita. Dos cubos: BLOQUEANTE (rompe la diana, publicaria un bug, o el verde es falso) vs MENOR (mejora/estetica). ` +
    `NO edites codigo, NO edites tests, NO marques casillas — solo lees y razonas (puedes correr "node tests/run.js <filtro>" para comprobar). ` +
    `Cuando termines, ESCRIBE el veredicto en el fichero ${verdictRel} con este JSON EXACTO: {"verdict":"ok"|"reject","blocking":[...strings...],"menor":[...strings...]}. ` +
    `"ok" si no lograste tumbarla; "reject" si encontraste algo bloqueante (lista los motivos en blocking). Los menores van en menor y NO bloquean. ` +
    `Despues imprime una sola linea: SPRINT_VERDICT_WRITTEN.`;

  const allowed = 'Read,Bash';
  // ARRAY of args, NO shell on any platform: claude is a real PATH executable, so
  // each arg is passed verbatim and cmd.exe never sees (and mangles) the prompt's
  // metacharacters on win32 — `<filtro>` would otherwise be read as cmd input
  // redirection from a missing file and crash every validator spawn.
  const r = spawnSync('claude', ['-p', prompt, '--allowedTools', allowed], { cwd: ROOT, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (r.error) return { invalid: true, reason: `no se pudo lanzar al validador (\`claude\`): ${r.error.message}` };
  // Even if claude exited cleanly we DO NOT trust its stdout — we read the file.
  return readVerdictFile();
}

// ── the diana gate (build step) ──────────────────────────────────────────────
// Runs `node tests/run.js <filtro>` as a deterministic gate. Returns {green,code}.
// The fix-loop of 5 lives in release-and-test.js and is NOT duplicated here.
// MOCK: NEBLLA_SPRINT_MOCK_GATE = '0' (green) | non-zero (red) skips the real run.
function runDianaGate(filter) {
  const mock = process.env.NEBLLA_SPRINT_MOCK_GATE;
  if (mock !== undefined) {
    const code = Number(mock) || 0;
    return { green: code === 0, code };
  }
  const r = spawnSync(process.execPath, ['tests/run.js', filter], { cwd: ROOT, stdio: 'inherit' });
  const code = typeof r.status === 'number' ? r.status : 1;
  return { green: code === 0, code };
}

// ── checkbox bookkeeping ──────────────────────────────────────────────────────
// Tick the NEXT not-yet-ticked checkbox for this approval, persist the .md, and
// record the ordinal in state.checkboxes. Each approved step ticks exactly one
// checkbox (in document order). Append a Log line.
function tickNextCheckbox(st, note) {
  let md = readFile(mdPath(st.slug));
  const boxes = checkboxLines(md.split('\n'));
  // the first checkbox whose ordinal isn't already in st.checkboxes
  let n = -1;
  for (let i = 0; i < boxes.length; i++) {
    if (!boxes[i].checked && !st.checkboxes.includes(i)) { n = i; break; }
  }
  if (n < 0) return;                       // nothing left to tick (already done / degraded)
  md = tickCheckbox(md, n);
  if (note) md = appendLog(md, note);
  atomicWrite(mdPath(st.slug), md);
  st.checkboxes.push(n);
}

function setMdStatus(slug, status) {
  let md = readFile(mdPath(slug));
  md = setFrontmatterStatus(md, status);
  atomicWrite(mdPath(slug), md);
}

// When a HOTFIX sprint closes, mark its PARENT sprint done too: the parent was
// parked when Otto failed; the hotfix carried the real fix to production. We
// flip the parent's frontmatter to `done` and append a Log line pointing back at
// the hotfix. Best-effort: if the parent .md is gone we just note it and move on
// (the hotfix itself closed fine — the parent pointer is bookkeeping).
function closeParentSprint(parentSlug, hotfixSlug, build) {
  if (!exists(mdPath(parentSlug))) {
    console.log(`(aviso: no encuentro el .md del sprint padre '${parentSlug}' para marcarlo done.)`);
    return;
  }
  let md = readFile(mdPath(parentSlug));
  md = setFrontmatterStatus(md, 'done');
  md = appendLog(md, `Cerrado vía hotfix '${hotfixSlug}' (release verde build ${build}).`);
  atomicWrite(mdPath(parentSlug), md);
  // Drop the parent's sidecar state if it's still around (it's gitignored/ephemeral).
  try { fs.unlinkSync(statePath(parentSlug)); } catch {}
}

// ── advance pointer ───────────────────────────────────────────────────────────
function approveAndAdvance(st, step, { note, imposed = false, auto = false } = {}) {
  st.steps[step].status = 'approved';
  st.steps[step].imposed = imposed;
  tickNextCheckbox(st, note);
  const idx = STEPS.indexOf(step);
  st.step = idx + 1 < STEPS.length ? STEPS[idx + 1] : step;
}

// ── the READ-ONLY orientation (`next` with no --file) ─────────────────────────
function describeCurrent(st) {
  const step = st.step;
  const s = st.steps[step];
  console.log(`Sprint activo: ${st.slug}`);
  console.log(`Paso actual: ${step}   (${STEP_WORKER[step] || ''})`);
  if (st._degraded) console.log(`(aviso: reconstruido desde el .md — faltaba el estado JSON; los contadores se reiniciaron, sigue desde aquí)`);
  if (st.hotfix) console.log(`(hotfix: pasada única — Tomás valida una sola vez, sin red de fondo; al cerrar marca done el sprint padre${st.fixes ? ' ' + st.fixes : ''}.)`);
  console.log(`Esperando: ${STEP_WAIT[step] || '—'}`);
  // last rejection reasons for THIS step + a sense of how stuck it is (without
  // ever printing the raw counter — promise model).
  const lastReject = [...st.verdicts].reverse().find(v => v.step === step && v.verdict === 'reject');
  if (lastReject && (lastReject.blocking || []).length) {
    console.log(`Último rechazo de Tomás en este paso:`);
    for (const b of lastReject.blocking) console.log(`  • ${b}`);
  }
  const blocks = s.blocks || 0;
  if (blocks > 0 && step !== 'release' && step !== 'cierre') {
    if (blocks >= CAP_BLOCKS - 1) console.log(`Aviso: este paso ya rebotó varias veces; el siguiente rebote dispara la red de fondo (aprobación automática).`);
    else console.log(`Este paso ha rebotado al menos una vez; reintenta con un artefacto corregido (o usa \`retry\` para empezar limpio).`);
  }
  // tip about the levers
  if (step === 'release') console.log(`\nCuando el release termine verde (Otto OK escribe el recibo en este .md), cierra con \`next\`.`);
  else if (step === 'cierre') console.log(`\nCierra con \`next\` (sin artefacto): comprobaré el recibo "## Recibo de release" de este .md.`);
  else console.log(`\nAvanza con \`next --file <artefacto>\`. (\`--impose\` solo tras un intento normal.)`);
}

// ── command: open ─────────────────────────────────────────────────────────────
function cmdOpen(flags) {
  const slug = flags.slug;
  const topic = flags.topic;
  if (!slug || slug === true) die('falta --slug <s>.');
  if (!topic || topic === true) die('falta --topic "<t>".');
  if (exists(mdPath(slug))) die(`ya existe ${path.relative(ROOT, mdPath(slug))}.`);
  const hotfix = !!flags.hotfix;
  const fixes = hotfix && flags.fixes && flags.fixes !== true ? flags.fixes : null;
  fs.mkdirSync(SPRINTS_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  // Build the .md from the README's documented skeleton (sections in order).
  // A hotfix sprint carries `hotfix: true` (+ a `fixes:` pointer to its parent)
  // in the frontmatter so the .md alone can recover the variant after a crash.
  const hotfixFm = hotfix ? `hotfix: true\n${fixes ? `fixes: ${fixes}\n` : ''}` : '';
  const md = `---
sprint: ${slug}
topic: ${topic}
status: planning
created: ${today}
${hotfixFm}---

# Sprint: ${topic}
${hotfix ? `\n_(HOTFIX${fixes ? ` de ${fixes}` : ''} — pasada única: Tomás valida una sola vez, sin red de fondo; al cerrar marca done el sprint padre.)_\n` : ''}
## Tema
_(panorámica corta: qué se construye y por qué)_

## Plan de acción
_(Lina Bo Bardi + Iris — replan desde la biblia, pendiente)_

## Diana (tests)
_(la rellena la fase de documentación; declara el filtro de la puerta build con \`filtro: <q>\`.)_

## Casillas (definition of done) — las marca Tomás
- [ ] Plan de acción replanificado y acordado (Lina + Iris).
- [ ] Construido (Miguel) y la diana declarada en verde.
- [ ] Listo para el release (Tie lanza \`npm run release\`).
- [ ] Release verde + Otto OK → sprint cerrado.

## Estado / handoff
- **Paso actual:** sprint recién abierto; arranca el replan.

## Log
- ${today} — Sprint abierto${hotfix ? ' (hotfix)' : ''}.
`;
  atomicWrite(mdPath(slug), md);
  const st = freshState(slug, { hotfix, fixes });
  saveState(st);
  console.log(`Sprint abierto: ${slug}${hotfix ? ' (HOTFIX, pasada única)' : ''}`);
  console.log(`  .md   → ${path.relative(ROOT, mdPath(slug))}`);
  console.log(`  estado → ${path.relative(ROOT, statePath(slug))}`);
  if (hotfix) {
    // The hotfix sprint exists to answer a failed Otto. Consume the signal so a
    // stale .hotfix-needed.json can't re-trigger Iris's greeting after this.
    try { fs.unlinkSync(HOTFIX_FILE); } catch {}
    console.log(`Hotfix${fixes ? ` de '${fixes}'` : ''}: Tomás valida una sola vez (sin red de fondo). Al cerrar marcaré done el sprint padre.`);
  }
  console.log(`Paso actual: replan. Pásale el plan replanificado con \`next --file <plan>\`.`);
}

// ── command: retry ────────────────────────────────────────────────────────────
// Rewind the current step and re-run it clean (Iris's lever on a worker↔Tomás
// deadlock). Resets the step's counters + status to pending. Does NOT un-tick
// checkboxes (the step wasn't approved if we're retrying).
function cmdRetry(flags) {
  const slug = findActiveSlug(flags.slug && flags.slug !== true ? flags.slug : null);
  const st = loadState(slug);
  const step = st.step;
  if (step === 'release' || step === 'cierre') die(`no se puede 'retry' en '${step}' (no es un paso adversario). El release lo lanza Tie; el cierre depende del recibo.`);
  st.steps[step] = { status: 'pending', attempts: 0, blocks: 0, imposed: false };
  st.verdicts.push({ step, verdict: 'retry', at: new Date().toISOString() });
  saveState(st);
  // log it on the whiteboard too
  let md = readFile(mdPath(slug));
  md = appendLog(md, `Iris rebobina el paso '${step}' (retry) para reintentarlo en limpio.`);
  atomicWrite(mdPath(slug), md);
  console.log(`Paso '${step}' rebobinado. Vuelve a pasarle el artefacto con \`next --file <artefacto>\`.`);
}

// ── command: next ─────────────────────────────────────────────────────────────
function cmdNext(flags) {
  const slug = findActiveSlug(flags.slug && flags.slug !== true ? flags.slug : null);
  const st = loadState(slug);
  const step = st.step;

  // READ-ONLY orientation: `next` with no --file MUST NOT mutate — for the
  // adversarial/gated steps (replan, build) you orient before
  // submitting. release + cierre are NO-ARTIFACT steps: there `next` (no file)
  // IS the action (the release transition / the close), per "el cierre se pliega
  // en el último next". (cierre stays effectively read-only until the receipt
  // exists — it prints + exits 1 without closing if it can't.)
  const noArtifactStep = step === 'release' || step === 'cierre';
  if (!flags.file && !noArtifactStep) {
    if (st._degraded) saveState(st);          // persist the rebuilt JSON so the next call is fast (this is recovery, not a step mutation)
    describeCurrent(st);
    return;
  }

  // From here we are SUBMITTING the current step's work.
  const s = st.steps[step];
  if (s.status === 'approved') die(`el paso '${step}' ya está aprobado; nada que enviar.`);

  const impose = !!flags.impose;

  // ── RELEASE step: the program never runs the release ──────────────────────
  if (step === 'release') {
    // assert all prior steps approved
    for (const prev of STEPS.slice(0, STEPS.indexOf('release'))) {
      if (st.steps[prev].status !== 'approved') die(`no puedo preparar el release: el paso '${prev}' aún no está aprobado. (El orden es fijo, nada saltable.)`);
    }
    st.steps.release.status = 'approved';
    st.release.requestedAt = new Date().toISOString();
    // Bind the close to THIS release: stamp the build this sprint's release WILL
    // ship — peeked the same way release-and-test.js does, at the moment we tell
    // Tie to launch. cierre then closes ONLY if THIS sprint's own in-doc receipt
    // (`## Recibo de release`, written by release-and-test.js after Otto green)
    // reports exactly this build. No shared `.release-ok`, so there is nothing
    // stale to wipe — each sprint reads its own .md.
    st.release.expectedBuild = peekNextVersion();
    setMdStatus(slug, 'releasing');
    tickNextCheckbox(st, `Todo aprobado hasta release. Marcado \`releasing\`; pendiente de que Tie lance el release (build esperado ${st.release.expectedBuild}).`);
    st.step = 'cierre';
    saveState(st);
    console.log(`Todo lo anterior está aprobado. He marcado el sprint como 'releasing'.`);
    console.log(`\n>>> Pídele a Tie que lance \`npm run release\` desde su terminal. <<<`);
    console.log(`(Yo NUNCA lo lanzo.) Cuando termine verde (Otto OK), cierra con \`next\` — comprobaré que el recibo de este .md es de ESTE release (build ${st.release.expectedBuild}).`);
    return;
  }

  // ── CIERRE step: close only if THIS sprint's in-doc receipt is present + right ─
  if (step === 'cierre') {
    if (flags.file) die(`el cierre no lleva artefacto; cierra con \`next\` (sin --file).`);
    // Read the receipt from THIS sprint's own .md (`## Recibo de release`),
    // written by release-and-test.js after Otto green. No shared file → no stale
    // cross-sprint receipt can ever close this one.
    const receiptBuild = readReceiptBuild(slug);
    if (receiptBuild === null) {
      console.log(`No puedo cerrar: no encuentro el recibo de un release verde (sección "## Recibo de release" en ${path.relative(ROOT, mdPath(slug))}).`);
      console.log(`El sprint sigue en 'release'. Pídele a Tie que lance \`npm run release\`; el recibo se escribe en este .md al terminar verde (Otto OK).`);
      // Stay in release semantics: keep the pointer at cierre but do NOT close.
      saveState(st);
      process.exit(1);
    }
    st.release.receiptBuild = receiptBuild;
    // Fail-closed: the receipt MUST be from THIS sprint's release. We stamped the
    // expected build at the release transition; a receipt whose build doesn't
    // match the stamp does NOT close the sprint — it stays in release.
    const expected = st.release.expectedBuild;
    if (expected !== undefined && expected !== null) {
      if (String(receiptBuild) !== String(expected)) {
        console.log(`No puedo cerrar: el recibo de este .md no es de ESTE release.`);
        console.log(`  esperaba build ${expected}; el recibo dice ${receiptBuild}.`);
        console.log(`El sprint sigue en 'release'. Pídele a Tie que lance \`npm run release\`; el recibo nuevo traerá el build ${expected}.`);
        saveState(st);
        process.exit(1);
      }
    }
    st.steps.cierre.status = 'approved';
    setMdStatus(slug, 'done');
    tickNextCheckbox(st, `Release verde + Otto OK (recibo build ${receiptBuild}). Sprint cerrado.`);
    saveState(st);
    // Hotfix close: mark the parent sprint done too, with a `fixes`/`fixed_by`
    // pointer so the lineage is visible on both whiteboards.
    if (st.hotfix && st.fixes) closeParentSprint(st.fixes, slug, receiptBuild);
    saveState(st);
    console.log(`Release confirmado verde (build ${receiptBuild}). Sprint '${slug}' CERRADO (status: done).`);
    if (st.hotfix && st.fixes) console.log(`Hotfix cerrado → marqué done el sprint padre '${st.fixes}' (puntero fixes).`);
    return;
  }

  // ── adversarial / gated steps: replan, build ──────────────────────────────
  // require an artifact file
  if (!flags.file || flags.file === true) die(`el paso '${step}' necesita un artefacto: \`next --file <ruta>\`.`);
  const artifact = path.resolve(ROOT, flags.file);
  if (!exists(artifact)) die(`no encuentro el artefacto: ${flags.file}`);

  // impose-guard: --impose is rejected if attempts<1 at this step.
  if (impose) {
    if (s.attempts < 1) die(`no puedes imponer en el primer intento: pásalo primero normal (sin --impose). Si Tomás lo tumba, entonces podrás imponer.`);
  }

  s.attempts++;

  // ── BUILD step: deterministic diana gate BEFORE the challenger ────────────
  if (step === 'build') {
    const filter = dianaFilter(readFile(mdPath(slug)), slug);
    console.log(`Corriendo la diana como puerta: node tests/run.js ${filter}`);
    const gate = runDianaGate(filter);
    if (!gate.green) {
      st.verdicts.push({ step, verdict: 'gate_red', code: gate.code, at: new Date().toISOString() });
      saveState(st);
      console.log(`\nLa diana está EN ROJO (exit ${gate.code}). NO avanzo: de vuelta a Miguel.`);
      console.log(`(El bucle de arreglo automático de 5 intentos vive en el release de Tie, no aquí. Arregla el código y reintenta el build.)`);
      process.exit(1);
    }
    console.log(`Diana en verde. Paso el build a Tomás (honesty check).`);
    // fall through to the challenger
  }

  // ── the challenger is always Tomás (the honesty check) ────────────────────
  const role = 'Tomás';
  const verdict = runValidator({ role, slug, step, file: flags.file });

  // FAIL-CLOSED on an invalid/absent verdict: not approved, NOT a block.
  if (verdict.invalid) {
    st.verdicts.push({ step, verdict: 'invalid', reason: verdict.reason, at: new Date().toISOString() });
    saveState(st);
    console.log(`\nNo obtuve un veredicto válido del validador (${verdict.reason}).`);
    console.log(`Por seguridad lo trato como NO aprobado (y NO cuenta como rebote). Reintenta con \`next --file <artefacto>\` o usa \`retry\`.`);
    process.exit(1);
  }

  // record the verdict in the auditable trail
  st.verdicts.push({ step, verdict: verdict.verdict, blocking: verdict.blocking, menor: verdict.menor, at: new Date().toISOString(), imposed: impose });

  if (verdict.verdict === 'ok') {
    approveAndAdvance(st, step, { note: noteFor(step, { ok: true, menor: verdict.menor }) });
    saveState(st);
    console.log(`\n${role} no logró tumbar el paso '${step}' → APROBADO.`);
    if ((verdict.menor || []).length) {
      console.log(`Menores anotados (no bloquean, van al BACKLOG): ${verdict.menor.join('; ')}`);
    }
    printNextInstruction(st);
    return;
  }

  // ── reject ─────────────────────────────────────────────────────────────────
  // impose path: a deliberate override AFTER a normal attempt.
  if (impose) {
    approveAndAdvance(st, step, { note: `Iris IMPONE el paso '${step}' sobre el rechazo de Tomás (tras intento normal).`, imposed: true });
    saveState(st);
    console.log(`\nTomás lo tumbó, pero Iris IMPONE el paso '${step}' (override manual tras intento normal) → APROBADO.`);
    printNextInstruction(st);
    return;
  }

  // normal reject: blocks++. At the cap → AUTO-APPROVE (backstop). The cap is 3
  // for a normal sprint; a HOTFIX gets a SINGLE pass (cap 1): one reject from
  // Tomás and it auto-approves, because a hotfix is the urgent prod fix and must
  // not loop. (`--impose` above is still available before the cap kicks in.)
  s.blocks++;
  const cap = st.hotfix ? 1 : CAP_BLOCKS;
  if (s.blocks >= cap) {
    approveAndAdvance(st, step, { note: st.hotfix
      ? `Hotfix (pasada única): Tomás tumbó el paso '${step}' → aprobación automática tras una sola pasada.`
      : `Red de fondo: el paso '${step}' rebotó ${CAP_BLOCKS} veces → aprobación automática (backstop).`, auto: true });
    st.verdicts[st.verdicts.length - 1].auto = true;
    saveState(st);
    if (st.hotfix) {
      console.log(`\nHotfix: Tomás tumbó el paso '${step}', pero el hotfix es de pasada única → aprobación automática.`);
    } else {
      console.log(`\nTomás lo tumbó otra vez, pero ya van ${CAP_BLOCKS} rebotes en este paso → RED DE FONDO: aprobación automática.`);
    }
    console.log(`Motivos del último rechazo:`);
    for (const b of verdict.blocking) console.log(`  • ${b}`);
    printNextInstruction(st);
    return;
  }

  saveState(st);
  console.log(`\nTomás TUMBA el paso '${step}'. Motivos bloqueantes:`);
  for (const b of verdict.blocking) console.log(`  • ${b}`);
  if ((verdict.menor || []).length) console.log(`(Menores, no bloquean → BACKLOG: ${verdict.menor.join('; ')})`);
  console.log(`\nDevuelto al trabajador. Arregla y reintenta con \`next --file <artefacto>\`.`);
  console.log(`(Si crees que Tomás se pasa de frenada, tras este intento normal puedes \`--impose\`, o \`retry\` para empezar limpio.)`);
  process.exit(1);
}

function noteFor(step, { ok, menor } = {}) {
  const human = {
    replan: 'Plan de acción (replan desde la biblia) aprobado (Tomás no lo tumbó).',
    build: 'Build aprobado: diana en verde + Tomás (honesty check) no lo tumbó.',
  };
  let n = human[step] || `Paso '${step}' aprobado.`;
  if (menor && menor.length) n += ` Menores al BACKLOG: ${menor.join('; ')}.`;
  return n;
}

function printNextInstruction(st) {
  const step = st.step;
  console.log(`\nSiguiente paso: ${step}.`);
  console.log(`→ ${STEP_WAIT[step] || ''}`);
}

// ── dispatch ──────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const { _, flags } = parseArgs(argv);
  const cmd = _[0];
  switch (cmd) {
    case 'open': return cmdOpen(flags);
    case 'next': return cmdNext(flags);
    case 'retry': return cmdRetry(flags);
    default:
      console.log('uso:');
      console.log('  node scripts/sprint.js open --slug <s> --topic "<t>"');
      console.log('  node scripts/sprint.js open --slug <s> --topic "<t>" --hotfix --fixes <parent>');
      console.log('  node scripts/sprint.js next                     (orientarse, read-only)');
      console.log('  node scripts/sprint.js next --file <art> [--impose]   (avanzar / imponer)');
      console.log('  node scripts/sprint.js retry                    (rebobinar el paso actual)');
      process.exit(cmd ? 2 : 0);
  }
}

main();
