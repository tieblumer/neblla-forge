# El sandbox — la fase de trastear

El **sandbox** es la primera mitad de un sprint en el modelo nuevo: una fase donde
se **explora y se descubre** con código de usar y tirar, antes de reconstruir
limpio. Lo que sobrevive son los **aprendizajes** (la `## Bitácora` de cada nota),
no las líneas de código.

## Qué hay aquí

- `notas/` — las notas (tarjetas). Cada una es un `.md` con frontmatter
  (`id`, `tema`, `estado`, `numero`, `responsable`, `dependencias`, `william`,
  `creada`) + tres secciones: `## Pide` (lo que escribe Iris), `## Observaciones
  de William` (append-only) y `## Bitácora` (append-only, los aprendizajes del
  programador). **Las notas se versionan en git.**
- `.heart.json` — el estado del corazón (pools de programadores libres/ocupados +
  el ordinal monótono). **Efímero, gitignored** — se reconstruye desde las notas.
- `.heart.log` — el latido en silencio (el corazón nunca escribe a stdout para no
  corromper la TUI de Iris). **Efímero, gitignored.**
- `.drain-requested` / `.sandbox-drained` — señales de drenaje hacia la fase de
  documentación. **Efímeras, gitignored.**

## Cómo se arranca

```
npm run sandbox
```

Esto lanza el **corazón** (`scripts/heart.js`): un único reloj (`setInterval`) con
tres manecillas por tic, en orden fijo **Aubé → Reparto → William**, y un
re-entrancy guard para que nunca haya dos manos tocando el tablón a la vez. El
corazón abre a **Iris dentro** como hijo interactivo (ocupa la terminal para
charlar con Tie) mientras el latido corre en el mismo proceso, callado.

El corazón es el **portero único** del `estado:` de las notas: solo él lo mueve
(`libre → en-proceso → finalizada`). Iris y los programadores **proponen**
escribiendo; el corazón confirma.

## Setup de una vez (auth sin API key)

El corazón y todos los claudes que engendra (Iris interactiva + programadores
`claude -p`) autentican con la **suscripción** de Tie, no con una API key. Una
sola vez:

```
claude setup-token
```

Esto crea un token OAuth de larga vida (`CLAUDE_CODE_OAUTH_TOKEN`) atado a la
suscripción. El corazón lo hereda del entorno y lo pasa a cada hijo. **Nunca se
usa `ANTHROPIC_API_KEY`.**

## Parar

`Ctrl+C` → el corazón manda `SIGTERM` a sus hijos, espera a que salgan y sale sin
huérfanos.
