/* node tools/test-srs.js — js/srs.js の単体テスト（依存なし） */
"use strict";
var assert = require("assert");
var SRS = require("../js/srs.js");
var T = "2026-11-01", pass = 0;
function t(name, fn) { fn(); pass++; console.log("ok  " + name); }
var ids = function (n, p) { var a = []; for (var i = 1; i <= n; i++) a.push((p || "w:") + i); return a; };

t("new card: two correct in session graduates to box 1 (due tomorrow)", function () {
  var s = SRS.introduce(T);
  assert.equal(s.box, 0);
  s = SRS.grade(s, "ok", T);
  assert.equal(s.box, 0); assert.equal(s.due, T);
  s = SRS.grade(s, "ok", T);
  assert.equal(s.box, 1); assert.equal(s.due, "2026-11-02"); assert.equal(s.correctStreak, 0);
});

t("new card: miss in learning does not lapse and resets streak", function () {
  var s = SRS.grade(SRS.introduce(T), "ok", T);
  s = SRS.grade(s, "miss", T, "audio");
  assert.equal(s.box, 0); assert.equal(s.lapses, 0); assert.equal(s.correctStreak, 0);
  assert.equal(s.mt.audio, 1);
});

t("correct answers advance 1,3,7,14,30,60 and cap at box 6", function () {
  var s = { box: 1, due: T, lapses: 0, seen: 3, last: T, correctStreak: 0 };
  var gaps = [3, 7, 14, 30, 60, 60];
  var boxes = [2, 3, 4, 5, 6, 6];
  gaps.forEach(function (g, i) {
    s = SRS.grade(s, "ok", T);
    assert.equal(s.box, boxes[i]);
    assert.equal(s.due, SRS.addDays(T, g));
  });
});

t("miss from box 4 returns to box 1, lapses++, due tomorrow", function () {
  var s = { box: 4, due: T, lapses: 0, seen: 5, last: T, correctStreak: 2 };
  var m = SRS.grade(s, "miss", T, "read");
  assert.equal(m.box, 1); assert.equal(m.lapses, 1); assert.equal(m.due, "2026-11-02");
  assert.equal(m.correctStreak, 0);
  assert.equal(s.box, 4, "input not mutated");
});

t("idk schedules like a miss and is counted separately", function () {
  var s = { box: 3, due: T, lapses: 0, seen: 5, last: T, correctStreak: 1 };
  var m = SRS.grade(s, "idk", T);
  assert.equal(m.box, 1); assert.equal(m.lapses, 1); assert.equal(m.idk, 1);
});

t("long-term = box >= 4 in stats; leech = lapses >= 3", function () {
  var st = {
    a: { box: 4, due: "2026-12-01", lapses: 0 }, b: { box: 3, due: T, lapses: 3 },
    c: { box: 6, due: "2027-01-01", lapses: 4 }, d: { box: 1, due: "2026-10-01", lapses: 0 }
  };
  var x = SRS.stats(st, T);
  assert.equal(x.longTerm, 2); assert.equal(x.due, 2); assert.deepEqual(x.leeches, ["c", "b"]);
});

t("reviews due block new cards", function () {
  var order = ids(10);
  var st = { "w:1": { box: 2, due: T, lapses: 0 } };
  var p = SRS.plan(order, st, T, { newCap: 5 });
  assert.deepEqual(p.due, ["w:1"]); assert.deepEqual(p.newIds, []);
  assert.equal(p.newCount, 5, "new cards are available, just held back");
  st["w:1"].due = "2026-11-02";
  p = SRS.plan(order, st, T, { newCap: 5 });
  assert.equal(p.due.length, 0); assert.equal(p.newIds.length, 5);
});

t("reviews are ordered by due date, earliest first", function () {
  var st = { "w:1": { box: 2, due: "2026-11-01" }, "w:2": { box: 2, due: "2026-10-20" }, "w:3": { box: 2, due: "2026-10-25" } };
  assert.deepEqual(SRS.plan(ids(3), st, T, {}).due, ["w:2", "w:3", "w:1"]);
});

