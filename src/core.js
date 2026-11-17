/*
 * SplitLink core — pure logic, no DOM.
 * Works in browsers (window.SL) and Node (module.exports).
 *
 * Money model: every amount is converted to the group's base currency and
 * handled as integer minor units, so balances always sum to exactly zero.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ZERO_DECIMAL = new Set(['TWD', 'JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF']);
  const decimalsOf = (cur) => (ZERO_DECIMAL.has(cur) ? 0 : 2);

  const CURRENCIES = {
    TWD: 'NT$', USD: 'US$', JPY: '¥', KRW: '₩', EUR: '€', GBP: '£', CNY: 'CN¥',
    HKD: 'HK$', MOP: 'MOP$', SGD: 'S$', MYR: 'RM', THB: '฿', VND: '₫', PHP: '₱',
    IDR: 'Rp', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', CHF: 'CHF', ISK: 'kr', HUF: 'Ft',
  };

  const CATEGORIES = [
    { id: 'food', icon: '🍜', label: '餐飲' },
    { id: 'transport', icon: '🚕', label: '交通' },
    { id: 'stay', icon: '🏨', label: '住宿' },
    { id: 'fun', icon: '🎡', label: '娛樂' },
    { id: 'shop', icon: '🛍️', label: '購物' },
    { id: 'grocery', icon: '🛒', label: '日用' },
    { id: 'bill', icon: '🧾', label: '帳單' },
    { id: 'other', icon: '📦', label: '其他' },
  ];

  function uid() {
    const a = new Uint8Array(8);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(a);
    return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  }

  function now() { return Date.now(); }

  function newGroup(name, base = 'TWD', memberNames = []) {
    const t = now();
    return {
      v: 1,
      id: uid(),
      name: name || '新群組',
      base,
      t, // meta (name/base) last-write timestamp
      rates: {}, // { USD: { r: 31.5, t } } => 1 USD = 31.5 base
      members: memberNames.filter(Boolean).map((n) => ({ id: uid(), name: n.trim(), t })),
      expenses: [],
    };
  }

  /* ---------- allocation ---------- */

  /**
   * Split integer `total` according to weights using the largest-remainder
   * method. Result sums exactly to total; ties go to earlier entries.
   * @param {number} total integer (may be negative)
   * @param {Array<[string, number]>} weights [[id, weight], ...]
   * @returns {Object<string, number>}
   */
  function allocate(total, weights) {
    const ws = weights.filter(([, w]) => w > 0);
    const out = {};
    if (!ws.length) return out;
    const sign = total < 0 ? -1 : 1;
    const abs = Math.abs(total);
    const sum = ws.reduce((s, [, w]) => s + w, 0);
    let used = 0;
    const rema = ws.map(([id, w], i) => {
      const exact = (abs * w) / sum;
      const fl = Math.floor(exact + 1e-9);
      used += fl;
      out[id] = fl;
      return { id, r: exact - fl, i };
    });
    let left = abs - used;
    rema.sort((a, b) => b.r - a.r || a.i - b.i);
    for (let k = 0; left > 0; k = (k + 1) % rema.length, left--) out[rema[k].id] += 1;
    if (sign < 0) for (const id in out) out[id] = -out[id];
    return out;
  }

  function rateOf(group, cur) {
    if (cur === group.base) return 1;
    const r = group.rates[cur];
    return r && r.r > 0 ? r.r : null;
  }

  /** Expense amount in base-currency minor units, or null if no rate. */
  function toBaseMinor(group, amount, cur) {
    const rate = rateOf(group, cur);
    if (rate == null) return null;
    return Math.round(amount * rate * 10 ** decimalsOf(group.base));
  }

  function liveMembers(group) { return group.members.filter((m) => !m.del); }
  function liveExpenses(group) { return group.expenses.filter((e) => !e.del); }

  /**
   * Per-member effect of one expense in base minor units.
   * Returns { paid: {id: n}, owed: {id: n}, total } or null if unconvertible.
   */
  function expenseEffect(group, e) {
    const total = toBaseMinor(group, e.amount, e.cur);
    if (total == null) return null;
    const paid = { [e.payer]: total };
    let owed;
    if (e.kind === 'transfer') {
      owed = { [e.to]: total };
    } else {
      const order = group.members.map((m) => m.id);
      const parts = e.split && e.split.parts ? e.split.parts : {};
      const weights = order.filter((id) => parts[id] > 0).map((id) => [id, Number(parts[id])]);
      owed = allocate(total, weights);
      // No valid participants: treat as the payer's own expense so the ledger stays balanced.
      if (!Object.keys(owed).length) owed = { [e.payer]: total };
    }
    return { paid, owed, total };
  }

  /**
   * Balances: positive = others owe this member; negative = member owes.
   * Also returns paid (cash out of pocket) and consumed (fair share) per member.
   */
  function balances(group) {
    const bal = {}, paid = {}, consumed = {};
    for (const m of group.members) { bal[m.id] = 0; paid[m.id] = 0; consumed[m.id] = 0; }
    const missingRates = new Set();
    for (const e of liveExpenses(group)) {
      const fx = expenseEffect(group, e);
      if (!fx) { missingRates.add(e.cur); continue; }
      for (const [id, v] of Object.entries(fx.paid)) {
        bal[id] = (bal[id] || 0) + v;
        if (e.kind !== 'transfer') paid[id] = (paid[id] || 0) + v;
      }
      for (const [id, v] of Object.entries(fx.owed)) {
        bal[id] = (bal[id] || 0) - v;
        if (e.kind !== 'transfer') consumed[id] = (consumed[id] || 0) + v;
      }
    }
    return { bal, paid, consumed, missingRates: [...missingRates] };
  }

  /**
   * Minimal-ish settlement plan: greedily match the largest debtor with the
   * largest creditor. Produces at most n-1 transfers.
   * @returns {Array<{from, to, amount}>} amounts in base minor units
   */
  function settle(bal) {
    const cred = [], debt = [];
    for (const [id, v] of Object.entries(bal)) {
      if (v > 0) cred.push({ id, v });
      else if (v < 0) debt.push({ id, v: -v });
    }
    const plan = [];
    // First pass: exact matches avoid needless chains.
    for (const d of debt) {
      const c = cred.find((x) => x.v === d.v && x.v > 0);
      if (c && d.v > 0) { plan.push({ from: d.id, to: c.id, amount: d.v }); c.v = 0; d.v = 0; }
    }
    for (;;) {
      cred.sort((a, b) => b.v - a.v);
      debt.sort((a, b) => b.v - a.v);
      const c = cred[0], d = debt[0];
      if (!c || !d || c.v === 0 || d.v === 0) break;
      const x = Math.min(c.v, d.v);
      plan.push({ from: d.id, to: c.id, amount: x });
      c.v -= x; d.v -= x;
    }
    return plan;
  }

  /* ---------- merge (offline-first, last-writer-wins per record) ---------- */

  function mergeList(a, b) {
    const map = new Map();
    for (const x of a) map.set(x.id, x);
    let added = 0, updated = 0, localNewer = 0;
    const remote = new Map(b.map((y) => [y.id, y]));
    for (const x of a) {
      const y = remote.get(x.id);
      if (y ? (x.t || 0) > (y.t || 0) : !x.del) localNewer++;
    }
    for (const y of b) {
      const x = map.get(y.id);
      if (!x) { map.set(y.id, y); if (!y.del) added++; }
      else if ((y.t || 0) > (x.t || 0)) { map.set(y.id, y); updated++; }
    }
    // keep original order for stable member ordering; new items appended
    const order = [...a.map((x) => x.id), ...b.map((y) => y.id)];
    const seen = new Set();
    const list = [];
    for (const id of order) if (!seen.has(id)) { seen.add(id); list.push(map.get(id)); }
    return { list, added, updated, localNewer };
  }

  /** Latest edit time anywhere in the group; used to detect unshared changes. */
  function stamp(g) {
    let t = g.t || 0;
    for (const x of g.members) t = Math.max(t, x.t || 0);
    for (const x of g.expenses) t = Math.max(t, x.t || 0);
    for (const r of Object.values(g.rates || {})) t = Math.max(t, (r && r.t) || 0);
    return t;
  }

  /**
   * Merge two copies of the same group. Commutative on content.
   * @returns {{group, stats:{expensesAdded, expensesUpdated, membersAdded}}}
   */
  function merge(local, remote) {
    if (local.id !== remote.id) throw new Error('不同群組無法合併');
    const meta = (remote.t || 0) > (local.t || 0) ? remote : local;
    // Rates are relative to a base currency: only take them from copies that share the winning base.
    const rates = {};
    for (const src of [local, remote]) {
      if (src.base !== meta.base) continue;
      for (const [cur, r] of Object.entries(src.rates || {})) {
        if (!r || cur === meta.base) continue;
        if (!rates[cur] || (r.t || 0) > (rates[cur].t || 0)) rates[cur] = r;
      }
    }
    const m = mergeList(local.members, remote.members);
    const e = mergeList(local.expenses, remote.expenses);
    return {
      group: { ...local, name: meta.name, base: meta.base, t: meta.t, rates, members: m.list, expenses: e.list },
      stats: {
        expensesAdded: e.added, expensesUpdated: e.updated, membersAdded: m.added,
        // records only this device has (or edited later): the other side is missing them
        localNewer: e.localNewer + m.localNewer,
      },
    };
  }

  /* ---------- link encoding ---------- */

  function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const MAX_DECODED = 4 * 1024 * 1024; // guard against decompression bombs
  async function pipe(bytes, stream) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_DECODED) { reader.cancel(); throw new Error('資料過大'); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /** Strip local-only fields and tombstones older than 90 days to keep links short. */
  function packable(group) {
    const cutoff = now() - 90 * 864e5;
    const keep = (x) => !x.del || (x.t || 0) > cutoff;
    return { ...group, members: group.members.filter(keep), expenses: group.expenses.filter(keep), me: undefined };
  }

  /*
   * Compact wire format (v2). Random ids are incompressible, so members are
   * referenced by index, timestamps become base36 offsets from the oldest one,
   * dates become day numbers, and equal splits become a bitmask.
   */
  const DAY0 = Date.UTC(2020, 0, 1);
  const dateToNum = (d) => { const x = Date.parse(d + 'T00:00:00Z'); return d && Number.isFinite(x) ? Math.round((x - DAY0) / 864e5) : null; };
  const numToDate = (n) => (typeof n !== 'number' || !Number.isFinite(n) ? '' : new Date(DAY0 + n * 864e5).toISOString().slice(0, 10));

  function pack(group) {
    const g = packable(group);
    const ts = [g.t, ...g.members.map((m) => m.t), ...g.expenses.map((e) => e.t), ...Object.values(g.rates).map((r) => r.t)]
      .filter(Number.isFinite);
    const t0 = ts.length ? Math.min(...ts) : 0;
    const T = (t) => Math.max(0, (t || t0) - t0).toString(36);
    const idx = new Map(g.members.map((m, i) => [m.id, i]));
    const curs = [g.base];
    const ci = (c) => { let i = curs.indexOf(c); if (i < 0) { i = curs.length; curs.push(c); } return i; };
    const rates = Object.entries(g.rates).map(([c, r]) => [ci(c), r.r, T(r.t)]);
    const e = g.expenses.map((x) => {
      if (x.del) return [x.id, T(x.t)];
      const base = [x.id, T(x.t), x.kind === 'transfer' ? 1 : 0, x.amount, ci(x.cur), idx.get(x.payer) ?? -1, dateToNum(x.date)];
      if (x.kind === 'transfer') return [...base, idx.get(x.to) ?? -1];
      const parts = (x.split && x.split.parts) || {};
      const mode = x.split ? ['equal', 'shares', 'exact'].indexOf(x.split.mode) : 0;
      let p;
      if (mode <= 0 && g.members.length <= 50) p = g.members.reduce((mask, m, i) => (parts[m.id] > 0 ? mask + 2 ** i : mask), 0);
      else p = g.members.map((m) => Number(parts[m.id]) || 0);
      return [...base, x.title || '', x.cat || 'other', Math.max(0, mode), p];
    });
    return {
      v: 2, i: g.id, n: g.name, t0, t: T(g.t), c: curs, r: rates,
      // [id, name, t, del?, pay?] — trailing defaults dropped
      m: g.members.map((m) => {
        const a = [m.id, m.name, T(m.t), m.del ? 1 : 0, m.pay || ''];
        while (a.length > 3 && !a[a.length - 1]) a.pop();
        return a;
      }),
      e,
    };
  }

  function unpack(p) {
    const T = (s) => p.t0 + parseInt(s, 36);
    const members = p.m.map(([id, name, t, del, pay]) => {
      const m = { id, name, t: T(t) };
      if (del === 1) m.del = true;
      if (pay) m.pay = pay;
      return m;
    });
    const mid = (i) => (members[i] || {}).id;
    const rates = {};
    for (const [c, r, t] of p.r) rates[p.c[c]] = { r, t: T(t) };
    const expenses = p.e.map((a) => {
      if (a.length === 2) return { id: a[0], t: T(a[1]), del: true, amount: 0, cur: p.c[0] };
      const [id, t, kind, amount, cur, payer, day] = a;
      const x = { id, t: T(t), amount, cur: p.c[cur], payer: mid(payer), date: numToDate(day) };
      if (kind === 1) return { ...x, kind: 'transfer', title: '', to: mid(a[7]) };
      const [, , , , , , , title, cat, mode, bits] = a;
      const parts = {};
      if (mode === 0 && !Array.isArray(bits)) members.forEach((m, i) => { if (Math.floor(bits / 2 ** i) % 2) parts[m.id] = 1; });
      else members.forEach((m, i) => { if (bits[i] > 0) parts[m.id] = bits[i]; });
      return { ...x, title, cat, split: { mode: ['equal', 'shares', 'exact'][mode], parts } };
    });
    return { v: 1, id: p.i, name: p.n, base: p.c[0], t: T(p.t), rates, members, expenses };
  }

  async function encode(group) {
    const json = new TextEncoder().encode(JSON.stringify(pack(group)));
    if (typeof CompressionStream !== 'undefined') {
      return 'z' + b64urlEncode(await pipe(json, new CompressionStream('deflate-raw')));
    }
    return 'j' + b64urlEncode(json);
  }

  async function decode(str) {
    const kind = str[0];
    const bytes = b64urlDecode(str.slice(1));
    let json;
    if (kind === 'z') json = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (kind === 'j') json = bytes;
    else throw new Error('無法辨識的連結格式');
    let g = JSON.parse(new TextDecoder().decode(json));
    if (g && g.v === 2) g = unpack(g);
    return validate(g);
  }

  /*
   * Link data is untrusted: rebuild the group from whitelisted, type-checked
   * fields only, so nothing malformed can reach the UI or break the math.
   */
  const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const CUR_RE = /^[A-Z]{3}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const isId = (x) => typeof x === 'string' && ID_RE.test(x) && x !== '__proto__';
  const isCur = (x) => typeof x === 'string' && CUR_RE.test(x);
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x));
  const finitePos = (x, max) => { const n = num(x); return Number.isFinite(n) && n > 0 && n < max ? n : null; };
  const ts = (x) => { const n = num(x); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
  const str = (x, max) => (typeof x === 'string' || typeof x === 'number' ? String(x).slice(0, max) : '');

  function validate(g) {
    if (!g || typeof g !== 'object' || !isId(g.id) || !Array.isArray(g.members) || !Array.isArray(g.expenses)) {
      throw new Error('群組資料不完整');
    }
    const base = Object.prototype.hasOwnProperty.call(CURRENCIES, g.base) ? g.base : 'TWD';
    const rates = {};
    if (g.rates && typeof g.rates === 'object') {
      for (const [c, r] of Object.entries(g.rates)) {
        const v = r && finitePos(r.r, 1e9);
        if (isCur(c) && c !== base && v) rates[c] = { r: v, t: ts(r.t) };
      }
    }
    const seen = new Set();
    const members = [];
    for (const m of g.members) {
      if (!m || !isId(m.id) || seen.has(m.id)) continue;
      seen.add(m.id);
      const x = { id: m.id, name: str(m.name, 40).trim() || '?', t: ts(m.t) };
      if (m.del) x.del = true;
      const pay = str(m.pay, 80).trim();
      if (pay) x.pay = pay;
      members.push(x);
    }
    const isMember = (id) => seen.has(id);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    const expenses = [];
    const eseen = new Set();
    for (const e of g.expenses) {
      if (!e || !isId(e.id) || eseen.has(e.id)) continue;
      eseen.add(e.id);
      if (e.del) { expenses.push({ id: e.id, t: ts(e.t), del: true, amount: 0, cur: base }); continue; }
      const amount = finitePos(e.amount, 1e12);
      if (!amount || !isCur(e.cur) || !isMember(e.payer)) continue;
      const x = {
        id: e.id, t: ts(e.t), amount, cur: e.cur, payer: e.payer,
        date: typeof e.date === 'string' && DATE_RE.test(e.date) ? e.date : '',
        title: str(e.title, 60),
      };
      if (e.kind === 'transfer') {
        if (!isMember(e.to)) continue;
        expenses.push({ ...x, kind: 'transfer', to: e.to });
        continue;
      }
      const mode = e.split && ['equal', 'shares', 'exact'].includes(e.split.mode) ? e.split.mode : 'equal';
      const parts = {};
      const rawParts = (e.split && e.split.parts && typeof e.split.parts === 'object') ? e.split.parts : {};
      for (const [id, w] of Object.entries(rawParts)) {
        const v = finitePos(w, 1e12);
        if (isMember(id) && v) parts[id] = mode === 'equal' ? 1 : v;
      }
      expenses.push({ ...x, cat: cats.has(e.cat) ? e.cat : 'other', split: { mode, parts } });
    }
    return { v: 1, id: g.id, name: str(g.name, 40).trim() || '未命名群組', base, t: ts(g.t), rates, members, expenses };
  }

  /* ---------- formatting ---------- */

  function fmtMinor(minor, cur) {
    const d = decimalsOf(cur);
    const v = minor / 10 ** d;
    const s = Math.abs(v).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sym = Object.prototype.hasOwnProperty.call(CURRENCIES, cur) ? CURRENCIES[cur] : (isCur(cur) ? cur + ' ' : '');
    return (v < 0 ? '-' : '') + sym + s;
  }
  function fmtAmount(amount, cur) {
    return fmtMinor(Math.round(amount * 10 ** decimalsOf(cur)), cur);
  }

  function summaryText(group) {
    const { bal } = balances(group);
    const plan = settle(bal);
    const name = (id) => (group.members.find((m) => m.id === id) || {}).name || '?';
    const total = liveExpenses(group).filter((e) => e.kind !== 'transfer')
      .reduce((s, e) => s + (toBaseMinor(group, e.amount, e.cur) || 0), 0);
    const lines = [`【${group.name}】分帳結算`, `總花費 ${fmtMinor(total, group.base)}`, ''];
    if (!plan.length) lines.push('✅ 大家都已經結清了！');
    else for (const p of plan) lines.push(`${name(p.from)} → ${name(p.to)}  ${fmtMinor(p.amount, group.base)}`);
    const payees = payeesWithInfo(group, plan);
    if (payees.length) {
      lines.push('', '💳 收款資訊');
      for (const m of payees) lines.push(`${m.name}：${m.pay}`);
    }
    return lines.join('\n');
  }

  /** Members who receive money in `plan` and have payment info, in plan order. */
  function payeesWithInfo(group, plan) {
    const out = [];
    for (const p of plan) {
      const m = group.members.find((x) => x.id === p.to);
      if (m && m.pay && !out.includes(m)) out.push(m);
    }
    return out;
  }

  function toCSV(group) {
    const name = (id) => (group.members.find((m) => m.id === id) || {}).name || '';
    const esc = (v) => { let s = String(v ?? ''); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['日期', '項目', '類別', '金額', '幣別', `換算(${group.base})`, '付款人', '分攤']];
    for (const e of liveExpenses(group)) {
      const fx = expenseEffect(group, e);
      const cat = e.kind === 'transfer' ? '還款' : (CATEGORIES.find((c) => c.id === e.cat) || CATEGORIES[7]).label;
      const shares = fx ? Object.entries(fx.owed).map(([id, v]) => `${name(id)}:${v / 10 ** decimalsOf(group.base)}`).join(' ') : '';
      rows.push([e.date, e.title, cat, e.amount, e.cur, fx ? fx.total / 10 ** decimalsOf(group.base) : '', name(e.payer), shares]);
    }
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  return {
    CURRENCIES, CATEGORIES, decimalsOf, uid, now, newGroup, allocate, rateOf, toBaseMinor,
    expenseEffect, balances, settle, merge, encode, decode, pack, unpack, validate, liveMembers, liveExpenses,
    fmtMinor, fmtAmount, summaryText, toCSV, stamp, payeesWithInfo,
  };
});
