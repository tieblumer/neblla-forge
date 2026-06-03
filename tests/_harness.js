// tests/_harness.js
//
// Shared machinery for the Neblla test suite. Talks to the *real* server
// (spawns `node app.js`) and the *real* MongoDB configured in `.env` — there is
// no mock. Everything it creates is namespaced under `__nebllatest_*` / the
// `__nebllatest@neblla.invalid` developer email and is removed in teardown
// (and again on the next run, in case a previous run crashed mid-flight).
//
// Run the suite with:  npm test    (see tests/run.js)

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { io as ioClient } from 'socket.io-client';

import mongo from '../controllers/mongo.js';
import apps from '../controllers/apps.js';
import files from '../controllers/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const TEST_EMAIL  = '__nebllatest@neblla.invalid';
export const TEST_PREFIX = '__nebllatest';

// ───────────────────────────────────────────────────────────────────────────
// Reporter — colored pass/fail, grouped by suite, exit code at the end.
// ───────────────────────────────────────────────────────────────────────────

function fmt(v) {
  try { const s = JSON.stringify(v); return s && s.length > 140 ? s.slice(0, 140) + '…' : s; }
  catch { return String(v); }
}

export class Reporter {
  constructor() { this.passed = 0; this.failed = 0; this.skipped = 0; this.heavyPaused = 0; this.results = []; this._suite = '?'; }

  suite(name) { this._suite = name; console.log('\n\x1b[1m━━ ' + name + ' ' + '━'.repeat(Math.max(0, 60 - name.length)) + '\x1b[0m'); }

  pass(label)       { this.passed++;  this.results.push({ s: 'pass', suite: this._suite, label }); console.log('  \x1b[32m✓\x1b[0m ' + label); }
  skip(label, why)  { this.skipped++; this.results.push({ s: 'skip', suite: this._suite, label }); console.log('  \x1b[33m∅\x1b[0m ' + label + (why ? ' \x1b[90m(' + why + ')\x1b[0m' : '')); }
  fail(label, err)  {
    this.failed++;
    this.results.push({ s: 'fail', suite: this._suite, label, err });
    console.log('  \x1b[31m✗ ' + label + '\x1b[0m');
    if (err) console.log('      \x1b[90m' + String((err && err.stack) || err).split('\n').join('\n      ') + '\x1b[0m');
  }

  ok(label, cond, detail)        { return cond ? (this.pass(label), true) : (this.fail(label, new Error(detail || 'condition was falsey')), false); }
  eq(label, actual, expected)    {
    const same = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
    return same ? (this.pass(label + '  \x1b[90m= ' + fmt(expected) + '\x1b[0m'), true)
                : (this.fail(label, new Error('expected ' + fmt(expected) + ', got ' + fmt(actual))), false);
  }
  // Run an async assertion body; any throw is a failure on `label`. Return
  // '__skip__' to mark the check skipped (e.g. precondition not met).
  //
  // Pass { heavy: true } for a LOAD-HEAVY check — one that hammers the shared
  // (cheap) MongoDB: bulk inserts, many seedApp()s, thousands of iterations.
  // These run by default, but are PAUSED (skipped with a reason) when
  // NEBLLA_TEST_SKIP_HEAVY=1 / `node tests/run.js --skip-heavy`. The point: once
  // real users push the shared DB near capacity, the gate must not be the thing
  // that topples it — flip the switch and only the light checks run.
  async step(label, fn, opts = {}) {
    if (opts.heavy && process.env.NEBLLA_TEST_SKIP_HEAVY === '1') {
      this.skipped++; this.heavyPaused++;
      this.results.push({ s: 'skip', suite: this._suite, label });
      console.log('  \x1b[33m∅\x1b[0m ' + label + ' \x1b[90m(heavy — paused: capacity)\x1b[0m');
      return;
    }
    try { const r = await fn(); if (r === false) this.fail(label, new Error('returned false')); else if (r === '__skip__') this.skip(label); else this.pass(label); }
    catch (e) { this.fail(label, e); }
  }

