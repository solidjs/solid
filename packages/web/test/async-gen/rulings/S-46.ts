import type { Ruling } from "./types.js";

const s = (i: number) => ({ k: "s" as const, i });
const m = (i: number) => ({ k: "m" as const, i });
const leaf = (how: "plain" | "latest" | "pending", src: { k: "s" | "m"; i: number }) => ({
  t: "leaf" as const,
  text: [{ how, src }],
  attrs: [],
  grouped: false
});
const prime = [{ t: "settle" as const, pick: 0 }, { t: "task" as const }];
const run = [
  ...prime,
  { t: "write" as const, s: 0, v: 1 },
  { t: "flush" as const },
  { t: "settle" as const, pick: 0 },
  { t: "task" as const }
];
const memos = [{ async: true, deps: [{ src: s(0), how: "plain" as const }], poison: null }];

/** `detail` is `id + 1` (async). A plain write to `id` is held by `detail`'s flight. */
export default {
  id: "S-46",
  title: "The content a display-ahead `Show` opens reads the screen, whoever opened the hold",
  rules: ["D-25"],
  status: "standing",
  pins: [
    "tests/display-ahead-plain-write-content.test.ts",
    "web/test/display-ahead-plain-write-content-s46.spec.tsx"
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
            leaf("plain", s(0)),
            leaf("plain", m(0)),
            {
              t: "show",
              when: { how: "latest", src: s(0) },
              fallback: true,
              child: leaf("plain", s(0))
            }
          ]
        },
        steps: run
      },
      frames: [
        { after: 1, screen: "<span>vs0:0 </span><span>vm0:1 </span>[F]", note: "primed" },
        {
          after: 3,
          screen: "—",
          note: "the `Show` opens ahead (`latest` asked), but the branch is a mount whose first pass read the staging plainly: born held (D-27), it does not attach until the landing; the fallback stays"
        },
        { after: 5, screen: "<span>vs0:1 </span><span>vm0:2 </span><span>vs0:1 </span>" }
      ],
      forbid: [
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span>vs0:1 </span>",
          why: "two plain reads of one signal disagreeing on one screen"
        },
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span>vs0:0 </span>",
          why: "the branch attached with the committed value; a mount under a display-ahead reader is born held, not a D-3 leaf"
        },
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span></span>",
          why: "the branch attached with its hole empty (F-2: never an empty slot)"
        }
      ]
    },
    {
      label: "′",
      scenario: {
        signals: [0],
        memos,
        tree: {
          t: "group",
          kids: [
            leaf("plain", s(0)),
            leaf("plain", m(0)),
            {
              t: "show",
              when: { how: "latest", src: s(0) },
              fallback: true,
              child: leaf("latest", s(0))
            }
          ]
        },
        steps: run
      },
      frames: [
        { after: 1, screen: "<span>vs0:0 </span><span>vm0:1 </span>[F]" },
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span><span>ls0:1 </span>",
          note: "content `latest(id)`: the read that asks sees ahead, at its own site"
        },
        { after: 5, screen: "<span>vs0:1 </span><span>vm0:2 </span><span>ls0:1 </span>" }
      ]
    },
    {
      label: "″",
      scenario: {
        signals: [0],
        memos,
        tree: {
          t: "group",
          kids: [
            leaf("plain", s(0)),
            leaf("plain", m(0)),
            {
              t: "show",
              when: { how: "latest", src: s(0) },
              fallback: true,
              child: { t: "loading", child: leaf("plain", s(0)) }
            }
          ]
        },
        steps: run
      },
      frames: [
        { after: 1, screen: "<span>vs0:0 </span><span>vm0:1 </span>[F]" },
        {
          after: 3,
          screen: "<span>vs0:0 </span><span>vm0:1 </span>[L]",
          note: "S-31's form: the boundary catches the born-held read"
        },
        { after: 5, screen: "<span>vs0:1 </span><span>vm0:2 </span><span>vs0:1 </span>" }
      ]
    }
  ]
} satisfies Ruling;
