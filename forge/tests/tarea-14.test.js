// forge/tests/tarea-14.test.js
//
// La DIANA de la tarea #014: "Borrar una tarea" — papelera 🗑 en la tarjeta (con
// confirmación) que borra la tarea del disco, calcando el borrado de conversación
// ya existente, y arrastrando su hilo propio (tarea-hilo) si lo tiene.
//
// Suite PURA (needsServer = false): la corre tests/run-forge.js, sin Mongo, sin
// servidor, sin `claude`. Cubre tres planos:
//   BACK store  → scripts/lib/forge-store.js deleteTarea(root,id)  (unidad real)
//   BACK endpoint → DELETE /api/tareas/:id (scripts/forge.js): el arrastre del hilo
//        vive AQUÍ (no en el store), así que se ejercita su composición sobre el
//        store real con un espejo del handler + un grep anti-drift que vigila que el
//        handler real siga calcando esa forma y el contrato compartido con
//        DELETE /api/chats/:id.
//   FRONT → public/forge/index.html (renderTareaItem + borrarTarea + CSS .tarea-del):
//        el botón es de navegador y arrastra ~20 globales del app, así que se asertan
//        sobre el fichero servido (la cadena real que se entrega en producción).
//
// IDs sellados en los labels [T-14-NN] para que el runner los case con la diana.
//
//   node tests/run-forge.js tarea-14

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createTarea, readTarea, deleteTarea, deleteChat, readChat,
  ensureTareaThread, chatPath, tareaPath,
} from '../../scripts/lib/forge-store.js';

export const needsServer = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORGE_JS = path.join(__dirname, '..', '..', 'scripts', 'forge.js');
const INDEX_HTML = path.join(__dirname, '..', '..', 'public', 'forge', 'index.html');

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Espejo EXACTO del handler DELETE /api/tareas/:id (scripts/forge.js, ~línea 1722):
// el arrastre del hilo y la forma de la respuesta los compone el endpoint, NO el
// store. Lo replicamos para ejercitar esa composición sobre el store REAL; un grep
// (T-14-09 / T-14-06) vigila que el handler de forge.js siga calcando esta forma.
function borrarTareaEndpoint(root, id) {
  const tarea = readTarea(root, id);
  if (!tarea) return { code: 404, body: { error: 'tarea no encontrada' } };
  if (tarea.threadId) { try { deleteChat(root, tarea.threadId); } catch {} }
  try { deleteTarea(root, id); }
  catch (e) { return { code: 500, body: { error: 'no se pudo borrar la tarea: ' + e.message } }; }
  return { code: 200, body: { deleted: id } };
}

// Extrae el cuerpo aproximado de una función/handler desde su firma (para asertar
// el cableado del front sin ejecutar el navegador).
function bloqueDesde(src, ancla, len = 900) {
  const i = src.indexOf(ancla);
  return i === -1 ? '' : src.slice(i, i + len);
}

