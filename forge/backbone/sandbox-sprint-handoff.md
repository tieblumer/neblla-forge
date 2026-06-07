# Handoff — Construir la "máquina de sandbox" de sprints

> Brief para una sesión de **effort alto** (Opus, panel de agentes). Diseñado con Tie el 2026-06-02 tras una charla larga. Build 31 ya está en producción (Otto verde) antes de empezar esto. Lee también la memoria `project_sandbox_sprint_model.md`.

> **Primer movimiento:** abre el sprint con `node scripts/sprint.js open` (tema = construir este sistema). Que **Lina arranque leyendo `scripts/sprint.js` + `scripts/release-and-test.js`** a fondo para entender la máquina vieja ANTES de tocar nada — este sistema se monta encima de ella y reusa sus patrones (`claude -p`, gate, recibo). Lo PRIMERO que hay que cerrar en el plan es la **pregunta abierta #1 (formato de la nota)**: todo lo demás depende de eso.

---

## 0. Por qué existe esto (el problema real)

Dos problemas que se resuelven con el mismo diseño:
- **Iris** no sabía distinguir un cambio de 5 minutos de un sprint de verdad → fricción constante para decidir cuándo abrir la máquina.
- **Tie** no pide todo al principio: trastea, ve cómo queda, pide más cositas. El modelo plan-first (diana antes de construir) choca de frente con eso.

El **detonante** fue el rediseño del wizard: estaban "dando palos de ciego", iterando en vivo sin un plan cerrado. Eso ES la forma natural de trabajar de Tie y no hay que combatirla — hay que **darle una fase donde trastear sin miedo** y luego reconstruir limpio.

## 1. El principio: invertir el orden

Hoy el sprint es `plan → diana → build`. Lo invertimos: **primero se explora y se descubre, luego se documenta lo descubierto, y solo entonces se construye limpio**. El sprint pasa a ser **UNA unidad con dos mitades**:

1. **Sandbox** (explorar) — código de **usar y tirar**. Aquí te equivocas, parcheas encima, vas a callejones sin salida. Da igual, porque ese código **se borra entero al final**. Lo único que sobrevive son los **aprendizajes**, no las líneas. Esto es lo que quita el miedo: nada de lo que ensucies se queda.
2. **Implementación** (reconstruir limpio) — la máquina actual `scripts/sprint.js`, alimentada por lo que salió del sandbox.

Ritmo manga de Tie: capítulo largo de charla/trasteo, y al final ¡PAM!, la reconstrucción pulida de un golpe.

**Clave conceptual — "semántico, no gramatical":** lo que se documenta del sandbox es el **QUÉ se construyó a nivel de significado/comportamiento**, NO el cómo se escribió (el diff literal). Se guarda *qué descubrí*, no *cómo lo tecleé*.

## 2. Cómo se construye ESTO

Con la **máquina vieja** (`scripts/sprint.js`, modelo `plan→diana→build→release→cierre`). Abrir un sprint normal cuyo **tema es construir este sistema**. Es el motor central del proceso → **effort máximo justificado**: Lina estudiando el código real a fondo, equipo de Miguel en paralelo, Tomás especialmente duro. (Calibración: panel grande solo para el motor central, que es justo esto.)

---

## 3. La fase sandbox — diseño completo

### Las notas
- Iris charla con Tie y **solo escribe notas pequeñas en `/sandbox`**. **Iris NUNCA toca código.**
- Una nota = lo que Tie pide / lo que se descubre. **Formato de la nota = PREGUNTA ABIERTA (ver §8)** — hay que diseñar qué lleva dentro para que Aubé sepa agruparla por tema y William sepa comentarla.
- Estados de una nota: `libre → en proceso ("estoy en ello") → finalizada → revisión / atención`.
- Regla de Tie: si una nota ya está `en proceso`, **Iris no la puede tocar** — si quiere añadir algo, **crea otra nota**.

### El corazón (daemon determinista)
- Es **un programa que lanza Tie** al arrancar la sesión (igual que `npm run release`). **Iris NUNCA lo lanza** — desde su aislamiento el claude anidado no conecta, y es el patrón ya establecido.
- Si no hay notas, **sigue latiendo pero no genera nada**.
- **REFINAMIENTO CLAVE: un solo reloj con tres manecillas, NO tres relojes independientes.** Tie lo describió como "tres corazones"; la versión a prueba de balas es **un único latido** que en cada tic hace los tres trabajos **en orden fijo**. Razón: si tres bucles laten por su cuenta, en algún tic uno lee el tablón mientras otro lo está cambiando → corrupción. Con un solo reloj nunca hay dos manos tocando el tablón a la vez. **Ese es el determinismo que Tie pide.**
- **El corazón es el portero único:** solo él mueve los estados *oficiales* de las notas. Todos los demás (Iris, William, programadores) **proponen** creando/anotando, pero el cambio de estado oficial lo hace el corazón. (Versión robusta de la regla "si está en ello, no la tocas, creas otra".)

Los tres trabajos por tic, en orden:

**Manecilla 1 — Aubéline (Aubé), la PM.**
- Mira TODAS las notas y las **organiza por temática** para que no se pisen, **teniendo en cuenta las que ya están en curso**, y las **prioriza**.
- Si una nota es de un **tema nuevo** → asigna un **programador nuevo**; si es de un tema ya en curso → al programador **ya existente** de ese tema.
- Escribe **números en las notas que NUNCA bajan**, para que cada programador sepa cuál es su siguiente nota (= la de menor número entre las suyas).
- Si el programador es nuevo, **Aubé lo crea en el pool de libres**.

