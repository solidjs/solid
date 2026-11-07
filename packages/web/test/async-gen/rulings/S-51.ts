import type { Ruling } from "./types.js";
import { s, m, plain, pend, leaf, write, settle, flush, task } from "./_h.js";

/** `details` is async over `id`; `badge` is async over `id` and
 * `isPending(id)` (its flight's input is `id + isPending + 1`). `badge` is
 * an act — it asks — so a change to `id` gives it one question, keyed on
 * the truth; the `isPending(id)` hole beside it shows now. */
export default {
  id: "S-51",
  title:
    "A question is asked only of the truth: an async derivation of a held value is the hold's, never a display-ahead pass",
  rules: ["F-2", "F-6", "D-25"],
  status: "standing",
  issues: ["#4677"],
  pins: ["tests/ispending-async-derivation-4677.test.ts"],
  names: { s0: "id", m0: "details", m1: "badge" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          {
            async: true,
            deps: [
              { src: s(0), how: "plain" },
              { src: s(0), how: "pending" }
            ],
            poison: null
          }
        ],
        tree: leaf(plain(s(0)), plain(m(0)), pend(s(0)), plain(m(1))),
        steps: [
          settle(),
          settle(),
          task, // 0,1,2 primed
          write(0, 2),
          flush, // 3,4 setId(2): details(2) and badge(2) asked, both the hold's
          settle(),
          task, // 5,6 the first lands
          settle(),
          task, // 7,8 the second lands: the frame
          settle(),
          task // 9,10 nothing left to land
        ]
      },
      frames: [
        { after: 2, screen: "<span>vs0:0 vm0:1 ps0:false vm1:1 </span>", note: "primed" },
        {
          after: 4,
          screen: "<span>vs0:0 vm0:1 ps0:true vm1:1 </span>",
          note: "`setId(2)`: `badge` asks, so it is the hold's and asks once, of the truth — `badge(2, false)`; nothing seats the `isPending(id)` hole in a lane, so it shows `true` now beside the kept badge (ruled 2026-11-07)"
        },
        { after: 6, screen: "—", note: "one answer landed; the frame holds on the other" },
        { after: 8, screen: "<span>vs0:2 vm0:3 ps0:false vm1:3 </span>", note: "the frame" },
        { after: 10, screen: "—", note: "no third flight was ever asked" }
      ],
      forbid: [
        {
          after: 8,
          screen: "<span>vs0:0 vm0:1 ps0:true vm1:2 </span>",
          why: "`badge(0, true)`: a question asked with the value the screen keeps, and its answer shown"
        }
      ],
      note: "Built 2026-11-07 (`askerJoins`): the badge, an asker, reads the staging and is the frame's; the `truth-asks` oracle finds nothing here now."
    }
  ],
  prose:
    "The #4677 issue's other order (the stale answer landing first) disappears with the stale question. L2's rule 6 (2026-10-04), which seated a verdict reader's whole pass in a lane, is narrowed by this ruling to passes that do not ask: F-6's limit."
} satisfies Ruling;
