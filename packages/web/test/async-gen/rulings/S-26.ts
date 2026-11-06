import type { Ruling } from "./types.js";
import { s, m, plain, pend, leaf, loading, asyncMemo, write, settle, flush, task } from "./_h.js";

/** `user` is `id + 1` (async), under a `<Loading>` with `isPending(user)` beside it. */
export default {
  id: "S-26",
  title: "`isPending` is about a new question",
  rules: ["D-23"],
  status: "standing",
  issues: ["A19", "A24"],
  pins: ["tests/question-scoped-pending.test.ts", "tests/loading-value.test.ts"],
  names: { s0: "id", m0: "user" },
  cases: [
    {
      scenario: {
        signals: [1],
        memos: [asyncMemo(s(0))],
        tree: loading(leaf(plain(m(0)), pend(m(0)))),
        steps: [
          settle(),
          task,
          write(0, 2),
          flush,
          settle(),
          task,
          { t: "refresh", m: 0 },
          flush,
          settle(),
          task
        ]
      },
      frames: [
        {
          after: "render",
          screen: "[L]",
          note: "first load: the probe's own read suspends; nothing observable yet — no verdict (D-24)"
        },
        { after: 1, screen: "<span>vm0:2 pm0:false </span>", note: "final" },
        {
          after: 3,
          screen: "<span>vm0:2 pm0:true </span>",
          note: "an input changed — a new question"
        },
        { after: 5, screen: "<span>vm0:3 pm0:false </span>" },
        { after: 7, screen: "—", note: "`refresh(user)`: a re-ask of the same question is quiet" },
        { after: 9, screen: "—", note: "the fresh value reveals silently" }
      ],
      forbid: [
        {
          after: 7,
          screen: "<span>vm0:3 pm0:true </span>",
          why: "a re-ask reported as a new question"
        }
      ]
    }
  ],
  prose:
    "The prose row's `affects()` (rows 5–6) and the optimistic write over `user` (row 7) are not migrated yet."
} satisfies Ruling;
