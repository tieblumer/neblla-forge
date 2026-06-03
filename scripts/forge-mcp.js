/**
 * forge-mcp.js — servidor MCP mínimo (JSON-RPC 2.0 por stdio) con UNA herramienta.
 *
 * Es la ÚNICA mano del headless de charla: no puede leer ni escribir ficheros,
 * solo llamar a `contestar`. Esa llamada escribe su respuesta en el chat
 * correspondiente (sprint/chats/NNN.json) vía el almacén compartido.
 *
 * El headless lo arranca Claude Code a partir del --mcp-config que escribe
 * scripts/forge.js, que le pasa por `env`:
 *   FORGE_ROOT      — raíz del forge (para localizar sprint/chats)
 *   FORGE_CHAT_ID   — a qué conversación contesta
 *   FORGE_REPLY_TO  — id del mensaje de Tie al que responde (la "charla" cuelga de él)
 *
 * REGLA DE STDOUT: por aquí SOLO viajan mensajes JSON-RPC (uno por línea). Todo
 * log de depuración va a stderr; un console.log rompería el protocolo.
 */

import { appendMessage } from './lib/forge-store.js';

const ROOT = process.env.FORGE_ROOT || process.cwd();
const CHAT_ID = process.env.FORGE_CHAT_ID || null;
const REPLY_TO = process.env.FORGE_REPLY_TO ? Number(process.env.FORGE_REPLY_TO) : null;
// El mismo `contestar` sirve para la charla (answer) y para la apertura del
// backlog (opener); el tipo/intención del mensaje los fija quien lanza el headless.
const MSG_TYPE = process.env.FORGE_MSG_TYPE || 'charla';
const INTENT = process.env.FORGE_INTENT || 'answer';
const AUTHOR = process.env.FORGE_AUTHOR || 'iris';

const TOOL = {
  name: 'contestar',
  description: 'Publica tu respuesta en la charla con Tie. Es tu única acción posible.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'El texto de tu respuesta para Tie.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  // Notificaciones (sin id): no se responden.
  const isNotification = (id === undefined || id === null);

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'forge', version: '0.1.0' },
      });
      return;

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notificaciones, se ignoran

    case 'ping':
      if (!isNotification) reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: [TOOL] });
      return;

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (name !== 'contestar') {
        return fail(id, -32602, 'herramienta desconocida: ' + name);
      }
      const text = String(args.text == null ? '' : args.text).trim();
      if (!text) {
        return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta el texto de la respuesta.' }] });
      }
      if (!CHAT_ID) {
        return reply(id, { isError: true, content: [{ type: 'text', text: 'No sé a qué chat contestar (falta FORGE_CHAT_ID).' }] });
      }
      try {
        const created = appendMessage(ROOT, CHAT_ID, {
          type: MSG_TYPE,
          author: AUTHOR,
          intent: INTENT,
          replyTo: REPLY_TO,
          text,
        });
        reply(id, {
          content: [{ type: 'text', text: `Contestación publicada en el chat ${CHAT_ID} (mensaje #${created.id}, en respuesta a #${REPLY_TO}).` }],
        });
      } catch (e) {
        reply(id, { isError: true, content: [{ type: 'text', text: 'No pude publicar: ' + e.message }] });
      }
      return;
    }

    default:
      if (!isNotification) fail(id, -32601, 'método no soportado: ' + method);
  }
}

// ── bucle de lectura de stdin (JSON por líneas) ──────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { console.error('[forge-mcp] línea no-JSON ignorada:', e.message); continue; }
    try { handle(msg); }
    catch (e) { console.error('[forge-mcp] error manejando', msg && msg.method, e.message); }
  }
});
process.stdin.on('end', () => process.exit(0));
