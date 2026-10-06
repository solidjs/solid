import {
  expectations,
  generateMountCases,
  judge,
  unruled,
  validateMountCase,
  type MountCase,
  type MountSnapshot
} from "./mount-cases.js";
import type { RunResult } from "./runner.js";
import type { Scenario } from "./scenario.js";

const base: MountCase = {
  kind: "mount-under-hold",
  version: 1,
  family: "fresh",
  hold: "action",
  trigger: "flip",
  show: "effect",
  content: "memo",
  ownLoad: false,
  keyed: false,
  boundary: true,
  value: 1,
  anchorLast: false
};

const timeline = (...seen: Array<[number, string, boolean?]>): MountSnapshot[] =>
  seen.map(([x, s, running], i) => ({
    at: (["S0", "S1", "S2", "S3", "S4"] as const)[i],
    x,
    seen: s,
    running: !!running
  }));

function judged(c: MountCase, snapshots: MountSnapshot[]) {
  const result = { status: "pass", scenario: c as unknown as Scenario } as RunResult;
  judge(c, snapshots, result);
  return result.failure?.rule;
}

test("a fresh boundary over a hold: fallback now, content at the commit", () => {
  const ok = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "fallback"],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(base, ok)).toBeUndefined();
  // Pre-L2 served the committed value under the new boundary: torn by A29.
  const committed = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "content 0"],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(base, committed)).toBe("MH1");
  // The whole mount held with the tick (L2's in-flush #3540 regression).
  const held = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "closed"],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(base, held)).toBe("MH1");
});

test("the direction rule: a hold does not wait on a first load the boundary owns", () => {
  const c = { ...base, ownLoad: true };
  const ok = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "fallback"],
    [1, "fallback"],
    [1, "content 1"]
  );
  expect(judged(c, ok)).toBeUndefined();
  const waited = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "fallback"],
    [0, "fallback"],
    [1, "content 1"]
  );
  expect(judged(c, waited)).toBe("MH3");
});

test("no tearing: an element without its binding, and content from another world, fail everywhere", () => {
  const sameTick = { ...base, trigger: "same-tick" as const };
  expect(unruled(sameTick)).toBeDefined();
  expect(expectations(sameTick)).toEqual([]);
  const torn = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "torn:element-without-binding"],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(sameTick, torn)).toBe("MH5");
  const ahead = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "content 1"],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(sameTick, ahead)).toBe("MH5");
  // Unruled shapes keep only the invariants: either early display passes.
  expect(
    judged(
      sameTick,
      timeline([0, "closed"], [0, "closed"], [0, "fallback"], [1, "content 1"], [1, "content 1"])
    )
  ).toBeUndefined();
  expect(
    judged(
      sameTick,
      timeline([0, "closed"], [0, "closed"], [0, "closed"], [1, "content 1"], [1, "content 1"])
    )
  ).toBeUndefined();
});

test("no catcher: a derived mount stays hidden with the hold; a direct render-effect read is a stale reader", () => {
  const none = { ...base, family: "none" as const };
  const shown = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "content 0"],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(none, shown)).toBe("MH4");
  expect(judged({ ...none, content: "direct" }, shown)).toBeUndefined();
});

test("a lane's mount: the element and its binding land now, in the lane's world", () => {
  const lane: MountCase = {
    ...base,
    family: "lane",
    trigger: "hold",
    content: "bound",
    lane: { wrap: true, reads: "held" }
  };
  const ok = timeline(
    [0, "closed"],
    [0, "content 0", true],
    [0, "content 0", true],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(lane, ok)).toBeUndefined();
  // #3835 before its fix: inside a memo the binding was born held.
  const bornHeld = timeline(
    [0, "closed"],
    [0, "torn:element-without-binding", true],
    [0, "torn:element-without-binding", true],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(lane, bornHeld)).toBe("MH6");
  // ...and directly under the lane pass it showed the held value early.
  const early = timeline(
    [0, "closed"],
    [0, "content 1", true],
    [0, "content 1", true],
    [1, "content 1"],
    [1, "content 1"]
  );
  expect(judged(lane, early)).toBe("MH6");
  // The same tear outside the lane's checkpoints is still MH5.
  expect(
    judged(
      lane,
      timeline(
        [0, "content 1"],
        ...early.slice(1).map(s => [s.x!, s.seen, s.running] as [number, string, boolean])
      )
    )
  ).toBe("MH5");
  // Reading the guess is the lane's own world.
  const guess = { ...lane, lane: { wrap: false, reads: "guess" as const } };
  expect(judged(guess, early)).toBeUndefined();
});

test("generated cases are valid and deterministic per seed", () => {
  const a = generateMountCases(91501, 300);
  expect(a).toEqual(generateMountCases(91501, 300));
  for (const c of a) expect(validateMountCase(c), JSON.stringify(c)).toBeUndefined();
  const families = new Set(a.map(c => c.family));
  expect(families.size).toBe(10);
});
