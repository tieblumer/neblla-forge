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
  return path.join(root, 'sprint', 'chats');
}

export function tareasDir(root) {
  return path.join(root, 'sprint', 'tareas');
}

// ── estado del ciclo (la forja) ──────────────────────────────────────────────
// Un único sidecar sprint/cycle.json guarda {cursor, paused}; persiste a
// reinicios. La LÓGICA de fases/transporte vive en forge-firme.js (pura); aquí
// solo el disco. Si falta o está corrupto, se devuelve null (forge.js pone el
// default y lo escribe).
export function cyclePath(root) {
  return path.join(root, 'sprint', 'cycle.json');
}

export function readCycle(root) {
  try { return JSON.parse(fs.readFileSync(cyclePath(root), 'utf8')); }
  catch { return null; }
}

export function writeCycle(root, state) {
  atomicWrite(cyclePath(root), JSON.stringify(state, null, 2) + '\n');
  return state;
}

// ── modelo global de los headless ────────────────────────────────────────────
// Un sidecar sprint/model.json guarda {model: <alias>}; persiste a reinicios. La
// elección la pone el selector de la UI y vale para TODOS los personajes. Vacío o
// corrupto → null (forge.js usa entonces el modelo por defecto del CLI).
export function modelPath(root) {
  return path.join(root, 'sprint', 'model.json');
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

export function createChat(root, { type, title } = {}) {
  const num = nextNum(root);
  const id = pad(num);
  const chat = {
    id, num,
    type: type || 'tarea',
    title: (title && String(title).trim()) || `Conversación ${id}`,
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

export function createTarea(root, { title, body, fromChat } = {}) {
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
    createdAt: new Date().toISOString(),
  };
  atomicWrite(path.join(tareasDir(root), id + '.json'), JSON.stringify(tarea, null, 2) + '\n');
  return tarea;
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
  delete tarea.brought; delete tarea.broughtAt;
  delete tarea.enMaster; delete tarea.enMasterAt; delete tarea.masterCommit;
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
