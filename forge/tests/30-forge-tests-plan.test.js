// tests/30-forge-tests-plan.test.js
//
// La diana de los TESTS EN PAPEL de Ana Liz (scripts/lib/forge-tests.js). Pura,
// sin lanzar ningún `claude`. Comprueba:
//   1. parseTestsBloque saca el bloque ```tests ``` (null si no hay/ilegible);
//   2. normalizarTestsPlan da forma canónica tolerante (ref por defecto 'general');
//   3. validarTestsPlan: necesita ≥1 test con título y refs que existan;
//   4. agruparTestsPorRef agrupa por subtarea / general para pintar.
//
// Se ejecuta con:  node tests/run-forge.js 30

import {
  parseTestsBloque, normalizarTestsPlan, validarTestsPlan, agruparTestsPorRef, REF_GENERAL,
  aplicarResultadosCorrida,
} from '../../scripts/lib/forge-tests.js';

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('30 — forge: tests en papel de Ana Liz');

  const tests = [
    { ref: 'general', titulo: 'la tarea entera', dado: 'd', cuando: 'c', entonces: 'e' },
    { ref: 'back', titulo: 'el endpoint responde', dado: 'd2', cuando: 'c2', entonces: 'e2' },
    { ref: 'front', titulo: 'el botón pinta', dado: 'd3', cuando: 'c3', entonces: 'e3' },
  ];

  // ── 1) parseTestsBloque ─────────────────────────────────────────────────────
  {
    const msg = 'Aquí van los tests:\n\n```tests\n' + JSON.stringify(tests) + '\n```\n';
    const parsed = parseTestsBloque(msg);
    r.ok('saca el bloque ```tests```', Array.isArray(parsed) && parsed.length === 3);
    r.eq('sin bloque → null', parseTestsBloque('texto sin bloque'), null);
    r.eq('JSON roto → null', parseTestsBloque('```tests\n[ roto, ]\n```'), null);
  }

  // ── 2) normalizarTestsPlan ──────────────────────────────────────────────────
  {
    const n = normalizarTestsPlan([{ titulo: '  sin ref  ', dado: 'x' }, { ref: 'back', titulo: 't2' }, { ref: 'x', dado: 'no-title' }]);
    r.eq('test sin ref → general', n.tests[0].ref, REF_GENERAL);
    r.eq('título trim', n.tests[0].titulo, 'sin ref');
    r.eq('test sin título se descarta', n.tests.length, 2);
    r.eq('version sellada', n.version, 1);
    r.eq('nace sin aprobar', n.aprobado, false);
    const obj = normalizarTestsPlan({ tests, aprobado: true, aprobadoAt: 'ayer' });
    r.eq('acepta forma {tests}', obj.tests.length, 3);
    r.eq('conserva aprobado', obj.aprobado, true);
    // nivel: por defecto 'temporal'; 'persistente' se respeta; el viejo 'permanente'
    // se mapea a 'persistente'; basura → default.
    const niv = normalizarTestsPlan([{ titulo: 'a' }, { titulo: 'b', nivel: 'persistente' }, { titulo: 'c', nivel: 'xxx' }, { titulo: 'd', nivel: 'permanente' }]);
    r.eq('nivel por defecto = temporal', niv.tests[0].nivel, 'temporal');
    r.eq('nivel persistente se respeta', niv.tests[1].nivel, 'persistente');
    r.eq('nivel basura → temporal', niv.tests[2].nivel, 'temporal');
    r.eq('viejo permanente → persistente', niv.tests[3].nivel, 'persistente');
    r.eq('estado por defecto = definido', niv.tests[0].estado, 'definido');
  }

  // ── 3) validarTestsPlan ─────────────────────────────────────────────────────
  {
    r.ok('plan con refs válidas es aprobable', validarTestsPlan(tests, ['back', 'front']).ok === true);
    const vacio = validarTestsPlan([], ['back']);
    r.ok('sin tests → no ok', vacio.ok === false);
    const refMala = validarTestsPlan([{ ref: 'fantasma', titulo: 't' }], ['back', 'front']);
    r.ok('ref a subtarea inexistente → no ok', refMala.ok === false);
    r.ok('lo dice', refMala.motivos.some((m) => /inexistente/i.test(m)));
    r.ok('ref general siempre vale', validarTestsPlan([{ ref: 'general', titulo: 't' }], []).ok === true);
  }

  // ── 4) agruparTestsPorRef ───────────────────────────────────────────────────
  {
    const g = agruparTestsPorRef(tests);
    r.eq('3 grupos (general, back, front)', g.size, 3);
    r.eq('general tiene 1', g.get('general').length, 1);
    r.eq('back tiene 1', g.get('back').length, 1);
  }

  // ── 5) aplicarResultadosCorrida: veredicto compartido (Probar / Miguel-MCP) ──
  {
    const conId = [
      { id: 'T-15-01', titulo: 'a', estado: 'escrito' },
      { id: 'T-15-02', titulo: 'b', estado: 'escrito' },
      { id: 'T-15-03', titulo: 'c', estado: 'escrito' },
      { titulo: 'sin id', estado: 'definido' },   // sin id: no se toca
    ];
    const out = '  ✓ [T-15-01] a\n  ✗ [T-15-02] b\n(no aparece T-15-03)\n';
    const res = aplicarResultadosCorrida(conId, out);
    r.eq('cuenta los que pasan', res.pasa, 1);
    r.eq('cuenta los que fallan', res.falla, 1);
    r.eq('el no encontrado → indeterminado', res.indet, 1);
    r.eq('total = solo los que tienen id', res.total, 3);
    r.eq('T-15-01 pasa', res.tests[0].estado, 'pasa');
    r.eq('T-15-02 falla', res.tests[1].estado, 'falla');
    r.eq('T-15-03 sin línea → vuelve a escrito', res.tests[2].estado, 'escrito');
    r.eq('el sin-id no se toca', res.tests[3].estado, 'definido');
  }
}
