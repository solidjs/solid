/**
 * #4405's one-hop shape (S-58): a keyed remount and a poisoning write in one
 * tick, then an action whose write `m0` reads through `latest`. The old
 * content is a zombie until the hold lands; its gate reads the errored `m0`
 * as the new content's gate does. An errored node retries on a later
 * cycle's pull (PJ-R35), so with one memo between `m0` and the branch the
 * zombie's retry of `m0` (a fresh error) re-derived the new content's
 * verdict reader, whose retry next round re-derived the zombie: "Potential
 * Infinite Loop Detected" in dev, a hang in prod. A zombie's fate is the
 * seam's (L2): it does not retry. Every hop count shows the same screen
 * (S-58).
 */
import { expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

type Gate = (when: () => unknown) => () => unknown;
/** `<Show when={when()}>`: a value memo, a truthiness memo, the branch. */
const show: Gate = when => {
  const value = createMemo(() => when());
  const cond = createMemo(value, { equals: (a, b) => !a === !b });
  return createMemo(() => (cond() ? { span: true } : undefined));
};
/** A truthiness memo and the branch memo: one hop. */
const oneHop: Gate = when => {
  const cond = createMemo(() => when(), { equals: (a, b) => !a === !b });
  return createMemo(() => (cond() ? { span: true } : undefined));
};
/** One memo that reads `when` and mounts the branch: no hop. */
const noHop: Gate = when => createMemo(() => (when() ? { span: true } : undefined));

for (const [name, gate] of [
  ["<Show>", show],
  ["one hop", oneHop],
  ["no hop", noHop]
] as const)
  it(`a zombie gate over an errored memo settles under a remount and an action (${name})`, () => {
    const [s0, setS0] = createSignal(2);
    const [s1, setS1] = createSignal(3);
    const [epoch, setEpoch] = createSignal(1);
    // Throws whenever its value is a multiple of 4.
    const m0 = createMemo(() => {
      const v = s0() + latest(s1) + 1;
      if (v % 4 === 0) throw new Error(`m0:${v}`);
      return v;
    });
    let screen: unknown;
    const dispose = createRoot(d => {
      const out = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => {
              const key = createMemo(() => epoch());
              return createMemo(() => (key() ? gate(m0) : undefined));
            },
            () => "[L]"
          ),
        e => `[E ${(e() as Error).message}]`
      );
      createRenderEffect(
        () => {
          let v: unknown = out();
          while (typeof v === "function") v = v();
          return v;
        },
        v => void (screen = v)
      );
      return d;
    });
    try {
      flush();
      expect(screen).toEqual({ span: true }); // m0 = 6
      // The write and the remount join the action's hold; the lane reads
      // `latest(s1)` = 1 over the committed `s0` = 2: m0 = 4 throws.
      setS0(3);
      setEpoch(e => e + 1);
      action(function* () {
        setS1(1);
        yield new Promise(() => {});
      })();
      flush();
      expect(screen).toBe("[E m0:4]");
    } finally {
      dispose();
    }
  });
