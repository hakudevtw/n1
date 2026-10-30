/* 間隔複習スケジューラ。純関数だけ（DOM・localStorage に触らない）。
   ブラウザでは window.SRS、node では module.exports。
   日付は "YYYY-MM-DD"（ローカル日付）の文字列。

   カード状態: { box, due, lapses, seen, last, correctStreak, first, idk, mt, imp }
     box 0 = 新カード（学習中。同日に2回正解で box 1 へ）
     box 1..6 の間隔 = INTERVALS[box] 日。box >= LONG_BOX は「長期記憶」 */
(function (root) {
"use strict";

var INTERVALS = [0, 1, 3, 7, 14, 30, 60];
var MAX_BOX = INTERVALS.length - 1;
var LONG_BOX = 4;       // 間隔 14 日以上
var LEECH = 3;          // lapses がこれ以上
var LEARN_STEPS = 2;    // box 0 で必要な正解回数
var MVD_LIMIT = 20;     // 最小可行日の最大題数
var DELAY_DAYS = 14;

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function today() { return fmtDate(new Date()); }
function dn(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
function addDays(s, n) {
  var d = new Date((dn(s) + n) * 864e5);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
function diffDays(a, b) { return dn(b) - dn(a); }

/* 初回の提示（答えを見せた）。新カードを今日の学習に入れる。 */
function introduce(day) {
  return { box: 0, due: day, lapses: 0, seen: 1, last: day, correctStreak: 0, first: day, idk: 0, mt: {} };
}

/* result: "ok" | "miss" | "idk"。mode は間違えた出題タイプ（任意、leech 分析用）。
   元の状態は変更せず、新しい状態を返す。 */
function grade(st, result, day, mode) {
  var s = Object.assign({ box: 0, lapses: 0, seen: 0, correctStreak: 0, idk: 0 }, st);
  s.mt = Object.assign({}, st && st.mt);
  s.seen += 1;
  s.last = day;
  if (result === "ok") {
    s.correctStreak += 1;
    if (s.box === 0) {
      if (s.correctStreak >= LEARN_STEPS) { s.box = 1; s.due = addDays(day, INTERVALS[1]); s.correctStreak = 0; }
      else s.due = day;
    } else {
      s.box = Math.min(s.box + 1, MAX_BOX);
      s.due = addDays(day, INTERVALS[s.box]);
    }
    return s;
  }
  /* miss と idk は予定上は同じ。idk は別カウントで残し、当日の正解率には入れない（app 側）。 */
  s.correctStreak = 0;
  if (result === "idk") s.idk += 1;
  if (mode) s.mt[mode] = (s.mt[mode] || 0) + 1;
  if (s.box === 0) { s.due = day; }              // 学習中の取りこぼしは lapse にしない
  else { s.lapses += 1; s.box = 1; s.due = addDays(day, INTERVALS[1]); }
  return s;
}

/* 「この日份は大致會了」: box 3（7日後）へ。すでに box 3 以上なら下げない。
   新詞の上限（first === 今日）には数えない。 */
function importKnown(states, ids, day) {
  var out = Object.assign({}, states);
  ids.forEach(function (id) {
    var s = out[id];
    if (s && s.box >= 3) return;
    out[id] = {
      box: 3, due: addDays(day, INTERVALS[3]), lapses: (s && s.lapses) || 0, seen: (s && s.seen) || 0,
      last: day, correctStreak: 0, first: (s && s.first) || null, idk: (s && s.idk) || 0,
      mt: (s && s.mt) || {}, imp: true
    };
  });
  return out;
}

function isDue(s, day) { return !!s && s.due <= day; }

function introducedOn(states, day) {
  var n = 0;
  for (var k in states) if (states[k] && states[k].first === day) n++;
  return n;
}

/* 今日の出題計画。
   order: 新詞の優先順に並んだ全 id。 states: {id: 状態}。
   cfg: { newCap=20, extra=0, priority=[], mode="normal"|"mvd", mvdLimit=20,
          exclude={id:1}（この場で処理済み）, canIntroduce(id)（任意） }
   ① 到期（due <= 今日）を due の早い順。
   ② 到期が1枚でも残っていれば新詞は出さない（newIds=[]）。
   ③ 新詞は newCap + extra − 今日導入済み まで。優先詞が先頭。
   ④ mvd は到期のみ、最大 mvdLimit 枚。 */
function plan(order, states, day, cfg) {
  cfg = cfg || {};
  var exclude = cfg.exclude || {}, can = cfg.canIntroduce;
  var idx = {};
  order.forEach(function (id, i) { idx[id] = i; });
  var due = order.filter(function (id) { return isDue(states[id], day) && !exclude[id]; });
  due.sort(function (a, b) {
    var d = dn(states[a].due) - dn(states[b].due);
    return d || idx[a] - idx[b];
  });
  var mvd = cfg.mode === "mvd";
  var dueAll = due.length;
  if (mvd) due = due.slice(0, Math.max(0, cfg.mvdLimit == null ? MVD_LIMIT : cfg.mvdLimit));

  var cap = cfg.newCap == null ? 20 : cfg.newCap;
  var introduced = introducedOn(states, day);
  var newLeft = mvd ? 0 : Math.max(0, cap + (cfg.extra || 0) - introduced);
  var cands = [];
  if (newLeft) {
    var seen = {}, fresh = function (id) {
      return idx[id] != null && !states[id] && !exclude[id] && !seen[id] && (!can || can(id));
    };
    (cfg.priority || []).forEach(function (id) { if (fresh(id)) { seen[id] = 1; cands.push(id); } });
    for (var i = 0; i < order.length && cands.length < newLeft; i++) {
      var id = order[i];
      if (fresh(id)) { seen[id] = 1; cands.push(id); }
    }
    cands = cands.slice(0, newLeft);
  }
  return {
    due: due, dueAll: dueAll, introduced: introduced, newLeft: newLeft,
    newCount: cands.length, newIds: due.length ? [] : cands
  };
}

/* 延遲測驗: box >= 3 かつ last が 14 日以上前。rng は 0..1 を返す関数。 */
function delayedEligible(states, day) {
  return Object.keys(states).filter(function (id) {
    var s = states[id];
    return s && s.box >= 3 && s.last && diffDays(s.last, day) >= DELAY_DAYS;
  }).sort();
}
function delayedSample(states, day, n, rng) {
  rng = rng || Math.random;
  var a = delayedEligible(states, day);
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, n == null ? 20 : n);
}

function stats(states, day) {
  var o = { due: 0, learned: 0, longTerm: 0, leeches: [] };
  Object.keys(states).forEach(function (id) {
    var s = states[id];
    if (!s) return;
    o.learned++;
    if (s.due <= day) o.due++;
    if (s.box >= LONG_BOX) o.longTerm++;
    if (s.lapses >= LEECH) o.leeches.push(id);
  });
  o.leeches.sort(function (a, b) { return states[b].lapses - states[a].lapses || (a < b ? -1 : 1); });
  return o;
}

/* daily: {日付: {n, newN, ...}}。n+newN > 0 の日を活動日とする。
   今日まだ何もしていなければ昨日から数える（今日はまだ終わっていないだけ）。 */
function newOf(x) { return (x && (x["new"] != null ? x["new"] : x.newN)) || 0; }
function active(daily, d) { var x = daily[d]; return !!x && ((x.n || 0) + newOf(x)) > 0; }
function streak(daily, day) {
  var d = active(daily, day) ? day : addDays(day, -1), n = 0;
  while (active(daily, d)) { n++; d = addDays(d, -1); }
  return n;
}
function lastDays(daily, day, n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    var d = addDays(day, -i), x = daily[d] || {};
    out.push({ date: d, n: x.n || 0, newN: newOf(x) });
  }
  return out;
}
/* 全期間の最長連続日数 */
function longestStreak(daily) {
  var ds = Object.keys(daily).filter(function (d) { return active(daily, d); }).sort();
  var best = 0, run = 0, prev = null;
  ds.forEach(function (d) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  });
  return best;
}

/* 「我熟了」: 箱 5（約 30 日後）へ直接。lapses などの履歴は残す。 */
var KNOWN_BOX = 5;
function markKnown(st, day) {
  var s = Object.assign({ lapses: 0, seen: 0, idk: 0, first: day }, st);
  s.mt = Object.assign({}, st && st.mt);
  s.box = KNOWN_BOX; s.due = addDays(day, INTERVALS[KNOWN_BOX]); s.last = day;
  s.correctStreak = 0; s.imp = true;
  return s;
}
/* 環状バッファ: 末尾に足して最新 max 件だけ残す（新しい配列を返す） */
function ringPush(arr, item, max) {
  var a = (arr || []).concat([item]);
  return a.length > max ? a.slice(a.length - max) : a;
}
/* 日別集計 days[date] = {n, ok, new, rev, idk} に 1 件足す（days を直接更新） */
function bumpDay(days, date, f) {
  var d = days[date] || (days[date] = { n: 0, ok: 0, "new": 0, rev: 0, idk: 0 });
  if (f.answer) {
    d.n++;
    if (f.answer === "ok") d.ok++; else if (f.answer === "idk") d.idk++;
    if (f.review) d.rev++;
  }
  if (f.introduced) d["new"]++;
  return d;
}

var api = {
  INTERVALS: INTERVALS, MAX_BOX: MAX_BOX, LONG_BOX: LONG_BOX, LEECH: LEECH, LEARN_STEPS: LEARN_STEPS,
  MVD_LIMIT: MVD_LIMIT, DELAY_DAYS: DELAY_DAYS,
  today: today, addDays: addDays, diffDays: diffDays,
  introduce: introduce, grade: grade, importKnown: importKnown, isDue: isDue,
  introducedOn: introducedOn, plan: plan, delayedEligible: delayedEligible, delayedSample: delayedSample,
  stats: stats, streak: streak, lastDays: lastDays, longestStreak: longestStreak,
  KNOWN_BOX: KNOWN_BOX, markKnown: markKnown, ringPush: ringPush, bumpDay: bumpDay
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SRS = api;
})(typeof window !== "undefined" ? window : this);
