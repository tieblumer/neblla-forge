/**
 * render-svg.js — el eslabón "renderiza → foto" del espejo de Perotti.
 *
 * Toma un SVG (o HTML) y produce un PNG que un agente ciego pueda abrir y mirar,
 * para cerrar el bucle dibuja → renderiza → foto → ajusta.
 *
 * Uso:
 *   node scripts/render-svg.js <input.svg|input.html> [opciones]
 *
 * Opciones:
 *   --out <ruta.png>     Ruta de salida (def.: junto al input, mismo nombre con .png).
 *   --size N             Lado del lienzo cuadrado en px (def. 64).
 *   --sizes 16,32,64     Genera un PNG por tamaño (sufijo .<N>.png). Anula --size.
 *   --bg <color>         Fondo: #hex | white | transparent (def. transparent).
 *   --pad N              Margen interior en px alrededor del dibujo (def. 0).
 *
 * Imprime en stdout la(s) ruta(s) ABSOLUTA(s) del/los PNG generado(s), una por línea.
 * Sale con código != 0 ante cualquier error (input inexistente, SVG inválido, etc.).
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';

// --- Resolver el navegador: preferimos 'playwright' (dependencia declarada),
//     caemos a 'playwright-core' si hiciera falta. ---
let chromium;
let pwSource;
try {
  ({ chromium } = await import('playwright'));
  pwSource = 'playwright';
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
    pwSource = 'playwright-core';
  } catch (err) {
    fail(
      'No se pudo cargar ni "playwright" ni "playwright-core". ' +
      'Instala una de las dos (y su Chromium) antes de usar este script.\n' +
      String(err)
    );
  }
}

function fail(msg) {
  process.stderr.write(`render-svg: ${msg}\n`);
  process.exit(1);
}

// --- Parseo de argumentos ---
function parseArgs(argv) {
  const opts = { input: null, out: null, size: 64, sizes: null, bg: 'transparent', pad: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--size') opts.size = Number(argv[++i]);
    else if (a === '--sizes') opts.sizes = String(argv[++i]).split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
    else if (a === '--bg') opts.bg = argv[++i];
    else if (a === '--pad') opts.pad = Number(argv[++i]);
    else if (a.startsWith('--')) fail(`opción desconocida: ${a}`);
    else if (opts.input === null) opts.input = a;
    else fail(`argumento inesperado: ${a}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.input) {
  fail('falta el input. Uso: node scripts/render-svg.js <input.svg|input.html> [--out r.png] [--size N] [--sizes 16,32,64] [--bg color] [--pad N]');
}

const inputPath = resolve(opts.input);
if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
  fail(`el input no existe o no es un fichero: ${inputPath}`);
}

const ext = extname(inputPath).toLowerCase();
const isHtml = ext === '.html' || ext === '.htm';
let source;
try {
  source = readFileSync(inputPath, 'utf8');
} catch (err) {
  fail(`no se pudo leer el input: ${String(err)}`);
}

if (!isHtml && !/<svg[\s>]/i.test(source)) {
  fail('el fichero no parece un SVG válido (no contiene una etiqueta <svg>).');
}

// Tamaños a generar
const sizes = (opts.sizes && opts.sizes.length) ? opts.sizes : [opts.size];
for (const s of sizes) {
  if (!Number.isFinite(s) || s <= 0) fail(`tamaño inválido: ${s}`);
}
if (!Number.isFinite(opts.pad) || opts.pad < 0) fail(`--pad inválido: ${opts.pad}`);

// Derivar rutas de salida
function outPathFor(size, multiple) {
  if (opts.out && !multiple) return resolve(opts.out);
  const dir = opts.out ? dirname(resolve(opts.out)) : dirname(inputPath);
  const stem = basename(opts.out || inputPath, extname(opts.out || inputPath));
  return join(dir, multiple ? `${stem}.${size}.png` : `${stem}.png`);
}

const multiple = sizes.length > 1;

// --- Construir la página: centramos el dibujo en un lienzo cuadrado. ---
const transparent = String(opts.bg).toLowerCase() === 'transparent';
const bgColor = transparent ? 'transparent' : opts.bg;

function buildHtml(size) {
  const inner = size - opts.pad * 2;
  const box = inner > 0 ? inner : size;
  // El contenido se mete en una caja centrada de lado `box`; SVG/HTML escala a contain.
  const body = isHtml
    ? source
    : `<div class="art">${source}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${size}px;height:${size}px}
    body{display:flex;align-items:center;justify-content:center;
         background:${bgColor};overflow:hidden}
    .art{width:${box}px;height:${box}px;display:flex;
         align-items:center;justify-content:center}
    .art svg{max-width:100%;max-height:100%;width:auto;height:auto;display:block}
  </style></head><body>${body}</body></html>`;
}

// --- Render ---
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
}).catch((err) => {
  fail(`no se pudo lanzar Chromium (vía ${pwSource}): ${String(err)}`);
});

const written = [];
try {
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(buildHtml(size), { waitUntil: 'networkidle' });
    const out = outPathFor(size, multiple);
    await page.screenshot({
      path: out,
      omitBackground: transparent,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    const stat = statSync(out);
    if (!stat.size) fail(`el PNG generado está vacío: ${out}`);
    written.push(out);
    await page.close();
  }
} catch (err) {
  await browser.close().catch(() => {});
  fail(`fallo al renderizar: ${String(err)}`);
}

await browser.close().catch(() => {});

for (const p of written) process.stdout.write(`${p}\n`);
