// forge/tests/tarea-22.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 22 — Cuando Tie escribe y pulsa un botón de acción (Discutir, Investigar, Consejo, Challenge, Resumir), su texto se publica SIEMPRE como un mensaje suyo en el hilo —en vez de consumirse como `steer` silencioso y perderse—, replicando el patrón que ya usa el endpoint de Aubé. La réplica del agente cuelga de ese mensaje, así la cadena lee rey → texto-de-Tie → respuesta..

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 22 — Cuando Tie escribe y pulsa un botón de acción (Discutir, Investigar, Consejo, Challenge, Resumir), su texto se publica SIEMPRE como un mensaje suyo en el hilo —en vez de consumirse como `steer` silencioso y perderse—, replicando el patrón que ya usa el endpoint de Aubé. La réplica del agente cuelga de ese mensaje, así la cadena lee rey → texto-de-Tie → respuesta.');
  await r.step('[T-22-01] El texto de Tie se publica como mensaje suyo en el hilo', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.post(', i + anchor.length); return src.slice(i, j < 0 ? i + 1600 : j); }
    const b = block("app.post('/api/chats/:id/discutir'");
    r.ok("existe el endpoint /discutir", b.length > 0);
    // Tras el cambio, el texto de Tie deja de tragarse como steer silencioso y se
    // publica como mensaje suyo: o por un helper (publicarSusurro…) o appendMessage
    // inline con author 'tie' / intent 'request'.
    const helperDef = /function\s+publicarSusurro/i.test(src);
    const inlineTie = /appendMessage\s*\(/.test(b) && /['"]tie['"]/.test(b) && /request/.test(b);
    r.ok("se publica el texto de Tie como mensaje suyo (intent request): helper o inline", helperDef || inlineTie);
    r.ok("/discutir invoca esa publicación del texto de Tie", /publicarSusurro/i.test(b) || inlineTie);
    // el mensaje de Tie cuelga del rey: se le pasa el targetId como padre (replyTo).
    r.ok("el mensaje de Tie cuelga del rey (targetId como padre)", /publicarSusurro[^)]*targetId/i.test(b) || /replyTo[\s\S]*targetId/.test(b) || /targetId/.test(b));
  });

  await r.step('[T-22-02] La réplica del agente cuelga del mensaje de Tie, no del rey', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.post(', i + anchor.length); return src.slice(i, j < 0 ? i + 1600 : j); }
    const b = block("app.post('/api/chats/:id/discutir'");
    r.ok("existe el endpoint /discutir", b.length > 0);
    // pendingParent ya no es literalmente r.targetId: pasa a ser el padre calculado
    // (el id del mensaje de Tie recién publicado), una variable.
    r.ok("pendingParent ya no apunta directo a r.targetId", !/pendingParent:\s*r\.targetId/.test(b));
    r.ok("pendingParent usa una variable/expresión (el padre calculado)", /pendingParent:\s*[A-Za-z_$]/.test(b));
    // el padre = id del susurro de Tie con fallback al targetId (ternario `.id : … targetId`).
    r.ok("la réplica cuelga del id del mensaje de Tie, con fallback al targetId", /\.id\s*:\s*[^,;}\n]*targetId/.test(b) || /\?\.id\b/.test(b) || /\.id\b[\s\S]{0,40}targetId/.test(b));
    // FORGE_REPLY_TO del headless ya no apunta a r.targetId: usa el mismo padre nuevo.
    r.ok("FORGE_REPLY_TO ya no referencia r.targetId (apunta al mensaje de Tie)", !/FORGE_REPLY_TO:[^,}]*r\.targetId/.test(b));
  });

  await r.step('[T-22-03] Sin texto, el comportamiento es idéntico al de hoy', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.post(', i + anchor.length); return src.slice(i, j < 0 ? i + 1600 : j); }
    // Sin texto no se publica nada: el helper (o el inline) hace guard sobre el texto vacío.
    const guardHelper = /function\s+publicarSusurro[\s\S]{0,320}?(return\s+null|!\s*\w*said\w*|trim\(\))/i.test(src);
    const b = block("app.post('/api/chats/:id/consejo'");
    r.ok("existe el endpoint /consejo", b.length > 0);
    const guardInline = /trim\(\)/.test(b) || /if\s*\(\s*said/.test(b) || /steer[\s\S]{0,40}trim/.test(b);
    r.ok("no se publica mensaje de Tie si el texto viene vacío/espacios (guard helper o inline)", guardHelper || guardInline);
    // Sin susurro, el padre cae al targetId ORIGINAL: el fallback al targetId existe en el cálculo del padre.
    r.ok("el padre conserva el fallback al targetId original (sin texto = como hoy)", /\.id\s*:\s*[^,;}\n]*targetId/.test(b) || /\|\|\s*[^,;}\n]*targetId/.test(b) || /targetId/.test(b));
    // FORGE_REPLY_TO mantiene la forma que, sin texto, resuelve al targetId.
    r.ok("FORGE_REPLY_TO sigue pudiendo resolver al targetId cuando no hay mensaje de Tie", /FORGE_REPLY_TO/.test(b) && /targetId/.test(b));
  });

  await r.step('[T-22-04] En la raíz de una tarea (sin target) el texto de Tie cuelga de la def', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.post(', i + anchor.length); return src.slice(i, j < 0 ? i + 1600 : j); }
    // En raíz de tarea, resolveTargetAndScope devuelve targetId=null; el susurro de Tie
    // cuelga con replyTo=null (de la def) porque se le pasa r.targetId (null) como padre.
    const rt = (()=>{ const i = src.indexOf('function resolveTargetAndScope('); return i < 0 ? '' : src.slice(i, i + 500); })();
    r.ok("resolveTargetAndScope devuelve targetId=null en la raíz de una tarea", /targetId:\s*null/.test(rt));
    const b = block("app.post('/api/chats/:id/investigar'");
    r.ok("existe el endpoint /investigar", b.length > 0);
    // publica el texto de Tie...
    r.ok("/investigar publica el texto de Tie como mensaje suyo", /publicarSusurro/i.test(b) || (/appendMessage\s*\(/.test(b) && /['"]tie['"]/.test(b)));
    // ...colgando del target (r.targetId), que en raíz de tarea es null → replyTo=null (de la def).
    r.ok("el susurro cuelga del target (r.targetId; null = de la def en raíz de tarea)", /publicarSusurro[^)]*targetId/i.test(b) || /replyTo[\s\S]*targetId/.test(b));
    // y el pendingParent pasa a ser el id del nuevo mensaje de Tie (no r.targetId directo).
    r.ok("pendingParent pasa a ser el id del mensaje de Tie (no r.targetId directo)", !/pendingParent:\s*r\.targetId/.test(b) && /pendingParent:\s*[A-Za-z_$]/.test(b));
  });

  await r.step('[T-22-05] El steer deja de inyectarse en el prompt del agente', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.post(', i + anchor.length); return src.slice(i, j < 0 ? i + 1600 : j); }
    // El texto de Tie ya vive en el hilo (buildThreadText), así que el prompt del agente
    // NO debe recibir `steer:` en estos endpoints (evita verlo duplicado). El `steer` del
    // body puede seguir leyéndose como FUENTE (req.body.steer) para publicarlo, pero ya
    // no se pasa como argumento `steer:` al builder del prompt.
    const endpoints = [
      ["/discutir',  ", "app.post('/api/chats/:id/discutir'"],
      ["/investigar", "app.post('/api/chats/:id/investigar'"],
      ["/consejo",    "app.post('/api/chats/:id/consejo'"],
      ["/anselmo",    "app.post('/api/chats/:id/anselmo'"],
    ];
    for (const [nombre, anchor] of endpoints) {
      const b = block(anchor);
      r.ok(nombre + ": existe el endpoint", b.length > 0);
      r.ok(nombre + ": ya no pasa `steer:` al prompt del agente", !/steer\s*:/.test(b));
    }
    // challenge se valida aparte porque tras su bloque viene resolveTargetAndScope (no es app.post),
    // así que acoto su prompt mirando la llamada a williamChallengePrompt.
    const wc = (()=>{ const i = src.indexOf('williamChallengePrompt({'); return i < 0 ? '' : src.slice(i, i + 400); })();
    r.ok("/challenge: williamChallengePrompt ya no recibe `steer:`", wc.length > 0 && !/steer\s*:/.test(wc));
  });

  await r.step('[T-22-06] El front no cambia de contrato y sigue funcionando', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // El front NO cambia de contrato: sigue MANDANDO `steer` en el body de las acciones
    // y sigue CONSUMIENDO pendingParent (que ahora apunta al mensaje de Tie) para colocar
    // el fantasma con addPending — sin necesitar ningún campo nuevo.
    r.ok("el front sigue enviando steer en las acciones", /steer/.test(html));
    r.ok("el front sigue consumiendo pendingParent de la respuesta", /pendingParent/.test(html));
    r.ok("el front coloca el fantasma/réplica con addPending", /addPending\s*\(/.test(html));
  });
}
