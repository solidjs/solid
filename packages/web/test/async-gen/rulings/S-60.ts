import type { Ruling } from "./types.js";
import { s, m, plain, pend, leaf, scope, show, group, settle, flush, write, task } from "./_h.js";

/** #4544's shape in the grammar: `gate` (async over `session`) holds a
 * write to `session`; the write opens a branch (born held, D-27) whose one
 * effect reads `params` — `session()` beside `isPending(session)`, a
 * verdict reader that pass — and `load`, a dependency-free async memo the
 * branch owns: what the screen's `params` asks for. */
export default {
  id: "S-60",
  title:
    "A branch born into a hold that asks because of a display-ahead value does not hold the hold",
  rules: ["F-6", "D-25"],
  status: "standing",
  issues: ["#4544"],
  pins: ["tests/verdict-memo-held-branch-4544.test.ts"],
  names: { s0: "session", m0: "gate", m1: "params", m2: "load", L: "[loading]" },
  cases: [
    {
      scenario: {
        signals: [0],
        memos: [
          { async: true, deps: [{ src: s(0), how: "plain" }], poison: null },
          {
            async: false,
            deps: [
              { src: s(0), how: "plain" },
              { src: s(0), how: "pending" }
            ],
            poison: null
          },
          { async: true, deps: [], poison: null }
        ],
        tree: group(
          leaf(plain(m(0))),
          show(plain(s(0)), scope(plain(m(1)), plain(m(2))), { owns: [1, 2] })
        ),
        steps: [settle(), task, write(0, 1), flush, settle(), task, settle(), task]
      },
      variants: [{ gate: "memo" }, { gate: "cond" }],
      frames: [
        { after: 1, screen: "<span>vm0:1 </span>", note: "primed; the branch is closed" },
        {
          after: 3,
          screen: "—",
          note: "`gate` holds the write; the branch opens in the hold's world, born held (D-27), and its one effect reads `params` — a verdict reader that pass (it probed `isPending(session)` beside `session()`, F-6): the screen's `session` — and asks `load` for it"
        },
        {
          after: 5,
          screen: "<span>vm0:2 </span>",
          note: "`gate` answers and the hold lands: the load the branch asked for derives from a display-ahead read, so it does not hold the hold (F-6, #4544). `params` re-derives at the landing (A15), and the branch's effect waits on its own load"
        },
        {
          after: 7,
          screen: "<span>vm0:2 </span><span data-a0=vm1:2  data-a1=vm2:1 ></span>",
          note: "the load answers; the branch shows"
        }
      ],
      forbid: [
        {
          after: 5,
          screen: "<span>vm0:1 </span>",
          why: "the hold waited for the branch's load: a frame born into the hold, pending on what a settled verdict reader's display-ahead value asked for, counted as the hold's own pending observer (`blockedBy` without the `CONFIG_AHEAD` exemption)"
        }
      ]
    }
  ],
  prose:
    "Reached by no random generator case in 50,000 × 3 seeds (size pass, 2026-11-10): the grammar emits neither `isPending` memo inputs nor owned branches. The hole must be one effect with both reads (a grouped leaf): split into one effect per hole, the effect that goes pending never read the verdict reader and holds as any born-held effect does."
} satisfies Ruling;
