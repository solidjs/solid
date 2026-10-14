// node --test gate.test.mjs — the gate's decision, without bundling anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, decideAll, MINIFIED_ALLOWANCE } from "./gate.mjs";

// A scenario capped at 1000 B brotli, with 4000 B minified recorded with the cap.
const head = (size, minified, extra = {}) => ({
  name: "s",
  size,
  minified,
  limit: 1000,
  capMinified: 4000,
  ...extra
});
const unrecorded = (size, minified, extra = {}) => {
  const h = head(size, minified, extra);
  delete h.capMinified;
  return h;
};
const base = minified => ({ name: "s", size: 990, minified });

test("under the cap passes whatever minified did", () => {
  assert.equal(decide(head(1000, 5000), base(4000)).verdict, "pass");
  assert.equal(decide(unrecorded(990, 5000)).verdict, "pass");
});

test("over the cap within the allowance of the recorded minified warns with the headroom left", () => {
  const v = decide(head(1050, 4012), base(4000));
  assert.equal(v.verdict, "warn");
  assert.equal(v.against, "recorded");
  assert.equal(v.overBy, 50);
  assert.equal(v.minDelta, 12);
  assert.equal(v.headroom, MINIFIED_ALLOWANCE - 12);
  assert.equal(
    v.message,
    `over brotli cap by 50 B; minified 4,012 B vs 4,000 B recorded with the cap (+12 B) — ${MINIFIED_ALLOWANCE - 12} B of the ${MINIFIED_ALLOWANCE} B minified allowance left; +12 B minified over this PR's base`
  );
  assert.doesNotMatch(v.message, /re-base/);
});

test("exactly at the allowance warns; one byte past fails", () => {
  assert.equal(decide(head(1001, 4000 + MINIFIED_ALLOWANCE)).verdict, "warn");
  const v = decide(head(1001, 4000 + MINIFIED_ALLOWANCE + 1), base(4000));
  assert.equal(v.verdict, "fail");
  assert.equal(v.headroom, -1);
  assert.match(v.message, /1 B past the 20 B minified allowance/);
});

test("creep: two successive +15 B PRs on an over-cap scenario — the second fails", () => {
  // PR 1 on a base at the recorded size: +15 B, over the cap on layout noise.
  const pr1 = decide(head(1030, 4015), base(4000));
  assert.equal(pr1.verdict, "warn");
  assert.equal(pr1.headroom, 5);
  // PR 1 merged; PR 2 adds another +15 B on top of it. Against its own base
  // that is +15 B again, but against the recorded minified it is +30 B.
  const pr2 = decide(head(1030, 4030), base(4015));
  assert.equal(pr2.verdict, "fail");
  assert.equal(pr2.baseDelta, 15);
  assert.equal(pr2.minDelta, 30);
  assert.match(pr2.message, /\+15 B minified over this PR's base/);
  // The per-PR comparison alone (no recorded minified) would have let it through.
  assert.equal(decide(unrecorded(1030, 4030), base(4015)).verdict, "warn");
});

test("under the cap again after creep passes; the recorded minified does not move", () => {
  assert.equal(decide(head(995, 4030), base(4015)).verdict, "pass");
});

test("shrinking minified over the cap warns with more headroom", () => {
  const v = decide(head(1003, 3946), base(4000));
  assert.equal(v.verdict, "warn");
  assert.equal(v.headroom, MINIFIED_ALLOWANCE + 54);
  assert.match(v.message, /\(−54 B\)/);
});

test("a scenario's minifiedAllowance overrides the default", () => {
  assert.equal(decide(head(1001, 4030, { minifiedAllowance: 40 })).verdict, "warn");
  assert.equal(decide(head(1001, 4010, { minifiedAllowance: 0 })).verdict, "fail");
});

test("fail-safe: no recorded minified falls back to the base and says so", () => {
  const warn = decide(unrecorded(1050, 4020), base(4000));
  assert.equal(warn.verdict, "warn");
  assert.equal(warn.against, "base");
  assert.match(warn.message, /no minified recorded with the cap, so judged against this PR's base/);
  const fail = decide(unrecorded(1050, 4021), base(4000));
  assert.equal(fail.verdict, "fail");
  assert.equal(fail.against, "base");
});

test("no recorded minified and no usable base: the cap is absolute", () => {
  assert.equal(decide(unrecorded(1001, 4000)).verdict, "fail");
  assert.equal(decide(unrecorded(1001, 4000), { name: "s", error: "boom" }).verdict, "fail");
  assert.equal(decide(unrecorded(1000, 4000)).verdict, "pass");
});

test("a recorded minified does not need a base", () => {
  assert.equal(decide(head(1001, 4010)).verdict, "warn");
  assert.equal(decide(head(1001, 4021)).verdict, "fail");
});

test("a scenario that failed to bundle fails", () => {
  assert.equal(decide({ name: "s", limit: 1000, error: "boom" }, base(4000)).verdict, "fail");
});

test("decideAll matches base by name and tolerates a missing base", () => {
  const verdicts = decideAll(
    [
      { name: "a", size: 1050, minified: 4010, limit: 1000 },
      { name: "b", size: 1050, minified: 4010, limit: 1000 }
    ],
    [{ name: "a", size: 1000, minified: 4000 }]
  );
  assert.deepEqual(
    verdicts.map(v => v.verdict),
    ["warn", "fail"]
  );
  assert.equal(decideAll([{ name: "a", size: 900, minified: 1, limit: 1000 }]).length, 1);
});
