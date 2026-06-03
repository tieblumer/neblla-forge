/**
 * forge.js — el servidor de la nueva interfaz del forge (`npm run forge`).
 *
 * Arranca un Express minúsculo y abre el navegador en la interfaz de tres
 * columnas (conversaciones · chat · tareas).
 *
 * Vivo en esta rebanada:
 *   - crear conversaciones (sprint/chats/NNN.json), persistentes a reinicios;
 *   - el compositor del centro: escribir texto + botón "Charlar". Charlar añade
 *     el turno de Tie al hilo y abre un HEADLESS cuya única mano es la
 *     herramienta MCP `contestar` (scripts/forge-mcp.js), que escribe la
 *     respuesta de vuelta en el mismo chat. El navegador la ve al sondear.
 *   - el resto de herramientas se muestran pero NO funcionan (cursor prohibido).
 *
 * Arranque:   node scripts/forge.js            (puerto 4330 por defecto)
 *             FORGE_PORT=5000 node scripts/forge.js
 *             FORGE_NO_OPEN=1 node scripts/forge.js   (no abre el navegador)
 */

import express from 'express';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listChats, createChat, readChat, appendMessage, chatsDir,
} from './lib/forge-store.js';
import { resolveProjectRoot } from './lib/target.js';

const PROJECT_ROOT = resolveProjectRoot();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// FORGE_DIR = la INSTALACIÓN del forge (scripts, public, project): fija, de aquí
// salen el MCP, el HTML y el cwd del headless.
const FORGE_DIR = path.resolve(__dirname, '..');
// ROOT = dónde viven las CONVERSACIONES. FORGE_ROOT la reapunta a una carpeta
// desechable para pruebas sin tocar las reales de Tie; por defecto, el forge.
const ROOT = process.env.FORGE_ROOT ? path.resolve(process.env.FORGE_ROOT) : FORGE_DIR;

const PORT = Number(process.env.FORGE_PORT) || 4330;
const FORGE_HTML = path.join(FORGE_DIR, 'public', 'forge', 'index.html');
const MCP_PATH = path.join(FORGE_DIR, 'scripts', 'forge-mcp.js');
const HEADLESS_TIMEOUT_MS = 5 * 60 * 1000;

// ── el headless de charla (suscripción, SIN API key) ─────────────────────────
// Patrón de mesa.js/sprint.js: spawn('claude', [...args]) con un ARRAY (sin
// shell). Le damos UNA sola herramienta: la MCP `contestar`. No tiene Read,
// Bash, Edit ni Write — literalmente no puede hacer otra cosa que contestar.
function buildThreadText(chatId) {
  const chat = readChat(ROOT, chatId);
  return (chat?.messages || [])
    .map((m) => `[#${m.id} · ${m.author} · ${m.type}${m.replyTo ? ' ↳#' + m.replyTo : ''}] ${m.text}`)
    .join('\n') || '(hilo vacío)';
}

function charlaPrompt(chatId) {
  const thread = buildThreadText(chatId);
  return [
    'Eres Iris, la CTO de Neblla, en una charla informal con Tie (el CEO) dentro',
    'del forge. Esto es una CHARLA: responde breve, claro y cálido, al grano.',
    '',
    'El hilo de la conversación hasta ahora:',
    '',
    thread,
    '',
    'Responde al ÚLTIMO mensaje de Tie.',
    '',
    'Puedes LEER el proyecto para contestar con fundamento: tienes Read, Grep y',
    'Glob (solo lectura). Úsalos si necesitas mirar el código antes de responder.',
    'NO tienes Edit, Write ni Bash: no puedes modificar nada.',
    '',
    'Tu ÚNICA forma de responder es la herramienta MCP `contestar`: LLÁMALA con tu',
    'respuesta en el campo `text`. No escribes en ningún otro sitio. En cuanto',
    'contestes, termina.',
  ].join('\n');
}

