/**
 * mesa.js — el "camarero" de la mesa de dibujo.
 *
 * Un servidor Express 5 minúsculo que sirve la mesa (mesa.html), el converter
 * (svg-doc.js, una sola verdad) y la API del cuaderno compartido entre Tie (en
 * el navegador) y Perotti (un Claude diseñador headless).
 *
 * Arranque:   node scripts/mesa.js            (puerto 4321 por defecto)
 *             MESA_PORT=5000 node scripts/mesa.js
 *
 * NO se integra en app.js: es una herramienta INTERNA, suelta, sin BBDD.
 *
 * El cuaderno vive en public/mesa/sessions/<id>.json. v1 = una sesión fija
 * "sketch". Concurrencia: un solo proceso camarero + la regla "no save mientras
 * thinking" → sin lockfile. Perotti es el ÚNICO escritor durante `thinking`, y
 * solo toca `doc` + añade a `conversation`; el camarero gestiona status/rev/turn.
 */

import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toSvg, svgToDoc } from './svg-doc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.MESA_PORT) || 4321;
const SESSIONS_DIR = path.join(ROOT, 'public', 'mesa', 'sessions');
const REFS_DIR = path.join(ROOT, 'public', 'mesa', 'refs');
const MESA_HTML = path.join(ROOT, 'public', 'mesa', 'mesa.html');
const SVG_DOC_JS = path.join(ROOT, 'scripts', 'svg-doc.js');
const PEROTTI_TIMEOUT_MS = 10 * 60 * 1000;

// ── utilidades de disco ──────────────────────────────────────────────────────

// Escritura atómica con retry de EPERM en Windows (tmp + rename). Copiada del
// patrón probado de scripts/sprint.js: en win32 un indexador/antivirus puede
// retener un lock transitorio sobre el tmp recién escrito → EPERM/EBUSY.
function atomicWrite(file, contents) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, contents);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') && i < 10) {
        const until = Date.now() + 25; while (Date.now() < until) { /* spin */ }
        continue;
      }
      try { fs.writeFileSync(file, contents); try { fs.unlinkSync(tmp); } catch {} return; }
      catch { throw e; }
    }
  }
}

function sessionPath(id) {
  // Sesión = nombre de fichero simple, sin travesía de rutas.
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  return path.join(SESSIONS_DIR, safe + '.json');
}

