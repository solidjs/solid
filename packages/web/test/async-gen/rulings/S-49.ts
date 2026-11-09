import type { Ruling } from "./types.js";
import { s, m, plain, lat, leaf, group, loading, asyncMemo, settle, flush, task } from "./_h.js";

/** `on={[latest(id), filter()]}`; one action writes both `id` and `filter`. */
export default {
  id: "S-49",
  title: "A mixed `on`: a plain read of a held value makes the re-arm wait",
  rules: ["D-17"],
  status: "ruled-not-built",
  names: { s0: "id", s1: "filter", m0: "product", m1: "comments" },
  cases: [
    {
      scenario: {
        signals: [1, 0],
        memos: [asyncMemo(s(0)), asyncMemo(s(0))],
        tree: group(leaf(plain(m(0))), loading(leaf(plain(m(1))), [lat(s(0)), plain(s(1))])),
        steps: [
          settle(),
          settle(),
          task,
          {
            t: "action",
            before: [
              { s: 0, v: 2 },
              { s: 1, v: 1 }
            ]
          },
          flush,
          settle(),
          task, // the action's body returns
          settle(),
          task, // product(2) lands: the hold commits
          settle(),
          task // comments(2) lands
        ]
      },
      frames: [
        { after: 2, screen: "<span>vm0:2 </span><span>vm1:2 </span>", note: "primed" },
        {
          after: 4,
          screen: "—",
          note: "`filter()` is a plain read of a held staging: the `on` pass is the hold's work and the re-arm waits, whatever `latest(id)` beside it read"
        },
        {
          after: 8,
          screen: "<span>vm0:3 </span>[L]",
          note: "the hold commits: the swap lands with the frame"
        },
        { after: 10, screen: "<span>vm0:3 </span><span>vm1:3 </span>" }
      ],
      forbid: [
        {
          after: 4,
          screen: "<span>vm0:2 </span>[L]",
          why: "today's screen: one probe made the whole `on` pass a verdict reader"
        }
      ]
    }
  ]
} satisfies Ruling;
