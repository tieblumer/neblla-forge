// tests/31-forge-link.test.js
//
// La diana del VÍNCULO conversación ↔ tarea del forge. Sin lanzar ningún `claude`,
// prueba la lógica PURA del almacén (scripts/lib/forge-store.js):
//   1. stubMessageForTarea: colapsa el mensaje de Aubé en "[Tarea NNN creada: …]",
//      guarda el plan original (stashed) y apunta a la tarea (tareaRef). Idempotente.
//   2. restoreStubbedMessage: devuelve el mensaje a su plan original y le quita el
//      vínculo (lo que corre al borrar la tarea).
//   3. resolveOrigen: el link "↰ viene de …" — conversación normal vs. hilo de otra
//      tarea; null si la fuente se borró (o no hay origen).
//   4. createTarea con fromMsg + deleteTarea.
//
// needsServer = false (suite pura del forge; la corre tests/run-forge.js).

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createChat, appendMessage, readChat, createTarea, readTarea, deleteTarea,
  stubMessageForTarea, restoreStubbedMessage, resolveOrigen, ensureTareaThread,
} from '../../scripts/lib/forge-store.js';

export const needsServer = false;

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export async function run({ reporter: r }) {
  r.suite('31 — forge: vínculo conversación ↔ tarea (stub / restaurar / origen)');

  // ── 1) stubMessageForTarea ──────────────────────────────────────────────────
  {
    const root = mkTmp('forge-link-');
    const chat = createChat(root, { type: 'tarea', title: 'Charla' });
    const plan = appendMessage(root, chat.id, { author: 'aube', intent: 'answer', text: 'Plan: arreglar el login\n\npasos…' });

    const stub = stubMessageForTarea(root, chat.id, plan.id, { tareaId: '007', title: 'Arreglar login' });
    r.ok('stub devuelve el mensaje', !!stub);
    r.eq('texto colapsado al stub', stub.text, '[Tarea 007 creada: Arreglar login]');
    r.eq('apunta a la tarea (tareaRef)', stub.tareaRef, '007');
    r.eq('guarda el plan original (stashed)', stub.stashed, 'Plan: arreglar el login\n\npasos…');
    r.eq('autor intacto', stub.author, 'aube');

    // persiste en disco
    const fresh = readChat(root, chat.id).messages.find((m) => m.id === plan.id);
    r.eq('persiste el stub en disco', fresh.text, '[Tarea 007 creada: Arreglar login]');

    // idempotente: re-stub NO pisa el stashed con el propio stub
    const again = stubMessageForTarea(root, chat.id, plan.id, { tareaId: '007', title: 'Arreglar login' });
    r.eq('re-stub conserva el plan original', again.stashed, 'Plan: arreglar el login\n\npasos…');

    // mensaje / chat inexistente → null, sin lanzar
    r.eq('msgId inexistente → null', stubMessageForTarea(root, chat.id, 9999, { tareaId: '1' }), null);
    r.eq('chat inexistente → null', stubMessageForTarea(root, '888', 1, { tareaId: '1' }), null);
  }

  // ── 2) restoreStubbedMessage ────────────────────────────────────────────────
  {
    const root = mkTmp('forge-restore-');
    const chat = createChat(root, { type: 'tarea', title: 'Charla' });
    const plan = appendMessage(root, chat.id, { author: 'aube', intent: 'answer', text: 'el plan entero' });
    stubMessageForTarea(root, chat.id, plan.id, { tareaId: '003', title: 'X' });

    const back = restoreStubbedMessage(root, chat.id, plan.id);
    r.eq('restaura el plan original', back.text, 'el plan entero');
    r.ok('quita el tareaRef', back.tareaRef === undefined);
    r.ok('quita el stashed', back.stashed === undefined);

    const fresh = readChat(root, chat.id).messages.find((m) => m.id === plan.id);
    r.eq('persiste la restauración', fresh.text, 'el plan entero');

    // restaurar un mensaje sin stub no rompe (idempotente)
    const noop = restoreStubbedMessage(root, chat.id, plan.id);
    r.eq('restaurar sin stub no rompe el texto', noop.text, 'el plan entero');
    r.eq('mensaje inexistente → null', restoreStubbedMessage(root, chat.id, 7777), null);
  }

  // ── 3) resolveOrigen ────────────────────────────────────────────────────────
  {
    const root = mkTmp('forge-origen-');

    // (a) origen = conversación normal
    const conv = createChat(root, { type: 'tarea', title: 'Conversación madre' });
    const tarea = createTarea(root, { title: 'T1', body: 'b', fromChat: conv.id, fromMsg: 1 });
    let o = resolveOrigen(root, readTarea(root, tarea.id));
    r.ok('origen conversación: existe', !!o);
    r.eq('origen conversación: kind', o.kind, 'chat');
    r.eq('origen conversación: id', o.id, conv.id);
    r.eq('origen conversación: título en vivo', o.title, 'Conversación madre');

    // renombrar la fuente → el origen lo refleja (se resuelve en vivo)
    const fresh = readChat(root, conv.id); fresh.title = 'Renombrada';
    fs.writeFileSync(path.join(root, 'forge', 'sprint', 'chats', conv.id + '.json'), JSON.stringify(fresh, null, 2));
    r.eq('origen sigue el rename de la fuente', resolveOrigen(root, readTarea(root, tarea.id)).title, 'Renombrada');

    // (b) origen = hilo de OTRA tarea → el link apunta a la tarea padre
    const padre = createTarea(root, { title: 'Tarea padre', body: 'b' });
    const conPadre = ensureTareaThread(root, padre.id);   // crea el tarea-hilo
    const hija = createTarea(root, { title: 'Hija', body: 'b', fromChat: conPadre.threadId, fromMsg: 1 });
    const oh = resolveOrigen(root, readTarea(root, hija.id));
    r.ok('origen tarea: existe', !!oh);
    r.eq('origen tarea: kind', oh.kind, 'tarea');
    r.eq('origen tarea: apunta al padre', oh.id, padre.id);
    r.eq('origen tarea: título del padre', oh.title, 'Tarea padre');

    // (c) fuente borrada → null (el link se elimina y listo)
    fs.unlinkSync(path.join(root, 'forge', 'sprint', 'chats', conv.id + '.json'));
    r.eq('fuente borrada → origen null', resolveOrigen(root, readTarea(root, tarea.id)), null);

    // (d) sin origen → null
    const suelta = createTarea(root, { title: 'Suelta', body: 'b' });
    r.eq('sin fromChat → origen null', resolveOrigen(root, suelta), null);
  }

  // ── 4) createTarea(fromMsg) + deleteTarea ───────────────────────────────────
  {
    const root = mkTmp('forge-deltarea-');
    const t = createTarea(root, { title: 'T', body: 'b', fromChat: '005', fromMsg: 12 });
    r.eq('createTarea persiste fromMsg (numérico)', t.fromMsg, 12);
    r.eq('createTarea persiste fromChat', t.fromChat, '005');

    r.eq('deleteTarea borra la existente', deleteTarea(root, t.id), true);
    r.eq('tras borrar, readTarea → null', readTarea(root, t.id), null);
    r.eq('deleteTarea idempotente (ya no existe)', deleteTarea(root, t.id), false);
  }
}