function readSession(id) {
  const p = sessionPath(id);
  if (!p || !fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeSession(id, book) {
  const p = sessionPath(id);
  book.updatedAt = new Date().toISOString();
  atomicWrite(p, JSON.stringify(book, null, 2) + '\n');
}

// ── estantería: alta de cuadernos ─────────────────────────────────────────────
// slug a partir de un título libre (o vacío). Solo [a-z0-9-], sin chocar nunca
// con la travesía de rutas (sessionPath ya saneaba, esto es para nombres bonitos).
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// Elige un id de fichero libre: parte de `base`, y si ya existe sufija -2/-3…
function freeSessionId(base) {
  let root = slugify(base);
  if (!root) {
    // sin título → dibujo-N por el primer hueco
    let i = 1;
    while (fs.existsSync(sessionPath('dibujo-' + i))) i++;
    return 'dibujo-' + i;
  }
  if (!fs.existsSync(sessionPath(root))) return root;
  let i = 2;
  while (fs.existsSync(sessionPath(root + '-' + i))) i++;
  return root + '-' + i;
}

// Semilla de un cuaderno nuevo. Compartida por "nuevo en blanco" y por "import":
// si llega un `doc`, ese es el dibujo; si no, LIENZO EN BLANCO (no copia nada).
// Escribe el fichero y devuelve { id, book }.
function seedBook(id, { title, doc, note } = {}) {
  const blank = { width: 100, height: 100, layers: [{ name: 'Capa 1', paths: [] }] };
  const useDoc = (doc && typeof doc === 'object') ? doc : blank;
  const firstLine = note
    ? note
    : (doc ? 'Dibujo importado. Edita o pídeme un cambio.' : 'Lienzo en blanco. Dibuja o pídeme algo.');
  const book = {
    version: 1,
    id,
    title: title && String(title).trim() ? String(title).trim() : id,
    status: 'idle',
    turn: 'tie',
    rev: 0,
    outputPath: 'public/mesa/' + id + '.svg',
    doc: useDoc,
    conversation: [
      { who: 'perotti', at: new Date().toISOString(), text: firstLine },
    ],
  };
  writeSession(id, book);
  return { id, book };
}

// Resumen ligero de un cuaderno para la lista de la estantería (NO el doc entero).
function summarize(id) {
  const book = readSession(id);
  if (!book) return null;
  return {
    id,
    title: book.title || id,
    status: book.status || 'idle',
    rev: book.rev || 0,
    updatedAt: book.updatedAt || null,
    outputPath: book.outputPath || null,
  };
}

// ── Perotti headless (suscripción, SIN API key) ──────────────────────────────
// Patrón de scripts/sprint.js: spawn('claude', ['-p', prompt, '--allowedTools',
// allowed]) con un ARRAY de args y SIN shell → cmd.exe nunca ve (ni destroza)
// los metacaracteres del prompt en win32. JAMÁS ANTHROPIC_API_KEY.

function perottiPrompt(bookAbsPath) {
  return [
    'Eres Perotti, el diseñador de SVG de Neblla. Lee primero backbone/perotti.md',
    'para recordar tu oficio y tu bucle (dibuja → renderiza → MIRA el PNG → ajusta).',
    '',
    'Estás en una MESA compartida con Tie. El cuaderno de la sesión está en:',
    `  ${bookAbsPath}`,
    'Es un JSON con un campo `doc` (el modelo de scripts/svg-doc.js: capas → paths →',
    'anclas con manejadores bézier `in`/`out` en offsets relativos) y un array',
    '`conversation`. NO existe ningún `d` crudo: lo escribe el converter.',
    '',
    'Tu ronda (UNA sola por arranque):',
    '1) Lee el cuaderno y fíjate en el ÚLTIMO mensaje de Tie en `conversation`.',
    '2) Mira el estado actual del dibujo: saca el SVG con',
    `     node scripts/svg-doc.js ${bookAbsPath} --out public/mesa/.mesa-current.svg`,
    '   y renderiza con',
    '     node scripts/render-svg.js public/mesa/.mesa-current.svg --size 64 --bg white',
    '   Abre el PNG resultante con Read y MÍRALO de verdad.',
    '3) Haz lo que pide Tie EDITANDO el modelo del `doc` (mueve/añade/quita anclas,',
    '   ajusta `in`/`out`, cambia fill/closed…) con Edit sobre el cuaderno. NUNCA',
    '   escribas un atributo `d` a mano: solo tocas el modelo.',
    '   El modelo soporta además (todo opcional): `fillOpacity`/`strokeOpacity`',
    '   (0..1) en cada path; `fill` puede ser un color o `"url(#gId)"` apuntando a',
    '   un gradiente declarado en `doc.gradients` ({ [id]:{ type:"linear", stops:',
    '   [{offset,color,opacity?}], coords? } }, v2 = lineal vertical, 2 stops).',
    '   Las anclas se numeran por-path por POSICIÓN: "ancla N" = la posición N',
    '   (1-based) en el array `anchors[]` del path en cuestión.',
    '   Una capa con `kind:"image"` (campos `src`/`opacity`) es SOLO una',
    '   referencia visual de fondo para que Tie calque encima: NO se exporta y',
    '   NO se edita. Ignórala por completo — no la toques, no dibujes sobre su',
    '   `src` ni la borres.',
    '4) Re-renderiza y vuelve a mirar; itera hasta que esté bien.',
    '5) Añade UN turno tuyo al final de `conversation` con',
    '   { "who":"perotti", "at":"<iso>", "text":"qué cambiaste" }.',
    '',
    'NO toques `status`, `rev` ni `turn`: eso lo gestiona el camarero. Toca solo',
    '`doc` y `conversation`. Cuando termines, sal.',
  ].join('\n');
}

// Lanza a Perotti SIN bloquear. Al salir, relee el cuaderno (Perotti ya dejó su
// doc + turno), devuelve el control a Tie (status idle, turn tie, rev++).
function launchPerotti(id) {
  const bookAbs = sessionPath(id);
  const prompt = perottiPrompt(bookAbs);
  const allowed = 'Read,Edit,Bash';

  let settled = false;
  const finish = (mut) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      const book = readSession(id);
      if (book) { mut(book); writeSession(id, book); }
    } catch (e) {
      console.error('[mesa] no se pudo cerrar la ronda de Perotti:', e.message);
    }
  };

  let child;
  try {
    child = spawn('claude', ['-p', prompt, '--allowedTools', allowed], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('[mesa] no se pudo lanzar a Perotti (`claude`):', e.message);
    finish((book) => {
      book.status = 'error';
      book.turn = 'tie';
      book.rev = (book.rev || 0) + 1;
      book.conversation.push({
        who: 'perotti', at: new Date().toISOString(),
        text: 'No pude arrancar (no encuentro `claude`). Revisa la instalación.',
      });
    });
    return;
  }

  const timer = setTimeout(() => {
    console.error('[mesa] Perotti agotó el tiempo, lo mato.');
    try { child.kill('SIGKILL'); } catch {}
    finish((book) => {
      book.status = 'error';
      book.turn = 'tie';
      book.rev = (book.rev || 0) + 1;
      book.conversation.push({
        who: 'perotti', at: new Date().toISOString(),
        text: 'Se me acabó el tiempo dibujando. Vuelve a intentarlo.',
      });
    });
  }, PEROTTI_TIMEOUT_MS);

  child.on('error', (e) => {
    console.error('[mesa] error en el proceso de Perotti:', e.message);
    finish((book) => {
      book.status = 'error';
      book.turn = 'tie';
      book.rev = (book.rev || 0) + 1;
      book.conversation.push({
        who: 'perotti', at: new Date().toISOString(),
        text: 'Algo falló al dibujar (' + e.message + ').',
      });
    });
  });

  child.on('exit', (code) => {
    console.log(`[mesa] Perotti salió (code=${code}).`);
    finish((book) => {
      book.status = 'idle';
      book.turn = 'tie';
      book.rev = (book.rev || 0) + 1;
    });
  });
}

// ── fusión del doc de Tie ─────────────────────────────────────────────────────
// Tie solo mueve anclas/manejadores en v1: aceptamos su `doc` tal cual como
// nuevo estado del dibujo (es una herramienta de un solo usuario humano).
function mergeTieDoc(book, doc) {
  if (doc && typeof doc === 'object') book.doc = doc;
}

// ── servidor ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));

// La página de la mesa.
app.get('/', (_req, res) => {
  if (!fs.existsSync(MESA_HTML)) return res.status(500).send('mesa.html no encontrado');
  res.type('html').send(fs.readFileSync(MESA_HTML, 'utf8'));
});

// El converter como módulo ES, para importarlo en el cliente (una sola verdad).
app.get('/svg-doc.js', (_req, res) => {
  if (!fs.existsSync(SVG_DOC_JS)) return res.status(500).send('svg-doc.js no encontrado');
  res.type('application/javascript').send(fs.readFileSync(SVG_DOC_JS, 'utf8'));
});

// Imágenes de referencia (fondo para calcar): se sirven estáticas desde
// public/mesa/refs/. Solo lectura, sin travesía de rutas (express.static
// ya bloquea `..`). La carpeta se crea perezosamente al primer upload.
app.use('/refs', express.static(REFS_DIR, { fallthrough: false, index: false }));

// ── estantería: lista + alta ─────────────────────────────────────────────────
// Lista todos los cuadernos (resumen ligero, NO el doc entero).
app.get('/api/sessions', (_req, res) => {
  let files = [];
  try { files = fs.readdirSync(SESSIONS_DIR); } catch {}
  const list = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => summarize(f.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  res.json(list);
});

// Crea un cuaderno nuevo. body {id?, title?, doc?}. Sin id → slug del título o
// dibujo-N; colisión → sufijo -2/-3. Semilla = lienzo en blanco (o el doc dado).
app.post('/api/sessions', (req, res) => {
  const { id, title, doc } = req.body || {};
  let base = id && String(id).trim() ? String(id) : (title || '');
  // si pidieron un id explícito y ya existe, también sufijamos (no pisamos)
  const finalId = freeSessionId(base);
  if (!finalId) return res.status(400).json({ error: 'id inválido' });
  try {
    const { id: newId } = seedBook(finalId, { title, doc });
    res.status(201).json({ id: newId });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo crear el cuaderno: ' + e.message });
  }
});

// Miniatura barata para la estantería: el SVG renderizado del cuaderno.
app.get('/api/session/:id/thumb.svg', (req, res) => {
  const book = readSession(req.params.id);
  if (!book) return res.status(404).type('text/plain').send('sesión no encontrada');
  res.type('image/svg+xml').send(toSvg(book.doc));
});

// El cuaderno completo.
app.get('/api/session/:id', (req, res) => {
  const book = readSession(req.params.id);
  if (!book) return res.status(404).json({ error: 'sesión no encontrada' });
  res.json(book);
});

// Poll ligero: solo status + rev.
app.get('/api/session/:id/status', (req, res) => {
  const book = readSession(req.params.id);
  if (!book) return res.status(404).json({ error: 'sesión no encontrada' });
  res.json({ status: book.status, rev: book.rev });
});

// Guardar el turno de Tie y arrancar a Perotti.
app.post('/api/session/:id/save', (req, res) => {
  const id = req.params.id;
  const book = readSession(id);
  if (!book) return res.status(404).json({ error: 'sesión no encontrada' });

  if (book.status === 'thinking') {
    return res.status(409).json({ error: 'Perotti está dibujando', status: book.status, rev: book.rev });
  }

  const { rev, doc, message } = req.body || {};
  if (typeof rev !== 'number' || rev !== book.rev) {
    return res.status(409).json({ error: 'rev desincronizado', status: book.status, rev: book.rev });
  }

  const trimmed = message && String(message).trim();

  // Aplica la edición de Tie (sus anclas/puntos) en cualquier caso.
  mergeTieDoc(book, doc);

  // Guardado en silencio: sin mensaje → solo persiste el doc, NO despierta a
  // Perotti. La mesa sigue siendo de Tie (idle/turn:tie); sube rev igual.
  if (!trimmed) {
    book.rev = (book.rev || 0) + 1;
    book.status = 'idle';
    book.turn = 'tie';
    writeSession(id, book);
    return res.json({ saved: true, spawned: false, rev: book.rev });
  }

  // Con mensaje: turno de Tie + arranque de Perotti (comportamiento de siempre).
  book.conversation.push({ who: 'tie', at: new Date().toISOString(), text: trimmed });
  book.rev = (book.rev || 0) + 1;
  book.status = 'thinking';
  book.turn = 'perotti';
  writeSession(id, book);

  // Arranca a Perotti SIN bloquear.
  launchPerotti(id);

  res.status(202).json({ saved: true, spawned: true, status: book.status, rev: book.rev });
});

// Exportar el SVG a disco DENTRO del repo (no descarga al navegador) y devolver
// la ruta relativa. El cliente manda su `doc` (estado en pantalla) + un
// `outputPath` opcional; el servidor escribe el SVG con toSvg() y, de paso,
// recuerda la ruta en el cuaderno.
const OUT_DIR = path.join(ROOT, 'public', 'mesa');
function safeOutPath(id, requested) {
  // Solo permitimos escribir dentro de public/mesa/, sin travesía.
  let rel = requested && String(requested).trim()
    ? String(requested).trim()
    : path.posix.join('public', 'mesa', String(id).replace(/[^a-zA-Z0-9_-]/g, '') + '.svg');
  const abs = path.resolve(ROOT, rel);
  const okRoot = path.resolve(OUT_DIR);
  if (abs !== okRoot && !abs.startsWith(okRoot + path.sep)) return null;
  if (!abs.toLowerCase().endsWith('.svg')) return null;
  return abs;
}

app.post('/api/session/:id/export', (req, res) => {
  const id = req.params.id;
  const book = readSession(id);
  if (!book) return res.status(404).json({ error: 'sesión no encontrada' });
  if (book.status === 'thinking') {
    return res.status(409).json({ error: 'Perotti está dibujando' });
  }

  const { doc, outputPath } = req.body || {};
  const useDoc = (doc && typeof doc === 'object') ? doc : book.doc;
  const abs = safeOutPath(id, outputPath);
  if (!abs) return res.status(400).json({ error: 'ruta de salida inválida (debe quedar en public/mesa/*.svg)' });

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    atomicWrite(abs, toSvg(useDoc) + '\n');
  } catch (e) {
    return res.status(500).json({ error: 'no se pudo escribir el SVG: ' + e.message });
  }

  // recuerda la ruta (relativa al repo) en el cuaderno, sin tocar rev/status
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  try { book.outputPath = rel; writeSession(id, book); } catch {}

  res.json({ path: rel });
});

// ── imagen de referencia de fondo ─────────────────────────────────────────────
// Recibe una imagen (dataURL base64 en el body JSON), la guarda en disco bajo
// public/mesa/refs/ y devuelve su URL servible (/refs/<fichero>). NO se
// guarda base64 en el cuaderno: la capa imagen solo lleva esa URL ligera.
const REF_MAX_BYTES = 10 * 1024 * 1024;                       // 10 MB de imagen real
const REF_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// parser JSON propio para esta ruta, con holgura para el base64 (≈+33%): un PNG
// de 10 MB ronda 13.3 MB en base64; damos 16 MB de margen.
const refImageParser = express.json({ limit: '16mb' });

app.post('/api/session/:id/refimage', refImageParser, (req, res) => {
  const id = req.params.id;
  const book = readSession(id);
  if (!book) return res.status(404).json({ error: 'sesión no encontrada' });

  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'falta dataUrl (la imagen en base64)' });
  }
  // data:image/png;base64,AAAA…
  const m = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s);
  if (!m) return res.status(400).json({ error: 'dataUrl inválido (se espera data:<mime>;base64,…)' });
  const mime = m[1].toLowerCase();
  const ext = REF_EXT[mime];
  if (!ext) return res.status(400).json({ error: 'tipo no soportado (solo PNG, JPG o WebP)' });

  let buf;
  try { buf = Buffer.from(m[2], 'base64'); }
  catch { return res.status(400).json({ error: 'base64 ilegible' }); }
  if (!buf.length) return res.status(400).json({ error: 'imagen vacía' });
  if (buf.length > REF_MAX_BYTES) {
    return res.status(413).json({ error: 'imagen demasiado grande (máx. 10 MB)' });
  }

  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '') || 'ref';
  const file = `${safeId}-${Date.now()}.${ext}`;
  const abs = path.join(REFS_DIR, file);
  try {
    fs.mkdirSync(REFS_DIR, { recursive: true });
    atomicWrite(abs, buf);
  } catch (e) {
    return res.status(500).json({ error: 'no se pudo guardar la imagen: ' + e.message });
  }
  res.status(201).json({ url: '/refs/' + file });
});

