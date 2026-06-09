/**
 * forge-store.js — el almacén de conversaciones del forge (una sola verdad).
 *
 * Compartido por el servidor (`scripts/forge.js`) y por el servidor MCP
 * (`scripts/forge-mcp.js`), para que ambos lean y escriban los ficheros
 * sprint/chats/NNN.json con la MISMA lógica (numeración, ids de mensaje,
 * escritura atómica). Nadie duplica el formato.
 *
 * Una conversación = sprint/chats/NNN.json:
 *   { id, num, type, title, createdAt, messages: [ msg... ] }
 * Un mensaje:
 *   { id, type, author, intent, replyTo, text, at }
 *     - id      : entero correlativo DENTRO del chat (1, 2, 3…) → permite replyTo
 *     - type    : tipo de la intervención (p.ej. 'charla')
 *     - author  : 'tie' | 'iris' | 'william' | …
 *     - intent  : 'request' | 'challenge' | 'answer'
 *     - replyTo : id del mensaje al que contesta (o null)
 */

import fs from 'fs';
import path from 'path';

export function chatsDir(root) {
  return path.join(root, 'forge', 'sprint', 'chats');
}

export function tareasDir(root) {
  return path.join(root, 'forge', 'sprint', 'tareas');
}

// ── estado del ciclo (la forja) ──────────────────────────────────────────────
// Un único sidecar sprint/cycle.json guarda {cursor, paused}; persiste a
// reinicios. La LÓGICA de fases/transporte vive en forge-firme.js (pura); aquí
// solo el disco. Si falta o está corrupto, se devuelve null (forge.js pone el
// default y lo escribe).
export function cyclePath(root) {
  return path.join(root, 'forge', 'sprint', 'cycle.json');
}

export function readCycle(root) {
  try { return JSON.parse(fs.readFileSync(cyclePath(root), 'utf8')); }
  catch { return null; }
}

export function writeCycle(root, state) {
  atomicWrite(cyclePath(root), JSON.stringify(state, null, 2) + '\n');
  return state;
}

// ── scratch del ANÁLISIS de arranque del ciclo ───────────────────────────────
// "Empezar ciclo" lanza dos analistas headless (Iris → rama + frentes; William →
// tecnologías externas). Su criterio (datos puros) lo graban vía MCP en estos
// sidecars, y el servidor (determinista) los consume al salir el analista: crea la
// rama, abre una conversación por frente y otra por sugerencia. `kind` = 'plan'
// (Iris) | 'tech' (William). Efímero: se borra al empezar y tras consumirse.
export function cyclePlanPath(root, kind) {
  const safe = kind === 'tech' ? 'tech' : 'plan';
  return path.join(root, 'forge', 'sprint', `cycle-${safe}.json`);
}

export function readCyclePlan(root, kind) {
  try { return JSON.parse(fs.readFileSync(cyclePlanPath(root, kind), 'utf8')); }
  catch { return null; }
}

export function writeCyclePlan(root, kind, data) {
  atomicWrite(cyclePlanPath(root, kind), JSON.stringify(data, null, 2) + '\n');
  return data;
}

export function clearCyclePlan(root, kind) {
  try { fs.unlinkSync(cyclePlanPath(root, kind)); } catch {}
}

// ── modelo global de los headless ────────────────────────────────────────────
// Un sidecar sprint/model.json guarda {model: <alias>}; persiste a reinicios. La
// elección la pone el selector de la UI y vale para TODOS los personajes. Vacío o
// corrupto → null (forge.js usa entonces el modelo por defecto del CLI).
export function modelPath(root) {
  return path.join(root, 'forge', 'sprint', 'model.json');
}

export function readModel(root) {
  try { return JSON.parse(fs.readFileSync(modelPath(root), 'utf8')).model || null; }
  catch { return null; }
}

export function writeModel(root, model) {
  atomicWrite(modelPath(root), JSON.stringify({ model: model || null }, null, 2) + '\n');
  return model || null;
}

// Escritura atómica con retry de EPERM en win32 (patrón de sprint.js/mesa.js).
export function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, contents);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && i < 10) {
        const until = Date.now() + 25; while (Date.now() < until) { /* spin */ }
        continue;
      }
      try { fs.writeFileSync(file, contents); try { fs.unlinkSync(tmp); } catch {} return; }
      catch { throw e; }
    }
  }
}

