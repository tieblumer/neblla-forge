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
  listChats, createChat, readChat, appendMessage, chatsDir, deleteChat,
  replaceMessageText, collapseUpToFork, listTareas, createTarea, renameChat,
  readCycle, writeCycle, readTarea, ensureTareaThread, updateTareaDefinition,
  setTareaBuild, markTareaBrought, markTareaEnMaster, setTareaError, clearTareaError, readModel, writeModel,
} from './lib/forge-store.js';
import * as cycle from './lib/forge-firme.js';
import { ordenar as ordenarTareas, GRUPOS as TAREA_GRUPOS } from './lib/forge-estado.js';
import { createMergeEngine } from './lib/forge-merge.js';
import {
  charlaPrompt, williamChallengePrompt, anselmoPrompt, aubePrompt,
  stevensPrompt, miyagiPrompt, discutirPrompt, miguelPrompt, mergeReviewerPrompt,
  parseSubtareasBloque,
} from './lib/forge-prompts.js';
import { troceaTarea } from './lib/forge-trocear.js';
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
const FORGE_FAVICON = path.join(FORGE_DIR, 'public', 'forge', 'favicon.svg');
const PANTALLAZOS_DIR = path.join(FORGE_DIR, 'pantallazos');
const MCP_PATH = path.join(FORGE_DIR, 'scripts', 'forge-mcp.js');
const HEADLESS_TIMEOUT_MS = 5 * 60 * 1000;

// ── modelo de los headless (selector GLOBAL de la UI) ────────────────────────
// El CLI `claude` acepta el alias del modelo (opus | sonnet | haiku) o el id
// completo; usamos el alias (mapea siempre al último de esa familia). La elección
// se guarda en sprint/model.json y vale para TODOS los personajes por igual.
// value '' = "Por defecto": NO pasamos --model y manda el modelo por defecto del CLI.
const MODEL_CHOICES = [
  { value: '',       label: 'Por defecto' },
  { value: 'opus',   label: 'Opus 4.8' },
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'haiku',  label: 'Haiku 4.5' },
];
const MODEL_VALUES = new Set(MODEL_CHOICES.map((m) => m.value).filter(Boolean));

// El alias guardado, saneado (uno de la lista, o '' si no hay/!válido).
function currentModel() {
  const m = readModel(ROOT);
  return MODEL_VALUES.has(m) ? m : '';
}

// Lo que se intercala en los args de spawn('claude', …): ['--model', alias] o []
// si está en "Por defecto". Así el selector aplica a todos los headless de golpe.
function modelArgs() {
  const m = currentModel();
  return m ? ['--model', m] : [];
}

