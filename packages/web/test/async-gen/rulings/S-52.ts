import type { Ruling } from "./types.js";
import { s, m, plain, pend, scope, asyncMemo, settle, flush, task } from "./_h.js";

/** `x` is async over `s`; one effect reads `isPending(x)` and `x()` together (attributes of one span).
 * An action writes `s` and ends at once; `x`'s fetch lands later. */
export default {
  id: "S-52",
  title:
    "`[isPending(x), x()]` after an action's write: held as one, or pending beside the committed value",
  rules: ["D-23", "D-25"],
  status: "proposed",
  proposedBy: "experiment/unified-updates (GabbeV), stage 127",
  issues: ["#4349"],
  pins: ["tests/action-refresh-ispending-loop-4349.test.ts"],
  names: { s0: "s", m0: "x" },
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
          screen: "—",
          note: "the action's write lands beneath `x`'s new question: the pair holds like `x()` alone (D-23)"
        },
        { after: 5, screen: "<span data-a0=pm0:false  data-a1=vm0:2 ></span>", note: "one frame" }
      ],
      proposed: [
        {
          after: 3,
          screen: "<span data-a0=pm0:true  data-a1=vm0:42 ></span>",
          note: "the experiment publishes `pending` beside the committed value, without restarting the request"
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
          note: "the action open: `pending` beside the committed value — what the proposal asks of case 1"
        },
        { after: 5, screen: "—", note: "the action ends; `x`'s fetch is still out" },
        { after: 7, screen: "<span data-a0=pm0:false  data-a1=vm0:2 ></span>" }
      ],
      note: "Case ′ is the same write from an action that yields. Today's model then shows `pending` beside the committed value on its own, as the mainline does for a plain write (S-26, frame 2): the hold of case 1 is specific to an action whose body ends inside the call. The proposal makes the two the same."
    }
  ]
} satisfies Ruling;
