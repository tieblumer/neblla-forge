// forge/tests/tarea-24.test.js
// GENERADO por el forge (herramienta escribir_test). No editar a mano: se
// reescribe entero cada vez que Ana Liz escribe/edita un test de esta tarea.
//
// Suite de la tarea 24 — Construir el "ciclo de reconstrucción" del forge: un orquestador que abre una rama nueva (todo el worktree pasa a la rama, no a master, para tener un master-vs-rama con qué comparar), hace que Anselmo documente todos los cambios en backbone + MCP, lanza 4 veces en paralelo al mismo apóstol con ángulos distintos (Lucas=tests, Marcos=definición, Juan=diff, Mateo=bordes/huecos) para verificar que la documentación está completa, deja que Lina+Ana Liz redacten plan y tests mirando solo tests+worktree de Anselmo, corre la batería nueva contra MASTER como "gate de oro", limpia de la rama todo el código que no sean los tests, vuelca plan+docs (sin los libros de los apóstoles), y suelta un Miguel gigante en ultracode que reprograma desde el código de master hasta que todos los tests pasan, con reanudación si se cae..

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('Tarea 24 — Construir el "ciclo de reconstrucción" del forge: un orquestador que abre una rama nueva (todo el worktree pasa a la rama, no a master, para tener un master-vs-rama con qué comparar), hace que Anselmo documente todos los cambios en backbone + MCP, lanza 4 veces en paralelo al mismo apóstol con ángulos distintos (Lucas=tests, Marcos=definición, Juan=diff, Mateo=bordes/huecos) para verificar que la documentación está completa, deja que Lina+Ana Liz redacten plan y tests mirando solo tests+worktree de Anselmo, corre la batería nueva contra MASTER como "gate de oro", limpia de la rama todo el código que no sean los tests, vuelca plan+docs (sin los libros de los apóstoles), y suelta un Miguel gigante en ultracode que reprograma desde el código de master hasta que todos los tests pasan, con reanudación si se cae.');
  await r.step('[T-24-01] anselmoDocPrompt arma la instrucción de documentar a fondo el diff', async () => {
    const { anselmoDocPrompt } = await import("../../scripts/lib/forge-prompts.js");
    r.ok("anselmoDocPrompt es una función", typeof anselmoDocPrompt === "function");
    const wt = "/wt/anselmo-7f3a";
    const base = "master";
    const obj = "el forge";
    const s = anselmoDocPrompt({ worktreeDir: wt, baseRef: base, objetivo: obj });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    r.ok("(a) manda leer el diff master-vs-rama usando baseRef", /diff/i.test(s) && /(master|rama|baseRef)/i.test(s));
    r.ok("(b) manda documentar TODAS las features en el backbone", /backbone/i.test(s) && /features?/i.test(s) && /(todas|todos|cada|a fondo)/i.test(s));
    r.ok("(b) manda reflejar los cambios en el MCP", /\bmcp\b/i.test(s));
    r.ok("(c) incrusta el worktreeDir recibido", s.includes(wt));
    r.ok("(c) incrusta el baseRef recibido", s.includes(base));
    r.ok("(c) incrusta el objetivo recibido", s.includes(obj));
  });

  await r.step('[T-24-02] apostolPrompt es una sola función con 4 ángulos distintos', async () => {
    const mod = await import("../../scripts/lib/forge-prompts.js");
    r.ok("se exporta UNA sola función apostolPrompt", typeof mod.apostolPrompt === "function");
    const wt = "/wt/anselmo-7f3a";
    const base = "master";
    const lucas = mod.apostolPrompt({ angulo: "lucas", worktreeDir: wt, baseRef: base });
    const marcos = mod.apostolPrompt({ angulo: "marcos", worktreeDir: wt, baseRef: base });
    const juan = mod.apostolPrompt({ angulo: "juan", worktreeDir: wt, baseRef: base });
    const mateo = mod.apostolPrompt({ angulo: "mateo", worktreeDir: wt, baseRef: base });
    const arr = [lucas, marcos, juan, mateo];
    r.ok("los cuatro son strings no vacíos", arr.every((x) => typeof x === "string" && x.length > 0));
    r.eq("los cuatro ángulos producen textos DISTINTOS entre sí", new Set(arr).size, 4);
    r.ok("lucas = los tests / qué se garantiza", /tests?/i.test(lucas) && /(garantiz|asegura|qu[eé] se)/i.test(lucas));
    r.ok("marcos = la definición / el porqué", /(definici|porqu|tarea)/i.test(marcos));
    r.ok("juan = el diff fichero a fichero", /diff/i.test(juan) && /fichero/i.test(juan));
    r.ok("mateo = bordes y huecos sin test", /(borde|hueco)/i.test(mateo) && /test/i.test(mateo));
  });

  await r.step('[T-24-03] cada ángulo del apóstol recibe el worktree de Anselmo y baseRef para el diff', async () => {
    const { apostolPrompt } = await import("../../scripts/lib/forge-prompts.js");
    const wt = "/wt/anselmo-91cc";
    const base = "master";
    for (const angulo of ["lucas", "marcos", "juan", "mateo"]) {
      const s = apostolPrompt({ angulo, worktreeDir: wt, baseRef: base });
      r.ok(`[${angulo}] devuelve un string no vacío`, typeof s === "string" && s.length > 0);
      r.ok(`[${angulo}] incrusta el worktreeDir de Anselmo`, s.includes(wt));
      r.ok(`[${angulo}] incrusta el baseRef para el diff master-vs-rama`, s.includes(base));
      r.ok(`[${angulo}] pide verificar que la documentación describe bien las features`, /(verific|comprob|confirm)/i.test(s) && /(document|backbone)/i.test(s) && /features?/i.test(s));
    }
  });

  await r.step('[T-24-04] apostolPrompt no revienta con un ángulo desconocido', async () => {
    const { apostolPrompt } = await import("../../scripts/lib/forge-prompts.js");
    // ángulo desconocido: NO debe reventar
    let threw = false, out;
    try { out = apostolPrompt({ angulo: "judas", worktreeDir: "/wt/x", baseRef: "master" }); }
    catch (e) { threw = true; }
    r.ok("un ángulo desconocido NO lanza excepción", threw === false);
    r.ok("un ángulo desconocido devuelve un string (degradación segura)", typeof out === "string" && out.length > 0);
    // ángulo vacío: igual de robusto
    let threw2 = false, out2;
    try { out2 = apostolPrompt({ angulo: "", worktreeDir: "/wt/x", baseRef: "master" }); }
    catch (e) { threw2 = true; }
    r.ok("un ángulo vacío tampoco lanza", threw2 === false);
    r.ok("un ángulo vacío devuelve un string", typeof out2 === "string" && out2.length > 0);
  });

  await r.step('[T-24-05] linaReconPrompt convierte la lista de Mateo en tests obligatorios y limita la vista', async () => {
    const { linaReconPrompt } = await import("../../scripts/lib/forge-prompts.js");
    const huecos = ["no hay test del gate en rojo", "falta cubrir el ángulo inválido del apóstol"];
    const s = linaReconPrompt({ testsDir: "/wt/tests", docsDir: "/wt/backbone", huecosMateo: huecos });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    // (a) los huecos de Mateo como entrada OBLIGATORIA que se vuelve tests nuevos
    r.ok("marca los huecos de Mateo como OBLIGATORIOS", /obligator/i.test(s));
    r.ok("enumera el primer hueco de Mateo", s.includes(huecos[0]));
    r.ok("enumera el segundo hueco de Mateo", s.includes(huecos[1]));
    r.ok("dice que los huecos se vuelven tests nuevos", /tests?/i.test(s));
    // (b) planificar mirando SOLO los tests + el worktree/docs de Anselmo
    r.ok("referencia testsDir (lo que SÍ puede mirar)", s.includes("/wt/tests"));
    r.ok("referencia docsDir (worktree/documentación de Anselmo)", s.includes("/wt/backbone"));
    r.ok("acota la vista: SOLO tests+docs, no el código vivo", /\bsolo\b/i.test(s) && /(c[oó]digo\s+vivo|no\s+(mires|leas|el\s+c[oó]digo))/i.test(s));
  });

  await r.step('[T-24-06] miguelGigantePrompt ordena reconstruir en ultracode desde el código de master', async () => {
    const { miguelGigantePrompt } = await import("../../scripts/lib/forge-prompts.js");
    const s = miguelGigantePrompt({ rama: "ciclo/recon-3", planPath: "/wt/plan-recon.md", docsDir: "/wt/backbone", masterRef: "master", reanudacion: false });
    r.ok("devuelve un string no vacío", typeof s === "string" && s.length > 0);
    r.ok("pide esfuerzo ultracode", /ultracode/i.test(s));
    r.ok("parte del código de masterRef", s.includes("master") && /(master|partiendo|desde el c[oó]digo)/i.test(s));
    r.ok("usa el plan (planPath) como brújula", s.includes("/wt/plan-recon.md"));
    r.ok("usa los docs (docsDir) como brújula", s.includes("/wt/backbone"));
    r.ok("manda reconstruir hasta que TODOS los tests pasen", /tests?/i.test(s) && /(todos|pasen|verde)/i.test(s));
    r.ok("incrusta la rama", s.includes("ciclo/recon-3"));
  });

  await r.step('[T-24-07] la variante de reanudación de Miguel cambia el texto', async () => {
    const { miguelGigantePrompt } = await import("../../scripts/lib/forge-prompts.js");
    const base = { rama: "ciclo/recon-3", planPath: "/wt/plan-recon.md", docsDir: "/wt/backbone", masterRef: "master" };
    const fresco = miguelGigantePrompt({ ...base, reanudacion: false });
    const reanuda = miguelGigantePrompt({ ...base, reanudacion: true });
    r.ok("ambos son strings no vacíos", typeof fresco === "string" && fresco.length > 0 && typeof reanuda === "string" && reanuda.length > 0);
    r.ok("los dos strings DIFIEREN", fresco !== reanuda);
    r.ok("reanudacion:true incluye 'seguir desde donde lo dejó'", /(sigue|contin[uú]a|donde lo dej|donde se qued|reanud)/i.test(reanuda));
    r.ok("reanudacion:true insiste en la MISMA rama (no empezar de cero)", reanuda.includes(base.rama) && /(misma rama|no empieces|no empezar|no desde cero)/i.test(reanuda));
    r.ok("reanudacion:false NO incluye la consigna de reanudar", !/(donde lo dej|donde se qued|reanud)/i.test(fresco));
  });

  await r.step('[T-24-08] los prompt-builders son puros y deterministas', async () => {
    const mod = await import("../../scripts/lib/forge-prompts.js");
    // determinismo: dos llamadas con los mismos args → el MISMO string
    const casos = [
      () => mod.anselmoDocPrompt({ worktreeDir: "/wt/a", baseRef: "master", objetivo: "el forge" }),
      () => mod.apostolPrompt({ angulo: "mateo", worktreeDir: "/wt/a", baseRef: "master" }),
      () => mod.linaReconPrompt({ testsDir: "/wt/tests", docsDir: "/wt/docs", huecosMateo: ["x"] }),
      () => mod.miguelGigantePrompt({ rama: "r", planPath: "/p", docsDir: "/d", masterRef: "master", reanudacion: false }),
    ];
    for (const f of casos) {
      const a = f(); const b = f();
      r.ok("misma entrada → mismo string (determinista)", typeof a === "string" && a.length > 0 && a === b);
    }
    // pureza por fuente: el módulo NO lee env ni toca disco (Contrato B)
    const fs = await import("fs"); const path = await import("path"); const { fileURLToPath } = await import("url");
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "forge-prompts.js"), "utf8");
    r.ok("forge-prompts.js no lee process.env", !/process\.env/.test(src));
    r.ok("forge-prompts.js no importa fs (no toca disco)", !/from\s+['\"]fs['\"]/.test(src) && !/require\(['\"]fs['\"]\)/.test(src));
  });

  await r.step('[T-24-09] abre rama de ciclo, mueve el worktree a ella y guarda baseRef=master', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo expone algo (forge-recon.js / forge-firme.js)", keys.length > 0);
    const fn = mod.abrirCiclo || mod.planCiclo || mod.nuevaRamaCiclo || mod.crearRamaCiclo
      || mod[keys.find((k) => typeof mod[k] === "function" && /(abrir|nueva|crear|plan).*(rama|ciclo)|ciclo$/i.test(k))];
    r.ok("expone un planificador de apertura del ciclo (paso 1)", typeof fn === "function");
    if (typeof fn !== "function") return;
    let res;
    try { res = fn({ baseBranch: "master" }); } catch { try { res = fn(); } catch { res = null; } }
    r.ok("devuelve un descriptor del ciclo", res && typeof res === "object");
    if (!res || typeof res !== "object") return;
    const baseRef = res.baseRef ?? res.base ?? res.baseRev;
    const rama = res.rama ?? res.branch ?? res.ramaCiclo;
    r.eq("registra baseRef = master (para diffear master-vs-rama)", baseRef, "master");
    r.ok("crea una rama de ciclo nueva, distinta de master (el worktree pasa a ELLA)", typeof rama === "string" && rama.length > 0 && rama !== "master");
  });

  await r.step('[T-24-10] el orquestador es un fence: ejecuta los pasos en orden fijo 1→9', async () => {
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
      lina: idx(/lina|ana\s*liz|tests?/),
      gate: idx(/gate|oro/),
      limpieza: idx(/limpi/),
      volcado: idx(/volcad/),
      miguel: idx(/miguel/),
    };
    const sec = [orden.rama, orden.anselmo, orden.apostoles, orden.lina, orden.gate, orden.limpieza, orden.volcado, orden.miguel];
    r.ok("todos los pasos del fence están presentes", sec.every((i) => i >= 0));
    r.ok("orden fijo 1→9: rama→Anselmo→apóstoles→Lina/AnaLiz→gate→limpieza→volcado→Miguel", sec.every((v, k) => k === 0 || sec[k - 1] < v));
  });

  await r.step('[T-24-11] lanza los 4 apóstoles EN PARALELO, mismo apóstol, 4 ángulos', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const pasosFn = mod.pasosCiclo || mod.pasos || mod.fence || mod.secuencia
      || mod[keys.find((k) => typeof mod[k] === "function" && /(paso|fence|secuenc|orden)/i.test(k))];
    r.ok("expone la secuencia de pasos", typeof pasosFn === "function");
    if (typeof pasosFn !== "function") return;
    const pasos = pasosFn();
    if (!Array.isArray(pasos)) { r.ok("pasos es un array", false); return; }
    const i = pasos.findIndex((p) => /ap[oó]stol/i.test(typeof p === "string" ? p : JSON.stringify(p)));
    r.ok("hay un paso de apóstoles", i >= 0);
    const pa = pasos[i];
    // fan-out de 4 EN PARALELO, mismo apóstol, 4 ángulos
    const paralelo = (pa && typeof pa === "object" && (pa.paralelo === true || pa.parallel === true || (Array.isArray(pa.apostoles) && pa.apostoles.length === 4) || pa.n === 4))
      || /paralel/i.test(JSON.stringify(pa));
    r.ok("los 4 apóstoles arrancan EN PARALELO (un solo paso fan-out, no 4 en serie)", paralelo);
    const json = JSON.stringify(pa).toLowerCase();
    const angulos = ["lucas", "marcos", "juan", "mateo"];
    r.ok("el paso nombra los 4 ángulos (lucas/marcos/juan/mateo)", angulos.every((a) => json.includes(a)) || (pa && pa.n === 4) || (Array.isArray(pa.apostoles) && pa.apostoles.length === 4));
  });

  await r.step('[T-24-12] gate de oro verde deja continuar el ciclo', async () => {
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
    const verde = gate({ pass: 17, fail: 0 });
    const accV = String(verde && (verde.accion ?? verde.action ?? verde));
    r.ok("gate verde (0 fallos) → el ciclo CONTINÚA hacia limpieza/volcado/Miguel", /continu|seguir|avanz|ok|true/i.test(accV) || verde === true || (verde && verde.ok === true));
  });

  await r.step('[T-24-13] gate de oro rojo aborta el ciclo y no lanza a Miguel', async () => {
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
    const rojo = gate({ pass: 15, fail: 2 });
    const accR = String(rojo && (rojo.accion ?? rojo.action ?? rojo));
    r.ok("gate rojo (algún fallo) → el ciclo ABORTA (no limpia, no vuelca, NO lanza a Miguel)", /abort|parar|detener|stop|fail|false/i.test(accR) || rojo === false || (rojo && rojo.ok === false));
    // y que verde y rojo den veredictos distintos
    const verde = gate({ pass: 17, fail: 0 });
    r.ok("verde y rojo dan veredictos DISTINTOS", JSON.stringify(verde) !== JSON.stringify(rojo));
  });

  await r.step('[T-24-14] la limpieza deja en la rama solo los tests', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const limpia = mod.planLimpieza || mod.limpiezaRama || mod.limpiarRama
      || mod[keys.find((k) => typeof mod[k] === "function" && /limpi/i.test(k))];
    r.ok("expone el plan de limpieza de la rama (paso 6)", typeof limpia === "function");
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
    r.ok("borra (no conserva) el código que no es test", !conserva.includes("scripts/reconstruir.js") && !conserva.includes("public/forge/index.html"));
  });

  await r.step('[T-24-15] el volcado lleva plan+docs pero NO los libros de los apóstoles', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const filtra = mod.filtrarVolcado || mod.volcadoFinal || mod.excluyeLibrosApostoles
      || mod[keys.find((k) => typeof mod[k] === "function" && /(volcad|apostol|libro)/i.test(k))];
    r.ok("expone el filtro del volcado (paso 7)", typeof filtra === "function");
    if (typeof filtra !== "function") return;
    const files = [
      "forge/backbone/plan-recon.md",
      "forge/backbone/backbone.md",
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
    r.ok("EXCLUYE los 4 libros de los apóstoles (lucas/marcos/juan/mateo)", kept.every((p) => !/(lucas|marcos|juan|mateo)\b/i.test(p)));
  });

  await r.step('[T-24-16] reanudación: si Miguel cae, otro sigue en la misma rama', async () => {
    let mod = {};
    for (const p of ["../../scripts/lib/forge-recon.js", "../../scripts/lib/forge-firme.js"]) {
      try { Object.assign(mod, await import(p)); } catch {}
    }
    const keys = Object.keys(mod);
    r.ok("el cerebro del ciclo existe", keys.length > 0);
    const decide = mod.decidirReanudacion || mod.reanudarMiguel || mod.trasCaidaMiguel
      || mod[keys.find((k) => typeof mod[k] === "function" && /(reanud|caid|reinten)/i.test(k))];
    r.ok("expone la decisión de reanudación de Miguel (paso 9)", typeof decide === "function");
    if (typeof decide !== "function") return;
    let res;
    try { res = decide({ caido: true, todosVerde: false, rama: "ciclo/recon-7" }); } catch { res = null; }
    r.ok("ante una caída devuelve una decisión", res && typeof res === "object");
    if (!res || typeof res !== "object") return;
    const acc = String(res.accion ?? res.action ?? "");
    r.ok("lanza OTRO Miguel (no se rinde)", res.reanudacion === true || res.relanzar === true || /reanud|relanz|lanzar|otro|continuar/i.test(acc));
    r.ok("marca que es reanudación (continúa, no desde cero)", res.reanudacion === true || /reanud/i.test(JSON.stringify(res)));
    r.eq("sigue en la MISMA rama (no crea otra)", res.rama ?? res.branch, "ciclo/recon-7");
  });

  await r.step('[T-24-17] Anselmo y Miguel trabajan cada uno en su propio worktree', async () => {
    const fs = await import("fs"); const path = await import("path"); const { fileURLToPath } = await import("url");
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; } };
    const src = read("scripts/reconstruir.js") + "\n" + read("scripts/lib/forge-recon.js") + "\n" + read("scripts/lib/forge-firme.js");
    r.ok("el orquestador del ciclo existe (reconstruir.js / forge-recon.js / forge-firme.js)", src.trim().length > 0);
    // reutiliza la plomería de worktrees (no la duplica) para aislar a Anselmo (paso 2) y a Miguel (paso 8)
    r.ok("reutiliza worktrees.js para dar a cada uno su PROPIO worktree", /worktrees/.test(src));
    r.ok("crea/desmonta worktrees con la plomería existente (worktrees.js / forge-merge.js)", /worktrees/.test(src) && /forge-merge/.test(src));
    // y que Anselmo y Miguel aparezcan como dueños de worktree en el ciclo
    r.ok("el ciclo menciona a Anselmo y a Miguel (cada uno con su worktree)", /anselmo/i.test(src) && /miguel/i.test(src));
  });
}