// ── el headless de charla (suscripción, SIN API key) ─────────────────────────
// Patrón de mesa.js/sprint.js: spawn('claude', [...args]) con un ARRAY (sin
// shell). Le damos UNA sola herramienta: la MCP `contestar`. No tiene Read,
// Bash, Edit ni Write — literalmente no puede hacer otra cosa que contestar.
function buildThreadText(chatId) {
  const chat = readChat(ROOT, chatId);
  const body = (chat?.messages || [])
    .map((m) => `[#${m.id} · ${m.author} · ${m.type}${m.replyTo ? ' ↳#' + m.replyTo : ''}] ${m.text}`)
    .join('\n');
  // Si es el HILO PROPIO de una tarea (F9b), su definición es el texto BASE: los
  // personajes la ven aunque el hilo esté vacío (p.ej. pedir Consejo nada más abrir).
  let head = '';
  if (chat && chat.tareaId) {
    const t = readTarea(ROOT, chat.tareaId);
    if (t) head = `[la TAREA] ${t.title || ''}\n${t.body || ''}`.trim() + '\n';
  }
  return (head + body).trim() || '(hilo vacío)';
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

// El subárbol (rama) que cuelga de un mensaje, él incluido, como texto.
function buildBranchText(chat, rootId) {
  const byParent = new Map();
  for (const m of chat.messages || []) {
    if (m.replyTo != null) {
      if (!byParent.has(m.replyTo)) byParent.set(m.replyTo, []);
      byParent.get(m.replyTo).push(m);
    }
  }
  const out = [];
  const walk = (mid) => {
    const m = (chat.messages || []).find((x) => x.id === mid);
    if (m) out.push(`[#${m.id} · ${m.author} · ${m.type}] ${m.text}`);
    for (const k of byParent.get(mid) || []) walk(k.id);
  };
  walk(rootId);
  return out.join('\n') || '(rama vacía)';
}

// Resuelve el ALCANCE (scope) a un texto de "foco" neutro que se le pasa al
// personaje (William, Stevens, Miyagi, Romina/Ariel…). La parte de datos es mía
// (Lane 1); la voz de cada uno vive en forge-prompts.js (Lane 3). El verbo
// (cuestionar / auditar / aconsejar / defender) lo pone el prompt de cada personaje.
function buildFocoText(chat, target, scope = 'mensaje') {
  if (scope === 'hilo') {
    return [
      `Tu foco es TODA LA RAMA que nace en el mensaje #${target.id}:`,
      '',
      buildBranchText(chat, target.id),
      '',
      'Tómala como conjunto (su hilo argumental), no un mensaje suelto.',
    ].join('\n');
  }
  if (scope === 'conversacion') {
    return 'Tu foco es la CONVERSACIÓN ENTERA de arriba: su rumbo global '
      + '(hacia dónde va, qué se da por sentado, dónde está el flanco).';
  }
  if (scope === 'contextual') {
    return `Tu foco es el OBJETO que se está viendo — la ${chat.type === 'tarea' ? 'TAREA' : 'IDEA'} `
      + `"${chat.title}" — tomada como un todo (de qué trata, si está bien planteada, qué se le escapa).`;
  }
  // mensaje (por defecto)
  return `Tu foco es EXACTAMENTE el mensaje #${target.id} (de ${target.author}):\n"${target.text}"`;
}

const ACTION_SCOPES = ['mensaje', 'hilo', 'conversacion', 'contextual'];

// OBJETIVO del ciclo → raíz del repo sobre el que se trabaja + su descripción
// para los personajes ("de quién están hablando"). forge = raíz; project = product.
function cycleTarget() {
  return cycle.normalize(readCycle(ROOT) || cycle.DEFAULT_CYCLE).target;
}
function targetRoot() {
  return cycleTarget() === 'project' ? PROJECT_ROOT : FORGE_DIR;
}
function targetDesc() {
  return cycleTarget() === 'project'
    ? 'Neblla, el PRODUCTO (la carpeta project/)'
    : 'el FORGE, la propia máquina de construir (la raíz del repo)';
}

// Lanza un headless conversacional (solo-lectura + MCP contestar). `extraEnv`
// fija tipo/intención/replyTo/autor del mensaje que escribirá.
function launchHeadless({
  chatId, prompt, extraEnv = {},
  cwd = FORGE_DIR,
  allowedTools = 'Read,Grep,Glob,mcp__forge__contestar',
  timeoutMs = HEADLESS_TIMEOUT_MS,
  liveMsgId = null,   // si viene: stream-json + resumen Haiku que REESCRIBE este mensaje cada 10s
  onDone = null,      // si viene: callback({ failed, reported, code, signal }) al salir el headless
}) {
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

  const live = liveMsgId != null;
  const args = [
    '-p', prompt,
    ...modelArgs(),
    '--allowedTools', allowedTools,
    '--mcp-config', cfgPath,
    // SOLO el servidor forge: ignora los MCP globales (Neblla, Google…). El
    // headless no debe ver más herramientas que las de su oficio, y así el
    // servidor `contestar` conecta de forma fiable (sin contaminación ambiental).
    '--strict-mcp-config',
    // con resumen en vivo, pedimos el stream para leer lo que va diciendo Miguel.
    ...(live ? ['--output-format', 'stream-json', '--verbose'] : []),
  ];

  const who = extraEnv.FORGE_AUTHOR || 'headless';
  const countMine = () => {
    try { return (readChat(ROOT, chatId)?.messages || []).filter((m) => m.author === who).length; }
    catch { return 0; }
  };
  const before = countMine();
  const startedAt = Date.now();
  let timedOut = false;
  let stderrTail = '';
  console.log(`[forge] ${who} arranca (chat ${chatId}, cwd ${cwd}${live ? ', resumen en vivo' : ''}).`);

  let child;
  try {
    // stdout: 'pipe' si hay resumen en vivo (para leer el stream); si no, 'inherit'.
    // stderr: 'pipe' siempre, para GUARDAR el motivo de un fallo (antes se perdía).
    child = spawn('claude', args, { cwd, stdio: ['inherit', live ? 'pipe' : 'inherit', 'pipe'] });
  } catch (e) {
    console.error('[forge] no pude lanzar el headless (`claude`):', e.message);
    try { fs.unlinkSync(cfgPath); } catch {}
    return;
  }

  if (child.stderr) {
    child.stderr.on('data', (d) => {
      const s = d.toString();
      process.stderr.write(s);
      stderrTail = (stderrTail + s).slice(-2000); // últimos ~2 KB, para el aviso
    });
  }

  // ── resumen en vivo: acumula el stream y reescribe el MENSAJE VIVO (snapshot).
  // El temporizador es "10s DESPUÉS de que acabe el resumen anterior" (setTimeout
  // que se re-arma al terminar), no un intervalo fijo → nunca se solapan ni se
  // amontonan. El informe FINAL del personaje es un mensaje APARTE (append), así
  // que el resumen vivo nunca pisa su mensaje de cierre.
  let finished = false;
  let transcript = '';
  let lastSummarized = '';
  let liveLabel = who === 'revisor' ? 'El revisor está resolviendo' : 'Miguel está construyendo';
  if (live && child.stdout) {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const piece = readableFromStreamLine(line.trim());
        if (piece) transcript = (transcript + '\n' + piece).slice(-12000);
      }
    });
    const tick = async () => {
      if (finished) return;
      const snap = transcript.trim();
      if (snap && snap !== lastSummarized) {
        lastSummarized = snap;
        const sum = await runHaikuSummary(snap);
        if (!finished && sum) {
          try { replaceMessageText(ROOT, chatId, liveMsgId, `🔨 ${liveLabel}… (resumen en vivo)\n\n${sum}`); }
          catch (e) { console.error('[forge] no pude reescribir el resumen en vivo:', e.message); }
        }
      }
      if (!finished) liveTimeout = setTimeout(tick, 10 * 1000); // 10s TRAS acabar este
    };
    var liveTimeout = setTimeout(tick, 10 * 1000);
  }

  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`[forge] ${who} agotó el tiempo (${Math.round(timeoutMs / 60000)} min), lo mato.`);
    try { child.kill('SIGKILL'); } catch {}
  }, timeoutMs);

  child.on('error', (e) => console.error(`[forge] error lanzando ${who}:`, e.message));
  child.on('exit', (code, signal) => {
    finished = true;
    clearTimeout(timer);
    if (typeof liveTimeout !== 'undefined') clearTimeout(liveTimeout);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const failed = timedOut || code !== 0;
    // el informe final es un mensaje APARTE: 'reportó' = creció el nº de mensajes
    // suyos por encima del que ya tenía (el vivo). Vale para todos los modos.
    const reported = countMine() > before;
    console.log(`[forge] ${who} salió (code=${code}, signal=${signal || '-'}, ${secs}s, reportó=${reported}).`);

    if (live) {
      // cierra el mensaje VIVO: en pasado (lo que hizo) si fue bien; con el aviso si murió.
      if (failed && !reported) {
        const motivo = timedOut
          ? `se agotó el tiempo (${Math.round(timeoutMs / 60000)} min) y lo paré`
          : `terminó con error (code ${code}${signal ? ', señal ' + signal : ''})`;
        const detalle = (stderrTail.match(/API Error[^\n]*/i) || [])[0]
          || stderrTail.split('\n').filter(Boolean).slice(-1)[0] || '';
        try { replaceMessageText(ROOT, chatId, liveMsgId, `⚠️ ${who} no terminó: ${motivo}.${detalle ? '\n\n' + detalle : ''}\n\nPuedes volver a intentarlo.`); } catch {}
      } else {
        const cierre = who === 'revisor' ? '🔀 El revisor terminó el merge.' : '🔨 Miguel terminó de construir.';
        const traza = lastSummarized ? '' : ''; // (la traza detallada queda en su informe aparte)
        try { replaceMessageText(ROOT, chatId, liveMsgId, cierre + (reported ? ' Ver su informe abajo. ↓' : ' (sin informe final)') + traza); } catch {}
      }
    } else if (failed && !reported) {
      const motivo = timedOut
        ? `se agotó el tiempo (${Math.round(timeoutMs / 60000)} min) y lo paré`
        : `terminó con error (code ${code}${signal ? ', señal ' + signal : ''})`;
      const detalle = (stderrTail.match(/API Error[^\n]*/i) || [])[0]
        || stderrTail.split('\n').filter(Boolean).slice(-1)[0] || '';
      try {
        appendMessage(ROOT, chatId, {
          type: 'aviso', author: 'sistema', intent: 'answer',
          replyTo: extraEnv.FORGE_REPLY_TO ? Number(extraEnv.FORGE_REPLY_TO) : null,
          text: `⚠️ ${who} no terminó: ${motivo}.${detalle ? '\n\n' + detalle : ''}\n\nPuedes volver a intentarlo.`,
        });
      } catch (e) { console.error('[forge] no pude escribir el aviso de fallo:', e.message); }
    }
    try { fs.unlinkSync(cfgPath); } catch {}
    // gancho de cierre: el endpoint que lanzó este headless puede enganchar aquí
    // un paso AUTOMÁTICO (p.ej. el auto-merge a master cuando Miguel termina). Se
    // llama SIEMPRE al salir, con el veredicto; el callback decide qué hacer con él.
    if (typeof onDone === 'function') {
      try { onDone({ failed, reported, code, signal }); }
      catch (e) { console.error('[forge] onDone reventó:', e.message); }
    }
  });
}

