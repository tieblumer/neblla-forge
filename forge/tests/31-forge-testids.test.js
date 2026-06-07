// tests/31-forge-testids.test.js
//
// La diana del sellado/reparto de IDs de test (scripts/lib/forge-testids.js). Pura.
//   1. sellarTestIds asigna IDs estables T-<num>-NN, idempotente (respeta los ya puestos);
//   2. testIdsPorRef agrupa los IDs por destino (general / subtarea);
//   3. testIdsParaSubtarea = los de la subtarea + los generales.
//
// Se ejecuta con:  node tests/run-forge.js 31

import { sellarTestIds, testIdsPorRef, testIdsParaSubtarea } from '../../scripts/lib/forge-testids.js';

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('31 — forge: IDs de test (sellado + reparto)');

  const plan = {
    tests: [
      { ref: 'general', titulo: 'la tarea entera' },
      { ref: 'back', titulo: 'el endpoint' },
      { ref: 'front', titulo: 'el botón' },
    ],
  };

  // ── 1) sellarTestIds ────────────────────────────────────────────────────────
  {
    const sealed = sellarTestIds(plan, 14);
    r.eq('todos sellados', sealed.tests.every((t) => /^T-14-\d\d$/.test(t.id)), true);
    r.eq('correlativos', sealed.tests.map((t) => t.id).join(','), 'T-14-01,T-14-02,T-14-03');

    // idempotente: re-sellar conserva los IDs existentes y solo asigna a los nuevos.
    const conNuevo = { tests: [...sealed.tests, { ref: 'front', titulo: 'otro más' }] };
    const reSealed = sellarTestIds(conNuevo, 14);
    r.eq('conserva los 3 viejos', reSealed.tests.slice(0, 3).map((t) => t.id).join(','), 'T-14-01,T-14-02,T-14-03');
    r.eq('el nuevo coge el siguiente libre', reSealed.tests[3].id, 'T-14-04');

    // IDs únicos siempre (sin choques).
    const ids = reSealed.tests.map((t) => t.id);
    r.eq('sin duplicados', new Set(ids).size, ids.length);
  }

  // ── 2) testIdsPorRef ────────────────────────────────────────────────────────
  {
    const sealed = sellarTestIds(plan, 7);
    const porRef = testIdsPorRef(sealed);
    r.eq('general tiene 1', (porRef.general || []).length, 1);
    r.eq('back tiene 1', (porRef.back || []).length, 1);
    r.eq('front tiene 1', (porRef.front || []).length, 1);
  }

  // ── 3) testIdsParaSubtarea = los suyos + los generales ──────────────────────
  {
    const sealed = sellarTestIds(plan, 7);
    const back = testIdsParaSubtarea(sealed, 'back');
    r.eq('back recibe el suyo + el general', back.length, 2);
    r.ok('incluye el general', back.some((id) => testIdsPorRef(sealed).general.includes(id)));
    const sinSub = testIdsParaSubtarea(sealed, null);
    r.eq('sin subtarea → solo generales', sinSub.length, 1);
  }
}
