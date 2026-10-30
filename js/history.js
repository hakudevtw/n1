/* 歷程ページの図。手刻み SVG 文字列を返す純関数（DOM・保存データには触らない）。
   色は css/app.css のクラス（hm*, bx*, ax, ln …）で当てるので、ライト／ダークは自動。
   出てくる文字列は固定ラベルと数値だけ（貼り付け由来の文字は入らない）。 */
(function (root) {
"use strict";

var SRS = typeof module !== "undefined" && module.exports ? require("./srs.js") : root.SRS;

function r1(x) { return Math.round(x * 10) / 10; }
function dow(d) { return new Date(d + "T00:00:00").getDay(); }          // 0=日
function act(days, d) { var x = days[d]; return x ? (x.n || 0) + (x["new"] != null ? x["new"] : x.newN || 0) : 0; }
function svg(w, h, body, label) {
  return '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + label + '" xmlns="http://www.w3.org/2000/svg">' + body + "</svg>";
}
function level(n) { return n <= 0 ? 0 : n <= 5 ? 1 : n <= 15 ? 2 : n <= 30 ? 3 : 4; }
function md(d) { return d.slice(5).replace("-", "/"); }

/* ① 日曆熱度圖: 近 weeks 週、月曜始まり。空白の日（最初に活動した日より後）は赤い点線で「穴」を見せる。 */
function heatmap(days, today, weeks) {
  weeks = weeks || 12;
  var cell = 22, gap = 3, pitch = cell + gap, left = 18, top = 16;
  var mondayOffset = (dow(today) + 6) % 7;                       // 今日が週の何日目か（月=0）
  var start = SRS.addDays(today, -(mondayOffset + (weeks - 1) * 7));
  var first = null;
  Object.keys(days).forEach(function (d) { if (act(days, d) > 0 && (!first || d < first)) first = d; });
  var out = "", lastMonth = "";
  ["月", "水", "金"].forEach(function (l, i) {
    out += '<text class="ax" x="0" y="' + (top + i * 2 * pitch + 15) + '">' + l + "</text>";
  });
  for (var w = 0; w < weeks; w++) {
    for (var r = 0; r < 7; r++) {
      var d = SRS.addDays(start, w * 7 + r);
      if (d > today) continue;
      var n = act(days, d), lv = level(n), cls = "hm" + lv;
      if (lv === 0 && first && d > first && d < today) cls += " hmgap";
      if (d === today) cls += " hmtoday";
      out += '<rect class="' + cls + '" x="' + (left + w * pitch) + '" y="' + (top + r * pitch) + '" width="' + cell + '" height="' + cell +
        '" rx="2"><title>' + md(d) + " · " + n + "</title></rect>";
      if (r === 0) {
        var m = d.slice(5, 7);
        if (m !== lastMonth && (w === 0 || +d.slice(8) <= 7)) { out += '<text class="ax" x="' + (left + w * pitch) + '" y="10">' + (+m) + "月</text>"; lastMonth = m; }
      }
    }
  }
  return svg(left + weeks * pitch, top + 7 * pitch, out, "近 " + weeks + " 週の学習量");
}

/* ② 長期記憶の枚数（箱 4 以上）の推移。ltm = {日付: 枚数}、nowCount = 今日の現在値。 */
function ltmLine(ltm, today, nowCount, span) {
  span = span || 90;
  var from = SRS.addDays(today, -span), pts = [];
  Object.keys(ltm).sort().forEach(function (d) { if (d >= from && d <= today) pts.push([d, ltm[d]]); });
  if (!pts.length || pts[pts.length - 1][0] !== today) pts.push([today, nowCount]); else pts[pts.length - 1][1] = nowCount;
  var W = 320, H = 130, pl = 28, pr = 10, pt = 12, pb = 22;
  var max = Math.max(5, nowCount, Math.max.apply(null, pts.map(function (p) { return p[1]; })));
  max = Math.ceil(max / 5) * 5;
  var x0 = pts[0][0], span2 = Math.max(1, SRS.diffDays(x0, today));
  function X(d) { return pl + (W - pl - pr) * (pts.length === 1 ? 1 : SRS.diffDays(x0, d) / span2); }
  function Y(v) { return pt + (H - pt - pb) * (1 - v / max); }
  var line = pts.map(function (p, i) { return (i ? "L" : "M") + r1(X(p[0])) + " " + r1(Y(p[1])); }).join(" ");
  var body = '<line class="grid" x1="' + pl + '" y1="' + r1(Y(0)) + '" x2="' + (W - pr) + '" y2="' + r1(Y(0)) + '"/>' +
    '<line class="grid" x1="' + pl + '" y1="' + r1(Y(max)) + '" x2="' + (W - pr) + '" y2="' + r1(Y(max)) + '"/>' +
    '<text class="ax" x="2" y="' + (r1(Y(max)) + 3) + '">' + max + '</text><text class="ax" x="2" y="' + (r1(Y(0)) + 3) + '">0</text>' +
    (pts.length > 1 ? '<path class="area" d="' + line + " L" + r1(X(today)) + " " + r1(Y(0)) + " L" + r1(X(x0)) + " " + r1(Y(0)) + ' Z"/>' : "") +
    '<path class="ln" d="' + line + '"/>';
  pts.forEach(function (p) { body += '<circle class="dot" cx="' + r1(X(p[0])) + '" cy="' + r1(Y(p[1])) + '" r="2.6"><title>' + md(p[0]) + " · " + p[1] + "</title></circle>"; });
  body += '<text class="ax" x="' + pl + '" y="' + (H - 6) + '">' + md(x0) + '</text><text class="ax" text-anchor="end" x="' + (W - pr) + '" y="' + (H - 6) + '">' + md(today) + " · " + nowCount + "</text>";
  return svg(W, H, body, "長期記憶の枚数の推移");
}

/* ③ 箱の分布（積み上げ横棒）。counts[0..6]。 */
function boxBar(counts) {
  var tot = counts.reduce(function (a, b) { return a + b; }, 0);
  if (!tot) return "";
  var W = 320, x = 0, body = "";
  counts.forEach(function (n, b) {
    if (!n) return;
    var w = W * n / tot;
    body += '<rect class="bx' + b + '" x="' + r1(x) + '" y="0" width="' + r1(w) + '" height="26"><title>箱 ' + b + " · " + n + "</title></rect>";
    if (w > 22) body += '<text class="bxt" x="' + r1(x + w / 2) + '" y="17" text-anchor="middle">' + n + "</text>";
    x += w;
  });
  return svg(W, 26, body, "箱の分布");
}

/* ④ 直近 n 日の量（新詞＋復習の積み上げ）と正解率。 */
function dailyBars(days, today, n) {
  n = n || 30;
  var W = 320, pl = 24, pr = 4, hb = 84, ha = 40, top = 6, gapH = 16;
  var bw = (W - pl - pr) / n, list = [], max = 5;
  for (var i = n - 1; i >= 0; i--) {
    var d = SRS.addDays(today, -i), x = days[d] || {};
    var nw = x["new"] != null ? x["new"] : x.newN || 0, rev = x.rev != null ? x.rev : Math.max(0, (x.n || 0));
    list.push({ d: d, nw: nw, rev: rev, n: x.n || 0, ok: x.ok || 0, idk: x.idk || 0 });
    max = Math.max(max, nw + rev);
  }
  max = Math.ceil(max / 10) * 10;
  var base = top + hb, body = '<line class="grid" x1="' + pl + '" y1="' + base + '" x2="' + (W - pr) + '" y2="' + base + '"/>' +
    '<text class="ax" x="0" y="' + (top + 8) + '">' + max + '</text>';
  var aTop = base + gapH, pts = [];
  list.forEach(function (it, i) {
    var x = pl + i * bw, tot = it.nw + it.rev;
    if (tot > 0) {
      var hr = hb * it.rev / max, hn = hb * it.nw / max;
      body += '<rect class="bar-rev" x="' + r1(x + 1) + '" y="' + r1(base - hr) + '" width="' + r1(bw - 2) + '" height="' + r1(hr) + '"><title>' + md(it.d) + " 復習 " + it.rev + " / 新詞 " + it.nw + "</title></rect>";
      if (hn > 0) body += '<rect class="bar-new" x="' + r1(x + 1) + '" y="' + r1(base - hr - hn) + '" width="' + r1(bw - 2) + '" height="' + r1(hn) + '"/>';
    } else if (it.d !== today) body += '<rect class="bar-gap" x="' + r1(x + 1) + '" y="' + (base - 3) + '" width="' + r1(bw - 2) + '" height="3"/>';
    var den = it.n - it.idk;
    if (den > 0) pts.push([x + bw / 2, aTop + ha * (1 - it.ok / den), Math.round(it.ok / den * 100), it.d]);
  });
  body += '<line class="grid" x1="' + pl + '" y1="' + (aTop + ha) + '" x2="' + (W - pr) + '" y2="' + (aTop + ha) + '"/>' +
    '<line class="grid dash" x1="' + pl + '" y1="' + r1(aTop + ha * 0.2) + '" x2="' + (W - pr) + '" y2="' + r1(aTop + ha * 0.2) + '"/>' +
    '<text class="ax" x="0" y="' + (aTop + 6) + '">100%</text><text class="ax" x="0" y="' + (aTop + ha) + '">0</text>';
  if (pts.length > 1) body += '<path class="ln" d="' + pts.map(function (p, i) { return (i ? "L" : "M") + r1(p[0]) + " " + r1(p[1]); }).join(" ") + '"/>';
  pts.forEach(function (p) { body += '<circle class="dot" cx="' + r1(p[0]) + '" cy="' + r1(p[1]) + '" r="2"><title>' + md(p[3]) + " · " + p[2] + "%</title></circle>"; });
  body += '<text class="ax" x="' + pl + '" y="' + (aTop + ha + 12) + '">' + md(list[0].d) + '</text><text class="ax" text-anchor="end" x="' + (W - pr) + '" y="' + (aTop + ha + 12) + '">' + md(today) + "</text>";
  return svg(W, aTop + ha + 16, body, "直近 " + n + " 日の量と正解率");
}

/* ⑤ 延遲測驗の正解率の推移。delayed = [{date, n, correct}] */
function delayedLine(delayed) {
  if (!delayed.length) return "";
  var W = 320, H = 110, pl = 28, pr = 12, pt = 14, pb = 20, n = delayed.length;
  function X(i) { return pl + (W - pl - pr) * (n === 1 ? 0.5 : i / (n - 1)); }
  function Y(p) { return pt + (H - pt - pb) * (1 - p / 100); }
  var pts = delayed.map(function (x, i) { return [X(i), Y(Math.round(x.correct / x.n * 100)), Math.round(x.correct / x.n * 100), x.date]; });
  var body = '<line class="grid" x1="' + pl + '" y1="' + r1(Y(0)) + '" x2="' + (W - pr) + '" y2="' + r1(Y(0)) + '"/>' +
    '<line class="grid dash" x1="' + pl + '" y1="' + r1(Y(80)) + '" x2="' + (W - pr) + '" y2="' + r1(Y(80)) + '"/>' +
    '<text class="ax" x="2" y="' + (r1(Y(100)) + 3) + '">100</text><text class="ax" x="2" y="' + (r1(Y(80)) + 3) + '">80</text><text class="ax" x="2" y="' + (r1(Y(0)) + 3) + '">0</text>';
  if (n > 1) body += '<path class="ln" d="' + pts.map(function (p, i) { return (i ? "L" : "M") + r1(p[0]) + " " + r1(p[1]); }).join(" ") + '"/>';
  pts.forEach(function (p) {
    body += '<circle class="dot" cx="' + r1(p[0]) + '" cy="' + r1(p[1]) + '" r="3"><title>' + md(p[3]) + " · " + p[2] + '%</title></circle>' +
      '<text class="ax" text-anchor="middle" x="' + r1(p[0]) + '" y="' + r1(p[1] - 7) + '">' + p[2] + "</text>";
  });
  return svg(W, H, body, "延遲測驗の正解率");
}

var api = { heatmap: heatmap, ltmLine: ltmLine, boxBar: boxBar, dailyBars: dailyBars, delayedLine: delayedLine };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.HIST = api;
})(typeof window !== "undefined" ? window : this);
