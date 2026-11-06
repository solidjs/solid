import type { Ruling } from "./types.js";
import { s, m, plain, lat, leaf, loading, settle, flush, task } from "./_h.js";

/** `comments` is an optimistic async memo over `sel`, still loading. A guess
 * is written before its first answer. */
export default {
  id: "S-56",
  title: "A guess before the first answer: refused (dev), or shown",
  rules: ["D-2", "D-22"],
  status: "proposed",
  proposedBy: "experiment/unified-updates (GabbeV), stage 124",
  pins: ["tests/createOptimistic.test.ts"],
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
          screen: "—",
          note: "the guess is refused: `OPTIMISTIC_WRITE_BEFORE_LOAD` (dev); nothing changes"
        },
        { after: 3, screen: "<span>vm0:4 lm0:4 </span>", note: "the first answer lands" }
      ],
      proposed: [
        {
          after: 1,
          screen: "<span>vm0:9 lm0:9 </span>",
          note: "the guess is accepted before the first answer (a functional guess receives `undefined`); the experiment's fixture shows it once written — whether `<Loading>` keeps its fallback until the first answer is not stated"
        }
      ],
      allow: ["throw"]
    }
  ]
} satisfies Ruling;
