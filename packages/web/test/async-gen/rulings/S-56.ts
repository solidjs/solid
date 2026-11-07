import type { Ruling } from "./types.js";
import { s, m, plain, lat, leaf, loading, settle, flush, task } from "./_h.js";

/** `comments` is an optimistic async memo over `sel`, still loading. A guess
 * is written before its first answer. */
export default {
  id: "S-56",
  title:
    "A guess before the first answer is the newest value the node has produced: it shows, and the first answer judges it",
  rules: ["F-11", "D-22", "D-2"],
  status: "standing",
  pins: [
    "tests/createOptimistic.test.ts",
    "tests/uninitialized-visibility.test.ts",
    "tests/superseded-before-first-commit.test.ts"
  ],
  names: { s0: "sel", m0: "comments" },
  cases: [
    {
      scenario: {
        signals: [3],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null, optimistic: true }
        ],
        tree: loading(leaf(plain(m(0)), lat(m(0)))),
        steps: [
          { t: "guess", o: m(0), v: 9 },
          flush, // 0,1 the guess, before any answer
          settle(),
          task // 2,3 the first answer lands
        ]
      },
      frames: [
        { after: "render", screen: "[L]", note: "first load" },
        {
          after: 1,
          screen: "<span>vm0:9 lm0:9 </span>",
          note: "the guess is the first value the node produced: `latest` shows it, the plain read shows it in place of the fallback (ruled 2026-11-07); a function-form setter receives `undefined`"
        },
        {
          after: 3,
          screen: "<span>vm0:4 lm0:4 </span>",
          note: "the first answer lands and judges the guess (F-11)"
        }
      ],
      forbid: [
        {
          after: 1,
          screen: "[L]",
          why: "the guess refused — the dev guard `OPTIMISTIC_WRITE_BEFORE_LOAD` (2026-11-03, #4656), a policy from before the lane model; it stays for derived optimistic stores only, whose engine cannot show such a guess yet"
        }
      ]
    }
  ]
} satisfies Ruling;
