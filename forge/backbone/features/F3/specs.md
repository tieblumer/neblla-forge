# F3 — Persistencia: una conversación = un fichero JSON

## Estado: implemented_untested

Cada conversación se guarda como `/sprint/chats/NNN.json` (`001`, `002`, …). El contenido es un
**array de objetos**, donde cada objeto (cada intervención) lleva:
- **tipo** de la intervención/consulta,
- **autor** — quién lo comentó (`Tie`, `Iris`, `William`, …),
- **intención** — `request` | `challenge` | `answer` (enum a cerrar),
- **responde-a** — a qué intervención contesta (referencia al padre).

La conversación se va guardando incrementalmente según se habla.
