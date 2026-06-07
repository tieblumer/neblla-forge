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
  replaceMessageText, deleteMessage, collapseUpToFork, listTareas, createTarea, renameChat,
  readCycle, writeCycle, readTarea, ensureTareaThread, updateTareaDefinition,
  setTareaBuild, markTareaBrought, markTareaConstruido, markTareaEnMaster, setTareaError, clearTareaError, readModel, writeModel,
  sweepLiveBuilds, markTareaInterrumpido, setTareaComplejidad,
  stampMessageCost, setMessageLive, setLiveBeat, setTareaPlan, approveTareaPlan, setTareaSubtareas, setTareaTestsPlan,
  mutateTestsPlan,
  stubMessageForTarea, restoreStubbedMessage, deleteTarea, resolveOrigen,
} from './lib/forge-store.js';
import * as cycle from './lib/forge-firme.js';
import { ordenar as ordenarTareas, GRUPOS as TAREA_GRUPOS, pasoConversacion } from './lib/forge-estado.js';
import { createMergeEngine } from './lib/forge-merge.js';
import {
  charlaPrompt, williamChallengePrompt, anselmoPrompt, aubePrompt,
  stevensPrompt, miyagiPrompt, discutirPrompt, miguelPrompt, mergeReviewerPrompt,
  parseSubtareasBloque, anaLizPlanPrompt, anaLizEscribirPrompt,
} from './lib/forge-prompts.js';
import { troceaTarea } from './lib/forge-trocear.js';
import { parsePlanBloque, normalizarPlan, validarPlan, planAPropuestaSubtareas, complejidadEfectiva, COMPLEJIDADES } from './lib/forge-plan.js';
import { parseTestsBloque, normalizarTestsPlan, fusionarTests, quitarTemporales, REF_GENERAL, aplicarResultadosCorrida, ensamblarTestFile } from './lib/forge-tests.js';
import { sellarTestIds, testIdsParaSubtarea } from './lib/forge-testids.js';
import { resolveProjectRoot } from './lib/target.js';
import { logTokenUsage, extractUsage, parseCliResult, readTokenLog, summarizeRun, chooseCostTargets } from './lib/forge-token-log.js';
import { listPeople, readPerson, writePerson, findByRol } from './lib/forge-people.js';
import {
  trackStart, trackEnd, activeCount, scheduleRestart, setOnDrained, statusShort, statusFull,
} from './lib/forge-shutdown.js';

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
const FORGE_MD = path.join(FORGE_DIR, 'public', 'forge', 'forge-md.js');
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

// ── catálogo de PERMISOS (todo lo posible) — lo consume el modal de permisos ──
// LEE es de UNA opción (nivel de lectura); ESCRIBE y HERRAMIENTAS son de varias.
// HERRAMIENTAS = las herramientas MCP que define scripts/forge-mcp.js; sirve además
// de lista de referencia para citarlas en la descripción de un personaje.
const LEE_OPCIONES = [
  { value: 'nada',     label: 'nada' },
  { value: 'backbone', label: 'solo el backbone' },
  { value: 'codigo',   label: 'solo el código' },
  { value: 'todo',     label: 'todo' },
];
const ESCRIBE_OPCIONES = [
  { value: 'codigo',   label: 'código' },
  { value: 'planes',   label: 'planes' },
  { value: 'tests',    label: 'tests' },
  { value: 'backbone', label: 'backbone (docs)' },
];
const HERRAMIENTAS_MCP = [
  { value: 'contestar', label: 'contestar', desc: 'escribir su respuesta en el hilo (todos la tienen)' },
  { value: 'preguntar', label: 'preguntar', desc: 'hacer una pregunta a Tie y esperar respuesta' },
  { value: 'backbone_resumen', label: 'backbone_resumen', desc: 'leer el resumen del backbone (backbone_mini.md)' },
  { value: 'backbone_completo', label: 'backbone_completo', desc: 'leer el backbone completo (backbone.md)' },
  { value: 'leer_feature', label: 'leer_feature', desc: 'listar features y leer una en detalle' },
  { value: 'proponer_plan', label: 'proponer_plan', desc: 'entregar el plan de implementación como datos (Aubé)' },
  { value: 'definir_tests', label: 'definir_tests', desc: 'redactar los tests en papel (dado/cuando/entonces) directo en la tarea (Ana Liz)' },
  { value: 'escribir_test', label: 'escribir_test', desc: 'convertir las definiciones en tests de código reales con su ID (Ana Liz)' },
  { value: 'correr_tests', label: 'correr_tests', desc: 'correr la batería de la tarea en el worktree e iterar (Miguel)' },
];
const ESCRIBE_VALUES = new Set(ESCRIBE_OPCIONES.map((o) => o.value));
const LEE_VALUES = new Set(LEE_OPCIONES.map((o) => o.value));
const HERR_VALUES = new Set(HERRAMIENTAS_MCP.map((o) => o.value));

// El alias guardado, saneado (uno de la lista, o '' si no hay/!válido).
function currentModel() {
  const m = readModel(ROOT);
  return MODEL_VALUES.has(m) ? m : '';
}

// Modelo RESUELTO de un empleado por su slug (= FORGE_AUTHOR): su `modelo` de
// people/<slug>.json manda; si lo deja vacío ("Por defecto"), hereda el selector
// GLOBAL; y si tampoco hay, el default del CLI. Así cada uno puede ir fijo (Miguel
// → sonnet) sin tocar a los demás, y el selector global sigue de red para el resto.
function modelFor(author) {
  const p = author ? findByRol(FORGE_DIR, author) : null;
  const m = (p && MODEL_VALUES.has(p.modelo)) ? p.modelo : currentModel();
  return m || '';
}

// La VOZ de un empleado: su `descripcion` de people/<slug>.json — el párrafo de
// apertura que forge-prompts.js usa como instrucción real. '' si no hay ficha (la
// función de prompt cae entonces a su voz por defecto). Editar el perfil cambia esto.
function vozDe(author) {
  const p = author ? findByRol(FORGE_DIR, author) : null;
  return p ? p.descripcion : '';
}

// Las herramientas REALES (--allowedTools) que recibe un empleado al lanzarse, DERIVADAS
// de su perfil people/*.json — así el scope y las herramientas mandan de verdad:
//   • leer (≠ 'nada')        → Read, Grep, Glob (ver el código)
//   • escribir incluye codigo → Write, Edit, Bash (manos de escribir ficheros)
//   • herramientas MCP        → mcp__forge__<cada una> (contestar / preguntar…)
// Si el empleado no tiene ficha, una base segura de solo lectura + contestar.
function allowedToolsFor(author) {
  const p = author ? findByRol(FORGE_DIR, author) : null;
  if (!p) return 'Read,Grep,Glob,mcp__forge__contestar';
  const tools = [];
  const lee = Array.isArray(p.scope.lee) ? (p.scope.lee.length ? 'algo' : 'nada') : p.scope.lee;
  if (lee && lee !== 'nada') tools.push('Read', 'Grep', 'Glob');
  if ((p.scope.escribe || []).includes('codigo')) tools.push('Write', 'Edit', 'Bash');
  for (const t of (p.herramientas || [])) tools.push('mcp__forge__' + t);
  return tools.join(',');
}

// Lo que se intercala en los args del lanzamiento de claude: ['--model', alias] o []
// si queda en "Por defecto" (ni la persona ni el global fijan modelo).
function modelArgs(author) {
  const m = modelFor(author);
  return m ? ['--model', m] : [];
}

// Etiqueta legible del modelo de un empleado, para el log de tokens.
function modelLabel(author) {
  return modelFor(author) || '(por defecto del CLI)';
}

// ── el EMBUDO ÚNICO de headless ──────────────────────────────────────────────
// Todo claude del forge (charla, varita, resumen en vivo…) NACE aquí: este es el
// único lanzamiento directo de claude de todo el fichero. trackStart cuenta el hijo (+1)
// ANTES de spawnear y RECHAZA con Error('shutting down') si la forja está
// drenando (así no nace ningún proceso). trackEnd lo descuenta (−1) en su
// exit/error. De ese modo el contador es la verdad, venga el claude de donde venga.
function spawnClaude(args, opts = {}, meta = {}) {
  const agentId = trackStart(meta);   // +1; lanza 'shutting down' si drena
  let child;
  try {
    child = spawn('claude', args, opts);
  } catch (e) { trackEnd(agentId); throw e; }
  const done = () => trackEnd(agentId);
  child.on('exit', done);
  child.on('error', done);
  return child;
}

// ── el headless de charla (suscripción, SIN API key) ─────────────────────────
// Patrón de mesa.js/sprint.js: lanzar claude con un ARRAY de args (sin
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

// Builds EN VIVO ahora mismo: liveMsgId → { resumir(), chatId }. El resumen ya NO
// se relanza solo cada 10s (era la fuga de tokens): se hace A DEMANDA cuando Tie
// pulsa "📸 Resumir" en el mensaje vivo, que llama al endpoint /resumir-build.
const LIVE_BUILDS = new Map();

// Cerrojo anti-duplicados: qué personajes están EN VUELO ahora mismo, por chat.
// Clave = `${autor}:${chatId}`. Evita que un doble clic (o las dos sesiones de Tie)
// lancen dos veces el mismo personaje sobre el mismo hilo. Se libera al terminar.
const headlessInFlight = new Set();
function inFlightAuthors(chatId) {
  const suf = ':' + String(chatId);
  return [...headlessInFlight].filter((k) => k.endsWith(suf)).map((k) => k.slice(0, -suf.length));
}

