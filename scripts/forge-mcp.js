/**
 * forge-mcp.js — servidor MCP mínimo (JSON-RPC 2.0 por stdio) con UNA herramienta.
 *
 * Es la ÚNICA mano del headless de charla: no puede leer ni escribir ficheros,
 * solo llamar a `contestar`. Esa llamada escribe su respuesta en el chat
 * correspondiente (sprint/chats/NNN.json) vía el almacén compartido.
 *
 * El headless lo arranca Claude Code a partir del --mcp-config que escribe
 * scripts/forge.js, que le pasa por `env`:
 *   FORGE_ROOT      — raíz del forge (para localizar sprint/chats)
 *   FORGE_CHAT_ID   — a qué conversación contesta
 *   FORGE_REPLY_TO  — id del mensaje de Tie al que responde (la "charla" cuelga de él)
 *
 * REGLA DE STDOUT: por aquí SOLO viajan mensajes JSON-RPC (uno por línea). Todo
 * log de depuración va a stderr; un console.log rompería el protocolo.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { appendMessage, replaceMessageText, readChat, readTarea, mutateTestsPlan, setTareaPlan, setMessagePlan, writeCyclePlan } from './lib/forge-store.js';
import { normalizarTestsPlan, fusionarTests, normalizarEstadoTest, ensamblarTestFile, aplicarResultadosCorrida } from './lib/forge-tests.js';
import { normalizarPlan, renderPlanTexto, COMPLEJIDADES } from './lib/forge-plan.js';

// Dónde escribe la herramienta determinista el fichero de test: el árbol en el que
// trabaja el headless (worktree de la tarea, o el forge). Lo pasa forge.js por env.
const WORKDIR = process.env.FORGE_WORKDIR || process.cwd();

const ROOT = process.env.FORGE_ROOT || process.cwd();
// El objetivo del ciclo (forge | project) ES la carpeta: el backbone vive en
// <ROOT>/<objetivo>/backbone con nombres GENÉRICOS (backbone.md, backbone_mini.md,
// features/<id>/). Así las herramientas de lectura miran siempre al mismo sitio.
const OBJETIVO = process.env.FORGE_OBJETIVO || 'forge';
function backboneDir() { return path.join(ROOT, OBJETIVO, 'backbone'); }
const CHAT_ID = process.env.FORGE_CHAT_ID || null;
const REPLY_TO = process.env.FORGE_REPLY_TO ? Number(process.env.FORGE_REPLY_TO) : null;
// Aubé escribe UN solo mensaje vivo: si se le pasa FORGE_REPLACE_MSG_ID, `contestar`
// REEMPLAZA ese mensaje (no añade) — así su mensaje converge en vez de acumularse.
const REPLACE_MSG_ID = process.env.FORGE_REPLACE_MSG_ID ? Number(process.env.FORGE_REPLACE_MSG_ID) : null;
// El mismo `contestar` sirve para la charla (answer) y para la apertura del
// backlog (opener); el tipo/intención del mensaje los fija quien lanza el headless.
const MSG_TYPE = process.env.FORGE_MSG_TYPE || 'charla';
const INTENT = process.env.FORGE_INTENT || 'answer';
const AUTHOR = process.env.FORGE_AUTHOR || 'iris';
// Discutir: el lado de la pareja (defiende|rechaza) se persiste en el mensaje para
// que el front sepa qué lado tomar en el turno siguiente. Vacío en el resto.
const STANCE = process.env.FORGE_STANCE || null;
// `preguntar` ESPERA la respuesta de Tie hasta este plazo; luego deja seguir al agente.
const QUESTION_TIMEOUT_MS = Number(process.env.FORGE_QUESTION_TIMEOUT_MS) || 30 * 60 * 1000;
const QUESTION_POLL_MS = 3000;

const TOOL = {
  name: 'contestar',
  description: 'Publica tu mensaje en la conversación del forge. Es tu única acción posible: '
    + 'lo usa cualquier personaje (Iris, William, Stevens, Miyagi, Romina/Ariel, Anselmo, Aubé…). '
    + 'El autor y el tipo del mensaje los fija quien te lanzó.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'El texto de tu mensaje para la conversación.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

const PREGUNTAR_TOOL = {
  name: 'preguntar',
  description: 'Hazle una PREGUNTA a Tie y ESPERA su respuesta. Úsala cuando te falte un '
    + 'dato o una decisión y no debas adivinar: en vez de seguir a ciegas, pregunta. Tu '
    + 'pregunta aparece en la conversación, Tie la responde, y esta llamada DEVUELVE su '
    + 'respuesta para que continúes. Si no contesta a tiempo, devuelve aviso para que sigas '
    + 'con tu mejor criterio. Úsala con criterio: solo lo que de verdad no puedas decidir tú.',
  inputSchema: {
    type: 'object',
    properties: {
      pregunta: { type: 'string', description: 'La pregunta, clara y concreta, para Tie.' },
    },
    required: ['pregunta'],
    additionalProperties: false,
  },
};

// ── herramientas de LECTURA del backbone (para trabajar el backlog) ──────────
const BACKBONE_RESUMEN_TOOL = {
  name: 'backbone_resumen',
  description: 'Lee el RESUMEN del backbone (backbone_mini.md): el mapa de capítulos y una '
    + 'línea por feature. Empieza por aquí para situarte rápido antes de pedir el detalle.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const BACKBONE_COMPLETO_TOOL = {
  name: 'backbone_completo',
  description: 'Lee el backbone COMPLETO (backbone.md): el catálogo entero — el porqué, el '
    + 'vocabulario del ciclo, las etapas y todas las features. Es largo; úsalo cuando de '
    + 'verdad necesites el contexto completo, no para una consulta puntual.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const LEER_FEATURE_TOOL = {
  name: 'leer_feature',
  description: 'Lee una FEATURE en detalle. Sin argumento, DEVUELVE LA LISTA de features que hay '
    + '(id + título) para que elijas. Con `feature` (p.ej. "F16"), devuelve su detalle (specs y, '
    + 'si los hay, tests/DOD).',
  inputSchema: {
    type: 'object',
    properties: {
      feature: { type: 'string', description: 'El id de la feature a leer (p.ej. "F16"). Vacío = lista todas.' },
    },
    additionalProperties: false,
  },
};

// ── herramientas de TESTS (Ana Liz) ──────────────────────────────────────────
const DEFINIR_TESTS_TOOL = {
  name: 'definir_tests',
  description: 'Entrega los tests EN PAPEL de esta tarea (Fase C, sin tocar código). Pasa el '
    + 'array COMPLETO de tests; la máquina lo valida y lo guarda en la tarea (reemplaza el '
    + 'conjunto, conservando el progreso de los que repitas por título). Cada test cuelga de '
    + '"general" o del name de una subtarea.',
  inputSchema: {
    type: 'object',
    properties: {
      tests: {
        type: 'array',
        description: 'El conjunto completo de tests definidos.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: '"general" o el name exacto de una subtarea.' },
            nivel: { type: 'string', enum: ['persistente', 'temporal'], description: 'persistente = regresión; temporal = de usar y tirar.' },
            titulo: { type: 'string', description: 'Qué comprueba, en una frase.' },
            dado: { type: 'string' }, cuando: { type: 'string' }, entonces: { type: 'string' },
          },
          required: ['titulo'],
        },
      },
    },
    required: ['tests'],
    additionalProperties: false,
  },
};
const CORRER_TESTS_TOOL = {
  name: 'correr_tests',
  description: 'Corre la batería de tests de ESTA tarea en tu worktree y te dice cuáles pasan y '
    + 'cuáles fallan (por su ID). Úsala para ITERAR: construye, corre, arregla lo que falle, '
    + 'vuelve a correr, hasta que estén todos en verde. No toca el árbol vivo.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const ESCRIBIR_TEST_TOOL = {
  name: 'escribir_test',
  description: 'Escribe el CÓDIGO de UN test (Fase D). Tú no tocas el disco: pasas el `id` del test '
    + '(T-num-NN) y su `codigo` (el cuerpo JS del caso, usando el reporter `r`; puede ser async). '
    + 'La máquina ENSAMBLA el fichero de test de la tarea de forma determinista (con el label '
    + '[T-id] para que el runner lo filtre) y marca ese test como ESCRITO. Llámala UNA VEZ por test.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'El ID del test (T-num-NN), tal cual te lo di.' },
      codigo: { type: 'string', description: 'El cuerpo JS del caso: usa `r` (reporter), p.ej. `const x = foo(); r.ok("hace algo", x === 1);`. Puede usar await.' },
    },
    required: ['id', 'codigo'],
    additionalProperties: false,
  },
};

// ── plan estructurado (Aubé) ──────────────────────────────────────────────────
const PROPONER_PLAN_TOOL = {
  name: 'proponer_plan',
  description: 'Entrega tu PLAN de implementación como DATOS (no texto libre). La máquina lo '
    + 'valida, lo guarda en la tarea y RENDERIZA ella misma el mensaje legible — tú no escribes '
    + 'el mensaje a mano. Es tu acción principal como PM: llámala UNA vez con el plan completo. '
    + 'Clasifica la COMPLEJIDAD, que gobierna los tests: facil (no necesita tests), mediana '
    + '(batería mínima), compleja (cobertura completa).',
  inputSchema: {
    type: 'object',
    properties: {
      resumen: { type: 'string', description: 'Qué se construye y por qué (una o dos frases).' },
      complejidad: { type: 'string', enum: COMPLEJIDADES, description: 'facil | mediana | compleja — gobierna cuántos tests pide la tarea.' },
      partes: {
        type: 'array',
        description: 'Las piezas del trabajo (borrador de las futuras subtareas paralelas).',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre corto y único de la parte.' },
            hace: { type: 'string', description: 'Qué hace esta parte.' },
            ficheros: { type: 'array', items: { type: 'string' }, description: 'Zonas/globs que toca.' },
          },
          required: ['name'],
        },
      },
      contrato: {
        type: 'array',
        description: 'Los ACUERDOS (interfaz de forma fija) entre partes que trabajan en paralelo.',
        items: {
          type: 'object',
          properties: {
            entre: { type: 'array', items: { type: 'string' }, description: 'Los names de las partes que comparten esta frontera.' },
            interfaz: { type: 'string', description: 'La forma fija por la que se hablan.' },
            acuerdo: { type: 'string', description: 'El acuerdo concreto sobre esa interfaz.' },
          },
          required: ['interfaz'],
        },
      },
    },
    required: ['resumen', 'complejidad'],
    additionalProperties: false,
  },
};

// ── arranque del ciclo (Iris analista / William analista) ─────────────────────
// Las usan los DOS analistas que dispara "Empezar ciclo". No escriben en ningún
// chat: entregan su criterio como DATOS y el servidor (determinista) hace el resto
// (crea la rama, abre una conversación por frente / por sugerencia).
const PLAN_CICLO_TOOL = {
  name: 'plan_ciclo',
  description: 'ARRANCA el ciclo (eres Iris). Tras leer la conversación entera, entrega como DATOS: '
    + '(1) `rama` = de 1 a 3 palabras que resuman el objetivo general del ciclo (será el nombre de la '
    + 'rama git), y (2) `frentes` = de 1 a 10 frentes DISTINTOS por donde atacar el problema, NO '
    + 'redundantes entre sí (cada uno ataca un problema diferente). El servidor crea la rama y abre una '
    + 'conversación por frente. Llámala UNA sola vez; con eso terminas.',
  inputSchema: {
    type: 'object',
    properties: {
      rama: { type: 'string', description: 'De 1 a 3 palabras que resumen el objetivo del ciclo (p.ej. "amigos cross-app").' },
      frentes: {
        type: 'array',
        description: 'De 1 a 10 frentes distintos, no redundantes, cada uno atacando un problema diferente.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Título corto del frente (qué ataca).' },
            angulo: { type: 'string', description: 'El ángulo concreto: por qué este frente, qué problema toca y por dónde empezar.' },
          },
          required: ['titulo'],
        },
      },
    },
    required: ['rama', 'frentes'],
    additionalProperties: false,
  },
};
const TECH_CICLO_TOOL = {
  name: 'tech_ciclo',
  description: 'SUGIERE tecnologías para el ciclo (eres William, mirada hacia fuera). Tras leer la '
    + 'conversación, entrega como DATOS de 1 a 3 `sugerencias` de tecnologías, técnicas o herramientas '
    + 'externas que vendría bien conocer o tener en cuenta para este ciclo. El servidor abre una '
    + 'conversación por sugerencia. Llámala UNA sola vez; con eso terminas.',
  inputSchema: {
    type: 'object',
    properties: {
      sugerencias: {
        type: 'array',
        description: 'De 1 a 3 tecnologías/técnicas/herramientas externas relevantes para este ciclo.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Nombre de la tecnología/técnica/herramienta.' },
            porque: { type: 'string', description: 'Por qué encaja en este ciclo y qué aportaría.' },
          },
          required: ['titulo'],
        },
      },
    },
    required: ['sugerencias'],
    additionalProperties: false,
  },
};

const TOOLS = [TOOL, PREGUNTAR_TOOL, BACKBONE_RESUMEN_TOOL, BACKBONE_COMPLETO_TOOL, LEER_FEATURE_TOOL, DEFINIR_TESTS_TOOL, ESCRIBIR_TEST_TOOL, CORRER_TESTS_TOOL, PROPONER_PLAN_TOOL, PLAN_CICLO_TOOL, TECH_CICLO_TOOL];

// La tarea de este hilo (CHAT_ID → chat.tareaId → tarea). null si el hilo no es de tarea.
function tareaDelHilo() {
  try { const c = readChat(ROOT, CHAT_ID); return (c && c.tareaId) ? readTarea(ROOT, c.tareaId) : null; }
  catch { return null; }
}
function handleDefinirTests(id, args) {
  const tarea = tareaDelHilo();
  if (!tarea) return reply(id, { isError: true, content: [{ type: 'text', text: 'Este hilo no es de una tarea; no hay dónde guardar los tests.' }] });
  const arr = Array.isArray(args.tests) ? args.tests : null;
  if (!arr || !arr.length) return reply(id, { isError: true, content: [{ type: 'text', text: 'Faltan los tests (array `tests`).' }] });
  const nuevo = normalizarTestsPlan(arr);
  if (!nuevo.tests.length) return reply(id, { isError: true, content: [{ type: 'text', text: 'Ningún test válido (cada uno necesita al menos `titulo`).' }] });
  const merged = fusionarTests(tarea.testsPlan, nuevo);
  mutateTestsPlan(ROOT, tarea.id, () => ({ ...merged, generado: true, generadoAt: new Date().toISOString() }));
  const n = merged.tests.length;
  reply(id, { content: [{ type: 'text', text: `Guardados ${n} tests en la tarea ${tarea.id}. Ahora escribe una nota corta para Tie con \`contestar\`.` }] });
}
// Miguel corre la batería de la tarea EN SU WORKTREE (FORGE_WORKDIR) e itera. Reusa
// el mismo veredicto que el servidor (aplicarResultadosCorrida) y refleja el estado
// de cada test en la tarea, para que la UI lo pinte aunque lo corra Miguel.
function handleCorrerTests(id) {
  const tarea = tareaDelHilo();
  if (!tarea) return reply(id, { isError: true, content: [{ type: 'text', text: 'Este hilo no es de una tarea.' }] });
  const plan = normalizarTestsPlan(tarea.testsPlan);
  const conId = plan.tests.filter((t) => t.id);
  if (!conId.length) return reply(id, { isError: true, content: [{ type: 'text', text: 'No hay tests escritos (con ID) que correr en esta tarea.' }] });
  const rel = plan.testsFile || `forge/tests/tarea-${tarea.num}.test.js`;
  const token = path.basename(String(rel)).replace(/\.test\.js$/, '');
  const abs = path.join(WORKDIR, rel);
  if (!fs.existsSync(abs)) return reply(id, { isError: true, content: [{ type: 'text', text: `No encuentro el fichero de tests en tu worktree (${rel}).` }] });
  let res;
  try { res = spawnSync('node', ['forge/tests/run-forge.js', token], { cwd: WORKDIR, encoding: 'utf8', timeout: 5 * 60 * 1000 }); }
  catch (e) { return reply(id, { isError: true, content: [{ type: 'text', text: 'No pude lanzar el runner: ' + e.message }] }); }
  const out = (res.stdout || '') + (res.stderr || '');
  const r = aplicarResultadosCorrida(plan.tests, out);
  try { mutateTestsPlan(ROOT, tarea.id, (p) => ({ ...normalizarTestsPlan(p), tests: aplicarResultadosCorrida(normalizarTestsPlan(p).tests, out).tests, ultimaCorrida: new Date().toISOString() })); } catch {}
  const fallidos = r.tests.filter((t) => t.estado === 'falla').map((t) => `${t.id} (${t.titulo})`);
  const resumen = `Resultado: ${r.pasa} pasan, ${r.falla} fallan, ${r.indet} sin determinar (de ${r.total}).`
    + (fallidos.length ? '\nFallan:\n  - ' + fallidos.join('\n  - ') + '\nArréglalos y vuelve a correr.' : '\n¡Todos en verde!');
  reply(id, { content: [{ type: 'text', text: resumen }] });
}
function handleProponerPlan(id, args) {
  if (!CHAT_ID) return reply(id, { isError: true, content: [{ type: 'text', text: 'No sé en qué hilo proponer el plan (falta FORGE_CHAT_ID).' }] });
  const plan = normalizarPlan(args);
  if (!plan.resumen) return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta el `resumen` del plan (qué se construye y por qué).' }] });
  const texto = renderPlanTexto(plan);
  try {
    // 1) deja el plan + el texto legible en TU mensaje (la fuente canónica = msg.plan).
    if (REPLACE_MSG_ID != null) {
      setMessagePlan(ROOT, CHAT_ID, REPLACE_MSG_ID, { plan, text: texto });
    } else {
      const m = appendMessage(ROOT, CHAT_ID, { type: 'tarea', author: AUTHOR, intent: INTENT, replyTo: REPLY_TO, text: texto });
      setMessagePlan(ROOT, CHAT_ID, m.id, { plan });
    }
    // 2) si este hilo YA es de una tarea (replan), guárdalo directo en ella.
    const tarea = tareaDelHilo();
    if (tarea) setTareaPlan(ROOT, tarea.id, plan);
  } catch (e) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'No pude guardar el plan: ' + e.message }] });
  }
  reply(id, { content: [{ type: 'text', text: `Plan guardado (complejidad: ${plan.complejidad}, ${plan.partes.length} parte(s)). El forge ya renderizó tu mensaje; con esto has terminado.` }] });
}
// Iris analista: graba {rama, frentes} en el scratch. El servidor lo consume al
// salir el headless (crea la rama + abre una conversación por frente).
function handlePlanCiclo(id, args) {
  const rama = String(args && args.rama != null ? args.rama : '').trim();
  const frentesIn = Array.isArray(args && args.frentes) ? args.frentes : [];
  if (!rama) return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta `rama` (1-3 palabras que resuman el objetivo del ciclo).' }] });
  const frentes = frentesIn
    .map((f) => ({ titulo: String((f && f.titulo) || '').trim(), angulo: String((f && f.angulo) || '').trim() }))
    .filter((f) => f.titulo)
    .slice(0, 10);
  if (!frentes.length) return reply(id, { isError: true, content: [{ type: 'text', text: 'Hace falta al menos un frente (con `titulo`).' }] });
  try {
    writeCyclePlan(ROOT, 'plan', { rama, frentes, at: new Date().toISOString() });
  } catch (e) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'No pude guardar el plan del ciclo: ' + e.message }] });
  }
  reply(id, { content: [{ type: 'text', text: `Arranque registrado: rama "${rama}" y ${frentes.length} frente(s). El forge creará la rama y abrirá las conversaciones; con esto has terminado.` }] });
}

// William analista: graba {sugerencias} en el scratch (1-3 tecnologías externas).
function handleTechCiclo(id, args) {
  const sugIn = Array.isArray(args && args.sugerencias) ? args.sugerencias : [];
  const sugerencias = sugIn
    .map((s) => ({ titulo: String((s && s.titulo) || '').trim(), porque: String((s && s.porque) || '').trim() }))
    .filter((s) => s.titulo)
    .slice(0, 3);
  if (!sugerencias.length) return reply(id, { isError: true, content: [{ type: 'text', text: 'Hace falta al menos una sugerencia (con `titulo`).' }] });
  try {
    writeCyclePlan(ROOT, 'tech', { sugerencias, at: new Date().toISOString() });
  } catch (e) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'No pude guardar las tecnologías del ciclo: ' + e.message }] });
  }
  reply(id, { content: [{ type: 'text', text: `Registradas ${sugerencias.length} tecnología(s). El forge abrirá una conversación por cada una; con esto has terminado.` }] });
}

function handleEscribirTest(id, args) {
  const tarea = tareaDelHilo();
  if (!tarea) return reply(id, { isError: true, content: [{ type: 'text', text: 'Este hilo no es de una tarea.' }] });
  const tid = String(args.id == null ? '' : args.id).trim();
  const codigo = String(args.codigo == null ? '' : args.codigo);
  if (!tid) return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta `id` (el T-num-NN del test).' }] });
  if (!codigo.trim()) return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta `codigo` (el cuerpo del caso).' }] });
  const plan0 = normalizarTestsPlan(tarea.testsPlan);
  if (!plan0.tests.some((t) => t.id === tid)) {
    return reply(id, { isError: true, content: [{ type: 'text', text: `No existe un test con id ${tid} en esta tarea. IDs válidos: ${plan0.tests.map((t) => t.id).filter(Boolean).join(', ') || '(ninguno sellado)'}.` }] });
  }
  // marca el test escrito + guarda su código; reensambla el fichero (determinista).
  const relFile = 'forge/tests/tarea-' + tarea.num + '.test.js';
  const updated = mutateTestsPlan(ROOT, tarea.id, (plan) => {
    const p = normalizarTestsPlan(plan);
    const tests = p.tests.map((t) => t.id === tid ? { ...t, codigo, estado: 'escrito' } : t);
    return { ...p, tests, testsFile: relFile };
  });
  let escritos = 0;
  try {
    const content = ensamblarTestFile(updated.testsPlan, { num: tarea.num, title: tarea.title });
    const abs = path.join(WORKDIR, relFile);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    escritos = normalizarTestsPlan(updated.testsPlan).tests.filter((t) => t.codigo && t.codigo.trim()).length;
  } catch (e) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'Guardé el test pero no pude escribir el fichero: ' + e.message }] });
  }
  reply(id, { content: [{ type: 'text', text: `Test ${tid} escrito (${escritos} en el fichero ${relFile}). Sigue con el siguiente, o cierra con \`contestar\`.` }] });
}

// Lee un fichero del backbone; texto o un aviso claro si falta (fail-soft: el
// agente recibe el motivo en vez de un error de protocolo).
function readBackboneFile(name) {
  const f = path.join(backboneDir(), name);
  try { return { ok: true, text: fs.readFileSync(f, 'utf8') }; }
  catch { return { ok: false, text: `No encontré ${name} en ${backboneDir()} (objetivo: ${OBJETIVO}). Puede que aún no exista.` }; }
}
function listFeatures() {
  const dir = path.join(backboneDir(), 'features');
  let ids;
  try { ids = fs.readdirSync(dir).filter((d) => { try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; } }); }
  catch { return `No hay carpeta de features en ${dir} (objetivo: ${OBJETIVO}).`; }
  if (!ids.length) return 'Todavía no hay features documentadas.';
  ids.sort();
  const rows = ids.map((id) => {
    let title = '';
    try {
      const first = fs.readFileSync(path.join(dir, id, 'specs.md'), 'utf8').split('\n').find((l) => l.startsWith('# '));
      if (first) title = first.replace(/^#\s*/, '');
    } catch { /* sin specs */ }
    return `- ${id}${title ? ' — ' + title.replace(/^[^—]*—\s*/, '') : ''}`;
  });
  return `Features (${ids.length}). Pide una con leer_feature({feature:"<id>"}):\n\n` + rows.join('\n');
}
function readFeature(id) {
  const safe = String(id).replace(/[^\w.\-]/g, '');   // sin trucos de ruta
  const fdir = path.join(backboneDir(), 'features', safe);
  let files;
  try { files = fs.readdirSync(fdir).filter((f) => f.endsWith('.md')); }
  catch { return `No existe la feature "${safe}". Llama a leer_feature sin argumento para ver la lista.`; }
  // specs primero, luego el resto en orden alfabético.
  files.sort((a, b) => (a === 'specs.md' ? -1 : b === 'specs.md' ? 1 : a.localeCompare(b)));
  return files.map((f) => {
    let body = '';
    try { body = fs.readFileSync(path.join(fdir, f), 'utf8').trim(); } catch { body = '(ilegible)'; }
    return `━━━ ${safe}/${f} ━━━\n${body}`;
  }).join('\n\n');
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

// `preguntar`: escribe la pregunta en el chat y ESPERA (sondeo) a que Tie responda
// — su respuesta es un mensaje de 'tie' que CUELGA de la pregunta (replyTo = su id).
// No bloquea el bucle de stdin: sondea con setTimeout y responde al `id` JSON-RPC
// cuando llega la respuesta o vence el plazo. Así el agente retoma con lo que digas.
function handlePreguntar(id, args) {
  const pregunta = String((args && (args.pregunta != null ? args.pregunta : args.text)) || '').trim();
  if (!pregunta) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta la pregunta.' }] });
  }
  if (!CHAT_ID) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'No sé en qué chat preguntar (falta FORGE_CHAT_ID).' }] });
  }
  let q;
  try {
    q = appendMessage(ROOT, CHAT_ID, { type: 'pregunta', author: AUTHOR, intent: 'request', replyTo: REPLY_TO, text: pregunta });
  } catch (e) {
    return reply(id, { isError: true, content: [{ type: 'text', text: 'No pude publicar la pregunta: ' + e.message }] });
  }
  const qId = q.id;
  const deadline = Date.now() + QUESTION_TIMEOUT_MS;
  const poll = () => {
    let ans = null;
    try {
      const chat = readChat(ROOT, CHAT_ID);
      ans = (chat && chat.messages || []).find((m) => m.author === 'tie' && Number(m.replyTo) === Number(qId));
    } catch { /* lectura fallida: reintenta en el siguiente tick */ }
    if (ans) {
      return reply(id, { content: [{ type: 'text', text: 'Tie respondió: ' + String(ans.text || '') }] });
    }
    if (Date.now() > deadline) {
      return reply(id, { content: [{ type: 'text', text: '(Tie no respondió a tiempo. Sigue con tu mejor criterio y deja anotado que quedó esta pregunta abierta.)' }] });
    }
    setTimeout(poll, QUESTION_POLL_MS);
  };
  setTimeout(poll, QUESTION_POLL_MS);
}

