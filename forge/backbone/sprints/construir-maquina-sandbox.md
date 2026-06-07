---
sprint: construir-maquina-sandbox
topic: Construir la maquina de sandbox: corazon-daemon raiz (lo lanza Tie) con Iris-as-child + Aube/Reparto/William + notas + worktrees; luego docs.js (4 apostoles -> biblia Anselmo -> diana Ana Liz); luego quitar el paso diana de scripts/sprint.js. Diseno completo en backbone/sandbox-sprint-handoff.md (secciones 1-12, verificado empiricamente).
status: planning
created: 2026-06-02
---

# Sprint: Construir la maquina de sandbox: corazon-daemon raiz (lo lanza Tie) con Iris-as-child + Aube/Reparto/William + notas + worktrees; luego docs.js (4 apostoles -> biblia Anselmo -> diana Ana Liz); luego quitar el paso diana de scripts/sprint.js. Diseno completo en backbone/sandbox-sprint-handoff.md (secciones 1-12, verificado empiricamente).

## Tema
La máquina de sandbox: una fase de exploración (código de usar-y-tirar, varios programadores en paralelo cada uno en su worktree, orquestados por el corazón-daemon) que alimenta a la máquina de sprints actual. Invierte el orden: explorar → documentar (biblia+diana) → reconstruir limpio. **NOTA de mecanismo:** este build NO se dirige con `sprint.js` (su `claude -p` no conecta desde la caja de Iris); se dirige con las herramientas Agent/Workflow de Iris, y se valida por etapa con tests deterministas. Este `.md` es el tracker; el diseño+plan viven en `backbone/sandbox-sprint-handoff.md` §1-13.

## Plan de acción
5 etapas (detalle en handoff §13): **(1)** esqueleto end-to-end ✅ HECHO+VERDE · **(2)** Aubé/Reparto/William+pools · **(3)** dependencias(5-7)+merge serializado+cancelación · **(4)** docs.js (apóstoles→biblia→diana) · **(5)** quitar paso `diana` de sprint.js + tests/22.

## Diana (tests)
filtro: 24
_(la diana del sandbox = `tests/24-sandbox-heart.test.js`, deterministas/mockeados; parte 1 = Etapa 1, 64/64 verde. El cambio de sprint.js se valida con `tests/22`.)_

## Casillas (definition of done) — las marca Tomás
- [ ] Plan de acción acordado (Lina + Iris).
- [ ] Diana de tests diseñada (Ana Liz puerta 1).
- [ ] Construido (Miguel) y la diana declarada en verde.
- [ ] Listo para el release (Tie lanza `npm run release`).
- [ ] Release verde + Otto OK → sprint cerrado.

## Estado / handoff
- **(2026-06-02) ✅ MÁQUINA COMPLETA — las 5 etapas construidas y VERIFICADAS.** `node tests/run.js 24` = **222/222** (sandbox: corazón + notas + worktrees + Aubé/Reparto/William + pools + dependencias paso-7 + merge serializado + cancelar + docs.js drenaje/apóstoles/biblia/diana/quema/handoff+fresh-Iris). `node tests/run.js 22` = **109/109** (la máquina vieja con el flujo NUEVO `replan→build→release→cierre`, sin paso `diana`). Tomás `pass` en las 5 etapas. Etapa 1 además probada EN VIVO por Tie. Repo limpio; el bug latente de `tests/22` (borraba los sprints reales al barrer) quedó AISLADO/arreglado.

- **🔁 PENDIENTE = shakedown EN VIVO del flujo entero** (solo el terminal de Tie prueba los claude/worktrees/quema REALES; los tests son con muñecos). La Etapa 1 ya se probó viva; falta el viaje completo (trastear → documentar → reconstruir).
- **✅ Los 2 menores de Tomás (Etapa 4) YA ARREGLADOS** + **la puerta de confirmación opción-2 construida** (ver Log, cierre 2026-06-02): `cleanupDirtyCode` desmonta los worktrees reales; `docs.js` verifica biblia+diana no-vacías antes de quemar (aborta si faltan = puente con red); y la puerta (drena→apaga Iris→el corazón pregunta a Tie [s/n]→sí quema / no vuelve al sandbox) verde. Decisión per-tema **CONFIRMADA por Tie**.
- **Menor → BACKLOG (cosmético):** la suite 22 deja un fixture `__test_orch_<pid>_*.md` suelto (untracked) por corrida; basura inofensiva. (No gitignorar el patrón: el test git-añade fixtures a propósito.)
- **Decisión de Miguel A CONFIRMAR con Tie:** reparto persiste el programador por-tema (Log Etapa 2). · **Menor → BACKLOG:** edge de numeración (Log).
- Las ## Casillas (modelo viejo): el BUILD (5 etapas) está hecho y verde; faltan `release` (Tie lanza `npm run release`) y `cierre` para tickear formalmente el sprint.

