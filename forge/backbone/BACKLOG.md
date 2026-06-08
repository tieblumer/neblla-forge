# Backlog del FORGE

El backlog de la propia máquina de construir (Neblla = el producto, tiene el suyo en
`project/backbone/BACKLOG.md`). Todo lo que genera el forge —backlog, chats, tests— vive
dentro de `forge/`. (Pendiente otro día: alinear `project/` al mismo patrón.)

---

## El ciclo de backlog + nuevo ciclo

**Cómo funciona "Nuevo ciclo":**
- "Nuevo ciclo" NO es un botón: es la PRIMERA parada del carril (`◀ Nuevo ciclo › Spike › … ▶`),
  una etiqueta de estado. Se llega SOLO con la flecha ◀ desde Spike.
- En esa parada NO hay modal en el centro. El objetivo (forge/producto) y la rama se editan
  **arriba a la izquierda** (el chip del objetivo + la rama, que solo ahí son editables).
- Las **tareas están vacías** (en un ciclo nuevo se borran todas).
- La **única conversación es la de Iris**, enfocada al backlog del **objetivo actual**.
  - Hay **una conversación de Iris por objetivo**. Cambiar de objetivo arriba-izquierda →
    Iris abre la del otro objetivo (lee su backlog: forge → `forge/backbone/BACKLOG.md`,
    producto → `project/backbone/BACKLOG.md`). Volver al primero NO crea otra: ya está ahí.
- **▶ (avanzar a Spike) = Empezar:** ahí se borra el taller (tareas + conversaciones, salvo
  la de Iris del objetivo elegido) y arranca de verdad.

## El botón de Anselmo (apuntar tarea en el backlog) — SIGUIENTE BUILD

- Cada tarea lleva un botón. Al pulsarlo, **Anselmo** (solo escribe docs, no toca código):
  1. Redacta un **pequeño resumen** de la tarea y lo **añade al `BACKLOG.md` del objetivo**,
     con un **ancla** estable en esa línea.
  2. Deja en la tarea una **nota con un enlace**.
- El **enlace** abre **el backlog dentro de la propia forja** (un visor de markdown nuevo) y
  **lleva el scroll hasta el ancla** que escribió Anselmo. Un clic y estás justo donde quedó.
- Requiere: un visor de backlog in-app (renderiza el `BACKLOG.md` y salta a un ancla).