// ── lock por chat ────────────────────────────────────────────────────────────
// El read-modify-write (append / replace) puede pisarse entre headless paralelos
// (lost-update). Serializamos por chat con un mkdir atómico; un lock más viejo de
// 5 s se considera huérfano y se reclama.
function lockPath(root, id) {
  const safe = String(id).replace(/[^0-9]/g, '');
  return path.join(chatsDir(root), '.' + safe + '.lock');
}

export function withChatLock(root, id, fn) {
  const lp = lockPath(root, id);
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(lp); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(lp).mtimeMs; } catch {}
      // lock huérfano (viejo) o agotamos la espera → lo reclamamos.
      if (age > 5000 || Date.now() > deadline) { try { fs.rmdirSync(lp); } catch {} continue; }
      const until = Date.now() + 20; while (Date.now() < until) { /* spin corto */ }
    }
  }
  try { return fn(); }
  finally { try { fs.rmdirSync(lp); } catch {} }
}

export function pad(n) { return String(n).padStart(3, '0'); }

export function chatPath(root, id) {
  const safe = String(id).replace(/[^0-9]/g, '');
  if (!safe) return null;
  return path.join(chatsDir(root), safe + '.json');
}

export function readChat(root, id) {
  const p = chatPath(root, id);
  if (!p || !fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeChat(root, chat) {
  atomicWrite(chatPath(root, chat.id), JSON.stringify(chat, null, 2) + '\n');
}

export function listChats(root) {
  let files = [];
  try { files = fs.readdirSync(chatsDir(root)); } catch { return []; }
  return files
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(chatsDir(root), f), 'utf8'));
        return { id: c.id, num: c.num, type: c.type, title: c.title, createdAt: c.createdAt };
      } catch { return null; }
    })
    .filter(Boolean)
    // los hilos PROPIOS de las tareas (type 'tarea-hilo') no son conversaciones
    // sueltas: no aparecen en la lista de la izquierda, se abren desde la tarea.
    .filter((c) => c.type !== 'tarea-hilo')
    .sort((a, b) => (a.num || 0) - (b.num || 0));
}