function handle(msg) {
  const { id, method, params } = msg;
  // Notificaciones (sin id): no se responden.
  const isNotification = (id === undefined || id === null);

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'forge', version: '0.1.0' },
      });
      return;

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notificaciones, se ignoran

    case 'ping':
      if (!isNotification) reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (name === 'preguntar') return handlePreguntar(id, args);
      if (name === 'backbone_resumen') {
        return reply(id, { content: [{ type: 'text', text: readBackboneFile('backbone_mini.md').text }] });
      }
      if (name === 'backbone_completo') {
        return reply(id, { content: [{ type: 'text', text: readBackboneFile('backbone.md').text }] });
      }
      if (name === 'leer_feature') {
        const f = String(args.feature == null ? '' : args.feature).trim();
        return reply(id, { content: [{ type: 'text', text: f ? readFeature(f) : listFeatures() }] });
      }
      if (name === 'definir_tests') return handleDefinirTests(id, args);
      if (name === 'escribir_test') return handleEscribirTest(id, args);
      if (name === 'correr_tests') return handleCorrerTests(id);
      if (name === 'proponer_plan') return handleProponerPlan(id, args);
      if (name === 'plan_ciclo') return handlePlanCiclo(id, args);
      if (name === 'tech_ciclo') return handleTechCiclo(id, args);
      if (name !== 'contestar') {
        return fail(id, -32602, 'herramienta desconocida: ' + name);
      }
      const text = String(args.text == null ? '' : args.text).trim();
      if (!text) {
        return reply(id, { isError: true, content: [{ type: 'text', text: 'Falta el texto de la respuesta.' }] });
      }
      if (!CHAT_ID) {
        return reply(id, { isError: true, content: [{ type: 'text', text: 'No sé a qué chat contestar (falta FORGE_CHAT_ID).' }] });
      }
      try {
        let created;
        if (REPLACE_MSG_ID != null) {
          // mensaje vivo (Aubé): reescribe el mismo mensaje, conserva su sitio.
          created = replaceMessageText(ROOT, CHAT_ID, REPLACE_MSG_ID, text);
          reply(id, {
            content: [{ type: 'text', text: `Mensaje #${created.id} reescrito en el chat ${CHAT_ID}.` }],
          });
        } else {
          created = appendMessage(ROOT, CHAT_ID, {
            type: MSG_TYPE,
            author: AUTHOR,
            intent: INTENT,
            replyTo: REPLY_TO,
            text,
            stance: STANCE,
          });
          reply(id, {
            content: [{ type: 'text', text: `Contestación publicada en el chat ${CHAT_ID} (mensaje #${created.id}, en respuesta a #${REPLY_TO}).` }],
          });
        }
      } catch (e) {
        reply(id, { isError: true, content: [{ type: 'text', text: 'No pude publicar: ' + e.message }] });
      }
      return;
    }

    default:
      if (!isNotification) fail(id, -32601, 'método no soportado: ' + method);
  }
}

// ── bucle de lectura de stdin (JSON por líneas) ──────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { console.error('[forge-mcp] línea no-JSON ignorada:', e.message); continue; }
    try { handle(msg); }
    catch (e) { console.error('[forge-mcp] error manejando', msg && msg.method, e.message); }
  }
});
process.stdin.on('end', () => process.exit(0));
