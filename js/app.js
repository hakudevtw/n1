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

var TODAY = (function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();

/* ---------------- store ---------------- */
var KEY = "n1app.v1";
var ST = { miss: {}, seen: {}, run: {}, lastMiss: {}, day: {}, best: 0, times: {}, plays: 0 };
try { var raw = localStorage.getItem(KEY); if (raw) ST = Object.assign(ST, JSON.parse(raw)); } catch (e) {}
["miss","seen","run","lastMiss","day","times"].forEach(function (k) { if (!ST[k]) ST[k] = {}; });
var save = function () { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) {} };

/* ---------------- speech ---------------- */
var jaVoice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  var v = speechSynthesis.getVoices();
  jaVoice = v.filter(function (x) { return x.lang === "ja-JP"; })[0] ||
            v.filter(function (x) { return x.lang && x.lang.indexOf("ja") === 0; })[0] || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(t, rate) {
  if (!("speechSynthesis" in window) || !t) return;
  speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(t);
  u.lang = "ja-JP"; u.rate = rate || 0.85;
  if (jaVoice) u.voice = jaVoice;
  speechSynthesis.speak(u);
}
var SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';

/* ---------------- data ---------------- */
var ALLDAYNUMS = Object.keys(window.DAYS).map(Number).sort(function (a, b) { return a - b; });
/* 先に用意しておいた日ぶんが今日のデッキに雪崩れ込まないよう、日付で門を閉めておく。
   date を過ぎた日だけが有効になる。 */
var DAYNUMS = ALLDAYNUMS.filter(function (n) {
  var d = window.DAYS[n].date;
  return !d || d <= TODAY;
});
if (!DAYNUMS.length) DAYNUMS = [ALLDAYNUMS[0]];
var TODAYNUM = DAYNUMS[DAYNUMS.length - 1];
var DAY = window.DAYS[TODAYNUM];
var TRAPS = DAY.traps || window.TRAPS || [];
var PASSAGES = DAY.read || window.READ_PASSAGES || [];
var GRAM = window.GRAMMAR;
/* 深さ二層。deep = 圈起來的＋陷阱組（例文・辨析・漢字ネットワークつき）
   lite = 残り（語・読み・意味だけ）。出題頻度は deep の 1/3 から始まり、
   ミスした瞬間に上がる ＝ 自己申告ではなく実績でふるいにかける。 */
function unpack(n) {
  var d = window.DAYS[n], out = [];
  (d.words || []).forEach(function (w) { w.deep = true; w.day = n; out.push(w); });
  (d.lite || []).forEach(function (a) {
    // a[4] = 朝つけた印。完全な解説は無いが、出題頻度は deep と同じにする。
    out.push({ w: a[0], r: a[1], c: a[2], ex: a[3] || "", exc: a[5] || "", note: "", deep: false, mark: !!a[4], day: n });
  });
  return out;
}
var ALLWORDS = [];
DAYNUMS.forEach(function (n) { ALLWORDS = ALLWORDS.concat(unpack(n)); });

/* 過去の日は「まだクリアしていない語」だけが今日のデッキに残る。
   クリア済みの語は退場し、つまずいた語だけがずっと付いてくる。
   全部は「漢字」タブと日付切り替えでいつでも見返せる。 */
function carried(w) {
  if (w.day === TODAYNUM) return true;
  return (ST.run[w.w] || 0) < 2 || (ST.miss[w.w] || 0) > 0;
}
var WORDS = ALLWORDS.filter(carried);
var MEANINGS = WORDS.map(function (w) { return w.c; });
var READINGS = WORDS.map(function (w) { return w.r; });
var SURFACES = WORDS.map(function (w) { return w.w; });

/* 同音語は自動で拾う（確立/確率、意向/移行、企画/規格 …）。手で書かなくていい。 */
var HOMO = {};
WORDS.forEach(function (w) { (HOMO[w.r] = HOMO[w.r] || []).push(w.w); });
function homophones(w) {
  return (HOMO[w.r] || []).filter(function (x) { return x !== w.w; });
}
/* 誤答は「同音」→「同じ漢字で始まる」→「同じ読みの頭」→ 残り、の順で選ぶ。
   でたらめな誤答だと消去法で当たってしまい、訓練にならない。 */
