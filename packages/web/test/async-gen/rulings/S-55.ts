import type { Ruling } from "./types.js";
import { s, m, plain, leaf, flush, settle, task } from "./_h.js";

/** `first` is an optimistic memo; `doubled` derives from it; `second` is an
 * optimistic memo over `doubled`. Action A guesses `first`; action B guesses
 * `second` and, while both are open, `refresh(second)` is called. */
export default {
  id: "S-55",
  title:
    "`refresh` of an optimistic derivation under a guess: the authoritative view replaces the guess, or the guess stays until its action ends",
  rules: ["F-11", "D-34"],
  status: "standing",
  pins: [],
  names: { m0: "first", m1: "doubled", m2: "second" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: false, deps: [], poison: null, optimistic: true },
          { async: false, deps: [{ src: m(0), how: "plain" }], poison: null },
          { async: false, deps: [{ src: m(1), how: "plain" }], poison: null, optimistic: true }
        ],
        tree: leaf(plain(m(0)), plain(m(1)), plain(m(2))),
        steps: [
          { t: "action", before: [{ o: m(0), v: 5 }] },
          flush, // 0,1 A guesses first = 5
          { t: "action", before: [{ o: m(2), v: 10 }] },
          flush, // 2,3 B guesses second = 10
          { t: "refresh", m: 2 },
          task, // 4,5 refresh(second) while both are open
          settle(1),
          task, // 6,7 B ends
          settle(),
          task // 8,9 A ends
        ]
      },
      frames: [
        { after: "render", screen: "<span>vm0:1 vm1:2 vm2:3 </span>" },
        {
          after: 1,
          screen: "<span>vm0:5 vm1:6 vm2:7 </span>",
          note: "A guesses `first = 5`: shown, derived through"
        },
        { after: 3, screen: "<span>vm0:5 vm1:6 vm2:10 </span>", note: "B guesses `second = 10`" },
        {
          after: 5,
          screen: "<span>vm0:5 vm1:6 vm2:7 </span>",
          note: "`refresh(second)` while both are open: the re-ask's answer is the authoritative view (`doubled + 1`), and it replaces B's guess now"
        },
        { after: 7, screen: "—", note: "B ends" },
        { after: 9, screen: "<span>vm0:1 vm1:2 vm2:3 </span>", note: "A ends: everything reverts" }
      ],
      forbid: [
        {
          after: 5,
          screen: "<span>vm0:5 vm1:6 vm2:10 </span>",
          why: "the guess kept until its action ends although its own source answered differently (F-11)"
        }
      ]
    }
  ],
  prose:
    "Standing (confirmed 2026-11-07). The `refresh` promise's value is not observable here; it resolves to the authoritative view. `s` is unused."
} satisfies Ruling;
