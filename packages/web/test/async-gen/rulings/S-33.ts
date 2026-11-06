import type { Ruling } from "./types.js";
import { s, m, plain, lat, pend, leaf, group, loading, write, settle, flush, task } from "./_h.js";

/** `double` is an optimistic async memo over `value` (truth `value + 1`);
 * `related` is `double + 1` (async), rendered beside it. The click writes
 * `value = 1` and guesses `double = 3` in one tick; the truth will be 2. */
export default {
  id: "S-33",
  title:
    "A different truth corrects the graph now and the screen at the commit; a never-shown guess is void",
  rules: ["D-34"],
  status: "standing",
  issues: ["#3331"],
  pins: ["tests/spec-async-semantics.test.ts"],
  names: { s0: "value", m0: "double", m1: "related" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null, optimistic: true },
          { async: true, deps: [{ src: m(0), how: "plain" }], poison: null }
        ],
        tree: group(loading(leaf(plain(m(0)), plain(m(1)))), leaf(lat(m(0))), leaf(pend(m(0)))),
        steps: [
          settle(),
          task,
          settle(),
          task, // 0..3 primed
          write(0, 1),
          { t: "guess", o: m(0), v: 3 },
          flush, // 4,5,6 the click
          settle(),
          task, // 7,8 the source lands 2 ≠ 3: related re-asks from 2
          settle(),
          task, // 9,10 the obsolete related(3) lands: inert
          settle(),
          task // 11,12 related(2) lands
        ]
      },
      frames: [
        {
          after: 3,
          screen: "<span>vm0:1 vm1:2 </span><span>lm0:1 </span><span>pm0:false </span>",
          note: "primed"
        },
        {
          after: 6,
          screen: "<span>vm0:1 vm1:2 </span><span>lm0:3 </span><span>pm0:true </span>",
          note: "the guess's lane holds itself on `related(3)`; `latest` shows the guess"
        },
        {
          after: 8,
          screen: "<span>vm0:1 vm1:2 </span><span>lm0:2 </span><span>pm0:true </span>",
          note: "the source lands 2 ≠ 3: `related` re-asks from 2 now; the guess never showed, so what showed stays"
        },
        { after: 10, screen: "—", note: "the obsolete `related(3)` lands: inert" },
        { after: 12, screen: "<span>vm0:2 vm1:3 </span><span>lm0:2 </span><span>pm0:false </span>" }
      ],
      forbid: [
        {
          after: 8,
          screen: "<span>vm0:3 vm1:4 </span><span>lm0:2 </span><span>pm0:true </span>",
          why: "a frame showing `double 3`: a dead, invisible guess"
        }
      ]
    }
  ]
} satisfies Ruling;