**Manecilla 2 — Reparto.**
- Recorre el **pool de programadores disponibles (libres)**; para cada uno coge la nota asociada a él de **menor número**.
- Si **no hay** nota para él → se **borra del pool**.
- Si **la hay** → el programador pasa al **pool de ocupados** y se pone con ella.
- Cada programador, al terminar, **avisa y vuelve al pool de libres**. Es un proceso automático: **el que lo lanzó detecta cuándo terminó** (con `claude -p`, el fin del proceso es la señal).

**Manecilla 3 — William, el senior.**
- Experto senior que **respeta el trabajo ajeno** y es **elegante: no genera ruido innecesario**.
- Despierta, **elige una nota al azar**, hace **UNA observación** (una mejora o un problema que vea)… **o no comenta nada** si no tiene nada inteligente que aportar.
- Si la nota **no está siendo trabajada** → el apunte se queda ahí para quien la coja.
- Si la nota **ya está finalizada** → su estado pasa a `revisión`.
- Si está **en proceso** → estado a `atención`; y **antes de que el programador la dé por finalizada, tiene que mirar si hay notas nuevas de William** (lo sabe porque el estado pasó a `atención`).

### Las dependencias entre notas (reglas exactas de Tie — pasos 5–7)
- Si una nota nueva **no se relaciona** con ninguna en curso → programador nuevo, **en paralelo**. Se abre un claude con ese nombre que ejecuta **las notas con su nombre, de una en una**.
- Si **no se puede paralelizar** porque otra nota relevante tiene que terminarse antes (para no pisarse) → se **apunta el nombre del programador** del que depende, para que se sepa la dependencia.
- **Edge case (paso 7):** si Juan programa la feature A y Petra la B, y aparece una C que **depende de ambas** → se apunta `responsable: Juan, Petra`. **El primero que termina borra su nombre** de la lista. Cuando **queda un solo nombre**, ese la coge como suya.

### Aislamiento — un worktree por programador
- **Cada programador trabaja en su propio git worktree** (copia real del taller en disco, `.git` compartido; `node_modules` NO se duplica — symlink o install compartido).
- **Es determinista y GRATIS** (es fontanería de git, no un agente que gasta tokens). El camino feliz (≈99%) es 100% determinista y gratis: crear copia y **fundir trabajos que no se solapan** lo hace git solo, siempre igual.
- El **único** punto no determinista es un **solape REAL línea-a-línea** del mismo fichero → ahí git no decide solo y hace falta un agente. Pero es **raro** (Aubé reparte por temas) y, sobre todo, **git lo detecta — nunca se cuela en silencio**.
- Por qué importa de verdad: sin aislamiento, dos procesos (`claude -p`) que graban el mismo fichero a la vez se **machacan en silencio**, sin marca ni error. El worktree convierte "fallo invisible y catastrófico" en "fallo visible y rarísimo". El reparto por temas reduce el choque; el worktree lo elimina.
- **El paralelismo vive AQUÍ, a nivel de programador, NO a nivel de sprint.** Sigue habiendo **UN solo sprint a la vez** (los sprints se cierran antes de abrir otro — paso 1). Razón: dos sprints a la vez meterían dos implementaciones finales de código que SÍ se queda sobre el mismo `master`, justo en el peor sitio (el release solo publica un master coherente), y Tie trabaja un hilo a la vez.

---

## 4. Fin del sandbox → la máquina de documentación

Cuando **Tie+Iris dicen "basta"** ("ya tenemos suficiente"):
1. **Drenar** las notas en curso (dejar que quien esté a media nota la termine).
2. **Iris apaga el corazón** y **enciende la máquina de documentación**.
3. **4 apóstoles** en paralelo, **ciegos entre sí** (ninguno sabe de la existencia de los otros): analizan **las notas + el código** y comentan lo que ven.
4. Cuando los 4 terminan → se lanza **Anselmo**, que lo **unifica en "la biblia"** (estira su rol de cronista; misma rima: apóstoles → evangelio → biblia).
5. Cuando Anselmo termina → se lanza **Ana Liz**, que escribe los **tests (la diana)** leyendo la biblia. Son **tests de INTENCIÓN**: sabemos qué debe hacer cada feature, nos da igual el cómo.
6. **Todo lo que no sean los tests + la biblia DESAPARECE** (el código sucio del sandbox se tira entero).

**Por qué la documentación es el único puente:** Miguel no verá NUNCA el código sucio (está hecho un asco). Solo cruza el puente la biblia (el qué + los tips descubiertos por el camino). Esto **obliga a que la documentación sea perfecta**: si el escribano se deja un truco fino sin apuntar, Miguel no puede reconstruirlo. Y los **tests de Ana Liz son la auditoría de que el puente fue fiel**: si la biblia estaba completa, pasan; si se dejó algo, salta en rojo. La implementación de Miguel es, de hecho, **una refactorización a ciegas**: "el producto se comporta así (biblia), con estos cuidados; escríbelo limpio".

---

## 5. El sprint lanzado (máquina actual, con UN cambio)

- Se lanza el sprint con `scripts/sprint.js`, pero **alimentado por la biblia + los tests**.
- **Lina + Iris replanifican** lo que dejó documentado Anselmo, con los **tests de Ana Liz delante** → **Tomás valida el plan** (como ahora) → **Miguel construye LIMPIO** (refactor a ciegas) → **release** → **cierre**.
- **CAMBIO EN LA MÁQUINA DE ESTADOS:** desaparece el paso `diana` del sprint, porque la diana **ya nació en la fase de documentación**. Nuevo recorrido del sprint: **replan → (Tomás) → build → release → cierre**. Dicho por Tie: *"Ana Liz sale del sprint y se va al sandbox."*