// Lanza un headless conversacional (solo-lectura + MCP contestar). `extraEnv`
// fija tipo/intención/replyTo/autor del mensaje que escribirá.
function launchHeadless({
  chatId, prompt, extraEnv = {},
  cwd = FORGE_DIR,
  allowedTools = null,   // null = DERIVAR del perfil del autor (allowedToolsFor); string = override explícito
  timeoutMs = HEADLESS_TIMEOUT_MS,
  liveMsgId = null,   // si viene: stream-json + resumen Haiku que REESCRIBE este mensaje cada 10s
  onDone = null,      // si viene: callback({ failed, reported, code, signal }) al salir el headless
  inFlightKey = null, // si viene: se libera de headlessInFlight al terminar (o si no arranca)
}) {
  const releaseInFlight = () => { if (inFlightKey) headlessInFlight.delete(inFlightKey); };
  const cfg = {
    mcpServers: {
      forge: {
        command: 'node',
        args: [MCP_PATH],
        env: { FORGE_ROOT: ROOT, FORGE_CHAT_ID: String(chatId), FORGE_OBJETIVO: cycleTarget(), ...extraEnv },
      },
    },
  };
  const cfgPath = path.join(os.tmpdir(), `forge-mcp-${process.pid}-${Date.now()}-${chatId}.json`);
  try { fs.writeFileSync(cfgPath, JSON.stringify(cfg)); }
  catch (e) { console.error('[forge] no pude escribir el mcp-config:', e.message); releaseInFlight(); return; }

  const live = liveMsgId != null;
  const who = extraEnv.FORGE_AUTHOR || 'headless';
  // herramientas REALES: el override explícito si vino, si no las DERIVADAS del perfil.
  const toolsResolved = allowedTools != null ? allowedTools : allowedToolsFor(who);
  // scope.preguntar (real): si está marcado, se le pide PREGUNTAR antes de actuar.
  const persona = findByRol(FORGE_DIR, who);
  const promptFinal = (persona && persona.scope && persona.scope.preguntar)
    ? prompt + '\n\nIMPORTANTE: antes de actuar o decidir, si tienes CUALQUIER duda, '
      + 'PREGUNTA a Tie con la herramienta `preguntar` y espera su respuesta antes de seguir.'
    : prompt;
  // El prompt va por STDIN, NO como argumento: en Windows un argumento de línea de
  // comandos tiene un tope (~32 KB) y un hilo largo + la diana lo cruzaban → `spawn`
  // moría con ENAMETOOLONG. Por stdin no hay límite. `claude -p` lee stdin como prompt.
  const args = [
    '-p',
    ...modelArgs(who),   // modelo POR PERSONA (people/<who>.json) → global → default
    '--allowedTools', toolsResolved,
    '--mcp-config', cfgPath,
    // SOLO el servidor forge: ignora los MCP globales (Neblla, Google…). El
    // headless no debe ver más herramientas que las de su oficio, y así el
    // servidor `contestar` conecta de forma fiable (sin contaminación ambiental).
    '--strict-mcp-config',
    // con resumen en vivo, pedimos el stream para leer lo que va diciendo Miguel.
    // sin resumen, pedimos el JSON final → trae `usage`/`total_cost_usd` (coste REAL
    // que reporta el propio CLI) para el contador de tokens, sin estimar nada.
    ...(live ? ['--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
  ];

  // runId: identifica TODO el gasto de este spawn (el personaje + cada resumen en
  // vivo que corrió mientras trabajaba). Cada fila del log lo lleva → la chapa de
  // un mensaje y su modal de detalle filtran por él.
  const runId = `${chatId}-${who}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const countMine = () => {
    try { return (readChat(ROOT, chatId)?.messages || []).filter((m) => m.author === who).length; }
    catch { return 0; }
  };
  // ids de mis mensajes ANTES de arrancar: los que aparezcan por encima son los
  // que produjo este run (se estampan con el coste al salir).
  const idsBefore = () => {
    try { return (readChat(ROOT, chatId)?.messages || []).filter((m) => m.author === who).map((m) => m.id); }
    catch { return []; }
  };
  const before = countMine();
  const beforeIds = idsBefore();
  // coste acumulado de los resúmenes en vivo (Haiku) que corren durante la build:
  // forma parte de lo que costó producir el mensaje final de Miguel.
  let liveCostSum = 0;
  const startedAt = Date.now();
  let timedOut = false;
  let stderrTail = '';
  console.log(`[forge] ${who} arranca (chat ${chatId}, cwd ${cwd}${live ? ', resumen en vivo' : ''}).`);

  // El proceso `claude` NO arrancó (spawn lanzó, o emitió 'error' sin llegar a salir):
  // libera el cerrojo, limpia el cfg y —si había mensaje vivo— lo CIERRA con el aviso
  // (antes se quedaba "arrancando…" eterno, sin avisar en la UI). Idempotente.
  let lanzamientoFallido = false;
  const fallaAlLanzar = (motivo) => {
    if (lanzamientoFallido) return;
    lanzamientoFallido = true;
    releaseInFlight();
    try { fs.unlinkSync(cfgPath); } catch {}
    if (live && liveMsgId != null) {
      try { LIVE_BUILDS.delete(String(liveMsgId)); } catch {}
      try { marcarBuildInterrumpido(chatId, liveMsgId, who, 'no pude lanzar el proceso — ' + motivo); } catch {}
    }
  };

  let child;
  // usageRaw: el objeto-resultado del CLI con `usage`/`total_cost_usd`. En vivo se
  // captura del evento `result` del stream; sin vivo, parseando el JSON final.
  let usageRaw = null;
  let jsonOut = '';   // acumula el stdout en modo no-vivo (un único JSON al final)
  try {
    // stdout: 'pipe' SIEMPRE — en vivo para leer el stream y el `result`; sin vivo
    // para capturar el JSON final con el coste. stderr: 'pipe' para guardar fallos.
    child = spawnClaude(args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }, { who, chatId });
  } catch (e) {
    console.error('[forge] no pude lanzar el headless (`claude`):', e.message);
    fallaAlLanzar(e.message);
    return;
  }

  // entrega el prompt por stdin y cierra la entrada (claude -p lo lee y arranca).
  if (child.stdin) {
    child.stdin.on('error', () => {});   // si claude muere antes de leerlo, ignora el EPIPE
    try { child.stdin.write(promptFinal); child.stdin.end(); }
    catch (e) { console.error('[forge] no pude escribir el prompt por stdin:', e.message); fallaAlLanzar(e.message); return; }
  }

  if (child.stderr) {
    child.stderr.on('data', (d) => {
      const s = d.toString();
      process.stderr.write(s);
      stderrTail = (stderrTail + s).slice(-2000); // últimos ~2 KB, para el aviso
    });
  }

  // Sin resumen en vivo, el stdout es un único JSON (`--output-format json`): lo
  // acumulamos para sacar el coste al cerrar. (En vivo lo lee el bloque de abajo.)
  if (!live && child.stdout) {
    child.stdout.on('data', (d) => { jsonOut += d.toString(); });
  }

  // ── resumen A DEMANDA: acumulamos el stream de lo que va diciendo Miguel; el
  // resumen Haiku se genera SOLO cuando Tie pulsa "📸 Resumir" en el mensaje vivo
  // (endpoint /resumir-build → entry.resumir()). Antes esto corría solo cada 10s
  // durante toda la build: era la mayor fuga de tokens (auditoría tarea 013).
  let finished = false;
  let transcript = '';
  let resumiendo = false;
  let lastAction = '';            // última acción legible del stream (para el latido)
  let lastActivityAt = startedAt; // cuándo se vio la última señal de vida
  let manualSummary = '';         // el resumen Haiku bajo demanda (📸), si lo hubo
  let heartbeat = null;
  const liveLabel = who === 'revisor' ? 'El revisor está resolviendo'
    : who === 'analiz' ? 'Ana Liz está escribiendo los tests'
    : who === 'aube' ? 'Aubé está replanteando'
    : 'Miguel está construyendo';
  const liveIcon = who === 'analiz' ? '⌨️' : who === 'aube' ? '✦' : '🔨';
  const livePrefix = `${liveIcon} ${liveLabel}…`;   // marca del mensaje-latido
  if (live && child.stdout) {
    // re-pinta el mensaje vivo: cabecera + LATIDO (gratis, sin LLM) + resumen si lo hay.
    // GUARDA: si el agente ya REEMPLAZÓ el mensaje vivo con su contenido final (modo
    // REPLACE, p.ej. Aubé escribe su plan ahí), su texto ya NO empieza por nuestra
    // marca → dejamos de pintar para no pisárselo.
    const render = () => {
      if (finished) return;
      try {
        const cur = (readChat(ROOT, chatId)?.messages || []).find((m) => m.id === Number(liveMsgId));
        if (cur && cur.text && !cur.text.startsWith(liveIcon)) return;   // el agente tomó el control
      } catch {}
      // el texto NO lleva el "hace Xs" (sería un número congelado): lleva la última
      // acción. El TIEMPO va como timestamps (liveStartedAt/livePingAt) y el navegador
      // calcula "arrancado a las HH:MM · último ping hace Xs" tickeando cada segundo.
      const txt = `${livePrefix}` + (lastAction ? ` · ${lastAction}` : '') + (manualSummary ? `\n\n${manualSummary}` : '');
      try { setLiveBeat(ROOT, chatId, liveMsgId, { text: txt, startedAt, pingAt: lastActivityAt }); } catch {}
    };
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const t = line.trim();
        if (t.startsWith('{') && t.includes('"result"')) {
          try { const obj = JSON.parse(t); if (obj && obj.type === 'result') usageRaw = obj; } catch {}
        }
        const piece = readableFromStreamLine(t);
        if (piece) {
          transcript = (transcript + '\n' + piece).slice(-12000);
          lastAction = piece.replace(/\s+/g, ' ').trim().slice(0, 90);
          lastActivityAt = Date.now();
        }
      }
    });
    // LATIDO: cada 10s re-pinta el "vivo, hace Xs" — coste CERO (solo escribe a disco,
    // ningún modelo). Reemplaza el viejo resumen Haiku automático (que era la fuga).
    heartbeat = setInterval(render, 10 * 1000);
    setTimeout(render, 1200);   // un primer latido pronto
    // resumir(): bajo demanda (botón 📸) — ESTE sí llama a Haiku. Convive con el latido.
    const resumir = async () => {
      if (finished) return { note: 'ya terminó' };
      if (resumiendo) return { note: 'ya estoy resumiendo, espera un momento' };
      const snap = transcript.trim();
      if (!snap) return { note: 'todavía no hay avance que resumir' };
      resumiendo = true;
      try {
        const res = await runHaikuSummary(snap, { chatId, forWho: who, runId });
        if (res && res.costUsd != null) liveCostSum += Number(res.costUsd) || 0;
        if (res && res.text) { manualSummary = res.text; render(); }
        return { text: (res && res.text) || null };
      } finally { resumiendo = false; }
    };
    // guardamos el PID y el autor: el vigilante de builds (abajo) comprueba con ellos
    // si un build "sin señal" tiene aún proceso vivo o se cortó sin disparar su exit.
    LIVE_BUILDS.set(String(liveMsgId), { resumir, chatId: String(chatId), pid: child.pid, author: who });
  }

  // ¿el agente está ESPERANDO respuesta a una pregunta suya? (mensaje 'pregunta' de
  // `who` sin un 'tie' que le cuelgue). Si es así, no lo matamos: le damos prórroga.
  const waitingOnQuestion = () => {
    try {
      const msgs = (readChat(ROOT, chatId)?.messages) || [];
      const preguntas = msgs.filter((m) => m.author === who && m.type === 'pregunta');
      if (!preguntas.length) return false;
      const ultima = preguntas[preguntas.length - 1];
      const contestada = msgs.some((m) => m.author === 'tie' && Number(m.replyTo) === Number(ultima.id));
      return !contestada;
    } catch { return false; }
  };
  const QUESTION_GRACE_MS = 35 * 60 * 1000; // algo más que el plazo del MCP (30 min)
  let timer;
  const onTimeout = () => {
    // mientras espere una respuesta (y dentro del tope), prorroga en vez de matar.
    if (waitingOnQuestion() && (Date.now() - startedAt) < timeoutMs + QUESTION_GRACE_MS) {
      timer = setTimeout(onTimeout, 60 * 1000); // revisa cada minuto
      return;
    }
    timedOut = true;
    console.error(`[forge] ${who} agotó el tiempo (${Math.round(timeoutMs / 60000)} min), lo mato.`);
    try { child.kill('SIGKILL'); } catch {}
  };
  timer = setTimeout(onTimeout, timeoutMs);

  child.on('error', (e) => {
    console.error(`[forge] error lanzando ${who}:`, e.message);
    // si el proceso ni siquiera salió (ENOENT, etc.), cierra el mensaje vivo con el aviso.
    if (!finished) fallaAlLanzar(e.message);
  });
  child.on('exit', (code, signal) => {
    finished = true;
    if (lanzamientoFallido) return;   // 'error' ya cerró el mensaje vivo; no dupliques
    releaseInFlight();   // libera el cerrojo: este personaje ya no está en vuelo
    clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    if (live) { LIVE_BUILDS.delete(String(liveMsgId)); try { setMessageLive(ROOT, chatId, liveMsgId, false); } catch {} }
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const failed = timedOut || code !== 0;
    // el informe final es un mensaje APARTE: 'reportó' = creció el nº de mensajes
    // suyos por encima del que ya tenía (el vivo). Vale para todos los modos.
    const reported = countMine() > before;
    console.log(`[forge] ${who} salió (code=${code}, signal=${signal || '-'}, ${secs}s, reportó=${reported}).`);

    // ── contador de tokens: una línea por personaje, con el coste REAL del CLI ──
    if (!live) { usageRaw = parseCliResult(jsonOut, { stream: false }); }
    const usage = extractUsage(usageRaw);
    if (usage.costUsd != null) {
      console.log(`[forge] ${who}: ${usage.costUsd} USD (in ${usage.inputTokens}, out ${usage.outputTokens}, cache-read ${usage.cacheReadTokens}).`);
    }
    logTokenUsage(ROOT, {
      spawn: live ? 'launchHeadless (vivo)' : 'launchHeadless',
      agente: who,
      runId,                             // une este personaje con sus resúmenes en vivo
      permisos: toolsResolved,           // las herramientas que se le concedieron (derivadas del perfil)
      // el modelo REAL que corrió (lo reporta el CLI); si no se sabe, la etiqueta
      // configurada (selector/perfil). Así el relatorio dice qué modelo se usó de verdad.
      modelo: usage.modeloReal || modelLabel(who),
      modeloConfig: modelLabel(who),
      chatId: String(chatId),
      promptChars: prompt.length,
      promptBytes: Buffer.byteLength(prompt, 'utf8'),
      textoEntrada: prompt,
      durationSecs: secs,
      code, signal: signal || null, failed,
      ...usage,
    });

    // ── estampar el coste en los mensajes (la chapa $ de la UI) ────────────────
    // El coste total del run = el del personaje + el de TODOS sus resúmenes en
    // vivo. Lo estampamos en cada mensaje nuevo de `who` (todos llevan runId+cost),
    // y marcamos costPrimary en UNO solo → una sola chapa visible: el informe final
    // si reportó, si no el mensaje vivo. Best-effort: nunca tumba el exit.
    try {
      const totalCostUsd = (usage.costUsd == null && liveCostSum === 0)
        ? null
        : (Number(usage.costUsd) || 0) + liveCostSum;
      const usageFound = usage.usageFound === true || liveCostSum > 0;
      let mineNow = [];
      try { mineNow = (readChat(ROOT, chatId)?.messages || []).filter((m) => m.author === who).map((m) => m.id); }
      catch {}
      const replacedId = extraEnv.FORGE_REPLACE_MSG_ID ? Number(extraEnv.FORGE_REPLACE_MSG_ID) : null;
      const { newIds, primaryId } = chooseCostTargets({ beforeIds, mineNow, live, liveMsgId, replacedId, reported });
      for (const mid of newIds) {
        stampMessageCost(ROOT, chatId, mid, {
          runId,
          costUsd: totalCostUsd,
          usageFound,
          costPrimary: mid === primaryId,
        });
      }
    } catch (e) {
      console.error('[forge] no pude estampar el coste en los mensajes:', e.message);
    }

    // detalle del fallo: en runs NO-vivos `claude` escribe el error en el JSON de
    // stdout (no en stderr) → miramos ambos. Prioridad: API Error en stderr → error
    // del resultado JSON → última línea de stderr.
    const failDetail = () => {
      const apiErr = (stderrTail.match(/API Error[^\n]*/i) || [])[0];
      if (apiErr) return apiErr;
      try {
        const r = usageRaw || parseCliResult(jsonOut, { stream: false });
        if (r && (r.is_error || r.subtype === 'error_max_turns' || r.subtype === 'error')) {
          return String(r.error || r.result || r.subtype || 'error').slice(0, 240);
        }
      } catch {}
      return stderrTail.split('\n').filter(Boolean).slice(-1)[0] || '';
    };

    if (live) {
      // cierra el mensaje VIVO: en pasado (lo que hizo) si fue bien; con el aviso si murió.
      if (failed && !reported) {
        const motivo = timedOut
          ? `se agotó el tiempo (${Math.round(timeoutMs / 60000)} min) y lo paré`
          : `terminó con error (code ${code}${signal ? ', señal ' + signal : ''})`;
        const detalle = failDetail();
        try { replaceMessageText(ROOT, chatId, liveMsgId, `⚠️ ${who} no terminó: ${motivo}.${detalle ? '\n\n' + detalle : ''}\n\nPuedes volver a intentarlo.`); } catch {}
      } else {
        // si el agente POSEE el mensaje vivo (modo REPLACE: su contenido final ESTÁ
        // ahí, p.ej. el plan de Aubé), NO lo pisamos con un cierre. Solo cerramos los
        // mensajes-latido que el agente no reescribe (Miguel/Ana Liz, modo append).
        const agentOwnsLive = extraEnv.FORGE_REPLACE_MSG_ID && String(extraEnv.FORGE_REPLACE_MSG_ID) === String(liveMsgId);
        let curText = '';
        try { curText = ((readChat(ROOT, chatId)?.messages || []).find((m) => m.id === Number(liveMsgId)) || {}).text || ''; } catch {}
        const aunEsLatido = curText.startsWith(liveIcon);
        if (!agentOwnsLive || aunEsLatido) {
          const cierre = who === 'revisor' ? '🔀 El revisor terminó el merge.'
            : who === 'analiz' ? '⌨️ Ana Liz terminó de escribir los tests.'
            : who === 'aube' ? '✦ Aubé terminó, pero no dejó plan. Vuelve a intentarlo.'
            : '🔨 Miguel terminó de construir.';
          try { replaceMessageText(ROOT, chatId, liveMsgId, cierre + (reported ? ' Ver su nota abajo. ↓' : '')); } catch {}
        }
      }
    } else if (failed && !reported) {
      const motivo = timedOut
        ? `se agotó el tiempo (${Math.round(timeoutMs / 60000)} min) y lo paré`
        : `terminó con error (code ${code}${signal ? ', señal ' + signal : ''})`;
      const detalle = failDetail();
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
      // JSON final → trae el título en `.result` y el coste en `.usage`/`.total_cost_usd`.
      child = spawnClaude(['-p', prompt, ...modelArgs(), '--output-format', 'json', '--mcp-config', cfgPath, '--strict-mcp-config'], {
        cwd: FORGE_DIR, stdio: ['ignore', 'pipe', 'inherit'],
      }, { who: 'varita (autoname)', chatId });
    } catch { try { fs.unlinkSync(cfgPath); } catch {} resolve(null); return; }

    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 90 * 1000);
    child.on('error', () => { clearTimeout(timer); try { fs.unlinkSync(cfgPath); } catch {} resolve(null); });
    child.on('exit', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(cfgPath); } catch {}
      const res = parseCliResult(out, { stream: false });
      logTokenUsage(ROOT, {
        spawn: 'generateTitle', agente: 'varita (autoname)', permisos: '(ninguna)',
        runId: `${chatId}-autoname-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        modelo: modelLabel(), chatId: String(chatId),
        promptChars: prompt.length, promptBytes: Buffer.byteLength(prompt, 'utf8'),
        textoEntrada: prompt, ...extractUsage(res),
      });
      // el título viaja en `.result` del JSON; primera línea no vacía, sin comillas.
      const raw = (res && typeof res.result === 'string') ? res.result : out;
      const t = String(raw).split('\n').map((s) => s.trim()).find(Boolean) || '';
      const clean = t.replace(/^["'«»]+|["'«».]+$/g, '').trim().slice(0, 60);
      resolve(clean || null);
    });
  });
}

