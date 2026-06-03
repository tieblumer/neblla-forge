/**
 * svg-doc.js — el converter del taller de Perotti.
 *
 * Traduce un MODELO ESTRUCTURADO (capas → paths con nombre → anclas con
 * manejadores bézier) a NOTACIÓN SVG (`<svg>` con `<path d="...">`).
 *
 * Es la piedra angular del taller: la pieza que convierte "x,y de anclas y
 * béziers" en SVG, para que ni Perotti ni Tie toquen jamás una coordenada
 * cruda. Ellos hablan de anclas con nombre ("la punta", "la hendidura"); el
 * programa escribe el `d`. La conversión es determinista y reversible.
 *
 * Modelo:
 *   ancla : { name?, x, y, in?:[dx,dy], out?:[dx,dy] }
 *           in/out son OFFSETS relativos al ancla, como una pluma real: el
 *           manejador de ENTRADA (la curva que llega) y el de SALIDA (la que
 *           parte). Ausentes = tramo recto por ese lado.
 *   path  : { name, fill?, stroke?, strokeWidth?, closed?, anchors:[...],
 *             fillOpacity?:0..1, strokeOpacity?:0..1 }
 *           fill puede ser un color ("#1e6bff") O una referencia a gradiente
 *           ("url(#g1)").
 *   layer : { name, paths:[...], hidden?:boolean }  hidden=true → no se pinta.
 *           Variante IMAGEN (referencia de fondo, no se exporta):
 *             { kind:'image', name, src, opacity?:0..1, hidden? }
 *           — participa en el orden de capas, pero toSvg la OMITE siempre.
 *   doc   : { width, height, layers:[ { name, paths:[...], hidden? } ], gradients? }
 *           gradients = { [id]: { type:'linear', stops:[{offset,color,opacity?}],
 *                                 coords? } } — v2 solo lineal vertical, 2 stops.
 *
 * CLI:
 *   node scripts/svg-doc.js <doc.json> [--out <file.svg>]
 *   (sin --out imprime el SVG por stdout)
 */

// OJO: este módulo lo importa TAMBIÉN el navegador (la mesa de dibujo usa
// `pathToD`/`toSvg`). Por eso NO hay `import` de Node a nivel de módulo: `node:fs`
// se carga perezosamente dentro del bloque CLI, solo cuando corre en terminal.

