// forge-autostart.js — el CEREBRO del arranque automático de la forja.
//
// Al estilo de forge-shutdown.js / forge-estado.js: una pieza pura + un par de
// helpers de disco best-effort. NO abre procesos ni toca el árbol vivo: solo
// DECIDE y persiste el flag.
//
// La idea: con el interruptor en ON, la forja sigue viva pero ociosa; un ticker
// interno (en forge.js) la consulta cada ~60s y, cuando la ventana de 5h de la
// suscripción se ha recuperado y no hay nadie construyendo, lanza —de una en
// una— la tarea pendiente más antigua. decidir() es ese juicio, aislado y puro
// para poder testearlo regla a regla.

import fs from 'fs';
import path from 'path';

// El TOPE de consumo (porcentaje de la ventana de 5h) por encima del cual NO se
// arranca nada: se espera a que se recupere. Es un umbral INCLUSIVO (>=): justo
// en el tope ya se aguarda. Constante exportada para que el front/los tests no
// se casen con un número mágico.
export const TOPE = 80;

// ── persistencia del flag (best-effort) ──────────────────────────────────────
// El flag vive en <root>/forge/sprint/auto-start.json con la MISMA convención de
// rutas que el resto del sprint (forge-store.js). Nace apagado: si no hay
// fichero (o está corrupto/ilegible), leer devuelve {on:false} sin reventar.
function autoStartFile(root) {
  return path.join(root, 'forge', 'sprint', 'auto-start.json');
}

// Lee el flag persistido. Devuelve SIEMPRE {on:bool}; por defecto {on:false}.
export function readAutoStart(root) {
  try {
    const raw = fs.readFileSync(autoStartFile(root), 'utf8');
    const obj = JSON.parse(raw);
    return { on: !!(obj && obj.on) };
  } catch {
    return { on: false };
  }
}

// Escribe el flag. Acepta tanto un booleano (`true`) como un objeto (`{on:true}`).
// Crea la carpeta si hace falta. Best-effort: un fallo de disco no propaga.
export function writeAutoStart(root, value) {
  const on = (value && typeof value === 'object') ? !!value.on : !!value;
  try {
    const file = autoStartFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ on }, null, 2));
  } catch { /* best-effort */ }
  return { on };
}

// ── la decisión (PURA) ───────────────────────────────────────────────────────
// decidir({on, phase, activeAgents, usagePrimary, pendientes}) → veredicto.
//
// El veredicto tiene forma fija:
//   { accion: 'lanzar'|'esperar'|'nada', tareaId?, proximaVentana, estado, motivo }
// donde `estado` es uno de 'off'|'esperando'|'lanzando'|'sin-pendientes' (la
// forma que el GET expone) y `proximaVentana` solo es no-null cuando se espera
// por consumo (estado 'esperando' con dato de uso).
//
// Las reglas, EN ORDEN (la primera que dispara, manda):
//   1. off                 → nada (el interruptor apagado manda sobre todo)
//   2. phase!=='running'    → nada (respeta el apagado ordenado de F15)
//   3. activeAgents>0       → nada (una a una: nunca se pisan dos builds)
//   4. pendientes vacío     → nada / 'sin-pendientes'
//   5. usagePrimary null    → esperar (sin dato de uso no se arriesga)
//   6. usedPercent >= TOPE  → esperar (aguarda a que se recupere la ventana)
//   7. hay hueco y pendiente→ lanzar la más antigua (menor num)
export function decidir({ on, phase, activeAgents, usagePrimary, pendientes } = {}) {
  if (!on) {
    return { accion: 'nada', estado: 'off', proximaVentana: null, motivo: 'arranque automático apagado' };
  }
  if (phase !== 'running') {
    return { accion: 'nada', estado: 'off', proximaVentana: null, motivo: `forja ${phase || 'no operativa'} (respeta el apagado)` };
  }
  if ((activeAgents || 0) > 0) {
    return { accion: 'nada', estado: 'lanzando', proximaVentana: null, motivo: 'ya hay un agente construyendo (una a una)' };
  }
  const lista = Array.isArray(pendientes) ? pendientes : [];
  if (!lista.length) {
    return { accion: 'nada', estado: 'sin-pendientes', proximaVentana: null, motivo: 'no hay tareas pendientes que lanzar' };
  }
  if (!usagePrimary || usagePrimary.usedPercent == null) {
    return { accion: 'esperar', estado: 'esperando', proximaVentana: null, motivo: 'sin dato de consumo: no se arriesga' };
  }
  if (usagePrimary.usedPercent >= TOPE) {
    return {
      accion: 'esperar', estado: 'esperando',
      proximaVentana: usagePrimary.resetsAt || null,
      motivo: `consumo al ${usagePrimary.usedPercent}% (tope ${TOPE}%): aguarda a que se recupere la ventana de 5h`,
    };
  }
  // hay hueco: lanza la más antigua (menor num).
  const masAntigua = [...lista].sort((a, b) => (a.num || 0) - (b.num || 0))[0];
  return {
    accion: 'lanzar', estado: 'lanzando', tareaId: masAntigua.id, proximaVentana: null,
    motivo: `hueco (consumo ${usagePrimary.usedPercent}%): lanzo la tarea ${masAntigua.id}`,
  };
}
