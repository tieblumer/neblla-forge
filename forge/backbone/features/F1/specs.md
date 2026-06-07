# F1 — Arranque limpio del ciclo (Nuevo ciclo)

## Estado: implemented_untested

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
