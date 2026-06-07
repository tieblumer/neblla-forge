/**
 * forge-plan.js — el PLAN estructurado de Aubé (con contrato entre partes).
 *
 * Hoy Aubé devuelve un título + un cuerpo libre: un ACTA, no un plan. Esta pieza
 * le da forma a un plan de implementación de VERDAD:
 *   - resumen   : qué se construye y por qué (una o dos frases)
 *   - partes    : las piezas del trabajo. Cada una: `name`, `hace` (qué hace) y
 *                 `ficheros` (las zonas/globs que toca). Son el borrador de las
 *                 futuras subtareas paralelas.
 *   - contrato  : los ACUERDOS entre partes — la INTERFAZ (forma fija) por la que
 *                 hablan, escrita ANTES de construir. Es lo que hace seguro soltar
 *                 dos programadores en paralelo: cada uno conoce su frontera con el
 *                 vecino sin adivinar. El contrato es FORMA, no ORDEN.
 *
 * Lógica PURA y testable (Contrato B): NO lee disco, NO importa el store, NO toca
 * env. La invoca forge.js al aprobar el plan / al paralelizar; los tests la
 * ejercitan sola. El troceo real (colisión de carriles) sigue en forge-trocear.js;
 * aquí solo se convierte el plan en la propuesta que aquel valida.
 */

import { normalizarPatron, normalizarAlcance } from './forge-trocear.js';

// Niveles de COMPLEJIDAD que Aubé asigna a la tarea — gobiernan el pipeline de tests:
//   facil    → el forge NO llama a Ana Liz (contesta en su nombre: no necesita tests)
//   mediana  → Ana Liz genera una batería MÍNIMA (camino feliz + 1-2 bordes críticos)
//   compleja → Ana Liz a fondo (cobertura completa, como siempre)
// Default seguro = 'compleja' (nunca saltarse tests por un dato ausente).
export const COMPLEJIDADES = ['facil', 'mediana', 'compleja'];
export function normalizarComplejidad(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return COMPLEJIDADES.includes(s) ? s : 'compleja';
}
// La complejidad EFECTIVA de una tarea: el override manual de Tie (tarea.complejidad)
// MANDA sobre la que clasificó Aubé (tarea.plan.complejidad). Sin ninguna → compleja.
export function complejidadEfectiva(tarea) {
  const t = tarea || {};
  if (t.complejidad != null && String(t.complejidad).trim()) return normalizarComplejidad(t.complejidad);
  return normalizarComplejidad(t.plan && t.plan.complejidad);
}

// ── parseo del bloque ```plan … ``` que Aubé deja al final de su mensaje ───────
// Devuelve el objeto crudo del JSON, o null si no hay bloque o no cuela. El caller
// lo pasa por normalizarPlan. Sin bloque/ilegible → la tarea queda sin plan
// estructurado (degradación limpia: sigue teniendo título+cuerpo).
export function parsePlanBloque(text) {
  const t = String(text == null ? '' : text);
  const m = t.match(/```plan\s*([\s\S]*?)```/i);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[1].trim()); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return obj;
}

// ── forma canónica del plan ───────────────────────────────────────────────────
// Tolerante con lo que venga (de Aubé o de Tie a mano). Siempre devuelve la misma
// forma, con arrays sanos, para que el resto del código no tenga que ramificar.
export function normalizarPlan(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const partes = (Array.isArray(r.partes) ? r.partes : [])
    .map((p) => {
      const o = p && typeof p === 'object' ? p : {};
      const ficheros = (Array.isArray(o.ficheros) ? o.ficheros : o.ficheros == null || o.ficheros === '' ? [] : [o.ficheros])
        .map(normalizarPatron).filter(Boolean);
      return {
        name: String(o.name == null ? '' : o.name).trim(),
        hace: String(o.hace == null ? '' : o.hace).trim(),
        ficheros,
      };
    })
    .filter((p) => p.name);
  const contrato = (Array.isArray(r.contrato) ? r.contrato : [])
    .map((c) => {
      const o = c && typeof c === 'object' ? c : {};
      const entre = (Array.isArray(o.entre) ? o.entre : o.entre == null || o.entre === '' ? [] : [o.entre])
        .map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
      return {
        entre,
        interfaz: String(o.interfaz == null ? '' : o.interfaz).trim(),
        acuerdo: String(o.acuerdo == null ? '' : o.acuerdo).trim(),
      };
    })
    .filter((c) => c.interfaz || c.entre.length);
  return {
    version: 1,
    resumen: String(r.resumen == null ? '' : r.resumen).trim(),
    complejidad: normalizarComplejidad(r.complejidad),
    partes,
    contrato,
    aprobado: r.aprobado === true,
    aprobadoAt: r.aprobadoAt || null,
  };
}

