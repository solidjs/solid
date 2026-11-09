import type { Ruling } from "./types.js";
import { s, m, plain, lat, pend, leaf, group, write, settle, flush, task } from "./_h.js";

/** `comments` is an optimistic async memo over `sel` (truth `sel + 1`). The
 * post guesses `comments = 9` ("mine (sending)") inside a hold that refreshes
 * at its end; `sel` is written from outside while the post is out. */
export default {
  id: "S-44",
  title: "An outside input change under a guess is held with the guess's hold",
  rules: ["D-34", "F-1"],
  status: "ruled-not-built",
  issues: ["#4336"],
  pins: [
    "tests/optimistic-question-change-4336.test.ts",
    "tests/optimistic-layered-filter-4336.test.ts"
  ],
  names: { s0: "sel", m0: "comments" },
  cases: [
    {
      scenario: {
        signals: [3],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null, optimistic: true }
        ],
        tree: group(leaf(plain(s(0)), plain(m(0))), leaf(lat(m(0))), leaf(pend(m(0)))),
        steps: [
          settle(),
          task, // 0,1 primed
          { t: "action", before: [{ o: m(0), v: 9 }], refresh: [0] },
          flush, // 2,3 the post
          write(0, 1),
          flush, // 4,5 outside: setSel(1)
          settle(1),
          task, // 6,7 issue 1's answer lands
          settle(),
          task, // 8,9 the post settles; its refresh re-asks 1
          settle(),
          task // 10,11 issue 1's answer lands again
        ]
      },
      frames: [
        {
          after: 1,
          screen: "<span>vs0:3 vm0:4 </span><span>lm0:4 </span><span>pm0:false </span>",
          note: "primed"
        },
        {
          after: 3,
          screen: "<span>vs0:3 vm0:9 </span><span>lm0:9 </span><span>pm0:false </span>",
          note: "the guess shows; verdict-inert"
        },
        {
          after: 5,
          screen: "<span>vs0:3 vm0:9 </span><span>lm0:9 </span><span>pm0:true </span>",
          note: "a new question, not the guess's source answering: the change is held with the post"
        },
        {
          after: 7,
          screen: "—",
          note: "issue 1's answer lands: still held; `latest(comments)` is the displayed guess (Decision 3)"
        },
        { after: 9, screen: "—", note: "the post settles; its refresh re-asks issue 1" },
        {
          after: 11,
          screen: "<span>vs0:1 vm0:2 </span><span>lm0:2 </span><span>pm0:false </span>",
          note: "one frame"
        }
      ],
      forbid: [
        {
          after: 7,
          screen: "<span>vs0:1 vm0:2 </span><span>lm0:2 </span><span>pm0:false </span>",
          why: "a `sel 1` frame before the post settles"
        }
      ]
    }
  ],
  prose:
    "The prose row's 1″/1⁗ (an optimistic `sel`), 1‴ (a keyed store) and the layered two-action case are not migrated yet."
} satisfies Ruling;
