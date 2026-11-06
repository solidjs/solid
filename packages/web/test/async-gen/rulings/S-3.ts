import type { Ruling } from "./types.js";
import {
  s,
  m,
  plain,
  leaf,
  group,
  show,
  asyncMemo,
  syncMemo,
  write,
  settle,
  flush,
  task,
  act
} from "./_h.js";

/** `slow` is `x + 1` (async). On a click while the action is open (`open`
 * flips), a branch mounts that creates `ten` (`x + 1`, sync — the prose's
 * `x * 10`) and reads it beside a direct read of `x`. `title` is an unrelated
 * signal written mid-hold. */
export default {
  id: "S-3",
  title:
    "A mount during a hold: a derivation born held holds the mount; the branch appears whole at the commit",
  rules: ["D-1", "D-3"],
  status: "standing",
  issues: ["A29"],
  pins: ["tests/born-held.test.ts"],
  names: { s0: "x", s1: "open", s2: "title", m0: "slow", m1: "ten" },
  cases: [
    {
      scenario: {
        signals: [0, 0, 0],
        memos: [asyncMemo(s(0)), syncMemo({ src: s(0), how: "plain" })],
        tree: group(
          leaf(plain(s(0))),
          leaf(plain(m(0))),
          leaf(plain(s(2))),
          show(plain(s(1)), group(leaf(plain(m(1))), leaf(plain(s(0)))), { owns: [1] })
        ),
        steps: [
          settle(),
          task, // 0,1 primed
          act(0, 1),
          flush, // 2,3 the action holds x = 1; slow re-asks
          write(1, 1),
          flush, // 4,5 the click: the branch mounts
          write(2, 1),
          flush, // 6,7 an unrelated mainline write
          settle(),
          task,
          settle(),
          task // 8..11 the body returns; slow(2) lands
        ]
      },
      frames: [
        {
          after: 1,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span>vs2:0 </span>",
          note: "primed"
        },
        { after: 3, screen: "—", note: "held on `slow`" },
        {
          after: 5,
          screen: "—",
          note: "`ten` is born held: its first pass read the held `x`; `<p>{ten()}</p>` throws, so it holds the mount and the branch is not attached"
        },
        {
          after: 7,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span>vs2:1 </span>",
          note: "an unrelated mainline write shows at once — not swallowed into the action"
        },
        {
          after: 11,
          screen:
            "<span>vs0:1 </span><span>vm0:2 </span><span>vs2:1 </span><span>vm1:2 </span><span>vs0:1 </span>",
          note: "the commit reveals everything, the branch whole"
        }
      ],
      forbid: [
        {
          after: 5,
          screen:
            "<span>vs0:0 </span><span>vm0:1 </span><span>vs2:0 </span><span>vm1:2 </span><span>vs0:0 </span>",
          why: "`ten 2` beside `x 0`: the published future"
        },
        {
          after: 5,
          screen:
            "<span>vs0:0 </span><span>vm0:1 </span><span>vs2:0 </span><span>vm1:1 </span><span>vs0:0 </span>",
          why: "`ten 1`: a committed value `ten` never had (the N1 reading)"
        },
        {
          after: 5,
          screen:
            "<span>vs0:0 </span><span>vm0:1 </span><span>vs2:0 </span><span></span><span>vs0:0 </span>",
          why: "the branch attached around an empty slot"
        }
      ]
    }
  ]
} satisfies Ruling;
