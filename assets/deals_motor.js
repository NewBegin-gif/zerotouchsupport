/* Geschiktheid en echte kosten van een aanbod -- browserversie van deals_motor.py (7 okt 2026).
   Zelfde regels, zelfde testgevallen (ops/deals_motor_cases.json, deals_motor_test.py --js). Wijzig ze samen. */
(function (g) {
  function r(x) { return x === null || x === undefined ? null : Math.round((Number(x) + 1e-9) * 100) / 100; }

  function check(rec, inp) {
    inp = inp || {};
    var el = rec.eligibility || {}, reasons = [], missing = [], unstated = [], nee = false;
    var c = el.customer;
    if (c === 'new') {
      if (inp.customer === 'existing') { nee = true; reasons.push('The offer is for new customers only.'); }
      else if (!inp.customer) missing.push('whether you are a new customer');
    } else if (c === null || c === undefined) unstated.push('whether existing customers qualify');
    var plans = el.plans;
    if (plans && plans.length) {
      var p = inp.plan;
      if (p && plans.indexOf(p) < 0) { nee = true; reasons.push('The offer covers ' + plans.join(', ') + ', not ' + p + '.'); }
      else if (!p) missing.push('which plan you will buy');
    } else unstated.push('which plans it covers');
    var billing = el.billing;
    if (billing && billing.length) {
      var b = inp.billing;
      if (b && billing.indexOf(b) < 0) { nee = true; reasons.push('The offer applies to ' + billing.join(' or ') + ' billing, not ' + b + '.'); }
      else if (!b) missing.push('how you will be billed');
    } else unstated.push('which billing terms it covers');
    if (!el.regions || !el.regions.length) unstated.push('which countries it covers');
    var result;
    if (nee) result = 'does_not_match';
    else if ((rec.structure || {}).kind === 'pilot') { result = 'needs_confirmation'; reasons.push('The vendor grants it case by case.'); }
    else if (rec.status !== 'vendor_confirmed') { result = 'needs_confirmation'; reasons.push('The vendor has not confirmed or reconfirmed this offer recently.'); }
    else if (missing.length) result = 'needs_confirmation';
    else result = 'matches';
    return { result: result, reasons: reasons, missing: missing, unstated: unstated,
             note: 'The vendor decides at checkout; we have not tested this offer at a checkout.' };
  }

  function cost(rec, inp) {
    inp = inp || {};
    var s = rec.structure || {}, k = s.kind, n = parseInt(inp.months || 12, 10), b = inp.billing || 'monthly', p = inp.price;
    var geen = { credits: 'Extra credits are not a cash saving unless you would otherwise buy those credits.',
                 trial_days: 'A longer trial delays the first payment; it does not lower the price.',
                 pilot: 'A pilot is granted case by case; there is no price to calculate.',
                 per_use: 'The discount applies per ride, not to a subscription price.' };
    if (geen[k]) return { status: 'not_computable', reason: geen[k] };
    if (!inp.billing) return { status: 'not_computable', reason: 'Choose how you will be billed.' };
    if (p === null || p === undefined || p === '' || !(Number(p) > 0)) return { status: 'not_computable', reason: 'Enter the monthly price you would pay without the offer.' };
    p = Number(p);
    var zonder = p * n, jaar = (b === 'annual' || b === 'biennial'), term = b === 'biennial' ? 24 : (b === 'annual' ? 12 : 1);
    var uit = { months: n, billing: b, without_offer: r(zonder), after_offer_month: r(p), assumptions: [
      'Your price without the offer, as you entered it; tax not included.',
      jaar ? 'Annual billing means paying the year up front.' : 'Monthly billing, paid each month.'] };
    var f;
    if (k === 'percent') {
      f = s.percent / 100;
      if (s.ongoing) { uit.status = 'ok'; uit.today = r(term * p * (1 - f)); uit.with_offer = r(zonder * (1 - f)); uit.after_offer_month = r(p * (1 - f)); }
      else if (s.months === null || s.months === undefined) {
        var hoog = zonder - Math.min(term, n) * p * f;
        uit.status = 'range'; uit.today = r(term * p * (1 - f)); uit.with_offer_min = r(zonder * (1 - f)); uit.with_offer_max = r(hoog);
        uit.saving_min = r(zonder - hoog); uit.saving_max = r(zonder * f);
        uit.reason = 'The vendor did not say how long the discount runs: between one invoice and the whole period.';
      } else if (jaar) return { status: 'not_computable', reason: 'The discount is stated for ' + s.months + ' month(s); how it applies to an annual invoice was not stated.' };
      else { var m = Math.min(s.months, n); uit.status = 'ok'; uit.today = r(p * (1 - f)); uit.with_offer = r(p * (1 - f) * m + p * (n - m)); }
    } else if (k === 'first_billing') {
      f = s.percent / 100;
      var eerste = Math.min(term, n) * p;
      uit.status = 'ok'; uit.today = r(term * p * (1 - f)); uit.with_offer = r(eerste * (1 - f) + (zonder - eerste));
    } else if (k === 'free_months') {
      if (jaar) return { status: 'not_computable', reason: 'Free months are stated per month; how they apply to an annual invoice was not stated.' };
      var mm = Math.min(s.months, n); uit.status = 'ok'; uit.today = 0; uit.with_offer = r(p * (n - mm));
    } else if (k === 'fixed_first_month') {
      if (jaar) return { status: 'not_computable', reason: 'The promotion is a first-month price; annual billing is not part of it.' };
      uit.status = 'ok'; uit.today = r(s.amount); uit.with_offer = r(s.amount + p * (n - 1));
      uit.assumptions.push('The first month costs ' + s.amount + ' ' + (s.currency || '') + '; your price must be in the same currency.');
    } else return { status: 'not_computable', reason: 'This offer has no price structure we can calculate.' };
    if (uit.with_offer !== undefined && uit.with_offer !== null) uit.saving = r(zonder - uit.with_offer);
    return uit;
  }

  g.DealsMotor = { check: check, cost: cost };
})(window);