export async function run({ reporter: r }) {
  r.suite('tarea-14 — borrar una tarea (papelera + endpoint + hilo propio)');

  const forgeSrc = fs.readFileSync(FORGE_JS, 'utf8');
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  // ── BACK · store deleteTarea(root,id) — la unidad real ──────────────────────
  // [T-14-02] borra el JSON y devuelve true
  {
    const root = mkTmp('t14-store-');
    const t = createTarea(root, { title: 'Borrarme', body: 'b' });
    r.ok('[T-14-02] la tarea existe en disco antes de borrar', fs.existsSync(tareaPath(root, t.id)));
    r.eq('[T-14-02] deleteTarea devuelve true', deleteTarea(root, t.id), true);
    r.ok('[T-14-02] el JSON ya no existe', !fs.existsSync(tareaPath(root, t.id)));
    r.eq('[T-14-02] readTarea tras borrar → null', readTarea(root, t.id), null);
  }

  // [T-14-04] tarea sin threadId: solo borra el JSON, sin lanzar, devuelve true
  {
    const root = mkTmp('t14-nothread-');
    const t = createTarea(root, { title: 'Sin hilo', body: 'b' });
    r.ok('[T-14-04] la tarea nace sin threadId', !t.threadId);
    r.eq('[T-14-04] deleteTarea sin hilo devuelve true', deleteTarea(root, t.id), true);
    r.ok('[T-14-04] el JSON desaparece', !fs.existsSync(tareaPath(root, t.id)));
  }

  // [T-14-05] idempotente sobre tarea inexistente: false, sin excepción
  {
    const root = mkTmp('t14-idem-');
    const t = createTarea(root, { title: 'Una vez', body: 'b' });
    r.eq('[T-14-05] primer borrado → true', deleteTarea(root, t.id), true);
    r.eq('[T-14-05] segundo borrado (ya no existe) → false', deleteTarea(root, t.id), false);
    r.eq('[T-14-05] id nunca existente → false', deleteTarea(root, '999'), false);
  }

  // ── BACK · endpoint DELETE /api/tareas/:id — composición sobre el store real ─
  // [T-14-03] arrastra el hilo propio: borra también el chat del threadId
  {
    const root = mkTmp('t14-thread-');
    const base = createTarea(root, { title: 'Con hilo', body: 'b' });
    const t = ensureTareaThread(root, base.id);   // le crea su tarea-hilo
    r.ok('[T-14-03] la tarea tiene threadId', !!t.threadId);
    r.ok('[T-14-03] su chat existe en disco', fs.existsSync(chatPath(root, t.threadId)));

    const out = borrarTareaEndpoint(root, t.id);
    r.eq('[T-14-03] responde 200', out.code, 200);
    r.ok('[T-14-03] la tarea desaparece', !fs.existsSync(tareaPath(root, t.id)));
    r.ok('[T-14-03] el chat del hilo desaparece (sin hilo huérfano)', !fs.existsSync(chatPath(root, t.threadId)));
    r.eq('[T-14-03] el hilo ya no se puede leer', readChat(root, t.threadId), null);
  }

  // [T-14-06] el borrado del hilo es best-effort: hilo ya inexistente / deleteChat
  // falla → la tarea se borra igual y no se propaga ninguna excepción.
  {
    const root = mkTmp('t14-besteffort-');
    const base = createTarea(root, { title: 'Hilo fantasma', body: 'b' });
    const t = ensureTareaThread(root, base.id);
    fs.unlinkSync(chatPath(root, t.threadId));     // el chat ya no está, pero la tarea conserva su threadId
    r.ok('[T-14-06] el chat del hilo ya no existe', !fs.existsSync(chatPath(root, t.threadId)));

    let out;
    r.ok('[T-14-06] borrar no lanza aunque el hilo no esté', (() => { out = borrarTareaEndpoint(root, t.id); return true; })());
    r.eq('[T-14-06] responde 200 igualmente', out.code, 200);
    r.ok('[T-14-06] la tarea se borra de todas formas', !fs.existsSync(tareaPath(root, t.id)));
    // y el handler real envuelve el deleteChat en try/catch (anti-drift):
    r.ok('[T-14-06] el handler real protege el borrado del hilo (try/catch)',
      /if \(tarea\.threadId\) \{ try \{ deleteChat\(ROOT, tarea\.threadId\); \} catch \{\} \}/.test(forgeSrc));
  }

  // [T-14-07] 200 {deleted:'NNN'} al borrar una tarea existente
  {
    const root = mkTmp('t14-200-');
    const t = createTarea(root, { title: 'OK', body: 'b' });
    const out = borrarTareaEndpoint(root, t.id);
    r.eq('[T-14-07] código 200', out.code, 200);
    r.eq('[T-14-07] body {deleted: id}', out.body.deleted, t.id);
  }

  // [T-14-08] 404 {error} si no existe
  {
    const root = mkTmp('t14-404-');
    const out = borrarTareaEndpoint(root, '777');
    r.eq('[T-14-08] código 404', out.code, 404);
    r.ok('[T-14-08] body trae {error}', typeof out.body.error === 'string' && out.body.error.length > 0);
  }

  // [T-14-09] (persistente) el endpoint respeta el contrato compartido con
  // DELETE /api/chats/:id: mismas claves (deleted/error) y mismos códigos, de modo
  // que el front lo consume igual. Se compara el handler REAL de forge.js.
  {
    const tareas = bloqueDesde(forgeSrc, "app.delete('/api/tareas/:id'", 1400);
    const chats = bloqueDesde(forgeSrc, "app.delete('/api/chats/:id'", 400);
    r.ok('[T-14-09] existe el handler DELETE /api/tareas/:id', tareas.length > 0);
    r.ok('[T-14-09] existe el handler DELETE /api/chats/:id', chats.length > 0);
    // mismos códigos
    r.ok('[T-14-09] tareas: 404 con {error}', /res\.status\(404\)\.json\(\{ error/.test(tareas));
    r.ok('[T-14-09] chats: 404 con {error}', /res\.status\(404\)\.json\(\{ error/.test(chats));
    r.ok('[T-14-09] tareas: 500 con {error}', /res\.status\(500\)\.json\(\{ error/.test(tareas));
    r.ok('[T-14-09] chats: 500 con {error}', /res\.status\(500\)\.json\(\{ error/.test(chats));
    // misma clave de éxito: {deleted: req.params.id}
    r.ok('[T-14-09] tareas: 200 con {deleted: req.params.id}', /res\.json\(\{ deleted: req\.params\.id/.test(tareas));
    r.ok('[T-14-09] chats: 200 con {deleted: req.params.id}', /res\.json\(\{ deleted: req\.params\.id/.test(chats));
  }

  // ── GENERAL · de extremo a extremo (persistente) ────────────────────────────
  // [T-14-01] una tarea se puede borrar de punta a punta: existe en disco +
  // tarjeta en la columna → papelera + confirm → ya no está en disco ni en la
  // columna. El plano "disco" se prueba en vivo; el plano "columna/confirm" por el
  // cableado del front (borrarTarea: confirm → DELETE → loadTareas repinta).
  {
    const root = mkTmp('t14-e2e-');
    const base = createTarea(root, { title: 'De punta a punta', body: 'b' });
    const t = ensureTareaThread(root, base.id);
    r.ok('[T-14-01] arranca existiendo en disco', fs.existsSync(tareaPath(root, t.id)));
    const out = borrarTareaEndpoint(root, t.id);
    r.eq('[T-14-01] el borrado responde OK', out.code, 200);
    r.ok('[T-14-01] el JSON desaparece del disco', !fs.existsSync(tareaPath(root, t.id)));
    r.ok('[T-14-01] el front pide confirmación antes de borrar', /async function borrarTarea\(t\) \{\s*if \(!confirm\(/.test(html));
    r.ok('[T-14-01] tras borrar el front repinta la columna (loadTareas)',
      bloqueDesde(html, 'async function borrarTarea(t)', 1400).includes('loadTareas()'));
  }

  // ── FRONT · public/forge/index.html ─────────────────────────────────────────
  // [T-14-10] la papelera existe oculta hasta el rollover, igual que .chat-del
  {
    r.ok('[T-14-10] hay regla CSS .tarea-del', /\.tarea-del \{/.test(html));
    const css = bloqueDesde(html, '.tarea-del {', 320);
    r.ok('[T-14-10] nace oculta (opacity: 0)', /opacity: 0;/.test(css));
    r.ok('[T-14-10] se muestra en hover/active de la tarjeta (como .chat-del)',
      /\.tarea-item:hover \.tarea-del, \.tarea-item\.active \.tarea-del \{ opacity: 1; \}/.test(html));
    r.ok('[T-14-10] renderTareaItem inserta el botón clase tarea-del',
      bloqueDesde(html, 'function renderTareaItem(t)', 1200).includes("del.className = 'tarea-del'"));
  }

  // [T-14-11] pulsar la papelera NO abre la tarea (stopPropagation) y dispara el borrado
  {
    const render = bloqueDesde(html, 'function renderTareaItem(t)', 1300);
    r.ok('[T-14-11] el onclick del 🗑 hace e.stopPropagation()',
      /del\.onclick = \(e\) => \{ e\.stopPropagation\(\);/.test(render));
    r.ok('[T-14-11] y llama al borrado de la tarea (borrarTarea)',
      /del\.onclick = \(e\) => \{ e\.stopPropagation\(\); borrarTarea\(t\); \}/.test(render));
    // la fila sí abre la tarea: confirma que el stopPropagation es lo que lo impide en el botón
    r.ok('[T-14-11] la fila normal sí abre la tarea (openTarea)', render.includes('row.onclick = () => openTarea(t.id)'));
  }

  // [T-14-12] cancelar el confirm no borra nada: el confirm va ANTES del fetch y
  // retorna en seco si el usuario cancela.
  {
    const fn = bloqueDesde(html, 'async function borrarTarea(t)', 1400);
    r.ok('[T-14-12] el confirm con return en seco abre la función',
      /async function borrarTarea\(t\) \{\s*if \(!confirm\(/.test(fn));
    const iConfirm = fn.indexOf('confirm(');
    const iFetch = fn.indexOf("fetch('/api/tareas/'");
    r.ok('[T-14-12] hay un fetch DELETE a /api/tareas/', iFetch > -1 && /\{ method: 'DELETE' \}/.test(fn));
    r.ok('[T-14-12] el confirm va ANTES del fetch (cancelar = no fetch)', iConfirm > -1 && iConfirm < iFetch);
  }

  // [T-14-13] tras borrar OK: repinta la columna y limpia el centro si era la abierta
  {
    const fn = bloqueDesde(html, 'async function borrarTarea(t)', 1300);
    r.ok('[T-14-13] al final repinta la columna (loadTareas)', fn.includes('loadTareas()'));
    r.ok('[T-14-13] detecta si la borrada era la tarea abierta',
      /if \(currentTarea && currentTarea\.id === t\.id\)/.test(fn));
    r.ok('[T-14-13] en ese caso limpia el centro (currentTarea = null)', /currentTarea = null;/.test(fn));
  }
}
