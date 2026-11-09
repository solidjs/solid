/**
 * @vitest-environment jsdom
 *
 * S-58 case ′ (D-25): a display-ahead gate is the same mainline mount
 * whatever its content's one grouped effect reads. Four leaf shapes under
 * `<Show when={isPending(m0)}>`, a one-hop gate (`gate: "cond"`), a
 * zero-hop gate (`gate: "memo"`) and one effect per attribute (`split`),
 * over the e1-3289-1831 memos: the last screen after the write's flight
 * lands. A leaf reading only `latest(m2)` paints in every column (it reads
 * nothing of the flight plainly); every other leaf keeps the fallback —
 * including one that reads `latest(m2)` or `latest(m0)` beside `m0()`,
 * which before this case attached early under the hand-written gates with
 * the committed `m0` beside its own ahead read (the maintainer's table,
 * 2026-11-08). Neither hop count nor grouping changes a mount's seat.
 */
import { expect, test } from "vitest";
import { runScenario } from "./async-gen/run.js";
const s = (i: number) => ({ k: "s", i }),
  m = (i: number) => ({ k: "m", i });
const memos = [
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
];
const leaves: Record<string, any[]> = {
  "m0() only": [{ how: "plain", src: m(0) }],
  "latest(m2) only": [{ how: "latest", src: m(2) }],
  "latest(m2), m0() (e1)": [
    { how: "latest", src: m(2) },
    { how: "plain", src: m(0) }
  ],
  "latest(m0), m0()": [
    { how: "latest", src: m(0) },
    { how: "plain", src: m(0) }
  ]
};
const sc = (attrs: any[]) =>
  ({
    signals: [0],
    memos,
    tree: {
      t: "show",
      when: { how: "pending", src: m(0) },
      child: { t: "leaf", text: [], attrs, grouped: true },
      fallback: true
    },
    steps: [{ t: "settle", pick: 5 }, { t: "task" }, { t: "write", s: 0, v: 1 }, { t: "task" }]
  }) as any;
test("isPending gate × leaf reads: the last screen is the same in every column", async () => {
  const out: string[] = [];
  for (const [name, attrs] of Object.entries(leaves)) {
    const row: string[] = [];
    for (const v of [
      { grouped: true },
      { grouped: true, gate: "cond" },
      { grouped: true, gate: "memo" },
      { split: true }
    ] as any[]) {
      const r = await runScenario(sc(attrs), v);
      row.push(
        (r.screens.at(-1) === "[F]"
          ? "[F]"
          : r.screens
              .at(-1)!
              .replace(/<span|><\/span>|data-|\s+/g, " ")
              .trim()
        ).padEnd(28)
      );
    }
    out.push(name.padEnd(24) + "| " + row.join(" | "));
  }
  expect(out.map(l => l.replace(/\s+\|/g, " |").trim())).toEqual([
    "m0() only | [F] | [F] | [F] | [F]",
    "latest(m2) only | a0=lm2:4 | a0=lm2:4 | a0=lm2:4 | a0=lm2:4",
    "latest(m2), m0() (e1) | [F] | [F] | [F] | [F]",
    "latest(m0), m0() | [F] | [F] | [F] | [F]"
  ]);
});
