/*
 * forge-md.js — motor markdown → DOM del forge.
 *
 * Convierte texto (markdown) en nodos del DOM de forma SEGURA: construye
 * <p>/<strong>/<code>/… nunca con innerHTML de texto crudo, así nada se inyecta.
 * Cubre el subconjunto que usan Aubé y los agentes: títulos, **negrita**,
 * *cursiva*, `código`, bloques ```…```, listas, citas, enlaces y reglas. Las
 * rutas de pantallazo se siguen pintando como miniatura + lightbox.
 *
 * Script CLÁSICO (no módulo): cuelga sus funciones de `window` para que el
 * <script> principal de index.html las use, y para que el test Playwright las
 * llame en un Chromium real. `makeThumb` usa el `openLightbox` global que define
 * index.html (en el test se stubea).
 */
(function (global) {
  'use strict';

  var IMG_PATH = 'pantallazos\\/pantallazo-\\d+\\.(?:png|jpe?g|gif|webp)';
  var IMG_RE = new RegExp(IMG_PATH, 'g');
  var INLINE_RE = new RegExp(
    '(`[^`]+`)'                              // 1 código
    + '|(\\*\\*[\\s\\S]+?\\*\\*)'            // 2 **negrita**
    + '|((?<![\\w])__[\\s\\S]+?__(?![\\w]))' // 3 __negrita__ (solo en bordes de palabra)
    + '|(\\*(?!\\s)[^*\\n]+?\\*)'            // 4 *cursiva*
    + '|((?<![\\w])_(?!\\s)[^_\\n]+?_(?![\\w]))' // 5 _cursiva_ (no parte interna de una palabra)
    + '|(\\[[^\\]\\n]+\\]\\([^)\\s]+\\))'    // 6 [texto](url)
    + '|(' + IMG_PATH + ')',                 // 7 pantallazo
    'g');

  function safeHref(url) {
    var u = String(url).trim();
    return /^(https?:|mailto:|\/|#|\.)/i.test(u) ? u : null;   // bloquea javascript:, data:…
  }

  function makeThumb(src) {
    var img = document.createElement('img');
    img.className = 'thumb'; img.src = src; img.alt = src; img.loading = 'lazy';
    img.title = 'Clic para ver completo';
    img.onclick = function (ev) {
      ev.stopPropagation();
      if (typeof global.openLightbox === 'function') global.openLightbox(src);
    };
    return img;
  }

  // inline: parsea UNA línea (sin saltos) y cuelga nodos en `parent`.
  function inlineInto(parent, text) {
    // Regex LOCAL por llamada: INLINE_RE es global (flag `g`) y inlineInto se llama
    // a SÍ MISMO (negrita/cursiva/enlace recurren sobre su contenido). Con el regex
    // compartido, la recursión reseteaba `lastIndex` del padre → el bucle re-machacaba
    // el mismo match para siempre (cuelgue + OOM de la pestaña). Un clon por llamada
    // le da a cada nivel su propio `lastIndex` → reentrante y seguro.
    var re = new RegExp(INLINE_RE.source, INLINE_RE.flags);
    var s = String(text); var last = 0; var m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      var tok = m[0];
      if (m[1]) { var c = document.createElement('code'); c.textContent = tok.slice(1, -1); parent.appendChild(c); }
      else if (m[2] || m[3]) { var st = document.createElement('strong'); inlineInto(st, tok.slice(2, -2)); parent.appendChild(st); }
      else if (m[4] || m[5]) { var em = document.createElement('em'); inlineInto(em, tok.slice(1, -1)); parent.appendChild(em); }
      else if (m[6]) {
        var lm = tok.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
        var href = lm && safeHref(lm[2]);
        if (href) {
          var a = document.createElement('a');
          a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          inlineInto(a, lm[1]); parent.appendChild(a);
        } else parent.appendChild(document.createTextNode(tok));
      }
      else if (m[7]) parent.appendChild(makeThumb(tok));
      last = m.index + tok.length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }

  // inline conservando saltos de línea dentro de un mismo párrafo → <br>.
  function inlineBlock(parent, text) {
    var parts = String(text).split('\n');
    parts.forEach(function (p, i) {
      if (i > 0) parent.appendChild(document.createElement('br'));
      inlineInto(parent, p);
    });
  }

  function isBlockStart(line) {
    return /^\s*```/.test(line) || /^\s*#{1,6}\s+/.test(line) || /^\s*[-*+]\s+/.test(line)
      || /^\s*\d+[.)]\s+/.test(line) || /^\s*>\s?/.test(line) || /^\s*([-*_])\s*(\1\s*){2,}$/.test(line);
  }

  function mdToFragment(text) {
    var frag = document.createDocumentFragment();
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^\s*```/.test(line)) {                 // bloque de código ```…```
        i++; var cbuf = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { cbuf.push(lines[i]); i++; }
        i++;
        var pre = document.createElement('pre'); var code = document.createElement('code');
        code.textContent = cbuf.join('\n'); pre.appendChild(code); frag.appendChild(pre); continue;
      }
      var h = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) { var el = document.createElement('h' + Math.min(h[1].length, 6)); inlineInto(el, h[2].trim()); frag.appendChild(el); i++; continue; }
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { frag.appendChild(document.createElement('hr')); i++; continue; }
      if (/^\s*>\s?/.test(line)) {                // cita >…
        var qbuf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qbuf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        var bq = document.createElement('blockquote'); bq.appendChild(mdToFragment(qbuf.join('\n'))); frag.appendChild(bq); continue;
      }
      var isOl = /^\s*\d+[.)]\s+/.test(line);
      var isUl = /^\s*[-*+]\s+/.test(line);
      if (isOl || isUl) {                          // lista
        var listEl = document.createElement(isOl ? 'ol' : 'ul');
        var itemRe = isOl ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
        while (i < lines.length) {
          var mm = lines[i].match(itemRe);
          if (!mm) break;
          var li = document.createElement('li'); inlineInto(li, mm[1]); listEl.appendChild(li); i++;
        }
        frag.appendChild(listEl); continue;
      }
      var pbuf = [line]; i++;                       // párrafo (hasta blanco o nuevo bloque)
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) { pbuf.push(lines[i]); i++; }
      var p = document.createElement('p'); inlineBlock(p, pbuf.join('\n')); frag.appendChild(p);
    }
    return frag;
  }

  // Rellena un elemento renderizando markdown (mensajes, fichas…). Conserva las
  // miniaturas de pantallazo, que viven como nodos <img> dentro del inline.
  function fillBubble(el, text) {
    el.textContent = '';
    el.classList.add('md-rendered');
    el.appendChild(mdToFragment(text));
  }

  global.forgeMd = { mdToFragment: mdToFragment, fillBubble: fillBubble, inlineBlock: inlineBlock, inlineInto: inlineInto, safeHref: safeHref, IMG_RE: IMG_RE };
  // atajos directos (el script principal de index.html los usa sin prefijo):
  global.mdToFragment = mdToFragment;
  global.fillBubble = fillBubble;
  global.inlineBlock = inlineBlock;
  global.IMG_RE = IMG_RE;
})(typeof window !== 'undefined' ? window : this);
