import type { Ruling } from "./types.js";
import { s, m, plain, pend, leaf, group, asyncMemo, syncMemo, settle, task } from "./_h.js";

/** `a` and `b` are optimistic signals; `left` and `right` are async over
 * them; `total` sums them. One action guesses both, so both re-fetch under
 * the hold. `left`'s answer lands first — a different value than shown —
 * while `right` still holds the frame. */
export default {
  id: "S-54",
  title: "`isPending` of a ready answer the frame still holds: cleared, or pending until it shows",
  rules: ["D-23"],
  status: "standing",
  pins: [],
  names: { s0: "a", s1: "b", m0: "left", m1: "right", m2: "total" },
  cases: [
    {
      scenario: {
        signals: [0, 0],
        optimistic: [0, 1],
        memos: [
          asyncMemo(s(0)),
          asyncMemo(s(1)),
          syncMemo({ src: m(0), how: "plain" }, { src: m(1), how: "plain" })
        ],
        tree: group(leaf(plain(m(0)), plain(m(2))), leaf(pend(m(0)))),
        steps: [
          settle(),
          settle(),
          task, // 0,1,2 primed
          {
            t: "action",
            before: [
              { s: 0, v: 1 },
              { s: 1, v: 1 }
            ]
          },
          task, // 3,4 both guessed; left(1) and right(1) in flight
          settle(1),
          task, // 5,6 left's answer lands beneath the hold
          settle(1),
          task, // 7,8 right's answer lands
          settle(),
          task // 9,10 the action ends: the guesses revert
        ]
      },
      frames: [
        { after: 2, screen: "<span>vm0:1 vm2:3 </span><span>pm0:false </span>", note: "primed" },
        {
          after: 4,
          screen: "<span>vm0:1 vm2:3 </span><span>pm0:true </span>",
          note: "both guessed: `left(1)` and `right(1)` are out under the action's hold"
        },
        {
          after: 6,
          screen: "—",
          note: "`left`'s answer (2, not the shown 1) lands beneath the hold: not showable while the frame holds on `right`, so still a question without a committed answer — `pending` stays (ruled and built 2026-11-07)"
        },
        {
          after: 8,
          screen: "<span>vm0:2 vm2:5 </span><span>pm0:false </span>",
          note: "`right` lands: the frame shows"
        },
        {
          after: 10,
          screen: "<span>vm0:2 vm2:5 </span><span>pm0:true </span>",
          note: "the action ends: the guesses revert and both re-fetch"
        }
      ],
      forbid: [
        {
          after: 6,
          screen: "<span>vm0:1 vm2:3 </span><span>pm0:false </span>",
          why: "`pending` clearing for an answer the frame cannot show yet"
        }
      ]
    }
  ]
} satisfies Ruling;