---

## 6. Roster de roles (nuevos / cambiados)

- **Aubéline (Aubé)** — NUEVA. PM del sandbox: organiza, prioriza, numera, lleva los pools, asigna/crea programadores.
- **William** — NUEVO. Revisor senior que ronda; una observación o silencio; nunca ruido.
- **4 apóstoles** — NUEVOS. Documentadores paralelos, ciegos entre sí.
- **Anselmo** — ESTIRADO. Además del changelog (su rol en el release), unifica a los apóstoles en la biblia.
- **Ana Liz** — MOVIDA. Sus tests pasan al final del sandbox; ya no es un paso del sprint.
- **Miguel** — ACOTADO. Solo constructor (el reparto que antes le cargábamos pasó a Aubé). Aparece únicamente en el sprint de implementación, refactorizando a ciegas.
- **Lina + Iris** — replanifican desde la biblia. **Iris dirige, no pica código.**
- **Tomás** — valida el plan, como ahora.
- **Determinismo:** la orquestación (corazón, pools, números, estados, worktrees) es determinista; **los agentes obviamente no**.

---

## 7. Constraints duras

- **Alpha, sin usuarios reales** → refactor libre, sin shims de retrocompatibilidad.
- **Iris NUNCA lanza `npm run release` ni el corazón** — los lanza Tie desde su terminal.
- El release ya hace **`git add -A`** (sube también lo sin trackear) y es **gate-first**: prueba en local antes de publicar, auto-arregla hasta 5 veces, **nunca publica en rojo**.
- Los agentes headless se convocan con **`claude -p` (tokens de suscripción, NUNCA API key)** — patrón ya usado por `sprint.js` y Perotti.

---

## 8. PREGUNTAS ABIERTAS (a resolver en la sesión nueva)

1. **Formato de la nota** — lo dejamos sin cerrar y es de lo que depende todo lo demás. ¿Qué lleva una nota por dentro para que Aubé la agrupe por tema y William la comente sin ver la cara de Tie? (frontmatter: id, tema, estado, número, responsable(s), dependencias, observaciones de William…).
   - **→ RESUELTO PARCIAL (2026-06-02, Tie):** quien AUTORA la nota es **Iris**, no Tie. Tie le cuenta a Iris en la charla; **Iris deja la tarjeta y rellena el campo `tema` ella misma** (tiene el contexto de la conversación), y solo pregunta a Tie el tema si duda de verdad. Conserva la regla de inmutabilidad: si una nota ya está `en proceso`, Iris no la toca → crea otra. La mecánica del frontmatter restante (id, estado, número, responsable(s), dependencias, observaciones de William, cuerpo) es **fontanería de Iris+Lina** (no necesita a Tie); se cierra al montar el plan.
2. **Detección de "tema"** por Aubé — ¿semántica vía agente, etiquetas manuales, o mixto?
   - **→ RESUELTO (2026-06-02, Tie):** ni agente ni mixto — **el `tema` lo escribe Iris al autorar la nota**. Aubé **reparte por el `tema` ya escrito** (string), sin adivinar. Se elimina el detector semántico del camino caliente → más determinista. La categorización la hace la persona con contexto (Iris), no un claude leyendo una nota seca.
3. **Mecánica del worktree en Windows** — cómo compartir `node_modules` (symlink vs install por worktree), dónde viven los worktrees, quién y cuándo funde de vuelta al tronco del sandbox.
4. **El corazón como proceso** — daemon nuevo de larga vida (vs `sprint.js` que es one-shot). ¿Reutiliza piezas de `release-and-test.js`/`sprint.js`? ¿Dónde vive `/sandbox`, las notas como ficheros con frontmatter?
5. **Disparador de la máquina de documentación** — cómo "Iris apaga el corazón y enciende la documentación" de forma determinista.
6. **Encaje con `sprint.js`** — el cambio de la máquina de estados (quitar `diana`) toca `scripts/sprint.js` y su suite `tests/22-sprint-orchestrator.test.js`.

---

## 9. Pendiente para Tie DESPUÉS de esto

- Retomar el **wizard** (estaba bien pero a medio polish; fue el detonante de todo esto).
- El **bug de CORS / 403 al reconectar** (`origenes-neblla-automaticos`, aparcado como stub, es parte de algo mayor que Tie quiere atacar aparte).

---

## 10. Plan-draft de Lina (2026-06-02) — máquina vieja mapeada + 6 preguntas resueltas

> Salida del workflow `entender-maquina-vieja-sandbox` (5 lectores paralelos + síntesis de Lina). #3/#4/#6 quedan **confirmados/mecánicos**; #1/#2 ya los cerró Tie (§8); **#5 deja UNA sub-pregunta de producto para Tie** (¿quién lanza `docs.js`?).

