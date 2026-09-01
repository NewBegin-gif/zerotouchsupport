/* AIBuilder Marketplace — Conversion Toolkit v2 (2026-06)
   Volledig client-side, geïsoleerd (try/catch), geen dependencies.
   Upgradet elke pagina die dit bestand laadt zonder de HTML te wijzigen,
   dus Victor-regeneratie kan het niet wissen. Opt-out: <body data-skip-conv="1">.
   Eerlijk by design: geen verzonnen kortingen/urgentie, alles dismissbaar. */

/* ===== Core Web Vitals: off-screen kaarten niet renderen (content-visibility) =====
   Grote winst op lange kaart-pagina's zoals /b2b/ (1600+ kaarten): de browser
   slaat layout/paint van niet-zichtbare kaarten over. contain-intrinsic-size
   reserveert ruimte zodat er geen layout-shift (CLS) optreedt. Veilig voor SEO:
   de inhoud blijft in de DOM en wordt gewoon geïndexeerd. */
(function(){ try {
  var s = document.createElement('style');
  s.textContent = '.card,.eco-card,.net-card,.deal-row,.review-card{content-visibility:auto;contain-intrinsic-size:auto 230px}';
  (document.head || document.documentElement).appendChild(s);
} catch(_){} })();

(function () {
  if (window.__convtkit) return;
  window.__convtkit = true;
  try {
    if (document.body && (document.body.dataset.skipConv === '1' || document.body.dataset.skipconv === '1')) return;

    var SS = window.sessionStorage;
    function seen(k){ try { return SS && SS.getItem(k) === '1'; } catch (_) { return false; } }
    function mark(k){ try { SS && SS.setItem(k, '1'); } catch (_) {} }
    function track(name, label){ try { if (window.gtag) gtag('event', name, {event_category:'conversion', event_label: label, variant: VARIANT, transport_type:'beacon'});
      /* CRO-autopilot (Darwin fase 2): variant-gecodeerde eventnaam, zodat de
         GA4-API per variant kan meten zonder custom-dimension-registratie */
      if (window.gtag && name.indexOf('cta') > -1) gtag('event', 'cro_' + name.replace(/[^a-z_]/g, '') + '_' + (VARIANT || 'a').toLowerCase(), {transport_type:'beacon'});
    } catch (_) {} }

    // ---- A/B-variant (Darwin Fase 1): per bezoeker vastgezet in localStorage.
    // Test eerlijke CTA-werkwoorden ("Visit" vs "Try"); winnaar bepalen we later uit
    // GA4 via de param `variant` op affiliate_click. Registreer `variant` als
    // event-scoped custom dimension in GA4 om het in rapporten te zien. ----
    var CTA_VERB = { A: 'Visit', B: 'Try', C: 'See' };
    /* Epsilon-greedy bandit (Darwin Fase 2): nieuwe bezoekers krijgen met kans
       1-epsilon de LEADER (best presterende variant), met kans epsilon een
       willekeurige variant (exploratie). Bestaande bezoekers blijven sticky op
       hun eerdere variant. De BANDIT-CONFIG-regel hieronder wordt wekelijks
       bijgewerkt door bandit_update.py (VPS) uit GA4 cro_-events — epsilon 1.0
       betekent koude start (zuiver uniform verkennen tot er genoeg data is). */
    var BANDIT = { leader: 'A', epsilon: 1.0, updated: '2026-07-21' }; /* BANDIT-CONFIG */
    var VARIANT = (function(){
      try {
        var v = localStorage.getItem('aibm_cta_variant');
        if (v && CTA_VERB[v]) return v;
        if (Math.random() < BANDIT.epsilon) {
          var ks = Object.keys(CTA_VERB);
          v = ks[Math.floor(Math.random() * ks.length)];
        } else { v = BANDIT.leader; }
        localStorage.setItem('aibm_cta_variant', v);
        return v;
      } catch (_) { return 'A'; }
    })();
    function ctaVerb(){ return CTA_VERB[VARIANT]; }
    /* CRO-autopilot: exposure-event 1x per pagina → click-rate per variant berekenbaar */
    try { if (window.gtag) setTimeout(function(){ gtag('event', 'cro_view_' + VARIANT.toLowerCase(), {transport_type:'beacon'}); }, 800); } catch (_) {}

    /* Demand-mining: wat zoeken bezoekers op de site? (GA4 'search' → searchTerm-dimensie)
       Elke term = gratis marktonderzoek; termen zonder dekking worden dossier-kandidaten. */
    try {
      var sIn = document.getElementById('home-search') || document.getElementById('q') || document.getElementById('vsq') || document.getElementById('pq');
      if (sIn && window.gtag) {
        var sLast = '';
        function sSend(){
          var v = (sIn.value || '').trim().toLowerCase();
          if (v.length >= 3 && v !== sLast && !seen('dm_' + v)) {
            sLast = v; mark('dm_' + v);
            gtag('event', 'search', {search_term: v, transport_type: 'beacon'});
          }
        }
        sIn.addEventListener('change', sSend);
        sIn.addEventListener('keydown', function(e){ if (e.key === 'Enter') sSend(); });
        sIn.addEventListener('blur', sSend);
      }
    } catch (_) {}

    // ---- Primaire affiliate-CTA: eerste echte sponsored-link (werkt voor ELKE affiliate) ----
    function findCTA(){
      var a = document.querySelector('a[rel~="sponsored"][href^="http"]');
      if (a) return a.href;
      var B = ['kinsta.com','beehiiv','bitvavo','synthesia','invideo','replit','clay.com','murf.ai','wp-rocket','rankmath','jotform','chemicloud','frase.io','hostinger','foxit','keap','tresorit','partnerstack','partnerlinks'];
      for (var i=0;i<B.length;i++){ var x=document.querySelector('a[href*="'+B[i]+'"]'); if (x) return x.href; }
      return null;
    }
    // ---- Tool-naam uit de title (bv. "Foxit Review 2026 — ..." -> "Foxit") ----
    function toolName(){
      var t = (document.title || '').split(/\s+[—|]\s+|\s+Review|\s+Pricing|\s+vs\s+|:/i)[0].trim();
      return (t && t.length <= 28) ? t : '';
    }

    var ctaLink = findCTA();
    var tool = toolName();
    var isReview = !!ctaLink; // conversie-UI alleen op pagina's met een affiliate-link

    function ready(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

    ready(function () {
      // 1) Trust-strip na de eerste H1 (alleen op review-/aanbiedingspagina's, eerlijk)
      try {
        var h1 = document.querySelector('article h1, main h1, h1');
        if (isReview && h1 && !document.getElementById('trust-strip')) {
          var ts = document.createElement('div');
          ts.id = 'trust-strip';
          ts.style.cssText = 'display:flex;gap:8px 16px;flex-wrap:wrap;margin:14px 0 22px;padding:9px 14px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:8px;font-size:12.5px;color:#60a5fa;font-family:system-ui,-apple-system,sans-serif';
          ts.innerHTML = '<span>✓ Independent &amp; founder-written</span><span>✓ Honest pros &amp; cons</span><span>✓ Affiliate-disclosed</span><span>✓ Updated 2026</span>';
          h1.parentNode.insertBefore(ts, h1.nextSibling);
        }
      } catch (_) {}

      // A/B: pas het CTA-werkwoord toe op de homepage-kaartknoppen. Staat
      // bewust VÓÓR de ctaLink-return: findCTA() draait bij script-parse en
      // vindt op de homepage nog niets (kaarten bestaan dan nog niet), waardoor
      // deze vervanging anders nooit draaide (gevonden bij bandit-test 21 jul).
      // De homepage-widget rendert kaarten bovendien NA ready(), dus een
      // MutationObserver houdt ook later toegevoegde knoppen consistent.
      try {
        var applyVerb = function () {
          document.querySelectorAll('a.tool-cta-primary').forEach(function (a) {
            if (a.firstChild && a.firstChild.nodeType === 3) {
              a.firstChild.nodeValue = a.firstChild.nodeValue.replace(/^\s*(Visit|Try|See)\b/, ctaVerb());
            }
          });
        };
        applyVerb();
        if (window.MutationObserver) {
          var mo = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
              if (muts[i].addedNodes && muts[i].addedNodes.length) { applyVerb(); return; }
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
          setTimeout(function(){ try { mo.disconnect(); } catch(_){} }, 15000);
        }
      } catch (_) {}

      if (!ctaLink) return;
      var btnTxt = (tool ? ctaVerb() + ' ' + tool : 'See the offer') + ' →';

      // 2) Sticky CTA — mobiel: onderbalk; desktop: zwevende pill. Beide dismissbaar.
      try {
        if (!seen('conv_bar_dismissed') && !document.getElementById('aibm-cta-bar')) {
          var isMobile = window.innerWidth <= 768;
          var bar = document.createElement('div');
          bar.id = 'aibm-cta-bar';
          var common = 'position:fixed;z-index:9998;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)';
          if (isMobile) {
            bar.style.cssText = common + ';left:0;right:0;bottom:0;background:#0b0f17;border-top:1px solid #2a2f3a;padding:10px 14px;display:flex;align-items:center;gap:10px;transform:translateY(110%);transition:transform .35s ease';
            bar.innerHTML =
              '<div style="flex:1;color:#e5e7eb;font-size:12.5px;line-height:1.3"><strong>' + (tool || 'Our recommended pick') + '</strong><br><span style="opacity:.65">Via our partner link · check current pricing</span></div>' +
              '<a href="' + ctaLink + '" target="_blank" rel="nofollow sponsored noopener" id="aibm-cta-btn" style="background:#10b981;color:#fff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;white-space:nowrap">' + btnTxt + '</a>' +
              '<button id="aibm-cta-x" aria-label="Dismiss" style="background:none;border:none;color:#64748b;font-size:20px;line-height:1;padding:0 4px;cursor:pointer">×</button>';
          } else {
            bar.style.cssText = common + ';right:22px;bottom:22px;max-width:330px;background:#0b0f17;border:1px solid #2a2f3a;border-radius:14px;padding:14px 16px;transform:translateY(140%);transition:transform .4s ease';
            bar.innerHTML =
              '<button id="aibm-cta-x" aria-label="Dismiss" style="position:absolute;top:6px;right:9px;background:none;border:none;color:#64748b;font-size:18px;line-height:1;cursor:pointer">×</button>' +
              '<div style="color:#e5e7eb;font-size:13px;line-height:1.4;margin-bottom:10px">' + (tool ? '<strong>' + tool + '</strong> — ' : '') + 'ready to try it?<br><span style="opacity:.6;font-size:12px">Our partner link · see current pricing</span></div>' +
              '<a href="' + ctaLink + '" target="_blank" rel="nofollow sponsored noopener" id="aibm-cta-btn" style="display:block;text-align:center;background:#10b981;color:#fff;padding:11px 16px;border-radius:9px;text-decoration:none;font-weight:700;font-size:13.5px">' + btnTxt + '</a>';
          }
          document.body.appendChild(bar);
          if (isMobile) document.body.style.paddingBottom = '78px';
          // Inschuiven nadat de bezoeker iets gelezen heeft (scroll of korte delay)
          var shown = false;
          function reveal(){ if (shown) return; shown = true; bar.style.transform = 'translateY(0)'; }
          if (isMobile) { setTimeout(reveal, 1200); }
          else {
            var onScroll = function(){ if ((window.scrollY||0) > 600){ reveal(); window.removeEventListener('scroll', onScroll); } };
            window.addEventListener('scroll', onScroll, {passive:true}); setTimeout(reveal, 6000);
          }
          document.getElementById('aibm-cta-btn').addEventListener('click', function(){ track('sticky_cta_click', ctaLink); });
          document.getElementById('aibm-cta-x').addEventListener('click', function(){
            bar.style.transform = isMobile ? 'translateY(110%)' : 'translateY(140%)'; setTimeout(function(){ bar.remove(); }, 350);
            if (isMobile) document.body.style.paddingBottom = '';
            mark('conv_bar_dismissed'); track('sticky_cta_dismiss', tool || 'page');
          });
        }
      } catch (_) {}

      // 3) Exit-intent (alleen desktop, 1x per sessie, dismissbaar, geen dark pattern)
      try {
        if (window.innerWidth > 768 && !seen('conv_exit_seen')) {
          var fired = false;
          document.addEventListener('mouseout', function (e) {
            if (fired || e.clientY > 0 || e.relatedTarget) return;
            fired = true; mark('conv_exit_seen');
            var ov = document.createElement('div');
            ov.id = 'aibm-exit';
            ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,15,.72);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;padding:20px';
            ov.innerHTML =
              '<div style="max-width:420px;background:#0b0f17;border:1px solid #2a2f3a;border-radius:16px;padding:28px 26px;text-align:center;position:relative">' +
                '<button id="aibm-exit-x" aria-label="Close" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#64748b;font-size:22px;line-height:1;cursor:pointer">×</button>' +
                '<div style="font-size:1.25rem;font-weight:800;color:#f1f5f9;margin-bottom:10px">Before you go' + (tool ? ' — one look at ' + tool : '') + '</div>' +
                '<p style="color:#94a3b8;font-size:.92rem;line-height:1.6;margin:0 0 18px">Check ' + (tool ? tool + "'s" : 'the') + ' current offer and pricing through our partner link — no extra cost to you, and it supports these honest reviews.</p>' +
                '<a href="' + ctaLink + '" target="_blank" rel="nofollow sponsored noopener" id="aibm-exit-btn" style="display:inline-block;background:#10b981;color:#fff;padding:12px 26px;border-radius:9px;text-decoration:none;font-weight:700">' + btnTxt + '</a>' +
                '<div style="margin-top:14px"><button id="aibm-exit-no" style="background:none;border:none;color:#64748b;font-size:.8rem;cursor:pointer;text-decoration:underline">No thanks, keep reading</button></div>' +
              '</div>';
            document.body.appendChild(ov);
            track('exit_intent_shown', tool || 'page');
            function close(){ ov.remove(); }
            document.getElementById('aibm-exit-x').addEventListener('click', close);
            document.getElementById('aibm-exit-no').addEventListener('click', close);
            ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
            document.getElementById('aibm-exit-btn').addEventListener('click', function(){ track('exit_intent_click', ctaLink); close(); });
          });
        }
      } catch (_) {}
    });
  } catch (_) {}
})();

