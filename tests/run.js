// tests/run.js — the manually-launched test job.
//
//   npm test                 # run everything
//   node tests/run.js 02      # run only suites whose filename matches "02"
//   node tests/run.js infra externaldb
//   node tests/run.js backbone   # only the per-feature backbone battery
//
// Talks to the REAL server (spawns `node app.js` on a test port) and the REAL
// MongoDB from `.env`. Everything it creates is namespaced under
// `__nebllatest_*` / the `__nebllatest@neblla.invalid` developer email and is
// removed in teardown — and again at startup, in case a previous run crashed.
// See tests/README.md.
//
// Two layers run in one pass:
//   • the legacy suites  (NN-*.test.js)            — subsystem-oriented
//   • the backbone battery (backbone/*.test.js)    — one COVERS list per domain,
//     cross-referenced against backbone/features/ so the run ends with a
//     complete 106-feature coverage mirror.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Reporter, boot, connectMongo, closeMongo, cleanupTestData } from './_harness.js';
import { FEATURES } from './backbone/_registry.js';
import { LEGACY_COVERAGE } from './backbone/_legacy_map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEGACY = [
  '00-env-remote',
  '01-contract',
  '02-protocol',
  '03-infra',
  '04-externaldb',
  '05-crdt',
  '06-appinvites',
  '07-quota-and-purchases',
  '08-rooms-lifecycle',
  '09-docs-contract',
  '10-auth-security',
  '11-static-assertions',
  '12-web-images',
  '13-draft',
  '14-cf-multi-app-freeze',
  '15-files-cleanliness',
  '16-hot-disk',
  '17-quota-system',
  '18-db-agnostic',
  '19-json-store',
  '20-byodb-multi-backend',
  '21-dev-auth-login',
  '22-sprint-orchestrator',
  '23-svg-doc-roundtrip',
  '24-sandbox-heart',
  '25-tarea-estado',
];

// Backbone battery files live in tests/backbone/ as <domain>.test.js (skip _*).
function backboneFiles() {
  const dir = path.join(__dirname, 'backbone');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter(n => n.endsWith('.test.js') && !n.startsWith('_'))
    .sort()
    .map(n => 'backbone/' + n.replace(/\.test\.js$/, ''));
}

const STRICT = process.env.NEBLLA_BACKBONE_STRICT === '1';

let server = null;
let interrupted = false;

// In REMOTE (from-outside) mode we never connected to Mongo or booted a local
// server, so teardown must not reach for either — calling cleanupTestData()
// there would open a Mongo connection we deliberately avoided.
const REMOTE_MODE = !!(process.env.NEBLLA_TEST_BASE_URL || '').trim();
async function shutdown() {
  if (server) { try { await server.kill(); } catch {} server = null; }
  if (REMOTE_MODE) return;
  try { await cleanupTestData(); } catch {}
  try { await closeMongo(); } catch {}
}

process.on('SIGINT', async () => { interrupted = true; console.log('\n⌃C — cleaning up…'); await shutdown(); process.exit(130); });

// A few waitFor() promises in the suites may be abandoned when an earlier
// assertion in the same step throws. Registering this handler keeps a stray
// timeout rejection from crashing the runner (Node ≥15 default) — it's just
// noise, the step that mattered already recorded its failure.
process.on('unhandledRejection', (reason) => {
  if (process.env.NEBLLA_TEST_VERBOSE) console.warn('\x1b[90m[unhandled rejection]', (reason && reason.message) || reason, '\x1b[0m');
});