// Resumen en vivo con el modelo MÁS BARATO (Haiku), pase lo que pase el selector
// global. Lee el registro de la sesión de Miguel y devuelve un SNAPSHOT corto en
// cristiano (no acumula: describe el estado actual). null si falla. Sin MCP.
function runHaikuSummary(transcript, meta = {}) {
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
      // JSON final → el resumen en `.result`, el coste en `.usage`/`.total_cost_usd`.
      child = spawnClaude(['-p', prompt, '--model', 'haiku', '--output-format', 'json', '--mcp-config', cfgPath, '--strict-mcp-config'], {
        cwd: FORGE_DIR, stdio: ['ignore', 'pipe', 'ignore'],
      }, { who: 'resumen-vivo', chatId: meta.chatId });
    } catch { try { fs.unlinkSync(cfgPath); } catch {} resolve(null); return; }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60 * 1000);
    child.on('error', () => { clearTimeout(timer); try { fs.unlinkSync(cfgPath); } catch {} resolve(null); });
    child.on('exit', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(cfgPath); } catch {}
      const res = parseCliResult(out, { stream: false });
      // Suspecto #2: este resumen se relanza cada 10s durante TODA la build → su
      // coste sumado es la fuga que más se acumula. Lo medimos aparte para verlo.
      const u = extractUsage(res);
      logTokenUsage(ROOT, {
        spawn: 'runHaikuSummary (resumen en vivo)',
        agente: 'resumen-vivo' + (meta.forWho ? ` (de ${meta.forWho})` : ''),
        runId: meta.runId || null,       // mismo runId que el personaje al que resume
        permisos: '(ninguna)', modelo: 'haiku', chatId: meta.chatId ? String(meta.chatId) : null,
        promptChars: prompt.length, promptBytes: Buffer.byteLength(prompt, 'utf8'),
        textoEntrada: prompt, ...u,
      });
      const summary = (res && typeof res.result === 'string') ? res.result : out;
      const text = String(summary).trim() || null;
      resolve({ text, costUsd: u.costUsd });
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

// ── abrir el navegador: reactivar la ventana si ya hay una, si no abrir una ───
// El forge se abre como VENTANA-APP dedicada de Edge/Chrome (--app), así una
// ventana = un forge, con un título reconocible ("Neblla Forge", el <title> de la
// página). Al relanzar (p.ej. tras matar el server colgado y arrancar otro), en vez
// de abrir una pestaña nueva BUSCAMOS esa ventana por su título y la traemos al
// frente; solo si no existe abrimos una. En Mac/Linux caemos al open/xdg-open de
// siempre (su gestor ya reusa la pestaña razonablemente).
const FORGE_WINDOW_TITLE = 'Neblla Forge';   // DEBE coincidir con el <title> de public/forge/index.html
const FORGE_BROWSER_PROFILE = path.join(FORGE_DIR, '.forge-browser');

// Encuentra el ejecutable del navegador en Windows. CHROME primero (es el que usa
// Tie); Edge solo como último recurso si no hubiera Chrome.
function findChromiumExe() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const cands = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    // fallback: Edge (solo si no hay Chrome instalado).
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

// ¿Hay ya una ventana de forge abierta? Si sí, la trae al frente (AppActivate) y
// devuelve true. Mira SOLO procesos de navegador para no confundirse con, p.ej., el
// IDE editando forge.js. Best-effort: cualquier fallo → false (abrimos una nueva).
function focusExistingForgeWindow() {
  const psScript =
    "$ErrorActionPreference='SilentlyContinue';" +
    "$w = Get-Process msedge,chrome,brave -ErrorAction SilentlyContinue |" +
    " Where-Object { $_.MainWindowTitle -like '*" + FORGE_WINDOW_TITLE + "*' } |" +
    " Select-Object -First 1;" +
    "if ($w) { (New-Object -ComObject WScript.Shell).AppActivate($w.MainWindowTitle) | Out-Null; 'FOCUSED' }";
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    });
    return !!(r.stdout && r.stdout.includes('FOCUSED'));
  } catch { return false; }
}

