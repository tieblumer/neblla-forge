// tests/25-tarea-estado.test.js
//
// La diana de la tarea #003: "Estado por tarea en el panel derecho". Suite PURA
// (needsServer = false): ejercita scripts/lib/forge-estado.js sin servidor, sin
// Mongo, sin `claude`. Comprueba que el icono se DERIVA de las señales que el
// ciclo ya emite (builtAt/brought/error), la regla del padre (menos avanzada;
// rojo gana), la divergencia (auto-despliegue) y el orden de los cajones.

import {
  subtareasDe, estadoPadre, diverge, decorar, ordenar, iconOf, ESTADOS, GRUPOS,
} from '../scripts/lib/forge-estado.js';

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('25 — estado por tarea (panel derecho, lógica pura)');

  // ── la escalera de iconos ──────────────────────────────────────────────────
  r.eq('▢ pendiente', iconOf('pendiente'), '▢');
  r.eq('⏳ cogida', iconOf('cogida'), '⏳');
  r.eq('🌳 mergeada', iconOf('mergeada'), '🌳');
  r.eq('✕ cerrada', iconOf('cerrada'), '✕');
  r.eq('✕ error', iconOf('error'), '✕');
  r.ok('error es rojo, cerrada no', ESTADOS.error.rojo === true && !ESTADOS.cerrada.rojo);

  // ── main sintética: el estado se LEE de las señales del ciclo ───────────────
  r.eq('sin marcas → main pendiente', subtareasDe({}).map((s) => s.estado).join(), 'pendiente');
  r.eq('builtAt → main cogida', subtareasDe({ builtAt: 'x' })[0].estado, 'cogida');
  r.eq('brought → main mergeada', subtareasDe({ builtAt: 'x', brought: true })[0].estado, 'mergeada');
  r.eq('error gana sobre brought', subtareasDe({ brought: true, error: 'petó' })[0].estado, 'error');
  r.eq('cerrada explícita', subtareasDe({ brought: true, cerrada: true })[0].estado, 'cerrada');
  r.eq('siempre hay al menos main', subtareasDe(null).length, 1);
  r.eq('la única se llama main', subtareasDe({})[0].name, 'main');

  // ── subtareas explícitas se respetan (y se sanean) ─────────────────────────
  {
    const subs = subtareasDe({ subtareas: [{ name: 'a', estado: 'cogida' }, { name: 'b', estado: 'inventado' }] });
    r.eq('respeta estado válido', subs[0].estado, 'cogida');
    r.eq('sanea estado inválido → pendiente', subs[1].estado, 'pendiente');
  }

  // ── regla del padre: la subtarea MENOS avanzada ────────────────────────────
  r.eq('padre = menos avanzada', estadoPadre([{ estado: 'mergeada' }, { estado: 'cogida' }]), 'cogida');
  r.eq('todas terminadas → mergeada', estadoPadre([{ estado: 'mergeada' }, { estado: 'mergeada' }]), 'mergeada');
  r.eq('lista vacía → pendiente', estadoPadre([]), 'pendiente');

  // ── el ROJO siempre gana (no se esconde tras un hermano terminado) ─────────
  r.eq('rojo gana aunque otra esté mergeada',
    estadoPadre([{ estado: 'mergeada' }, { estado: 'error' }]), 'error');
  r.eq('rojo gana aunque todas las demás terminen',
    estadoPadre([{ estado: 'cerrada' }, { estado: 'error' }, { estado: 'mergeada' }]), 'error');

  // ── divergencia → auto-despliegue ──────────────────────────────────────────
  r.ok('iconos iguales NO divergen', diverge([{ estado: 'cogida' }, { estado: 'cogida' }]) === false);
  r.ok('iconos distintos divergen', diverge([{ estado: 'cogida' }, { estado: 'mergeada' }]) === true);
  r.ok('una sola subtarea no diverge', diverge([{ estado: 'cogida' }]) === false);

  // ── decorar: el objeto que viaja al front ──────────────────────────────────
  {
    const d = decorar({ id: '003', num: 3, title: 'X', builtAt: 'x' });
    r.eq('decora estado', d.estado, 'cogida');
    r.eq('decora icono', d.icon, '⏳');
    r.eq('decora grupo', d.grupo, 'encurso');
    r.eq('decora subtareas', d.subtareas.length, 1);
    r.ok('preserva campos originales', d.id === '003' && d.title === 'X');
  }

  // ── ordenar: cajón a cajón (revisar → en curso → por hacer → terminadas) ────
  {
    const lista = [
      { id: '001', num: 1, brought: true },              // terminadas
      { id: '002', num: 2 },                             // por hacer (pendiente)
      { id: '003', num: 3, builtAt: 'x' },               // en curso (cogida)
      { id: '004', num: 4, error: 'petó' },              // revisar
      { id: '005', num: 5, builtAt: 'x' },               // en curso (cogida), más nueva
    ];
    const ord = ordenar(lista).map((t) => t.id);
    r.eq('revisar primero', ord[0], '004');
    r.eq('en curso después, la más nueva arriba', ord.slice(1, 3).join(), '005,003');
    r.eq('por hacer luego', ord[3], '002');
    r.eq('terminadas al final', ord[4], '001');
  }

  // ── los cajones están en el orden canónico ─────────────────────────────────
  r.eq('orden de cajones', GRUPOS.map((g) => g.key).join(),
    'revisar,encurso,porhacer,terminadas');
}
