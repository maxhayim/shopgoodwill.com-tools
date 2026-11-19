'use strict';

// Tests load the real userscript file, so they exercise the exact code that
// runs in Tampermonkey. DOM tests use the small stand-in DOM below (no
// dependencies); they are not a live browser test.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sgw = require(path.join(__dirname, '..', 'scripts', 'shopgoodwill-eastern-time.user.js'));

const conv = (text, date) => {
  const r = sgw.convertText(text, date ? { date } : undefined);
  return r && r.text;
};

// ---------------------------------------------------------------------------
// Minimal DOM stand-in: elements, text nodes, "tag.class" selectors and a
// MutationObserver that reports appended children.
// ---------------------------------------------------------------------------
class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentElement = null; }
  get textContent() { return this.nodeValue; }
}

class Element {
  constructor(tag, className, children) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.className = className || '';
    this.attributes = {};
    this.childNodes = [];
    this.parentElement = null;
    this.ownerDocument = null;
    (children || []).forEach((c) => this.appendChild(typeof c === 'string' ? new TextNode(c) : c));
  }
  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    let top = this;
    while (top.parentElement) top = top.parentElement;
    if (top.ownerDocument) top.ownerDocument._notify(this, child);
    return child;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; this.appendChild(new TextNode(v)); }
  get nextSibling() {
    if (!this.parentElement) return null;
    const sibs = this.parentElement.childNodes;
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  insertBefore(child, ref) {
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    this.appendChild(child);
    if (i >= 0) { this.childNodes.pop(); this.childNodes.splice(i, 0, child); }
    return child;
  }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); }
  matches(sel) {
    const [tag, ...classes] = sel.split('.');
    if (tag && tag.toUpperCase() !== this.tagName) return false;
    const mine = this.className.split(/\s+/);
    return classes.every((c) => mine.includes(c));
  }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const sibs = this.parentElement.childNodes.filter((c) => c.nodeType === 1);
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (el) => el.childNodes.forEach((c) => {
      if (c.nodeType === 1) { if (c.matches(sel)) out.push(c); walk(c); }
    });
    walk(this);
    return out;
  }
}

function makeWindow() {
  const observers = [];
  const timers = [];
  const doc = {
    body: new Element('body'),
    _notify(target, added) {
      observers.forEach((o) => o._records.push({ type: 'childList', target, addedNodes: [added] }));
    }
  };
  doc.body.ownerDocument = doc;
  class FakeObserver {
    constructor(cb) { this.cb = cb; this._records = []; }
    observe() { observers.push(this); }
    disconnect() { observers.splice(observers.indexOf(this), 1); }
  }
  const win = {
    MutationObserver: FakeObserver,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() { timers.length = 0; },
    // Delivers pending mutation records, then runs pending timers.
    flush() {
      observers.slice().forEach((o) => {
        const recs = o._records.splice(0);
        if (recs.length) o.cb(recs);
      });
      timers.splice(0).forEach((fn) => fn());
    },
    observers,
    timers
  };
  return { win, doc };
}

const timeLi = (text) => new Element('li', 'text-danger ng-star-inserted', [text]);

// ---------------------------------------------------------------------------
// Conversion.
// ---------------------------------------------------------------------------
test('keeps the original behaviour: 6:39:00 PM PDT -> 9:39:00 PM EDT', () => {
  assert.equal(conv('6:39:00 PM PDT'), '9:39:00 PM EDT');
  assert.equal(conv('  6:39:00 PM PDT  '), '  9:39:00 PM EDT  ');
});

test('PDT to EDT with a summer date', () => {
  assert.equal(conv('10:15:30 AM PDT', { year: 2026, month: 7, day: 4 }), '1:15:30 PM EDT');
});

test('PST to EST, with and without a date', () => {
  assert.equal(conv('4:05:00 PM PST'), '7:05:00 PM EST');
  assert.equal(conv('4:05:00 PM PST', { year: 2026, month: 12, day: 15 }), '7:05:00 PM EST');
});

test('generic PT uses the closing date to pick EST or EDT', () => {
  assert.equal(conv('6:00:00 PM PT', { year: 2026, month: 7, day: 1 }), '9:00:00 PM EDT');
  assert.equal(conv('6:00:00 PM PT', { year: 2026, month: 1, day: 10 }), '9:00:00 PM EST');
});

test('midnight rollover', () => {
  assert.equal(conv('10:30:00 PM PDT', { year: 2026, month: 8, day: 20 }), '1:30:00 AM EDT (next day)');
  assert.equal(conv('9:45:00 PM PST'), '12:45:00 AM EST (next day)');
  // Without a date, a time after 11 PM could fall in a changeover window.
  assert.equal(conv('11:59:59 PM PDT'), '2:59:59 AM ET (next day)');
});