// ── backbone coverage mirror ─────────────────────────────────────────────────
// Cross-reference what the battery actually asserted (each module's COVERS +
// the LEGACY_COVERAGE map) against the 106-feature registry, and print the
// full mirror grouped by domain. Server-testable features with no coverage are
// the open gaps: a skip by default, a failure under NEBLLA_BACKBONE_STRICT=1.
function reportCoverage(r, coveredSet) {
  r.suite('BB — backbone coverage (106 features)');

  const byDomain = new Map();
  for (const f of FEATURES) {
    if (!byDomain.has(f.domain)) byDomain.set(f.domain, []);
    byDomain.get(f.domain).push(f);
  }

  let proven = 0, waivedBrowser = 0, waivedNarrative = 0, gaps = 0;
  const gapIds = [];

  for (const [domain, feats] of byDomain) {
    console.log(`  \x1b[90m── ${domain} ──\x1b[0m`);
    for (const f of feats) {
      const covered = coveredSet.has(f.id);
      if (covered) {
        proven++;
        r.pass(`${f.id}  \x1b[90m[${f.verdict}]\x1b[0m`);
      } else if (f.verdict === 'narrative_only' || f.surface === 'narrative') {
        waivedNarrative++;
        r.skip(`${f.id}`, 'narrative_only — sin construir, nada que probar');
      } else if (f.surface === 'browser') {
        waivedBrowser++;
        r.skip(`${f.id}`, 'browser-only — requiere navegador real (capa pendiente)');
      } else {
        gaps++;
        gapIds.push(f.id);
        if (STRICT) r.fail(`${f.id} — GAP: feature construida sin red de tests`, new Error('uncovered server-testable feature (strict mode)'));
        else r.skip(`${f.id}`, 'GAP: construida y probable, aún sin test — pendiente');
      }
    }
  }

  console.log('\n  \x1b[1mEspejo del backbone:\x1b[0m');
  console.log(`    \x1b[32m${proven}\x1b[0m probadas   ` +
              `\x1b[33m${gaps}\x1b[0m huecos abiertos   ` +
              `\x1b[90m${waivedBrowser} navegador · ${waivedNarrative} sin construir (aplazadas)\x1b[0m`);
  if (gaps && !STRICT) {
    console.log(`    \x1b[33m↳ huecos:\x1b[0m \x1b[90m${gapIds.join(', ')}\x1b[0m`);
    console.log(`    \x1b[90m(NEBLLA_BACKBONE_STRICT=1 convierte estos huecos en fallos del gate)\x1b[0m`);
  }
}