// ── nombre automático (la "varita") ─────────────────────────────────────────
// Lanza un headless SIN herramientas que lee el hilo y devuelve un título súper
// corto. No usa la MCP `contestar` (no escribe en el chat): capturamos su stdout
// directamente. Promesa → null si falla. Config MCP vacía + strict para no cargar
// los MCP globales (Neblla/Google) ni pedir auth.
function generateTitle(chatId) {
  return new Promise((resolve) => {
    const thread = buildThreadText(chatId);
    const prompt = [
      'Lee esta conversación y proponle un TÍTULO súper corto: 2 a 4 palabras,',
      'sin comillas, sin punto final, que capture de qué va. Responde SOLO con el',
      'título, nada más (ni explicación ni prefijos).',
      '',
      thread,
    ].join('\n');

    const cfgPath = path.join(os.tmpdir(), `forge-name-${process.pid}-${Date.now()}-${chatId}.json`);
    try { fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: {} })); }
    catch { resolve(null); return; }

    let child;
    try {
      child = spawn('claude', ['-p', prompt, ...modelArgs(), '--mcp-config', cfgPath, '--strict-mcp-config'], {
        cwd: FORGE_DIR, stdio: ['ignore', 'pipe', 'inherit'],
      });
    } catch { try { fs.unlinkSync(cfgPath); } catch {} resolve(null); return; }

    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 90 * 1000);
    child.on('error', () => { clearTimeout(timer); try { fs.unlinkSync(cfgPath); } catch {} resolve(null); });
    child.on('exit', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(cfgPath); } catch {}
      // primera línea no vacía, sin comillas, recortada por seguridad.
      const t = out.split('\n').map((s) => s.trim()).find(Boolean) || '';
      const clean = t.replace(/^["'«»]+|["'«».]+$/g, '').trim().slice(0, 60);
      resolve(clean || null);
    });
  });
}

// Resumen en vivo con el modelo MÁS BARATO (Haiku), pase lo que pase el selector
// global. Lee el registro de la sesión de Miguel y devuelve un SNAPSHOT corto en
// cristiano (no acumula: describe el estado actual). null si falla. Sin MCP.
function runHaikuSummary(transcript) {
  return new Promise((resolve) => {
    const prompt = [
      'Eres un narrador silencioso. Abajo está el registro EN BRUTO de la sesión de',
      'Miguel (un programador) construyendo una tarea: lo que va diciendo y las',
      'herramientas que usa. Escribe un SNAPSHOT del progreso AHORA MISMO: 2 a 4 frases',
      'en cristiano y en presente ("está leyendo…", "ya escribió…", "ahora prueba…").',
      'Es una foto del estado actual, NO un diario: no acumules, describe dónde va.',
      'Sin preámbulos ni listas, solo el párrafo.',
      '',
      '--- REGISTRO ---',
      String(transcript || '').slice(-8000),
      '--- FIN ---',
    ].join('\n');
    const cfgPath = path.join(os.tmpdir(), `forge-sum-${process.pid}-${Date.now()}.json`);
    try { fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: {} })); }
    catch { resolve(null); return; }
    let child;
    try {
      child = spawn('claude', ['-p', prompt, '--model', 'haiku', '--mcp-config', cfgPath, '--strict-mcp-config'], {
        cwd: FORGE_DIR, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { try { fs.unlinkSync(cfgPath); } catch {} resolve(null); return; }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60 * 1000);
    child.on('error', () => { clearTimeout(timer); try { fs.unlinkSync(cfgPath); } catch {} resolve(null); });
    child.on('exit', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(cfgPath); } catch {}
      resolve(out.trim() || null);
    });
  });
}

// Extrae de una línea stream-json del CLI un trozo legible para el registro:
// el texto del asistente y las herramientas que usa. '' si no aporta nada.
function readableFromStreamLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return ''; }
  if (!obj || obj.type !== 'assistant' || !obj.message) return '';
  const parts = [];
  for (const b of obj.message.content || []) {
    if (b.type === 'text' && b.text) parts.push(b.text);
    else if (b.type === 'tool_use') {
      const arg = b.input && (b.input.file_path || b.input.path || b.input.command || b.input.pattern || '');
      parts.push(`[${b.name}${arg ? ' ' + String(arg).slice(0, 80) : ''}]`);
    }
  }
  return parts.join(' ');
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

// Favicon del forge (yunque en magenta de marca).
app.get('/forge/favicon.svg', (_req, res) => {
  if (!fs.existsSync(FORGE_FAVICON)) return res.status(404).end();
  res.type('image/svg+xml').send(fs.readFileSync(FORGE_FAVICON, 'utf8'));
});

// Modelo global de los headless: el navegador lo lee al cargar (para pintar el
// selector con su valor actual y las opciones) y lo escribe al cambiarlo.
app.get('/api/model', (_req, res) => {
  res.json({ model: currentModel(), choices: MODEL_CHOICES });
});

app.post('/api/model', (req, res) => {
  const raw = req.body && req.body.model;
  const model = (raw == null ? '' : String(raw));
  if (model && !MODEL_VALUES.has(model)) {
    return res.status(400).json({ error: 'modelo no válido: ' + model });
  }
  try {
    writeModel(ROOT, model);
    res.json({ model: currentModel() });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo guardar el modelo: ' + e.message });
  }
});

// Pegar un pantallazo: el navegador manda la imagen en CRUDO (Content-Type
// image/*); la guardamos en pantallazos/ con nombre correlativo y devolvemos la
// ruta relativa, que el navegador mete en el mensaje de Tie. La ruta es legible
// por los headless (su cwd es FORGE_DIR). express.raw solo en ESTA ruta.
function savePantallazo(buf, mime) {
  fs.mkdirSync(PANTALLAZOS_DIR, { recursive: true });
  const ext = mime === 'image/jpeg' ? 'jpg'
    : mime === 'image/gif' ? 'gif'
    : mime === 'image/webp' ? 'webp'
    : 'png';
  let max = 0;
  try {
    for (const f of fs.readdirSync(PANTALLAZOS_DIR)) {
      const m = f.match(/^pantallazo-(\d+)\./);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch { /* dir nuevo */ }
  const name = `pantallazo-${String(max + 1).padStart(3, '0')}.${ext}`;
  fs.writeFileSync(path.join(PANTALLAZOS_DIR, name), buf);
  return 'pantallazos/' + name;
}

app.post('/api/pantallazo', express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const buf = req.body;
  const mime = req.headers['content-type'] || 'image/png';
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'no llegó ninguna imagen' });
  if (!/^image\//.test(mime)) return res.status(400).json({ error: 'el contenido no es una imagen' });
  try {
    res.status(201).json({ path: savePantallazo(buf, mime) });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo guardar el pantallazo: ' + e.message });
  }
});

