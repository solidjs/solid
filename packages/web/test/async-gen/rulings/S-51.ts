import type { Ruling } from "./types.js";
import { s, m, plain, pend, leaf, write, settle, flush, task } from "./_h.js";

/** `details` is async over `id`; `badge` is async over `id` and
 * `isPending(id)` (its flight's input is `id + isPending + 1`). Writing `id`
 * asks two questions at once: `details(2)` on the mainline, and the badge's
 * display-ahead question `badge(0, pending)` beside its mainline one. */
export default {
  id: "S-51",
  title: "An obsolete display-ahead question: shown when it lands, or superseded by the correction",
  rules: ["F-6", "D-25"],
  status: "proposed",
  proposedBy: "experiment/unified-updates (GabbeV), stage 126",
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
          flush, // 3,4 setId(2): details(2) and the badge's two questions
          settle(),
          task, // 5,6 details lands
          settle(),
          task, // 7,8 the obsolete badge lands
          settle(),
          task // 9,10 the correction lands
        ]
      },
      frames: [
        { after: 2, screen: "<span>vs0:0 vm0:1 ps0:false vm1:1 </span>", note: "primed" },
        {
          after: 4,
          screen: "—",
          note: "`setId(2)`: `details(2)` on the mainline; the badge asks its display-ahead question `badge(0, pending)` and its mainline one — the frame holds"
        },
        {
          after: 6,
          screen: "—",
          note: "`details(2)` lands: held, the badge's display-ahead question is still out"
        },
        {
          after: 8,
          screen: "<span>vs0:0 vm0:1 ps0:true vm1:2 </span>",
          note: "the obsolete question lands and reveals whole (F-6): `pending true` beside `Item 0`; the correction `badge(2)` is asked now"
        },
        {
          after: 10,
          screen: "<span>vs0:2 vm0:3 ps0:false vm1:3 </span>",
          note: "the correction lands"
        }
      ],
      proposed: [
        {
          after: 8,
          screen: "<span>vs0:0 vm0:1 ps0:false vm1:1 </span>",
          note: "the correction was asked when `details(2)` landed; the obsolete question's answer is superseded and its frame never shows — one frame fewer, one request fewer"
        }
      ]
    }
  ]
} satisfies Ruling;
