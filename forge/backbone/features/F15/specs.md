# F15 — El ciclo arranca en Spike (la primera fase)

## Estado: implemented_untested

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