/* ===== Lezersreviews (motor 29, 2026-07) =====
   Client-side: haalt gepubliceerde reviews op en toont een eerlijk formulier.
   Moderatie filtert alleen spam — kritische reviews worden net zo gepubliceerd. */
(function(){try{
    /* zustersites: de review staat op /<slug>-review.html in plaats van
     op /b2b/<slug>-review/. Zelfde slug, dus dezelfde reviewverzameling. */
  var m = location.pathname.match(/^\/b2b\/([a-z0-9-]+)-review\/?$/)
       || location.pathname.match(/^\/([a-z0-9-]+)-review\.html$/);
  var mp = location.pathname.match(/^\/marketplace\/([a-z0-9-]+)\/?$/);
  if (!m && !mp) return;
  /* motor 31: op vendor-listings krijgen reviews een eigen mp-namespace,
     zodat ze nooit mengen met de reviews op onze onafhankelijke dossiers */
  var slug = m ? m[1] : 'mp-' + mp[1];
  var API = 'https://api.aibuildermarketplace.com';
  function el(tag, css, html){ var e = document.createElement(tag); if (css) e.style.cssText = css; if (html) e.innerHTML = html; return e; }
  function dots(n){ var s=''; for (var i=1;i<=5;i++) s += (i<=n?'●':'○'); return s; }
  function rdy(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  rdy(function(){
    if (document.getElementById('reader-reviews')) return;
    var host = document.querySelector('article, main, .wrap') || document.body;
    var sec = el('section', 'margin:44px 0 20px;font-family:inherit');
    sec.id = 'reader-reviews';
    sec.innerHTML = '<h2 style="margin-bottom:4px">Reader reviews</h2>' +
      '<p style="color:var(--muted,#94a3b8);font-size:.88rem;margin:0 0 14px">Real users, unedited — moderated for spam only. Critical takes get published just like glowing ones. <a href="/community/" style="color:#93c5fd">All reader reviews →</a></p>' +
      '<div id="rr-list"></div>' +
      '<button id="rr-open" style="background:none;border:1px solid #2a2f3a;color:#93c5fd;border-radius:9px;padding:10px 18px;cursor:pointer;font-weight:700">✍️ Write your honest review (critical welcome)</button>' +
      '<form id="rr-form" style="display:none;border:1px solid #2a2f3a;border-radius:12px;padding:16px;margin-top:12px;background:rgba(11,15,23,.6)">' +
        '<input name="website" style="display:none" tabindex="-1" autocomplete="off">' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin:8px 0 3px">What do you use it for?</label>' +
        '<input name="use_case" maxlength="200" style="width:100%;background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:9px">' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">' +
          '<label style="font-size:.85rem;color:#94a3b8">Ease of use<br><select name="ease" style="background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:8px"><option>5</option><option selected>4</option><option>3</option><option>2</option><option>1</option></select></label>' +
          '<label style="font-size:.85rem;color:#94a3b8">Plan<br><select name="plan" style="background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:8px"><option value="free">Free</option><option value="paid">Paid</option><option value="trial">Trial</option></select></label>' +
          '<label style="font-size:.85rem;color:#94a3b8">Satisfaction<br><select name="satisfied" style="background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:8px"><option>5</option><option selected>4</option><option>3</option><option>2</option><option>1</option></select></label>' +
          '<label style="font-size:.85rem;color:#94a3b8">Recommend?<br><select name="recommend" style="background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:8px"><option value="1">Yes</option><option value="0">No</option></select></label>' +
        '</div>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin:10px 0 3px">Why? (the honest part — min. 15 characters)</label>' +
        '<textarea name="why" maxlength="900" rows="4" style="width:100%;background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:9px"></textarea>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin:10px 0 3px">Name (optional)</label>' +
        '<input name="name" maxlength="40" style="width:220px;background:#0b0f17;border:1px solid #2a2f3a;border-radius:7px;color:#e5e7eb;padding:9px">' +
        '<div style="margin-top:14px"><button type="submit" style="background:#10b981;color:#fff;border:none;border-radius:9px;padding:11px 22px;font-weight:700;cursor:pointer">Submit review</button>' +
        '<span id="rr-msg" style="margin-left:12px;font-size:.85rem;color:#94a3b8"></span></div>' +
      '</form>';
    host.appendChild(sec);
    document.getElementById('rr-open').addEventListener('click', function(){
      this.style.display = 'none';
      document.getElementById('rr-form').style.display = 'block';
      if (window.gtag) gtag('event', 'reader_review_open', {transport_type:'beacon'});
    });
    fetch(API + '/reviews/' + slug + '.json').then(function(r){ return r.json(); }).then(function(d){
      var list = document.getElementById('rr-list');
      (d.reviews || []).slice(0, 8).forEach(function(r){
        var rec = r.recommend ? '<span style="color:#22c55e;font-weight:700">✓ would recommend</span>' : '<span style="color:#f43f5e;font-weight:700">✗ would not recommend</span>';
        var c = el('div', 'border:1px solid #2a2f3a;border-radius:12px;padding:14px 16px;margin:0 0 12px;background:rgba(11,15,23,.6)');
        function esc(t){ var d2 = document.createElement('div'); d2.textContent = t || ''; return d2.innerHTML; }
        c.innerHTML = '<div style="font-size:.85rem;color:#94a3b8"><strong style="color:#e5e7eb">' + esc(r.name) + '</strong> · ' + esc((r.ts||'').slice(0,10)) + (r.use_case ? ' · uses it for: ' + esc(r.use_case) : '') + '</div>' +
          '<div style="font-size:.83rem;color:#94a3b8;margin-top:4px">Ease ' + dots(r.ease) + ' · Satisfaction ' + dots(r.satisfied) + ' · ' + esc(r.plan) + ' plan · ' + rec + '</div>' +
          '<p style="margin:8px 0 0;color:#e2e8f0">“' + esc(r.why) + '”</p>';
        list.appendChild(c);
      });
    }).catch(function(){});
    document.getElementById('rr-form').addEventListener('submit', function(e){
      e.preventDefault();
      var f = this;
      var body = { tool_slug: slug, tool: (document.title || '').split(' Review')[0].trim(),
        website: f.website.value, use_case: f.use_case.value, ease: parseInt(f.ease.value, 10),
        plan: f.plan.value, satisfied: parseInt(f.satisfied.value, 10),
        recommend: f.recommend.value === '1', why: f.why.value, name: f.name.value };
      var msg = document.getElementById('rr-msg');
      msg.textContent = '…';
      fetch(API + '/review', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d.ok) { f.style.display = 'none'; var ok = el('p', 'color:#22c55e;font-weight:700', '✓ ' + (d.msg || 'Thanks!')); f.parentNode.appendChild(ok);
            if (window.gtag) gtag('event', 'reader_review_submit', {transport_type:'beacon'}); }
          else { msg.textContent = d.error || 'Something went wrong — try again.'; }
        })
        .catch(function(){ msg.textContent = 'Temporarily unavailable — please try again later.'; });
    });
  });
}catch(_){}})();