### Mapa de la máquina vieja (lo esencial)
- **Dos programas, un contrato por fichero.** `scripts/sprint.js` (DIRECTOR one-shot, lo conduce Iris) + `scripts/release-and-test.js` (RELEASE, lo lanza SOLO Tie). No se llaman entre sí: se comunican por ficheros en `backbone/sprints/`. Contrato: sprint.js marca el `.md` a `status: releasing` y sella el build esperado; release-and-test.js, tras Otto verde, estampa `## Recibo de release` en ESE `.md`; el paso `cierre` lo lee y cierra fail-closed si el build no casa.
- **sprint.js:** `STEPS=['plan','diana','build','release','cierre']` (L99); `approveAndAdvance` indexa por STEPS (cambiar el array reordena la máquina sola). Dos ficheros/sprint: `.md` (pizarra) + `.state.json` (contadores attempts/blocks/imposed SOLO aquí, la CLI nunca los imprime; hand-editable). Crash-recovery reconstruye degradado desde el `.md` (asume 1 casilla por paso).
- **Convocatoria headless (el patrón que el corazón reusa TAL CUAL):** `spawnSync('claude',['-p',prompt,'--allowedTools',allowed],{cwd,stdio:'inherit',timeout:10min})` — array de args, **sin shell:true** (win32 destrozaría `<`,`|`), sin env de auth (suscripción), sin `--model`. Resultado SIEMPRE por fichero (`.verdict.json`), nunca por stdout. Mock por env (`NEBLLA_SPRINT_MOCK_VERDICT/GATE`). Para el POOL paralelo: variante ASÍNCRONA de `scripts/mesa.js` (spawn + `on('exit')` como señal de fin + watchdog SIGKILL + flag `settled` idempotente); spawnSync bloquearía el reloj.
- **release-and-test.js:** gate-first (batería entera hasta verde, Miguel-fix tope 5, nunca publica en rojo) → ship (`git add -A`, commit, push) → waitForDeploy → Otto (remoteSafe, `NEBLLA_TEST_BASE_URL`) → recibo o `.hotfix-needed.json`. Anselmo: changelog + coherencia no-bloqueante + barrido de `done` (solo si git-tracked+clean).
- **tests/run.js:** filtro por substring; cleanup anclado al prefijo `__nebllatest` (nunca toca `misc.appCounter`); **una sola batería a la vez** (local+prod comparten Mongo+Turso). tests/22 conduce sprint.js con mocks (needsServer=false).

### #1 — Formato de nota (fontanería; el producto ya lo cerró Tie en §8)
Cada nota = `.md` en `backbone/sandbox/notas/<id>.md`, frontmatter parseable por el `parseFrontmatter` de sprint.js:
```
---
id: n-0007          # estable, lo asigna Iris (n- + ordinal monótono)
tema: wizard-paso2  # STRING (slug) que escribe IRIS; Aubé reparte por este literal
estado: libre       # libre|en-proceso|finalizada|revision|atencion — SOLO el corazón lo muta
numero: 0           # 0 hasta que Aubé numera; nunca baja; el prog coge el menor suyo
responsable: ''     # programador(es) CSV (paso-7: 'juan,petra'); lo escribe Aubé
dependencias: ''    # ids/nombres que deben terminar antes; lo escribe Aubé
william: ''         # ref de la última observación de William a leer antes de finalizar
creada: 2026-06-02
---
## Pide                       <- lo escribe Iris (prosa)
## Observaciones de William   <- append-only, 1 línea o nada
## Bitácora                   <- append-only del programador: aprendizajes/tips (ESTO sobrevive al borrado del código)
```
Sidecar global del corazón: `backbone/sandbox/.heart.json` (pools libres/ocupados + ordinal monótono). Crash → pools se reconstruyen desde los frontmatter de las notas.

### #2 — Tema (RESUELTO): Aubé reparte por igualdad EXACTA del string `tema` que Iris escribió; sin detector semántico en el camino caliente. Normalizar `tema` a slug al escribirlo (evita que 'Wizard Paso2' ≠ 'wizard-paso2' creen dos programadores).

### #3 — Worktree en Windows (CONFIRMADO en esta máquina: git 2.38.1, PowerShell sin admin)
- DÓNDE: **`.wt/<programador>` DENTRO del repo** (gitignored), una por programador; desechables. (Antes se planeó fuera en `C:\nbla-wt`; movido dentro por decisión de Tie — ver §14. Probado: no ensucia `git status`.)
- node_modules: **junction `/J`** al node_modules del repo principal (0 disco, instantáneo, sin admin; `require.resolve` verificado). NUNCA symlink (falla sin admin) ni copia (168 MB × N). Nadie hace `npm install` en un worktree.
- FUNDE: **solo el corazón, serializado** (index.lock global compartido; dos commits simultáneos chocan), uno a uno en su tic. Camino feliz (temas disjuntos) = merge limpio gratis; único no-determinista = solape línea-a-línea del mismo fichero → git lo DETECTA (nunca silencioso) → escalar a agente resolver.
- `git config --global core.longpaths true`. Limpieza SIEMPRE: `git worktree remove --force` + `git branch -D` + rmdir de la junction (nunca borrar la carpeta a mano → worktree fantasma).

### #4 — El corazón = `scripts/heart.js` (daemon, lo lanza Tie `npm run heart`, NUNCA Iris)
- UN solo `setInterval` (tic 10-20s) con **re-entrancy guard** (`ticking`); el siguiente tic no arranca hasta cerrar el anterior → nunca dos manos en el tablón.
- Por tic, orden fijo: **Aubé → Reparto → William** (Aubé y William = `claude -p` SÍNCRONO dentro del tic; los PROGRAMADORES = spawn **asíncrono** estilo mesa.js, corren entre tics en sus worktrees, fin de proceso = señal).
- Vive en `backbone/sandbox/`. El corazón es el **portero único** de `estado:`; los demás proponen escribiendo.

