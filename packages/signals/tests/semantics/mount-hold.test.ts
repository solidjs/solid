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

const fallbackNow = timeline(
  [0, "closed"],
  [0, "closed"],
  [0, "fallback"],
  [1, "content 1"],
  [1, "content 1"]
);
const heldClosed = timeline(
  [0, "closed"],
  [0, "closed"],
  [0, "closed"],
  [1, "content 1"],
  [1, "content 1"]
);
// Pre-L2 served the committed value under the new boundary: torn by A29.
const committed = timeline(
  [0, "closed"],
  [0, "closed"],
  [0, "content 0"],
  [1, "content 1"],
  [1, "content 1"]
);

test("a fresh boundary over held data: fallback now, content at the commit, outside reader or not (A29)", () => {
  for (const c of [base, { ...base, anchor: false }, { ...base, trigger: "root" as const }]) {
    expect(judged(c, fallbackNow)).toBeUndefined();
    expect(judged(c, committed)).toBe("MH1");
    expect(judged(c, heldClosed)).toBe("MH1");
  }
});

test("an `on` re-arm by a flip that never writes the held source: fallback now, anchor or not (#3575)", () => {
  const rearm = { ...base, family: "rearm-committed" as const, show: "memo" as const };
  const kept = timeline(
    [0, "content 0"],
    [0, "content 0"],
    [0, "content 0"],
    [1, "content 1"],
    [1, "content 1"]
  );
  const fellBack = timeline(
    [0, "content 0"],
    [0, "content 0"],
    [0, "fallback"],
    [1, "content 1"],
    [1, "content 1"]
  );
  for (const c of [rearm, { ...rearm, anchor: false }]) {
    expect(judged(c, fellBack)).toBeUndefined();
    expect(judged(c, kept)).toBe("MH1");
  }
});

test("a re-armed tree whose Show mounts a direct render-effect read: a stale reader, the re-arm is a no-op", () => {
  const rearm = { ...base, family: "rearm-mount" as const, content: "direct" as const };
  const shown = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "content 0"],
    [1, "content 1"],
    [1, "content 1"]
  );
  const fellBack = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "fallback"],
    [1, "content 1"],
    [1, "content 1"]
  );
  for (const c of [rearm, { ...rearm, anchor: false }]) {
    expect(judged(c, shown)).toBeUndefined();
    expect(judged(c, fellBack)).toBe("MH8");
  }
  expect(judged({ ...rearm, show: "memo" }, shown)).toBe("MH1");
  expect(judged({ ...rearm, show: "memo" }, fellBack)).toBeUndefined();
  // A flight nothing outside reads: the content is pending under the boundary.
  const caught = { ...rearm, hold: "flight" as const, anchor: false };
  expect(judged(caught, fellBack)).toBeUndefined();
  expect(judged(caught, shown)).toBe("MH1");
});

test("an uncommitted outside read: its own catcher shows the fallback, not the inner boundary", () => {
  const c: MountCase = { ...base, anchor: false, content: "nested", outerRead: true };
  const outer = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "outer fallback"],
    [1, "[content 1]"],
    [1, "[content 1]"]
  );
  expect(judged(c, outer)).toBeUndefined();
  const inner = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "[fallback]"],
    [1, "[content 1]"],
    [1, "[content 1]"]
  );
  expect(judged(c, inner)).toBe("MH1");
  expect(judged({ ...c, outerRead: false }, inner)).toBeUndefined();
});

test("the direction rule: a first load keeps the fallback past the release, and the hold does not wait", () => {
  const c = { ...base, ownLoad: true };
  const ok = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "fallback"],
    [1, "fallback"],
    [1, "content 1"]
  );
  expect(judged(c, ok)).toBeUndefined();
  const closedFirst = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "closed"],
    [1, "fallback"],
    [1, "content 1"]
  );
  expect(judged(c, closedFirst)).toBe("MH1");
  const waited = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "fallback"],
    [0, "fallback"],
    [1, "content 1"]
  );
  expect(judged(c, waited)).toBe("MH3");
});

test("a latest() condition mounts mainline (rev 22): a fresh boundary there shows its fallback now", () => {
  const verdict = { ...base, family: "verdict" as const, trigger: "hold" as const };
  expect(unruled(verdict)).toBeUndefined();
  // The hold mounts: S1 is already the mount's checkpoint.
  const closed = timeline(
    [0, "closed"],
    [0, "closed"],
    [0, "closed"],
    [1, "content 1"],
    [1, "content 1"]
  );
  const fallback = timeline(
    [0, "closed"],
    [0, "fallback"],
    [0, "fallback"],
    [1, "content 1"],
    [1, "content 1"]
  );
  const ahead = timeline(
    [0, "closed"],
    [0, "content 1"],
    [0, "content 1"],
    [1, "content 1"],
    [1, "content 1"]
  );
  for (const c of [verdict, { ...verdict, anchor: false }]) {
    expect(judged(c, fallback)).toBeUndefined();
    expect(judged(c, closed)).toBe("MH1");
    expect(judged(c, ahead)).toBe("MH1");
  }
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
  expect(a.some(c => c.anchor === false)).toBe(true);
  expect(a.some(c => c.outerRead)).toBe(true);
});
