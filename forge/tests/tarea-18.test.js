// forge/tests/tarea-18.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 18 — Borrar un mensaje individual de un hilo.

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 18 — Borrar un mensaje individual de un hilo');
  await r.step('[T-18-01] cascade=true borra la raíz y todo su subárbol', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const { createChat, appendMessage, readChat, deleteMessage } = await import('../../scripts/lib/forge-store.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbla-del-01-'));
    const chat = createChat(root, { type: 'tarea', title: 'T' });
    const R = appendMessage(root, chat.id, { author: 'tie', text: 'R', replyTo: null }); // id 1
    const A = appendMessage(root, chat.id, { author: 'tie', text: 'A', replyTo: R.id });  // id 2
    const B = appendMessage(root, chat.id, { author: 'tie', text: 'B', replyTo: A.id });  // id 3
    const S = appendMessage(root, chat.id, { author: 'tie', text: 'S', replyTo: null }); // id 4 (suelto)
    const res = deleteMessage(root, chat.id, R.id, { cascade: true });
    const removed = [...res.removed].sort((a, b) => a - b);
    r.eq('[T-18-01] removed = subárbol entero {R,A,B}', JSON.stringify(removed), JSON.stringify([R.id, A.id, B.id]));
    r.ok('[T-18-01] reparented vacío en cascada', Array.isArray(res.reparented) && res.reparented.length === 0);
    const ids = readChat(root, chat.id).messages.map((m) => m.id);
    r.ok('[T-18-01] R, A y B ya no están en el chat', !ids.includes(R.id) && !ids.includes(A.id) && !ids.includes(B.id));
    const sFresh = readChat(root, chat.id).messages.find((m) => m.id === S.id);
    r.ok('[T-18-01] el mensaje suelto S sobrevive intacto', !!sFresh && sFresh.text === 'S' && sFresh.replyTo === null);
  });

  await r.step('[T-18-02] cascade=false re-cuelga los hijos directos del padre del borrado', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const { createChat, appendMessage, readChat, deleteMessage } = await import('../../scripts/lib/forge-store.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbla-del-02-'));
    const chat = createChat(root, { type: 'tarea', title: 'T' });
    const R = appendMessage(root, chat.id, { author: 'tie', text: 'R', replyTo: null }); // id 1
    const M = appendMessage(root, chat.id, { author: 'tie', text: 'M', replyTo: R.id });  // id 2 (intermedio)
    const C1 = appendMessage(root, chat.id, { author: 'tie', text: 'C1', replyTo: M.id }); // id 3
    const C2 = appendMessage(root, chat.id, { author: 'tie', text: 'C2', replyTo: M.id }); // id 4
    const res = deleteMessage(root, chat.id, M.id, { cascade: false });
    r.eq('[T-18-02] removed = solo el borrado [M]', JSON.stringify([...res.removed]), JSON.stringify([M.id]));
    const fresh = readChat(root, chat.id);
    const c1 = fresh.messages.find((m) => m.id === C1.id);
    const c2 = fresh.messages.find((m) => m.id === C2.id);
    r.ok('[T-18-02] C1 y C2 siguen vivos', !!c1 && !!c2);
    r.eq('[T-18-02] C1 re-colgado del padre del borrado (replyTo=R)', c1.replyTo, R.id);
    r.eq('[T-18-02] C2 re-colgado del padre del borrado (replyTo=R)', c2.replyTo, R.id);
    const repIds = res.reparented.map((x) => x.id).sort((a, b) => a - b);
    r.eq('[T-18-02] ambos hijos figuran en reparented', JSON.stringify(repIds), JSON.stringify([C1.id, C2.id]));
    r.ok('[T-18-02] reparented lleva el nuevo replyTo (=R) para cada hijo', res.reparented.every((x) => x.replyTo === R.id));
    const rFresh = fresh.messages.find((m) => m.id === R.id);
    r.ok('[T-18-02] R sigue intacto', !!rFresh && rFresh.replyTo === null);
  });

  await r.step('[T-18-03] borrar la raíz sin cascada deja a los hijos como nuevas raíces (replyTo null)', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const { createChat, appendMessage, readChat, deleteMessage } = await import('../../scripts/lib/forge-store.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbla-del-03-'));
    const chat = createChat(root, { type: 'tarea', title: 'T' });
    const R = appendMessage(root, chat.id, { author: 'tie', text: 'R', replyTo: null });  // id 1, raíz
    const H1 = appendMessage(root, chat.id, { author: 'tie', text: 'H1', replyTo: R.id }); // id 2
    const H2 = appendMessage(root, chat.id, { author: 'tie', text: 'H2', replyTo: R.id }); // id 3
    const res = deleteMessage(root, chat.id, R.id, { cascade: false });
    r.eq('[T-18-03] removed = [R]', JSON.stringify([...res.removed]), JSON.stringify([R.id]));
    const fresh = readChat(root, chat.id);
    const h1 = fresh.messages.find((m) => m.id === H1.id);
    const h2 = fresh.messages.find((m) => m.id === H2.id);
    r.ok('[T-18-03] borrar la raíz sin cascada deja H1 como nueva raíz (replyTo null)', !!h1 && h1.replyTo === null);
    r.ok('[T-18-03] borrar la raíz sin cascada deja H2 como nueva raíz (replyTo null)', !!h2 && h2.replyTo === null);
    const repIds = res.reparented.map((x) => x.id).sort((a, b) => a - b);
    r.eq('[T-18-03] H1 y H2 figuran en reparented', JSON.stringify(repIds), JSON.stringify([H1.id, H2.id]));
    r.ok('[T-18-03] el nuevo replyTo en reparented es null (raíz → null)', res.reparented.every((x) => x.replyTo === null));
    r.ok('[T-18-03] el hilo sobrevive sin R (R ya no está)', !fresh.messages.some((m) => m.id === R.id));
  });

  await r.step('[T-18-04] borrar un msgId inexistente es idempotente', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const { createChat, appendMessage, readChat, deleteMessage } = await import('../../scripts/lib/forge-store.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbla-del-04-'));
    const chat = createChat(root, { type: 'tarea', title: 'T' });
    appendMessage(root, chat.id, { author: 'tie', text: 'uno', replyTo: null });
    appendMessage(root, chat.id, { author: 'tie', text: 'dos', replyTo: 1 });
    const antes = JSON.stringify(readChat(root, chat.id).messages);
    let res, threw = false;
    try { res = deleteMessage(root, chat.id, 999, { cascade: false }); } catch { threw = true; }
    r.ok('[T-18-04] borrar un id inexistente NO lanza', !threw);
    r.eq('[T-18-04] removed vacío', JSON.stringify([...res.removed]), JSON.stringify([]));
    r.eq('[T-18-04] reparented vacío', JSON.stringify(res.reparented), JSON.stringify([]));
    r.eq('[T-18-04] el chat queda exactamente igual (idempotente)', JSON.stringify(readChat(root, chat.id).messages), antes);
  });

  await r.step('[T-18-05] el endpoint DELETE valida conversación y msgId', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    // El endpoint DELETE de borrado por mensaje existe y cuelga del árbol replyTo.
    r.ok('[T-18-05] existe DELETE /api/chats/:id/messages/:msgId',
      /app\.delete\('\/api\/chats\/:id\/messages\/:msgId'/.test(src));
    // Aísla el cuerpo del handler para afirmar sobre él.
    const i = src.indexOf("app.delete('/api/chats/:id/messages/:msgId'");
    const body = i === -1 ? '' : src.slice(i, i + 900);
    r.ok('[T-18-05] delega en deleteMessage del store', /deleteMessage\(/.test(body));
    r.ok('[T-18-05] lee el flag cascade (body/query)', /cascade/.test(body));
    r.ok('[T-18-05] 404 cuando la conversación no existe', /status\(404\)/.test(body));
    r.ok('[T-18-05] 400 cuando el msgId no es válido', /status\(400\)/.test(body));
    r.ok('[T-18-05] responde { removed, reparented } en el caso bueno', /removed/.test(body) && /reparented/.test(body));
  });

  await r.step('[T-18-06] el front pregunta solo cuando el mensaje tiene descendientes', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // 1) Hay una acción de borrado POR MENSAJE que pega al endpoint nuevo.
    r.ok('[T-18-06] el front llama a DELETE /api/chats/<id>/messages/<msgId>',
      /\/api\/chats\/[^'"`]*\/messages\//.test(html) && /method:\s*'DELETE'/.test(html));
    // 2) Existe la función que decide el borrado de un mensaje.
    const m = html.match(/(?:async\s+)?function\s+(borrarMensaje|deleteMessage|delMensaje)\s*\([^)]*\)\s*\{[\s\S]{0,1600}?\n  \}/);
    r.ok('[T-18-06] existe la función de borrado por mensaje (borrarMensaje/…)', !!m);
    const fn = m ? m[0] : '';
    // 3) Decide preguntar SOLO si el mensaje tiene descendientes en el árbol local.
    r.ok('[T-18-06] mira si el mensaje tiene hijos/descendientes (replyTo) antes de actuar',
      /replyTo/.test(fn) && /(descend|hijo|child)/i.test(fn));
    // 4) Con descendientes ofrece la elección cascada sí/no; hoja → confirm directo.
    r.ok('[T-18-06] ofrece ambas ramas cascade=true y cascade=false',
      /cascade/.test(fn) && /true/.test(fn) && /false/.test(fn));
    r.ok('[T-18-06] la hoja se borra directa con confirm()', /confirm\(/.test(fn));
  });
}
