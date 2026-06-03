// tests/22-sprint-orchestrator.test.js
//
// The diana for the `sprint-orchestrator` sprint. Drives scripts/sprint.js (the
// deterministic sprint director) end-to-end with MOCKED validators — no server,
// no Mongo, no real `claude` is ever spawned. Like 01-contract, this is a pure
// static / process-level suite (`needsServer = false`).
//
// The mock contract (implemented in scripts/sprint.js):
//   • NEBLLA_SPRINT_MOCK_VERDICT = a JSON literal (or path) → the Tomás/Ana Liz
//     call returns that verdict instead of spawning `claude`.
//   • NEBLLA_SPRINT_MOCK_GATE    = '0' (green) | non-zero (red) → the build-step
//     diana gate skips the real `node tests/run.js` run.
//
// What it asserts (the checklist of the sprint):
//   • order / no-skip (replan→build→release→cierre — diana + coherencia are gone;
//     the diana is now born in the docs phase and lands in the impl sprint's
//     `## Diana` section, so it is no longer a director step)
//   • 3-block auto-approve backstop
//   • impose-guard (rejected when attempts==0; allowed after a normal attempt)
//   • SAFE checkbox round-trip (only the right `- [ ]`→`- [x]` line flips; prose
//     untouched)
//   • crash-recovery: rebuild a degraded state from the .md when the JSON is gone
//   • verdict fail-closed (missing/invalid → not approved, not a block)
//   • build-gate red → no advance
//   • release transition + receipt-gated close (the receipt lives IN the sprint's
//     own .md — `## Recibo de release` — not a shared .release-ok)
//   • hotfix variant: open --hotfix → single Tomás pass, prioritised as active,
//     closing it marks the parent done
//   • C4 sweep: a done sprint that is git tracked+clean is removable; an untracked
//     or modified one is NOT; README is never touched
//   • the program NEVER invokes `npm run release` / release-and-test.js (static
//     grep over the source, like 01-contract's node --check)

import fs from 'fs';
import path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { ROOT } from './_harness.js';
import { sweepDoneSprints, gitTrackedAndClean } from '../scripts/release-and-test.js';

export const needsServer = false;

const SCRIPT = path.join(ROOT, 'scripts', 'sprint.js');
const SPRINTS_DIR = path.join(ROOT, 'backbone', 'sprints');

// Each test gets its own throwaway slug so a crash can't poison the real sprints.
let slugCounter = 0;
function freshSlug() { return `__test_orch_${process.pid}_${++slugCounter}`; }
function mdOf(slug) { return path.join(SPRINTS_DIR, slug + '.md'); }
function stateOf(slug) { return path.join(SPRINTS_DIR, slug + '.state.json'); }
function cleanupSlug(slug) {
  for (const f of [mdOf(slug), stateOf(slug)]) { try { fs.unlinkSync(f); } catch {} }
}

const OK = JSON.stringify({ verdict: 'ok', blocking: [], menor: [] });
const REJECT = (reasons = ['x']) => JSON.stringify({ verdict: 'reject', blocking: reasons, menor: [] });

// Run the CLI. `verdict` / `gate` go into the mock env. Returns {code,out}.
function cli(args, { verdict, gate } = {}) {
  const env = { ...process.env };
  if (verdict !== undefined) env.NEBLLA_SPRINT_MOCK_VERDICT = verdict;
  else delete env.NEBLLA_SPRINT_MOCK_VERDICT;
  if (gate !== undefined) env.NEBLLA_SPRINT_MOCK_GATE = String(gate);
  else delete env.NEBLLA_SPRINT_MOCK_GATE;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env, encoding: 'utf8' });
  return { code: typeof r.status === 'number' ? r.status : 1, out: (r.stdout || '') + (r.stderr || '') };
}

const readState = (slug) => JSON.parse(fs.readFileSync(stateOf(slug), 'utf8'));
const readMd = (slug) => fs.readFileSync(mdOf(slug), 'utf8');

// Submit an `ok` artifact for the current adversarial step (advances one step).
function submitOk(slug, { gate } = {}) {
  return cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: OK, gate });
}