// Sirve un pantallazo guardado (para el thumbnail del chat). Solo nombres
// pantallazo-NNN.ext; basename + regex evitan subir de directorio.
app.get('/pantallazos/:name', (req, res) => {
  const name = path.basename(req.params.name || '');
  if (!/^pantallazo-\d+\.(png|jpe?g|gif|webp)$/.test(name)) return res.status(404).end();
  const file = path.join(PANTALLAZOS_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).end();
  const ext = name.split('.').pop().toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
    : ext === 'gif' ? 'image/gif'
    : ext === 'webp' ? 'image/webp'
    : 'image/png';
  res.type(mime).send(fs.readFileSync(file));
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

// Borra una conversación (DEFINITIVO). 404 si no existe. (Tarea #001, de Miguel.)
app.delete('/api/chats/:id', (req, res) => {
  let removed;
  try { removed = deleteChat(ROOT, req.params.id); }
  catch (e) { return res.status(500).json({ error: 'no se pudo borrar: ' + e.message }); }
  if (!removed) return res.status(404).json({ error: 'conversación no encontrada' });
  res.json({ deleted: req.params.id });
});

// Charlar: añade el turno de Tie y abre el headless que contestará vía MCP.
app.post('/api/chats/:id/charla', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const text = req.body && req.body.text;
  const hasText = text != null && String(text).trim();

  // replyTo opcional: si Tie responde a un mensaje concreto, su turno cuelga de él
  // (rama); sin replyTo es un mensaje raíz nuevo.
  let parent = null;
  if (req.body.replyTo != null) {
    const pid = Number(req.body.replyTo);
    if ((chat.messages || []).some((m) => m.id === pid)) parent = pid;
  }

  // ── Modo PROACTIVO: input VACÍO + bloque seleccionado. Iris arranca la charla
  // sobre ese bloque por iniciativa propia (qué es, qué hace, dudas), sin que Tie
  // teclee nada. NO se crea turno de Tie: la respuesta de Iris cuelga del bloque.
  if (!hasText) {
    if (parent == null) {
      return res.status(400).json({ error: 'falta el texto o un bloque seleccionado' });
    }
    const target = (chat.messages || []).find((m) => m.id === parent);
    const scope = ACTION_SCOPES.includes(req.body && req.body.scope) ? req.body.scope : 'mensaje';
    launchHeadless({
      chatId: id,
      prompt: charlaPrompt({ threadText: buildThreadText(id), focoText: buildFocoText(chat, target, scope) }),
      extraEnv: { FORGE_REPLY_TO: String(parent), FORGE_MSG_TYPE: 'charla', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'iris' },
    });
    return res.status(202).json({ pendingParent: parent, scope, spawned: true });
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
    prompt: charlaPrompt({ threadText: buildThreadText(id) }),
    extraEnv: { FORGE_REPLY_TO: String(tieMsg.id), FORGE_MSG_TYPE: 'charla', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'iris' },
  });
  // pendingParent = de quién colgará la respuesta de Iris (su turno cuelga del de
  // Tie). El navegador lo usa para poner el fantasma en su sitio exacto del árbol.
  res.status(202).json({ message: tieMsg, pendingParent: tieMsg.id, spawned: true });
});

// Responder: añade el turno de Tie SIN disparar a la IA (punto final, silencio).
// Igual que /charla pero sin headless. Si el objetivo ya tiene respuesta, el
// append cuelga de él → nace una rama hermana de forma natural (append-only).
app.post('/api/chats/:id/responder', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const text = req.body && req.body.text;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'falta el texto' });

  let parent = null;
  if (req.body.replyTo != null) {
    const pid = Number(req.body.replyTo);
    if ((chat.messages || []).some((m) => m.id === pid)) parent = pid;
  }
  try {
    const tieMsg = appendMessage(ROOT, id, {
      type: 'charla', author: 'tie', intent: 'request', replyTo: parent, text: String(text).trim(),
    });
    res.status(201).json({ message: tieMsg, spawned: false });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo guardar: ' + e.message });
  }
});

