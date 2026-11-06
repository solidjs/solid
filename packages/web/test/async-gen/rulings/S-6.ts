import type { Ruling } from "./types.js";
import { s, m, plain, leaf, group, show, asyncMemo, write, settle, flush, task } from "./_h.js";

/** `slow` is `count + 1` (async). While the write to `count` is held on it,
 * a branch mounts (`open` flips) that creates `fast` (`count + 1`, async)
 * and renders it. */
const scenario = {
  signals: [1, 0],
  memos: [asyncMemo(s(0)), asyncMemo(s(0))],
  tree: group(leaf(plain(s(0)), plain(m(0))), show(plain(s(1)), leaf(plain(m(1))), { owns: [1] })),
  steps: [] as ReturnType<typeof write>[]
};
export default {
  id: "S-6",
  title: "A new async memo a render effect consumes waits with the hold",
  rules: ["D-1", "F-2"],
  status: "standing",
  issues: ["#3800"],
  pins: ["tests/issue-3800-repro.test.ts"],
  names: { s0: "count", s1: "open", m0: "slow", m1: "fast" },
  cases: [
    {
      scenario: {
        ...scenario,
        steps: [
          settle(),
          task,
          write(0, 2),
          flush,
          write(1, 1),
          flush,
          settle(1),
          task,
          settle(0),
          task
        ]
      },
      frames: [
        { after: 1, screen: "<span>vs0:1 vm0:2 </span>", note: "primed" },
        {
          after: 5,
          screen: "—",
          note: "`setCount(2)` held on `slow`; the child branch mounts: `fast` is born held and throws, so it holds its mount and is not attached"
        },
        {
          after: 7,
          screen: "—",
          note: "`fast`'s answer lands while the hold is live: `slow` is still out, so the hold waits and the answer does not show"
        },
        {
          after: 9,
          screen: "<span>vs0:2 vm0:3 </span><span>vm1:3 </span>",
          note: "`slow(2)` lands: parent and child together"
        }
      ],
      forbid: [
        {
          after: 7,
          screen: "<span>vs0:1 vm0:2 </span><span>vm1:3 </span>",
          why: "the child beside the parent still on the old value"
        },
        {
          after: 5,
          screen: "<span>vs0:1 vm0:2 </span><span></span>",
          why: "`child (empty)` on screen"
        }
      ]
    },
    {
      label: "′",
      scenario: {
        ...scenario,
        steps: [
          settle(),
          task,
          write(0, 2),
          flush,
          write(1, 1),
          flush,
          settle(0),
          task,
          settle(0),
          task
        ]
      },
      frames: [
        { after: 1, screen: "<span>vs0:1 vm0:2 </span>" },
        {
          after: 7,
          screen: "—",
          note: "`slow(2)` lands first: `fast` is still out, so the parent does not show yet (the hold waits for the child a render effect consumes, F-2)"
        },
        { after: 9, screen: "<span>vs0:2 vm0:3 </span><span>vm1:3 </span>" }
      ],
      forbid: [
        {
          after: 7,
          screen: "<span>vs0:2 vm0:3 </span><span></span>",
          why: "the parent revealed around an empty child slot"
        }
      ]
    }
  ],
  prose: "The sync twin (S-3's `ten`) already waits; the asymmetry was the bug."
} satisfies Ruling;
