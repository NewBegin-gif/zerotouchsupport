/*
 * renewal-core.js - Before You Renew: pure calculation and decision core.
 *
 * UMD-style global: RenewalCore. No page access, no network, no storage,
 * no timers, no eval. Every function is pure: inputs are never changed.
 *
 * Source rules for this file (checked by tests/run_tests.py):
 *   - ASCII only, and no backslash character anywhere. Special characters
 *     are built with String.fromCharCode, so the file survives any string
 *     layer it is copied through.
 *   - None of the output or storage APIs listed in the renewal invariants.
 *
 * Money is an integer number of minor units (cents) with an explicit
 * currency code. Unknown is null and is never turned into 0. A 0 means the
 * visitor entered 0 (an explicit, confirmed zero).
 *
 * Public API (see the function comments below for shapes):
 *   parseAmount(text, currency)  parseHours(text)  parseCount(text)
 *   yearEquivalent(minor, period)  monthEquivalent(minor, period)
 *   comparable(a, b, sideA, sideB)  switchingCosts(sw)  compare(input)
 *   decide(input)  matchCandidates(required, candidates)
 *   paybackTenths(K, S)  formatTenths(t)  formatMoney(minor, currency)
 *   formatCount(n)  formatHours(hundredths)  periodLabel(period)
 *   equivalentText(minor, period, currency)
 *   isDate(s)  nextDay(s)  daysBetween(a, b)  todayLocal(date)
 *   validateCheckDate(date, ctx)
 *   ics(opts)  icsEscape(text)  icsFold(line)
 *   supplierEmail(planName)
 *   analyticsEvent(name, params)   ANALYTICS (frozen whitelist)
 *   CURRENCIES  CURRENCY_ORDER  CATEGORIES  HEADLINES  LABELS  DEMO
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.RenewalCore = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // ------------------------------------------------------------------
  // Characters and limits
  // ------------------------------------------------------------------
  var CH = String.fromCharCode;
  var NL = CH(10);
  var CRLF = CH(13, 10);
  var BS = CH(92);
  var EURO = CH(0x20AC);
  var POUND = CH(0xA3);
  var YEN = CH(0xA5);
  var EMDASH = CH(0x2014);
  var MINUS_SIGN = CH(0x2212);
  var REPLACEMENT = CH(0xFFFD);

  var MAX_SAFE = 9007199254740991;
  var MAX_MINOR = 100000000000;          // 1,000,000,000.00 in a two-decimal currency
  var MAX_COUNT = 1000000;               // licences
  var MAX_HOURS_HUNDREDTHS = 1000000;    // 10,000 hours
  var DAY_MS = 86400000;

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && Math.abs(v) <= MAX_SAFE;
  }
  function isMinor(v) { return isInt(v) && v >= 0 && v <= MAX_MINOR * 12; }
  function isCount(v) { return isInt(v) && v >= 0 && v <= MAX_COUNT; }
  function isHundredths(v) { return isInt(v) && v >= 0 && v <= MAX_HOURS_HUNDREDTHS; }
  function has(o, k) {
    return o !== null && o !== undefined && typeof o === 'object' &&
      Object.prototype.hasOwnProperty.call(o, k);
  }
  function known(v) { return v !== null && v !== undefined; }
  function indexOf(list, v) {
    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return i; } }
    return -1;
  }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      var keys = Object.keys(o);
      for (var i = 0; i < keys.length; i++) { deepFreeze(o[keys[i]]); }
    }
    return o;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad4(n) {
    var s = String(n);
    while (s.length < 4) { s = '0' + s; }
    return s;
  }

  // Exact integer division helpers (a >= 0, b > 0).
  function idiv(a, b) {
    var q = Math.floor(a / b);
    if (q * b > a) { q -= 1; }
    if ((q + 1) * b <= a) { q += 1; }
    return q;
  }
  // Round half up, for display values only.
  function roundDiv(a, b) { return idiv(2 * a + b, 2 * b); }

  // ------------------------------------------------------------------
  // Currencies
  // ------------------------------------------------------------------
  var CURRENCIES = {
    EUR: { code: 'EUR', exp: 2, prefix: EURO, tokens: [EURO, 'EUR'] },
    USD: { code: 'USD', exp: 2, prefix: '$', tokens: ['$', 'US$', 'USD'] },
    GBP: { code: 'GBP', exp: 2, prefix: POUND, tokens: [POUND, 'GBP'] },
    CAD: { code: 'CAD', exp: 2, prefix: 'CA$', tokens: ['CA$', 'C$', '$', 'CAD'] },
    AUD: { code: 'AUD', exp: 2, prefix: 'A$', tokens: ['A$', 'AU$', '$', 'AUD'] },
    NZD: { code: 'NZD', exp: 2, prefix: 'NZ$', tokens: ['NZ$', '$', 'NZD'] },
    CHF: { code: 'CHF', exp: 2, prefix: 'CHF ', tokens: ['CHF'] },
    SEK: { code: 'SEK', exp: 2, prefix: 'SEK ', tokens: ['SEK', 'KR'] },
    NOK: { code: 'NOK', exp: 2, prefix: 'NOK ', tokens: ['NOK', 'KR'] },
    DKK: { code: 'DKK', exp: 2, prefix: 'DKK ', tokens: ['DKK', 'KR'] },
    JPY: { code: 'JPY', exp: 0, prefix: YEN, tokens: [YEN, 'JPY'] }
  };
  var CURRENCY_ORDER = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY'];

  function currencyInfo(code) {
    return (typeof code === 'string' && has(CURRENCIES, code)) ? CURRENCIES[code] : null;
  }
  function anyCurrencyToken(tok) {
    for (var i = 0; i < CURRENCY_ORDER.length; i++) {
      if (indexOf(CURRENCIES[CURRENCY_ORDER[i]].tokens, tok) >= 0) { return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Number parsing
  // ------------------------------------------------------------------
  var PARSE_MESSAGES = {
    invalid: 'Enter a number, for example 180 or 180.50.',
    negative: 'Enter zero or more. Negative amounts are not accepted.',
    ambiguous: 'This number can be read two ways. Write it without a thousands separator, for example 1234 or 1234.50.',
    too_many_decimals: 'Use at most two decimals.',
    whole_number: 'Enter a whole number.',
    too_large: 'This number is too large for this check.',
    currency_required: 'Choose the currency in the list and enter the number only.',
    currency_symbol_mismatch: 'This symbol does not match the currency you chose. Enter the number only.'
  };

  function parseError(code, exp) {
    var msgCode = code;
    if (code === 'too_many_decimals') {
      msgCode = exp === 0 ? 'whole_number' : 'too_many_decimals';
    }
    var msg = PARSE_MESSAGES[msgCode];
    if (code === 'too_many_decimals' && exp > 0 && exp !== 2) {
      msg = 'Use at most ' + exp + ' decimals.';
    }
    return { ok: false, value: null, empty: false, error: code, message: msg };
  }
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isGroupChar(c) {
    var k = c.charCodeAt(0);
    return c === ' ' || c === "'" || k === 0xA0 || k === 0x202F || k === 0x2009 || k === 0x2019;
  }

  // Parse a plain digit string with separators into a scaled integer.
  // exp = number of decimals allowed (2 for cents or hundredths, 0 for counts).
  function parseDigits(s, exp, max) {
    var tokens = [];
    var i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (isDigit(c)) {
        if (tokens.length && tokens[tokens.length - 1].t === 'd') {
          tokens[tokens.length - 1].v += c;
        } else {
          tokens.push({ t: 'd', v: c });
        }
      } else if (c === '.' || c === ',' || isGroupChar(c)) {
        var kind = c === '.' ? 'P' : (c === ',' ? 'C' : 'G');
        if (tokens.length && tokens[tokens.length - 1].t !== 'd') { return parseError('invalid', exp); }
        tokens.push({ t: kind, v: c });
      } else {
        return parseError('invalid', exp);
      }
    }
    if (!tokens.length) { return parseError('invalid', exp); }
    var last = tokens[tokens.length - 1];
    if (last.t !== 'd') { return parseError('invalid', exp); }
    if (tokens[0].t === 'G') { return parseError('invalid', exp); }

    var puncts = [];
    for (i = 0; i < tokens.length; i++) {
      if (tokens[i].t === 'P' || tokens[i].t === 'C') { puncts.push({ kind: tokens[i].t, pos: i }); }
    }
    var kinds = [];
    for (i = 0; i < puncts.length; i++) {
      if (indexOf(kinds, puncts[i].kind) < 0) { kinds.push(puncts[i].kind); }
    }
    var decPos = -1;
    var groupKind = null;
    if (kinds.length === 2) {
      var decKind = puncts[puncts.length - 1].kind;
      var count = 0;
      for (i = 0; i < puncts.length; i++) { if (puncts[i].kind === decKind) { count++; } }
      if (count !== 1) { return parseError('invalid', exp); }
      decPos = puncts[puncts.length - 1].pos;
      groupKind = decKind === 'P' ? 'C' : 'P';
    } else if (kinds.length === 1) {
      if (puncts.length === 1) {
        var afterLen = tokens[puncts[0].pos + 1].v.length;
        if (afterLen === 3) { return parseError('ambiguous', exp); }
        decPos = puncts[0].pos;
      } else {
        groupKind = kinds[0];
      }
    }
    if (decPos >= 0 && decPos !== tokens.length - 2) { return parseError('invalid', exp); }
    // Only a decimal separator may come first (".5"); never a group separator.
    if (tokens[0].t !== 'd' && decPos !== 0) { return parseError('invalid', exp); }

    // Integer part: tokens before the decimal separator.
    var intTokens = decPos >= 0 ? tokens.slice(0, decPos) : tokens.slice(0);
    var groups = [];
    var sepKind = null;
    for (i = 0; i < intTokens.length; i++) {
      var tk = intTokens[i];
      if (tk.t === 'd') {
        groups.push(tk.v);
      } else {
        var k2 = tk.t;
        if (k2 !== 'G' && k2 !== groupKind) { return parseError('invalid', exp); }
        if (sepKind === null) { sepKind = k2; } else if (sepKind !== k2) { return parseError('invalid', exp); }
      }
    }
    if (groups.length > 1) {
      if (groups[0].length < 1 || groups[0].length > 3) { return parseError('invalid', exp); }
      for (i = 1; i < groups.length; i++) {
        if (groups[i].length !== 3) { return parseError('invalid', exp); }
      }
    }
    var intDigits = groups.join('');
    var decDigits = decPos >= 0 ? tokens[decPos + 1].v : '';
    if (decDigits.length > exp) { return parseError('too_many_decimals', exp); }
    while (intDigits.length > 1 && intDigits.charAt(0) === '0') { intDigits = intDigits.slice(1); }
    if (intDigits === '') { intDigits = '0'; }
    if (intDigits.length > 13) { return parseError('too_large', exp); }
    while (decDigits.length < exp) { decDigits += '0'; }
    var scale = Math.pow(10, exp);
    var value = parseInt(intDigits, 10) * scale + (exp > 0 ? parseInt(decDigits, 10) : 0);
    if (!isInt(value) || value > max) { return parseError('too_large', exp); }
    return { ok: true, value: value, empty: false, error: null, message: null };
  }

  function stripNegative(t) {
    var neg = false;
    var out = '';
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (c === '-' || c === MINUS_SIGN || c === '(') { neg = true; } else if (c !== ')') { out += c; }
    }
    return { neg: neg, rest: out };
  }

  function normaliseInput(input) {
    if (input === null || input === undefined) { return { empty: true }; }
    if (typeof input === 'number') {
      if (!isFinite(input)) { return { error: 'invalid' }; }
      if (input < 0) { return { error: 'negative' }; }
      return { s: String(input) };
    }
    if (typeof input !== 'string') { return { error: 'invalid' }; }
    var s = input.trim();
    if (s === '') { return { empty: true }; }
    return { s: s };
  }

  function parseScaled(input, exp, max, currency) {
    var n = normaliseInput(input);
    if (n.empty) { return { ok: true, value: null, empty: true, error: null, message: null }; }
    if (n.error) { return parseError(n.error, exp); }
    var s = n.s;
    var i = 0;
    while (i < s.length && !isDigit(s.charAt(i)) && s.charAt(i) !== '.' && s.charAt(i) !== ',') { i++; }
    var j = s.length;
    while (j > i && !isDigit(s.charAt(j - 1))) { j--; }
    var lead = stripNegative(s.slice(0, i));
    var trail = stripNegative(s.slice(j));
    var mid = s.slice(i, j);
    if (lead.neg || trail.neg) { return parseError('negative', exp); }
    var leadTok = lead.rest.trim().toUpperCase();
    var trailTok = trail.rest.trim().toUpperCase();
    if (leadTok && trailTok) { return parseError('invalid', exp); }
    var tok = leadTok || trailTok;
    if (tok) {
      var info = currencyInfo(currency);
      if (!info) {
        return parseError(anyCurrencyToken(tok) ? 'currency_required' : 'invalid', exp);
      }
      if (indexOf(info.tokens, tok) < 0) {
        return parseError(anyCurrencyToken(tok) ? 'currency_symbol_mismatch' : 'invalid', exp);
      }
    }
    if (mid.length && (mid.charAt(0) === '-' || mid.charAt(0) === MINUS_SIGN)) {
      return parseError('negative', exp);
    }
    return parseDigits(mid, exp, max);
  }

  // parseAmount(text, currency) -> { ok, value (integer minor units or null), empty, error, message }
  // Empty input gives { ok: true, value: null, empty: true }: unknown, never 0.
  // A single separator followed by exactly three digits ("1,234" or "1.234")
  // is ambiguous and gives a field error.
  function parseAmount(input, currency) {
    var info = currencyInfo(currency);
    var exp = info ? info.exp : 2;
    return parseScaled(input, exp, MAX_MINOR, currency);
  }
  // Hours with up to two decimals, as hundredths of an hour.
  function parseHours(input) { return parseScaled(input, 2, MAX_HOURS_HUNDREDTHS, null); }
  // Whole numbers, for licences.
  function parseCount(input) { return parseScaled(input, 0, MAX_COUNT, null); }

  // ------------------------------------------------------------------
  // Equivalents and formatting
  // ------------------------------------------------------------------
  function validPeriod(p) { return p === 'month' || p === 'year'; }

  // 12-month cost equivalent in minor units. Exact integer. null if unknown.
  function yearEquivalent(minor, period) {
    if (!isMinor(minor) || !validPeriod(period)) { return null; }
    return period === 'month' ? minor * 12 : minor;
  }
  // Monthly equivalent for display. A yearly total is divided by 12 and
  // rounded half up to whole minor units; comparisons use yearEquivalent.
  function monthEquivalent(minor, period) {
    if (!isMinor(minor) || !validPeriod(period)) { return null; }
    return period === 'month' ? minor : roundDiv(minor, 12);
  }

  function groupThousands(digits) {
    var out = '';
    var n = digits.length;
    for (var i = 0; i < n; i++) {
      out += digits.charAt(i);
      var left = n - i - 1;
      if (left > 0 && left % 3 === 0) { out += ','; }
    }
    return out;
  }
  function formatCount(n) {
    if (!isInt(n)) { return 'unknown'; }
    return (n < 0 ? '-' : '') + groupThousands(String(Math.abs(n)));
  }
  // formatMoney(18050, 'EUR') -> EURO + '180.50'; 216000 -> EURO + '2,160'.
  // Decimals are shown only when they are not zero, unless opts.decimals === 'always'.
  function formatMoney(minor, currency, opts) {
    if (!isInt(minor)) { return 'unknown'; }
    var info = currencyInfo(currency) || { exp: 2, prefix: (typeof currency === 'string' && currency ? currency + ' ' : '') };
    var neg = minor < 0;
    var abs = Math.abs(minor);
    var scale = Math.pow(10, info.exp);
    var major = idiv(abs, scale);
    var frac = abs - major * scale;
    var s = groupThousands(String(major));
    if (info.exp > 0 && (frac !== 0 || (opts && opts.decimals === 'always'))) {
      var f = String(frac);
      while (f.length < info.exp) { f = '0' + f; }
      s += '.' + f;
    }
    return (neg ? '-' : '') + info.prefix + s;
  }
  function formatHours(h) {
    if (!isInt(h)) { return 'unknown'; }
    var whole = idiv(Math.abs(h), 100);
    var frac = Math.abs(h) - whole * 100;
    var s = groupThousands(String(whole));
    if (frac) {
      var f = pad2(frac);
      if (f.charAt(1) === '0') { f = f.charAt(0); }
      s += '.' + f;
    }
    return s;
  }
  function periodLabel(period) {
    if (period === 'month') { return 'billed monthly'; }
    if (period === 'year') { return 'billed yearly'; }
    return 'billing period not supported';
  }
  // "EURO2,160/year - equivalent to EURO180/month" (with an em dash).
  function equivalentText(minor, period, currency) {
    var y = yearEquivalent(minor, period);
    var m = monthEquivalent(minor, period);
    if (y === null) { return 'unknown'; }
    if (period === 'year') {
      return formatMoney(y, currency) + '/year ' + EMDASH + ' equivalent to ' + formatMoney(m, currency) + '/month';
    }
    return formatMoney(m, currency) + '/month ' + EMDASH + ' equivalent to ' + formatMoney(y, currency) + '/year';
  }

  // Payback in tenths of a month: round(12 * K / S, 1 decimal), exact integer maths.
  function paybackTenths(K, S) {
    if (!isInt(K) || !isInt(S) || K < 0 || S <= 0) { return null; }
    var num = 120 * K;
    if (num > MAX_SAFE / 2) { return null; }
    return roundDiv(num, S);
  }
  function formatTenths(t) {
    if (!isInt(t) || t < 0) { return null; }
    var whole = idiv(t, 10);
    return groupThousands(String(whole)) + '.' + (t - whole * 10);
  }

  // ------------------------------------------------------------------
  // Text cleaning (plain text only, no markup is ever produced here)
  // ------------------------------------------------------------------
  function isSpaceCode(k) {
    return k <= 32 || k === 127 || (k >= 0x80 && k <= 0x9F) || k === 0xA0 || k === 0x1680 ||
      (k >= 0x2000 && k <= 0x200A) || k === 0x2028 || k === 0x2029 || k === 0x202F ||
      k === 0x205F || k === 0x3000;
  }
  function isInvisibleCode(k) {
    return (k >= 0x200B && k <= 0x200F) || (k >= 0x202A && k <= 0x202E) ||
      (k >= 0x2060 && k <= 0x2069) || k === 0xFEFF;
  }
  // Replace lone surrogates with U+FFFD so the text is valid UTF-8.
  function fixSurrogates(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; } else { out += REPLACEMENT; }
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        out += REPLACEMENT;
      } else {
        out += s.charAt(i);
      }
    }
    return out;
  }
  // Cut to at most n UTF-16 units without splitting a surrogate pair.
  function cut(s, n) {
    if (s.length <= n) { return s; }
    var r = s.slice(0, n);
    var last = r.charCodeAt(r.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) { r = r.slice(0, -1); }
    return r;
  }
  // One line of plain text: line breaks and control characters become
  // spaces, runs of spaces collapse, invisible direction marks go.
  function cleanInline(v, maxLen) {
    var s = fixSurrogates(v === null || v === undefined ? '' : String(v));
    var out = '';
    var lastSpace = true;
    for (var i = 0; i < s.length; i++) {
      var k = s.charCodeAt(i);
      if (isInvisibleCode(k)) { continue; }
      if (isSpaceCode(k)) {
        if (!lastSpace) { out += ' '; lastSpace = true; }
      } else {
        out += s.charAt(i);
        lastSpace = false;
      }
    }
    out = out.trim();
    return cut(out, maxLen || 120).trim();
  }
  // Multi-line text for the calendar: line breaks become LF, other
  // control characters are removed, tabs become spaces.
  function cleanMultiline(v, maxLen) {
    var s = fixSurrogates(v === null || v === undefined ? '' : String(v));
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var k = s.charCodeAt(i);
      if (k === 13) {
        out += NL;
        if (i + 1 < s.length && s.charCodeAt(i + 1) === 10) { i++; }
      } else if (k === 10 || k === 0x2028 || k === 0x2029 || k === 0x85) {
        out += NL;
      } else if (k === 9) {
        out += ' ';
      } else if (k < 32 || k === 127 || (k >= 0x80 && k <= 0x9F) || isInvisibleCode(k)) {
        continue;
      } else {
        out += s.charAt(i);
      }
    }
    return cut(out.trim(), maxLen || 500);
  }

  // ------------------------------------------------------------------
  // Comparability of two money inputs
  // ------------------------------------------------------------------
  var SIDE_NAMES = {
    current: 'your current plan',
    renewal: 'the renewal quote',
    option: 'the option'
  };
  function sideName(side) { return has(SIDE_NAMES, side) ? SIDE_NAMES[side] : 'this amount'; }

  function problem(code, side, text, kind) {
    return { code: code, side: side || null, kind: kind || 'incomplete', text: text };
  }
  function amountMissingText(side) {
    if (side === 'current') { return 'Enter what you pay now: your invoice total, including paid add-ons.'; }
    if (side === 'renewal') { return 'Enter the total of the renewal quote.'; }
    if (side === 'option') { return 'Enter the total recurring price of the option.'; }
    return 'Enter the amount.';
  }
  function moneyProblems(m, side) {
    var p = [];
    if (!m || !known(m.amount)) {
      p.push(problem('missing_amount', side, amountMissingText(side)));
    } else if (!isMinor(m.amount)) {
      p.push(problem('invalid_amount', side, 'Check the amount for ' + sideName(side) + '.'));
    }
    if (!m || !m.currency) {
      p.push(problem('missing_currency', side, 'Choose the currency for ' + sideName(side) + '.'));
    } else if (!currencyInfo(m.currency)) {
      p.push(problem('unknown_currency', side, 'Choose a currency from the list for ' + sideName(side) + '.'));
    }
    if (!m || !m.period) {
      p.push(problem('missing_period', side, 'Choose whether the amount for ' + sideName(side) + ' is per month or per year.'));
    } else if (!validPeriod(m.period)) {
      p.push(problem('period_unsupported', side,
        'This check compares monthly or yearly totals only. Ask for a monthly or yearly quote for ' + sideName(side) + '.'));
    }
    return p;
  }

  // comparable(a, b, sideA, sideB)
  // a, b: { amount: minor|null, currency: 'EUR'|..., period: 'month'|'year'|..., tax: 'included'|'excluded'|'unsure'|null }
  // -> { ok, status: 'ok'|'blocked'|'incomplete', category: null|'check_details', problems: [...] }
  // Currency or tax-basis mismatch blocks the comparison (no conversion,
  // no tax advice). 'unsure' tax gives check_details.
  function comparable(a, b, sideA, sideB) {
    sideA = sideA || 'current';
    sideB = sideB || 'option';
    var problems = moneyProblems(a, sideA).concat(moneyProblems(b, sideB));
    var ta = a ? a.tax : null;
    var tb = b ? b.tax : null;
    var pairs = [[ta, sideA], [tb, sideB]];
    for (var i = 0; i < pairs.length; i++) {
      var t = pairs[i][0];
      var sd = pairs[i][1];
      if (!known(t) || t === '') {
        problems.push(problem('missing_tax', sd, 'Choose whether tax is included in the amount for ' + sideName(sd) + '.'));
      } else if (t === 'unsure') {
        problems.push(problem('tax_unsure', sd, 'Check whether tax is included in the amount for ' + sideName(sd) + '.'));
      } else if (t !== 'included' && t !== 'excluded') {
        problems.push(problem('missing_tax', sd, 'Choose whether tax is included in the amount for ' + sideName(sd) + '.'));
      }
    }
    var ca = a && currencyInfo(a.currency) ? a.currency : null;
    var cb = b && currencyInfo(b.currency) ? b.currency : null;
    if (ca && cb && ca !== cb) {
      problems.push(problem('currency_mismatch', null,
        'The amounts are in different currencies (' + ca + ' and ' + cb + '). Enter both in the same currency. This check does not convert currencies.',
        'blocked'));
    }
    if ((ta === 'included' || ta === 'excluded') && (tb === 'included' || tb === 'excluded') && ta !== tb) {
      problems.push(problem('tax_mismatch', null,
        'One amount includes tax and the other does not. Enter both with tax included, or both without tax.',
        'blocked'));
    }
    var blocked = false;
    for (var j = 0; j < problems.length; j++) { if (problems[j].kind === 'blocked') { blocked = true; } }
    var status = blocked ? 'blocked' : (problems.length ? 'incomplete' : 'ok');
    return {
      ok: status === 'ok',
      status: status,
      category: status === 'ok' ? null : 'check_details',
      problems: problems
    };
  }

  // ------------------------------------------------------------------
  // Switching costs
  // ------------------------------------------------------------------
  var SWITCH_FIELD_NAMES = {
    hours: 'migration hours',
    hourly_rate: 'hourly value',
    implementation: 'implementation costs',
    overlap: 'overlap costs',
    other: 'other one-off costs'
  };

  // switchingCosts({ hours: hundredths|null, hourly_rate: minor|null,
  //   implementation: minor|null, overlap: minor|null, other: minor|null,
  //   confirmed: bool })
  // null or a missing field means unknown. Only an explicit 0 counts as zero.
  // H = hours x hourly value (rounded half up to whole minor units),
  // F = implementation + overlap + other, K = H + F. Unknown parts give null.
  function switchingCosts(sw) {
    sw = sw || {};
    var unknown = [];
    var invalid = [];
    function get(key, check) {
      var v = has(sw, key) ? sw[key] : null;
      if (!known(v)) { return null; }
      if (!check(v)) { invalid.push(key); return null; }
      return v;
    }
    var hours = get('hours', isHundredths);
    var rate = get('hourly_rate', isMinor);
    var H = null;
    if (hours === 0 || rate === 0) {
      H = 0;
    } else if (hours !== null && rate !== null) {
      var product = hours * rate;
      if (product > MAX_SAFE / 2) { invalid.push('hours'); } else { H = roundDiv(product, 100); }
    } else {
      if (hours === null && indexOf(invalid, 'hours') < 0) { unknown.push('hours'); }
      if (rate === null && indexOf(invalid, 'hourly_rate') < 0) { unknown.push('hourly_rate'); }
    }
    var parts = ['implementation', 'overlap', 'other'];
    var F = 0;
    var knownSum = H === null ? 0 : H;
    for (var i = 0; i < parts.length; i++) {
      var v = get(parts[i], isMinor);
      if (v === null) {
        if (indexOf(invalid, parts[i]) < 0) { unknown.push(parts[i]); }
        F = null;
      } else {
        knownSum += v;
        if (F !== null) { F += v; }
      }
    }
    var K = (H !== null && F !== null) ? H + F : null;
    return {
      H: H,
      F: F,
      K: K,
      complete: K !== null,
      unknown: unknown,
      invalid: invalid,
      known_sum: knownSum,
      confirmed: sw.confirmed === true,
      migration_estimate: hours !== null ? hours > 0 : true
    };
  }
  function unknownNames(list) {
    var names = [];
    for (var i = 0; i < list.length; i++) {
      names.push(has(SWITCH_FIELD_NAMES, list[i]) ? SWITCH_FIELD_NAMES[list[i]] : list[i]);
    }
    return names;
  }

  // ------------------------------------------------------------------
  // compare(): C, A, S, H, F, K, E, T
  // ------------------------------------------------------------------
  var LABELS = {
    C: 'Current cost, 12-month equivalent',
    C_renewal: 'Renewal cost, 12-month equivalent',
    A: 'Option cost, 12-month equivalent',
    S: 'Difference before switching costs',
    H: 'Migration time value (estimate)',
    F: 'Implementation, overlap and other one-off costs',
    K: 'Estimated switching costs',
    E: 'Difference in the first 12 months after switching',
    T: 'Simple payback in months'
  };

  function hasAmount(m) { return !!(m && known(m.amount)); }
  function moneyOk(m, side) { return moneyProblems(m, side).length === 0; }

  // compare({ current, renewal_quote?, option?, switching? })
  // C = 12-month equivalent of the renewal quote when given, else of the
  // current invoice. A = option. S = C - A (only when comparable).
  // E = S - K. T = 12K / S months, only when S > 0 and K is known.
  function compare(input) {
    input = input || {};
    var current = input.current || null;
    var renewal = hasAmount(input.renewal_quote) ? input.renewal_quote : null;
    var basisSide = renewal ? 'renewal' : 'current';
    var basis = renewal || current;
    var option = input.option || null;
    var out = {
      basis: basisSide,
      currency: basis && currencyInfo(basis.currency) ? basis.currency : null,
      C: null, C_month: null, A: null, A_month: null, S: null, S_month: null,
      H: null, F: null, K: null, E: null, T: null, T_tenths: null, T_display: null,
      current_year: null, renewal_year: null, renewal_change: null,
      comparison: null, switching: null,
      flags: { no_finite_payback: false, no_one_off_costs: false, switching_unknown: false },
      labels: LABELS
    };
    if (moneyOk(basis, basisSide)) {
      out.C = yearEquivalent(basis.amount, basis.period);
      out.C_month = monthEquivalent(basis.amount, basis.period);
    }
    if (moneyOk(current, 'current')) { out.current_year = yearEquivalent(current.amount, current.period); }
    if (renewal && moneyOk(renewal, 'renewal')) {
      out.renewal_year = yearEquivalent(renewal.amount, renewal.period);
      if (out.current_year !== null && comparable(current, renewal, 'current', 'renewal').ok) {
        out.renewal_change = out.renewal_year - out.current_year;
      }
    }
    if (option) {
      out.comparison = comparable(basis, option, basisSide, 'option');
      if (moneyOk(option, 'option')) {
        out.A = yearEquivalent(option.amount, option.period);
        out.A_month = monthEquivalent(option.amount, option.period);
      }
      if (out.comparison.ok && out.C !== null && out.A !== null) {
        out.S = out.C - out.A;
        var sm = roundDiv(Math.abs(out.S), 12);
        out.S_month = out.S < 0 ? -sm : sm;
      }
      var sw = switchingCosts(input.switching);
      out.switching = sw;
      out.H = sw.H;
      out.F = sw.F;
      out.K = sw.K;
      out.flags.switching_unknown = sw.K === null;
      if (out.S !== null && out.K !== null) { out.E = out.S - out.K; }
      if (out.S !== null) {
        if (out.S <= 0) {
          out.flags.no_finite_payback = true;
        } else if (out.K !== null) {
          out.T_tenths = paybackTenths(out.K, out.S);
          if (out.T_tenths !== null) {
            out.T = (12 * out.K) / out.S;
            out.T_display = formatTenths(out.T_tenths);
          }
          out.flags.no_one_off_costs = out.K === 0;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Dates
  // ------------------------------------------------------------------
  function daysInMonth(y, m) {
    if (m === 2) { return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28; }
    return (m === 4 || m === 6 || m === 9 || m === 11) ? 30 : 31;
  }
  function splitDate(s) {
    if (typeof s !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) { return null; }
    var y = parseInt(s.slice(0, 4), 10);
    var m = parseInt(s.slice(5, 7), 10);
    var d = parseInt(s.slice(8, 10), 10);
    if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) { return null; }
    return { y: y, m: m, d: d };
  }
  function isDate(s) { return splitDate(s) !== null; }
  function utcDay(s) {
    var p = splitDate(s);
    return p ? Date.UTC(p.y, p.m - 1, p.d) : null;
  }
  // Next calendar day of a YYYY-MM-DD string, computed with Date.UTC so the
  // local time zone never shifts the day.
  function nextDay(s) {
    var p = splitDate(s);
    if (!p) { return null; }
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    return pad4(t.getUTCFullYear()) + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
  }
  // Whole days from a to b (b - a).
  function daysBetween(a, b) {
    var ta = utcDay(a);
    var tb = utcDay(b);
    if (ta === null || tb === null) { return null; }
    return Math.round((tb - ta) / DAY_MS);
  }
  // The visitor's local calendar date for a given moment (default: now).
  function todayLocal(d) {
    var t = (d && typeof d.getFullYear === 'function') ? d : new Date();
    return pad4(t.getFullYear()) + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }
  function compact(s) { return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10); }

  function dateStatus(v, today) {
    if (!known(v) || v === '') { return { status: 'unknown', date: null, days_left: null }; }
    if (!isDate(v)) { return { status: 'invalid', date: null, days_left: null }; }
    var diff = daysBetween(today, v);
    return {
      status: diff < 0 ? 'passed' : (diff === 0 ? 'today' : 'upcoming'),
      date: v,
      days_left: diff
    };
  }

  // validateCheckDate(date, { today, deadline }) -> { ok, problems, warnings }
  // The visitor picks their own check date; nothing is derived from a
  // notice period.
  function validateCheckDate(date, ctx) {
    ctx = ctx || {};
    var problems = [];
    var warnings = [];
    if (!isDate(date)) {
      problems.push({ code: 'invalid_date', text: 'Enter a valid date.' });
      return { ok: false, problems: problems, warnings: warnings };
    }
    if (isDate(ctx.today) && daysBetween(ctx.today, date) < 0) {
      problems.push({ code: 'in_past', text: 'Choose today or a later date.' });
    }
    if (isDate(ctx.deadline) && isDate(ctx.today) && daysBetween(ctx.today, ctx.deadline) >= 0) {
      var gap = daysBetween(date, ctx.deadline);
      if (gap < 0) {
        problems.push({ code: 'after_deadline', text: 'Choose a date before your notice deadline (' + ctx.deadline + ').' });
      } else if (gap === 0) {
        warnings.push({ code: 'on_deadline', text: 'This is the deadline itself. An earlier date gives you time to act.' });
      }
    }
    return { ok: problems.length === 0, problems: problems, warnings: warnings };
  }

  // ------------------------------------------------------------------
  // Candidates with structured capabilities (fixtures only in v1)
  // ------------------------------------------------------------------
  // matchCandidates(requiredKeys, candidates)
  // candidates: [{ id, capabilities: { key: true | false | 'unknown' } }]
  // true = supported, false = explicitly not supported, anything else = unknown.
  // An explicit mismatch excludes; unknown gives 'unconfirmed'. At most
  // three, input order kept, no ranking, no minimum. Keys are structured
  // capability keys, never free text.
  function matchCandidates(required, candidates) {
    var req = [];
    var i, k;
    for (i = 0; i < (required || []).length && req.length < 3; i++) {
      if (typeof required[i] === 'string' && required[i] && indexOf(req, required[i]) < 0) { req.push(required[i]); }
    }
    var included = [];
    var excluded = [];
    for (i = 0; i < (candidates || []).length; i++) {
      var c = candidates[i] || {};
      var caps = c.capabilities || {};
      var missing = [];
      var unconfirmed = [];
      for (k = 0; k < req.length; k++) {
        var v = has(caps, req[k]) ? caps[req[k]] : null;
        if (v === false) { missing.push(req[k]); } else if (v !== true) { unconfirmed.push(req[k]); }
      }
      if (missing.length) {
        excluded.push({ id: c.id, missing: missing });
      } else if (included.length < 3) {
        included.push({
          id: c.id,
          status: (req.length && !unconfirmed.length) ? 'confirmed' : 'unconfirmed',
          unconfirmed: unconfirmed
        });
      }
    }
    return { required: req, included: included, excluded: excluded };
  }

  // ------------------------------------------------------------------
  // decide(): the result table
  // ------------------------------------------------------------------
  var CATEGORIES = ['check_details', 'find_deadline', 'deadline_passed', 'reduce_licences',
    'investigate_option', 'may_lower_costs', 'no_saving', 'review_current'];

  var HEADLINES = {
    check_details: 'Check these details before comparing',
    find_deadline: 'Find your notice deadline',
    deadline_passed: 'Check whether changes are still possible',
    reduce_licences: 'Check whether you can reduce paid licences',
    investigate_option: 'Investigate this option before switching',
    may_lower_costs: 'This option may lower your costs',
    no_saving: 'Switching does not reduce costs in this comparison',
    review_current: 'Review your current plan first'
  };

  // Primary and secondary actions per signal.
  var SIGNAL_ACTIONS = {
    check_details: [['fix_basis'], []],
    deadline_passed: [['ask_changes_possible'], ['set_new_check_date']],
    investigate_option: [['confirm_open_points'], []],
    may_lower_costs: [['check_assumptions'], []],
    no_saving: [['note_other_benefits'], []],
    reduce_licences: [['check_licence_minimum'], []],
    find_deadline: [['ask_notice_terms'], ['set_check_date']],
    review_current: [['review_usage'], []]
  };

  function plural(n, one, many) { return n === 1 ? one : many; }

  function normFeatures(option) {
    var out = { supported: [], missing: [], unknown: [] };
    var list = option && option.features ? option.features : [];
    for (var i = 0; i < list.length && i < 3; i++) {
      var f = list[i] || {};
      var label = cleanInline(f.label, 80);
      if (!label) { continue; }
      if (f.status === 'supported') { out.supported.push(label); } else if (f.status === 'missing') { out.missing.push(label); } else { out.unknown.push(label); }
    }
    return out;
  }

  function openConditions(option, features, sw) {
    var open = [];
    if (sw.K === null) {
      var names = unknownNames(sw.unknown.length ? sw.unknown : sw.invalid);
      open.push({ code: 'switching_unknown', text: 'Some switching costs are unknown: ' + names.join(', ') + '.' });
    }
    if (!sw.confirmed) {
      open.push({
        code: 'switching_unconfirmed',
        text: (sw.H !== null && sw.H > 0) || (sw.H === null && sw.migration_estimate)
          ? 'Migration hours are an estimate, and remaining contract obligations are not confirmed.'
          : 'Remaining contract obligations are not confirmed.'
      });
    }
    if (option.price_source !== 'quote') {
      open.push({ code: 'price_unconfirmed', text: 'The option price is an estimate until the supplier confirms it for your users and usage.' });
    }
    if (option.scope_confirmed !== true) {
      open.push({ code: 'scope_unconfirmed', text: 'Confirm that the option covers the same users, features and usage as your current plan.' });
    }
    if (features.unknown.length) {
      open.push({ code: 'features_unconfirmed', text: 'Not confirmed yet: ' + features.unknown.join(', ') + '.' });
    } else if (!features.supported.length && option.fit_confirmed !== true) {
      open.push({ code: 'fit_unconfirmed', text: 'Confirm that the option has the features and integrations you need.' });
    }
    return open;
  }

  function moneyPerMonthPhrase(absS, currency, word) {
    var m = roundDiv(absS, 12);
    if (m === 0) { return formatMoney(absS, currency) + ' ' + word + ' per year'; }
    return formatMoney(m, currency) + ' ' + word + ' per month';
  }

  function explain(cat, ctx) {
    var n = ctx.numbers;
    var cur = n.currency;
    var parts = [];
    if (cat === 'check_details') {
      parts.push(ctx.blocked
        ? 'These amounts cannot be compared as entered.'
        : 'Some details are missing before this check can compare costs.');
      parts.push('Complete or align the details listed below.');
    } else if (cat === 'deadline_passed') {
      if (ctx.notice.status === 'passed') {
        parts.push('According to what you entered, your notice deadline (' + ctx.notice.date + ') has passed.');
      } else {
        parts.push('According to what you entered, the renewal date (' + ctx.renewalDate.date + ') has passed.');
      }
      parts.push('Ask your supplier whether changes are still possible. This check does not say that cancelling is impossible.');
    } else if (cat === 'investigate_option' || cat === 'may_lower_costs') {
      parts.push('The alternative costs ' + moneyPerMonthPhrase(n.S, cur, 'less') + (n.K === null ? ' before switching costs.' : '.'));
      if (n.K === null) {
        parts.push('Some switching costs are unknown, so there is no payback estimate yet.');
      } else if (n.T_display === null) {
        parts.push('The switching costs are too large for a payback estimate in this check.');
      } else if (n.K === 0) {
        parts.push('No one-off switching costs were entered. That does not make switching risk-free.');
      } else if (cat === 'investigate_option') {
        parts.push('With your estimated switching costs of ' + formatMoney(n.K, cur) + ', the simple payback is about ' + n.T_display + ' months.');
      } else {
        parts.push('With switching costs of ' + formatMoney(n.K, cur) + ', the simple payback is about ' + n.T_display + ' months.');
      }
      parts.push(cat === 'investigate_option'
        ? 'Confirm feature fit and contract obligations before deciding.'
        : 'This is based on the figures you confirmed. Check the assumptions below.');
    } else if (cat === 'no_saving') {
      if (n.S === 0) {
        parts.push('The alternative costs the same as your current plan in this comparison.');
      } else {
        parts.push('The alternative costs ' + moneyPerMonthPhrase(-n.S, cur, 'more') + ' in this comparison.');
      }
      parts.push('Other benefits, if any, are not part of this calculation.');
    } else if (cat === 'reduce_licences') {
      var L = ctx.licences;
      parts.push('You pay for ' + formatCount(L.paid) + ' ' + plural(L.paid, 'licence', 'licences') + ' and ' +
        formatCount(L.active) + ' ' + plural(L.active, 'is', 'are') + ' in use.');
      parts.push('Check the minimum number of licences, which roles need one and when a reduction takes effect. This check does not estimate a saving.');
    } else if (cat === 'find_deadline') {
      parts.push('You have not entered a notice deadline. Ask your supplier for it. This check does not assume a notice period.');
    } else {
      if (ctx.optionExcluded) {
        parts.push('The option lacks a feature you need (' + ctx.features.missing.join(', ') + ').');
      } else {
        parts.push('There is no confirmed alternative in this check.');
      }
      parts.push('Review what you use in your current plan and the renewal terms first.');
    }
    return parts.join(' ');
  }

  function buildAction(id, ctx) {
    var a = { id: id, text: '', items: [], needs_date: false, before: null, uses: null, group: id };
    if (id === 'fix_basis') {
      a.text = 'Complete or align these details, then check again.';
      for (var i = 0; i < ctx.problems.length; i++) { a.items.push(ctx.problems[i].text); }
    } else if (id === 'ask_changes_possible') {
      a.text = 'Ask your supplier whether you can still change or cancel, and from which date a change would apply.';
      a.uses = 'supplier_email';
    } else if (id === 'set_new_check_date') {
      a.text = 'Choose a new date to check the terms and add it to your calendar.';
      a.needs_date = true;
      a.group = 'check_date';
    } else if (id === 'confirm_open_points') {
      a.text = 'Confirm these points before deciding.';
      for (var j = 0; j < ctx.open.length; j++) { a.items.push(ctx.open[j].text); }
    } else if (id === 'check_assumptions') {
      a.text = 'Check the calculation and assumptions below, and confirm your notice deadline before you switch.';
    } else if (id === 'note_other_benefits') {
      a.text = 'Weigh any other benefits of the option separately. They are not part of this calculation.';
    } else if (id === 'check_licence_minimum') {
      a.text = 'Ask your supplier about the minimum number of licences, which roles need one and when a reduction takes effect.';
      a.uses = 'supplier_email';
      if (ctx.licences.minimum !== null) {
        a.items.push('The minimum you entered is ' + formatCount(ctx.licences.minimum) + ' ' + plural(ctx.licences.minimum, 'licence', 'licences') + '.');
      } else {
        a.items.push('The minimum number of licences is unknown.');
      }
    } else if (id === 'ask_notice_terms') {
      a.text = 'Ask your supplier for the notice deadline and how to cancel or reduce licences.';
      a.uses = 'supplier_email';
    } else if (id === 'set_check_date') {
      a.text = 'Choose a date to check the terms and add it to your calendar.';
      a.needs_date = true;
      a.group = 'check_date';
    } else if (id === 'set_check_date_before_deadline') {
      a.text = 'Choose a date before your notice deadline (' + ctx.notice.date + ') to decide, and add it to your calendar.';
      a.needs_date = true;
      a.before = ctx.notice.date;
      a.group = 'check_date';
    } else if (id === 'review_usage') {
      a.text = 'Review which features and add-ons you use, and ask your supplier about the renewal terms.';
      a.uses = 'supplier_email';
    }
    return a;
  }

  function includesList(input, n, option, sw) {
    if (!option || !n.comparison || !n.comparison.ok) { return null; }
    var basis = n.basis === 'renewal' ? input.renewal_quote : input.current;
    var list = [];
    list.push({ key: 'period', text: '12-month cost equivalents. Your payment dates and amounts may differ.' });
    if (n.basis === 'renewal') {
      list.push({ key: 'basis', text: 'Your side of the comparison uses the renewal quote, not your current invoice.' });
    }
    list.push({ key: 'currency', text: 'Both amounts in ' + basis.currency + '. No currency conversion.' });
    list.push({ key: 'tax', text: basis.tax === 'included' ? 'Tax included in both amounts.' : 'Tax excluded from both amounts.' });
    list.push({
      key: 'scope',
      text: option.scope_confirmed === true
        ? 'You confirmed that the option covers the same users and usage.'
        : 'Not confirmed: the option covers the same users and usage.'
    });
    list.push({
      key: 'option_price',
      text: option.price_source === 'quote'
        ? 'Option price: a quote you entered.'
        : 'Option price: an estimate until the supplier confirms it.'
    });
    var swText;
    if (sw.K === null) {
      swText = 'Switching costs: partly unknown (' + unknownNames(sw.unknown.length ? sw.unknown : sw.invalid).join(', ') + ').';
    } else if (sw.confirmed) {
      swText = 'Switching costs: confirmed by you.';
    } else {
      swText = 'Switching costs: your estimate. Hourly value is an economic estimate, not a payment.';
    }
    list.push({ key: 'switching', text: swText });
    return list;
  }

  function normLicences(seats) {
    seats = seats || {};
    var paid = isCount(seats.paid) ? seats.paid : null;
    var active = isCount(seats.active) ? seats.active : null;
    var minimum = isCount(seats.minimum) ? seats.minimum : null;
    return {
      paid: paid,
      active: active,
      minimum: minimum,
      unused: (paid !== null && active !== null && active < paid) ? paid - active : null
    };
  }

  // decide(input) -> result
  // input: {
  //   today: 'YYYY-MM-DD' (the visitor's local date, from todayLocal()),
  //   goal: 'lower_costs'|'better_plan'|'alternative'|'planning_only'|null,
  //   current: { amount, currency, period, tax },
  //   renewal_quote: { amount, currency, period, tax } | null,
  //   seats: { paid, active, minimum },
  //   dates: { renewal: 'YYYY-MM-DD'|null, notice_deadline: 'YYYY-MM-DD'|null },
  //   option: null | { amount, currency, period, tax,
  //     price_source: 'quote'|'catalogue'|'estimate'|null, scope_confirmed: bool,
  //     fit_confirmed: bool, features: [{ label, status: 'supported'|'missing'|'unknown' }] },
  //   switching: { hours, hourly_rate, implementation, overlap, other, confirmed }
  // }
  // Fixed priority: basis incomplete -> deadline passed -> option rows ->
  // licences -> deadline unknown -> review current. Several signals can be
  // present; result_category is the first. At most three actions.
  function decide(input) {
    input = input || {};
    var today = input.today;
    if (!isDate(today)) { throw new TypeError('decide: today must be a YYYY-MM-DD string'); }
    var n = compare(input);
    var option = input.option || null;
    var dates = input.dates || {};
    var signals = [];
    var warnings = [];
    var problems = [];

    // 1. Price basis incomplete or not comparable. An option that lacks a
    // required feature is left out, so its price details are not asked for.
    var features = normFeatures(option);
    var optionExcluded = !!(option && features.missing.length);
    var basisObj = n.basis === 'renewal' ? input.renewal_quote : input.current;
    if (option && !optionExcluded) {
      problems = n.comparison.problems.slice(0);
    } else {
      problems = moneyProblems(basisObj, n.basis);
    }
    var sw = n.switching || switchingCosts(null);
    if (option && !optionExcluded && sw.invalid.length) {
      problems.push(problem('invalid_switching_value', null,
        'Check these switching cost fields: ' + unknownNames(sw.invalid).join(', ') + '.'));
    }
    var blocked = false;
    for (var i = 0; i < problems.length; i++) { if (problems[i].kind === 'blocked') { blocked = true; } }
    if (problems.length) {
      signals.push({ category: 'check_details', reasons: problems.map(function (p) { return p.code; }) });
    }

    // 2. Deadline passed (according to the visitor's own dates).
    var notice = dateStatus(dates.notice_deadline, today);
    var renewalDate = dateStatus(dates.renewal, today);
    if (notice.status === 'invalid') {
      warnings.push({ code: 'invalid_notice_date', date: null, text: 'The notice deadline is not a valid date, so it was left out.' });
    }
    if (renewalDate.status === 'invalid') {
      warnings.push({ code: 'invalid_renewal_date', date: null, text: 'The renewal date is not a valid date, so it was left out.' });
    }
    if (notice.status === 'passed' || renewalDate.status === 'passed') {
      var reasons = [];
      if (notice.status === 'passed') {
        reasons.push('notice_deadline_passed');
        warnings.push({ code: 'deadline_passed', date: notice.date, text: 'According to what you entered, your notice deadline (' + notice.date + ') has passed.' });
      }
      if (renewalDate.status === 'passed') {
        reasons.push('renewal_date_passed');
        warnings.push({ code: 'renewal_date_passed', date: renewalDate.date, text: 'According to what you entered, the renewal date (' + renewalDate.date + ') has passed.' });
      }
      signals.push({ category: 'deadline_passed', reasons: reasons });
    }
    if (notice.status === 'today') {
      warnings.push({ code: 'deadline_today', date: notice.date, text: 'Your notice deadline is today.' });
    }

    // 3. Option rows.
    var open = [];
    var optionStatus = option ? 'not_comparable' : 'none';
    if (optionExcluded) {
      optionStatus = 'excluded';
    } else if (option && n.comparison.ok && n.S !== null) {
      if (n.S <= 0) {
        optionStatus = 'no_saving';
        signals.push({ category: 'no_saving', reasons: [n.S === 0 ? 'same_cost' : 'option_costs_more'] });
      } else {
        open = openConditions(option, features, sw);
        if (open.length) {
          optionStatus = 'investigate';
          signals.push({ category: 'investigate_option', reasons: open.map(function (o) { return o.code; }) });
        } else {
          optionStatus = 'may_lower';
          signals.push({ category: 'may_lower_costs', reasons: n.K === 0 ? ['no_one_off_costs_entered'] : ['confirmed_inputs'] });
        }
      }
    }

    // 4. Licences: a signal only, never a savings figure.
    var licences = normLicences(input.seats);
    if (licences.unused !== null) {
      if (licences.minimum !== null && licences.minimum >= licences.paid) {
        warnings.push({ code: 'at_minimum', date: null, text: 'You pay for the minimum number of licences you entered (' + formatCount(licences.minimum) + ').' });
      } else {
        signals.push({ category: 'reduce_licences', reasons: [licences.minimum === null ? 'minimum_unknown' : 'minimum_known'] });
      }
    }

    // 5. Notice deadline unknown.
    if (notice.status === 'unknown' || notice.status === 'invalid') {
      signals.push({ category: 'find_deadline', reasons: ['notice_deadline_unknown'] });
    }

    // 6. No usable option: review the current plan.
    if (!option || optionExcluded) {
      signals.push({ category: 'review_current', reasons: [optionExcluded ? 'option_lacks_feature' : 'no_option_entered'] });
    }

    var ctx = {
      numbers: n, problems: problems, blocked: blocked, open: open, notice: notice,
      renewalDate: renewalDate, licences: licences, features: features, optionExcluded: optionExcluded
    };

    // Actions: primaries in signal order, then secondaries, at most three.
    var actions = [];
    var groups = [];
    function add(id) {
      if (actions.length >= 3) { return; }
      var a = buildAction(id, ctx);
      if (indexOf(groups, a.group) >= 0) { return; }
      groups.push(a.group);
      a.category = null;
      actions.push(a);
    }
    var s, k;
    for (s = 0; s < signals.length; s++) {
      var prim = SIGNAL_ACTIONS[signals[s].category][0];
      for (k = 0; k < prim.length; k++) { add(prim[k]); }
    }
    for (s = 0; s < signals.length; s++) {
      var sec = SIGNAL_ACTIONS[signals[s].category][1];
      for (k = 0; k < sec.length; k++) { add(sec[k]); }
    }
    if (notice.status === 'upcoming' || notice.status === 'today') { add('set_check_date_before_deadline'); }
    for (k = 0; k < actions.length; k++) {
      for (s = 0; s < signals.length; s++) {
        var ids = SIGNAL_ACTIONS[signals[s].category][0].concat(SIGNAL_ACTIONS[signals[s].category][1]);
        if (indexOf(ids, actions[k].id) >= 0) { actions[k].category = signals[s].category; break; }
      }
    }

    var category = signals[0].category;
    return {
      result_category: category,
      headline: HEADLINES[category],
      explanation: explain(category, ctx),
      signals: signals.map(function (sg) {
        return { category: sg.category, headline: HEADLINES[sg.category], reasons: sg.reasons };
      }),
      actions: actions,
      problems: problems,
      warnings: warnings,
      open_conditions: open,
      option_status: optionStatus,
      includes: includesList(input, n, option, sw),
      deadline: notice,
      renewal_date: renewalDate,
      licences: licences.unused !== null ? licences : null,
      numbers: n
    };
  }

  // ------------------------------------------------------------------
  // Calendar file (.ics)
  // ------------------------------------------------------------------
  function utf8Length(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) { n += 1; } else if (c < 0x800) { n += 2; } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { n += 4; i++; } else { n += 3; }
      } else { n += 3; }
    }
    return n;
  }
  // RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks.
  function icsEscape(text) {
    var s = cleanMultiline(text, 2000);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === BS) { out += BS + BS; } else if (c === ';') { out += BS + ';'; } else if (c === ',') { out += BS + ','; } else if (c === NL) { out += BS + 'n'; } else { out += c; }
    }
    return out;
  }
  // Fold a content line at 75 octets (UTF-8). Never splits a character,
  // a surrogate pair or an escape sequence.
  function icsFold(line) {
    var units = [];
    var i = 0;
    while (i < line.length) {
      var c = line.charCodeAt(i);
      if (c === 92 && i + 1 < line.length) { units.push(line.substr(i, 2)); i += 2; continue; }
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < line.length) {
        var d = line.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { units.push(line.substr(i, 2)); i += 2; continue; }
      }
      units.push(line.charAt(i));
      i += 1;
    }
    var out = [];
    var cur = '';
    var bytes = 0;
    for (var u = 0; u < units.length; u++) {
      var b = utf8Length(units[u]);
      if (bytes + b > 75) {
        out.push(cur);
        cur = ' ';
        bytes = 1;
      }
      cur += units[u];
      bytes += b;
    }
    out.push(cur);
    return out.join(CRLF);
  }
  function randomHex(bytesWanted, rnd) {
    var bytes = [];
    var i;
    if (!rnd && typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      var arr = new Uint8Array(bytesWanted);
      crypto.getRandomValues(arr);
      for (i = 0; i < bytesWanted; i++) { bytes.push(arr[i]); }
    } else {
      var r = typeof rnd === 'function' ? rnd : Math.random;
      for (i = 0; i < bytesWanted; i++) { bytes.push(Math.floor(r() * 256) & 255); }
    }
    var hex = '';
    for (i = 0; i < bytes.length; i++) { hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); }
    return hex;
  }
  function utcStamp(d) {
    return pad4(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }
  var ICS_DEFAULT_TITLE = 'Review software renewal';
  var ICS_DEFAULT_DESCRIPTION = 'Check the renewal terms and decide what to do next.';

  // ics({ date: 'YYYY-MM-DD', title?, description?, now?: Date, random?: fn, uidDomain? })
  // -> { ok: true, text, filename, uid } or { ok: false, error, message }
  // All-day event on exactly the chosen calendar date: DTSTART;VALUE=DATE
  // comes from the string itself, DTEND is the next day via Date.UTC.
  // CRLF line ends, TEXT escaping, folding at 75 octets, random UID.
  // Nothing from the comparison is added: no amounts.
  function ics(opts) {
    opts = opts || {};
    if (!isDate(opts.date)) {
      return { ok: false, error: 'invalid_date', message: 'Choose a valid date for the reminder.' };
    }
    // The title is one line: line breaks in it become spaces.
    var title = cleanInline(opts.title, 200);
    if (!title) { title = ICS_DEFAULT_TITLE; }
    var description = known(opts.description) ? cleanMultiline(opts.description, 1000) : ICS_DEFAULT_DESCRIPTION;
    var now = (opts.now && typeof opts.now.getUTCFullYear === 'function') ? opts.now : new Date();
    var domain = (typeof opts.uidDomain === 'string' && /^[a-z0-9.-]{1,60}$/.test(opts.uidDomain)) ? opts.uidDomain : 'before-you-renew';
    var uid = randomHex(16, opts.random) + '@' + domain;
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Before You Renew//Renewal Check//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + utcStamp(now),
      'DTSTART;VALUE=DATE:' + compact(opts.date),
      'DTEND;VALUE=DATE:' + compact(nextDay(opts.date)),
      'SUMMARY:' + icsEscape(title),
      'TRANSP:TRANSPARENT'
    ];
    if (description) { lines.push('DESCRIPTION:' + icsEscape(description)); }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    var folded = [];
    for (var i = 0; i < lines.length; i++) { folded.push(icsFold(lines[i])); }
    return { ok: true, text: folded.join(CRLF) + CRLF, filename: 'renewal-reminder.ics', uid: uid };
  }

  // ------------------------------------------------------------------
  // Supplier questions (copied, never sent)
  // ------------------------------------------------------------------
  // supplierEmail(planName) -> { subject, body, text }
  // The plan name is inserted as plain text on one line.
  function supplierEmail(planName) {
    var name = cleanInline(planName, 120);
    var subject = 'Questions before our subscription renewal';
    var intro = name
      ? 'We are reviewing our ' + name + ' subscription before renewal. Could you confirm:'
      : 'We are reviewing our subscription before renewal. Could you confirm:';
    var lines = [
      'Hello,',
      '',
      intro,
      '1. The renewal date, total renewal price and billing commitment.',
      '2. The deadline and process for cancelling or reducing licences.',
      '3. Any minimum quantities, mandatory add-ons or usage charges.',
      '4. When a requested change would take effect.',
      '5. The available data-export options and any associated charges.',
      '',
      'Please identify any changes from our current terms.',
      '',
      'Thank you.'
    ];
    var body = lines.join(NL);
    return { subject: subject, body: body, text: 'Subject: ' + subject + NL + NL + body };
  }

  // ------------------------------------------------------------------
  // Analytics whitelist
  // ------------------------------------------------------------------
  var ANALYTICS = {
    events: {
      renewal_start: ['site'],
      renewal_step_complete: ['site', 'step'],
      renewal_result: ['site', 'result_category'],
      renewal_print: ['site'],
      renewal_calendar_export: ['site'],
      renewal_supplier_copy: ['site'],
      renewal_review_click: ['site']
    },
    values: {
      site: ['aibm', 'osm', 'mss', 'zts'],
      step: ['1', '2', '3'],
      result_category: CATEGORIES.slice(0)
    }
  };
  // analyticsEvent(name, params) -> null or a frozen { name, params }.
  // Unknown names give null. Only the keys listed for the event are kept,
  // and only string values from the fixed enums. If a listed key is missing
  // or invalid, the whole event is dropped.
  function analyticsEvent(name, params) {
    if (typeof name !== 'string' || !has(ANALYTICS.events, name)) { return null; }
    var keys = ANALYTICS.events[name];
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!has(params, k)) { return null; }
      var v = params[k];
      if (typeof v !== 'string' || indexOf(ANALYTICS.values[k], v) < 0) { return null; }
      out[k] = v;
    }
    return Object.freeze({ name: name, params: Object.freeze(out) });
  }

  // ------------------------------------------------------------------
  // Fictional demo (plan section 7). Names are not real suppliers.
  // ------------------------------------------------------------------
  var DEMO = {
    goal: 'alternative',
    current: { name: 'Current tool', amount: 18000, currency: 'EUR', period: 'month', tax: 'excluded' },
    renewal_quote: null,
    seats: { paid: null, active: null, minimum: null },
    dates: { renewal: null, notice_deadline: null },
    option: {
      name: 'Alternative', amount: 12000, currency: 'EUR', period: 'month', tax: 'excluded',
      price_source: 'quote', scope_confirmed: true, fit_confirmed: false, features: []
    },
    switching: { hours: 800, hourly_rate: 5000, implementation: 0, overlap: 18000, other: 0, confirmed: false }
  };

  return deepFreeze({
    version: '1.0.0',
    CURRENCIES: CURRENCIES,
    CURRENCY_ORDER: CURRENCY_ORDER,
    CATEGORIES: CATEGORIES,
    HEADLINES: HEADLINES,
    LABELS: LABELS,
    ANALYTICS: ANALYTICS,
    DEMO: DEMO,
    ICS_DEFAULT_TITLE: ICS_DEFAULT_TITLE,
    parseAmount: parseAmount,
    parseHours: parseHours,
    parseCount: parseCount,
    yearEquivalent: yearEquivalent,
    monthEquivalent: monthEquivalent,
    comparable: comparable,
    switchingCosts: switchingCosts,
    compare: compare,
    decide: decide,
    matchCandidates: matchCandidates,
    paybackTenths: paybackTenths,
    formatTenths: formatTenths,
    formatMoney: formatMoney,
    formatCount: formatCount,
    formatHours: formatHours,
    periodLabel: periodLabel,
    equivalentText: equivalentText,
    isDate: isDate,
    nextDay: nextDay,
    daysBetween: daysBetween,
    todayLocal: todayLocal,
    validateCheckDate: validateCheckDate,
    ics: ics,
    icsEscape: icsEscape,
    icsFold: icsFold,
    utf8Length: utf8Length,
    cleanInline: cleanInline,
    supplierEmail: supplierEmail,
    analyticsEvent: analyticsEvent
  });
}));