t("future-due cards are not offered", function () {
  var st = { "w:1": { box: 2, due: "2026-11-02" } };
  assert.equal(SRS.plan(ids(2), st, T, { newCap: 1 }).due.length, 0);
});

t("newCap limits new cards, counting today's introductions", function () {
  var order = ids(30), st = {};
  assert.equal(SRS.plan(order, st, T, { newCap: 20 }).newIds.length, 20);
  for (var i = 1; i <= 18; i++) st["w:" + i] = Object.assign(SRS.introduce(T), { box: 1, due: "2026-11-02" });
  var p = SRS.plan(order, st, T, { newCap: 20 });
  assert.equal(p.introduced, 18); assert.deepEqual(p.newIds, ["w:19", "w:20"]);
  assert.equal(SRS.plan(order, st, T, { newCap: 20, extra: 10 }).newIds.length, 12);
  assert.equal(SRS.plan(order, st, T, { newCap: 18 }).newIds.length, 0);
});

t("priority words come first, in order, and only if unseen", function () {
  var order = ids(10), st = { "w:9": { box: 2, due: "2026-11-05", first: "2026-10-01" } };
  var p = SRS.plan(order, st, T, { newCap: 3, priority: ["w:7", "w:9", "w:5"] });
  assert.deepEqual(p.newIds, ["w:7", "w:5", "w:1"]);
});

t("canIntroduce gates ineligible new cards", function () {
  var p = SRS.plan(ids(5), {}, T, { newCap: 2, canIntroduce: function (id) { return id !== "w:1"; } });
  assert.deepEqual(p.newIds, ["w:2", "w:3"]);
});

t("minimum viable day: reviews only, max 20, no new cards", function () {
  var order = ids(40), st = {};
  for (var i = 1; i <= 30; i++) st["w:" + i] = { box: 2, due: "2026-10-30" };
  var p = SRS.plan(order, st, T, { mode: "mvd", newCap: 20 });
  assert.equal(p.due.length, 20); assert.equal(p.newIds.length, 0); assert.equal(p.newCount, 0);
  assert.equal(SRS.plan(order, st, T, { mode: "mvd", mvdLimit: 5 }).due.length, 5);
  assert.equal(SRS.plan(order, {}, T, { mode: "mvd" }).newIds.length, 0);
});

t("exclude hides cards already handled this session", function () {
  var st = { "w:1": { box: 0, due: T } };
  assert.equal(SRS.plan(ids(3), st, T, { newCap: 0, exclude: { "w:1": 1 } }).due.length, 0);
});

t("import known: box 3, due in 7 days, no downgrade, not a new introduction", function () {
  var st = { "w:2": { box: 5, due: "2026-12-01", lapses: 1, seen: 9, last: T, first: "2026-10-01" },
             "w:3": { box: 1, due: T, lapses: 2, seen: 4, last: T, first: "2026-10-30" } };
  var out = SRS.importKnown(st, ["w:1", "w:2", "w:3"], T);
  assert.equal(out["w:1"].box, 3); assert.equal(out["w:1"].due, "2026-11-08");
  assert.equal(out["w:1"].first, null);
  assert.equal(out["w:2"].box, 5);
  assert.equal(out["w:3"].box, 3); assert.equal(out["w:3"].lapses, 2);
  assert.equal(SRS.introducedOn(out, T), 0);
  assert.equal(SRS.plan(ids(3), out, T, { newCap: 5 }).due.length, 0, "not due until a week later");
  assert.equal(SRS.plan(ids(3), out, "2026-11-08", {}).due.length, 2, "w:2 (box 5) is still far off");
  assert.equal(st["w:1"], undefined, "input not mutated");
});

