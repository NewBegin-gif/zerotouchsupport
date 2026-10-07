/* Offer Finder op de dealpagina's (deals fase 2, 7 okt 2026): geschiktheid + echte kosten (DealsMotor), vergelijken
   (max 3), lokaal bewaren, Deal Passport, deelbare link en 'Report an issue'. Leest de records uit
   <script id="deal-records" type="application/json"> op de pagina -- dezelfde records als /api/v1/offers.json.
   Alles werkt zonder account; niets van wat je invult verlaat de browser, behalve een melding die je zelf verstuurt.
   Zonder JavaScript blijven de kaarten volledig leesbaar; deze knoppen staan dan verborgen. */
(function () {
  var el = document.getElementById('deal-records');
  if (!el || !window.DealsMotor) return;
  var RECS = {};
  try { JSON.parse(el.textContent).forEach(function (r) { RECS[r.offer_id] = r; }); } catch (e) { return; }
  var API = 'https://api.aibuildermarketplace.com/deal-issue';
  var SAVEKEY = 'aibm_deals_saved', MAXCMP = 3;
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return [].slice.call((c || document).querySelectorAll(s)); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function meet(ev, p) { try { if (window.gtag) gtag('event', ev, p); } catch (e) {} }
  function geld(x) { return x === null || x === undefined ? '' : Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function lees(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function bewaar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---- knoppen op de kaarten zichtbaar maken (progressive enhancement) ----
  $$('.dc-tools').forEach(function (t) { t.hidden = false; });

  // ---- dialoog: geschiktheid en kosten ----
  var dlg = document.createElement('dialog');
  dlg.id = 'df-dialog'; dlg.className = 'df-dialog'; dlg.setAttribute('aria-labelledby', 'df-title');
  document.body.appendChild(dlg);
  var opener = null, huidig = null;

  function velden(r) {
    var e = r.eligibility || {}, h = '';
    if (e.customer === 'new') h += '<fieldset><legend>Are you a new customer of ' + esc(r.product) + '?</legend>' +
      '<label><input type="radio" name="customer" value="new"> Yes, new</label> <label><input type="radio" name="customer" value="existing"> No, I already have an account</label></fieldset>';
    if (e.plans && e.plans.length) h += '<label class="df-l">Which plan will you buy?<select name="plan"><option value="">Not sure yet</option>' +
      e.plans.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('') + '<option value="__other">Another plan</option></select></label>';
    h += '<label class="df-l">How will you be billed?<select name="billing"><option value="">Choose&hellip;</option><option value="monthly">Monthly</option><option value="annual">Yearly (paid up front)</option><option value="biennial">Every two years (paid up front)</option></select></label>';
    var k = (r.structure || {}).kind;
    if (['percent', 'first_billing', 'free_months', 'fixed_first_month'].indexOf(k) > -1)
      h += '<label class="df-l">Your price per month without the offer<span class="df-hint">On yearly billing: the monthly amount on the yearly price. Same currency as the vendor shows you; tax not included.</span>' +
        '<input name="price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="e.g. 49"></label>' +
        '<label class="df-l">Compare over<select name="months"><option value="12">12 months</option><option value="24">24 months</option></select></label>';
    return h;
  }

  function invoer(f) {
    var g = function (n) { var x = f.querySelector('[name="' + n + '"]:checked') || f.querySelector('[name="' + n + '"]:not([type=radio])'); return x ? x.value : ''; };
    var plan = g('plan');
    return { customer: g('customer') || null, plan: plan === '__other' ? 'another plan' : plan, billing: g('billing') || null,
             price: g('price') === '' ? null : Number(g('price')), months: Number(g('months') || 12) };
  }

  var UITKOMST = { matches: ['Matches the recorded terms', 'ok'], does_not_match: ['Does not match', 'no'], needs_confirmation: ['Needs confirmation', 'open'] };

  function render(r, f) {
    var i = invoer(f), c = DealsMotor.check(r, i), k = DealsMotor.cost(r, i), u = UITKOMST[c.result];
    var h = '<p class="df-res df-' + u[1] + '"><b>' + u[0] + '.</b> ' + esc(c.reasons.join(' ')) + '</p>';
    if (c.missing.length) h += '<p class="df-small">Tell us ' + esc(c.missing.join(', ')) + ' to complete the check.</p>';
    if (c.unstated.length) h += '<p class="df-small">Not stated by the vendor: ' + esc(c.unstated.join(', ')) + '.</p>';
    h += '<p class="df-small">' + esc(c.note) + '</p>';
    $('.df-fit', dlg).innerHTML = h;
    var kh = '';
    if (c.result === 'does_not_match') { k = { status: 'not_computable', reason: 'The offer does not match your situation, so there is nothing to calculate.' }; }
    if (k.status === 'ok') {
      kh = '<table class="df-tab"><tr><th scope="row">You pay today</th><td>' + geld(k.today) + '</td></tr>' +
        '<tr><th scope="row">Over ' + k.months + ' months, with the offer</th><td>' + geld(k.with_offer) + '</td></tr>' +
        '<tr><th scope="row">Over ' + k.months + ' months, without it</th><td>' + geld(k.without_offer) + '</td></tr>' +
        '<tr><th scope="row">Saving</th><td><b>' + geld(k.saving) + '</b></td></tr>' +
        '<tr><th scope="row">Per month after the offer</th><td>' + geld(k.after_offer_month) + '</td></tr></table>';
    } else if (k.status === 'range') {
      kh = '<p>' + esc(k.reason) + '</p><table class="df-tab"><tr><th scope="row">You pay today</th><td>' + geld(k.today) + '</td></tr>' +
        '<tr><th scope="row">Over ' + k.months + ' months</th><td>' + geld(k.with_offer_min) + ' to ' + geld(k.with_offer_max) + '</td></tr>' +
        '<tr><th scope="row">Without the offer</th><td>' + geld(k.without_offer) + '</td></tr>' +
        '<tr><th scope="row">Saving</th><td>' + geld(k.saving_min) + ' to ' + geld(k.saving_max) + '</td></tr></table>';
    } else kh = '<p class="df-small">' + esc(k.reason) + '</p>';
    if (k.assumptions) kh += '<p class="df-small">' + esc(k.assumptions.join(' ')) + '</p>';
    $('.df-cost', dlg).innerHTML = kh;
    huidig = { r: r, i: i, c: c, k: k };
  }

  function paspoort() {
    var r = huidig.r, i = huidig.i, c = huidig.c, k = huidig.k, u = UITKOMST[c.result][0];
    var regels = ['DEAL PASSPORT: ' + r.product, 'Offer: ' + r.benefit + ' (' + r.type_label + '), record ' + r.offer_id + ' v' + r.version + ', page built ' + r.as_of,
      'Your situation: ' + [i.customer ? 'customer: ' + i.customer : '', i.plan ? 'plan: ' + i.plan : '', i.billing ? 'billing: ' + i.billing : ''].filter(Boolean).join('; '),
      'Fit: ' + u + '. ' + c.reasons.join(' ') + (c.unstated.length ? ' Not stated by the vendor: ' + c.unstated.join(', ') + '.' : '')];
    if (k.status === 'ok') regels.push('Cost over ' + k.months + ' months (your price, tax excluded): ' + geld(k.with_offer) + ' with the offer, ' + geld(k.without_offer) + ' without, saving ' + geld(k.saving) + '; you pay ' + geld(k.today) + ' today.');
    else if (k.status === 'range') regels.push('Cost over ' + k.months + ' months: ' + geld(k.with_offer_min) + ' to ' + geld(k.with_offer_max) + ' (' + k.reason + ')');
    else regels.push('Cost: ' + k.reason);
    regels.push('Evidence: ' + r.evidence + ' (' + r.status_label + '). Not tested by us at a checkout.');
    regels.push('How to claim: ' + r.claim_steps + (r.code ? ' Code: ' + r.code : ''));
    if (r.limits && r.limits.length) regels.push('Key limit: ' + r.limits[0]);
    if (r.deadline) regels.push('Ends: ' + r.deadline);
    regels.push('Current offer: ' + deellink());
    regels.push('Recheck before you buy: offers change. This is a snapshot, not a quote or a reservation.');
    return regels.join('\n');
  }

  function deellink() {
    var i = huidig.i, p = ['offer=' + huidig.r.offer_id];
    if (i.customer) p.push('customer=' + i.customer);
    if (i.plan && i.plan !== 'another plan') p.push('plan=' + encodeURIComponent(i.plan));
    if (i.billing) p.push('billing=' + i.billing);
    return location.origin + location.pathname + '#' + p.join('&');   // nooit de prijs: dat is jouw budget
  }

  function kopieer(tekst, knop) {
    var oud = knop.textContent;
    function ok() { knop.textContent = 'Copied'; setTimeout(function () { knop.textContent = oud; }, 1600); }
    function mis() { var t = $('.df-out', dlg); t.hidden = false; t.value = tekst; t.focus(); t.select(); knop.textContent = 'Select and copy below'; setTimeout(function () { knop.textContent = oud; }, 2400); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tekst).then(ok, mis); else mis();
  }

  function open(id, knop, vooraf) {
    var r = RECS[id];
    if (!r) return;
    opener = knop || null;
    dlg.innerHTML = '<div class="df-head"><h2 id="df-title">' + esc(r.product) + ': ' + esc(r.benefit) + '</h2>' +
      '<button type="button" class="df-x" aria-label="Close">&times;</button></div>' +
      '<p class="df-small"><span class="pill pill-' + esc(r.status_key) + '">' + esc(r.status_label) + '</span>' + esc(r.evidence) + (r.deadline ? ' · Ends ' + esc(r.deadline) : '') + '</p>' +
      '<form class="df-form" novalidate>' + velden(r) + '</form>' +
      '<h3>Does it fit?</h3><div class="df-fit" aria-live="polite"></div><h3>What you pay</h3><div class="df-cost" aria-live="polite"></div>' +
      '<div class="df-acts"><button type="button" class="df-b" data-a="pass">Copy Deal Passport</button><button type="button" class="df-b" data-a="link">Copy link</button>' +
      '<button type="button" class="df-b" data-a="report">Report an issue</button><a class="df-b df-go" href="' + esc(r.handoff_url) + '" target="_blank" rel="sponsored noopener nofollow">' + esc(r.cta) + ' &rarr;</a></div>' +
      '<textarea class="df-out" hidden readonly aria-label="Deal Passport text"></textarea>' +
      '<form class="df-report" hidden><h3>Report an issue</h3><label class="df-l">What went wrong?<select name="kind"><option value="code_rejected">The code was rejected</option><option value="terms_differ">The terms are different</option><option value="link_broken">The link is broken</option><option value="expired">The offer has ended</option><option value="other">Something else</option></select></label>' +
      '<label class="df-l">Details (optional; please no personal data)<textarea name="note" maxlength="600" rows="3"></textarea></label>' +
      '<label class="df-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>' +
      '<button type="submit" class="df-b">Send report</button> <span class="df-rep-uit" aria-live="polite"></span></form>';
    var f = $('.df-form', dlg);
    if (vooraf) Object.keys(vooraf).forEach(function (n) {
      var x = f.querySelector('[name="' + n + '"][value="' + vooraf[n] + '"]') || f.querySelector('select[name="' + n + '"]');
      if (x && x.type === 'radio') x.checked = true; else if (x) x.value = vooraf[n];
    });
    f.addEventListener('input', function () { render(r, f); });
    f.addEventListener('change', function () { render(r, f); });
    render(r, f);
    $('.df-x', dlg).addEventListener('click', function () { dlg.close(); });
    $$('.df-b[data-a]', dlg).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-a');
        if (a === 'pass') { kopieer(paspoort(), b); meet('deal_passport_copy', { offer: r.offer_id }); }
        if (a === 'link') { kopieer(deellink(), b); meet('deal_link_copy', { offer: r.offer_id }); }
        if (a === 'report') { var rf = $('.df-report', dlg); rf.hidden = !rf.hidden; if (!rf.hidden) rf.querySelector('select').focus(); }
      });
    });
    $('.df-report', dlg).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var rf = ev.target, uit = $('.df-rep-uit', dlg), knop = rf.querySelector('button');
      knop.disabled = true; uit.textContent = 'Sending…';
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        offer_id: r.offer_id, kind: rf.kind.value, note: rf.note.value, website: rf.website.value, page: location.origin + location.pathname }) })
        .then(function (x) { return x.json().then(function (j) { return [x.ok, j]; }); })
        .then(function (a) { uit.textContent = a[0] ? (a[1].msg || 'Thanks.') : ('Could not send: ' + (a[1].error || 'try again later')); if (!a[0]) knop.disabled = false; meet('deal_issue_report', { offer: r.offer_id }); })
        .catch(function () { uit.textContent = 'Could not send. Check your connection and try again.'; knop.disabled = false; });
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    var eerste = f.querySelector('input,select'); if (eerste) eerste.focus();
    meet('deal_check_open', { offer: id });
  }
  dlg.addEventListener('close', function () { if (opener) opener.focus(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  $$('.dc-check').forEach(function (b) { b.addEventListener('click', function () { open(b.getAttribute('data-offer'), b); }); });

  // ---- vergelijken (max 3) ----
  var tray = document.createElement('div');
  tray.className = 'df-tray'; tray.hidden = true; tray.setAttribute('role', 'region'); tray.setAttribute('aria-label', 'Compare offers');
  tray.innerHTML = '<span class="df-tray-t"></span><button type="button" class="df-b" data-t="open">Compare</button><button type="button" class="df-b df-plain" data-t="clear">Clear</button>';
  document.body.appendChild(tray);
  function gekozen() { return $$('.dc-cmp input:checked').map(function (x) { return x.getAttribute('data-cmp'); }); }
  function trayUpdate() {
    var g = gekozen();
    tray.hidden = !g.length; document.body.classList.toggle('df-tray-on', g.length > 0);
    $('.df-tray-t', tray).textContent = g.length + ' of ' + MAXCMP + ' selected';
    $('[data-t=open]', tray).disabled = g.length < 2;
    $$('.dc-cmp input').forEach(function (x) { x.disabled = !x.checked && g.length >= MAXCMP; });
  }
  $$('.dc-cmp input').forEach(function (x) { x.addEventListener('change', trayUpdate); });
  $('[data-t=clear]', tray).addEventListener('click', function () { $$('.dc-cmp input').forEach(function (x) { x.checked = false; }); trayUpdate(); });
  $('[data-t=open]', tray).addEventListener('click', function () {
    var g = gekozen().map(function (id) { return RECS[id]; }).filter(Boolean);
    var rij = function (kop, f) { return '<tr><th scope="row">' + kop + '</th>' + g.map(function (r) { return '<td>' + esc(f(r)) + '</td>'; }).join('') + '</tr>'; };
    var vw = function (r) { var e = r.eligibility || {}; return [e.customer === 'new' ? 'New customers' : 'Customers: not stated', e.plans ? 'Plans: ' + e.plans.join(', ') : 'Plans: not stated', e.billing ? 'Billing: ' + e.billing.join(', ') : 'Billing: not stated'].join(' · '); };
    opener = $('[data-t=open]', tray);
    dlg.innerHTML = '<div class="df-head"><h2 id="df-title">Compare offers</h2><button type="button" class="df-x" aria-label="Close">&times;</button></div>' +
      '<p class="df-small">Same questions for each offer. Prices differ per product, so open &ldquo;Check fit &amp; cost&rdquo; on a card to calculate with your own price.</p>' +
      '<div class="df-scroll"><table class="df-tab df-cmp"><tr><th></th>' + g.map(function (r) { return '<th scope="col">' + esc(r.product) + '</th>'; }).join('') + '</tr>' +
      rij('Kind', function (r) { return r.type_label; }) + rij('Benefit', function (r) { return r.benefit; }) + rij('How long', function (r) { return r.duration; }) +
      rij('Who qualifies', vw) + rij('Key limit', function (r) { return (r.limits || [])[0] || 'None stated'; }) +
      rij('Afterwards', function (r) { return r.post_offer_price || 'Not confirmed'; }) + rij('Evidence', function (r) { return r.status_label + ': ' + r.evidence; }) +
      rij('Ends', function (r) { return r.deadline || 'No end date given'; }) + rij('Combines with other offers', function (r) { return r.stacking === 'no' ? 'No' : r.stacking === 'yes' ? 'Yes' : 'Not stated'; }) +
      '</table></div>';
    $('.df-x', dlg).addEventListener('click', function () { dlg.close(); });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    meet('deal_compare', { n: g.length });
  });

  // ---- lokaal bewaren ----
  var saved = lees(SAVEKEY);
  function saveUpdate() {
    $$('.dc-save').forEach(function (b) { var on = saved.indexOf(b.getAttribute('data-save')) > -1; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.textContent = on ? 'Saved' : 'Save'; });
    var sb = $('.df-btn[data-type="saved"]');
    if (sb) { sb.hidden = !saved.length; var n = sb.querySelector('.df-n'); if (n) n.textContent = saved.length; }
  }
  $$('.dc-save').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-save'), i = saved.indexOf(k);
      if (i > -1) saved.splice(i, 1); else saved.push(k);
      bewaar(SAVEKEY, saved); saveUpdate(); meet('deal_save', { tool: k, on: i < 0 });
    });
  });
  window.DealsSaved = function () { return saved.slice(); };
  saveUpdate();

  // ---- #offer=... opent de dialoog (deellink, detailpagina's) ----
  var h = location.hash.slice(1), q = {};
  h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[1]) q[p[0]] = decodeURIComponent(p[1]); });
  if (q.offer && RECS[q.offer]) {
    var kaart = $('.dc-check[data-offer="' + q.offer + '"]');
    if (kaart) kaart.closest('.deal-card').scrollIntoView({ block: 'center' });
    var v = {}; ['customer', 'plan', 'billing'].forEach(function (n) { if (q[n]) v[n] = q[n]; });
    open(q.offer, kaart, v);
  }
})();
