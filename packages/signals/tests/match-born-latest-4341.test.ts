// #4341: a memo born in a branch that a staged or held condition opened has
// no screen of its own — the branch exists only in the world that opened it.
// Its first pass reads that world like any derivation of it, whether or not
// it enters a `latest()`/`isPending()` window, and in whatever order: a
// verdict window must not turn the branch's own first pass into a reader of
// the screen, where its condition is still closed (the <Match> accessor then
// saw its branch as unmounted and threw, halting the app).
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack,
  type Accessor
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    flush();
  }
};

type Read = (zone: Accessor<string>, format: Accessor<string>, open: () => string) => string;

const reads: [string, Read][] = [
  ["latest(format) first", (zone, format, open) => `${latest(format)}:${zone()}:${open()}`],
  ["latest(format) between", (zone, format, open) => `${zone()}:${latest(format)}:${open()}`],
  ["latest(zone)", (zone, format, open) => `${format()}:${latest(zone)}:${open()}`],
  [
    "isPending(format)",
    (zone, format, open) => `${isPending(format) ? "?" : format()}:${zone()}:${open()}`
  ],
  ["plain reads (control)", (zone, format, open) => `${format()}:${zone()}:${open()}`]
];

/**
 * `zone` gates a branch (as `<Match when={zone() === "ready"}>`), and an
 * async memo under its own boundary re-asks on `zone`, so the frame that
 * flips it has a transaction.
 * - "staged": one write opens the branch; the selecting chain is deep
 *   enough that it runs after the frame has its transaction, so the
 *   selection reads a staging of that flush.
 * - "joined": the write is held first; a second, unrelated write re-runs
 *   the selection, which reads the held condition (it joins the hold) and
 *   opens the branch.
 * The reader is a memo, a render effect, or a memo a plain wrapper memo
 * creates (its creator is not the selecting pass itself).
 */
function setup(read: Read, reader: "memo" | "effect" | "nested memo", opener: "staged" | "joined") {
  const [ready, setReady] = createSignal(false);
  const [gate, setGate] = createSignal(opener === "staged");
  let resolve!: (v: string) => void;
  const screen: Record<string, unknown> = {};
  const seen: string[] = [];
  createRoot(() => {
    const zone = createMemo(() => (ready() ? "ready" : "loading"));
    const format = createMemo(() => "ru");
    const data = createMemo(() => {
      if (zone() !== "ready") return "none";
      return new Promise<string>(r => (resolve = r));
    });
    let selected: Accessor<boolean> = createMemo(() => zone() === "ready");
    for (let i = 0; i < 6; i++) {
      const prev = selected;
      selected = createMemo(() => prev());
    }
    const sel = selected;
    const show = (label: Accessor<string>) =>
      createRenderEffect(label, v => void seen.push((screen.span = v)));
    const branch = createMemo(() => {
      if (!gate() || !sel()) return "closed";
      return untrack(() => {
        // The narrowed accessor's guard: is this branch still the selected one?
        const open = () => (untrack(sel) ? "sel" : "stale");
        if (reader === "effect") show(() => read(zone, format, open));
        else if (reader === "memo") show(createMemo(() => read(zone, format, open)));
        else createMemo(() => show(createMemo(() => read(zone, format, open))));
        return "open";
      });
    });
    createRenderEffect(branch, v => void (screen.branch = v));
    createRenderEffect(
      createLoadingBoundary(
        () => data(),
        () => "wait"
      ),
      v => void (screen.data = v)
    );
  });
  flush();
  return { screen, seen, setReady, setGate, resolve: (v: string) => resolve(v) };
}

describe("a memo born in a newly opened branch reads the world that opened it (#4341)", () => {
  for (const opener of ["staged", "joined"] as const)
    for (const reader of ["memo", "effect", "nested memo"] as const)
      for (const [name, read] of reads)
        it(`${opener}, ${reader}: ${name}`, async () => {
          const { screen, seen, setReady, setGate, resolve } = setup(read, reader, opener);
          expect(screen).toEqual({ branch: "closed", data: "none" });
          setReady(true);
          flush();
          if (opener === "joined") {
            expect(screen).toEqual({ branch: "closed", data: "none" });
            setGate(true);
            flush();
          }
          // Held on `data`: the branch has not opened on screen.
          expect(screen.branch).toBe("closed");
          resolve("data");
          await settle();
          const want = name === "latest(format) between" ? "ready:ru:sel" : "ru:ready:sel";
          expect(screen).toEqual({ branch: "open", span: want, data: "data" });
          // No pass of the branch's reader saw its branch closed.
          expect(seen.filter(v => v !== want)).toEqual([]);
        });
});