### #5 — Disparador de docs (señal-fichero, como `.hotfix-needed.json`)
- "Basta" → Iris escribe `backbone/sandbox/.drain-requested`. El corazón deja de asignar notas nuevas pero **sigue latiendo hasta drenar** (los ocupados terminan). Pool vacío → escribe `.sandbox-drained` y se para.
- La docs = SEGUNDO programa `scripts/docs.js`, arranca SOLO si existe `.sandbox-drained` (fail-closed). Orden: 4 apóstoles paralelos ciegos → Anselmo (biblia) → Ana Liz (diana). Al final borra todo menos biblia+tests (+ worktrees) y deja señal de handoff a sprint.js.
- **⚠ PREGUNTA ABIERTA PARA TIE:** ¿`docs.js` lo lanza Tie explícitamente (como el release) o el corazón lo encadena al drenar? Lina recomienda **Tie** (invariante: Iris/corazón nunca encadenan un programa que destruye/despliega).

### #6 — Quitar `diana` de sprint.js (anchors exactos; cambiar sprint.js + tests/22 en el MISMO commit)
- sprint.js: (1) L99 STEPS → `['replan','build','release','cierre']`. (2) L100-114 STEP_WORKER/STEP_WAIT: borrar `diana`, renombrar plan→replan. (3) noteFor L790-799: borrar `diana`, reescribir nota de build. (4) Plantilla cmdOpen L551-559: **borrar la sección `## Diana` Y su casilla** (quedan 4; casilla huérfana = tickeo desalineado). (5) **CONSERVAR** dianaFilter/runDianaGate/puerta de tests del build: la diana ahora la rellena la fase docs en el `## Diana` del `.md` de implementación; solo cambia QUIÉN la rellena. (6) revisar phaseByStatus/resumeIdx para 4 casillas. (7) limpiar comentarios/mensajería. LO QUE NO CAMBIA: release-and-test.js (no lee `## Diana`), runValidator/Tomás, release, cierre, round-trip de casillas.
- tests/22: 8 puntos (5 casillas→4, step inicial plan→replan, quitar submitOk de diana en happy/no-skip/gate-rojo/crash-recovery/cierre/hotfix, 3 approvals→2). NO tocar tests/run.js ni _harness.js.

### Riesgos (de Lina)
1. **Race del tablón** → re-entrancy guard obligatorio; corazón = portero único de `estado`.
2. **Merge de worktrees** → solo el corazón funde, serializado; conflicto real → agente resolver.
3. **Daemon largo en Windows** → watchdog SIGKILL por proceso; recuperable desde `.heart.json`+frontmatter; junctions colgando → limpieza vía git worktree remove.
4. **Romper tests/22** (números hardcoded) → cambiar sprint.js+tests/22 juntos; correr `node tests/run.js 22` aislado.
5. **Casilla huérfana** → quitar paso+casilla juntos.
6. **`git add -A` del release** arrastra untracked → sandbox en `backbone/sandbox/` (controlado), worktrees en **`.wt/` dentro del repo pero GITIGNORED** (probado: invisibles a git), docs borra lo sucio ANTES del release de implementación.
7. **Una sola batería** → la suite del corazón needsServer=false; programadores que corran tests, serializados.
8. **Deriva del `tema`** → normalizar a slug al escribirlo.

---

## 11. La interfaz de Tie con el sandbox (RESUELTO 2026-06-02, Tie)

- **Iris es la ÚNICA interfaz de Tie.** Tie no lee notas crudas ni el `.heart.json`, ni habla con Aubé/William/programadores: esos son la cuadrilla por debajo. Tie habla SOLO con Iris.
- **Cómo avisa un programador:** tocando su nota (el corazón mueve `estado:` → `finalizada`). Iris vigila las notas según terminan.
- **Iris narra con CRITERIO, no en bruto:** de vez en cuando dice *"me han dicho que lo de X ya está, por si quieres echar un vistazo"*. Si X es una patita de un XYZ mayor y no merece avisar suelto, **Iris decide** esperar al conjunto. (Latitud editorial de Iris, explícita por Tie.)
- **Status on-demand:** si Tie pregunta *"¿cómo va lo de X?"*, Iris mira las notas y le cuenta el progreso (qué está, qué falta).
- **"Echar un vistazo" = plumbing de Iris** (Tie lo delega: *"es trabajo técnico entre agentes"*). El código del sandbox se funde al tronco local; cuando algo merece mirarse, Iris entrega a Tie un **enlace local** que abre en su máquina y juguetea. Tie no arranca servidores ni gestiona nada.
  - *Detalle técnico a cerrar con Lina:* dónde corre el tronco del sandbox para el vistazo (instancia local siempre viva que Iris refresca vs. levantarla al pedir). NO es decisión de Tie.
- **Cambiar lo terminado vs. cancelar a media (RESUELTO 2026-06-02, Tie):** un retoque sobre algo YA terminado = **tarjeta nueva** (nunca se toca la cerrada). Para algo a medio hacer que va por mal camino, Iris PUEDE abortar la nota en proceso → el corazón mata el proceso del programador (SIGKILL, reusa el watchdog que ya existe) + descarta su worktree (`git worktree remove --force`) + libera al programador. Es una **válvula rara, no el camino común** (Tie: *"podemos tirar a medias, pero no creo que pase"*); se diseña para que todo termine y el cancelar es solo alivio. Mecánica: Iris marca la nota (p.ej. `estado: cancelada`), el corazón lo honra en el siguiente tic.

---

## 12. Una terminal, un comando — el corazón como raíz, Iris dentro (VERIFICADO 2026-06-02)

