/* node tools/test-sync.js — js/sync.js と js/audit.js の単体テスト（依存なし） */
"use strict";
var assert = require("assert");
var SRS = require("../js/srs.js");
var SYNC = require("../js/sync.js");
var AUDIT = require("../js/audit.js");
var T = "2026-11-01", NOW = Date.parse("2026-11-01T12:00:00"), pass = 0;
function t(name, fn) { fn(); pass++; console.log("ok  " + name); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function sample() {
  var s = SYNC.defaults();
  s.cards["w:a"] = { box: 4, due: "2026-11-20", lapses: 1, seen: 6, last: "2026-10-20", correctStreak: 0, first: "2026-10-01", idk: 0, mt: { audio: 1 }, u: Date.parse("2026-10-20T10:00:00") };
  s.cards["w:b"] = { box: 1, due: "2026-11-02", lapses: 3, seen: 9, last: T, correctStreak: 0, first: "2026-10-02", idk: 1, mt: { read: 2, audio: 1 }, u: Date.parse("2026-11-01T09:00:00") };
  s.cards["g:c"] = { box: 0, due: T, lapses: 0, seen: 1, last: T, correctStreak: 1, first: T, idk: 0, mt: {}, u: Date.parse("2026-11-01T09:30:00") };
  s.days["2026-10-20"] = { n: 10, ok: 8, "new": 5, rev: 5, idk: 0 };
  s.days["2026-10-31"] = { n: 4, ok: 3, "new": 0, rev: 4, idk: 1 };
  s.days[T] = { n: 12, ok: 9, "new": 3, rev: 9, idk: 1 };
  s.log = [
    { t: Date.parse("2026-10-20T10:00:00"), id: "w:a", q: "audio", ok: "ok", b0: 3, b1: 4 },
    { t: Date.parse("2026-11-01T09:00:00"), id: "w:b", q: "read", ok: "miss", b0: 2, b1: 1 }
  ];
  s.delayed = [{ date: "2026-10-25", n: 20, correct: 15 }];
  s.journal = [{ d: "2026-10-30", t: "**先** 休息" }];
  s.priority = ["w:z"]; s.notes = { "w:b": "用 **例句** 記" };
  s.flags = [{ t: Date.parse("2026-11-01T09:10:00"), id: "w:b", q: "read", snap: { head: "読みを選ぶ", prompt: "角", opts: ["かど", "つの"], ans: 0 } }];
  s.ltm = { "2026-10-20": 1, "2026-11-01": 1 }; s.settings.newCap = 12;
  return SYNC.normalizeState(s).state;
}
var KNOWN = { "w:a": 1, "w:b": 1, "g:c": 1, "w:p": 1, "w:q": 1, "w:z": 1 };
var CTX_BASE = function (st) {
  return { known: function (id) { return !!KNOWN[id]; }, hasCard: function (id) { return !!st.cards[id]; } };
};
function coach(o) { return JSON.stringify(Object.assign({ kind: "n1.coach", schema: 2, id: "c-1", issuedAt: "2026-11-01T13:00:00Z" }, o || {})); }

t("normalizeState is idempotent and keeps valid data", function () {
  var s = sample(), again = SYNC.normalizeState(clone(s)).state;
  assert.deepEqual(again, s);
  assert.equal(s.cards["w:b"].lapses, 3);
});

t("normalizeState drops broken cards, migrates old daily/newCap, ignores unknown fields", function () {
  var n = SYNC.normalizeState({ cards: { x: { box: 99, due: "2026-11-01" }, y: { box: 2, due: "bad" }, z: { box: 2, due: T } },
    daily: { "2026-10-01": { n: 3, ok: 2, newN: 4 } }, newCap: 999, evil: { a: 1 }, __proto__: { p: 1 } });
  assert.deepEqual(Object.keys(n.state.cards), ["z"]); assert.equal(n.dropped, 2);
  assert.deepEqual(n.state.days["2026-10-01"], { n: 3, ok: 2, "new": 4, rev: 0, idk: 0 });
  assert.equal(n.state.settings.newCap, 50);
  assert.equal(n.state.evil, undefined);
  assert.equal(SYNC.normalizeState(null).ok, false);
  assert.equal(SYNC.normalizeState([]).ok, false);
});

t("backup round trip: restore gives an identical state", function () {
  var s = sample(), text = SYNC.stringify(SYNC.buildBackup(s, NOW));
  var p = SYNC.parseBackup(text);
  assert.ok(p.ok, p.error);
  assert.deepEqual(p.state, s);
  assert.equal(JSON.stringify(p.state), JSON.stringify(s), "same key order too");
});

t("backup parse: wrong kind / schema / garbage are refused with a message", function () {
  var s = sample();
  assert.equal(SYNC.parseBackup("nope").ok, false);
  assert.equal(SYNC.parseBackup('{"kind":"n1.backup"').ok, false);
  assert.equal(SYNC.parseBackup(coach()).ok, false);
  var b = SYNC.buildBackup(s, NOW); b.schema = 9;
  assert.match(SYNC.parseBackup(JSON.stringify(b)).error, /schema/);
  b = SYNC.buildBackup(s, NOW); b.state = "x";
  assert.equal(SYNC.parseBackup(JSON.stringify(b)).ok, false);
});

t("pasting inside a ``` fence or with chatter around it still parses", function () {
  var s = sample(), text = "はい、どうぞ\n```json\n" + SYNC.stringify(SYNC.buildBackup(s, NOW)) + "\n```\n";
  assert.ok(SYNC.parseBackup(text).ok);
});

t("oversized input is rejected (coach and backup)", function () {
  var big = coach({ message: "x" }) + " ".repeat(SYNC.MAX_INPUT);
  assert.equal(SYNC.parseCoach(big).ok, false); assert.match(SYNC.parseCoach(big).error, /大きすぎ/);
  assert.equal(SYNC.parseBackup(big).ok, false);
});

t("sync package: first export has everything, schema fields present", function () {
  var s = sample(), p = SYNC.buildSync(s, { now: NOW, today: T, lookup: function (id) { return { w: id, r: "r", m: "m" }; }, dueAll: 7 });
  assert.equal(p.kind, "n1.sync"); assert.equal(p.schema, 2); assert.equal(p.since, null);
  assert.equal(Object.keys(p.cards).length, 3);
  assert.deepEqual(p.cards["w:a"], { b: 4, due: "2026-11-20", l: 1, s: 6, last: "2026-10-20" });
  assert.equal(p.summary.reviewDue, 7); assert.equal(p.summary.today, T); assert.equal(p.summary.done, 12);
  assert.equal(p.summary.acc, Math.round(9 / 11 * 100)); assert.equal(p.summary.streak, 2);
  assert.equal(p.summary.gapDays.length, 12, "14 days minus the 2 active ones");
  assert.deepEqual(p.leeches.map(function (x) { return x.id; }), ["w:b"]);
  assert.deepEqual(p.leeches[0].mt, { read: 2, audio: 1 });
  assert.deepEqual(p.delayed, [{ d: "2026-10-25", n: 20, ok: 15 }]);
  assert.equal(p.log.length, 2); assert.equal(p.flags.length, 1);
  assert.equal(JSON.parse(SYNC.stringify(p)).kind, "n1.sync");
});

t("sync package is incremental: only cards/days/log changed since the last export", function () {
  var s = sample();
  SYNC.markExported(s, Date.parse("2026-10-31T00:00:00"), "test");
  var p = SYNC.buildSync(s, { now: NOW, today: T });
  assert.deepEqual(Object.keys(p.cards).sort(), ["g:c", "w:b"]);
  assert.deepEqual(Object.keys(p.days).sort(), ["2026-10-31", T]);
  assert.equal(p.log.length, 1); assert.equal(p.log[0].id, "w:b");
  assert.equal(p.since, new Date(Date.parse("2026-10-31T00:00:00")).toISOString());
  /* 同じ区間をもう一度: prevExportAt を since に */
  SYNC.markExported(s, NOW, "again");
  assert.equal(s.sync.prevExportAt, Date.parse("2026-10-31T00:00:00"));
  var again = SYNC.buildSync(s, { now: NOW + 1000, today: T, since: s.sync.prevExportAt });
  assert.deepEqual(Object.keys(again.cards).sort(), ["g:c", "w:b"]);
  assert.equal(SYNC.buildSync(s, { now: NOW + 1000, today: T }).log.length, 0, "nothing new after export");
});

t("incremental falls back to card.last when u is missing (older data)", function () {
  var s = sample(); delete s.cards["w:a"].u; delete s.cards["w:b"].u;
  SYNC.markExported(s, Date.parse("2026-10-31T00:00:00"), "x");
  var p = SYNC.buildSync(s, { now: NOW, today: T });
  assert.ok(p.cards["w:b"]); assert.ok(!p.cards["w:a"]);
});

t("log in the sync package is capped at 200 (newest kept)", function () {
  var s = sample();
  for (var i = 0; i < 400; i++) s.log.push({ t: NOW + i, id: "w:a", q: "audio", ok: "ok", b0: 1, b1: 2 });
  s.log = s.log.slice(-500);
  var p = SYNC.buildSync(s, { now: NOW + 9999, today: T });
  assert.equal(p.log.length, 200); assert.equal(p.log[199].t, NOW + 399);
});

t("coach: parse whitelists fields, clamps settings, ignores unknown fields", function () {
  var r = SYNC.parseCoach(coach({ settings: { newCap: 999, mvdN: "12", rate: 0.9, theme: "dark", evil: 1 },
    priority: ["w:p", "w:p", 5, "w:q"], notes: { "w:a": "**x**", "w:b": 3 }, journal: [{ d: "2026-11-01", t: "hi" }, { d: "bad", t: "x" }, { d: "2026-11-02" }],
    message: "ok", extra: { a: 1 }, __proto__: { x: 1 } }));
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.pkg.settings, { newCap: 50, mvdN: 12, rate: 0.9 });
  assert.deepEqual(r.pkg.priority, ["w:p", "w:q"]);
  assert.deepEqual(r.pkg.notes, { "w:a": "**x**" });
  assert.deepEqual(r.pkg.journal, [{ d: "2026-11-01", t: "hi" }]);
  assert.equal(r.pkg.extra, undefined);
});

