import type { Ruling } from "./types.js";

const s = (i: number) => ({ k: "s" as const, i });
const m = (i: number) => ({ k: "m" as const, i });

/** `m0` is `s0 + 1` (async, a first load). The first answer and an action
 * that writes `s0` land in one tick. */
export default {
  id: "S-45",
  title:
    "A first answer landing in the same tick as an action that writes its input: `latest` shows it, the plain read waits",
  rules: ["D-22", "F-9"],
  status: "ruled-not-built",
  issues: ["E9"],
  names: { s0: "s0", m0: "m0", m1: "L" },
  cases: [
    {
      label: "leaf",
      scenario: {
        signals: [0],
        memos: [{ async: true, deps: [{ src: s(0), how: "plain" }], poison: null }],
        tree: {
          t: "group",
          kids: [
            { t: "leaf", text: [{ how: "plain", src: s(0) }], attrs: [], grouped: false },
            {
              t: "loading",
              child: { t: "leaf", text: [{ how: "latest", src: m(0) }], attrs: [], grouped: false }
            }
          ]
        },
        steps: [
          { t: "settle", pick: 0 },
          { t: "action", s: 0, v: 1 },
          { t: "micro" },
          { t: "micro" },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        { after: "render", screen: "<span>vs0:0 </span>[L]", note: "first load" },
        {
          after: 4,
          screen: "<span>vs0:0 </span><span>lm0:1 </span>",
          note: "the answer is the action's (D-4) and `latest` returns it (D-22): the committed `s0 = 0` beside its own answer, one frame"
        },
        { after: 8, screen: "<span>vs0:1 </span><span>lm0:2 </span>" }
      ],
      forbid: [
        {
          after: 4,
          screen: "<span>vs0:0 </span>[L]",
          why: "the leaf waited on the action it did not read; a `Loading` reading only `latest` shows what it has (S-40)"
        }
      ]
    },
    {
      label: "memo",
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          { async: false, deps: [{ src: m(0), how: "latest" }], poison: null }
        ],
        tree: {
          t: "group",
          kids: [
            { t: "leaf", text: [{ how: "plain", src: s(0) }], attrs: [], grouped: false },
            {
              t: "loading",
              child: { t: "leaf", text: [{ how: "plain", src: m(1) }], attrs: [], grouped: false }
            }
          ]
        },
        steps: [
          { t: "settle", pick: 0 },
          { t: "action", s: 0, v: 1 },
          { t: "micro" },
          { t: "micro" },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        { after: "render", screen: "<span>vs0:0 </span>[L]", note: "first load" },
        {
          after: 4,
          screen: "<span>vs0:0 </span><span>vm1:2 </span>",
          note: "the same screen through a memo `L = latest(m0) + 1`"
        },
        { after: 8, screen: "<span>vs0:1 </span><span>vm1:3 </span>" }
      ]
    },
    {
      label: "plain",
      status: "standing",
      scenario: {
        signals: [0],
        memos: [{ async: true, deps: [{ src: s(0), how: "plain" }], poison: null }],
        tree: {
          t: "group",
          kids: [
            { t: "leaf", text: [{ how: "plain", src: s(0) }], attrs: [], grouped: false },
            {
              t: "loading",
              child: { t: "leaf", text: [{ how: "plain", src: m(0) }], attrs: [], grouped: false }
            }
          ]
        },
        steps: [
          { t: "settle", pick: 0 },
          { t: "action", s: 0, v: 1 },
          { t: "micro" },
          { t: "micro" },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        { after: "render", screen: "<span>vs0:0 </span>[L]" },
        {
          after: 4,
          screen: "—",
          note: "a plain read of a first load is loading (F-9); the fallback is right there"
        },
        { after: 8, screen: "<span>vs0:1 </span><span>vm0:2 </span>" }
      ]
    }
  ]
} satisfies Ruling;
