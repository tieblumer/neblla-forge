// tests/27-forge-token-log.test.js
//
// La diana del CONTADOR DE TOKENS del forge (scripts/lib/forge-token-log.js).
// Comprueba, sin lanzar ningún `claude` real, que:
//   1. extractUsage normaliza el bloque usage/coste del JSON del CLI;
//   2. parseCliResult saca el objeto-resultado tanto en modo `json` (un único
//      objeto) como en `stream-json` (la última línea con type:'result');
//   3. logTokenUsage escribe JSONL append-only, estampa la hora y no pierde
//      filas ni rompe ante basura;
//   4. el contador NUNCA lanza (best-effort) aunque la ruta sea imposible.
//
// Se ejecuta directo:  node tests/27-forge-token-log.test.js
// needsServer = false → cuando el launcher sano lo recoja.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { logTokenUsage, extractUsage, parseCliResult, tokenLogPath } from '../scripts/lib/forge-token-log.js';

export const needsServer = false;

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export async function run({ reporter: r }) {
  r.suite('27 — forge: contador de tokens (log de la fuga)');

  // ── 1) extractUsage normaliza usage + coste ────────────────────────────────
  {
    const cli = { type: 'result', total_cost_usd: 0.0123, num_turns: 3, duration_ms: 8400,
      usage: { input_tokens: 1200, output_tokens: 340, cache_creation_input_tokens: 500, cache_read_input_tokens: 24000 } };
    const u = extractUsage(cli);
    r.ok('usageFound true cuando hay usage', u.usageFound === true);
    r.eq('coste leído del CLI (no estimado)', u.costUsd, 0.0123);
    r.eq('input tokens', u.inputTokens, 1200);
    r.eq('output tokens', u.outputTokens, 340);
    r.eq('cache-read tokens', u.cacheReadTokens, 24000);
    r.eq('cache-new tokens', u.cacheCreationTokens, 500);

    const empty = extractUsage(null);
    r.ok('sin objeto → usageFound false', empty.usageFound === false);
  }

  // ── 2) parseCliResult: modo json y modo stream-json ────────────────────────
  {
    const jsonOut = JSON.stringify({ type: 'result', total_cost_usd: 0.5, result: 'hola',
      usage: { input_tokens: 90000, output_tokens: 2000, cache_read_input_tokens: 120000 } });
    const a = parseCliResult(jsonOut, { stream: false });
    r.eq('json: saca el result', a && a.result, 'hola');
    r.eq('json: coste accesible vía extractUsage', extractUsage(a).costUsd, 0.5);

    const stream = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'trabajando' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.9,
        usage: { input_tokens: 5000, output_tokens: 8000, cache_read_input_tokens: 400000 } }),
    ].join('\n');
    const b = parseCliResult(stream, { stream: true });
    r.ok('stream: coge la línea result', b && b.type === 'result');
    r.eq('stream: coste de toda la sesión', extractUsage(b).costUsd, 0.9);

    r.eq('basura → null', parseCliResult('no soy json', { stream: false }), null);
    r.eq('vacío → null', parseCliResult('', { stream: true }), null);
  }

  // ── 3) logTokenUsage escribe JSONL append-only y estampa la hora ───────────
  {
    const root = mkTmp('tok-log-');
    logTokenUsage(root, { agente: 'iris', permisos: 'Read,Grep', modelo: 'opus', costUsd: 0.04 });
    logTokenUsage(root, { agente: 'miguel', permisos: 'Read,Write,Edit', modelo: 'opus', costUsd: 0.9 });
    const lines = fs.readFileSync(tokenLogPath(root), 'utf8').trim().split('\n');
    r.eq('una línea por petición', lines.length, 2);
    const first = JSON.parse(lines[0]);
    r.ok('cada fila estampa la hora (ts)', typeof first.ts === 'string' && first.ts.length > 0);
    r.eq('guarda el agente', first.agente, 'iris');
    r.eq('guarda los permisos (herramientas)', first.permisos, 'Read,Grep');
    r.eq('guarda el modelo', first.modelo, 'opus');
    r.eq('segunda fila es miguel', JSON.parse(lines[1]).agente, 'miguel');
  }

  // ── 4) best-effort: nunca lanza, ni con ruta imposible ─────────────────────
  {
    let threw = false;
    try { logTokenUsage('\0ruta::imposible', { agente: 'x' }); } catch { threw = true; }
    r.ok('logTokenUsage nunca tumba el forge', threw === false);
  }
}
