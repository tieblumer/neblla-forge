# F21 — Miga de pan del ciclo + mando de transporte (4 acciones)

## Estado: implemented_untested

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