## Log
- 2026-06-02 — Sprint abierto.
- 2026-06-02 noche — Plan por etapas (Lina) + diana (Ana Liz) cerrados. Etapa 1 construida (Miguel) + verificada (Tomás pass, 64/64). Bug real cazado (tests tocaban git real bajo mock → `setMockGit`). Repo limpio. Diseño+plan anclados en handoff §1-13.
- 2026-06-02 — Etapa 1 verificada EN VIVO por Tie (`npm run sandbox:demo`): trabajador real + worktree real + ciclo completo. Worktrees movidos DENTRO del repo (`.wt/`, gitignored) por decisión de Tie (probado: no ensucia git status). Demo auto-limpio (corre en `.demo/` gitignored). Refinamientos §14 (talleres dentro) y §15 (`npm run sprint` = hilo nuevo + ultracode al reconstruir, confirmado factible).
- 2026-06-02 — Etapa 2 construida (Miguel: `aube.js`/`reparto.js`/`william.js` extraídos a módulos + heart v2; las manecillas PROPONEN, el corazón mueve estado vía un `gatekeeper` closure) + verificada (Tomás pass; Iris re-corrió **110/110 determinista**). **DECISIÓN de Miguel A CONFIRMAR con Tie:** reparto PERSISTE el programador por-tema (reinterpretó "sin nota → se borra del pool" como "sin tema nunca", no "sin trabajo ahora") — encaja con "mismo tema → mismo programador". Minor → BACKLOG: edge de numeración (crash que borra `.heart.json` Y la nota del nº más alto puede reusar un nº).
- 2026-06-02 — Etapa 3 construida (dependencias paso-7 CSV-mengua + merge serializado de worktrees + conflicto detectado→resolver + válvula de cancelar). Incidencias resueltas: (a) el workflow abortó por fallo de FORMATO del informe (no de código), rematado por un agente-fix; (b) un agente disparó el barrido de sprints `done` y borró `montar-la-maquina.md`+`sprint-orchestrator.md` → **RESTAURADOS** (`git checkout HEAD`), guardarraíles puestos (agentes: solo `tests/run.js 24`, cero git mutador/sweep, no tocar `backbone/sprints/`). **Tomás CAZÓ un bloqueante oculto tras el verde:** `reconcilePools` soltaba a un programador cuya nota William movió a `atencion` (sigue trabajando) → huérfano + worktree fantasma. ARREGLADO (`WORK_STATES={en-proceso,atencion}`) + test del punto ciego añadido (falla con bug viejo, pasa con arreglo). Iris re-corrió **164/164**. Etapas 4-5 pendientes.
- 2026-06-02 — Etapa 4 (docs.js: drenaje + 4 apóstoles ciegos → biblia Anselmo → diana Ana Liz → quema + handoff/fresh-Iris) construida + Tomás pass (222/222). Etapa 5 (quitar paso `diana` de sprint.js → `replan→build→release→cierre` + adaptar tests/22) construida + Tomás pass (tests/22 109/109); de paso AISLADO el bug del barrido C4 de tests/22 que borraba los sprints reales (`montar`/`orch`).
- 2026-06-02 — **CIERRE DEL TEMA:** puerta de confirmación opción-2 (Iris decide cuándo → el corazón la apaga → el corazón pregunta a Tie `[s/n]` → SÍ quema / NO vuelve al sandbox; confirmación inyectable para tests) + 2 redes de seguridad de docs.js (cleanup desmonta los worktrees reales; verifica biblia+diana no-vacías ANTES de quemar). Tomás pass; Iris re-corrió **261/261** (suite 24) + **109/109** (suite 22), sprints reales intactos. Decisión per-tema CONFIRMADA por Tie. **PENDIENTE: solo el shakedown EN VIVO (terminal de Tie).**
