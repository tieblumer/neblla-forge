# Forge — CONTRATO de paralelización (3 lanes, ficheros disjuntos)

> **ESTADO 2026-06-03 — LAS TRES LANES HECHAS, INTEGRADAS y verificadas.** El forge entero levanta
> verde (`node scripts/forge.js`): miga de pan + transporte (F21), selector de scope + mensaje-rey
> (F22), y los personajes nuevos (Stevens/Miyagi/Romina&Ariel) cableados. Endpoints vivos:
> `GET /api/cycle` + `POST /api/cycle/{advance,back,pause,resume}` y
> `POST /api/chats/:id/{investigar,consejo,discutir}` (body `{scope,targetId}`). Falta solo la
> **prueba en vivo** (Tie en su terminal: `npm run forge`, con headless reales).

> Mapa para construir en paralelo SIN pisarnos. Cada Claude trabaja **solo en los ficheros de su
> lane** y **en su propio git worktree**. El diseño de fondo vive en `forge-backbone.md` (léelo:
> §2 nomenclatura del ciclo, §3 las etapas ventana-a-ventana, F21 transporte, F22 interacción).
> Este documento solo fija **el idioma entre lanes** (endpoints, exports, shapes) para que al
> final encaje solo. **Si algo no está aquí, NO inventes el contrato: pregunta a Iris.**

## Regla de oro
- **Quédate en TUS ficheros.** No edites los de otra lane (ni para "un arreglito").
- Trabaja en un **worktree** propio. Al terminar, se fusiona.
- El contrato (abajo) es ley: respeta nombres de endpoint, exports y shapes **al pie de la letra**.
- Estado del producto: alpha, sin usuarios → refactor libre, sin shims de retrocompat.

---

## Reparto de lanes y ficheros (disjuntos)

| Lane | Quién | Ficheros (únicos de esta lane) | Qué construye |
|---|---|---|---|
| **1 — la forja (back)** | **Iris** | `scripts/forge.js` · `scripts/lib/forge-firme.js` · `scripts/lib/forge-store.js` | Motor del CICLO + transporte + endpoints; endpoints de las acciones de Spike; persistencia. El núcleo determinista. |
| **2 — front** | **Claude A** | `public/forge/index.html` (único fichero) | Miga de pan + mando de transporte (F21); botones de las acciones nuevas; refactor del modelo de interacción (F22: barra común + selector de scope + mensaje seleccionado "rey"). |
| **3 — personajes + MCP** | **Claude B** | `scripts/lib/forge-prompts.js` **(NUEVO)** · `scripts/forge-mcp.js` | Los PROMPTS de todos los personajes como funciones puras (migra los existentes + escribe los nuevos); herramientas MCP que falten. |

> `forge-store.js` lo toca **solo la Lane 1**. Si la Lane 3 necesita una función del store, la
> **pide** y Iris la añade y la fija aquí; la Lane 3 solo la **importa**.

---

## Contrato A — Endpoints HTTP (los expone Lane 1 · los consume Lane 2)

### Ciclo + transporte (NUEVO)
Estado del ciclo, **persistente** (sobrevive a reinicios). Fases lineales: `spike → grooming →
sprint → qa`; `hotfix` es rama (cuelga de qa). Forma del estado (la devuelven todos):

```json
{ "phase": "spike", "cursor": 0, "paused": false,
  "phases": [ {"key":"spike","label":"Spike"}, {"key":"grooming","label":"Grooming"},
              {"key":"sprint","label":"Sprint"}, {"key":"qa","label":"QA"} ],
  "breadcrumb": "[Spike] > Grooming > Sprint > QA" }
```

| Método · ruta | Body | Devuelve |
|---|---|---|
| `GET  /api/cycle` | — | estado del ciclo |
| `POST /api/cycle/advance` | — | estado tras avanzar (no pasa de `qa`) |
| `POST /api/cycle/back` | — | estado tras retroceder (no baja de `spike`) |
| `POST /api/cycle/pause` | — | estado con `paused:true` |
| `POST /api/cycle/resume` | — | estado con `paused:false` |

- **Cruce Spike→Grooming** (primer `advance`): la forja **borra todas las conversaciones** (el
  viejo `/api/sprint/try`). Reversible y repetible (F15): `back` vuelve a Spike; re-`advance`
  repite.
- `POST /api/sprint/try` queda **deprecado** — el front ya no lo llama; usa el transporte.

### Acciones de Spike (NUEVO — mismas convenciones que `/challenge`)
Todas: body `{ "scope": "mensaje"|"hilo"|"conversacion"|"contextual", "targetId": <id> }`.
Responden `202 { "spawned": true, "pendingParent": <id|null>, "scope": <scope> }`.