  summary() {
    console.log('\n\x1b[1m──────────────────────────────────────────────────────────────\x1b[0m');
    const tot = this.passed + this.failed + this.skipped;
    console.log(`  ${tot} checks   \x1b[32m${this.passed} passed\x1b[0m   ` +
                (this.failed ? `\x1b[31m${this.failed} failed\x1b[0m` : '0 failed') +
                `   \x1b[33m${this.skipped} skipped\x1b[0m` +
                (this.heavyPaused ? `   \x1b[90m(${this.heavyPaused} heavy paused)\x1b[0m` : ''));
    if (this.failed) {
      console.log('\n  \x1b[31mFailures:\x1b[0m');
      for (const r of this.results) if (r.s === 'fail') console.log(`    • [${r.suite}] ${r.label}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// MongoDB lifecycle for the test process + namespaced cleanup
// ───────────────────────────────────────────────────────────────────────────

let _mongoReady = false;
export async function connectMongo() {
  if (_mongoReady) return;
  await mongo.connect();
  _mongoReady = true;
}
export async function closeMongo() { try { await mongo.client.close(); } catch {} _mongoReady = false; }
export { mongo };

// Bound a promise so a stuck remote call can never freeze the caller. The
// underlying work isn't cancelled (libSQL has no abort), but the caller stops
// waiting and moves on — a timed-out Turso wipe is logged, never a hang. Pairs
// with the run.js watchdog: between them, no test op can sit silent for hours.
function withTimeout(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout:' + label)), ms); });
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), timeout]);
}

// Wipe every __nebllatest_* artifact from the SHARED dev/prod database.
//
// CRITICAL: dev and prod share one Mongo db + one Turso. The ONLY thing that
// tells test data apart from real data is the `__nebllatest` prefix. So every
// delete here is anchored POSITIVELY — to that prefix, or to _ids/personIds
// DERIVED from documents that already carry it. No deleteMany({}), no whole
// collection, and every `$in` guarded by `if (arr.length)`.
//
// Order matters: children are deleted FIRST (the apps row is the source of the
// pubIds/oids we filter children by), and `apps` is deleted LAST.
//
// Returns the apps deletedCount (tests/run.js logs it as "stale apps removed").
export async function cleanupTestData() {
  await connectMongo();
  const db = mongo.db();

  // ── 1. Build the id graph from the two prefix-anchored root collections ────
  // apps: a test app is created with both `email` and `name` carrying the
  // prefix (seedApp), but match either to also catch web_interactive's apps
  // (top-level email = __nebllatest_*) and any renamed-by-test app.
  const testApps = await db.collection('apps')
    .find({ $or: [ { email: /^__nebllatest/ }, { name: /^__nebllatest/ } ] })
    .project({ id: 1, _id: 1 }).toArray();
  const pubIds = [];                          // public ids (used by per-app child collections)
  for (const a of testApps) {
    pubIds.push(a.id);
    pubIds.push('_' + a.id);                  // draft id convention (13-draft creates `_<pubId>`)
  }
  const oids = testApps.map(a => a._id);      // ObjectId — users.app stores the _id, NOT the public id

  // people: emails live in TWO shapes — a flat array of strings (Person.findOrCreate,
  // friends/comms/appinvites suites) AND an array of {address} objects (Developer-style
  // docs, auth_user/web_interactive). Match both, plus a `name` prefix and the
  // `__nbtest` slug that 06-appinvites stamps, so no test person escapes.
  const testPeople = await db.collection('people')
    .find({ $or: [
      { emails: /^__nebllatest/ },            // emails: ['__nebllatest...@...']
      { 'emails.address': /^__nebllatest/ },  // emails: [{ address: '__nebllatest...' }]
      { name: /^__nebllatest/ },
      { slug: /^__nbtest/ },                  // 06-appinvites people
    ] })
    .project({ _id: 1 }).toArray();
  const personOids = testPeople.map(p => p._id);

  // ── 2. Delete children first (anchored to pubIds/oids/personOids), apps last ─
  if (pubIds.length) {
    await db.collection('files').deleteMany({ appId: { $in: pubIds } });
    await db.collection('sessions').deleteMany({ appId: { $in: pubIds } });
    await db.collection('products').deleteMany({ appId: { $in: pubIds } });
    await db.collection('purchases').deleteMany({ appId: { $in: pubIds } });
    await db.collection('rooms').deleteMany({ appId: { $in: pubIds } });
    await db.collection('room_messages').deleteMany({ appId: { $in: pubIds } });
    await db.collection('fraud_reports').deleteMany({ appId: { $in: pubIds } });
    await db.collection('app_daily_reports').deleteMany({ appId: { $in: pubIds } });
    await db.collection('translation_jobs').deleteMany({ appId: { $in: pubIds } });
  }

  // app_invites: keyed by appId OR by the from/to personIds it references.
  if (pubIds.length || personOids.length) {
    const or = [];
    if (pubIds.length)     or.push({ appId: { $in: pubIds } });
    if (personOids.length) { or.push({ fromPersonId: { $in: personOids } }); or.push({ toPersonId: { $in: personOids } }); }
    if (or.length) await db.collection('app_invites').deleteMany({ $or: or });
  }

  // users: an SDK user belongs to an app (_id, ObjectId) and may carry a person.
  if (oids.length || personOids.length) {
    const or = [];
    if (oids.length)       or.push({ app: { $in: oids } });
    if (personOids.length) or.push({ person: { $in: personOids } });
    if (or.length) await db.collection('users').deleteMany({ $or: or });
  }

  // person-anchored collections
  if (personOids.length) {
    await db.collection('friendships').deleteMany({
      $or: [ { requester: { $in: personOids } }, { recipient: { $in: personOids } } ],
    });
    await db.collection('reviews').deleteMany({ 'author.person': { $in: personOids } });
    await db.collection('people').deleteMany({ _id: { $in: personOids } });
  }

  // prefix-anchored standalone collections (no derived ids needed)
  await db.collection('developers').deleteMany({ email: /^__nebllatest/ });
  // pending_registrations: 21-dev-auth-login seeds rows whose `email` carries
  // the prefix (__nebllatest_authlogin_*). Safe-net cleanup anchored to it.
  await db.collection('pending_registrations').deleteMany({ email: /^__nebllatest/ });

  // NOT swept here (no safe positive anchor on test data → left to the suites
  // that own them): delete_tokens (its field is `person`, and the suite already
  // cleans it by tracked _ids), cf_projects (no suite creates test rows),
  // byodb_outbox (its test appIds are literal 'BYOTEST*', not derivable from
  // pubIds; the suite self-cleans), and oauth_*/login_tokens/neblla_sso_sessions
  // (the suites track and clean their own minted ids).

  // ── 3. Turso (shared singleton): wipe per-app JSON blobs + the literal-id
  // appIds that suite 19 uses ('__nebllatest_js_*'), which NEVER hit the apps
  // collection so they aren't in pubIds. Tolerant: if Turso isn't configured
  // (throws turso_not_configured), the Mongo cleanup above must still stand.
  try {
    const turso = (await import('../controllers/jsonStore/turso.js')).default;
    for (const pubId of pubIds) { try { await withTimeout(turso.deleteAppData(pubId), 5000, 'deleteAppData'); } catch {} }
    try { await withTimeout(turso.deleteTestPrefixData(TEST_PREFIX), 5000, 'deleteTestPrefixData'); } catch {}
  } catch { /* turso not configured / unreachable — Mongo cleanup already done */ }

  // ── 4. apps LAST (we derived pubIds/oids from these rows above). ───────────
  // NOTE: we do NOT touch misc.appCounter.totalApps. That is the PRODUCTION
  // app-number counter in a shared DB; decrementing it would re-emit public-ids
  // that are already live → catastrophic id collisions in prod. Suites keep the
  // id seedApp returns and reuse it within the same run, so nothing depends on a
  // stable/hardcoded public id across runs — the counter stays untouched.
  const res = await db.collection('apps').deleteMany({ $or: [ { email: /^__nebllatest/ }, { name: /^__nebllatest/ } ] });
  return res.deletedCount || 0;
}

/**
 * Create a throwaway test app.
 * @param {{label?:string, serverMode?:'js'|'wasm'|'infra', rooms?:object, ai?:object,
 *          serverFiles?:Record<string,string>}} opts
 * @returns {Promise<string>} appId
 */
export async function seedApp(opts = {}) {
  await connectMongo();
  const name = `${TEST_PREFIX}_${opts.label || 'app'}_${crypto.randomBytes(3).toString('hex')}`;
  const id = await apps.create({ name, email: TEST_EMAIL });
  const set = { sandbox: true };          // sandbox ⇒ localhost Origin is accepted by CORS
  if (opts.serverMode) set.serverMode = opts.serverMode;
  if (opts.rooms)      set.rooms = opts.rooms;
  if (opts.ai)         set.ai = opts.ai;
  await mongo.db().collection('apps').updateOne({ id }, { $set: set });
  for (const [p, content] of Object.entries(opts.serverFiles || {})) {
    await files.upload(id, p, content);
  }
  return id;
}

// ───────────────────────────────────────────────────────────────────────────
// Boot the real server
// ───────────────────────────────────────────────────────────────────────────

// Grab a free TCP port from the OS: listen on 0 (the kernel hands out an unused
// port), read it back, then close the probe and reuse the number. There's a tiny
// TOCTOU window before app.js claims it, but it's astronomically better than a
// fixed 4599 that collides with Tie's running dev `node app.js` (EADDRINUSE →
// "server not ready within 30s" → every server-backed suite fails).
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

export async function boot({ port } = {}) {
  // Explicit caller arg or NEBLLA_TEST_PORT override wins (someone who *wants* a
  // fixed port can still set it); otherwise pick a free, dynamic port so the test
  // server never collides with a dev server (or a hung process) on the old 4599.
  port = port || Number(process.env.NEBLLA_TEST_PORT) || await freePort();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['app.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', done = false;
    const finish = (fn) => { if (done) return; done = true; fn(); };
    const onData = (buf) => {
      const s = buf.toString();
      out += s;
      if (process.env.NEBLLA_TEST_VERBOSE) process.stdout.write('\x1b[90m[srv]\x1b[0m ' + s);
      if (!done && /Server running on port/.test(out)) {
        finish(() => resolve({
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          child,
          kill: () => new Promise((res) => {
            let settled = false;
            const k = () => { if (settled) return; settled = true; res(); };
            child.once('exit', k);
            try { child.kill('SIGTERM'); } catch {}
            setTimeout(() => { try { child.kill('SIGKILL'); } catch {} k(); }, 3000);
          }),
        }));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => finish(() => reject(new Error('failed to spawn server: ' + e.message))));
    child.on('exit', (code) => finish(() => reject(new Error('server exited before ready (code ' + code + ')\n--- last output ---\n' + out.slice(-3000)))));
    setTimeout(() => finish(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('server not ready within 30s\n--- last output ---\n' + out.slice(-3000))); }), 30000);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// TestClient — performs the exact SDK handshake against the real server, then
// drives the raw socket protocol. It does NOT run server/*.js (that happens in
// the SDK on a peer in `js` mode); it observes/asserts on the wire protocol,
// and can itself act as the designated server peer by emitting serverMessage /
// setState (the server only checks `room.serverPeerId === user.userId`).
// ───────────────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:1';            // hostname `localhost` ⇒ accepted for sandbox apps
const UA     = 'neblla-test/1';

export class TestClient {
  constructor(baseUrl, appId, opts = {}) {
    this.baseUrl = baseUrl;
    this.appId = appId;
    this.name = opts.name || ('c' + crypto.randomBytes(2).toString('hex'));
    this._events = [];          // every socket event, in order; `_consumed` flips when a waitFor takes it
    this._waiters = [];
    this.lobby = null;          // the first joinRoom event payload (the lobby)
  }

  _push(event, arg) {
    const e = { event, arg, t: Date.now(), _consumed: false };
    this._events.push(e);
    for (const w of this._waiters.slice()) w(e);
  }

  /** Resolve with the arg of the next (or already-buffered) `event` matching `pred`. */
  waitFor(event, pred = null, timeout = 6000) {
    const match = (e) => e.event === event && !e._consumed && (!pred || (() => { try { return pred(e.arg); } catch { return false; } })());
    const buffered = this._events.find(match);
    if (buffered) { buffered._consumed = true; return Promise.resolve(buffered.arg); }
    return new Promise((res, rej) => {
      const to = setTimeout(() => {
        this._waiters = this._waiters.filter(w => w !== w0);
        const seen = [...new Set(this._events.map(e => e.event))].join(', ');
        rej(new Error(`[${this.name}] timed out after ${timeout}ms waiting for '${event}'${pred ? ' matching predicate' : ''}. Events seen: ${seen}`));
      }, timeout);
      const w0 = (e) => { if (match(e)) { e._consumed = true; clearTimeout(to); this._waiters = this._waiters.filter(w => w !== w0); res(e.arg); } };
      this._waiters.push(w0);
    });
  }

  /** Assert that NO `event` matching `pred` arrives within `window` ms (counted from now). */
  async expectNone(event, pred = null, window = 700) {
    const since = this._events.length;
    await new Promise(r => setTimeout(r, window));
    const hit = this._events.slice(since).find(e => e.event === event && (!pred || (() => { try { return pred(e.arg); } catch { return false; } })()));
    if (hit) throw new Error(`[${this.name}] expected NO '${event}' but got: ${fmt(hit.arg)}`);
    return true;
  }

  /** socket.emit with an ack callback → resolves with the ack arg.
   *  Pass `undefined` for `payload` on handlers whose only arg is the callback. */
  rpc(event, payload, timeout = 6000) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`[${this.name}] ack timeout for '${event}'`)), timeout);
      const cb = (resp) => { clearTimeout(to); res(resp); };
      if (payload === undefined) this.socket.emit(event, cb);
      else this.socket.emit(event, payload, cb);
    });
  }

  emit(event, payload) { this.socket.emit(event, payload); return this; }

  get id() { return this.userId; }

  async connect() {
    // 1. fetch the served SDK to harvest baked identity + one-shot secret
    const r1 = await fetch(`${this.baseUrl}/connect/app/${this.appId}`, { headers: { Origin: ORIGIN, 'User-Agent': UA } });
    if (!r1.ok) throw new Error(`GET /connect/app/${this.appId} → ${r1.status}`);
    const js = await r1.text();
    const grab = (re, what) => { const m = js.match(re); if (!m) throw new Error(`could not extract ${what} from served SDK`); return m[1]; };
    this.userId    = grab(/_userId\s*=\s*\([^)]*\)\s*\|\|\s*"([0-9a-fA-F-]{8,})"/, 'userId');
    this.longToken = grab(/_longToken\s*=\s*\([^)]*\)\s*\|\|\s*"([0-9a-fA-F]{8,})"/, 'longToken');
    this.tabId     = grab(/_tabId\s*=\s*"([0-9a-fA-F]{4,})"\s*;/, 'tabId');
    this.secret    = grab(/x-session-token\s+([0-9a-f]{16,})'/, 'session secret');

    // 2. exchange the secret for a (12s-lived) authToken
    const r2 = await fetch(`${this.baseUrl}/connect/auth?tabId=${this.tabId}&location=${encodeURIComponent(ORIGIN + '/')}`, {
      headers: { Origin: ORIGIN, 'User-Agent': UA, 'Content-Type': 'application/json', Authorization: 'x-session-token ' + this.secret },
    });
    if (!r2.ok) throw new Error(`GET /connect/auth → ${r2.status} ${(await r2.text()).slice(0, 200)}`);
    let authToken = (await r2.text()).trim();
    if (authToken.startsWith('"') && authToken.endsWith('"')) authToken = authToken.slice(1, -1);
    if (authToken.startsWith('{')) { try { authToken = JSON.parse(authToken).data || authToken; } catch {} }
    this.authToken = authToken;

    // 3. socket connect, then `auth`, then wait for `session` + the lobby `joinRoom`
    this.socket = ioClient(this.baseUrl, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 8000 });
    this.socket.onAny((event, arg) => this._push(event, arg));
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`[${this.name}] socket connect timeout`)), 8000);
      this.socket.once('connect', () => { clearTimeout(to); res(); });
      this.socket.once('connect_error', (e) => { clearTimeout(to); rej(new Error('connect_error: ' + e.message)); });
    });
    const sessionP = this.waitFor('session', null, 8000);
    const lobbyP   = this.waitFor('joinRoom', null, 8000);
    this.socket.emit('auth', { userId: this.userId, authToken: this.authToken, tabId: this.tabId });
    const [, lobby] = await Promise.all([sessionP, lobbyP]);
    this.lobby = lobby;
    return this;
  }

  close() { try { this.socket && this.socket.disconnect(); } catch {} }
}

/** Connect N clients sequentially (so presenter / membership ordering is deterministic). */
export async function connectClients(baseUrl, appId, names) {
  const out = [];
  for (const name of names) out.push(await new TestClient(baseUrl, appId, { name }).connect());
  return out;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
