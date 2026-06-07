// tests/29-forge-plan.test.js
//
// La diana del PLAN estructurado de Aubé (scripts/lib/forge-plan.js). Sin lanzar
// ningún `claude`. Comprueba:
//   1. parsePlanBloque saca el bloque ```plan ``` (y devuelve null si no hay/ilegible);
//   2. normalizarPlan da forma canónica tolerante a basura;
//   3. validarPlan es la puerta: rechaza plan sin resumen, parte sin ficheros,
//      contrato a partes inexistentes, y ≥2 partes sin contrato;
//   4. planAPropuestaSubtareas produce carriles que troceaTarea parte LIMPIO,
//      con noTocar = ficheros de las otras partes y su trozo de contrato adjunto.
//
// Se ejecuta con:  node tests/run-forge.js 29

import {
  parsePlanBloque, normalizarPlan, validarPlan, planAPropuestaSubtareas,
  normalizarComplejidad, renderPlanTexto, COMPLEJIDADES,
} from '../../scripts/lib/forge-plan.js';
import { troceaTarea } from '../../scripts/lib/forge-trocear.js';

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('29 — forge: plan estructurado de Aubé (con contrato)');

  const planOk = {
    resumen: 'Añadir el botón X y su endpoint',
    partes: [
      { name: 'back', hace: 'el endpoint POST /api/x', ficheros: ['controllers/**', 'routes/api/**'] },
      { name: 'front', hace: 'el botón y su pintado', ficheros: ['public/**'] },
    ],
    contrato: [
      { entre: ['back', 'front'], interfaz: 'POST /api/x → {ok:true}', acuerdo: 'el back expone, el front consume; forma fija' },
    ],
  };

  // ── 1) parsePlanBloque ──────────────────────────────────────────────────────
  {
    const msg = 'Título\n\nCuerpo legible del plan.\n\n```plan\n' + JSON.stringify(planOk) + '\n```\n';
    const parsed = parsePlanBloque(msg);
    r.ok('saca el bloque ```plan```', !!parsed && parsed.resumen === planOk.resumen);
    r.eq('parse trae las 2 partes', (parsed.partes || []).length, 2);
    r.eq('sin bloque → null', parsePlanBloque('solo texto, sin bloque'), null);
    r.eq('bloque con JSON roto → null', parsePlanBloque('```plan\n{roto,,}\n```'), null);
    r.eq('bloque que es un array (no objeto) → null', parsePlanBloque('```plan\n[1,2]\n```'), null);
  }

  // ── 2) normalizarPlan: forma canónica + tolerancia ──────────────────────────
  {
    const n = normalizarPlan({ resumen: '  hola  ', partes: [{ name: ' back ', hace: 'x', ficheros: 'controllers/Foo.js' }], contrato: 'no-es-array' });
    r.eq('resumen trim', n.resumen, 'hola');
    r.eq('name trim', n.partes[0].name, 'back');
    r.eq('ficheros string suelto → array normalizado', n.partes[0].ficheros, ['controllers/Foo.js']);
    r.eq('contrato no-array → []', n.contrato, []);
    r.eq('version sellada', n.version, 1);
    const basura = normalizarPlan(null);
    r.eq('null → resumen vacío', basura.resumen, '');
    r.eq('null → partes []', basura.partes, []);
    r.ok('parte sin name se descarta', normalizarPlan({ partes: [{ hace: 'x', ficheros: ['a'] }] }).partes.length === 0);
  }

  // ── 3) validarPlan: la puerta ───────────────────────────────────────────────
  {
    r.ok('plan completo es aprobable', validarPlan(planOk).ok === true);

    const sinResumen = validarPlan({ ...planOk, resumen: '' });
    r.ok('sin resumen → no ok', sinResumen.ok === false);
    r.ok('sin resumen → lo dice', sinResumen.motivos.some((m) => /resumen/i.test(m)));

    const parteSinFich = validarPlan({ resumen: 'x', partes: [{ name: 'solo', hace: 'y', ficheros: [] }], contrato: [] });
    r.ok('parte sin ficheros → no ok', parteSinFich.ok === false);

    const contratoFantasma = validarPlan({
      resumen: 'x',
      partes: [{ name: 'back', hace: 'a', ficheros: ['controllers/**'] }, { name: 'front', hace: 'b', ficheros: ['public/**'] }],
      contrato: [{ entre: ['back', 'fantasma'], interfaz: 'z', acuerdo: 'w' }],
    });
    r.ok('contrato a parte inexistente → no ok', contratoFantasma.ok === false);
    r.ok('contrato fantasma → lo dice', contratoFantasma.motivos.some((m) => /inexistente/i.test(m)));

    const dosSinContrato = validarPlan({
      resumen: 'x',
      partes: [{ name: 'back', hace: 'a', ficheros: ['controllers/**'] }, { name: 'front', hace: 'b', ficheros: ['public/**'] }],
      contrato: [],
    });
    r.ok('≥2 partes sin contrato → no ok', dosSinContrato.ok === false);

    const unaParte = validarPlan({ resumen: 'x', partes: [{ name: 'main', hace: 'todo', ficheros: ['**'] }], contrato: [] });
    r.ok('1 sola parte sin contrato SÍ es aprobable', unaParte.ok === true);
  }

  // ── 3b) complejidad: enum cerrado + default seguro ──────────────────────────
  {
    r.eq('niveles', COMPLEJIDADES, ['facil', 'mediana', 'compleja']);
    r.eq('facil válido', normalizarComplejidad('facil'), 'facil');
    r.eq('MAYÚSCULAS/espacios → normaliza', normalizarComplejidad('  MEDIANA '), 'mediana');
    r.eq('valor inventado → default compleja', normalizarComplejidad('trivial'), 'compleja');
    r.eq('vacío/nulo → default compleja', normalizarComplejidad(null), 'compleja');
    r.eq('normalizarPlan sella complejidad', normalizarPlan({ resumen: 'x', complejidad: 'facil' }).complejidad, 'facil');
    r.eq('normalizarPlan sin complejidad → compleja', normalizarPlan({ resumen: 'x' }).complejidad, 'compleja');
  }

  // ── 3c) renderPlanTexto: el texto legible que escribe el FORGE (no el agente) ─
  {
    const txt = renderPlanTexto(planOk);
    r.ok('incluye el resumen', txt.includes(planOk.resumen));
    r.ok('muestra la complejidad', /Complejidad:/i.test(txt));
    r.ok('lista las partes (back y front)', txt.includes('back') && txt.includes('front'));
    r.ok('muestra el contrato', /Contrato:/i.test(txt));
    r.ok('NO empieza por el icono de latido ✦ (deja de repintar el vivo)', !txt.startsWith('✦'));
  }

  // ── 4) planAPropuestaSubtareas → troceaTarea limpio ─────────────────────────
  {
    const prop = planAPropuestaSubtareas(planOk);
    r.eq('propone 2 carriles', prop.subtareas.length, 2);
    const back = prop.subtareas.find((s) => s.name === 'back');
    r.eq('back.alcance.archivos del plan', back.alcance.archivos, ['controllers/**', 'routes/api/**']);
    r.eq('back.noTocar = ficheros del front', back.alcance.noTocar, ['public/**']);
    r.ok('back lleva su trozo de contrato', Array.isArray(back.contrato) && back.contrato.length === 1);

    const corte = troceaTarea(prop);
    r.ok('troceaTarea PARTE limpio (carriles no colisionan)', corte.troceada === true);
    r.eq('parte en 2 subtareas', corte.subtareas.length, 2);

    // un plan donde dos partes comparten zona → troceaTarea NO parte (red de seguridad)
    const solapado = planAPropuestaSubtareas({
      resumen: 'x',
      partes: [{ name: 'a', hace: '1', ficheros: ['controllers/**'] }, { name: 'b', hace: '2', ficheros: ['controllers/**'] }],
      contrato: [{ entre: ['a', 'b'], interfaz: 'i', acuerdo: 'w' }],
    });
    r.ok('carriles solapados → troceaTarea NO parte', troceaTarea(solapado).troceada === false);
  }
}