/* ===== Consent Mode v2 (GDPR, 2026-07) =====
   De inline head-snippet zet analytics_storage default op 'denied' voor EEA/UK/CH
   (cookieless pings blijven lopen). Dit blok onthoudt de keuze en toont een
   minimale, eerlijke banner — alleen voor bezoekers met een Europe/-tijdzone. */
(function(){try{
  var KEY='aibm_consent';
  var keuze=null; try{keuze=localStorage.getItem(KEY);}catch(_){}
  function upd(v){ try{ if(window.gtag) gtag('consent','update',{analytics_storage:v}); }catch(_){} }
  if(keuze==='granted'){ upd('granted'); return; }
  if(keuze==='denied'){ upd('denied'); return; }
  var eu=false; try{ eu=(Intl.DateTimeFormat().resolvedOptions().timeZone||'').indexOf('Europe/')===0; }catch(_){}
  if(!eu && !window.__aibmForceConsent) return;
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn); else fn(); }
  ready(function(){
    if(document.getElementById('aibm-consent')) return;
    var b=document.createElement('div');
    b.id='aibm-consent';
    var bot=(window.innerWidth<=768)?'92px':'14px';
    b.style.cssText='position:fixed;left:14px;bottom:'+bot+';z-index:10001;max-width:320px;background:#0b0f17;border:1px solid #2a2f3a;border-radius:12px;padding:14px 16px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)';
    b.innerHTML='<div style="color:#e5e7eb;font-size:12.5px;line-height:1.5;margin-bottom:10px">We use one analytics cookie to see what helps readers. No ads, no data resale.</div>'+
      '<div style="display:flex;gap:8px"><button id="aibm-c-ok" style="flex:1;background:#10b981;color:#fff;border:none;border-radius:8px;padding:9px 0;font-weight:700;cursor:pointer">OK</button>'+
      '<button id="aibm-c-no" style="flex:1;background:none;color:#94a3b8;border:1px solid #2a2f3a;border-radius:8px;padding:9px 0;cursor:pointer">Decline</button></div>';
    document.body.appendChild(b);
    function kies(v){ try{localStorage.setItem(KEY,v);}catch(_){} upd(v); b.remove(); }
    document.getElementById('aibm-c-ok').addEventListener('click',function(){kies('granted');});
    document.getElementById('aibm-c-no').addEventListener('click',function(){kies('denied');});
  });
}catch(_){}})();

