import type { Ruling } from "./types.js";

const s = (i: number) => ({ k: "s" as const, i });
const m = (i: number) => ({ k: "m" as const, i });
const leaf = (how: "plain" | "latest" | "pending", src: { k: "s" | "m"; i: number }) => ({
  t: "leaf" as const,
  text: [{ how, src }],
  attrs: [],
  grouped: false
});

/** Every channel sees a write at the flush that carries it, none before.
 * `doubled` is `count + 1` here (a memo is one plus its inputs). */
export default {
  id: "S-25",
  title: "Nothing shows a write before its flush; then every channel at once",
  rules: ["D-22"],
  status: "standing",
  issues: ["A28"],
  pins: ["tests/latest-held-till-flush.test.ts", "tests/latest-repeated-writes.test.ts"],
  names: { s0: "count", m0: "doubled", m1: "slow" },
  cases: [
    {
      scenario: {
        signals: [20],
        memos: [{ async: false, deps: [{ src: s(0), how: "plain" }], poison: null }],
        tree: {
          t: "group",
          kids: [
            leaf("plain", s(0)),
            leaf("latest", s(0)),
            leaf("latest", m(0)),
            leaf("pending", s(0))
          ]
        },
        steps: [{ t: "write", s: 0, v: 30 }, { t: "flush" }]
      },
      frames: [
        {
          after: "render",
          screen:
            "<span>vs0:20 </span><span>ls0:20 </span><span>lm0:21 </span><span>ps0:false </span>"
        },
        { after: 0, screen: "—", note: "`setCount(30)` with no flush: nothing shows it" },
        {
          after: 1,
          screen:
            "<span>vs0:30 </span><span>ls0:30 </span><span>lm0:31 </span><span>ps0:false </span>",
          note: "nothing holds: every channel at once"
        }
      ],
      forbid: [
        {
          after: 0,
          screen:
            "<span>vs0:20 </span><span>ls0:30 </span><span>lm0:21 </span><span>ps0:false </span>",
          why: "`latest(count)` 30 while `latest(doubled)` is still 21"
        }
      ]
    },
    {
      label: "′",
      scenario: {
        signals: [20],
        memos: [
          { async: false, deps: [{ src: s(0), how: "plain" }], poison: null },
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null }
        ],
        tree: {
          t: "group",
          kids: [
            leaf("plain", s(0)),
            leaf("latest", s(0)),
            leaf("latest", m(0)),
            leaf("pending", s(0)),
            leaf("plain", m(1))
          ]
        },
        steps: [
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "write", s: 0, v: 30 },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        {
          after: 1,
          screen:
            "<span>vs0:20 </span><span>ls0:20 </span><span>lm0:21 </span><span>ps0:false </span><span>vm1:21 </span>",
          note: "primed"
        },
        {
          after: 3,
          screen:
            "<span>vs0:20 </span><span>ls0:30 </span><span>lm0:31 </span><span>ps0:true </span><span>vm1:21 </span>",
          note: "an asyncMemo reader holds `count`: the plain read keeps 20, `latest` shows 30, `isPending` true"
        },
        {
          after: 5,
          screen:
            "<span>vs0:30 </span><span>ls0:30 </span><span>lm0:31 </span><span>ps0:false </span><span>vm1:31 </span>"
        }
      ]
    }
  ]
} satisfies Ruling;