export function nextNum(root) {
  let files = [];
  try { files = fs.readdirSync(chatsDir(root)); } catch {}
  let max = 0;
  for (const f of files) {
    const m = f.match(/^(\d+)\.json$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function createChat(root, { type, title, target } = {}) {
  const num = nextNum(root);
  const id = pad(num);
  const chat = {
    id, num,
    type: type || 'tarea',
    title: (title && String(title).trim()) || `Conversación ${id}`,
    // objetivo (forge|project) al que pertenece la conversación. Lo usan las
    // conversaciones de backlog: una por objetivo (ver findBacklogChat en forge.js).
    ...(target ? { target } : {}),
    createdAt: new Date().toISOString(),
    messages: [],
  };
  writeChat(root, chat);
  return chat;
}

// Borra una conversación de disco (borrado DEFINITIVO). Devuelve true si existía y
// se borró, false si no existía. Idempotente. (Construido por Miguel, tarea #001.)
export function deleteChat(root, id) {
  const p = chatPath(root, id);
  if (!p || !fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

// Renombra la conversación (solo el título). Serializado por chat. Un título
// vacío se ignora (conserva el anterior). Devuelve el chat resultante.
export function renameChat(root, id, title) {
  return withChatLock(root, id, () => {
    const chat = readChat(root, id);
    if (!chat) throw new Error('conversación no encontrada: ' + id);
    const t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    if (t) chat.title = t;
    writeChat(root, chat);
    return chat;
  });
}

// Añade un mensaje al chat (read-modify-write fresco de disco). Devuelve el
// mensaje creado (con su id) o lanza si el chat no existe.
export function appendMessage(root, id, { type, author, intent, replyTo, text, stance }) {
  return withChatLock(root, id, () => {
    const chat = readChat(root, id);
    if (!chat) throw new Error('conversación no encontrada: ' + id);
    if (!Array.isArray(chat.messages)) chat.messages = [];
    const nextId = chat.messages.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    const msg = {
      id: nextId,
      type: type || 'charla',
      author: author || 'tie',
      intent: intent || 'request',
      replyTo: (replyTo === undefined ? null : replyTo),
      text: String(text == null ? '' : text),
      at: new Date().toISOString(),
    };
    // Discutir: el lado de la pareja (defiende|rechaza). Solo si viene; el front lo
    // lee para que el siguiente turno tome el lado contrario.
    if (stance) msg.stance = stance;
    chat.messages.push(msg);
    writeChat(root, chat);
    return msg;
  });
}

// Reemplaza SOLO el texto de un mensaje existente, conservando id/author/replyTo
// (la "edición": el texto cambia, la cara de quien lo dijo no). NO crea mensaje
// nuevo ni bifurca. Marca edited/editedAt. Lanza si el mensaje no existe.
export function replaceMessageText(root, id, msgId, text) {
  return withChatLock(root, id, () => {
    const chat = readChat(root, id);
    if (!chat) throw new Error('conversación no encontrada: ' + id);
    const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
    if (!msg) throw new Error('mensaje no encontrado: ' + msgId);
    msg.text = String(text == null ? '' : text);
    msg.edited = true;
    msg.editedAt = new Date().toISOString();
    writeChat(root, chat);
    return msg;
  });
}

// Borra UN mensaje de un hilo sobre el árbol replyTo. Serializado por chat.
//   - cascade=true  → borra el mensaje y TODOS sus descendientes (subárbol entero).
//   - cascade=false → borra solo ese mensaje y re-cuelga sus hijos DIRECTOS al
//                     replyTo del borrado (si era raíz → null: quedan como nuevas
//                     raíces). Los nietos no se tocan (siguen colgando de sus padres).
// Idempotente: un msgId inexistente no lanza, devuelve { removed:[], reparented:[] }
// y deja el chat igual. Devuelve { removed:[ids], reparented:[{id,replyTo}] }.
export function deleteMessage(root, id, msgId, { cascade = false } = {}) {
  return withChatLock(root, id, () => {
    const chat = readChat(root, id);
    if (!chat) throw new Error('conversación no encontrada: ' + id);
    const messages = chat.messages || [];
    const target = messages.find((m) => m.id === Number(msgId));
    if (!target) return { removed: [], reparented: [] };

    const removed = [];
    const reparented = [];

    if (cascade) {
      // Subárbol entero: el target y todo lo que (transitivamente) le cuelga.
      const kill = new Set([target.id]);
      let crecio = true;
      while (crecio) {
        crecio = false;
        for (const m of messages) {
          if (!kill.has(m.id) && m.replyTo != null && kill.has(m.replyTo)) {
            kill.add(m.id); crecio = true;
          }
        }
      }
      chat.messages = messages.filter((m) => !kill.has(m.id));
      removed.push(...[...kill].sort((a, b) => a - b));
    } else {
      // Solo el target: sus hijos directos se re-cuelgan de su replyTo.
      const nuevoPadre = (target.replyTo === undefined ? null : target.replyTo);
      for (const m of messages) {
        if (m.replyTo === target.id) {
          m.replyTo = nuevoPadre;
          reparented.push({ id: m.id, replyTo: nuevoPadre });
        }
      }
      chat.messages = messages.filter((m) => m.id !== target.id);
      removed.push(target.id);
    }

    writeChat(root, chat);
    return { removed, reparented };
  });
}

// ── el vínculo conversación ↔ tarea (el "stub" de Aubé) ──────────────────────
// Cuando se APRUEBA una tarea desde un mensaje de Aubé, ese mensaje no se borra:
// se COLAPSA en un stub "[Tarea NNN creada: título]" que apunta a la tarea
// (tareaRef) y guarda su plan original (stashed) para poder devolverlo. Click en
// el stub → abre la tarea. Idempotente (no re-guarda stashed si ya lo está).
export function stubMessageForTarea(root, chatId, msgId, { tareaId, title } = {}) {
  return withChatLock(root, chatId, () => {
    const chat = readChat(root, chatId);
    if (!chat) return null;
    const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
    if (!msg) return null;
    if (msg.stashed == null) msg.stashed = msg.text;   // conserva el plan original
    msg.tareaRef = tareaId;
    msg.text = `[Tarea ${tareaId} creada: ${title || ('Tarea ' + tareaId)}]`;
    writeChat(root, chat);
    return msg;
  });
}

// Adjunta a un mensaje el PLAN estructurado de Aubé (DETERMINISTA: viene del MCP
// `proponer_plan`, no de parsear texto) y, opcional, reescribe su texto con el render
// legible. `msg.plan` es la fuente canónica que /api/tareas lee sin parsear. Round-trip
// acotado y seguro. Devuelve el mensaje, o null si no existe.
export function setMessagePlan(root, chatId, msgId, { plan, text } = {}) {
  return withChatLock(root, chatId, () => {
    const chat = readChat(root, chatId);
    if (!chat) return null;
    const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
    if (!msg) return null;
    if (plan && typeof plan === 'object') msg.plan = plan;
    if (typeof text === 'string') msg.text = text;
    delete msg.live;   // el plan ya llegó: deja de ser un latido
    writeChat(root, chat);
    return msg;
  });
}

// Deshace el stub: devuelve el mensaje a su plan original (stashed) y le quita la
// referencia a la tarea. Es lo que corre al BORRAR una tarea (el plan vuelve a su
// conversación origen). Idempotente; null si el chat/mensaje no existe.
export function restoreStubbedMessage(root, chatId, msgId) {
  return withChatLock(root, chatId, () => {
    const chat = readChat(root, chatId);
    if (!chat) return null;
    const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
    if (!msg) return null;
    if (msg.stashed != null) msg.text = msg.stashed;
    delete msg.stashed;
    delete msg.tareaRef;
    writeChat(root, chat);
    return msg;
  });
}

// Estampa el COSTE de un mensaje (la chapa $ de la UI). NO es una edición de
// contenido: no toca `text` ni marca `edited`. Añade `runId` (el spawn que lo
// produjo), `cost` ({ usd, usageFound }) y, opcional, `costPrimary` (solo UNO de
// los mensajes de un run lo lleva → una sola chapa). Best-effort: idempotente,
// devuelve null (sin lanzar) si el chat o el mensaje no existen.
export function stampMessageCost(root, id, msgId, { runId, costUsd, usageFound, costPrimary } = {}) {
  try {
    return withChatLock(root, id, () => {
      const chat = readChat(root, id);
      if (!chat) return null;
      const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
      if (!msg) return null;
      if (runId !== undefined) msg.runId = runId;
      msg.cost = { usd: (costUsd === undefined ? null : costUsd), usageFound: !!usageFound };
      if (costPrimary) msg.costPrimary = true;
      writeChat(root, chat);
      return msg;
    });
  } catch {
    return null;
  }
}

// Marca/desmarca un mensaje como BUILD EN VIVO (Miguel/revisor construyendo). El
// front pinta el botón "📸 Resumir" solo en los mensajes con `live:true`. Round-trip
// acotado y seguro (solo voltea el flag). Se limpia cuando el build termina.
export function setMessageLive(root, id, msgId, val) {
  try {
    return withChatLock(root, id, () => {
      const chat = readChat(root, id);
      if (!chat) return null;
      const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
      if (!msg) return null;
      if (val) msg.live = true; else delete msg.live;
      writeChat(root, chat);
      return msg;
    });
  } catch { return null; }
}

// Estampa el LATIDO de un mensaje vivo: su texto + los TIMESTAMPS (arranque y último
// ping) para que el navegador calcule "hace Xs" EN VIVO (no un número congelado). El
// front lee `liveStartedAt`/`livePingAt` y los tickea cada segundo. Round-trip acotado.
export function setLiveBeat(root, id, msgId, { text, startedAt, pingAt } = {}) {
  try {
    return withChatLock(root, id, () => {
      const chat = readChat(root, id);
      if (!chat) return null;
      const msg = (chat.messages || []).find((m) => m.id === Number(msgId));
      if (!msg) return null;
      if (typeof text === 'string') msg.text = text;
      msg.live = true;
      if (startedAt != null) msg.liveStartedAt = Number(startedAt);
      if (pingAt != null) msg.livePingAt = Number(pingAt);
      writeChat(root, chat);
      return msg;
    });
  } catch { return null; }
}

// Barre TODOS los chats apagando los mensajes que quedaron marcados "vivo" sin un
// proceso detrás (builds HUÉRFANOS: la máquina se reinició o el headless se cortó
// sin disparar su `exit`). Por definición, al arrancar el servidor NO hay ninguno
// corriendo, así que cualquier `live:true` es basura: lo apagamos y reescribimos su
// texto con el aviso de interrupción. Devuelve [{ chatId, msgId, author }] de los que
// tocó (el server los usa para marcar la tarea afectada). No lanza.
export function sweepLiveBuilds(root) {
  const tocados = [];
  for (const meta of listChats(root)) {
    try {
      withChatLock(root, meta.id, () => {
        const chat = readChat(root, meta.id);
        if (!chat) return;
        let cambiado = false;
        for (const msg of (chat.messages || [])) {
          if (!msg.live) continue;
          delete msg.live;
          delete msg.liveStartedAt;
          delete msg.livePingAt;
          msg.text = '⚠️ El trabajo se interrumpió (se reinició la máquina). Vuelve a lanzarlo.';
          tocados.push({ chatId: chat.id, msgId: msg.id, author: msg.author });
          cambiado = true;
        }
        if (cambiado) writeChat(root, chat);
      });
    } catch { /* un chat ilegible no debe tumbar el barrido */ }
  }
  return tocados;
}

// ── tareas (columna derecha) ─────────────────────────────────────────────────
// Una tarea aprobada por Aubé vive en sprint/tareas/NNN.json, INDEPENDIENTE del
// producto: la forge no toca project/ ni el BACKLOG. Esquema simple.
//   { id, num, title, body, fromChat, createdAt }
export function listTareas(root) {
  let files = [];
  try { files = fs.readdirSync(tareasDir(root)); } catch { return []; }
  return files
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(tareasDir(root), f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.num || 0) - (b.num || 0));
}

export function createTarea(root, { title, body, fromChat, fromMsg, subtareas, plan } = {}) {
  let files = [];
  try { files = fs.readdirSync(tareasDir(root)); } catch {}
  let max = 0;
  for (const f of files) {
    const m = f.match(/^(\d+)\.json$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const num = max + 1;
  const id = pad(num);
  const tarea = {
    id, num,
    title: (title && String(title).trim()) || `Tarea ${id}`,
    body: String(body == null ? '' : body),
    fromChat: fromChat || null,
    // fromMsg: el id del mensaje de Aubé (en `fromChat`) que esta tarea sustituyó
    // por su stub "[Tarea NNN creada: …]". Al borrar la tarea, devolvemos ESE
    // mensaje a su plan original (restoreStubbedMessage). null = nació sin origen.
    fromMsg: (fromMsg == null ? null : Number(fromMsg)),
    createdAt: new Date().toISOString(),
  };
  // Si Aubé partió la tarea en carriles paralelos, se guardan aquí; el motor
  // (forge-estado.js) deriva de ellos el estado del padre. Sin partir → se omite
  // y el motor sintetiza la única subtarea `main` de alcance completo.
  if (Array.isArray(subtareas) && subtareas.length > 1) tarea.subtareas = subtareas;
  // El PLAN estructurado de Aubé (resumen + partes + contrato). Nace SIN aprobar;
  // se aprueba aparte (approveTareaPlan) antes de paralelizar/construir.
  if (plan && typeof plan === 'object') tarea.plan = plan;
  atomicWrite(path.join(tareasDir(root), id + '.json'), JSON.stringify(tarea, null, 2) + '\n');
  return tarea;
}

// Guarda/reemplaza el PLAN estructurado de la tarea (de Aubé o editado a mano).
// Lo deja SIN aprobar (un plan nuevo siempre vuelve a la cola de aprobación).
// Devuelve la tarea, o null si no existe.
export function setTareaPlan(root, id, plan) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  tarea.plan = (plan && typeof plan === 'object') ? { ...plan, aprobado: false, aprobadoAt: null } : null;
  return writeTarea(root, tarea);
}

// Override MANUAL de la complejidad por Tie (manda sobre la de Aubé en el plan).
// `nivel` vacío/null borra el override (vuelve a regir la de Aubé). Devuelve la tarea.
export function setTareaComplejidad(root, id, nivel) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  const n = String(nivel == null ? '' : nivel).trim().toLowerCase();
  if (n) tarea.complejidad = n; else delete tarea.complejidad;
  return writeTarea(root, tarea);
}

// Marca el plan como APROBADO (la puerta antes de paralelizar). Idempotente.
// Devuelve la tarea, o null si no existe / no tiene plan.
export function approveTareaPlan(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea || !tarea.plan) return null;
  tarea.plan.aprobado = true;
  tarea.plan.aprobadoAt = new Date().toISOString();
  return writeTarea(root, tarea);
}

// Materializa las SUBTAREAS de la tarea (las que produce "Paralelizar" desde el
// plan aprobado): array de {name, alcance, contrato}. Una lista vacía/nula borra el
// troceo (vuelve a la `main` sintética). Devuelve la tarea, o null si no existe.
export function setTareaSubtareas(root, id, subtareas) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  if (Array.isArray(subtareas) && subtareas.length > 1) tarea.subtareas = subtareas;
  else delete tarea.subtareas;   // una sola pieza → main sintética (el motor la deriva)
  // Sello de "paralelizado AHORA": el front compara este instante con plan.aprobadoAt
  // para saber si la paralelización corresponde a la versión ACTUAL del plan (y así
  // esconder el botón si ya está en sync, o mostrarlo si el plan cambió después).
  tarea.paralelizadoAt = new Date().toISOString();
  return writeTarea(root, tarea);
}

// Guarda/reemplaza el PLAN DE TESTS en papel de Ana Liz (Fase C). Lo deja SIN
// aprobar (replanificar siempre vuelve a la cola). Devuelve la tarea, o null.
export function setTareaTestsPlan(root, id, testsPlan) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  tarea.testsPlan = (testsPlan && typeof testsPlan === 'object')
    ? { ...testsPlan, aprobado: false, aprobadoAt: null }
    : null;
  return writeTarea(root, tarea);
}

// Muta el plan de tests con una función pura `fn(testsPlanActual) → testsPlanNuevo`.
// Lee la tarea, aplica fn sobre su `testsPlan` (o {} si no hay), guarda. Es el carril
// común de las ediciones finas (patch/borrar/promover/cambiar-nivel/sellar/estado),
// para no repetir el read-modify-write. Devuelve la tarea, o null si no existe.
export function mutateTestsPlan(root, id, fn) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  const next = fn(tarea.testsPlan || { tests: [] }) || { tests: [] };
  tarea.testsPlan = next;
  return writeTarea(root, tarea);
}