test('a date in the same text is moved to the next day as well', () => {
  assert.equal(conv('8/31/2026 10:30:00 PM PDT'), '9/1/2026 1:30:00 AM EDT');
  assert.equal(conv('12/31/2026 11:00:00 PM PST'), '1/1/2027 2:00:00 AM EST');
  assert.equal(conv('Ends 2026-03-01 9:00:00 PM PST'), 'Ends 2026-03-02 12:00:00 AM EST');
  assert.equal(conv('Nov 20, 2026 6:39:00 PM PST'), 'Nov 20, 2026 9:39:00 PM EST');
});

test('noon and midnight', () => {
  assert.equal(conv('12:00:00 PM PDT'), '3:00:00 PM EDT');
  assert.equal(conv('12:00:00 AM PST', { year: 2026, month: 1, day: 5 }), '3:00:00 AM EST');
  assert.equal(conv('9:00:00 AM PDT'), '12:00:00 PM EDT');
  assert.equal(conv('9:00:00 PM PST', { year: 2026, month: 1, day: 5 }), '12:00:00 AM EST (next day)');
});

test('US DST dates are computed correctly', () => {
  assert.equal(sgw.nthSunday(2026, 3, 2), 8);
  assert.equal(sgw.nthSunday(2026, 11, 1), 1);
  assert.equal(sgw.nthSunday(2027, 3, 2), 14);
  assert.equal(sgw.nthSunday(2027, 11, 1), 7);
});

test('spring changeover night (2026-03-07/08)', () => {
  // 10:30 PM PST Sat = 06:30 UTC, before Eastern springs forward at 07:00 UTC.
  assert.equal(conv('10:30:00 PM PST', { year: 2026, month: 3, day: 7 }), '1:30:00 AM EST (next day)');
  // 11:30 PM PST Sat = 07:30 UTC: Eastern is already on EDT, a 4-hour gap.
  assert.equal(conv('11:30:00 PM PST', { year: 2026, month: 3, day: 7 }), '3:30:00 AM EDT (next day)');
  // 1:30 AM PST Sun = 09:30 UTC: still the 4-hour gap.
  assert.equal(conv('1:30:00 AM PST', { year: 2026, month: 3, day: 8 }), '5:30:00 AM EDT');
  // 3:00 AM PDT Sun: both on daylight time again.
  assert.equal(conv('3:00:00 AM PDT', { year: 2026, month: 3, day: 8 }), '6:00:00 AM EDT');
  // Generic PT on the morning after.
  assert.equal(conv('9:00:00 AM PT', { year: 2026, month: 3, day: 8 }), '12:00:00 PM EDT');
});

test('fall changeover night (2026-10-31/11-01)', () => {
  // 10:30 PM PDT Sat = 05:30 UTC: Eastern still EDT.
  assert.equal(conv('10:30:00 PM PDT', { year: 2026, month: 10, day: 31 }), '1:30:00 AM EDT (next day)');
  // 11:30 PM PDT Sat = 06:30 UTC: Eastern has fallen back, a 2-hour gap.
  assert.equal(conv('11:30:00 PM PDT', { year: 2026, month: 10, day: 31 }), '1:30:00 AM EST (next day)');
  // 1:30 AM PST Sun = 09:30 UTC.
  assert.equal(conv('1:30:00 AM PST', { year: 2026, month: 11, day: 1 }), '4:30:00 AM EST');
  // Generic PT after the change.
  assert.equal(conv('6:00:00 PM PT', { year: 2026, month: 11, day: 1 }), '9:00:00 PM EST');
});

test('without a date, EST/EDT is only claimed when it cannot be wrong', () => {
  const night = sgw.convertText('11:30:00 PM PDT');
  assert.equal(night.result.abbr, 'ET');
  assert.equal(night.result.certain, false);
  const early = sgw.convertText('1:59:00 AM PST');
  assert.equal(early.result.abbr, 'ET');
  const day = sgw.convertText('2:00:00 AM PST');
  assert.equal(day.result.abbr, 'EST');
  assert.equal(day.result.certain, true);
  assert.equal(sgw.convertText('6:00:00 PM PT').result.abbr, 'ET');
});

test('invalid and unsupported formats are left alone', () => {
  [
    '',
    'Ends in 2d 4h 12m',
    '18:39:00 PDT',
    '13:00:00 PM PDT',
    '0:30:00 AM PDT',
    '6:60:00 PM PDT',
    '6:39:61 PM PDT',
    '6:39:00 PM EST',
    '6:39:00 PM CDT',
    '6:39:00 PM PDTX',
    'PDT 6:39 PM'
  ].forEach((t) => assert.equal(sgw.convertText(t), null, t));
  assert.equal(sgw.convertText(null), null);
  assert.equal(sgw.convertText(undefined), null);
});

