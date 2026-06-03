// scripts/sandbox/william.js — Manecilla 3: William, the senior reviewer.
//
// William is a senior who RESPECTS others' work and is ELEGANT — he never makes
// noise. Once per tick he wakes, chooses ONE note, and either makes ONE single
// observation… or says NOTHING at all if he has nothing intelligent to add. He
// NEVER appends more than one observation per tick (the elegance invariant).
//
// What his observation/touch does to a note (the heart applies the estado move,
// William only proposes):
//   • the note is `finalizada`  → estado moves to `revision`.
//   • the note is `en-proceso`  → estado moves to `atencion` (so the programmer
//     knows to read William's note before declaring it finalizada).
//   • any other state           → no estado move (he can still leave a note for
//     whoever picks it up later — the prose stays put).
//
// REAL mode: William is a SYNCHRONOUS `claude -p` inside the tick (fast); he reads
// the board and answers with {note, say}. MOCK mode (tests): NEBLLA_SANDBOX_MOCK_
// WILLIAM is a JSON literal {note?, say?} the heart hands in; `note` pins his
// choice, `say` is the single line (absent/'' → silence). Either way William only
// PROPOSES — he appends prose and the heart's gatekeeper moves the estado. This
// module never references setNoteState (the diana checks the source).

// runWilliam(ctx) — ctx exposes ONLY William's allowed surfaces:
//   • listNotes() / readNote(id)        — the board
//   • appendWilliam(id, line)           — his ONE append-only observation (or none)
//   • gatekeeper(id, state)             — the heart's setNoteState (estado moves)
//   • williamChoice() -> {note?, say?}  — the (mock-resolved) decision for this tick
//                                         (real mode resolves this via `claude -p`)
export async function runWilliam(ctx) {
  const { listNotes, readNote, appendWilliam, gatekeeper, williamChoice } = ctx;

  // No board, nothing to do.
  const ids = listNotes();
  if (!ids.length) return;

  // The decision for this tick: which note + what (if anything) to say.
  let choice = {};
  try { choice = (await williamChoice()) || {}; } catch { choice = {}; }

  // Which note does William attend to this tick? The mock pins `note`; otherwise
  // he picks DETERMINISTICALLY (the lowest id) so the suite stays hermetic and the
  // daemon never depends on a wall-clock random.
  let noteId = choice.note;
  if (!noteId || !ids.includes(noteId)) noteId = ids[0];

  // Read the note's current estado BEFORE we touch it (to decide the move).
  let estado = null;
  try { estado = readNote(noteId).frontmatter.estado; } catch { return; }

  // ONE observation, or silence. `say` empty/absent → William stays silent: the
  // note's prose is left byte-for-byte unchanged AND its estado is left exactly as
  // it was. He only flags a note when he has something to say — an elegant senior
  // makes no noise and disturbs nothing when he has nothing to add.
  const say = typeof choice.say === 'string' ? choice.say.trim() : '';
  if (!say) return;

  // 1) the single observation (append-only; never more than one per tick).
  try { appendWilliam(noteId, say); } catch { /* never throw into the tick */ }

  // 2) propose the estado move that goes WITH the observation (the heart's
  //    gatekeeper applies it). finalizada → revision; en-proceso → atencion (so the
  //    programmer knows to read William before declaring it finalizada). Any other
  //    state is left as it is.
  let next = null;
  if (estado === 'finalizada') next = 'revision';
  else if (estado === 'en-proceso') next = 'atencion';
  if (next) {
    try { gatekeeper(noteId, next); } catch { /* never throw into the tick */ }
  }
}
