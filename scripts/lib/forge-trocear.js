/**
 * forge-trocear.js — el CEREBRO de Aubé para partir una tarea en subtareas
 * paralelas (tarea #008). Lógica PURA y testable: propuesta → partición.
 *
 * El motor (forge-estado.js) y la UI ya saben pintar varias subtareas y el icono
 * del padre. Lo que faltaba era el CRITERIO: cuándo partir, cómo describir el
 * carril de cada trozo, y qué hacer cuando dos trozos se pisan. Eso vive aquí.
 *
 * Modelo (alineado con forge-estado.js):
 *   - El DEFAULT es NO partir: una sola subtarea `main` de alcance completo.
 *   - Aubé solo parte cuando los trozos son de VERDAD independientes: carriles
 *     (archivos/zonas) que no se solapan. Si se pisan → no se parte, queda `main`.
 *   - Cada subtarea lleva su ALCANCE explícito: `archivos` (qué le toca),
 *     `frontera` (hasta dónde) y `noTocar` (lo prohibido). El plan COMPLETO sigue
 *     viviendo en la tarea; el alcance solo recorta el carril del programador.
 *
 * Las tres decisiones de la tarea, resueltas aquí:
 *   1. CUÁNDO partir  → `troceaTarea` solo parte si hay ≥2 carriles sin colisión.
 *   2. CÓMO el alcance → `normalizarAlcance` da forma al carril {archivos,frontera,noTocar}.
 *   3. COLISIÓN        → `detectarColisiones` (a priori, antes de construir) +
 *                        `colisionEnEjecucion` (a posteriori, sobre lo tocado de verdad).
 *
 * Es código puro: NO lee disco, NO importa el store, NO toca env. Lo invoca
 * Lane 1 (forge.js) al aprobar/dividir una tarea; los tests lo ejercitan solos.
 */

// El carril por defecto de una tarea sin partir: una subtarea que lo abarca todo.
export const MAIN = Object.freeze({
  name: 'main',
  alcance: Object.freeze({ archivos: ['**'], frontera: 'toda la tarea', noTocar: [] }),
});

// ── el alcance (el carril de una subtarea) ───────────────────────────────────
// Sanea lo que venga (de Aubé o de Tie a mano) a la forma canónica del carril.
// Tolerante: una cadena suelta en `archivos` se acepta como un patrón único; los
// patrones se normalizan (barras Windows → /, sin ./ inicial, sin / final).
export function normalizarPatron(p) {
  return String(p == null ? '' : p)
    .trim()
    .replace(/\\/g, '/')        // separadores de Windows → posix
    .replace(/^\.\//, '')       // ./controllers → controllers
    .replace(/\/+$/, '');       // controllers/ → controllers
}

export function normalizarAlcance(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const lista = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])
    .map(normalizarPatron).filter(Boolean);
  return {
    archivos: lista(a.archivos),
    frontera: String(a.frontera == null ? '' : a.frontera).trim(),
    noTocar: lista(a.noTocar),
  };
}

// ── solape de carriles (la mecánica de colisión, decisión #3) ────────────────
// Un patrón se reduce a su PREFIJO ESTÁTICO: los segmentos antes del primer
// comodín. `controllers/**` → ['controllers']; `routes/api/*.js` → ['routes','api'];
// `controllers/Friends.js` → ['controllers','Friends.js']; `**` o `*.html` → [].
function prefijo(patron) {
  const segs = normalizarPatron(patron).split('/').filter(Boolean);
  const out = [];
  for (const s of segs) {
    if (s.includes('*') || s.includes('?')) break;   // primer comodín: paramos
    out.push(s);
  }
  return out;
}

// ¿Es `a` un prefijo de camino de `b` (o igual)? Comparación por SEGMENTOS, no por
// substring: ['controllers'] es prefijo de ['controllers','Friends.js'] pero
// ['cont'] NO lo es de ['controllers'].
function esPrefijoDe(a, b) {
  if (a.length > b.length) return false;
  return a.every((s, i) => s === b[i]);
}

// ¿Dos patrones pueden tocar el MISMO fichero? Sí cuando uno cubre al otro: un
// prefijo vacío (`**`, `*.html`) cubre todo el árbol → solapa con cualquiera (un
// carril sin acotar no es paralelizable con nada — se queda en `main`).
export function patronesSolapan(p1, p2) {
  const a = prefijo(p1);
  const b = prefijo(p2);
  return esPrefijoDe(a, b) || esPrefijoDe(b, a);
}