// Editar: REEMPLAZA el texto de un mensaje conservando su autoría (id/author/
// replyTo intactos). NO crea mensaje nuevo ni bifurca, aunque tenga respuestas
// colgando — es la excepción a la regla de bifurcación.
app.post('/api/chats/:id/edit', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const msgId = Number(req.body && req.body.msgId);
  const text = req.body && req.body.text;
  if (!Number.isFinite(msgId)) return res.status(400).json({ error: 'falta msgId' });
  if (text == null || !String(text).trim()) return res.status(400).json({ error: 'falta el texto' });
  try {
    const msg = replaceMessageText(ROOT, id, msgId, String(text).trim());
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Challenge: un William rebate, con ALCANCE elegible (mensaje | hilo |
// conversacion | contextual). Su challenge cuelga del mensaje objetivo.
app.post('/api/chats/:id/challenge', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const targetId = Number(req.body && req.body.targetId);
  const target = (chat.messages || []).find((m) => m.id === targetId);
  if (!target) return res.status(400).json({ error: 'mensaje objetivo no encontrado' });
  const scope = ACTION_SCOPES.includes(req.body && req.body.scope) ? req.body.scope : 'mensaje';

  // foco neutro + la auto-incredulidad de William si el objetivo es suyo.
  let focoText = buildFocoText(chat, target, scope);
  if (scope === 'mensaje' && target.author === 'william') {
    focoText += '\n\nOJO: ese mensaje es TUYO — cuestiónate a ti mismo en primera persona.';
  }

  launchHeadless({
    chatId: id,
    prompt: williamChallengePrompt({ threadText: buildThreadText(id), focoText, steer: req.body && req.body.steer }),
    extraEnv: { FORGE_REPLY_TO: String(targetId), FORGE_MSG_TYPE: 'challenge', FORGE_INTENT: 'challenge', FORGE_AUTHOR: 'william' },
  });
  // pendingParent = el challenge de William cuelga del mensaje objetivo: el
  // navegador pone ahí el fantasma, en su sitio exacto del árbol.
  res.status(202).json({ spawned: true, targetId, pendingParent: targetId, scope });
});

// ── acciones de Spike con scope (Stevens / Miyagi / Romina&Ariel) ────────────
// Mismas convenciones que /challenge: body {scope, targetId}; el mensaje del
// personaje cuelga del targetId. Sus prompts (puros) viven en forge-prompts.js.
function resolveTargetAndScope(req, chat) {
  const targetId = Number(req.body && req.body.targetId);
  const target = (chat.messages || []).find((m) => m.id === targetId);
  if (!target) {
    // Hilo de tarea aún sin mensajes: se actúa sobre la TAREA entera (su
    // definición, que buildThreadText ya inyecta como texto base). Scope 'conversacion'.
    if (chat.tareaId) return { target: null, targetId: null, scope: 'conversacion' };
    return { error: 'mensaje objetivo no encontrado' };
  }
  const scope = ACTION_SCOPES.includes(req.body && req.body.scope) ? req.body.scope : 'mensaje';
  return { target, targetId, scope };
}

// Stevens: audita el estado REAL del código (Investigar).
app.post('/api/chats/:id/investigar', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  const r = resolveTargetAndScope(req, chat);
  if (r.error) return res.status(400).json({ error: r.error });
  launchHeadless({
    chatId: id,
    prompt: stevensPrompt({ threadText: buildThreadText(id), focoText: buildFocoText(chat, r.target, r.scope), steer: req.body && req.body.steer, target: targetDesc() }),
    extraEnv: { FORGE_REPLY_TO: r.targetId == null ? '' : String(r.targetId), FORGE_MSG_TYPE: 'investigacion', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'stevens' },
  });
  res.status(202).json({ spawned: true, targetId: r.targetId, pendingParent: r.targetId, scope: r.scope });
});

// Mr. Miyagi: opinión honesta sobre qué buscamos (Consejo).
app.post('/api/chats/:id/consejo', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  const r = resolveTargetAndScope(req, chat);
  if (r.error) return res.status(400).json({ error: r.error });
  launchHeadless({
    chatId: id,
    prompt: miyagiPrompt({ threadText: buildThreadText(id), focoText: buildFocoText(chat, r.target, r.scope), steer: req.body && req.body.steer, target: targetDesc() }),
    extraEnv: { FORGE_REPLY_TO: r.targetId == null ? '' : String(r.targetId), FORGE_MSG_TYPE: 'consejo', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'miyagi' },
  });
  res.status(202).json({ spawned: true, targetId: r.targetId, pendingParent: r.targetId, scope: r.scope });
});

// Romina y Ariel: el dúo que discute, turno a turno (Discutir). UN solo mensaje:
// el front elige el AUTOR (romina|ariel) y el LADO (defiende|rechaza) — al azar la
// primera vez, y el OTRO con el lado contrario cuando el rey ya es de la pareja. El
// `stance` se persiste en el mensaje (FORGE_STANCE) para que el front sepa voltearlo.
app.post('/api/chats/:id/discutir', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  const r = resolveTargetAndScope(req, chat);
  if (r.error) return res.status(400).json({ error: r.error });
  const author = (req.body && req.body.author) === 'ariel' ? 'ariel' : 'romina';
  const stance = (req.body && req.body.stance) === 'rechaza' ? 'rechaza' : 'defiende';
  launchHeadless({
    chatId: id,
    prompt: discutirPrompt({
      threadText: buildThreadText(id),
      focoText: buildFocoText(chat, r.target, r.scope),
      stance, steer: req.body && req.body.steer,
    }),
    extraEnv: {
      FORGE_REPLY_TO: r.targetId == null ? '' : String(r.targetId), FORGE_MSG_TYPE: 'discusion',
      FORGE_INTENT: 'challenge', FORGE_AUTHOR: author, FORGE_STANCE: stance,
    },
  });
  res.status(202).json({ spawned: true, targetId: r.targetId, pendingParent: r.targetId, scope: r.scope, author, stance });
});

// Anselmo: resume el hilo en una nota (que luego llevará el botón COMPACTAR). Su
// nota cuelga del último mensaje (o del objetivo, si se le pasa).
app.post('/api/chats/:id/anselmo', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const msgs = chat.messages || [];
  let parent = null;
  if (req.body && req.body.targetId != null) {
    const pid = Number(req.body.targetId);
    if (msgs.some((m) => m.id === pid)) parent = pid;
  }
  if (parent == null && msgs.length) parent = msgs[msgs.length - 1].id;

  launchHeadless({
    chatId: id,
    prompt: anselmoPrompt({ threadText: buildThreadText(id), steer: req.body && req.body.steer }),
    extraEnv: { FORGE_REPLY_TO: parent == null ? '' : String(parent), FORGE_MSG_TYPE: 'resumen', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'anselmo' },
  });
  res.status(202).json({ spawned: true, pendingParent: parent });
});

