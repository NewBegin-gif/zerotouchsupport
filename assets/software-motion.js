/* SoftwareMotion 2.1 — decoratieve Canvas 2D-achtergrond voor de homepage-hero.
   Gebaseerd op het v2-concept (26 sep 2026). Verschillen met v2:
   - stilstaande lagen (gloed, raster, ellipsen, kaartframes) worden één keer
     getekend en daarna als afbeelding hergebruikt; per beeld worden alleen de
     bewegende delen getekend. Geen shadowBlur meer tijdens de animatie.
   - smal (<1100 px): alleen het netwerk, zonder kaarten, gecentreerd en gedimd,
     zodat niets achter de koptekst of knoppen verschijnt.
   - geen paginateksten in de renderer; de pagina houdt haar eigen inhoud.
   - roundRect heeft een terugval voor oudere Safari.
   Automatisch: elk <canvas data-software-motion="ai|office|marketing|support">
   wordt gestart; een knop met data-motion-toggle="<canvas-id>" pauzeert/hervat.
   data-clear-of="<selector>": kaarten blijven 40 px rechts van die elementen.
   data-layout="network": alleen het netwerk, nooit kaarten (voor een hero met eigen illustratie).
   Eén bron: aibuildermarketplace-main/assets/software-motion.js; de zusters dragen een
   identieke kopie (invariant motion-kopieen-gelijk). Wijzig alleen de bron en kopieer. */
