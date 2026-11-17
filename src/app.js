/* SplitLink UI — vanilla JS, no build step. Depends on window.SL (core.js). */
(() => {
  'use strict';
  const SL = window.SL;
  // Embedded/sandboxed hosts can't carry #g= links or start downloads: use share codes + clipboard instead.
  const EMBED = !!window.SPLITLINK_EMBED;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toLocaleDateString('sv');
  const catOf = (id) => SL.CATEGORIES.find((c) => c.id === id) || SL.CATEGORIES[SL.CATEGORIES.length - 1];

  /* ---------------- storage ---------------- */
  const LS_KEY = 'splitlink:v1';
  let db = loadDb();
  function loadDb() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY));
      if (d && d.groups) {
        const groups = {};
        for (const g of Object.values(d.groups)) { try { const v = SL.validate(g); groups[v.id] = v; } catch {} }
        return { me: {}, opened: {}, shared: {}, ...d, groups };
      }
    } catch {}
    return { groups: {}, me: {}, opened: {}, shared: {} };
  }
  let warnedStorage = false;
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch {
      if (!warnedStorage) { warnedStorage = true; toast('⚠️ 瀏覽器不允許儲存，關閉頁面前請先分享連結備份'); }
    }
  }
  function saveGroup(g) { db.groups[g.id] = g; persist(); render(); }

  /* ---------------- view state ---------------- */
  const view = { gid: null, tab: 'list' };
  const G = () => db.groups[view.gid];
  const meOf = (g) => { const id = db.me[g.id]; return g.members.some((m) => m.id === id && !m.del) ? id : null; };
  const nameOf = (g, id) => (g.members.find((m) => m.id === id) || {}).name || '（已移除）';

  function openGroup(id, tab = 'list') {
    view.gid = id; view.tab = tab;
    db.opened[id] = Date.now(); db.last = id; persist();
    render(); window.scrollTo(0, 0);
    const g = G();
    if (g && !meOf(g) && SL.liveMembers(g).length) setTimeout(() => whoAmISheet(g), 150);
  }
  function goHome() { view.gid = null; db.last = null; persist(); render(); window.scrollTo(0, 0); }

  /* ---------------- toast / clipboard ---------------- */
  let toastTimer;
  function toast(msg, ms = 2600) {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), ms);
  }
  function markShared(g) {
    db.shared[g.id] = SL.stamp(g); persist();
    const dot = $('.share-btn .dot'); if (dot) dot.remove();
  }
  async function copy(text, okMsg = '已複製') {
    try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch {}
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch { toast('複製失敗，請手動選取'); }
    ta.remove();
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------- sheet (modal) ---------------- */
  function sheet(title, bodyHtml, mount) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="關閉">✕</button></div>
      <div class="sheet-b">${bodyHtml}</div></div>`;
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
    scrim.querySelector('[data-close]').onclick = closeSheet;
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';
    const body = scrim.querySelector('.sheet-b');
    if (mount) mount(body);
    const first = body.querySelector('[autofocus]');
    if (first && matchMedia('(min-width: 700px)').matches) first.focus();
    return body;
  }
  function closeSheet() {
    $$('.scrim').forEach((s) => s.remove());
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  function confirmSheet(title, msg, okLabel, onOk, danger) {
    sheet(title, `<p>${esc(msg)}</p><div class="btns" style="justify-content:flex-end;margin-top:16px">
      <button class="btn" data-no>取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`, (b) => {
      b.querySelector('[data-no]').onclick = closeSheet;
      b.querySelector('[data-ok]').onclick = () => { closeSheet(); onOk(); };
    });
  }

  /* ---------------- render root ---------------- */
  function render() {
    const app = $('#app');
    if (view.gid && !G()) view.gid = null;
    app.innerHTML = view.gid ? groupView(G()) : homeView();
  }

  /* ---------------- home ---------------- */
  function groupTotal(g) {
    return SL.liveExpenses(g).filter((e) => e.kind !== 'transfer')
      .reduce((s, e) => s + (SL.toBaseMinor(g, e.amount, e.cur) || 0), 0);
  }

  function homeView() {
    const gs = Object.values(db.groups).sort((a, b) => (db.opened[b.id] || 0) - (db.opened[a.id] || 0));
    const cards = gs.map((g) => {
      const me = meOf(g);
      let right = `<span class="muted small">${SL.liveMembers(g).length} 人</span>`;
      if (me) {
        const v = SL.balances(g).bal[me] || 0;
        right = v === 0 ? '<span class="muted small">已結清</span>'
          : `<span class="small ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '應收' : '應付'}<br><b class="num">${SL.fmtMinor(Math.abs(v), g.base)}</b></span>`;
      }
      return `<button class="item" data-act="open" data-id="${esc(g.id)}">
        <div class="ico">${esc((g.name || '?').trim().slice(0, 1))}</div>
        <div class="grow"><div class="ellipsis"><b>${esc(g.name)}</b></div>
        <div class="muted small ellipsis">${esc(SL.liveMembers(g).map((m) => m.name).join('、'))} · 共 ${SL.fmtMinor(groupTotal(g), g.base)}</div></div>
        <div class="amt">${right}</div></button>`;
    }).join('');

    return `
    <header class="top"><div class="top-in"><h1>🔗 SplitLink <span class="muted" style="font-weight:500">分帳連結</span></h1><span class="grow"></span>
      <button class="icon-btn" data-act="theme" aria-label="切換深淺色">◐</button></div></header>
    <main class="wrap">
      ${gs.length ? '' : `<section class="hero"><h2>出遊、室友、聚餐，<br>一條連結就能分帳。</h2>
        <p>不用註冊、不用下載 App、沒有每日筆數限制。資料只存在你的手機和分享連結裡。</p></section>
        <div class="feats">
          <div class="feat"><b>🔗 連結即資料</b>整個帳本壓縮進網址，丟到 LINE 群組大家就能看。</div>
          <div class="feat"><b>🔀 離線各記各的</b>每個人都能自己記帳，再把連結傳回來就會自動合併。</div>
          <div class="feat"><b>🧮 最少轉帳次數</b>自動算出誰該付誰，n 個人最多 n−1 筆轉帳。</div>
          <div class="feat"><b>💱 多幣別</b>日圓、韓元、美金混著記，依匯率換算成主幣別。</div>
        </div>`}
      <div class="btns" style="margin:16px 0">
        <button class="btn primary" data-act="new-group">＋ 建立新群組</button>
        <button class="btn" data-act="import">貼上連結加入</button>
        ${gs.length ? '' : '<button class="btn" data-act="demo">看範例</button>'}
        ${canOfferInstall() ? '<button class="btn" data-act="install">📲 加到主畫面</button>' : ''}
      </div>
      ${gs.length ? `<div class="day">我的群組</div><div class="list">${cards}</div>` : ''}
      <footer class="foot">資料只存在這台裝置的瀏覽器中，清除瀏覽資料前請先分享連結備份。</footer>
    </main>`;
  }

  function newGroupSheet() {
    const opts = Object.keys(SL.CURRENCIES).map((c) => `<option value="${c}">${c} ${esc(SL.CURRENCIES[c])}</option>`).join('');
    sheet('建立新群組', `
      <label class="f"><span>群組名稱</span><input class="in" id="ng-name" placeholder="例如：東京五日遊、301 室友" maxlength="40" autofocus></label>
      <label class="f"><span>成員（用逗號、空白或換行分隔，第一位是你）</span><textarea class="in" id="ng-mem" placeholder="小明, 小華, 阿傑"></textarea></label>
      <label class="f"><span>主幣別（結算用）</span><select class="in" id="ng-cur">${opts}</select></label>
      <div class="err" id="ng-err"></div>
      <button class="btn primary block" id="ng-ok">建立</button>`, (b) => {
      b.querySelector('#ng-ok').onclick = () => {
        const name = $('#ng-name', b).value.trim();
        const mems = [...new Set($('#ng-mem', b).value.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean))];
        if (!name) return ($('#ng-err', b).textContent = '請輸入群組名稱');
        if (mems.length < 2) return ($('#ng-err', b).textContent = '至少需要 2 位成員');
        const g = SL.newGroup(name, $('#ng-cur', b).value, mems);
        db.groups[g.id] = g; db.me[g.id] = g.members[0].id; persist();
        closeSheet(); openGroup(g.id);
        setTimeout(() => toast('群組已建立！記完帳按右上角「分享」傳給朋友'), 300);
      };
    });
  }

  function importSheet() {
    sheet('加入／合併群組', `
      <p class="muted small" style="margin-top:0">貼上朋友傳來的 SplitLink 連結或分享碼。如果你已經有這個群組，會自動合併雙方的紀錄。</p>
      <textarea class="in" id="im-text" placeholder="https://…#g=z… 或 z…" autofocus></textarea>
      <div class="err" id="im-err"></div>
      <div class="btns"><button class="btn primary" id="im-ok">匯入</button><button class="btn" id="im-file">從 JSON 檔匯入</button></div>
      <input type="file" id="im-input" accept=".json,application/json" class="hidden">`, (b) => {
      b.querySelector('#im-ok').onclick = async () => {
        const raw = $('#im-text', b).value.trim();
        const m = raw.match(/[#&?]g=([A-Za-z0-9_-]+)/);
        const code = m ? m[1] : raw.replace(/\s+/g, '');
        try { importGroup(raw.startsWith('{') ? SL.validate(JSON.parse(raw)) : await SL.decode(code)); closeSheet(); } catch (e) { $('#im-err', b).textContent = '無法讀取：' + (e.message || '格式錯誤'); }
      };
      b.querySelector('#im-file').onclick = () => $('#im-input', b).click();
      b.querySelector('#im-input').onchange = async (ev) => {
        try { importGroup(SL.validate(JSON.parse(await ev.target.files[0].text()))); closeSheet(); } catch (e) { $('#im-err', b).textContent = '檔案格式錯誤'; }
      };
    });
  }

  function importGroup(remote) {
    const local = db.groups[remote.id];
    if (local) {
      const { group, stats } = SL.merge(local, remote);
      db.groups[group.id] = group;
      if (!stats.localNewer) db.shared[group.id] = SL.stamp(group);
      persist();
      const n = stats.expensesAdded + stats.expensesUpdated + stats.membersAdded;
      openGroup(group.id);
      const got = n ? `🔀 已合併：新增 ${stats.expensesAdded} 筆、更新 ${stats.expensesUpdated} 筆${stats.membersAdded ? `、新成員 ${stats.membersAdded} 位` : ''}` : '✅ 對方的紀錄你都有了';
      toast(stats.localNewer ? `${got}。你有 ${stats.localNewer} 筆對方還沒有，記得把你的連結傳回去` : got, stats.localNewer ? 5000 : undefined);
    } else {
      db.groups[remote.id] = remote; db.shared[remote.id] = SL.stamp(remote); persist();
      openGroup(remote.id);
      toast(`已加入「${remote.name}」`);
    }
  }

  function demoGroup() {
    const g = SL.newGroup('東京五日遊（範例）', 'TWD', ['小明', '小華', '阿傑', 'Amy']);
    const [a, b, c, d] = g.members.map((m) => m.id);
    g.rates.JPY = { r: 0.212, t: SL.now() };
    g.members[0].pay = '範例銀行 000-1234567890（請改成你的帳號）';
    const all = { [a]: 1, [b]: 1, [c]: 1, [d]: 1 };
    const add = (title, amount, cur, payer, cat, parts, date, mode = 'equal') =>
      g.expenses.push({ id: SL.uid(), t: SL.now(), title, amount, cur, payer, cat, date, split: { mode, parts } });
    add('機票 ×4', 38400, 'TWD', a, 'transport', all, '2026-11-01');
    add('新宿飯店 4 晚', 96000, 'JPY', b, 'stay', all, '2026-11-02');
    add('一蘭拉麵', 4920, 'JPY', c, 'food', all, '2026-11-02');
    add('Suica 儲值', 8000, 'JPY', d, 'transport', all, '2026-11-02');
    add('迪士尼門票', 37600, 'JPY', a, 'fun', { [a]: 1, [b]: 1, [d]: 1 }, '2026-11-03');
    add('燒肉（阿傑吃兩人份）', 18000, 'JPY', b, 'food', { [a]: 1, [b]: 1, [c]: 2, [d]: 1 }, '2026-11-04', 'shares');
    add('藥妝', 12000, 'JPY', d, 'shop', { [d]: 9000, [b]: 3000 }, '2026-11-05', 'exact');
    g.expenses.push({ id: SL.uid(), t: SL.now(), kind: 'transfer', amount: 2000, cur: 'TWD', payer: c, to: a, date: '2026-11-05', title: '' });
    db.groups[g.id] = g; db.me[g.id] = a; persist();
    openGroup(g.id);
  }

  /* ---------------- group view ---------------- */
  const TABS = [['list', '帳目'], ['settle', '結算'], ['stats', '統計'], ['settings', '設定']];

  function groupView(g) {
    const me = meOf(g);
    const tabs = TABS.map(([id, l]) => `<button class="tab ${view.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${l}</button>`).join('');
    let body = '';
    if (view.tab === 'list') body = listTab(g, me);
    else if (view.tab === 'settle') body = settleTab(g, me);
    else if (view.tab === 'stats') body = statsTab(g, me);
    else body = settingsTab(g, me);
    return `
    <header class="top"><div class="top-in">
      <button class="icon-btn" data-act="home" aria-label="返回">←</button>
      <h1 class="grow ellipsis">${esc(g.name)}</h1>
      <button class="btn sm primary share-btn" data-act="share">分享連結${SL.stamp(g) > (db.shared[g.id] || 0) && SL.liveExpenses(g).length ? '<span class="dot" title="有還沒分享出去的變更"></span>' : ''}</button></div>
      <nav class="tabs">${tabs}</nav></header>
    <main class="wrap">${body}</main>
    ${view.tab === 'list' ? '<button class="fab" data-act="add">＋ 記一筆</button>' : ''}`;
  }

  function meBar(g, me) {
    return `<div class="mebar small muted">我是：<button class="chip on" data-act="who">${esc(me ? nameOf(g, me) : '選擇身分')} ▾</button></div>`;
  }

  function missingBanner(g, missing) {
    return missing.length ? `<div class="banner">⚠️ ${esc(missing.join('、'))} 尚未設定匯率，這些帳目暫不計入。<button class="btn sm" data-act="tab" data-tab="settings" style="margin-left:6px">去設定</button></div>` : '';
  }

  function listTab(g, me) {
    const { bal, paid, consumed, missingRates } = SL.balances(g);
    const total = Object.values(consumed).reduce((s, v) => s + v, 0);
    const exps = SL.liveExpenses(g).slice().sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.t || 0) - (x.t || 0));
    let head = `<div class="summary">
      <div class="stat"><div class="k">群組總花費</div><div class="v num">${SL.fmtMinor(total, g.base)}</div></div>`;
    if (me) {
      const v = bal[me] || 0;
      head += `<div class="stat"><div class="k">${v > 0 ? '別人欠我' : v < 0 ? '我還欠' : '我的狀態'}</div>
        <div class="v num ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v === 0 ? '已結清 ✓' : SL.fmtMinor(Math.abs(v), g.base)}</div>
        <div class="k">我付了 ${SL.fmtMinor(paid[me] || 0, g.base)} · 我的份 ${SL.fmtMinor(consumed[me] || 0, g.base)}</div></div>`;
    } else head += `<div class="stat"><div class="k">成員</div><div class="v">${SL.liveMembers(g).length} 人</div></div>`;
    head += '</div>';

    if (!exps.length) {
      return meBar(g, me) + head + `<div class="empty"><div class="big">🧾</div><p>還沒有任何帳目<br>按右下角「記一筆」開始</p></div>`;
    }
    let out = meBar(g, me) + head + missingBanner(g, missingRates);
    let lastDay = null, buf = '';
    const flush = () => { if (buf) out += `<div class="list">${buf}</div>`; buf = ''; };
    for (const e of exps) {
      if (e.date !== lastDay) { flush(); lastDay = e.date; out += `<div class="day">${esc(fmtDay(e.date))}</div>`; }
      buf += expenseRow(g, e, me);
    }
    flush();
    return out;
  }

  function fmtDay(d) {
    if (!d) return '未填日期';
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return d;
    const wd = '日一二三四五六'[dt.getDay()];
    return `${dt.getMonth() + 1} 月 ${dt.getDate()} 日（${wd}）${d === today() ? '· 今天' : ''}`;
  }

  function expenseRow(g, e, me) {
    const fx = SL.expenseEffect(g, e);
    let right = '';
    if (me && fx) {
      const net = (fx.paid[me] || 0) - (fx.owed[me] || 0);
      if (e.kind === 'transfer') right = net ? `<b class="num">${SL.fmtMinor(Math.abs(net), g.base)}</b><span class="muted small">${net > 0 ? '我付出' : '我收到'}</span>` : '';
      else right = net > 0 ? `<span class="small pos">借出</span><b class="num pos">${SL.fmtMinor(net, g.base)}</b>`
        : net < 0 ? `<span class="small neg">我的份</span><b class="num neg">${SL.fmtMinor(-net, g.base)}</b>`
          : '<span class="small muted">未參與</span>';
    } else if (!fx) right = '<span class="small neg">缺匯率</span>';
    if (e.kind === 'transfer') {
      return `<button class="item" data-act="edit" data-id="${esc(e.id)}"><div class="ico">💸</div>
        <div class="grow"><div class="ellipsis">${esc(nameOf(g, e.payer))} 還給 ${esc(nameOf(g, e.to))}</div>
        <div class="muted small">${SL.fmtAmount(e.amount, e.cur)}</div></div><div class="amt">${right}</div></button>`;
    }
    const n = fx ? Object.keys(fx.owed).length : 0;
    return `<button class="item" data-act="edit" data-id="${esc(e.id)}"><div class="ico">${catOf(e.cat).icon}</div>
      <div class="grow"><div class="ellipsis">${esc(e.title || catOf(e.cat).label)}</div>
      <div class="muted small ellipsis">${esc(nameOf(g, e.payer))} 付了 ${SL.fmtAmount(e.amount, e.cur)}${n ? ` · ${n} 人分` : ''}</div></div>
      <div class="amt">${right}</div></button>`;
  }

  function settleTab(g, me) {
    const { bal, missingRates } = SL.balances(g);
    const plan = SL.settle({ ...bal });
    const maxAbs = Math.max(1, ...Object.values(bal).map(Math.abs));
    const rows = SL.liveMembers(g).map((m) => {
      const v = bal[m.id] || 0;
      const w = (Math.abs(v) / maxAbs) * 50;
      return `<div style="margin:10px 0"><div class="row"><span class="grow">${esc(m.name)}${m.id === me ? ' <span class="muted small">（我）</span>' : ''}</span>
        <b class="num ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v === 0 ? '0' : (v > 0 ? '+' : '−') + SL.fmtMinor(Math.abs(v), g.base)}</b></div>
        <div class="dbar"><i class="${v >= 0 ? 'p' : 'n'}" style="width:${w}%"></i></div></div>`;
    }).join('');
    const planHtml = plan.length ? plan.map((p, i) => {
      const mine = p.from === me || p.to === me;
      const to = g.members.find((m) => m.id === p.to) || {};
      const pay = to.pay ? `<button class="paychip" data-act="copy-pay" data-id="${esc(to.id)}" title="複製收款資訊">💳 ${esc(to.pay)}</button>` : '';
      return `<div class="item" style="${mine ? 'background:var(--accent-soft)' : ''}">
        <div class="grow"><b>${esc(nameOf(g, p.from))}</b> <span class="muted">→</span> <b>${esc(nameOf(g, p.to))}</b>
        <div class="num" style="font-size:18px;font-weight:650">${SL.fmtMinor(p.amount, g.base)}</div>${pay}</div>
        <button class="btn sm" data-act="paid" data-i="${i}">已還款</button></div>`;
    }).join('') : '<div class="empty" style="padding:24px"><div class="big">🎉</div><p>大家都結清了！</p></div>';
    return meBar(g, me) + missingBanner(g, missingRates) + `
      <div class="card"><h3>每個人的餘額</h3><div class="muted small">＋ 代表別人欠他，− 代表他該付錢</div>${rows}</div>
      <div class="day">建議轉帳（${plan.length} 筆就能結清）</div>
      <div class="list">${planHtml}</div>
      <div class="btns" style="margin-top:14px">
        <button class="btn primary" data-act="settle-image">📷 結算圖片</button>
        <button class="btn" data-act="copy-summary">複製結算文字</button>
        <button class="btn" data-act="add-transfer">手動記一筆還款</button></div>
      ${plan.length && !SL.payeesWithInfo(g, plan).length ? '<p class="muted small">💡 到「設定 → 成員」填上收款帳號，結算時就會顯示給要付錢的人。</p>' : ''}`;
  }

  function statsTab(g, me) {
    const { paid, consumed } = SL.balances(g);
    const byCat = {};
    let total = 0;
    for (const e of SL.liveExpenses(g)) {
      if (e.kind === 'transfer') continue;
      const v = SL.toBaseMinor(g, e.amount, e.cur);
      if (v == null) continue;
      byCat[e.cat || 'other'] = (byCat[e.cat || 'other'] || 0) + v; total += v;
    }
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxC = Math.max(1, ...cats.map((c) => c[1]));
    const catHtml = cats.length ? cats.map(([id, v]) => `<div style="margin:10px 0"><div class="row"><span class="grow">${catOf(id).icon} ${catOf(id).label}</span>
      <span class="num">${SL.fmtMinor(v, g.base)} <span class="muted small">${Math.round((v / total) * 100)}%</span></span></div>
      <div class="bar"><i style="width:${(v / maxC) * 100}%"></i></div></div>`).join('') : '<p class="muted">還沒有資料</p>';
    const mem = SL.liveMembers(g);
    const maxP = Math.max(1, ...mem.map((m) => Math.max(paid[m.id] || 0, consumed[m.id] || 0)));
    const memHtml = mem.map((m) => `<div style="margin:12px 0"><div class="row"><b class="grow">${esc(m.name)}${m.id === me ? ' <span class="muted small">（我）</span>' : ''}</b></div>
      <div class="row small"><span class="muted" style="width:52px">付出</span><div class="bar grow" style="margin:0"><i style="width:${((paid[m.id] || 0) / maxP) * 100}%"></i></div><span class="num" style="width:96px;text-align:right">${SL.fmtMinor(paid[m.id] || 0, g.base)}</span></div>
      <div class="row small"><span class="muted" style="width:52px">花費</span><div class="bar grow" style="margin:0"><i style="width:${((consumed[m.id] || 0) / maxP) * 100}%;background:var(--muted)"></i></div><span class="num" style="width:96px;text-align:right">${SL.fmtMinor(consumed[m.id] || 0, g.base)}</span></div></div>`).join('');
    const days = new Set(SL.liveExpenses(g).map((e) => e.date).filter(Boolean)).size;
    return `<div class="summary">
      <div class="stat"><div class="k">總花費</div><div class="v num">${SL.fmtMinor(total, g.base)}</div></div>
      <div class="stat"><div class="k">每人平均</div><div class="v num">${SL.fmtMinor(Math.round(total / Math.max(1, mem.length)), g.base)}</div>${days > 1 ? `<div class="k">共 ${days} 天，日均 ${SL.fmtMinor(Math.round(total / days), g.base)}</div>` : ''}</div></div>
      <div class="card"><h3>依類別</h3>${catHtml}</div>
      <div class="card"><h3>每個人</h3><div class="muted small">「付出」是實際掏錢，「花費」是他該負擔的份</div>${memHtml}</div>`;
  }

  function settingsTab(g, me) {
    const used = new Set(SL.liveExpenses(g).map((e) => e.cur));
    for (const c of Object.keys(g.rates)) used.add(c);
    used.delete(g.base);
    const rates = [...used].map((c) => `<div class="split-row"><span class="grow">1 ${c}</span><span class="muted">=</span>
      <input class="in num" type="number" inputmode="decimal" step="any" min="0" data-rate="${c}" value="${g.rates[c] ? g.rates[c].r : ''}" placeholder="匯率"><span class="muted small">${g.base}</span></div>`).join('');
    const opts = Object.keys(SL.CURRENCIES).map((c) => `<option value="${c}" ${c === g.base ? 'selected' : ''}>${c} ${esc(SL.CURRENCIES[c])}</option>`).join('');
    const mems = SL.liveMembers(g).map((m) => `<div class="mem-row"><div class="row"><input class="in grow" data-mname="${esc(m.id)}" value="${esc(m.name)}" maxlength="20" aria-label="成員名稱">
      <button class="icon-btn" data-act="del-member" data-id="${esc(m.id)}" aria-label="移除 ${esc(m.name)}">🗑</button></div>
      <input class="in small" data-mpay="${esc(m.id)}" value="${esc(m.pay || '')}" maxlength="80" placeholder="收款方式（選填）例：國泰 013-1234567890、LINE Pay" aria-label="${esc(m.name)} 的收款方式"></div>`).join('');
    return `
      <div class="card"><h3>群組</h3>
        <label class="f"><span>名稱</span><input class="in" id="st-name" value="${esc(g.name)}" maxlength="40"></label>
        <label class="f"><span>主幣別（結算時使用）</span><select class="in" id="st-base">${opts}</select></label></div>
      <div class="card"><h3>成員</h3><p class="muted small" style="margin:0 0 6px">填了收款方式，結算時就會顯示給要付錢的人。收款方式會包含在分享連結裡。</p>${mems}
        <div class="row" style="margin-top:10px"><input class="in grow" id="st-newmem" placeholder="新增成員名稱" maxlength="20"><button class="btn" data-act="add-member">新增</button></div></div>
      <div class="card"><h3>匯率</h3>${rates || '<p class="muted small">目前只有主幣別。記帳時選擇其他幣別就會出現在這裡。</p>'}
        <div class="btns" style="margin-top:10px">${rates ? `<button class="btn sm" data-act="save-rates">儲存匯率</button>${EMBED ? '' : '<button class="btn sm" data-act="fetch-rates">抓取最新匯率（需網路）</button>'}` : ''}</div></div>
      <div class="card"><h3>備份與匯出</h3><div class="btns">
        <button class="btn sm" data-act="csv">${EMBED ? '複製 CSV' : '匯出 CSV（Excel）'}</button>
        <button class="btn sm" data-act="json">${EMBED ? '複製 JSON 備份' : '下載 JSON 備份'}</button></div></div>
      <div class="card"><h3>危險區域</h3><p class="muted small">只會從這台裝置刪除，不影響其他人手上的連結。</p>
        <button class="btn danger" data-act="del-group">從這台裝置刪除群組</button></div>`;
  }

  /* ---------------- who am I ---------------- */
  function whoAmISheet(g) {
    const btns = SL.liveMembers(g).map((m) => `<button class="chip ${db.me[g.id] === m.id ? 'on' : ''}" data-id="${esc(m.id)}" style="font-size:15px;padding:8px 16px">${esc(m.name)}</button>`).join('');
    sheet('你是哪一位？', `<p class="muted small" style="margin-top:0">選擇後會標出「你欠多少／別人欠你多少」。只存在你的裝置上。</p>
      <div class="mebar" style="gap:10px">${btns}</div>`, (b) => {
      $$('[data-id]', b).forEach((el) => (el.onclick = () => { db.me[g.id] = el.dataset.id; persist(); closeSheet(); render(); }));
    });
  }

  /* ---------------- expense editor ---------------- */
  function expenseSheet(g, existing) {
    const mem = SL.liveMembers(g);
    const me = meOf(g);
    const e = existing ? structuredClone(existing) : null;
    const d = {
      title: e ? e.title || '' : '',
      amount: e ? String(e.amount) : '',
      cur: e ? e.cur : lastCur(g),
      payer: e && mem.some((m) => m.id === e.payer) ? e.payer : me || mem[0].id,
      date: e ? e.date || today() : today(),
      cat: e ? e.cat || 'other' : 'food',
      mode: e && e.split ? e.split.mode : 'equal',
      parts: {},
    };
    for (const m of mem) {
      const p = e && e.split && e.split.parts ? e.split.parts[m.id] : undefined;
      d.parts[m.id] = d.mode === 'equal' ? (e ? !!(p > 0) : true) : p > 0 ? String(p) : '';
    }
    const curs = [...new Set([g.base, ...Object.keys(g.rates), d.cur, ...Object.keys(SL.CURRENCIES)])];
    const curOpts = curs.map((c) => `<option value="${c}" ${c === d.cur ? 'selected' : ''}>${c}</option>`).join('');
    const payerOpts = mem.map((m) => `<option value="${esc(m.id)}" ${m.id === d.payer ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    const cats = SL.CATEGORIES.map((c) => `<button type="button" data-cat="${c.id}" class="${c.id === d.cat ? 'on' : ''}">${c.icon} ${c.label}</button>`).join('');
    const body = sheet(e ? '編輯帳目' : '記一筆', `
      <div class="amtrow" style="margin-top:6px"><input class="in big num" id="ex-amt" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${esc(d.amount)}" autofocus>
        <select class="in" id="ex-cur">${curOpts}</select></div>
      <div id="ex-rate" class="split-hint"></div>
      <label class="f"><span>項目</span><input class="in" id="ex-title" placeholder="例如：晚餐、計程車" maxlength="60" value="${esc(d.title)}"></label>
      <div class="cats">${cats}</div>
      <div class="two"><label class="f"><span>誰付的</span><select class="in" id="ex-payer">${payerOpts}</select></label>
        <label class="f"><span>日期</span><input class="in" id="ex-date" type="date" value="${esc(d.date)}"></label></div>
      <div class="f" style="margin:14px 0 6px"><div class="seg" id="ex-mode">
        <button type="button" data-mode="equal">平分</button><button type="button" data-mode="shares">按份數</button><button type="button" data-mode="exact">指定金額</button></div></div>
      <div id="ex-parts"></div>
      <div class="split-hint muted" id="ex-hint"></div>
      <div class="err" id="ex-err"></div>
      <div class="btns" style="margin-top:8px"><button class="btn primary grow" id="ex-save">${e ? '儲存' : '新增'}</button>
        ${e ? '<button class="btn danger" id="ex-del">刪除</button>' : ''}</div>`);

    const amtMinor = () => Math.round((parseFloat(d.amount) || 0) * 10 ** SL.decimalsOf(d.cur));
    const weights = () => mem.map((m) => [m.id, d.mode === 'equal' ? (d.parts[m.id] ? 1 : 0) : parseFloat(d.parts[m.id]) || 0]);

    function drawRate() {
      const box = $('#ex-rate', body);
      if (d.cur === g.base) { box.innerHTML = ''; return; }
      const r = g.rates[d.cur];
      box.innerHTML = `<div class="row"><span class="muted">匯率 1 ${d.cur} =</span><input class="in num" id="ex-rateval" type="number" step="any" min="0" inputmode="decimal" style="width:110px;padding:6px 8px" value="${r ? r.r : ''}" placeholder="必填"><span class="muted">${g.base}</span></div>`;
      $('#ex-rateval', body).oninput = drawHint;
    }
    function drawParts() {
      $$('#ex-mode button', body).forEach((b) => b.classList.toggle('on', b.dataset.mode === d.mode));
      const box = $('#ex-parts', body);
      box.innerHTML = `<div class="card" style="margin:6px 0;padding:6px 14px">${mem.map((m) => {
        const ctrl = d.mode === 'equal'
          ? `<input type="checkbox" data-p="${esc(m.id)}" ${d.parts[m.id] ? 'checked' : ''} aria-label="${esc(m.name)}">`
          : `<input class="in num" type="number" inputmode="decimal" step="any" min="0" data-p="${esc(m.id)}" value="${esc(d.parts[m.id] === true ? '' : d.parts[m.id] || '')}" placeholder="${d.mode === 'shares' ? '份' : '0'}">`;
        return `<label class="split-row">${d.mode === 'equal' ? ctrl : ''}<span class="grow">${esc(m.name)}</span><span class="muted small num" data-share="${esc(m.id)}"></span>${d.mode === 'equal' ? '' : ctrl}</label>`;
      }).join('')}</div>${d.mode === 'equal' ? '<div class="btns"><button type="button" class="btn sm" id="ex-all">全選</button><button type="button" class="btn sm" id="ex-none">全不選</button></div>' : ''}`;
      $$('[data-p]', box).forEach((inp) => {
        inp.oninput = inp.onchange = () => { d.parts[inp.dataset.p] = inp.type === 'checkbox' ? inp.checked : inp.value; drawHint(); };
      });
      const all = $('#ex-all', box), none = $('#ex-none', box);
      if (all) all.onclick = () => { mem.forEach((m) => (d.parts[m.id] = true)); drawParts(); };
      if (none) none.onclick = () => { mem.forEach((m) => (d.parts[m.id] = false)); drawParts(); };
      drawHint();
    }
    function drawHint() {
      const total = amtMinor();
      const ws = weights();
      const alloc = SL.allocate(total, ws);
      for (const m of mem) {
        const el = $(`[data-share="${CSS.escape(m.id)}"]`, body);
        if (el) el.textContent = alloc[m.id] ? SL.fmtMinor(alloc[m.id], d.cur) : '';
      }
      const hint = $('#ex-hint', body);
      const n = ws.filter(([, w]) => w > 0).length;
      if (d.mode === 'exact') {
        const s = Math.round(ws.reduce((a, [, w]) => a + w, 0) * 10 ** SL.decimalsOf(d.cur));
        const left = total - s;
        hint.innerHTML = left === 0 ? '<span class="pos">✓ 金額剛好分完</span>'
          : `<span class="neg">${left > 0 ? '還有' : '超出'} ${SL.fmtMinor(Math.abs(left), d.cur)} ${left > 0 ? '未分配' : ''}</span>`;
      } else hint.textContent = n ? `${n} 人分攤${d.mode === 'equal' && total ? `，每人約 ${SL.fmtMinor(Math.round(total / n), d.cur)}` : ''}` : '請選擇分攤的人';
      const rateIn = $('#ex-rateval', body);
      if (rateIn && parseFloat(rateIn.value) > 0 && total) {
        hint.innerHTML += ` <span class="muted">· 約 ${SL.fmtMinor(Math.round((total / 10 ** SL.decimalsOf(d.cur)) * parseFloat(rateIn.value) * 10 ** SL.decimalsOf(g.base)), g.base)}</span>`;
      }
    }

    $('#ex-amt', body).oninput = (ev) => { d.amount = ev.target.value; drawHint(); };
    $('#ex-cur', body).onchange = (ev) => { d.cur = ev.target.value; drawRate(); drawHint(); };
    $('#ex-title', body).oninput = (ev) => (d.title = ev.target.value);
    $('#ex-payer', body).onchange = (ev) => (d.payer = ev.target.value);
    $('#ex-date', body).onchange = (ev) => (d.date = ev.target.value);
    $$('.cats button', body).forEach((b) => (b.onclick = () => { d.cat = b.dataset.cat; $$('.cats button', body).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('#ex-mode button', body).forEach((b) => (b.onclick = () => {
      if (d.mode === b.dataset.mode) return;
      const wasEqual = d.mode === 'equal';
      d.mode = b.dataset.mode;
      for (const m of mem) {
        if (d.mode === 'equal') d.parts[m.id] = parseFloat(d.parts[m.id]) > 0 || d.parts[m.id] === true;
        else if (wasEqual) d.parts[m.id] = d.parts[m.id] ? (d.mode === 'shares' ? '1' : '') : '';
        else if (d.mode === 'shares') d.parts[m.id] = parseFloat(d.parts[m.id]) > 0 ? '1' : '';
        else d.parts[m.id] = '';
      }
      // Nobody left selected (e.g. coming back from empty exact amounts) → include everyone.
      if (d.mode !== 'exact' && !mem.some((m) => d.parts[m.id] === true || parseFloat(d.parts[m.id]) > 0)) {
        for (const m of mem) d.parts[m.id] = d.mode === 'equal' ? true : '1';
      }
      drawParts();
    }));

    $('#ex-save', body).onclick = () => {
      const err = $('#ex-err', body);
      const amount = parseFloat(d.amount);
      if (!(amount > 0) || amount >= 1e12) return (err.textContent = '請輸入金額');
      let rate = null;
      if (d.cur !== g.base) {
        rate = parseFloat(($('#ex-rateval', body) || {}).value);
        if (!(rate > 0)) return (err.textContent = `請輸入 ${d.cur} 的匯率`);
      }
      const ws = weights().filter(([, w]) => w > 0);
      if (!ws.length) return (err.textContent = '至少要有一個人分攤');
      if (d.mode === 'exact') {
        const s = Math.round(ws.reduce((a, [, w]) => a + w, 0) * 10 ** SL.decimalsOf(d.cur));
        if (s !== amtMinor()) return (err.textContent = '指定金額的總和要等於總金額');
      }
      if (rate && (!g.rates[d.cur] || g.rates[d.cur].r !== rate)) g.rates[d.cur] = { r: rate, t: SL.now() };
      const parts = Object.fromEntries(ws.map(([id, w]) => [id, d.mode === 'equal' ? 1 : w]));
      const rec = {
        ...(existing || {}), id: existing ? existing.id : SL.uid(), t: SL.now(), title: d.title.trim(), amount,
        cur: d.cur, payer: d.payer, date: d.date || today(), cat: d.cat, split: { mode: d.mode, parts },
      };
      upsertExpense(g, rec);
      db.lastCur = db.lastCur || {}; db.lastCur[g.id] = d.cur;
      closeSheet(); saveGroup(g);
      toast(existing ? '已更新' : '已新增 ✓');
    };
    if (e) $('#ex-del', body).onclick = () => deleteExpense(g, existing);

    drawRate(); drawParts();
  }
  function lastCur(g) { return (db.lastCur && db.lastCur[g.id]) || g.base; }

  function upsertExpense(g, rec) {
    const i = g.expenses.findIndex((x) => x.id === rec.id);
    if (i >= 0) g.expenses[i] = rec; else g.expenses.push(rec);
  }
  function deleteExpense(g, e) {
    confirmSheet('刪除這筆帳目？', `「${e.kind === 'transfer' ? '還款' : e.title || catOf(e.cat).label}」${SL.fmtAmount(e.amount, e.cur)}`, '刪除', () => {
      const i = g.expenses.findIndex((x) => x.id === e.id);
      g.expenses[i] = { id: e.id, t: SL.now(), del: true, amount: 0, cur: g.base };
      saveGroup(g); toast('已刪除');
    }, true);
  }

  function transferSheet(g, existing, preset) {
    const mem = SL.liveMembers(g);
    const me = meOf(g);
    const t = existing || preset || { payer: me || mem[0].id, to: (mem.find((m) => m.id !== (me || mem[0].id)) || mem[0]).id, amount: '', cur: g.base, date: today() };
    const tcur = existing ? existing.cur : g.base;
    const opt = (sel) => mem.map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    const body = sheet(existing ? '編輯還款' : '記一筆還款', `
      <div class="two"><label class="f"><span>誰付錢</span><select class="in" id="tr-from">${opt(t.payer)}</select></label>
        <label class="f"><span>付給誰</span><select class="in" id="tr-to">${opt(t.to)}</select></label></div>
      <label class="f"><span>金額（${esc(tcur)}）</span><input class="in big num" id="tr-amt" type="number" inputmode="decimal" step="any" min="0" value="${esc(t.amount)}" autofocus></label>
      <label class="f"><span>日期</span><input class="in" id="tr-date" type="date" value="${esc(t.date || today())}"></label>
      <div class="err" id="tr-err"></div>
      <div class="btns"><button class="btn primary grow" id="tr-ok">${existing ? '儲存' : '記錄還款'}</button>${existing ? '<button class="btn danger" id="tr-del">刪除</button>' : ''}</div>`);
    $('#tr-ok', body).onclick = () => {
      const from = $('#tr-from', body).value, to = $('#tr-to', body).value, amount = parseFloat($('#tr-amt', body).value);
      if (from === to) return ($('#tr-err', body).textContent = '付款人和收款人不能相同');
      if (!(amount > 0)) return ($('#tr-err', body).textContent = '請輸入金額');
      upsertExpense(g, { ...(existing || {}), id: existing ? existing.id : SL.uid(), t: SL.now(), kind: 'transfer', title: '', amount, cur: existing ? existing.cur : g.base, payer: from, to, date: $('#tr-date', body).value || today() });
      closeSheet(); saveGroup(g); toast('已記錄還款 💸');
    };
    if (existing) $('#tr-del', body).onclick = () => deleteExpense(g, existing);
  }

  /* ---------------- share ---------------- */
  async function shareSheet(g) {
    const code = await SL.encode(g);
    const base = location.href.split('#')[0];
    const isWeb = /^https?:/.test(base) && !EMBED;
    const link = `${base}#g=${code}`;
    const body = sheet('分享給朋友', `
      <p class="muted small" style="margin-top:0">整個帳本都在這條連結裡。朋友打開就能看、能記帳；他們記完再把連結傳回來，你打開就會自動合併。</p>
      <div class="qr hidden" id="sh-qr"></div>
      <div class="linkbox" id="sh-link">${esc(isWeb ? link : code)}</div>
      <p class="muted small">${isWeb ? `連結長度 ${link.length} 字元${link.length > 4800 ? '，超過 LINE 單則訊息上限（5000 字），建議改傳 JSON 備份檔' : ''}` : `分享碼 ${code.length} 字元。請把分享碼傳給朋友，在首頁「貼上連結加入」貼上即可。`}</p>
      <div class="btns">
        ${isWeb ? '<button class="btn primary" id="sh-copy">複製連結</button>' : ''}
        ${isWeb && navigator.share ? '<button class="btn" id="sh-native">分享到…</button>' : ''}
        <button class="btn ${isWeb ? '' : 'primary'}" id="sh-code">複製分享碼</button></div>`);
    const c = $('#sh-copy', body); if (c) c.onclick = () => { markShared(g); copy(link, '連結已複製，貼到群組吧！'); };
    const n = $('#sh-native', body); if (n) n.onclick = () => navigator.share({ title: `SplitLink｜${g.name}`, text: `${g.name} 的分帳帳本`, url: link }).then(() => markShared(g), () => {});
    $('#sh-code', body).onclick = () => { markShared(g); copy(code, '分享碼已複製'); };
    if (isWeb && link.length < 2900) drawQR(link, $('#sh-qr', body));
  }

  let qrLib;
  function drawQR(text, box) {
    const go = () => {
      try {
        const q = window.qrcode(0, 'L'); q.addData(text); q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        box.classList.remove('hidden');
      } catch {}
    };
    if (window.qrcode) return go();
    if (!qrLib) {
      qrLib = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    qrLib.then(go, () => {});
  }

  async function fetchRates(g) {
    const curs = $$('[data-rate]').map((i) => i.dataset.rate);
    if (!curs.length) return;
    toast('抓取匯率中…');
    try {
      const r = await fetch(`https://open.er-api.com/v6/latest/${g.base}`);
      const j = await r.json();
      if (j.result !== 'success') throw 0;
      let n = 0;
      for (const c of curs) {
        if (j.rates[c] > 0) { g.rates[c] = { r: +(1 / j.rates[c]).toPrecision(6), t: SL.now() }; n++; }
      }
      saveGroup(g); toast(`已更新 ${n} 種匯率`);
    } catch { toast('抓不到匯率，請手動輸入'); }
  }

  /* ---------------- settlement image ---------------- */
  const SITE = 'weeklyship-ai.github.io/splitlink';
  const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif';

  function settleCanvas(g) {
    const { bal } = SL.balances(g);
    const plan = SL.settle({ ...bal });
    const payees = SL.payeesWithInfo(g, plan);
    const W = 1080, P = 64, rowH = 132, gap = 18;
    const listH = plan.length ? plan.length * (rowH + gap) - gap : 200;
    const payH = payees.length ? 100 + payees.length * 64 : 0;
    const H = 290 + listH + (payH ? payH + 40 : 0) + 150;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const C = { bg: '#f6f5f1', card: '#ffffff', ink: '#1d1c1a', muted: '#6f6b63', accent: '#1f7a5a', soft: '#e2f1ea' };
    const font = (w, s) => (x.font = `${w} ${s}px ${FONT}`);
    const fit = (t, max) => {
      if (x.measureText(t).width <= max) return t;
      while (t.length && x.measureText(t + '…').width > max) t = t.slice(0, -1);
      return t + '…';
    };
    const box = (X, Y, w, h, r, fill) => {
      x.fillStyle = fill; x.beginPath();
      if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h);
      x.fill();
    };
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
    x.fillStyle = C.accent; x.fillRect(0, 0, W, 12);
    font(700, 30); x.fillStyle = C.accent; x.fillText('分帳結算', P, 92);
    font(800, 64); x.fillStyle = C.ink; x.fillText(fit(g.name, W - 2 * P), P, 172);
    font(500, 32); x.fillStyle = C.muted;
    x.fillText(fit(`總花費 ${SL.fmtMinor(groupTotal(g), g.base)} · ${SL.liveMembers(g).length} 人 · ${plan.length ? `${plan.length} 筆轉帳就結清` : '已結清'}`, W - 2 * P), P, 228);
    let y = 270;
    if (!plan.length) {
      box(P, y, W - 2 * P, 200, 28, C.card);
      font(700, 48); x.fillStyle = C.accent; x.textAlign = 'center';
      x.fillText('🎉 大家都結清了！', W / 2, y + 118); x.textAlign = 'left';
      y += 200;
    }
    for (const p of plan) {
      box(P, y, W - 2 * P, rowH, 28, C.card);
      font(600, 38);
      const from = fit(nameOf(g, p.from), 200), to = fit(nameOf(g, p.to), 200);
      let fx = P + 36;
      x.fillStyle = C.ink; x.fillText(from, fx, y + 80); fx += x.measureText(from).width + 16;
      x.fillStyle = C.muted; x.fillText('→', fx, y + 80); fx += x.measureText('→').width + 16;
      x.fillStyle = C.ink; x.fillText(to, fx, y + 80);
      font(800, 48); x.fillStyle = C.accent; x.textAlign = 'right';
      x.fillText(SL.fmtMinor(p.amount, g.base), W - P - 36, y + 84); x.textAlign = 'left';
      y += rowH + gap;
    }
    if (plan.length) y -= gap;
    if (payees.length) {
      y += 40;
      box(P, y, W - 2 * P, payH, 28, C.soft);
      font(700, 32); x.fillStyle = C.accent; x.fillText('💳 收款資訊', P + 36, y + 60);
      font(500, 32); x.fillStyle = C.ink;
      payees.forEach((m, i) => x.fillText(fit(`${m.name}：${m.pay}`, W - 2 * P - 72), P + 36, y + 60 + 64 * (i + 1)));
    }
    font(500, 26); x.fillStyle = C.muted;
    x.fillText(`🔗 SplitLink 分帳連結 · ${SITE}`, P, H - 60);
    x.textAlign = 'right'; x.fillText(new Date().toLocaleDateString('zh-TW'), W - P, H - 60); x.textAlign = 'left';
    return c;
  }

  function canShareFiles() {
    try { return !EMBED && !!navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }); } catch { return false; }
  }

  function imageSheet(g) {
    const c = settleCanvas(g);
    const url = c.toDataURL('image/png');
    const fname = `${g.name}-結算.png`;
    const blobP = new Promise((res) => c.toBlob(res, 'image/png'));
    const body = sheet('結算圖片', `<img src="${url}" alt="${esc(g.name)} 的結算圖片" class="settle-img">
      <p class="muted small">${canShareFiles() ? '按「分享圖片」可以直接傳到 LINE 群組。' : '也可以長按或右鍵圖片另存。'}</p>
      <div class="btns">
        ${canShareFiles() ? '<button class="btn primary" id="img-share">分享圖片</button>' : ''}
        ${window.ClipboardItem && navigator.clipboard && navigator.clipboard.write ? `<button class="btn ${canShareFiles() ? '' : 'primary'}" id="img-copy">複製圖片</button>` : ''}
        ${EMBED ? '' : '<button class="btn" id="img-dl">下載 PNG</button>'}</div>`);
    const s = $('#img-share', body);
    if (s) s.onclick = async () => {
      const file = new File([await blobP], fname, { type: 'image/png' });
      navigator.share({ files: [file], title: `${g.name} 分帳結算` }).catch(() => {});
    };
    const cp = $('#img-copy', body);
    if (cp) cp.onclick = () => navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })])
      .then(() => toast('圖片已複製，可以直接貼上'), () => toast('這個瀏覽器不能複製圖片，請長按另存'));
    const dl = $('#img-dl', body);
    if (dl) dl.onclick = () => {
      const a = document.createElement('a');
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    };
  }

  /* ---------------- install (PWA) ---------------- */
  let deferredInstall = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const canOfferInstall = () => !EMBED && !isStandalone() && (deferredInstall || isIOS);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredInstall = e;
    if (!view.gid) render();
  });
  function installApp() {
    if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall.userChoice.finally(() => { deferredInstall = null; render(); });
    } else {
      sheet('加到主畫面', `<ol class="steps">
        <li>用 <b>Safari</b> 開啟這個網頁（LINE 內建瀏覽器不支援，請先點右下角「⋯」→「用預設瀏覽器開啟」）</li>
        <li>點下方的 <b>分享</b> 按鈕 <span aria-hidden="true">⬆️</span></li>
        <li>選 <b>加入主畫面</b></li></ol>
        <p class="muted small">加到主畫面後可以離線開啟，帳本也不會被 Safari 自動清除。</p>`);
    }
  }

  /* ---------------- global click handler ---------------- */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.closest('.sheet')) return;
    const act = el.dataset.act;
    const g = G();
    switch (act) {
      case 'open': openGroup(el.dataset.id); break;
      case 'home': goHome(); break;
      case 'theme': {
        const r = document.documentElement;
        const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
        r.dataset.theme = dark ? 'light' : 'dark';
        try { localStorage.setItem('splitlink:theme', r.dataset.theme); } catch {}
        break;
      }
      case 'new-group': newGroupSheet(); break;
      case 'import': importSheet(); break;
      case 'demo': demoGroup(); break;
      case 'tab': view.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case 'who': whoAmISheet(g); break;
      case 'share': shareSheet(g); break;
      case 'add': expenseSheet(g); break;
      case 'add-transfer': transferSheet(g); break;
      case 'edit': {
        const e = g.expenses.find((x) => x.id === el.dataset.id);
        if (e) (e.kind === 'transfer' ? transferSheet(g, e) : expenseSheet(g, e));
        break;
      }
      case 'paid': {
        const plan = SL.settle({ ...SL.balances(g).bal });
        const p = plan[+el.dataset.i];
        if (!p) break;
        const amt = p.amount / 10 ** SL.decimalsOf(g.base);
        confirmSheet('確認已還款？', `${nameOf(g, p.from)} 已付給 ${nameOf(g, p.to)} ${SL.fmtMinor(p.amount, g.base)}`, '確認', () => {
          g.expenses.push({ id: SL.uid(), t: SL.now(), kind: 'transfer', title: '', amount: amt, cur: g.base, payer: p.from, to: p.to, date: today() });
          saveGroup(g); toast('已記錄 💸');
        });
        break;
      }
      case 'copy-summary': copy(SL.summaryText(g), '結算文字已複製'); break;
      case 'copy-pay': {
        const m = g.members.find((x) => x.id === el.dataset.id);
        if (m && m.pay) copy(m.pay, `已複製 ${m.name} 的收款資訊`);
        break;
      }
      case 'settle-image': imageSheet(g); break;
      case 'install': installApp(); break;
      case 'add-member': {
        const inp = $('#st-newmem');
        const name = inp.value.trim();
        if (!name) return;
        g.members.push({ id: SL.uid(), name, t: SL.now() });
        saveGroup(g); toast(`已新增 ${name}`);
        break;
      }
      case 'del-member': {
        const id = el.dataset.id;
        const involved = SL.liveExpenses(g).some((e) => e.payer === id || e.to === id || (e.split && e.split.parts && e.split.parts[id] > 0));
        if (involved) { toast('這位成員還有相關帳目，無法移除'); break; }
        confirmSheet('移除成員？', nameOf(g, id), '移除', () => {
          const m = g.members.find((x) => x.id === id);
          m.del = true; m.t = SL.now(); saveGroup(g);
        }, true);
        break;
      }
      case 'save-rates': {
        let n = 0;
        for (const inp of $$('[data-rate]')) {
          const r = parseFloat(inp.value);
          const c = inp.dataset.rate;
          if (r > 0 && (!g.rates[c] || g.rates[c].r !== r)) { g.rates[c] = { r, t: SL.now() }; n++; }
        }
        saveGroup(g); toast(n ? `已儲存 ${n} 個匯率` : '沒有變更');
        break;
      }
      case 'fetch-rates': fetchRates(g); break;
      case 'csv':
        if (EMBED) copy(SL.toCSV(g).replace(/^﻿/, ''), 'CSV 已複製，可直接貼到試算表');
        else download(`${g.name}.csv`, SL.toCSV(g), 'text/csv;charset=utf-8');
        break;
      case 'json':
        if (EMBED) copy(JSON.stringify(g), 'JSON 已複製');
        else download(`${g.name}.splitlink.json`, JSON.stringify(g, null, 1), 'application/json');
        break;
      case 'del-group':
        confirmSheet('刪除群組？', `「${g.name}」會從這台裝置移除。如果沒有分享過連結，資料將無法復原。`, '刪除', () => {
          delete db.groups[g.id]; delete db.me[g.id]; delete db.opened[g.id]; persist(); goHome();
        }, true);
        break;
    }
  });

  // Settings inputs save on change (rename group, base currency, rename members)
  document.addEventListener('change', (ev) => {
    const g = G();
    if (!g || ev.target.closest('.sheet')) return;
    const t = ev.target;
    if (t.id === 'st-name' && t.value.trim()) { g.name = t.value.trim(); g.t = SL.now(); saveGroup(g); toast('已更新名稱'); }
    else if (t.id === 'st-base') {
      const old = g.base, nb = t.value;
      // Re-express existing rates in the new base so nothing is lost.
      const k = SL.rateOf(g, nb); // 1 nb = k old
      const rates = {};
      if (k) {
        for (const [c, r] of Object.entries(g.rates)) if (c !== nb) rates[c] = { r: +(r.r / k).toPrecision(6), t: SL.now() };
        rates[old] = { r: +(1 / k).toPrecision(6), t: SL.now() };
      }
      g.base = nb; g.rates = rates; g.t = SL.now(); saveGroup(g);
      toast(k ? `主幣別改為 ${nb}` : `主幣別改為 ${nb}，請設定 ${old} 的匯率`);
    } else if (t.dataset.mpay) {
      const m = g.members.find((x) => x.id === t.dataset.mpay);
      const v = t.value.trim().slice(0, 80);
      if (m && v !== (m.pay || '')) { if (v) m.pay = v; else delete m.pay; m.t = SL.now(); saveGroup(g); toast('已更新收款方式'); }
    } else if (t.dataset.mname) {
      const m = g.members.find((x) => x.id === t.dataset.mname);
      if (m && t.value.trim() && t.value.trim() !== m.name) { m.name = t.value.trim(); m.t = SL.now(); saveGroup(g); toast('已更新'); }
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.id === 'st-newmem') $('[data-act="add-member"]').click();
  });

  /* ---------------- boot ---------------- */
  async function handleHash() {
    const m = location.hash.match(/[#&]g=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try { importGroup(await SL.decode(m[1])); } catch (e) { toast('連結無法讀取：' + (e.message || '')); }
    return true;
  }
  window.addEventListener('hashchange', handleHash);

  (async () => {
    try { const th = localStorage.getItem('splitlink:theme'); if (th) document.documentElement.dataset.theme = th; } catch {}
    if (db.last && db.groups[db.last]) view.gid = db.last;
    render();
    if (!EMBED && 'serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    await handleHash();
  })();
})();