// Compactar: colapsa la cadena que la nota de Anselmo resume, hasta la
// bifurcación más cercana, y reengancha la nota en su sitio. Reversible.
app.post('/api/chats/:id/compactar', (req, res) => {
  const id = req.params.id;
  const noteId = Number(req.body && req.body.noteId);
  if (!Number.isFinite(noteId)) return res.status(400).json({ error: 'falta noteId' });
  try {
    const chat = collapseUpToFork(ROOT, id, noteId);
    res.json({ chat });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Aubé: (re)entiende la tarea desde el hilo y escribe su mensaje ÚNICO y vivo. Si
// ya existe su mensaje, lo REEMPLAZA (FORGE_REPLACE_MSG_ID); la primera vez lo crea.
app.post('/api/chats/:id/aube', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const msgs = chat.messages || [];
  const existing = msgs.find((m) => m.author === 'aube');
  const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
  const extraEnv = existing
    ? { FORGE_REPLACE_MSG_ID: String(existing.id), FORGE_MSG_TYPE: 'tarea', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'aube' }
    : { FORGE_REPLY_TO: String(lastId), FORGE_MSG_TYPE: 'tarea', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'aube' };

  launchHeadless({ chatId: id, prompt: aubePrompt({ threadText: buildThreadText(id), steer: req.body && req.body.steer }), extraEnv });
  // si reemplaza, no hay fantasma nuevo (cambia in-place); si crea, cuelga del último.
  res.status(202).json({ spawned: true, replacing: !!existing, pendingParent: existing ? null : (lastId || null) });
});

// Tareas (columna derecha): listar y crear (Aprobar de Aubé).
// Cada tarea sale DECORADA con su estado/icono/subtareas computados desde las
// señales del ciclo (forge-estado.js) y la lista ya viene ORDENADA por cajón
// (revisar → en curso → por hacer → terminadas). El front solo pinta.
app.get('/api/tareas', (_req, res) => {
  res.json({ tareas: ordenarTareas(listTareas(ROOT)), grupos: TAREA_GRUPOS });
});

app.post('/api/tareas', (req, res) => {
  const { fromChat } = req.body || {};
  let { title, body } = req.body || {};
  let aubeText = null;
  // si no llega cuerpo pero sí un chat, lo saco del mensaje vivo de Aubé.
  if ((!body || !String(body).trim()) && fromChat) {
    const chat = readChat(ROOT, fromChat);
    const aube = (chat?.messages || []).find((m) => m.author === 'aube');
    if (aube) {
      aubeText = String(aube.text);
      const lines = aubeText.split('\n');
      if (!title) title = lines[0];
      body = lines.slice(1).join('\n').trim() || aube.text;
    }
  }
  if ((!title || !String(title).trim()) && (!body || !String(body).trim())) {
    return res.status(400).json({ error: 'no hay de qué crear la tarea (ni texto ni mensaje de Aubé)' });
  }
  // El cerebro de Aubé: si su mensaje trae un bloque ```subtareas y los carriles NO
  // se pisan, la tarea nace partida en paralelo; si colisionan (o no hay bloque),
  // troceaTarea devuelve la única `main` (default seguro). Probamos el cuerpo y el
  // texto crudo de Aubé por si el bloque quedó fuera del cuerpo recortado.
  let subtareas;
  const propuesta = parseSubtareasBloque(body) || parseSubtareasBloque(aubeText || '');
  if (propuesta) {
    const fallo = troceaTarea(propuesta);
    if (fallo.troceada) subtareas = fallo.subtareas;
  }
  try {
    res.status(201).json(createTarea(ROOT, { title, body, fromChat, subtareas }));
  } catch (e) {
    res.status(500).json({ error: 'no se pudo crear la tarea: ' + e.message });
  }
});

// ── la tarea como objeto vivo (F9b): abrir + editar su definición ────────────
// Abrir una tarea: asegura su HILO propio (lo crea perezosamente la 1ª vez) y
// devuelve la tarea con su threadId. El front pone la definición fija arriba y
// abre ese hilo en el centro.
app.post('/api/tareas/:id/open', (req, res) => {
  try {
    res.json(ensureTareaThread(ROOT, req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Editar a mano la DEFINICIÓN de la tarea (título y/o cuerpo del bloque fijo).
app.post('/api/tareas/:id/definicion', (req, res) => {
  const { title, body } = req.body || {};
  if ((title == null || !String(title).trim()) && body == null) {
    return res.status(400).json({ error: 'nada que cambiar' });
  }
  try {
    res.json(updateTareaDefinition(ROOT, req.params.id, { title, body }));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// EJECUTAR (F16): lanza a MIGUEL —el único con manos de escribir— a construir la
// tarea en un git WORKTREE AISLADO del repo objetivo (forge|project, según el flag
// del ciclo). No toca el árbol vivo. Miguel reporta en el hilo de la tarea por
// `contestar`. En Spike el worktree es desechable. (Limpieza del worktree y revisor
// de PR independiente = pendientes, ver backbone.)
app.post('/api/tareas/:id/ejecutar', (req, res) => {
  let tarea;
  try { tarea = ensureTareaThread(ROOT, req.params.id); }
  catch (e) { return res.status(404).json({ error: e.message }); }

  const repo = targetRoot();
  const stamp = Date.now();
  const branch = `miguel/tarea-${tarea.id}-${stamp}`;
  const wtPath = path.join(FORGE_DIR, '.wt', `miguel-t${tarea.id}-${stamp}`);
  // Miguel parte del ESTADO VIVO (lo que Tie ve), no del último commit: así su diff
  // aplica limpio al Traer aunque la sesión tenga cambios sin comitear. Si la foto
  // falla por lo que sea, cae a HEAD (comportamiento viejo).
  const base = snapshotLiveCommit(repo) || 'HEAD';
  const r = spawnSync('git', ['-C', repo, 'worktree', 'add', '-b', branch, wtPath, base], { encoding: 'utf8' });
  if (r.status !== 0) {
    return res.status(500).json({ error: 'no pude crear el worktree: ' + ((r.stderr || '').trim() || (r.error && r.error.message) || 'git falló') });
  }
  console.log(`[forge] worktree de la tarea ${tarea.id} parte del estado vivo (base ${base === 'HEAD' ? 'HEAD' : base.slice(0, 8)}).`);
  // recuerda el worktree Y LA BASE en la tarea → al traer, el delta completo del
  // arbolito (commits + cambios sueltos) se calcula contra esta base.
  try { setTareaBuild(ROOT, tarea.id, { worktree: wtPath, branch, repo, base }); } catch {}
  // re-Ejecutar empieza de cero: borra cualquier petó previo (icono ✕ rojo) y la
  // marca de "ya traída", para que el panel la pinte como ⏳ cogida otra vez.
  try { clearTareaError(ROOT, tarea.id); } catch {}

  // Mensaje VIVO de Miguel: nace ya en el hilo (placeholder) y se va reescribiendo
  // con el resumen en vivo (Haiku, cada 10s); su informe final lo REEMPLAZA encima
  // (FORGE_REPLACE_MSG_ID). Un solo mensaje que evoluciona — snapshot, no append.
  let liveMsg;
  try {
    liveMsg = appendMessage(ROOT, tarea.threadId, {
      type: 'build', author: 'miguel', intent: 'answer', replyTo: null,
      text: '🔨 Miguel está arrancando…',
    });
  } catch (e) { return res.status(500).json({ error: 'no pude crear el mensaje de Miguel: ' + e.message }); }

  const definicion = `${tarea.title}\n\n${tarea.body || ''}`.trim();
  launchHeadless({
    chatId: tarea.threadId,
    cwd: wtPath,
    allowedTools: 'Read,Write,Edit,Bash,Grep,Glob,mcp__forge__contestar',
    timeoutMs: 30 * 60 * 1000, // construir lleva más que charlar
    liveMsgId: liveMsg.id,     // resumen en vivo (Haiku) reescribe este mensaje
    prompt: miguelPrompt({
      threadText: buildThreadText(tarea.threadId),
      definicion,
      target: targetDesc(),
      steer: req.body && req.body.steer,
    }),
    // REPLACE: el informe final de Miguel reemplaza su propio mensaje vivo.
    // APPEND: el informe final de Miguel es un mensaje APARTE (cuelga del vivo), así
    // el resumen en vivo nunca lo pisa. El vivo se cierra "en pasado" al terminar.
    extraEnv: { FORGE_REPLY_TO: String(liveMsg.id), FORGE_MSG_TYPE: 'build', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'miguel' },
    // AUTO-MERGE: cuando Miguel TERMINA de construir bien, el último diente gira
    // solo — el forge trae todo el arbolito y lo sube a master sin que nadie pulse
    // "Traer". Si Miguel petó, no se trae nada (no hay build que subir). Serializado
    // por el mutex de merges; los conflictos van al revisor (reintento, tope 3).
    onDone: ({ failed }) => {
      if (failed) { console.log(`[forge] Miguel petó la tarea ${tarea.id}; no auto-merge.`); return; }
      console.log(`[forge] Miguel terminó la tarea ${tarea.id} → auto-merge a master.`);
      mergeTareaToMaster(tarea.id).catch((e) => console.error('[forge] auto-merge reventó:', e.message));
    },
  });
  console.log(`[forge] Ejecutar tarea ${tarea.id} → Miguel en worktree ${wtPath} (rama ${branch}).`);
  res.status(202).json({ spawned: true, worktree: wtPath, branch, threadId: tarea.threadId, liveMsgId: liveMsg.id });
});

// ¿Hay algo que TRAER de la tarea? (worktree existe + tiene cambios + no traída ya).
// El front lo usa para enseñar/deshabilitar el botón "Traer el código".
function buildStatus(tarea) {
  if (!tarea || !tarea.worktree || !fs.existsSync(tarea.worktree)) return { traible: false, reason: 'sin worktree' };
  // ya en master = cierre feliz: no hay nada más que traer.
  if (tarea.enMaster) return { traible: false, reason: 'ya en master' };
  // si petó el auto-merge (error sin llegar a master), el botón SIGUE vivo para
  // reintentar a mano. Solo bloqueamos cuando NO hay error y ya se trajo.
  if (tarea.brought && !tarea.error) return { traible: false, reason: 'ya traído' };
  return { traible: true };
}

app.get('/api/tareas/:id/traible', (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  res.json(buildStatus(tarea));
});

// Foto del ESTADO VIVO del repo (tracked modificado + ficheros nuevos sin
// trackear, respetando .gitignore) como un commit, SIN tocar el índice/HEAD reales
// (usa un índice temporal). Así el worktree de Miguel parte de lo que Tie VE ahora
// —no del último commit— y al Traer su diff aplica limpio (no choca con la sesión).
// Devuelve el sha del commit, o null si no se pudo (→ se cae a HEAD).
function snapshotLiveCommit(repo) {
  const tmpIndex = path.join(os.tmpdir(), `forge-idx-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    if (spawnSync('git', ['-C', repo, 'read-tree', 'HEAD'], { env, encoding: 'utf8' }).status !== 0) return null;
    if (spawnSync('git', ['-C', repo, 'add', '-A'], { env, encoding: 'utf8' }).status !== 0) return null;
    const tree = spawnSync('git', ['-C', repo, 'write-tree'], { env, encoding: 'utf8' });
    if (tree.status !== 0) return null;
    const c = spawnSync('git', ['-C', repo, 'commit-tree', tree.stdout.trim(), '-p', 'HEAD', '-m', 'forge: snapshot del estado vivo'], { env, encoding: 'utf8' });
    if (c.status !== 0) return null;
    return c.stdout.trim();
  } catch { return null; }
  finally { try { fs.unlinkSync(tmpIndex); } catch {} }
}

// ── el ÚLTIMO diente: traer-todo + commit a master (motor determinista) ──────
// El cierre de una tarea ya no se queda en el arbolito: el delta COMPLETO del
// worktree (commits de la rama + cambios sueltos) se aplica al árbol vivo del repo
// objetivo y se COMMITEA a master. Conflicto → revisor → reintento (tope 3) →
// si no entra, ERROR. Todo serializado por un mutex (forge.js es un proceso).
// El motor PURO vive en scripts/lib/forge-merge.js (testable sin servidor); aquí
// solo le inyectamos sus manos (git real, store real, revisor-Claude real).

// El revisor real: lanza un headless que resuelve los marcadores y espera (promesa)
// a que termine. El motor verifica DESPUÉS (grep de marcadores) si de verdad cerró.
function spawnRealReviewer({ tarea, repo, ficheros }) {
  return new Promise((resolve) => {
    const repoDesc = repo === PROJECT_ROOT ? 'Neblla, el producto (project/)' : 'el forge (raíz del repo)';
    let t2;
    try { ensureTareaThread(ROOT, tarea.id); t2 = readTarea(ROOT, tarea.id); }
    catch { resolve(false); return; }
    let liveMsg;
    try {
      liveMsg = appendMessage(ROOT, t2.threadId, {
        type: 'merge', author: 'revisor', intent: 'answer', replyTo: null,
        text: '🔀 Hubo conflictos al subir a master. El revisor los está resolviendo…',
      });
    } catch { resolve(false); return; }
    launchHeadless({
      chatId: t2.threadId,
      cwd: repo,
      allowedTools: 'Read,Write,Edit,Bash,Grep,Glob,mcp__forge__contestar',
      timeoutMs: 15 * 60 * 1000,
      liveMsgId: liveMsg.id,
      prompt: mergeReviewerPrompt({ definicion: `${t2.title}\n\n${t2.body || ''}`.trim(), repoDesc, ficheros }),
      extraEnv: { FORGE_REPLY_TO: String(liveMsg.id), FORGE_MSG_TYPE: 'merge', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'revisor' },
      onDone: () => resolve(true),
    });
  });
}

const { mergeTareaToMaster } = createMergeEngine({
  spawnSync,
  readTarea: (id) => readTarea(ROOT, id),
  resolveRepo: (tarea) => (tarea.buildRepo && fs.existsSync(tarea.buildRepo) ? tarea.buildRepo : targetRoot()),
  markBrought: (id) => { try { markTareaBrought(ROOT, id); } catch {} },
  markEnMaster: (id, commit) => { try { markTareaEnMaster(ROOT, id, commit); } catch {} },
  markError: (id, msg) => { try { setTareaError(ROOT, id, msg); } catch {} },
  runReviewer: spawnRealReviewer,
  log: (m) => console.log('[forge] ' + m),
  errlog: (m) => console.error('[forge] ' + m),
});

// TRAER el código (botón MANUAL, y el mismo camino que dispara el auto-merge):
// trae el delta COMPLETO del arbolito al árbol vivo y lo COMMITEA a master. Si hay
// conflicto, el revisor lo resuelve y reintenta; si no entra tras 3, queda en error.
app.post('/api/tareas/:id/traer', async (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  if (!tarea.worktree || !fs.existsSync(tarea.worktree)) {
    return res.status(400).json({ error: 'esta tarea no tiene worktree de Miguel (¿la ejecutaste?)' });
  }
  let result;
  try { result = await mergeTareaToMaster(tarea.id); }
  catch (e) { return res.status(500).json({ error: 'el merge a master reventó: ' + e.message }); }

  if (result.ok && result.enMaster) return res.json({ applied: true, enMaster: true, repo: result.repo, commit: result.commit });
  if (result.ok && result.empty)   return res.json({ applied: false, empty: true, message: result.message });
  if (result.incompatible) {
    return res.status(409).json({
      applied: false, incompatible: true,
      error: 'El código de Miguel no encaja con tu árbol actual (se construyó sobre una base '
        + 'distinta). No se aplicó nada. Vuelve a pulsar Ejecutar para reconstruirlo sobre el '
        + 'estado actual y luego Traer.',
    });
  }
  return res.status(409).json({ applied: false, error: result.error || 'no se pudo subir a master' });
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
    // barre también los dirs-lock huérfanos (.NNN.lock) que pudieran quedar.
    else if (/^\.\d+\.lock$/.test(f)) { try { fs.rmdirSync(path.join(chatsDir(ROOT), f)); } catch {} }
  }
}

app.post('/api/cycle/new', (req, res) => {
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

  // Empezar un ciclo nuevo REBOBINA el carril a Spike (cursor 0, sin pausa). Es el
  // único momento en que el objetivo (forge/producto) puede fijarse libremente: el
  // body opcional `target` viaja aquí para que el cambio sea atómico con el reinicio.
  // (Mid-ciclo el endpoint /api/cycle/target está bloqueado a Spike — ver allí.)
  const reset = cycle.normalize({ ...loadCycle(), cursor: 0, paused: false });
  const target = req.body && req.body.target;
  writeCycle(ROOT, target ? cycle.setTarget(reset, target) : reset);

  wipeChats();
  const chat = createChat(ROOT, { type: 'backlog', title: 'backlog' });
  launchHeadless({
    chatId: chat.id,
    prompt: backlogOpenerPrompt(),
    extraEnv: { FORGE_MSG_TYPE: 'backlog', FORGE_INTENT: 'opener' }, // sin replyTo → apertura
  });
  res.status(201).json({ chat, spawned: true });
});

// Bootstrap: si no hay NINGUNA conversación, crea la primera y lanza a Iris a
// abrirla explicando lo que hay pendiente (mismo opener del backlog, pero SIN
// borrar nada ni exigir el producto limpio). Si ya hay alguna, no crea otra.
app.post('/api/chats/bootstrap', (_req, res) => {
  const existing = listChats(ROOT);
  if (existing.length) {
    return res.json({ chat: existing[existing.length - 1], spawned: false });
  }
  const chat = createChat(ROOT, { type: 'backlog', title: 'backlog' });
  launchHeadless({
    chatId: chat.id,
    prompt: backlogOpenerPrompt(),
    extraEnv: { FORGE_MSG_TYPE: 'backlog', FORGE_INTENT: 'opener' },
  });
  res.status(201).json({ chat, spawned: true });
});

// Renombrar una conversación a mano (clic en el título). body {title}.
app.post('/api/chats/:id/title', (req, res) => {
  const title = req.body && req.body.title;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'falta el título' });
  if (!readChat(ROOT, req.params.id)) return res.status(404).json({ error: 'conversación no encontrada' });
  try {
    res.json({ chat: renameChat(ROOT, req.params.id, String(title)) });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo renombrar: ' + e.message });
  }
});

// Varita: la máquina lee el hilo y bautiza la conversación con un nombre corto.
app.post('/api/chats/:id/autoname', async (req, res) => {
  if (!readChat(ROOT, req.params.id)) return res.status(404).json({ error: 'conversación no encontrada' });
  const title = await generateTitle(req.params.id);
  if (!title) return res.status(500).json({ error: 'no se pudo generar el nombre' });
  try {
    res.json({ chat: renameChat(ROOT, req.params.id, title), title });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo guardar el nombre: ' + e.message });
  }
});

// ── ciclo + transporte (la forja conduce el ciclo) ───────────────────────────
// Estado persistente en sprint/cycle.json; la lógica de fases vive en
// forge-firme.js (pura). El navegador pinta la miga de pan con GET /api/cycle y
// mueve el cursor con los 4 POST (avanzar/retroceder/pausar/reanudar).
function loadCycle() {
  return cycle.normalize(readCycle(ROOT) || cycle.DEFAULT_CYCLE);
}

app.get('/api/cycle', (_req, res) => {
  res.json(cycle.publicState(loadCycle()));
});

// Avanzar es SOFT: pura navegación, NUNCA destruye. El borrado del taller (las
// conversaciones efímeras del Spike) ya NO cuelga de aquí — vive con su guardián
// fuerte en "Nuevo ciclo" (POST /api/cycle/new). Así Avanzar mueve sin sustos.
app.post('/api/cycle/advance', (_req, res) => {
  const next = cycle.advance(loadCycle());
  res.json(cycle.publicState(writeCycle(ROOT, next)));
});

app.post('/api/cycle/back', (_req, res) => {
  res.json(cycle.publicState(writeCycle(ROOT, cycle.back(loadCycle()))));
});
app.post('/api/cycle/pause', (_req, res) => {
  res.json(cycle.publicState(writeCycle(ROOT, cycle.pause(loadCycle()))));
});
app.post('/api/cycle/resume', (_req, res) => {
  res.json(cycle.publicState(writeCycle(ROOT, cycle.resume(loadCycle()))));
});

// OBJETIVO del ciclo (forge | project): sobre QUÉ se trabaja, uno por ciclo,
// NUNCA los dos a la vez. Lo sabrán todos los personajes (Miguel/Stevens/Miyagi).
// Se fija antes de arrancar el sprint. Por defecto 'forge'.
app.post('/api/cycle/target', (req, res) => {
  // BLOQUEO: el objetivo solo se cambia "en caliente" cuando estamos en un ciclo
  // nuevo (fase Spike, cursor 0). En cualquier otra fase el selector está cerrado
  // para no cambiar de forge/producto a mitad de un ciclo en curso. Para cambiarlo
  // hay que empezar un Nuevo ciclo (POST /api/cycle/new, que sí acepta `target`).
  const cur = loadCycle();
  if (cycle.phaseKey(cur) !== 'spike') {
    return res.status(409).json({
      error: 'El objetivo (forge/producto) solo se puede cambiar en un Nuevo ciclo (fase Spike). '
        + 'Empieza un ciclo nuevo para cambiarlo.',
      phase: cycle.phaseKey(cur),
    });
  }
  const target = req.body && req.body.target;
  res.json(cycle.publicState(writeCycle(ROOT, cycle.setTarget(cur, target))));
});

// DEPRECADO: el viejo "modo sprint" (lo sustituye el transporte del ciclo). Se
// mantiene mientras el front migra a /api/cycle/*; el cruce real borra en advance.
app.post('/api/sprint/try', (_req, res) => {
  try {
    wipeChats();
    console.log('[forge] (deprecado) sprint/try: conversaciones borradas.');
    res.json({ ok: true, wiped: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'no se pudieron borrar las conversaciones: ' + e.message });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Forge en ${url}`);
  openBrowser(url);
});