| Método · ruta | Personaje | author del mensaje · type |
|---|---|---|
| `POST /api/chats/:id/investigar` | **Stevens** (auditar el código real) | `stevens` · `investigacion` |
| `POST /api/chats/:id/consejo` | **Mr. Miyagi** (opinión honesta) | `miyagi` · `consejo` |
| `POST /api/chats/:id/discutir` | **Romina / Ariel** (turno a turno) | `romina` \| `ariel` · `discusion` |

**`discutir` produce UN solo mensaje** (no dos) y lleva **dos campos extra en el body**:
`{ scope, targetId, "author": "romina"|"ariel", "stance": "defiende"|"rechaza" }`. La forja:
- lanza UN headless con ese `author` (vía `FORGE_AUTHOR`) y ese `stance` (al `discutirPrompt`);
- el mensaje cuelga del `targetId` (cadena) y **persiste `stance` en el propio mensaje** — el front
  lo lee para que el siguiente turno tome el lado contrario;
- responde `202 { spawned, pendingParent, scope }` como el resto.

Quién/qué lado los **elige el front** (Lane 2): si el rey no es de la pareja → ambos al azar; si el
rey ya es `romina`/`ariel` → el OTRO con el `stance` volteado. La pelea avanza un turno por cada
pulsación de Tie (nada automático). Lane 1 solo obedece el `author`/`stance` que recibe.

> El `steer` (susurro de Tie, opción C): si el body trae `"steer": "<texto>"`, la forja lo mete en
> el PROMPT del personaje (no lo publica como mensaje) y deja que el personaje decida si mencionarlo
> de pasada o no. Aplica a `discutir` y, si se quiere, a las demás acciones de Spike + `challenge`.

> Endpoints YA existentes (no tocar el contrato): `GET/POST /api/chats`, `GET /api/chats/:id`,
> `POST /api/chats/:id/{charla,responder,edit,challenge,anselmo,compactar,aube,title,autoname}`,
> `GET/POST /api/tareas`, `POST /api/chats/bootstrap`, `POST /api/cycle/new`.

---

## Contrato B — Módulo de prompts (lo crea Lane 3 · lo importa Lane 1)

`scripts/lib/forge-prompts.js` exporta **funciones PURAS** (string→string; NO leen disco, NO
importan el store). Lane 1 arma el texto del hilo y se lo pasa.

```js
export function charlaPrompt({ threadText })                          // Iris (migrar de forge.js)
export function williamChallengePrompt({ threadText, focoText })      // William (migrar; foco ya armado por Lane 1)
export function anselmoPrompt({ threadText })                         // Anselmo (migrar)
export function aubePrompt({ threadText })                            // Aubé (migrar)
export function stevensPrompt({ threadText, focoText })               // NUEVO — metódico, preciso, impoluto, silencioso; audita el estado REAL
export function miyagiPrompt({ threadText, focoText })                // NUEVO — abuelo que solo ofrece conocimiento, ve más allá del fuego pasajero
export function discutirPrompt({ threadText, focoText, stance })      // NUEVO — stance: 'defiende' | 'rechaza' (Romina/Ariel)
```
- `focoText` = el alcance ya resuelto por Lane 1 (mensaje/rama/conversación/objeto), como texto.
- Cada personaje escribe SOLO por la MCP `contestar`. Personalidades: ver `forge-backbone.md` §3.

## Contrato C — MCP (`scripts/forge-mcp.js`, Lane 3)
- Hoy existe `contestar(text)` y respeta `FORGE_AUTHOR/FORGE_MSG_TYPE/FORGE_INTENT/FORGE_REPLY_TO`
  y `FORGE_REPLACE_MSG_ID`. **Stevens/Miyagi/Romina/Ariel NO necesitan herramienta nueva**: usan
  `contestar` con su `FORGE_AUTHOR`/`type` (los fija Lane 1 al lanzar el headless).
- Si surge una acción que escriba distinto (p.ej. `partir` una tarea), Lane 3 añade la herramienta
  aquí y la fija en este documento antes de que Lane 1 la lance.

## Nombres nuevos (Lane 2 los mapea en el front; Lane 1/3 los emiten)
`stevens → Stevens` · `miyagi → Mr. Miyagi` · `romina → Romina` · `ariel → Ariel`.

---

## Puntos de encaje (responsabilidad de Iris al fusionar)
- `forge.js` importará los prompts desde `forge-prompts.js` (Lane 1 hace el swap; Lane 3 solo
  entrega el módulo con los exports de arriba).
- El front (Lane 2) pinta la miga de pan y el transporte contra `GET /api/cycle` + los 4 POST.
- Cualquier duda de contrato → Iris. No se cambia una firma sin actualizar este fichero.
