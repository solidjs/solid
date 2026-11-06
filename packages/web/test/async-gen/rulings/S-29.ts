import type { Ruling } from "./types.js";

const s = (i: number) => ({ k: "s" as const, i });
const m = (i: number) => ({ k: "m" as const, i });

/** `fast` and `slow` are `n + 1` (async), `copy` is `slow + 1` (sync), and
 * `both` is `fast + copy + 1` (sync): `isPending(both)` is the combined
 * probe `isPending(() => [fast(), copy()])`. */
export default {
  id: "S-29",
  title: "A display-ahead reader's own async is held",
  rules: ["D-25"],
  status: "standing",
  issues: ["A31", "#3442"],
  pins: ["tests/ispending-combined-atomic-3442.test.ts"],
  names: { s0: "n", m0: "fast", m1: "slow", m2: "copy", m3: "both" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          { async: false, deps: [{ src: m(1), how: "plain" }], poison: null },
          {
            async: false,
            deps: [
              { src: m(0), how: "plain" },
              { src: m(2), how: "plain" }
            ],
            poison: null
          }
        ],
        tree: {
          t: "leaf",
          text: [],
          attrs: [
            { how: "plain", src: m(0) },
            { how: "plain", src: m(2) },
            { how: "pending", src: m(3) }
          ],
          grouped: true
        },
        steps: [
          { t: "settle", pick: 0 },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "write", s: 0, v: 1 },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        {
          after: 2,
          screen: "<span data-a0=vm0:1  data-a1=vm2:2  data-a2=pm3:false ></span>",
          note: "primed"
        },
        { after: 4, screen: "<span data-a0=vm0:1  data-a1=vm2:2  data-a2=pm3:true ></span>" },
        {
          after: 6,
          screen: "—",
          note: "`fast` landed; `copy` computes under its own posture: still pending on `slow`"
        },
        { after: 8, screen: "<span data-a0=vm0:2  data-a1=vm2:3  data-a2=pm3:false ></span>" }
      ],
      forbid: [
        {
          after: 6,
          screen: "<span data-a0=vm0:2  data-a1=vm2:2  data-a2=pm3:false ></span>",
          why: "`fast` revealed alone with the probe false"
        }
      ]
    }
  ]
} satisfies Ruling;