// Mensaje voluntario de apertura del backlog (la única vez que se llama a
// "Discutir backlog"): Iris mira el backlog real del producto y abre la charla.
function backlogOpenerPrompt() {
  // Le incrustamos el backlog en el prompt (el server SÍ puede leer cualquier
  // ruta); así Iris no depende de leer ficheros fuera de su cwd. Puede usar
  // Read/Grep/Glob para profundizar, pero el backlog ya lo tiene delante.
  let backlog = '(no encontré el BACKLOG.md del producto)';
  try {
    const p = path.join(PROJECT_ROOT, 'backbone', 'BACKLOG.md');
    if (fs.existsSync(p)) backlog = fs.readFileSync(p, 'utf8').slice(0, 12000);
  } catch { /* deja el placeholder */ }
  return [
    'Eres Iris, la CTO de Neblla, en una charla con Tie (el CEO) dentro del forge.',
    'Empieza un CICLO nuevo: la pizarra está limpia y tú ABRES la conversación del',
    'backlog (Tie aún no ha dicho nada). Este es tu mensaje voluntario de arranque.',
    '',
    'Este es el backlog real del producto:',
    '--- BACKLOG ---',
    backlog,
    '--- FIN BACKLOG ---',
    '',
    'Escribe un mensaje de apertura BREVE y en cristiano, sin jargon ni IDs:',
    'panorámica de los tres cubos (lo roto / lo a medias / lo sin empezar) con 2-3',
    'ejemplos concretos traducidos a qué significan, recuérdale el orden (lo roto',
    'primero) e invítale a elegir UN hilo. Cálida y directa.',
    '',
    'Tu ÚNICA forma de escribir es la herramienta MCP `contestar` (campo `text`).',
    'En cuanto publiques tu apertura, termina.',
  ].join('\n');
}

// William rebate UN mensaje concreto del hilo (challenge constructivo). Si el
// mensaje objetivo es de otro William, se cuestiona a sí mismo en primera persona.
function williamChallengePrompt(chatId, target) {
  const thread = buildThreadText(chatId);
  const self = target.author === 'william';
  return [
    'Eres William, el abogado del diablo de Neblla. Tu oficio: poner a prueba una',
    'afirmación con un challenge CONSTRUCTIVO — no destruir por destruir, sino',
    'señalar el flanco débil y proponer cómo reforzarlo. Una sola pasada, al grano.',
    '',
    'El hilo hasta ahora:',
    '',
    thread,
    '',
    `Tu objetivo es EXACTAMENTE el mensaje #${target.id} (de ${target.author}):`,
    `"${target.text}"`,
    '',
    self
      ? 'OJO: ese mensaje es TUYO. Hazte el abogado del diablo a ti mismo, EN PRIMERA'
        + ' persona ("me cuestiono que…", "¿y si me equivoqué en…?").'
      : `Cuestiona ESE mensaje en concreto (el #${target.id}), no lo último del hilo.`,
    'Si lo ves sólido, dilo y señala el único flanco que quede. No inventes',
    'requisitos nuevos ni muevas la portería.',
    '',
    'Tu única forma de escribir es la herramienta MCP `contestar` (campo `text`).',
    'Tienes Read/Grep/Glob de solo lectura. En cuanto publiques tu challenge, termina.',
  ].join('\n');
}

// Lanza un headless conversacional (solo-lectura + MCP contestar). `extraEnv`
// fija tipo/intención/replyTo/autor del mensaje que escribirá.
function launchHeadless({ chatId, prompt, extraEnv = {} }) {
  const cfg = {
    mcpServers: {
      forge: {
        command: 'node',
        args: [MCP_PATH],
        env: { FORGE_ROOT: ROOT, FORGE_CHAT_ID: String(chatId), ...extraEnv },
      },
    },
  };
  const cfgPath = path.join(os.tmpdir(), `forge-mcp-${process.pid}-${Date.now()}-${chatId}.json`);
  try { fs.writeFileSync(cfgPath, JSON.stringify(cfg)); }
  catch (e) { console.error('[forge] no pude escribir el mcp-config:', e.message); return; }

  const args = [
    '-p', prompt,
    '--allowedTools', 'Read,Grep,Glob,mcp__forge__contestar',
    '--mcp-config', cfgPath,
    // SOLO el servidor forge: ignora los MCP globales (Neblla, Google…). El
    // headless no debe ver más herramientas que las de su oficio, y así el
    // servidor `contestar` conecta de forma fiable (sin contaminación ambiental).
    '--strict-mcp-config',
  ];

  let child;
  try {
    child = spawn('claude', args, { cwd: FORGE_DIR, stdio: 'inherit' });
  } catch (e) {
    console.error('[forge] no pude lanzar el headless (`claude`):', e.message);
    try { fs.unlinkSync(cfgPath); } catch {}
    return;
  }

  const timer = setTimeout(() => {
    console.error('[forge] el headless agotó el tiempo, lo mato.');
    try { child.kill('SIGKILL'); } catch {}
  }, HEADLESS_TIMEOUT_MS);

  child.on('error', (e) => console.error('[forge] error en el headless:', e.message));
  child.on('exit', (code) => {
    clearTimeout(timer);
    console.log(`[forge] headless salió (code=${code}).`);
    try { fs.unlinkSync(cfgPath); } catch {}
  });
}