// Borra una tarea de disco (DEFINITIVO). Devuelve true si existía y se borró. NO
// toca su origen ni su hilo: eso lo orquesta el servidor (restaura el stub y borra
// el tarea-hilo) antes de llamar aquí. Idempotente.
export function deleteTarea(root, id) {
  const p = tareaPath(root, id);
  if (!p || !fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

// Resuelve el LINK ORIGEN de una tarea (la cabecera "↰ viene de …"): de qué
// conversación —o de qué tarea— nació. Se resuelve EN VIVO, así que renombrar la
// fuente renombra el link y borrarla lo hace desaparecer (devuelve null):
//   - fromChat es una conversación normal → { kind:'chat',  id, title }
//   - fromChat es el HILO de otra tarea   → { kind:'tarea', id, title } (la tarea padre)
//   - fromChat no existe / no hay origen  → null (el link se elimina y listo)
export function resolveOrigen(root, tarea) {
  if (!tarea || !tarea.fromChat) return null;
  const chat = readChat(root, tarea.fromChat);
  if (!chat) return null;                              // la fuente se borró → sin link
  if (chat.tareaId) {                                  // la fuente es el hilo de otra tarea
    const padre = readTarea(root, chat.tareaId);
    if (!padre) return null;
    return { kind: 'tarea', id: padre.id, title: padre.title || ('Tarea ' + padre.id) };
  }
  return { kind: 'chat', id: chat.id, title: chat.title || ('Conversación ' + chat.id) };
}

// ── la tarea como objeto vivo: leer / hilo propio / editar definición ────────
export function tareaPath(root, id) {
  const safe = String(id).replace(/[^0-9]/g, '');
  return safe ? path.join(tareasDir(root), safe + '.json') : null;
}
export function readTarea(root, id) {
  const p = tareaPath(root, id);
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeTarea(root, tarea) {
  atomicWrite(tareaPath(root, tarea.id), JSON.stringify(tarea, null, 2) + '\n');
  return tarea;
}

// Asegura que la tarea tenga su propio HILO (un chat aparte, type 'tarea-hilo',
// que NO sale en la lista de conversaciones). Se crea PEREZOSAMENTE al abrir la
// tarea por primera vez (vale también para tareas viejas sin hilo, F9b: hilo en
// blanco). Devuelve la tarea (con threadId).
export function ensureTareaThread(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea) throw new Error('tarea no encontrada: ' + id);
  if (tarea.threadId && fs.existsSync(chatPath(root, tarea.threadId))) return tarea;
  const chat = createChat(root, { type: 'tarea-hilo', title: 'Hilo · ' + (tarea.title || ('Tarea ' + tarea.id)) });
  chat.tareaId = tarea.id;   // el hilo sabe de qué tarea es → su definición es el texto base
  writeChat(root, chat);
  tarea.threadId = chat.id;
  return writeTarea(root, tarea);
}

// Edita la DEFINICIÓN de la tarea (título y/o cuerpo). A mano (Tie) o por Aubé
// (Revisar). Devuelve la tarea actualizada.
export function updateTareaDefinition(root, id, { title, body }) {
  const tarea = readTarea(root, id);
  if (!tarea) throw new Error('tarea no encontrada: ' + id);
  if (title != null && String(title).trim()) tarea.title = String(title).trim();
  if (body != null) tarea.body = String(body);
  tarea.editedAt = new Date().toISOString();
  return writeTarea(root, tarea);
}

// Guarda en la tarea el worktree donde Miguel construyó (al Ejecutar), para poder
// TRAER ese código al árbol vivo después. Devuelve la tarea.
export function setTareaBuild(root, id, { worktree, branch, repo, base } = {}) {
  const tarea = readTarea(root, id);
  if (!tarea) throw new Error('tarea no encontrada: ' + id);
  if (worktree !== undefined) tarea.worktree = worktree;
  if (branch !== undefined) tarea.branch = branch;
  if (repo !== undefined) tarea.buildRepo = repo;
  if (base !== undefined) tarea.base = base;   // sha del que partió el worktree → delta completo al traer
  tarea.builtAt = new Date().toISOString();
  // re-Ejecutar empieza de cero: el build anterior ya no vale, así que las marcas
  // de avance posteriores (traído / en master) se borran para que el panel vuelva
  // a ⏳ cogida y no quede un ✓ mentiroso de un build viejo.
  delete tarea.construido; delete tarea.construidoAt;   // el build anterior ya no cuenta
  delete tarea.brought; delete tarea.broughtAt;
  delete tarea.enMaster; delete tarea.enMasterAt; delete tarea.masterCommit;
  delete tarea.miguelInterrumpido; delete tarea.interrumpidoAt;   // re-lanzar borra el "build interrumpido"
  return writeTarea(root, tarea);
}

// Marca que Miguel ACABÓ de construir (build vivo en el worktree, aún sin subir a
// master): la tarea pasa a 'terminada' 🌳 y espera a "Completar". setTareaBuild la
// limpia al re-Ejecutar. Idempotente; no lanza si la tarea no existe.
export function markTareaConstruido(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  tarea.construido = true;
  tarea.construidoAt = new Date().toISOString();
  return writeTarea(root, tarea);
}

// Marca que el build de Miguel se INTERRUMPIÓ (huérfano: se cortó sin terminar). Bloquea
// "Subir a master" hasta que se relance a Miguel (setTareaBuild lo limpia). Idempotente.
export function markTareaInterrumpido(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  if (tarea.enMaster) return tarea;   // ya cerrada: un huérfano viejo no la reabre
  tarea.miguelInterrumpido = true;
  tarea.interrumpidoAt = new Date().toISOString();
  return writeTarea(root, tarea);
}

// Marca la tarea como "ya traída" al árbol vivo → el botón "Traer el código" pasa
// a deshabilitado. Idempotente; no lanza si la tarea no existe.
export function markTareaBrought(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  tarea.brought = true;
  tarea.broughtAt = new Date().toISOString();
  delete tarea.error; delete tarea.erroredAt;   // traer OK borra cualquier petó previo
  return writeTarea(root, tarea);
}

// Marca que el delta del worktree YA se commiteó a MASTER (icono ✓ verde =
// cierre feliz). Implica que el build terminó (marca también `brought` si no
// estaba) y borra cualquier petó previo. `commit` = sha del commit a master (para
// trazabilidad). Idempotente; no lanza si la tarea no existe.
export function markTareaEnMaster(root, id, commit) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  tarea.brought = true;
  if (!tarea.broughtAt) tarea.broughtAt = new Date().toISOString();
  tarea.enMaster = true;
  tarea.enMasterAt = new Date().toISOString();
  if (commit) tarea.masterCommit = String(commit);
  delete tarea.error; delete tarea.erroredAt;   // entrar en master borra cualquier petó
  return writeTarea(root, tarea);
}

// Marca que la tarea PETÓ (icono ✕ rojo en el panel → cajón "revisar"). Es la señal
// que el ciclo emite cuando Traer no encaja. Idempotente; no lanza si no existe.
export function setTareaError(root, id, message) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  tarea.error = String(message || 'falló');
  tarea.erroredAt = new Date().toISOString();
  return writeTarea(root, tarea);
}

