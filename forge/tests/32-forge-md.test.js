// tests/32-forge-md.test.js
//
// La diana del MOTOR MARKDOWN del cliente (public/forge/forge-md.js): el que
// convierte el texto de los mensajes y del plan de Aubé en DOM renderizado.
// Como el motor es código de NAVEGADOR (construye nodos del DOM), se prueba en un
// Chromium REAL con Playwright — no con un shim. Carga el MISMO fichero que sirve
// el forge en producción y comprueba el árbol que produce `mdToFragment`.
//
// Cubre: negrita/cursiva, código inline y bloques, títulos, listas (orden y no),
// citas, enlaces (y bloqueo de javascript:), seguridad anti-inyección (HTML crudo
// queda como TEXTO, nunca como nodo vivo), guion bajo intra-palabra (no es cursiva)
// y las miniaturas de pantallazo.
//
// Se ejecuta con:  node tests/run-forge.js 32

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORGE_MD = path.join(__dirname, '..', '..', 'public', 'forge', 'forge-md.js');

export const needsServer = false;

export async function run({ reporter: r }) {
  r.suite('32 — forge: motor markdown del cliente (forge-md.js, Chromium real)');

  const engine = fs.readFileSync(FORGE_MD, 'utf8');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    r.skip('lanzar Chromium (Playwright)', (e && e.message) || String(e));
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: engine });

    // Renderiza `md` y devuelve { html, hasEmHere, imgs, badImgs, links } para asertar.
    const render = (md) => page.evaluate((src) => {
      const div = document.createElement('div');
      div.appendChild(window.mdToFragment(src));
      return {
        html: div.innerHTML,
        ems: div.querySelectorAll('em').length,
        strongs: div.querySelectorAll('strong').length,
        codes: div.querySelectorAll('code').length,
        pres: div.querySelectorAll('pre').length,
        h2: div.querySelectorAll('h2').length,
        lis: div.querySelectorAll('li').length,
        uls: div.querySelectorAll('ul').length,
        ols: div.querySelectorAll('ol').length,
        quotes: div.querySelectorAll('blockquote').length,
        links: [...div.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent })),
        thumbs: div.querySelectorAll('img.thumb').length,
        injectedImgs: div.querySelectorAll('img[onerror], img[src="x"]').length,
        text: div.textContent,
      };
    }, md);

    await r.step('**negrita** → <strong>', async () => {
      const x = await render('esto es **negrita** ya');
      return x.strongs === 1 && x.html.includes('<strong>negrita</strong>');
    });

    await r.step('`código` inline → <code>', async () => {
      const x = await render('usa `forge-md.js` aquí');
      return x.codes === 1 && x.html.includes('<code>forge-md.js</code>');
    });

    await r.step('_cursiva_ en borde de palabra → <em>', async () => {
      const x = await render('un _matiz_ suave');
      return x.ems === 1 && x.html.includes('<em>matiz</em>');
    });

    await r.step('some_var_name NO es cursiva (guion bajo intra-palabra)', async () => {
      const x = await render('la variable some_var_name vale 3');
      return x.ems === 0 && x.text.includes('some_var_name');
    });

    await r.step('## Título → <h2>', async () => {
      const x = await render('## Mi título');
      return x.h2 === 1 && x.html.includes('<h2>Mi título</h2>');
    });

    await r.step('lista con - → <ul> con 2 <li>', async () => {
      const x = await render('- uno\n- dos');
      return x.uls === 1 && x.lis === 2;
    });

    await r.step('lista 1. 2. → <ol>', async () => {
      const x = await render('1. uno\n2. dos\n3. tres');
      return x.ols === 1 && x.lis === 3;
    });

    await r.step('bloque ```…``` → <pre><code> con el texto literal', async () => {
      const x = await render('antes\n```\nconst a = **no negrita**;\n```\ndespués');
      return x.pres === 1 && x.codes === 1 && x.html.includes('const a = **no negrita**;');
    });

    await r.step('cita > … → <blockquote>', async () => {
      const x = await render('> una cita');
      return x.quotes === 1 && x.text.includes('una cita');
    });

    await r.step('[texto](https) → <a href> con target/rel seguro', async () => {
      const x = await render('mira [el foro](https://neblla.com/foro) ahí');
      return x.links.length === 1 && x.links[0].href === 'https://neblla.com/foro'
        && x.links[0].text === 'el foro' && x.html.includes('rel="noopener noreferrer"');
    });

    await r.step('javascript: en enlace → BLOQUEADO (queda como texto)', async () => {
      const x = await render('[click](javascript:alert(1))');
      return x.links.length === 0 && x.text.includes('[click]');
    });

    await r.step('HTML crudo NO se inyecta (anti-XSS): queda como texto', async () => {
      const x = await render('peligro <img src=x onerror=alert(1)> fin');
      return x.injectedImgs === 0 && x.text.includes('<img src=x onerror=alert(1)>');
    });

    await r.step('<script> crudo no crea nodo <script>', async () => {
      const x = await render('hola <script>alert(1)<\/script> mundo');
      const has = await page.evaluate((src) => {
        const div = document.createElement('div');
        div.appendChild(window.mdToFragment(src));
        return div.querySelectorAll('script').length;
      }, 'hola <script>alert(1)<\/script> mundo');
      return has === 0 && x.text.includes('alert(1)');
    });

    await r.step('pantallazo → <img class="thumb">', async () => {
      const x = await render('mira pantallazos/pantallazo-7.png eso');
      return x.thumbs === 1;
    });

    await r.step('plan de Aubé realista: título + párrafo + lista + negrita juntos', async () => {
      const md = '## Plan\n\nVamos a tocar **dos** piezas:\n\n- el `endpoint` nuevo\n- el botón en `index.html`\n\nListo.';
      const x = await render(md);
      return x.h2 === 1 && x.strongs === 1 && x.lis === 2 && x.codes === 2;
    });

  } finally {
    await browser.close();
  }
}