t("coach: refuses missing id, wrong kind, wrong schema, bad JSON", function () {
  assert.equal(SYNC.parseCoach(JSON.stringify({ kind: "n1.coach", schema: 2 })).ok, false);
  assert.equal(SYNC.parseCoach(JSON.stringify({ kind: "n1.sync", schema: 2, id: "x" })).ok, false);
  assert.equal(SYNC.parseCoach(JSON.stringify({ kind: "n1.coach", schema: 1, id: "x" })).ok, false);
  assert.equal(SYNC.parseCoach("{bad").ok, false);
  assert.equal(SYNC.parseCoach("").ok, false);
});

t("coach preview describes the change without touching state", function () {
  var s = sample(), before = JSON.stringify(s);
  var r = SYNC.parseCoach(coach({ settings: { newCap: 10 }, priority: ["w:p", "w:b", "w:nope"], notes: { "w:a": "n", "w:nope": "n" },
    journal: [{ d: "2026-11-01", t: "新" }, { d: "2026-10-30", t: "**先** 休息" }], message: "加油" }));
  var pv = SYNC.previewCoach(s, r.pkg, CTX_BASE(s));
  assert.equal(JSON.stringify(s), before);
  assert.equal(pv.already, false);
  assert.deepEqual(pv.counts, { settings: 1, priority: 1, journal: 1, notes: 1, message: 1 });
  assert.match(pv.lines.join("\n"), /newCap 12 → 10/);
});

