// scripts/sandbox/notes.js — the note (the "tarjeta") as a frontmatter `.md`.
//
// A note is the atom of the sandbox: what Tie asked / what was discovered.
// Iris AUTHORS it (createNote), filling `tema` from the conversation context.
// Everything else about a note's lifecycle is plumbing the heart drives.
//
// Hard rules (the diana, tests/24-sandbox-heart.test.js, fixes these shapes):
//   • The frontmatter parses with the SAME grammar as scripts/sprint.js — so the
//     old machine could read it too. (id, tema, estado, numero, responsable,
//     dependencias, william, creada.)
//   • `estado:` has EXACTLY ONE writer: setNoteState. It throws on a state outside
//     VALID_STATES and leaves the note untouched on a refusal. The heart is the
//     ONLY caller (the single gatekeeper); everyone else "proposes" by writing
//     prose into the two append-only logs.
//   • appendBitacora / appendWilliam are append-only and NEVER touch `estado:`.
//   • IMMUTABILITY: a note already in flight is never edited by Iris's authoring
//     path — she makes ANOTHER note. createNote always mints a DISTINCT id.
//   • NEBLLA_SANDBOX_DIR overrides the sandbox root (so tests isolate to a tmpdir).
//     Everything (notas/, .heart.json) lives under it.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// The note states. `estado:` may only ever be one of these (setNoteState throws
// otherwise). libre → en-proceso → finalizada is the happy path; revision /
// atencion are William's flags; cancelada is Iris's abort valve.
export const VALID_STATES = ['libre', 'en-proceso', 'finalizada', 'revision', 'atencion', 'cancelada'];

// ── where the sandbox lives ───────────────────────────────────────────────────
// Default: backbone/sandbox/ inside the repo (notes are versioned). Tests point
// NEBLLA_SANDBOX_DIR at a throwaway tmpdir so nothing escapes.
//
// The root is CAPTURED at import time into a module-mutable `_root`. Why import
// time and not call time: the diana's `loadFresh` sets NEBLLA_SANDBOX_DIR only
// for the duration of the `import()` and restores it immediately after, so by the
// time a function body runs the env is gone. Capturing at import is the contract;
// the test cache-busts the module URL so each per-dir import is a fresh instance
// with its own `_root`.
//
// `setSandboxRoot` lets a DEPENDENT module (heart.js, worktrees.js) — which
// imports this module via a STATIC, non-cache-busted specifier (so it shares ONE
// instance) — re-point the shared root to ITS OWN import-time env. That's how the
// heart suite, which re-imports heart fresh per tmpdir, keeps the shared notes
// store aimed at the current test's dir.
function envRootOrDefault() {
  const override = (process.env.NEBLLA_SANDBOX_DIR || '').trim();
  if (override) return path.resolve(override);
  return path.join(REPO_ROOT, 'backbone', 'sandbox');
}
let _root = envRootOrDefault();
export function setSandboxRoot(dir) { _root = dir ? path.resolve(dir) : envRootOrDefault(); }
export function sandboxRoot() { return _root; }
export function notesDir() { return path.join(sandboxRoot(), 'notas'); }

function notePath(id) { return path.join(notesDir(), String(id) + '.md'); }

// ── atomic write (tmp + rename), with the Windows EPERM retry from sprint.js ───
// On win32 an indexer/antivirus can briefly lock the just-written tmp → EPERM/
// EBUSY on rename. Retry a few times; fall back to an in-place write as a last
// resort so a single flake never corrupts a note.
function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, contents);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && i < 10) {
        const until = Date.now() + 25; while (Date.now() < until) { /* spin briefly */ }
        continue;
      }
      try { fs.writeFileSync(file, contents); try { fs.unlinkSync(tmp); } catch {} return; }
      catch { throw e; }
    }
  }
}

