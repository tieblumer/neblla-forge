/**
 * forge-token-report.js — el informe de la fuga de tokens del forge.
 *
 * Lee sprint/token-log.jsonl (lo que escribe forge.js por cada `claude` que
 * lanza) y lo enseña en cristiano. Para cada petición saca lo que pide la tarea:
 *   - agente, permisos (herramientas), modelo, tamaño del texto de entrada
 *   - el coste REAL del CLI: tokens (in/out/cache) + total_cost_usd
 * Y luego AGREGA por agente y por tipo de spawn → ahí la fuga se enseña sola
 * (p.ej. cuántas veces corrió el resumen en vivo y cuánto sumó en total).
 *
 * Uso:
 *   node scripts/forge-token-report.js                 (log por defecto)
 *   node scripts/forge-token-report.js <ruta.jsonl>
 *   node scripts/forge-token-report.js --full          (incluye el prompt entero)
 *   FORGE_ROOT=/otra/carpeta node scripts/forge-token-report.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const FORGE_DIR = path.resolve(path.dirname(__filename), '..');
const ROOT = process.env.FORGE_ROOT ? path.resolve(process.env.FORGE_ROOT) : FORGE_DIR;

const argv = process.argv.slice(2);
const full = argv.includes('--full');
const fileArg = argv.find((a) => !a.startsWith('--'));
const LOG = fileArg ? path.resolve(fileArg) : path.join(ROOT, 'sprint', 'token-log.jsonl');

function readLog(p) {
  if (!fs.existsSync(p)) {
    console.error(`No encontré el log en ${p}. ¿Ya corrió algún personaje desde que se instaló el contador?`);
    process.exit(1);
  }
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* línea corrupta, sáltala */ }
  }
  return out;
}

const n = (v) => (v == null ? 0 : Number(v) || 0);
const usd = (v) => (v == null ? '—' : '$' + n(v).toFixed(4));
const tok = (v) => (v == null ? '—' : n(v).toLocaleString('en-US'));

function lineFor(r) {
  const modelo = r.modelo || '?';
  const size = `${r.promptChars ?? '?'} chars / ${r.promptBytes ?? '?'} B`;
  const tokens = `in ${tok(r.inputTokens)} · out ${tok(r.outputTokens)} · cache-read ${tok(r.cacheReadTokens)} · cache-new ${tok(r.cacheCreationTokens)}`;
  return [
    `  • ${r.agente}  [${modelo}]  ${usd(r.costUsd)}`,
    `      permisos : ${r.permisos}`,
    `      entrada  : ${size}   (${r.spawn}${r.chatId ? ', chat ' + r.chatId : ''})`,
    `      tokens   : ${tokens}`,
    r.usageFound ? null : '      ⚠️  el CLI no devolvió usage para esta petición',
    full && r.textoEntrada ? '      ───── texto de entrada ─────\n' + indent(r.textoEntrada) : null,
  ].filter(Boolean).join('\n');
}

function indent(s) {
  return String(s).split('\n').map((l) => '      | ' + l).join('\n');
}

// Agrega por una clave (agente o spawn): nº de peticiones, coste y tokens totales.
function aggregate(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || '?';
    if (!m.has(k)) m.set(k, { k, count: 0, cost: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheNew: 0, bytes: 0 });
    const a = m.get(k);
    a.count++; a.cost += n(r.costUsd); a.inTok += n(r.inputTokens); a.outTok += n(r.outputTokens);
    a.cacheRead += n(r.cacheReadTokens); a.cacheNew += n(r.cacheCreationTokens); a.bytes += n(r.promptBytes);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}

function printTable(title, aggs, totalCost) {
  console.log('\n' + title);
  console.log('─'.repeat(title.length));
  for (const a of aggs) {
    const pct = totalCost > 0 ? ((a.cost / totalCost) * 100).toFixed(1) : '0.0';
    console.log(
      `  ${a.k.padEnd(34)} ${String(a.count).padStart(4)}×  ${usd(a.cost).padStart(10)}  (${pct.padStart(5)}%)  ` +
      `in ${tok(a.inTok)} / out ${tok(a.outTok)} / cache-read ${tok(a.cacheRead)} / cache-new ${tok(a.cacheNew)} / entrada ${(a.bytes / 1024).toFixed(0)}KB`
    );
  }
}

const rows = readLog(LOG);
const totalCost = rows.reduce((s, r) => s + n(r.costUsd), 0);
const totalIn = rows.reduce((s, r) => s + n(r.inputTokens), 0);
const totalOut = rows.reduce((s, r) => s + n(r.outputTokens), 0);
const totalCacheRead = rows.reduce((s, r) => s + n(r.cacheReadTokens), 0);
const totalCacheNew = rows.reduce((s, r) => s + n(r.cacheCreationTokens), 0);

console.log(`\n=== INFORME DE TOKENS DEL FORGE ===`);
console.log(`Log: ${LOG}`);
console.log(`Peticiones: ${rows.length}   Coste total: ${usd(totalCost)}`);
console.log(`Tokens — entrada ${tok(totalIn)} · salida ${tok(totalOut)} · cache-read ${tok(totalCacheRead)} · cache-new ${tok(totalCacheNew)}`);

printTable('POR AGENTE (mayor gasto primero)', aggregate(rows, 'agente'), totalCost);
printTable('POR TIPO DE SPAWN', aggregate(rows, 'spawn'), totalCost);

console.log('\nDETALLE PETICIÓN A PETICIÓN' + (full ? ' (con texto de entrada)' : ' (usa --full para ver el prompt)'));
console.log('─'.repeat(40));
for (const r of rows) console.log(lineFor(r));
console.log('');
