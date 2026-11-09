import type { Ruling } from "./types.js";
import {
  s,
  m,
  plain,
  lat,
  leaf,
  group,
  loading,
  asyncMemo,
  write,
  settle,
  flush,
  task
} from "./_h.js";

/** `product` and `comments` are `id + 1` (async). The shell reads `product`
 * outside the boundary; `comments` is under `<Loading on={[latest(id)]}>`. */
export default {
  id: "S-21",
  title: "A display-ahead read in `on` shows the fallback now, beside the held frame",
  rules: ["D-17"],
  status: "standing",
  pins: [
    "tests/loading-on-frame-following-3540.test.ts",
    "tests/loading-on-rearm-reveal-3540.test.ts"
  ],
  names: { s0: "id", m0: "product", m1: "comments" },
  cases: [
    {
      scenario: {
        signals: [1],
        memos: [asyncMemo(s(0)), asyncMemo(s(0))],
        tree: group(leaf(plain(m(0))), loading(leaf(plain(m(1))), [lat(s(0))])),
        steps: [settle(), settle(), task, write(0, 2), flush, settle(), task, settle(), task]
      },
      frames: [
        { after: 2, screen: "<span>vm0:2 </span><span>vm1:2 </span>", note: "primed" },
        {
          after: 4,
          screen: "<span>vm0:2 </span>[L]",
          note: "the new id's loading state inside the old page: `on` read `latest(id)`, whose frame has landed; the shell's read of `product` stays held"
        },
        { after: 6, screen: "<span>vm0:3 </span>[L]" },
        {
          after: 8,
          screen: "<span>vm0:3 </span><span>vm1:3 </span>",
          note: "content that reads nothing held reveals when it lands"
        }
      ],
      forbid: [
        {
          after: 4,
          screen: "<span>vm0:2 </span><span>vm1:2 </span>",
          why: "the swap travelled with the shell's frame"
        }
      ]
    }
  ]
} satisfies Ruling;