t("coach apply: settings, priority first, notes, journal, message; input state untouched", function () {
  var s = sample(), before = JSON.stringify(s);
  var r = SYNC.parseCoach(coach({ settings: { newCap: 10 }, priority: ["w:p", "w:b", "w:q"], notes: { "w:a": "**記法**", "w:nope": "x" },
    journal: [{ d: "2026-11-01", t: "新" }], message: "加油" }));
  var a = SYNC.applyCoach(s, r.pkg, CTX_BASE(s), NOW);
  assert.equal(JSON.stringify(s), before, "pure");
  assert.ok(a.applied);
  var n = a.state;
  assert.equal(n.settings.newCap, 10);
  assert.deepEqual(n.priority, ["w:p", "w:q", "w:z"], "w:b is already learning; new ones go first");
  assert.equal(n.notes["w:a"], "**記法**"); assert.equal(n.notes["w:nope"], undefined);
  assert.equal(n.journal.length, 2); assert.equal(n.coachMsg.m, "加油");
  assert.deepEqual(n.sync.applied, ["c-1"]);
  assert.equal(n.sync.log[n.sync.log.length - 1].k, "apply");
  assert.deepEqual(n.cards, s.cards, "cards are never touched by a coach package");
});

t("coach apply is idempotent: the same package twice changes nothing the second time", function () {
  var s = sample(), r = SYNC.parseCoach(coach({ priority: ["w:p"], journal: [{ d: "2026-11-01", t: "新" }], notes: { "w:a": "n" } }));
  var a1 = SYNC.applyCoach(s, r.pkg, CTX_BASE(s), NOW);
  var a2 = SYNC.applyCoach(a1.state, r.pkg, CTX_BASE(a1.state), NOW + 5000);
  assert.equal(a2.applied, false);
  assert.equal(JSON.stringify(a2.state), JSON.stringify(a1.state));
  assert.equal(a2.state.journal.length, 2); assert.equal(a2.state.priority.filter(function (x) { return x === "w:p"; }).length, 1);
  assert.equal(SYNC.previewCoach(a1.state, r.pkg, CTX_BASE(a1.state)).already, true);
  /* 別 id でも同じ留言・同じ優先詞は増えない */
  var r2 = SYNC.parseCoach(coach({ id: "c-2", priority: ["w:p"], journal: [{ d: "2026-11-01", t: "新" }] }));
  var a3 = SYNC.applyCoach(a1.state, r2.pkg, CTX_BASE(a1.state), NOW + 9000);
  assert.equal(a3.state.journal.length, 2); assert.equal(a3.state.priority.filter(function (x) { return x === "w:p"; }).length, 1);
});