function openBrowser(url) {
  if (process.env.FORGE_NO_OPEN) return;
  try {
    if (process.platform === 'win32') {
      if (focusExistingForgeWindow()) {
        console.log('[forge] ya había una ventana de forge: la traigo al frente (no abro otra).');
        return;
      }
      const exe = findChromiumExe();
      if (exe) {
        try { fs.mkdirSync(FORGE_BROWSER_PROFILE, { recursive: true }); } catch {}
        spawn(exe, [
          `--app=${url}`,
          `--user-data-dir=${FORGE_BROWSER_PROFILE}`,
          '--no-first-run', '--no-default-browser-check',
        ], { detached: true, stdio: 'ignore' }).unref();
      } else {
        // sin Edge/Chrome a mano: al menos abrir la pestaña como antes.
        spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
      }
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

// ── la COMPUERTA del apagado ordenado ────────────────────────────────────────
// Mientras la forja drena (apagandose), toda ruta que lanzaría un headless nuevo
// se rechaza con 503 {ok:false, error:'shutting down'} ANTES de spawnear nada. El
// front detecta ese par exacto y reintenta cada 60s. Las lecturas (todo lo que no
// sea POST: status, leer chats/tareas/cycle…) atraviesan la compuerta sin tocarse:
// el drenaje solo bloquea el trabajo nuevo, no la observación.
const RUTAS_DE_TRABAJO = [
  /^\/api\/chats\/[^/]+\/charla$/,
  /^\/api\/chats\/[^/]+\/aube$/,
  /^\/api\/chats\/[^/]+\/challenge$/,
  /^\/api\/chats\/[^/]+\/discutir$/,
  /^\/api\/chats\/[^/]+\/anselmo$/,
  /^\/api\/chats\/[^/]+\/consejo$/,
  /^\/api\/chats\/[^/]+\/investigar$/,
  /^\/api\/chats\/[^/]+\/responder$/,
  /^\/api\/chats\/[^/]+\/autoname$/,
  /^\/api\/tareas\/[^/]+\/ejecutar$/,
  /^\/api\/tareas\/[^/]+\/tests\/definir$/,
  /^\/api\/tareas\/[^/]+\/tests\/escribir$/,
];
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();           // las lecturas pasan siempre
  if (!statusShort().apagandose) return next();        // marcha normal: todo pasa
  if (RUTAS_DE_TRABAJO.some((re) => re.test(req.path))) {
    return res.status(503).json({ ok: false, error: 'shutting down' });
  }
  return next();
});

// ── estado de la forja (lo sondea el front cada ~3s) ─────────────────────────
// Forma fija del contrato: {encendida, agentes, apagandose, reiniciada}. Si el
// proceso no responde, el front lo interpreta como 'desconectada'.
app.get('/api/forge/status', (_req, res) => res.json(statusShort()));
// Alias extendido (phase + lista de agentes vivos), por si se quiere el detalle.
app.get('/api/forge/estado', (_req, res) => res.json(statusFull()));

// ── reinicio ordenado: entra en modo drenaje (idempotente) ───────────────────
app.post('/api/forge/schedule-restart', (_req, res) => {
  const agentes = scheduleRestart();
  res.json({ ok: true, agentes });
});
app.post('/api/forge/restart', (_req, res) => {
  scheduleRestart();
  res.json({ ok: true, ...statusFull() });
});

// Al vaciarse el set de agentes durante el drenaje, la forja queda 'down'
// (reiniciada=true). Damos 5s de gracia para que el front pille ese último estado
// en su sonda y luego cerramos el proceso de verdad → "desconectada, reinicio manual".
setOnDrained(() => {
  console.log('[forge] drenaje completo: 0 agentes. Cierro en 5s (reinicio manual).');
  setTimeout(() => { process.exit(0); }, 5000);
});

app.get('/', (_req, res) => {
  if (!fs.existsSync(FORGE_HTML)) return res.status(500).send('forge/index.html no encontrado');
  res.type('html').send(fs.readFileSync(FORGE_HTML, 'utf8'));
});

// Favicon del forge (yunque en magenta de marca).
app.get('/forge/favicon.svg', (_req, res) => {
  if (!fs.existsSync(FORGE_FAVICON)) return res.status(404).end();
  res.type('image/svg+xml').send(fs.readFileSync(FORGE_FAVICON, 'utf8'));
});

// Motor markdown del cliente (mdToFragment/fillBubble): lo carga index.html.
app.get('/forge/forge-md.js', (_req, res) => {
  if (!fs.existsSync(FORGE_MD)) return res.status(404).end();
  res.type('application/javascript').send(fs.readFileSync(FORGE_MD, 'utf8'));
});

// ── uso de la suscripción (la ventana de 5h) ─────────────────────────────────
// El endpoint /api/oauth/usage valida el ACCESS TOKEN corto de Claude Code (el
// setup-token largo da "Invalid bearer token"). Así que leemos las credenciales que
// Claude Code guarda en disco (~/.claude/.credentials.json → claudeAiOauth) — es la
// propia app de Tie leyendo sus propias credenciales — y si el access token caducó, lo
// RENOVAMOS con el refresh token (POST al token endpoint, client_id público del CLI) y
// reescribimos el fichero ATÓMICO, preservando el resto. Cacheamos el RESULTADO 5 min y
// aguantamos 429 sirviendo lo último bueno.
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';   // id público del CLI (sin secreto)
const USAGE_TTL_MS = 5 * 60 * 1000;
let usageCache = { at: 0, raw: null };

function credsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  return path.join(dir, '.credentials.json');
}
// Una ventana del payload (five_hour / seven_day) → {usedPercent, resetsAt}.
function usageWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const u = w.utilization != null ? w.utilization : (w.usedPercent != null ? w.usedPercent : null);
  return (u != null) ? { usedPercent: u, resetsAt: w.resets_at || w.resetsAt || null } : null;
}
// Renueva el access token con el refresh token. Devuelve {accessToken, refreshToken, expiresAt}.
async function refreshAccessToken(oauth) {
  if (!oauth.refreshToken) throw new Error('las credenciales no traen refreshToken');
  const res = await fetch('https://platform.claude.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'claude-code/2.1.166' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: OAUTH_CLIENT_ID }),
  });
  if (!res.ok) { let b = ''; try { b = (await res.text()).slice(0, 200); } catch {} throw new Error('refresh HTTP ' + res.status + (b ? ' — ' + b : '')); }
  const j = await res.json();
  return { accessToken: j.access_token, refreshToken: j.refresh_token || oauth.refreshToken, expiresAt: Date.now() + (Number(j.expires_in) || 0) * 1000 };
}
// Reescribe SOLO los 3 campos del token, preservando el resto del fichero. Atómico.
function persistTokens(all, fresh) {
  const next = { ...all, claudeAiOauth: { ...all.claudeAiOauth, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt } };
  const p = credsPath();
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, p);
}
// Lee credenciales → (renueva si caducó) → llama al endpoint de uso. Devuelve {raw} o lanza.
async function liveUsage() {
  let all;
  try { all = JSON.parse(fs.readFileSync(credsPath(), 'utf8')); }
  catch (e) { throw new Error('no pude leer ' + credsPath() + ': ' + e.message); }
  let oauth = all.claudeAiOauth;
  if (!oauth || !oauth.accessToken) throw new Error('las credenciales no tienen claudeAiOauth.accessToken');
  // ¿caducado? (margen de 60s) → renueva y persiste.
  if (oauth.expiresAt && Date.now() >= Number(oauth.expiresAt) - 60000) {
    const fresh = await refreshAccessToken(oauth);
    try { persistTokens(all, fresh); } catch (e) { console.error('[forge] no pude reescribir credenciales tras refrescar:', e.message); }
    oauth = { ...oauth, ...fresh };
  }
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: 'Bearer ' + oauth.accessToken, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/2.1.166' },
  });
  if (!res.ok) { let b = ''; try { b = (await res.text()).slice(0, 200); } catch {} throw new Error('usage HTTP ' + res.status + (b ? ' — ' + b : '')); }
  return { raw: await res.json() };
}
function usageShape(raw, extra) {
  return { available: true, ...extra,
    primary: usageWindow(raw.five_hour), secondary: usageWindow(raw.seven_day), raw };
}
async function fetchUsage() {
  const fresh = usageCache.raw && (Date.now() - usageCache.at) < USAGE_TTL_MS;
  if (!fresh) {
    try {
      const r = await liveUsage();
      usageCache = { at: Date.now(), raw: r.raw };
    } catch (e) {
      // 429 u otro fallo con caché previa → lo último bueno, marcado rancio.
      if (usageCache.raw) return usageShape(usageCache.raw, { stale: true, cachedAt: usageCache.at });
      return { available: false, reason: e.message };
    }
  }
  return usageShape(usageCache.raw, { cachedAt: usageCache.at });
}
app.get('/api/usage', async (_req, res) => {
  try { res.json(await fetchUsage()); }
  catch (e) { res.status(500).json({ available: false, reason: e.message }); }
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

// ── perfiles de los empleados (people/*.json) ────────────────────────────────
// La pestaña de Perfiles los lee para pintarlos; cada uno trae su descripción (la
// VOZ que de verdad usa al lanzarse), su modelo por persona y su scope (informativo).
// Las opciones de modelo son las MISMAS del selector global (MODEL_CHOICES).
app.get('/api/people', (_req, res) => {
  res.json({
    people: listPeople(FORGE_DIR),
    choices: MODEL_CHOICES,
    globalModel: currentModel(),
    catalogo: { lee: LEE_OPCIONES, escribe: ESCRIBE_OPCIONES, herramientas: HERRAMIENTAS_MCP },
  });
});

// Parcha un perfil por su id (P-NNN, en la URL). Toca descripción / modelo / scope /
// herramientas / nombre. No crea ni renombra ficheros (el id manda). Valida modelo,
// niveles de lectura, capacidades de escritura y herramientas contra el catálogo.
// 404 si el id no existe.
app.post('/api/people/:id', (req, res) => {
  const id = String(req.params.id || '');
  const body = req.body || {};
  const patch = {};
  if (typeof body.nombre === 'string') patch.nombre = body.nombre;
  if (typeof body.descripcion === 'string') patch.descripcion = body.descripcion;
  if (body.modelo != null) {
    const modelo = String(body.modelo);
    if (modelo && !MODEL_VALUES.has(modelo)) return res.status(400).json({ error: 'modelo no válido: ' + modelo });
    patch.modelo = modelo;
  }
  if (body.scope != null && typeof body.scope === 'object') {
    const s = {};
    if (body.scope.lee !== undefined) {
      const lee = String(body.scope.lee);
      if (lee && !LEE_VALUES.has(lee)) return res.status(400).json({ error: 'nivel de lectura no válido: ' + lee });
      s.lee = lee;
    }
    if (body.scope.escribe !== undefined) {
      const arr = Array.isArray(body.scope.escribe) ? body.scope.escribe.map(String) : [];
      const bad = arr.find((v) => !ESCRIBE_VALUES.has(v));
      if (bad) return res.status(400).json({ error: 'capacidad de escritura no válida: ' + bad });
      s.escribe = arr;
    }
    if (body.scope.preguntar !== undefined) s.preguntar = body.scope.preguntar;
    patch.scope = s;
  }
  if (body.herramientas !== undefined) {
    const arr = Array.isArray(body.herramientas) ? body.herramientas.map(String) : [];
    const bad = arr.find((v) => !HERR_VALUES.has(v));
    if (bad) return res.status(400).json({ error: 'herramienta MCP no válida: ' + bad });
    patch.herramientas = arr;
  }
  try {
    const updated = writePerson(FORGE_DIR, id, patch);
    if (!updated) return res.status(404).json({ error: 'no existe el empleado: ' + id });
    res.json({ person: updated });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo guardar el perfil: ' + e.message });
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
  // `next` = el paso recomendado de la conversación (determinista, lo decide la
  // forja): el botón "Siguiente paso" del front lo dispara. Lo mismo que `t.next`
  // hace por una tarea, pero para la mitad de conversación (William→Iris→Aubé→aprobar).
  res.json({ ...chat, next: pasoConversacion(chat) });
});

// Detalle del coste de un run (lo que pide el modal al pinchar la chapa $): el
// total agregado + cada petición tal cual del log. Sin filas → totales a 0 y
// requests [], status 200 (no 404). textoEntrada va completo.
app.get('/api/tokens/run/:runId', (req, res) => {
  try {
    const rows = readTokenLog(ROOT);
    res.json(summarizeRun(rows, req.params.runId));
  } catch (e) {
    res.status(500).json({ error: 'no se pudo leer el log de tokens: ' + e.message });
  }
});

// Borra una conversación (DEFINITIVO). 404 si no existe. (Tarea #001, de Miguel.)
app.delete('/api/chats/:id', (req, res) => {
  let removed;
  try { removed = deleteChat(ROOT, req.params.id); }
  catch (e) { return res.status(500).json({ error: 'no se pudo borrar: ' + e.message }); }
  if (!removed) return res.status(404).json({ error: 'conversación no encontrada' });
  res.json({ deleted: req.params.id });
});

// Borrar UN mensaje de un hilo. El front decide CUÁNDO preguntar (solo si el
// mensaje tiene descendientes); aquí solo obedecemos el flag cascade. cascade=true
// borra el subárbol entero; cascade=false re-cuelga los hijos directos del padre
// del borrado. Responde { removed, reparented }. 404 si no existe la conversación,
// 400 si el msgId no es válido.
app.delete('/api/chats/:id/messages/:msgId', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });

  const msgId = Number(req.params.msgId);
  if (!Number.isFinite(msgId)) return res.status(400).json({ error: 'msgId no válido' });

  // cascade del body (JSON) o, en su defecto, de la query (?cascade=true).
  const raw = (req.body && req.body.cascade != null) ? req.body.cascade : req.query.cascade;
  const cascade = raw === true || raw === 'true' || raw === 1 || raw === '1';

  try {
    const result = deleteMessage(ROOT, id, msgId, { cascade });
    res.json({ removed: result.removed, reparented: result.reparented });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo borrar: ' + e.message });
  }
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
      prompt: charlaPrompt({ threadText: buildThreadText(id), focoText: buildFocoText(chat, target, scope), voz: vozDe('iris') }),
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
    prompt: charlaPrompt({ threadText: buildThreadText(id), voz: vozDe('iris') }),
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
    prompt: williamChallengePrompt({ threadText: buildThreadText(id), focoText, steer: req.body && req.body.steer, voz: vozDe('william') }),
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

// DEBUG: devuelve el texto que se ENSAMBLA para un alcance dado, SIN lanzar a nadie.
// El botón 🐞 Debug de la UI lo vuelca en la consola para verificar a ojo qué se
// manda en cada scope: el hilo (igual siempre) + el foco (lo que cambia con el
// alcance: mensaje / hilo / conversacion / contextual). Misma resolución de
// target/scope que las acciones reales (resolveTargetAndScope + buildFocoText).
app.post('/api/chats/:id/debug-foco', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  const r = resolveTargetAndScope(req, chat);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({
    scope: r.scope,
    targetId: r.targetId,
    threadText: buildThreadText(id),
    focoText: buildFocoText(chat, r.target, r.scope),
  });
});

// Stevens: audita el estado REAL del código (Investigar).
app.post('/api/chats/:id/investigar', (req, res) => {
  const id = req.params.id;
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  const r = resolveTargetAndScope(req, chat);
  if (r.error) return res.status(400).json({ error: r.error });
  launchHeadless({
    chatId: id,
    prompt: stevensPrompt({ threadText: buildThreadText(id), focoText: buildFocoText(chat, r.target, r.scope), steer: req.body && req.body.steer, target: targetDesc(), voz: vozDe('stevens') }),
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
    prompt: miyagiPrompt({ threadText: buildThreadText(id), focoText: buildFocoText(chat, r.target, r.scope), steer: req.body && req.body.steer, target: targetDesc(), voz: vozDe('miyagi') }),
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
  // Ariel y Romina son UN solo personaje (ficha P-003, alias ariel+romina): el
  // rótulo elegido es a la vez el AUTOR que se ve en el hilo y el GÉNERO de la voz.
  const author = (req.body && req.body.author) === 'ariel' ? 'ariel' : 'romina';
  const genero = author === 'ariel' ? 'el' : 'ella';
  const stance = (req.body && req.body.stance) === 'rechaza' ? 'rechaza' : 'defiende';
  launchHeadless({
    chatId: id,
    prompt: discutirPrompt({
      threadText: buildThreadText(id),
      focoText: buildFocoText(chat, r.target, r.scope),
      stance, steer: req.body && req.body.steer, voz: vozDe(author), genero,
    }),
    extraEnv: {
      FORGE_REPLY_TO: r.targetId == null ? '' : String(r.targetId), FORGE_MSG_TYPE: 'discusion',
      FORGE_INTENT: 'challenge', FORGE_AUTHOR: author, FORGE_STANCE: stance,
    },
  });
  res.status(202).json({ spawned: true, targetId: r.targetId, pendingParent: r.targetId, scope: r.scope, author, stance });
});

// Resumen A DEMANDA del build en vivo: Tie pulsa "📸 Resumir" en el mensaje de
// Miguel/revisor y aquí generamos UN snapshot Haiku del avance actual (el resumen
// ya no se relanza solo cada 10s). 409 si esa build ya terminó o no existe.
app.post('/api/chats/:id/resumir-build', async (req, res) => {
  const msgId = String((req.body && req.body.msgId) != null ? req.body.msgId : '');
  const entry = LIVE_BUILDS.get(msgId);
  if (!entry) return res.status(409).json({ error: 'esa build ya terminó (o no existe).' });
  try {
    const r = await entry.resumir();
    res.json({ ok: true, text: (r && r.text) || null, note: (r && r.note) || null });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo resumir: ' + e.message });
  }
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
    prompt: anselmoPrompt({ threadText: buildThreadText(id), steer: req.body && req.body.steer, voz: vozDe('anselmo') }),
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

  // Lo que Tie escribe al pedir a Aubé NO es un susurro silencioso: se PUBLICA como
  // su mensaje en el hilo (antes se consumía como `steer` y desaparecía). Aubé lo
  // leerá como parte del hilo (buildThreadText), así que no hace falta inyectarlo aparte.
  const said = String((req.body && req.body.steer) || '').trim();
  let posted = false;
  if (said) { try { appendMessage(ROOT, id, { author: 'tie', intent: 'request', text: said }); posted = true; } catch {} }

  const fresh = readChat(ROOT, id) || chat;
  const msgs = fresh.messages || [];
  let existing = msgs.find((m) => m.author === 'aube');
  const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
  // mensaje VIVO de Aubé: si ya tiene uno, lo reusa (lo reescribirá con el plan); si
  // no, crea un PLACEHOLDER que sirve de latido y que su plan final reemplazará.
  if (!existing) {
    try { existing = appendMessage(ROOT, id, { type: 'tarea', author: 'aube', intent: 'answer', replyTo: (lastId || null), text: '✦ Aubé está replanteando…' }); }
    catch (e) { return res.status(500).json({ error: 'no pude crear el mensaje de Aubé: ' + e.message }); }
  } else {
    // REUSA la caja vieja: hay que BORRARLE el plan anterior y dejar el cartel de
    // "replanteando…", o si no parecería que no pasó nada (la caja se quedaría
    // enseñando el plan viejo igual, sin pista de que Aubé arrancó otra vez).
    try { replaceMessageText(ROOT, id, existing.id, '✦ Aubé está replanteando…'); } catch {}
  }
  try { setMessageLive(ROOT, id, existing.id, true); } catch {}
  const extraEnv = { FORGE_REPLACE_MSG_ID: String(existing.id), FORGE_MSG_TYPE: 'tarea', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'aube' };

  launchHeadless({
    chatId: id, prompt: aubePrompt({ threadText: buildThreadText(id), voz: vozDe('aube') }), extraEnv,
    liveMsgId: existing.id,   // placeholder + latido gratis; el plan final lo reemplaza
    // Cuando Aubé TERMINA, si este hilo es de una tarea, su plan entra SOLO en la
    // tarea (sin botón "recoger"): leemos su último mensaje, sacamos el bloque
    // ```plan y lo adoptamos (sin aprobar). Best-effort: nunca tumba el cierre.
    onDone: () => {
      try {
        const c = readChat(ROOT, id);
        if (!c || !c.tareaId) return;
        const aube = [...(c.messages || [])].reverse().find((m) => m.author === 'aube');
        // fuente canónica = msg.plan (MCP proponer_plan); parseo de texto solo como
        // red para mensajes viejos (pre-MCP).
        const plan = normalizarPlan((aube && aube.plan) || parsePlanBloque((aube && aube.text) || ''));
        if (plan.resumen || plan.partes.length) {
          setTareaPlan(ROOT, c.tareaId, plan);
          derivarSubtareasDelPlan(c.tareaId);   // el plan trae el reparto → subtareas solas
        }
      } catch {}
    },
  });
  // si reemplaza, no hay fantasma nuevo (cambia in-place); si crea, cuelga del último.
  res.status(202).json({ spawned: true, replacing: !!existing, posted, pendingParent: existing ? null : (lastId || null) });
});

// RESPONDER una PREGUNTA de un agente (la herramienta MCP `preguntar` está esperando).
// Añade tu respuesta como un mensaje de 'tie' que CUELGA de la pregunta (replyTo); el
// MCP que sondea la detecta y se la entrega al agente. Queda registrada en el hilo.
app.post('/api/chats/:id/preguntas/:msgId/responder', (req, res) => {
  const id = req.params.id;
  const qId = Number(req.params.msgId);
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'la respuesta no puede estar vacía' });
  const chat = readChat(ROOT, id);
  if (!chat) return res.status(404).json({ error: 'conversación no encontrada' });
  const pregunta = (chat.messages || []).find((m) => m.id === qId && m.type === 'pregunta');
  if (!pregunta) return res.status(404).json({ error: 'pregunta no encontrada' });
  try {
    const msg = appendMessage(ROOT, id, { type: 'charla', author: 'tie', intent: 'answer', replyTo: qId, text });
    res.status(201).json({ message: msg });
  } catch (e) {
    res.status(500).json({ error: 'no pude registrar la respuesta: ' + e.message });
  }
});

// Tareas (columna derecha): listar y crear (Aprobar de Aubé).
// Cada tarea sale DECORADA con su estado/icono/subtareas computados desde las
// señales del ciclo (forge-estado.js) y la lista ya viene ORDENADA por cajón
// (revisar → en curso → por hacer → terminadas). El front solo pinta.
app.get('/api/tareas', (_req, res) => {
  // cada tarea sale con su `origen` resuelto EN VIVO (la cabecera "↰ viene de …"):
  // así renombrar la fuente renombra el link y borrarla lo hace desaparecer.
  const tareas = ordenarTareas(listTareas(ROOT)).map((t) => ({
    ...t,
    origen: resolveOrigen(ROOT, t),
    // qué personajes están EN VUELO en el hilo de esta tarea (para el hint "trabajando…")
    headlessEnCurso: t.threadId ? inFlightAuthors(t.threadId) : [],
  }));
  res.json({ tareas, grupos: TAREA_GRUPOS });
});

app.post('/api/tareas', (req, res) => {
  const { fromChat } = req.body || {};
  let { title, body } = req.body || {};
  let aubeText = null;
  let aubePlan = null;    // el plan estructurado del MCP (proponer_plan), si lo trae
  let aubeMsgId = null;   // el mensaje de Aubé que esta tarea se lleva (→ stub)
  // SIEMPRE que haya un chat origen, localizamos el mensaje de Aubé que se lleva la
  // tarea (el `fromMsg` rey si llega, si no el primer Aubé del hilo) — para colapsarlo
  // en su stub. Además, si no llegó cuerpo, lo derivamos de ese mensaje.
  if (fromChat) {
    const chat = readChat(ROOT, fromChat);
    const msgs = (chat?.messages || []);
    let aube = null;
    if (req.body.fromMsg != null) aube = msgs.find((m) => m.id === Number(req.body.fromMsg) && m.author === 'aube');
    if (!aube) aube = msgs.find((m) => m.author === 'aube');
    if (aube) {
      aubeText = String(aube.text);
      aubePlan = aube.plan || null;   // fuente canónica si vino del MCP
      aubeMsgId = aube.id;
      if (!body || !String(body).trim()) {
        const lines = aubeText.split('\n');
        if (!title) title = lines[0];
        body = lines.slice(1).join('\n').trim() || aube.text;
      }
    }
  }
  if ((!title || !String(title).trim()) && (!body || !String(body).trim())) {
    return res.status(400).json({ error: 'no hay de qué crear la tarea (ni texto ni mensaje de Aubé)' });
  }
  // El PLAN estructurado de Aubé (resumen + partes + contrato) se guarda al crear.
  // Las SUBTAREAS ya NO se derivan aquí: nacen solo al pulsar "Paralelizar" sobre el
  // plan APROBADO. Así "las partes del plan" ≠ "ya está paralelizado": son dos pasos
  // conscientes (describir vs. partir de verdad en subtareas con vida propia).
  const plan = normalizarPlan(aubePlan || parsePlanBloque(aubeText || body));
  const tienePlan = plan.resumen || plan.partes.length;
  let tarea;
  try {
    tarea = createTarea(ROOT, { title, body, fromChat, fromMsg: aubeMsgId, plan: tienePlan ? plan : undefined });
  } catch (e) {
    return res.status(500).json({ error: 'no se pudo crear la tarea: ' + e.message });
  }
  // El reparto en paralelo lo decide Aubé en el plan: en cuanto hay plan, sus partes
  // se materializan en subtareas SOLAS (sin botón). Best-effort.
  if (tienePlan) { try { derivarSubtareasDelPlan(tarea.id); tarea = readTarea(ROOT, tarea.id); } catch {} }
  // El plan SALE de la conversación: el mensaje de Aubé se colapsa en un stub
  // "[Tarea NNN creada: …]" que apunta a la tarea (click → la abre). Best-effort:
  // si falla, la tarea ya está creada; no la tumbamos por el stub.
  if (fromChat && aubeMsgId != null) {
    try { stubMessageForTarea(ROOT, fromChat, aubeMsgId, { tareaId: tarea.id, title: tarea.title }); }
    catch (e) { console.error('[forge] no pude colapsar el mensaje de Aubé en stub:', e.message); }
  }
  res.status(201).json({ ...tarea, origen: resolveOrigen(ROOT, tarea) });
});

// Aprobar el PLAN de una tarea (la puerta antes de paralelizar/construir). Valida
// el plan; si no pasa, 422 con los motivos. Si pasa, lo marca aprobado.
app.post('/api/tareas/:id/plan/aprobar', (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  if (!tarea.plan) return res.status(409).json({ error: 'la tarea no tiene plan estructurado que aprobar' });
  const v = validarPlan(tarea.plan);
  if (!v.ok) return res.status(422).json({ error: 'el plan no es aprobable', motivos: v.motivos });
  res.json(approveTareaPlan(ROOT, req.params.id));
});

// Editar a mano el PLAN de una tarea (Tie). Reemplaza y vuelve a dejarlo SIN
// aprobar. Devuelve la tarea con el plan normalizado.
app.post('/api/tareas/:id/plan', (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  const plan = normalizarPlan((req.body && req.body.plan) || null);
  const out = setTareaPlan(ROOT, req.params.id, plan);
  res.json(out || { error: 'no se pudo guardar el plan' });
});

// RECOGER el plan que Aubé acaba de reescribir en el HILO de la tarea (tras pulsar
// "Revisar (Aubé)"). Lee el último mensaje de `aube` del hilo, saca su bloque
// ```plan y lo adopta en la tarea (sin aprobar). Devuelve la tarea, o 409 si no
// hay un plan recogible en el hilo.
app.post('/api/tareas/:id/plan/recoger', (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  const chat = tarea.threadId ? readChat(ROOT, tarea.threadId) : null;
  const aube = [...((chat && chat.messages) || [])].reverse().find((m) => m.author === 'aube');
  const plan = normalizarPlan((aube && aube.plan) || parsePlanBloque((aube && aube.text) || ''));
  if (!plan.resumen && !plan.partes.length) {
    return res.status(409).json({ error: 'Aubé aún no ha dejado un plan en el hilo (pulsa "Revisar (Aubé)" y espera a que termine)' });
  }
  res.json(setTareaPlan(ROOT, req.params.id, plan));
});

// PARALELIZAR: convierte las partes del PLAN APROBADO en subtareas reales (con su
// alcance + su trozo de contrato). La red de seguridad es troceaTarea: si los
// carriles se pisan o hay una sola pieza, NO parte (queda main) y lo dice en `motivo`.
// Deriva las SUBTAREAS de una tarea desde las `partes` de su plan. Es AUTOMÁTICO:
// el reparto en paralelo ya lo decidió Aubé al escribir el plan, así que no hay
// botón — en cuanto hay/llega un plan, sus partes se materializan como subtareas
// (con su alcance + su trozo de contrato). troceaTarea es la red de seguridad: si
// los carriles se pisan o es una sola pieza, queda como tarea única (main).
function derivarSubtareasDelPlan(id) {
  const tarea = readTarea(ROOT, id);
  if (!tarea || !tarea.plan) return { troceada: false, motivo: 'sin plan' };
  const prop = planAPropuestaSubtareas(tarea.plan);
  const corte = troceaTarea(prop);
  let subs = null;
  if (corte.troceada) {
    const byName = new Map(prop.subtareas.map((s) => [s.name, s]));
    subs = corte.subtareas.map((s) => ({ ...s, contrato: (byName.get(s.name) || {}).contrato || [] }));
  }
  setTareaSubtareas(ROOT, id, subs);
  return { troceada: corte.troceada, motivo: corte.motivo };
}

// PLANIFICAR TESTS (Ana Liz, Fase C): lanza a Ana Liz a redactar los tests EN PAPEL
// (dado/cuando/entonces) en el HILO de la tarea. Mensaje único y vivo (Reanalizar =
// mismo endpoint, REEMPLAZA). Al terminar, su plan de tests entra solo en la tarea.
// Mensaje VIVO de Ana Liz: el campo reservado bajo el de Aubé. Lo reusa (replace) si
// ya existe; si no, lo crea colgando del último. Devuelve {extraEnv, existing}.
function anaLizLiveEnv(tarea) {
  const chat = readChat(ROOT, tarea.threadId);
  const msgs = (chat && chat.messages) || [];
  const existing = msgs.find((m) => m.author === 'analiz');
  const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
  const extraEnv = existing
    ? { FORGE_REPLACE_MSG_ID: String(existing.id), FORGE_MSG_TYPE: 'tests', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'analiz' }
    : { FORGE_REPLY_TO: String(lastId), FORGE_MSG_TYPE: 'tests', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'analiz' };
  return { extraEnv, existing: !!existing };
}

// DEFINIR TESTS (Ana Liz, Fase C, CIEGA AL CÓDIGO): redacta los tests en papel y los
// entrega por la herramienta MCP `definir_tests` (que los guarda directo en la tarea
// — sin regex, sin volcado en el chat). Su mensaje queda como una nota humana corta.
function lanzarDefinirTests(req, res) {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  if (!tarea.threadId) return res.status(409).json({ error: 'abre la tarea primero (no tiene hilo)' });
  // GATE de complejidad: en una tarea FÁCIL, Ana Liz NO define tests (el forge la
  // intercepta). Si quieres alguno, se añade a mano con "Añadir test".
  if (complejidadEfectiva(tarea) === 'facil') {
    return res.status(409).json({ error: 'Tarea fácil: Ana Liz no define tests. Usa "Añadir test" para ponerlos a mano.', facil: true });
  }
  const inFlightKey = 'analiz:' + tarea.threadId;
  if (headlessInFlight.has(inFlightKey)) {
    return res.status(409).json({ error: 'Ana Liz ya está trabajando en esta tarea', busy: true });
  }
  headlessInFlight.add(inFlightKey);
  const { extraEnv, existing } = anaLizLiveEnv(tarea);
  const testsActuales = normalizarTestsPlan(tarea.testsPlan).tests;
  launchHeadless({
    chatId: tarea.threadId,
    inFlightKey,
    // CIEGA AL CÓDIGO: solo sus dos MCP (definir_tests + contestar), sin Read/Grep/Glob.
    allowedTools: 'mcp__forge__definir_tests,mcp__forge__contestar',
    prompt: anaLizPlanPrompt({ threadText: buildThreadText(tarea.threadId), plan: tarea.plan, subtareas: tarea.subtareas, steer: req.body && req.body.steer, voz: vozDe('analiz'), testsActuales, complejidad: complejidadEfectiva(tarea) }),
    extraEnv,
    // La herramienta MCP ya guardó los tests; aquí nada que parsear.
  });
  res.status(202).json({ spawned: true, replacing: existing });
}
app.post('/api/tareas/:id/tests/definir', lanzarDefinirTests);
app.post('/api/tareas/:id/tests/planificar', lanzarDefinirTests);   // alias viejo

// ESCRIBIR TESTS (Ana Liz, Fase D, CON CÓDIGO): convierte las definiciones en tests
// REALES. PRE-SELLAMOS los IDs (T-num-NN) y se los damos hechos; ella escribe el
// fichero (en el worktree de la tarea si existe, para que conviva con el código de
// Miguel y se pueda probar antes de subir) y marca el progreso por `escribir_tests`.
app.post('/api/tareas/:id/tests/escribir', (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  if (!tarea.threadId) return res.status(409).json({ error: 'abre la tarea primero' });
  const plan = normalizarTestsPlan(tarea.testsPlan);
  if (!plan.tests.length) return res.status(409).json({ error: 'no hay tests definidos; primero "Definir tests"' });
  const inFlightKey = 'analiz:' + tarea.threadId;
  if (headlessInFlight.has(inFlightKey)) return res.status(409).json({ error: 'Ana Liz ya está trabajando en esta tarea', busy: true });
  headlessInFlight.add(inFlightKey);
  // sella los IDs que falten y persiste (idempotente: respeta los ya sellados).
  const sellado = sellarTestIds(plan, tarea.num);
  mutateTestsPlan(ROOT, tarea.id, (p) => ({ ...normalizarTestsPlan(p), tests: sellado.tests }));
  // escribe en el worktree de la tarea si existe (convive con el código de Miguel),
  // si no, en el forge. La herramienta determinista escribe ahí (FORGE_WORKDIR).
  const cwd = (tarea.worktree && fs.existsSync(tarea.worktree)) ? tarea.worktree : FORGE_DIR;
  const ficheroSugerido = `forge/tests/tarea-${tarea.num}.test.js`;
  // mensaje VIVO de Ana Liz (latido + lo reescribe su nota final).
  let liveMsg;
  try { liveMsg = appendMessage(ROOT, tarea.threadId, { type: 'tests', author: 'analiz', intent: 'answer', text: '⌨️ Ana Liz está escribiendo los tests…' }); }
  catch (e) { headlessInFlight.delete(inFlightKey); return res.status(500).json({ error: 'no pude crear el mensaje: ' + e.message }); }
  try { setMessageLive(ROOT, tarea.threadId, liveMsg.id, true); } catch {}
  launchHeadless({
    chatId: tarea.threadId,
    inFlightKey,
    cwd,
    // BARATO y DETERMINISTA: sin Write/Edit/Bash — la herramienta escribe el fichero.
    allowedTools: 'Read,Grep,Glob,mcp__forge__escribir_test,mcp__forge__contestar',
    timeoutMs: 20 * 60 * 1000,
    liveMsgId: liveMsg.id,
    prompt: anaLizEscribirPrompt({
      threadText: buildThreadText(tarea.threadId), plan: tarea.plan, testsSellados: sellado.tests,
      target: targetDesc(), ficheroSugerido, steer: req.body && req.body.steer, voz: vozDe('analiz'),
    }),
    // su nota final CUELGA del mensaje vivo (append), como el informe de Miguel; el
    // mensaje vivo lo cierra el handler con "Ana Liz terminó…".
    extraEnv: { FORGE_REPLY_TO: String(liveMsg.id), FORGE_MSG_TYPE: 'tests', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'analiz', FORGE_WORKDIR: cwd },
  });
  res.status(202).json({ spawned: true });
});

// PROBAR TESTS: corre la batería del fichero de tests de la tarea y refleja el
// resultado por test (pasa/falla) leyendo el ID [T-…] de cada línea del reporter.
// Best-effort: si no encuentra el id en la salida, deja el test como estaba.
function runTareaTests(tarea) {
  return new Promise((resolve) => {
    const plan = normalizarTestsPlan(tarea.testsPlan);
    const conId = plan.tests.filter((t) => t.id);
    if (!conId.length) return resolve({ ok: false, reason: 'no hay tests escritos (con ID) que correr' });
    const cwd = (tarea.worktree && fs.existsSync(tarea.worktree)) ? tarea.worktree : FORGE_DIR;
    const file = plan.testsFile || `forge/tests/tarea-${tarea.num}.test.js`;
    const token = path.basename(String(file)).replace(/\.test\.js$/, '');
    // marca todos en ejecutando
    mutateTestsPlan(ROOT, tarea.id, (p) => {
      const np = normalizarTestsPlan(p);
      return { ...np, tests: np.tests.map((t) => t.id ? { ...t, estado: 'ejecutando' } : t) };
    });
    let out = '';
    let child;
    try {
      child = spawn('node', ['forge/tests/run-forge.js', token], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, reason: 'no pude lanzar el runner: ' + e.message }); }
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5 * 60 * 1000);
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, reason: 'el runner no arrancó' }); });
    child.on('exit', () => {
      clearTimeout(timer);
      // veredicto compartido (mismo parser que usa Miguel desde el MCP).
      let pasa = 0, falla = 0, indet = 0;
      mutateTestsPlan(ROOT, tarea.id, (p) => {
        const np = normalizarTestsPlan(p);
        const r = aplicarResultadosCorrida(np.tests, out);
        pasa = r.pasa; falla = r.falla; indet = r.indet;
        return { ...np, tests: r.tests, ultimaCorrida: new Date().toISOString() };
      });
      resolve({ ok: true, pasa, falla, indet, total: conId.length });
    });
  });
}
app.post('/api/tareas/:id/tests/probar', async (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  try { res.json(await runTareaTests(tarea)); }
  catch (e) { res.status(500).json({ error: 'no se pudo probar: ' + e.message }); }
});

