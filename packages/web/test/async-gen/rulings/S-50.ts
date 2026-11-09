import type { Ruling } from "./types.js";
import { s, m, plain, leaf, syncMemo, write, flush, task, settle, act } from "./_h.js";

/** `m` reads `k`, probes `isPending(x)` while `probe` is on, and reads `x`:
 * `m = 1 + k + (probe ? isPending(x) : 0) + x`. */
export default {
  id: "S-50",
  title: "A memo that probed once, re-run by a sync write, holds the tick",
  rules: ["D-25"],
  status: "ruled-not-built",
  names: { s0: "x", s1: "k", s2: "probe", m0: "m" },
  cases: [
    {
      scenario: {
        signals: [0, 0, 1],
        memos: [
          syncMemo(
            { src: s(1), how: "plain" },
            { src: s(0), how: "pending", when: s(2) },
            { src: s(0), how: "plain" }
          )
        ],
        tree: leaf(plain(m(0)), plain(s(1))),
        steps: [
          act(0, 1),
          flush, // 0,1 an action holds x = 1; m probes: busy
          write(2, 0),
          write(1, 1),
          flush, // 2,3,4 the probe is dropped; a sync write to k re-runs m
          settle(),
          task // 5,6 the body returns
        ]
      },
      frames: [
        { after: "render", screen: "<span>vm0:1 vs1:0 </span>" },
        {
          after: 1,
          screen: "<span>vm0:2 vs1:0 </span>",
          note: "the probe shows busy now; the plain read of `x` is the screen's 0"
        },
        {
          after: 4,
          screen: "—",
          note: "this run probes nothing: its read of `x` is a plain read of the held staging, so `m` is the hold's work and the tick that wrote `k` holds with it"
        },
        { after: 6, screen: "<span>vm0:3 vs1:1 </span>" }
      ],
      forbid: [
        {
          after: 4,
          screen: "<span>vm0:2 vs1:1 </span>",
          why: "today's screen (published twice): the memo read `x` as the screen's because its last run probed, and `k` broke free"
        }
      ]
    }
  ]
} satisfies Ruling;