// Limpia el petó (p.ej. al re-Ejecutar: la tarea empieza de cero). Idempotente.
export function clearTareaError(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea) return null;
  if (!tarea.error && !tarea.erroredAt) return tarea;
  delete tarea.error; delete tarea.erroredAt;
  return writeTarea(root, tarea);
}

// El primer ancestro de `msgId` que es "diente" de una bifurcación (su padre
// tiene >1 hijo), o la raíz de su rama. Es el "nacimiento de la rama más cercano".
export function nearestForkAncestor(messages, msgId) {
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  const childCount = new Map();
  for (const m of messages || []) {
    if (m.replyTo != null) childCount.set(m.replyTo, (childCount.get(m.replyTo) || 0) + 1);
  }
  let cur = byId.get(Number(msgId));
  while (cur) {
    const parent = cur.replyTo != null ? byId.get(cur.replyTo) : null;
    if (!parent) return cur;                                   // cur es raíz
    if ((childCount.get(parent.id) || 0) > 1) return cur;      // cur es diente
    cur = parent;
  }
  return null;
}

// COMPACTAR: colapsa (sin borrar) la cadena lineal que la nota-resumen `noteMsgId`
// sustituye — desde su padre hacia arriba hasta el nacimiento de la rama (la
// bifurcación más cercana, inclusive) — y reengancha la nota en el sitio que
// ocupaba la cadena. Las ramas hermanas no se tocan. Reversible (collapsed:true +
// collapsedFrom). Devuelve el chat resultante.
export function collapseUpToFork(root, id, noteMsgId) {
  return withChatLock(root, id, () => {
    const chat = readChat(root, id);
    if (!chat) throw new Error('conversación no encontrada: ' + id);
    const messages = chat.messages || [];
    const byId = new Map(messages.map((m) => [m.id, m]));
    const note = byId.get(Number(noteMsgId));
    if (!note) throw new Error('mensaje no encontrado: ' + noteMsgId);
    const childCount = new Map();
    for (const m of messages) {
      if (m.replyTo != null) childCount.set(m.replyTo, (childCount.get(m.replyTo) || 0) + 1);
    }
    const chain = [];
    let cur = note.replyTo != null ? byId.get(note.replyTo) : null;
    let forkParent = null; // de dónde colgará la nota tras compactar (null = raíz)
    while (cur) {
      // Si `cur` tiene hijos vivos APARTE del eslabón de la cadena (una rama
      // lateral: un challenge, una respuesta a un mensaje viejo…), es un fork:
      // NO lo colapsamos (orfanaría esa rama). Paramos y la nota cuelga de él.
      // (childCount cuenta la propia nota como hijo del primer `cur`; un sole-child
      // limpio da exactamente 1.)
      if ((childCount.get(cur.id) || 0) > 1) { forkParent = cur.id; break; }
      chain.push(cur);
      const parent = cur.replyTo != null ? byId.get(cur.replyTo) : null;
      if (!parent) { forkParent = null; break; }                 // cur es raíz
      if ((childCount.get(parent.id) || 0) > 1) { forkParent = parent.id; break; } // cur es diente: nace aquí
      cur = parent;
    }
    if (!chain.length) return chat; // la nota ya cuelga directa de raíz: nada que colapsar
    for (const m of chain) m.collapsed = true;
    note.collapsedFrom = note.replyTo;  // para poder deshacer
    note.replyTo = forkParent;          // la nota ocupa el hueco de la cadena
    writeChat(root, chat);
    return chat;
  });
}
