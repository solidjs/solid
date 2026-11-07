import type { Ruling } from "./types.js";
import { s, m, plain, pend, scope, leaf, asyncMemo, settle, flush, task } from "./_h.js";

/** `x` is async over `s`. Case 1 and ′: one render effect reads
 * `isPending(x)` and `x()` together (attributes of one span). Case ″: a sync
 * memo reads the same pair (`1 + isPending + x`) and a leaf shows it. */
const bothMemo = {
  async: false,
  deps: [
    { src: m(0), how: "pending" as const },
    { src: m(0), how: "plain" as const }
  ],
  poison: null
};

export default {
  id: "S-52",
  title:
    "`[isPending(x), x()]` in one pass shows pending beside the committed value — the display's declared inconsistency, in a render effect or a memo alike",
  rules: ["D-25", "D-23", "F-6"],
  status: "standing",
  issues: ["#4349", "#3905"],
  pins: [
    "tests/action-refresh-ispending-loop-4349.test.ts",
    "tests/latest-isPending-consistency.test.ts"
  ],
  names: { s0: "s", m0: "x", m1: "both" },
  cases: [
    {
      scenario: {
        signals: [41],
        memos: [asyncMemo(s(0))],
        tree: scope(pend(m(0)), plain(m(0))),
        steps: [
          settle(),
          task, // 0,1 primed
          { t: "action", before: [{ s: 0, v: 1 }], sync: true },
          flush, // 2,3 the action writes s = 1 and ends inside the call (#4349)
          settle(),
          task // 4,5 x's fetch lands
        ]
      },
      frames: [
        { after: 1, screen: "<span data-a0=pm0:false  data-a1=vm0:42 ></span>", note: "primed" },
        {
          after: 3,
          screen: "<span data-a0=pm0:true  data-a1=vm0:42 ></span>",
          note: "the display keeps `42` beside the verdict about its successor, whatever the action's shape (ruled 2026-11-07; the #4349 pin held this shape as one)"
        },
        { after: 5, screen: "<span data-a0=pm0:false  data-a1=vm0:2 ></span>", note: "the frame" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span data-a0=pm0:false  data-a1=vm0:42 ></span>",
          why: "the pair held as one: the spinner only at the commit"
        }
      ]
    },
    {
      label: "′",
      scenario: {
        signals: [41],
        memos: [asyncMemo(s(0))],
        tree: scope(pend(m(0)), plain(m(0))),
        steps: [
          settle(),
          task, // 0,1 primed
          { t: "action", before: [{ s: 0, v: 1 }] },
          flush, // 2,3 the same write; the action stays open
          settle(),
          task, // 4,5 the action ends
          settle(),
          task // 6,7 x's fetch lands
        ]
      },
      frames: [
        { after: 1, screen: "<span data-a0=pm0:false  data-a1=vm0:42 ></span>", note: "primed" },
        {
          after: 3,
          screen: "<span data-a0=pm0:true  data-a1=vm0:42 ></span>",
          note: "the same with the action open: today's screen already"
        },
        { after: 5, screen: "—" },
        { after: 7, screen: "<span data-a0=pm0:false  data-a1=vm0:2 ></span>" }
      ]
    },
    {
      label: "″",
      scenario: {
        signals: [41],
        memos: [asyncMemo(s(0)), bothMemo],
        tree: leaf(plain(m(1))),
        steps: [
          settle(),
          task, // 0,1 primed
          { t: "action", before: [{ s: 0, v: 1 }], sync: true },
          flush, // 2,3 the same write, read by a memo
          settle(),
          task // 4,5 x's fetch lands
        ]
      },
      frames: [
        { after: 1, screen: "<span>vm1:43 </span>", note: "primed: `1 + 0 + 42`" },
        {
          after: 3,
          screen: "<span>vm1:44 </span>",
          note: "`1 + 1 + 42`: the memo is display — it feeds a binding and asks nothing — so hoisting the pair into it changes no screen (S-27's memo row, 11-05)"
        },
        { after: 5, screen: "<span>vm1:3 </span>" }
      ]
    }
  ],
  prose:
    "Ruled 2026-11-07. The display — render effects, compiled bindings, user effects, and the sync derivations that feed them — may hold the value it showed beside the verdict about its successor, because it is declared (`isPending`, `latest`), terminal, and keeps rather than computes. That is the one inconsistency the screen is allowed, and the only consumer barred from it is one that asks (S-51). The #4349 pin's held shape was the odd one out: the action's body ending inside the call is not a reason for the display to wait."
} satisfies Ruling;
