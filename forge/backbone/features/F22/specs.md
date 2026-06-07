# F22 — Modelo de interacción: selección + scope + barra común (2026-06-03)

## Estado: implemented_untested

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
