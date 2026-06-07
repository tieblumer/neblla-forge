# F10 — "Aterrizar" un prompt, y solo entonces "Aplicar"

## Estado: implemented_untested

- Botón **Aterrizar**: un headless **resume todo el hilo en forma de prompt** que serviría para
  cambiar la tarea.
- Tras aterrizar, podemos **seguir discutiendo** o decir **Aplicar**.
- **Solo los prompts aterrizados muestran el botón "Aplicar".** No se puede aplicar nada que no
  haya pasado por el aterrizaje (= candado contra cambios crudos sin resumir/revisar).