t("bad coach text never changes state (parse fails before apply)", function () {
  var s = sample(), before = JSON.stringify(s);
  ["{", "[]", "null", "hello", '{"kind":"n1.coach","schema":2}', "x".repeat(SYNC.MAX_INPUT + 1)].forEach(function (txt) {
    var r = SYNC.parseCoach(txt); assert.equal(r.ok, false); assert.ok(r.error);
  });
  assert.equal(JSON.stringify(s), before);
});

t("note clearing: empty string removes a note", function () {
  var s = sample(), r = SYNC.parseCoach(coach({ notes: { "w:b": "" } }));
  assert.equal(SYNC.applyCoach(s, r.pkg, CTX_BASE(s), NOW).state.notes["w:b"], undefined);
});

t("snapshots keep the newest 3 and read back to the same state", function () {
  var s = sample(), snaps = [];
  for (var i = 0; i < 5; i++) snaps = SYNC.pushSnapshot(snaps, s, "r" + i, NOW + i);
  assert.equal(snaps.length, 3); assert.equal(snaps[0].reason, "r2");
  assert.deepEqual(SYNC.readSnapshot(snaps[2]), s);
  assert.equal(SYNC.readSnapshot({ json: "{broken" }), null);
});

t("sync package size helper counts UTF-8 bytes", function () {
  assert.equal(SYNC.sizeOf("あ"), 3); assert.equal(SYNC.sizeOf("a"), 1);
});

