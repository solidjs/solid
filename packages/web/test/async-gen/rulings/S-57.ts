import type { Ruling } from "./types.js";
import { s, m, plain, leaf, write, settle, flush, task } from "./_h.js";

/** `view` is an optimistic memo; `label` is async over `view` and the plain
 * signal `ordinary` (its flight's input is `view + ordinary + 1`). An action
 * guesses `view`; later, from outside, `ordinary` is written. `label`'s pass
 * reads `view()`, a lane node, so it is lane work both times: the guess's
 * world asks `label(5, 0)` and then `label(5, 10)`; nobody asks
 * `label(1, 10)`. Case ′: the same with a sync derivation and the second
 * write held by another action. */
export default {
  id: "S-57",
  title:
    "A change whose derivation became a guess's lane work holds on that flight, and reveals with the lane",
  rules: ["F-2", "F-1", "F-6"],
  status: "standing",
  names: { s0: "ordinary", m0: "view", m1: "label" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: false, deps: [], poison: null, optimistic: true },
          {
            async: true,
            deps: [
              { src: m(0), how: "plain" },
              { src: s(0), how: "plain" }
            ],
            poison: null
          }
        ],
        tree: leaf(plain(m(0)), plain(s(0)), plain(m(1))),
        steps: [
          settle(),
          task, // 0,1 primed
          { t: "action", before: [{ o: m(0), v: 5 }] },
          flush, // 2,3 guess view = 5: label(5, 0) asked, the lane's
          write(0, 10),
          flush, // 4,5 setOrdinary(10) from outside: label(5, 10) asked, the lane's again
          settle(2),
          task, // 6,7 label(5, 10) lands
          settle(1),
          task, // 8,9 label(5, 0), superseded, lands
          settle(),
          task // 10,11 the action ends
        ]
      },
      frames: [
        { after: 1, screen: "<span>vm0:1 vs0:0 vm1:2 </span>", note: "primed" },
        {
          after: 3,
          screen: "—",
          note: "the guess waits for its own async, `label(5, 0)` (F-6); the action's yield keeps it live, not off screen"
        },
        {
          after: 5,
          screen: "—",
          note: "`setOrdinary(10)` needs `label` to show, and `label`'s only pending answer is the lane's `label(5, 10)`: the write is held on it (F-2, whatever the async's source) and its frame is entangled with the lane (ruled 2026-11-07)"
        },
        {
          after: 7,
          screen: "<span>vm0:5 vs0:10 vm1:16 </span>",
          note: "`label(5, 10)` lands: the write and the lane reveal as one frame — the only consistent screen that contains `10`"
        },
        {
          after: 9,
          screen: "—",
          note: "`label(5, 0)` was superseded by the re-ask: its answer lands nothing (today already)"
        },
        { after: 11, screen: "—", note: "the action ends; the guess reverts after this script" }
      ],
      forbid: [
        {
          after: 5,
          screen: "<span>vm0:1 vs0:10 vm1:2 </span>",
          why: "`ordinary = 10` beside `label(1, 0)`: a new value beside a stale derivation of it (F-1); before the build the plain write's frame had no consequence of its own to wait for, because the lane took the derivation"
        }
      ]
    },
    {
      label: "′",
      scenario: {
        signals: [0],
        memos: [
          { async: false, deps: [], poison: null, optimistic: true },
          {
            async: false,
            deps: [
              { src: m(0), how: "plain" },
              { src: s(0), how: "plain" }
            ],
            poison: null
          }
        ],
        tree: leaf(plain(m(0)), plain(s(0)), plain(m(1))),
        steps: [
          { t: "action", before: [{ o: m(0), v: 11 }] },
          flush, // 0,1 A guesses view = 11: sync, shows now
          { t: "action", before: [{ s: 0, v: 2 }] },
          flush, // 2,3 B writes ordinary = 2 and stays open: held
          settle(1),
          task, // 4,5 B ends
          settle(),
          task // 6,7 A ends
        ]
      },
      frames: [
        { after: "render", screen: "<span>vm0:1 vs0:0 vm1:2 </span>" },
        {
          after: 1,
          screen: "<span>vm0:11 vs0:0 vm1:12 </span>",
          note: "a sync derivation of the guess shows with it"
        },
        { after: 3, screen: "—", note: "B's write is held; `label` is the hold's work" },
        {
          after: 5,
          screen: "<span>vm0:11 vs0:2 vm1:14 </span>",
          note: "B lands: the guess and the truth combine in one frame"
        },
        { after: 7, screen: "<span>vm0:1 vs0:2 vm1:4 </span>", note: "A ends: the guess reverts" }
      ],
      note: "Standing today: the peers coordinate (the experiment's accepted C2 reading)."
    }
  ],
  prose:
    "The experiment's A2 row. Ruled 2026-11-07 for case 1: F-2 as written. F-6's lane exemption was for the guess's own hold, the action; it never released an unrelated write from its own consequence. A lane's superseded question holds nothing, which today already does."
} satisfies Ruling;
