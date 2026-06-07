# `backbone/sprints/` — la pizarra viva del ciclo

Cada sprint es **un fichero** aquí. Es la **única pizarra viva** de planificación y
handoff: el plan, la diana de tests, las casillas (definition of done) y el log de
avance viven juntos en ese fichero, por orden, para que **sobreviva a caídas** —
cualquier rol (Lina, Miguel, Ana Liz, Tomás, Iris) puede retomar leyendo el fichero
y mirando la primera casilla sin marcar.

> **El recorrido lo conduce un programa: `scripts/sprint.js`** (el director del
> sprint). Iris no improvisa los pasos a mano: los dirige con un verbo + dos
> palancas (`next` para orientarse, `next --file <art> [--impose]` para avanzar,
> `retry` para rebobinar; `open` para nacer el sprint). El programa lleva el orden
> y los topes, convoca a los trabajadores y al challenger (Tomás / Ana Liz, headless)
> y **marca él las casillas**. El **estado-máquina** vive en un sidecar
> `<slug>.state.json` (contadores, punteros — la CLI nunca los muestra; modelo de
> promesa, editable a mano para arreglar un bucle roto). Este `.md` es la **pizarra
> humana**: prosa + casillas visibles + log. Contrato completo en `CLAUDE.md`
> (§"El director del sprint").

> Las superficies de planificación viejas están **congeladas** (`backbone/progress.md`,
> la carpeta `plans/`): histórico, no se tocan. El plan y el handoff de ahora en
> adelante viven en el sprint activo. `BACKLOG.md` sigue siendo la cola de estrategia;
> `CHANGELOG.md` sigue siendo de Anselmo.

## Nombre del fichero
`backbone/sprints/<slug-en-kebab>.md` — un slug corto y descriptivo del tema
(p.ej. `montar-la-maquina.md`). El sprint activo es el que tiene `status` distinto
de `done`.

## Frontmatter (YAML)
```yaml
---
sprint: <slug>                # igual que el nombre del fichero, sin .md
topic: <una línea, en cristiano>
status: planning              # planning | building | verifying | releasing | done
created: YYYY-MM-DD
---
```
`status` traza la fase del ciclo:
- **planning** — Lina/Iris cerrando el plan con el CEO.
- **building** — Miguel construyendo.
- **verifying** — Ana Liz (puerta de tests) + Tomás verificando casillas.
- **releasing** — listo para que Tie lance `npm run release` (gate → ship → Otto).
- **done** — todas las casillas marcadas y release confirmado.

## Secciones (en este orden)
1. `## Tema` — qué se construye y por qué, en una panorámica corta.
2. `## Plan de acción` — el plan acordado (resumen; quién lo cerró y cuándo). Los
   bloques de trabajo (A/B/C…) y las **decisiones CEO cerradas** van aquí.
3. `## Diana (tests)` — qué prueba que el sprint está hecho: la diana que Ana Liz
   diseña (puerta 1) y la batería persigue. Comportamiento observable, no
   implementación.
4. `## Casillas (DoD)` — la definition of done como checklist `- [ ]`. **Las marca el
   programa** (`scripts/sprint.js`) al aprobar cada etapa (la voz de Tomás llega vía
   el challenger headless que el programa convoca) — ningún humano las toca a mano. El
   programa solo voltea `- [ ]`→`- [x]` **dentro de esta sección, por orden** (tickea
   la primera sin marcar al aprobar), y appendea una línea al `## Log`; nunca reescribe
   la prosa. Formato: **una casilla por etapa**, en el orden del recorrido (plan, diana,
   build, release, cierre). Editarlas a mano solo para arreglar un estado roto.
5. `## Estado / handoff` — el puntero de reanudación tras una caída: paso actual,
   por qué casilla retomar, qué no olvidar. (Redundante con el `.state.json`, que es la
   fuente para el programa; esta sección es la lectura humana.)
6. `## Log` — bitácora append-only, una línea fechada por avance. Cualquier rol
   añade aquí; **el programa añade una línea al aprobar/marcar cada casilla.**

## Reglas del ciclo (resumen; el contrato completo está en `CLAUDE.md`)
- **Iris** conduce el sprint vía `scripts/sprint.js` (un verbo + dos palancas) y
  aporta contenido + juicio; no toca contadores ni orden, no habla con Tomás/Ana Liz
  (los convoca el programa). El `.md` es la pizarra que se pasan; el `.state.json`
  es la cinta de la máquina.
- **El programa marca las casillas** al aprobar cada etapa: el trabajador entrega el
  artefacto, Iris lo envía con `next --file <art>`, el programa convoca al challenger
  headless; si no la tumba, tickea y appendea al Log; si la tumba, la devuelve (al 3.er
  bloqueo aprueba solo). Las palancas de Iris: `--impose` (tras un intento normal; nunca
  sobre coherencia) y `retry` (rebobinar un paso).
- **Headless en el release** (en `scripts/release-and-test.js`, sin humano): Anselmo
  (changelog + coherencia docs/código no-bloqueante + barrido de los sprints `done`),
  Miguel-fix (bucle de arreglo del gate, tope 5), Otto (re-test desde fuera en prod;
  si falla, escribe `.hotfix-needed.json` y sale en rojo — Iris abre un hotfix, sin
  auto-revert). El recibo de release verde lo escribe `release-and-test.js` **dentro
  del propio `.md` del sprint** (`## Recibo de release`). Los trabajadores/challenger
  del sprint (Lina, Miguel-build, Ana Liz, Tomás) los convoca `scripts/sprint.js`,
  también headless.
- El release lo lanza **siempre Tie** desde su terminal (el programa marca `releasing`
  y se lo pide; nunca lo lanza). Construir deja la batería local verde; publicar es
  decisión del CEO. El cierre del sprint requiere el recibo de release verde **dentro
  del propio `.md` del sprint** (sección `## Recibo de release`, build sellado; release
  verde + Otto OK). Si Otto falla en prod, se abre un **hotfix** (`open --hotfix`, Tomás
  una pasada) en vez de iterar el sprint cerrado.