// ── importar SVG ──────────────────────────────────────────────────────────────
// Lista los .svg sueltos en public/mesa/ (para meter el trex de un clic).
const DESIGN_DIR = path.join(ROOT, 'public', 'mesa');
app.get('/api/svg-files', (_req, res) => {
  let files = [];
  try { files = fs.readdirSync(DESIGN_DIR); } catch {}
  const svgs = files.filter((f) => /\.svg$/i.test(f) && !f.startsWith('.')).sort();
  res.json(svgs);
});

// Importa un SVG plano → cuaderno nuevo. body {svg?|file?, title?}. `file` lee
// un .svg de public/mesa/ (saneado, sin travesía). Devuelve {id, warnings}.
app.post('/api/import', (req, res) => {
  const { svg, file, title } = req.body || {};
  let svgString = null;
  let srcTitle = title;

  if (file && String(file).trim()) {
    // solo un nombre de fichero simple dentro de public/mesa/
    const safe = String(file).replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!safe || !/\.svg$/i.test(safe)) return res.status(400).json({ error: 'fichero SVG inválido' });
    const abs = path.join(DESIGN_DIR, safe);
    if (!abs.startsWith(DESIGN_DIR + path.sep)) return res.status(400).json({ error: 'ruta de fichero inválida' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'fichero no encontrado' });
    try { svgString = fs.readFileSync(abs, 'utf8'); } catch (e) { return res.status(500).json({ error: 'no se pudo leer: ' + e.message }); }
    if (!srcTitle) srcTitle = safe.replace(/\.svg$/i, '');
  } else if (svg && String(svg).trim()) {
    svgString = String(svg);
  } else {
    return res.status(400).json({ error: 'falta el SVG (svg o file)' });
  }

  let parsed;
  try { parsed = svgToDoc(svgString); }
  catch (e) { return res.status(400).json({ error: 'no se pudo parsear el SVG: ' + e.message }); }

  const base = srcTitle || 'importado';
  const finalId = freeSessionId(base);
  try {
    seedBook(finalId, { title: srcTitle, doc: parsed.doc, note: 'Dibujo importado. Edita o pídeme un cambio.' });
  } catch (e) {
    return res.status(500).json({ error: 'no se pudo guardar el cuaderno: ' + e.message });
  }
  res.status(201).json({ id: finalId, warnings: parsed.warnings || [] });
});

app.listen(PORT, () => {
  console.log(`Mesa de dibujo en http://localhost:${PORT}`);
  console.log(`  cuadernos → ${path.relative(ROOT, SESSIONS_DIR)}`);
});
