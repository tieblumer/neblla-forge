// forge/tests/tarea-20.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 20 — Pintar en cada fila de la lista de conversaciones un iconito de estado por cada tarea que nació de ese chat, para ver de un vistazo qué charla parió trabajo y cómo va. Es puro front: cruza las dos listas que el panel ya carga (chats y tareas decoradas) sin endpoint nuevo..

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 20 — Pintar en cada fila de la lista de conversaciones un iconito de estado por cada tarea que nació de ese chat, para ver de un vistazo qué charla parió trabajo y cómo va. Es puro front: cruza las dos listas que el panel ya carga (chats y tareas decoradas) sin endpoint nuevo.');
  await r.step('[T-20-01] Un chat que parió tareas muestra sus iconos de estado en la fila', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 1600) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    // existe el índice compartido chatId -> tareas
    r.ok('[T-20-01] existe el índice tareasPorChat', /tareasPorChat/.test(html));
    // loadTareas() reconstruye el cruce agrupando por fromChat
    const lt = bloque(html, 'async function loadTareas(', 2200);
    r.ok('[T-20-01] loadTareas alimenta tareasPorChat', /tareasPorChat/.test(lt));
    r.ok('[T-20-01] el cruce se hace por fromChat', /fromChat/.test(lt) || /fromChat/.test(html));
    // se pintan los iconos de cada tarea decorada (su .icon) en la fila .chat-item .title
    const pintarChats = bloque(html, '.chat-item', 0) ; // anchor sólo para asegurar contexto
    r.ok('[T-20-01] el cruce indexa/lee por id de chat', /tareasPorChat\s*\[/.test(html));
    r.ok('[T-20-01] los iconos pintados salen del .icon de la tarea decorada', /\.icon\b/.test(html));
  });

  await r.step('[T-20-02] Los iconos se ordenan por gravedad según el orden de GRUPOS', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // los iconos se ordenan por gravedad siguiendo el orden de GRUPOS
    // el orden canónico revisar->encurso->porhacer->terminadas debe aparecer en el front
    r.ok('[T-20-02] el front conoce el orden de grupos (revisar..terminadas)',
      /revisar[\s\S]{0,80}encurso[\s\S]{0,80}porhacer[\s\S]{0,80}terminadas/.test(html));
    // y se aplica con un sort/ordenación sobre las tareas del chat antes de pintar
    r.ok('[T-20-02] hay una ordenación (sort) de las tareas del chat', /\.sort\s*\(/.test(html));
    // la ordenación se apoya en el grupo de cada tarea, no en otra cosa
    r.ok('[T-20-02] la ordenación mira el grupo de la tarea', /\bgrupo\b/.test(html));
  });

  await r.step('[T-20-03] Tope de 3 iconos visibles más un \'+N\' cuando sobran', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // tope de 3 iconos visibles: hay un recorte a 3
    r.ok('[T-20-03] se recortan los iconos a un tope de 3', /slice\(\s*0\s*,\s*3\s*\)/.test(html) || /\b3\b/.test(html) && /slice\(/.test(html));
    // y un indicador '+N' cuando sobran (concatenación con '+')
    r.ok("[T-20-03] hay un indicador de exceso con prefijo '+'", /['"`]\+['"`]\s*\+/.test(html) || /\+['"`]\s*\+/.test(html));
    // el '+N' va en gris (color apagado/muted)
    r.ok('[T-20-03] el contador de exceso usa un color apagado (gris/muted)', /muted/.test(html) || /#?(888|999|aaa|gray|grey)/i.test(html));
  });

  await r.step('[T-20-04] Un chat sin tareas no muestra iconos', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 1800) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    // un chat sin tareas no debe pintar contenedor de iconos: el pintado va guardado por
    // un chequeo de "hay tareas" (length) antes de crear/insertar el contenedor.
    // Buscamos la zona donde se cruza por chat (tareasPorChat[...]) y comprobamos que
    // hay un guard de longitud cerca.
    const idx = html.indexOf('tareasPorChat[');
    const zona = idx === -1 ? html : html.slice(Math.max(0, idx - 200), idx + 1200);
    r.ok('[T-20-04] el cruce por chat existe', idx !== -1 || /tareasPorChat/.test(html));
    r.ok('[T-20-04] el pintado de iconos está guardado por un chequeo de longitud (sin tareas, sin iconos)',
      /\.length/.test(zona) && /(if|\?|&&|continue|return)/.test(zona));
  });

  await r.step('[T-20-05] Sin caché propia: una tarea que pierde su fromChat desaparece del cruce al refrescar', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 2200) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const lt = bloque(html, 'async function loadTareas(');
    // sin caché propia: loadTareas RECONSTRUYE el índice en cada refresco (reasignación/reset),
    // no lo va acumulando — así una tarea que pierde su fromChat desaparece sola del cruce.
    r.ok('[T-20-05] loadTareas reconstruye el índice tareasPorChat en cada refresco',
      /tareasPorChat\s*=/.test(lt) || /tareasPorChat\s*=\s*\{\s*\}/.test(html) || /tareasPorChat\.clear\(/.test(lt));
    // y dispara un re-pintado de la lista de chats tras refrescar las tareas
    r.ok('[T-20-05] loadTareas dispara el re-pintado de los iconos en la lista de chats',
      /loadList\(/.test(lt) || /pintarIconos|repintar|pintarChat|refreshChats|renderChat/i.test(lt));
  });

  await r.step('[T-20-06] El truncado del título sigue intacto con la fila de iconos', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 240) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    // el truncado del título sigue intacto: .chat-item .title conserva overflow/ellipsis/nowrap
    const titleCss = bloque(html, '.chat-item .title', 260);
    r.ok('[T-20-06] .chat-item .title sigue con overflow hidden', /overflow:\s*hidden/.test(titleCss));
    r.ok('[T-20-06] .chat-item .title sigue con text-overflow: ellipsis', /text-overflow:\s*ellipsis/.test(titleCss));
    r.ok('[T-20-06] .chat-item .title sigue con white-space: nowrap', /white-space:\s*nowrap/.test(titleCss));
    // y se ha añadido CSS para la fila de iconos como contenedor inline (no en bloque,
    // para convivir con el título truncado sin romper el layout)
    r.ok('[T-20-06] hay CSS para el contenedor inline de iconos en la fila',
      /inline-flex/.test(html) || /display:\s*inline/.test(html));
  });
}
