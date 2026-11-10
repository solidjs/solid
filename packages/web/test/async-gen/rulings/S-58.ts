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
  issues: ["#4708", "#4405"],
  pins: [
    "tests/verdict-mount-first-pass-3851.test.ts",
    "web/test/display-ahead-gate-hops.spec.tsx",
    "tests/zombie-errored-retry-4405.test.ts"
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
    },
    {
      label: "″",
      scenario: {
        signals: [0],
        optimistic: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          {
            async: false,
            deps: [
              { src: s(0), how: "plain" },
              { src: m(0), how: "latest" }
            ],
            poison: null
          },
          {
            async: false,
            deps: [
              { src: m(0), how: "latest" },
              { src: m(1), how: "plain" }
            ],
            poison: null
          }
        ],
        tree: {
          t: "show",
          when: { how: "pending", src: m(0) },
          child: { t: "leaf", text: [], attrs: [lat(m(2)), plain(m(0))], grouped: true },
          fallback: true
        },
        steps: [
          settle(),
          task,
          { t: "action", before: [{ s: 0, v: 1 }] },
          task,
          settle(),
          task,
          settle(),
          task
        ]
      },
      variants: [{ gate: "memo" }, { gate: "cond" }, { split: true }],
      frames: [
        { after: 1, screen: "[F]", note: "primed" },
        {
          after: 3,
          screen: "—",
          note: "case ′'s write inside an action, as a guess on `id`: the lane re-asks `detail`, `isPending(detail)` opens the gate in the lane, and the mount's first pass reads the lane's flight plainly — born held on it, not served the screen as lane work is (A15's stale reader, D-28): served, it would initialize with S-46's frame inside the lane's, revealed at the landing. The fallback stays"
        },
        {
          after: 5,
          screen: "—",
          note: "the action landed; the truth re-asks `detail` and the same mount still waits on the flight (its first pass never completed): the fallback stays. Not a hold the lane's work joined — a lane never makes a flush the hold's (D-37); `frameRead`'s mount arm is for a mainline pass, or a lane pass reading a pending node"
        },
        { after: 7, screen: "—", note: "`detail` answered: `isPending` is false again" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span data-a0=lm2:5  data-a1=vm0:1 ></span>",
          why: "the branch attached inside the lane with the committed value beside the lane's own derivation"
        },
        {
          after: 5,
          screen: "<span data-a0=lm2:4  data-a1=vm0:1 ></span>",
          why: "the mount the lane served the screen revealed at the action's landing with the committed value — S-46's frame, through `<Show>`, a truthiness memo and a split leaf before this case was built (the single-memo gate re-created its branch at the landing and escaped it); it then stayed on screen after `detail` answered (F-1)"
        }
      ]
    },
    {
      label: "‴",
      scenario: {
        signals: [0],
        optimistic: [0],
        memos: [{ async: true, deps: [{ src: s(0), how: "plain" }], poison: null }],
        tree: {
          t: "show",
          when: { how: "pending", src: m(0) },
          child: { t: "leaf", text: [], attrs: [plain(m(0))], grouped: true },
          fallback: true
        },
        steps: [
          settle(),
          task,
          { t: "action", before: [{ s: 0, v: 1 }] },
          task,
          settle(),
          task,
          settle(),
          task
        ]
      },
      variants: [{ gate: "memo" }, { gate: "cond" }, { split: true }],
      frames: [
        { after: 1, screen: "[F]", note: "primed" },
        {
          after: 3,
          screen: "—",
          note: "the plain-only leaf (S-46's row) under the same guess: the same seat in a lane as in a mainline flush — born held on the lane's flight, the fallback stays through the lane, the action's landing and the answer"
        },
        { after: 7, screen: "—" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span data-a0=vm0:1 ></span>",
          why: "the branch attached inside the lane with the committed value (S-46 ✗2, in a lane) — every gate shape before this case was built; the frame then stayed on screen after `detail` answered"
        }
      ]
    },
    {
      label: "⁗",
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
              child: { t: "errored", child: leaf(plain(s(0))) }
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
          note: "case 1 with an `<Errored>` around the branch's content: the boundary is part of the mount, so the content's first pass is the mount's and is born held — the fallback stays through every gate shape"
        },
        { after: 5, screen: "<span>vs0:1 </span><span>vm0:2 </span><span>vs0:1 </span>" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span></span>",
          why: "the branch attached with its hole empty (F-2): the mount stamp (S-46) did not reach a first pass the mount's boundary created, so the content behind it was served as a plain leaf — through a hand-written gate, before this case was built"
        }
      ]
    },
    {
      label: "⁗′",
      scenario: JSON.parse(
        `{"signals":[2,3],"memos":[{"async":false,"deps":[{"src":{"k":"s","i":0},"how":"plain"},{"src":{"k":"s","i":1},"how":"latest"}],"poison":0},{"async":false,"deps":[{"src":{"k":"m","i":0},"how":"plain"},{"src":{"k":"s","i":1},"how":"plain"}],"poison":1}],"tree":{"t":"show","when":{"how":"plain","src":{"k":"m","i":1}},"child":{"t":"leaf","text":[],"attrs":[],"grouped":true},"fallback":false},"steps":[{"t":"action","s":1,"v":2},{"t":"settle","pick":2},{"t":"write","s":0,"v":3},{"t":"task"},{"t":"action","s":1,"v":1}]}`
      ),
      variants: [
        { remount: true },
        { remount: true, gate: "memo" },
        { remount: true, gate: "cond" }
      ],
      frames: [
        { after: "render", screen: "<span></span>" },
        {
          after: 3,
          screen: "[ROOT-E]",
          note: "#4405's minimized shape: the action's landing, a write that poisons `m1` and (variant) a remount of the gate in one tick"
        },
        {
          after: 4,
          screen: "—",
          note: "a second action re-asks `detail` through `latest(s1)`; the remounted gate's old content is a zombie until the hold lands and reads the same errored memo. It settles in every hop count: before this case was built the one-hop gate looped (\"Potential Infinite Loop Detected\") — the zombie retried the errored memo every round (a later cycle's retry, PJ-R35), and the fresh error re-derived the live gate, whose retry next round re-derived the zombie"
        }
      ]
    }
  ],
  prose:
    "PR #4708 pinned a hop-less `<Show>` as never painting; with real JSX it paints at the landing and tears only during the flight, the same way `<Show>` did before S-46. The runner's `gate` variant here is the gate as written by hand, not an emulation. Cases ″ and ‴ (2026-11-08, #4723 review): the same mount under a guess lane — the write inside an action on an optimistic `id` — is the same mount; lane work served the screen (A15) is the one exception D-25 makes for no leaf a probing pass opened."
} satisfies Ruling;