> Idea de Tie: *"si el corazón no puede vivir dentro de ti, tú puedes vivir dentro del corazón."* Verificado por un agente `claude-code-guide` (rutas A/B + auth + de dónde sale el sandbox).

- **VEREDICTO: viable por Ruta A (el corazón lanza un Claude Code hijo), NO por Ruta B (Agent SDK in-process).**
- **El corazón es la RAÍZ** que Tie lanza con UN comando en UNA terminal. Como nace en el terminal limpio de Tie, todo lo que él engendra hereda ese entorno. Hallazgo clave: **el sandbox es propiedad de la *herramienta Bash* de una sesión Claude Code, no de todo proceso** → un daemon Node lanzado desde el terminal de Tie NO está amurallado.
- **Auth sin API key — el cabo que faltaba:** Tie corre `claude setup-token` UNA vez → token OAuth de larga vida `CLAUDE_CODE_OAUTH_TOKEN` atado a su **suscripción** (no API key). El corazón lo tiene en env y lo pasa a CADA claude que arranca (Iris interactiva + programadores `claude -p`) → todos autentican con la suscripción de Tie. Confirmado que `claude -p` sobre suscripción está soportado (art. de soporte 2026-06-15).
- **Iris se lanza como hijo interactivo** del corazón: `spawn('claude', …, {stdio:'inherit'})` → ocupa el TTY para la charla con Tie; el corazón corre su `setInterval` (el latido) en el mismo proceso **en SILENCIO** (escribe a ficheros/log, nunca a stdout, para no corromper la TUI de Iris; alternativa robusta: el loop en un Worker thread).
- **DESCARTADO — Ruta B (Agent SDK / "Iris como librería dentro del corazón"):** el Agent SDK exige `ANTHROPIC_API_KEY`; Anthropic NO permite login de suscripción/claude.ai en SDKs de terceros. Por eso la versión "librería literal" se cae; se usa el spawn de CLI hijo (que sí acepta el token de suscripción).
- **Caveats (fontanería, no muros):** (1) `setup-token` una sola vez; (2) señales: Ctrl+C → catch en el corazón → SIGTERM a los hijos → esperar su exit → salir (sin huérfanos); (3) el latido nunca escribe a stdout.
- **Implicación de arranque:** cambia el punto de entrada — Tie ya no lanza `claude` para hablar con Iris; lanza el corazón (`npm run sandbox` o similar) y el corazón abre a Iris dentro. La release final sigue siendo su propio comando aparte (publica a prod = decisión CEO).
- **✅ CONFIRMADO empíricamente (2026-06-02)** con el spike `scripts/spike-heart.mjs auth`: desde el terminal de Tie, un `claude -p` hijo spawneado por Node **autentica con su suscripción** (`exit=0`, devolvió `SPIKE_OK`, sin API key) mientras un `setInterval` late en paralelo y en silencio (4 golpes durante el trabajo del hijo). Contraste: desde la caja amurallada de Iris el MISMO código cuelga y vuelve vacío (el `claude -p` no puede conectar). NB: el bang `!` de Iris hereda sus permisos acotados (lo enseñó Tie); aun así, esta vez por el `!` también autenticó. Spike = throwaway, **borrar `scripts/spike-heart.mjs` tras las pruebas** (no dejarlo para que el `git add -A` del release no lo arrastre).
- *Fuentes: Claude Code sandboxing docs · `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` · Agent SDK overview (API-key-only) · art. soporte suscripción 2026-06-15.*

---

## 13. Plan de construcción por etapas (Lina + Ana Liz, 2026-06-02) — sprint `construir-maquina-sandbox`

> Diseño cerrado (§0-12) → plan de build secuenciado. **Mecanismo de build (clave):** construir la máquina lo dirige **Iris con sus herramientas Agent/Workflow del harness** (las que SÍ autentican), NO con `sprint.js` (su `claude -p` no conecta desde la caja de Iris — probado). Validación por etapa = **tests deterministas mockeados por env** (`node tests/run.js 24` para el sandbox, `node tests/run.js 22` para el cambio de sprint.js; needsServer=false, sin claude real → corren desde la caja de Iris). **Ejecutar** la máquina (el producto) lo hace **Tie** desde su terminal (`npm run sandbox`, `npm run sprint`).

**Ficheros nuevos:** `scripts/heart.js` (el corazón-raíz), `scripts/sandbox/notes.js` (formato de nota), `scripts/sandbox/aube.js`, `scripts/sandbox/reparto.js`, `scripts/sandbox/william.js`, `scripts/sandbox/worktrees.js`, `scripts/docs.js`, `tests/24-sandbox-heart.test.js`.
**Ficheros editados:** `scripts/sprint.js` (quitar paso diana, anchors §6), `tests/22-...` (4 casillas), `package.json` (scripts `sandbox`/`sprint`), `.gitignore` (señales efímeras), `tests/run.js` (registrar suite 24).

**Etapas (cada una verificable + casi todas trasteables por Tie):**
1. **Esqueleto end-to-end trasteable** — notes.js + worktrees.js + heart.js v1 (UN reloj + re-entrancy guard, spawnIris stdio:inherit, launchProgrammer async estilo mesa.js, portero único, señales) + `npm run sandbox`. Demo: Tie lanza un comando, ve a Iris dentro, deja UNA nota, y la ve recorrer libre→en-proceso→finalizada con UN programador real en su worktree mientras el corazón late callado. ⏳ **EN CONSTRUCCIÓN (esta noche).**
2. **Aubé + Reparto + William + pools + numeración** — las 3 manecillas reales por tic; varias notas/temas → varios programadores en paralelo; reconstrucción de pools desde frontmatter tras crash.
3. **Dependencias (pasos 5-7) + merge serializado de worktrees + válvula de cancelación** — el caso `responsable: juan,petra`; merge limpio gratis / conflicto detectado→escala a resolver; abortar nota en proceso.
4. **docs.js** — drenaje (.drain-requested→.sandbox-drained) + 4 apóstoles ciegos → biblia de Anselmo → diana de Ana Liz + borrado del código sucio. Fail-closed.
5. **Quitar paso `diana` de sprint.js + arreglar tests/22** — recorrido replan→build→release→cierre; el handoff docs.js→sprint.js (la diana aterriza en el `## Diana` del .md de implementación).

