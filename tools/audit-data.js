/* node tools/audit-data.js — 「通れなくなる出題」の元になるデータ側の問題を洗い出す。
   出題側の対策（同義・同音の除外、選択肢の整え、仮名入力の正規化）は js/app.js と js/audit.js にある。
   ここで「ブロッカー」と出たものはデータを直す必要がある。それ以外は出題側で吸収済みの情報。 */
"use strict";
var A = require("../js/audit.js");
global.window = {};
require("../js/data/words.js"); require("../js/data/grammar.js");
var W = [], T = [], blockers = 0, info = [];
Object.keys(window.DAYS).forEach(function (n) {
  var d = window.DAYS[n];
  (d.words || []).forEach(function (w) { W.push(w); });
  (d.lite || []).forEach(function (a) { W.push({ w: a[0], r: a[1], c: a[2], ex: a[3] || "" }); });
  (d.traps || []).forEach(function (t) { T.push(t); });
});
function block(m) { blockers++; console.log("BLOCKER  " + m); }
function note(m) { info.push(m); }

var seen = {};
W.forEach(function (w) {
  if (seen[w.w]) block("duplicate word id w:" + w.w); seen[w.w] = 1;
  if (!A.readings(w.r).length) block("empty reading: " + w.w);
  A.readings(w.r).forEach(function (r) { if (!/^[ぁ-ゖァ-ヺー]+$/.test(r)) block("reading has non-kana: " + w.w + " " + r); });
});
var gs = {};
window.GRAMMAR.forEach(function (g) {
  if (gs[g.f]) block("duplicate grammar id g:" + g.f); gs[g.f] = 1;
  var c = A.cleanOpts(g.q.o, g.q.a);
  if (!c) block("grammar quiz answer missing: " + g.f);
  else if (c.opts.length !== g.q.o.length || g.q.o.some(function (x) { return x !== x.trim(); }))
    note("grammar options had whitespace/duplicates (cleaned at runtime): " + g.f);
});
T.forEach(function (t, i) {
  var c = A.cleanOpts(t.o, t.a);
  if (!c) block("trap answer missing: " + t.s);
  else if (c.opts.length !== t.o.length) block("trap has duplicate options: " + t.s);
  if (c && c.opts.length < 2) block("trap has <2 options: " + t.s);
});
var multi = W.filter(function (w) { return A.readings(w.r).length > 1; });
note("multi-reading words (typing accepts any; reading choices exclude partial overlaps): " + multi.map(function (w) { return w.w + "=" + w.r; }).join(" "));
var pairs = 0;
W.forEach(function (a, i) { for (var j = i + 1; j < W.length; j++) if (A.sameMeaning(a.c, W[j].c)) pairs++; });
note("word pairs sharing a meaning segment (excluded from each other's options): " + pairs);
var hp = {};
W.forEach(function (w) { A.readings(w.r).forEach(function (r) { (hp[r] = hp[r] || []).push(w.w); }); });
note("homophone groups (excluded from 音→意 options): " + Object.keys(hp).filter(function (k) { return hp[k].length > 1; }).length);
var cl = W.filter(function (w) { return w.ex && w.ex.indexOf("<b>") >= 0; });
note("cloze sentences whose bold text differs from the headword (conjugated; options stay dictionary form): " +
  cl.filter(function (w) { return w.ex.match(/<b>([\s\S]*?)<\/b>/)[1] !== w.w; }).length);

info.forEach(function (m) { console.log("info     " + m); });
console.log(blockers ? "\n" + blockers + " blocker(s)" : "\nno blockers");
process.exit(blockers ? 1 : 0);
