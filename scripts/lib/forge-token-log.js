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
  return path.join(root, 'forge', 'sprint', 'token-log.jsonl');
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

// Lee el JSONL entero a un array de objetos, saltando líneas corruptas. [] si no
// existe el log. Lo usa el endpoint /api/tokens/run/:runId.
export function readTokenLog(root) {
  let raw = '';
  try { raw = fs.readFileSync(tokenLogPath(root), 'utf8'); }
  catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* línea corrupta, se salta */ }
  }
  return out;
}

// Suma el coste (costUsd, equivalente-API que reporta el CLI) de las filas del log,
// opcionalmente solo las posteriores a `sinceTs` (ISO). Pura. null/ausente → 0.
// La usa el calibrador de subvención (gasto API-equivalente acumulado / por ciclo).
export function sumCostUsd(rows, { sinceTs = null } = {}) {
  const since = sinceTs ? Date.parse(sinceTs) : null;
  let total = 0;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r) continue;
    if (since != null) {
      const t = Date.parse(r.ts);
      if (Number.isFinite(t) && t < since) continue;
    }
    total += Number(r.costUsd) || 0;
  }
  return total;
}

// Desglosa el coste por PERSONAJE (campo `agente`), opcionalmente desde `sinceTs`.
// Para cada uno: nº de lanzamientos, coste total y coste medio por lanzamiento (≈ por
// mensaje). Ordenado por coste total desc (el candidato a optimizar primero). Pura.
export function breakdownByAgente(rows, { sinceTs = null } = {}) {
  const since = sinceTs ? Date.parse(sinceTs) : null;
  const map = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.agente) continue;
    if (since != null) {
      const t = Date.parse(r.ts);
      if (Number.isFinite(t) && t < since) continue;
    }
    const cur = map.get(r.agente) || { agente: r.agente, count: 0, totalCostUsd: 0 };
    cur.count += 1;
    cur.totalCostUsd += Number(r.costUsd) || 0;
    map.set(r.agente, cur);
  }
  const out = [...map.values()].map((x) => ({ ...x, avgCostUsd: x.count ? x.totalCostUsd / x.count : 0 }));
  out.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return out;
}

// Filtra las filas de un `runId` y agrega sus totales. Función PURA (testable sin
// servidor). Trata null/ausente como 0 en las sumas. Si no hay filas → totales a
// 0 y requests vacío (nunca lanza).
export function summarizeRun(rows, runId) {
  const requests = (Array.isArray(rows) ? rows : []).filter((r) => r && r.runId === runId);
  const total = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const r of requests) {
    total.costUsd += Number(r.costUsd) || 0;
    total.inputTokens += Number(r.inputTokens) || 0;
    total.outputTokens += Number(r.outputTokens) || 0;
    total.cacheReadTokens += Number(r.cacheReadTokens) || 0;
    total.cacheCreationTokens += Number(r.cacheCreationTokens) || 0;
  }
  return { runId, total, requests };
}

// Normaliza el bloque `usage` + coste de un objeto del CLI (el JSON final de
// `--output-format json`, o el evento `result` de stream-json). {} si no hay.
export function extractUsage(obj) {
  if (!obj || typeof obj !== 'object') return { usageFound: false };
  const u = obj.usage || {};
  // el modelo REAL que corrió: el CLI lo reporta en `modelUsage` (un objeto cuyas
  // claves son los ids de modelo, p.ej. "claude-opus-4-8"). Caemos a obj.model si lo
  // hubiera. null si no se puede saber. (≠ la etiqueta CONFIGURADA del selector.)
  const mu = obj.modelUsage && typeof obj.modelUsage === 'object' ? Object.keys(obj.modelUsage) : [];
  const modeloReal = mu.length ? mu.join(', ') : (typeof obj.model === 'string' ? obj.model : null);
  return {
    usageFound: !!obj.usage || obj.total_cost_usd != null,
    inputTokens: u.input_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
    cacheCreationTokens: u.cache_creation_input_tokens ?? null,
    cacheReadTokens: u.cache_read_input_tokens ?? null,
    costUsd: obj.total_cost_usd ?? null,
    numTurns: obj.num_turns ?? null,
    durationMs: obj.duration_ms ?? null,
    modeloReal,
  };
}

// Decide QUÉ mensajes de un personaje llevan la chapa de coste y CUÁL es el primario
// (el único con chapa visible). Pura y testeable — la usa launchHeadless. Reglas:
//   • nuevos     = los mensajes de `who` que NO existían antes del run.
//   • el mensaje VIVO (liveMsgId) cuenta como suyo aunque naciera justo antes.
//   • el REEMPLAZADO (replacedId, p.ej. Aubé reescribe el suyo) también.
//   • primario   = si REPORTÓ (dejó una nota aparte), la nota (id mayor de los nuevos);
//                  si no, el vivo, o el reescrito, o el mayor.
export function chooseCostTargets({ beforeIds = [], mineNow = [], live = false, liveMsgId = null, replacedId = null, reported = false } = {}) {
  const beforeSet = new Set((beforeIds || []).map(Number));
  const newIds = (mineNow || []).map(Number).filter((id) => !beforeSet.has(id));
  if (live && liveMsgId != null && !newIds.includes(Number(liveMsgId))) newIds.push(Number(liveMsgId));
  if (replacedId != null && !newIds.includes(Number(replacedId))) newIds.push(Number(replacedId));
  let primaryId = null;
  if (newIds.length) {
    primaryId = reported ? Math.max(...newIds)
      : (live && liveMsgId != null ? Number(liveMsgId)
        : (replacedId != null ? Number(replacedId) : Math.max(...newIds)));
  }
  return { newIds, primaryId };
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