**Diana:** `tests/24-sandbox-heart.test.js` (4 partes ↔ etapas 1-4) + adaptación de `tests/22` (etapa 5). 100% determinista, needsServer=false, sin claude/Mongo/worktrees reales. Hooks que el código DEBE exponer: `NEBLLA_SANDBOX_DIR`, `NEBLLA_SANDBOX_MOCK_PROGRAMMER`, `NEBLLA_SANDBOX_MOCK_GIT`. Reloj inyectable (`tick()` puro + `tickN`), contrato-por-fichero (asertar sobre disco), aislamiento por tmpdir.

**Decisiones para Tie (adopté los defaults de Lina; confírmalos por la mañana):**
1. **¿Quién/cómo se dispara la fase de documentar+reconstruir?** → **OPCIÓN 2 — auto-con-confirmación, el sí/no va AL CORAZÓN (Tie 2026-06-02).** Secuencia: **(a)** IRIS decide CUÁNDO (juzga "ya tenemos suficiente") y **cambia la variable** (`.drain-requested`); **(b)** el corazón drena (los ocupados terminan) y **APAGA a Iris** (cierra la sesión del sandbox); **(c)** con la terminal ya libre, **el CORAZÓN pregunta a Tie DIRECTAMENTE en la terminal: "¿quemo y reconstruyo, o vuelvo al sandbox? [s/n]"** — el sí/no de Tie va al corazón (Iris ya está apagada, no media). **SÍ** → el corazón corre `docs.js` (apóstoles→biblia→diana→QUEMA) y abre la Iris nueva en ultracode; **NO** → el corazón limpia el drenaje y **vuelve a modo sandbox** (re-abre una Iris de sandbox que relee el tablón y sigue trasteando — se pierde el scrollback del chat, NO el trabajo). Razón: la quema es irreversible (gatillo HUMANO, como la release) pero sin teclear comandos; y la confirmación la lleva el **programa determinista** (el corazón pregunta y lee la respuesta), no un Claude. `npm run sprint` separado = fallback manual. Invariante: **nadie quema sin el sí explícito de Tie**; un "no" no destruye nada.
2. **Nombre del comando de arranque** → adopté: **`npm run sandbox`** (cambia tu comando diario: ya no lanzas `claude` para hablar conmigo, lanzas el corazón y él me abre dentro).
3. **Dónde corre el tronco para "echar un vistazo"** → adopté: **levantar on-demand** (sin daemon extra siempre vivo). Técnico, ya delegado.

**Estado (2026-06-02, noche):** ✅ **ETAPA 1 CONSTRUIDA Y VERIFICADA.**
- Ficheros: `scripts/heart.js` (corazón v1: reloj único + re-entrancy guard, portero único, spawnIris stdio:inherit, launchProgrammer async estilo mesa.js, señales SIGINT, teardown de worktree al finalizar), `scripts/sandbox/notes.js` (formato de nota completo, frontmatter compatible con sprint.js), `scripts/sandbox/worktrees.js` (junction /J, limpieza sin fantasma, hook `setMockGit`), `tests/24-sandbox-heart.test.js` (diana parte 1), `backbone/sandbox/` (README + notas/). Edits: `package.json` (`sandbox`/`docs` scripts), `.gitignore` (señales efímeras), `tests/run.js` (suite 24 LEGACY needsServer=false).
- **64/64 tests verde**, deterministas, re-corridos por Iris. Tomás `pass`, sin bloqueantes, nada falseado. 4 menores cerrados (3 asserts flojos de la diana apretados + teardown enchufado).
- **Bug real cazado** al enchufar el teardown: los ticks tocaban git REAL bajo `MOCK_GIT` por captura-al-import en módulo compartido → arreglado con `setMockGit` (espejo de `setSandboxRoot`). Repo limpio: solo worktree master, cero ramas `sandbox/*`, `C:\nbla-wt` ausente.
- **PENDIENTE = shakedown EN VIVO** (`npm run sandbox` desde el terminal de Tie): la mecánica real (claude -p worker, worktree+junction en su Windows, Iris-as-child interactiva) NO la prueban los tests mockeados; se verifica con Tie. Prerrequisito: `claude setup-token` una vez. Matiz: la Iris-as-child de v1 es un claude en blanco (darle el contexto/persona de Iris = retoque posterior).
- **Etapas 2-5:** planeadas (arriba), a construir tras el trastear de la Etapa 1.

---

## 14. Decisión (2026-06-02, Tie): los talleres (worktrees) viven DENTRO del repo

