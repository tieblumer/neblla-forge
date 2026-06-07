// tests/_reporter.js
//
// The pure, dependency-free test Reporter — colored pass/fail grouped by suite,
// with counts and an exit-friendly summary. Extracted verbatim from _harness.js
// so the forge's pure suites can be run by a lightweight runner (run-forge.js)
// that never imports the (product) server/Mongo/socket.io machinery.
//
// _harness.js re-exports `Reporter` from here, so existing importers are unaffected.

export function fmt(v) {
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