(function (global) {
  'use strict';
  var THEMES = {
    ai: { a: [151, 135, 255], b: [82, 188, 255], cards: ['RESEARCH', 'COMPARE', 'YOUR SHORTLIST'], icons: ['code', 'grid', 'check'] },
    office: { a: [107, 180, 244], b: [87, 215, 200], cards: ['DOCUMENTS', 'WORKFLOW', 'YOUR WORKSPACE'], icons: ['doc', 'grid', 'check'] },
    marketing: { a: [232, 158, 102], b: [219, 127, 183], cards: ['AUDIENCE', 'CAMPAIGNS', 'YOUR NEXT STEP'], icons: ['people', 'chart', 'check'] },
    support: { a: [85, 208, 186], b: [91, 165, 243], cards: ['CONVERSATIONS', 'CONTEXT', 'YOUR SUPPORT STACK'], icons: ['chat', 'grid', 'check'] }
  };
  var NODES = [[-240, -160], [-165, 96], [118, -31], [225, 185], [-12, 223], [100, -236], [-320, 13], [285, -161]];
  var EDGES = [[0, 2], [1, 2], [2, 3], [1, 4], [0, 5], [6, 1], [5, 7], [7, 2], [4, 3]];
  var CARDS = [[0, -60, -65, 200, 144], [2, -53, -48, 216, 141], [1, -35, 10, 231, 132]]; // [node, dx, dy, w, h]
  var WIDE = 1100;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function canvasOf(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function mount(canvas, options) {
    options = options || {};
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('SoftwareMotion requires a canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var key = has(THEMES, options.theme) ? options.theme : 'ai', theme = THEMES[key];
    var speed = clamp(Number(options.speed) || 0.6, 0.1, 2), intensity = clamp(Number(options.intensity) || 0.9, 0.4, 2);
    var reduced = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var paused = options.paused === undefined ? reduced.matches : !!options.paused;
    var w = 0, h = 0, dpr = 1, time = 0, last = 0, raf = 0, destroyed = false, visible = false;
    var wide = true, cx = 0, cy = 0, scale = 1, dim = 1;
    var staticLayer = null, cardSprites = [], glowSprite = null;
    var seed = 21;
    function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var dust = []; for (var d = 0; d < 45; d++) dust.push({ x: rand(), y: rand(), s: 0.5 + rand() * 1.2, p: rand() * 6.28 });

    function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.min(1, a * intensity * dim) + ')'; }
    function state() { return { theme: key, paused: paused, running: !!raf, visible: visible, speed: speed, intensity: intensity, reducedMotion: reduced.matches, destroyed: destroyed, layout: wide ? 'wide' : 'narrow' }; }
    function announce() { try { canvas.dispatchEvent(new CustomEvent('motionchange', { detail: state() })); } catch (e) { /* oude browser */ } }

    function icon(c, type, x, y) {
      c.save(); c.translate(x, y); c.strokeStyle = rgba(theme.a, 0.85); c.lineWidth = 1.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
      if (type === 'code') { c.moveTo(-5, -6); c.lineTo(-11, 0); c.lineTo(-5, 6); c.moveTo(5, -6); c.lineTo(11, 0); c.lineTo(5, 6); c.moveTo(2, -9); c.lineTo(-2, 9); c.stroke(); }
      else if (type === 'check') { c.moveTo(-8, 0); c.lineTo(-2, 6); c.lineTo(9, -7); c.stroke(); }
      else if (type === 'chat') { roundRect(c, -11, -9, 22, 15, 4); c.stroke(); c.beginPath(); c.moveTo(-5, 6); c.lineTo(-9, 12); c.lineTo(2, 6); c.stroke(); }
      else if (type === 'doc') { roundRect(c, -8, -11, 16, 23, 2); c.stroke(); c.beginPath(); c.moveTo(-4, -4); c.lineTo(4, -4); c.moveTo(-4, 1); c.lineTo(4, 1); c.moveTo(-4, 6); c.lineTo(1, 6); c.stroke(); }
      else if (type === 'chart') { c.moveTo(-10, 8); c.lineTo(-10, 1); c.moveTo(-3, 8); c.lineTo(-3, -4); c.moveTo(4, 8); c.lineTo(4, -8); c.moveTo(11, 8); c.lineTo(11, -2); c.stroke(); }
      else if (type === 'people') { c.arc(0, -5, 4, 0, Math.PI * 2); c.moveTo(-9, 10); c.bezierCurveTo(-9, 0, 9, 0, 9, 10); c.stroke(); }
      else { for (var i = 0; i < 4; i++) { roundRect(c, -10 + (i % 2) * 12, -10 + Math.floor(i / 2) * 12, 7, 7, 1); c.stroke(); } }
      c.restore();
    }

    // Kaartframe (alles behalve de bewegende staafjes) op een eigen canvas, één keer.
    function makeCard(index, cw, ch) {
      var pad = 40, k = scale * dpr, c = canvasOf((cw + pad * 2) * k, (ch + pad * 2) * k).getContext('2d');
      c.scale(k, k); c.translate(pad, pad);
      var fill = c.createLinearGradient(0, 0, cw, ch); fill.addColorStop(0, 'rgba(25,30,48,.89)'); fill.addColorStop(1, 'rgba(11,16,28,.9)');
      c.shadowBlur = 35; c.shadowColor = rgba(theme.a, 0.065); roundRect(c, 0, 0, cw, ch, 13); c.fillStyle = fill; c.fill(); c.shadowBlur = 0;
      c.strokeStyle = rgba(theme.a, 0.24); c.lineWidth = 0.8; c.stroke();
      c.fillStyle = rgba(theme.a, 0.08); roundRect(c, 17, 17, 37, 37, 9); c.fill(); icon(c, theme.icons[index], 35, 35);
      c.fillStyle = '#a7afca'; c.font = '9px system-ui,-apple-system,sans-serif';
      var label = theme.cards[index], x = 65; for (var i = 0; i < label.length; i++) { c.fillText(label[i], x, 31); x += c.measureText(label[i]).width + 1.3; }
      c.fillStyle = rgba(theme.a, 0.25); roundRect(c, 65, 42, cw - 91, 3, 1.5); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.05)'; c.beginPath(); c.moveTo(18, 68); c.lineTo(cw - 18, 68); c.stroke();
      if (index === 0) { for (var j = 0; j < 3; j++) { c.fillStyle = rgba(theme.a, 0.3); c.beginPath(); c.arc(23, 87 + j * 16, 2, 0, Math.PI * 2); c.fill(); c.fillStyle = j === 0 ? rgba(theme.a, 0.38) : 'rgba(66,76,102,.5)'; roundRect(c, 33, 85 + j * 16, (cw - 63) * [0.85, 0.6, 0.73][j], 3, 1.5); c.fill(); } }
      else if (index === 2) { for (var m = 0; m < 3; m++) { c.strokeStyle = rgba(theme.a, 0.15); roundRect(c, 18 + m * ((cw - 34) / 3), 83, ((cw - 44) / 3) - 4, 29, 6); c.stroke(); c.fillStyle = rgba(theme.a, 0.6); c.beginPath(); c.arc(31 + m * ((cw - 34) / 3), 98, 2.5, 0, Math.PI * 2); c.fill(); } }
      return { img: c.canvas, pad: pad, w: cw, h: ch };
    }

    // Rechterrand (in canvas-px) van de elementen die vrij moeten blijven (optie clearOf, een CSS-selector).
    function textRight() {
      if (!options.clearOf) return 0;
      var els = document.querySelectorAll(options.clearOf), cr = canvas.getBoundingClientRect(), r = 0;
      for (var i = 0; i < els.length; i++) { var b = els[i].getBoundingClientRect(); if (b.width) r = Math.max(r, b.right - cr.left); }
      return r;
    }

    function buildLayers() {
      wide = w >= WIDE && options.layout !== 'network'; // 'network': nooit kaarten (hero met eigen illustratie)
      if (wide) {
        cx = w * 0.76; cy = h * 0.5; scale = clamp(Math.min(w / 1350, h / 620), 0.6, 1.15); dim = 1;
        // Houd de kaarten rechts van de paginatekst: linkerrand kaarten = cx - 300*scale,
        // rechterrand = cx + 281*scale. Past het niet vanaf schaal 0,58, dan de smalle weergave.
        var clearX = textRight();
        if (clearX) {
          var room = (w - 16 - clearX - 40) / 581;
          if (room < 0.58) wide = false;
          else { scale = Math.min(scale, room); cx = Math.max(cx, clearX + 40 + 300 * scale); }
        }
      }
      if (!wide) { cx = w * 0.5; cy = h * 0.52; scale = clamp(Math.min(w / 760, h / 900), 0.45, 0.9); dim = w < 600 ? 0.6 : 0.85; }
      // statische laag: gloed, raster, ellipsen
      var s = canvasOf(w * dpr, h * dpr).getContext('2d');
      s.setTransform(dpr, 0, 0, dpr, 0, 0); s.translate(cx, cy); s.scale(scale, scale);
      var glow = s.createRadialGradient(0, 0, 0, 0, 0, 480); glow.addColorStop(0, rgba(theme.a, 0.10)); glow.addColorStop(0.5, rgba(theme.b, 0.035)); glow.addColorStop(1, rgba(theme.a, 0));
      s.fillStyle = glow; s.fillRect(-600, -550, 1200, 1100);
      s.save(); s.rotate(-0.24); s.strokeStyle = rgba(theme.a, 0.055); s.lineWidth = 0.8; s.beginPath();
      for (var i = -8; i <= 8; i++) { s.moveTo(i * 49, -400); s.lineTo(i * 49, 400); s.moveTo(-470, i * 49); s.lineTo(470, i * 49); }
      s.stroke(); s.restore();
      for (var e = 0; e < 3; e++) { s.beginPath(); s.ellipse(0, 0, 210 + e * 60, 150 + e * 47, -0.38, 0, Math.PI * 2); s.strokeStyle = rgba(theme.a, 0.07 - e * 0.014); s.stroke(); }
      staticLayer = s.canvas;
      cardSprites = wide ? CARDS.map(function (cd, idx) { return makeCard(idx, cd[3], cd[4]); }) : [];
      // gloeiend puntje als afbeelding in plaats van shadowBlur per beeld
      var g = canvasOf(28 * dpr, 28 * dpr).getContext('2d'); g.scale(dpr, dpr);
      var rg = g.createRadialGradient(14, 14, 0, 14, 14, 14); rg.addColorStop(0, rgba(theme.a, 0.75)); rg.addColorStop(0.18, rgba(theme.a, 0.55)); rg.addColorStop(0.45, rgba(theme.a, 0.12)); rg.addColorStop(1, rgba(theme.a, 0));
      g.fillStyle = rg; g.fillRect(0, 0, 28, 28); glowSprite = g.canvas;
    }

    function dot(x, y, r, a) { ctx.fillStyle = rgba(theme.a, a); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

    function draw() {
      if (!staticLayer) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(staticLayer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(cx, cy); ctx.scale(scale, scale);
      var sh = NODES.map(function (p, i) { return [p[0] + Math.sin(time * 0.17 + i) * 8, p[1] + Math.cos(time * 0.21 + i) * 9]; });
      ctx.lineWidth = 0.85; ctx.strokeStyle = rgba(theme.a, 0.18); ctx.beginPath();
      for (var i = 0; i < EDGES.length; i++) { var a = sh[EDGES[i][0]], b = sh[EDGES[i][1]], bend = (i % 2 ? 1 : -1) * 36; ctx.moveTo(a[0], a[1]); ctx.bezierCurveTo(a[0] + 70, a[1] + bend, b[0] - 70, b[1] - bend, b[0], b[1]); }
      ctx.stroke();
      for (var k = 0; k < EDGES.length; k++) {
        var p0 = sh[EDGES[k][0]], p1 = sh[EDGES[k][1]], bd = (k % 2 ? 1 : -1) * 36, t = (time * 0.055 + k * 0.19) % 1, q = 1 - t;
        var px = q * q * q * p0[0] + 3 * q * q * t * (p0[0] + 70) + 3 * q * t * t * (p1[0] - 70) + t * t * t * p1[0];
        var py = q * q * q * p0[1] + 3 * q * q * t * (p0[1] + bd) + 3 * q * t * t * (p1[1] - bd) + t * t * t * p1[1];
        ctx.drawImage(glowSprite, px - 14, py - 14, 28, 28);
      }
      ctx.strokeStyle = rgba(theme.a, 0.15); ctx.beginPath();
      for (var n = 0; n < sh.length; n++) { ctx.moveTo(sh[n][0] + 8, sh[n][1]); ctx.arc(sh[n][0], sh[n][1], 8, 0, Math.PI * 2); }
      ctx.stroke();
      ctx.fillStyle = rgba(theme.a, 0.65); ctx.beginPath();
      for (var m = 0; m < sh.length; m++) { ctx.moveTo(sh[m][0] + 2.2, sh[m][1]); ctx.arc(sh[m][0], sh[m][1], 2.2, 0, Math.PI * 2); }
      ctx.fill();
      for (var c = 0; c < cardSprites.length; c++) {
        var cd = CARDS[c], sp = cardSprites[c], x = sh[cd[0]][0] + cd[1], y = sh[cd[0]][1] + cd[2];
        ctx.drawImage(sp.img, x - sp.pad, y - sp.pad, sp.w + sp.pad * 2, sp.h + sp.pad * 2);
        if (c === 1) { for (var j = 0; j < 9; j++) { var ht = 11 + Math.sin(j * 0.9 + time * 0.18) * 7 + j * 2; ctx.fillStyle = rgba(j > 5 ? theme.b : theme.a, 0.16 + j * 0.035); roundRect(ctx, x + 21 + j * ((sp.w - 44) / 9), y + sp.h - 20 - ht, 9, ht, 2); ctx.fill(); } }
      }
      for (var z = 0; z < dust.length; z++) { var pd = dust[z]; dot((pd.x - 0.5) * 880 + Math.sin(time * 0.1 + pd.p) * 6, (pd.y - 0.5) * 770 + Math.cos(time * 0.12 + pd.p) * 7, pd.s, 0.12 + 0.08 * Math.sin(time * 0.25 + pd.p)); }
    }

    var minFrame = 1000 / (Number(options.fps) || 30);
    function tick(stamp) {
      raf = 0; if (!allowed()) return;
      if (!last) last = stamp;
      var elapsed = stamp - last;
      if (elapsed >= minFrame) { time += Math.min(elapsed, 70) / 1000 * speed; last = stamp; draw(); }
      raf = global.requestAnimationFrame(tick);
    }
    function allowed() { return !destroyed && !paused && !document.hidden && visible; }
    function reconcile() { if (allowed()) { if (!raf) { last = 0; raf = global.requestAnimationFrame(tick); } } else { global.cancelAnimationFrame(raf); raf = 0; last = 0; } announce(); }
    function resize() {
      if (destroyed) return;
      var nw = canvas.clientWidth, nh = canvas.clientHeight, nd = Math.min(global.devicePixelRatio || 1, options.maxDpr || 1.5);
      if (nw === w && nh === h && nd === dpr && staticLayer) return;
      w = nw; h = nh; dpr = nd; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      buildLayers(); draw(); announce();
    }
    function onVisibility() { reconcile(); }
    function onReduced(e) { paused = e.matches; reconcile(); }
    var ro = global.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas); else global.addEventListener('resize', resize);
    var io = global.IntersectionObserver ? new IntersectionObserver(function (en) { visible = en[0].isIntersecting; reconcile(); }, { threshold: 0 }) : null;
    if (io) io.observe(canvas); else visible = true;
    document.addEventListener('visibilitychange', onVisibility);
    if (reduced.addEventListener) reduced.addEventListener('change', onReduced);
    resize(); reconcile();

    return {
      getState: state,
      setTheme: function (v) { if (destroyed || !has(THEMES, v)) return; key = v; theme = THEMES[v]; buildLayers(); draw(); announce(); },
      setSpeed: function (v) { if (destroyed || !isFinite(Number(v))) return; speed = clamp(Number(v), 0.1, 2); announce(); },
      setIntensity: function (v) { if (destroyed || !isFinite(Number(v))) return; intensity = clamp(Number(v), 0.4, 2); buildLayers(); draw(); announce(); },
      pause: function () { if (destroyed) return; paused = true; reconcile(); },
      play: function () { if (destroyed) return; paused = false; reconcile(); },
      destroy: function () {
        if (destroyed) return; destroyed = true; global.cancelAnimationFrame(raf); raf = 0;
        if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
        if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVisibility);
        if (reduced.removeEventListener) reduced.removeEventListener('change', onReduced); announce();
      }
    };
  }

  function autostart() {
    var PREF = 'software-motion-paused', stored = null;
    try { stored = global.localStorage.getItem(PREF); } catch (e) { stored = null; }
    var list = document.querySelectorAll('canvas[data-software-motion]');
    for (var i = 0; i < list.length; i++) {
      (function (cv) {
        var opts = { theme: cv.getAttribute('data-software-motion'), speed: Number(cv.getAttribute('data-speed')) || 0.6, intensity: Number(cv.getAttribute('data-intensity')) || 0.9, clearOf: cv.getAttribute('data-clear-of') || '', layout: cv.getAttribute('data-layout') || '' };
        if (stored === '1') opts.paused = true;
        var bg; try { bg = mount(cv, opts); } catch (e) { return; }
        if (!bg || !cv.id) return;
        var btn = document.querySelector('[data-motion-toggle="' + cv.id + '"]');
        if (!btn) return;
        function update() { var s = bg.getState(); btn.setAttribute('aria-pressed', String(s.paused)); btn.setAttribute('data-state', s.paused ? 'paused' : 'playing'); var lbl = btn.querySelector('[data-motion-label]'); if (lbl) lbl.textContent = s.paused ? 'Play animation' : 'Pause animation'; }
        cv.addEventListener('motionchange', update);
        btn.addEventListener('click', function () { var p = bg.getState().paused; if (p) bg.play(); else bg.pause(); try { global.localStorage.setItem(PREF, p ? '0' : '1'); } catch (e) { /* geen opslag */ } });
        btn.hidden = false; update();
      })(list[i]);
    }
  }

  global.SoftwareMotion = { mount: mount, themes: THEMES, version: '2.1' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autostart); else autostart();
})(window);
