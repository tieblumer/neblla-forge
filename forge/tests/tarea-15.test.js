// forge/tests/tarea-15.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 15 — Estado de la forja + botón "schedule restart".

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 15 — Estado de la forja + botón "schedule restart"');
  await r.step('[T-15-01] GET /api/forge/status devuelve la forma fija del contrato', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    sd._reset();
    const st = sd.statusShort();
    const keys = Object.keys(st).sort();
    r.eq('[T-15-01] claves EXACTAS {encendida,agentes,apagandose,reiniciada}', JSON.stringify(keys), JSON.stringify(['agentes', 'apagandose', 'encendida', 'reiniciada']));
    r.eq('[T-15-01] encendida === true', st.encendida, true);
    r.ok('[T-15-01] agentes es entero >= 0', Number.isInteger(st.agentes) && st.agentes >= 0);
    r.ok('[T-15-01] apagandose es booleano', typeof st.apagandose === 'boolean');
    r.ok('[T-15-01] reiniciada es booleano', typeof st.reiniciada === 'boolean');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    r.ok('[T-15-01] GET /api/forge/status responde la forma fija (statusShort())',
      /app\.get\('\/api\/forge\/status'[\s\S]{0,120}statusShort\(\)/.test(src));
  });

  await r.step('[T-15-02] El contador agentes refleja los headless vivos vía el embudo', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    sd._reset();
    r.eq('[T-15-02] el embudo arranca con 0 agentes', sd.statusShort().agentes, 0);
    const id = sd.trackStart({ who: 'miguel', chatId: '7' });   // entra al set (+1)
    r.eq('[T-15-02] tras registrar un hijo agentes=1', sd.statusShort().agentes, 1);
    r.eq('[T-15-02] activeCount coincide con el contador', sd.activeCount(), 1);
    sd.trackEnd(id);                                            // emite exit (−1)
    r.eq('[T-15-02] tras el exit agentes=0 (el +1/−1 cuadra)', sd.statusShort().agentes, 0);
    // idempotente: un exit repetido no pone el contador en negativo
    sd.trackEnd(id);
    r.eq('[T-15-02] un exit repetido no resta de más', sd.statusShort().agentes, 0);
  });

  await r.step('[T-15-03] Los tres spawn(\'claude\') pasan por el embudo único', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    // Solo puede quedar UN spawn('claude', …) directo en todo el fichero: el del embudo.
    const directas = (src.match(/spawn\('claude'/g) || []).length;
    r.eq('[T-15-03] un único spawn(\'claude\') directo en forge.js', directas, 1);
    // y ese spawn vive DENTRO de spawnClaude (el embudo), no suelto.
    r.ok('[T-15-03] el spawn directo está dentro de spawnClaude',
      /function spawnClaude\([\s\S]{0,400}spawn\('claude'/.test(src));
    // los tres lanzamientos pasan por el embudo: >=3 invocaciones (sin contar la def).
    const invocaciones = (src.match(/\bspawnClaude\(/g) || []).length - 1; // −1 = la propia función
    r.ok('[T-15-03] los tres lanzamientos llaman a spawnClaude (>=3)', invocaciones >= 3);
    // anti-drift: las tres funciones citadas existen
    r.ok('[T-15-03] existen launchHeadless / generateTitle / runHaikuSummary',
      src.includes('function launchHeadless(') && src.includes('generateTitle') && src.includes('runHaikuSummary'));
  });

  await r.step('[T-15-04] POST /api/forge/schedule-restart activa el drenaje y responde la forma fija', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    sd._reset();
    r.eq('[T-15-04] arranca sin drenar (apagandose=false)', sd.statusShort().apagandose, false);
    const agentes = sd.scheduleRestart();   // lo que dispara POST /api/forge/schedule-restart
    r.ok('[T-15-04] devuelve agentes entero', Number.isInteger(agentes));
    r.eq('[T-15-04] a partir de ahí apagandose=true', sd.statusShort().apagandose, true);
    // el endpoint envuelve eso en {ok:true, agentes}
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    r.ok('[T-15-04] POST /api/forge/schedule-restart → {ok:true, agentes}',
      /app\.post\('\/api\/forge\/schedule-restart'[\s\S]{0,200}scheduleRestart\(\)[\s\S]{0,120}res\.json\(\{ ok: true, agentes \}\)/.test(src));
  });

  await r.step('[T-15-05] schedule-restart es idempotente', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    sd._reset();
    const keep = sd.trackStart({ who: 'keep' });   // un agente vivo: drena pero NO baja a down
    const n1 = sd.scheduleRestart();
    r.eq('[T-15-05] primera llamada deja apagandose=true', sd.statusShort().apagandose, true);
    let relanzo = true;
    let n2;
    try { n2 = sd.scheduleRestart(); } catch { relanzo = false; }
    r.ok('[T-15-05] la segunda llamada no lanza', relanzo);
    r.ok('[T-15-05] devuelve un entero', Number.isInteger(n2));
    r.eq('[T-15-05] mismo recuento que la primera (no altera estado)', n2, n1);
    r.eq('[T-15-05] sigue apagandose=true tras la 2ª', sd.statusShort().apagandose, true);
    r.eq('[T-15-05] no se marcó reiniciada (idempotente, agentes>0)', sd.statusShort().reiniciada, false);
    sd.trackEnd(keep);
  });

  await r.step('[T-15-06] spawnClaude rechaza lanzar mientras se drena', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    sd._reset();
    const keep = sd.trackStart({ who: 'keep' });   // mantiene apagandose sin caer a down
    sd.scheduleRestart();
    const antes = sd.activeCount();
    let threw = false, msg = '';
    try { sd.trackStart({ who: 'nuevo' }); } catch (e) { threw = true; msg = e.message; }
    r.ok('[T-15-06] trackStart lanza durante el drenaje', threw);
    r.eq('[T-15-06] el error es exactamente "shutting down"', msg, 'shutting down');
    r.eq('[T-15-06] NO incrementó ACTIVE_AGENTS (no se aceptó trabajo)', sd.activeCount(), antes);
    // y el embudo llama a trackStart ANTES de spawn → si rechaza, no nace ningún hijo
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    r.ok('[T-15-06] spawnClaude llama trackStart ANTES de spawn(\'claude\')',
      /function spawnClaude\([\s\S]{0,200}trackStart\([\s\S]{0,200}spawn\('claude'/.test(src));
    sd.trackEnd(keep);
  });

  await r.step('[T-15-07] Un endpoint de trabajo responde 503 \'shutting down\' en drenaje', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    // Espejo de la compuerta real (app.use): drena + POST + ruta de trabajo → 503.
    function gate(isDraining, method, p, rutas) {
      if (!isDraining) return null;
      if (method !== 'POST') return null;
      if (rutas.some((re) => re.test(p))) return { code: 503, body: { ok: false, error: 'shutting down' } };
      return null;
    }
    const rutas = [/^\/api\/tareas\/[^/]+\/ejecutar$/, /^\/api\/chats\/[^/]+\/aube$/];
    const out = gate(true, 'POST', '/api/tareas/7/ejecutar', rutas);
    r.eq('[T-15-07] un endpoint de trabajo responde 503 en drenaje', out.code, 503);
    r.eq('[T-15-07] cuerpo EXACTO {ok:false, error:"shutting down"}',
      JSON.stringify(out.body), JSON.stringify({ ok: false, error: 'shutting down' }));
    // anti-drift sobre el forge.js real:
    r.ok('[T-15-07] la compuerta real corta con 503 {ok:false,error:"shutting down"}',
      /res\.status\(503\)\.json\(\{ ok: false, error: 'shutting down' \}\)/.test(src));
    r.ok('[T-15-07] /ejecutar y /aube están en la lista de rutas de trabajo',
      src.includes('ejecutar$/') && src.includes('aube$/'));
  });

  await r.step('[T-15-08] Las rutas de solo-lectura siguen vivas durante el drenaje', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function gate(isDraining, method, p, rutas) {
      if (!isDraining) return null;
      if (method !== 'POST') return null;
      if (rutas.some((re) => re.test(p))) return { code: 503, body: { ok: false, error: 'shutting down' } };
      return null;
    }
    const rutas = [/^\/api\/tareas\/[^/]+\/ejecutar$/, /^\/api\/chats\/[^/]+\/aube$/];
    // Las lecturas (GET) atraviesan la compuerta aunque la forja drene.
    r.ok('[T-15-08] GET /api/forge/status sigue vivo en drenaje', gate(true, 'GET', '/api/forge/status', rutas) === null);
    r.ok('[T-15-08] GET leer chats sigue vivo en drenaje', gate(true, 'GET', '/api/chats', rutas) === null);
    r.ok('[T-15-08] GET leer tareas sigue vivo en drenaje', gate(true, 'GET', '/api/tareas', rutas) === null);
    // anti-drift: el middleware real deja pasar todo lo que no sea POST
    r.ok('[T-15-08] el middleware real deja pasar las lecturas (no-POST)',
      /if \(req\.method !== 'POST'\) return next\(\)/.test(src));
  });

  await r.step('[T-15-09] Al quedar en cero agentes durante el drenaje se marca reiniciada y se programa el cierre', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    sd._reset();
    let drained = 0;
    sd.setOnDrained(() => { drained++; });   // forge.js engancha aquí el process.exit
    const id = sd.trackStart({ who: 'a' });
    sd.scheduleRestart();
    r.eq('[T-15-09] con un agente vivo aún NO reiniciada', sd.statusShort().reiniciada, false);
    sd.trackEnd(id);                          // sale el último agente → 0
    r.eq('[T-15-09] al llegar a 0 se marca reiniciada=true', sd.statusShort().reiniciada, true);
    r.eq('[T-15-09] el status alcanza a exponer reiniciada antes de morir', sd.statusFull().phase, 'down');
    r.eq('[T-15-09] onDrained se disparó UNA vez (programa el cierre)', drained, 1);
    // forge.js programa el process.exit(0) tras la gracia de 5s
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    r.ok('[T-15-09] forge.js programa process.exit(0) tras 5s de gracia',
      /setOnDrained\(\(\) => \{[\s\S]{0,300}setTimeout\([\s\S]{0,80}process\.exit\(0\)[\s\S]{0,40}\}, 5000\)/.test(src));
  });

  await r.step('[T-15-10] schedule-restart no mata el proceso si aún quedan agentes', async () => {
    const sd = await import('../../scripts/lib/forge-shutdown.js');
    sd._reset();
    let drained = 0;
    sd.setOnDrained(() => { drained++; });
    sd.trackStart({ who: 'a' });   // queda un claude trabajando
    sd.scheduleRestart();
    r.eq('[T-15-10] con agentes>0 NO se dispara el cierre', drained, 0);
    r.eq('[T-15-10] sigue en fase draining (no down)', sd.statusFull().phase, 'draining');
    r.eq('[T-15-10] el proceso sigue respondiendo el status', sd.statusShort().agentes, 1);
    r.eq('[T-15-10] no se marcó reiniciada todavía', sd.statusShort().reiniciada, false);
  });

  await r.step('[T-15-11] La lucecita pinta los tres estados según el status', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 2200) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'function pintarForgeStatus(st)');
    r.ok('[T-15-11] existe pintarForgeStatus', fn.length > 0);
    // verde "encendida" (running)
    r.ok('[T-15-11] estado verde: clase on + "encendida"',
      /className = 'forge-status on'/.test(fn) && fn.includes('encendida'));
    // ámbar "apagándose · N claudes" (draining)
    r.ok('[T-15-11] estado ámbar: clase draining + "apagándose" + N claudes',
      /className = 'forge-status draining'/.test(fn) && fn.includes('apagándose') && fn.includes("' claude' + plural(n)"));
    // gris/rojo "desconectada — reinicio manual" (down)
    r.ok('[T-15-11] estado gris/rojo: clase down + "desconectada — reinicio manual"',
      /className = 'forge-status down'/.test(fn) && fn.includes('desconectada — reinicio manual'));
    // la luz nace en la cabecera (bar-right)
    r.ok('[T-15-11] la lucecita #forgeStatus está en la cabecera', /id="forgeStatus"/.test(html));
  });

  await r.step('[T-15-12] El contador 🤖 N se alimenta del status en vivo', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 2200) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'function pintarForgeStatus(st)');
    // el contador 🤖 N se alimenta de st.agentes (el status en vivo)
    r.ok('[T-15-12] el contador sale de st.agentes', /const n = Number\(st\.agentes\)/.test(fn));
    r.ok('[T-15-12] pinta el chip 🤖 N', fn.includes("'🤖 ' + n"));
    // la sonda repinta sin recargar: cada poll vuelve a llamar a pintarForgeStatus
    const poll = bloque(html, 'async function pollForgeStatus()');
    r.ok('[T-15-12] la sonda repinta con el status nuevo', poll.includes('pintarForgeStatus(st)'));
    r.ok('[T-15-12] hay una sonda periódica propia (setInterval)', /setInterval\(pollForgeStatus/.test(html));
  });

  await r.step('[T-15-13] Fallo del fetch de status => desconectada', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 2200) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const poll = bloque(html, 'async function pollForgeStatus()');
    // un fetch que falla deja st=null (no se queda en el último estado bueno)
    r.ok('[T-15-13] el fetch fallido deja st=null', /catch \{ st = null; \}/.test(poll));
    r.ok('[T-15-13] solo acepta el cuerpo si la respuesta es ok', poll.includes('if (r.ok)'));
    // st=null pinta "desconectada — reinicio manual"
    const fn = bloque(html, 'function pintarForgeStatus(st)');
    r.ok('[T-15-13] st null → clase down (desconectada)',
      /if \(!st\) \{[\s\S]{0,200}forge-status down/.test(fn));
    r.ok('[T-15-13] el mensaje es "desconectada — reinicio manual"',
      /if \(!st\) \{[\s\S]{0,260}desconectada — reinicio manual/.test(fn));
  });

  await r.step('[T-15-14] El botón Schedule restart llama al endpoint con confirmación', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 1400) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    // el botón existe en la cabecera
    r.ok('[T-15-14] existe el botón "⟳ Schedule restart"', /id="btnRestart"[\s\S]{0,160}Schedule restart/.test(html));
    const fn = bloque(html, 'btnRestart.onclick');
    r.ok('[T-15-14] el handler pide confirmación', fn.includes('confirm('));
    r.ok('[T-15-14] hace POST a /api/forge/schedule-restart',
      /fetch\('\/api\/forge\/schedule-restart', \{ method: 'POST' \}\)/.test(fn));
    r.ok('[T-15-14] la confirmación va ANTES del POST (cancelar = no llama)',
      fn.indexOf('confirm(') > -1 && fn.indexOf('confirm(') < fn.indexOf('schedule-restart'));
    r.ok('[T-15-14] tras pulsar entra en modo "esperando reinicio"', fn.includes('esperandoReinicio = true'));
  });

  await r.step('[T-15-15] Una acción que recibe 503 \'shutting down\' reintenta cada 60s', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    function bloque(src, ancla, len = 1000) { const i = src.indexOf(ancla); return i === -1 ? '' : src.slice(i, i + len); }
    const fn = bloque(html, 'async function apagadoEnCurso(res, reintentar)');
    r.ok('[T-15-15] existe el guardián apagadoEnCurso', fn.length > 0);
    // detecta exactamente el par (503 + error:'shutting down')
    r.ok('[T-15-15] reconoce el status 503', /res\.status !== 503/.test(fn));
    r.ok('[T-15-15] y el cuerpo error:"shutting down"', fn.includes("body.error === 'shutting down'"));
    // muestra el aviso y reprograma la MISMA acción a 60s (no la descarta)
    r.ok('[T-15-15] muestra el aviso de reinicio en curso', fn.includes('avisoReinicio'));
    r.ok('[T-15-15] reprograma esa misma acción cada 60s', /setTimeout\(reintentar, 60000\)/.test(fn));
    // está cableado en varias acciones que lanzan trabajo
    r.ok('[T-15-15] cableado en charlar y en ejecutarTarea',
      /apagadoEnCurso\(res, \(\) => charlar\(\)\)/.test(html) && /apagadoEnCurso\(res, \(\) => ejecutarTarea\(id\)\)/.test(html));
  });

  await r.step('[T-15-16] Existen los ficheros nuevos previstos por el plan', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    // Los ficheros previstos por el plan existen
    const indexPath = path.join(ROOT, 'public', 'forge', 'index.html');
    const forgePath = path.join(ROOT, 'scripts', 'forge.js');
    const modPath = path.join(ROOT, 'scripts', 'lib', 'forge-shutdown.js');   // el registro separado
    r.ok('[T-15-16] existe public/forge/index.html', fs.existsSync(indexPath));
    r.ok('[T-15-16] existe scripts/forge.js', fs.existsSync(forgePath));
    r.ok('[T-15-16] existe el módulo del registro (scripts/lib/forge-shutdown.js)', fs.existsSync(modPath));
    const html = fs.readFileSync(indexPath, 'utf8');
    const src = fs.readFileSync(forgePath, 'utf8');
    r.ok('[T-15-16] index.html trae el bloque de estado (#forgeStatus)', html.includes('id="forgeStatus"'));
    r.ok('[T-15-16] forge.js trae el embudo único spawnClaude', src.includes('function spawnClaude('));
    r.ok('[T-15-16] forge.js expone los dos endpoints (status + schedule-restart)',
      src.includes("'/api/forge/status'") && src.includes("'/api/forge/schedule-restart'"));
  });
}
