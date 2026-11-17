const test = require('node:test');
const assert = require('node:assert/strict');
const SL = require('../src/core.js');

function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }

function group3() {
  const g = SL.newGroup('東京', 'TWD', ['A', 'B', 'C']);
  const [a, b, c] = g.members.map((m) => m.id);
  return { g, a, b, c };
}
function exp(g, payer, amount, parts, extra = {}) {
  const e = { id: SL.uid(), t: SL.now(), title: 'x', amount, cur: g.base, payer, split: { mode: 'equal', parts }, date: '2026-11-18', cat: 'food', ...extra };
  g.expenses.push(e);
  return e;
}

test('allocate sums exactly and distributes remainder deterministically', () => {
  const r = SL.allocate(100, [['a', 1], ['b', 1], ['c', 1]]);
  assert.deepEqual(r, { a: 34, b: 33, c: 33 });
  assert.equal(sum(SL.allocate(1001, [['a', 3], ['b', 7], ['c', 11]])), 1001);
  assert.equal(sum(SL.allocate(-50, [['a', 1], ['b', 2]])), -50);
  assert.deepEqual(SL.allocate(10, [['a', 0]]), {});
});

test('allocate fuzz: always exact', () => {
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(Math.random() * 8);
    const ws = Array.from({ length: n }, (_, k) => [String(k), Math.random() < 0.2 ? 0 : Math.random() * 100]);
    const total = Math.floor(Math.random() * 1e6);
    const r = SL.allocate(total, ws);
    if (ws.some(([, w]) => w > 0)) assert.equal(sum(r), total);
  }
});

test('balances sum to zero and settle clears them', () => {
  const { g, a, b, c } = group3();
  exp(g, a, 900, { [a]: 1, [b]: 1, [c]: 1 });
  exp(g, b, 301, { [a]: 1, [b]: 1, [c]: 1 });
  exp(g, c, 1000, { [a]: 2, [b]: 1 });
  const { bal } = SL.balances(g);
  assert.equal(sum(bal), 0);
  const plan = SL.settle({ ...bal });
  assert.ok(plan.length <= 2);
  const after = { ...bal };
  for (const p of plan) { after[p.from] += p.amount; after[p.to] -= p.amount; }
  assert.ok(Object.values(after).every((v) => v === 0));
});

test('transfer settles a debt', () => {
  const { g, a, b } = group3();
  exp(g, a, 200, { [a]: 1, [b]: 1 });
  g.expenses.push({ id: SL.uid(), t: SL.now(), kind: 'transfer', amount: 100, cur: 'TWD', payer: b, to: a, date: '2026-11-18' });
  const { bal, paid, consumed } = SL.balances(g);
  assert.equal(bal[a], 0);
  assert.equal(bal[b], 0);
  assert.equal(paid[b], 0, 'transfers are not spending');
  assert.equal(consumed[a], 100);
});

test('foreign currency converts with rate, missing rate is reported', () => {
  const { g, a, b } = group3();
  g.rates.JPY = { r: 0.21, t: 1 };
  exp(g, a, 10000, { [a]: 1, [b]: 1 }, { cur: 'JPY' });
  exp(g, a, 10, { [a]: 1, [b]: 1 }, { cur: 'USD' });
  const { bal, missingRates } = SL.balances(g);
  assert.equal(bal[b], -1050);
  assert.deepEqual(missingRates, ['USD']);
});

test('USD base uses cents', () => {
  const g = SL.newGroup('NY', 'USD', ['A', 'B', 'C']);
  const [a, b, c] = g.members.map((m) => m.id);
  exp(g, a, 10, { [a]: 1, [b]: 1, [c]: 1 });
  const { bal } = SL.balances(g);
  assert.equal(bal[a], 666);
  assert.equal(bal[b] + bal[c], -666);
  assert.equal(SL.fmtMinor(1234, 'USD'), 'US$12.34');
});

test('settle prefers exact matches', () => {
  const plan = SL.settle({ a: 500, b: 300, c: -300, d: -500 });
  assert.equal(plan.length, 2);
  assert.ok(plan.some((p) => p.from === 'c' && p.to === 'b' && p.amount === 300));
});