/* ---------- audit.js ---------- */
t("kana typing: katakana / half-width / spaces / middle dot are normalised", function () {
  assert.ok(AUDIT.typedMatches("トウキョウ", ["とうきょう"]));
  assert.ok(AUDIT.typedMatches("ﾄｳｷｮｳ", ["とうきょう"]));
  assert.ok(AUDIT.typedMatches(" と う きょう ", ["とうきょう"]));
  assert.ok(AUDIT.typedMatches("あ・い", ["あい"]));
  assert.ok(!AUDIT.typedMatches("", ["あ"]));
  assert.ok(!AUDIT.typedMatches("かく", ["かど", "つの"]));
});
t("kana typing: ー and う/お long-vowel spellings are equivalent, other things are not", function () {
  assert.ok(AUDIT.typedMatches("とーきょー", ["とうきょう"]));
  assert.ok(AUDIT.typedMatches("とうきょう", ["とーきょー"]));
  assert.ok(AUDIT.typedMatches("ﾄｰｷｮｰ", ["とうきょう"]), "half-width prolonged mark");
  assert.ok(AUDIT.typedMatches("とーい", ["とおい"]));
  assert.ok(AUDIT.typedMatches("けーかく", ["けいかく"]));
  assert.ok(AUDIT.typedMatches("きょ－か", ["きょうか"]), "full-width hyphen-minus");
  assert.ok(!AUDIT.typedMatches("とき", ["とうき"]), "dropping a vowel is still wrong");
  assert.ok(!AUDIT.typedMatches("こうこ", ["こうこう"]));
});
t("multi-reading words: any listed reading passes", function () {
  assert.deepEqual(AUDIT.readings("かど／つの"), ["かど", "つの"]);
  assert.ok(AUDIT.typedMatches("つの", AUDIT.readings("かど／つの")));
  assert.ok(AUDIT.typedMatches("カド", AUDIT.readings("かど／つの")));
});
t("meaning overlap: shared segment means ambiguous, parentheses are ignored", function () {
  assert.ok(AUDIT.sameMeaning("禁止", "禁止"));
  assert.ok(AUDIT.sameMeaning("手段、方法（中性詞）", "手段、辦法"));
  assert.ok(!AUDIT.sameMeaning("轉角、稜角／（動物的）角", "牌子、標籤／鈔票"));
  assert.ok(!AUDIT.sameMeaning("", "x"));
});
t("cleanOpts trims, dedupes and keeps the answer; fails if the answer vanishes", function () {
  var r = AUDIT.cleanOpts(["わけにはいかない", " わけではない", "ようがない", "わけではない"], 0);
  assert.deepEqual(r.opts, ["わけにはいかない", "わけではない", "ようがない"]); assert.equal(r.ans, 0);
  assert.equal(AUDIT.cleanOpts(["a", "b"], 5), null);
});
t("questionIssues flags duplicates, empty options and bad answer index", function () {
  assert.deepEqual(AUDIT.questionIssues({ opts: ["a", "b", "c"], ans: 1 }), []);
  assert.ok(AUDIT.questionIssues({ opts: ["a", "a ", "c"], ans: 0 }).indexOf("duplicate-option") >= 0);
  assert.ok(AUDIT.questionIssues({ opts: ["a", "b"], ans: 2 }).indexOf("answer-out-of-range") >= 0);
  assert.ok(AUDIT.questionIssues({ mode: "type", expect: [] }).length);
  assert.deepEqual(AUDIT.questionIssues({ mode: "type", expect: ["とうきょう"] }), []);
});

console.log("\n" + pass + " tests passed");
