import type { Ruling } from "./types.js";
import { s, m, plain, lat, leaf, show, write, settle, flush, task } from "./_h.js";

/** `m` is `s + 1` and throws at 2. `<Show when={latest(m)}>` under an error
 * boundary. `s = 1` errors the boundary; an action writes `s = 0` back (the
 * last good value) and stays open. */
export default {
  id: "S-53",
  title:
    "`latest` shows a held recovery ahead, as it shows a held value: the boundary recovers while the action is open",
  rules: ["D-41", "D-22", "F-6"],
  status: "standing",
  issues: ["#4403"],
  pins: ["tests/errored-recovery-wedge-4403-4404-4405.test.ts"],
  names: { s0: "s", m0: "m" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [{ async: false, deps: [{ src: s(0), how: "plain" }], poison: 2 }],
        tree: { t: "errored", child: show(lat(m(0)), leaf(lat(s(0))), { fallback: true }) },
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
        { after: "render", screen: "<span>ls0:0 </span>" },
        { after: 1, screen: "[E]", note: "`m = 2` throws: the boundary shows its fallback" },
        {
          after: 3,
          screen: "<span>ls0:0 </span>",
          note: "the action writes `s = 0` back and stays open: `latest(m)` is the newest answer `m` produced — the recovery, a change of answer though equal to the last good value (D-41) — so the `Show` it gates opens now and the content's `latest(s)` shows the held write (ruled 2026-11-07: value and error are symmetric under `latest`, as D-41 already lets `latest` throw a proposed error early)"
        },
        { after: 5, screen: "—", note: "the action lands: nothing changes" }
      ],
      forbid: [
        {
          after: 3,
          screen: "[E]",
          why: "the error kept until the action lands — D-41's mirror clause, which applies to a plain read, not to `latest`"
        }
      ]
    },
    {
      label: "′",
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
          note: "the `Show` opens ahead as in case 1, but its content's first pass reads the held `s` plainly: born held (S-46), the mount attaches at the landing and the `Show`'s switch waits with it — the boundary keeps its fallback meanwhile; a `<Loading>` inside the `Show` would show ahead (S-31). Built 2026-11-08 with S-58"
        },
        { after: 5, screen: "<span>vs0:0 </span>", note: "the action lands: the branch attaches" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span></span>",
          why: "the branch attached with its hole empty (F-2: never an empty slot) — S-46's plain row, #4417's mechanism; before S-53 the shown error masked it here, and until S-58 the action's open hold let the lane reveal it"
        },
        {
          after: 3,
          screen: "<span>vs0:1 </span>",
          why: "the branch attached with the committed `s` beside a `Show` opened by the hold's recovery (S-46 ✗: a mount under a display-ahead reader is born held, not a D-3 leaf)"
        }
      ]
    }
  ]
} satisfies Ruling;