// ── frontmatter (the SAME grammar as scripts/sprint.js) ───────────────────────
// Key: value between the leading `---` fences. Byte-for-byte the parser the old
// machine uses, so a note's frontmatter is readable by both.
export function parseFrontmatter(md) {
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

// Alias the diana also references as parseNoteFrontmatter (same function).
export const parseNoteFrontmatter = parseFrontmatter;

// ── slugify the tema ──────────────────────────────────────────────────────────
// 'Wizard Paso2' → 'wizard-paso2'; idempotent on an already-slug. Aubé reparts
// by EXACT string equality of this slug, so two spellings of the same tema must
// normalise to one (else they spawn two programmers).
export function slugifyTema(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── id minting (monotonic, never collides) ────────────────────────────────────
// id = `n-NNNN` with a 4-digit zero-padded ordinal. The next ordinal is one past
// the highest already on disk, so a fresh sandbox starts at n-0001 and a second
// createNote in the same run mints a DISTINCT id (the immutability rule depends
// on this). Reading from disk also makes it crash-safe: the counter survives a
// restart because it's derived from the notes themselves.
function nextOrdinal() {
  let max = 0;
  let names = [];
  try { names = fs.readdirSync(notesDir()); } catch { /* no notes yet */ }
  for (const f of names) {
    const m = f.match(/^n-(\d+)\.md$/);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max + 1;
}

// ── the note body template ────────────────────────────────────────────────────
// ## Pide                       — Iris's prose (what Tie asked / what to do)
// ## Observaciones de William   — append-only, one line or nothing
// ## Bitácora                   — append-only, the programmer's learnings/tips
//                                 (THIS is what survives the dirty-code deletion)
function noteBody(pide) {
  return [
    '## Pide',
    String(pide || '').trim(),
    '',
    '## Observaciones de William',
    '',
    '## Bitácora',
    '',
  ].join('\n');
}

// ── createNote ────────────────────────────────────────────────────────────────
// Iris's authoring path. tema is normalised to a slug on write (so Aubé's exact
// match works). estado starts 'libre', numero '0' (Aubé numbers it later; the
// number NEVER goes down). Returns {id, file}. Always mints a fresh id, so a
// second authoring while another note is in flight produces a DISTINCT note.
export function createNote({ tema, body } = {}) {
  const id = 'n-' + String(nextOrdinal()).padStart(4, '0');
  const slug = slugifyTema(tema);
  const today = new Date().toISOString().slice(0, 10);
  const md =
`---
id: ${id}
tema: ${slug}
estado: libre
numero: 0
responsable:
dependencias:
william:
creada: ${today}
---

${noteBody(body)}`;
  const file = notePath(id);
  atomicWrite(file, md);
  return { id, file: path.relative(REPO_ROOT, file).split(path.sep).join('/') };
}

// ── readNote ──────────────────────────────────────────────────────────────────
// Round-trips what's on disk: {frontmatter, body, file}. body is everything after
// the closing `---` fence.
export function readNote(id) {
  const file = notePath(id);
  const md = fs.readFileSync(file, 'utf8');
  const frontmatter = parseFrontmatter(md);
  const m = md.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = m ? m[1] : '';
  return { frontmatter, body, file };
}

// ── listNotes ─────────────────────────────────────────────────────────────────
// All note ids on disk (sorted). Used by the heart to rebuild its pools from the
// frontmatter after a crash.
export function listNotes() {
  let names = [];
  try { names = fs.readdirSync(notesDir()); } catch { return []; }
  return names
    .filter(n => /^n-\d+\.md$/.test(n))
    .map(n => n.replace(/\.md$/, ''))
    .sort();
}

// ── setNoteState — THE ONLY writer of `estado:` (the gatekeeper's hand) ────────
// Throws on a state outside VALID_STATES and leaves the note byte-unchanged on a
// refusal (we validate BEFORE touching disk). Replaces ONLY the `estado:` line in
// the frontmatter; every other byte is preserved (the immutability the diana
// asserts). Atomic write.
export function setNoteState(id, state) {
  if (!VALID_STATES.includes(state)) {
    throw new Error(`estado inválido: ${JSON.stringify(state)} (válidos: ${VALID_STATES.join(', ')})`);
  }
  const file = notePath(id);
  const md = fs.readFileSync(file, 'utf8');
  // Replace only the estado: line inside the frontmatter block. The regex is
  // anchored to the frontmatter fences so a stray `estado:` in the body can't be
  // hit by accident.
  const next = md.replace(
    /^(---\n[\s\S]*?\nestado:\s*)([^\n]*)(\n[\s\S]*?\n---)/,
    `$1${state}$3`
  );
  if (next === md && parseFrontmatter(md).estado !== state) {
    // No estado: line found in the frontmatter — the note is malformed.
    throw new Error(`la nota ${id} no tiene una línea \`estado:\` en su frontmatter`);
  }
  atomicWrite(file, next);
}

// ── append-only logs ──────────────────────────────────────────────────────────
// Generic appender: add `line` at the END of the named `## <heading>` section
// (just before the next `## ` or EOF). NEVER touches the frontmatter, so `estado:`
// is untouched by construction.
function appendUnder(id, heading, line) {
  const file = notePath(id);
  const md = fs.readFileSync(file, 'utf8');
  const lines = md.split('\n');
  // find the heading
  let head = -1;
  const re = new RegExp('^##\\s+' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) { head = i; break; }
  const entry = '- ' + String(line);
  if (head < 0) {
    // No such section yet — append it at the end of the file.
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push('## ' + heading, entry);
    atomicWrite(file, lines.join('\n'));
    return;
  }
  // end of the section = next `## ` heading or EOF
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  // insert just before `end`, trimming trailing blanks inside the section
  let insertAt = end;
  while (insertAt - 1 > head && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, entry);
  atomicWrite(file, lines.join('\n'));
}

// The programmer's learnings/tips. Append-only; survives the dirty-code deletion.
export function appendBitacora(id, line) { appendUnder(id, 'Bitácora', line); }

// William's single observation. Append-only; one line or none.
export function appendWilliam(id, line) { appendUnder(id, 'Observaciones de William', line); }