// Redondeo limpio: enteros tal cual, decimales a 2 cifras (sin ceros de cola feos).
function n(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// Un ancla con un offset → coordenada absoluta del manejador bézier.
function handle(anchor, off) {
  return [anchor.x + (off ? off[0] : 0), anchor.y + (off ? off[1] : 0)];
}

/** Un path estructurado → su atributo `d` de SVG. */
export function pathToD(path) {
  const a = path.anchors || [];
  if (!a.length) return '';
  const closed = !!path.closed;
  let d = `M ${n(a[0].x)},${n(a[0].y)}`;
  const segs = closed ? a.length : a.length - 1;
  for (let i = 0; i < segs; i++) {
    const cur = a[i];
    const nxt = a[(i + 1) % a.length];
    if (cur.out || nxt.in) {
      const [c1x, c1y] = handle(cur, cur.out);   // manejador de salida del ancla actual
      const [c2x, c2y] = handle(nxt, nxt.in);    // manejador de entrada de la siguiente
      d += ` C ${n(c1x)},${n(c1y)} ${n(c2x)},${n(c2y)} ${n(nxt.x)},${n(nxt.y)}`;
    } else {
      d += ` L ${n(nxt.x)},${n(nxt.y)}`;
    }
  }
  if (closed) d += ' Z';
  return d;
}

/**
 * Fragmento de atributos de pintado de un path (fill/stroke/opacidades),
 * COMPARTIDO entre `toSvg` (export) y el `render()` del navegador (lienzo en
 * vivo) → así el export y el lienzo muestran exactamente lo mismo (paridad).
 * Devuelve algo como: `fill="#1e6bff" fill-opacity="0.5" stroke="#000" ...`.
 * `fill` puede ser un color o `url(#gradId)`; ambos valen aquí tal cual.
 */
export function pathAttrs(p) {
  const fill = p.fill || 'none';
  let out = `fill="${fill}"`;
  if (p.fillOpacity != null) out += ` fill-opacity="${n(p.fillOpacity)}"`;
  if (p.stroke) {
    out += ` stroke="${p.stroke}" stroke-width="${p.strokeWidth ?? 1}"`;
    if (p.strokeOpacity != null) out += ` stroke-opacity="${n(p.strokeOpacity)}"`;
  }
  return out;
}

/**
 * Bloque `<defs>` con los gradientes del doc. COMPARTIDO entre `toSvg` y el
 * navegador (que lo inyecta en un `<defs id="defs">` vivo). Devuelve '' si no
 * hay gradientes. v2: solo `linear`, vertical por defecto, stops con opacidad.
 */
export function defsToSvg(gradients) {
  const ids = gradients ? Object.keys(gradients) : [];
  if (!ids.length) return '';
  const blocks = ids.map((id) => {
    const g = gradients[id] || {};
    const c = g.coords || { x1: 0, y1: 0, x2: 0, y2: 1 };
    const stops = (g.stops || []).map((s) => {
      const op = s.opacity != null ? ` stop-opacity="${n(s.opacity)}"` : '';
      return `<stop offset="${n(s.offset ?? 0)}" stop-color="${s.color || '#000'}"${op} />`;
    }).join('');
    return `<linearGradient id="${id}" x1="${n(c.x1)}" y1="${n(c.y1)}" x2="${n(c.x2)}" y2="${n(c.y2)}">${stops}</linearGradient>`;
  }).join('');
  return `<defs>${blocks}</defs>`;
}

/**
 * Un documento entero → cadena SVG. Se omiten:
 *   • las capas con `hidden:true` (apagadas en el panel), y
 *   • las capas de tipo imagen (`kind:'image'`): son SOLO referencia de fondo
 *     para calcar encima, NUNCA forman parte del dibujo exportado.
 */
export function toSvg(doc) {
  const body = (doc.layers || [])
    .filter((layer) => !layer.hidden && layer.kind !== 'image')
    .map((layer) => {
      const paths = (layer.paths || []).map((p) => {
        const d = pathToD(p);
        return `    <path id="${p.name || ''}" d="${d}" ${pathAttrs(p)} />`;
      }).join('\n');
      return `  <g id="${layer.name || ''}">\n${paths}\n  </g>`;
    }).join('\n');
  const defs = defsToSvg(doc.gradients);
  const defsLine = defs ? `  ${defs}\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}">\n${defsLine}${body}\n</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// svgToDoc — el converter AL REVÉS: SVG plano → modelo estructurado.
//
// Inversa de toSvg/pathToD/defsToSvg. Parser SIN dependencias, idéntico en Node
// y navegador: NO usa DOMParser, solo regex + un tokenizador a mano del atributo
// `d`. Mantiene el blindaje (cero imports Node de módulo).
//
// Alcance v1: M/m L/l C/c Z/z + H/h V/v (triviales→L). El resto (S/T/Q/A) y
// cualquier rareza → NO rompe: registra un aviso en `warnings` y sigue.
//
// Devuelve { doc, warnings:[...] }.
// ═══════════════════════════════════════════════════════════════════════════

// --- helpers de parseo de SVG (regex, sin DOM) -------------------------------

// Quita comentarios <!-- ... --> para no confundir al escáner de etiquetas.
function stripComments(svg) {
  return String(svg).replace(/<!--[\s\S]*?-->/g, '');
}

// Lee los atributos de una etiqueta abridora (la cadena DENTRO de < >).
// Devuelve un objeto plano { attr: valor }. Tolera comillas simples o dobles.
function parseAttrs(tagInner) {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagInner))) {
    attrs[m[1]] = m[3] != null ? m[3] : m[4];
  }
  return attrs;
}

// Parte `style="fill:#abc;stroke:none"` en { fill:'#abc', stroke:'none' }.
function parseStyle(style) {
  const out = {};
  if (!style) return out;
  for (const decl of String(style).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Estilo de pintado efectivo de un <path>: atributos sueltos (fill=, stroke=…)
// CON prioridad de los del `style="..."` por encima (como hace el navegador).
function paintOf(attrs) {
  const st = parseStyle(attrs.style);
  const pick = (a, b) => (st[a] != null ? st[a] : attrs[b]);
  const out = {};
  const fill = pick('fill', 'fill');
  if (fill != null && fill !== '') out.fill = fill;
  const stroke = pick('stroke', 'stroke');
  if (stroke != null && stroke !== '' && stroke !== 'none') out.stroke = stroke;
  const sw = pick('stroke-width', 'stroke-width');
  if (sw != null && sw !== '') { const v = parseFloat(sw); if (!Number.isNaN(v)) out.strokeWidth = v; }
  const fo = pick('fill-opacity', 'fill-opacity');
  if (fo != null && fo !== '') { const v = parseFloat(fo); if (!Number.isNaN(v)) out.fillOpacity = v; }
  const so = pick('stroke-opacity', 'stroke-opacity');
  if (so != null && so !== '') { const v = parseFloat(so); if (!Number.isNaN(v)) out.strokeOpacity = v; }
  const fr = pick('fill-rule', 'fill-rule');
  if (fr != null) out._fillRule = fr;   // interno: dispara aviso si evenodd
  return out;
}

// --- tokenizador del atributo `d` --------------------------------------------
// Devuelve una lista de comandos { cmd, nums:[...] } en el orden del path.
// Tolera comas/espacios mezclados y números pegados (ej. "M10-5").
function tokenizeD(d) {
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
  let m;
  let cur = null;
  while ((m = re.exec(d))) {
    if (m[1]) {            // letra de comando
      cur = { cmd: m[1], nums: [] };
      tokens.push(cur);
    } else if (cur) {      // número → al comando actual
      cur.nums.push(parseFloat(m[2]));
    }
  }
  return tokens;
}

// Round-2-clean idéntico al de `n()` pero devolviendo número (para los offsets).
function r2(v) { return Number.isInteger(v) ? v : Math.round(v * 100) / 100; }

// Casi-igual de coordenadas (el cierre cae sobre el punto inicial con redondeo).
function near(a, b) { return Math.abs(a - b) < 0.01; }

/**
 * Un único atributo `d` → array de paths del modelo (uno por subpath M…M).
 * Inversa EXACTA de pathToD. Empuja avisos a `warnings` por comandos no
 * soportados (S/T/Q/A) sin romper.
 *
 * @returns {Array<{closed?:boolean, anchors:Array}>}
 */
function dToPaths(d, warnings) {
  const toks = tokenizeD(d);
  const paths = [];
  let anchors = null;       // anclas del subpath en curso
  let cx = 0, cy = 0;       // punto actual (absoluto)
  let startX = 0, startY = 0;
  const unsupported = new Set();

  const flush = (closed) => {
    if (anchors && anchors.length) {
      const p = { anchors };
      if (closed) p.closed = true;
      paths.push(p);
    }
    anchors = null;
  };

  for (const t of toks) {
    const c = t.cmd;
    const rel = c === c.toLowerCase() && c !== 'Z' && c !== 'z';
    const up = c.toUpperCase();

    if (up === 'M') {
      // Cada M inicia un subpath. Si había uno abierto sin cerrar, lo cerramos
      // como path independiente (esto explota un `d` multi-subpath en N paths).
      flush(false);
      const ns = t.nums;
      if (ns.length >= 2) {
        let x = ns[0], y = ns[1];
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; startX = x; startY = y;
        anchors = [{ x: r2(x), y: r2(y) }];
        // M con coordenadas extra = L implícitas (spec SVG)
        for (let i = 2; i + 1 < ns.length; i += 2) {
          let nx = ns[i], ny = ns[i + 1];
          if (rel) { nx += cx; ny += cy; }
          anchors.push({ x: r2(nx), y: r2(ny) });
          cx = nx; cy = ny;
        }
      }
      continue;
    }

    if (!anchors) {
      // comando antes de un M: lo ignoramos defensivamente
      continue;
    }

    if (up === 'L') {
      for (let i = 0; i + 1 < t.nums.length; i += 2) {
        let x = t.nums[i], y = t.nums[i + 1];
        if (rel) { x += cx; y += cy; }
        appendLine(anchors, x, y, startX, startY, c);
        cx = x; cy = y;
      }
    } else if (up === 'H') {
      for (const v of t.nums) {
        let x = rel ? cx + v : v;
        appendLine(anchors, x, cy, startX, startY, c);
        cx = x;
      }
    } else if (up === 'V') {
      for (const v of t.nums) {
        let y = rel ? cy + v : v;
        appendLine(anchors, cx, y, startX, startY, c);
        cy = y;
      }
    } else if (up === 'C') {
      for (let i = 0; i + 5 < t.nums.length; i += 6) {
        let c1x = t.nums[i], c1y = t.nums[i + 1];
        let c2x = t.nums[i + 2], c2y = t.nums[i + 3];
        let px = t.nums[i + 4], py = t.nums[i + 5];
        if (rel) { c1x += cx; c1y += cy; c2x += cx; c2y += cy; px += cx; py += cy; }
        appendCurve(anchors, cx, cy, c1x, c1y, c2x, c2y, px, py, startX, startY);
        cx = px; cy = py;
      }
    } else if (up === 'Z') {
      // cierre: pliega el último segmento sobre el primer ancla si aterrizó ahí
      foldClose(anchors);
      flush(true);
      cx = startX; cy = startY;
    } else {
      // S / T / Q / A → no soportado en v1. No rompemos: avisamos y seguimos.
      unsupported.add(up);
    }
  }
  flush(false);
  if (unsupported.size) {
    warnings.push('comandos de path no soportados (v1), ignorados: ' + [...unsupported].sort().join(', '));
  }
  return paths;
}

// Añade un ancla recto (sin in/out). Pero si este L cae sobre el punto inicial
// del subpath y NO es el primer ancla, es el segmento de cierre implícito: no
// creamos un ancla duplicada (foldClose/Z lo gestionan).
function appendLine(anchors, x, y, startX, startY) {
  // recto: el ancla previo pierde out, el nuevo no tiene in
  anchors.push({ x: r2(x), y: r2(y) });
}

// Añade una curva C: el `out` del ancla ANTERIOR y el `in` del ancla NUEVA.
function appendCurve(anchors, x0, y0, c1x, c1y, c2x, c2y, px, py) {
  const prev = anchors[anchors.length - 1];
  if (prev) {
    const ox = r2(c1x - x0), oy = r2(c1y - y0);
    if (ox !== 0 || oy !== 0) prev.out = [ox, oy];
  }
  const a = { x: r2(px), y: r2(py) };
  const ix = r2(c2x - px), iy = r2(c2y - py);
  if (ix !== 0 || iy !== 0) a.in = [ix, iy];
  anchors.push(a);
}

// CLAVE del round-trip: cuando el último ancla coincide con el primero, ese
// ancla extra es el punto de CIERRE que pathToD NO emite (cierra con Z hacia el
// ancla[0]). Lo plegamos: su `in` (control de llegada al inicio) pasa a ser el
// `in` del primer ancla; su `out` (si lo hubiera) ya no aplica. Y lo quitamos.
function foldClose(anchors) {
  if (anchors.length < 2) return;
  const last = anchors[anchors.length - 1];
  const first = anchors[0];
  if (near(last.x, first.x) && near(last.y, first.y)) {
    // el control de entrada del cierre es el `in` del primer ancla
    if (last.in) first.in = last.in;
    anchors.pop();
  }
}

// --- gradientes (inversa de defsToSvg) ---------------------------------------
function parseGradients(svg, warnings) {
  const gradients = {};
  const re = /<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi;
  let m;
  while ((m = re.exec(svg))) {
    const a = parseAttrs(m[1]);
    const id = a.id;
    if (!id) continue;
    const coords = {
      x1: numAttr(a.x1, 0), y1: numAttr(a.y1, 0),
      x2: numAttr(a.x2, 0), y2: numAttr(a.y2, 1),
    };
    const stops = [];
    const sre = /<stop\b([^>]*)\/?>/gi;
    let sm;
    while ((sm = sre.exec(m[2]))) {
      const sa = parseAttrs(sm[1]);
      const st = parseStyle(sa.style);
      const stop = {
        offset: numAttr(sa.offset, 0),
        color: st['stop-color'] || sa['stop-color'] || '#000',
      };
      const op = st['stop-opacity'] != null ? st['stop-opacity'] : sa['stop-opacity'];
      if (op != null && op !== '') { const v = parseFloat(op); if (!Number.isNaN(v)) stop.opacity = v; }
      stops.push(stop);
    }
    gradients[id] = { type: 'linear', coords, stops };
  }
  return gradients;
}
function numAttr(v, dflt) { if (v == null || v === '') return dflt; const n = parseFloat(v); return Number.isNaN(n) ? dflt : n; }

/**
 * SVG plano (string) → { doc, warnings }.
 * Inversa de toSvg. Soporta <g id> como capas, <path> con d + estilo (atributos
 * y `style="..."`), <defs><linearGradient>. Comandos no soportados / evenodd /
 * origen de viewBox != 0 → avisos, nunca excepción.
 */
export function svgToDoc(svgString) {
  const warnings = [];
  const svg = stripComments(svgString || '');

  // viewBox → width/height (asume origen 0,0; avisa si min != 0)
  let width = 100, height = 100;
  const vbM = svg.match(/\bviewBox\s*=\s*["']\s*([-\d.eE+]+)[ ,]+([-\d.eE+]+)[ ,]+([-\d.eE+]+)[ ,]+([-\d.eE+]+)\s*["']/);
  if (vbM) {
    const minX = parseFloat(vbM[1]), minY = parseFloat(vbM[2]);
    width = parseFloat(vbM[3]); height = parseFloat(vbM[4]);
    if (!near(minX, 0) || !near(minY, 0)) {
      warnings.push(`viewBox no arranca en 0,0 (min=${minX},${minY}); el modelo asume origen 0,0`);
    }
  } else {
    const wM = svg.match(/\bwidth\s*=\s*["']?([\d.]+)/);
    const hM = svg.match(/\bheight\s*=\s*["']?([\d.]+)/);
    if (wM) width = parseFloat(wM[1]);
    if (hM) height = parseFloat(hM[1]);
    if (!wM && !hM) warnings.push('sin viewBox ni width/height; uso 100×100 por defecto');
  }

  const gradients = parseGradients(svg, warnings);

  // Construye un path del modelo a partir de un <path> SVG (puede dar N por los
  // subpaths del `d`). Reparte el estilo a todos los paths que produce.
  let sawEvenOdd = false;
  function buildPaths(tagInner) {
    const attrs = parseAttrs(tagInner);
    const paint = paintOf(attrs);
    const d = attrs.d || '';
    const sub = dToPaths(d, warnings);
    if (sub.length > 1) {
      // v1: subpaths explotados en paths separados. evenodd se ignora con aviso.
      if (paint._fillRule === 'evenodd') sawEvenOdd = true;
    }
    return sub.map((p, i) => {
      const out = { name: attrs.id ? (sub.length > 1 ? attrs.id + '-' + (i + 1) : attrs.id) : '', ...p };
      if (paint.fill != null) out.fill = paint.fill;
      if (paint.stroke != null) out.stroke = paint.stroke;
      if (paint.strokeWidth != null) out.strokeWidth = paint.strokeWidth;
      if (paint.fillOpacity != null) out.fillOpacity = paint.fillOpacity;
      if (paint.strokeOpacity != null) out.strokeOpacity = paint.strokeOpacity;
      // re-ordena para que `name` quede primero y `closed`/`anchors` después,
      // imitando el orden del modelo escrito a mano (cosmético).
      return reorderPath(out);
    });
  }

  // Detecta capas <g>: si hay <g>, cada una es una capa con su id como nombre.
  // Si no hay ninguna, una capa por defecto con todos los <path>.
  const layers = [];
  const gRe = /<g\b([^>]*)>([\s\S]*?)<\/g>/gi;
  let gm;
  let consumed = '';
  let anyG = false;
  while ((gm = gRe.exec(svg))) {
    anyG = true;
    const ga = parseAttrs(gm[1]);
    const paths = [];
    const pRe = /<path\b([^>]*?)\/?>/gi;
    let pm;
    while ((pm = pRe.exec(gm[2]))) { for (const p of buildPaths(pm[1])) paths.push(p); }
    layers.push({ name: ga.id || ('Capa ' + (layers.length + 1)), paths });
    consumed += gm[2];
  }
  if (!anyG) {
    const paths = [];
    const pRe = /<path\b([^>]*?)\/?>/gi;
    let pm;
    while ((pm = pRe.exec(svg))) { for (const p of buildPaths(pm[1])) paths.push(p); }
    layers.push({ name: 'Capa 1', paths });
  }

  if (sawEvenOdd) {
    warnings.push('fill-rule="evenodd" no soportado (v1): los subpaths se separan en paths sueltos, los "agujeros" entran rellenos');
  }

  const doc = { width, height, layers };
  if (Object.keys(gradients).length) doc.gradients = gradients;
  return { doc, warnings };
}

// Reordena las claves de un path para que salga limpio (name, estilo, closed,
// anchors), igual que los docs escritos a mano. Puro cosmético.
function reorderPath(p) {
  const out = {};
  if (p.name !== undefined) out.name = p.name;
  for (const k of ['fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeOpacity']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  if (p.closed !== undefined) out.closed = p.closed;
  out.anchors = p.anchors;
  return out;
}

// --- CLI (solo en Node; en el navegador `process` no existe y nos saltamos todo) ---
const isNode = typeof process !== 'undefined' && Array.isArray(process.argv);
const isMain = isNode && (import.meta.url === `file://${process.argv[1]}` ||
               process.argv[1]?.endsWith('svg-doc.js'));
if (isMain) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const args = process.argv.slice(2);
  let input = null, out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else if (!input) input = args[i];
  }
  if (!input) {
    process.stderr.write('uso: node scripts/svg-doc.js <doc.json> [--out file.svg]\n');
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(input, 'utf8'));
  // Acepta tanto un doc suelto ({width,height,layers}) como un cuaderno
  // completo de la mesa ({...,doc:{...}}): si trae `.doc`, dibuja ese.
  const doc = parsed && parsed.doc ? parsed.doc : parsed;
  const svg = toSvg(doc);
  if (out) { writeFileSync(out, svg + '\n'); process.stdout.write(`${out}\n`); }
  else process.stdout.write(svg + '\n');
}