// ── colisión A PRIORI: ¿se pisan los carriles ANTES de construir? ────────────
// Compara los `archivos` de cada par de subtareas. Devuelve un parte por cada par
// que solapa, con los patrones culpables — la prueba de por qué no se puede partir.
export function detectarColisiones(subtareas) {
  const subs = (subtareas || []).filter((s) => s && s.name);
  const out = [];
  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      const A = normalizarAlcance(subs[i].alcance);
      const B = normalizarAlcance(subs[j].alcance);
      const pares = [];
      for (const pa of A.archivos) {
        for (const pb of B.archivos) {
          if (patronesSolapan(pa, pb)) pares.push([pa, pb]);
        }
      }
      if (pares.length) out.push({ a: subs[i].name, b: subs[j].name, patrones: pares });
    }
  }
  return out;
}

// ── la decisión completa: ¿parto o no? (decisión #1, usando #2 y #3) ─────────
// `propuesta` = lo que Aubé propone: { subtareas: [{name, alcance}, …] } o nada.
// Reglas:
//   • menos de 2 carriles válidos (con archivos) → NO se parte: queda `main`.
//   • los carriles colisionan (a priori) → NO se parte: queda `main` (rule 1).
//   • ≥2 carriles independientes → se parte de verdad.
// SIEMPRE devuelve la misma forma { subtareas, troceada, motivo, colisiones } para
// que forge.js no tenga que ramificar: aplica `subtareas` y muestra `motivo`.
export function troceaTarea(propuesta) {
  const crudas = (propuesta && Array.isArray(propuesta.subtareas)) ? propuesta.subtareas : [];
  // sanea: nombre obligatorio, alcance normalizado, nombres únicos.
  const vistos = new Set();
  const subs = [];
  for (const s of crudas) {
    const name = String((s && s.name) || '').trim();
    if (!name || vistos.has(name)) continue;
    vistos.add(name);
    subs.push({ name, alcance: normalizarAlcance(s && s.alcance) });
  }

  // un carril sólo cuenta si declara DÓNDE actúa (sin `archivos` no es un carril).
  const conCarril = subs.filter((s) => s.alcance.archivos.length);
  if (conCarril.length < 2) {
    return { subtareas: [clonMain()], troceada: false, colisiones: [],
      motivo: 'una sola pieza (no hay dos carriles independientes que declarar) → main' };
  }

  const colisiones = detectarColisiones(conCarril);
  if (colisiones.length) {
    const det = colisiones.map((c) => `${c.a}↔${c.b}`).join(', ');
    return { subtareas: [clonMain()], troceada: false, colisiones,
      motivo: `los carriles se pisan (${det}) → no se parte, queda main` };
  }

  return { subtareas: conCarril, troceada: true, colisiones: [],
    motivo: `${conCarril.length} carriles independientes: ${conCarril.map((s) => s.name).join(', ')}` };
}

function clonMain() {
  return { name: MAIN.name, alcance: { ...MAIN.alcance, archivos: [...MAIN.alcance.archivos], noTocar: [] } };
}

// ── colisión A POSTERIORI: dos programadores tocaron el mismo fichero ────────
// El motor ya avisa por el icono (el padre asume la subtarea menos avanzada y el
// contenedor se abre solo al divergir). Esto es el OTRO lado: QUIÉN detecta el
// solape real y CÓMO se resuelve. `tocados` = { <name>: [rutas que tocó de verdad] }
// (lo sabe el ciclo tras construir, p.ej. del `git diff` de cada worktree).
// Devuelve, por cada fichero tocado por ≥2 subtareas, quiénes lo tocaron. Una lista
// vacía = sin solape real (paralelización limpia, se puede fusionar sin miedo).
export function colisionEnEjecucion(tocados) {
  const porFichero = new Map();
  for (const [name, rutas] of Object.entries(tocados || {})) {
    for (const r of (Array.isArray(rutas) ? rutas : [])) {
      const f = normalizarPatron(r);
      if (!f) continue;
      if (!porFichero.has(f)) porFichero.set(f, new Set());
      porFichero.get(f).add(name);
    }
  }
  const out = [];
  for (const [fichero, quienes] of porFichero) {
    if (quienes.size > 1) out.push({ fichero, subtareas: [...quienes].sort() });
  }
  return out.sort((x, y) => x.fichero.localeCompare(y.fichero));
}
