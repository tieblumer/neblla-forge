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
su último texto**. Un headless con la función de **resumir** convierte eso en una tarea y la
**anota en la columna derecha**.

### F8 — La tarea es editable (por Tie y por los headless)
Tanto Tie como los Claudes pueden **actualizar la tarea** — de manera deliberada, no como efecto
colateral. La tarea es un objeto vivo en la columna derecha.

### F9 — Cada tarea tiene su propio hilo
Cada tarea abre y mantiene **su propio hilo de conversación**, separado de la conversación de la
que nació.

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
> ⚠️ A confirmar: Tie dijo "tres sabores" pero enumeró cuatro dianas. ¿Son cuatro, o dos de ellas
> se funden?

### F12 — Consultar estado
Poder **preguntar por el estado** de algo: `listo` | `en curso` | `procesando`.

### F13 — Pedir una investigación
Poder **pedir una investigación** sobre cómo funciona una feature o algo del proyecto. La hace un
Claude investigador (solo-lectura) y devuelve la respuesta.

### F14 — Respuesta vía MCP
El Claude que investiga/consulta **devuelve su respuesta a través de un MCP** (no por un canal
libre). *Pendiente: precisar el papel exacto del MCP en el bucle navegador↔headless.*

### F15 — Dos modos del sprint; arranca siempre en sandbox
El sprint tiene **dos modos** y **siempre empieza en modo sandbox** (exploración / taller de
usar y tirar). El segundo modo es el de ejecución real. La transición la dispara Tie.
> A cerrar: cómo se llama el segundo modo y qué implica (¿pasa por la máquina de sprint
> completa — plan/diana/build/release? ¿la ejecución en sandbox es desechable y la del segundo
> modo es la que se queda?).

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
confirmar** (es el cruce de no-retorno: de taller desechable a construir en firme). Al confirmar
se dispara la **fase de documentación**:
- arrancan los **4 apóstoles** → generan los **4 libros**, que aparecen **a la izquierda**;
- **Anselmo** produce la **versión final** (la biblia) a partir de ellos;
- si Anselmo **detecta algo**, puede **lanzar preguntas vía el MCP** → eso **genera
  conversaciones** (el headless abre hilo de vuelta hacia Tie);
- si todo va bien, **Ana Liz genera los tests** (la diana)…
> *(El resto del recorrido en firme —Miguel construye apuntando a la diana, release, etc.— se
> detalla más adelante. "Ya llegaremos a eso." — Tie.)*

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
| **Pedir / Crear tarea** | Convierte el hilo en una tarea (columna derecha) | **Escriba** (anota) → **William** (rebate/propone) | La tarea + su challenge |
| **Challenge** (4 dianas: lo dicho / el hilo / la tarea / toda la idea) | Pone a prueba una afirmación o el plan | **William** | Solo su challenge |
| **Aterrizar** | Resume el hilo en un *prompt* aplicable a la tarea | **Escriba** | El prompt aterrizado |
| **Dividir tarea** | Parte la tarea según el criterio de Tie | **Lina** | La partición propuesta |
| **Paralelizar** | Investiga cómo dividir en grupos paralelizables | **Lina** | La partición propuesta |
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

- **Escriba — el de la palabra exacta.** *Personalidad:* silencioso y mecánico a propósito; no
  opina, **destila fielmente**. Convierte un hilo en tarea y aterriza prompts sin añadir criterio.
  *Herramientas:* recibe el hilo en el prompt + MCP `anotar-tarea`/`aterrizar`. **Sin** acceso
  libre a ficheros. *(Es el "resumidor/anotador"; emparentado con Anselmo, el cronista.)*

- **Lina Bo Bardi — la arquitecta.** *Personalidad:* **estudia el código real**, nunca asume cómo
  funciona algo: lo abre y lo lee. Devuelve un plan claro o una partición limpia; planea, no pica.
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
