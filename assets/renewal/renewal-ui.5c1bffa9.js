/*
 * renewal-ui.js - Before You Renew: form, result rendering, print report,
 * calendar file, supplier questions and the track() wrapper.
 *
 * Every number, category and decision text comes from RenewalCore
 * (renewal-core.js). This file reads the form, calls the core and writes
 * plain text into the page.
 *
 * Source rules (checked by build_renewal_check.py):
 *   - ASCII only and no backslash; special characters via String.fromCharCode.
 *   - Rendering with createElement and textContent only.
 *   - No storage, no network calls, no changes to the address bar or title.
 *   - Analytics only through track(): the fixed whitelist in RenewalCore,
 *     queued on window.__ga4wacht (see /ga4-gate.js). Never an input value.
 *   - Page data comes from the inline JSON block #rc-data, never fetched.
 */
(function () {
  'use strict';

  var RC = window.RenewalCore;
  var doc = document;
  var FORM = doc.getElementById('rc-form');
  if (!RC || !FORM) { return; }

  var CH = String.fromCharCode;
  var MID = ' ' + CH(0xB7) + ' ';
  var TIMES = ' ' + CH(0xD7) + ' ';
  var LQ = CH(0x201C);
  var RQ = CH(0x201D);
  var APOS = CH(39);
  var OTHER = '__other';
  var OWN = '__own';
  var WITH_OPTION = { better_plan: true, alternative: true };
  var WITH_LICENCES = { lower_costs: true, better_plan: true };
  var WITH_FEATURES = { better_plan: true, alternative: true };
  var GOALS = {
    lower_costs: 'Lower my costs',
    better_plan: 'Find a better-fitting plan',
    alternative: 'Explore an alternative',
    planning_only: 'Just plan the renewal'
  };
  var TAX_TEXT = { included: 'Tax included', excluded: 'Tax excluded', unsure: 'Not sure whether tax is included' };
  var FEATURE_TEXT = { supported: 'Supported (confirmed)', missing: 'Missing', unknown: 'Not confirmed' };
  // [field id, kind, label, key in the switching object]
  var COSTS = [
    ['rc-sw-hours', 'hours', 'Migration hours', 'hours'],
    ['rc-sw-rate', 'money', 'Hourly value', 'hourly_rate'],
    ['rc-sw-impl', 'money', 'Implementation costs', 'implementation'],
    ['rc-sw-overlap', 'money', 'Overlap costs', 'overlap'],
    ['rc-sw-other', 'money', 'Other one-off costs', 'other']
  ];

  function $(id) { return doc.getElementById(id); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  var MAIN = $('main') || FORM.parentNode;

  // ------------------------------------------------------------------
  // Page data (inline JSON, never fetched)
  // ------------------------------------------------------------------
  function readConfig() {
    var node = $('rc-data');
    if (!node) { return null; }
    try { return JSON.parse(node.textContent || 'null'); } catch (e) { return null; }
  }
  var CFG = readConfig() || {};
  var SITE = CFG.site || null;
  var PRODUCTS = CFG.products || [];
  var QUESTIONS = CFG.questions || [];
  var NETWORK = CFG.network || [];
  var OWN_DOMAIN = CFG.domain || '';
  var EXPORT = CFG.export || {};

  // ------------------------------------------------------------------
  // Analytics: fixed names and values only, queued behind the GA4 gate
  // ------------------------------------------------------------------
  var sentOnce = {};
  function track(name, extra, onceKey) {
    if (onceKey && sentOnce[onceKey]) { return false; }
    var params = { site: SITE };
    if (extra) {
      for (var k in extra) { if (has(extra, k)) { params[k] = extra[k]; } }
    }
    var ev = RC.analyticsEvent(name, params);
    if (!ev) { return false; }
    if (onceKey) { sentOnce[onceKey] = true; }
    var copy = {};
    for (var p in ev.params) { if (has(ev.params, p)) { copy[p] = ev.params[p]; } }
    var queue = window.__ga4wacht = window.__ga4wacht || [];
    queue.push(function () {
      if (typeof window.gtag === 'function') { window.gtag('event', ev.name, copy); }
    });
    return true;
  }

  // ------------------------------------------------------------------
  // Small DOM helpers (text only)
  // ------------------------------------------------------------------
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = String(text); }
    return n;
  }
  function add(parent, child) { parent.appendChild(child); return child; }
  function txt(parent, s) { parent.appendChild(doc.createTextNode(s)); }
  function clear(n) { while (n && n.firstChild) { n.removeChild(n.firstChild); } }
  function show(n, on) { if (n) { n.hidden = !on; } }
  function value(id) { var n = $(id); return n ? String(n.value || '') : ''; }
  function filled(id) { return value(id).trim() !== ''; }
  function checked(id) { var n = $(id); return !!(n && n.checked); }
  function setValue(id, v) { var n = $(id); if (n) { n.value = v; } }
  function inside(node, parent) {
    while (node) { if (node === parent) { return true; } node = node.parentNode; }
    return false;
  }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function focusOn(node) {
    if (!node) { return; }
    try { node.focus({ preventScroll: false }); } catch (e) { node.focus(); }
  }
  // The goal radiogroup: the checked option, else the first one.
  function goalRadios() { return doc.querySelectorAll('#rc-goals .rc-choice'); }
  function goalTarget() {
    return doc.querySelector('#rc-goals .rc-choice[aria-checked=true]') || doc.querySelector('#rc-goals .rc-choice');
  }
  function focusField(id) {
    if (id === 'rc-goals') { focusOn(goalTarget()); return; }
    focusOn($(id));
  }
  // One always-rendered polite status region outside the form and the result. Used for
  // messages nobody would hear otherwise: a format error shown when the visitor leaves a
  // field (focus has already moved on) and the result, whose text is written while the
  // result container is still hidden.
  var announceTimer = null;
  function announce(msg) {
    var live = $('rc-announce');
    if (!live) { return; }
    live.textContent = '';
    if (announceTimer) { clearTimeout(announceTimer); }
    announceTimer = setTimeout(function () { live.textContent = msg; announceTimer = null; }, 120);
  }
  function labelText(id) {
    var lab = doc.querySelector('label[for="' + id + '"]');
    if (!lab && id === 'rc-goals') { lab = $('rc-goals-label'); }
    return lab ? String(lab.textContent || '').trim() : '';
  }
  function hostOf(url) {
    var a = doc.createElement('a');
    a.href = url;
    var h = String(a.hostname || '').toLowerCase();
    return h.indexOf('www.') === 0 ? h.slice(4) : h;
  }
  // The path of an absolute URL on this site, for example /edesk-review.html.
  function localPath(url) {
    var a = doc.createElement('a');
    a.href = url;
    return (a.pathname || '/') + (a.search || '') + (a.hash || '');
  }
  // Review links. A review on this site gets a local root-relative link; one
  // on another network site stays absolute and gets nofollow here, because
  // netwerk_nofollow cannot see links created by script. They open in a new
  // tab so the figures on this page stay where they are.
  function reviewLink(url, text) {
    var a = el('a', null, text);
    var own = hostOf(url) === OWN_DOMAIN;
    a.setAttribute('href', own ? localPath(url) : url);
    if (!own) { a.setAttribute('rel', 'nofollow noopener'); }
    a.setAttribute('target', '_blank');
    a.setAttribute('data-rc-review', '1');
    // The printed report shows this full address, also when href is root-relative.
    a.setAttribute('data-print-url', String(url));
    add(a, el('span', 'rc-vh', ' (opens in a new tab)'));
    return a;
  }
  // A vendor pricing page is cited as plain text, not linked.
  function sourceText(url) {
    var s = String(url || '');
    var i = s.indexOf('://');
    if (i >= 0) { s = s.slice(i + 3); }
    if (s.indexOf('www.') === 0) { s = s.slice(4); }
    while (s.length > 1 && s.charAt(s.length - 1) === '/') { s = s.slice(0, -1); }
    return s;
  }

  // ------------------------------------------------------------------
  // Field errors, next to the field
  // ------------------------------------------------------------------
  function setError(id, msg) {
    var input = $(id);
    var err = $(id + '-err');
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
    if (input) {
      if (msg) { input.setAttribute('aria-invalid', 'true'); } else { input.removeAttribute('aria-invalid'); }
    }
    // The goal error belongs to each option too: focus lands on an option, not on the group.
    if (id === 'rc-goals') {
      var radios = goalRadios();
      for (var i = 0; i < radios.length; i++) {
        if (msg) { radios[i].setAttribute('aria-describedby', 'rc-goals-err'); } else { radios[i].removeAttribute('aria-describedby'); }
      }
    }
  }
  function errorShown(id) { var err = $(id + '-err'); return !!(err && !err.hidden); }
  function clearErrors() {
    var errs = doc.querySelectorAll('.rc-err');
    for (var i = 0; i < errs.length; i++) {
      errs[i].textContent = '';
      errs[i].hidden = true;
    }
    var bad = doc.querySelectorAll('[aria-invalid]');
    for (var j = 0; j < bad.length; j++) { bad[j].removeAttribute('aria-invalid'); }
    setError('rc-goals', '');
  }

  // ctx.silent: collect errors without touching the page (summary, blur).
  // ctx.required: also report empty required fields (on Next and Show).
  function fieldProblem(id, msg, ctx) {
    if (has(ctx.messages, id)) { return null; }
    ctx.errors.push(id);
    ctx.messages[id] = msg;
    if (!ctx.silent) { setError(id, msg); }
    return null;
  }
  function need(id, ok, msg, ctx) {
    if (ctx.required && !ok) { fieldProblem(id, msg, ctx); }
  }
  function readParsed(id, result, ctx) {
    if (!result.ok) { return fieldProblem(id, result.message, ctx); }
    if (!ctx.silent) { setError(id, ''); }
    return result.value;
  }
  function readAmount(id, currency, ctx) { return readParsed(id, RC.parseAmount(value(id), currency || null), ctx); }
  function readCount(id, ctx) { return readParsed(id, RC.parseCount(value(id)), ctx); }
  function readDate(id, ctx) {
    var t = value(id).trim();
    if (!t) { if (!ctx.silent) { setError(id, ''); } return null; }
    if (!RC.isDate(t)) { return fieldProblem(id, 'Enter a valid date, for example 2026-11-30.', ctx); }
    if (!ctx.silent) { setError(id, ''); }
    return t;
  }
  // A switching cost: "Unknown" ticked or an empty field is unknown (null).
  // Only a typed 0 is zero.
  function readCost(id, kind, currency, ctx) {
    if (checked(id + '-unk')) { if (!ctx.silent) { setError(id, ''); } return null; }
    var r = kind === 'hours' ? RC.parseHours(value(id)) : RC.parseAmount(value(id), currency || null);
    return readParsed(id, r, ctx);
  }

  // ------------------------------------------------------------------
  // State (page memory only)
  // ------------------------------------------------------------------
  var state;
  function freshState() {
    return { goal: null, step2: false, step3: false, result: null, input: null, meta: null, today: null, remindBefore: null, remindOpener: null, example: false };
  }
  state = freshState();

  function productById(id) {
    for (var i = 0; i < PRODUCTS.length; i++) { if (PRODUCTS[i].product_id === id) { return PRODUCTS[i]; } }
    return null;
  }
  function selectedProduct() {
    var v = value('rc-product');
    return v && v !== OTHER ? productById(v) : null;
  }

  // Catalogue variants that are still inside their 30-day window on the
  // visitor's own date. An expired claim disappears without a rebuild.
  function liveVariants(p, today) {
    var out = [];
    var list = (p && p.plan_variants) || [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || typeof v.amount_minor !== 'number' || !RC.isDate(v.checked_at) || !RC.isDate(v.valid_until)) { continue; }
      if (RC.daysBetween(today, v.valid_until) < 0 || RC.daysBetween(v.checked_at, today) < 0) { continue; }
      out.push(v);
    }
    return out;
  }
  function isCandidate(p, today) {
    return !!(p && p.in_picker && (p.supported_modes || []).indexOf('catalogue_reference') >= 0 &&
      liveVariants(p, today).length);
  }
  function selectedCandidate() {
    var v = value('rc-opt-source');
    if (!v || v === OWN) { return null; }
    var p = productById(v);
    return isCandidate(p, RC.todayLocal()) ? p : null;
  }
  function conditionLive(c, today) {
    return !!(c && c.status === 'verified' && RC.isDate(c.valid_until) && RC.daysBetween(today, c.valid_until) >= 0);
  }

  // ------------------------------------------------------------------
  // Reading the whole form into a RenewalCore input
  // ------------------------------------------------------------------
  function gather(opts) {
    opts = opts || {};
    var ctx = { silent: !!opts.silent, required: !!opts.required, errors: [], messages: {} };
    var cur = value('rc-currency') || null;
    var productSel = value('rc-product');
    var product = selectedProduct();
    var otherName = productSel === OTHER ? RC.cleanInline(value('rc-other-name'), 80) : '';
    var plan = RC.cleanInline(value('rc-plan'), 80);
    need('rc-product', !!productSel, 'Choose your software, or choose that it isn' + APOS + 't listed.', ctx);
    var current = {
      amount: readAmount('rc-amount', cur, ctx),
      currency: cur,
      period: value('rc-period') || null,
      tax: value('rc-tax') || null
    };
    need('rc-currency', !!cur, 'Choose the currency on your invoice.', ctx);
    need('rc-amount', filled('rc-amount'), 'Enter what you pay: your invoice total.', ctx);
    need('rc-period', !!current.period, 'Choose how often you are billed.', ctx);
    need('rc-tax', !!current.tax, 'Choose whether tax is included, or choose Not sure.', ctx);
    var renewalUnknown = checked('rc-renewal-unknown');
    var renewal = renewalUnknown ? null : readDate('rc-renewal', ctx);
    var goal = state.goal;
    var seats = { paid: null, active: null, minimum: null };
    var features = [];
    var notice = null;
    var rq = null;
    if (state.step2) {
      need('rc-goals', !!goal, 'Choose what you would like to change.', ctx);
      if (goal && WITH_LICENCES[goal]) {
        seats.paid = readCount('rc-paid', ctx);
        seats.active = readCount('rc-active', ctx);
        seats.minimum = readCount('rc-min', ctx);
      }
      if (goal && WITH_FEATURES[goal]) {
        for (var i = 1; i <= 3; i++) {
          var label = RC.cleanInline(value('rc-feat' + i), 80);
          if (label) { features.push({ n: i, label: label }); }
        }
      }
      if (value('rc-notice-known') === 'yes') {
        notice = readDate('rc-notice', ctx);
        need('rc-notice', filled('rc-notice'), 'Enter the notice deadline, or choose that you don' + APOS + 't know it yet.', ctx);
      }
      if (checked('rc-rq-has')) {
        rq = {
          amount: readAmount('rc-rq-amount', cur, ctx),
          currency: cur,
          period: value('rc-rq-period') || null,
          tax: value('rc-rq-tax') || null
        };
        need('rc-rq-amount', filled('rc-rq-amount'), 'Enter the total of the renewal quote, or untick the quote.', ctx);
        need('rc-rq-period', !!rq.period, 'Choose the period of the renewal quote.', ctx);
        need('rc-rq-tax', !!rq.tax, 'Choose whether tax is included in the quote.', ctx);
      }
    }
    var option = null;
    var switching = {};
    var candidate = null;
    var optName = '';
    if (state.step3) {
      candidate = selectedCandidate();
      optName = RC.cleanInline(value('rc-opt-name'), 80);
      var ocur = value('rc-opt-currency') || null;
      var fs = [];
      for (var j = 0; j < features.length; j++) {
        fs.push({ label: features[j].label, status: value('rc-fs' + features[j].n) || 'unknown' });
      }
      option = {
        amount: readAmount('rc-opt-amount', ocur, ctx),
        currency: ocur,
        period: value('rc-opt-period') || null,
        tax: value('rc-opt-tax') || null,
        price_source: value('rc-opt-kind') === 'quote' ? 'quote' : (candidate ? 'catalogue' : 'estimate'),
        scope_confirmed: checked('rc-opt-scope'),
        fit_confirmed: features.length ? false : checked('rc-opt-fit'),
        features: fs
      };
      need('rc-opt-amount', filled('rc-opt-amount'), 'Enter the total recurring price of the option.', ctx);
      need('rc-opt-currency', !!ocur, 'Choose the currency of the option' + APOS + 's price.', ctx);
      need('rc-opt-period', !!option.period, 'Choose how often the option is billed.', ctx);
      need('rc-opt-tax', !!option.tax, 'Choose whether tax is included in the option' + APOS + 's price.', ctx);
      switching = { confirmed: checked('rc-sw-confirmed') };
      for (var c = 0; c < COSTS.length; c++) {
        switching[COSTS[c][3]] = readCost(COSTS[c][0], COSTS[c][1], cur, ctx);
      }
    }
    return {
      errors: ctx.errors,
      messages: ctx.messages,
      input: {
        goal: goal,
        current: current,
        renewal_quote: rq,
        seats: seats,
        dates: { renewal: renewal, notice_deadline: notice },
        option: option,
        switching: switching
      },
      meta: {
        product: product, productSel: productSel, otherName: otherName, plan: plan,
        renewalUnknown: renewalUnknown, noticeKnown: value('rc-notice-known'),
        features: features, candidate: candidate, optName: optName
      }
    };
  }

  function softwareName(meta) {
    if (meta.product) { return meta.product.name; }
    if (meta.productSel === OTHER) { return meta.otherName || 'Your software (not listed)'; }
    return '';
  }
  function planName(meta) {
    var parts = [];
    var s = meta.product ? meta.product.name : meta.otherName;
    if (s) { parts.push(s); }
    if (meta.plan) { parts.push(meta.plan); }
    return RC.cleanInline(parts.join(' '), 120);
  }
  function moneyText(m) {
    if (!m || m.amount === null || m.amount === undefined) { return 'Not entered'; }
    if (!m.currency) { return 'Currency not chosen'; }
    if (m.period === 'other') { return RC.formatMoney(m.amount, m.currency) + ' for another period: ask for a monthly or yearly total'; }
    if (m.period !== 'month' && m.period !== 'year') { return RC.formatMoney(m.amount, m.currency) + ', period not chosen'; }
    return RC.equivalentText(m.amount, m.period, m.currency);
  }
  function billedText(interval) {
    if (interval === 'month') { return 'billed monthly'; }
    if (interval === 'year') { return 'billed annually'; }
    return 'billing period not stated';
  }

  // ------------------------------------------------------------------
  // Visibility of fields per step and goal
  // ------------------------------------------------------------------
  function applyVisibility() {
    var goal = state.goal;
    show($('rc-other-name-wrap'), value('rc-product') === OTHER);
    show($('rc-period-other'), value('rc-period') === 'other');
    var ren = $('rc-renewal');
    if (checked('rc-renewal-unknown')) { ren.value = ''; ren.disabled = true; setError('rc-renewal', ''); } else { ren.disabled = false; }

    show($('rc-step2'), state.step2);
    show($('rc-lic-wrap'), !!(goal && WITH_LICENCES[goal]));
    var featOn = !!(goal && WITH_FEATURES[goal]);
    show($('rc-feat-wrap'), featOn);
    show($('rc-notice-wrap'), value('rc-notice-known') === 'yes');
    show($('rc-rq-wrap'), checked('rc-rq-has'));
    show($('rc-rq-period-other'), checked('rc-rq-has') && value('rc-rq-period') === 'other');
    var toOption = !!(goal && WITH_OPTION[goal]);
    $('rc-next2').textContent = state.step3 ? 'Continue to step 3' : (toOption ? 'Next: compare an option' : 'Show my renewal check');
    show($('rc-compare-too'), !toOption && !state.step3);

    show($('rc-step3'), state.step3);
    var cand = selectedCandidate();
    show($('rc-ref'), !!cand);
    if (cand) { renderReference(cand); }
    show($('rc-opt-period-other'), value('rc-opt-period') === 'other');
    var nFeatures = 0;
    for (var i = 1; i <= 3; i++) {
      var label = featOn ? RC.cleanInline(value('rc-feat' + i), 80) : '';
      $('rc-fs-name' + i).textContent = label;
      show($('rc-fs' + i + '-wrap'), !!label);
      if (label) { nFeatures++; }
    }
    show($('rc-fs-intro'), nFeatures > 0);
    show($('rc-opt-fit-wrap'), nFeatures === 0);
    var cur = value('rc-currency');
    var labels = doc.querySelectorAll('.rc-curlabel');
    for (var j = 0; j < labels.length; j++) { labels[j].textContent = cur ? ' (' + cur + ')' : ''; }
    var ocur = value('rc-opt-currency');
    var olabels = doc.querySelectorAll('.rc-optcurlabel');
    for (var k = 0; k < olabels.length; k++) { olabels[k].textContent = ocur ? ' (' + ocur + ')' : ''; }
  }

  // ------------------------------------------------------------------
  // Product information ("Check this first") and the reference line
  // ------------------------------------------------------------------
  // Signals that quote the same review sentence show it once, with both labels and both
  // questions. A signal without a quote (the sentence named a price or read wrongly on its
  // own) shows only its question; the review is linked once per product.
  // covered: signal keys already asked by this entry's own questions (result view only).
  // Such a signal keeps its quote and review link but not its question; without a quote it is dropped.
  function productChecks(p, today, covered) {
    var out = [];
    var i;
    for (i = 0; i < (p.signals || []).length; i++) {
      var s = p.signals[i];
      if (covered && covered.indexOf(s.key) >= 0) {
        if (s.evidence) { out.push({ title: s.label, text: null, question: '', evidence: s.evidence, date: s.checked_at, src: s.source_url }); }
        continue;
      }
      var same = null;
      for (var k = 0; k < out.length && s.evidence; k++) { if (out[k].evidence === s.evidence) { same = out[k]; } }
      if (same) {
        same.title += '; ' + s.label;
        if (same.question !== s.question) { same.question += ' ' + s.question; }
        continue;
      }
      out.push({ title: s.label, text: null, question: s.question, evidence: s.evidence, date: s.checked_at, src: s.source_url });
    }
    var seen = [];
    for (i = 0; i < (p.conditions || []).length; i++) {
      var c = p.conditions[i];
      var live = conditionLive(c, today);
      // Two conditions with the same question and no note of their own
      // (for example two plan minimums past their date) show it once.
      var key = (live ? c.text : '') + '|' + c.question;
      if (seen.indexOf(key) >= 0) { continue; }
      seen.push(key);
      if (live) {
        // a checked fact whose question the entry already asks keeps only the fact
        var cq = (covered && covered.indexOf(c.key) >= 0) ? '' : c.question;
        out.push({ title: null, text: c.text, question: cq, evidence: null, date: c.checked_at, src: c.source_url });
      } else {
        out.push({ title: null, text: null, question: c.question, evidence: null, date: null, src: c.source_url });
      }
    }
    return out;
  }
  function checkItem(item, p, withEvidence) {
    var li = el('li');
    if (item.title) { add(li, el('b', null, item.title + ': ')); }
    if (item.text) { txt(li, item.text + ' '); }
    if (item.question) { txt(li, item.question); }
    if (withEvidence && item.evidence) {
      var ev = add(li, el('span', 'ev'));
      var when = item.date ? 'dated ' + item.date : 'date not stated';
      txt(ev, 'From the ' + p.name + ' review (' + when + '): ' + LQ + item.evidence + RQ + ' ');
      if (item.src) { add(ev, reviewLink(item.src, p.name + ' review')); }
    } else if (withEvidence && item.text && item.date) {
      add(li, el('span', 'ev', 'From the ' + p.name + ' review, checked ' + item.date + '.'));
    }
    return li;
  }
  function renderProductInfo() {
    var box = $('rc-product-info');
    clear(box);
    var p = selectedProduct();
    if (!p) { box.hidden = true; return; }
    var today = RC.todayLocal();
    add(box, el('p', 'rc-boxtitle', 'Check this first for ' + p.name));
    if (p.needs_total_quote) {
      add(box, el('p', null, 'The bill for ' + p.name + ' has more than one part, so a single list price is not your bill. Use your invoice total, or ask your supplier for a total quote.'));
    }
    var items = productChecks(p, today);
    if (items.length) {
      var ul = add(box, el('ul'));
      for (var i = 0; i < items.length; i++) { add(ul, checkItem(items[i], p, false)); }
    }
    var more = add(box, el('p'));
    add(more, reviewLink(p.canonical_review_url, 'Read the ' + p.name + ' review'));
    box.hidden = false;
  }
  function variantText(v) {
    var unit = v.unit_name || v.unit || 'unit';
    var per = v.price_period === 'year' ? 'a year' : 'a month';
    return RC.formatMoney(v.amount_minor, v.currency) + ' per ' + unit + ' ' + per + ', ' + billedText(v.billing_interval);
  }
  function referenceText(p, today) {
    var vs = liveVariants(p, today);
    var dates = [];
    var parts = [];
    for (var i = 0; i < vs.length; i++) {
      if (dates.indexOf(vs[i].checked_at) < 0) { dates.push(vs[i].checked_at); }
      parts.push(variantText(vs[i]) + (dates.length > 1 ? ' (read ' + vs[i].checked_at + ')' : ''));
    }
    var plan = vs.length && vs[0].plan_name ? ' ' + vs[0].plan_name : '';
    var head = 'List price for ' + p.name + plan + (dates.length === 1 ? ', read on ' + dates[0] : '') + ': ';
    return head + parts.join('; or ') + '. This is an estimate until your supplier confirms it. The check does not multiply it by your users and does not fill it in as your total. Minimum quantity, tax and notice terms: unknown.';
  }
  function renderReference(p) {
    var today = RC.todayLocal();
    $('rc-ref-text').textContent = referenceText(p, today);
    var src = $('rc-ref-src');
    clear(src);
    var vs = liveVariants(p, today);
    if (vs.length && vs[0].source_url) {
      txt(src, 'Source: ' + sourceText(vs[0].source_url) + ' (pricing page)' + MID);
      add(src, reviewLink(p.canonical_review_url, p.name + ' review'));
    }
  }
  function populateCandidates() {
    var sel = $('rc-opt-source');
    var today = RC.todayLocal();
    for (var i = 0; i < PRODUCTS.length; i++) {
      var p = PRODUCTS[i];
      if (!isCandidate(p, today)) { continue; }
      var planLabel = liveVariants(p, today)[0].plan_name;
      var o = el('option', null, p.name + (planLabel ? ' ' + planLabel : '') + ': show its list price as a reference');
      o.value = p.product_id;
      sel.appendChild(o);
    }
  }

  // ------------------------------------------------------------------
  // Compact summary beside the form
  // ------------------------------------------------------------------
  function summaryRows(g) {
    var m = g.meta;
    var inp = g.input;
    var rows = [];
    rows.push(['Software', softwareName(m) || 'Not chosen yet']);
    if (m.plan) { rows.push(['Plan', m.plan]); }
    rows.push(['You pay', moneyText(inp.current)]);
    if (inp.current.period === 'month' || inp.current.period === 'year') { rows.push(['Payment', RC.periodLabel(inp.current.period)]); }
    rows.push(['Tax', has(TAX_TEXT, inp.current.tax) ? TAX_TEXT[inp.current.tax] : 'Not chosen yet']);
    rows.push(['Renewal date', m.renewalUnknown ? 'I don' + APOS + 't know' : (inp.dates.renewal || 'Not entered')]);
    if (state.step2) {
      rows.push(['Goal', has(GOALS, inp.goal) ? GOALS[inp.goal] : 'Not chosen yet']);
      rows.push(['Notice deadline', inp.dates.notice_deadline || 'Unknown']);
      if (inp.renewal_quote) { rows.push(['Renewal quote', moneyText(inp.renewal_quote)]); }
      if (inp.seats.paid !== null || inp.seats.active !== null) {
        rows.push(['Licences', RC.formatCount(inp.seats.paid) + ' paid' + MID + RC.formatCount(inp.seats.active) + ' in use']);
      }
    }
    if (state.step3 && inp.option) {
      rows.push(['Option', (m.optName ? m.optName + ': ' : '') + moneyText(inp.option)]);
    }
    return rows;
  }
  function renderSummary() {
    var g = gather({ silent: true });
    var dl = $('rc-sum');
    clear(dl);
    var rows = summaryRows(g);
    for (var i = 0; i < rows.length; i++) {
      add(dl, el('dt', null, rows[i][0]));
      add(dl, el('dd', null, rows[i][1]));
    }
  }

  // ------------------------------------------------------------------
  // Steps
  // ------------------------------------------------------------------
  function stepErrors(stepId) {
    var g = gather({ required: true });
    var step = $(stepId);
    var list = [];
    for (var i = 0; i < g.errors.length; i++) {
      var f = $(g.errors[i]);
      if (f && inside(f, step)) { list.push(g.errors[i]); }
    }
    return list;
  }
  function openStep2() {
    state.step2 = true;
    applyVisibility();
    renderSummary();
    focusOn(goalTarget());
  }
  function openStep3() {
    state.step3 = true;
    applyVisibility();
    renderSummary();
    focusOn($('rc-opt-source'));
  }
  function nextFromStep1() {
    var errs = stepErrors('rc-step1');
    if (errs.length) { focusField(errs[0]); return; }
    track('renewal_step_complete', { step: '1' }, 'step1');
    if (state.step2) { focusOn(goalTarget()); return; }
    openStep2();
  }
  function nextFromStep2(forceOption) {
    var errs = stepErrors('rc-step2');
    if (errs.length) { focusField(errs[0]); return; }
    track('renewal_step_complete', { step: '2' }, 'step2');
    if (state.step3) { focusOn($('rc-opt-source')); return; }
    if (forceOption || (state.goal && WITH_OPTION[state.goal])) { openStep3(); return; }
    compute();
  }
  function showFromStep3() {
    var errs = stepErrors('rc-step3');
    if (errs.length) { focusField(errs[0]); return; }
    track('renewal_step_complete', { step: '3' }, 'step3');
    compute();
  }
  function removeComparison() {
    state.step3 = false;
    applyVisibility();
    renderSummary();
    focusOn($('rc-next2'));
  }
  // Radiogroup: aria-checked on the chosen option; only that option (else the first) is in
  // the tab order, the arrow keys move between options.
  function setGoal(goal) {
    state.goal = has(GOALS, goal) ? goal : null;
    var btns = goalRadios();
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-goal') === state.goal;
      btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
      btns[i].setAttribute('tabindex', on || (!state.goal && i === 0) ? '0' : '-1');
    }
    if (state.goal) { setError('rc-goals', ''); }
    applyVisibility();
    renderSummary();
  }
  function goalKey(e) {
    var keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!has(keys, e.key)) { return; }
    var btns = goalRadios();
    var at = -1;
    for (var i = 0; i < btns.length; i++) { if (btns[i] === e.target) { at = i; } }
    if (at < 0) { return; }
    e.preventDefault();
    var next = btns[(at + keys[e.key] + btns.length) % btns.length];
    setGoal(next.getAttribute('data-goal'));
    focusOn(next);
  }

  // ------------------------------------------------------------------
  // Result
  // ------------------------------------------------------------------
  function amountCard(label, main, notes) {
    var box = el('div', 'rc-amount');
    add(box, el('p', 'rc-alabel', label));
    add(box, el('p', 'rc-avalue', main));
    for (var i = 0; i < notes.length; i++) { if (notes[i]) { add(box, el('p', 'rc-anote', notes[i])); } }
    return box;
  }
  function paymentNote(m) {
    if (!m || (m.period !== 'month' && m.period !== 'year') || !m.currency || m.amount === null) { return ''; }
    return 'Payment: ' + RC.periodLabel(m.period) + ', ' + RC.formatMoney(m.amount, m.currency) + ' a ' + m.period + '.';
  }
  function renderAmounts(res, input) {
    var box = $('rc-amounts');
    clear(box);
    var n = res.numbers;
    var cur = n.currency;
    var basis = n.basis === 'renewal' ? input.renewal_quote : input.current;
    var c1 = [];
    var c1main;
    if (n.C !== null) {
      c1main = RC.equivalentText(n.C, 'year', cur);
      c1.push(paymentNote(basis));
      if (n.basis === 'renewal' && n.current_year !== null) {
        c1.push('You pay now: ' + RC.equivalentText(n.current_year, 'year', cur) + '.');
        if (n.renewal_change !== null && n.renewal_change !== 0) {
          c1.push('The renewal quote is ' + RC.formatMoney(Math.abs(n.renewal_change), cur) + '/year ' + (n.renewal_change > 0 ? 'more' : 'less') + ' than you pay now.');
        }
      }
    } else {
      c1main = 'Check this first';
      c1.push('This amount cannot be used yet. See your next steps.');
    }
    add(box, amountCard(n.basis === 'renewal' ? RC.LABELS.C_renewal : RC.LABELS.C, c1main, c1));

    var opt = input.option;
    if (!opt) {
      add(box, amountCard(RC.LABELS.A, 'No option compared', ['You can add an option in step 3.']));
    } else if (n.A !== null) {
      add(box, amountCard(RC.LABELS.A, RC.equivalentText(n.A, 'year', opt.currency), [paymentNote(opt)]));
    } else {
      add(box, amountCard(RC.LABELS.A, 'Check this first', ['This amount cannot be used yet. See your next steps.']));
    }

    if (n.S !== null) {
      var absS = Math.abs(n.S);
      var absM = Math.abs(n.S_month);
      if (n.S > 0) {
        add(box, amountCard(RC.LABELS.S, RC.formatMoney(absS, cur) + '/year less', ['Equivalent to ' + RC.formatMoney(absM, cur) + '/month less, before one-off switching costs.']));
      } else if (n.S < 0) {
        add(box, amountCard(RC.LABELS.S, RC.formatMoney(absS, cur) + '/year more', ['Equivalent to ' + RC.formatMoney(absM, cur) + '/month more. The option does not cost less.']));
      } else {
        add(box, amountCard(RC.LABELS.S, 'No difference', ['Both cost the same per year in this comparison.']));
      }
    } else {
      add(box, amountCard(RC.LABELS.S, 'Not compared', [opt ? 'The amounts cannot be compared as entered. See your next steps.' : 'No option entered.']));
    }
  }
  function renderIncludes(res, input) {
    var ul = $('rc-includes');
    clear(ul);
    var list = res.includes;
    var texts = [];
    var i;
    if (list && list.length) {
      for (i = 0; i < list.length; i++) { texts.push(list[i].text); }
    } else if (input.option) {
      texts.push('The amounts could not be compared yet. Complete or align the details listed under your next steps.');
    } else {
      texts.push('12-month cost equivalents of the amounts you entered. Your payment dates and amounts may differ.');
      if (input.current.currency) { texts.push('Currency: ' + input.current.currency + '. No currency conversion.'); }
      if (has(TAX_TEXT, input.current.tax)) { texts.push(TAX_TEXT[input.current.tax] + '.'); }
      texts.push('No option was compared.');
    }
    for (i = 0; i < texts.length; i++) { add(ul, el('li', null, texts[i])); }
  }
  function renderSwitching(res, input) {
    var dl = $('rc-switching');
    var note = $('rc-switching-note');
    clear(dl);
    if (!input.option) {
      dl.hidden = true;
      note.textContent = 'No option compared, so there are no switching costs to count.';
      return;
    }
    dl.hidden = false;
    var n = res.numbers;
    var cur = n.currency || input.current.currency;
    var sw = input.switching || {};
    function money(v) { return v === null || v === undefined ? 'unknown' : RC.formatMoney(v, cur); }
    var hText = money(n.H);
    if (n.H !== null && typeof sw.hours === 'number' && typeof sw.hourly_rate === 'number') {
      hText += ' (' + RC.formatHours(sw.hours) + ' hours' + TIMES + RC.formatMoney(sw.hourly_rate, cur) + ')';
    }
    var tText;
    if (n.T_display) {
      tText = 'about ' + n.T_display + ' months';
    } else if (n.flags.no_finite_payback) {
      tText = 'no payback: the option does not cost less';
    } else {
      tText = 'unknown';
    }
    var rows = [
      [RC.LABELS.H, hText],
      [RC.LABELS.F, money(n.F)],
      [RC.LABELS.K, money(n.K)],
      [RC.LABELS.E, money(n.E)],
      [RC.LABELS.T, tText]
    ];
    for (var i = 0; i < rows.length; i++) {
      add(dl, el('dt', null, rows[i][0]));
      add(dl, el('dd', null, rows[i][1]));
    }
    var parts = ['Hourly value is an economic estimate of your time, not a payment. Overlap counts only the extra cost of running both tools at the same time.'];
    if (n.flags.no_one_off_costs) { parts.push('No one-off costs were entered. That does not make switching risk-free.'); }
    if (n.K === null) { parts.push('Unknown costs are not counted as zero, so the payback stays unknown until you know them.'); }
    parts.push('Payback is a simple estimate, not the date your bank balance turns positive.');
    note.textContent = parts.join(' ');
  }
  // shownAbove: texts already listed under "Still to confirm" in the verdict;
  // an action points there instead of repeating them.
  function renderActions(res, shownAbove) {
    var ol = $('rc-actions');
    clear(ol);
    for (var i = 0; i < res.actions.length; i++) {
      var a = res.actions[i];
      var li = add(ol, el('li'));
      var rest = [];
      var j;
      for (j = 0; j < (a.items || []).length; j++) {
        if (shownAbove.indexOf(a.items[j]) < 0) { rest.push(a.items[j]); }
      }
      var repeated = a.items && a.items.length && rest.length < a.items.length;
      add(li, el('p', null, a.text + (repeated ? ' The points are listed under Still to confirm, above.' : '')));
      if (rest.length) {
        var ul = add(li, el('ul'));
        for (j = 0; j < rest.length; j++) { add(ul, el('li', null, rest[j])); }
      }
      if (a.uses === 'supplier_email') {
        var b1 = add(li, el('button', 'btn sec small rc-noprint', 'Copy supplier questions'));
        b1.type = 'button';
        b1.addEventListener('click', openCopy);
      }
      if (a.needs_date) {
        var b2 = add(li, el('button', 'btn sec small rc-noprint', 'Choose a date for a reminder'));
        b2.type = 'button';
        b2.addEventListener('click', (function (before) { return function () { openRemind(before); }; }(a.before)));
      }
    }
  }
  function resultProducts(meta) {
    var list = [];
    if (meta.product) { list.push(meta.product); }
    if (meta.candidate && meta.candidate !== meta.product) { list.push(meta.candidate); }
    return list;
  }
  function renderChecks(meta, today) {
    var ul = $('rc-check');
    clear(ul);
    var i;
    var covered = [];
    for (i = 0; i < QUESTIONS.length; i++) {
      var q = QUESTIONS[i];
      var li = add(ul, el('li'));
      add(li, el('b', null, q.label + ': '));
      txt(li, q.question);
      covered = covered.concat(q.covers || []);
    }
    var products = resultProducts(meta);
    for (var k = 0; k < products.length; k++) {
      var p = products[k];
      var items = productChecks(p, today, covered);
      // the general line is dropped when a checked condition already gives the same advice
      var saysTotal = false;
      for (i = 0; i < items.length; i++) { if (items[i].text && items[i].text.indexOf('invoice total') >= 0) { saysTotal = true; } }
      if (p.needs_total_quote && !saysTotal) {
        add(ul, el('li', null, p.name + ': the bill has more than one part. Use your invoice total or ask for a total quote.'));
      }
      for (i = 0; i < items.length; i++) {
        var li2 = checkItem(items[i], p, true);
        li2.insertBefore(el('b', null, p.name + MID), li2.firstChild);
        add(ul, li2);
      }
      if (items.length) {
        var more = add(ul, el('li'));
        add(more, el('b', null, p.name + MID));
        txt(more, 'Background to these questions: ');
        add(more, reviewLink(p.canonical_review_url, 'the ' + p.name + ' review'));
      }
    }
  }
  function uniquePush(list, s) { if (list.indexOf(s) < 0) { list.push(s); } }
  function renderSources(meta, today) {
    var ul = $('rc-sources');
    clear(ul);
    add(ul, el('li', null, 'Your figures: the amounts, dates and licence counts you entered, checked on ' + today + ' (the date on your device).'));
    var products = resultProducts(meta);
    for (var k = 0; k < products.length; k++) {
      var p = products[k];
      var li = add(ul, el('li'));
      add(li, reviewLink(p.canonical_review_url, 'The ' + p.name + ' review'));
      // Only quoted sentences carry a date of their own; each date is listed once.
      var dates = [];
      var noted = [];
      var i;
      for (i = 0; i < (p.signals || []).length; i++) {
        var s = p.signals[i];
        if (s.evidence) { uniquePush(dates, 'quote ' + (s.checked_at ? 'dated ' + s.checked_at : 'with no date stated')); }
      }
      for (i = 0; i < (p.conditions || []).length; i++) {
        var c = p.conditions[i];
        if (conditionLive(c, today)) { uniquePush(noted, c.checked_at); }
      }
      if (noted.length) { dates.push((noted.length > 1 ? 'notes checked ' : 'note checked ') + noted.join(', ')); }
      if (dates.length) { txt(li, MID + dates.join('; ') + '.'); }
      if (p === meta.candidate) {
        var vs = liveVariants(p, today);
        if (vs.length) {
          add(ul, el('li', null, 'List price of ' + p.name + ': ' + sourceText(vs[0].source_url) + ', read on ' + vs[0].checked_at + '. Shown on this page until ' + vs[0].valid_until + '.'));
        }
      }
    }
    if (EXPORT.generated_at) {
      add(ul, el('li', null, 'Product data on this page: version ' + (EXPORT.version || 'not stated') + ', built on ' + EXPORT.generated_at + '.'));
    }
  }
  function reportRows(g) {
    var m = g.meta;
    var inp = g.input;
    var rows = summaryRows(g);
    if (state.step2 && inp.seats.minimum !== null) { rows.push(['Minimum licences', RC.formatCount(inp.seats.minimum)]); }
    for (var i = 0; i < m.features.length; i++) {
      var st = state.step3 ? (value('rc-fs' + m.features[i].n) || 'unknown') : null;
      rows.push(['Must-have ' + (i + 1), m.features[i].label + (st ? MID + FEATURE_TEXT[st] : '')]);
    }
    if (state.step3 && inp.option) {
      rows.push(['Option price', inp.option.price_source === 'quote' ? 'A written quote' : 'A list price or estimate']);
      rows.push(['Option tax', has(TAX_TEXT, inp.option.tax) ? TAX_TEXT[inp.option.tax] : 'Not chosen']);
      rows.push(['Same scope confirmed', inp.option.scope_confirmed ? 'Yes' : 'No']);
      var cur = inp.current.currency;
      for (var j = 0; j < COSTS.length; j++) {
        var v = inp.switching[COSTS[j][3]];
        var t = v === null || v === undefined ? 'unknown' : (COSTS[j][1] === 'hours' ? RC.formatHours(v) + ' hours' : RC.formatMoney(v, cur));
        rows.push([COSTS[j][2], t]);
      }
      rows.push(['Switching costs confirmed', inp.switching.confirmed ? 'Yes' : 'No']);
    }
    return rows;
  }
  function renderReport(res, g, today) {
    $('rc-report-date').textContent = 'Checked on ' + today + ' (the date on your device). Product data built on ' + (EXPORT.generated_at || 'an unknown date') + '.' +
      (state.example ? ' Example with fictional figures.' : '');
    var dl = $('rc-report-inputs');
    clear(dl);
    var rows = reportRows(g);
    for (var i = 0; i < rows.length; i++) {
      add(dl, el('dt', null, rows[i][0]));
      add(dl, el('dd', null, rows[i][1]));
    }
    var ul = $('rc-report-assumptions');
    clear(ul);
    var list = res.includes || [];
    for (var j = 0; j < list.length; j++) { add(ul, el('li', null, list[j].text)); }
    add(ul, el('li', null, 'Unknown values stay unknown. They are never counted as zero.'));
    add(ul, el('li', null, 'A 12-month equivalent is a cost comparison, not your payment schedule.'));
    if (state.step3) { add(ul, el('li', null, 'Hourly value is an economic estimate, not a payment. A list price is an estimate until your supplier confirms it.')); }
  }
  function renderResult(res, g) {
    var input = g.input;
    var meta = g.meta;
    var today = input.today;
    $('rc-verdict').setAttribute('data-cat', res.result_category);
    show($('rc-example-note'), state.example);
    show($('rc-own'), state.example);
    $('rc-headline').textContent = res.headline;
    $('rc-explanation').textContent = res.explanation;

    var unc = $('rc-uncertain');
    clear(unc);
    var items = [];
    var i;
    for (i = 0; i < res.open_conditions.length; i++) { items.push(res.open_conditions[i].text); }
    for (i = 0; i < res.warnings.length; i++) { if (items.indexOf(res.warnings[i].text) < 0) { items.push(res.warnings[i].text); } }
    if (items.length) {
      add(unc, el('p', null, res.result_category === 'investigate_option' ? 'Still to confirm:' : 'Please note:'));
      var ul = add(unc, el('ul'));
      for (i = 0; i < items.length; i++) { add(ul, el('li', null, items[i])); }
    }
    show(unc, items.length > 0);

    var also = $('rc-also');
    var others = [];
    for (i = 1; i < res.signals.length; i++) { if (others.indexOf(res.signals[i].headline) < 0) { others.push(res.signals[i].headline); } }
    also.textContent = others.length ? 'Also: ' + others.join('; ') + '.' : '';
    show(also, others.length > 0);

    renderAmounts(res, input);
    renderIncludes(res, input);
    renderSwitching(res, input);
    renderActions(res, items);
    renderChecks(meta, today);
    renderSources(meta, today);
    renderReport(res, g, today);
  }

  function compute(opts) {
    var example = !!(opts && opts.example);
    var g = gather({ required: true });
    if (g.errors.length) {
      focusField(g.errors[0]);
      return false;
    }
    var input = g.input;
    input.today = RC.todayLocal();
    var res;
    try { res = RC.decide(input); } catch (e) { return false; }
    state.result = res;
    state.input = input;
    state.meta = g.meta;
    state.today = input.today;
    state.example = example;
    closePanels();
    renderResult(res, g);
    FORM.hidden = true;
    $('rc-result').hidden = false;
    MAIN.setAttribute('data-rc-view', 'result');
    renderSummary();
    focusOn($('rc-result-title'));
    // Focus reads the heading; the verdict itself goes through the status region, because
    // its text was written while the result was still hidden.
    var head = String(res.headline || '');
    announce((example ? 'Example with fictional figures: ' : 'Your renewal check: ') + head +
      (head.charAt(head.length - 1) === '.' ? '' : '.'));
    // The fictional example is not a visitor's result, so it is not counted.
    if (!example) { track('renewal_result', { result_category: res.result_category }); }
    return true;
  }

  // ------------------------------------------------------------------
  // Reminder (.ics), supplier questions, print
  // ------------------------------------------------------------------
  function closePanels() {
    show($('rc-remind-panel'), false);
    show($('rc-copy-panel'), false);
  }
  function upcomingDeadline() {
    var d = state.result && state.result.deadline;
    return d && (d.status === 'upcoming' || d.status === 'today') ? d.date : null;
  }
  function updateIcsConfirm() {
    var date = value('rc-ics-date').trim();
    var title = RC.cleanInline(value('rc-ics-title'), 200) || RC.ICS_DEFAULT_TITLE;
    $('rc-ics-confirm').textContent = RC.isDate(date)
      ? 'The file adds one all-day event on ' + date + ' called ' + LQ + title + RQ + '. It contains no amounts or contract details.'
      : 'Choose a date to see what the calendar file will contain.';
  }
  function openRemind(before) {
    // Cancel returns focus to whichever button opened the panel.
    var opener = doc.activeElement;
    state.remindOpener = opener && opener !== doc.body && inside(opener, MAIN) ? opener : null;
    show($('rc-copy-panel'), false);
    var panel = $('rc-remind-panel');
    panel.hidden = false;
    var d = $('rc-ics-date');
    var today = RC.todayLocal();
    state.remindBefore = before || upcomingDeadline();
    d.setAttribute('min', today);
    if (state.remindBefore) { d.setAttribute('max', state.remindBefore); } else { d.removeAttribute('max'); }
    $('rc-ics-hint').textContent = state.remindBefore
      ? 'Choose a date before your notice deadline (' + state.remindBefore + '), so you have time to act.'
      : 'Choose the date on which you want to check the terms.';
    if (!value('rc-ics-title')) { setValue('rc-ics-title', RC.ICS_DEFAULT_TITLE); }
    $('rc-ics-status').textContent = '';
    setError('rc-ics-date', '');
    updateIcsConfirm();
    focusOn(d);
  }
  function downloadIcs() {
    var date = value('rc-ics-date').trim();
    var today = RC.todayLocal();
    var check = RC.validateCheckDate(date, { today: today, deadline: state.remindBefore });
    if (!check.ok) {
      setError('rc-ics-date', check.problems[0].text);
      focusOn($('rc-ics-date'));
      return;
    }
    setError('rc-ics-date', '');
    var r = RC.ics({ date: date, title: value('rc-ics-title'), uidDomain: OWN_DOMAIN });
    if (!r.ok) { setError('rc-ics-date', r.message); return; }
    var blob = new Blob([r.text], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', r.filename);
    a.hidden = true;
    // Keep this generated click away from page-wide click listeners.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) { a.parentNode.removeChild(a); }
    }, 1500);
    var msg = 'Calendar file created: ' + r.filename + '. Open it to add the event. Whether you get an alert depends on your calendar app.';
    if (check.warnings.length) { msg += ' ' + check.warnings[0].text; }
    $('rc-ics-status').textContent = msg;
    track('renewal_calendar_export');
  }
  function copyText(text) {
    var ta = $('rc-email');
    var status = $('rc-copy-status');
    var done = 'Copied. This page does not send the email; you send it yourself from your own mailbox.';
    function fallback() {
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      status.textContent = ok ? done : 'Select the text above and copy it.';
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { status.textContent = done; }, fallback);
    } else {
      fallback();
    }
  }
  function openCopy() {
    show($('rc-remind-panel'), false);
    var g = gather({ silent: true });
    var mail = RC.supplierEmail(planName(g.meta));
    $('rc-email').value = mail.text;
    $('rc-copy-panel').hidden = false;
    $('rc-copy-status').textContent = '';
    copyText(mail.text);
    track('renewal_supplier_copy');
  }

  // ------------------------------------------------------------------
  // Edit, clear, example
  // ------------------------------------------------------------------
  function editInputs() {
    closePanels();
    $('rc-result').hidden = true;
    FORM.hidden = false;
    MAIN.setAttribute('data-rc-view', 'form');
    focusOn($('rc-product'));
  }
  function clearAll(withFocus) {
    FORM.reset();
    var fields = FORM.querySelectorAll('input, select, textarea');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.type === 'checkbox') {
        f.checked = f.defaultChecked;
      } else if (f.tagName === 'SELECT') {
        var def = 0;
        for (var j = 0; j < f.options.length; j++) { if (f.options[j].defaultSelected) { def = j; } }
        f.selectedIndex = def;
      } else {
        f.value = '';
      }
      f.disabled = false;
    }
    setValue('rc-ics-date', '');
    setValue('rc-ics-title', RC.ICS_DEFAULT_TITLE);
    setValue('rc-email', '');
    $('rc-ics-status').textContent = '';
    $('rc-ics-confirm').textContent = '';
    $('rc-copy-status').textContent = '';
    // Everything the last check wrote into the page goes, also inside the hidden result:
    // the notice date in the reminder hint and the date limits, the result category,
    // and the shown/hidden state of the result blocks (review R2-F1).
    $('rc-ics-hint').textContent = '';
    $('rc-ics-date').removeAttribute('min');
    $('rc-ics-date').removeAttribute('max');
    $('rc-verdict').removeAttribute('data-cat');
    $('rc-ref-text').textContent = '';
    var resultLists = ['rc-ref-src', 'rc-amounts', 'rc-includes', 'rc-switching', 'rc-actions', 'rc-check', 'rc-sources', 'rc-report-inputs', 'rc-report-assumptions', 'rc-uncertain'];
    for (var k = 0; k < resultLists.length; k++) { clear($(resultLists[k])); }
    show($('rc-uncertain'), false);
    show($('rc-also'), false);
    show($('rc-switching'), true);
    $('rc-headline').textContent = '';
    $('rc-explanation').textContent = '';
    $('rc-also').textContent = '';
    $('rc-report-date').textContent = '';
    $('rc-switching-note').textContent = '';
    if (announceTimer) { clearTimeout(announceTimer); announceTimer = null; }
    $('rc-announce').textContent = '';
    if (pendingBlur) { pendingBlur = null; }
    state = freshState();
    setGoal(null);
    clearErrors();
    closePanels();
    show($('rc-example-note'), false);
    show($('rc-own'), false);
    $('rc-result').hidden = true;
    FORM.hidden = false;
    MAIN.setAttribute('data-rc-view', 'form');
    renderProductInfo();
    applyVisibility();
    renderSummary();
    if (withFocus) {
      $('rc-sum-status').textContent = 'Your figures are cleared.';
      focusOn($('rc-product'));
    } else {
      $('rc-sum-status').textContent = '';
    }
  }
  function plainNumber(v, exp) {
    var scale = Math.pow(10, exp);
    var whole = Math.floor(v / scale);
    var frac = v - whole * scale;
    if (!frac) { return String(whole); }
    var f = String(frac);
    while (f.length < exp) { f = '0' + f; }
    return String(whole) + '.' + f;
  }
  function setCost(id, text) {
    setValue(id, text);
    var unk = $(id + '-unk');
    if (unk) { unk.checked = text === ''; }
  }
  function setCount(id, v) { setValue(id, typeof v === 'number' ? String(v) : ''); }
  function known(v) { return v !== null && v !== undefined; }
  // Fill the check with the fictional example (the page's own example from
  // #rc-data, else RenewalCore.DEMO) and show its result. The names are
  // fictional, for example "Current tool" and "Alternative". An example can
  // hold a renewal quote, licence counts, must-haves and no option at all.
  function loadExample() {
    var D = CFG.example || RC.DEMO;
    var dates = D.dates || {};
    var seats = D.seats || {};
    var o = D.option || null;
    var feats = (o && o.features) || [];
    var rq = D.renewal_quote || null;
    clearAll(false);
    var ce = RC.CURRENCIES[D.current.currency].exp;
    setValue('rc-product', OTHER);
    setValue('rc-other-name', D.current.name);
    setValue('rc-currency', D.current.currency);
    setValue('rc-amount', plainNumber(D.current.amount, ce));
    setValue('rc-period', D.current.period);
    setValue('rc-tax', D.current.tax);
    $('rc-renewal-unknown').checked = !dates.renewal;
    if (dates.renewal) { setValue('rc-renewal', dates.renewal); }
    state.step2 = true;
    setGoal(D.goal);
    setCount('rc-paid', seats.paid);
    setCount('rc-active', seats.active);
    setCount('rc-min', seats.minimum);
    for (var f = 0; f < 3; f++) { setValue('rc-feat' + (f + 1), feats[f] ? feats[f].label : ''); }
    setValue('rc-notice-known', dates.notice_deadline ? 'yes' : 'no');
    if (dates.notice_deadline) { setValue('rc-notice', dates.notice_deadline); }
    $('rc-rq-has').checked = !!rq;
    if (rq) {
      setValue('rc-rq-amount', plainNumber(rq.amount, RC.CURRENCIES[rq.currency].exp));
      setValue('rc-rq-period', rq.period);
      setValue('rc-rq-tax', rq.tax);
    }
    state.step3 = !!o;
    if (o) {
      var oe = RC.CURRENCIES[o.currency].exp;
      setValue('rc-opt-source', OWN);
      setValue('rc-opt-name', o.name);
      setValue('rc-opt-amount', plainNumber(o.amount, oe));
      setValue('rc-opt-currency', o.currency);
      setValue('rc-opt-period', o.period);
      setValue('rc-opt-tax', o.tax);
      setValue('rc-opt-kind', o.price_source === 'quote' ? 'quote' : 'estimate');
      $('rc-opt-scope').checked = o.scope_confirmed === true;
      $('rc-opt-fit').checked = o.fit_confirmed === true;
      for (var g = 0; g < 3; g++) { setValue('rc-fs' + (g + 1), feats[g] ? (feats[g].status || 'unknown') : 'unknown'); }
      var s = D.switching || {};
      var keys = ['hours', 'hourly_rate', 'implementation', 'overlap', 'other'];
      for (var i = 0; i < COSTS.length; i++) {
        var v = s[keys[i]];
        setCost(COSTS[i][0], known(v) ? plainNumber(v, COSTS[i][1] === 'hours' ? 2 : ce) : '');
      }
      $('rc-sw-confirmed').checked = s.confirmed === true;
    }
    renderProductInfo();
    applyVisibility();
    renderSummary();
    compute({ example: true });
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  function on(id, type, fn) { var n = $(id); if (n) { n.addEventListener(type, fn); } }

  FORM.addEventListener('submit', function (e) { e.preventDefault(); });
  // Error timing. The layout must not move between a mouse press and its release, or the
  // click lands beside the button and is lost (review R1-01, R2-F2). So:
  //   - a shown error disappears while the visitor types, as soon as the value is valid;
  //   - a format error found when the visitor leaves a field is shown at once for the
  //     keyboard, but only after the release when a pointer is pressed (the click on
  //     Next or a checkbox then lands where it was aimed), and it is announced through
  //     the status region, because focus has already moved on (review R4-04);
  //   - an empty required field is only reported on Next or Show.
  function fieldMessage(id) {
    var g = gather({ silent: true });
    return has(g.messages, id) ? g.messages[id] : '';
  }
  function showBlurError(id) {
    if (!$(id)) { return; }
    var msg = fieldMessage(id);
    if (msg) {
      var before = $(id + '-err') ? $(id + '-err').textContent : '';
      setError(id, msg);
      if (before !== msg) { announce(labelText(id) + ': ' + msg); }
    } else if (filled(id)) {
      setError(id, '');
    }
  }
  var pointerDown = false;
  var pendingBlur = null;
  var flushTimer = null;
  function flushBlur() {
    var id = pendingBlur;
    pendingBlur = null;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (id) { showBlurError(id); }
  }
  function flushSoon(ms) {
    if (flushTimer) { clearTimeout(flushTimer); }
    flushTimer = setTimeout(function () { flushTimer = null; flushBlur(); }, ms);
  }
  doc.addEventListener('pointerdown', function () { pointerDown = true; }, true);
  function released() {
    pointerDown = false;
    // Normally the click that follows flushes (below). A touch tap can dispatch its click
    // in a later task, and a long press may not click at all: this timer is the fallback.
    if (pendingBlur) { flushSoon(400); }
  }
  doc.addEventListener('pointerup', released, true);
  doc.addEventListener('pointercancel', released, true);
  // Bubble phase on the document: runs after the clicked button's own handler.
  doc.addEventListener('click', function () { if (pendingBlur) { flushSoon(0); } });
  doc.addEventListener('keydown', function () { if (pendingBlur && !pointerDown) { flushBlur(); } }, true);
  FORM.addEventListener('input', function (e) {
    var t = e.target;
    for (var i = 0; i < COSTS.length; i++) {
      if (t && t.id === COSTS[i][0] && String(t.value || '').trim() !== '') { $(COSTS[i][0] + '-unk').checked = false; }
    }
    if (t && t.id && t.id.indexOf('rc-feat') === 0) { applyVisibility(); }
    // clear, never add, an error while typing
    if (t && t.id && errorShown(t.id) && filled(t.id) && !fieldMessage(t.id)) { setError(t.id, ''); }
    renderSummary();
  });
  FORM.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.id === 'rc-product') { renderProductInfo(); }
    for (var i = 0; i < COSTS.length; i++) {
      if (t && t.id === COSTS[i][0] + '-unk' && t.checked) { setValue(COSTS[i][0], ''); setError(COSTS[i][0], ''); }
    }
    if (t && t.id && t.tagName === 'SELECT' && value(t.id)) { setError(t.id, ''); }
    applyVisibility();
    renderSummary();
  });
  FORM.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || !t.id || t.type === 'checkbox' || !$(t.id + '-err')) { return; }
    if (pointerDown) { pendingBlur = t.id; return; }
    showBlurError(t.id);
  });

  on('rc-start', 'click', function () {
    track('renewal_start', null, 'start');
    if (FORM.hidden) { editInputs(); return; }
    focusOn($('rc-product'));
  });
  on('rc-see-example', 'click', function (e) {
    e.preventDefault();
    loadExample();
  });
  on('rc-try-example', 'click', function () {
    loadExample();
    var r = $('rc-result');
    if (r && r.scrollIntoView) { r.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  });
  on('rc-next1', 'click', nextFromStep1);
  on('rc-next2', 'click', function () { nextFromStep2(false); });
  on('rc-compare-too', 'click', function () { nextFromStep2(true); });
  on('rc-show', 'click', showFromStep3);
  on('rc-remove3', 'click', removeComparison);
  var goalBtns = goalRadios();
  for (var gb = 0; gb < goalBtns.length; gb++) {
    goalBtns[gb].addEventListener('click', function (e) { setGoal(e.currentTarget.getAttribute('data-goal')); });
    goalBtns[gb].addEventListener('keydown', goalKey);
  }
  on('rc-print', 'click', function () { track('renewal_print'); window.print(); });
  on('rc-remind', 'click', function () { openRemind(null); });
  on('rc-copy', 'click', openCopy);
  on('rc-copy-again', 'click', function () { copyText(value('rc-email')); track('renewal_supplier_copy'); });
  on('rc-edit', 'click', editInputs);
  on('rc-clear', 'click', function () { clearAll(true); });
  on('rc-own', 'click', function () { clearAll(false); focusOn($('rc-product')); });
  on('rc-ics-date', 'input', updateIcsConfirm);
  on('rc-ics-date', 'change', updateIcsConfirm);
  on('rc-ics-title', 'input', updateIcsConfirm);
  on('rc-ics-download', 'click', downloadIcs);
  on('rc-ics-cancel', 'click', function () {
    var back = state.remindOpener;
    state.remindOpener = null;
    show($('rc-remind-panel'), false);
    // back to the button that opened the panel, if it is still on the page and visible
    focusOn(back && inside(back, MAIN) && back.offsetParent !== null ? back : $('rc-remind'));
  });
  doc.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== doc && !(t.tagName === 'A' && t.getAttribute('data-rc-review') === '1')) { t = t.parentNode; }
    if (t && t !== doc) { track('renewal_review_click'); }
  });
  // A page restored from the back/forward cache must not show old figures.
  window.addEventListener('pageshow', function (e) { if (e.persisted) { clearAll(false); } });

  populateCandidates();
  clearAll(false);
}());
