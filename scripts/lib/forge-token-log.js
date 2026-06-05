/**
 * forge-token-log.js — el contador de tokens del forge.
 *
 * Hoy el forge solo dice "fulano arranca" (forge.js) y NADA del coste. Esta
 * pieza registra, por CADA `claude` que se lanza (cada personaje, cada resumen
 * en vivo, cada varita de nombre), una línea JSON con:
 *   - agente            quién es (iris, william, miguel, resumen-vivo…)
 *   - permisos          las herramientas que se le concedieron (--allowedTools)
 *   - modelo            opus | sonnet | haiku | (por defecto del CLI)
 *   - textoEntrada      el prompt inicial COMPLETO + su tamaño (chars/bytes)
 *   - usage/coste       lo que reporta el PROPIO CLI (`--output-format json` →
 *                       `usage` / `total_cost_usd`): el coste REAL, no una
 *                       estimación del texto de entrada.
 *
 * El log es un JSONL (una petición = una línea) en sprint/token-log.jsonl bajo
 * la carpeta de conversaciones (ROOT). Append-only, best-effort: el log JAMÁS
 * debe tumbar un spawn — si falla escribiendo, se traga el error y sigue.
 */

import fs from 'fs';
import path from 'path';

export function tokenLogPath(root) {
  return path.join(root, 'sprint', 'token-log.jsonl');
}

// Añade una petición al log. Estampa la hora. Nunca lanza.
export function logTokenUsage(root, entry) {
  try {
    const p = tokenLogPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const rec = { ts: new Date().toISOString(), ...entry };
    fs.appendFileSync(p, JSON.stringify(rec) + '\n');
  } catch {
    /* best-effort: el contador nunca frena al forge */
  }
}

// Normaliza el bloque `usage` + coste de un objeto del CLI (el JSON final de
// `--output-format json`, o el evento `result` de stream-json). {} si no hay.
export function extractUsage(obj) {
  if (!obj || typeof obj !== 'object') return { usageFound: false };
  const u = obj.usage || {};
  return {
    usageFound: !!obj.usage || obj.total_cost_usd != null,
    inputTokens: u.input_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
    cacheCreationTokens: u.cache_creation_input_tokens ?? null,
    cacheReadTokens: u.cache_read_input_tokens ?? null,
    costUsd: obj.total_cost_usd ?? null,
    numTurns: obj.num_turns ?? null,
    durationMs: obj.duration_ms ?? null,
  };
}

// Intenta sacar el objeto-resultado del CLI de su stdout.
//   - modo json:        el stdout ENTERO es un único objeto JSON.
//   - modo stream-json: una línea por evento; la última con type==='result'
//                       trae el usage/coste. Devolvemos ESA.
// null si no se encuentra nada parseable.
export function parseCliResult(stdout, { stream = false } = {}) {
  const s = String(stdout || '').trim();
  if (!s) return null;
  if (!stream) {
    try { return JSON.parse(s); } catch { return null; }
  }
  let found = null;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && obj.type === 'result') found = obj;
    } catch { /* línea no-JSON, ignora */ }
  }
  return found;
}