// Render DETERMINISTA del plan → texto legible para el hilo (lo escribe el forge,
// NO el agente: la estructura manda, el texto se deriva de ella). Es lo que se ve
// como mensaje de Aubé. NO empieza por su icono de latido (✦) para que el bucle de
// "vivo" deje de repintar al detectar que ya hay contenido real.
const COMPLEJIDAD_ETIQUETA = { facil: 'fácil', mediana: 'mediana', compleja: 'compleja' };
export function renderPlanTexto(plan) {
  const p = normalizarPlan(plan);
  const lineas = [];
  if (p.resumen) lineas.push(p.resumen);
  lineas.push('', `Complejidad: ${COMPLEJIDAD_ETIQUETA[p.complejidad] || p.complejidad}`);
  if (p.partes.length) {
    lineas.push('', 'Partes:');
    for (const parte of p.partes) {
      const fich = parte.ficheros.length ? `  (ficheros: ${parte.ficheros.join(', ')})` : '';
      lineas.push(`• ${parte.name}${parte.hace ? ' — ' + parte.hace : ''}${fich}`);
    }
  }
  if (p.contrato.length) {
    lineas.push('', 'Contrato:');
    for (const c of p.contrato) {
      const quienes = c.entre.length ? c.entre.join(' ↔ ') + ': ' : '';
      lineas.push(`• ${quienes}${c.interfaz}${c.acuerdo ? ' — ' + c.acuerdo : ''}`);
    }
  }
  return lineas.join('\n').trim();
}

// ── ¿es un plan APROBABLE? ─────────────────────────────────────────────────────
// La puerta antes de paralelizar/construir. Devuelve { ok, motivos:[…] }: ok=false
// con las razones legibles si algo falta. Reglas:
//   • resumen no vacío.
//   • al menos una parte, y CADA parte declara dónde actúa (`ficheros`).
//   • cada entrada del contrato referencia partes que EXISTEN (no se inventa una
//     frontera con una pieza que no está en el plan).
//   • si hay ≥2 partes, el contrato no puede estar vacío (dos piezas en paralelo
//     SIN acuerdo entre ellas = colisión esperando a pasar).
export function validarPlan(plan) {
  const p = normalizarPlan(plan);
  const motivos = [];
  if (!p.resumen) motivos.push('falta el resumen (qué se construye y por qué)');
  if (!p.partes.length) motivos.push('el plan no tiene ninguna parte');
  const sinFicheros = p.partes.filter((x) => !x.ficheros.length).map((x) => x.name);
  if (sinFicheros.length) motivos.push('estas partes no declaran ficheros: ' + sinFicheros.join(', '));
  const nombres = new Set(p.partes.map((x) => x.name));
  for (const c of p.contrato) {
    const fuera = c.entre.filter((n) => !nombres.has(n));
    if (fuera.length) motivos.push(`el contrato referencia partes inexistentes: ${fuera.join(', ')}`);
  }
  if (p.partes.length >= 2 && !p.contrato.length) {
    motivos.push('hay ≥2 partes pero ningún contrato que fije la frontera entre ellas');
  }
  return { ok: motivos.length === 0, motivos };
}

// ── plan → propuesta de subtareas (para forge-trocear.troceaTarea) ─────────────
// Convierte las `partes` del plan en carriles {name, alcance:{archivos,frontera,
// noTocar}}. El `noTocar` de cada carril = la unión de los ficheros de las OTRAS
// partes (frontera explícita). A cada subtarea se le adjunta SU trozo del contrato
// (las entradas donde aparece su name) para que el programador conozca su acuerdo.
// El resultado va a troceaTarea, que decide si parte de verdad (sin colisión) o no.
export function planAPropuestaSubtareas(plan) {
  const p = normalizarPlan(plan);
  const subtareas = p.partes.map((parte) => {
    const otros = p.partes.filter((x) => x.name !== parte.name).flatMap((x) => x.ficheros);
    const contrato = p.contrato.filter((c) => c.entre.includes(parte.name));
    return {
      name: parte.name,
      alcance: normalizarAlcance({ archivos: parte.ficheros, frontera: parte.hace, noTocar: [...new Set(otros)] }),
      contrato,
    };
  });
  return { subtareas };
}
