// tests/28-forge-cost-chip.test.js
//
// La diana de la CHAPA DE COSTE del forge. Sin lanzar ningún `claude` real, prueba:
//   1. stampMessageCost (scripts/lib/forge-store.js): estampa runId/cost/costPrimary
//      en un mensaje SIN tocar text/author ni marcar edited; idempotente; no lanza
//      si el mensaje no existe.
//   2. summarizeRun (scripts/lib/forge-token-log.js): filtra y agrega por runId la
//      lógica que sirve el endpoint /api/tokens/run/:runId.
//   3. caso degradado: costUsd null / usageFound:false → el agregado lo trata como 0.
//
// Se ejecuta directo (el launcher tests/run.js está roto: importa socket.io-client).
// needsServer = false.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createChat, appendMessage, readChat, stampMessageCost } from '../../scripts/lib/forge-store.js';
import { logTokenUsage, readTokenLog, summarizeRun, chooseCostTargets } from '../../scripts/lib/forge-token-log.js';

export const needsServer = false;

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export async function run({ reporter: r }) {
  r.suite('28 — forge: chapa de coste (stamp + agregado por runId)');

  // ── 0) chooseCostTargets: a qué mensaje(s) va la chapa y cuál es el primario ──
  {
    // Ana Liz (vivo + nota): el placeholder 10 ya existía al spawn; la nota 11 es nueva.
    const a = chooseCostTargets({ beforeIds: [10], mineNow: [10, 11], live: true, liveMsgId: 10, reported: true });
    r.ok('Ana Liz: la chapa visible va en su NOTA (11)', a.primaryId === 11);
    r.ok('Ana Liz: tanto la nota como el vivo se estampan', a.newIds.includes(11) && a.newIds.includes(10));
    // Miguel: build vivo 5 + informe 6.
    const m = chooseCostTargets({ beforeIds: [5], mineNow: [5, 6], live: true, liveMsgId: 5, reported: true });
    r.ok('Miguel: chapa en el informe (6)', m.primaryId === 6);
    // Aubé: reescribe su propio mensaje 7 (REPLACE), sin nota aparte.
    const au = chooseCostTargets({ beforeIds: [7], mineNow: [7], live: true, liveMsgId: 7, replacedId: 7, reported: false });
    r.ok('Aubé: chapa en su mensaje reescrito (7)', au.primaryId === 7 && au.newIds.includes(7));
    // Sin nota (solo el vivo): chapa en el vivo.
    const s = chooseCostTargets({ beforeIds: [10], mineNow: [10], live: true, liveMsgId: 10, reported: false });
    r.ok('sin nota: chapa en el vivo (10)', s.primaryId === 10);
  }

  // ── 1) stampMessageCost ─────────────────────────────────────────────────────
  {
    const root = mkTmp('forge-cost-');
    const chat = createChat(root, { type: 'tarea', title: 'X' });
    const msg = appendMessage(root, chat.id, { author: 'miguel', text: 'informe final', intent: 'answer' });

    const stamped = stampMessageCost(root, chat.id, msg.id, {
      runId: 'run-A', costUsd: 0.0123, usageFound: true, costPrimary: true,
    });
    r.ok('estampar devuelve el mensaje', !!stamped);
    r.eq('lleva el runId', stamped.runId, 'run-A');
    r.eq('cost.usd estampado', stamped.cost.usd, 0.0123);
    r.eq('cost.usageFound true', stamped.cost.usageFound, true);
    r.ok('costPrimary marcado', stamped.costPrimary === true);
    r.eq('text intacto', stamped.text, 'informe final');
    r.eq('author intacto', stamped.author, 'miguel');
    r.ok('NO marca edited', stamped.edited === undefined);

    // persistió en disco
    const fresh = readChat(root, chat.id).messages.find((m) => m.id === msg.id);
    r.eq('persiste el coste en disco', fresh.cost.usd, 0.0123);

    // idempotente: re-estampar sin costPrimary no rompe ni pierde el coste
    const again = stampMessageCost(root, chat.id, msg.id, { runId: 'run-A', costUsd: 0.0123, usageFound: true });
    r.eq('re-estampar idempotente (usd)', again.cost.usd, 0.0123);
    r.ok('re-estampar no marca edited', again.edited === undefined);

    // mensaje inexistente → null, no lanza
    let threw = false; let res;
    try { res = stampMessageCost(root, chat.id, 9999, { runId: 'r', costUsd: 0.1, usageFound: true }); }
    catch { threw = true; }
    r.ok('msgId inexistente no lanza', threw === false);
    r.eq('msgId inexistente devuelve null', res, null);

    // chat inexistente → null, no lanza
    let threw2 = false; let res2;
    try { res2 = stampMessageCost(root, '777', 1, { runId: 'r', costUsd: 0.1, usageFound: true }); }
    catch { threw2 = true; }
    r.ok('chat inexistente no lanza', threw2 === false);
    r.eq('chat inexistente devuelve null', res2, null);
  }

  // ── 2) summarizeRun: filtro + agregado por runId ────────────────────────────
  {
    const root = mkTmp('forge-run-');
    logTokenUsage(root, { agente: 'miguel', runId: 'r1', costUsd: 0.10, inputTokens: 100, outputTokens: 20, cacheReadTokens: 1000, cacheCreationTokens: 50 });
    logTokenUsage(root, { agente: 'resumen-vivo', runId: 'r1', costUsd: 0.02, inputTokens: 30, outputTokens: 5, cacheReadTokens: 200, cacheCreationTokens: 0 });
    logTokenUsage(root, { agente: 'iris', runId: 'r2', costUsd: 0.99, inputTokens: 9, outputTokens: 9 });

    const rows = readTokenLog(root);
    r.eq('readTokenLog parsea todas las filas', rows.length, 3);

    const s1 = summarizeRun(rows, 'r1');
    r.eq('r1 trae solo sus 2 peticiones', s1.requests.length, 2);
    r.ok('r1 suma el coste (0.10+0.02)', Math.abs(s1.total.costUsd - 0.12) < 1e-9);
    r.eq('r1 suma input tokens', s1.total.inputTokens, 130);
    r.eq('r1 suma output tokens', s1.total.outputTokens, 25);
    r.eq('r1 suma cache-read', s1.total.cacheReadTokens, 1200);
    r.eq('r1 suma cache-new', s1.total.cacheCreationTokens, 50);

    const s2 = summarizeRun(rows, 'r2');
    r.eq('r2 trae solo la suya', s2.requests.length, 1);
    r.ok('r2 coste 0.99', Math.abs(s2.total.costUsd - 0.99) < 1e-9);

    const none = summarizeRun(rows, 'no-existe');
    r.eq('runId inexistente → requests vacío', none.requests.length, 0);
    r.eq('runId inexistente → coste 0', none.total.costUsd, 0);
  }

  // ── 3) costUsd null / usageFound:false → tratado como 0, sin romper ─────────
  {
    const root = mkTmp('forge-null-');
    logTokenUsage(root, { agente: 'miguel', runId: 'r3', costUsd: null, usageFound: false, inputTokens: null, outputTokens: null });
    logTokenUsage(root, { agente: 'miguel', runId: 'r3', costUsd: 0.05, inputTokens: 10, outputTokens: 2 });
    const s = summarizeRun(readTokenLog(root), 'r3');
    r.eq('null + 0.05 → 0.05 (null como 0)', s.total.costUsd, 0.05);
    r.eq('null inputs no rompen la suma', s.total.inputTokens, 10);
    r.eq('ambas filas presentes', s.requests.length, 2);

    // readTokenLog salta líneas corruptas sin romper
    fs.appendFileSync(path.join(root, 'forge', 'sprint', 'token-log.jsonl'), 'esto no es json\n');
    const rows = readTokenLog(root);
    r.eq('línea corrupta se salta (siguen 2 filas)', rows.length, 2);
  }
}
