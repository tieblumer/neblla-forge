// tests/26-trocear.test.js
//
// La diana de la tarea #008: "Aubé aprende a trocear una tarea en subtareas
// paralelas". Suite PURA (needsServer = false): ejercita scripts/lib/forge-trocear.js
// (el cerebro de Aubé) + el parser del bloque ```subtareas de forge-prompts.js.
// Comprueba las tres decisiones: CUÁNDO partir, CÓMO el alcance, y la COLISIÓN
// (a priori, antes de construir; y a posteriori, sobre lo tocado de verdad).

import {
  normalizarPatron, normalizarAlcance, patronesSolapan,
  detectarColisiones, troceaTarea, colisionEnEjecucion, MAIN,
} from '../scripts/lib/forge-trocear.js';
import { parseSubtareasBloque, aubePrompt } from '../scripts/lib/forge-prompts.js';

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('26 — trocear: el cerebro de Aubé (lógica pura)');

  // ── normalización del carril ────────────────────────────────────────────────
  r.eq('barras Windows → posix', normalizarPatron('controllers\\Friends.js'), 'controllers/Friends.js');
  r.eq('quita ./ inicial', normalizarPatron('./public/foo'), 'public/foo');
  r.eq('quita / final', normalizarPatron('routes/api/'), 'routes/api');
  {
    const a = normalizarAlcance({ archivos: 'controllers/**', frontera: '  server ', noTocar: ['public/**', ''] });
    r.eq('archivos string suelto → array', a.archivos.join(), 'controllers/**');
    r.eq('frontera trim', a.frontera, 'server');
    r.eq('noTocar saneado (sin vacíos)', a.noTocar.join(), 'public/**');
    r.eq('alcance vacío → arrays vacíos', normalizarAlcance(null).archivos.length, 0);
  }

  // ── solape de patrones (la mecánica de colisión por prefijo de segmentos) ────
  r.ok('zona contiene fichero → solapan', patronesSolapan('controllers/**', 'controllers/Friends.js'));
  r.ok('back vs front → NO solapan', !patronesSolapan('routes/api/**', 'public/**'));
  r.ok('dos ficheros distintos misma carpeta → NO solapan', !patronesSolapan('controllers/Friends.js', 'controllers/Room.js'));
  r.ok('prefijo por SEGMENTO, no substring (cont ≠ controllers)', !patronesSolapan('cont/**', 'controllers/**'));
  r.ok('mismo patrón → solapa', patronesSolapan('public/**', 'public/**'));
  r.ok('comodín de raíz (**) cubre todo → solapa con cualquiera', patronesSolapan('**', 'routes/api/**'));
  r.ok('*.html sin carpeta = prefijo vacío → solapa (no acotado)', patronesSolapan('*.html', 'public/**'));

  // ── detectarColisiones (a priori) ────────────────────────────────────────────
  {
    const limpio = [
      { name: 'back', alcance: { archivos: ['controllers/**', 'routes/api/**'] } },
      { name: 'front', alcance: { archivos: ['public/**'] } },
    ];
    r.eq('carriles limpios → sin colisión', detectarColisiones(limpio).length, 0);

    const sucio = [
      { name: 'back', alcance: { archivos: ['controllers/**'] } },
      { name: 'otro', alcance: { archivos: ['controllers/Friends.js'] } },
    ];
    const col = detectarColisiones(sucio);
    r.eq('carriles que se pisan → 1 colisión', col.length, 1);
    r.eq('la colisión nombra a los dos', [col[0].a, col[0].b].sort().join(), 'back,otro');
    r.ok('la colisión señala los patrones culpables', col[0].patrones.length >= 1);
  }

  // ── troceaTarea: la decisión completa (CUÁNDO partir) ────────────────────────
  {
    const def = troceaTarea(null);
    r.eq('sin propuesta → no se parte', def.troceada, false);
    r.eq('sin propuesta → una sola subtarea', def.subtareas.length, 1);
    r.eq('sin propuesta → es main', def.subtareas[0].name, MAIN.name);
  }
  {
    const una = troceaTarea({ subtareas: [{ name: 'solo', alcance: { archivos: ['x/**'] } }] });
    r.eq('un solo carril → no se parte (queda main)', una.troceada, false);
    r.eq('un solo carril → main', una.subtareas[0].name, 'main');
  }
  {
    const ok = troceaTarea({ subtareas: [
      { name: 'back', alcance: { archivos: ['controllers/**'] } },
      { name: 'front', alcance: { archivos: ['public/**'] } },
    ] });
    r.eq('dos carriles independientes → SE PARTE', ok.troceada, true);
    r.eq('se parte en 2', ok.subtareas.length, 2);
    r.eq('conserva nombres', ok.subtareas.map((s) => s.name).join(), 'back,front');
    r.ok('conserva el alcance normalizado', ok.subtareas[0].alcance.archivos.join() === 'controllers/**');
  }
  {
    // rule 1 + rule 3: si los carriles se pisan, NO se parte aunque Aubé lo proponga.
    const choca = troceaTarea({ subtareas: [
      { name: 'a', alcance: { archivos: ['controllers/**'] } },
      { name: 'b', alcance: { archivos: ['controllers/Friends.js'] } },
    ] });
    r.eq('carriles que colisionan → NO se parte', choca.troceada, false);
    r.eq('colisión → cae a main', choca.subtareas[0].name, 'main');
    r.ok('reporta la colisión en el motivo', /se pisan/.test(choca.motivo));
    r.ok('adjunta las colisiones detectadas', choca.colisiones.length === 1);
  }
  {
    // nombres duplicados se descartan; un carril sin `archivos` no cuenta.
    const raro = troceaTarea({ subtareas: [
      { name: 'x', alcance: { archivos: ['a/**'] } },
      { name: 'x', alcance: { archivos: ['b/**'] } },   // duplicado → fuera
      { name: 'y', alcance: { frontera: 'sin archivos' } }, // sin carril → no cuenta
    ] });
    r.eq('dup + carril vacío → menos de 2 válidos → main', raro.troceada, false);
  }

  // ── colisión A POSTERIORI (sobre lo tocado de verdad) ────────────────────────
  {
    r.eq('nadie pisa a nadie → sin colisión real',
      colisionEnEjecucion({ back: ['controllers/x.js'], front: ['public/y.js'] }).length, 0);
    const col = colisionEnEjecucion({
      back: ['controllers/x.js', 'shared/util.js'],
      front: ['public/y.js', 'shared/util.js'],
    });
    r.eq('mismo fichero tocado por dos → 1 colisión real', col.length, 1);
    r.eq('señala el fichero del solape', col[0].fichero, 'shared/util.js');
    r.eq('y quién lo tocó', col[0].subtareas.join(), 'back,front');
    r.eq('normaliza barras al comparar',
      colisionEnEjecucion({ a: ['shared\\u.js'], b: ['shared/u.js'] }).length, 1);
  }

  // ── el parser del bloque ```subtareas de Aubé ────────────────────────────────
  {
    r.eq('sin bloque → null', parseSubtareasBloque('solo texto, sin bloque'), null);
    r.eq('JSON roto → null', parseSubtareasBloque('```subtareas\n[ roto ]\n```'), null);
    const msg = [
      'Partir back y front',
      'cuerpo del plan…',
      '```subtareas',
      '[{"name":"back","alcance":{"archivos":["controllers/**"]}},',
      ' {"name":"front","alcance":{"archivos":["public/**"]}}]',
      '```',
    ].join('\n');
    const p = parseSubtareasBloque(msg);
    r.ok('extrae el bloque', p && p.subtareas.length === 2);
    // y el cerebro lo acepta como partición limpia.
    r.eq('parser + cerebro → se parte', troceaTarea(p).troceada, true);
  }

  // ── el prompt de Aubé enseña el criterio ─────────────────────────────────────
  {
    const pr = aubePrompt({ threadText: 'hola' });
    r.ok('el prompt menciona el bloque subtareas', /```subtareas/.test(pr));
    r.ok('el prompt dice que por defecto NO se parte', /DEFECTO.*NO se parte/.test(pr));
    r.ok('el prompt explica el carril (archivos/frontera/noTocar)', /noTocar/.test(pr) && /frontera/.test(pr));
  }
}
