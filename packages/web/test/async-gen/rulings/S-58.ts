import type { Ruling } from "./types.js";
import { s, m, plain, lat, leaf, settle, flush, write, task } from "./_h.js";

/** S-46's shape with the `Show` replaced by a hand-written gate: `detail`
 * is `id + 1` (async); a plain write to `id` is held by `detail`'s flight;
 * the gate opens on `latest(id)` and its content reads `id` plainly. */
const memos = [{ async: true, deps: [{ src: s(0), how: "plain" as const }], poison: null }];

export default {
  id: "S-58",
  title:
    "A display-ahead gate is the same mainline mount with any number of memos between the probe and the branch",
  rules: ["D-25", "F-1"],
  status: "standing",
  issues: ["#4708"],
  pins: [
    "tests/verdict-mount-first-pass-3851.test.ts",
    "web/test/display-ahead-gate-hops.spec.tsx"
  ],
  names: { s0: "id", m0: "detail", F: "[none]" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos,
        tree: {
          t: "group",
          kids: [
            leaf(plain(s(0))),
            leaf(plain(m(0))),
            {
              t: "show",
              when: { how: "latest", src: s(0) },
              fallback: true,
              child: leaf(plain(s(0)))
            }
          ]
        },
        steps: [settle(), task, write(0, 1), flush, settle(), task]
      },
      variants: [{ gate: "memo" }, { gate: "cond" }],
      frames: [
        { after: 1, screen: "<span>vs0:0 </span><span>vm0:1 </span>[F]", note: "primed" },
        {
          after: 3,
          screen: "—",
          note: "the gate opens ahead (`latest` asked) and mounts a branch whose first pass reads the staging plainly: born held, it attaches at the landing and the fallback stays — through `<Show>` (two memos between the probe and the branch), a truthiness memo and a branch memo (one), or one memo that probes and mounts (none). Ruled 2026-11-08: D-25's third sentence is about the gate, not about `<Show>`"
        },
        { after: 5, screen: "<span>vs0:1 </span><span>vm0:2 </span><span>vs0:1 </span>" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span></span>",
          why: "the branch attached with its hole empty (F-2: never an empty slot) — the one-hop gate before S-58: the probe's own reader was published with its frame when the probe re-derived to the same value at the seam (`keepReaders`), where `<Show>`'s truthiness memo kept the branch one read away"
        },
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span>vs0:0 </span>",
          why: "the branch attached with the committed value: a mount under a display-ahead reader is born held, not a D-3 leaf (S-46)"
        }
      ]
    },
    {
      label: "′",
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          {
            async: false,
            deps: [
              { src: s(0), how: "plain" },
              { src: m(0), how: "latest" }
            ],
            poison: 0
          },
          {
            async: false,
            deps: [
              { src: m(0), how: "latest" },
              { src: m(1), how: "plain" }
            ],
            poison: 1
          }
        ],
        tree: {
          t: "show",
          when: { how: "pending", src: m(0) },
          child: { t: "leaf", text: [], attrs: [lat(m(2)), plain(m(0))], grouped: true },
          fallback: true
        },
        steps: [settle(), task, write(0, 1), task]
      },
      variants: [{ gate: "memo" }, { gate: "cond" }, { split: true }],
      frames: [
        { after: 1, screen: "[F]", note: "primed: `isPending(m0)` is false" },
        {
          after: 3,
          screen: "—",
          note: "the write re-asks `m0`; `isPending(m0)` opens the gate, and the mount's one grouped effect reads `latest(m2)` ahead beside `m0()` plainly: the window it opened does not make it a D-3 leaf of the screen — it is the mount a probing pass opened, born held on its plain read of the flight, and the fallback stays until the landing, where `isPending` is false again (ruled 2026-11-08: neither hop count nor grouping changes a mount's seat, even when its own pass reads ahead of the same node)"
        }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span data-a0=lm2:4  data-a1=vm0:1 ></span>",
          why: "the branch attached with the committed value beside its own ahead read — through a hand-written gate, grouped, before this case was built; `<Show>` and the split leaf already kept the fallback"
        }
      ]
    }
  ],
  prose:
    "PR #4708 pinned a hop-less `<Show>` as never painting; with real JSX it paints at the landing and tears only during the flight, the same way `<Show>` did before S-46. The runner's `gate` variant here is the gate as written by hand, not an emulation."
} satisfies Ruling;