test('settle fuzz: transfers <= n-1 and clears all', () => {
  for (let i = 0; i < 500; i++) {
    const n = 2 + Math.floor(Math.random() * 9);
    const bal = {};
    let s = 0;
    for (let k = 0; k < n - 1; k++) { const v = Math.floor(Math.random() * 20000) - 10000; bal['m' + k] = v; s += v; }
    bal['m' + (n - 1)] = -s;
    const plan = SL.settle({ ...bal });
    assert.ok(plan.length <= n - 1);
    for (const p of plan) { assert.ok(p.amount > 0); bal[p.from] += p.amount; bal[p.to] -= p.amount; }
    assert.ok(Object.values(bal).every((v) => v === 0));
  }
});

test('merge unions records, newer edit wins, tombstones propagate', () => {
  const { g, a, b } = group3();
  const e1 = exp(g, a, 100, { [a]: 1, [b]: 1 });
  const copyA = structuredClone(g);
  const copyB = structuredClone(g);
  exp(copyA, a, 50, { [a]: 1 });
  exp(copyB, b, 70, { [b]: 1 });
  copyB.expenses.find((x) => x.id === e1.id).amount = 120;
  copyB.expenses.find((x) => x.id === e1.id).t = e1.t + 10;
  copyB.members.push({ id: 'newbie', name: 'D', t: SL.now() });

  const { group: m1, stats } = SL.merge(copyA, copyB);
  assert.equal(stats.expensesAdded, 1);
  assert.equal(stats.expensesUpdated, 1);
  assert.equal(stats.membersAdded, 1);
  assert.equal(m1.expenses.length, 3);
  assert.equal(m1.expenses.find((x) => x.id === e1.id).amount, 120);

  const { group: m2 } = SL.merge(copyB, copyA);
  const key = (gr) => JSON.stringify(gr.expenses.map((x) => [x.id, x.amount]).sort());
  assert.equal(key(m1), key(m2), 'merge is commutative on content');

  const del = structuredClone(m1);
  Object.assign(del.expenses[0], { del: true, t: SL.now() + 100 });
  const { group: m3 } = SL.merge(m1, del);
  assert.equal(SL.liveExpenses(m3).length, 2);
  assert.throws(() => SL.merge(m1, SL.newGroup('x')));
});

test('encode/decode round trip (compressed)', async () => {
  const { g, a, b, c } = group3();
  for (let i = 0; i < 40; i++) exp(g, [a, b, c][i % 3], 100 + i, { [a]: 1, [b]: 1, [c]: 1 }, { title: '拉麵 ' + i });
  const s = await SL.encode(g);
  assert.equal(s[0], 'z');
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  const back = await SL.decode(s);
  assert.deepEqual(back.expenses, g.expenses);
  assert.ok(s.length < JSON.stringify(g).length);
});

test('compact v2 round trip covers every record shape', async () => {
  const { g, a, b, c } = group3();
  g.rates.JPY = { r: 0.212, t: SL.now() - 5000 };
  exp(g, a, 900, { [a]: 1, [b]: 1, [c]: 1 });
  exp(g, b, 18000, { [a]: 1, [b]: 2, [c]: 1.5 }, { cur: 'JPY', split: { mode: 'shares', parts: { [a]: 1, [b]: 2, [c]: 1.5 } }, cat: 'stay' });
  exp(g, c, 12.5, {}, { split: { mode: 'exact', parts: { [a]: 10, [c]: 2.5 } }, title: '' });
  g.expenses.push({ id: SL.uid(), t: SL.now(), kind: 'transfer', title: '', amount: 300, cur: 'TWD', payer: b, to: a, date: '2026-11-17' });
  g.expenses.push({ id: SL.uid(), t: SL.now(), del: true, amount: 0, cur: 'TWD' });
  g.members.push({ id: SL.uid(), name: 'gone', t: SL.now(), del: true });
  const back = await SL.decode(await SL.encode(g));
  assert.deepEqual(back.expenses, g.expenses);
  assert.deepEqual(back.members, g.members);
  assert.deepEqual(back.rates, g.rates);
  assert.equal(back.t, g.t);
  assert.deepEqual(SL.balances(back), SL.balances(g));
});

