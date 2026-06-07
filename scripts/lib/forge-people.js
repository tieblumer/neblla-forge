/**
 * forge-people.js — el registro de EMPLEADOS del forge (people/P-NNN.json).
 *
 * Cada empleado es un fichero people/P-NNN.json con identidad NEUTRA:
 *   { id, rol, nombre, descripcion, modelo, scope:{lee,escribe,preguntar}, herramientas }
 *
 * Dos identificadores, a propósito:
 *   • `id`  (P-001…) = la identidad NEUTRA. Es el nombre de fichero y la clave de
 *                      las URLs/botones de la UI. No cambia nunca.
 *   • `rol` (miguel, aube…) = la clave ESTABLE que usa el código para lanzar a cada
 *                      personaje (FORGE_AUTHOR) y para pintar su nombre en el hilo.
 *   • `nombre` = el rótulo que se ve; se puede cambiar cuando se quiera sin tocar nada.
 *
 * `descripcion` = la VOZ (su texto inicial: instrucciones reales que usa al lanzarse).
 * `modelo` = alias por persona ('' = hereda el global). `scope` = permisos de
 * lectura/escritura. `herramientas` = qué herramientas MCP puede llamar.
 *
 * La capa solo LEE/ESCRIBE disco con lógica común. La validación (modelo válido,
 * opciones de scope) la pone forge.js. Reusa atomicWrite de forge-store.
 */

import fs from 'fs';
import path from 'path';
import { atomicWrite } from './forge-store.js';

// people/ vive en la RAÍZ de la instalación del forge (junto a CLAUDE.md y las
// fichas claudio.md/iris.md), NO bajo forge/sprint. Por eso recibe el FORGE_DIR.
export function peopleDir(forgeDir) {
  return path.join(forgeDir, 'people');
}

function personPath(forgeDir, id) {
  return path.join(peopleDir(forgeDir), String(id) + '.json');
}

// Forma canónica tolerante: rellena lo que falte sin inventar.
function normalize(raw, fileId) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const scope = (o.scope && typeof o.scope === 'object') ? o.scope : {};
  return {
    id: typeof o.id === 'string' && o.id.trim() ? o.id : fileId,
    rol: typeof o.rol === 'string' && o.rol.trim() ? o.rol : fileId,
    // alias = otros roles que TAMBIÉN resuelven a esta ficha (p.ej. la pareja
    // Ariel/Romina: un solo perfil que sirve a los dos rótulos de género).
    alias: Array.isArray(o.alias) ? o.alias.map(String) : [],
    nombre: typeof o.nombre === 'string' && o.nombre.trim() ? o.nombre : fileId,
    descripcion: typeof o.descripcion === 'string' ? o.descripcion : '',
    modelo: typeof o.modelo === 'string' ? o.modelo : '',
    scope: {
      lee: typeof scope.lee === 'string' ? scope.lee : (Array.isArray(scope.lee) ? scope.lee : ''),
      escribe: Array.isArray(scope.escribe) ? scope.escribe : [],
      preguntar: scope.preguntar === true,   // por defecto FALSE: solo pregunta si se marca
    },
    herramientas: Array.isArray(o.herramientas) ? o.herramientas.map(String) : [],
  };
}

// El objeto que se PERSISTE (sin campos derivados). Orden fijo, legible.
function serialize(p) {
  const out = { id: p.id, rol: p.rol };
  if (p.alias && p.alias.length) out.alias = p.alias;
  out.nombre = p.nombre; out.descripcion = p.descripcion;
  out.modelo = p.modelo; out.scope = p.scope; out.herramientas = p.herramientas;
  return JSON.stringify(out, null, 2) + '\n';
}

// Lee un empleado por su id (= nombre de fichero, P-NNN). null si no existe/ilegible.
export function readPerson(forgeDir, id) {
  if (!id) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(personPath(forgeDir, id), 'utf8')); }
  catch { return null; }
  return normalize(raw, String(id));
}

// Lista TODOS los empleados (ordenados por id). Solo *.json; ignora claudio.md /
// iris.md (fichas de prosa de las sesiones, no empleados headless).
export function listPeople(forgeDir) {
  let files = [];
  try { files = fs.readdirSync(peopleDir(forgeDir)); }
  catch { return []; }
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort()
    .map((id) => readPerson(forgeDir, id))
    .filter(Boolean);
}

// Busca un empleado por su ROL (la clave que usa el código al lanzarlo: 'miguel',
// 'aube'…). Escanea el registro (12 ficheros, barato). null si ningún rol cuadra.
export function findByRol(forgeDir, rol) {
  if (!rol) return null;
  const r = String(rol).toLowerCase();
  return listPeople(forgeDir).find((p) =>
    String(p.rol).toLowerCase() === r || (p.alias || []).some((a) => String(a).toLowerCase() === r)
  ) || null;
}

function mergeScope(cur, patch) {
  if (!patch || typeof patch !== 'object') return cur;
  const out = { lee: cur.lee, escribe: cur.escribe, preguntar: cur.preguntar };
  if (patch.lee !== undefined) out.lee = patch.lee;
  if (patch.escribe !== undefined) {
    out.escribe = Array.isArray(patch.escribe)
      ? patch.escribe.map((s) => String(s).trim()).filter(Boolean) : [];
  }
  if (patch.preguntar !== undefined) out.preguntar = patch.preguntar !== false;
  return out;
}

// Parcha un empleado por su id: descripcion / modelo / scope / herramientas / nombre.
// NO crea ni renombra ficheros (el id manda). Devuelve el empleado normalizado o null.
export function writePerson(forgeDir, id, patch = {}) {
  const cur = readPerson(forgeDir, id);
  if (!cur) return null;
  const next = {
    id: cur.id,
    rol: cur.rol,
    alias: cur.alias,
    nombre: typeof patch.nombre === 'string' && patch.nombre.trim() ? patch.nombre : cur.nombre,
    descripcion: typeof patch.descripcion === 'string' ? patch.descripcion : cur.descripcion,
    modelo: typeof patch.modelo === 'string' ? patch.modelo : cur.modelo,
    scope: mergeScope(cur.scope, patch.scope),
    herramientas: Array.isArray(patch.herramientas)
      ? patch.herramientas.map((s) => String(s).trim()).filter(Boolean) : cur.herramientas,
  };
  atomicWrite(personPath(forgeDir, cur.id), serialize(next));
  return next;
}
