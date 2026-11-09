import type { Ruling } from "./types.js";

const s = (i: number) => ({ k: "s" as const, i });

export default {
  id: "S-31",
  title:
    "A verdict reader's mount is mainline: `Show when={latest(x)}` → `Loading` shows its fallback",
  rules: ["D-1", "D-25"],
  status: "standing",
  issues: ["#3851"],
  pins: ["tests/verdict-mount-first-pass-3851.test.ts"],
  names: { s0: "x" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [],
        tree: {
          t: "group",
          kids: [
            { t: "leaf", text: [{ how: "plain", src: s(0) }], attrs: [], grouped: false },
            {
              t: "show",
              when: { how: "latest", src: s(0) },
              fallback: false,
              child: {
                t: "loading",
                child: { t: "leaf", text: [{ how: "plain", src: s(0) }], attrs: [], grouped: false }
              }
            }
          ]
        },
        steps: [
          { t: "action", s: 0, v: 1 },
          { t: "flush" },
          { t: "settle", pick: 0 },
          { t: "task" }
        ]
      },
      frames: [
        { after: "render", screen: "<span>vs0:0 </span>", note: "the `Show` is closed" },
        {
          after: 1,
          screen: "<span>vs0:0 </span>[L]",
          note: "the `Show` opens ahead (display-ahead); the boundary is a mainline mount whose content read the write the action holds: born held, so the fallback"
        },
        { after: 3, screen: "<span>vs0:1 </span><span>vs0:1 </span>" }
      ],
      forbid: [
        {
          after: 1,
          screen: "<span>vs0:0 </span><span>vs0:1 </span>",
          why: "the torn frame #3869 fixed: content 1 beside x = 0"
        }
      ]
    }
  ]
} satisfies Ruling;
