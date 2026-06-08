// forge/tests/tarea-25.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 25 — [Tarea 024 creada: Construir el "ciclo de reconstrucción" del forge: un orquestador que abre una rama nueva (todo el worktree pasa a la rama, no a master, para tener un master-vs-rama con qué comparar), hace que Anselmo documente todos los cambios en backbone + MCP, lanza 4 veces en paralelo al mismo apóstol con ángulos distintos (Lucas=tests, Marcos=definición, Juan=diff, Mateo=bordes/huecos) para verificar que la documentación está completa, deja que Lina+Ana Liz redacten plan y tests mirando solo tests+worktree de Anselmo, corre la batería nueva contra MASTER como "gate de oro", limpia de la rama todo el código que no sean los tests, vuelca plan+docs (sin los libros de los apóstoles), y suelta un Miguel gigante en ultracode que reprograma desde el código de master hasta que todos los tests pasan, con reanudación si se cae.].

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 25 — [Tarea 024 creada: Construir el "ciclo de reconstrucción" del forge: un orquestador que abre una rama nueva (todo el worktree pasa a la rama, no a master, para tener un master-vs-rama con qué comparar), hace que Anselmo documente todos los cambios en backbone + MCP, lanza 4 veces en paralelo al mismo apóstol con ángulos distintos (Lucas=tests, Marcos=definición, Juan=diff, Mateo=bordes/huecos) para verificar que la documentación está completa, deja que Lina+Ana Liz redacten plan y tests mirando solo tests+worktree de Anselmo, corre la batería nueva contra MASTER como "gate de oro", limpia de la rama todo el código que no sean los tests, vuelca plan+docs (sin los libros de los apóstoles), y suelta un Miguel gigante en ultracode que reprograma desde el código de master hasta que todos los tests pasan, con reanudación si se cae.]');
  await r.step('[T-25-01] anselmoDocPrompt ordena documentar el diff master-vs-rama en backbone + MCP', async () => {
    const { anselmoDocPrompt } = await import("../../scripts/lib/forge-prompts.js");
    r.ok("anselmoDocPrompt es una función", typeof anselmoDocPrompt === "function");
    const wt = "/wt/anselmo-7f3a";
    const base = "master-abc123";
    const s = anselmoDocPrompt({ worktreeDir: wt, baseRef: base, objetivo: "el forge" });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    r.ok("nombra el worktreeDir recibido", s.includes(wt));
    r.ok("nombra el baseRef recibido", s.includes(base));
    r.ok("manda leer el diff master-vs-rama", /diff/i.test(s) && /(master|rama|baseRef)/i.test(s));
    r.ok("manda documentar en el backbone", /backbone/i.test(s));
    r.ok("manda reflejar los cambios en el MCP", /\bmcp\b/i.test(s));
    r.ok("habla de documentar TODAS las features a fondo", /features?/i.test(s) && /(todas|todos|cada|a fondo)/i.test(s));
  });

  await r.step('[T-25-02] apostolPrompt es UNA función que produce 4 lentes distintas según el ángulo', async () => {
    const { apostolPrompt } = await import("../../scripts/lib/forge-prompts.js");
    r.ok("apostolPrompt es UNA sola función", typeof apostolPrompt === "function");
    const wt = "/wt/anselmo-7f3a";
    const base = "master-abc123";
    const lucas = apostolPrompt({ angulo: "lucas", worktreeDir: wt, baseRef: base });
    const marcos = apostolPrompt({ angulo: "marcos", worktreeDir: wt, baseRef: base });
    const juan = apostolPrompt({ angulo: "juan", worktreeDir: wt, baseRef: base });
    const mateo = apostolPrompt({ angulo: "mateo", worktreeDir: wt, baseRef: base });
    const arr = [lucas, marcos, juan, mateo];
    r.ok("los cuatro son strings no vacíos", arr.every((x) => typeof x === "string" && x.length > 0));
    r.eq("los cuatro ángulos producen textos DISTINTOS entre sí", new Set(arr).size, 4);
    r.ok("lucas mira los tests (qué se garantiza)", /tests?/i.test(lucas));
    r.ok("marcos mira la definición de la tarea (el porqué)", /(definici|porqu|tarea)/i.test(marcos));
    r.ok("juan mira el diff fichero a fichero (qué cambió)", /diff/i.test(juan) && /fichero/i.test(juan));
    r.ok("mateo mira los bordes y huecos sin test", /(borde|hueco)/i.test(mateo));
  });

  await r.step('[T-25-03] apostolPrompt pasa worktreeDir y baseRef para el diff', async () => {
    const { apostolPrompt } = await import("../../scripts/lib/forge-prompts.js");
    const wt = "/wt/anselmo-juan-91cc";
    const base = "master-cafe01";
    const s = apostolPrompt({ angulo: "juan", worktreeDir: wt, baseRef: base });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    r.ok("contiene el worktreeDir de Anselmo", s.includes(wt));
    r.ok("contiene el baseRef para calcular el diff master-vs-rama", s.includes(base));
  });

  await r.step('[T-25-04] apostolPrompt con un ángulo desconocido no falla en silencio', async () => {
    const { apostolPrompt } = await import("../../scripts/lib/forge-prompts.js");
    let threw = false;
    let out;
    try { out = apostolPrompt({ angulo: "judas", worktreeDir: "/wt/x", baseRef: "master" }); }
    catch (e) { threw = true; }
    // rechazo EXPLÍCITO: o lanza, o devuelve algo claramente marcado como inválido/error (no un string normal en silencio)
    const rechazaExplicito = threw
      || out == null
      || (typeof out === "string" && /(desconocid|inv[aá]lid|no\s+v[aá]lid|\berror\b)/i.test(out));
    r.ok("un ángulo desconocido NO se traga en silencio (lanza o lo rechaza explícito)", rechazaExplicito);
    // y desde luego NO debe colar por sorpresa una de las 4 lentes válidas
    if (typeof out === "string" && out.length > 0) {
      const valido = apostolPrompt({ angulo: "lucas", worktreeDir: "/wt/x", baseRef: "master" });
      r.ok("no devuelve una lente válida equivocada disfrazada", out !== valido);
    }
  });

  await r.step('[T-25-05] linaReconPrompt convierte los huecos de Mateo en tests OBLIGATORIOS', async () => {
    const { linaReconPrompt } = await import("../../scripts/lib/forge-prompts.js");
    const huecos = ["no hay test del gate en rojo", "falta cubrir el ángulo inválido del apóstol"];
    const s = linaReconPrompt({ testsDir: "/wt/tests", docsDir: "/wt/backbone", huecosMateo: huecos });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    r.ok("referencia testsDir (lo único que mira Lina)", s.includes("/wt/tests"));
    r.ok("referencia docsDir (el worktree de Anselmo)", s.includes("/wt/backbone"));
    r.ok("enumera el primer hueco de Mateo", s.includes(huecos[0]));
    r.ok("enumera el segundo hueco de Mateo", s.includes(huecos[1]));
    r.ok("deja claro que los huecos son tests OBLIGATORIOS del plan", /obligator/i.test(s));
  });

  await r.step('[T-25-06] linaReconPrompt sigue siendo válido sin huecos de Mateo', async () => {
    const { linaReconPrompt } = await import("../../scripts/lib/forge-prompts.js");
    const vacio = linaReconPrompt({ testsDir: "/wt/tests", docsDir: "/wt/backbone", huecosMateo: [] });
    r.ok("con lista vacía sigue devolviendo un string coherente y no vacío", typeof vacio === "string" && vacio.length > 40);
    r.ok("sigue referenciando testsDir y docsDir", vacio.includes("/wt/tests") && vacio.includes("/wt/backbone"));
    // no debe meter una sección de huecos vacía/engañosa: el texto sin huecos difiere del que sí los tiene
    const conHueco = linaReconPrompt({ testsDir: "/wt/tests", docsDir: "/wt/backbone", huecosMateo: ["un hueco real"] });
    r.ok("sin huecos NO arrastra el contenido de la lista (difiere del caso con huecos)", vacio !== conHueco);
    r.ok("sin huecos no cuela el texto de un hueco inexistente", !vacio.includes("un hueco real"));
  });

  await r.step('[T-25-07] miguelGigantePrompt arranca desde el código de master con esfuerzo ultracode', async () => {
    const { miguelGigantePrompt } = await import("../../scripts/lib/forge-prompts.js");
    const s = miguelGigantePrompt({ rama: "ciclo/recon-3", planPath: "/wt/plan-recon.md", docsDir: "/wt/backbone", masterRef: "master", reanudacion: false });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    r.ok("pide esfuerzo ultracode", /ultracode/i.test(s));
    r.ok("parte del código de master (masterRef)", s.includes("master"));
    r.ok("usa el plan (planPath) como brújula", s.includes("/wt/plan-recon.md"));
    r.ok("usa los docs (docsDir) como brújula", s.includes("/wt/backbone"));
    r.ok("manda iterar hasta que TODOS los tests pasen", /tests?/i.test(s) && /(todos|pasen|verde)/i.test(s));
  });

  await r.step('[T-25-08] miguelGigantePrompt en reanudación dice \'sigue desde donde lo dejó\'', async () => {
    const { miguelGigantePrompt } = await import("../../scripts/lib/forge-prompts.js");
    const base = { rama: "ciclo/recon-3", planPath: "/wt/plan-recon.md", docsDir: "/wt/backbone", masterRef: "master" };
    const fresco = miguelGigantePrompt({ ...base, reanudacion: false });
    const reanuda = miguelGigantePrompt({ ...base, reanudacion: true });
    r.ok("ambos son strings no vacíos", typeof fresco === "string" && fresco.length > 0 && typeof reanuda === "string" && reanuda.length > 0);
    r.ok("el de reanudación se DIFERENCIA del de arranque en frío", fresco !== reanuda);
    r.ok("la reanudación dice continuar desde donde se quedó el Miguel anterior", /(sigue|contin[uú]a|donde lo dej|donde se qued|reanud)/i.test(reanuda));
    r.ok("la reanudación sigue en la MISMA rama", reanuda.includes(base.rama));
  });

  await r.step('[T-25-09] los prompt-builders son puros: no leen disco/env y son deterministas', async () => {
    const mod = await import("../../scripts/lib/forge-prompts.js");
    // determinismo: dos llamadas con las mismas entradas → el MISMO string
    const casos = [
      () => mod.anselmoDocPrompt({ worktreeDir: "/wt/a", baseRef: "master", objetivo: "el forge" }),
      () => mod.apostolPrompt({ angulo: "mateo", worktreeDir: "/wt/a", baseRef: "master" }),
      () => mod.linaReconPrompt({ testsDir: "/wt/tests", docsDir: "/wt/docs", huecosMateo: ["x"] }),
      () => mod.miguelGigantePrompt({ rama: "r", planPath: "/p", docsDir: "/d", masterRef: "master", reanudacion: false }),
    ];
    for (const f of casos) {
      const a = f();
      const b = f();
      r.ok("misma entrada → mismo string (determinista)", typeof a === "string" && a.length > 0 && a === b);
    }
    // pureza por fuente: el módulo NO lee env ni toca disco (Contrato B)
    const fs = await import("fs"); const path = await import("path"); const { fileURLToPath } = await import("url");
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "forge-prompts.js"), "utf8");
    r.ok("forge-prompts.js no lee process.env (función pura)", !/process\.env/.test(src));
    r.ok("forge-prompts.js no importa fs (no toca disco)", !/from\s+['\"]fs['\"]/.test(src) && !/require\(['\"]fs['\"]\)/.test(src));
  });

  await r.step('[T-25-10] el ciclo abre una rama nueva, mueve el trabajo a ella y fija baseRef=master', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo expone algo (forge-recon.js / forge-firme.js)", keys.length > 0);
    const fn = mod.abrirCiclo || mod.planCiclo || mod.nuevaRamaCiclo || mod.crearRamaCiclo
      || mod[keys.find((k) => typeof mod[k] === "function" && /(abrir|nueva|crear|plan).*(rama|ciclo)|^.*ciclo$/i.test(k))];
    r.ok("expone un planificador de apertura del ciclo", typeof fn === "function");
    if (typeof fn !== "function") return;
    let res;
    try { res = fn({ baseBranch: "master" }); } catch { try { res = fn(); } catch { res = null; } }
    r.ok("devuelve un descriptor del ciclo", res && typeof res === "object");
    const baseRef = res && (res.baseRef ?? res.base ?? res.baseRev);
    const rama = res && (res.rama ?? res.branch ?? res.ramaCiclo);
    r.eq("fija baseRef = master para poder diffear master-vs-rama", baseRef, "master");
    r.ok("crea una rama de ciclo distinta de master (el worktree pasa a ELLA, no a master)", typeof rama === "string" && rama.length > 0 && rama !== "master");
  });

  await r.step('[T-25-11] GATE DE ORO: verde continúa, rojo aborta el ciclo', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const gate = mod.gateDeOro || mod.evaluarGate || mod.gate
      || mod[keys.find((k) => typeof mod[k] === "function" && /gate|oro/i.test(k))];
    r.ok("expone el gate de oro", typeof gate === "function");
    if (typeof gate !== "function") return;
    const verde = gate({ pass: 16, fail: 0 });
    const rojo = gate({ pass: 14, fail: 2 });
    const accV = String(verde && (verde.accion ?? verde.action ?? verde));
    const accR = String(rojo && (rojo.accion ?? rojo.action ?? rojo));
    r.ok("verde (0 fallos) → el ciclo CONTINÚA", /continu|seguir|avanz|ok|true/i.test(accV) || verde === true);
    r.ok("rojo (algún fallo) → el ciclo ABORTA (no avanza a limpiar ni a Miguel)", /abort|parar|detener|stop|fail|false/i.test(accR) || rojo === false);
    r.ok("verde y rojo dan veredictos distintos", JSON.stringify(verde) !== JSON.stringify(rojo));
  });

  await r.step('[T-25-12] la limpieza deja en la rama SOLO los ficheros de test', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const limpia = mod.planLimpieza || mod.limpiezaRama || mod.limpiarRama
      || mod[keys.find((k) => typeof mod[k] === "function" && /limpi/i.test(k))];
    r.ok("expone el plan de limpieza de la rama", typeof limpia === "function");
    if (typeof limpia !== "function") return;
    const cambiados = [
      "forge/tests/tarea-24.test.js",
      "scripts/reconstruir.js",
      "scripts/lib/forge-prompts.js",
      "forge/tests/25-recon.test.js",
      "public/forge/index.html",
    ];
    let res;
    try { res = limpia(cambiados); } catch { res = limpia({ cambiados }); }
    const conserva = Array.isArray(res) ? res : (res && (res.conserva || res.keep || res.sobreviven));
    r.ok("devuelve qué ficheros se conservan", Array.isArray(conserva));
    if (!Array.isArray(conserva)) return;
    r.ok("SOLO sobreviven ficheros de test", conserva.every((p) => /\.test\.js$/.test(p) || /[\\/]tests[\\/]/.test(p)));
    r.ok("conserva los .test.js que cambiaron", conserva.includes("forge/tests/tarea-24.test.js") && conserva.includes("forge/tests/25-recon.test.js"));
    r.ok("NO conserva el código que no es test (vuelve a master)", !conserva.includes("scripts/reconstruir.js") && !conserva.includes("public/forge/index.html"));
    const revierte = res && (res.revierte || res.revert || res.descarta);
    if (Array.isArray(revierte)) r.ok("marca el código no-test para revertir al estado de master", revierte.includes("scripts/reconstruir.js"));
  });

  await r.step('[T-25-13] el volcado lleva plan + docs pero NO los libros de los apóstoles', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const filtra = mod.filtrarVolcado || mod.volcadoFinal || mod.excluyeLibrosApostoles
      || mod[keys.find((k) => typeof mod[k] === "function" && /(volcad|apostol|libro)/i.test(k))];
    r.ok("expone el filtro del volcado", typeof filtra === "function");
    if (typeof filtra !== "function") return;
    const files = [
      "forge/backbone/plan-recon.md",        // plan de Lina
      "forge/backbone/backbone.md",          // docs de Anselmo
      "forge/backbone/apostoles/lucas.md",
      "forge/backbone/apostoles/marcos.md",
      "forge/backbone/apostoles/juan.md",
      "forge/backbone/apostoles/mateo.md",
    ];
    let out;
    try { out = filtra(files); } catch { out = filtra({ files }); }
    const kept = Array.isArray(out) ? out : (out && (out.conserva || out.keep || out.volcado));
    r.ok("devuelve la lista volcada", Array.isArray(kept));
    if (!Array.isArray(kept)) return;
    r.ok("incluye el plan de Lina", kept.some((p) => /plan/i.test(p)));
    r.ok("incluye los docs de Anselmo (backbone.md)", kept.some((p) => /backbone\.md$/i.test(p)));
    r.ok("EXCLUYE los cuatro libros de los apóstoles", kept.every((p) => !/(lucas|marcos|juan|mateo)\b/i.test(p)));
  });

  await r.step('[T-25-14] reanudación: un Miguel caído se reemplaza en la MISMA rama, no desde cero', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const decide = mod.decidirReanudacion || mod.reanudarMiguel || mod.trasCaidaMiguel
      || mod[keys.find((k) => typeof mod[k] === "function" && /(reanud|caid|reinten)/i.test(k))];
    r.ok("expone la decisión de reanudación de Miguel", typeof decide === "function");
    if (typeof decide !== "function") return;
    let res;
    try { res = decide({ caido: true, todosVerde: false, rama: "ciclo/recon-7" }); } catch { res = null; }
    r.ok("ante una caída devuelve una decisión", res && typeof res === "object");
    if (!res || typeof res !== "object") return;
    const acc = String(res.accion ?? res.action ?? "");
    r.ok("lanza OTRO Miguel (reanuda), no se rinde", res.reanudacion === true || res.relanzar === true || /reanud|relanz|lanzar|otro|continuar/i.test(acc));
    r.ok("marca que es reanudación (continúa, no desde cero)", res.reanudacion === true || /reanud/i.test(JSON.stringify(res)));
    r.eq("sigue en la MISMA rama (no crea una nueva)", res.rama ?? res.branch, "ciclo/recon-7");
    // borde: si ya estaban todos verdes, no hay nada que reanudar
    let fin;
    try { fin = decide({ caido: true, todosVerde: true, rama: "ciclo/recon-7" }); } catch { fin = null; }
    if (fin && typeof fin === "object") r.ok("con todos los tests en verde NO relanza", fin.reanudacion !== true && !/reanud|relanz/i.test(String(fin.accion ?? "")));
  });

  await r.step('[T-25-15] el ciclo es un fence: ejecuta los pasos en orden fijo y los 4 apóstoles en paralelo', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const pasosFn = mod.pasosCiclo || mod.pasos || mod.fence || mod.secuencia
      || mod[keys.find((k) => typeof mod[k] === "function" && /(paso|fence|secuenc|orden)/i.test(k))];
    r.ok("expone la secuencia de pasos del fence", typeof pasosFn === "function");
    if (typeof pasosFn !== "function") return;
    const pasos = pasosFn();
    r.ok("devuelve la lista de pasos (>=8)", Array.isArray(pasos) && pasos.length >= 8);
    if (!Array.isArray(pasos)) return;
    const texto = pasos.map((p) => (typeof p === "string" ? p : JSON.stringify(p)).toLowerCase());
    const idx = (re) => texto.findIndex((t) => re.test(t));
    const orden = {
      rama: idx(/rama|ciclo/),
      anselmo: idx(/anselmo|document/),
      apostoles: idx(/ap[oó]stol/),
      lina: idx(/lina/),
      gate: idx(/gate|oro/),
      limpieza: idx(/limpi/),
      volcado: idx(/volcad/),
      miguel: idx(/miguel/),
    };
    const sec = [orden.rama, orden.anselmo, orden.apostoles, orden.lina, orden.gate, orden.limpieza, orden.volcado, orden.miguel];
    r.ok("todos los pasos del fence están presentes", sec.every((i) => i >= 0));
    r.ok("orden fijo: rama→Anselmo→apóstoles→Lina→gate→limpieza→volcado→Miguel", sec.every((v, k) => k === 0 || sec[k - 1] < v));
    const pa = pasos[orden.apostoles];
    const paralelo = (pa && typeof pa === "object" && (pa.paralelo === true || pa.parallel === true || (Array.isArray(pa.apostoles) && pa.apostoles.length === 4) || pa.n === 4))
      || /paralel/i.test(JSON.stringify(pa));
    r.ok("los 4 apóstoles arrancan EN PARALELO (un solo paso fan-out, no 4 en serie)", paralelo);
  });

  await r.step('[T-25-16] el ciclo reutiliza la maquinaria existente de worktrees/merge/tests', async () => {
    const fs = await import("fs"); const path = await import("path"); const { fileURLToPath } = await import("url");
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; } };
    const src = read("scripts/reconstruir.js") + "\n" + read("scripts/lib/forge-recon.js") + "\n" + read("scripts/lib/forge-firme.js");
    r.ok("el orquestador del ciclo existe (reconstruir.js / forge-recon.js / forge-firme.js)", src.trim().length > 0);
    r.ok("reutiliza worktrees.js (no duplica la plomería de worktrees)", /worktrees/.test(src));
    r.ok("reutiliza forge-merge.js para fundir ramas", /forge-merge/.test(src));
    r.ok("reutiliza el runner de tests existente (run-forge.js / forge-tests / run.js)", /run-forge|forge-tests|run\.js/.test(src));
  });
}
