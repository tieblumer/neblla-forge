// scripts/sandbox/aube.js — Manecilla 1: Aubéline (Aubé), the sandbox PM.
//
// Aubé looks at EVERY free, un-numbered note and does two things, deterministically:
//   1. NUMBERS it with a MONOTONIC ordinal — the number only ever climbs. The
//      ordinal lives in .heart.json, NOT derived from the count of notes on disk,
//      so deleting an already-numbered note never lowers the next number handed
//      out. (The diana asserts this directly.)
//   2. REPARTS it to a programmer by EXACT string equality of the `tema` slug Iris
//      wrote — no semantic detector on the hot path. A NEW tema → a NEW programmer
//      created in the FREE pool; a tema already in flight → the EXISTING programmer
//      for that tema is reused (one entry per tema in .heart.json's assignments).
//
// Aubé PROPOSES numero + responsable by rewriting those two frontmatter fields,
// and it mutates the heart's pools/ordinal/assignments. It NEVER touches `estado:`
// — that is the heart's (the single gatekeeper's) hand alone. This module must not
// reference setNoteState (the diana checks the source).

// ── dependency resolution (Tie's exact rules, handoff §3 pasos 5-7) ───────────
// A note declares its blockers in the `dependencias` frontmatter field (Iris
// writes it, like `tema`). A token is one of:
//   • a NOTE ID (matches /^n-\d+$/) — "finished" when that note is `finalizada`.
//   • a PROGRAMMER NAME (anything else) — "finished" when every note that
//     programmer owns is `finalizada` (and it owns at least one).
//
// Each TICK, Aubé shrinks the CSV deterministically (no agent):
//   (a) a finished token that is NOT the last remaining one → ERASED from the CSV.
//   (b) the LAST remaining token, when it's a finished PROGRAMMER NAME → that
//       programmer TAKES the note as its own (responsable = that name, if the note
//       has none yet) and the CSV is consumed (emptied). This is paso-7.
//   (c) the LAST remaining token that is a finished NOTE ID → simply ERASED
//       (emptied); the note keeps whatever responsable Aubé already gave it.
// Reparto then refuses to dispatch any note whose `dependencias` is still non-empty.
const NOTE_ID_RE = /^n-\d+$/;

// Is a single dependency token finished? note-id → its note finalizada;
// programmer-name → all its notes finalizada (and it owns at least one).
function tokenFinished(token, notesByResp, estadoOf) {
  if (NOTE_ID_RE.test(token)) {
    return estadoOf(token) === 'finalizada';
  }
  const owned = notesByResp.get(token) || [];
  if (!owned.length) return false;                 // owns nothing → can't be "done"
  return owned.every((nid) => estadoOf(nid) === 'finalizada');
}

// Shrink one note's dependencias CSV per the rules above. Returns the fields to
// write ({dependencias?, responsable?}) or null if nothing changed.
function resolveDeps(fm, notesByResp, estadoOf) {
  const raw = (fm.dependencias || '').trim();
  if (!raw) return null;
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;

  const remaining = [];
  let takeOwner = null;                            // a programmer-name to inherit (paso-7)
  for (const tok of tokens) {
    if (!tokenFinished(tok, notesByResp, estadoOf)) { remaining.push(tok); continue; }
    // finished token: erase it. If it's the LAST one left (no other tokens remain
    // AND none are still pending after it) and it's a programmer name, that owner
    // takes the note.
    // We decide "last remaining" AFTER the loop, so just drop it here and remember
    // if it was a programmer name in case it turns out to be the sole survivor.
  }
  // Recompute the shrink deterministically: keep only the still-unfinished tokens.
  const kept = tokens.filter((t) => !tokenFinished(t, notesByResp, estadoOf));
  if (kept.length === tokens.length) return null;  // nothing finished this tick

  // paso-7: if shrinking leaves EXACTLY zero kept tokens and the LAST finished
  // token was a programmer name, that programmer takes the note (if it has none).
  if (kept.length === 0) {
    // the last token to finish (in declared order) is the inheriting owner.
    const finishedNames = tokens.filter((t) => tokenFinished(t, notesByResp, estadoOf) && !NOTE_ID_RE.test(t));
    if (finishedNames.length && !((fm.responsable || '').trim())) {
      takeOwner = finishedNames[finishedNames.length - 1];
    }
  }

  const out = { dependencias: kept.join(',') };
  if (takeOwner) out.responsable = takeOwner;
  return out;
}