test('times without seconds and in lower case', () => {
  assert.equal(conv('6:39 pm pdt'), '9:39 PM EDT');
});

test('invalid calendar dates are ignored', () => {
  assert.deepEqual(sgw.findDates('2/30/2026'), []);
  assert.equal(conv('13/45/2026 6:39:00 PM PDT'), '13/45/2026 9:39:00 PM EDT');
});

test('converted text is never converted again', () => {
  const once = conv('6:39:00 PM PDT');
  assert.equal(sgw.convertText(once), null);
});

// ---------------------------------------------------------------------------
// DOM.
// ---------------------------------------------------------------------------
test('processElement converts once and keeps the Pacific time in the tooltip', () => {
  const li = timeLi('6:39:00 PM PDT');
  new Element('ul', '', [li]);
  assert.equal(sgw.processElement(li), true);
  assert.equal(li.textContent, '9:39:00 PM EDT');
  assert.match(li.getAttribute('title'), /Original: 6:39:00 PM PDT \(Pacific Time\)/);
  assert.equal(li.getAttribute('data-sgw-et-original'), '6:39:00 PM PDT');
  // Repeated calls do nothing.
  assert.equal(sgw.processElement(li), false);
  assert.equal(sgw.processElement(li), false);
  assert.equal(li.textContent, '9:39:00 PM EDT');
});

test('an existing title is kept', () => {
  const li = timeLi('6:39:00 PM PDT');
  li.setAttribute('title', 'Auction end');
  sgw.processElement(li);
  assert.match(li.getAttribute('title'), /^Auction end\nOriginal: 6:39:00 PM PDT/);
  li.childNodes[0].nodeValue = '7:00:00 PM PDT';
  sgw.processElement(li);
  assert.match(li.getAttribute('title'), /^Auction end\nOriginal: 7:00:00 PM PDT/);
});

test('uncertain abbreviation is explained in the tooltip', () => {
  const li = timeLi('11:30:00 PM PDT');
  sgw.processElement(li);
  assert.equal(li.textContent, '2:30:00 AM ET (next day)');
  assert.match(li.getAttribute('title'), /could not be confirmed/);
});

test('Angular re-render with a new Pacific time is converted again', () => {
  const li = timeLi('6:39:00 PM PDT');
  sgw.processElement(li);
  li.childNodes[0].nodeValue = '7:15:00 PM PDT';
  assert.equal(sgw.processElement(li), true);
  assert.equal(li.textContent, '10:15:00 PM EDT');
});

test('closing date is read from the surrounding listing', () => {
  const li = timeLi('11:30:00 PM PST');
  const ul = new Element('ul', 'item-ends', [new Element('li', '', ['Ends 3/7/2026']), li]);
  new Element('div', 'item', [ul]);
  sgw.processElement(li);
  assert.equal(li.textContent, '3:30:00 AM EDT (next day)');
});

test('a date is never borrowed from a container holding several listings', () => {
  const a = timeLi('11:30:00 PM PST');
  const b = timeLi('6:00:00 PM PST');
  const ul = new Element('ul', '', [new Element('li', '', ['3/7/2026']), a, b]);
  new Element('div', '', [ul]);
  assert.equal(sgw.findClosingDate(a), null);
});

test('conflicting dates nearby are ignored', () => {
  const li = timeLi('6:00:00 PM PT');
  new Element('ul', '', [new Element('li', '', ['Listed 1/2/2026, ends 7/2/2026']), li]);
  assert.equal(sgw.findClosingDate(li), null);
});

test('countdowns and unrelated elements are not touched', () => {
  const body = new Element('body', '', [
    new Element('li', 'text-danger', ['2d 4h 12m']),
    new Element('span', 'countdown', ['6:39:00 PM PDT']),
    new Element('li', 'text-success', ['6:39:00 PM PDT']),
    timeLi('6:39:00 PM PDT')
  ]);
  assert.equal(sgw.scan(body), 1);
  assert.equal(body.childNodes[0].textContent, '2d 4h 12m');
  assert.equal(body.childNodes[1].textContent, '6:39:00 PM PDT');
  assert.equal(body.childNodes[2].textContent, '6:39:00 PM PDT');
  assert.equal(body.childNodes[3].textContent, '9:39:00 PM EDT');
});

test('repeated scans are stable', () => {
  const body = new Element('body', '', [timeLi('6:39:00 PM PDT'), timeLi('4:05:00 PM PST')]);
  assert.equal(sgw.scan(body), 2);
  assert.equal(sgw.scan(body), 0);
  assert.equal(sgw.scan(body), 0);
  assert.equal(body.textContent, '9:39:00 PM EDT7:05:00 PM EST');
});

