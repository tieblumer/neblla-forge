// forge/tests/tarea-21.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 21 — En modo tarea, la "raíz" del hilo pasa a significar la propia definición de Aubé (el bloque `.tarea-def`), representada por `selectedId = null`. Hoy F22 ("siempre hay rey") obliga a que el rey sea un mensaje y `firstMsgId()` apunta a `messages[0]`, así que volver a la raíz aterriza en la primera burbuja en vez de en la tarea. Hacemos que abrir la tarea, el re-clic sobre el rey y el clic en el fondo del hilo aterricen en la def (la resaltamos como rey y lo que escribas le contesta a ella, que ya funciona a nivel de datos con `replyTo=null`). En modo conversación todo sigue igual..

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 21 — En modo tarea, la "raíz" del hilo pasa a significar la propia definición de Aubé (el bloque `.tarea-def`), representada por `selectedId = null`. Hoy F22 ("siempre hay rey") obliga a que el rey sea un mensaje y `firstMsgId()` apunta a `messages[0]`, así que volver a la raíz aterriza en la primera burbuja en vez de en la tarea. Hacemos que abrir la tarea, el re-clic sobre el rey y el clic en el fondo del hilo aterricen en la def (la resaltamos como rey y lo que escribas le contesta a ella, que ya funciona a nivel de datos con `replyTo=null`). En modo conversación todo sigue igual.');
  await r.step('[T-21-01] Abrir una tarea deja la def de Aubé como rey por defecto (selectedId=null)', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const rt = bloque(html, 'function renderThread(', 700);
    r.ok('[T-21-01] existe renderThread', rt.length > 0);
    // El auto-relleno del rey (selectedId = último real) sigue existiendo...
    r.ok('[T-21-01] renderThread aún tiene el auto-relleno del rey', /selectedId\s*=\s*real\[real\.length\s*-\s*1\]\.id/.test(rt));
    // ...pero ahora está condicionado a NO tener tarea abierta: con currentTarea el
    // relleno no corre y selectedId se queda en null (la def queda de rey).
    r.ok('[T-21-01] el auto-relleno mira currentTarea para no pisar la def en modo tarea', /currentTarea/.test(rt));
    r.ok('[T-21-01] el guard excluye el modo tarea (!currentTarea / currentTarea==null / sin tarea)',
      /!currentTarea/.test(rt) || /currentTarea\s*==\s*null/.test(rt) || /currentTarea\s*===\s*null/.test(rt));
  });

  await r.step('[T-21-02] En modo conversación renderThread sigue forzando un rey (F22 intacta)', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const rt = bloque(html, 'function renderThread(', 700);
    r.ok('[T-21-02] existe renderThread', rt.length > 0);
    // F22 intacta en conversación: cuando no hay tarea (y no había selección), renderThread
    // SIGUE cayendo al último mensaje real — siempre hay rey, nunca aterriza en la def.
    r.ok('[T-21-02] sigue existiendo el relleno al último mensaje real (F22)',
      /selectedId\s*=\s*real\[real\.length\s*-\s*1\]\.id/.test(rt));
    // el relleno sigue exigiendo que no haya selección previa (selectedId==null) o que el rey desapareciera
    r.ok('[T-21-02] el relleno solo actúa si no había rey vivo', /selectedId\s*==\s*null/.test(rt) || /selectedId\s*===\s*null/.test(rt));
    // y exige que haya mensajes reales (no rey en conversación vacía)
    r.ok('[T-21-02] el relleno exige mensajes reales', /real\.length/.test(rt));
  });

  await r.step('[T-21-03] Re-clic sobre el rey en modo tarea vuelve a la def (selectedId=null), no a firstMsgId', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const sm = bloque(html, 'function selectMsg(', 600);
    r.ok('[T-21-03] existe selectMsg', sm.length > 0);
    // re-clic sobre el rey: la rama "ya seleccionado" ahora mira currentTarea
    r.ok('[T-21-03] el re-clic distingue el modo tarea (currentTarea) del modo conversación', /currentTarea/.test(sm));
    // en modo tarea, re-clic vuelve a la def: selectedId = null
    r.ok('[T-21-03] en modo tarea el re-clic pone selectedId = null (vuelve a la def)', /selectedId\s*=\s*null/.test(sm));
    // en conversación se mantiene el salto al primer mensaje (firstMsgId)
    r.ok('[T-21-03] en conversación el re-clic sigue saltando a firstMsgId()', /firstMsgId\s*\(/.test(sm));
  });

  await r.step('[T-21-04] Clic en el fondo vacío del hilo en modo tarea deselecciona hacia la def', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    // el handler de clic-en-vacío del fondo del hilo
    const h = bloque(html, "threadEl.addEventListener('click'", 600);
    r.ok('[T-21-04] existe el handler de clic-en-vacío del hilo', h.length > 0 && /\.bubble/.test(h) && /\.node/.test(h));
    // en modo tarea, el clic en vacío deselecciona hacia la def: currentTarea + selectedId = null
    r.ok('[T-21-04] el handler distingue el modo tarea (currentTarea)', /currentTarea/.test(h));
    r.ok('[T-21-04] en modo tarea el clic en vacío pone selectedId = null (aterriza en la def)', /selectedId\s*=\s*null/.test(h));
    // y re-renderiza para reflejar la deselección
    r.ok('[T-21-04] re-renderiza tras deseleccionar (renderThread / refreshThread / updateSelectionUI)',
      /renderThread\s*\(/.test(h) || /refreshThread\s*\(/.test(h) || /updateSelectionUI\s*\(/.test(h));
    // en conversación se mantiene el ir a firstMsgId()
    r.ok('[T-21-04] en conversación el clic en vacío sigue yendo a firstMsgId()', /firstMsgId\s*\(/.test(h));
  });

  await r.step('[T-21-05] La barra de selección anuncia la def como rey cuando selectedId==null y hay tarea', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const us = bloque(html, 'function updateSelectionUI(', 1400);
    r.ok('[T-21-05] existe updateSelectionUI', us.length > 0);
    // cuando hay tarea y selectedId==null, la barra anuncia la def como rey
    r.ok('[T-21-05] updateSelectionUI contempla el caso tarea + sin rey-mensaje (currentTarea)', /currentTarea/.test(us));
    // rótulo "Sobre 👑 la tarea · Aubé" (corona + la tarea + Aubé)
    r.ok('[T-21-05] la barra anuncia 👑 la tarea', /👑/.test(us) && /la tarea/.test(us));
    r.ok('[T-21-05] la barra acredita a Aubé como autora de la def', /Aub/.test(us));
    // muestra un preview del cuerpo de la def (currentTarea.body)
    r.ok('[T-21-05] la barra usa el preview del cuerpo de la def (currentTarea.body)', /currentTarea\.body/.test(us));
    // NO debe caer en "Elige una conversación" cuando hay tarea con def-rey
    r.ok('[T-21-05] sigue existiendo la rama vacía de conversación (no se borra el fallback)', /Elige una conversaci/.test(us));
  });

  await r.step('[T-21-06] renderTareaDef marca .tarea-def como rey y la hace clicable cuando selectedId==null', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const rd = bloque(html, 'function renderTareaDef(', 2200);
    r.ok('[T-21-06] existe renderTareaDef', rd.length > 0);
    // cuando hay tarea y selectedId==null, el bloque .tarea-def recibe la clase 'rey'
    r.ok('[T-21-06] renderTareaDef condiciona el resaltado a selectedId==null', /selectedId\s*==\s*null/.test(rd) || /selectedId\s*===\s*null/.test(rd));
    r.ok('[T-21-06] renderTareaDef marca el bloque con la clase rey',
      /classList\.(add|toggle)\(\s*['"`]rey['"`]/.test(rd) || /['"`]rey['"`]/.test(rd));
    // el bloque queda clicable para volver a seleccionarse como rey (selectedId=null + re-render)
    r.ok('[T-21-06] el bloque .tarea-def queda clicable (onclick / addEventListener)',
      /tareaDefEl\.onclick/.test(rd) || /tareaDefEl\.addEventListener\(\s*['"`]click/.test(rd) || /\.onclick\s*=/.test(rd));
    r.ok('[T-21-06] al clicar la def vuelve a ser rey (selectedId = null)', /selectedId\s*=\s*null/.test(rd));
  });

  await r.step('[T-21-07] Existe la regla CSS .tarea-def.rey con el lenguaje visual de rey', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // existe la regla CSS .tarea-def.rey que resalta la def cuando es rey
    r.ok('[T-21-07] existe la regla CSS .tarea-def.rey', /\.tarea-def\.rey\s*\{/.test(html));
    // con cuerpo real (al menos una propiedad) — no una regla vacía
    const m = html.match(/\.tarea-def\.rey\s*\{([^}]*)\}/);
    r.ok('[T-21-07] la regla .tarea-def.rey tiene cuerpo (alguna propiedad)', !!m && /:/.test(m[1]));
    // mismo lenguaje visual de rey que las burbujas (F22): se apoya en el acento, igual que
    // .node.selected > .bubble y .sel-info .king (var(--accent) / accent / borde resaltado)
    const cuerpo = m ? m[1] : '';
    r.ok('[T-21-07] el resaltado de rey usa el lenguaje visual de acento/borde (como las burbujas)',
      /accent/.test(cuerpo) || /border/.test(cuerpo) || /box-shadow/.test(cuerpo) || /outline/.test(cuerpo) || /background/.test(cuerpo));
  });
}