// runDeps(ctx) — the dependency-clearing pass (handoff §3 pasos 5-7), split OUT of
// runAube so the HEART can run it at the TOP of the tick, BEFORE harvest. Why before
// harvest: harvest is what finalizes a programmer's note; running the dep-clear first
// means a blocker that finalizes in THIS tick's harvest is only observed as finished
// by the NEXT tick's dep-pass — the one-tick lag the design wants (a dependent never
// dispatches in the very beat its blocker finished). It only rewrites numero/
// responsable/dependencias via writeNoteFields — NEVER estado (the gatekeeper's).
//   • readHeartState() / writeHeartState(hs)  — the .heart.json sidecar (unused here
//                                               but kept for ctx symmetry)
//   • listNotes() / readNote(id)              — the notes on disk
//   • writeNoteFields(id, fields)             — rewrite numero/responsable/dependencias
export async function runDeps(ctx) {
  const { listNotes, readNote, writeNoteFields } = ctx;
  // Build an index of estado + notes-by-responsable so token-finished checks are a
  // pure read of the current board, then shrink every note's dependencias CSV.
  const estadoMap = new Map();
  const notesByResp = new Map();
  for (const id of listNotes()) {
    let fm;
    try { fm = readNote(id).frontmatter; } catch { continue; }
    estadoMap.set(id, fm.estado);
    const resp = (fm.responsable || '').trim();
    if (resp) {
      if (!notesByResp.has(resp)) notesByResp.set(resp, []);
      notesByResp.get(resp).push(id);
    }
  }
  const estadoOf = (id) => estadoMap.get(id);
  for (const id of listNotes()) {
    let fm;
    try { fm = readNote(id).frontmatter; } catch { continue; }
    const upd = resolveDeps(fm, notesByResp, estadoOf);
    if (upd) writeNoteFields(id, upd);
  }
}

// runAube(ctx) — ctx is supplied by the heart and exposes ONLY the surfaces Aubé
// is allowed to touch:
//   • readHeartState() / writeHeartState(hs)  — the .heart.json sidecar
//   • listNotes() / readNote(id)              — the notes on disk
//   • writeNoteFields(id, fields)             — rewrite numero/responsable/dependencias (NOT estado)
// Determinism: notes are processed in ascending id order (listNotes is sorted), so
// the same set of free notes always numbers + assigns identically. The dependency
// CSV shrink lives in runDeps (run by the heart before harvest), NOT here.
export async function runAube(ctx) {
  const { readHeartState, writeHeartState, listNotes, readNote, writeNoteFields } = ctx;
  const hs = readHeartState();
  hs.libres = hs.libres || [];
  hs.ocupados = hs.ocupados || [];
  hs.assignments = hs.assignments || {};
  hs.ordinal = hs.ordinal || 0;

  let dirty = false;
  for (const id of listNotes()) {
    let note;
    try { note = readNote(id); } catch { continue; }
    const fm = note.frontmatter;
    if (fm.estado !== 'libre') continue;                 // only number actionable notes
    if (String(fm.numero || '0') !== '0') continue;      // already numbered (monotonic)

    // 1) assign the next MONOTONIC number (lives in .heart.json, never goes down).
    hs.ordinal = (hs.ordinal || 0) + 1;
    const numero = hs.ordinal;

    // 2) repart by EXACT tema slug: reuse the existing programmer, else create a
    //    fresh one in the FREE pool. One assignment entry per tema.
    const tema = fm.tema || 'sin-tema';
    let prog = hs.assignments[tema] || null;
    if (!prog) {
      prog = 'p' + numero;                               // a fresh, deterministic name
      hs.assignments[tema] = prog;
      if (!hs.libres.includes(prog) && !hs.ocupados.includes(prog)) hs.libres.push(prog);
    }

    // write numero + responsable into the note WITHOUT touching estado.
    writeNoteFields(id, { numero: String(numero), responsable: prog });
    dirty = true;
  }
  if (dirty) writeHeartState(hs);
}