// EDITAR un test a mano (modal): index + campos. ref/nivel/titulo/dado/cuando/entonces.
app.post('/api/tareas/:id/tests/patch', (req, res) => {
  const { index, fields } = req.body || {};
  const i = Number(index);
  if (!Number.isInteger(i) || !fields || typeof fields !== 'object') return res.status(400).json({ error: 'faltan index/fields' });
  const upd = mutateTestsPlan(ROOT, req.params.id, (p) => {
    const np = normalizarTestsPlan(p);
    if (i < 0 || i >= np.tests.length) return np;
    const t = { ...np.tests[i] };
    for (const k of ['ref', 'nivel', 'titulo', 'dado', 'cuando', 'entonces']) {
      if (fields[k] != null) t[k] = String(fields[k]);
    }
    const tests = np.tests.slice(); tests[i] = t;
    return normalizarTestsPlan({ ...np, tests });
  });
  if (!upd) return res.status(404).json({ error: 'tarea no encontrada' });
  res.json({ testsPlan: upd.testsPlan });
});

// BORRAR un test (desde el modal). index.
app.post('/api/tareas/:id/tests/delete', (req, res) => {
  const i = Number((req.body || {}).index);
  if (!Number.isInteger(i)) return res.status(400).json({ error: 'falta index' });
  const upd = mutateTestsPlan(ROOT, req.params.id, (p) => {
    const np = normalizarTestsPlan(p);
    const tests = np.tests.filter((_, idx) => idx !== i);
    return { ...np, tests };
  });
  if (!upd) return res.status(404).json({ error: 'tarea no encontrada' });
  res.json({ testsPlan: upd.testsPlan });
});

