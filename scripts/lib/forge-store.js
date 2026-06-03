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

// Añade un mensaje al chat (read-modify-write fresco de disco). Devuelve el
// mensaje creado (con su id) o lanza si el chat no existe.
export function appendMessage(root, id, { type, author, intent, replyTo, text }) {
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
  chat.messages.push(msg);
  writeChat(root, chat);
  return msg;
}
