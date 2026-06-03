# Neblla test suite

A manually-launched job that exercises the `llms.txt` model **against the real
server** — it spawns `node app.js` on a test port and drives it with real
`socket.io-client` sessions doing the exact SDK handshake. It also talks to the
**real MongoDB** from `.env`.

Two layers run in one pass:
- **legacy suites** (`NN-*.test.js`) — subsystem-oriented regression nets.
- **backbone battery** (`backbone/*.test.js`) — one `COVERS` list per domain,
  cross-referenced against `backbone/features/` so the run ends with a complete
  **106-feature coverage mirror**. See `tests/backbone/README.md`.

This suite is the **pre-deploy gate**: `npm run release` runs it against a
locally-booted server *before* bumping the version, committing or pushing — so a
locally-testable bug never reaches production. Only a green gate ships.
`npm run release -- --no-deploy` runs the gate alone.

```bash
npm test                       # run everything
node tests/run.js 02           # only suites whose filename matches "02"
node tests/run.js infra extdb  # several filters
NEBLLA_TEST_VERBOSE=1 npm test # also stream the spawned server's stdout/stderr
```

Exit code is non-zero if any check fails.

## What it covers

| Suite | Boots server? | Checks |
|---|---|---|
| `01-contract` | no | SDK surface (methods/events/properties) vs `llms.txt` §20–22; AppManager/sockets wire-up of the presenter↔server split + `@infra` sentinel; the 4 templates' 6-file structure incl. `server/`; server-side template files don't touch the DOM / `neblla.me`; `node --check` over every `.js` in the repo; **every inline `<script>` block in the served + source HTML pages parses** (a stray bad escape in one block kills the whole `<script>` — `node --check` can't see inside HTML) |
| `02-protocol` | yes | lobby + presenter assignment; membership snapshots; `setPublicInfo`/`publicInfo`; `bookRoom({config})` → `joinRoom` (gathering) → `startRoom` (presenter only) → `roomStarted`; `tellServer`→`messageToServer` (server peer only); `serverMessage`→`messageFromServer` (all); `setState`→`state` (payload = the state, all); spoof rejection for non-server-peers; `sendMessage`→`message` incl. `fromMe`; the `gathering` feed + `getGathering`; `confirm` relay; `flag`→`flagged`; **server-peer handover** on disconnect → `newServerPeer`; presenter promotion on `leaveRoom` → `newPresenter` |
| `03-infra` | yes | `serverMode: 'infra'` end-to-end: `serverPeerId === '@infra'`; a `worker_threads` Worker (`controllers/infraRunner.js`) runs the dev's `server/gathering.js` then `server/room.js`; `tellServer` routes to the Worker; `setState`/`sendMessage` come back out; Worker state persists across messages |
| `04-externaldb` | no (Mongo only) | `controllers/externalDb.js`: connection-string encrypt/decrypt round-trip, `getConfig`/`isConfigured`; **LIVE** `validate()` probe + `saveData`/`loadData`/`deleteData` + the CRDT sidecar (`saveData(.., meta)` / `loadDataWithMeta`, and that a meta-less save `$unset`s it) against a real MongoDB |
| `05-crdt` | no | `controllers/crdt.js` — `neblla.save()` merge strategies: `normalizeStrategy`, `shallowMerge`, `deepMerge`, and the LWW-Map (`lwwMerge`/`applyMerge`): newest-per-leaf wins, order-independent convergence, actor-id tiebreak, `null`=tombstone (+ stale-re-add rejection), object↔primitive resolved by clock, arrays as whole leaves, no base mutation, `crdt` re-baselining when the sidecar was cleared |
| `06-appinvites` | no (Mongo only) | `controllers/AppInvites.js` — cross-app friend invite: `areFriends`, `listFriendsOfPerson` (hydrated), `createInvite` (friendship-gated, dedups per (from,to,app), supersedes the old token), `getInvite`/`listForPerson` (hydrated app + redeem deep-link, addressed only to the recipient), the 5-min expiry cutoff, `deleteInvite`. Creates + tears down its own throwaway `people`/`friendships`/`app_invites` rows |
| `07`–`21` | mixed | quota/purchases, rooms lifecycle, docs↔MCP↔runtime contract, auth+OAuth security, static post-fix assertions, web image content-types, app drafts, CF multi-app freeze manifest, files cleanliness, hot-disk storage, quota system (credits/caps/feature switches), db-agnostic facade, JsonStore (Turso) round-trip, JsonStore multi-backend contract, dev email/password auth |
| `backbone/<domain>` | mixed | the per-feature backbone battery — one file per domain, each asserting the DOD-level observable behaviour of the features it `COVERS`. The run ends with the 106-feature coverage mirror. See `tests/backbone/README.md` |

## Safety / cleanup

- Everything created lives under the developer email `__nebllatest@neblla.invalid`
  and app names prefixed `__nebllatest_*`. The runner deletes all of it on exit
  **and** on startup (so a previously crashed run is cleaned up next time).
- `04-externaldb`'s live part uses, by default, the cluster from `.env` with a
  dedicated throwaway database `__nebllatest_extdb`; its docs are removed in
  teardown and the DB is dropped if the user has the privilege (on Atlas M0 it
  doesn't, so an **empty** `__nebllatest_extdb` shell stays — 0 data, safe to
  leave or delete from the Atlas UI). Override with `NEBLLA_TEST_EXTDB_URI` /
  `NEBLLA_TEST_EXTDB_DB`, or skip it with `NEBLLA_TEST_SKIP_EXTDB_LIVE=1`.
- The spawned server picks a **free dynamic port** from the OS by default, so it
  never collides with a running dev `node app.js`. Set `NEBLLA_TEST_PORT` to pin
  it to a fixed port if you need one.

## Requirements

- A working `.env` (same one `npm start` uses): MongoDB URI etc.
- Node ≥ 20. `socket.io-client` is already a dependency; nothing else to install.

## What it does NOT cover (needs external services / a real browser)

- The client SDK *running in a browser* (`window.onNeblla`, DOM rendering,
  in-browser AssemblyScript→WASM compilation). A Playwright layer could be added
  later as `05-browser.test.js`.
- Stripe checkout (`neblla.buy`), `neblla.ai` routes 2/3 (Anthropic key),
  Cloudflare Pages hot/cold hosting — those are stubbed out of scope.
- The `js`/`wasm` server-mode peer execution of `server/room.js` *inside the SDK*
  (it runs on a designated peer in the browser). The protocol suite instead has
  the chosen server peer act as the server by emitting `serverMessage`/`setState`
  directly, which exercises the server-side relay/auth logic. `infra` mode runs
  the dev's `server/*.js` server-side, so `03-infra` covers that path for real.