// Write a release receipt INTO a sprint's own .md (`## Recibo de release`),
// stamped `build <n>` — what release-and-test.js does after Otto goes green.
// `build` may be a number (the real build) or any string (to plant a mismatch).
function writeReceipt(slug, build) {
  let md = fs.readFileSync(mdOf(slug), 'utf8');
  const section = `## Recibo de release\n- build ${build} — ${new Date().toISOString()} — Otto OK.\n`;
  if (/^##\s+Recibo de release\b/m.test(md)) {
    md = md.replace(/^##\s+Recibo de release[\s\S]*?(?=^##\s|\Z)/m, section + '\n');
  } else {
    if (!md.endsWith('\n')) md += '\n';
    md += '\n' + section;
  }
  fs.writeFileSync(mdOf(slug), md);
}
// Remove the receipt section entirely (simulate "no receipt yet").
function clearReceipt(slug) {
  let md = fs.readFileSync(mdOf(slug), 'utf8');
  md = md.replace(/\n*^##\s+Recibo de release[\s\S]*?(?=^##\s|\Z)/m, '\n');
  fs.writeFileSync(mdOf(slug), md);
}
// A receipt with no parseable build line at all.
function writeReceiptNoBuild(slug) {
  let md = fs.readFileSync(mdOf(slug), 'utf8');
  const section = `## Recibo de release\n- release ok (sin build legible aquí)\n`;
  if (/^##\s+Recibo de release\b/m.test(md)) {
    md = md.replace(/^##\s+Recibo de release[\s\S]*?(?=^##\s|\Z)/m, section + '\n');
  } else {
    if (!md.endsWith('\n')) md += '\n';
    md += '\n' + section;
  }
  fs.writeFileSync(mdOf(slug), md);
}

export async function run({ reporter: r }) {
  r.suite('22 — sprint orchestrator (mocked validators)');

  // ── open creates the .md + JSON with the right skeleton ────────────────────
  {
    const slug = freshSlug();
    try {
      const o = cli(['open', '--slug', slug, '--topic', 'una prueba']);
      r.ok('open → exit 0', o.code === 0, o.out);
      r.ok('open creates the .md', fs.existsSync(mdOf(slug)));
      r.ok('open creates the .state.json', fs.existsSync(stateOf(slug)));
      const md = readMd(slug);
      r.ok('.md has frontmatter status: planning', /^status:\s*planning/m.test(md));
      r.ok('.md has a ## Casillas section with 4 checkboxes', (md.match(/^- \[ \]/gm) || []).length === 4);
      const st = readState(slug);
      r.ok('state starts at step replan', st.step === 'replan');
      r.ok('replan is pending, the rest locked', st.steps.replan?.status === 'pending' && st.steps.build?.status === 'locked');
    } finally { cleanupSlug(slug); }
  }

  // ── `next` (no --file) is READ-ONLY: it must NOT mutate ────────────────────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      const before = readState(slug);
      const mdBefore = readMd(slug);
      const o = cli(['next', '--slug', slug]);
      r.ok('bare `next` exits 0 (orientation)', o.code === 0, o.out);
      r.ok('bare `next` prints the current step + what it waits for', /Paso actual: replan/.test(o.out) && /Esperando/.test(o.out));
      const after = readState(slug);
      r.eq('bare `next` did NOT change the step', after.step, before.step);
      r.eq('bare `next` did NOT change replan attempts', after.steps.replan?.attempts, before.steps.replan?.attempts);
      r.ok('bare `next` did NOT tick any checkbox', readMd(slug) === mdBefore);
    } finally { cleanupSlug(slug); }
  }

  // ── order / no-skip: walk the full happy path, one checkbox per step ───────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      let o;
      o = submitOk(slug); r.ok('replan approved → exit 0', o.code === 0, o.out);
      r.eq('after replan, step is build (diana is gone)', readState(slug).step, 'build');
      o = submitOk(slug, { gate: 0 }); r.ok('build (green gate) approved → release (diana + coherencia are gone)', o.code === 0 && readState(slug).step === 'release', o.out);

      // checkbox round-trip: exactly 2 ticked, in order, prose intact
      const md = readMd(slug);
      const ticks = (md.match(/^- \[x\]/gm) || []).length;
      r.eq('exactly 2 checkboxes ticked after 2 approvals', ticks, 2);
      r.ok('the FIRST two are the ones ticked (order preserved)',
        /- \[x\].*\n- \[x\].*\n- \[ \].*\n- \[ \]/.test(
          md.split('## Casillas')[1].trim()));
      r.ok('prose section ## Tema is untouched', md.includes('## Tema'));
      r.ok('## Log got append-only entries (not a rewrite)', (md.match(/^- \d{4}-\d\d-\d\d —/gm) || []).length >= 3);

      // ── release transition: marks releasing, asks Tie, never launches ──────
      o = cli(['next', '--slug', slug]);
      r.ok('release step → exit 0', o.code === 0, o.out);
      r.ok('release prints "pídele a Tie que lance `npm run release`"', /npm run release/.test(o.out) && /Tie/.test(o.out));
      r.ok('release does NOT claim to have launched anything', !/lanzando|launching|ejecutando el release/i.test(o.out));
      r.ok('.md frontmatter is now status: releasing', /^status:\s*releasing/m.test(readMd(slug)));
      r.eq('step pointer moved to cierre', readState(slug).step, 'cierre');
    } finally { cleanupSlug(slug); }
  }

  // ── you cannot skip a step (submit at plan never touches later steps) ──────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      // one approval only advances by exactly one
      submitOk(slug);
      const st = readState(slug);
      r.ok('one approval advances exactly one step', st.step === 'build' && st.steps.release?.status === 'locked' && st.steps.cierre?.status === 'locked');
    } finally { cleanupSlug(slug); }
  }

  // ── 3-block auto-approve backstop ──────────────────────────────────────────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      let o;
      o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: REJECT(['b1']) });
      r.ok('1st reject → exit 1, still at replan', o.code === 1 && readState(slug).step === 'replan');
      o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: REJECT(['b2']) });
      r.ok('2nd reject → exit 1, still at replan', o.code === 1 && readState(slug).step === 'replan');
      o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: REJECT(['b3']) });
      r.ok('3rd reject → AUTO-APPROVE (exit 0), advanced to build', o.code === 0 && readState(slug).step === 'build', o.out);
      r.ok('auto-approval is announced as the backstop', /red de fondo|autom/i.test(o.out));
      const st = readState(slug);
      r.eq('replan recorded 3 blocks', st.steps.replan?.blocks, 3);
      r.ok('the auto verdict is flagged in the trail', st.verdicts.some(v => v.step === 'replan' && v.auto === true));
    } finally { cleanupSlug(slug); }
  }

  // ── impose-guard: --impose rejected when attempts==0; allowed after one ────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      let o = cli(['next', '--slug', slug, '--file', mdOf(slug), '--impose'], { verdict: REJECT() });
      r.ok('--impose on the FIRST attempt is refused (exit 2)', o.code === 2, o.out);
      r.ok('refusal explains a normal attempt is needed first', /primer intento|intento normal/i.test(o.out));
      r.eq('the refused impose did not advance', readState(slug).step, 'replan');
      r.eq('the refused impose did not count as an attempt', readState(slug).steps.replan?.attempts, 0);

      // a normal attempt first…
      o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: REJECT(['nope']) });
      r.ok('normal reject lands (exit 1)', o.code === 1);
      // …now impose is allowed
      o = cli(['next', '--slug', slug, '--file', mdOf(slug), '--impose'], { verdict: REJECT(['still nope']) });
      r.ok('--impose AFTER a normal attempt approves (exit 0)', o.code === 0 && readState(slug).step === 'build', o.out);
      r.ok('the imposed step is flagged imposed in state', readState(slug).steps.replan?.imposed === true);
    } finally { cleanupSlug(slug); }
  }

  // ── retry: rewinds the current step + zeros its counters, then it can pass ──
  // (Diana + coherencia are gone; retry is exercised on an adversarial step — `replan`.)
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      // bounce replan once so it has a block recorded
      let o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: REJECT(['nope']) });
      r.ok('replan reject lands (exit 1)', o.code === 1 && readState(slug).steps.replan?.blocks === 1, o.out);

      o = cli(['retry', '--slug', slug]);
      r.ok('retry rewinds the current step (exit 0)', o.code === 0, o.out);
      r.ok('retry zeroed the step counters', readState(slug).steps.replan?.blocks === 0 && readState(slug).steps.replan?.attempts === 0);
      r.eq('still at replan after retry', readState(slug).step, 'replan');

      o = submitOk(slug);
      r.ok('replan passes after retry → build', o.code === 0 && readState(slug).step === 'build', o.out);
    } finally { cleanupSlug(slug); }
  }

  // ── verdict fail-closed: missing/invalid → not approved, not a block ───────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      const o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: JSON.stringify({ invalid: true, reason: 'simulada' }) });
      r.ok('an invalid verdict → exit 1', o.code === 1, o.out);
      r.ok('it is treated as NOT approved (still at replan)', readState(slug).step === 'replan');
      r.eq('it did NOT count as a block', readState(slug).steps.replan?.blocks, 0);
      r.ok('the invalid verdict is recorded in the trail', readState(slug).verdicts.some(v => v.verdict === 'invalid'));
      r.ok('the message tells Iris to retry', /retry|reintenta/i.test(o.out));
    } finally { cleanupSlug(slug); }
  }

  // ── build-gate red → no advance, "back to Miguel" ──────────────────────────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      submitOk(slug);                 // replan
      r.eq('reached build', readState(slug).step, 'build');
      const o = cli(['next', '--slug', slug, '--file', mdOf(slug)], { verdict: OK, gate: 1 });
      r.ok('red diana gate → exit 1', o.code === 1, o.out);
      r.ok('it says "back to Miguel" and does NOT advance', /Miguel/.test(o.out) && readState(slug).step === 'build');
      r.ok('build was not approved', readState(slug).steps.build?.status !== 'approved');
      r.ok('it does NOT re-implement the 5-attempt fix loop (points at the release)', /release|Tie/i.test(o.out));
    } finally { cleanupSlug(slug); }
  }

  // ── crash-recovery: rebuild a degraded state from the .md ──────────────────
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      submitOk(slug);                 // replan ticked → at build
      fs.unlinkSync(stateOf(slug));   // simulate a lost sidecar (the .md survives)
      const o = cli(['next', '--slug', slug]);
      r.ok('orient after losing the JSON → exit 0 (rebuilt)', o.code === 0, o.out);
      r.ok('it warns the state was rebuilt from the .md', /reconstru/i.test(o.out));
      const st = readState(slug);
      r.eq('resumes at build (the first unticked checkbox)', st.step, 'build');
      r.ok('replan is marked approved in the rebuild', st.steps.replan?.status === 'approved');
      r.ok('it remembers the already-ticked checkboxes (won\'t re-tick)', Array.isArray(st.checkboxes) && st.checkboxes.length === 1);
      // and it can keep going from the rebuilt state
      const o2 = submitOk(slug, { gate: 0 });
      r.ok('the rebuilt sprint can advance (build → release)', o2.code === 0 && readState(slug).step === 'release', o2.out);
    } finally { cleanupSlug(slug); }
  }

  // ── crash-recovery: a `verifying` .md now resumes at build (coherencia gone) ─
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      submitOk(slug);                 // replan ticked → at build
      // simulate the old `verifying` status lingering in a .md + lost sidecar.
      let md = readMd(slug).replace(/^status:\s*\w+/m, 'status: verifying');
      fs.writeFileSync(mdOf(slug), md);
      fs.unlinkSync(stateOf(slug));
      const o = cli(['next', '--slug', slug]);
      r.ok('a verifying .md rebuilds → exit 0', o.code === 0, o.out);
      r.eq('verifying now resumes at build (not the removed coherencia)', readState(slug).step, 'build');
    } finally { cleanupSlug(slug); }
  }

  // ── receipt-gated close (cierre) — the receipt now lives IN the sprint's .md ─
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      submitOk(slug); submitOk(slug, { gate: 0 });   // replan, build → release
      cli(['next', '--slug', slug]);   // release transition → cierre

      // the transition stamps the build THIS release will ship.
      const expected = readState(slug).release.expectedBuild;
      r.ok('release transition stamped an expected build', Number.isInteger(expected) && expected > 0, String(expected));

      // no in-doc receipt → cannot close
      clearReceipt(slug);
      let o = cli(['next', '--slug', slug]);
      r.ok('cierre without the in-doc receipt → exit 1 (refuses)', o.code === 1, o.out);
      r.ok('it stays unclosed (frontmatter not done)', /^status:\s*releasing/m.test(readMd(slug)));

      // a matching-build receipt written INTO this sprint's own .md → closes
      writeReceipt(slug, expected);
      o = cli(['next', '--slug', slug]);
      r.ok('cierre WITH a matching-build in-doc receipt → exit 0 (closes)', o.code === 0, o.out);
      r.ok('frontmatter is now status: done', /^status:\s*done/m.test(readMd(slug)));
      r.ok('all 4 checkboxes are ticked', (readMd(slug).match(/^- \[x\]/gm) || []).length === 4);
      r.ok('the receipt build is recorded', String(readState(slug).release.receiptBuild) === String(expected));
    } finally { cleanupSlug(slug); }
  }

  // ── REGRESSION (Tomás's attack): a wrong-build receipt CANNOT close ─────────
  // The original bug: a shared, gitignored `.release-ok` persisted between sprints,
  // so a receipt from a PREVIOUS cycle could close a brand-new sprint green without
  // that sprint's release ever running. The receipt now lives IN each sprint's own
  // .md (## Recibo de release) AND is bound to the build stamped at the release
  // transition — so a different sprint's receipt is simply not in THIS .md, and a
  // wrong-build receipt is rejected. This proves the door is shut.
  {
    const slug = freshSlug();
    try {
      cli(['open', '--slug', slug, '--topic', 't']);
      submitOk(slug); submitOk(slug, { gate: 0 });   // replan, build → release
      cli(['next', '--slug', slug]);   // release transition → cierre (stamps expected build)
      const expected = readState(slug).release.expectedBuild;

      // ATTACK 1: a wrong-build receipt in THIS .md (a stale stamp from another cycle).
      writeReceipt(slug, 99999);
      let o = cli(['next', '--slug', slug]);
      r.ok('wrong-build receipt does NOT close the sprint (exit 1)', o.code === 1, o.out);
      r.ok('it stays in release (frontmatter still releasing)', /^status:\s*releasing/m.test(readMd(slug)));
      r.ok('it explains the receipt is from another release', /no es de ESTE release|esperaba build/i.test(o.out));
      r.ok('the cierre step was NOT approved', readState(slug).steps.cierre?.status !== 'approved');

      // ATTACK 2: a receipt section with no parseable build at all → also rejected.
      writeReceiptNoBuild(slug);
      o = cli(['next', '--slug', slug]);
      r.ok('no-build receipt does NOT close (exit 1)', o.code === 1, o.out);
      r.ok('still in release after the no-build receipt', /^status:\s*releasing/m.test(readMd(slug)));

      // CONTROL: only a receipt matching the stamped expected build closes it.
      writeReceipt(slug, expected);
      o = cli(['next', '--slug', slug]);
      r.ok('matching-build receipt DOES close the sprint (exit 0)', o.code === 0, o.out);
      r.ok('now status: done', /^status:\s*done/m.test(readMd(slug)));
    } finally { cleanupSlug(slug); }
  }

  // ── active-sprint disambiguation ───────────────────────────────────────────
  {
    const a = freshSlug(), b = freshSlug();
    try {
      cli(['open', '--slug', a, '--topic', 't']);
      cli(['open', '--slug', b, '--topic', 't']);
      const o = cli(['next']);   // two open sprints, no --slug
      r.ok('two open sprints + no --slug → refuses (exit 2)', o.code === 2, o.out);
      r.ok('it lists the open sprints', o.out.includes(a) && o.out.includes(b));
    } finally { cleanupSlug(a); cleanupSlug(b); }
  }

  // ── C3: HOTFIX variant — single Tomás pass, prioritised active, closes parent ─
  {
    const parent = freshSlug();
    const hot = freshSlug();
    try {
      // a parent sprint that got parked in `releasing` (Otto failed against it)
      cli(['open', '--slug', parent, '--topic', 'parent']);
      submitOk(parent); submitOk(parent, { gate: 0 });   // replan, build → release
      cli(['next', '--slug', parent]);   // parent now status: releasing
      r.ok('parent is in releasing', /^status:\s*releasing/m.test(readMd(parent)));

      // open the hotfix pointing at the parent
      let o = cli(['open', '--slug', hot, '--topic', 'el arreglo', '--hotfix', '--fixes', parent]);
      r.ok('open --hotfix → exit 0', o.code === 0, o.out);
      r.ok('.md carries hotfix: true in the frontmatter', /^hotfix:\s*true/m.test(readMd(hot)));
      r.ok('.md carries the fixes pointer', new RegExp(`^fixes:\\s*${parent}`, 'm').test(readMd(hot)));
      r.ok('state flags hotfix + fixes', readState(hot).hotfix === true && readState(hot).fixes === parent);
      r.ok('hotfix .md has 4 checkboxes (STEPS not duplicated)', (readMd(hot).match(/^- \[ \]/gm) || []).length === 4);

      // findActiveSlug prioritises the hotfix even though the parent is open too
      o = cli(['next']);   // no --slug: two open sprints, but one is a hotfix
      r.ok('bare next picks the hotfix (prioritised active) → exit 0', o.code === 0, o.out);
      r.ok('the chosen active sprint is the hotfix, not the parent',
        o.out.includes(`Sprint activo: ${hot}`) && !o.out.includes(`Sprint activo: ${parent}`), o.out);

      // single Tomás pass: ONE reject auto-approves (cap 1), no 3-block loop
      o = cli(['next', '--slug', hot, '--file', mdOf(hot)], { verdict: REJECT(['tomas says no']) });
      r.ok('hotfix: first Tomás reject AUTO-APPROVES (single pass) → build', o.code === 0 && readState(hot).step === 'build', o.out);
      r.ok('the auto verdict is flagged in the trail', readState(hot).verdicts.some(v => v.step === 'replan' && v.auto === true));

      // walk to release and close with a matching in-doc receipt
      submitOk(hot, { gate: 0 });    // build → release
      r.eq('hotfix reached release', readState(hot).step, 'release');
      cli(['next', '--slug', hot]);  // release transition → cierre
      const expected = readState(hot).release.expectedBuild;
      writeReceipt(hot, expected);
      o = cli(['next', '--slug', hot]);
      r.ok('hotfix closes (exit 0)', o.code === 0, o.out);
      r.ok('hotfix is now status: done', /^status:\s*done/m.test(readMd(hot)));
      // closing the hotfix marks the PARENT done too, with a fixes pointer
      r.ok('closing the hotfix marked the parent done', /^status:\s*done/m.test(readMd(parent)));
      r.ok('the parent log points back at the hotfix', new RegExp(`hotfix '${hot}'`).test(readMd(parent)));
    } finally { cleanupSlug(parent); cleanupSlug(hot); }
  }

  // ── C3: a hotfix-needed.json signal is consumed when the hotfix opens ───────
  {
    const hot = freshSlug();
    const signal = path.join(SPRINTS_DIR, '.hotfix-needed.json');
    try {
      fs.writeFileSync(signal, JSON.stringify({ sprint: 'someparent', build: 7, reason: 'otto failed' }) + '\n');
      const o = cli(['open', '--slug', hot, '--topic', 't', '--hotfix']);
      r.ok('open --hotfix → exit 0', o.code === 0, o.out);
      r.ok('opening the hotfix consumed the .hotfix-needed.json signal', !fs.existsSync(signal));
    } finally { cleanupSlug(hot); try { fs.unlinkSync(signal); } catch {} }
  }

  // ── C4: sweepDoneSprints safeguard — tracked+clean is removable; else skipped ─
  // README is NEVER touched; a done-but-untracked or done-but-modified .md is kept.
  // "tracked+clean" means: `git ls-files` lists it AND `git status --porcelain`
  // shows nothing for it (worktree == HEAD). To get that honestly we COMMIT the
  // tracked fixtures to a throwaway commit, run the sweep, then `git reset` the
  // commit away in cleanup so the repo history is left exactly as we found it.
  //
  // ⚠ ISOLATION (CRITICAL): sweepDoneSprints() is hardcoded to scan the REAL
  // backbone/sprints/ directory — it takes no dir argument — so it would ALSO
  // delete the real `done` sprints (montar-la-maquina.md, sprint-orchestrator.md),
  // which ARE tracked+clean+done. The throwaway `git reset --soft` cleanup does
  // NOT restore a deleted WORKING-TREE file, so those real sprints would be lost
  // on disk for good. To sweep ONLY our own throwaway fixture without ever losing
  // a real sprint, we SNAPSHOT the content of every pre-existing real `done`
  // sprint before the sweep and RESTORE byte-for-byte any the sweep removed, in
  // the finally (even on a crash). The sweep still genuinely runs against the
  // fixtures (real behavior verified); the real sprints are guaranteed intact.
  {
    const git = (a, opts = {}) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
    const tracked = freshSlug();     // done + committed (tracked+clean) → SWEEP removes it
    const untracked = freshSlug();   // done + untracked                 → kept
    const notDone = freshSlug();     // committed but planning            → kept
    const modified = freshSlug();    // committed done + then edited      → kept (dirty)
    const rel = (slug) => path.relative(ROOT, mdOf(slug)).replace(/\\/g, '/');
    const doneMd = (slug, status = 'done') =>
      `---\nsprint: ${slug}\ntopic: t\nstatus: ${status}\ncreated: 2026-01-01\n---\n\n# Sprint: t\n\n## Casillas\n- [x] done.\n\n## Log\n- 2026-01-01 — x.\n`;

    // SNAPSHOT every pre-existing REAL done sprint (anything not one of our own
    // __test_ fixtures) so we can restore byte-for-byte whatever the sweep eats.
    const isFixture = (f) => /^__test_orch_/.test(f);
    const realDoneSnapshot = new Map();   // absolute .md path → original bytes
    try {
      for (const f of fs.readdirSync(SPRINTS_DIR)) {
        if (!f.endsWith('.md') || f === 'README.md' || isFixture(f)) continue;
        const p = path.join(SPRINTS_DIR, f);
        let md; try { md = fs.readFileSync(p, 'utf8'); } catch { continue; }
        if (/^status:\s*done\b/m.test(md)) realDoneSnapshot.set(p, md);
      }
    } catch {}
    const restoreRealSprints = () => {
      for (const [p, bytes] of realDoneSnapshot) {
        try { if (!fs.existsSync(p)) fs.writeFileSync(p, bytes); } catch {}
      }
    };

    let committed = false;
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    try {
      // fixtures that need to be tracked+clean → write, stage, COMMIT them
      fs.writeFileSync(mdOf(tracked), doneMd(tracked));
      fs.writeFileSync(mdOf(notDone), doneMd(notDone, 'planning'));
      fs.writeFileSync(mdOf(modified), doneMd(modified));
      git(['add', '--', rel(tracked), rel(notDone), rel(modified)], { quiet: true });
      git(['commit', '-m', 'test(22): C4 sweep fixtures (reset in cleanup)', '--no-verify'], { quiet: true });
      committed = true;

      // now make `modified` dirty in the worktree (committed but edited → must skip)
      fs.appendFileSync(mdOf(modified), '\n- 2026-01-02 — edited after commit.\n');

      // untracked done sprint: on disk, never committed
      fs.writeFileSync(mdOf(untracked), doneMd(untracked));

      r.ok('precondition: committed done sprint reads as tracked+clean', gitTrackedAndClean(rel(tracked)), 'expected tracked+clean');
      r.ok('precondition: untracked done sprint reads as NOT tracked+clean', !gitTrackedAndClean(rel(untracked)));
      r.ok('precondition: committed-then-modified reads as NOT tracked+clean', !gitTrackedAndClean(rel(modified)));

      const readmeBefore = fs.readFileSync(path.join(SPRINTS_DIR, 'README.md'), 'utf8');

      // run the actual sweep (scans the whole real dir; our snapshot will heal any
      // real done sprint it removes, in the finally below)
      sweepDoneSprints();
      // heal the real sprints IMMEDIATELY so the rest of the suite + later runs
      // never see them missing (the finally is the crash-safe backstop).
      restoreRealSprints();

      r.ok('sweep REMOVED the tracked+clean done fixture', !fs.existsSync(mdOf(tracked)));
      r.ok('sweep KEPT the untracked done fixture (no loss)', fs.existsSync(mdOf(untracked)));
      r.ok('sweep KEPT the modified done fixture (no loss)', fs.existsSync(mdOf(modified)));
      r.ok('sweep KEPT the non-done tracked fixture (status gate)', fs.existsSync(mdOf(notDone)));
      r.ok('sweep NEVER touched README.md', fs.readFileSync(path.join(SPRINTS_DIR, 'README.md'), 'utf8') === readmeBefore && fs.existsSync(path.join(SPRINTS_DIR, 'README.md')));
      // ISOLATION ASSERT: every REAL done sprint the sweep saw is still on disk
      // (restored if removed). The sweep must never cost us a real sprint.
      r.ok('the REAL done sprints survive the sweep (isolation)',
        [...realDoneSnapshot.keys()].every(p => fs.existsSync(p)),
        'a real done sprint was left missing after the sweep');
    } finally {
      // crash-safe backstop: heal the real sprints even if an assert above threw.
      restoreRealSprints();
      // Undo ONLY our throwaway commit, preserving every OTHER working change in
      // the tree (the in-flight edits to sprint.js/release-and-test.js/etc).
      // `reset --soft` un-commits without touching the worktree or unstaging
      // unrelated files; then we drop our fixtures from the index + disk.
      try {
        if (committed) git(['reset', '--soft', headBefore], { quiet: true });
        for (const slug of [tracked, notDone, modified]) {
          try { git(['rm', '--cached', '--force', '--ignore-unmatch', '--', rel(slug)], { quiet: true }); } catch {}
        }
        // sweepDoneSprints() may have `git add`ed real done sprints as DELETED
        // (we restored them on disk, but the index could still hold the deletion).
        // Un-stage those index entries so the real sprints read tracked+CLEAN again
        // and `git status` is left exactly as we found it. `reset` (mixed, paths)
        // never touches the worktree → our restored bytes stay.
        for (const p of realDoneSnapshot.keys()) {
          const r2 = path.relative(ROOT, p).replace(/\\/g, '/');
          try { git(['reset', '-q', '--', r2], { quiet: true }); } catch {}
        }
      } catch {}
      cleanupSlug(tracked); cleanupSlug(untracked); cleanupSlug(notDone); cleanupSlug(modified);
    }
  }

  // ── STATIC: the program NEVER invokes the release ──────────────────────────
  // Like 01-contract's node --check: a source-level guarantee. scripts/sprint.js
  // must not run `npm run release` nor spawn release-and-test.js. (It may MENTION
  // them in prose/print strings telling Tie to launch it — so we forbid only the
  // execution shapes.)
  {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    // strip line + block comments so a doc-comment mention can't trip the grep
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    r.ok('sprint.js never spawns `npm run release`',
      !/spawn\w*\([^)]*['"]npm['"][\s\S]*?run[\s\S]*?release/i.test(code) && !/exec\w*\([^)]*npm run release/i.test(code),
      'sprint.js appears to execute `npm run release`');
    r.ok('sprint.js never spawns release-and-test.js',
      !/spawn\w*\([^)]*release-and-test/i.test(code) && !/exec\w*\([^)]*release-and-test/i.test(code),
      'sprint.js appears to execute scripts/release-and-test.js');
    // it MUST, however, tell Tie to launch it (the print string is allowed)
    r.ok('sprint.js DOES print an ask-Tie-to-launch message', /npm run release/.test(src));
  }

  // ── STATIC: validators are summoned with --allowedTools Read,Bash only ─────
  {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    r.ok('validators are spawned with --allowedTools Read,Bash (no edit rights)', /allowed\s*=\s*['"]Read,Bash['"]/.test(src),
      'the headless validator must not be allowed to Edit/Write');
    r.ok('the verdict is captured via the sentinel FILE (.verdict.json), not prose', /\.verdict\.json/.test(src) && /readVerdictFile/.test(src));
  }

  // tidy the transient verdict sentinel the mocked runs left behind (the program
  // deletes it before each call but writes it during; it's gitignored, but we
  // keep the working tree clean).
  try { fs.unlinkSync(path.join(SPRINTS_DIR, '.verdict.json')); } catch {}
}