test('dynamically inserted elements are converted by the observer', () => {
  const { win, doc } = makeWindow();
  doc.body.appendChild(timeLi('6:39:00 PM PDT'));
  const handle = sgw.start(win, doc);
  assert.equal(doc.body.childNodes[0].textContent, '9:39:00 PM EDT');

  // Angular adds a listing later.
  const ul = new Element('ul', '', [timeLi('10:30:00 PM PST')]);
  doc.body.appendChild(ul);
  assert.equal(ul.childNodes[0].textContent, '10:30:00 PM PST');
  win.flush();
  assert.equal(ul.childNodes[0].textContent, '1:30:00 AM EST (next day)');

  // Several insertions in one burst schedule a single rescan.
  doc.body.appendChild(timeLi('1:00:00 PM PDT'));
  doc.body.appendChild(timeLi('2:00:00 PM PDT'));
  win.observers.forEach((o) => { const r = o._records.splice(0); o.cb(r); o.cb(r); });
  assert.equal(win.timers.length, 1);
  win.flush();
  assert.equal(doc.body.childNodes[2].textContent, '4:00:00 PM EDT');
  assert.equal(doc.body.childNodes[3].textContent, '5:00:00 PM EDT');

  handle.stop();
  assert.equal(win.observers.length, 0);
});

test('item page "Ends On" row is converted using its own date', () => {
  const td = new Element('td', '', [' 11/23/2026 07:56:00 PM PT ']);
  const other = new Element('td', '', [' 284347676 ']);
  const body = new Element('body', '', [
    new Element('table', '', [
      new Element('tr', '', [new Element('th', '', [' Item ID: ']), other]),
      new Element('tr', '', [new Element('th', '', [' Ends On: ']), td])
    ])
  ]);
  assert.equal(sgw.scan(body), 1);
  assert.equal(td.textContent, ' 11/23/2026 10:56:00 PM EST ');
  assert.equal(other.textContent, ' 284347676 ');
  assert.equal(sgw.scan(body), 0);
});

test('"Ends On" late at night moves the date too', () => {
  const td = new Element('td', '', ['8/31/2026 10:30:00 PM PT']);
  const body = new Element('body', '', [new Element('tr', '', [new Element('th', '', ['Ends On:']), td])]);
  sgw.scan(body);
  assert.equal(td.textContent, '9/1/2026 1:30:00 AM EDT');
});

// ---------------------------------------------------------------------------
// Eastern end time beside the item page countdown.
// ---------------------------------------------------------------------------
test('shortEasternEnd reads Pacific or already-converted Ends On values', () => {
  assert.equal(sgw.shortEasternEnd('11/19/2026 06:02:00 PM PT'), 'Thu 11/19, 9:02 PM EST');
  assert.equal(sgw.shortEasternEnd('11/19/2026 09:02:00 PM EST'), 'Thu 11/19, 9:02 PM EST');
  assert.equal(sgw.shortEasternEnd('7/4/2026 10:30:00 PM PT'), 'Sun 7/5, 1:30 AM EDT');
  assert.equal(sgw.shortEasternEnd('soon'), null);
});

function itemPage(endsText, timeLeft) {
  const doc = { createElement: (tag) => new Element(tag), _notify() {} };
  const value = new Element('span', '', [timeLeft]);
  const ends = new Element('td', '', [endsText]);
  const bar = new Element('span', 'ng-star-inserted', [
    new Element('strong', '', ['Time left:']), value, new Element('p', '', ['(update)'])
  ]);
  const body = new Element('body', '', [
    new Element('app-bidding-control', '', [new Element('div', '', [bar])]),
    new Element('table', '', [new Element('tr', '', [new Element('th', '', ['Ends On:']), ends])])
  ]);
  body.ownerDocument = doc;
  return { body, bar, value, ends };
}

test('adds the Eastern end time right after the countdown, once', () => {
  const p = itemPage('11/19/2026 06:02:00 PM PT', '5h 18m');
  sgw.scan(p.body);
  const added = p.value.nextElementSibling;
  assert.equal(added.className, 'sgwt-et-ends');
  assert.equal(added.textContent, ' \u00b7 ends Thu 11/19, 9:02 PM EST');
  assert.equal(p.bar.textContent, 'Time left:5h 18m \u00b7 ends Thu 11/19, 9:02 PM EST(update)');
  assert.equal(p.ends.textContent, '11/19/2026 9:02:00 PM EST');
  assert.equal(sgw.scan(p.body), 0);
  assert.equal(p.bar.querySelectorAll('span.sgwt-et-ends').length, 1);
});

test('no Ends On line: the countdown is left alone', () => {
  const p = itemPage('', '5h 18m');
  sgw.scan(p.body);
  assert.equal(p.value.nextElementSibling.tagName, 'P');
});
