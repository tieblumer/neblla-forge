// scripts/sandbox/reparto.js — Manecilla 2: Reparto (pure, deterministic).
//
// Reparto is the deterministic dispatcher. It walks the FREE pool and, for each
// free programmer that is not already running, takes its LOWEST-numbered actionable
// note and puts the programmer to work on it:
//   • no actionable note AND no live assignment → drop the programmer from the pool
//     (a transient with nothing to ever do).
//   • a note to work on → the programmer leaves `libres`, joins `ocupados`, its note
//     moves libre → en-proceso (THROUGH the gatekeeper — see below), and its
//     `claude -p` is launched in its own worktree. The exit (real) / canned
//     completion (mock) is the done-signal; harvest returns it to `libres`.
//
// MANY programmers can be busy at once (N>1): each free programmer with work is
// claimed in the SAME tick, each launched into its OWN worktree (.wt/<prog>).
//
// THE GATEKEEPER: Reparto never writes `estado:` itself. The heart hands it a
// `gatekeeper(id, state)` function (the ONLY thing that calls notes.setNoteState);
// Reparto merely PROPOSES the en-proceso move by calling it. This keeps the
// estado-mutating call out of this module's source (the diana checks for it).

// runReparto(ctx) — ctx exposes ONLY Reparto's allowed surfaces:
//   • readHeartState() / writeHeartState(hs)
//   • lowestNoteFor(prog) -> id|null   — the prog's lowest-numbered `libre` note
//   • hasAssignment(prog) -> bool      — is this prog still the worker for some tema
//   • isInflight(prog) -> bool         — already running this tick / across ticks
//   • gatekeeper(id, state)            — the heart's setNoteState (estado moves)
//   • launchProgrammer(prog, noteId)   — spawn the worker (async, mesa.js pattern)
export async function runReparto(ctx) {
  const {
    readHeartState, writeHeartState, lowestNoteFor,
    hasAssignment, isInflight, gatekeeper, launchProgrammer,
  } = ctx;

  const hs = readHeartState();
  hs.libres = hs.libres || [];
  hs.ocupados = hs.ocupados || [];

  // snapshot the free pool: we mutate hs as we claim programmers.
  const free = [...hs.libres];
  for (const prog of free) {
    if (isInflight(prog)) continue;                      // already working
    const noteId = lowestNoteFor(prog);
    if (!noteId) {
      // No actionable note right now. Keep the programmer alive in `libres` if it
      // still OWNS a tema (more notes may arrive); only drop a true transient that
      // owns nothing. A finished programmer idles here, ready for its next note.
      if (!hasAssignment(prog)) hs.libres = hs.libres.filter(p => p !== prog);
      continue;
    }
    // claim it: free → busy, then launch. Persist the pool move BEFORE the launch.
    hs.libres = hs.libres.filter(p => p !== prog);
    if (!hs.ocupados.includes(prog)) hs.ocupados.push(prog);
    writeHeartState(hs);
    gatekeeper(noteId, 'en-proceso');                    // THE gatekeeper's hand (heart's)
    launchProgrammer(prog, noteId);
  }
  writeHeartState(hs);
}