function distractors(w, n) {
  var out = [], seen = {};
  seen[w.w] = 1;
  function take(list) {
    shuffle(list).forEach(function (x) {
      if (!seen[x] && out.length < n) { seen[x] = 1; out.push(x); }
    });
  }
  take(homophones(w));
  take(WORDS.filter(function (x) { return x.w[0] === w.w[0]; }).map(function (x) { return x.w; }));
  take(WORDS.filter(function (x) { return x.r[0] === w.r[0]; }).map(function (x) { return x.w; }));
  take(SURFACES);
  return out;
}
var GFORMS = GRAM.map(function (g) { return g.f; });
var GMEANS = GRAM.map(function (g) { return g.cn; });

/* ---------------- question builders ---------------- */
/* 中文と日本語が同じ綴りになる語（改善→改善、維持→維持…）は
   「意味→語」にすると答えが問題文に出てしまう。その型だけ外す。 */
function sameSpelling(w) {
  return w.c.split(/[、（(]/)[0].trim() === w.w;
}
function wordQ(w) {
  var bag = sameSpelling(w) ? ["audio", "audio", "read"] : ["audio", "audio", "read", "mean"];
  if (w.ex && w.ex.indexOf("<b>") >= 0) bag = bag.concat(["cloze", "cloze", "cloze"]);
  var mode = pick(bag);
  if (mode === "cloze") {
    var o0 = shuffle([w.w].concat(distractors(w, 3)));
    return {
      key: w.w, kind: "w", word: w, head: "文に合う語を選ぶ",
      sent: w.ex.replace(/<b>[\s\S]*?<\/b>/, "＿＿").replace(/<\/?b>/g, ""),
      opts: o0, ans: o0.indexOf(w.w), jp: true
    };
  }
  if (mode === "audio") {
    var o = shuffle([w.c].concat(sampleNot(MEANINGS, 3, w.c)));
    return { key: w.w, kind: "w", word: w, head: "聴いて意味を選ぶ", audio: w.w, opts: o, ans: o.indexOf(w.c) };
  }
  if (mode === "read") {
    var o2 = shuffle([w.r].concat(sampleNot(READINGS, 3, w.r)));
    return { key: w.w, kind: "w", word: w, head: "読みを選ぶ", kanji: w.w, opts: o2, ans: o2.indexOf(w.r) };
  }
  var o3 = shuffle([w.w].concat(sampleNot(SURFACES, 3, w.w)));
  return { key: w.w, kind: "w", word: w, head: "この意味の語は", cn: w.c, opts: o3, ans: o3.indexOf(w.w), jp: true };
}
function trapQ(t) {
  // 活用した形を選ばせる問題があるので、記録用の見出し語は t.k で指定できる
  var key = t.k || t.o[t.a];
  var w = WORDS.filter(function (x) { return x.w === key; })[0] || { w: key, r: "", c: "", ex: "", note: "" };
  return { key: key, kind: "w", word: w, head: "文に合う語を選ぶ", sent: t.s, opts: t.o, ans: t.a, jp: true, why: t.why };
}
function gramQ(g) {
  var mode = pick(["quiz", "quiz", "form", "mean"]);
  if (mode === "quiz") {
    var o = g.q.o;
    return { key: g.f, kind: "g", gram: g, head: "文に合う文法を選ぶ", sent: g.q.s, opts: o, ans: g.q.a, why: g.q.why };
  }
  if (mode === "form") {
    var o2 = shuffle([g.f].concat(sampleNot(GFORMS, 3, g.f)));
    return { key: g.f, kind: "g", gram: g, head: "この意味の文法は", cn: g.cn, opts: o2, ans: o2.indexOf(g.f), jp: true };
  }
  var o3 = shuffle([g.cn].concat(sampleNot(GMEANS, 3, g.cn)));
  return { key: g.f, kind: "g", gram: g, head: "意味を選ぶ", form: g.f, opts: o3, ans: o3.indexOf(g.cn) };
}

/* ---------------- drill engine ---------------- */
var deck = "words", queue = [], cur = null, recent = [];
try { var sd = localStorage.getItem("n1app.deck"); if (sd === "words" || sd === "grammar" || sd === "mixed") deck = sd; } catch (e) {}
var sess = { seen: 0, ok: 0, streak: 0, best: 0, miss: {} };

function sources() {
  var out = [];
  if (deck === "words" || deck === "mixed") {
    WORDS.forEach(function (w) { out.push({ t: "w", d: w, k: w.w, base: (w.deep || w.mark) ? 3 : 1 }); });
    TRAPS.forEach(function (t) { out.push({ t: "t", d: t, k: t.o[t.a], base: 3 }); });
  }
  if (deck === "grammar" || deck === "mixed") {
    GRAM.forEach(function (g) { out.push({ t: "g", d: g, k: g.f, base: 3 }); });
  }
  return out;
}
/* クリア＝2回続けて正解した語。無限に出題されるドリルに終点を作るための線。 */
function deckKeys() {
  var seen = {}, out = [];
  sources().forEach(function (x) { if (!seen[x.k]) { seen[x.k] = 1; out.push(x.k); } });
  return out;
}
function progress() {
  var keys = deckKeys(), done = 0;
  keys.forEach(function (k) { if ((ST.run[k] || 0) >= 2) done++; });
  return { done: done, total: keys.length };
}
/* まだクリアしていない語を優先する。クリア済みは背景でたまに戻るだけ。
   固定の重みで引くと、とっくに覚えた語が延々と出てきて終わりが来ない。 */
function refill() {
  var src = sources(), bag = [], done = [];
  src.forEach(function (x) {
    if ((ST.run[x.k] || 0) >= 2) { done.push(x); return; }
    var m = ST.miss[x.k] || 0, sm = sess.miss[x.k] || 0;
    var n = (x.base === 3 ? 2 : 1) + Math.min(m, 3) + sm * 2;
    for (var i = 0; i < n; i++) bag.push(x);
  });
  if (done.length) {                                   // 維持のため 15% ほど混ぜる
    shuffle(done).slice(0, Math.max(1, Math.round(bag.length * 0.15)))
      .forEach(function (x) { bag.push(x); });
  }
  if (!bag.length) bag = src.slice();                  // 全クリア後は自由復習
  queue = shuffle(bag);
}
function nextQ() {
  var guard = 0;
  while (guard++ < 40) {
    if (!queue.length) refill();
    var s = queue.shift();
    if (!s) { refill(); continue; }
    if (recent.indexOf(s.k) !== -1 && guard < 20) { queue.push(s); continue; }
    recent.push(s.k); if (recent.length > 6) recent.shift();
    return s.t === "w" ? wordQ(s.d) : s.t === "t" ? trapQ(s.d) : gramQ(s.d);
  }
  return wordQ(pick(WORDS));
}

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

function renderDrill() {
  var v = $("#view-drill"); v.innerHTML = "";
  var seg = el("div", "seg"), btns = [];
  function paint() {
    btns.forEach(function (x) { x.b.setAttribute("aria-selected", String(x.k === deck)); });
  }
  [["words", "単語"], ["grammar", "文法"], ["mixed", "全部"]].forEach(function (d) {
    var b = el("button", null, d[1]);
    btns.push({ b: b, k: d[0] });
    b.onclick = function () {
      if (deck === d[0]) return;
      deck = d[0];
      try { localStorage.setItem("n1app.deck", deck); } catch (e) {}
      recent = []; queue = [];
      paint();
      refill(); step();
    };
    seg.appendChild(b);
  });
  paint();
  v.appendChild(seg);
  var tip = el("p", "hint", "クリア＝<b>2回続けて正解</b>した語。残りが減らないうちは同じ語が何度でも戻ってくる。");
  tip.style.margin = "9px 2px 0";
  v.appendChild(tip);
  var host = el("div"); host.id = "qhost"; host.style.marginTop = "12px"; v.appendChild(host);
  step();
}

function paintProgress() {
  var pg = progress(), pct = pg.total ? pg.done / pg.total * 100 : 0;
  var rail = $("#rail");
  rail.style.width = pct.toFixed(1) + "%";
  rail.className = pg.done >= pg.total && pg.total ? "done" : "";
  $("#daytag").textContent = (pg.done >= pg.total && pg.total ? "全クリア " : "クリア ") +
    pg.done + "/" + pg.total;
  return pg;
}
function step() {
  cur = nextQ();
  var q = cur, host = $("#qhost");
  paintProgress();

  var head = q.kind === "g" ? "文法 · " + q.head : "単語 · " + q.head;
  var body =
    q.audio ? '<button class="speak" id="spk">' + SPK + 'もう一度 聞く</button>' :
    q.kanji ? '<p class="prompt kanji">' + q.kanji + '</p>' :
    q.form  ? '<p class="prompt form">' + q.form + '</p>' :
    q.cn    ? '<p class="prompt cn">' + q.cn + '</p>' :
              '<p class="prompt sent">' + q.sent.replace("＿＿", "<b>＿＿</b>") + '</p>';

  host.innerHTML = '<div class="card">' +
    '<div class="plate-top"><span class="eyebrow">' + head + '</span>' +
    '<span class="daytag">' + (deck === "grammar" ? "N2 文法" : ((q.word && q.word.day ? q.word.day : TODAYNUM) + "日目")) + '</span></div>' +
    body +
    '<div class="choices" id="ch">' + q.opts.map(function (o, n) {
      return '<button class="choice' + (q.jp ? " jp" : "") + '" data-n="' + n + '">' +
        '<span class="idx">' + (n + 1) + '</span><span>' + o + '</span></button>';
    }).join("") + '</div><div id="rev"></div></div>';

  if (q.audio) { say(q.audio); $("#spk").onclick = function () { say(q.audio); }; }
  Array.prototype.forEach.call($("#ch").children, function (b) {
    b.onclick = function () { answer(+b.dataset.n); };
  });
}

function answer(n) {
  var q = cur, good = n === q.ans;
  sess.seen++;
  ST.seen[q.key] = (ST.seen[q.key] || 0) + 1;
  var d = ST.day[TODAY] || (ST.day[TODAY] = { seen: 0, ok: 0, miss: {} });
  d.seen++;
  var justCleared = false;
  if (good) {
    d.ok++;
    ST.run[q.key] = (ST.run[q.key] || 0) + 1;
    if (ST.run[q.key] === 2) justCleared = true;
    /* 1回目に正解したら、その語を数問先に差し込む。
       次の周回まで待たせると、いつまでもクリアにならず進捗が動かない。
       7問以上先にしているのは直近6問の重複よけをすり抜けさせないため。 */
    if (ST.run[q.key] === 1) {
      var back = { t: q.kind === "g" ? "g" : "w", d: q.kind === "g" ? q.gram : q.word, k: q.key, base: 1 };
      queue.splice(Math.min(queue.length, 7 + (Math.random() * 5 | 0)), 0, back);
    }
    sess.ok++; sess.streak++;
    if (sess.streak > sess.best) sess.best = sess.streak;
    if (sess.streak > (ST.best || 0)) { ST.best = sess.streak; }
  } else {
    sess.streak = 0;
    ST.run[q.key] = 0;
    ST.lastMiss[q.key] = TODAY;
    d.miss[q.key] = (d.miss[q.key] || 0) + 1;
    sess.miss[q.key] = (sess.miss[q.key] || 0) + 1;
    ST.miss[q.key] = (ST.miss[q.key] || 0) + 1;
    queue.unshift({ t: q.kind === "g" ? "g" : "w", d: q.kind === "g" ? q.gram : q.word, k: q.key });
  }
  save();
  var pg = paintProgress();

  Array.prototype.forEach.call($("#ch").children, function (b, i) {
    b.disabled = true;
    if (i === q.ans) b.className += " is-ok";
    else if (i === n) b.className += " is-no";
  });

  var rev = "";
  if (q.kind === "g") {
    var g = q.gram;
    rev = '<div class="rd"><span class="k" style="font-size:22px">' + g.f + '</span>' +
      '<span class="y">' + g.y + '</span><span class="c">' + g.cn + '</span></div>' +
      '<p class="conn">' + g.conn + '</p>' +
      exBlock(g) +
      (q.why ? '<p class="note">' + q.why + '</p>' : "") +
      (g.trap ? '<p class="note">' + g.trap + '</p>' : "");
  } else {
    var w = q.word, ho = homophones(w);
    rev = '<div class="rd"><span class="k">' + w.w + '</span><span class="y">' + w.r + '</span>' +
      '<span class="c">' + w.c + '</span></div>' +
      (ho.length ? '<p class="note">⚠️ 同音：<b>' + ho.join("・") + '</b> — 読みだけでは決まらない。文脈で選ぶ。</p>' : "") +
      exBlock(w) +
      (q.why ? '<p class="note">' + q.why + '</p>' : "") +
      (w.note ? '<p class="note">' + w.note + '</p>' : "") +
      knetHTML(w);
  }

  $("#rev").innerHTML = '<div class="reveal">' +
    '<div class="verdict ' + (good ? "ok" : "no") + '"><span>' +
    (good ? (justCleared ? "正解 — クリア" : "正解") : "不正解") + '</span>' +
    '<span class="streak" style="margin-left:12px;color:var(--accent)">残り ' + (pg.total - pg.done) + '</span>' +
    '<span class="streak">連続 ' + sess.streak + ' · 最高 ' + Math.max(sess.best, ST.best || 0) +
    (sess.seen ? ' · 正解率 ' + Math.round(sess.ok / sess.seen * 100) + '%' : "") + '</span></div>' +
    rev + '<button class="next" id="nx">つぎへ</button></div>';

  if (q.kind !== "g" && !q.audio) say(q.word.w);
  Array.prototype.forEach.call($("#rev").querySelectorAll("[data-say]"), function (b) {
    b.onclick = function (ev) { ev.preventDefault(); say(b.dataset.say, b.className === "exline" ? 0.95 : 0.85); };
  });
  var nx = $("#nx");
  nx.onclick = function () { step(); window.scrollTo(0, 0); };
  nx.focus({ preventScroll: true });
}

/* ---------------- 漢字 view ---------------- */
function renderKanji() {
  var map = {}, order = [];
  WORDS.forEach(function (w) {
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
    '<span class="eyebrow">' + DAY.label + ' · 漢字ネットワーク</span>' +
    '<h2>一語を三語に増やす</h2>' +
    '<p class="hint">意思你本來就懂，缺的只有音。同一個漢字的其他組合一起記，邊際成本幾乎是零。<b>點任何一個詞會念給你聽。</b></p>' +
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
    '<p class="hint">你 N2 這些都看過，問題是<b>選項擺在一起時分不出來</b>。每一條的最後一行就是那個分界點。要練的話去「ドリル」切到文法。</p>' +
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
      var b = ST.times[TODAYNUM + "-" + i];
      return '<div class="card" data-card="' + i + '">' +
        '<div class="plate-top"><span class="eyebrow">' + p.t + '</span>' +
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
    var k = TODAYNUM + "-" + activeP;
    if (!ST.times[k] || s < ST.times[k]) { ST.times[k] = s; save(); renderRead(); }
    $("#clock").textContent = fmt(s);
    return;
  }
  t0 = Date.now(); btn.textContent = "ストップ";
  tick = setInterval(function () {
    $("#clock").textContent = fmt(Math.floor((Date.now() - t0) / 1000));
  }, 200);
}

/* ---------------- 共有 view : 今日のレポート ＋ 会話プロンプト ---------------- */
/* 「不熟」の定義
   score = ミス回数×2 + ミス率×4 − 直近の連続正解×1.2
   絶対量・比率・回復ぶんの三つを同時に見る。回復した語は自動的に落ちる。 */
function weakness(key) {
  var m = ST.miss[key] || 0;
  if (!m) return 0;
  var s = Math.max(ST.seen[key] || 0, 1), run = ST.run[key] || 0;
  return m * 2 + (m / s) * 4 - Math.min(run, 4) * 1.2;
}
function lookup(key) {
  var w = WORDS.filter(function (x) { return x.w === key; })[0];
  if (w) return { kind: "w", label: w.w, sub: w.r, cn: w.c, deep: w.deep };
  var g = GRAM.filter(function (x) { return x.f === key; })[0];
  if (g) return { kind: "g", label: g.f, sub: g.y, cn: g.cn };
  return { kind: "w", label: key, sub: "", cn: "" };
}
function weakList() {
  var keys = {};
  Object.keys(ST.miss).forEach(function (k) { if (ST.miss[k]) keys[k] = 1; });
  var today = (ST.day[TODAY] && ST.day[TODAY].miss) || {};
  Object.keys(today).forEach(function (k) { keys[k] = 1; });
  return Object.keys(keys).map(function (k) {
    var info = lookup(k);
    return {
      key: k, kind: info.kind, label: info.label, sub: info.sub, cn: info.cn, deep: info.deep !== false,
      m: ST.miss[k] || 0, s: ST.seen[k] || 0, run: ST.run[k] || 0,
      todayMiss: today[k] || 0, last: ST.lastMiss[k] || "",
      score: weakness(k)
    };
  }).sort(function (a, b) { return b.score - a.score; });
}
function tiers() {
  var all = weakList();
  /* 通算3回以上ミスした語は、直近で戻っていても必ず要注意に出す。
     leeches.md に載せる基準がそれだから。 */
  var hot = all.filter(function (x) { return x.score >= 5 || x.m >= 3; });
  var warm = all.filter(function (x) { return hot.indexOf(x) < 0 && x.score >= 2; });
  /* 「1回ミスしてすぐ2回続けて正解」はただのブレ。もう戻った語は出さない。 */
  var cool = all.filter(function (x) {
    return hot.indexOf(x) < 0 && warm.indexOf(x) < 0 && x.todayMiss > 0 && x.run < 2;
  });
  var settled = all.filter(function (x) {
    return hot.indexOf(x) < 0 && warm.indexOf(x) < 0 && x.todayMiss > 0 && x.run >= 2;
  });
  var back = all.filter(function (x) { return x.score < 2 && x.todayMiss === 0 && x.run >= 3; });
  return { all: all, hot: hot, warm: warm, cool: cool, settled: settled, back: back };
}

function line(x) {
  var s = "- " + x.label + (x.sub ? "（" + x.sub + "）" : "") + (x.cn ? " " + x.cn : "");
  s += " … " + x.s + "回中" + x.m + "回ミス";
  if (x.run) s += "／直近" + x.run + "連続正解";
  return s;
}
function buildReport() {
  var t = tiers(), d = ST.day[TODAY] || { seen: 0, ok: 0, miss: {} };
  var rate = d.seen ? Math.round(d.ok / d.seen * 100) : 0;
  var out = [];
  out.push("【モリタン ドリル " + TODAY + "】" + DAY.label + " " + DAY.range);
  out.push("今日 " + d.seen + "問 / 正解 " + d.ok + "（" + rate + "%）｜累計ミス語 " + t.all.length + " 件");
  out.push("");

  function sec(title, arr) {
    if (!arr.length) return;
    out.push("■ " + title + "（" + arr.length + "）");
    arr.slice(0, 25).forEach(function (x) { out.push(line(x)); });
    if (arr.length > 25) out.push("…ほか " + (arr.length - 25) + " 件");
    out.push("");
  }
  var hw = t.hot.filter(function (x) { return x.kind === "w"; });
  var hg = t.hot.filter(function (x) { return x.kind === "g"; });
  var ww = t.warm.filter(function (x) { return x.kind === "w"; });
  var wg = t.warm.filter(function (x) { return x.kind === "g"; });
  sec("要注意 — 単語", hw);
  sec("要注意 — 文法", hg);
  sec("あやしい — 単語", ww);
  sec("あやしい — 文法", wg);
  var promo = t.all.filter(function (x) { return !x.deep && x.m >= 2; });
  if (promo.length) {
    out.push("■ 昇格候補 — 「知ってるつもりだった」語（" + promo.length + "）");
    out.push("  ※圈のときは自分で分かると思っていたが、音から引けなかったもの。");
    promo.slice(0, 20).forEach(function (x) { out.push(line(x)); });
    out.push("");
  }
  sec("今日つまずいて、まだ戻っていない", t.cool);
  if (t.settled.length) {
    out.push("■ 今日1回ミスしたが、その場で戻った（" + t.settled.length + "）― 対応不要");
    out.push(t.settled.slice(0, 30).map(function (x) { return x.label; }).join("・"));
    out.push("");
  }
  if (t.back.length) {
    out.push("■ 回復した（もう出題頻度は下げてある）");
    out.push(t.back.slice(0, 20).map(function (x) { return x.label; }).join("・"));
    out.push("");
  }
  var times = Object.keys(ST.times).filter(function (k) { return k.indexOf(TODAYNUM + "-") === 0; });
  if (times.length) {
    out.push("■ 計時読解（" + DAY.label + "）");
    times.forEach(function (k) {
      var p = PASSAGES[+k.split("-")[1]];
      if (p) out.push("- " + p.t + " 最速 " + fmt(ST.times[k]) + "（目標 " + fmt(p.sec) + "）");
    });
    out.push("");
  }
  if (!t.hot.length && !t.warm.length && !t.cool.length) {
    out.push("■ 今日は引っかかった語なし。");
    out.push("");
  }
  out.push("――――――");
  out.push("請據此更新 leeches.md（錯 3 次以上的）與 mistakes.md（文法），");
  out.push("「昇格候補」的請在明天的教材補上完整精讀（例句・辨析・漢字網路），");
  out.push("並把「要注意」那批混進明天的例句和陷阱句加重。");
  return out.join("\n");
}

function renderShare() {
  var t = tiers(), d = ST.day[TODAY] || { seen: 0, ok: 0 };
  var rate = d.seen ? Math.round(d.ok / d.seen * 100) : 0;
  var v = $("#view-prompt");
  v.innerHTML = '<div class="stack">' +
    '<div class="card">' +
      '<span class="eyebrow">寝る前に一回</span><h2>今日のレポート</h2>' +
      '<div class="score">' +
        '<div><div class="n">' + d.seen + '</div><div class="l">今日の問題</div></div>' +
        '<div><div class="n">' + rate + '<small>%</small></div><div class="l">正解率</div></div>' +
        '<div><div class="n">' + (t.hot.length + t.warm.length) + '</div><div class="l">不熟</div></div>' +
      '</div>' +
      (t.hot.length || t.warm.length || t.cool.length
        ? '<ul class="miss">' + t.hot.concat(t.warm).slice(0, 8).map(function (x) {
            return '<li><span class="k">' + x.label + '</span>' +
              (x.sub ? '<span class="y">' + x.sub + '</span>' : "") +
              (x.cn ? '<span class="c">' + x.cn + '</span>' : "") +
              '<span class="n">' + x.m + '/' + x.s + '</span></li>';
          }).join("") + '</ul>' +
          ((t.hot.length + t.warm.length) > 8
            ? '<p class="hint">ほか ' + (t.hot.length + t.warm.length - 8) + ' 件。全部レポートに入る。</p>' : "")
        : '<p class="hint">まだ引っかかった語がない。ドリルを回してから来て。</p>') +
      '<button class="next" id="rep">レポートをコピー</button>' +
      '<p class="hint"><b>不熟の定義</b>：ミス回数×2 ＋ ミス率×4 − 直近の連続正解×1.2。' +
      '回數多、比例高、而且最近沒救回來的才算。貼給 Claude 就會進 leeches.md。</p>' +
    '</div>' +
    '<div class="card">' +
      '<span class="eyebrow">帰りの電車で</span><h2>会話プロンプト</h2>' +
      '<p class="hint">複製 → 貼進手機的 Claude 或 Gemini。規則已經寫死：<b>你答不出來時它不會直接給答案</b>。</p>' +
      '<textarea id="pbox" readonly></textarea>' +
      '<button class="next ghost" id="copy">プロンプトをコピー</button>' +
    '</div>' +
    '<div class="card">' +
      '<span class="eyebrow">困ったとき</span>' +
      '<p class="hint">語数が増えないときはキャッシュが古い。下を押すと全部捨てて取り直す。' +
      '<b>学習記録は消えない</b>（クリア数・ミス回数はそのまま）。</p>' +
      '<button class="next ghost" id="reset">最新版を取り直す</button>' +
      '<p class="hint" style="text-align:center">' + BUILD + ' · 出題 ' + WORDS.length + '語 · 卒業 ' + (ALLWORDS.length - WORDS.length) + '語</p>' +
    '</div></div>';

  $("#pbox").value = PROMPT;
  wireCopy($("#rep"), buildReport, "レポートをコピー");
  wireCopy($("#copy"), function () { return PROMPT; }, "プロンプトをコピー");
  $("#reset").onclick = function () {
    $("#reset").textContent = "取り直しています…";
    window.moritanReset();
  };
}

function wireCopy(btn, getText, label) {
  if (!btn) return;
  btn.onclick = function () {
    var text = getText();
    var done = function () { btn.textContent = "コピーしました"; setTimeout(function () { btn.textContent = label; }, 2200); };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { btn.textContent = "コピーできず — 長押しで選択して"; }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  };
}

var PROMPT = "あなたは私のN1単語トレーナーです。全部日本語で話してください。\n\n" +
"【今日の語】" + WORDS.map(function (w) { return w.w; }).join(" ") + "\n\n" +
"【ルール】\n" +
"1. 私は日本で働く外国人（管理職）です。仕事や生活の話題で、上の語を必ず使わせる質問をしてください。1回に1問だけ。\n" +
"2. 私が語を思い出せないとき、絶対に答えを先に言わないでください。まずヒント（使う場面・コロケーション・最初の一音）を出して、私に取り出させてください。2回失敗してから答えを教えてください。\n" +
"3. 私の日本語が不自然なとき、その場で直してください。「なぜ不自然か」を一行で。\n" +
"4. 漢字の意味は分かるが読みが怪しい語があるので、読みを確認する質問も混ぜてください。\n" +
"5. 余裕があれば、N2文法（〜ざるを得ない／〜かねない／〜次第／〜どころか など）を使わせる質問も入れてください。\n" +
"6. 最後に、私が詰まった語と文法だけをリストで出してください。\n\n" +
"では1問目をお願いします。";

/* ---------------- nav ---------------- */
var VIEWS = [
  ["drill", "問", "ドリル", renderDrill],
  ["kanji", "漢", "漢字", renderKanji],
  ["grammar", "法", "文法", renderGrammar],
  ["read", "読", "読解", renderRead],
  ["prompt", "送", "共有", renderShare]
];
function show(id) {
  stopReading();
  VIEWS.forEach(function (v) {
    var on = v[0] === id;
    $("#view-" + v[0]).hidden = !on;
    $("#nav-" + v[0]).setAttribute("aria-selected", String(on));
  });
  var v = VIEWS.filter(function (x) { return x[0] === id; })[0];
  if (v) v[3]();
  if (id !== "drill") { $("#rail").style.width = "0%"; $("#daytag").textContent = DAY.range; }
  window.scrollTo(0, 0);
  try { localStorage.setItem("n1app.tab", id); } catch (e) {}
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
var BUILD = "v11";
(function () {
  var today = WORDS.filter(function (w) { return w.day === TODAYNUM; }).length;
  var carry = WORDS.length - today;
  var retired = ALLWORDS.length - WORDS.length;   // クリアして抜けた語＝消えたのではなく卒業
  $("#foot").textContent = DAY.label + " " + DAY.range.split(" ")[0] +
    " · 出題 " + WORDS.length + "語" +
    (carry ? "（今日 " + today + " ＋ 持ち越し " + carry + "）" : "") +
    (retired ? " · 卒業 " + retired : "") + " · " + BUILD;
})();
var start;
try { start = localStorage.getItem("n1app.tab"); } catch (e) {}
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
