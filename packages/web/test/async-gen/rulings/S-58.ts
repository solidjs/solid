import type { Ruling } from "./types.js";
import { s, m, plain, leaf, settle, flush, write, task } from "./_h.js";

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
    }
  ],
  prose:
    "PR #4708 pinned a hop-less `<Show>` as never painting; with real JSX it paints at the landing and tears only during the flight, the same way `<Show>` did before S-46. The runner's `gate` variant here is the gate as written by hand, not an emulation."
} satisfies Ruling;
