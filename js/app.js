/* モリタン ドリル — N1 単語・文法 ドリル (PWA, no build step) */
(function () {
"use strict";

var $ = function (s, r) { return (r || document).querySelector(s); };
var el = function (t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.random() * (i + 1) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
var pick = function (a) { return a[Math.random() * a.length | 0]; };
var sampleNot = function (pool, n, not) {
  var out = [], seen = {}; seen[not] = 1;
  var s = shuffle(pool);
  for (var i = 0; i < s.length && out.length < n; i++) if (!seen[s[i]]) { seen[s[i]] = 1; out.push(s[i]); }
  return out;
};

var TODAY = SRS.today();

/* ---------------- store ----------------
   v1（旧エンジン）の記録は触らない・移行しない。v2 は別キーで最初から。
   読めないデータ（壊れた JSON）は黙って初期化しない: 警告を出し、保存を止め、
   スナップショットからの復元を案内する。 */
var KEY = "n1app.v2.state", TABKEY = "n1app.v2.tab", SNAPKEY = "n1app.v2.snaps", CORRKEY = "n1app.v2.corrupt";
var BUILD = "v18";
var ST = SYNC.defaults();
var SNAPS = [];
var STORE = { status: "new", raw: null, dropped: 0, writeError: "" };     // new | ok | corrupt | unavailable
(function loadStore() {
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { STORE.status = "unavailable"; STORE.writeError = String(e && e.message || e); return; }
  try {
    var rs = localStorage.getItem(SNAPKEY), a = rs ? JSON.parse(rs) : [];
    if (Array.isArray(a)) SNAPS = a.filter(function (x) { return x && typeof x.json === "string" && x.t > 0; });
  } catch (e) {}
  if (raw == null) return;
  var n = null;
  try {
    var o = JSON.parse(raw);
    if (o && typeof o === "object" && !Array.isArray(o) && !(o.cards != null && (typeof o.cards !== "object" || Array.isArray(o.cards)))) n = SYNC.normalizeState(o);
  } catch (e) {}
  if (!n || !n.ok) {
    STORE.status = "corrupt"; STORE.raw = raw;
    try { if (!localStorage.getItem(CORRKEY)) localStorage.setItem(CORRKEY, raw); } catch (e) {}
    return;
  }
  ST = n.state; STORE.status = "ok"; STORE.dropped = n.dropped;
  if (n.dropped) { try { if (!localStorage.getItem(CORRKEY)) localStorage.setItem(CORRKEY, raw); } catch (e) {} }
})();
function save() {
  if (STORE.status === "corrupt") return false;
  var prevErr = STORE.writeError;
  try {
    ST.schema = SYNC.SCHEMA; ST.savedAt = Date.now();
    if (Object.keys(ST.cards).length) ST.ltm[SRS.today()] = SRS.stats(ST.cards, SRS.today()).longTerm;
    localStorage.setItem(KEY, JSON.stringify(ST));
    STORE.status = "ok"; STORE.writeError = "";
    if (prevErr) paintAlert();
    return true;
  } catch (e) { STORE.writeError = String(e && e.message || e); if (!prevErr) paintAlert(); return false; }
}
/* 大きな操作（コーチ適用・復元・全部重設）の前に必ず呼ぶ。最新 3 件だけ残す。 */
function snapshot(reason) {
  if (STORE.status === "corrupt") return false;
  SNAPS = SYNC.pushSnapshot(SNAPS, ST, reason, Date.now(), 3);
  for (var i = 0; i < 3; i++) {
    try { localStorage.setItem(SNAPKEY, JSON.stringify(SNAPS)); return true; }
    catch (e) { if (SNAPS.length <= 1) break; SNAPS = SNAPS.slice(1); }
  }
  return false;
}
function day() { return ST.days[TODAY] || (ST.days[TODAY] = { n: 0, ok: 0, "new": 0, rev: 0, idk: 0 }); }
function accuracy(d) { var den = (d.n || 0) - (d.idk || 0); return den > 0 ? Math.round((d.ok || 0) / den * 100) : 0; }
var MVDN = function () { return ST.settings.mvdN; };
function putCard(id, s) { s.u = Date.now(); ST.cards[id] = s; }
function logAns(id, q, ok, b0, b1) {
  ST.log = SRS.ringPush(ST.log, { t: Date.now(), id: id, q: q, ok: ok, b0: b0, b1: b1 }, SYNC.LIMITS.log);
}
/* 安全な DOM 構築。貼り付け由来の文字は必ず textContent（innerHTML には入れない）。 */
function mk(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
/* textContent ＋ 限定的な **太字** だけ。HTML は一切解釈しない。 */
function rich(node, s) {
  node.textContent = "";
  String(s == null ? "" : s).split(/(\*\*[^*\n]+\*\*)/).forEach(function (p) {
    if (!p) return;
    if (/^\*\*[^*\n]+\*\*$/.test(p)) node.appendChild(mk("b", null, p.slice(2, -2)));
    else node.appendChild(document.createTextNode(p));
  });
  return node;
}
var pad2 = function (n) { return String(n).padStart(2, "0"); };
function fmtTime(ms) {
  var d = new Date(ms);
  return pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function fmtKB(n) { return (n / 1024).toFixed(n < 10240 ? 1 : 0) + "KB"; }

/* ---------------- speech ---------------- */
var SPEECH = "speechSynthesis" in window;
var jaVoice = null;
function pickVoice() {
  if (!SPEECH) return;
  var v = speechSynthesis.getVoices();
  jaVoice = v.filter(function (x) { return x.lang === "ja-JP"; })[0] ||
            v.filter(function (x) { return x.lang && x.lang.indexOf("ja") === 0; })[0] || null;
}
if (SPEECH) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(t, rate) {
  if (!SPEECH || !t) return;
  speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(t);
  u.lang = "ja-JP"; u.rate = rate || ST.settings.rate;
  if (jaVoice) u.voice = jaVoice;
  speechSynthesis.speak(u);
}
var SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';

/* ---------------- data ----------------
   日付の門（wake / 持ち越し）は廃止。全日份が最初から素材として存在し、
   何を出すかは SRS の状態（箱・期日）だけで決まる。
   項目 id: 単語 "w:語" / 陷阱句 "t:日:通し番号" / 文法 "g:形" */
var DAYNUMS = Object.keys(window.DAYS).map(Number).sort(function (a, b) { return a - b; });
var WORDS = [], TRAPS = [], PASSAGES = [], ITEM = {}, BYWORD = {};
var seq = 0;
function addWord(w) { w.id = "w:" + w.w; w.no = ++seq; WORDS.push(w); ITEM[w.id] = { t: "w", d: w }; BYWORD[w.w] = w; }
DAYNUMS.forEach(function (n) {
  var d = window.DAYS[n];
  (d.words || []).forEach(function (w) { w.deep = true; w.day = n; addWord(w); });
  (d.lite || []).forEach(function (a) {
    /* a[4] = 朝つけた印、a[5] = 例文の中文訳 */
    addWord({ w: a[0], r: a[1], c: a[2], ex: a[3] || "", exc: a[5] || "", note: "", deep: false, mark: !!a[4], day: n });
  });
  (d.traps || []).forEach(function (t, i) {
    t.day = n; t.id = "t:" + n + ":" + i; t.key = t.k || t.o[t.a];
    TRAPS.push(t); ITEM[t.id] = { t: "t", d: t };
  });
  (d.read || []).forEach(function (r, i) { PASSAGES.push({ day: n, i: i, t: r.t, sec: r.sec, html: r.html }); });
});
PASSAGES.sort(function (a, b) { return b.day - a.day; });
var GRAM = window.GRAMMAR;
GRAM.forEach(function (g) { g.id = "g:" + g.f; ITEM[g.id] = { t: "g", d: g }; });

/* 新規カードの順番: 陷阱句（語が一度復習に乗ったあとで解禁）→ 語を日份・番号順に、
   8 語ごとに文法を 1 つ挟む。「優先詞」は plan() 側で先頭に差し込まれる。 */
var ORDER = (function () {
  var out = TRAPS.map(function (t) { return t.id; }), gi = 0;
  WORDS.forEach(function (w, i) {
    out.push(w.id);
    if ((i + 1) % 8 === 0 && gi < GRAM.length) out.push(GRAM[gi++].id);
  });
  while (gi < GRAM.length) out.push(GRAM[gi++].id);
  return out;
})();
function canIntro(id) {
  var it = ITEM[id];
  if (it.t !== "t") return true;
  var w = ST.cards["w:" + it.d.key];
  return ITEM["w:" + it.d.key] ? !!w && w.box >= 2 : true;
}
function planCfg(extra) {
  var c = {
    newCap: ST.settings.newCap, extra: ST.extra[TODAY] || 0, priority: ST.priority,
    mode: "normal", exclude: {}, canIntroduce: canIntro
  };
  return Object.assign(c, extra || {});
}

var MEANINGS = WORDS.map(function (w) { return w.c; });
var READINGS = WORDS.map(function (w) { return w.r; });
var SURFACES = WORDS.map(function (w) { return w.w; });

/* 同音語は自動で拾う（確立/確率、意向/移行、企画/規格 …）。手で書かなくていい。
   一語多読（角＝かど／つの）は読みごとに登録する。 */
var HOMO = {};
WORDS.forEach(function (w) { AUDIT.readings(w.r).forEach(function (r) { (HOMO[r] = HOMO[r] || []).push(w.w); }); });
function homophones(w) {
  var out = [];
  AUDIT.readings(w.r).forEach(function (r) {
    (HOMO[r] || []).forEach(function (x) { if (x !== w.w && out.indexOf(x) < 0) out.push(x); });
  });
  return out;
}
/* 「正解が二つに見える」組み合わせ（稽古で見つけた詰まりの主因）:
   意味が重なる（禁止／禁じる、準備／用意 …）、片方の意味欄がもう片方の語そのもの。
   選択肢にこういう語を混ぜない。 */
function conflicts(a, b) {
  return AUDIT.sameMeaning(a.c, b.c) || AUDIT.meaningSegs(a.c).indexOf(b.w) >= 0 || AUDIT.meaningSegs(b.c).indexOf(a.w) >= 0;
}
function shareReading(a, b) {
  var ra = AUDIT.readings(a.r);
  return AUDIT.readings(b.r).some(function (x) { return ra.indexOf(x) >= 0; });
}
function uniqueTake(list, n) {
  var out = [], seen = {};
  shuffle(list).forEach(function (x) { if (!seen[x] && out.length < n) { seen[x] = 1; out.push(x); } });
  return out;
}
/* 誤答は「同音」→「同じ漢字で始まる」→「同じ読みの頭」→ 残り、の順で選ぶ（文中の語選び用）。
   でたらめな誤答だと消去法で当たってしまい、訓練にならない。意味が重なる語は除く。 */
function distractors(w, n) {
  var out = [], seen = {};
  seen[w.w] = 1;
  var ok = function (x) { var o = BYWORD[x]; return !o || !conflicts(w, o); };
  function take(list) {
    shuffle(list).forEach(function (x) {
      if (!seen[x] && out.length < n && ok(x)) { seen[x] = 1; out.push(x); }
    });
  }
  take(homophones(w));
  take(WORDS.filter(function (x) { return x.w[0] === w.w[0]; }).map(function (x) { return x.w; }));
  take(WORDS.filter(function (x) { return x.r[0] === w.r[0]; }).map(function (x) { return x.w; }));
  take(SURFACES);
  return out;
}
/* 音→意: 同音語の意味は誤答に入れない（耳で聞いて区別できないので両方正解になる）。 */
function meaningDistractors(w, n) {
  return uniqueTake(WORDS.filter(function (x) { return x.w !== w.w && !conflicts(w, x) && !shareReading(w, x); })
    .map(function (x) { return x.c; }).filter(function (c) { return c !== w.c; }), n);
}
/* 漢字→読み: 一語多読の「一部」が誤答に混ざらないよう、読みの集合が重ならないものだけ。 */
function readingDistractors(w, n) {
  return uniqueTake(WORDS.filter(function (x) { return x.w !== w.w && !shareReading(w, x); })
    .map(function (x) { return x.r; }), n);
}
function surfaceDistractors(w, n) {
  return uniqueTake(WORDS.filter(function (x) { return x.w !== w.w && !conflicts(w, x); }).map(function (x) { return x.w; }), n);
}
function gramFormDistractors(g, n) {
  return uniqueTake(GRAM.filter(function (x) { return x !== g && !AUDIT.sameMeaning(g.cn, x.cn); }).map(function (x) { return x.f; }), n);
}
function gramMeanDistractors(g, n) {
  return uniqueTake(GRAM.filter(function (x) { return x !== g && !AUDIT.sameMeaning(g.cn, x.cn); }).map(function (x) { return x.cn; }), n);
}

/* ---------------- question builders ---------------- */
var MODE_LABEL = { audio: "音→意", read: "漢字→読み", mean: "意味→語", cloze: "文中の語", type: "聞き取り→仮名",
  trap: "陷阱句", quiz: "文法（文）", form: "意味→文法", gmean: "文法→意味" };
/* 中文と日本語が同じ綴りになる語（改善→改善、維持→維持…）は
   「意味→語」にすると答えが問題文に出てしまう。その型だけ外す。 */
function sameSpelling(w) {
  return w.c.split(/[、（(]/)[0].trim() === w.w;
}
/* カタカナ語とかな副詞は「読み」が語そのもの。読みを選ばせると問題文に答えが出る。 */
function noReading(w) { return w.r === w.w; }
/* データの正解位置はほぼ全部 0（先頭）。そのまま出すと「一番上」が正解になるので並べ替える。
   前後の空白・重複は先に取り除く（重複があると「同じ選択肢なのに片方が不正解」になる）。 */
function shufOpts(o, a) {
  var c = AUDIT.cleanOpts(o, a);
  if (!c) return { opts: o.slice(), ans: -1 };
  var correct = c.opts[c.ans], s = shuffle(c.opts);
  return { opts: s, ans: s.indexOf(correct) };
}
/* 音が出せるか。日本語の声が無い端末で「聴いて答える」を出すと、絶対に答えられない。 */
function audioOK() {
  return SPEECH && (!!jaVoice || speechSynthesis.getVoices().length === 0);
}
/* 読み上げに使う文字。一語多読の語は漢字だと TTS が別の読み（角→かく）をするので、読みの仮名で言う。 */
function speakOf(w) { var rs = AUDIT.readings(w.r); return rs.length > 1 ? rs[0] : w.w; }
/* 「這題怪怪的」で外された型は、その語では出さない（ほかの型が残っていれば） */
function flaggedModes(id) {
  var m = [];
  ST.flags.forEach(function (f) { if (f.id === id && m.indexOf(f.q) < 0) m.push(f.q); });
  return m;
}
/* 箱で出題型が変わる:
   box 0–2 = 音→意・漢字→読み / box ≥3 = ＋意味→語・文中の語 / box ≥4 = ＋聞き取り→仮名入力 */
function wordQ(w, box, noType, avoid) {
  var bag = ["audio", "audio"], snd = audioOK();
  if (!noReading(w)) bag.push("read");
  if (box >= 3) {
    if (!sameSpelling(w)) bag.push("mean");
    if (w.ex && w.ex.indexOf("<b>") >= 0) bag.push("cloze", "cloze");
  }
  if (box >= 4 && snd && !noType && !noReading(w)) bag.push("type", "type");
  if (!snd) bag = bag.filter(function (x) { return x !== "audio"; });
  var kept = bag.filter(function (x) { return !avoid || avoid.indexOf(x) < 0; });
  if (kept.length) bag = kept;
  if (!bag.length) {                                   // 声が無い＋カタカナ語: ほかの型で代用（最後は audio）
    if (!sameSpelling(w)) bag = ["mean"];
    else if (w.ex && w.ex.indexOf("<b>") >= 0) bag = ["cloze"];
    else bag = ["audio"];
  }
  var mode = pick(bag);
  var base = { id: w.id, kind: "w", word: w, mode: mode };
  if (mode === "type") {
    var exp = AUDIT.readings(w.r);
    return Object.assign(base, { head: "聴いて仮名で書く", audio: exp[0], expect: exp, show: exp.join("／") });
  }
  if (mode === "cloze") {
    var o0 = shuffle([w.w].concat(distractors(w, 3)));
    return Object.assign(base, {
      head: "文に合う語を選ぶ",
      sent: w.ex.replace(/<b>[\s\S]*?<\/b>/, "＿＿").replace(/<\/?b>/g, ""),
      opts: o0, ans: o0.indexOf(w.w), jp: true
    });
  }
  if (mode === "audio") {
    var o = shuffle([w.c].concat(meaningDistractors(w, 3)));
    return Object.assign(base, { head: "聴いて意味を選ぶ", audio: speakOf(w), opts: o, ans: o.indexOf(w.c) });
  }
  if (mode === "read") {
    var o2 = shuffle([w.r].concat(readingDistractors(w, 3)));
    return Object.assign(base, { head: "読みを選ぶ", kanji: w.w, opts: o2, ans: o2.indexOf(w.r) });
  }
  var o3 = shuffle([w.w].concat(surfaceDistractors(w, 3)));
  return Object.assign(base, { head: "この意味の語は", cn: w.c, opts: o3, ans: o3.indexOf(w.w), jp: true });
}
function trapQ(t) {
  // 活用した形を選ばせる問題があるので、見出し語は t.key（= t.k || 正解の語）
  var w = ITEM["w:" + t.key] ? ITEM["w:" + t.key].d : { w: t.key, r: "", c: "", ex: "", note: "" };
  var s = shufOpts(t.o, t.a);
  return { id: t.id, kind: "w", word: w, mode: "trap", head: "文に合う語を選ぶ", sent: t.s,
    opts: s.opts, ans: s.ans, jp: true, why: t.why };
}
function gramQ(g, box, avoid) {
  var modes = box >= 3 ? ["quiz", "quiz", "form", "gmean"] : ["quiz", "quiz", "gmean"];
  var kept = modes.filter(function (x) { return !avoid || avoid.indexOf(x) < 0; });
  var mode = pick(kept.length ? kept : modes);
  var base = { id: g.id, kind: "g", gram: g };
  if (mode === "quiz") {
    var s = shufOpts(g.q.o, g.q.a);
    return Object.assign(base, { mode: "quiz", head: "文に合う文法を選ぶ", sent: g.q.s, opts: s.opts, ans: s.ans, why: g.q.why });
  }
  if (mode === "form") {
    var o2 = shuffle([g.f].concat(gramFormDistractors(g, 3)));
    return Object.assign(base, { mode: "form", head: "この意味の文法は", cn: g.cn, opts: o2, ans: o2.indexOf(g.f), jp: true });
  }
  var o3 = shuffle([g.cn].concat(gramMeanDistractors(g, 3)));
  return Object.assign(base, { mode: "gmean", head: "意味を選ぶ", form: g.f, opts: o3, ans: o3.indexOf(g.cn) });
}
/* 出題を作る。「正解が一つに決まらない」形（選択肢の重複・正解が消えた等）が出たら作り直し、
   四回やって駄目なら null（呼び出し側が自動で「怪怪的」として記録し、この場では飛ばす）。 */
function makeQ(id, o) {
  o = o || {};
  var it = ITEM[id], st = ST.cards[id], box = o.box != null ? o.box : (st ? st.box : 0), avoid = flaggedModes(id);
  for (var k = 0; k < 4; k++) {
    var q = it.t === "w" ? wordQ(it.d, box, o.noType, avoid) : it.t === "t" ? trapQ(it.d) : gramQ(it.d, box, avoid);
    q.box = box;
    if (!AUDIT.questionIssues(q).length) return q;
  }
  return null;
}
function lookup(id) {
  var it = ITEM[id];
  if (!it) return { label: id, sub: "", cn: "" };
  if (it.t === "w") return { label: it.d.w, sub: it.d.r, cn: it.d.c };
  if (it.t === "t") { var w = ITEM["w:" + it.d.key]; return { label: it.d.key + "（陷阱句）", sub: w ? w.d.r : "", cn: w ? w.d.c : "" }; }
  return { label: it.d.f, sub: it.d.y, cn: it.d.cn };
}

/* ---------------- card HTML ---------------- */
/* 例文は答えたあとにだけ出る。タップで読み上げ、下に中文訳。
   訳は「読めたつもり」を潰すためのもので、先に見せたら意味がない。 */
function exBlock(o) {
  if (!o.ex) return "";
  var plain = o.ex.replace(/<[^>]+>/g, "").replace(/"/g, "");
  return '<button class="exline" data-say="' + plain + '">' +
    '<span class="jp">' + o.ex + '</span><span class="ico">' + SPK + '</span></button>' +
    (o.exc ? '<p class="exc">' + o.exc + '</p>' : "");
}
function knetHTML(w) {
  if (!w.rel || !w.rel.length) return "";
  return w.rel.map(function (r) {
    return '<div class="knet"><div class="khead"><span class="kj">' + r.k + '</span>' +
      (r.on ? '<span class="on">' + r.on + '</span>' : "") +
      (r.kun ? '<span class="kun">' + r.kun + '</span>' : "") + '</div>' +
      '<div class="krow">' + r.ws.map(function (x) {
        return '<button class="kw" data-say="' + x[0] + '"><span class="a">' + x[0] +
          '</span><span class="b">' + x[1] + '</span><span class="c">' + x[2] + '</span></button>';
      }).join("") + '</div></div>';
  }).join("");
}
function revealBody(q) {
  if (q.kind === "g") {
    var g = q.gram;
    return '<div class="rd"><span class="k" style="font-size:22px">' + g.f + '</span>' +
      '<span class="y">' + g.y + '</span><span class="c">' + g.cn + '</span></div>' +
      '<p class="conn">' + g.conn + '</p>' + exBlock(g) +
      (q.why ? '<p class="note">' + q.why + '</p>' : "") +
      (g.trap ? '<p class="note">' + g.trap + '</p>' : "");
  }
  var w = q.word, ho = homophones(w);
  return '<div class="rd"><span class="k">' + w.w + '</span><span class="y">' + w.r + '</span>' +
    '<span class="c">' + w.c + '</span></div>' +
    (ho.length ? '<p class="note">⚠️ 同音：<b>' + ho.join("・") + '</b> — 読みだけでは決まらない。文脈で選ぶ。</p>' : "") +
    exBlock(w) +
    (q.why ? '<p class="note">' + q.why + '</p>' : "") +
    (w.note ? '<p class="note">' + w.note + '</p>' : "") +
    knetHTML(w);
}
function wireSay(root) {
  Array.prototype.forEach.call(root.querySelectorAll("[data-say]"), function (b) {
    b.onclick = function (ev) { ev.preventDefault(); say(b.dataset.say, b.className === "exline" ? Math.min(1.2, ST.settings.rate + 0.1) : ST.settings.rate); };
  });
}
/* 新カードの初回提示: 先に答えを見せる（その後、同じ場で 2 回取り出させる） */
function introHTML(id) {
  var it = ITEM[id], q;
  if (it.t === "w") q = { kind: "w", word: it.d };
  else if (it.t === "g") q = { kind: "g", gram: it.d, why: it.d.q.why };
  else {
    var w = ITEM["w:" + it.d.key];
    q = { kind: "w", word: w ? w.d : { w: it.d.key, r: "", c: "", ex: "", note: "" }, why: it.d.why };
  }
  var lead = "";
  if (it.t === "t") lead = '<p class="prompt sent">' + it.d.s.replace("＿＿", "<b>" + it.d.o[it.d.a] + "</b>") + '</p>';
  var kind = it.t === "g" ? "文法" : it.t === "t" ? "陷阱句" : "単語";
  return '<div class="card"><div class="plate-top"><span class="eyebrow">新しいカード · ' + kind +
    ' · まず見る</span><span class="daytag">' + (it.d.day ? it.d.day + "日目" : "N2 文法") + '</span></div>' +
    lead + '<div class="reveal" style="border-top:0;padding-top:0">' + revealBody(q) +
    '<button class="next" id="nx">覚えた — 続ける</button></div></div>';
}
/* 出題カード。onPick を一度だけ呼ぶ:
   {good, n} 選んだ / {skipped} わからない / {skip} 仮名入力を飛ばす / {flag} 這題怪怪的 / {known} 我熟了 */
function qPrompt(q) {
  return q.kanji || q.cn || q.form || (q.sent ? q.sent : q.audio ? "（音声）" + q.audio : "");
}
function showQ(host, q, tag, onPick, opt) {
  opt = opt || {};
  var body =
    q.audio ? '<button class="speak" id="spk">' + SPK + 'もう一度 聞く</button>' +
              '<button class="linkbtn" id="nosnd">音が出ない？ — 語を見る</button><p class="prompt kanji" id="sndword" hidden></p>' :
    q.kanji ? '<p class="prompt kanji">' + q.kanji + '</p>' :
    q.form  ? '<p class="prompt form">' + q.form + '</p>' :
    q.cn    ? '<p class="prompt cn">' + q.cn + '</p>' :
              '<p class="prompt sent">' + q.sent.replace("＿＿", "<b>＿＿</b>") + '</p>';
  var inner = q.mode === "type"
    ? '<div class="typebox"><input id="tin" type="text" inputmode="text" lang="ja" autocomplete="off" ' +
      'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ひらがなで入力（ー・カタカナ可）">' +
      '<button class="next" id="tok">確認</button></div>' +
      '<button class="idk" id="tskip">スキップ（今は打てない）</button>'
    : '<div class="choices" id="ch">' + q.opts.map(function (o, n) {
        return '<button class="choice' + (q.jp ? " jp" : "") + '" data-n="' + n + '">' +
          '<span class="idx">' + (n + 1) + '</span><span></span></button>';
      }).join("") + '</div>';
  host.innerHTML = '<div class="card">' +
    '<div class="plate-top"><span class="eyebrow">' + (q.kind === "g" ? "文法" : "単語") + ' · ' + q.head + '</span>' +
    '<span class="daytag" id="qtag"></span></div>' + body + inner +
    /* 当てずっぽうで正解してしまうと、覚えたことになってしまう。
       「実は分かっていない」と自分で言えるようにしておく。 */
    '<button class="idk" id="idk">わからない — 答えを見る</button>' +
    '<div class="qtools" id="qtools"><button class="linkbtn" id="qflag">這題怪怪的</button>' +
    (opt.noKnown ? "" : '<button class="linkbtn" id="qknown">我熟了</button>') + '</div>' +
    '<div id="rev"></div></div>';
  $("#qtag").textContent = tag;
  if (q.opts) Array.prototype.forEach.call($("#ch").children, function (b, i) { b.lastChild.textContent = q.opts[i]; });

  var done = false;
  function once(r) { if (done) return; done = true; onPick(r); }
  if (q.audio) {
    say(q.audio); $("#spk").onclick = function () { say(q.audio); };
    $("#nosnd").onclick = function () { var p = $("#sndword"); p.textContent = q.word.w; p.hidden = false; this.hidden = true; };
  }
  if (q.mode === "type") {
    var tin = $("#tin");
    var submit = function () {
      if (!AUDIT.kanaKey(tin.value)) return;
      once({ good: AUDIT.typedMatches(tin.value, q.expect), typed: tin.value.trim() });
    };
    $("#tok").onclick = submit;
    tin.onkeydown = function (e) { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submit(); };
    $("#tskip").onclick = function () { once({ skip: true }); };
    setTimeout(function () { try { tin.focus({ preventScroll: true }); } catch (e) {} }, 50);
  } else {
    Array.prototype.forEach.call($("#ch").children, function (b) {
      b.onclick = function () { var n = +b.dataset.n; once({ good: n === q.ans, n: n }); };
    });
  }
  $("#idk").onclick = function () { once({ skipped: true, n: -1 }); };
  $("#qflag").onclick = function () { once({ flag: true }); };
  var kn = $("#qknown"); if (kn) kn.onclick = function () { once({ known: true }); };
}

/* ---------------- drill session ---------------- */
var S = null, cur = null, D = null;
var GAP_FIRST = 3, GAP_SECOND = 7, GAP_PRACTICE = 4, MAX_LEARN_MISSES = 3;

function sessCfg() {
  return planCfg({ mode: S.mode, mvdLimit: MVDN() - S.mvdDone, exclude: S.handled });
}
function nextItem() {
  var p = SRS.plan(ORDER, ST.cards, TODAY, sessCfg());
  /* 学習中のカード（同場の再取り出し）は、間を空けたあと最優先で戻す */
  for (var i = 0; i < S.learnQ.length; i++) {
    if (S.learnQ[i].at <= S.counter) { var e = S.learnQ.splice(i, 1)[0]; return { id: e.id, practice: e.practice }; }
  }
  if (p.due.length) return { id: p.due[0], fromPlan: true };
  if (p.newIds.length) return { id: p.newIds[0], intro: true };
  if (S.learnQ.length) { var e2 = S.learnQ.shift(); return { id: e2.id, practice: e2.practice }; }
  return null;
}
function remaining() {
  var p = SRS.plan(ORDER, ST.cards, TODAY, sessCfg());
  return p.due.length + p.newCount + S.learnQ.length;
}
function paintProgress() {
  var rail = $("#rail"), left = D ? D.ids.length - D.i : S ? remaining() : 0;
  var tot = D ? D.ids.length : S ? S.answered + S.introN + left : 0;
  var done = tot - left;
  rail.style.width = (tot ? done / tot * 100 : 0).toFixed(1) + "%";
  rail.className = tot && !left ? "done" : "";
  $("#daytag").textContent = D ? "延遲測驗 " + D.i + "/" + D.ids.length
    : S ? (S.mode === "mvd" ? "5分 · " : "") + "残り " + left : "";
}

function startSession(mode, bonus) {
  TODAY = SRS.today();
  D = null;
  if (bonus && mode !== "mvd") { ST.extra[TODAY] = (ST.extra[TODAY] || 0) + 10; save(); }
  S = { mode: mode, handled: {}, learnQ: [], counter: 0, answered: 0, introN: 0, ok: 0, streak: 0, best: 0, tries: {}, flagged: 0,
        mvdDone: bonus && mode === "mvd" ? MVDN() - 10 : 0 };
  renderSessionShell();
  step();
}
function renderSessionShell() {
  var v = $("#view-drill");
  v.innerHTML = '<div class="sesshead"><span class="hint" id="sinfo"></span>' +
    '<button class="mini" id="sexit">終了</button></div><div id="qhost"></div>';
  $("#sinfo").textContent = S.mode === "mvd" ? "只複習 5 分鐘（新詞なし）" : "復習 → 新詞";
  $("#sexit").onclick = function () { endSession(true); };
}
function toast(host, msg) {
  var p = mk("p", "toast", msg);
  host.insertBefore(p, host.firstChild);
}
function step() {
  var n = nextItem(), host = $("#qhost");
  if (!n) { endSession(false); return; }
  S.counter++;
  if (n.intro) { showIntro(n.id, host); return; }
  cur = makeQ(n.id);
  if (!cur) {                                          // 出題が作れない = データ側の問題。記録して飛ばす
    flagCard({ id: n.id, mode: "auto", head: "自動検出", opts: [], ans: -1 }, "auto");
    S.handled[n.id] = 1; dropLearn(n.id); S.flagged++;
    S.toast = "この題は作れなかった（記録した）";
    step(); return;
  }
  cur.practice = !!n.practice; cur.fromPlan = !!n.fromPlan;
  var it = ITEM[n.id];
  showQ(host, cur, (n.practice ? "もう一度 · " : "") + (it.t === "g" ? "N2 文法" : (it.d.day || "") + "日目"), answerDrill);
  if (S.toast) { toast(host, S.toast); S.toast = ""; }
  paintProgress();
}
function dropLearn(id) { S.learnQ = S.learnQ.filter(function (e) { return e.id !== id; }); }
function showIntro(id, host) {
  var it = ITEM[id];
  host.innerHTML = introHTML(id);
  wireSay(host);
  if (it.t === "w") say(speakOf(it.d));
  var nx = $("#nx");
  nx.onclick = function () {
    putCard(id, SRS.introduce(TODAY));
    SRS.bumpDay(ST.days, TODAY, { introduced: true });
    S.handled[id] = 1; S.introN++;
    S.learnQ.push({ id: id, at: S.counter + GAP_FIRST });
    save();
    step(); window.scrollTo(0, 0);
  };
  nx.focus({ preventScroll: true });
  paintProgress();
}

function nextText(before, after, result) {
  if (result === "ok") {
    if (after.box === 0) return "もう一度（学習中）";
    if (before.box === 0) return "覚えた — 明日また";
    return "次は " + SRS.INTERVALS[after.box] + " 日後" + (after.box >= SRS.LONG_BOX ? " · 長期記憶" : "");
  }
  return before.box === 0 ? "もう一度（学習中）" : "箱 1 に戻る — 明日また";
}

/* 這題怪怪的: 題面を残して記録する。成績にも日別にも数えない（中立）。 */
function flagCard(q, kind) {
  ST.flags = SRS.ringPush(ST.flags, {
    t: Date.now(), id: q.id, q: q.mode || "?",
    snap: { head: q.head || "", prompt: String(qPrompt(q)).slice(0, 300), opts: (q.opts || []).slice(0, 8), ans: typeof q.ans === "number" ? q.ans : -1 }
  }, SYNC.LIMITS.flags);
  save();
}

function answerDrill(res) {
  var q = cur;
  if (res.skip) { step(); return; }                    // 仮名入力のスキップ: 記録なし
  if (res.flag) {
    flagCard(q); S.handled[q.id] = 1; dropLearn(q.id); S.flagged++;
    S.toast = "記録した — この題は今回スキップ（成績には入らない）";
    step(); window.scrollTo(0, 0); return;
  }
  if (res.known) {
    var b0 = ST.cards[q.id] ? ST.cards[q.id].box : 0;
    putCard(q.id, SRS.markKnown(ST.cards[q.id], TODAY));
    logAns(q.id, "known", "known", b0, SRS.KNOWN_BOX);
    S.handled[q.id] = 1; dropLearn(q.id);
    S.toast = "箱 5 にした — 次は 30 日後";
    save(); step(); window.scrollTo(0, 0); return;
  }
  var result = res.skipped ? "idk" : res.good ? "ok" : "miss";
  var text = "練習 — 記録には入らない";
  if (!q.practice) {
    var before = ST.cards[q.id] || SRS.introduce(TODAY);
    var after = SRS.grade(before, result, TODAY, q.mode);
    /* 学習中に何度も外すカードで場が終わらなくなるのを防ぐ: 3 回外したら明日に回す */
    var giveUp = before.box === 0 && result !== "ok" && (S.tries[q.id] = (S.tries[q.id] || 0) + 1) >= MAX_LEARN_MISSES;
    if (giveUp) after.due = SRS.addDays(TODAY, 1);
    putCard(q.id, after);
    SRS.bumpDay(ST.days, TODAY, { answer: result, review: before.box >= 1 });
    logAns(q.id, q.mode, result, before.box, after.box);
    S.handled[q.id] = 1; S.answered++;
    if (q.fromPlan && S.mode === "mvd") S.mvdDone++;
    if (before.box === 0) {
      if (after.box === 0 && !giveUp) S.learnQ.push({ id: q.id, at: S.counter + (result === "ok" ? GAP_SECOND : GAP_FIRST) });
    } else if (result !== "ok") {
      S.learnQ.push({ id: q.id, at: S.counter + GAP_PRACTICE, practice: true });
    }
    text = giveUp ? "今日はここまで — 明日また" : nextText(before, after, result);
  }
  if (result === "ok") { S.ok++; S.streak++; if (S.streak > S.best) S.best = S.streak; } else S.streak = 0;
  save();
  paintProgress();

  if (q.mode === "type") {
    $("#tin").disabled = true; $("#tok").disabled = true;
    var sk = $("#tskip"); if (sk) sk.remove();
    $("#tin").value = res.typed != null ? res.typed : q.show;
  } else {
    Array.prototype.forEach.call($("#ch").children, function (b, i) {
      b.disabled = true;
      if (i === q.ans) b.className += res.skipped ? " is-idk" : " is-ok";
      else if (i === res.n) b.className += " is-no";
    });
  }
  var idk = $("#idk"); if (idk) idk.remove();
  var qt = $("#qtools"); if (qt) qt.remove();

  var typedAns = q.mode === "type" ? '<p class="note">答え：<b>' + q.show + '</b></p>' : "";
  $("#rev").innerHTML = '<div class="reveal">' +
    '<div class="verdict ' + (result === "idk" ? "idk" : result === "ok" ? "ok" : "no") + '"><span>' +
    (result === "idk" ? "わからない" : result === "ok" ? "正解" : "不正解") + '</span>' +
    '<span class="streak">' + text + '</span></div>' +
    typedAns + revealBody(q) + coachNote(q.id) +
    '<button class="linkbtn" id="qflag2">この判定がおかしい（記録して次へ）</button>' +
    '<button class="next" id="nx">つぎへ</button></div>';
  if (q.kind !== "g" && !q.audio) say(speakOf(q.word));
  wireSay($("#rev"));
  fillCoachNotes($("#rev"));
  /* 答えを見たあとでも「選択肢が二つとも正しかった」等に気づける。記録のみ、成績は変えない。 */
  $("#qflag2").onclick = function () { flagCard(q); S.flagged++; S.toast = "記録した（この回の成績はそのまま）"; step(); window.scrollTo(0, 0); };
  var nx = $("#nx");
  nx.onclick = function () { step(); window.scrollTo(0, 0); };
  nx.focus({ preventScroll: true });
}
/* 教練の詞注解（pasted）。textContent＋**太字** だけ。 */
function coachNote(id) {
  var t = ST.notes[id];
  if (!t) return "";
  return '<p class="note coach" data-note="' + id.replace(/"/g, "") + '"></p>';
}
function fillCoachNotes(root) {
  Array.prototype.forEach.call(root.querySelectorAll("[data-note]"), function (p) {
    rich(p, "教練：" + (ST.notes[p.getAttribute("data-note")] || ""));
  });
}

function endSession(manual) {
  if (SPEECH) speechSynthesis.cancel();
  var s = S; S = null; cur = null;
  $("#rail").style.width = "0%";
  showHome(s, manual);
}

/* ---------------- delayed test ---------------- */
function startDelayed() {
  TODAY = SRS.today();
  var ids = SRS.delayedSample(ST.cards, TODAY, 20).filter(function (id) { return ITEM[id]; });
  if (!ids.length) return;
  S = null;
  D = { ids: ids, i: 0, right: 0, wrong: [], neutral: 0 };
  $("#view-drill").innerHTML = '<div class="sesshead"><span class="hint">延遲測驗 — ヒントも即時の答え合わせもなし</span>' +
    '<button class="mini" id="sexit">やめる</button></div><div id="qhost"></div>';
  $("#sexit").onclick = function () { D = null; $("#rail").style.width = "0%"; showHome(null); };
  stepDelayed();
}
function stepDelayed() {
  if (D.i >= D.ids.length) { finishDelayed(); return; }
  var id = D.ids[D.i], st = ST.cards[id];
  cur = makeQ(id, { box: Math.max(3, st ? st.box : 3), noType: true });
  if (!cur) { flagCard({ id: id, mode: "auto", head: "自動検出", opts: [], ans: -1 }); D.ids.splice(D.i, 1); D.neutral++; stepDelayed(); return; }
  showQ($("#qhost"), cur, (D.i + 1) + " / " + D.ids.length, function (res) {
    if (res.skip) { D.ids.splice(D.i, 1); D.neutral++; stepDelayed(); return; }
    if (res.flag) { flagCard(cur); D.ids.splice(D.i, 1); D.neutral++; window.scrollTo(0, 0); stepDelayed(); return; }
    var result = res.skipped ? "idk" : res.good ? "ok" : "miss";
    var after = SRS.grade(st, result, TODAY, cur.mode);
    putCard(id, after);
    SRS.bumpDay(ST.days, TODAY, { answer: result, review: true });
    logAns(id, cur.mode, result, st.box, after.box);
    if (result === "ok") D.right++; else D.wrong.push(id);
    D.i++; save(); paintProgress(); window.scrollTo(0, 0);
    stepDelayed();
  }, { noKnown: true });
  paintProgress();
}
function finishDelayed() {
  var r = D; D = null;
  var n = r.ids.length;
  if (n) ST.delayed = SRS.ringPush(ST.delayed, { date: TODAY, n: n, correct: r.right }, SYNC.LIMITS.delayed);
  save();
  $("#rail").style.width = "0%";
  var v = $("#view-drill");
  v.innerHTML = '<div class="stack"><div class="card"><span class="eyebrow">延遲測驗 · 結果</span>' +
    (n ? '<div class="score"><div><div class="n">' + r.right + '<small>/' + n + '</small></div><div class="l">正解</div></div>' +
    '<div><div class="n">' + Math.round(r.right / n * 100) + '<small>%</small></div><div class="l">14日以上あとの正解率</div></div></div>' : '<p class="hint">答えた問題がなかった。</p>') +
    (r.neutral ? '<p class="hint">スキップ／記録した題 ' + r.neutral + ' 問は数えていない。</p>' : "") +
    (r.wrong.length ? '<ul class="miss">' + r.wrong.map(function (id) {
      var x = lookup(id);
      return '<li><span class="k">' + x.label + '</span>' + (x.sub ? '<span class="y">' + x.sub + '</span>' : "") +
        (x.cn ? '<span class="c">' + x.cn + '</span>' : "") + '</li>';
    }).join("") + '</ul><p class="hint">間違えた語は箱 1 に戻り、明日から復習に出る。</p>'
      : (n ? '<p class="hint">全問正解。</p>' : "")) +
    '<button class="next" id="back">ホームへ</button></div></div>';
  $("#back").onclick = function () { showHome(null); };
}

/* ---------------- home ---------------- */
function dayWordIds(n) { return WORDS.filter(function (w) { return w.day === n; }).map(function (w) { return w.id; }); }

function renderDrill() { showHome(null); }
function showHome(summary, manual) {
  TODAY = SRS.today();
  S = null; D = null;
  var v = $("#view-drill"), st = SRS.stats(ST.cards, TODAY);
  var p = SRS.plan(ORDER, ST.cards, TODAY, planCfg());
  var strk = SRS.streak(ST.days, TODAY);
  var elig = SRS.delayedEligible(ST.cards, TODAY).length;
  var td = ST.days[TODAY], active = !!td && td.n + td["new"] > 0;
  var html = '<div class="stack">';

  if (summary) {
    html += '<div class="card"><span class="eyebrow">' + (manual ? "ここまで" : "今日の分は完了") + '</span>' +
      '<p class="hint">この場で <b>' + summary.answered + '</b> 問に答え（正解 ' + summary.ok + '）、新詞 <b>' + summary.introN + '</b> 枚。' +
      (summary.flagged ? ' 「怪怪的」記録 <b>' + summary.flagged + '</b> 件（成績には入れていない）。' : "") +
      (!manual ? (p.dueAll ? "復習はまだ " + p.dueAll + " 枚残っている（明日以降でもいい。続けることが目的）。" : "到期の復習は清算済み。") : "") + '</p>' +
      '<button class="next ghost" id="more">再來 10 題</button></div>';
  }

  if (ST.coachMsg) html += '<div class="card coachcard"><span class="eyebrow">教練より</span><p class="coachmsg" id="cmsg"></p></div>';

  html += '<div class="card"><span class="eyebrow">' + TODAY + '</span>' +
    '<div class="score">' +
      '<div><div class="n">' + p.dueAll + '</div><div class="l">今日到期</div></div>' +
      '<div><div class="n">' + p.introduced + '<small>/' + (ST.settings.newCap + (ST.extra[TODAY] || 0)) + '</small></div><div class="l">新詞</div></div>' +
      '<div><div class="n">' + st.longTerm + '</div><div class="l">長期記憶</div></div>' +
      '<div><div class="n">' + strk + '</div><div class="l">連続日数</div></div>' +
    '</div>' +
    '<button class="next" id="go">開始</button>' +
    '<button class="next ghost small" id="mvd">只複習 5 分鐘</button>' +
    '<p class="hint">復習 <b>' + p.dueAll + '</b> 枚を先に片づけてから新詞 <b>' + p.newCount + '</b> 枚。' +
    (p.dueAll > 40 ? '<br>たまっているときは「5 分」だけでいい。1 日 ' + MVDN() + ' 枚ずつ減らしていく。' : '') + '</p></div>';

  if (active && !summary && ST.sync.lastExportAt < Date.parse(TODAY + "T00:00:00")) {
    html += '<div class="card"><span class="eyebrow">同期</span><p class="hint">今日の記録はまだ教練に送っていない。</p>' +
      '<button class="next ghost small" id="tosync">設定 → 同期包をコピー</button></div>';
  }

  html += '<div class="card"><span class="eyebrow">延遲測驗</span>' +
    '<p class="hint">14 日以上前に答えた語（箱 3 以上）から 20 問、ヒントなし・答え合わせは最後。「本当に覚えたか」の指標。<b>対象 ' + elig + ' 枚</b></p>' +
    (ST.delayed.length ? '<p class="hint">' + ST.delayed.slice(-3).map(function (x) {
      return x.date.slice(5) + " " + x.correct + "/" + x.n;
    }).join(" · ") + '</p>' : "") +
    '<button class="next ghost" id="dly"' + (elig ? "" : " disabled") + '>延遲測驗を始める</button></div>';

  v.innerHTML = html + '</div>';
  if (ST.coachMsg) rich($("#cmsg"), ST.coachMsg.m);
  $("#go").onclick = function () { startSession("normal"); };
  $("#mvd").onclick = function () { startSession("mvd"); };
  var more = $("#more");
  if (more) more.onclick = function () { startSession(summary.mode === "mvd" ? "mvd" : "normal", true); };
  var ts = $("#tosync"); if (ts) ts.onclick = function () { show("settings"); };
  $("#dly").onclick = startDelayed;
  $("#rail").style.width = "0%";
  $("#daytag").textContent = "長期記憶 " + st.longTerm;
  window.scrollTo(0, 0);
}



/* ---------------- 漢字 view ---------------- */
function renderKanji() {
  var map = {}, order = [], learned = WORDS.filter(function (w) { return ST.cards[w.id]; });
  learned.forEach(function (w) {
    (w.rel || []).forEach(function (r) {
      if (!map[r.k]) { map[r.k] = { k: r.k, on: r.on, kun: r.kun, ws: [], from: [] }; order.push(r.k); }
      r.ws.forEach(function (x) {
        if (!map[r.k].ws.some(function (y) { return y[0] === x[0]; })) map[r.k].ws.push(x);
      });
      if (map[r.k].from.indexOf(w.w) === -1) map[r.k].from.push(w.w);
    });
  });
  var v = $("#view-kanji");
  v.innerHTML = '<div class="stack"><div class="card">' +
    '<span class="eyebrow">学んだ語 ' + learned.length + ' · 漢字ネットワーク</span>' +
    '<h2>一語を三語に増やす</h2>' +
    '<p class="hint">意思你本來就懂，缺的只有音。同一個漢字的其他組合一起記，邊際成本幾乎是零。<b>點任何一個詞會念給你聽。</b>' +
    (order.length ? '' : '<br>まだ学んだ語がない。ドリルで新詞を出すと、ここに増えていく。') + '</p>' +
    '</div>' + order.map(function (k) {
      var m = map[k];
      return '<div class="card"><div class="khead"><span class="kj">' + m.k + '</span>' +
        (m.on ? '<span class="on">' + m.on + '</span>' : "") +
        (m.kun ? '<span class="kun">' + m.kun + '</span>' : "") +
        '<span class="tag" style="margin-left:auto;font-size:11px;color:var(--muted)">' + m.from.join("・") + '</span></div>' +
        '<div class="krow">' + m.ws.map(function (x) {
          return '<button class="kw" data-say="' + x[0] + '"><span class="a">' + x[0] +
            '</span><span class="b">' + x[1] + '</span><span class="c">' + x[2] + '</span></button>';
        }).join("") + '</div></div>';
    }).join("") + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll(".kw"), function (b) {
    b.onclick = function () { say(b.dataset.say); };
  });
}


/* ---------------- 文法 view ---------------- */
function renderGrammar() {
  var v = $("#view-grammar"), groups = [], byG = {};
  GRAM.forEach(function (g) { if (!byG[g.g]) { byG[g.g] = []; groups.push(g.g); } byG[g.g].push(g); });
  var html = '<div class="stack"><div class="card">' +
    '<span class="eyebrow">N2 復習 · ' + GRAM.length + ' 項目</span>' +
    '<h2>「印象はある」を「選べる」に</h2>' +
    '<p class="hint">你 N2 這些都看過，問題是<b>選項擺在一起時分不出來</b>。每一條的最後一行就是那個分界點。文法カードもドリルの新詞に混ざって出る（8 語ごとに 1 つ）。</p>' +
    '</div>';
  groups.forEach(function (gr) {
    html += '<div class="gsec">' + gr + '</div>';
    byG[gr].forEach(function (g) {
      html += '<details class="gitem"><summary><span class="f">' + g.f + '</span>' +
        '<span class="m">' + g.cn + '</span></summary><div class="gbody">' +
        '<p class="conn">' + g.conn + '</p>' +
        exBlock(g) +
        '<p class="note">' + g.trap + '</p>' +
        '</div></details>';
    });
  });
  v.innerHTML = html + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll("[data-say]"), function (b) {
    b.onclick = function (e) { e.preventDefault(); say(b.dataset.say, 0.95); };
  });
}

/* ---------------- 読解 view ---------------- */
var t0 = null, tick = null, activeP = 0, reading = null;
function fmt(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function sentences(html) {
  return html.split("。").map(function (x) { return x.trim(); })
             .filter(function (x) { return x; }).map(function (x) { return x + "。"; });
}
function stopReading() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  reading = null;
  Array.prototype.forEach.call(document.querySelectorAll(".sx.on"), function (e) { e.className = "sx"; });
  Array.prototype.forEach.call(document.querySelectorAll("[data-play]"), function (b) {
    b.textContent = b.dataset.label;
  });
}
/* 一文ずつ読み上げて、いま読んでいる文を光らせる。
   自分で音読したあとに流して、読み違えていた場所を突き合わせるためのもの。 */
function playPassage(card, idx, rate, btn) {
  var was = reading;
  stopReading();
  if (was && was.i === idx && was.rate === rate) return;
  var spans = card.querySelectorAll(".sx");
  var sents = Array.prototype.map.call(spans, function (e) { return e.textContent; });
  reading = { i: idx, rate: rate };
  btn.textContent = "停止";
  var n = 0;
  function next() {
    if (!reading || n >= sents.length) { stopReading(); return; }
    Array.prototype.forEach.call(spans, function (e) { e.className = "sx"; });
    if (spans[n]) { spans[n].className = "sx on"; spans[n].scrollIntoView({ block: "center", behavior: "smooth" }); }
    var u = new SpeechSynthesisUtterance(sents[n]);
    u.lang = "ja-JP"; u.rate = rate;
    if (jaVoice) u.voice = jaVoice;
    u.onend = function () { n++; next(); };
    u.onerror = function () { stopReading(); };
    speechSynthesis.speak(u);
  }
  next();
}
function renderRead() {
  var v = $("#view-read");
  v.innerHTML = '<div class="stack"><div class="card">' +
    '<div class="timer"><span class="clock" id="clock">0:00</span>' +
    '<button class="tbtn" id="tbtn">スタート</button></div>' +
    '<p class="hint">まず<b>自分で音読せず黙読</b>して計る。目標各 <b>60 秒</b>、假名は心の中でも音にしない。' +
    'そのあと <b>読み上げ</b> を流すと、いま読んでいる文が光る ―― 自分の読みとずれていた所がそこで分かる。</p>' +
    '</div>' + PASSAGES.map(function (p, i) {
      var b = ST.times[p.day + "-" + p.i];
      return '<div class="card" data-card="' + i + '">' +
        '<div class="plate-top"><span class="eyebrow">' + p.day + '日目 · ' + p.t + '</span>' +
        '<span class="best">' + (b ? "最速 " + fmt(b) : "未計測") + '</span></div>' +
        '<p class="passage">' + sentences(p.html).map(function (x) {
          return '<span class="sx">' + x + '</span>';
        }).join("") + '</p>' +
        '<div class="seg" style="margin-top:2px">' +
          '<button data-play="' + i + '" data-rate="0.95" data-label="読み上げ">読み上げ</button>' +
          '<button data-play="' + i + '" data-rate="0.7" data-label="ゆっくり">ゆっくり</button>' +
          '<button data-time="' + i + '">この文を計る</button>' +
        '</div></div>';
    }).join("") + '</div>';

  Array.prototype.forEach.call(v.querySelectorAll("[data-play]"), function (b) {
    b.onclick = function () {
      var i = +b.dataset.play;
      playPassage(v.querySelector('[data-card="' + i + '"]'), i, +b.dataset.rate, b);
    };
  });
  Array.prototype.forEach.call(v.querySelectorAll("[data-time]"), function (b) {
    b.onclick = function () { activeP = +b.dataset.time; if (!tick) toggleTimer(); window.scrollTo(0, 0); };
  });
  $("#tbtn").onclick = toggleTimer;
}
function toggleTimer() {
  var btn = $("#tbtn");
  if (tick) {
    clearInterval(tick); tick = null; btn.textContent = "スタート";
    var s = Math.floor((Date.now() - t0) / 1000);
    var ap = PASSAGES[activeP] || PASSAGES[0];
    var k = ap ? ap.day + "-" + ap.i : "0-0";
    if (!ST.times[k] || s < ST.times[k]) { ST.times[k] = s; save(); renderRead(); }
    $("#clock").textContent = fmt(s);
    return;
  }
  t0 = Date.now(); btn.textContent = "ストップ";
  tick = setInterval(function () {
    $("#clock").textContent = fmt(Math.floor((Date.now() - t0) / 1000));
  }, 200);
}

/* ---------------- 共有 view : レポート ＋ 会話プロンプト ---------------- */
var MD = function (d) { return d.slice(5).replace("-", "/"); };
function leechInfo(id) {
  var s = ST.cards[id], x = lookup(id);
  var mt = Object.keys(s.mt || {}).sort(function (a, b) { return s.mt[b] - s.mt[a]; })
    .map(function (m) { return (MODE_LABEL[m] || m) + "×" + s.mt[m]; }).join("・");
  return { id: id, label: x.label, sub: x.sub, cn: x.cn, lapses: s.lapses, idk: s.idk || 0, box: s.box, types: mt };
}
function buildReport() {
  TODAY = SRS.today();
  var d = day(), st = SRS.stats(ST.cards, TODAY);
  var p = SRS.plan(ORDER, ST.cards, TODAY, planCfg());
  var out = [];
  out.push("【N1 ドリル " + TODAY + "】");
  out.push("今日 " + d.n + " 問 / 正解 " + (d.ok || 0) + "（" + accuracy(d) + "%）" +
    ((d.idk || 0) ? "・わからない " + d.idk + " 回（正解率の分母から除外）" : "") +
    "｜新詞 " + (d["new"] || 0) + " 枚（上限 " + ST.settings.newCap + "）");
  out.push("到期の復習 残り " + p.dueAll + " 枚｜長期記憶（箱 4 以上）" + st.longTerm + " 枚 / 学習中を含む全体 " + st.learned + " 枚");
  out.push("連続 " + SRS.streak(ST.days, TODAY) + "日（最長 " + SRS.longestStreak(ST.days) + " 日）");
  var fl7 = ST.flags.filter(function (f) { return f.t > Date.now() - 7 * 864e5; }).length;
  if (fl7) out.push("「這題怪怪的」記録（7日）" + fl7 + " 件");
  out.push("");
  out.push("■ 最近 7 日の完了量（答えた問題 ＋ 新詞）");
  SRS.lastDays(ST.days, TODAY, 7).forEach(function (x) {
    var tot = x.n + x.newN;
    out.push("- " + MD(x.date) + "  " + x.n + " 問 + 新詞 " + x.newN + (tot === 0 && x.date !== TODAY ? "  ← 中断" : ""));
  });
  out.push("");
  var lee = st.leeches.map(leechInfo);
  out.push("■ leech（lapses 3 回以上）" + (lee.length ? "（" + lee.length + "）" : "— なし"));
  lee.slice(0, 30).forEach(function (x) {
    out.push("- " + x.label + (x.sub ? "（" + x.sub + "）" : "") + (x.cn ? " " + x.cn : "") +
      " … lapses " + x.lapses + (x.idk ? "（わからない " + x.idk + "）" : "") + (x.types ? "／錯的類型：" + x.types : ""));
  });
  if (lee.length > 30) out.push("…ほか " + (lee.length - 30) + " 件");
  out.push("");
  out.push("■ 延遲測驗（最近 3 次）" + (ST.delayed.length ? "" : "— まだなし"));
  ST.delayed.slice(-3).forEach(function (x) {
    out.push("- " + MD(x.date) + "  " + x.correct + "/" + x.n + "（" + Math.round(x.correct / x.n * 100) + "%）");
  });
  var timed = PASSAGES.filter(function (q) { return ST.times[q.day + "-" + q.i]; });
  if (timed.length) {
    out.push("");
    out.push("■ 計時読解");
    timed.forEach(function (q) {
      out.push("- " + q.day + "日目 " + q.t + " 最速 " + fmt(ST.times[q.day + "-" + q.i]) + "（目標 " + fmt(q.sec) + "）");
    });
  }
  out.push("");
  out.push("――――――");
  out.push("請看：有沒有中斷、到期有沒有積壓、延遲測驗的正確率趨勢；");
  out.push("leech 請換記法（例句／漢字網路／同音辨析），不要只是再背；必要時調整新詞上限。");
  return out.join("\n");
}

/* 会話プロンプトに入れる語: 直近 3 日に導入した語（なければ空）＋ leech */
function buildPrompt() {
  var since = SRS.addDays(SRS.today(), -2), ws = [];
  WORDS.forEach(function (w) { var s = ST.cards[w.id]; if (s && s.first && s.first >= since) ws.push(w.w); });
  SRS.stats(ST.cards, SRS.today()).leeches.forEach(function (id) {
    if (ITEM[id].t === "w" && ws.indexOf(ITEM[id].d.w) < 0) ws.push(ITEM[id].d.w);
  });
  return "あなたは私のN1単語トレーナーです。全部日本語で話してください。\n\n" +
"【今日の語】" + (ws.length ? ws.slice(0, 40).join(" ") : "（まだありません。私が語を言います）") + "\n\n" +
"【ルール】\n" +
"1. 私は日本で働く外国人（管理職）です。仕事や生活の話題で、上の語を必ず使わせる質問をしてください。1回に1問だけ。\n" +
"2. 私が語を思い出せないとき、絶対に答えを先に言わないでください。まずヒント（使う場面・コロケーション・最初の一音）を出して、私に取り出させてください。2回失敗してから答えを教えてください。\n" +
"3. 私の日本語が不自然なとき、その場で直してください。「なぜ不自然か」を一行で。\n" +
"4. 漢字の意味は分かるが読みが怪しい語があるので、読みを確認する質問も混ぜてください。\n" +
"5. 余裕があれば、N2文法（〜ざるを得ない／〜かねない／〜次第／〜どころか など）を使わせる質問も入れてください。\n" +
"6. 最後に、私が詰まった語と文法だけをリストで出してください。\n\n" +
"では1問目をお願いします。";
}

/* ---------------- 歷程 view ---------------- */
function card(eyebrow, title) {
  var c = mk("div", "card");
  c.appendChild(mk("span", "eyebrow", eyebrow));
  if (title) c.appendChild(mk("h2", null, title));
  return c;
}
function scoreRow(items) {
  var s = mk("div", "score");
  items.forEach(function (it) {
    var d = mk("div"), n = mk("div", "n", String(it[0]));
    if (it[2]) n.appendChild(mk("small", null, it[2]));
    d.appendChild(n); d.appendChild(mk("div", "l", it[1])); s.appendChild(d);
  });
  return s;
}
function chartBox(svgStr) { var d = mk("div", "chartbox"); d.innerHTML = svgStr; return d; }   // svgStr は HIST の数値だけの文字列

function renderHistory() {
  TODAY = SRS.today();
  var v = $("#view-history"), stack = mk("div", "stack");
  v.textContent = ""; v.appendChild(stack);
  var st = SRS.stats(ST.cards, TODAY);
  var nDays = Object.keys(ST.days).filter(function (d) { return ST.days[d].n + ST.days[d]["new"] > 0; }).length;

  /* ① 熱度圖 */
  var c1 = card("近 12 週 · 毎日の量");
  c1.appendChild(scoreRow([[SRS.streak(ST.days, TODAY), "いまの連続", "日"], [SRS.longestStreak(ST.days), "最長連続", "日"], [nDays, "やった日", "日"]]));
  c1.appendChild(chartBox(HIST.heatmap(ST.days, TODAY, 12)));
  c1.appendChild(mk("p", "hint", "濃いほど多い。赤い点線の枠は「やった日のあとで空いた日」＝中断。5 分だけでもやれば埋まる。"));
  stack.appendChild(c1);

  /* ② 長期記憶 + 箱の分布 */
  var c2 = card("長期記憶（箱 4 以上＝14 日以上の間隔で答えられた）");
  c2.appendChild(scoreRow([[st.longTerm, "長期記憶"], [st.learned, "学習中を含む"], [st.due, "到期"]]));
  c2.appendChild(chartBox(HIST.ltmLine(ST.ltm, TODAY, st.longTerm, 90)));
  var cnt = [0, 0, 0, 0, 0, 0, 0];
  Object.keys(ST.cards).forEach(function (id) { cnt[ST.cards[id].box]++; });
  var bb = HIST.boxBar(cnt);
  c2.appendChild(mk("span", "eyebrow", "箱の分布（今日）"));
  if (bb) {
    c2.appendChild(chartBox(bb));
    var lg = mk("div", "legend");
    cnt.forEach(function (n, b) { if (n) { var s = mk("span", null, "箱" + b + " " + n); s.className = "lg" + b; lg.appendChild(s); } });
    c2.appendChild(lg);
  } else c2.appendChild(mk("p", "hint", "まだカードがない。"));
  stack.appendChild(c2);

  /* ③ 直近 30 日 */
  var c3 = card("直近 30 日 · 新詞と復習 / 正解率");
  c3.appendChild(chartBox(HIST.dailyBars(ST.days, TODAY, 30)));
  c3.appendChild(mk("p", "hint", "青＝復習、朱＝新詞。下の線は正解率（わからない は除く）。赤い短い棒は空いた日。"));
  stack.appendChild(c3);

  /* ④ 延遲測驗 */
  var c4 = card("延遲測驗 · 14 日以上あとの正解率");
  if (ST.delayed.length) {
    c4.appendChild(chartBox(HIST.delayedLine(ST.delayed)));
    var tb = mk("table", "tbl");
    ST.delayed.slice(-8).reverse().forEach(function (x) {
      var tr = mk("tr");
      [x.date, x.correct + " / " + x.n, Math.round(x.correct / x.n * 100) + "%"].forEach(function (t) { tr.appendChild(mk("td", null, t)); });
      tb.appendChild(tr);
    });
    c4.appendChild(tb);
  } else c4.appendChild(mk("p", "hint", "まだ受けていない。14 日以上前に答えた語（箱 3 以上）が溜まると、今日ページから受けられる。"));
  stack.appendChild(c4);

  /* ⑤ leech */
  var c5 = card("Leech（lapses 3 回以上）· タップで詳細");
  var lee = st.leeches.map(leechInfo);
  if (lee.length) {
    var ul = mk("ul", "miss");
    lee.slice(0, 40).forEach(function (x) {
      var li = mk("li", "tap"); li.tabIndex = 0;
      li.appendChild(mk("span", "k", x.label));
      if (x.sub) li.appendChild(mk("span", "y", x.sub));
      if (x.cn) li.appendChild(mk("span", "c", x.cn));
      li.appendChild(mk("span", "n", x.lapses + "回"));
      if (x.types) li.appendChild(mk("span", "sub", "錯的類型：" + x.types));
      if (ST.notes[x.id]) { var nt = mk("span", "sub coach"); rich(nt, "教練：" + ST.notes[x.id]); li.appendChild(nt); }
      li.onclick = function () { openCard(x.id); };
      li.onkeydown = function (e) { if (e.key === "Enter") openCard(x.id); };
      ul.appendChild(li);
    });
    c5.appendChild(ul);
    if (lee.length > 40) c5.appendChild(mk("p", "hint", "ほか " + (lee.length - 40) + " 件。"));
  } else c5.appendChild(mk("p", "hint", "lapses 3 回以上の語はまだない。"));
  /* 任意のカードを探して検査する（「何度やっても通れない」を見つけるための入口） */
  var sr = mk("input", "search"); sr.type = "search"; sr.placeholder = "語・読み・意味でカードを探す"; sr.setAttribute("autocomplete", "off");
  var res = mk("div", "results");
  sr.oninput = function () {
    res.textContent = "";
    var q = sr.value.trim();
    if (!q) return;
    var hits = WORDS.filter(function (w) { return w.w.indexOf(q) >= 0 || w.r.indexOf(q) >= 0 || w.c.indexOf(q) >= 0; }).map(function (w) { return w.id; })
      .concat(GRAM.filter(function (g) { return g.f.indexOf(q) >= 0 || g.cn.indexOf(q) >= 0; }).map(function (g) { return g.id; })).slice(0, 8);
    hits.forEach(function (id) {
      var x = lookup(id), b = mk("button", "mini", x.label + (x.sub ? "（" + x.sub + "）" : "") + (ST.cards[id] ? " · 箱" + ST.cards[id].box : " · 未学"));
      b.onclick = function () { openCard(id); }; res.appendChild(b);
    });
    if (!hits.length) res.appendChild(mk("p", "hint", "見つからない。"));
  };
  c5.appendChild(sr); c5.appendChild(res);
  stack.appendChild(c5);

  /* ⑥ 教練の留言 */
  var c6 = card("教練の留言");
  if (ST.journal.length) {
    ST.journal.slice().reverse().slice(0, 30).forEach(function (j) {
      var r = mk("div", "jrow"); r.appendChild(mk("span", "jd", j.d.slice(5).replace("-", "/")));
      r.appendChild(rich(mk("span", "jt"), j.t)); c6.appendChild(r);
    });
  } else c6.appendChild(mk("p", "hint", "まだない。教練の回覆（n1.coach）を設定ページで貼ると、ここに溜まる。"));
  stack.appendChild(c6);

  /* ⑦ 同期紀錄 */
  var c7 = card("同期紀錄");
  if (ST.sync.log.length) {
    ST.sync.log.slice().reverse().slice(0, 20).forEach(function (x) {
      var r = mk("div", "jrow"); r.appendChild(mk("span", "jd", fmtTime(x.t)));
      r.appendChild(mk("span", "jt", ({ export: "匯出", apply: "套用", backup: "備份", restore: "還原", reset: "重設" }[x.k] || x.k) + " · " + x.s)); c7.appendChild(r);
    });
  } else c7.appendChild(mk("p", "hint", "まだ同期していない。"));
  stack.appendChild(c7);
}

/* ---------------- カード検査（シート） ---------------- */
function closeSheet() { var s = $("#sheet"); s.hidden = true; s.textContent = ""; document.body.classList.remove("noscroll"); }
function openCard(id) {
  var sh = $("#sheet"), x = lookup(id), c = ST.cards[id];
  sh.textContent = ""; sh.hidden = false; document.body.classList.add("noscroll");
  var panel = mk("div", "panel card");
  var head = mk("div", "plate-top");
  head.appendChild(mk("span", "eyebrow", "カード検査"));
  var cl = mk("button", "mini", "閉じる"); cl.onclick = closeSheet; head.appendChild(cl);
  panel.appendChild(head);
  var rd = mk("div", "rd"); rd.appendChild(mk("span", "k", x.label));
  if (x.sub) rd.appendChild(mk("span", "y", x.sub));
  if (x.cn) rd.appendChild(mk("span", "c", x.cn));
  panel.appendChild(rd);
  if (!ITEM[id]) panel.appendChild(mk("p", "hint", "このカードは今のデータにない（素材から削除された可能性）。"));
  if (c) {
    var rows = [
      ["箱", c.box + (c.box >= SRS.LONG_BOX ? "（長期記憶）" : c.box === 0 ? "（学習中）" : "")],
      ["次回", c.due + "（" + (SRS.diffDays(TODAY, c.due) <= 0 ? "到期" : "あと " + SRS.diffDays(TODAY, c.due) + " 日") + "）"],
      ["lapses（忘れた回数）", c.lapses], ["出題回数", c.seen], ["わからない", c.idk || 0],
      ["最後", c.last || "—"], ["初回", c.first || "—"],
      ["錯的類型", Object.keys(c.mt || {}).map(function (m) { return (MODE_LABEL[m] || m) + "×" + c.mt[m]; }).join("・") || "—"]
    ];
    var tb = mk("table", "tbl kv");
    rows.forEach(function (r) { var tr = mk("tr"); tr.appendChild(mk("th", null, r[0])); tr.appendChild(mk("td", null, String(r[1]))); tb.appendChild(tr); });
    panel.appendChild(tb);
  } else panel.appendChild(mk("p", "hint", "まだ出題されていない（未学）。"));
  if (ST.notes[id]) { var n = mk("p", "note coach"); rich(n, "教練：" + ST.notes[id]); panel.appendChild(n); }
  var fl = ST.flags.filter(function (f) { return f.id === id; });
  if (fl.length) panel.appendChild(mk("p", "hint", "「怪怪的」記録 " + fl.length + " 件（型: " + fl.map(function (f) { return MODE_LABEL[f.q] || f.q; }).join("・") + "）。この型はこの語では出さないようにしている。"));
  var lg = ST.log.filter(function (e) { return e.id === id; }).slice(-10).reverse();
  panel.appendChild(mk("span", "eyebrow", "最近 " + lg.length + " 回の作答"));
  if (lg.length) {
    var t2 = mk("table", "tbl");
    lg.forEach(function (e) {
      var tr = mk("tr");
      [fmtTime(e.t), MODE_LABEL[e.q] || e.q, e.ok === "ok" ? "○" : e.ok === "idk" ? "？" : e.ok === "known" ? "熟" : "×", "箱 " + e.b0 + "→" + e.b1]
        .forEach(function (t) { tr.appendChild(mk("td", null, t)); });
      t2.appendChild(tr);
    });
    panel.appendChild(t2);
  } else panel.appendChild(mk("p", "hint", "作答記録なし（直近 500 件のみ残る）。"));
  if (ITEM[id]) {
    var k = mk("button", "next ghost small", "我熟了（箱 5・30 日後）");
    k.onclick = function () { putCard(id, SRS.markKnown(c, TODAY)); logAns(id, "known", "known", c ? c.box : 0, SRS.KNOWN_BOX); save(); closeSheet(); show(CURVIEW); };
    panel.appendChild(k);
    if (c) {
      var r = mk("button", "next ghost small", "このカードを未学に戻す");
      r.onclick = function () { if (!confirm("このカードの記録を消して未学に戻しますか？")) return; delete ST.cards[id]; save(); closeSheet(); show(CURVIEW); };
      panel.appendChild(r);
    }
  }
  sh.appendChild(panel);
  panel.scrollTop = 0;
}

/* ---------------- 設定 view ---------------- */
var PERSIST = "確認中…", ESTIMATE = "";
function isStandalone() {
  try { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; } catch (e) { return false; }
}
function applyTheme() {
  var t = ST.settings.theme;
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
function syncLookup(id) { var x = lookup(id); return { w: x.label, r: x.sub, m: x.cn }; }
function dueNow() { return SRS.plan(ORDER, ST.cards, TODAY, planCfg()).dueAll; }
function coachCtx() {
  return { known: function (id) { return !!ITEM[id]; }, hasCard: function (id) { return !!ST.cards[id]; } };
}

/* クリップボードへ。失敗したら（iOS の非セキュア等）選択済みの文字枠を出して手動コピーに回す。 */
function copyOut(text, btn, label, fallbackHost) {
  var ok = function () { btn.textContent = "コピーしました"; setTimeout(function () { btn.textContent = label; }, 2200); fallbackHost.textContent = ""; };
  var manual = function () {
    fallbackHost.textContent = "";
    var ta = mk("textarea"); ta.readOnly = true; ta.value = text; ta.className = "outbox";
    fallbackHost.appendChild(mk("p", "hint", "自動コピーができなかった。下の文字を長押し → すべて選択 → コピー。"));
    fallbackHost.appendChild(ta);
    ta.focus(); ta.select(); try { ta.setSelectionRange(0, text.length); } catch (e) {}
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, manual);
  else manual();
}

function field(label, node) { var l = mk("label", "row"); l.appendChild(mk("span", null, label)); l.appendChild(node); return l; }
function msgBox(cls) { var m = mk("p", "hint msg" + (cls ? " " + cls : "")); m.setAttribute("role", "status"); return m; }
function setMsg(m, text, bad) { m.textContent = text; m.className = "hint msg" + (bad ? " bad" : text ? " good" : ""); }

function renderSettings() {
  TODAY = SRS.today();
  var v = $("#view-settings"), stack = mk("div", "stack");
  v.textContent = ""; v.appendChild(stack);

  /* ---- 1. 毎日の設定 ---- */
  var c1 = card("設定", "毎日の設定");
  var cap = mk("input"); cap.type = "range"; cap.min = 5; cap.max = 50; cap.step = 1; cap.value = ST.settings.newCap;
  var capv = mk("b", "val", String(ST.settings.newCap));
  cap.oninput = function () { capv.textContent = cap.value; };
  cap.onchange = function () { ST.settings.newCap = +cap.value; save(); };
  var cw = mk("div", "sl"); cw.appendChild(cap); cw.appendChild(capv);
  c1.appendChild(field("1 日の新詞の上限（5–50）", cw));
  var mv = mk("input"); mv.type = "range"; mv.min = 5; mv.max = 50; mv.step = 1; mv.value = ST.settings.mvdN;
  var mvv = mk("b", "val", String(ST.settings.mvdN));
  mv.oninput = function () { mvv.textContent = mv.value; };
  mv.onchange = function () { ST.settings.mvdN = +mv.value; save(); };
  var mw = mk("div", "sl"); mw.appendChild(mv); mw.appendChild(mvv);
  c1.appendChild(field("「只複習 5 分鐘」の題数", mw));
  var rt = mk("input"); rt.type = "range"; rt.min = 0.6; rt.max = 1.2; rt.step = 0.05; rt.value = ST.settings.rate;
  var rtv = mk("b", "val", ST.settings.rate.toFixed(2));
  rt.oninput = function () { rtv.textContent = (+rt.value).toFixed(2); };
  rt.onchange = function () { ST.settings.rate = +rt.value; save(); say("日本語の速さを確かめます。", ST.settings.rate); };
  var rw = mk("div", "sl"); rw.appendChild(rt); rw.appendChild(rtv);
  c1.appendChild(field("朗読の速さ", rw));
  var th = mk("select");
  [["auto", "端末に合わせる"], ["light", "ライト"], ["dark", "ダーク"]].forEach(function (o) {
    var op = mk("option", null, o[1]); op.value = o[0]; if (o[0] === ST.settings.theme) op.selected = true; th.appendChild(op);
  });
  th.onchange = function () { ST.settings.theme = th.value; save(); applyTheme(); };
  c1.appendChild(field("表示", th));
  stack.appendChild(c1);

  /* ---- 2. 同期 ---- */
  var c2 = card("同期（クリップボードだけ・サーバなし）", "教練と記録をやりとりする");
  c2.appendChild(mk("p", "hint", "毎日おわりに ① 同期包をコピー → Claude に貼る ② 返ってきた n1.coach を下に貼る → 確認 → 套用。"));
  var info = mk("p", "hint"), syncOut = mk("div");
  function refreshInfo() {
    var pk = SYNC.buildSync(ST, { now: Date.now(), today: TODAY, lookup: syncLookup, dueAll: dueNow() }), sz = SYNC.sizeOf(SYNC.stringify(pk));
    info.textContent = "前回の匯出：" + (ST.sync.lastExportAt ? fmtTime(ST.sync.lastExportAt) : "まだ") + " ／ 次の同期包：約 " + fmtKB(sz) +
      "（カード " + Object.keys(pk.cards).length + " 枚・作答 " + pk.log.length + " 件）" + (sz > SYNC.WARN_SYNC ? " ⚠ 60KB 超。大きい — こまめに同期すると小さくなる。" : "");
    info.className = "hint" + (sz > SYNC.WARN_SYNC ? " warn" : "");
  }
  refreshInfo();
  c2.appendChild(info);
  var bExp = mk("button", "next", "今日の同期包をコピー");
  bExp.onclick = function () {
    var now = Date.now(), pk = SYNC.buildSync(ST, { now: now, today: TODAY, lookup: syncLookup, dueAll: dueNow(), app: "n1-app " + BUILD });
    var text = SYNC.stringify(pk);
    SYNC.markExported(ST, now, "n1.sync " + fmtKB(SYNC.sizeOf(text)) + "・カード " + Object.keys(pk.cards).length + "・作答 " + pk.log.length);
    save(); copyOut(text, bExp, "今日の同期包をコピー", syncOut); refreshInfo();
  };
  var bAgain = mk("button", "next ghost small", "貼れなかった — 同じ区間をもう一度コピー");
  bAgain.onclick = function () {
    var now = Date.now(), since = ST.sync.prevExportAt || 0;
    var pk = SYNC.buildSync(ST, { now: now, today: TODAY, lookup: syncLookup, dueAll: dueNow(), since: since, app: "n1-app " + BUILD });
    var text = SYNC.stringify(pk);
    SYNC.logSync(ST, "export", "再コピー " + fmtKB(SYNC.sizeOf(text)), now); save();
    copyOut(text, bAgain, "貼れなかった — 同じ区間をもう一度コピー", syncOut);
  };
  c2.appendChild(bExp); c2.appendChild(bAgain); c2.appendChild(syncOut);

  c2.appendChild(mk("span", "eyebrow", "教練の回覆を貼る（n1.coach）"));
  var cin = mk("textarea", "sm"); cin.placeholder = '{"kind":"n1.coach", …}';
  var cprev = mk("div"), cmsg = msgBox();
  var bPrev = mk("button", "next ghost small", "預覽");
  bPrev.onclick = function () {
    cprev.textContent = ""; setMsg(cmsg, "");
    var p = SYNC.parseCoach(cin.value);
    if (!p.ok) { setMsg(cmsg, "読めない：" + p.error + " データは変えていない。", true); return; }
    var pv = SYNC.previewCoach(ST, p.pkg, coachCtx());
    var box = mk("div", "preview"); box.appendChild(mk("b", null, "プレビュー · id " + p.pkg.id));
    pv.lines.forEach(function (l) { box.appendChild(mk("p", null, l)); });
    var ok = mk("button", "next small", pv.already ? "適用済み" : "確認して套用"); ok.disabled = pv.already;
    ok.onclick = function () {
      snapshot("before-coach");
      var a = SYNC.applyCoach(ST, p.pkg, coachCtx(), Date.now());
      if (!a.applied) { setMsg(cmsg, "適用済みのため何も変えていない。", false); return; }
      ST = a.state; save(); applyTheme(); cin.value = ""; cprev.textContent = "";
      renderSettings(); var m2 = $("#coachmsg"); if (m2) setMsg(m2, "套用した（" + a.summary + "）。前の状態はスナップショットに残してある。");
    };
    var no = mk("button", "next ghost small", "やめる"); no.onclick = function () { cprev.textContent = ""; };
    box.appendChild(ok); box.appendChild(no); cprev.appendChild(box);
  };
  cmsg.id = "coachmsg";
  c2.appendChild(cin); c2.appendChild(bPrev); c2.appendChild(cprev); c2.appendChild(cmsg);

  c2.appendChild(mk("span", "eyebrow", "完全バックアップ（n1.backup）"));
  var bkOut = mk("div"), bkB = mk("button", "next ghost small", "完全バックアップをコピー");
  bkB.onclick = function () {
    var now = Date.now(), text = SYNC.stringify(SYNC.buildBackup(ST, now, "n1-app " + BUILD));
    SYNC.logSync(ST, "backup", "n1.backup " + fmtKB(SYNC.sizeOf(text)), now); save();
    copyOut(text, bkB, "完全バックアップをコピー", bkOut);
  };
  c2.appendChild(bkB); c2.appendChild(bkOut);
  var bin = mk("textarea", "sm"); bin.placeholder = '{"kind":"n1.backup", …}';
  var bprev = mk("div"), bmsg = msgBox();
  var bP = mk("button", "next ghost small", "バックアップから還原（預覽）");
  bP.onclick = function () {
    bprev.textContent = ""; setMsg(bmsg, "");
    var p = SYNC.parseBackup(bin.value);
    if (!p.ok) { setMsg(bmsg, "読めない：" + p.error + " データは変えていない。", true); return; }
    var box = mk("div", "preview"); box.appendChild(mk("b", null, "プレビュー"));
    box.appendChild(mk("p", null, "書き出した日時：" + (p.exportedAt || "不明")));
    box.appendChild(mk("p", null, "カード " + Object.keys(p.state.cards).length + " 枚・日別 " + Object.keys(p.state.days).length + " 日・作答 " + p.state.log.length + " 件・延遲測驗 " + p.state.delayed.length + " 回" + (p.dropped ? "・壊れたカード " + p.dropped + " 枚は除外" : "")));
    box.appendChild(mk("p", "warn", "いまのデータ（カード " + Object.keys(ST.cards).length + " 枚）は置き換わる。先にスナップショットを取る。"));
    var ok = mk("button", "next small", "確認して還原");
    ok.onclick = function () { restoreState(p.state, "バックアップ"); };
    var no = mk("button", "next ghost small", "やめる"); no.onclick = function () { bprev.textContent = ""; };
    box.appendChild(ok); box.appendChild(no); bprev.appendChild(box);
  };
  c2.appendChild(bin); c2.appendChild(bP); c2.appendChild(bprev); c2.appendChild(bmsg);

  var rp = mk("button", "next ghost small", "文字レポートをコピー（人が読む版）"), rpOut = mk("div");
  rp.onclick = function () { copyOut(buildReport(), rp, "文字レポートをコピー（人が読む版）", rpOut); };
  var pm = mk("button", "next ghost small", "会話プロンプトをコピー（帰りの電車用）"), pmOut = mk("div");
  pm.onclick = function () { copyOut(buildPrompt(), pm, "会話プロンプトをコピー（帰りの電車用）", pmOut); };
  c2.appendChild(rp); c2.appendChild(rpOut); c2.appendChild(pm); c2.appendChild(pmOut);
  stack.appendChild(c2);

  /* ---- 3. 優先詞 ---- */
  var c3 = card("優先詞", "言えなかった語を先頭へ");
  c3.appendChild(mk("p", "hint", "仕事や生活で「言えなかった語」を入れる。次の新詞から先頭に出る。区切りは空白・改行・読点。素材にない語は追加されない。"));
  var pri = mk("textarea", "sm"); pri.placeholder = "例：汚れる 企画 …";
  var pm2 = msgBox(), pl = mk("div", "plist");
  function paintPri() {
    pl.textContent = "";
    var pend = ST.priority.filter(function (id) { return !ST.cards[id] && ITEM[id]; });
    pl.appendChild(mk("p", "hint", "待ち " + pend.length + " 件"));
    pend.slice(0, 40).forEach(function (id) {
      var row = mk("div", "dayrow"), x = lookup(id);
      row.appendChild(mk("span", null, x.label + (x.sub ? "（" + x.sub + "）" : "")));
      var rm = mk("button", "mini", "外す"); rm.onclick = function () { ST.priority = ST.priority.filter(function (z) { return z !== id; }); save(); paintPri(); };
      row.appendChild(rm); pl.appendChild(row);
    });
  }
  var pa = mk("button", "next ghost small", "優先詞に追加");
  pa.onclick = function () {
    var toks = pri.value.split(/[\s,、，]+/).filter(Boolean), added = [], miss = [], have = [];
    toks.forEach(function (t) {
      var w = BYWORD[t];
      if (!w) miss.push(t); else if (ST.cards[w.id]) have.push(t); else if (added.indexOf(w.id) < 0) added.push(w.id);
    });
    ST.priority = added.concat(ST.priority.filter(function (id) { return added.indexOf(id) < 0; }));
    save(); paintPri();
    setMsg(pm2, "追加 " + added.length + " 件" + (have.length ? "／すでに学習中: " + have.join("・") : "") + (miss.length ? "／素材にない: " + miss.join("・") : ""), !added.length && toks.length > 0);
    pri.value = "";
  };
  c3.appendChild(pri); c3.appendChild(pa); c3.appendChild(pm2); c3.appendChild(pl); paintPri();
  stack.appendChild(c3);

  /* ---- 4. 資料健康 ---- */
  var c4 = card("資料健康", "保存の状態");
  var rows = mk("table", "tbl kv");
  function kv(k, val, id) { var tr = mk("tr"); tr.appendChild(mk("th", null, k)); var td = mk("td", null, val); if (id) td.id = id; tr.appendChild(td); rows.appendChild(tr); }
  kv("保存の版", "schema " + SYNC.SCHEMA + " ／ " + KEY);
  kv("状態", STORE.status === "ok" || STORE.status === "new" ? "正常" : STORE.status === "corrupt" ? "読めない（保存停止中）" : "保存できない");
  kv("最後の書き込み", ST.savedAt ? fmtTime(ST.savedAt) : "まだ");
  kv("カード数", Object.keys(ST.cards).length + " 枚");
  kv("永続ストレージ", PERSIST, "hp-persist");
  kv("主画面アプリ", isStandalone() ? "はい（standalone）" : "いいえ");
  kv("使用量", ESTIMATE || "計測中…", "hp-est");
  c4.appendChild(rows);
  if (!isStandalone()) c4.appendChild(mk("p", "hint warn", "ブラウザのタブのままだと、一定期間使わないと保存が消されることがある（特に iPhone の Safari）。共有メニュー →「ホーム画面に追加」から開く。"));
  if (STORE.writeError) c4.appendChild(mk("p", "hint warn", "保存エラー：" + STORE.writeError));
  if (STORE.dropped) c4.appendChild(mk("p", "hint warn", "読み込み時に壊れたカード " + STORE.dropped + " 枚を無視した（元の文字は " + CORRKEY + " に退避済み）。"));
  c4.appendChild(mk("span", "eyebrow", "スナップショット（最近 3 件）"));
  if (!SNAPS.length) c4.appendChild(mk("p", "hint", "まだない。コーチ適用・還原・重設の前と、1 日 1 回自動で取る。"));
  SNAPS.slice().reverse().forEach(function (sn) {
    var row = mk("div", "dayrow"), n = SYNC.readSnapshot(sn);
    row.appendChild(mk("span", null, fmtTime(sn.t) + " · " + sn.reason + (n ? " · " + Object.keys(n.cards).length + " 枚" : " · 読めない")));
    var b = mk("button", "mini", "還原"); b.disabled = !n;
    b.onclick = function () { if (n && confirm(fmtTime(sn.t) + " のスナップショット（カード " + Object.keys(n.cards).length + " 枚）に戻しますか？\n今の状態も先にスナップショットに残す。")) restoreState(n, "スナップショット"); };
    row.appendChild(b); c4.appendChild(row);
  });
  stack.appendChild(c4);

  /* ---- 5. 已會匯入 ---- */
  var c5 = card("已會匯入", "この日份は大致會了");
  c5.appendChild(mk("p", "hint", "押すと、その日份の語が箱 3（約 7 日後に再テスト）から始まる。既定では何も入れていない。本当に知っている日份だけ。"));
  DAYNUMS.forEach(function (n) {
    var ids = dayWordIds(n), known = ids.filter(function (id) { return ST.cards[id]; }).length;
    var row = mk("div", "dayrow"), l = mk("span"); l.appendChild(mk("b", null, window.DAYS[n].label + " ")); l.appendChild(mk("span", "hint", known + "/" + ids.length));
    row.appendChild(l);
    var b = mk("button", "mini", "大致會了");
    b.onclick = function () {
      if (!confirm(window.DAYS[n].label + " の語を全部「大致會了」（箱 3）にしますか？")) return;
      snapshot("before-import");
      var before = ST.cards; ST.cards = SRS.importKnown(ST.cards, ids, TODAY);
      Object.keys(ST.cards).forEach(function (id) { if (ST.cards[id] !== before[id]) ST.cards[id].u = Date.now(); });
      save(); renderSettings();
    };
    row.appendChild(b); c5.appendChild(row);
  });
  stack.appendChild(c5);

  /* ---- 6. 診断 ---- */
  var c6 = card("診断", "作答ログと記録");
  var dt = mk("details"); dt.appendChild(mk("summary", null, "最近 20 件の作答（時間・カード・型・結果・箱）"));
  var t3 = mk("table", "tbl");
  ST.log.slice(-20).reverse().forEach(function (e) {
    var tr = mk("tr", "tap"), x = lookup(e.id);
    [fmtTime(e.t), x.label, MODE_LABEL[e.q] || e.q, e.ok === "ok" ? "○" : e.ok === "idk" ? "？" : e.ok === "known" ? "熟" : "×", e.b0 + "→" + e.b1].forEach(function (t) { tr.appendChild(mk("td", null, t)); });
    tr.onclick = function () { openCard(e.id); }; t3.appendChild(tr);
  });
  dt.appendChild(ST.log.length ? t3 : mk("p", "hint", "まだない。"));
  c6.appendChild(dt);
  var df = mk("details"); df.appendChild(mk("summary", null, "「怪怪的」記録 " + ST.flags.length + " 件"));
  ST.flags.slice(-15).reverse().forEach(function (f) {
    var row = mk("div", "jrow"), x = lookup(f.id);
    row.appendChild(mk("span", "jd", fmtTime(f.t))); row.appendChild(mk("span", "jt", x.label + " · " + (MODE_LABEL[f.q] || f.q) + " · " + (f.snap.prompt || "").slice(0, 40)));
    row.onclick = function () { openCard(f.id); }; df.appendChild(row);
  });
  if (ST.flags.length) { var cf = mk("button", "mini", "記録を空にする"); cf.onclick = function () { if (confirm("「怪怪的」記録を全部消しますか？（外された出題型は元に戻る）")) { ST.flags = []; save(); renderSettings(); } }; df.appendChild(cf); }
  c6.appendChild(df);
  c6.appendChild(mk("p", "hint", "ビルド " + BUILD + " · 学習中 " + Object.keys(ST.cards).length + " / " + WORDS.length + " 語 + 文法・陷阱句"));
  var rs = mk("button", "next ghost small", "最新版を取り直す（学習記録は消えない）");
  rs.onclick = function () { rs.textContent = "取り直しています…"; window.moritanReset(); };
  c6.appendChild(rs);
  stack.appendChild(c6);

  /* ---- 7. 危険区 ---- */
  var c7 = card("危険區", "全部重設");
  c7.className += " danger";
  c7.appendChild(mk("p", "hint", "カード・日別・作答ログ・延遲測驗・優先詞・注解・怪怪的記録を消して最初からやり直す。設定・教練の留言・同期紀錄は残る。実行前にスナップショットを取るので、スナップショットから戻せる。"));
  var ri = mk("input", "dz"); ri.placeholder = "「重設」と入力"; ri.setAttribute("autocomplete", "off");
  var rb = mk("button", "next ghost small", "全部重設"); rb.disabled = true;
  ri.oninput = function () { rb.disabled = ri.value.trim() !== "重設"; };
  rb.onclick = function () {
    if (ri.value.trim() !== "重設") return;
    snapshot("before-reset");
    ST.cards = {}; ST.days = {}; ST.log = []; ST.delayed = []; ST.extra = {}; ST.priority = []; ST.flags = []; ST.notes = {}; ST.ltm = {}; ST.coachMsg = null;
    SYNC.logSync(ST, "reset", "全部重設", Date.now()); ST.sync.lastExportAt = 0; ST.sync.prevExportAt = 0;
    save(); renderSettings();
  };
  c7.appendChild(ri); c7.appendChild(rb);
  stack.appendChild(c7);

  paintStorageInfo();
}
function paintStorageInfo() {
  var p = $("#hp-persist"); if (p) p.textContent = PERSIST;
  var e = $("#hp-est");
  if (e && navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function (x) {
      ESTIMATE = fmtKB(x.usage || 0) + " / " + (x.quota ? Math.round(x.quota / 1048576) + "MB" : "?");
      var e2 = $("#hp-est"); if (e2) e2.textContent = ESTIMATE;
    }, function () { var e2 = $("#hp-est"); if (e2) e2.textContent = "取得できない"; });
  } else if (e) e.textContent = "この端末では取得できない";
}
/* 状態の置き換え（バックアップ・スナップショット共通）。壊れたデータの上からでも動く。 */
function restoreState(state, label) {
  if (STORE.status !== "corrupt") snapshot("before-restore");
  ST = state;
  SYNC.logSync(ST, "restore", label + "から還原（カード " + Object.keys(ST.cards).length + " 枚）", Date.now());
  STORE.status = "ok"; STORE.dropped = 0;
  var ok = save();
  applyTheme(); paintAlert();
  show(CURVIEW === "settings" ? "settings" : "drill");
  if (!ok) alert("還原したが保存に失敗した: " + STORE.writeError);
}

/* ---------------- 警告バナー（全タブ共通）---------------- */
function paintAlert() {
  var a = $("#alert"); a.textContent = "";
  if (STORE.status === "corrupt") {
    a.hidden = false;
    a.appendChild(mk("b", null, "保存データが読めない。"));
    a.appendChild(mk("p", null, "壊れた JSON のため、何も上書きしていない（保存を停止中）。元の文字は " + CORRKEY + " にも退避してある。下のスナップショットかバックアップから戻せる。"));
    SNAPS.slice().reverse().forEach(function (sn) {
      var n = SYNC.readSnapshot(sn); if (!n) return;
      var b = mk("button", "mini", "還原 " + fmtTime(sn.t) + "（" + Object.keys(n.cards).length + " 枚）");
      b.onclick = function () { if (confirm("このスナップショットに戻しますか？")) restoreState(n, "スナップショット"); };
      a.appendChild(b);
    });
    var go = mk("button", "mini", "貼ったバックアップから戻す → 設定"); go.onclick = function () { show("settings"); }; a.appendChild(go);
    var cp = mk("button", "mini", "壊れた原文をコピー"); cp.onclick = function () { copyOut(STORE.raw || "", cp, "壊れた原文をコピー", mk("div")); }; a.appendChild(cp);
    var ng = mk("button", "mini", "あきらめて最初から");
    ng.onclick = function () { if (confirm("壊れたデータを使わずに最初から始めますか？（原文は " + CORRKEY + " に残る）")) { ST = SYNC.defaults(); STORE.status = "ok"; save(); paintAlert(); show("drill"); } };
    a.appendChild(ng);
  } else if (STORE.status === "unavailable") {
    a.hidden = false;
    a.appendChild(mk("b", null, "このブラウザは保存を許可していない。"));
    a.appendChild(mk("p", null, "閉じると進捗が消える（プライベートモード等）。通常のタブか、ホーム画面のアプリで開く。"));
  } else if (STORE.writeError) {
    a.hidden = false;
    a.appendChild(mk("b", null, "保存に失敗した。"));
    a.appendChild(mk("p", null, STORE.writeError + " — 設定 → 完全バックアップをコピーしておく。"));
  } else a.hidden = true;
}

/* ---------------- 素材（漢字・文法・読解）---------------- */
var MSUB = "kanji", CURVIEW = "drill";
function renderMaterials() {
  var v = $("#view-materials");
  v.textContent = "";
  var seg = mk("div", "seg");
  [["kanji", "漢字"], ["grammar", "文法"], ["read", "読解"]].forEach(function (s) {
    var b = mk("button", null, s[1]); b.setAttribute("aria-selected", String(MSUB === s[0]));
    b.onclick = function () { stopReading(); MSUB = s[0]; renderMaterials(); window.scrollTo(0, 0); };
    seg.appendChild(b);
  });
  var host = mk("div"); host.id = "view-" + MSUB;
  v.appendChild(seg); v.appendChild(host);
  ({ kanji: renderKanji, grammar: renderGrammar, read: renderRead })[MSUB]();
}

/* ---------------- nav ---------------- */
var VIEWS = [
  ["drill", "今", "今日", renderDrill],
  ["history", "歷", "歷程", renderHistory],
  ["materials", "素", "素材", renderMaterials],
  ["settings", "設", "設定", renderSettings]
];
function show(id) {
  stopReading(); closeSheet();
  S = null; D = null; CURVIEW = id;
  VIEWS.forEach(function (v) {
    var on = v[0] === id;
    $("#view-" + v[0]).hidden = !on;
    $("#nav-" + v[0]).setAttribute("aria-selected", String(on));
  });
  var v = VIEWS.filter(function (x) { return x[0] === id; })[0];
  if (v) v[3]();
  if (id !== "drill") {
    $("#rail").style.width = "0%";
    $("#daytag").textContent = "長期記憶 " + SRS.stats(ST.cards, SRS.today()).longTerm;
  }
  window.scrollTo(0, 0);
  try { localStorage.setItem(TABKEY, id); } catch (e) {}
}
var nav = $("nav");
VIEWS.forEach(function (v) {
  var b = el("button", null, '<span class="g">' + v[1] + '</span>' + v[2]);
  b.id = "nav-" + v[0];
  b.onclick = function () { show(v[0]); };
  nav.appendChild(b);
});

/* ---------------- boot ---------------- */
$("#mark").textContent = "モリタン ドリル";
try { history.scrollRestoration = "manual"; } catch (e) {}
applyTheme();
paintAlert();
(function () {
  $("#foot").textContent = "学習中 " + SRS.stats(ST.cards, TODAY).learned + " / " + (WORDS.length + TRAPS.length + GRAM.length) + " 枚 · " + BUILD;
  var last = SNAPS[SNAPS.length - 1];
  if (STORE.status === "ok" && Object.keys(ST.cards).length && (!last || Date.now() - last.t > 20 * 36e5)) snapshot("auto");
  /* 永続ストレージを要求して結果を覚えておく（設定の「資料健康」に出す） */
  try {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) {
        if (p) { PERSIST = "granted（永続）"; paintStorageInfo(); return; }
        return navigator.storage.persist().then(function (g) { PERSIST = g ? "granted（永続）" : "denied（ブラウザが認めていない）"; paintStorageInfo(); });
      }).catch(function () { PERSIST = "取得できない"; paintStorageInfo(); });
    } else PERSIST = "この端末では取得できない";
  } catch (e) { PERSIST = "取得できない"; }
})();
var start;
try { start = localStorage.getItem(TABKEY); } catch (e) {}
show(VIEWS.some(function (v) { return v[0] === start; }) ? start : "drill");

window.moritanReport = buildReport;  // デバッグ用：コンソールから今日のレポートを覗ける
window.moritanPeek = function () { return cur ? cur.ans : -1; };  // デバッグ用：正解の位置

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      reg.update();
      // 新しい版が入ったら、次に開いたときに確実に切り替わるよう待たせない
      reg.addEventListener("updatefound", function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", function () {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            nw.postMessage("skip-waiting");
            var f = $("#foot");
            if (f) f.textContent = "新しい版があります — 引っぱって再読み込みしてください";
          }
        });
      });
    }).catch(function () {});
  });
}

/* 詰まったとき用の非常口。キャッシュを全部捨てて取り直す。 */
window.moritanReset = function () {
  return Promise.all([
    caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }),
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.unregister(); }));
    })
  ]).then(function () { location.reload(true); });
};
})();
