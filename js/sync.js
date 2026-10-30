/* 同期・バックアップの純関数。DOM・localStorage に触らない（入力は渡し、結果を返す）。
   ブラウザでは window.SYNC、node では module.exports。
   フィールド定義は docs/SYNC.md。クリップボードで往復するだけで、サーバは無い。 */
(function (root) {
"use strict";

var SRS = typeof module !== "undefined" && module.exports ? require("./srs.js") : root.SRS;

var SCHEMA = 2;
var MAX_INPUT = 500 * 1024;          // 貼り付けテキストの上限（文字数）
var WARN_SYNC = 60 * 1024;           // 同期包がこれを超えたら警告
var L = {
  log: 500, flags: 100, journal: 200, applied: 100, syncLog: 50, delayed: 100,
  syncLogOut: 200, priority: 300, notes: 400, noteLen: 400, journalLen: 1000, msgLen: 200, idLen: 120,
  cardsIn: 20000
};
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- 型の補助 ---------- */
function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
function num(x, lo, hi, dflt) {
  x = +x;
  if (!isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
}
function str(x, max) { return typeof x === "string" ? x.slice(0, max) : ""; }
function isDate(x) { return typeof x === "string" && DATE_RE.test(x); }
function isId(x) { return typeof x === "string" && x.length > 0 && x.length <= L.idLen; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function defaults() {
  return {
    schema: SCHEMA, cards: {}, days: {}, log: [], delayed: [], journal: [], priority: [], flags: [],
    notes: {}, ltm: {}, extra: {}, times: {},
    settings: { newCap: 20, mvdN: 20, rate: 0.85, theme: "auto" },
    sync: { lastExportAt: 0, prevExportAt: 0, applied: [], log: [] },
    coachMsg: null, savedAt: 0
  };
}

/* ---------- 状態の正規化（読み込み・復元の両方で使う）----------
   未知のフィールドは捨て、型が壊れたカードは落とす。旧開発版の
   daily / newCap も拾う。返す dropped は捨てた件数（診断用）。 */
function normCard(c) {
  if (!isObj(c)) return null;
  var box = Math.round(+c.box);
  if (!(box >= 0 && box <= SRS.MAX_BOX) || !isDate(c.due)) return null;
  var o = {
    box: box, due: c.due, lapses: Math.max(0, Math.round(+c.lapses) || 0), seen: Math.max(0, Math.round(+c.seen) || 0),
    last: isDate(c.last) ? c.last : null, correctStreak: Math.max(0, Math.round(+c.correctStreak) || 0),
    first: isDate(c.first) ? c.first : null, idk: Math.max(0, Math.round(+c.idk) || 0), mt: {}
  };
  if (isObj(c.mt)) Object.keys(c.mt).slice(0, 20).forEach(function (m) { if (+c.mt[m] > 0) o.mt[str(m, 20)] = Math.round(+c.mt[m]); });
  if (c.imp) o.imp = true;
  if (+c.u > 0) o.u = Math.round(+c.u);
  return o;
}
function normDay(d) {
  if (!isObj(d)) return null;
  var nw = d["new"] != null ? d["new"] : d.newN;
  return { n: Math.max(0, Math.round(+d.n) || 0), ok: Math.max(0, Math.round(+d.ok) || 0),
    "new": Math.max(0, Math.round(+nw) || 0), rev: Math.max(0, Math.round(+d.rev) || 0), idk: Math.max(0, Math.round(+d.idk) || 0) };
}
function normLog(e) {
  if (!isObj(e) || !isId(e.id)) return null;
  var o = { t: Math.round(+e.t) || 0, id: e.id, q: str(e.q, 20), ok: str(e.ok, 8), b0: Math.round(+e.b0) || 0, b1: Math.round(+e.b1) || 0 };
  return o.t > 0 ? o : null;
}
function normFlag(f) {
  if (!isObj(f) || !isId(f.id)) return null;
  var o = { t: Math.round(+f.t) || 0, id: f.id, q: str(f.q, 20), snap: {} };
  if (isObj(f.snap)) {
    o.snap.head = str(f.snap.head, 80); o.snap.prompt = str(f.snap.prompt, 300);
    o.snap.opts = Array.isArray(f.snap.opts) ? f.snap.opts.slice(0, 8).map(function (x) { return str(x, 120); }) : [];
    o.snap.ans = typeof f.snap.ans === "number" ? f.snap.ans : -1;
  }
  return o.t > 0 ? o : null;
}
function normalizeState(raw) {
  var s = defaults(), dropped = 0;
  if (!isObj(raw)) return { state: s, dropped: 0, ok: false };
  if (isObj(raw.cards)) {
    var ks = Object.keys(raw.cards);
    if (ks.length > L.cardsIn) ks = ks.slice(0, L.cardsIn);
    ks.forEach(function (id) {
      var c = isId(id) ? normCard(raw.cards[id]) : null;
      if (c) s.cards[id] = c; else dropped++;
    });
  }
  var days = isObj(raw.days) ? raw.days : isObj(raw.daily) ? raw.daily : {};
  Object.keys(days).forEach(function (d) { var x = isDate(d) ? normDay(days[d]) : null; if (x) s.days[d] = x; });
  s.log = (Array.isArray(raw.log) ? raw.log : []).map(normLog).filter(Boolean).slice(-L.log);
  s.flags = (Array.isArray(raw.flags) ? raw.flags : []).map(normFlag).filter(Boolean).slice(-L.flags);
  s.delayed = (Array.isArray(raw.delayed) ? raw.delayed : []).filter(function (x) {
    return isObj(x) && isDate(x.date) && +x.n > 0;
  }).map(function (x) { return { date: x.date, n: Math.round(+x.n), correct: Math.max(0, Math.min(Math.round(+x.n), Math.round(+x.correct) || 0)) }; })
    .slice(-L.delayed);
  s.journal = (Array.isArray(raw.journal) ? raw.journal : []).filter(function (x) { return isObj(x) && isDate(x.d) && typeof x.t === "string" && x.t; })
    .map(function (x) { return { d: x.d, t: x.t.slice(0, L.journalLen) }; }).slice(-L.journal);
  s.priority = (Array.isArray(raw.priority) ? raw.priority : []).filter(isId).slice(0, L.priority);
  if (isObj(raw.notes)) Object.keys(raw.notes).slice(0, 2000).forEach(function (id) {
    if (isId(id) && typeof raw.notes[id] === "string" && raw.notes[id]) s.notes[id] = raw.notes[id].slice(0, L.noteLen);
  });
  if (isObj(raw.ltm)) Object.keys(raw.ltm).forEach(function (d) { if (isDate(d) && +raw.ltm[d] >= 0) s.ltm[d] = Math.round(+raw.ltm[d]); });
  if (isObj(raw.extra)) Object.keys(raw.extra).forEach(function (d) { if (isDate(d)) s.extra[d] = Math.max(0, Math.round(+raw.extra[d]) || 0); });
  if (isObj(raw.times)) Object.keys(raw.times).forEach(function (k) { if (/^\d+-\d+$/.test(k) && +raw.times[k] > 0) s.times[k] = Math.round(+raw.times[k]); });
  var st = isObj(raw.settings) ? raw.settings : {};
  s.settings.newCap = Math.round(num(st.newCap != null ? st.newCap : raw.newCap, 5, 50, 20));
  s.settings.mvdN = Math.round(num(st.mvdN, 5, 50, 20));
  s.settings.rate = Math.round(num(st.rate, 0.5, 1.3, 0.85) * 100) / 100;
  s.settings.theme = st.theme === "light" || st.theme === "dark" ? st.theme : "auto";
  var sy = isObj(raw.sync) ? raw.sync : {};
  s.sync.lastExportAt = Math.max(0, Math.round(+sy.lastExportAt) || 0);
  s.sync.prevExportAt = Math.max(0, Math.round(+sy.prevExportAt) || 0);
  s.sync.applied = (Array.isArray(sy.applied) ? sy.applied : []).filter(isId).slice(-L.applied);
  s.sync.log = (Array.isArray(sy.log) ? sy.log : []).filter(function (x) { return isObj(x) && +x.t > 0; })
    .map(function (x) { return { t: Math.round(+x.t), k: str(x.k, 12), s: str(x.s, 200) }; }).slice(-L.syncLog);
  if (isObj(raw.coachMsg) && typeof raw.coachMsg.m === "string" && raw.coachMsg.m)
    s.coachMsg = { id: str(raw.coachMsg.id, L.idLen), m: raw.coachMsg.m.slice(0, L.msgLen), at: Math.round(+raw.coachMsg.at) || 0 };
  s.savedAt = Math.max(0, Math.round(+raw.savedAt) || 0);
  return { state: s, dropped: dropped, ok: true };
}

/* ---------- 共通のパース ---------- */
function parseJSON(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "空です。" };
  if (text.length > MAX_INPUT) return { ok: false, error: "大きすぎます（上限 " + Math.round(MAX_INPUT / 1024) + "KB）。" };
  var t = text.trim();
  /* チャットから貼ると ``` で囲まれていることがある */
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  var i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j < i) return { ok: false, error: "JSON が見つかりません。" };
  try {
    var obj = JSON.parse(t.slice(i, j + 1));
    if (!isObj(obj)) return { ok: false, error: "JSON の形が違います。" };
    return { ok: true, obj: obj };
  } catch (e) { return { ok: false, error: "JSON として読めません（途中で切れていないか確認）。" }; }
}

/* ---------- 出力: n1.sync（増量）---------- */
function cardTouched(c, sinceMs, sinceDate) {
  if (!sinceMs) return true;
  if (c.u) return c.u > sinceMs;
  return !!c.last && c.last >= sinceDate;
}
function localDate(ms) {
  var d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
/* opts: { now(ms), today("YYYY-MM-DD"), since(ms, 省略で state.sync.lastExportAt), app,
           lookup(id)->{w,r,m}, dueAll(今日の到期枚数) } */
function buildSync(state, opts) {
  var now = opts.now, today = opts.today;
  var since = opts.since != null ? opts.since : state.sync.lastExportAt;
  var sinceDate = since ? localDate(since) : "0000-00-00";
  var lookup = opts.lookup || function () { return {}; };
  var st = SRS.stats(state.cards, today);
  var td = state.days[today] || { n: 0, ok: 0, "new": 0, rev: 0, idk: 0 };
  var den = td.n - td.idk;
  var gaps = [];
  for (var i = 14; i >= 1; i--) {
    var d = SRS.addDays(today, -i), x = state.days[d];
    if (!x || x.n + x["new"] === 0) gaps.push(d);
  }
  var cards = {}, ncards = 0;
  Object.keys(state.cards).sort().forEach(function (id) {
    var c = state.cards[id];
    if (!cardTouched(c, since, sinceDate)) return;
    cards[id] = { b: c.box, due: c.due, l: c.lapses, s: c.seen, last: c.last };
    ncards++;
  });
  var days = {};
  Object.keys(state.days).sort().forEach(function (d) { if (d >= sinceDate) days[d] = state.days[d]; });
  var leeches = st.leeches.slice(0, 40).map(function (id) {
    var c = state.cards[id], m = lookup(id) || {};
    return { id: id, w: m.w || id, r: m.r || "", m: m.m || "", lapses: c.lapses, mt: c.mt || {} };
  });
  return {
    kind: "n1.sync", schema: SCHEMA, app: opts.app || "n1-app", id: "s-" + now,
    exportedAt: new Date(now).toISOString(), since: since ? new Date(since).toISOString() : null,
    summary: {
      today: today, done: td.n, acc: den > 0 ? Math.round(td.ok / den * 100) : null, "new": td["new"],
      reviewDue: opts.dueAll != null ? opts.dueAll : st.due, learned: st.learned,
      longTerm: st.longTerm, streak: SRS.streak(state.days, today), gapDays: gaps
    },
    days: days, cards: cards,
    leeches: leeches,
    delayed: state.delayed.slice(-5).map(function (x) { return { d: x.date, n: x.n, ok: x.correct }; }),
    log: state.log.filter(function (e) { return e.t > since; }).slice(-L.syncLogOut),
    flags: state.flags.filter(function (f) { return f.t > since; }),
    settings: clone(state.settings)
  };
}
function stringify(obj) { return JSON.stringify(obj); }
function sizeOf(text) {
  /* UTF-8 バイト数。日本語を含むので length ではなく数える。 */
  if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
  return new Blob([text]).size;
}

/* ---------- 出力・入力: n1.backup（全部）---------- */
function buildBackup(state, now, app) {
  var s = clone(state);
  return { kind: "n1.backup", schema: SCHEMA, app: app || "n1-app", exportedAt: new Date(now).toISOString(), state: s };
}
function parseBackup(text) {
  var p = parseJSON(text);
  if (!p.ok) return p;
  var o = p.obj;
  if (o.kind === "n1.coach" || o.kind === "n1.sync") return { ok: false, error: "これは " + o.kind + " です。バックアップ（n1.backup）ではありません。" };
  if (o.kind !== "n1.backup") return { ok: false, error: "n1.backup ではありません。" };
  if (o.schema !== SCHEMA) return { ok: false, error: "schema " + o.schema + " は未対応です（対応: " + SCHEMA + "）。" };
  var n = normalizeState(o.state);
  if (!n.ok) return { ok: false, error: "state が読めません。" };
  return { ok: true, state: n.state, dropped: n.dropped, exportedAt: str(o.exportedAt, 40) };
}

/* ---------- 入力: n1.coach ---------- */
var COACH_SETTINGS = { newCap: [5, 50], mvdN: [5, 50], rate: [0.5, 1.3] };
function parseCoach(text) {
  var p = parseJSON(text);
  if (!p.ok) return p;
  var o = p.obj;
  if (o.kind === "n1.backup" || o.kind === "n1.sync") return { ok: false, error: "これは " + o.kind + " です。教練の回覆（n1.coach）ではありません。" };
  if (o.kind !== "n1.coach") return { ok: false, error: "n1.coach ではありません。" };
  if (o.schema !== SCHEMA) return { ok: false, error: "schema " + o.schema + " は未対応です（対応: " + SCHEMA + "）。" };
  if (!isId(o.id)) return { ok: false, error: "id がありません（重複適用の防止に必要）。" };
  var pkg = { id: o.id, issuedAt: str(o.issuedAt, 40), settings: {}, priority: [], notes: {}, journal: [], message: "" };
  if (isObj(o.settings)) Object.keys(COACH_SETTINGS).forEach(function (k) {
    if (o.settings[k] != null && isFinite(+o.settings[k]))
      pkg.settings[k] = Math.round(num(o.settings[k], COACH_SETTINGS[k][0], COACH_SETTINGS[k][1], 0) * 100) / 100;
  });
  if (pkg.settings.newCap != null) pkg.settings.newCap = Math.round(pkg.settings.newCap);
  if (pkg.settings.mvdN != null) pkg.settings.mvdN = Math.round(pkg.settings.mvdN);
  var seen = {};
  (Array.isArray(o.priority) ? o.priority : []).forEach(function (id) {
    if (isId(id) && !seen[id] && pkg.priority.length < L.priority) { seen[id] = 1; pkg.priority.push(id); }
  });
  if (isObj(o.notes)) Object.keys(o.notes).slice(0, L.notes).forEach(function (id) {
    if (isId(id) && typeof o.notes[id] === "string") pkg.notes[id] = o.notes[id].slice(0, L.noteLen);
  });
  (Array.isArray(o.journal) ? o.journal : []).slice(0, 100).forEach(function (j) {
    if (isObj(j) && isDate(j.d) && typeof j.t === "string" && j.t.trim()) pkg.journal.push({ d: j.d, t: j.t.slice(0, L.journalLen) });
  });
  pkg.message = str(o.message, L.msgLen);
  return { ok: true, pkg: pkg };
}
/* ctx: { known(id)->bool（App が知っているカード id）, hasCard(id)->bool（すでに学習中）} */
function previewCoach(state, pkg, ctx) {
  var lines = [], already = state.sync.applied.indexOf(pkg.id) >= 0;
  var sk = Object.keys(pkg.settings).filter(function (k) { return state.settings[k] !== pkg.settings[k]; });
  var pri = { add: 0, learning: 0, unknown: 0 };
  pkg.priority.forEach(function (id) {
    if (!ctx.known(id)) pri.unknown++; else if (ctx.hasCard(id)) pri.learning++; else pri.add++;
  });
  var noteN = 0, noteUnknown = 0, noteClear = 0;
  Object.keys(pkg.notes).forEach(function (id) {
    if (!ctx.known(id)) noteUnknown++; else if (pkg.notes[id] === "") noteClear++; else noteN++;
  });
  var jNew = pkg.journal.filter(function (j) {
    return !state.journal.some(function (x) { return x.d === j.d && x.t === j.t; });
  }).length;
  if (already) lines.push("このパッケージ（" + pkg.id + "）は適用済みです。もう一度貼っても何も変わりません。");
  lines.push("設定の変更：" + (sk.length ? sk.map(function (k) { return k + " " + state.settings[k] + " → " + pkg.settings[k]; }).join("、") : "なし"));
  lines.push("優先詞：追加 " + pri.add + " 件" + (pri.learning ? "／すでに学習中 " + pri.learning + " 件（対象外）" : "") + (pri.unknown ? "／不明な id " + pri.unknown + " 件（無視）" : ""));
  lines.push("教練の留言：" + jNew + " 則（新規）" + (pkg.journal.length - jNew ? "／既読 " + (pkg.journal.length - jNew) + " 則" : ""));
  lines.push("詞の注解：" + noteN + " 件" + (noteClear ? "／消去 " + noteClear + " 件" : "") + (noteUnknown ? "／不明な id " + noteUnknown + " 件（無視）" : ""));
  lines.push("今日ページの一言：" + (pkg.message ? "「" + pkg.message + "」" : "なし"));
  return { already: already, lines: lines, counts: { settings: sk.length, priority: pri.add, journal: jNew, notes: noteN + noteClear, message: pkg.message ? 1 : 0 } };
}
/* 純粋: 新しい state を返す。適用済みなら applied:false で何も変えない。 */
function applyCoach(state, pkg, ctx, now) {
  if (state.sync.applied.indexOf(pkg.id) >= 0) return { state: state, applied: false, summary: "適用済み" };
  var s = clone(state), pv = previewCoach(state, pkg, ctx);
  Object.keys(pkg.settings).forEach(function (k) { s.settings[k] = pkg.settings[k]; });
  var add = pkg.priority.filter(function (id) { return ctx.known(id) && !ctx.hasCard(id); });
  s.priority = add.concat(s.priority.filter(function (id) { return add.indexOf(id) < 0; })).slice(0, L.priority);
  Object.keys(pkg.notes).forEach(function (id) {
    if (!ctx.known(id)) return;
    if (pkg.notes[id] === "") delete s.notes[id]; else s.notes[id] = pkg.notes[id];
  });
  pkg.journal.forEach(function (j) {
    if (!s.journal.some(function (x) { return x.d === j.d && x.t === j.t; })) s.journal.push({ d: j.d, t: j.t });
  });
  s.journal.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  s.journal = s.journal.slice(-L.journal);
  if (pkg.message) s.coachMsg = { id: pkg.id, m: pkg.message, at: now };
  s.sync.applied = SRS.ringPush(s.sync.applied, pkg.id, L.applied);
  var summary = "設定 " + pv.counts.settings + "・優先詞 " + pv.counts.priority + "・留言 " + pv.counts.journal + "・注解 " + pv.counts.notes;
  s.sync.log = SRS.ringPush(s.sync.log, { t: now, k: "apply", s: summary }, L.syncLog);
  return { state: s, applied: true, summary: summary };
}

/* ---------- 輸出の記録・スナップショット ---------- */
function logSync(state, kind, summary, now) {
  state.sync.log = SRS.ringPush(state.sync.log, { t: now, k: kind, s: String(summary).slice(0, 200) }, L.syncLog);
  return state;
}
/* 輸出を確定: lastExportAt を now にし、直前の値を prevExportAt に退避（「同じ区間をもう一度」用）。 */
function markExported(state, now, summary) {
  state.sync.prevExportAt = state.sync.lastExportAt;
  state.sync.lastExportAt = now;
  return logSync(state, "export", summary, now);
}
/* snaps: [{t, reason, json}]。最新 max 件。 */
function pushSnapshot(snaps, state, reason, now, max) {
  return SRS.ringPush(snaps || [], { t: now, reason: String(reason).slice(0, 30), json: JSON.stringify(state) }, max || 3);
}
function readSnapshot(snap) {
  try { var n = normalizeState(JSON.parse(snap.json)); return n.ok ? n.state : null; } catch (e) { return null; }
}

var api = {
  SCHEMA: SCHEMA, MAX_INPUT: MAX_INPUT, WARN_SYNC: WARN_SYNC, LIMITS: L,
  defaults: defaults, normalizeState: normalizeState, normCard: normCard, parseJSON: parseJSON,
  buildSync: buildSync, stringify: stringify, sizeOf: sizeOf, buildBackup: buildBackup, parseBackup: parseBackup,
  parseCoach: parseCoach, previewCoach: previewCoach, applyCoach: applyCoach,
  logSync: logSync, markExported: markExported, pushSnapshot: pushSnapshot, readSnapshot: readSnapshot, localDate: localDate
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SYNC = api;
})(typeof window !== "undefined" ? window : this);