Tie no quiere depender de tocar ficheros FUERA del repo (`C:\nbla-wt`) — riesgo de portabilidad/permisos a futuro (otra máquina, entorno restringido). **Decisión: los worktrees se mueven a una carpeta oculta y gitignored DENTRO del repo** (p.ej. `.wt/`), no fuera.
- **Gitignored** → git no los ve, y el `git add -A` del release NUNCA los arrastra.
- **El path-length (la razón original del root externo) NO es problema:** el `node_modules` de cada worktree es una **junction** que resuelve a la ubicación REAL (corta) del `node_modules` principal, así que la profundidad del worktree no cuenta para el límite de 260 de Windows; + `core.longpaths true` ya planeado.
- **✅ APLICADO Y VERIFICADO (2026-06-02):** `scripts/sandbox/worktrees.js` (`WT_ROOT` → `path.join(REPO_ROOT, '.wt')`), `.gitignore` (ignora `.wt/`), assert de `tests/24` actualizado. **Prueba empírica (la preocupación de Tie):** un worktree REAL creado dentro del repo en `.wt/` NO aparece en `git status` (11 líneas antes = 11 después, 0 menciones de `.wt`) — confirmado por Miguel (byte-idéntico) y re-confirmado por Iris de primera mano. Suite 24 64/64 verde, demo limpio. Otros usos del teardown capturan la salida de git (`runQuiet`) y son idempotentes, así que nunca corrompen la TUI de Iris ni dejan fantasmas.

---

## 15. Refinamiento (Tie, 2026-06-02): `npm run sprint` arranca HILO NUEVO + esfuerzo ultra-high

Extensión del "refactor a ciegas": tras `docs.js` (biblia + diana + quema del código sucio), `npm run sprint` debe **arrancar una sesión de Iris NUEVA, en hilo limpio** (sin la conversación del sandbox encima), **cebada SOLO con la biblia + los tests** (lo único que sobrevive), y **a esfuerzo ultra-high de fábrica** (sin que Tie teclee `/effort`).
- **Razón (la simetría que vio Tie):** el reconstructor no ve ni el código sucio NI la cháchara del trasteo — solo la verdad documentada; y reconstruir limpio es la parte de máxima exigencia → máximo esfuerzo.
- **Hilo nuevo cebado:** factible — el comando lanza un `claude` fresco (sin resume) con un encargo inicial apuntando a la biblia+diana.
- **Esfuerzo ultra-high de fábrica: ✅ CONFIRMADO** — `claude --settings '{"ultracode": true}' "<encargo apuntando a biblia+tests>"` arranca una sesión interactiva FRESCA (sin `--resume`/`--continue` → contexto limpio) ya en `ultracode` (xhigh + orquestación de workflows), sin teclear `/effort`. Matices: `ultracode` es **session-only** (NO se puede dejar fijo en `settings.json`), pero SÍ se pasa por `--settings` al lanzar; `--effort xhigh` / `CLAUDE_CODE_EFFORT_LEVEL` sirven para niveles estándar pero NO para `ultracode`. Receta para `npm run sprint`: `spawn('claude', ['--model','opus','--settings', JSON.stringify({ultracode:true}), prompt], {stdio:'inherit'})`. (Fuentes: code.claude.com `cli-reference` + `model-config`.)
- **A montar en la etapa 4-5** (docs.js + el handoff a la implementación), no ahora.

## 16. Hallazgos del vuelo real (para el REBUILD en limpio — NO se parchea el sandbox)

El sandbox es de usar y tirar: lo que se aprende aquí NO se arregla en su código (se quemaría), se **anota** y se construye bien en la reconstrucción en limpio. Los 4 primeros viven en la memoria de Iris (`project_sandbox_first_flight.md`); aquí quedan en el repo, que también sobrevive a la sesión.

- **#1–#4 (primer vuelo, 2026-06-02):** (1) la Bitácora del programador no sobrevive a la fusión-cosecha (nota escrita desde dos ramas que divergen → conflicto la tira); (2) William quema tokens (un claude real cada tick de 15s, sin dedup) mientras Aubé es código gratis; (3) fix de Tie = contador de aprobaciones consecutivas por nota (3 pasadas en silencio = en reposo, se resetea al cambiar contenido) para que el corazón solo dispare a William si una nota viva tiene <3; (4) la respuesta elegante a "qué Iris soy" = `spawnIris` con `--append-system-prompt`, una línea.

- **#5 (segundo vuelo, 2026-06-02) — el corazón se SUICIDA en el relevo.** Al drenar la mesa, la puerta de confirmación (OPCIÓN 2) cierra a Iris a propósito con `killIris('SIGTERM')` para liberar la terminal y preguntar a Tie `[s/n]`. Pero `main()` tiene `iris.on('exit', () => shutdown())` INCONDICIONAL → el cierre intencionado de Iris dispara `shutdown()` → `process.exit` en ~100 ms, matando el corazón ANTES de que `confirmReconstruct()`/`runDocs()` corran. Resultado: la pregunta nunca llega, el relevo a docs/sprint nunca arranca, y en pantalla solo queda el último fragmento ANSI de claude muriendo (`[`). **Fix en el rebuild:** el corazón debe distinguir un cierre de Iris *intencionado por la puerta* de un "fin de sesión" real — una guarda (p.ej. `expectingIrisExit`/`gateInProgress`) que se alza antes de `killIris`, para que el handler de `exit` NO llame a `shutdown()` durante la puerta; la propia puerta decide después si respawnea (rama NO) o hace el handoff a docs (rama SÍ).
  - **Daño colateral observado:** quedan `.drain-requested` + `.sandbox-drained` en `backbone/sandbox/`; un relanzamiento arranca directo en modo drenaje (no numera/reparte) y, con `.sandbox-drained` ya presente, ni siquiera reentra en la puerta. El rebuild debería limpiar/ignorar señales rancias al arrancar.
