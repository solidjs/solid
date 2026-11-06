import type { Ruling } from "./types.js";
import { s, m, plain, lat, leaf, show, write, settle, flush, task } from "./_h.js";

/** `m` is `s + 1` and throws at 2. `<Show when={latest(m)}>` under an error
 * boundary. `s = 1` errors the boundary; an action writes `s = 0` back (the
 * last good value) and stays open. */
export default {
  id: "S-53",
  title:
    "An action recovering a memo to its last good value under `latest`: the error until it lands, or the recovery ahead",
  rules: ["D-39", "D-41", "D-22"],
  status: "proposed",
  proposedBy: "experiment/unified-updates (GabbeV), stage 137 (value/error symmetry)",
  issues: ["#4403"],
  pins: ["tests/errored-recovery-wedge-4403-4404-4405.test.ts"],
  names: { s0: "s", m0: "m" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [{ async: false, deps: [{ src: s(0), how: "plain" }], poison: 2 }],
        tree: { t: "errored", child: show(lat(m(0)), leaf(plain(s(0))), { fallback: true }) },
        steps: [
          write(0, 1),
          flush, // 0,1 m = 2 throws
          { t: "action", before: [{ s: 0, v: 0 }] },
          flush, // 2,3 the recovery, held
          settle(),
          task // 4,5 the action lands
        ]
      },
      frames: [
        { after: "render", screen: "<span>vs0:0 </span>" },
        { after: 1, screen: "[E]", note: "`m = 2` throws: the boundary shows its fallback" },
        {
          after: 3,
          screen: "—",
          note: "the action writes `s = 0` back — the last good value — and stays open: the error stays until it lands (D-39)"
        },
        { after: 5, screen: "<span>vs0:0 </span>", note: "the action lands: recovered" }
      ],
      proposed: [
        {
          after: 3,
          screen: "<span>vs0:0 </span>",
          note: "`latest(m)` selects the recovery ahead as it would a value (D-22's symmetry): the boundary recovers while the action is open"
        }
      ]
    }
  ]
} satisfies Ruling;