// AÑADIR un test a mano (modal "Añadir test"): {ref, nivel, titulo, dado, cuando, entonces}.
// Sirve incluso en tareas fáciles (donde Ana Liz no define). Lo añade al final.
app.post('/api/tareas/:id/tests/add', (req, res) => {
  const f = (req.body && req.body.fields) || {};
  const titulo = String(f.titulo == null ? '' : f.titulo).trim();
  if (!titulo) return res.status(400).json({ error: 'el test necesita al menos un título' });
  const nuevo = {
    ref: String(f.ref || 'general'), nivel: f.nivel === 'persistente' ? 'persistente' : 'temporal',
    titulo, dado: String(f.dado || ''), cuando: String(f.cuando || ''), entonces: String(f.entonces || ''),
  };
  const upd = mutateTestsPlan(ROOT, req.params.id, (p) => {
    const np = normalizarTestsPlan(p);
    return normalizarTestsPlan({ ...np, tests: [...np.tests, nuevo] });
  });
  if (!upd) return res.status(404).json({ error: 'tarea no encontrada' });
  res.json({ testsPlan: upd.testsPlan });
});

// Override MANUAL de la complejidad (Tie): {nivel: 'facil'|'mediana'|'compleja'|''}.
// Vacío borra el override (vuelve a regir la de Aubé). Manda sobre la del plan.
app.post('/api/tareas/:id/complejidad', (req, res) => {
  const nivel = String((req.body && req.body.nivel) || '').trim().toLowerCase();
  if (nivel && !COMPLEJIDADES.includes(nivel)) return res.status(400).json({ error: 'complejidad no válida: ' + nivel });
  const out = setTareaComplejidad(ROOT, req.params.id, nivel);
  if (!out) return res.status(404).json({ error: 'tarea no encontrada' });
  res.json({ complejidad: out.complejidad || null, efectiva: complejidadEfectiva(out) });
});