/* ===== Affiliate click tracking (v2, 2026-06) =====
   Vuurt GA4-event 'affiliate_click' bij klik op elke a[rel~=sponsored].
   Volledig geisoleerd: een fout hier kan de rest van de pagina niet raken. */
(function(){try{
  if (window.__affTrack) return; window.__affTrack = 1;
  document.addEventListener('click', function(e){
    try{
      var t = e.target;
      var a = t && t.closest ? t.closest('a[rel~="sponsored"]') : null;
      if (!a || !a.href || a.href.indexOf('http') !== 0) return;
      var h = 'unknown';
      try { h = new URL(a.href).hostname.replace(/^(www|try|get|go|join|start|now|refer|partners?|affiliates?|psref)\./,''); } catch(_){}
      var variant = 'A';
      try { variant = localStorage.getItem('aibm_cta_variant') || 'A'; } catch(_){}
      /* v3: sub-ID-attributie — de pagina-slug reist mee naar het netwerk
         (Impact: subId1; generiek: sid — onbekende params negeren redirectors).
         Zo wordt omzet straks per PAGINA zichtbaar, zonder één pagina te herschrijven. */
      try {
        /* Bandit-meting: de CTA-variant reist als suffix mee in de sub-ID
           (…-va/-vb/-vc), zodat kliks per variant in de netwerk-data zichtbaar
           worden naast de GA4 cro_-events. */
        var sid = (location.pathname.replace(/^\/+|\/+$/g,'').replace(/[^a-zA-Z0-9\/-]/g,'').replace(/\//g,'-').slice(0,56) || 'home') + '-v' + String(variant).toLowerCase().slice(0,1);
        var u = new URL(a.href);
        if (!u.searchParams.has('subId1')) u.searchParams.set('subId1', sid);
        if (!u.searchParams.has('sid')) u.searchParams.set('sid', sid);
        a.href = u.toString();
      } catch(_){}
      if (window.gtag) gtag('event', 'affiliate_click', {
        partner: h,
        link_url: a.href.split('?')[0],
        variant: variant,
        transport_type: 'beacon'
      });
    }catch(_){}
  }, true);
}catch(_){}})();
