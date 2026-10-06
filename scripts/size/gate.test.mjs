// node --test gate.test.mjs — the gate's decision, without bundling anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, decideAll, MINIFIED_ALLOWANCE } from "./gate.mjs";

const head = (size, minified, extra = {}) => ({ name: "s", size, minified, limit: 1000, ...extra });
const base = minified => ({ name: "s", size: 990, minified });

test("under the cap passes whatever minified did", () => {
  assert.equal(decide(head(1000, 5000), base(4000)).verdict, "pass");
  assert.equal(decide(head(990, 5000)).verdict, "pass");
});

test("over the cap with minified growth within the allowance warns", () => {
  const v = decide(head(1050, 4000 + MINIFIED_ALLOWANCE), base(4000));
  assert.equal(v.verdict, "warn");
  assert.equal(v.overBy, 50);
  assert.equal(v.minDelta, MINIFIED_ALLOWANCE);
  assert.equal(
    v.message,
    `over brotli cap by 50 B, minified +${MINIFIED_ALLOWANCE} B — layout noise; cap will be re-based at the next ratchet`
  );
});

test("over the cap after shrinking minified warns", () => {
  const v = decide(head(1003, 3946), base(4000));
  assert.equal(v.verdict, "warn");
  assert.match(v.message, /minified −54 B/);
});

test("over the cap with minified growth past the allowance fails", () => {
  const v = decide(head(1001, 4000 + MINIFIED_ALLOWANCE + 1), base(4000));
  assert.equal(v.verdict, "fail");
  assert.equal(v.minDelta, MINIFIED_ALLOWANCE + 1);
});

test("a scenario's minifiedAllowance overrides the default", () => {
  assert.equal(decide(head(1001, 4030, { minifiedAllowance: 40 }), base(4000)).verdict, "warn");
  assert.equal(decide(head(1001, 4010, { minifiedAllowance: 0 }), base(4000)).verdict, "fail");
});

test("without a usable base the cap is absolute", () => {
  assert.equal(decide(head(1001, 4000)).verdict, "fail");
  assert.equal(decide(head(1001, 4000), { name: "s", error: "boom" }).verdict, "fail");
  assert.equal(decide(head(1000, 4000)).verdict, "pass");
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