test('link stays LINE-friendly: 100 records < 5000 chars', async () => {
  const g = SL.newGroup('旅行', 'TWD', ['小明', '小華', '阿傑', 'Amy', 'Bob', 'Cat']);
  const ids = g.members.map((m) => m.id);
  const titles = ['拉麵', '計程車', '便利商店', '咖啡', '門票', '晚餐', '早餐', '地鐵'];
  for (let i = 0; i < 100; i++) {
    const parts = Object.fromEntries(ids.filter((_, k) => (i + k) % 4).map((id) => [id, 1]));
    exp(g, ids[i % 6], 100 + ((i * 137) % 5000), parts, { title: titles[i % 8], date: `2026-11-${String(1 + (i % 9)).padStart(2, '0')}`, t: SL.now() + i * 60000 });
  }
  const s = await SL.encode(g);
  assert.ok(s.length < 5000, `encoded length ${s.length}`);
});

test('validate neutralises hostile link data', async () => {
  const { g, a, b } = group3();
  const bad = structuredClone(g);
  bad.name = 123;
  bad.rates = { USD: null, '"><img src=x>': { r: 1 }, JPY: { r: 1e999 }, toString: { r: 2 } };
  bad.expenses = [
    { id: 'x1', t: 1, amount: 100, cur: '<img src=x onerror=alert(1)>', payer: a, split: { mode: 'equal', parts: { [a]: 1 } } },
    { id: 'x2', t: 1, amount: 100, cur: 'TWD', payer: a, date: 20261118, split: { mode: 'shares', parts: { [a]: 1e999, [b]: 1 } } },
    { id: 'x3', t: 1, amount: 1e999, cur: 'TWD', payer: a },
    { id: 'x4', t: 1, amount: 100, cur: 'TWD', payer: 'ghost' },
    { id: 'x5', t: 1, amount: 100, cur: 'TWD', payer: a, split: { mode: 'equal' } },
    { id: '__proto__', t: 1, amount: 5, cur: 'TWD', payer: a },
  ];
  bad.base = 'constructor';
  const v = SL.validate(structuredClone(bad));
  assert.equal(v.name, '123');
  assert.equal(v.base, 'TWD');
  assert.deepEqual(Object.keys(v.rates), []);
  assert.deepEqual(v.expenses.map((e) => e.id), ['x2', 'x5']);
  assert.equal(v.expenses[0].date, '');
  assert.deepEqual(v.expenses[0].split.parts, { [b]: 1 });
  const { bal } = SL.balances(v);
  assert.equal(sum(bal), 0, 'ledger stays balanced even with an empty split');
  assert.ok(Object.values(bal).every(Number.isFinite));
  assert.equal(SL.fmtMinor(100, '<b>'), '1.00', 'unknown currency code is never echoed');
});

test('pre-2020 and empty dates survive the compact format', async () => {
  const { g, a } = group3();
  exp(g, a, 100, { [a]: 1 }, { date: '2019-12-30' });
  exp(g, a, 100, { [a]: 1 }, { date: '' });
  const back = await SL.decode(await SL.encode(g));
  assert.deepEqual(back.expenses.map((e) => e.date), ['2019-12-30', '']);
});

test('merge ignores rates from a copy with a different base currency', () => {
  const { g } = group3();
  g.rates.JPY = { r: 0.21, t: 100 };
  const changed = structuredClone(g);
  changed.base = 'JPY'; changed.t = g.t + 10; changed.rates = { TWD: { r: 4.76, t: 200 } };
  const { group } = SL.merge(g, changed);
  assert.equal(group.base, 'JPY');
  assert.deepEqual(Object.keys(group.rates), ['TWD']);
});

test('decompression bomb is rejected', async () => {
  const big = new TextEncoder().encode('{"x":"' + 'a'.repeat(6 * 1024 * 1024) + '"}');
  const zipped = new Uint8Array(await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const code = 'z' + Buffer.from(zipped).toString('base64url');
  await assert.rejects(SL.decode(code), /過大/);
});

test('csv neutralises formulas', () => {
  const { g, a } = group3();
  exp(g, a, 100, { [a]: 1 }, { title: '=HYPERLINK("x")' });
  assert.match(SL.toCSV(g), /'=HYPERLINK/);
});

test('decode rejects garbage', async () => {
  await assert.rejects(SL.decode('xabc'));
  await assert.rejects(SL.decode('j' + Buffer.from('{"a":1}').toString('base64url')));
});

test('summary text and csv', () => {
  const { g, a, b } = group3();
  exp(g, a, 300, { [a]: 1, [b]: 1 }, { title: '晚餐, 含飲料' });
  const t = SL.summaryText(g);
  assert.match(t, /B → A {2}NT\$150/);
  const csv = SL.toCSV(g);
  assert.match(csv, /"晚餐, 含飲料"/);
});
