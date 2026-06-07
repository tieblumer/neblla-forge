// forge/tests/tarea-19.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 19 — Hacer que la selección del "rey" en el hilo del forge vuelva sola al PRIMER mensaje (= hilo principal) cuando Tie hace click en vacío o vuelve a clicar la frase ya seleccionada. Así "salir" de un sub-hilo y aterrizar en el principal es un gesto natural, no algo que haya que deshacer a mano..

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 19 — Hacer que la selección del "rey" en el hilo del forge vuelva sola al PRIMER mensaje (= hilo principal) cuando Tie hace click en vacío o vuelve a clicar la frase ya seleccionada. Así "salir" de un sub-hilo y aterrizar en el principal es un gesto natural, no algo que haya que deshacer a mano.');
  await r.step('[T-19-01] firstMsgId() devuelve el primer mensaje raíz en orden cronológico', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 900) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'function firstMsgId(');
    r.ok('[T-19-01] existe el helper firstMsgId()', fn.length > 0);
    // toma el PRIMER raíz/real en orden cronológico ([0]) — NO el último
    r.ok('[T-19-01] coge el primer elemento ([0]) del array de raíces/reales', /\[0\]/.test(fn));
    r.ok('[T-19-01] NO devuelve el último (length-1)', !/length\s*-\s*1\s*\]/.test(fn));
    // devuelve el id de ese mensaje, no el objeto entero
    r.ok('[T-19-01] devuelve el .id de ese primer mensaje', /\.id\b/.test(fn) && /return/.test(fn));
    // se apoya en roots o en la lista real de mensajes (no en pendings/fantasmas)
    r.ok('[T-19-01] parte de roots o de la lista real de mensajes', /\broots\b/.test(fn) || /\breal\b/.test(fn));
  });

  await r.step('[T-19-02] Re-clic sobre el rey actual (que no es el primero) vuelve al hilo principal', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 900) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'function selectMsg(');
    r.ok('[T-19-02] existe selectMsg()', fn.length > 0);
    // la rama "ya seleccionado" ya NO es un return seco: ahora llama a firstMsgId()
    r.ok('[T-19-02] al re-clicar el rey actual entra firstMsgId() (ya no hay return pelado)',
      /selectedId === id[\s\S]{0,220}firstMsgId\(/.test(fn));
    // y re-renderiza el hilo con el primero como nuevo rey
    r.ok('[T-19-02] re-renderiza el hilo tras el reset', /renderThread\(/.test(fn));
    // el viejo "return sin hacer nada" ya no es la ÚNICA salida de esa rama
    r.ok('[T-19-02] firstMsgId aparece antes de salir de la rama de re-clic',
      fn.indexOf('firstMsgId(') > -1 && fn.indexOf('firstMsgId(') < fn.indexOf('selectedId = id'));
  });

  await r.step('[T-19-03] Re-clic sobre el rey cuando ya es el primero no hace nada', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 900) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'function selectMsg(');
    r.ok('[T-19-03] existe selectMsg()', fn.length > 0);
    // guarda contra reset inútil: si el rey YA es el primero, no se vuelve a renderizar
    const guarda = /firstMsgId\(\)[\s\S]{0,90}(!==|!=)\s*id/.test(fn)   // const first = firstMsgId(); if (first !== id)
      || /(!==|!=)\s*firstMsgId\(\)/.test(fn)                          // if (id !== firstMsgId())
      || /id === firstMsgId\(\)/.test(fn)                              // if (id === firstMsgId()) return
      || /firstMsgId\(\) === id/.test(fn);
    r.ok('[T-19-03] hay guarda: cuando id ya es el primero NO resetea', guarda);
    // y aun así la rama de re-clic conserva un return (no cae a fijar selected= id de nuevo)
    r.ok('[T-19-03] la rama de re-clic sigue cerrando con return', /selectedId === id[\s\S]{0,260}return/.test(fn));
  });

  await r.step('[T-19-04] Clic en una frase distinta entra a ese sub-hilo', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 900) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'function selectMsg(');
    r.ok('[T-19-04] existe selectMsg()', fn.length > 0);
    // clic en una frase DISTINTA del rey: se entra a ese sub-hilo (selectedId = id)
    r.ok('[T-19-04] una frase distinta fija selectedId = id (se entra al sub-hilo)', /selectedId = id\b/.test(fn));
    // ese caminio re-renderiza para mostrar el nuevo rey
    r.ok('[T-19-04] re-renderiza al entrar al sub-hilo', /renderThread\(/.test(fn));
    // la asignación selectedId = id vive DESPUÉS de la rama del re-clic (no se resetea al primero)
    r.ok('[T-19-04] fijar el nuevo rey va tras la rama "ya seleccionado", sin pasar por el reset al primero',
      fn.indexOf('selectedId = id') > fn.indexOf('selectedId === id'));
  });

  await r.step('[T-19-05] Clic en el fondo vacío del hilo vuelve al principal', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // threadEl tiene un handler de fondo (onclick o addEventListener)
    const tieneHandler = /threadEl\.onclick\s*=/.test(html) || /threadEl\.addEventListener\(\s*'click'/.test(html);
    r.ok('[T-19-05] threadEl tiene un handler de fondo cableado', tieneHandler);
    const i = Math.max(html.indexOf('threadEl.onclick'), html.indexOf("threadEl.addEventListener('click'"), html.indexOf('threadEl.addEventListener( \'click\''));
    const fn = i === -1 ? '' : html.slice(i, i + 500);
    // el click en vacío resetea al hilo principal
    r.ok('[T-19-05] el handler de fondo resetea al primero (firstMsgId)', fn.includes('firstMsgId('));
    // solo dispara en vacío: filtra por e.target para ignorar .bubble/.node
    const filtraVacio = /e\.target/.test(fn) && (/bubble|node/.test(fn) || /e\.target === threadEl/.test(fn) || /closest\(/.test(fn));
    r.ok('[T-19-05] ignora clicks venidos de una .bubble/.node (mira e.target)', filtraVacio);
    // anti-drift: las burbujas siguen teniendo su propio onclick → no caen al fondo
    r.ok('[T-19-05] la burbuja conserva su propio selectMsg (no depende del fondo)', /bubble\.onclick = \(\) => selectMsg\(/.test(html));
  });
}
