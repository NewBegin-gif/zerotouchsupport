/*
 * test-drive-core.js - Software Test Drive: the decision rules, without any DOM.
 *
 * The visitor runs every test in their own software; this file only turns the
 * results they record into a decision sheet. Rules from the build plan of
 * 28 September 2026 (sections 4, 6, 7 and 12):
 *   - statuses: passed, partly passed, failed, blocked, not tested;
 *   - no total score: one failed essential test is never averaged away;
 *   - a test with three AI runs is passed only at 3 of 3, and a mix is partly passed;
 *   - a result recorded against an older wording of a test counts as not tested;
 *   - imported files are checked field by field; nothing in them is ever run.
 *
 * Source rules (checked by build_test_drive.py): ASCII only, no backslash,
 * no storage, no network, no DOM access.
 */
(function (root) {
  'use strict';

  var CH = String.fromCharCode;
  var NL = CH(10);
  var SCHEMA_VERSION = 1;
  var TOOL = 'software-test-drive';
  var MAX_IMPORT_BYTES = 1048576;
  var STATUSES = ['passed', 'partly', 'failed', 'blocked', 'not_tested'];
  var STATUS_TEXT = {
    passed: 'Passed', partly: 'Partly passed', failed: 'Failed', blocked: 'Blocked', not_tested: 'Not tested'
  };
  var BLOCK_REASONS = {
    unavailable_in_plan: 'Unavailable in this plan',
    missing_access: 'Missing access',
    setup_issue: 'Setup issue',
    other: 'Other reason'
  };
  var ACCESS = { trial: 'A trial', paid: 'A paid plan', unknown: 'Not sure' };
  var ANSWERS = { ai: 'AI answers', person: 'A person answers' };
  var ENVIRONMENT = { yes: 'Yes', no: 'No', unsure: 'Not sure' };
  var LIMITS = { name: 60, plan: 60, config: 300, note: 2000, custom_label: 80, custom_success: 300, budget: 60, minutes: 10000 };
  var SITES = ['aibm', 'osm', 'mss', 'zts'];
  var THEMES = ['build_app', 'team_workflow', 'contacts_campaigns', 'customer_support'];
  var HEADLINES = {
    essential_passed: 'Your essential tests passed',
    essential_failed: 'An essential requirement failed',
    more_evidence: 'More evidence is needed',
    no_essentials: 'No essential requirement chosen'
  };
  var EVENTS = {
    testdrive_start: ['site', 'theme'],
    plan_created: ['site', 'theme'],
    result_recorded: ['site', 'theme', 'status'],
    comparison_opened: ['site', 'theme'],
    export_downloaded: ['site', 'theme'],
    print_opened: ['site', 'theme']
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isStr(v) { return typeof v === 'string'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function inList(v, list) { return list.indexOf(v) >= 0; }

  // ------------------------------------------------------------------
  // Dates (the device date, as YYYY-MM-DD)
  // ------------------------------------------------------------------
  function todayLocal(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isDate(s) {
    if (!isStr(s) || s.length !== 10 || s.charAt(4) !== '-' || s.charAt(7) !== '-') { return false; }
    var y = +s.slice(0, 4);
    var m = +s.slice(5, 7);
    var d = +s.slice(8, 10);
    if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) { return false; }
    var last = new Date(y, m, 0).getDate();
    return d <= last;
  }
  function dateText(s) {
    if (!isDate(s)) { return ''; }
    return (+s.slice(8, 10)) + ' ' + MONTHS[(+s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4);
  }

  // ------------------------------------------------------------------
  // Hash for the wording of a test (FNV-1a, 32 bit)
  // ------------------------------------------------------------------
  function hash(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function criterionHash(test) {
    return hash((test.expected || []).join(' | '));
  }

  // ------------------------------------------------------------------
  // Tests of a session: the template's six plus the visitor's own requirement
  // ------------------------------------------------------------------
  function customTest(session) {
    var c = session && session.requirements && session.requirements.custom;
    if (!c || !c.label) { return null; }
    return {
      id: 'custom', short: c.label, title: c.label, custom: true,
      objective: 'Your own requirement.',
      test_data: 'Your own data. Use nothing real that you would mind losing.',
      preparation: ['Write down how you will check this before you start.'],
      steps: ['Carry out the check you wrote down.'],
      expected: [c.success || 'The success condition you wrote down.'],
      non_evidence: ['A claim on a sales page or in a demo is not your own observation.'],
      needs: [], repeat_count: 1
    };
  }
  function allTests(template, session) {
    var list = (template.tests || []).slice();
    var c = customTest(session);
    if (c) { list.push(c); }
    return list;
  }
  function testById(template, session, id) {
    var list = allTests(template, session);
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }
  function isEssential(session, id) {
    return inList(id, (session.requirements && session.requirements.essential) || []);
  }
  // Essential tests first, then the others, each group in template order.
  function orderedTests(template, session) {
    var list = allTests(template, session);
    var ess = [];
    var other = [];
    for (var i = 0; i < list.length; i++) { (isEssential(session, list[i].id) ? ess : other).push(list[i]); }
    return ess.concat(other);
  }
  function runsNeeded(test, product) {
    if (test.ai_repeat && product && product.answers === 'person') { return 1; }
    return test.repeat_count === 3 ? 3 : 1;
  }

  // ------------------------------------------------------------------
  // One result: the runs summarised (plan section 5, ZTS: 3 of 3)
  // ------------------------------------------------------------------
  function summarizeRuns(runs, needed) {
    var counts = { passed: 0, partly: 0, failed: 0, blocked: 0, not_tested: 0 };
    var recorded = 0;
    var i;
    for (i = 0; i < needed; i++) {
      var r = runs && runs[i];
      var st = r && inList(r.status, STATUSES) ? r.status : 'not_tested';
      counts[st] += 1;
      if (st !== 'not_tested') { recorded += 1; }
    }
    var status;
    if (recorded < needed) {
      status = 'not_tested';
    } else if (counts.passed === needed) {
      status = 'passed';
    } else if (counts.failed === needed) {
      status = 'failed';
    } else if (counts.blocked === needed) {
      status = 'blocked';
    } else {
      status = 'partly';
    }
    var reason = null;
    if (status === 'blocked') { reason = runs[0].reason || 'other'; }
    return { status: status, reason: reason, recorded: recorded, needed: needed, counts: counts };
  }

  // The status that counts for the decision: a result recorded against another
  // wording of the test counts as not tested (plan section 7).
  function effective(session, template, slot, test) {
    var product = productBySlot(session, slot);
    var needed = runsNeeded(test, product);
    var res = session.results && session.results[slot] && session.results[slot][test.id];
    if (!res) {
      return { status: 'not_tested', reason: null, recorded: 0, needed: needed, outdated: false, note: '', observed_at: null };
    }
    var outdated = !!res.criterion_hash && res.criterion_hash !== criterionHash(test);
    var sum = summarizeRuns(res.runs || [], needed);
    return {
      status: outdated ? 'not_tested' : sum.status,
      recorded_status: sum.status,
      reason: outdated ? null : sum.reason,
      recorded: sum.recorded, needed: needed, counts: sum.counts, outdated: outdated,
      note: res.note || '', minutes: has(res, 'minutes') ? res.minutes : null,
      observed_at: res.observed_at || null, runs: res.runs || []
    };
  }
  function productBySlot(session, slot) {
    var list = (session && session.products) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].slot === slot) { return list[i]; } }
    return null;
  }

  // ------------------------------------------------------------------
  // Recording a result (the visitor's own observation)
  // ------------------------------------------------------------------
  function recordResult(session, template, slot, testId, input, today) {
    var test = testById(template, session, testId);
    var product = productBySlot(session, slot);
    if (!test || !product) { return { ok: false, message: 'This test or product is not in your plan.' }; }
    var needed = runsNeeded(test, product);
    var runs = [];
    for (var i = 0; i < needed; i++) {
      var r = (input.runs && input.runs[i]) || {};
      var st = inList(r.status, STATUSES) ? r.status : 'not_tested';
      var run = { status: st };
      if (st === 'blocked') {
        if (!has(BLOCK_REASONS, r.reason)) {
          return { ok: false, field: i, message: 'Choose why this test was blocked.' };
        }
        run.reason = r.reason;
      }
      runs.push(run);
    }
    var note = isStr(input.note) ? input.note : '';
    if (note.length > LIMITS.note) { return { ok: false, field: 'note', message: 'Keep the note under ' + LIMITS.note + ' characters.' }; }
    var minutes = null;
    if (input.minutes !== undefined && input.minutes !== null && String(input.minutes).trim() !== '') {
      var m = String(input.minutes).trim();
      if (!/^[0-9]{1,5}$/.test(m) || +m > LIMITS.minutes) {
        return { ok: false, field: 'minutes', message: 'Enter whole minutes, for example 25, or leave it empty.' };
      }
      minutes = +m;
    }
    var all = true;
    for (var j = 0; j < runs.length; j++) { if (runs[j].status === 'not_tested') { all = false; } }
    var res = {
      runs: runs, note: note, observed_at: today,
      template_version: template.version, criterion_hash: criterionHash(test)
    };
    if (minutes !== null) { res.minutes = minutes; }
    session.results = session.results || {};
    session.results[slot] = session.results[slot] || {};
    session.results[slot][testId] = res;
    session.updated_at = today;
    return { ok: true, complete: all, summary: summarizeRuns(runs, needed) };
  }

  // Changing what is essential after results exist is allowed, and shown (plan section 6).
  function setEssential(session, testId, on, today) {
    var req = session.requirements = session.requirements || { essential: [], custom: null };
    var list = req.essential = req.essential || [];
    var was = inList(testId, list);
    if (on === was) { return { ok: true, changed: false }; }
    if (on && list.length >= 3) { return { ok: false, message: 'Choose at most three essential requirements.' }; }
    if (on) { list.push(testId); } else { list.splice(list.indexOf(testId), 1); }
    if (hasAnyResult(session, testId)) {
      session.priority_changes = session.priority_changes || [];
      session.priority_changes.push({ test_id: testId, to: on ? 'essential' : 'other', at: today });
    }
    return { ok: true, changed: true };
  }
  function hasAnyResult(session, testId) {
    var r = session.results || {};
    for (var slot in r) {
      if (has(r, slot) && r[slot] && has(r[slot], testId)) { return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------
  // The decision sheet for one product (plan section 4, step 4)
  // ------------------------------------------------------------------
  function countsText(counts, total, label) {
    var parts = [counts.passed + ' of ' + total + ' ' + label + ' passed'];
    var order = ['failed', 'partly', 'blocked', 'not_tested'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (counts[k]) { parts.push(counts[k] + ' ' + STATUS_TEXT[k].toLowerCase()); }
    }
    return parts.join('; ');
  }
  function decide(session, template, slot) {
    var product = productBySlot(session, slot);
    var tests = orderedTests(template, session);
    var ess = [];
    var other = [];
    var ce = { passed: 0, partly: 0, failed: 0, blocked: 0, not_tested: 0 };
    var co = { passed: 0, partly: 0, failed: 0, blocked: 0, not_tested: 0 };
    var dates = [];
    var outdated = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      var e = effective(session, template, slot, t);
      var row = { test_id: t.id, title: t.title, short: t.short, status: e.status, reason: e.reason,
        recorded: e.recorded, needed: e.needed, note: e.note, outdated: e.outdated, runs: e.runs || [],
        observed_at: e.observed_at, custom: !!t.custom };
      if (e.outdated) { outdated += 1; }
      if (e.observed_at && e.status !== 'not_tested' && dates.indexOf(e.observed_at) < 0) { dates.push(e.observed_at); }
      if (isEssential(session, t.id)) { ess.push(row); ce[e.status] += 1; } else { other.push(row); co[e.status] += 1; }
    }
    var key;
    if (!ess.length) {
      key = 'no_essentials';
    } else if (ce.failed > 0) {
      key = 'essential_failed';
    } else if (ce.passed === ess.length) {
      key = 'essential_passed';
    } else {
      key = 'more_evidence';
    }
    dates.sort();
    var plan = product && product.plan_tested ? product.plan_tested : 'the plan you tested';
    var when;
    if (!dates.length) { when = null; } else if (dates.length === 1) { when = dateText(dates[0]); } else {
      when = dateText(dates[0]) + ' to ' + dateText(dates[dates.length - 1]);
    }
    var subtitle = when ? 'Based on your recorded results for ' + plan + ', tested on ' + when + '.'
      : 'No results recorded yet for ' + plan + '.';
    return {
      slot: slot, product: product ? product.name : '', key: key, headline: HEADLINES[key], subtitle: subtitle,
      essential: ess, other: other,
      essential_counts: ce, other_counts: co,
      essential_text: ess.length ? countsText(ce, ess.length, ess.length === 1 ? 'essential test' : 'essential tests') : '',
      other_text: other.length ? countsText(co, other.length, other.length === 1 ? 'other test' : 'other tests') : '',
      cautions: cautions(session, template, product, ess.concat(other), outdated),
      recorded: tests.length - ce.not_tested - co.not_tested,
      total: tests.length
    };
  }
  function cautions(session, template, product, rows, outdated) {
    var out = [];
    if (!product) { return out; }
    if (product.access === 'trial') {
      out.push('You tested a trial. A trial with every feature switched on does not show that the plan you would buy can do the same.');
    } else if (product.access !== 'paid') {
      out.push('You did not say whether you tested a trial or a paid plan.');
    }
    if (product.plan_target && product.plan_tested && product.plan_target.toLowerCase() !== product.plan_tested.toLowerCase()) {
      out.push('You tested ' + product.plan_tested + ' but would buy ' + product.plan_target +
        '. Check that ' + product.plan_target + ' includes what you tested.');
    }
    if (outdated) {
      out.push(outdated + (outdated === 1 ? ' result was' : ' results were') +
        ' recorded against an older wording of a test and now count as not tested. Test ' +
        (outdated === 1 ? 'it' : 'them') + ' again.');
    }
    var changes = session.priority_changes || [];
    for (var i = 0; i < changes.length; i++) {
      var t = testById(template, session, changes[i].test_id);
      out.push('After recording results you made ' + (t ? t.title : changes[i].test_id) + ' ' +
        (changes[i].to === 'essential' ? 'essential' : 'an other test') + '.');
    }
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].status === 'blocked') {
        out.push(rows[j].title + ' could not run (' + BLOCK_REASONS[rows[j].reason || 'other'].toLowerCase() +
          '). Blocked is not a failure of the product.');
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Questions for the supplier, in the visitor's own words to copy
  // ------------------------------------------------------------------
  function supplierQuestions(session, template, slot) {
    var product = productBySlot(session, slot);
    if (!product) { return ''; }
    var plan = product.plan_target || product.plan_tested || 'the plan we are considering';
    var lines = ['Questions about ' + (product.name || 'your software') + ' before we buy', ''];
    var tests = orderedTests(template, session);
    var n = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      var e = effective(session, template, slot, t);
      var q = null;
      if (e.status === 'blocked' && e.reason === 'unavailable_in_plan') {
        q = t.title + ': this was not available on the plan we tried. Which plan includes it, and is it included in ' + plan + '?';
      } else if (e.status === 'blocked' && e.reason === 'missing_access') {
        q = t.title + ': we did not have the access this check needs. Can you give us a trial set-up where we can check it ourselves?';
      } else if (e.status === 'blocked') {
        q = t.title + ': we could not complete this check. Can you show us how it works on ' + plan + '?';
      } else if (e.status === 'failed' && isEssential(session, t.id)) {
        q = t.title + ': this did not work in our check. Is there a setting or plan that changes this?';
      } else if ((e.status === 'not_tested' || e.status === 'partly') && isEssential(session, t.id)) {
        q = t.title + ': can you show us this on ' + plan + ', so we can see it for ourselves?';
      }
      if (q) { n += 1; lines.push(n + '. ' + q); }
    }
    if (!n) { lines.push('We have no open questions from our checks so far.'); }
    return lines.join(NL);
  }

  // ------------------------------------------------------------------
  // Session: new, example, export, import
  // ------------------------------------------------------------------
  function newSession(template, site, today) {
    return {
      schema_version: SCHEMA_VERSION, tool: TOOL, site: site,
      template_id: template.template_id, template_version: template.version,
      fixture_version: template.fixture_version,
      created_at: today, updated_at: today,
      products: [{ slot: 'a', name: '', product_id: null, plan_tested: '', plan_target: '', access: 'unknown', answers: 'ai', config: '' }],
      requirements: { essential: [], custom: null },
      environment: { separate: 'unsure', access: [], budget: '' },
      results: {}, priority_changes: [], example: false
    };
  }
  function exampleSession(template, site, today) {
    var s = newSession(template, site, today);
    s.example = true;
    s.products = [
      { slot: 'a', name: 'Example tool A', product_id: null, plan_tested: 'Team plan', plan_target: 'Team plan', access: 'paid', answers: 'ai', config: 'Default settings.' },
      { slot: 'b', name: 'Example tool B', product_id: null, plan_tested: 'Business trial', plan_target: 'Starter plan', access: 'trial', answers: 'ai', config: '' }
    ];
    var ids = [];
    for (var i = 0; i < template.tests.length; i++) { ids.push(template.tests[i].id); }
    s.requirements.essential = [ids[0], ids[2], ids[5]];
    var plans = {
      a: ['passed', 'passed', 'passed', 'blocked', 'partly', 'passed'],
      b: ['passed', 'passed', 'failed', 'not_tested', 'passed', 'partly']
    };
    var notes = { a: 'Fictional example result.', b: 'Fictional example result.' };
    for (var slot in plans) {
      if (!has(plans, slot)) { continue; }
      for (var k = 0; k < ids.length; k++) {
        var st = plans[slot][k];
        if (st === 'not_tested') { continue; }
        var t = template.tests[k];
        var needed = runsNeeded(t, productBySlot(s, slot));
        var runs = [];
        for (var r = 0; r < needed; r++) {
          var run = { status: st === 'partly' && needed === 3 ? (r < 2 ? 'passed' : 'failed') : st };
          if (run.status === 'blocked') { run.reason = 'missing_access'; }
          runs.push(run);
        }
        recordResult(s, template, slot, t.id, { runs: runs, note: notes[slot] }, today);
      }
    }
    return s;
  }
  function exportText(session) {
    var copy = JSON.parse(JSON.stringify(session));
    delete copy.example;
    copy.exported_at = session.updated_at;
    return JSON.stringify(copy, null, 2) + NL;
  }
  function exportFilename(session, today) {
    return 'software-test-drive-' + session.site + '-' + (isDate(today) ? today : 'results') + '.json';
  }

  function cleanText(v, max) {
    if (!isStr(v)) { return null; }
    var out = '';
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      if (c === 10 || c === 9 || c >= 32) { out += v.charAt(i); }
    }
    return out.length > max ? null : out;
  }
  function importSession(text, byteLength, ctx) {
    var errors = [];
    function fail(msg) { return { ok: false, errors: [msg] }; }
    if (byteLength > MAX_IMPORT_BYTES) {
      return fail('This file is larger than 1 MB. A saved test drive is much smaller: choose the file you downloaded here.');
    }
    var data;
    try { data = JSON.parse(text); } catch (e) {
      return fail('This file is not a saved test drive: it is not valid JSON. Nothing was changed.');
    }
    if (!data || typeof data !== 'object' || data instanceof Array) { return fail('This file is not a saved test drive. Nothing was changed.'); }
    if (data.tool !== TOOL) { return fail('This file is not a saved Software Test Drive. Nothing was changed.'); }
    if (data.schema_version !== SCHEMA_VERSION) {
      return fail('This file was saved by version ' + String(data.schema_version).slice(0, 12) +
        ' of the test drive, and this page reads version ' + SCHEMA_VERSION + '. Nothing was changed.');
    }
    if (data.site !== ctx.site || data.template_id !== ctx.template.template_id) {
      return fail('This file belongs to another test drive (' + String(data.template_id).slice(0, 40) +
        '). Open it on the page it was made on. Nothing was changed.');
    }
    var t = ctx.template;
    var s = newSession(t, ctx.site, ctx.today);
    s.template_version = cleanText(data.template_version, 12) || '';
    s.fixture_version = cleanText(data.fixture_version, 12) || '';
    s.created_at = isDate(data.created_at) ? data.created_at : ctx.today;
    s.updated_at = isDate(data.updated_at) ? data.updated_at : s.created_at;
    // products
    var ps = data.products;
    if (!(ps instanceof Array) || ps.length < 1 || ps.length > 2) { errors.push('The file must hold one or two products.'); ps = []; }
    s.products = [];
    var slots = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i] || {};
      var slot = p.slot;
      if (!(slot === 'a' || slot === 'b') || slots.indexOf(slot) >= 0) { errors.push('Product ' + (i + 1) + ' has no valid position.'); continue; }
      slots.push(slot);
      var q = {
        slot: slot,
        name: cleanText(p.name, LIMITS.name),
        product_id: p.product_id === null || p.product_id === undefined ? null : cleanText(p.product_id, 40),
        plan_tested: cleanText(p.plan_tested, LIMITS.plan),
        plan_target: cleanText(p.plan_target, LIMITS.plan),
        access: has(ACCESS, p.access) ? p.access : null,
        answers: has(ANSWERS, p.answers) ? p.answers : 'ai',
        config: cleanText(p.config === undefined ? '' : p.config, LIMITS.config)
      };
      if (q.name === null || q.plan_tested === null || q.plan_target === null || q.access === null || q.config === null) {
        errors.push('Product ' + (i + 1) + ' has a field that is too long or of the wrong type.');
        continue;
      }
      s.products.push(q);
    }
    // requirements
    var rq = data.requirements || {};
    var known = {};
    for (var k = 0; k < t.tests.length; k++) { known[t.tests[k].id] = true; }
    var custom = null;
    if (rq.custom !== null && rq.custom !== undefined) {
      var cl = cleanText(rq.custom.label, LIMITS.custom_label);
      var cs = cleanText(rq.custom.success, LIMITS.custom_success);
      if (!cl || cs === null) { errors.push('Your own requirement has a field that is too long or empty.'); } else { custom = { label: cl, success: cs }; }
    }
    if (custom) { known.custom = true; }
    s.requirements = { essential: [], custom: custom };
    var ess = rq.essential instanceof Array ? rq.essential : [];
    for (var e = 0; e < ess.length; e++) {
      if (known[ess[e]] && s.requirements.essential.indexOf(ess[e]) < 0) { s.requirements.essential.push(ess[e]); }
    }
    if (s.requirements.essential.length > 3) { errors.push('The file marks more than three requirements as essential.'); }
    // environment
    var env = data.environment || {};
    var acc = [];
    var accKnown = {};
    for (var a = 0; a < (t.access || []).length; a++) { accKnown[t.access[a].id] = true; }
    if (env.access instanceof Array) {
      for (var b = 0; b < env.access.length; b++) { if (accKnown[env.access[b]] && acc.indexOf(env.access[b]) < 0) { acc.push(env.access[b]); } }
    }
    s.environment = { separate: has(ENVIRONMENT, env.separate) ? env.separate : 'unsure', access: acc,
      budget: cleanText(env.budget === undefined ? '' : env.budget, LIMITS.budget) || '' };
    // results
    var res = data.results || {};
    s.results = {};
    var ignored = 0;
    for (var ri = 0; ri < slots.length; ri++) {
      var sl = slots[ri];
      var bySlot = res[sl];
      if (!bySlot || typeof bySlot !== 'object') { continue; }
      s.results[sl] = {};
      for (var tid in bySlot) {
        if (!has(bySlot, tid)) { continue; }
        if (!known[tid]) { ignored += 1; continue; }
        var r = bySlot[tid] || {};
        var runs = r.runs instanceof Array ? r.runs : [];
        if (runs.length < 1 || runs.length > 3) { errors.push('A result for ' + tid + ' has no valid runs.'); continue; }
        var outRuns = [];
        var bad = false;
        for (var ru = 0; ru < runs.length; ru++) {
          var x = runs[ru] || {};
          if (!inList(x.status, STATUSES)) { bad = true; break; }
          var or = { status: x.status };
          if (x.status === 'blocked') {
            if (!has(BLOCK_REASONS, x.reason)) { bad = true; break; }
            or.reason = x.reason;
          }
          outRuns.push(or);
        }
        var note = cleanText(r.note === undefined ? '' : r.note, LIMITS.note);
        if (bad || note === null) { errors.push('A result for ' + tid + ' has a value this page does not know.'); continue; }
        var nr = { runs: outRuns, note: note, observed_at: isDate(r.observed_at) ? r.observed_at : null,
          template_version: cleanText(r.template_version, 12) || '', criterion_hash: cleanText(r.criterion_hash, 8) || '' };
        if (typeof r.minutes === 'number' && r.minutes >= 0 && r.minutes <= LIMITS.minutes && Math.floor(r.minutes) === r.minutes) {
          nr.minutes = r.minutes;
        }
        s.results[sl][tid] = nr;
      }
    }
    // priority changes
    var pc = data.priority_changes instanceof Array ? data.priority_changes : [];
    s.priority_changes = [];
    for (var c = 0; c < pc.length && c < 50; c++) {
      var ch = pc[c] || {};
      if (known[ch.test_id] && (ch.to === 'essential' || ch.to === 'other')) {
        s.priority_changes.push({ test_id: ch.test_id, to: ch.to, at: isDate(ch.at) ? ch.at : null });
      }
    }
    if (errors.length) { return { ok: false, errors: errors }; }
    var notices = [];
    if (s.template_version !== t.version) {
      notices.push('This file was made with version ' + s.template_version + ' of these tests; this page has version ' +
        t.version + '. Results for a test whose expected outcome has changed count as not tested.');
    }
    if (ignored) { notices.push(ignored + ' result(s) for tests this page does not have were left out.'); }
    return { ok: true, session: s, notices: notices };
  }

  // ------------------------------------------------------------------
  // Test data downloads
  // ------------------------------------------------------------------
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    var first = s.charAt(0);
    if (first === '=' || first === '+' || first === '-' || first === '@' || first === CH(9) || first === CH(13)) {
      s = CH(39) + s;
    }
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf(NL) >= 0 || s.indexOf(CH(13)) >= 0) {
      s = '"' + s.split('"').join('""') + '"';
    }
    return s;
  }
  function csv(rows, columns) {
    var out = [columns.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < columns.length; j++) { line.push(csvCell(rows[i][columns[j]])); }
      out.push(line.join(','));
    }
    return out.join(CH(13) + NL) + CH(13) + NL;
  }

  // ------------------------------------------------------------------
  // Analytics: fixed names and values only (plan section 8)
  // ------------------------------------------------------------------
  function analyticsEvent(name, params) {
    if (!has(EVENTS, name)) { return null; }
    var allowed = EVENTS[name];
    var out = {};
    for (var i = 0; i < allowed.length; i++) {
      var k = allowed[i];
      var v = params ? params[k] : undefined;
      if (k === 'site' && !inList(v, SITES)) { return null; }
      if (k === 'theme' && !inList(v, THEMES)) { return null; }
      if (k === 'status' && !inList(v, STATUSES)) { return null; }
      out[k] = v;
    }
    return { name: name, params: out };
  }

  root.TestDriveCore = {
    SCHEMA_VERSION: SCHEMA_VERSION, TOOL: TOOL, MAX_IMPORT_BYTES: MAX_IMPORT_BYTES,
    STATUSES: STATUSES, STATUS_TEXT: STATUS_TEXT, BLOCK_REASONS: BLOCK_REASONS, ACCESS: ACCESS,
    ANSWERS: ANSWERS, ENVIRONMENT: ENVIRONMENT, LIMITS: LIMITS, HEADLINES: HEADLINES, EVENTS: EVENTS,
    todayLocal: todayLocal, isDate: isDate, dateText: dateText, hash: hash, criterionHash: criterionHash,
    allTests: allTests, orderedTests: orderedTests, testById: testById, isEssential: isEssential,
    runsNeeded: runsNeeded, summarizeRuns: summarizeRuns, effective: effective, productBySlot: productBySlot,
    recordResult: recordResult, setEssential: setEssential, decide: decide, countsText: countsText,
    supplierQuestions: supplierQuestions, newSession: newSession, exampleSession: exampleSession,
    exportText: exportText, exportFilename: exportFilename, importSession: importSession,
    csv: csv, csvCell: csvCell, analyticsEvent: analyticsEvent
  };
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this)));