// COMPLETAR la tarea (el GATE — la tarea ya NO se completa sola): sube a master,
// corre los tests, borra los temporales y la deja cerrada. Decisión explícita de Tie.
app.post('/api/tareas/:id/completar', async (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  let merge = null;
  // 1) probar (si hay tests escritos) — Tie ve el resultado en la respuesta
  let prueba = null;
  try { prueba = await runTareaTests(tarea); } catch {}
  // 2) subir a master (reusa el motor existente). Si ya estaba en master, se salta.
  if (!tarea.enMaster) {
    try { merge = await mergeTareaToMaster(tarea.id); }
    catch (e) { return res.status(500).json({ error: 'no se pudo subir a master: ' + e.message, prueba }); }
    // COMPLETAR es la decisión explícita de Tie: la tarea queda HECHA (enMaster ✓).
    // El motor solo marca 'brought' (🌳) cuando el merge fue VACÍO (build sin cambios)
    // o aplicó sin commit; aquí forzamos enMaster en cualquier cierre OK, para que no
    // se quede a medias (🌳 75%) tras completar. Si el merge fue incompatible, error.
    if (merge && merge.ok === false) {
      return res.status(409).json({ error: merge.error || 'el build no encaja con master', prueba, merge });
    }
    try { markTareaEnMaster(ROOT, tarea.id, (merge && merge.commit) || null); } catch {}
  }
  // 3) borrar los tests TEMPORALES (lo persistente se queda como regresión)
  mutateTestsPlan(ROOT, tarea.id, (p) => quitarTemporales(p));
  res.json({ ok: true, prueba, merge });
});

