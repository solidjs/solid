import type { Ruling } from "./types.js";

const s = (i: number) => ({ k: "s" as const, i });
const m = (i: number) => ({ k: "m" as const, i });

/** `x` is `n + 1`, `y` is `x + 1`. Two scopes: `[isPending(x), x()]` and
 * `[isPending(() => latest(x)), latest(x)]` (A8). */
export default {
  id: "S-27",
  title: "`[isPending(x), x()]` is atomic; the `latest` form follows x's own async only",
  rules: ["D-23", "D-25"],
  status: "standing",
  issues: ["A10", "A8"],
  pins: ["tests/latest-isPending-consistency.test.ts", "tests/createMemo.test.ts"],
  names: { s0: "n", m0: "x", m1: "y" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          { async: true, deps: [{ src: m(0), how: "plain" }], poison: null }
        ],
        tree: {
          t: "group",
          kids: [
            {
              t: "leaf",
              text: [],
              attrs: [
                { how: "pending", src: m(0) },
                { how: "plain", src: m(0) }
              ],
              grouped: true
            },
            {
              t: "leaf",
              text: [],
              attrs: [
                { how: "pendingLatest", src: m(0) },
                { how: "latest", src: m(0) }
              ],
              grouped: true
            },
            { t: "leaf", text: [{ how: "plain", src: m(1) }], attrs: [], grouped: false }
          ]
        },
        steps: [
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "write", s: 0, v: 1 },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        {
          after: 3,
          screen:
            "<span data-a0=pm0:false  data-a1=vm0:1 ></span><span data-a0=qm0:false  data-a1=lm0:1 ></span><span>vm1:2 </span>",
          note: "primed"
        },
        {
          after: 5,
          screen:
            "<span data-a0=pm0:true  data-a1=vm0:1 ></span><span data-a0=qm0:true  data-a1=lm0:1 ></span><span>vm1:2 </span>",
          note: "both channels: x's own fetch is up"
        },
        {
          after: 7,
          screen:
            "<span data-a0=pm0:true  data-a1=vm0:1 ></span><span data-a0=qm0:false  data-a1=lm0:2 ></span><span>vm1:2 </span>",
          note: "`x` landed, `y` still up: the plain channel is a landed answer awaiting reveal; `latest` saw x's own answer — verdicts are per channel"
        },
        {
          after: 9,
          screen:
            "<span data-a0=pm0:false  data-a1=vm0:2 ></span><span data-a0=qm0:false  data-a1=lm0:2 ></span><span>vm1:3 </span>"
        }
      ],
      forbid: [
        {
          after: 7,
          screen:
            "<span data-a0=pm0:true  data-a1=vm0:2 ></span><span data-a0=qm0:false  data-a1=lm0:2 ></span><span>vm1:2 </span>",
          why: "`[true, x1]`: pending beside the fresh value"
        }
      ]
    },
    {
      label: "memo",
      scenario: {
        signals: [0],
        memos: [
          {
            async: false,
            deps: [
              { src: s(0), how: "plain" },
              { src: s(0), how: "pending" }
            ],
            poison: null
          }
        ],
        tree: { t: "leaf", text: [{ how: "plain", src: m(0) }], attrs: [], grouped: false },
        steps: [
          { t: "action", s: 0, v: 5 },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        { after: "render", screen: "<span>vm0:1 </span>" },
        {
          after: 1,
          screen: "<span>vm0:2 </span>",
          note: "`m = 1 + x + isPending(x)`: the memo probes x and reads it plainly in one pass — the plain read is the screen's 0 and the probe is true, shown now (A10, D-25); the memo is not the hold's work"
        },
        { after: 3, screen: "<span>vm0:6 </span>" }
      ],
      forbid: [
        {
          after: 1,
          screen: "<span>vm0:1 </span>",
          why: "the memo held with the write it probed: the spinner would show only at the commit"
        }
      ]
    }
  ],
  prose:
    "On a plain signal or sync memo the `latest` form is never pending. The memo case is the pass-level half of D-25: a plain read of a node the pass also probed is the screen's."
} satisfies Ruling;
