# F15.1 — Qué sobrevive al spike: revert al estado original (decisión de Tie, 2026-06-05)

## Estado: implemented_untested

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

> **Deuda de la transición (2026-06-05, RESUELTA):** las tareas **001–004** quedaron en estados
> dispares (▢/🌳/⏳) aunque su código YA estaba en master — se fusionaron **a mano** durante el
> incidente de los worktrees, antes de que existiera el auto-merge, así que nunca se les marcó
> `enMaster` y sus worktrees fueron podados. Era dato rancio, no un fallo del motor nuevo. Se
> corrigió marcándolas las cuatro `enMaster` ✓ (commit de estado `1258cf9`). Las tareas que se
> ejecuten de ahora en adelante cierran solas por el auto-merge.
