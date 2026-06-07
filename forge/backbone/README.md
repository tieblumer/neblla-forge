# Forge · Documentación (backbone)

> La documentación canónica de **la forja** (la máquina de construir). No se lee directamente
> por humanos: es la fuente de verdad de la que se derivan el resumen, el detalle por feature
> y lo que leen los personajes headless. **Empieza siempre por este README** antes de tocar
> ningún otro fichero del backbone.

---

## Nomenclatura GENÉRICA y determinista

La forja construye sobre un **objetivo** (`forge` | `project`). El objetivo **marca la carpeta**;
los nombres de dentro son **idénticos** para los dos. Así la máquina mira siempre al mismo sitio,
sin saber sobre qué objetivo trabaja:

```
<objetivo>/backbone/
   README.md          ← este fichero: las convenciones (la meta-doc)
   backbone.md        ← el catálogo COMPLETO
   backbone_mini.md   ← el RESUMEN (índice derivado del completo)
   features/<id>/      ← el DETALLE por feature
```

- objetivo `forge`   → `forge/backbone/…`
- objetivo `project` → `project/backbone/…`

Nada de nombres atados al objetivo (`forge-backbone.md`, `neblla_backbone.md`): un solo esqueleto.

---

## Los documentos

| Fichero | Qué es |
|---|---|
| **`README.md`** | Este fichero. Las convenciones — la meta-documentación. |
| **`backbone.md`** | El catálogo narrativo completo: por qué existe la forja, el vocabulario del ciclo, las etapas y **todas las features** (secciones `### F…`). La fuente de verdad. |
| **`backbone_mini.md`** | El resumen: el mapa de capítulos + una línea por feature. **Derivado** de `backbone.md` (regenerable), ordenado para consulta rápida. |
| **`features/<id>/`** | El detalle de cada feature: `specs.md` (qué hace y su estado) y, según haga falta, `tests.md`, `DOD.md`, `backlog.md`, `log.md`. |

---

## Cómo se escribe `backbone.md`

A diferencia de Neblla (que cuenta la historia de un ajedrez multijugador), el hilo de la forja
es **el propio ciclo de trabajo**: cómo una idea entra por una conversación, se aterriza en una
tarea, se construye y se cierra. Esa narrativa común da coherencia: cualquier documento derivado
(o cualquier headless) reutiliza el mismo vocabulario en vez de inventar uno nuevo.

El documento va en capítulos de orden fijo: el **por qué** (la tesis), la **interfaz**, la
**nomenclatura del ciclo**, las **etapas** (Spike → Grooming → Sprint → QA, + Hotfix), las
**Features**, las **Acciones** (qué botón llama a quién) y los **Perfiles** (los personajes).

### La feature, unidad atómica

Una feature es una **capacidad** de la forja: *qué hace y por qué*, a medio camino entre lo
narrativo y lo técnico (sabemos por dónde van los tiros: qué fichero JSON persiste, qué MCP usa).
Cada feature tiene un id estable (`F1`, `F9b`, `F16`…) que es el nombre de su carpeta.

**Reglas de redacción de una feature:**

- Empieza por **qué representa** para Tie, no por el mecanismo. El mecanismo va después, breve.
- Es **agnóstica de implementación** salvo en los hechos transversales que importan (el nombre de
  un fichero de estado, el evento MCP, el flag del ciclo).
- Lleva un **`## Estado:`** ∈ `implemented_tested | implemented_untested | partial | narrative_only`,
  para distinguir lo construido y probado de lo que aún es solo narrativa.

---

## Cómo se mantiene

- `backbone.md` es **canónico**: se edita a mano (con permiso de Tie para cambios de fondo).
- `backbone_mini.md` y los `features/<id>/specs.md` se **derivan** de `backbone.md` en la primera
  pasada; a partir de ahí, el detalle de una feature puede crecer en su carpeta.
- Las herramientas MCP de lectura (`backbone_resumen`, `backbone_completo`, `leer_feature`) leen
  **siempre por estos nombres genéricos**, resolviendo la carpeta por el objetivo del ciclo.
