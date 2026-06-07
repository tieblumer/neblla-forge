// forge-shutdown.js — el registro ÚNICO de headless (claudes) vivos + el estado
// del apagado ordenado de la forja.
//
// Por qué vive aparte: hoy los claudes nacen de tres `spawn('claude')` distintos
// en forge.js. Para que el contador y el "ya no queda nadie" sean DE VERDAD (no
// estimados), los tres pasan por el embudo `spawnClaude`, que llama a `trackStart`
// al nacer (+1) y a `trackEnd` en su exit (−1). Este módulo es esa caja: cuenta,
// rechaza trabajo nuevo en drenaje, y avisa cuando el último agente se va.
//
// Estados (statusFull().phase):
//   running  → marcha normal (apagandose=false)
//   draining → se pidió schedule-restart; se rechaza trabajo nuevo, se espera a 0
//   down     → ya no queda ningún agente: reiniciada=true, listo para reinicio manual

let ACTIVE_AGENTS = new Map();   // id -> { who, chatId, since }
let _seq = 0;
let apagandose = false;          // ¿estamos drenando? (rechaza trabajo nuevo)
let reiniciada = false;          // ¿se vació el set durante el drenaje? (down)
let onDrained = null;            // callback que dispara el cierre real (forge.js)
let drainedFired = false;        // garantiza que onDrained se llame UNA sola vez

// Reinicia TODO el estado. Solo para los tests (no se usa en producción).
export function _reset() {
  ACTIVE_AGENTS = new Map();
  _seq = 0;
  apagandose = false;
  reiniciada = false;
  onDrained = null;
  drainedFired = false;
}

// nº de claudes vivos ahora mismo.
export function activeCount() { return ACTIVE_AGENTS.size; }

// Registra un headless que ARRANCA (+1). Devuelve su id (para trackEnd). Si la
// forja está drenando, RECHAZA: lanza Error('shutting down') y NO cuenta nada,
// de modo que el embudo no llega a spawnear ningún proceso.
export function trackStart(meta = {}) {
  if (apagandose) throw new Error('shutting down');
  const id = ++_seq;
  ACTIVE_AGENTS.set(id, {
    who: meta.who || '?',
    chatId: meta.chatId != null ? String(meta.chatId) : null,
    since: meta.since || Date.now(),
  });
  return id;
}

// Registra que un headless SALIÓ (−1). Idempotente: un exit repetido (exit+error
// del mismo hijo) no resta de más. Si al vaciarse el set estábamos drenando,
// marca la forja como reiniciada y dispara el cierre.
export function trackEnd(id) {
  if (!ACTIVE_AGENTS.has(id)) return;
  ACTIVE_AGENTS.delete(id);
  if (apagandose && ACTIVE_AGENTS.size === 0) _markDown();
}

function _markDown() {
  if (reiniciada) return;
  reiniciada = true;
  if (!drainedFired && typeof onDrained === 'function') {
    drainedFired = true;
    try { onDrained(); } catch {}
  }
}

// Entra en modo drenaje (lo dispara POST /api/forge/schedule-restart). Idempotente:
// si ya estaba drenando devuelve el mismo recuento sin alterar el estado. Si no
// quedaba ningún agente, cae directo a down. Devuelve el nº de agentes vivos.
export function scheduleRestart() {
  apagandose = true;
  if (ACTIVE_AGENTS.size === 0) _markDown();
  return ACTIVE_AGENTS.size;
}

// Engancha el cierre real del proceso (forge.js programa aquí el process.exit).
export function setOnDrained(cb) { onDrained = cb; }

function phase() {
  if (reiniciada) return 'down';
  if (apagandose) return 'draining';
  return 'running';
}

// La forma fija del contrato con el front: {encendida, agentes, apagandose, reiniciada}.
export function statusShort() {
  return { encendida: true, agentes: ACTIVE_AGENTS.size, apagandose, reiniciada };
}

// Forma extendida (alias /api/forge/estado): añade phase + la lista de agentes.
export function statusFull() {
  return {
    phase: phase(),
    encendida: true,
    activeAgents: ACTIVE_AGENTS.size,
    agentes: [...ACTIVE_AGENTS.values()].map((a) => ({ who: a.who, chatId: a.chatId, since: a.since })),
    apagandose,
    reiniciada,
  };
}
