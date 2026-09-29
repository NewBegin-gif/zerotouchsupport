/*
 * test-drive-ui.js - Software Test Drive: shortlist, requirements, test plan,
 * decision sheet, print report, JSON download and import, supplier questions.
 *
 * Every status, headline, count and caution comes from TestDriveCore
 * (test-drive-core.js). This file reads the form, calls the core and writes
 * plain text into the page.
 *
 * Source rules (checked by build_test_drive.py):
 *   - ASCII only and no backslash; special characters via String.fromCharCode.
 *   - Rendering with createElement and textContent only.
 *   - No storage, no network calls, no changes to the address bar or title.
 *   - Analytics only through track(): the fixed whitelist in TestDriveCore,
 *     queued on window.__ga4wacht (see /ga4-gate.js). Never an input value.
 *   - Page data comes from the inline JSON block #td-data, never fetched.
 */
(function () {
  'use strict';

  var C = window.TestDriveCore;
  var doc = document;
  var FORM = doc.getElementById('td-form');
  if (!C || !FORM) { return; }

  var CH = String.fromCharCode;
  var MID = ' ' + CH(0xB7) + ' ';
  var DASH = ' ' + CH(0x2014) + ' ';
  var OTHER = '__other';
  var SLOTS = ['a', 'b'];

  function $(id) { return doc.getElementById(id); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
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
  function setValue(id, v) { var n = $(id); if (n) { n.value = v === null || v === undefined ? '' : String(v); } }
  function checked(id) { var n = $(id); return !!(n && n.checked); }
  function setChecked(id, on) { var n = $(id); if (n) { n.checked = !!on; } }
  function on(id, ev, fn) { var n = $(id); if (n) { n.addEventListener(ev, fn); } }

  // ------------------------------------------------------------------
  // Page data (inline JSON, never fetched)
  // ------------------------------------------------------------------
  function readConfig() {
    var node = $('td-data');
    if (!node) { return null; }
    try { return JSON.parse(node.textContent || 'null'); } catch (e) { return null; }
  }
  var CFG = readConfig() || {};
  var SITE = CFG.site || null;
  var T = CFG.template || { tests: [], access: [] };
  var CANDIDATES = CFG.candidates || [];
  var FIX = CFG.fixtures || {};
  var DOMAIN = CFG.domain || '';

  // ------------------------------------------------------------------
  // Analytics: fixed names and values only, queued behind the GA4 gate
  // ------------------------------------------------------------------
  var sentOnce = {};
  function track(name, extra, onceKey) {
    if (onceKey && sentOnce[onceKey]) { return false; }
    var params = { site: SITE, theme: T.theme };
    if (extra) { for (var k in extra) { if (has(extra, k)) { params[k] = extra[k]; } } }
    var ev = C.analyticsEvent(name, params);
    if (!ev) { return false; }
    if (onceKey) { sentOnce[onceKey] = true; }
    var copy = {};
    for (var p in ev.params) { if (has(ev.params, p)) { copy[p] = ev.params[p]; } }
    var queue = window.__ga4wacht = window.__ga4wacht || [];
    queue.push(function () { if (typeof window.gtag === 'function') { window.gtag('event', ev.name, copy); } });
    return true;
  }

  // ------------------------------------------------------------------
  // State: the session (what the visitor saved) and drafts (not saved yet)
  // ------------------------------------------------------------------
  var today = C.todayLocal();
  var state = { session: C.newSession(T, SITE, today), step: 0, drafts: {}, changedSinceDownload: false };

  function announce(s) {
    var n = $('td-announce');
    if (!n) { return; }
    n.textContent = '';
    setTimeout(function () { n.textContent = s; }, 30);
  }
  function setError(id, msg) {
    var field = $(id);
    var err = $(id + '-err');
    if (err) { err.textContent = msg || ''; show(err, !!msg); }
    if (field) {
      if (msg) { field.setAttribute('aria-invalid', 'true'); } else { field.removeAttribute('aria-invalid'); }
    }
  }
  function focusOn(n) {
    if (!n) { return; }
    if (!n.hasAttribute('tabindex') && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(n.tagName)) { n.setAttribute('tabindex', '-1'); }
    n.focus();
  }
  function candidate(id) {
    for (var i = 0; i < CANDIDATES.length; i++) { if (CANDIDATES[i].product_id === id) { return CANDIDATES[i]; } }
    return null;
  }
  function productLabel(p) {
    var n = p && p.name ? p.name : 'Product ' + (p && p.slot === 'b' ? 'B' : 'A');
    return p && p.plan_tested ? n + ' (' + p.plan_tested + ')' : n;
  }
  function markChanged() {
    state.changedSinceDownload = true;
    state.session.updated_at = today;
  }

  // ------------------------------------------------------------------
  // Steps
  // ------------------------------------------------------------------
  var STEP_IDS = ['td-step1', 'td-step2', 'td-step3', 'td-step4'];
  function goTo(step, focus) {
    show($('td-app'), true);
    for (var i = 0; i < STEP_IDS.length; i++) { show($(STEP_IDS[i]), i === step - 1); }
    state.step = step;
    if (step === 3) { renderPlan(); track('plan_created', null, 'plan_created'); }
    if (step === 4) { renderDecision(); track('comparison_opened', null, 'comparison_opened'); }
    var rail = $('td-rail');
    if (rail) {
      var items = rail.getElementsByTagName('li');
      for (var j = 0; j < items.length; j++) {
        if (j === step - 1) { items[j].setAttribute('aria-current', 'step'); } else { items[j].removeAttribute('aria-current'); }
      }
    }
    if (focus !== false) { focusOn($('td-step' + step + '-h')); }
  }

  // ------------------------------------------------------------------
  // Step 1: your shortlist
  // ------------------------------------------------------------------
  function slotShown(slot) { return slot === 'a' || !$('td-prod-b').hidden; }
  function syncPick(slot) {
    var pick = value('td-' + slot + '-pick');
    var c = candidate(pick);
    show($('td-' + slot + '-name-f'), pick === OTHER);
    var info = $('td-' + slot + '-cand');
    if (info) {
      clear(info);
      if (c) {
        txt(info, 'Product-specific steps for ' + c.name + ' are not ready yet: the general steps below apply to it as to any other product.');
        show(info, true);
      } else {
        show(info, false);
      }
    }
  }
  function readProduct(slot, silent) {
    var pick = value('td-' + slot + '-pick');
    var c = candidate(pick);
    var name = c ? c.name : value('td-' + slot + '-name').trim();
    var p = {
      slot: slot, name: name, product_id: c ? c.product_id : null,
      plan_tested: value('td-' + slot + '-plan').trim(), plan_target: value('td-' + slot + '-target').trim(),
      access: value('td-' + slot + '-access') || '', answers: value('td-' + slot + '-answers') || 'ai',
      config: value('td-' + slot + '-config')
    };
    var bad = null;
    if (!silent) {
      setError('td-' + slot + '-pick', pick ? '' : 'Choose a product, or choose Another product.');
      setError('td-' + slot + '-name', pick === OTHER && !name ? 'Enter the name of the product.' : '');
      setError('td-' + slot + '-plan', p.plan_tested ? '' : 'Enter the plan you will test, for example Free, Trial or Team.');
      setError('td-' + slot + '-access', p.access ? '' : 'Choose whether you test a trial or a paid plan, or Not sure.');
      if (!pick) { bad = 'td-' + slot + '-pick'; } else if (pick === OTHER && !name) { bad = 'td-' + slot + '-name'; } else if (!p.plan_tested) {
        bad = 'td-' + slot + '-plan';
      } else if (!p.access) { bad = 'td-' + slot + '-access'; }
    }
    if (!p.access) { p.access = 'unknown'; }
    return { product: p, bad: bad };
  }
  function saveStep1(silent) {
    var products = [];
    var firstBad = null;
    for (var i = 0; i < SLOTS.length; i++) {
      if (!slotShown(SLOTS[i])) { continue; }
      var r = readProduct(SLOTS[i], silent);
      if (r.bad && !firstBad) { firstBad = r.bad; }
      products.push(r.product);
    }
    if (firstBad) { return firstBad; }
    var before = JSON.stringify(state.session.products);
    state.session.products = products;
    if (JSON.stringify(products) !== before) { markChanged(); }
    // results of a removed product go with it
    if (!slotShown('b') && state.session.results.b) { delete state.session.results.b; delete state.drafts.b; }
    return null;
  }
  function fillStep1() {
    show($('td-prod-b'), false);
    show($('td-add-b'), true);
    for (var i = 0; i < state.session.products.length; i++) {
      var p = state.session.products[i];
      var s = p.slot;
      if (s === 'b') { show($('td-prod-b'), true); show($('td-add-b'), false); }
      var pick = p.product_id && candidate(p.product_id) ? p.product_id : (p.name ? OTHER : '');
      setValue('td-' + s + '-pick', pick);
      setValue('td-' + s + '-name', pick === OTHER ? p.name : '');
      setValue('td-' + s + '-plan', p.plan_tested);
      setValue('td-' + s + '-target', p.plan_target);
      setValue('td-' + s + '-access', p.access === 'unknown' && !p.plan_tested ? '' : p.access);
      setValue('td-' + s + '-answers', p.answers || 'ai');
      setValue('td-' + s + '-config', p.config || '');
      syncPick(s);
    }
    if (state.session.products.length < 2) {
      var ids = ['pick', 'name', 'plan', 'target', 'access', 'config'];
      for (var j = 0; j < ids.length; j++) { setValue('td-b-' + ids[j], ''); }
      syncPick('b');
    }
  }

  // ------------------------------------------------------------------
  // Step 2: what must work
  // ------------------------------------------------------------------
  function saveStep2(silent) {
    var ess = [];
    for (var i = 0; i < T.tests.length; i++) { if (checked('td-req-' + T.tests[i].id)) { ess.push(T.tests[i].id); } }
    var custom = null;
    var bad = null;
    if (checked('td-custom-on')) {
      var label = value('td-custom-label').trim();
      var success = value('td-custom-success').trim();
      if (!silent) {
        setError('td-custom-label', label ? '' : 'Name your requirement in a few words.');
        setError('td-custom-success', success ? '' : 'Describe what you must be able to see for this to pass.');
      }
      if (!label) { bad = bad || 'td-custom-label'; } else if (!success) { bad = bad || 'td-custom-success'; }
      custom = { label: label, success: success };
      if (label && success) { ess.push('custom'); }
    } else if (!silent) {
      setError('td-custom-label', '');
      setError('td-custom-success', '');
    }
    if (!silent) {
      var msg = '';
      if (!ess.length) { msg = 'Choose at least one essential requirement.'; } else if (ess.length > 3) {
        msg = 'Choose at most three essential requirements, your own requirement included.';
      }
      var err = $('td-reqs-err');
      if (err) { err.textContent = msg; show(err, !!msg); }
      var group = $('td-reqs');
      if (group) { if (msg) { group.setAttribute('aria-invalid', 'true'); } else { group.removeAttribute('aria-invalid'); } }
      if (msg && !bad) { bad = 'td-req-' + T.tests[0].id; }
    }
    if (bad) { return bad; }
    var acc = [];
    for (var a = 0; a < (T.access || []).length; a++) { if (checked('td-acc-' + T.access[a].id)) { acc.push(T.access[a].id); } }
    var s = state.session;
    var before = JSON.stringify([s.requirements, s.environment]);
    // keep the order and the change log of anything already essential
    var list = [];
    for (var k = 0; k < ess.length && list.length < 3; k++) { list.push(ess[k]); }
    var old = s.requirements.essential || [];
    for (var o = 0; o < old.length; o++) { if (list.indexOf(old[o]) < 0) { C.setEssential(s, old[o], false, today); } }
    for (var n = 0; n < list.length; n++) { if (old.indexOf(list[n]) < 0) { C.setEssential(s, list[n], true, today); } }
    s.requirements.custom = custom && custom.label && custom.success ? custom : null;
    if (!s.requirements.custom && s.requirements.essential.indexOf('custom') >= 0) {
      s.requirements.essential.splice(s.requirements.essential.indexOf('custom'), 1);
    }
    s.environment = { separate: value('td-env') || 'unsure', access: acc, budget: value('td-budget').trim().slice(0, 60) };
    if (JSON.stringify([s.requirements, s.environment]) !== before) { markChanged(); }
    return null;
  }
  function fillStep2() {
    var s = state.session;
    for (var i = 0; i < T.tests.length; i++) { setChecked('td-req-' + T.tests[i].id, C.isEssential(s, T.tests[i].id)); }
    var c = s.requirements.custom;
    setChecked('td-custom-on', !!c);
    show($('td-custom-fields'), !!c);
    setValue('td-custom-label', c ? c.label : '');
    setValue('td-custom-success', c ? c.success : '');
    setValue('td-env', s.environment.separate || 'unsure');
    for (var a = 0; a < (T.access || []).length; a++) { setChecked('td-acc-' + T.access[a].id, s.environment.access.indexOf(T.access[a].id) >= 0); }
    setValue('td-budget', s.environment.budget || '');
  }

  // ------------------------------------------------------------------
  // Step 3: the test plan (cards)
  // ------------------------------------------------------------------
  function list(parent, tag, items, cls) {
    var l = add(parent, el(tag, cls || null));
    for (var i = 0; i < items.length; i++) { add(l, el('li', null, items[i])); }
    return l;
  }
  function accessLabel(id) {
    for (var i = 0; i < (T.access || []).length; i++) { if (T.access[i].id === id) { return T.access[i].label; } }
    return id;
  }
  function draftFor(slot, test, product) {
    var d = state.drafts[slot] = state.drafts[slot] || {};
    if (d[test.id]) { return d[test.id]; }
    var needed = C.runsNeeded(test, product);
    var saved = state.session.results[slot] && state.session.results[slot][test.id];
    var runs = [];
    for (var i = 0; i < needed; i++) {
      var r = saved && saved.runs && saved.runs[i];
      runs.push({ status: r ? r.status : 'not_tested', reason: r && r.reason ? r.reason : '' });
    }
    d[test.id] = { runs: runs, note: saved ? saved.note || '' : '', minutes: saved && has(saved, 'minutes') ? String(saved.minutes) : '' };
    return d[test.id];
  }
  function statusOptions(sel, current) {
    for (var i = 0; i < C.STATUSES.length; i++) {
      var o = add(sel, el('option', null, C.STATUS_TEXT[C.STATUSES[i]]));
      o.value = C.STATUSES[i];
      if (C.STATUSES[i] === current) { o.selected = true; }
    }
  }
  function reasonOptions(sel, current) {
    var o0 = add(sel, el('option', null, 'Choose a reason'));
    o0.value = '';
    for (var k in C.BLOCK_REASONS) {
      if (!has(C.BLOCK_REASONS, k)) { continue; }
      var o = add(sel, el('option', null, C.BLOCK_REASONS[k]));
      o.value = k;
      if (k === current) { o.selected = true; }
    }
  }
  function field(parent, id, labelText, control, help) {
    var f = add(parent, el('div', 'td-field'));
    var l = add(f, el('label', null, labelText));
    l.setAttribute('for', id);
    control.id = id;
    var desc = [];
    if (help) {
      var h = add(f, el('p', 'td-help', help));
      h.id = id + '-help';
      desc.push(h.id);
    }
    add(f, control);
    var err = add(f, el('p', 'td-err'));
    err.id = id + '-err';
    err.hidden = true;
    desc.push(err.id);
    control.setAttribute('aria-describedby', desc.join(' '));
    return f;
  }
  function savedLine(slot, test) {
    var e = C.effective(state.session, T, slot, test);
    var res = state.session.results[slot] && state.session.results[slot][test.id];
    if (!res) { return 'Not recorded yet.'; }
    var s = 'Saved on ' + C.dateText(res.observed_at) + ': ' + C.STATUS_TEXT[e.recorded_status || e.status];
    if (e.needed > 1) { s += ' (' + e.counts.passed + ' of ' + e.needed + ' runs passed)'; }
    if (e.recorded_status === 'blocked' && e.reason) { s += DASH + C.BLOCK_REASONS[e.reason].toLowerCase(); }
    if (e.outdated) { s += '. This test was reworded since then: test it again.'; }
    return s + '.';
  }
  function resultBlock(card, slot, test, product, k) {
    var box = add(card, el('div', 'td-result'));
    box.setAttribute('data-slot', slot);
    var head = add(box, el('h4', null, 'Result for ' + productLabel(product)));
    head.id = 'td-rh-' + slot + '-' + test.id;
    var dr = draftFor(slot, test, product);
    var pre = 'td-r-' + slot + '-' + k;
    for (var i = 0; i < dr.runs.length; i++) {
      var row = add(box, el('div', 'td-run'));
      var label = dr.runs.length > 1 ? 'Run ' + (i + 1) + ' of ' + dr.runs.length + ': status' : 'Status';
      var sel = el('select');
      sel.setAttribute('autocomplete', 'off');
      statusOptions(sel, dr.runs[i].status);
      field(row, pre + '-s' + i, label, sel, i === 0 && dr.runs.length > 1 ?
        'With AI answers, ask each question three times, each in a new conversation. Passed needs 3 of 3.' : null);
      var rs = el('select');
      rs.setAttribute('autocomplete', 'off');
      reasonOptions(rs, dr.runs[i].reason);
      var rf = field(row, pre + '-b' + i, 'Why was it blocked?', rs, null);
      rf.hidden = dr.runs[i].status !== 'blocked';
      (function (idx, s1, rwrap, rsel) {
        s1.addEventListener('change', function () {
          dr.runs[idx].status = s1.value;
          rwrap.hidden = s1.value !== 'blocked';
        });
        rsel.addEventListener('change', function () { dr.runs[idx].reason = rsel.value; });
      }(i, sel, rf, rs));
    }
    var note = el('textarea');
    note.setAttribute('rows', '3');
    note.setAttribute('maxlength', String(C.LIMITS.note));
    note.value = dr.note;
    note.addEventListener('input', function () { dr.note = note.value; });
    field(box, pre + '-note', 'What did you observe?', note, 'Your own notes: record IDs, what you saw, what you did not check.');
    var mins = el('input');
    mins.setAttribute('type', 'text');
    mins.setAttribute('inputmode', 'numeric');
    mins.setAttribute('maxlength', '5');
    mins.setAttribute('autocomplete', 'off');
    mins.value = dr.minutes;
    mins.addEventListener('input', function () { dr.minutes = mins.value; });
    field(box, pre + '-min', 'Minutes it took you (optional)', mins, 'Your own indication, not a benchmark.');
    var btn = add(box, el('button', 'btn small', 'Save result'));
    btn.setAttribute('type', 'button');
    var line = add(box, el('p', 'td-saved', savedLine(slot, test)));
    line.id = pre + '-saved';
    btn.addEventListener('click', function () { saveResult(slot, test, pre, line); });
  }
  function saveResult(slot, test, pre, line) {
    var dr = draftFor(slot, test, C.productBySlot(state.session, slot));
    for (var i = 0; i < dr.runs.length; i++) {
      setError(pre + '-b' + i, dr.runs[i].status === 'blocked' && !dr.runs[i].reason ? 'Choose why this test was blocked.' : '');
    }
    setError(pre + '-min', '');
    setError(pre + '-note', '');
    var r = C.recordResult(state.session, T, slot, test.id, { runs: dr.runs, note: dr.note, minutes: dr.minutes }, today);
    if (!r.ok) {
      var target = typeof r.field === 'number' ? pre + '-b' + r.field : (r.field === 'minutes' ? pre + '-min' : pre + '-note');
      setError(target, r.message);
      focusOn($(target));
      return;
    }
    markChanged();
    line.textContent = savedLine(slot, test);
    track('result_recorded', { status: r.summary.status });
    renderProgress();
    announce('Saved for ' + productLabel(C.productBySlot(state.session, slot)) + ': ' + C.STATUS_TEXT[r.summary.status] + '.');
  }
  function renderProgress() {
    var n = $('td-progress');
    if (!n) { return; }
    clear(n);
    for (var i = 0; i < state.session.products.length; i++) {
      var p = state.session.products[i];
      var d = C.decide(state.session, T, p.slot);
      add(n, el('li', null, productLabel(p) + ': ' + d.recorded + ' of ' + d.total + ' recorded'));
    }
  }
  function renderPlan() {
    var box = $('td-cards');
    clear(box);
    var s = state.session;
    var tests = C.orderedTests(T, s);
    for (var k = 0; k < tests.length; k++) {
      var t = tests[k];
      var ess = C.isEssential(s, t.id);
      var card = add(box, el('article', 'td-card' + (ess ? ' is-essential' : '')));
      card.id = 'td-card-' + t.id;
      var head = add(card, el('div', 'td-card-head'));
      add(head, el('span', 'td-badge', ess ? 'Essential' : 'Other test'));
      var h = add(head, el('h3', null, (t.custom ? 'Your requirement' : 'Test ' + t.id.split('-')[1]) + ': ' + t.title));
      h.id = 'td-h-' + t.id;
      var tog = add(head, el('button', 'td-linkbtn', ess ? 'Make it an other test' : 'Make it essential'));
      tog.setAttribute('type', 'button');
      tog.setAttribute('aria-describedby', h.id);
      (function (id, isEss) {
        tog.addEventListener('click', function () {
          var r = C.setEssential(state.session, id, !isEss, today);
          if (!r.ok) { announce(r.message); var e2 = $('td-plan-msg'); if (e2) { e2.textContent = r.message; show(e2, true); } return; }
          show($('td-plan-msg'), false);
          markChanged();
          fillStep2();
          renderPlan();
          focusOn($('td-h-' + id));
        });
      }(t.id, ess));
      add(card, el('p', 'td-objective', t.objective));
      var dl = add(card, el('dl', 'td-facts'));
      add(dl, el('dt', null, 'Test data'));
      add(dl, el('dd', null, t.test_data));
      add(card, el('h4', null, 'Before you start'));
      list(card, 'ul', t.preparation);
      add(card, el('h4', null, 'Steps'));
      list(card, 'ol', t.steps);
      add(card, el('h4', null, 'You can call it passed when'));
      list(card, 'ul', t.expected);
      add(card, el('h4', null, 'Not proof on its own'));
      list(card, 'ul', t.non_evidence);
      var missing = [];
      for (var n = 0; n < (t.needs || []).length; n++) {
        if (s.environment.access.indexOf(t.needs[n]) < 0) { missing.push(accessLabel(t.needs[n]).toLowerCase()); }
      }
      if (missing.length || t.blocked_hint) {
        var warn = add(card, el('div', 'td-note'));
        if (missing.length) { add(warn, el('p', null, 'You did not tick: ' + missing.join('; ') + '. Without it, this test may be blocked.')); }
        if (t.blocked_hint) { add(warn, el('p', null, t.blocked_hint)); }
      }
      add(card, el('p', 'td-scope', 'General test: no product-specific steps are verified for this test yet.'));
      for (var j = 0; j < s.products.length; j++) { resultBlock(card, s.products[j].slot, t, s.products[j], k); }
    }
    renderProgress();
  }

  // ------------------------------------------------------------------
  // Step 4: the decision sheet
  // ------------------------------------------------------------------
  function rowText(r) {
    var s = C.STATUS_TEXT[r.status] + DASH + r.title;
    if (r.status === 'blocked' && r.reason) { s += ' (' + C.BLOCK_REASONS[r.reason].toLowerCase() + ')'; }
    if (r.needed > 1 && r.recorded) {
      var p = 0;
      for (var i = 0; i < r.runs.length; i++) { if (r.runs[i].status === 'passed') { p += 1; } }
      s += ' (' + p + ' of ' + r.needed + ' runs passed' + (r.recorded < r.needed ? ', ' + r.recorded + ' of ' + r.needed + ' recorded' : '') + ')';
    }
    if (r.outdated) { s += ' (reworded since you recorded it: test again)'; }
    return s;
  }
  function statusList(parent, rows) {
    var ul = add(parent, el('ul', 'td-statuslist'));
    for (var i = 0; i < rows.length; i++) {
      var li = add(ul, el('li', null));
      li.setAttribute('data-status', rows[i].status);
      add(li, el('span', 'td-dot'));
      txt(li, rowText(rows[i]));
    }
    return ul;
  }
  function renderDecision() {
    var box = $('td-sheets');
    clear(box);
    var s = state.session;
    show($('td-example-note'), !!s.example);
    box.className = 'td-sheets' + (s.products.length > 1 ? ' two' : '');
    for (var i = 0; i < s.products.length; i++) {
      var p = s.products[i];
      var d = C.decide(s, T, p.slot);
      var sec = add(box, el('section', 'panel td-sheet'));
      sec.setAttribute('data-key', d.key);
      sec.setAttribute('aria-labelledby', 'td-sheet-h-' + p.slot);
      add(sec, el('p', 'td-kicker', productLabel(p)));
      var h = add(sec, el('h3', null, d.headline));
      h.id = 'td-sheet-h-' + p.slot;
      add(sec, el('p', 'td-sub', d.subtitle));
      if (d.essential.length) {
        add(sec, el('h4', null, 'Essential requirements'));
        add(sec, el('p', 'td-count', d.essential_text));
        statusList(sec, d.essential);
      }
      if (d.other.length) {
        add(sec, el('h4', null, 'Other tests'));
        add(sec, el('p', 'td-count', d.other_text));
        statusList(sec, d.other);
      }
      if (d.cautions.length) {
        var c = add(sec, el('div', 'td-note'));
        add(c, el('p', 'td-boxtitle', 'Keep in mind'));
        list(c, 'ul', d.cautions);
      }
      var notes = [];
      var rows = d.essential.concat(d.other);
      for (var n = 0; n < rows.length; n++) { if (rows[n].note) { notes.push(rows[n].title + ': ' + rows[n].note); } }
      if (notes.length) {
        add(sec, el('h4', null, 'Your notes'));
        list(sec, 'ul', notes, 'td-notes');
      }
      add(sec, el('p', 'td-help', 'A passed test drive shows that these tests passed in your set-up. It does not show that the software fits every use, keeps up at a larger scale, or is secure.'));
    }
    renderQuestionsPicker();
    renderReviews();
    announce(s.products.length > 1 ? 'Your decision sheet for both products is ready.' : 'Your decision sheet is ready.');
  }
  function renderReviews() {
    var box = $('td-reviews');
    if (!box) { return; }
    clear(box);
    var shown = 0;
    for (var i = 0; i < state.session.products.length; i++) {
      var c = candidate(state.session.products[i].product_id);
      if (!c || !c.canonical_review_url) { continue; }
      var p = add(box, el('p', null, 'Background on ' + c.name + ': '));
      var href = c.canonical_review_url;
      var own = 'https://' + DOMAIN;
      var a = add(p, el('a', null, 'our ' + c.name + ' review'));
      if (href.indexOf(own + '/') === 0) { a.setAttribute('href', href.slice(own.length)); } else {
        a.setAttribute('href', href);
        a.setAttribute('rel', 'nofollow noopener');
      }
      a.setAttribute('target', '_blank');
      a.setAttribute('data-td-review', '1');
      a.setAttribute('data-print-url', href);
      add(a, el('span', 'td-vh', ' (opens in a new tab)'));
      shown += 1;
    }
    show(box, shown > 0);
  }
  function renderQuestionsPicker() {
    var sel = $('td-q-product');
    if (!sel) { return; }
    clear(sel);
    for (var i = 0; i < state.session.products.length; i++) {
      var p = state.session.products[i];
      var o = add(sel, el('option', null, productLabel(p)));
      o.value = p.slot;
    }
    show($('td-q-product-f'), state.session.products.length > 1);
    show($('td-q-panel'), false);
  }

  // ------------------------------------------------------------------
  // Print report (plan section 8): product and plan, requirements, versions,
  // date, statuses, notes, open items and sources
  // ------------------------------------------------------------------
  function buildReport() {
    var r = $('td-report');
    if (!r) { return; }
    clear(r);
    var s = state.session;
    add(r, el('h2', null, 'Software Test Drive' + DASH + T.title));
    add(r, el('p', null, (s.example ? 'Example with fictional results. ' : '') + 'Printed on ' + C.dateText(today) +
      MID + 'tests version ' + T.version + MID + 'test data version ' + (s.fixture_version || T.fixture_version)));
    var req = [];
    var es = s.requirements.essential || [];
    for (var i = 0; i < es.length; i++) { var t = C.testById(T, s, es[i]); if (t) { req.push(t.title); } }
    add(r, el('p', null, 'Essential requirements: ' + (req.join('; ') || 'none chosen')));
    if (s.requirements.custom) { add(r, el('p', null, 'Your own requirement passes when: ' + s.requirements.custom.success)); }
    for (var k = 0; k < s.products.length; k++) {
      var p = s.products[k];
      var d = C.decide(s, T, p.slot);
      var sec = add(r, el('section', 'td-rep-product'));
      add(sec, el('h3', null, productLabel(p) + DASH + d.headline));
      add(sec, el('p', null, d.subtitle));
      var facts = 'Access: ' + C.ACCESS[p.access || 'unknown'];
      if (p.plan_target) { facts += MID + 'plan you would buy: ' + p.plan_target; }
      add(sec, el('p', null, facts));
      if (p.config) { add(sec, el('p', null, 'Set-up: ' + p.config)); }
      if (d.essential_text) { add(sec, el('p', null, d.essential_text)); }
      if (d.other_text) { add(sec, el('p', null, d.other_text)); }
      statusList(sec, d.essential.concat(d.other));
      var notes = [];
      var rows = d.essential.concat(d.other);
      for (var n = 0; n < rows.length; n++) { if (rows[n].note) { notes.push(rows[n].title + ': ' + rows[n].note); } }
      if (notes.length) { add(sec, el('p', null, 'Notes')); list(sec, 'ul', notes); }
      if (d.cautions.length) { add(sec, el('p', null, 'Keep in mind')); list(sec, 'ul', d.cautions); }
    }
    add(r, el('p', null, 'Your own results, recorded on your own device. Not an editorial benchmark and not a statement about reliability, security or legal compliance.'));
    add(r, el('p', null, 'Test drive: https://' + DOMAIN + (CFG.route || '')));
  }

  // ------------------------------------------------------------------
  // Files: download, import, test data
  // ------------------------------------------------------------------
  function saveFile(text, name, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', name);
    a.hidden = true;
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) { a.parentNode.removeChild(a); }
    }, 1500);
  }
  function download() {
    saveResultsFromSteps();
    var name = C.exportFilename(state.session, today);
    saveFile(C.exportText(state.session), name, 'application/json;charset=utf-8');
    state.changedSinceDownload = false;
    $('td-file-status').textContent = 'Saved as ' + name + ' in your downloads. The file stays on your device; keep it to continue later.';
    track('export_downloaded');
  }
  function saveResultsFromSteps() {
    if (state.step === 1) { saveStep1(true); }
    if (state.step === 2) { saveStep2(true); }
  }
  function importStatus(msgs, isError) {
    var n = $('td-file-status');
    clear(n);
    n.className = 'td-filestatus' + (isError ? ' is-error' : '');
    for (var i = 0; i < msgs.length; i++) { add(n, el('p', null, msgs[i])); }
  }
  function openFile() {
    var input = $('td-file');
    if (input) { input.value = ''; input.click(); }
  }
  function readFile() {
    var input = $('td-file');
    var f = input && input.files && input.files[0];
    if (!f) { return; }
    show($('td-app'), true);
    if (state.step === 0) { goTo(4, false); show($('td-step4'), true); }
    if (f.size > C.MAX_IMPORT_BYTES) {
      importStatus(['This file is larger than 1 MB. A saved test drive is much smaller: choose the file you downloaded here. Your current plan is unchanged.'], true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var r = C.importSession(text, f.size, { site: SITE, template: T, today: today });
      if (!r.ok) {
        importStatus(r.errors.concat(['Your current plan is unchanged.']), true);
        announce(r.errors[0]);
        return;
      }
      state.session = r.session;
      state.drafts = {};
      state.changedSinceDownload = false;
      fillStep1();
      fillStep2();
      goTo(4);
      importStatus(['Your saved test drive is loaded.'].concat(r.notices), false);
      announce('Your saved test drive is loaded.');
    };
    reader.onerror = function () { importStatus(['The file could not be read. Your current plan is unchanged.'], true); };
    reader.readAsText(f);
  }
  function fixtureDownload(kind) {
    if (kind === 'csv') {
      saveFile(C.csv(FIX.contacts || [], ['first_name', 'email', 'segment', 'permission_status', 'company']),
        'test-drive-contacts-' + (CFG.fixture_version || '1.0') + '.csv', 'text/csv;charset=utf-8');
      return;
    }
    var data = { fixture_version: CFG.fixture_version, synthetic: true,
      instructions: 'Fictional data for isolated tests only. Never send messages to these addresses.', data: FIX };
    saveFile(JSON.stringify(data, null, 2) + CH(10), 'test-drive-data-' + SITE + '-' + (CFG.fixture_version || '1.0') + '.json',
      'application/json;charset=utf-8');
  }

  // ------------------------------------------------------------------
  // Supplier questions (copied by the visitor; this page sends nothing)
  // ------------------------------------------------------------------
  function openQuestions() {
    var slot = state.session.products.length > 1 ? value('td-q-product') || 'a' : 'a';
    $('td-questions').value = C.supplierQuestions(state.session, T, slot);
    show($('td-q-panel'), true);
    focusOn($('td-questions'));
  }
  function copyQuestions() {
    var ta = $('td-questions');
    var status = $('td-copy-status');
    var done = 'Copied. Paste it into your own email: this page sends nothing.';
    function fallback() {
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      status.textContent = ok ? done : 'Select the text above and copy it.';
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(ta.value).then(function () { status.textContent = done; }, fallback);
    } else { fallback(); }
  }

  // ------------------------------------------------------------------
  // Start, sample, clear
  // ------------------------------------------------------------------
  function start() {
    if (state.session.example) { clearSession(false); }
    fillStep1();
    goTo(1);
    track('testdrive_start', null, 'testdrive_start');
  }
  function sample() {
    state.session = C.exampleSession(T, SITE, today);
    state.drafts = {};
    state.changedSinceDownload = false;
    fillStep1();
    fillStep2();
    goTo(4);
  }
  function clearSession(announceIt) {
    state.session = C.newSession(T, SITE, today);
    state.drafts = {};
    state.changedSinceDownload = false;
    var fields = FORM.querySelectorAll('input, select, textarea');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.type === 'checkbox') { f.checked = false; } else if (f.type !== 'file') { f.value = ''; }
      f.removeAttribute('aria-invalid');
    }
    var errs = FORM.querySelectorAll('.td-err');
    for (var j = 0; j < errs.length; j++) { errs[j].textContent = ''; errs[j].hidden = true; }
    clear($('td-cards'));
    clear($('td-sheets'));
    clear($('td-report'));
    clear($('td-file-status'));
    show($('td-q-panel'), false);
    show($('td-custom-fields'), false);
    fillStep1();
    fillStep2();
    if (announceIt !== false) {
      goTo(1);
      announce('Cleared. Your plan and results are gone from this page.');
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  on('td-start', 'click', start);
  on('td-sample', 'click', function () { sample(); });
  on('td-open', 'click', openFile);
  on('td-open2', 'click', openFile);
  on('td-file', 'change', readFile);
  on('td-add-b', 'click', function () {
    show($('td-prod-b'), true);
    show($('td-add-b'), false);
    focusOn($('td-b-pick'));
  });
  on('td-remove-b', 'click', function () {
    show($('td-prod-b'), false);
    show($('td-add-b'), true);
    saveStep1(true);
    focusOn($('td-add-b'));
  });
  for (var s = 0; s < SLOTS.length; s++) {
    (function (slot) { on('td-' + slot + '-pick', 'change', function () { syncPick(slot); }); }(SLOTS[s]));
  }
  on('td-custom-on', 'change', function () { show($('td-custom-fields'), checked('td-custom-on')); });
  on('td-next1', 'click', function () {
    var bad = saveStep1(false);
    if (bad) { focusOn($(bad)); return; }
    fillStep2();
    goTo(2);
  });
  on('td-back2', 'click', function () { saveStep2(true); goTo(1); });
  on('td-next2', 'click', function () {
    var bad = saveStep2(false);
    if (bad) { focusOn($(bad)); return; }
    goTo(3);
  });
  on('td-back3', 'click', function () { fillStep2(); goTo(2); });
  on('td-next3', 'click', function () { goTo(4); });
  on('td-back4', 'click', function () { goTo(3); });
  on('td-edit4', 'click', function () { fillStep1(); goTo(1); });
  on('td-print', 'click', function () { buildReport(); track('print_opened'); window.print(); });
  on('td-download', 'click', download);
  on('td-q-open', 'click', openQuestions);
  on('td-q-product', 'change', openQuestions);
  on('td-copy', 'click', copyQuestions);
  on('td-clear', 'click', function () { clearSession(true); });
  on('td-dl-json', 'click', function () { fixtureDownload('json'); });
  on('td-dl-csv', 'click', function () { fixtureDownload('csv'); });
  FORM.addEventListener('submit', function (e) { e.preventDefault(); });
  window.addEventListener('beforeprint', buildReport);
  window.addEventListener('beforeunload', function (e) {
    var r = state.session.results || {};
    var any = false;
    for (var k in r) { if (has(r, k)) { for (var t in r[k]) { if (has(r[k], t)) { any = true; } } } }
    if (any && state.changedSinceDownload && !state.session.example) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { clearSession(false); show($('td-app'), false); } });
  fillStep1();
  fillStep2();
}());
