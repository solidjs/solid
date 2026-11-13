import type { Ruling } from "./types.js";
import { s, m, plain, pend, leaf, write, settle, flush, task } from "./_h.js";

/** `details` is async over `id`; `badge` is async over `id` and
 * `isPending(id)` (its flight's input is `id + isPending + 1`). `badge`
 * reads ahead, so it is a display-ahead reader as a sync memo would be: a
 * change to `id` has it ask the screen's question — `badge(0, true)`, shown
 * with the `isPending(id)` hole beside it — and the landing asks the landed
 * world's, `badge(2, false)`. */
export default {
  id: "S-51",
  title:
    "A pass that asks reads ahead on the screen as a sync pass does: it answers the screen's question for the display, the landed world's for the frame",
  rules: ["F-2", "F-6", "D-23", "D-25"],
  status: "standing",
  issues: ["#4677", "#4778"],
  pins: [
    "tests/ispending-async-derivation-4677.test.ts",
    "tests/ispending-memo-wrapped-asker-4778.test.ts",
    "tests/async-reads-ahead-matrix.test.ts"
  ],
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
          flush, // 3,4 setId(2): details(2) asked; badge(0, true) asked for the display
          settle(),
          task, // 5,6 details(2) lands
          settle(),
          task, // 7,8 badge(0, true) lands: the display; the landing asks badge(2, false)
          settle(),
          task // 9,10 the frame
        ]
      },
      frames: [
        { after: 2, screen: "<span>vs0:0 vm0:1 ps0:false vm1:1 </span>", note: "primed" },
        {
          after: 4,
          screen: "—",
          note: "`setId(2)`: `details(2)` holds the write. The badge's pass runs on the screen — `id` 0, `isPending(id)` true — and asks `badge(0, true)`. Nothing shows until that answers: the badge reads the verdict, so the two show together (D-23)"
        },
        { after: 6, screen: "—", note: "`details(2)` landed; the hold waits on its display" },
        {
          after: 8,
          screen: "<span>vs0:0 vm0:1 ps0:true vm1:2 </span>",
          note: "`isPending(id)` and `badge(0, true)` in one frame (F-6). The hold lands behind it and asks `badge(2, false)`; the landing's frame waits for that answer (F-1)"
        },
        {
          after: 10,
          screen: "<span>vs0:2 vm0:3 ps0:false vm1:3 </span>",
          note: "the frame"
        }
      ],
      forbid: [
        {
          after: 8,
          screen: "<span>vs0:2 vm0:3 ps0:false vm1:2 </span>",
          why: "the landed `id` beside `badge(0, true)`: the landing's frame waits for the answer to its own question (F-1, F-2)"
        },
        {
          after: 8,
          screen: "<span>vs0:0 vm0:1 ps0:true vm1:1 </span>",
          why: "the verdict beside the badge that predates it: `badge` reads that verdict (D-23)"
        }
      ],
      note: "Declared before `details`, the badge's pass is the frame's first: it asks `badge(2, false)` at the write, the hold waits on that flight and the landing adopts it (`tests/async-reads-ahead-matrix.test.ts`, the `holderLast` rows)."
    }
  ],
  prose:
    "Ruled 2026-11-12 (C): this replaces the 2026-11-07 producer clause, under which a pass that asks was the hold's and never a display-ahead reader. That clause made `isPending`/`latest` mean different things in an async pass and a sync one, and a memo between them changed the answer (#4778). The cost of this ruling is requests: the screen's question is asked beside the frame's, and the display's reveal — the `isPending(id)` hole included — waits for it."
} satisfies Ruling;
