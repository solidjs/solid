import type { Ruling } from "./types.js";
import { s, m, plain, leaf, group, loading, asyncMemo, write, settle, flush, task } from "./_h.js";

/** The same page as S-21 with `on={[id()]}`: a plain read of the held `id`. */
export default {
  id: "S-48",
  title:
    "`on={id()}`: the `on` pass reads the held value plainly, so the swap lands with the write's frame",
  rules: ["D-17"],
  status: "standing",
  issues: ["#3540"],
  pins: ["tests/loading-on-frame-following-3540.test.ts"],
  names: { s0: "id", m0: "product", m1: "comments" },
  cases: [
    {
      scenario: {
        signals: [1],
        memos: [asyncMemo(s(0)), asyncMemo(s(0))],
        tree: group(leaf(plain(m(0))), loading(leaf(plain(m(1))), [plain(s(0))])),
        steps: [settle(), settle(), task, write(0, 2), flush, settle(), task, settle(), task]
      },
      frames: [
        { after: 2, screen: "<span>vm0:2 </span><span>vm1:2 </span>", note: "primed" },
        {
          after: 4,
          screen: "—",
          note: "the `on` pass read the held `id`: it is the hold's work and its re-arm is held with it"
        },
        {
          after: 6,
          screen: "<span>vm0:3 </span>[L]",
          note: "`product(2)` lands: the frame commits and the swap lands with it"
        },
        { after: 8, screen: "<span>vm0:3 </span><span>vm1:3 </span>" }
      ],
      forbid: [
        {
          after: 4,
          screen: "<span>vm0:2 </span>[L]",
          why: "the fallback ahead of the frame the plain read belongs to"
        }
      ]
    }
  ]
} satisfies Ruling;