// ── la tarea como objeto vivo (F9b): abrir + editar su definición ────────────
// Abrir una tarea: asegura su HILO propio (lo crea perezosamente la 1ª vez) y
// devuelve la tarea con su threadId. El front pone la definición fija arriba y
// abre ese hilo en el centro.
app.post('/api/tareas/:id/open', (req, res) => {
  try {
    const t = ensureTareaThread(ROOT, req.params.id);
    res.json({ ...t, origen: resolveOrigen(ROOT, t) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Borrar una tarea (DEFINITIVO). El plan VUELVE a su conversación origen: el stub
// "[Tarea NNN creada: …]" se restaura al plan de Aubé que dejó atrás. También se
// borra su HILO propio (tarea-hilo) — y con él los stubs de tareas que nacieran de
// ESTE hilo, que quedan así sin upstream (se elimina y listo). 404 si no existe.
app.delete('/api/tareas/:id', (req, res) => {
  const tarea = readTarea(ROOT, req.params.id);
  if (!tarea) return res.status(404).json({ error: 'tarea no encontrada' });
  // devuelve el plan a la conversación origen (best-effort: si la fuente ya no
  // existe, no hay nada que restaurar).
  if (tarea.fromChat && tarea.fromMsg != null) {
    try { restoreStubbedMessage(ROOT, tarea.fromChat, tarea.fromMsg); }
    catch (e) { console.error('[forge] no pude restaurar el plan en la conversación origen:', e.message); }
  }
  // su hilo propio se va con ella.
  if (tarea.threadId) { try { deleteChat(ROOT, tarea.threadId); } catch {} }
  try { deleteTarea(ROOT, req.params.id); }
  catch (e) { return res.status(500).json({ error: 'no se pudo borrar la tarea: ' + e.message }); }
  res.json({ deleted: req.params.id, restored: tarea.fromChat && tarea.fromMsg != null ? { chat: tarea.fromChat, msg: tarea.fromMsg } : null });
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
  // re-Ejecutar empieza de cero: si quedó un worktree de un intento anterior, lo
  // LIMPIAMOS (worktree remove --force + prune + borrar su rama) antes de abrir uno
  // nuevo. Si no, se acumularía basura en .wt/ con cada reintento. Best-effort.
  if (tarea.worktree) {
    const oldRepo = tarea.buildRepo || repo;
    spawnSync('git', ['-C', oldRepo, 'worktree', 'remove', '--force', tarea.worktree], { encoding: 'utf8' });
    try { if (fs.existsSync(tarea.worktree)) fs.rmSync(tarea.worktree, { recursive: true, force: true }); } catch {}
    spawnSync('git', ['-C', oldRepo, 'worktree', 'prune'], { encoding: 'utf8' });
    if (tarea.branch) spawnSync('git', ['-C', oldRepo, 'branch', '-D', tarea.branch], { encoding: 'utf8' });
    console.log(`[forge] tarea ${tarea.id}: limpiado el worktree anterior antes de re-ejecutar.`);
  }
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

  // SIEMBRA la DIANA en el worktree nuevo: si Ana Liz ya escribió tests (con código),
  // re-ensambla su fichero aquí para que Miguel pueda CORRERLO desde dentro (TDD).
  // El worktree nace de la base limpia, así que el fichero hay que volcarlo a mano.
  const planTests = normalizarTestsPlan(tarea.testsPlan);
  const hayEscritos = planTests.tests.some((t) => t.codigo && t.codigo.trim());
  if (hayEscritos) {
    try {
      const rel = planTests.testsFile || `forge/tests/tarea-${tarea.num}.test.js`;
      const abs = path.join(wtPath, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, ensamblarTestFile(tarea.testsPlan, { num: tarea.num, title: tarea.title }));
      console.log(`[forge] tarea ${tarea.id}: diana (${rel}) sembrada en el worktree de Miguel.`);
    } catch (e) { console.error('[forge] no pude sembrar la diana en el worktree:', e.message); }
  }

  // Mensaje VIVO de Miguel: nace ya en el hilo (placeholder) y se va reescribiendo
  // con el resumen en vivo (Haiku, cada 10s); su informe final lo REEMPLAZA encima
  // (FORGE_REPLACE_MSG_ID). Un solo mensaje que evoluciona — snapshot, no append.
  // Antes de arrancar: apaga cualquier mensaje de build VIEJO que quedara "vivo"
  // (intento superado, fantasma). Así no se acumulan y no mienten en el hilo ni
  // bloquean "Subir a master" más adelante.
  try {
    for (const m of (readChat(ROOT, tarea.threadId)?.messages || [])) {
      if (m.live && m.author === 'miguel') {
        try { setMessageLive(ROOT, tarea.threadId, m.id, false); } catch {}
        try { replaceMessageText(ROOT, tarea.threadId, m.id, '🔨 (intento anterior, superado)'); } catch {}
      }
    }
  } catch {}

  let liveMsg;
  try {
    liveMsg = appendMessage(ROOT, tarea.threadId, {
      type: 'build', author: 'miguel', intent: 'answer', replyTo: null,
      text: '🔨 Miguel está arrancando…',
    });
    try { setMessageLive(ROOT, tarea.threadId, liveMsg.id, true); } catch {}
  } catch (e) { return res.status(500).json({ error: 'no pude crear el mensaje de Miguel: ' + e.message }); }

  const definicion = `${tarea.title}\n\n${tarea.body || ''}`.trim();
  launchHeadless({
    chatId: tarea.threadId,
    cwd: wtPath,
    // herramientas DERIVADAS del perfil de Miguel (lee:todo + escribe:codigo + sus MCP).
    timeoutMs: 30 * 60 * 1000, // construir lleva más que charlar
    liveMsgId: liveMsg.id,     // resumen en vivo (Haiku) reescribe este mensaje
    prompt: miguelPrompt({
      threadText: buildThreadText(tarea.threadId),
      definicion,
      target: targetDesc(),
      steer: req.body && req.body.steer,
      voz: vozDe('miguel'),
      tests: planTests.tests,            // su DIANA (las definiciones de Ana Liz)
      puedeCorrerTests: hayEscritos,     // ¿hay fichero de test sembrado que correr?
    }),
    // REPLACE: el informe final de Miguel reemplaza su propio mensaje vivo.
    // APPEND: el informe final de Miguel es un mensaje APARTE (cuelga del vivo), así
    // el resumen en vivo nunca lo pisa. El vivo se cierra "en pasado" al terminar.
    extraEnv: { FORGE_REPLY_TO: String(liveMsg.id), FORGE_MSG_TYPE: 'build', FORGE_INTENT: 'answer', FORGE_AUTHOR: 'miguel', FORGE_WORKDIR: wtPath },
    // GATE DE COMPLETADO (decisión de Tie 2026-06-06): la tarea YA NO se sube sola a
    // master al terminar Miguel. Se queda "terminada" esperando que Tie pulse
    // "✅ Completar" (que sube a master + borra los temporales). Aquí solo, si hay
    // tests ESCRITOS, los corremos para que Tie vea el resultado antes de decidir.
    onDone: ({ failed }) => {
      if (failed) { console.log(`[forge] Miguel petó la tarea ${tarea.id}.`); return; }
      // Miguel acabó el build → la tarea pasa a 'terminada' 🌳 (espera a "Completar").
      try { markTareaConstruido(ROOT, tarea.id); } catch {}
      console.log(`[forge] Miguel terminó la tarea ${tarea.id}; esperando aprobación de Tie.`);
      try {
        const t = readTarea(ROOT, tarea.id);
        const plan = normalizarTestsPlan(t && t.testsPlan);
        if (plan.tests.some((x) => x.id && x.estado !== 'definido')) {
          runTareaTests(t).catch((e) => console.error('[forge] auto-probar reventó:', e.message));
        }
      } catch {}
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
  // build EN VIVO: mientras Miguel siga construyendo (mensaje vivo en el hilo) no se
  // sube nada a medias. (Un huérfano de una sesión anterior se apaga al arrancar.)
  if (tarea.threadId != null) {
    try {
      // SOLO el ÚLTIMO build de Miguel cuenta como "construyendo". Banderas "vivo"
      // pegadas en mensajes anteriores son fantasmas de intentos superados (no un
      // build en curso) y NO deben bloquear "Subir a master" para siempre.
      const migueles = (readChat(ROOT, tarea.threadId)?.messages || []).filter((m) => m.author === 'miguel');
      const ultimo = migueles[migueles.length - 1];
      if (ultimo && ultimo.live) return { traible: false, reason: 'construyendo' };
    } catch {}
  }
  // build INTERRUMPIDO (huérfano apagado al arrancar): el worktree quedó a medias →
  // hay que relanzar a Miguel, no fusionar lo incompleto.
  if (tarea.miguelInterrumpido) return { traible: false, reason: 'build interrumpido' };
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
      // herramientas DERIVADAS del perfil del revisor (lee:todo + escribe:codigo + contestar).
      timeoutMs: 15 * 60 * 1000,
      liveMsgId: liveMsg.id,
      prompt: mergeReviewerPrompt({ definicion: `${t2.title}\n\n${t2.body || ''}`.trim(), repoDesc, ficheros, voz: vozDe('revisor') }),
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

// El forge es una herramienta LOCAL de larga vida: un error suelto en un callback
// asíncrono (un spawn que peta, un JSON corrupto, una promesa rechazada) NO debe
// tumbar TODO el servidor. Sin estos manejadores, Node mata el proceso ante
// cualquier excepción no capturada — la causa de que la forja "se cayera sola muy a
// menudo". Ahora se registra y se sigue vivo; el log dice qué reventó para corregirlo.
process.on('uncaughtException', (e) => {
  console.error('[forge] ⚠️ excepción no capturada (sigo vivo):', (e && e.stack) || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[forge] ⚠️ promesa rechazada sin capturar (sigo vivo):', (e && e.stack) || e);
});

// Al arrancar: apaga los builds HUÉRFANOS de una sesión anterior (mensajes que
// quedaron "vivos" sin proceso detrás). Cada uno se reescribe con el aviso de
// interrupción; si el huérfano era un build de Miguel dentro de una tarea, la tarea
// queda marcada "interrumpida" (bloquea "Subir a master" hasta relanzarlo).
function sweepOrphanLiveBuildsAtBoot() {
  let tocados = [];
  try { tocados = sweepLiveBuilds(ROOT); } catch (e) { console.error('[forge] barrido de huérfanos falló:', e.message); return; }
  if (!tocados.length) return;
  const tareaPorThread = new Map();
  try { for (const meta of listTareas(ROOT)) { const t = readTarea(ROOT, meta.id); if (t && t.threadId != null) tareaPorThread.set(String(t.threadId), t.id); } } catch {}
  // agrupa por hilo los mensajes de Miguel que se apagaron
  const apagadosPorHilo = new Map();
  for (const { chatId, msgId, author } of tocados) {
    if (author !== 'miguel') continue;
    if (!apagadosPorHilo.has(String(chatId))) apagadosPorHilo.set(String(chatId), new Set());
    apagadosPorHilo.get(String(chatId)).add(msgId);
  }
  for (const [chatId, apagados] of apagadosPorHilo) {
    const tareaId = tareaPorThread.get(String(chatId));
    if (tareaId == null) continue;
    // La tarea solo queda INTERRUMPIDA si el que estaba vivo era el ÚLTIMO build de
    // Miguel (el que corría al morir la máquina). Si el último Miguel ya estaba
    // cerrado y lo apagado eran fantasmas de intentos viejos, NO está interrumpida.
    let ultimoMiguelId = null;
    try {
      const migueles = (readChat(ROOT, chatId)?.messages || []).filter((m) => m.author === 'miguel');
      ultimoMiguelId = migueles.length ? migueles[migueles.length - 1].id : null;
    } catch {}
    if (ultimoMiguelId != null && apagados.has(ultimoMiguelId)) {
      try { markTareaInterrumpido(ROOT, tareaId); } catch {}
    }
  }
  console.log(`[forge] barrido de arranque: ${tocados.length} build(s) huérfano(s) apagado(s).`);
}

// ¿qué tarea cuelga de este hilo? (su threadId === chatId). null si ninguna.
function tareaIdForThread(chatId) {
  try {
    for (const meta of listTareas(ROOT)) {
      const t = readTarea(ROOT, meta.id);
      if (t && String(t.threadId) === String(chatId)) return t.id;
    }
  } catch {}
  return null;
}

// ¿sigue vivo ese PID? `kill(pid, 0)` no mata: solo pregunta. ESRCH = no existe;
// EPERM = existe pero no es nuestro (cuenta como vivo). Cualquier otro fallo → muerto.
function procesoVivo(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// Da un build por INTERRUMPIDO: apaga el mensaje vivo, lo reescribe con el aviso y,
// si era un build de Miguel en una tarea, la marca interrumpida (bloquea "Subir a master").
function marcarBuildInterrumpido(chatId, msgId, author, motivo) {
  try { setMessageLive(ROOT, chatId, msgId, false); } catch {}
  try { replaceMessageText(ROOT, chatId, msgId, `⚠️ El trabajo se interrumpió (${motivo}). Vuelve a lanzarlo.`); } catch {}
  if (author === 'miguel') {
    const tareaId = tareaIdForThread(chatId);
    if (tareaId != null) { try { markTareaInterrumpido(ROOT, tareaId); } catch {} }
  }
}

// VIGILANTE de builds en vivo: cada 30s revisa los que llevan rato sin latido (>60s).
// Un latido viejo solo no basta para matar (un Bash largo no escribe nada): por eso
// COMPROBAMOS si el proceso sigue vivo. Si está vivo pero callado, lo dejamos (el
// ticker ya avisa "sin señal" en el navegador). Si el proceso ya no existe y su exit
// nunca llegó (zombie / muerto externamente), lo damos por interrumpido y avisamos.
const LIVE_STALE_MS = 60 * 1000;
function vigilarBuildsVivos() {
  for (const [msgId, entry] of LIVE_BUILDS) {
    try {
      const msg = (readChat(ROOT, entry.chatId)?.messages || []).find((m) => m.id === Number(msgId));
      if (!msg || !msg.live) { LIVE_BUILDS.delete(msgId); continue; }
      const ping = Number(msg.livePingAt || msg.liveStartedAt || 0);
      if (ping && (Date.now() - ping) < LIVE_STALE_MS) continue;   // latido reciente → sano
      if (procesoVivo(entry.pid)) continue;                        // callado pero vivo → lo dejo
      marcarBuildInterrumpido(entry.chatId, Number(msgId), entry.author || msg.author, 'el proceso ya no responde');
      LIVE_BUILDS.delete(msgId);
      console.log(`[forge] build ${msgId}: sin señal y sin proceso → marcado interrumpido.`);
    } catch { /* un fallo puntual no debe tumbar el vigilante */ }
  }
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Forge en ${url}`);
  sweepOrphanLiveBuildsAtBoot();
  setInterval(vigilarBuildsVivos, 30 * 1000);
  openBrowser(url);
});