async function main() {
  const filters = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('-'));
  // --skip-heavy / --light: pause load-heavy checks (bulk inserts, big loops)
  // so the gate can't topple a capacity-constrained shared DB. Read dynamically
  // by Reporter.step({heavy:true}); set it before any suite runs.
  if (flags.includes('--skip-heavy') || flags.includes('--light')) process.env.NEBLLA_TEST_SKIP_HEAVY = '1';
  const skipHeavy = process.env.NEBLLA_TEST_SKIP_HEAVY === '1';
  if (skipHeavy) console.log('\x1b[90m· heavy checks PAUSED (NEBLLA_TEST_SKIP_HEAVY=1) — light gate only\x1b[0m');

  // Global watchdog. A hung suite or a stuck shared-DB call must NEVER sit silent
  // for hours (it once froze a run for 3h holding the shared dev/prod DB). A healthy
  // full battery is a few minutes; if we blow past the ceiling, exit loud (124) so
  // a hang surfaces as a failure instead of a zombie. unref() so it never keeps the
  // process alive on its own. Override with NEBLLA_TEST_MAX_MIN.
  const MAX_MIN = Number(process.env.NEBLLA_TEST_MAX_MIN) || 10;
  setTimeout(() => {
    console.error(`\x1b[31mWATCHDOG: battery exceeded ${MAX_MIN} min — forcing exit (hung suite or stuck DB call?)\x1b[0m`);
    process.exit(124);
  }, MAX_MIN * 60_000).unref();

  // ── REMOTE / from-outside mode (Otto) ──────────────────────────────────────
  // When NEBLLA_TEST_BASE_URL is set we run a DIFFERENT job: skip boot() and the
  // Mongo connect/cleanup entirely, and run ONLY the suites that declared
  // `remoteSafe = true` (pure read-only HTTP, no app seeding, no DB writes)
  // against that live URL. The data layer is already proven by the local gate;
  // local and prod SHARE the same MongoDB, so re-running DB tests against prod
  // would just rewrite prod data. This is the environment-only re-check after a
  // deploy: domains/CORS/web-serves/SDK-reachable.
  const REMOTE_BASE = (process.env.NEBLLA_TEST_BASE_URL || '').replace(/\/+$/, '');
  const REMOTE = !!REMOTE_BASE;

  const legacyPicked = LEGACY.filter(f => filters.length === 0 || filters.some(q => f.includes(q)));
  const bbAll = backboneFiles();
  const bbPicked = bbAll.filter(f => filters.length === 0 || filters.some(q => f.includes(q) || 'backbone'.includes(q)));
  const files = [...legacyPicked, ...bbPicked];
  // The coverage mirror is a local-only, DB-coupled artifact — never in REMOTE.
  const wholeBattery = !REMOTE && (filters.length === 0 || filters.some(q => 'backbone'.includes(q)));

  if (!files.length && !wholeBattery && !REMOTE) {
    console.error('no test suites match', filters, '\n  legacy:', LEGACY.join(', '), '\n  backbone:', bbAll.join(', '));
    process.exit(2);
  }

  const r = new Reporter();

  if (REMOTE) {
    console.log(`\x1b[90m· REMOTE mode — from-outside against ${REMOTE_BASE} (no boot, no Mongo; remoteSafe suites only)\x1b[0m`);
  } else {
    console.log('\x1b[90m· connecting to MongoDB…\x1b[0m');
    try { await connectMongo(); }
    catch (e) { console.error('\x1b[31mFATAL: cannot connect to MongoDB — is .env present and the cluster reachable?\x1b[0m\n', e.message); process.exit(2); }

    const stale = await cleanupTestData().catch(() => 0);
    if (stale) console.log(`\x1b[90m· removed ${stale} stale __nebllatest_* app(s) from a previous run\x1b[0m`);
  }

  // Load suite modules so we know which need the HTTP server.
  const suites = [];
  for (const f of files) {
    try { suites.push({ name: f, mod: await import('./' + f + '.test.js') }); }
    catch (e) { r.suite(f); r.fail('load suite module', e); }
  }

  // REMOTE mode: keep only the remoteSafe suites; everything else is skipped
  // loudly (so the run output makes clear what was NOT re-checked against prod).
  let runnable = suites;
  if (REMOTE) {
    runnable = suites.filter(s => s.mod.remoteSafe === true);
    if (!runnable.length) { console.error('\x1b[31mno remoteSafe suites matched — nothing to run against prod\x1b[0m'); process.exit(2); }
    for (const s of suites) if (s.mod.remoteSafe !== true) { /* not remote-safe — silently out of scope for the from-outside check */ }
  }

  // Run the no-server suites first (cheap; surfaces syntax breakage before we bother booting).
  const ordered = [...runnable.filter(s => !s.mod.needsServer), ...runnable.filter(s => s.mod.needsServer)];

  for (const s of ordered) {
    if (interrupted) break;
    // A whole suite can opt out under capacity pressure with `export const heavy = true`.
    if (s.mod.heavy && skipHeavy) {
      r.suite(s.name);
      r.skip(s.name + ' — whole suite', 'heavy — paused: capacity'); r.heavyPaused++;
      continue;
    }
    // In REMOTE mode the target is the live URL; we never boot a local server.
    if (!REMOTE && s.mod.needsServer && !server) {
      console.log('\x1b[90m· booting the real server (node app.js)…\x1b[0m');
      try { server = await boot(); console.log(`\x1b[90m· server up at ${server.baseUrl}\x1b[0m`); }
      catch (e) { r.suite('server'); r.fail('boot real server', e); break; }
    }
    const baseUrl = REMOTE ? REMOTE_BASE : (server && server.baseUrl);
    const _t0 = Date.now();
    try { await s.mod.run({ baseUrl, reporter: r }); }
    catch (e) { r.fail(`suite "${s.name}" crashed`, e); }
    finally {
      const _suiteMs = Date.now() - _t0;
      // Sweep this suite's __nebllatest_* footprint from the SHARED dev/prod DB
      // BEFORE the next suite runs — that cross-suite pollution is what made the
      // battery non-deterministic (a left-behind test app/person changed the
      // state another suite assumed empty). Safe to clean after each suite: each
      // run() builds and consumes ALL its own state internally; no suite depends
      // on another's data. Tolerant (never aborts the run) and SKIPPED in REMOTE
      // (no Mongo there — calling it would open the connection we deliberately
      // avoided). cleanupTestData() does NOT close Mongo; that's only shutdown().
      let _cleanMs = 0;
      if (!REMOTE) { const _c0 = Date.now(); try { await cleanupTestData(); } catch {} _cleanMs = Date.now() - _c0; }
      // Surface where wall-clock actually goes — a slow suite or a slow cleanup
      // is now visible in the log instead of an opaque silent wait.
      if (_suiteMs > 2000 || _cleanMs > 1500) {
        console.log(`\x1b[90m·   ${s.name}: suite ${(_suiteMs/1000).toFixed(1)}s, cleanup ${(_cleanMs/1000).toFixed(1)}s\x1b[0m`);
      }
    }
  }

  // Backbone coverage mirror — only when the whole battery ran (no narrow filter
  // that would make "uncovered" misleading). Always shown for a bare `npm test`
  // or an explicit `backbone` filter. Never in REMOTE (DB-coupled, local-only).
  if (wholeBattery && !interrupted) {
    const covered = new Set(LEGACY_COVERAGE);
    // Credit a feature as proven ONLY when a PASSING step references it as
    // `[feature_id]`. A static COVERS list would credit a feature even if its
    // assertions failed or were skipped — that's the dishonest path. Failing /
    // skipped draft steps therefore leave their feature an honest GAP.
    const idRe = /\[([a-z0-9_]+)\]/g;
    for (const res of r.results) {
      if (res.s !== 'pass') continue;
      let m;
      while ((m = idRe.exec(res.label))) covered.add(m[1]);
    }
    reportCoverage(r, covered);
  }

  await shutdown();
  r.summary();
  process.exit(r.failed ? 1 : 0);
}

main().catch(async (e) => { console.error('\x1b[31munhandled:\x1b[0m', e); await shutdown(); process.exit(1); });
