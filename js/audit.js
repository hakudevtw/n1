/* 「通れなくなる出題」を防ぐ純関数。DOM・localStorage に触らない。
   ブラウザでは window.AUDIT、node では module.exports。
   稽古の結果は docs ではなく tools/audit-data.js で再現できる。 */
(function (root) {
"use strict";

/* ---------- 仮名入力の正規化 ---------- */
var DASHES = /[‐-―−－ｰ\-]/g;           // - ‐ – — ― − － ｰ → ー
var DROP = /[\s　・･、。，,.〜~〜～「」『』()（）]/g;
function nfkc(s) { return String(s == null ? "" : s).normalize ? String(s).normalize("NFKC") : String(s); }
function kata2hira(s) {
  return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
}
/* 全角/半角・カタカナ/ひらがな・空白・中黒・各種ダッシュを揃える。
   NFKC は半角カナ（ｶﾀｶﾅ）を全角にし、全角英数を半角にする。 */
function norm(s) {
  s = nfkc(s);                       // ｶﾞ → ガ（濁点も合成される）
  s = s.replace(DASHES, "ー");
  s = kata2hira(s).replace(DROP, "");
  return s;
}
var ROWS = {
  a: "ぁあかがさざただなはばぱまゃやらゎわ", i: "ぃいきぎしじちぢにひびぴみり",
  u: "ぅうくぐすずっつづぬふぶぷむゅゆるゔ", e: "ぇえけげせぜてでねへべぺめれ",
  o: "ぉおこごそぞとどのほぼぽもょよろを"
};
var VOWEL = {};
Object.keys(ROWS).forEach(function (v) { ROWS[v].split("").forEach(function (c) { VOWEL[c] = v; }); });
var EXT = { a: "あ", i: "い", u: "う", e: "えい", o: "おう" };
/* 長音の綴りの揺れを「ー」に畳む（ー／う／お／い／え の延ばし）。
   とーきょー・とうきょう・とおきょお を同じ音として扱う。
   あくまで「打ち間違いで通れなくなる」のを防ぐための寛容さ。 */
function foldLong(s) {
  var out = "", last = null;
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (c === "ー") { out += "ー"; last = null; continue; }
    if (last && EXT[last].indexOf(c) >= 0) { out += "ー"; last = null; continue; }
    out += c; last = VOWEL[c] || null;
  }
  return out;
}
function kanaKey(s) { return foldLong(norm(s)); }
/* expect: 正解の読みの配列（一語多読なら複数）。どれか一つに合えば正解。 */
function typedMatches(input, expect) {
  var k = kanaKey(input);
  if (!k) return false;
  return expect.some(function (x) { return kanaKey(x) === k; });
}
/* 読みの区切り（／・、）で一語多読を分ける */
function readings(r) {
  return String(r).split(/[／\/]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

/* ---------- 意味の重なり（同義で両方正解になるのを避ける） ---------- */
function meaningSegs(c) {
  return String(c || "").replace(/[（(][^）)]*[）)]/g, "").split(/[、，,；;／\/]/)
    .map(function (x) { return x.trim(); }).filter(Boolean);
}
function sameMeaning(a, b) {
  var sa = meaningSegs(a), sb = meaningSegs(b);
  return sa.some(function (x) { return sb.indexOf(x) >= 0; });
}

/* ---------- 選択肢の整え・検査 ---------- */
/* 前後の空白を除き、重複を消し、正解の位置を返す。正解が消えたら null。 */
function cleanOpts(opts, ans) {
  var correct = String(opts[ans]).trim(), seen = {}, out = [];
  opts.forEach(function (o) {
    var t = String(o).trim();
    if (!seen[t]) { seen[t] = 1; out.push(t); }
  });
  var idx = out.indexOf(correct);
  return idx < 0 ? null : { opts: out, ans: idx };
}
/* 出題が「正解が一つに決まる」形かどうか。問題がある場合は理由の配列を返す。 */
function questionIssues(q) {
  var bad = [];
  if (q.mode === "type") {
    if (!q.expect || !q.expect.length || q.expect.some(function (x) { return !kanaKey(x); })) bad.push("empty-expect");
    return bad;
  }
  if (!q.opts || q.opts.length < 2) { bad.push("too-few-options"); return bad; }
  if (typeof q.ans !== "number" || q.ans < 0 || q.ans >= q.opts.length) bad.push("answer-out-of-range");
  var seen = {};
  q.opts.forEach(function (o) {
    var t = String(o).trim();
    if (!t) bad.push("empty-option");
    if (seen[t]) bad.push("duplicate-option"); seen[t] = 1;
  });
  return bad;
}

var api = {
  norm: norm, foldLong: foldLong, kanaKey: kanaKey, typedMatches: typedMatches, readings: readings,
  meaningSegs: meaningSegs, sameMeaning: sameMeaning, cleanOpts: cleanOpts, questionIssues: questionIssues
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.AUDIT = api;
})(typeof window !== "undefined" ? window : this);
