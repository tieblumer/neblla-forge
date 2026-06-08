// forge/tests/tarea-23.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 23 — Un interruptor "Arranque automático: on/off" en la cabecera del forge. Con ON, la forja vigila la ventana de 5 horas de la suscripción (vía el /api/usage que ya existe) y, cuando se ha recuperado, lanza sola —de una en una— las tareas pendientes de construir (las que su paso recomendado es 'ejecutar'). Así aprovechamos el margen nocturno sin gastar de más y sin que la forja tenga que despertarse a sí misma: sigue viva, solo ociosa, y un ticker interno dispara cuando hay hueco..

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 23 — Un interruptor "Arranque automático: on/off" en la cabecera del forge. Con ON, la forja vigila la ventana de 5 horas de la suscripción (vía el /api/usage que ya existe) y, cuando se ha recuperado, lanza sola —de una en una— las tareas pendientes de construir (las que su paso recomendado es \'ejecutar\'). Así aprovechamos el margen nocturno sin gastar de más y sin que la forja tenga que despertarse a sí misma: sigue viva, solo ociosa, y un ticker interno dispara cuando hay hueco.');
  await r.step('[T-23-01] decidir() con el flag off no hace nada', async () => {
    const { decidir } = await import("../../scripts/lib/forge-autostart.js");
    const d = decidir({ on: false, phase: 'running', activeAgents: 0, usagePrimary: { usedPercent: 10 }, pendientes: [{ num: 1, id: '001' }] });
    r.eq("accion 'nada' con el flag off", d.accion, 'nada');
    r.eq("estado 'off'", d.estado, 'off');
    r.ok("sin tareaId (no lanza nada)", d.tareaId == null);
  });

  await r.step('[T-23-02] decidir() respeta el apagado de la forja (phase draining/down)', async () => {
    const { decidir } = await import("../../scripts/lib/forge-autostart.js");
    for (const phase of ['draining', 'down']) {
      const d = decidir({ on: true, phase, activeAgents: 0, usagePrimary: { usedPercent: 10 }, pendientes: [{ num: 1, id: '001' }] });
      r.eq(phase + ": accion 'nada' (respeta el apagado de F15)", d.accion, 'nada');
      r.ok(phase + ": no devuelve tareaId", d.tareaId == null);
    }
  });

  await r.step('[T-23-03] decidir() no lanza si ya hay un agente trabajando (una a una)', async () => {
    const { decidir } = await import("../../scripts/lib/forge-autostart.js");
    const d = decidir({ on: true, phase: 'running', activeAgents: 1, usagePrimary: { usedPercent: 10 }, pendientes: [{ num: 1, id: '001' }] });
    r.eq("accion 'nada' con un agente vivo (una a una)", d.accion, 'nada');
    r.ok("no lanza una segunda construcción", d.tareaId == null);
  });

  await r.step('[T-23-04] decidir() sin tareas pendientes informa \'sin-pendientes\'', async () => {
    const { decidir } = await import("../../scripts/lib/forge-autostart.js");
    const d = decidir({ on: true, phase: 'running', activeAgents: 0, usagePrimary: { usedPercent: 10 }, pendientes: [] });
    r.eq("accion 'nada' sin pendientes", d.accion, 'nada');
    r.eq("estado 'sin-pendientes'", d.estado, 'sin-pendientes');
    r.ok("sin tareaId", d.tareaId == null);
  });

  await r.step('[T-23-05] decidir() espera cuando no hay dato de uso (no arriesga)', async () => {
    const { decidir } = await import("../../scripts/lib/forge-autostart.js");
    const d = decidir({ on: true, phase: 'running', activeAgents: 0, usagePrimary: null, pendientes: [{ num: 1, id: '001' }] });
    r.eq("accion 'esperar' sin dato de uso (no arriesga)", d.accion, 'esperar');
    r.eq("estado 'esperando'", d.estado, 'esperando');
  });

  await r.step('[T-23-06] decidir() espera cuando el consumo está al tope o por encima', async () => {
    const mod = await import("../../scripts/lib/forge-autostart.js");
    const TOPE = (mod.TOPE != null) ? mod.TOPE : 80;
    const resetsAt = '2026-06-08T02:00:00Z';
    const d = mod.decidir({ on: true, phase: 'running', activeAgents: 0, usagePrimary: { usedPercent: TOPE, resetsAt }, pendientes: [{ num: 1, id: '001' }] });
    r.eq("accion 'esperar' al tope o por encima", d.accion, 'esperar');
    r.eq("estado 'esperando'", d.estado, 'esperando');
    r.eq("proximaVentana = usagePrimary.resetsAt", d.proximaVentana, resetsAt);
  });

  await r.step('[T-23-07] decidir() lanza la tarea más antigua cuando hay hueco y pendientes', async () => {
    const mod = await import("../../scripts/lib/forge-autostart.js");
    const TOPE = (mod.TOPE != null) ? mod.TOPE : 80;
    // pendientes ya ordenadas por num ascendente (la más antigua primero), como las entrega el ticker.
    const pendientes = [{ num: 1, id: '001' }, { num: 2, id: '002' }, { num: 3, id: '003' }];
    const d = mod.decidir({ on: true, phase: 'running', activeAgents: 0, usagePrimary: { usedPercent: Math.max(0, TOPE - 50) }, pendientes });
    r.eq("accion 'lanzar' con hueco y pendientes", d.accion, 'lanzar');
    r.eq("estado 'lanzando'", d.estado, 'lanzando');
    r.eq("tareaId = la más antigua (menor num)", d.tareaId, '001');
  });

  await r.step('[T-23-08] El tope es un umbral inclusivo: justo por debajo lanza, justo en el tope espera', async () => {
    const mod = await import("../../scripts/lib/forge-autostart.js");
    const TOPE = (mod.TOPE != null) ? mod.TOPE : 80;
    const base = { on: true, phase: 'running', activeAgents: 0, pendientes: [{ num: 1, id: '001' }] };
    const below = mod.decidir({ ...base, usagePrimary: { usedPercent: TOPE - 1 } });
    r.eq("justo por debajo del tope → 'lanzar'", below.accion, 'lanzar');
    const at = mod.decidir({ ...base, usagePrimary: { usedPercent: TOPE, resetsAt: '2026-06-08T02:00:00Z' } });
    r.eq("exactamente en el tope → 'esperar' (>= inclusivo)", at.accion, 'esperar');
  });

  await r.step('[T-23-09] Leer el flag por defecto da off cuando no hay fichero', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const mod = await import("../../scripts/lib/forge-autostart.js");
    const read = mod.readAutoStart || mod.leerAutoStart ||
      Object.values(mod).find((f, i) => typeof f === 'function' && /^(read|leer|load|get)/i.test(Object.keys(mod)[i]));
    r.ok("la lib expone un lector del flag", typeof read === 'function');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-default-'));
    let v;
    try { v = read(tmp); } catch (e) { v = read(); }
    const on = (v && typeof v === 'object') ? v.on : v;
    r.eq("sin fichero → nace apagado (on:false)", on, false);
  });

  await r.step('[T-23-10] Escribir y releer el flag conserva el valor', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path');
    const mod = await import("../../scripts/lib/forge-autostart.js");
    const keys = Object.keys(mod);
    const read = mod.readAutoStart || mod.leerAutoStart || mod[keys.find(k => typeof mod[k] === 'function' && /^(read|leer|load|get)/i.test(k))];
    const write = mod.writeAutoStart || mod.escribirAutoStart || mod[keys.find(k => typeof mod[k] === 'function' && /^(write|escribir|save|set)/i.test(k))];
    r.ok("la lib expone lector y escritor del flag", typeof read === 'function' && typeof write === 'function');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-rt-'));
    const put = (val) => { try { write(tmp, val); } catch { write(tmp, { on: val }); } };
    const get = () => { const v = read(tmp); return (v && typeof v === 'object') ? v.on : v; };
    put(true);
    r.eq("escribir on:true y releer → true", get(), true);
    put(false);
    r.eq("reescribir on:false y releer → false (round-trip)", get(), false);
  });

  await r.step('[T-23-11] GET /api/forge/autostart devuelve la forma fija del contrato', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.', i + anchor.length); return src.slice(i, j < 0 ? i + 1200 : j); }
    const b = block("app.get('/api/forge/autostart'");
    r.ok("existe GET /api/forge/autostart", b.length > 0);
    // la forma fija del contrato: on, estado, proximaVentana, pendientes
    r.ok("expone on", /\bon\b/.test(b));
    r.ok("expone estado", /estado/.test(b));
    r.ok("expone proximaVentana", /proximaVentana/.test(b));
    r.ok("expone pendientes", /pendientes/.test(b));
    // derivado del flag + el último veredicto de decidir() (var de módulo)
    r.ok("se alimenta del flag persistido (readAutoStart/leerAutoStart)", /(read|leer)AutoStart/i.test(src));
  });

  await r.step('[T-23-12] POST /api/forge/autostart persiste el flip y es idempotente', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.', i + anchor.length); return src.slice(i, j < 0 ? i + 1400 : j); }
    const b = block("app.post('/api/forge/autostart'");
    r.ok("existe POST /api/forge/autostart", b.length > 0);
    // persiste a disco vía la lib (write/escribirAutoStart)
    r.ok("persiste el flip con el escritor de la lib", /(write|escribir)AutoStart/i.test(b));
    // lee el on del body y responde con {ok:true, on}
    r.ok("lee on del body", /body[\s\S]{0,40}\.on\b/.test(b) || /\bon\b/.test(b));
    r.ok("responde ok:true", /ok:\s*true/.test(b));
  });

  await r.step('[T-23-13] arrancarConstruccion() está factorizada y el endpoint /ejecutar la usa', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    // arrancarConstruccion(tareaId) existe como función reutilizable
    r.ok("existe la función arrancarConstruccion(...)", /function\s+arrancarConstruccion\s*\(/.test(src) || /arrancarConstruccion\s*=\s*(async\s*)?\(/.test(src));
    // el endpoint /ejecutar la invoca en vez de duplicar el cuerpo
    const ej = (() => { const i = src.indexOf("app.post('/api/tareas/:id/ejecutar'"); if (i < 0) return ''; const j = src.indexOf('app.', i + 40); return src.slice(i, j < 0 ? i + 1200 : j); })();
    r.ok("existe el endpoint /ejecutar", ej.length > 0);
    r.ok("/ejecutar invoca arrancarConstruccion", /arrancarConstruccion\s*\(/.test(ej));
  });

  await r.step('[T-23-14] Un ticker periódico evalúa decidir() y dispara la construcción al \'lanzar\'', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    // hay un ticker setInterval que llama a decidir(...) y, al 'lanzar', arrancarConstruccion
    r.ok("importa/usa decidir de la lib de autostart", /decidir\s*\(/.test(src) && /forge-autostart/.test(src));
    r.ok("hay un setInterval (ticker)", /setInterval\s*\(/.test(src));
    // localizo la zona del ticker por la llamada a decidir
    const i = src.indexOf('decidir(');
    const z = i < 0 ? '' : src.slice(Math.max(0, i - 800), i + 800);
    r.ok("el ticker reúne las tareas con next.key==='ejecutar'", /next[\s\S]{0,12}key[\s\S]{0,20}ejecutar/.test(src) || /'ejecutar'/.test(z));
    r.ok("guarda el veredicto en una var de módulo para el GET", /=\s*decidir\s*\(/.test(src));
    r.ok("si accion==='lanzar' invoca arrancarConstruccion", /'lanzar'/.test(z) && /arrancarConstruccion\s*\(/.test(z));
  });

  await r.step('[T-23-15] El POST dispara un latido inmediato del ticker tras el flip', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.js'), 'utf8');
    function block(anchor){ const i = src.indexOf(anchor); if (i < 0) return ''; const j = src.indexOf('app.', i + anchor.length); return src.slice(i, j < 0 ? i + 1400 : j); }
    const b = block("app.post('/api/forge/autostart'");
    r.ok("existe POST /api/forge/autostart", b.length > 0);
    // el ticker está nombrado para poder dispararse a mano (un latido inmediato)
    const fnName = (src.match(/function\s+(\w*[Tt]ick\w*|latido\w*|autostartTick\w*|tickAutostart\w*)\s*\(/) || [])[1];
    const llamaLatido = !!fnName && new RegExp(fnName + '\\s*\\(').test(b);
    const llamaGenerico = /(tick|latido|heartbeat|evaluar)\w*\s*\(/i.test(b);
    r.ok("tras persistir dispara un latido del ticker de inmediato", llamaLatido || llamaGenerico);
    // la respuesta no depende del latido: el res.json se envía igualmente
    r.ok("responde ok:true sin depender del latido", /res\.json\([\s\S]{0,80}ok:\s*true/.test(b));
  });

  await r.step('[T-23-16] Existe el toggle \'Arranque automático\' en la cabecera, junto al estado de la forja', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // hay un toggle de 'Arranque automático'
    r.ok("aparece la etiqueta 'Arranque automático'", /Arranque autom[áa]tico/i.test(html));
    // y un control de toggle asociado al autostart (id/clase reconocible)
    r.ok("hay un control de toggle del autostart", /autostart|auto-start|autoStart/i.test(html));
    // colocado junto a la lucecita de estado de la forja (#forgeStatus, F15)
    r.ok("el front conoce #forgeStatus (la cabecera de estado)", /forgeStatus/.test(html));
  });

  await r.step('[T-23-17] El front lee GET /api/forge/autostart al cargar y pinta el toggle en su posición real', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // el front hace GET /api/forge/autostart
    r.ok("hace GET /api/forge/autostart", /\/api\/forge\/autostart/.test(html));
    // y refleja el campo on en la posición del toggle (lee r.on / data.on / .on para pintar el control)
    const usaOn = /\.on\b/.test(html) && /autostart|auto-start|autoStart/i.test(html);
    r.ok("refleja el campo on en la posición del toggle", usaOn);
    // el toggle se marca/desmarca según on (checked / classList / aria)
    r.ok("ajusta el estado visual del toggle (checked/class)", /checked|classList|aria-checked|\.toggle\(/.test(html));
  });

  await r.step('[T-23-18] Al pulsar el toggle hace POST /api/forge/autostart con {on}', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // al pulsar hace POST a /api/forge/autostart con body {on}
    const i = html.indexOf('/api/forge/autostart');
    r.ok("referencia /api/forge/autostart", i >= 0);
    // hay una llamada con method POST que manda on en el body, cerca del endpoint
    const post = /method:\s*['"]POST['"][\s\S]{0,200}\/api\/forge\/autostart/.test(html)
      || /\/api\/forge\/autostart[\s\S]{0,260}method:\s*['"]POST['"]/.test(html);
    r.ok("hace POST a /api/forge/autostart", post);
    r.ok("manda { on } en el body (JSON.stringify con on)", /JSON\.stringify\([\s\S]{0,60}on/.test(html));
  });

  await r.step('[T-23-19] El hint refleja cada estado del back', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // la línea de hint cubre los cuatro estados del back
    r.ok("hint 'esperando' menciona la ventana de 5h", /ventana de 5\s?h|recupere|recupera/i.test(html));
    r.ok("hint 'lanzando' = 'construyendo las tareas pendientes'", /construyendo las tareas pendientes/i.test(html));
    r.ok("hint 'sin-pendientes' = 'sin tareas pendientes que lanzar'", /sin tareas pendientes que lanzar/i.test(html));
    // usa proximaVentana (HH:MM) en el texto de espera
    r.ok("usa proximaVentana para el texto de espera", /proximaVentana/.test(html));
    // el front discrimina por el campo estado
    r.ok("discrimina por el campo estado", /estado/.test(html) && /esperando|lanzando|sin-pendientes/.test(html));
  });

  await r.step('[T-23-20] El front sondea el estado colgándose del poll de la forja existente', async () => {
    const fs = await import('fs'); const path = await import('path'); const { fileURLToPath } = await import('url');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'forge', 'index.html'), 'utf8');
    // existe el poll de la forja al que engancharse
    r.ok("existe pollForgeStatus", /function\s+pollForgeStatus|pollForgeStatus\s*=/.test(html));
    // el sondeo del autostart se cuelga del poll existente: o se llama dentro de pollForgeStatus,
    // o comparte su mismo setInterval — sin abrir un setInterval NUEVO dedicado al autostart.
    const pf = (() => { const i = html.indexOf('pollForgeStatus'); const s = html.indexOf('function', i - 30); const start = s >= 0 ? s : i; return html.slice(start, start + 900); })();
    const dentroDelPoll = /autostart/i.test(pf);
    const sinSondaNueva = !/setInterval\([^)]*autostart/i.test(html) && !/setInterval\([\s\S]{0,40}[Aa]utoStart/.test(html);
    r.ok("el sondeo de autostart se engancha al poll existente (no abre setInterval propio)", dentroDelPoll || sinSondaNueva);
    r.ok("el front lee /api/forge/autostart de forma periódica", /\/api\/forge\/autostart/.test(html));
  });
}