// ── abrir el navegador (best-effort, multiplataforma) ───────────────────────
function openBrowser(url) {
  if (process.env.FORGE_NO_OPEN) return;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.error('[forge] no pude abrir el navegador solo:', e.message);
  }
}

// ── servidor ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  if (!fs.existsSync(FORGE_HTML)) return res.status(500).send('forge/index.html no encontrado');
  res.type('html').send(fs.readFileSync(FORGE_HTML, 'utf8'));
});

// Lista de conversaciones (releída de disco → persiste siempre).
app.get('/api/chats', (_req, res) => {
  res.json(listChats(ROOT));
});

// Crea una conversación nueva. body {type?, title?}.
app.post('/api/chats', (req, res) => {
  try {
    const { type, title } = req.body || {};
    res.status(201).json(createChat(ROOT, { type, title }));
  } catch (e) {
    res.status(500).json({ error: 'no se pudo crear la conversación: ' + e.message });
  }
});

// Una conversación completa (el navegador sondea esto para ver llegar respuestas).
app.get('/api/chats/:id', (req, res) => {
  const chat = readChat(ROOT, req.params.id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  res.json(chat);
});

// Charlar: añade el turno de Tie y abre el headless que contestará vía MCP.
app.post('/api/chats/:id/charla', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const text = req.body && req.body.text;
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'falta el texto' });
  }
  // replyTo opcional: si Tie responde a un mensaje concreto, su turno cuelga de él
  // (rama); sin replyTo es un mensaje raíz nuevo.
  let parent = null;
  if (req.body.replyTo != null) {
    const pid = Number(req.body.replyTo);
    if ((chat.messages || []).some((m) => m.id === pid)) parent = pid;
  }

  let tieMsg;
  try {
    tieMsg = appendMessage(ROOT, id, {
      type: 'charla', author: 'tie', intent: 'request', replyTo: parent, text: String(text).trim(),
    });
  } catch (e) {
    return res.status(500).json({ error: 'no se pudo guardar: ' + e.message });
  }

  // sin bloquear; Iris contesta colgando de mi turno
  launchHeadless({
    chatId: id,
    prompt: charlaPrompt(id),
    extraEnv: { FORGE_REPLY_TO: String(tieMsg.id), FORGE_MSG_TYPE: 'charla', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'iris' },
  });
  res.status(202).json({ message: tieMsg, spawned: true });
});

// Challenge: un William rebate un mensaje concreto (su challenge cuelga de él).
app.post('/api/chats/:id/challenge', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const targetId = Number(req.body && req.body.targetId);
  const target = (chat.messages || []).find((m) => m.id === targetId);
  if (!target) return res.status(400).json({ error: 'mensaje objetivo no encontrado' });

  launchHeadless({
    chatId: id,
    prompt: williamChallengePrompt(id, target),
    extraEnv: { FORGE_REPLY_TO: String(targetId), FORGE_MSG_TYPE: 'challenge', FORGE_INTENT: 'challenge', FORGE_AUTHOR: 'william' },
  });
  res.status(202).json({ spawned: true, targetId });
});

// ── nuevo ciclo ───────────────────────────────────────────────────────────────
// Borra TODAS las conversaciones (efímeras) y exige que el producto (project/)
// no tenga nada por comitear. Luego auto-crea la conversación `backlog` y lanza
// a Iris a abrirla con un mensaje voluntario (la única vez que se invoca
// "Discutir backlog").
function projectPending() {
  // Lista los cambios sin comitear del producto; [] = limpio. null = no es repo git.
  const r = spawnSync('git', ['-C', PROJECT_ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

function wipeChats() {
  let files = [];
  try { files = fs.readdirSync(chatsDir(ROOT)); } catch { return; }
  for (const f of files) {
    if (/^\d+\.json$/.test(f)) { try { fs.unlinkSync(path.join(chatsDir(ROOT), f)); } catch {} }
  }
}

app.post('/api/cycle/new', (_req, res) => {
  const pending = projectPending();
  if (pending === null) {
    return res.status(409).json({ error: 'No pude consultar el git del producto en ' + PROJECT_ROOT });
  }
  if (pending.length) {
    return res.status(409).json({
      error: 'El producto (project/) tiene cambios sin comitear. Ciérralos antes de empezar un ciclo nuevo.',
      pending,
    });
  }

  wipeChats();
  const chat = createChat(ROOT, { type: 'backlog', title: 'backlog' });
  launchHeadless({
    chatId: chat.id,
    prompt: backlogOpenerPrompt(),
    extraEnv: { FORGE_MSG_TYPE: 'backlog', FORGE_INTENT: 'opener' }, // sin replyTo → apertura
  });
  res.status(201).json({ chat, spawned: true });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Forge en ${url}`);
  openBrowser(url);
});
