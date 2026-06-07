// tests/23-svg-doc-roundtrip.test.js
//
// The diana for "importar SVG": svgToDoc is the EXACT inverse of toSvg. Pure
// static suite (no server, no Mongo) — same shape as 01-contract / 22-orchestrator.
//
// What it asserts:
//   • idempotency: toSvg(svgToDoc(toSvg(doc))) === toSvg(doc) for the two
//     hand-written docs (sketch.json + heart-doc.json) — the round-trip that
//     proves the parser inverts pathToD/defsToSvg exactly.
//   • trex.svg (a real foreign SVG: multi-subpath + fill-rule=evenodd) parses
//     without throwing, yields N>1 paths, and re-exports stably on a 2nd round.
//   • the evenodd holes-filled limitation surfaces as a warning (it's a known
//     v1 decision, not a silent bug).
//   • a few parser unit cases (H/V→L, multi-subpath split, style="...", gradients).

import fs from 'fs';
import path from 'path';
import { ROOT } from './_root.js';
import { toSvg, svgToDoc } from '../../scripts/svg-doc.js';

export const needsServer = false;

const readJson = (rel) => {
  const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return parsed && parsed.doc ? parsed.doc : parsed;
};

export async function run({ reporter: r }) {
  r.suite('23 — svg-doc round-trip (importar SVG)');

  // ── idempotency on hand-written docs ────────────────────────────────────
  for (const rel of ['public/mesa/heart-doc.json', 'public/mesa/sessions/sketch.json']) {
    let ok = false, warnings = [];
    try {
      const doc = readJson(rel);
      const svg1 = toSvg(doc);
      const res = svgToDoc(svg1);
      warnings = res.warnings;
      const svg2 = toSvg(res.doc);
      ok = svg1 === svg2;
    } catch (e) {
      r.fail(`${rel} round-trip threw`, e); continue;
    }
    r.ok(`${rel}: toSvg(svgToDoc(toSvg(doc))) === toSvg(doc)`, ok,
      'round-trip not idempotent — svgToDoc is not the exact inverse of toSvg');
    r.ok(`${rel}: no warnings on a clean model SVG`, warnings.length === 0,
      'unexpected warnings: ' + JSON.stringify(warnings));
  }

  // ── trex.svg: a real foreign SVG (multi-subpath + evenodd) ──────────────
  {
    let res = null, threw = null;
    try { res = svgToDoc(fs.readFileSync(path.join(ROOT, 'public/mesa/trex.svg'), 'utf8')); }
    catch (e) { threw = e; }
    r.ok('trex.svg parses without throwing', !threw, threw && String(threw.message));
    if (res) {
      const nPaths = res.doc.layers.reduce((s, l) => s + (l.paths || []).length, 0);
      r.ok('trex.svg yields multiple paths (subpaths split)', nPaths > 1, `got ${nPaths} paths`);
      r.ok('trex.svg keeps the 256×256 viewBox', res.doc.width === 256 && res.doc.height === 256,
        `got ${res.doc.width}×${res.doc.height}`);
      const hasEvenOddWarn = res.warnings.some(w => /evenodd/i.test(w));
      r.ok('trex.svg surfaces the evenodd-holes warning', hasEvenOddWarn,
        'expected an evenodd warning; got: ' + JSON.stringify(res.warnings));
      // re-export must be STABLE on a 2nd round (we don't demand equality vs the
      // original foreign SVG — only that our own model→svg→model is a fixpoint)
      let stable = false;
      try {
        const svg2 = toSvg(res.doc);
        const svg3 = toSvg(svgToDoc(svg2).doc);
        stable = svg2 === svg3;
      } catch (e) { /* stable stays false */ }
      r.ok('trex.svg re-export is stable on the 2nd round', stable,
        'model→svg→model→svg drifted — not a fixpoint');
    }
  }

  // ── parser unit cases ───────────────────────────────────────────────────
  {
    // H/h V/v collapse to straight L anchors
    const { doc } = svgToDoc('<svg viewBox="0 0 10 10"><path d="M 0 0 H 5 V 5 Z"/></svg>');
    const p = doc.layers[0].paths[0];
    r.ok('H/V parse into straight anchors', p && p.anchors.length === 3 && p.closed === true,
      'expected 3 anchors closed; got ' + JSON.stringify(p && p.anchors));
    const noHandles = p && p.anchors.every(a => !a.in && !a.out);
    r.ok('H/V anchors carry no bézier handles (straight)', !!noHandles);
  }
  {
    // multi-subpath in one <path d> explodes into N paths
    const { doc } = svgToDoc('<svg viewBox="0 0 10 10"><path d="M 0 0 L 1 0 L 1 1 Z M 5 5 L 6 5 L 6 6 Z"/></svg>');
    r.ok('multi-subpath splits into 2 paths', doc.layers[0].paths.length === 2,
      'got ' + doc.layers[0].paths.length);
  }
  {
    // style="fill:..;stroke:.." is parsed alongside attribute fill=/stroke=
    const { doc } = svgToDoc('<svg viewBox="0 0 10 10"><path d="M 0 0 L 1 1" style="fill:#abcdef;stroke:#123456;stroke-width:2"/></svg>');
    const p = doc.layers[0].paths[0];
    r.ok('style="fill/stroke" is parsed', p.fill === '#abcdef' && p.stroke === '#123456' && p.strokeWidth === 2,
      'got ' + JSON.stringify({ fill: p.fill, stroke: p.stroke, sw: p.strokeWidth }));
  }
  {
    // a kind:'image' layer (reference background) is NEVER exported by toSvg —
    // it's only a tracing reference in the mesa, not part of the final drawing.
    const docImg = {
      width: 10, height: 10,
      layers: [
        { kind: 'image', name: 'Fondo', src: '/refs/x-123.png', opacity: 0.5 },
        { name: 'dibujo', paths: [{ name: 'p', fill: '#000', closed: true, anchors: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }] },
      ],
    };
    const svg = toSvg(docImg);
    r.ok('toSvg omits kind:"image" layers (no <image>, no ref src)',
      !/<image/i.test(svg) && !svg.includes('/refs/x-123.png'),
      'image reference layer leaked into the exported SVG: ' + svg);
    r.ok('toSvg still emits the real drawing layer alongside the image layer',
      svg.includes('id="dibujo"') && svg.includes('id="p"'),
      'the path layer was dropped: ' + svg);
  }
  {
    // a linearGradient round-trips and the url(#id) fill is preserved
    const doc0 = {
      width: 10, height: 10,
      gradients: { g1: { type: 'linear', coords: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [{ offset: 0, color: '#ffffff', opacity: 1 }, { offset: 1, color: '#ff0066' }] } },
      layers: [{ name: 'l', paths: [{ name: 'p', fill: 'url(#g1)', closed: true, anchors: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }] }],
    };
    const svg1 = toSvg(doc0);
    const { doc } = svgToDoc(svg1);
    const svg2 = toSvg(doc);
    r.ok('linearGradient + url(#id) fill round-trips', svg1 === svg2,
      'gradient round-trip drifted');
  }
}
