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
  status: "ruled-not-built",
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
          screen: "<span>vs0:0 </span>",
          note: "the action writes `s = 0` back and stays open: `latest(m)` is the newest answer `m` produced — the recovery — so the `Show` it gates opens now (ruled 2026-11-07: value and error are symmetric under `latest`, as D-41 already lets `latest` throw a proposed error early)"
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
    }
  ]
} satisfies Ruling;
