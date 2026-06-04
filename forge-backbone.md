# Forge — backbone del nuevo modelo de trabajo

> Documento vivo. Aquí describimos las features del **nuevo forge**: la interfaz y el modelo
> con el que Tie (CEO) y el equipo de Claudes trabajarán. Se irá refinando en conversación
> antes de implementar nada. **Estado global: IDEACIÓN — nada construido todavía.**

---

## 0. Por qué (la tesis)

El forge de hoy no es fiable, y la causa es **estructural, no de disciplina**: la puerta de
entrada es un Claude Code libre con todas las herramientas. Lo único que separa a ese Claude de
saltarse una nota o tomar una decisión que no le tocaba es su propia buena voluntad — y eso no
es fiable por diseño. Demasiadas veces el patrón ha sido *"ah, perdón, sí había una nota que
decía que no, y lo hice igual."*

La cura: **sacar la fiabilidad de la voluntad del modelo y meterla en la estructura.** Es el
mismo principio que ya rige el sprint ("el determinismo no vive en lo que hace cada Claude, sino
en el programa que lo encarrila"), pero extendido por fin a la **capa de conversación**, que era
la que se había quedado fuera.

Tres decisiones de fondo que materializan la tesis:

1. **CEO metido a fondo, no de paseo.** Tie deja de ser el CEO que habla con su CTO y se va. Se
   mete en cada tarea. El modelo es **horizontal** y **cada paso lo dispara Tie** — nada avanza
   solo por iniciativa de un Claude.
2. **Navegador, no Claude Code.** La interfaz deja de ser una terminal de Claude Code y pasa a
   ser una **app web**, al estilo claude.ai.
3. **Todos los Claudes headless y con herramientas recortadas.** Headless = sin sesión libre;
   cada rol solo tiene las funciones que su oficio necesita (el investigador no escribe, el
   resumidor solo resume, etc.). Las manos limitadas son el mecanismo de fiabilidad nº 1.

> "Algún día el modelo será suficientemente fiable para ser la entrada libre. Por ahora no lo es.
> Así que diseñamos en frío un modelo mucho más determinista." — Tie, 2026-06-03

---

## 1. La interfaz (layout de tres columnas)

Arranca pareciéndose a claude.ai y añade una columna:

- **Izquierda — lista de conversaciones.** Como en claude.ai. Cada conversación creada aparece
  aquí.
- **Centro — el chat.** El hilo activo.
- **Derecha — lista de TAREAS.** Lo nuevo. Las tareas que van naciendo de las conversaciones se
  anotan y viven aquí.

**Principio izquierda/derecha** (Tie, 2026-06-03): la lectura de fondo de las dos columnas
laterales es **izquierda = la conversación actual** (lo que se está hablando ahora) · **derecha =
lo que se va cerrando para el próximo paso** (la bandeja de salida: lo que queda fijado/cerrado y
pasa a la fase siguiente del ciclo). La derecha no es un cajón estático de tareas: es lo que el
paso actual deja **listo para entregar** al siguiente.
> A reconciliar con **F20** (que decía que en firme la izquierda muestra *personajes + sus
> preguntas*): ¿la izquierda es "la conversación actual" siempre, y los personajes/preguntas viven
> en otro sitio, o conviven? Cerrar con Tie.

---

## 2. Nomenclatura — el CICLO y sus fases (vocabulario canónico)

> Fijado con Tie, 2026-06-03. Esta es la palabra oficial; el código y la UI se alinean a ella.

- **La forja** — la **máquina determinista** que conduce todo (la que antes llamábamos
  *corazón*). No es un Claude: es código que lleva el orden, los contadores y los topes, y
  convoca a los personajes. Iris/Tie la conducen; ella no improvisa.
- **Ciclo** — la **totalidad** del proceso, de cero a producción. Es lo que arranca *"Nuevo
  ciclo"*. Un ciclo recorre estas **fases en orden**:

  | Fase | Qué es | Quién trabaja |
  |---|---|---|
  | **Spike** | Exploración desechable (el antiguo "sandbox", taller de usar y tirar) | (taller) |
  | **Grooming** | Planificación | 4 apóstoles, Anselmo (biblia), Ana Liz (diana), Lina |
  | **Sprint** | Construir | Miguel |
  | **QA** | Vigilar producción | Otto |
  | **Hot Fix** | Rama condicional: si QA falla, vuelta a construir | Miguel |

  El **release** (subir a producción) es la **fontanería determinista** que une *Sprint* con *QA*;
  no es una fase con personaje. **Hot Fix** no va en la línea recta: cuelga de *QA* solo cuando
  Otto falla, y devuelve a Miguel.

> ⚠️ **Choque de nombre a saldar:** "sprint" significaba antes el **proceso entero** (la máquina
> `scripts/sprint.js`, la carpeta `backbone/sprints/`, el "modo sprint" del forge). Ahora *Sprint*
> es **solo la fase de construir**. Consecuencia: **el "modo sprint" del forge se renombra** — esa
> palanca pasa a ser el mando de transporte del ciclo (ver F21), no un modo llamado "sprint".

---

## 3. Las etapas, ventana por ventana (LIENZO — borrador para afinar)

> Una ficha por etapa, con la plantilla de Tie. **Primer borrador de Iris (2026-06-03)**, para
> tener algo delante y pensarlo juntos — nada cerrado. Esto **resuelve los roles de las tres
> columnas**: la conversación viva pasa en el **centro** (con sus personajes y botones); la
> **izquierda** es lo que se ve de contexto (historias/personajes/estado); la **derecha** es lo
> que se está cerrando para entregar a la etapa siguiente.

### 🧪 SPIKE
**Objetivo:** explorar libre y barato. Tantear ideas en un taller desechable, antes de
comprometerse a nada.
- **Izquierda — qué se ve:** las conversaciones del taller (las "historias" abiertas de
  exploración), como hoy.
- **Centro — personajes y herramientas:** la **barra de acciones común** (F22) que actúa sobre el
  **mensaje/hilo/conversación seleccionado**. Acciones y quién las atiende:
  - **Charlar** — **Iris** (charla informal).
  - **Challenge** — **William** (abogado del diablo: rebate).
  - **Investigar / auditar** — mira el **estado REAL del código**, lo audita y es **honesto** sobre
    lo que de verdad hay. *Vibra:* **metódico, preciso, impoluto, silencioso** — el perfeccionista
    que no levanta la voz porque su trabajo habla por él; no se le escapa un detalle, sin una gota
    de violencia. *Nombre elegido POR AHORA:* **Stevens** *(el mayordomo de "Lo que queda del día")*.
    *(En el camino se descartaron por demasiado pop o demasiado atados a la violencia: Mulder, Sr.
    Lobo, Grissom, Schultz/Landa, Stannis…)*
  - **Consejo** — una **opinión honesta** sobre qué buscamos, de alguien que **no puede ofrecer
    nada más que conocimiento** y ve más allá del fuego pasajero. → **Mr. Miyagi** *(el jardinero
    que ve lo que tú no ves; paciencia, no fuerza)*. **ELEGIDO.**
  - **Discutir** — **ángel y demonio**: uno defiende tu idea, el otro la tira. La **pareja
    escandalosa** que vive del desacuerdo (les importa más estar en contra que el qué). → **Romina
    y Ariel** *(la pareja de la boda en "Relatos salvajes": locos, intensos, verdades como puños,
    se aman y arrasan con todo)*. **ELEGIDO.**
  - **Pedir / Crear tarea** — **Aubé** (la PM baja la idea a tarea).

  Todo **solo-lectura** sobre el código; cada personaje solo escribe por su MCP de oficio.
- **Derecha — qué vamos a construir:** las **tareas** que van cuajando de las charlas (las baja
  **Aubé**). Es lo que se cierra y se entrega a Grooming.

> Nombre pendiente: solo **Investigar** (candidato por ahora **Schultz**; en estudio Stannis /
> Bruto / arquetipo Robespierre). Consejo = **Mr. Miyagi**, Discutir = **Romina y Ariel**. El resto
> del elenco ya tenía nombre (Iris, William, Aubé, Anselmo, Ana Liz, Lina, Miguel, Otto, Tomás…).

### 📐 GROOMING
**Objetivo:** convertir lo explorado en un plan firme: documentar (la biblia) y poner la diana
(los tests) **antes** de construir.
- **Izquierda — qué se ve:** los **personajes** del grooming y sus **preguntas agrupadas por
  personaje** (apóstoles, Anselmo, Ana Liz, Lina). Abrir un personaje → su **historia** (resumen
  determinista, letra discreta).
- **Centro — personajes y herramientas:** la conversación viva — responder las preguntas que
  lanzan los personajes y afinar el plan. Personajes: **4 apóstoles** (libros), **Anselmo**
  (biblia), **Ana Liz** (diana), **Lina** (plan/partición).
- **Derecha — qué vamos a construir:** los **documentos** que cierran el grooming: los 4 libros →
  la **biblia** → la **diana** (+ el plan). Es lo que se entrega a Sprint.

### 🔨 SPRINT
**Objetivo:** construir lo planificado **apuntando a la diana**. Miguel pica, solo o con equipo
en paralelo.
- **Izquierda — qué se ve:** las **tareas en construcción** y su estado (en curso / listo /
  procesando); preguntas de Miguel si surgen.
- **Centro — personajes y herramientas:** el seguimiento de la obra. Personaje: **Miguel** (+ su
  equipo de programadores, cada uno en su worktree). Botones: Ejecuta · Dividir/Paralelizar
  (Aubé) · Estado. **Tomás** vela las casillas.
- **Derecha — qué vamos a construir:** el **código** que pasa la diana, listo para subir. Se
  entrega al release → QA.

### 🛰️ QA
**Objetivo:** tras subir a producción, verificar **desde fuera** que el entorno está vivo
(dominios, CORS, que la web carga y la SDK llega). NO toca base de datos.
- **Izquierda — qué se ve:** el estado del release y el resultado de **Otto** (verde/rojo); la
  bitácora de QA.
- **Centro — personajes y herramientas:** **Otto** — código determinista, **no es un Claude**: el
  re-test desde fuera contra producción. Es maquinaria, no charla.
- **Derecha — qué vamos a construir:** el **recibo de release verde** (cierra el ciclo) o, si Otto
  falla, la señal de **Hot Fix**.

### 🎯 OBJETIVO del ciclo — el FLAG forge | project (decisión de Tie, 2026-06-04)
Cada ciclo trabaja sobre **UNA** cosa: **el forge** (la máquina) **o** **Neblla** (el producto,
`project/`) — **NUNCA los dos a la vez**. Casi siempre será el producto; a veces el forge.
- **Lo saben TODOS los personajes** que tocan código: **Miguel** (construye), **Stevens**
  (audita), **Miyagi** (aconseja)… "necesitan saber de quién están hablando".
- Se **fija ANTES de arrancar el sprint** (propiedad del ciclo, no de cada tarea).
- *(VIVO 2026-06-04 — flag `target` en el estado del ciclo: `GET /api/cycle` lo devuelve,
  `POST /api/cycle/target` lo fija, se conserva al avanzar, por defecto **forge**. UI: chip 🎯 en
  la barra del ciclo, clic para alternar forge↔producto. Los prompts de **Stevens/Miyagi/Miguel**
  ya lo incluyen ("trabajas sobre …").)*

### 🔨 Ejecutar la tarea (F16) — VIVO 2026-06-04
Cuando una tarea está aterrizada, **Ejecutar** (botón en el bloque de la tarea) la lanza: **Miguel**
(el ÚNICO con manos de escribir — `Read/Write/Edit/Bash/Grep/Glob` — lo que a Tie le da
tranquilidad) la construye en un **git worktree aislado** del repo objetivo (según el flag, bajo
`.wt/`), **sin tocar el árbol vivo**, y reporta en el hilo de la tarea por `contestar`. En **Spike**
el worktree es **desechable**.
- *(VIVO: `POST /api/tareas/:id/ejecutar` crea el worktree (`git worktree add -b miguel/tarea-…`) y
  lanza a Miguel (`miguelPrompt`, cwd=worktree, herramientas de escritura, timeout 30 min). Probado
  el cableado/validación; el build real con `claude` es prueba en vivo de Tie.)*
**Traer el código (VIVO 2026-06-04):** botón **⬇ Traer el código** en la tarea (aparece una vez
ejecutada). `POST /api/tareas/:id/ejecutar` guarda el worktree en la tarea; `POST
/api/tareas/:id/traer` coge lo que Miguel dejó sin comitear (`git -C worktree diff`) y lo aplica al
árbol vivo con **merge a 3 vías** (`git apply --3way`) — resuelve el atasco de "bases distintas"
(Miguel construye sobre el último commit; el árbol vivo va por delante). Limpio si no se solapa;
**409 (conflictos)** si choca de verdad → a mano.
**Resumen en vivo de Miguel (VIVO 2026-06-04):** al Ejecutar, Miguel tiene UN mensaje vivo en el
hilo que se va reescribiendo (snapshot, no append) cada 10s con un resumen del **modelo más barato
(Haiku)** que lee su stream (`--output-format stream-json`); su informe final REEMPLAZA ese mismo
mensaje (`FORGE_REPLACE_MSG_ID`). Si Miguel (o cualquier headless) muere sin reportar, la forja
escribe un **aviso de fallo** en el hilo (el "pensando" ya no se queda colgado — bug de la noche
del 2026-06-04, causa real: corte de la API de Claude). Logs ricos (quién, duración, code, reportó).

**Traer el código (revisado 2026-06-04):** botón **⬇ Traer el código** cuelga del **informe de
Miguel** (no del bloque de definición): solo en mensajes de Miguel, **habilitado si hay algo que
traer** (`GET /api/tareas/:id/traible`), **gris** si no (ya traído / sin cambios), **nada** si no
es Miguel. Aplica con `git apply --3way`; si choca, **NO se rinde**: lanza un **Revisor** (Claude
con manos de escribir en el repo) que resuelve los marcadores y **SIEMPRE completa el merge**,
reportando en el hilo. La tarea se marca `brought` al traer.
**Worktree desde el ESTADO VIVO (RESUELTO 2026-06-04):** el worktree de Ejecutar ya NO parte del
último commit sino de una **foto del estado vivo** (`snapshotLiveCommit`: tracked + ficheros nuevos
sin trackear, vía índice temporal, sin tocar el repo real). Así Miguel construye sobre lo que Tie
VE, y al Traer su parche **aplica plano y limpio** (`git apply`; `--3way`→revisor solo de reserva).
Esto mata el atasco que tuvo la tarea 002 (Miguel reescribía `index.html` desde una base vieja
mientras la sesión lo reescribía sin comitear → imposible de mergear). El informe final de Miguel y
del Revisor son mensajes APARTE (append) — el resumen vivo (Haiku, 10s tras acabar el anterior)
nunca pisa el mensaje de cierre. Si un headless muere sin reportar, aviso en el hilo.
> **Pendientes**: (1) **limpieza** de los worktrees `.wt/` (se acumulan; hoy a mano con el forge
> parado); (2) `node_modules` no viaja al worktree (correr la app pediría `npm install`); (3) el
> Revisor edita el ÁRBOL VIVO con un Claude (riesgo aceptado, ya raro al aplicar plano).

### 🚑 HOT FIX  *(rama condicional, cuelga de QA)*
**Objetivo:** si QA falla en producción, volver a Miguel a arreglar — mini-pasada, sin auto-revert
ni reintento automático en prod.
- **Izquierda — qué se ve:** el fallo que reportó Otto y qué hay que arreglar.
- **Centro — personajes y herramientas:** **Miguel** otra vez (una pasada; **Tomás** con tope 1).
- **Derecha — qué vamos a construir:** el **arreglo**, que vuelve al release → QA.

> Huecos que veo para pensar juntos: (1) en **Spike**, ¿la derecha ya son "tareas" o algo más
> blando (ideas/candidatas)? (2) ¿la **izquierda** de cada etapa es siempre lista-de-algo, o en
> Spike sigue siendo conversaciones? (3) ¿el centro en **QA/Hot Fix** (pura máquina) necesita
> ventana de charla, o solo muestra el log?

---

## Features

### F1 — Arranque limpio del ciclo (Nuevo ciclo)
Un **ciclo** (= un sprint) empieza **vacío**. Empezar un ciclo nuevo:
1. **Exige el producto limpio** — si `project/` tiene algo por comitear, el ciclo **se niega** y
   lista lo pendiente (no arrancas un ciclo encima de trabajo a medio cerrar).
2. **Borra TODAS las conversaciones** (son efímeras, ya no van a git → ningún ruido que arrastrar).
3. **Auto-crea la conversación `backlog`** y lanza a **Iris** a abrirla con un **primer mensaje
   voluntario** (panorámica de los tres cubos, invitación a elegir un hilo). Es la **única vez**
   que se invoca la función "Discutir backlog": Iris abre, y a partir de ahí la charla sigue con
   los botones normales.

*(VIVO — `POST /api/cycle/new`: chequea el git del producto, barre `sprint/chats/`, siembra el
backlog y arranca la apertura de Iris por el MCP. Verificado: rechazo con producto sucio, y
camino feliz con producto limpio.)*

### F2 — Crear conversación y elegir su tipo
Lo primero que hace Tie es **crear una conversación nueva** y **elegir el tipo**. Tipos iniciales:
- **Discutir el backlog con Iris.**
- **Crear una tarea.**
- **Hacer una consulta.**

El tipo condiciona quién atiende y qué acciones están disponibles.

### F3 — Persistencia: una conversación = un fichero JSON
Cada conversación se guarda como `/sprint/chats/NNN.json` (`001`, `002`, …). El contenido es un
**array de objetos**, donde cada objeto (cada intervención) lleva:
- **tipo** de la intervención/consulta,
- **autor** — quién lo comentó (`Tie`, `Iris`, `William`, …),
- **intención** — `request` | `challenge` | `answer` (enum a cerrar),
- **responde-a** — a qué intervención contesta (referencia al padre).

La conversación se va guardando incrementalmente según se habla.

### F4 — Hilos recursivos estilo reddit (2 niveles)
Todo son **hilos** que cuelgan de la conversación raíz. El modelo es **más reddit que slack**:
recursivo (un comentario responde a otro), pero acotado a **dos niveles de profundidad**.

### F5 — Entrada por acción, no por "enviar"
Donde Tie escribe el texto **no hay un botón genérico de "enviar"**. En su lugar, **un botón por
cada tipo de acción**: p.ej. **preguntar**, **charlar**, **pedir**. El botón que pulsas declara
tu intención — eso es determinismo en la entrada (no hay un Claude adivinando si preguntas o
mandas).

### F6 — Headless con funciones muy limitadas
Cada Claude corre **headless** y con un set de herramientas recortado a su oficio. Ningún Claude
tiene la caja de herramientas completa. (Mecanismo de fiabilidad central.) — *Pendiente: definir
el set exacto de cada rol (ver §Roles).*

### F7 — Crear una tarea desde un hilo
Cuando la conversación llega a un punto, Tie puede **pedir una tarea**: se manda **todo el hilo +
su último texto**. **Aubé** (la PM) lo **baja a una tarea concreta** y la **anota en la columna
derecha**.

### F8 — La tarea es editable (por Tie y por los headless)
Tanto Tie como los Claudes pueden **actualizar la tarea** — de manera deliberada, no como efecto
colateral. La tarea es un objeto vivo en la columna derecha.

### F9 — Cada tarea tiene su propio hilo
Cada tarea abre y mantiene **su propio hilo de conversación**, separado de la conversación de la
que nació.

### F9b — Vista de una tarea (bloque fijo + charla + acciones)
Al **seleccionar una tarea**, el **centro** se reconfigura:
- arriba, un **bloque fijo** (anclado, no scrollea) con la **definición de la tarea** — siempre a
  la vista mientras se charla;
- debajo, el **hilo normal** de charla sobre esa tarea (F9).

El **texto de la definición** es de **Aubé** (la PM), y se cambia de dos maneras:
- **Edición directa** — Tie reescribe el bloque a mano;
- **Revisar** — Tie le pide a **Aubé** que reescriba/afine la definición a partir del hilo.

Desde dentro de una tarea, además de las acciones propias, está disponible **Crear tarea** para
abrir una tarea **nueva y no relacionada** (no cuelga de la actual): la columna de tareas es
plana, no un árbol.

### F10 — "Aterrizar" un prompt, y solo entonces "Aplicar"
- Botón **Aterrizar**: un headless **resume todo el hilo en forma de prompt** que serviría para
  cambiar la tarea.
- Tras aterrizar, podemos **seguir discutiendo** o decir **Aplicar**.
- **Solo los prompts aterrizados muestran el botón "Aplicar".** No se puede aplicar nada que no
  haya pasado por el aterrizaje (= candado contra cambios crudos sin resumir/revisar).

### F11 — Challenge con sabores
Botones de **challenge** que se diferencian por **a qué apuntan**:
- challenge a **lo que acabo de decir**,
- challenge a **este hilo**,
- challenge a **la tarea**,
- challenge a **toda la idea**.
> **SUPERADO por F22 (2026-06-03):** las "dianas" del challenge ya no son del challenge — son el
> **scope universal** (mensaje / hilo / conversación) que aplica a TODAS las acciones. Aquí queda
> como antecedente de esa idea.

### F12 — Consultar estado
Poder **preguntar por el estado** de algo: `listo` | `en curso` | `procesando`.

### F13 — Pedir una investigación
Poder **pedir una investigación** sobre cómo funciona una feature o algo del proyecto. La hace un
Claude investigador (solo-lectura) y devuelve la respuesta.

### F14 — Respuesta vía MCP
El Claude que investiga/consulta **devuelve su respuesta a través de un MCP** (no por un canal
libre). *Pendiente: precisar el papel exacto del MCP en el bucle navegador↔headless.*

### F15 — El ciclo arranca en Spike (la primera fase)
El **ciclo** (§2) **siempre empieza en Spike** (exploración / taller de usar y tirar). De ahí
avanza por las fases (Grooming → Sprint → QA). El recorrido lo **conduce Tie** con el mando de
transporte (F21), no se dispara solo.

**Reversible y repetible** (decisión de Tie, 2026-06-03): el ciclo **no** es de un solo sentido.
Tie puede **retroceder** en cualquier momento para parar y corregir el rumbo, y volver a avanzar
cuando quiera. Al re-entrar en una fase, **se repiten sus pasos desde cero** (no se reanuda a
medias).

> *(Antecedente VIVO, a renombrar: el viejo toggle de "modo sprint" —columna Tareas, abajo, +
> `POST /api/sprint/try`— pedía "¿Seguro?" y borraba todas las conversaciones al entrar en firme.
> Esa palanca se sustituye por el mando de transporte de F21; el borrado pasa a ser un efecto del
> cruce Spike→Grooming.)*

### F15.1 — Qué sobrevive al spike: revert al estado original (decisión de Tie, 2026-06-05)
El **Spike es código guarreto a propósito**: se pica sucio para **ver las funcionalidades en vivo**,
sacar ideas y **adelantarse a los errores** antes de comprometerse a nada. Ese código **no se
queda** — es del taller de usar y tirar.

Al cerrar el spike y pasar a firme, el árbol **se revierte al ESTADO ORIGINAL de antes del spike**:
el guarreto se tira entero. Pero **dos artefactos sobreviven** a la base limpia:
- los **tests** que diseñó **Ana Liz** (la diana), y
- la **biblia** que escribió **Anselmo** (lo aprendido, documentado).

Desde ese estado limpio —original + tests + biblia, sin una línea del guarreto— **Lina planifica** y
**empieza el Sprint**. Así el sprint construye *de cero pero con la diana ya puesta y el conocimiento
ya escrito*: la exploración valió, el desorden no contamina.

> **Mecánica de git (idea de Tie, a aterrizar — NO para ya):** trabajar el spike en una rama (p.ej.
> `forge`), y al cerrar hacer **cherry-pick de los tests (Ana Liz) y la biblia (Anselmo)** a una rama
> nueva limpia (p.ej. `sprint`), revirtiendo el resto. Posible refinamiento: que las ramas lleven el
> **nombre del estado actual del ciclo**. Pendiente de aterrizar en una conversación propia.

### F21 — Miga de pan del ciclo + mando de transporte (4 acciones)
En alguna parte visible se ve **todo el ciclo en una miga de pan** separada por ">", con la fase
actual **iluminada**:

    Spike  >  Grooming  >  Sprint  >  QA

(*Hot Fix* no va en la línea recta: cuelga de *QA* cuando salta.)

El antiguo botón que saltaba de un modo a otro se sustituye por un **mando de transporte** de
**4 acciones** sobre el ciclo:
- **Avanzar** → a la fase siguiente.
- **Retroceder** → a la fase anterior (corregir el rumbo).
- **Pausar** → detiene el trabajo de la fase actual.
- **Reanudar** → lo retoma.

> A confirmar con Tie: (1) ¿*Hot Fix* aparece también en la miga de pan (como rama colgando de QA)
> o solo cuando salta? (2) ¿Son **4 botones** distintos, o 3 controles donde *pausar/reanudar* es
> un único botón que alterna?

*(VIVO en el back — Lane 1, 2026-06-03: `scripts/lib/forge-firme.js` (motor puro: PHASES, cursor,
`advance`/`back`/`pause`/`resume`, `breadcrumb`, `publicState`, detección del cruce Spike→Grooming)
+ persistencia en `forge-store.js` (`sprint/cycle.json`) + endpoints en `forge.js`
(`GET /api/cycle`, `POST /api/cycle/{advance,back,pause,resume}`). Verificado por HTTP: transporte,
persistencia entre reinicios y borrado de conversaciones al cruzar Spike→Grooming. Falta el FRONT
(Lane 2) que pinte la miga de pan y mueva el transporte.)*

### F16 — Botón "Ejecuta"
En cualquier momento, cuando una tarea le parece a Tie **suficientemente aterrizada**, pulsa
**Ejecuta** y **un programador la construye**. Es Tie quien decide que ya está lista — el paso
no se dispara solo.

### F17 — Dividir una tarea (a mano)
Tie puede pedir **dividir la tarea** y **explicar en qué** quiere dividirla. El criterio de
corte lo pone Tie.

### F18 — Botón "Paralelizar" (división investigada)
Además del corte a mano, hay un botón **Paralelizar**: un Claude **investiga exactamente cómo
dividir la tarea en grupos paralelizables** (qué puede ir a la vez sin pisarse) y propone esa
partición. (Encaja con el equipo de programadores en paralelo, cada uno en su worktree.)

### F19 — Botón "Empezar sprint" (el salto de sandbox → firme)
Cuando todo está bien en sandbox, Tie pulsa **Empezar sprint** — un botón que **salta un
confirmar** ("¿Seguro?": de taller desechable a construir en firme). **No es de no-retorno**
(ver F15): Tie puede volver a sandbox a corregir, y cada re-entrada repite todo desde cero. Al
confirmar se dispara la **fase de documentación**:
- arrancan los **4 apóstoles** → generan los **4 libros**, que aparecen **a la izquierda**;
- **Anselmo** produce la **versión final** (la biblia) a partir de ellos;
- **preguntar no es solo de Anselmo** — los **4 apóstoles** y **Ana Liz** también pueden lanzar
  preguntas de vuelta hacia Tie vía el MCP (es una capacidad de varios personajes, no un paso
  único). Cada pregunta abre hilo de vuelta hacia Tie;
- si todo va bien, **Ana Liz genera los tests** (la diana)…
> *(El resto del recorrido en firme —Miguel construye apuntando a la diana, release, etc.— se
> detalla más adelante. "Ya llegaremos a eso." — Tie.)*

### F20 — La izquierda en firme: personajes, sus preguntas y su historia
En firme, la **columna izquierda** cambia de piel: donde en el taller había
**conversaciones** ("historias"), ahora muestra los **personajes** del recorrido (los 4
apóstoles, Anselmo, Ana Liz, Miguel…).
- Bajo cada personaje, sus **preguntas agrupadas por personaje** (las que ese personaje lanzó de
  vuelta hacia Tie). El reparto es por quién pregunta, no por orden de llegada.
- **Abrir la "historia" de un personaje** muestra un **resumen DETERMINISTA** (lo escribe la
  máquina, no un Claude) de lo que va pasando con ese personaje — su bitácora del recorrido —,
  en una **tipografía más discreta y contextual** (narración tenue, gris/pequeña; **no** burbujas
  de chat). Es el "qué está haciendo cada uno" de un vistazo.
> A confirmar con Tie: (1) "historias" = la columna izquierda (conversaciones) que en firme pasa a
> personajes; (2) "letra discreta" = estilo de texto sutil (gris/pequeño, tipo narración) frente
> a las burbujas normales.

### F22 — Modelo de interacción: selección + scope + barra común (2026-06-03)
Cambio de fondo en cómo se actúa sobre el chat. Sustituye la barra de acciones que hoy cuelga de
**cada** mensaje (F5).

- **Las herramientas viven en un sitio común** (una sola barra), **no** en cada mensaje.
- **Cualquier acción** (charlar, investigar, consejo, discutir, challenge, pedir…) se aplica sobre
  un **SCOPE**, que se elige en **un sitio común** (un selector), no es propio de cada acción:
  - **un mensaje** · **un hilo** · **toda la conversación**.
  Esto **generaliza F11** (el challenge tenía dianas) a TODAS las acciones: la diana deja de ser
  cosa del challenge y pasa a ser un scope universal.
- **El mensaje SELECCIONADO es el rey:** define toda la interacción (sobre qué se actúa con el
  scope elegido). Por eso **debe verse muy marcado** cuál está seleccionado (resaltado fuerte,
  inequívoco). Ver qué hay seleccionado es ahora lo más importante de la pantalla.

> Encaja con la tesis del doc: la intención (qué acción) y el alcance (qué scope) se declaran en la
> puerta, de forma explícita y determinista — ningún Claude adivina sobre qué actúa.
> Pendiente menor: ¿el scope por defecto al seleccionar un mensaje es "mensaje", y subes a hilo/
> conversación a mano? ¿"la tarea" es simplemente el scope "conversación" cuando estás en una tarea?

---

## Acciones (qué botón invoca a quién)

Cada acción de la interfaz dispara un **perfil headless** concreto (o, cuando se indica, **código
determinista** sin Claude). El reparto NO lo decide ningún Claude: lo decide el botón que Tie
pulsa. Esa es la fiabilidad — la intención se declara en la puerta.

| Acción (botón) | Qué hace | Perfil invocado | ¿Escribe algo? |
|---|---|---|---|
| **Charlar** | Charla informal sobre el hilo. *(VIVO)* | **Iris** | Solo su respuesta, vía `contestar` |
| **Discutir backlog** | Conversación de estrategia sobre el backlog | **Iris** | Solo su respuesta |
| **Preguntar / Consulta** | Pregunta puntual respondida con fundamento | **Investigador** | Solo su respuesta |
| **Investigar** | Estudio de cómo funciona una feature/parte del proyecto | **Investigador** | Solo su informe |
| **Pedir / Crear tarea** | Convierte el hilo en una tarea (columna derecha) | **Aubé** (la baja a tarea) | La tarea |
| **Revisar** (texto de la tarea) | Reescribe/afina la **definición** de la tarea desde el hilo | **Aubé** | La definición revisada |
| **Challenge** (4 dianas: lo dicho / el hilo / la tarea / toda la idea) | Pone a prueba una afirmación o el plan | **William** | Solo su challenge |
| **Aterrizar** | Resume el hilo en un *prompt* aplicable a la tarea | **Aubé** | El prompt aterrizado |
| **Dividir tarea** | Parte la tarea según el criterio de Tie | **Aubé** | La partición propuesta |
| **Paralelizar** | Investiga cómo dividir en grupos paralelizables | **Aubé** | La partición propuesta |
| **Ejecuta** | Construye la tarea (en sandbox = desechable) | **Miguel** | Código (en su worktree) |
| **Estado** | listo / en curso / procesando | *(código, sin Claude)* | — |
| **Empezar sprint** | Salto a firme (confirm) | *(código que dispara la cadena)* → **4 apóstoles** → **Anselmo** → **Ana Liz** | Libros, biblia, diana |

> Nota: las acciones de respuesta usan la familia de herramientas MCP de escritura acotada (hoy
> solo existe `contestar`; vendrán `anotar-tarea`, `proponer`, `aterrizar`…). Un perfil **nunca**
> escribe con `Write` libre: solo a través de la herramienta MCP de su oficio, a un destino fijo.

---

## Perfiles (personalidad relevante + herramientas)

Todos **headless**. La columna de herramientas es el contrato de fiabilidad: un perfil
*estructuralmente* no puede hacer lo que no está en su lista. Solo **uno** (Miguel) tiene manos de
escribir/ejecutar código, y solo dentro de su worktree.

- **Iris — la CTO, el puente.** *Personalidad:* traduce mecanismo→significado, cálida y directa,
  honesta sobre el estado real (no maquilla), calibra antes de ejecutar. Habla con Tie de tú a tú.
  *Herramientas:* `Read, Grep, Glob` (solo lectura) + MCP `contestar`. **Sin** Edit/Write/Bash.
  *(VIVO — su lectura se verificó en `npm run forge`.)*

- **Investigador — el que mira sin tocar.** *Personalidad:* literal y preciso, **no inventa**;
  si no lo ha leído, no lo afirma; cita lo que encontró y dice qué no pudo confirmar.
  *Herramientas:* `Read, Grep, Glob` (solo lectura) + MCP `contestar`. **Sin** escritura.

- **William — el abogado del diablo.** *Personalidad:* incrédulo por oficio (*¿seguro? ¿y si…?*),
  intenta tumbar antes de aprobar. Dos cubos: *bloqueante* (rompe algo real) rebota; *menor*
  (estética, "yo lo haría distinto") lo anota y NO bloquea. Una pasada, veredicto binario; **no
  mueve la portería** (se ciñe a lo escrito, no inventa requisitos). *Herramientas:* `Read, Grep,
  Glob` + MCP `proponer`/`challenge`. **No construye** — propone y rebate.

- **Aubé (Aubeline) — la PM.** *Personalidad:* baja las ideas a **tareas concretas** y, cuando
  hace falta, **parte una tarea en sub-tareas paralelizables**. A diferencia de un mero resumidor,
  **sí pone criterio de producto**: decide qué entra en la definición de la tarea y cómo se trocea.
  Es la **dueña del texto de la tarea** — Tie puede editarlo a mano, o pedirle a Aubé que lo
  reescriba (botón **Revisar**). *Herramientas:* recibe el hilo/tarea en el prompt + MCP
  `anotar-tarea` / `revisar` / `aterrizar` / `partir`. **Sin** escritura libre de ficheros.
  *(Absorbe lo que el doc llamaba **Escriba** y la **división/paralelización** que antes colgaba de
  Lina; Lina se queda con el plan de construcción.)*

- **Lina Bo Bardi — la arquitecta.** *Personalidad:* **estudia el código real**, nunca asume cómo
  funciona algo: lo abre y lo lee. Devuelve un **plan de construcción** claro; planea, no pica.
  (La **división en tareas paralelizables** ya no es suya: pasó a Aubé.)
  *Herramientas:* `Read, Grep, Glob` (lectura profunda) + MCP `plan`. **Sin** escritura de código.

- **Miguel — el constructor.** *Personalidad:* autonomía total para construir solo o lanzar un
  equipo en paralelo; redundancia bienvenida. *Herramientas:* `Read, Write, Edit, Bash, Grep,
  Glob` **dentro de su propio git worktree**. Es el ÚNICO perfil con manos de escribir/ejecutar;
  en modo sandbox lo que produce es **desechable**.

- **Ana Liz — la diana.** *Personalidad:* diseña y evalúa los tests que validan el plan; no
  implementa la feature. *Herramientas:* `Read, Grep, Glob` + escritura **acotada a los tests**.

- **Anselmo — el cronista.** *Personalidad:* aburrido a propósito, silencio total: mira, escribe,
  sale. Changelog, biblia (al Empezar sprint) y coherencia docs/código (avisa, no frena).
  *Herramientas:* `Read, Grep, Glob` + escritura **acotada a docs/changelog**. **No toca código.**

- **Los 4 apóstoles — los documentadores del sandbox.** *Personalidad:* cada uno levanta acta fiel
  de lo aprendido en el taller (su "libro"). *Herramientas:* `Read, Grep, Glob` + escritura
  **acotada a su libro**.

> Pendiente de cerrar: el set fino de las **herramientas MCP de escritura** (`anotar-tarea`,
> `proponer`, `aterrizar`, `plan`) — hoy solo existe `contestar`. Y si **Estado**/**Empezar
> sprint** son 100% código (la tesis dice que sí).

---

## Preguntas abiertas (para ir cerrando en conversación)
1. **Entrada = código puro.** ¿El reparto (qué rol atiende según el botón/tipo) lo hace una
   tubería determinista sin Claude en medio? (Tesis del doc: sí.)
2. **Challenge: ¿3 o 4 sabores?** (ver F11).
3. **Enum de tipos e intenciones**: cerrar la lista canónica de `tipo` y de `intención`.
4. **Papel del MCP** (F14): RESPUESTA PARCIAL — sí, el MCP es el canal por el que los headless
   **escriben de vuelta a la web y abren conversaciones** (p.ej. Anselmo lanzando preguntas en
   F19). Falta precisar el mecanismo exacto.
5. **Dónde vive `/sprint/`** dentro del forge y cómo se relaciona con la máquina de sprint actual
   (`scripts/sprint.js`) — ¿la reemplaza, la envuelve, convive?
6. **Sets de herramientas por rol** (§Roles).
7. **El segundo modo** (F15): RESUELTO — sandbox = taller desechable ("Ejecuta"/F16 construye
   pruebas de usar y tirar); el **segundo modo es "el sprint en firme"**, al que se entra con
   **Empezar sprint** (F19) y que arranca por la fase de docs (4 apóstoles → Anselmo → diana de
   Ana Liz → … build/release). Falta nombrar el segundo modo y detallar su tramo final.