t("delayed test sampling: box >= 3 and last >= 14 days ago, max n", function () {
  var st = {
    a: { box: 3, last: "2026-10-18" }, b: { box: 3, last: "2026-10-19" },     // 14 / 13 days
    c: { box: 2, last: "2026-09-01" }, d: { box: 5, last: "2026-10-01" },
    e: { box: 4, last: null }
  };
  assert.deepEqual(SRS.delayedEligible(st, T), ["a", "d"]);
  var s = SRS.delayedSample(st, T, 1, function () { return 0; });
  assert.equal(s.length, 1);
  var big = {};
  for (var i = 0; i < 50; i++) big["x" + i] = { box: 4, last: "2026-09-01" };
  assert.equal(SRS.delayedSample(big, T, 20).length, 20);
  assert.equal(new Set(SRS.delayedSample(big, T, 20)).size, 20);
});

t("streak and last-7-days", function () {
  var daily = {};
  daily["2026-11-01"] = { n: 5 }; daily["2026-10-31"] = { newN: 3 }; daily["2026-10-30"] = { n: 2 };
  daily["2026-10-28"] = { n: 9 };
  assert.equal(SRS.streak(daily, T), 3);
  assert.equal(SRS.streak(daily, "2026-11-02"), 3, "today empty counts from yesterday");
  assert.equal(SRS.streak({}, T), 0);
  var l = SRS.lastDays(daily, T, 7);
  assert.equal(l.length, 7); assert.equal(l[0].date, "2026-10-26"); assert.equal(l[6].n, 5);
  assert.equal(l[3].n + l[3].newN, 0);
});

t("addDays crosses month/year boundaries", function () {
  assert.equal(SRS.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(SRS.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(SRS.diffDays("2026-10-18", "2026-11-01"), 14);
});

t("mark known (我熟了): box 5, due in 30 days, history kept, input not mutated", function () {
  var st = { box: 1, due: T, lapses: 4, seen: 9, last: T, first: "2026-10-01", idk: 2, mt: { audio: 3 } };
  var k = SRS.markKnown(st, T);
  assert.equal(k.box, 5); assert.equal(k.due, "2026-12-01"); assert.equal(k.lapses, 4);
  assert.equal(k.mt.audio, 3); assert.equal(st.box, 1);
  assert.equal(SRS.markKnown(undefined, T).box, 5);
  assert.equal(SRS.stats({ a: k }, T).longTerm, 1);
});

t("neutral skip (這題怪怪的): card state is untouched and it is excluded from the session", function () {
  var st = { "w:1": { box: 2, due: T, lapses: 1, seen: 3, last: "2026-10-28" } };
  var before = JSON.stringify(st);
  // app skips grade(); the plan must not offer it again once it is in exclude
  assert.deepEqual(SRS.plan(ids(2), st, T, { newCap: 0 }).due, ["w:1"]);
  assert.equal(SRS.plan(ids(2), st, T, { newCap: 0, exclude: { "w:1": 1 } }).due.length, 0);
  assert.equal(JSON.stringify(st), before);
});

t("ringPush keeps only the newest max items and does not mutate", function () {
  var a = [1, 2, 3], b = SRS.ringPush(a, 4, 3);
  assert.deepEqual(b, [2, 3, 4]); assert.deepEqual(a, [1, 2, 3]);
  var big = []; for (var i = 0; i < 520; i++) big = SRS.ringPush(big, i, 500);
  assert.equal(big.length, 500); assert.equal(big[0], 20); assert.equal(big[499], 519);
});

t("bumpDay aggregates answers / reviews / new / idk", function () {
  var d = {};
  SRS.bumpDay(d, T, { answer: "ok", review: true });
  SRS.bumpDay(d, T, { answer: "miss" });
  SRS.bumpDay(d, T, { answer: "idk", review: true });
  SRS.bumpDay(d, T, { introduced: true });
  assert.deepEqual(d[T], { n: 3, ok: 1, "new": 1, rev: 2, idk: 1 });
  assert.equal(SRS.streak(d, T), 1, "new-field days count as active");
});

t("longest streak across history", function () {
  var d = { "2026-10-01": { n: 1 }, "2026-10-02": { n: 1 }, "2026-10-03": { n: 1 }, "2026-10-05": { n: 1 }, "2026-10-06": { n: 0 } };
  assert.equal(SRS.longestStreak(d), 3); assert.equal(SRS.longestStreak({}), 0);
});

console.log("\n" + pass + " tests passed");
