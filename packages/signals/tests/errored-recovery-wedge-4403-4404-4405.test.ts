/**
 * #4403, #4404, #4405 (async-app generator): a root `<Errored>` on its
 * fallback after a sync memo threw, then a write that re-asks the memo. The
 * boundary waits on the source that threw (D-39); the seam drops a source
 * it judges settled and redraws the output, whose pass re-catches the tree's
 * error without re-running it. Each shape left the tree carrying an error the
 * graph would never re-derive, so the redraw re-caught it on every round:
 * "Potential Infinite Loop Detected" in dev, a hang in prod, and every later
 * flush wedged until the root was disposed.
 *
 * - #4404: a reader born in the flush read the committed error of a memo
 *   whose new error was staged, and its stale error committed last (D-41: a
 *   derivation that reads a staged error throws it).
 * - #4403: in the original script the memo's error was only staged, with
 *   the hold of the action whose slot the poisoning write joined (D-8), and
 *   the pass replacing it with the committed value was judged unchanged: the
 *   `latest()` readers that had thrown the staged error kept it (D-41: a
 *   recovery equal to the last good value is a change). The minimized form
 *   (the recovery itself held) holds on next since #4401; it stays as the
 *   guard that the error remains the display until that action lands (D-39).
 * - #4405: the boundary's tree, errored at the landing of the action that
 *   remounted its content, was not re-derived there, so it never linked the
 *   new content whose recovery had to reach it (D-3: structure reads the
 *   screen and re-derives at the commit; D-39).
 *
 * The shapes are the generator's minimized forms, in signals primitives:
 * `<Show>` is a condition memo and a value memo (keyed: the condition alone),
 * `<Errored><Loading>` the two boundaries, the root insert a render effect.
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

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  flush();
};

/** `<Show when={when()} fallback={fb}>{child()}</Show>`: the child is a new
 * object per pass, as a template clone is. */
function show(when: () => unknown, fb?: unknown) {
  const value = createMemo(() => when());
  const cond = createMemo(value, { equals: (a, b) => !a === !b });
  return createMemo(() => (cond() ? { span: true } : fb));
}
/** `<Show when={when()} keyed>{child()}</Show>`. */
function keyed(when: () => unknown, child: () => unknown) {
  const value = createMemo(() => when());
  return createMemo(() => (value() ? child() : undefined));
}
/** A memo that throws `name:v` whenever `v % 4 === at`. */
function poisoned(name: string, at: number, fn: () => number) {
  return createMemo(() => {
    const v = fn();
    if (v % 4 === at) throw new Error(`${name}:${v}`);
    return v;
  });
}
/** `<Errored fallback={e => "[E " + e().message + "]"}><Loading>…`. */
function mount(content: () => unknown) {
  let screen: unknown;
  const dispose = createRoot(d => {
    const out = createErrorBoundary(
      () => createLoadingBoundary(content, () => "[L]"),
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
  return { screen: () => screen, dispose };
}

it("#4404: a re-poisoning write batched with a remount settles on the new error (D-41)", () => {
  const [s, set] = createSignal(0);
  const [epoch, setEpoch] = createSignal(1);
  const m0 = poisoned("m0", 1, () => s() + 1);
  const m1 = poisoned("m1", 1, () => m0() + 1);
  const app = mount(() => keyed(epoch, () => show(m1)));
  try {
    flush();
    expect(app.screen()).toBe("[E m0:1]");
    // m0 = 4 is fine, m1 = 5 throws: the boundary retries once, sees the new
    // error and stops — a fresh render shows the same.
    set(3);
    setEpoch(e => e + 1);
    flush();
    expect(app.screen()).toBe("[E m1:5]");
    flush();
  } finally {
    app.dispose();
  }
});

it("#4403: an action recovering the memo to its last good value keeps the error until it lands (D-39, D-41)", async () => {
  const [s, set] = createSignal(0);
  const m = poisoned("m", 2, () => s() + 1);
  const app = mount(() => show(() => latest(m), "[F]"));
  let release!: () => void;
  const act = action(function* (v: number) {
    set(v);
    yield new Promise<void>(r => (release = r));
  });
  try {
    flush();
    expect(app.screen()).toEqual({ span: true });
    set(1); // m = 2 throws
    await tick();
    expect(app.screen()).toBe("[E m:2]");
    // m = 1 again, the value it had before it threw: a new answer all the
    // same, held with the action — the error stays the display meanwhile.
    act(0);
    flush();
    expect(app.screen()).toBe("[E m:2]");
    release();
    await tick();
    await tick();
    expect(app.screen()).toEqual({ span: true });
  } finally {
    app.dispose();
  }
});

it("#4403, the original's script: a held poisoning write, then a second action restoring the committed value (D-41)", async () => {
  const [s, set] = createSignal(0);
  const m = poisoned("m", 2, () => s() + 1);
  const app = mount(() => show(() => latest(m), "[F]"));
  const releases: (() => void)[] = [];
  const act = action(function* (v: number) {
    set(v);
    yield new Promise<void>(r => releases.push(r));
  });
  try {
    flush();
    act(2);
    flush();
    // A write to the slot the action holds joins it (D-8): m = 2 throws, an
    // error staged with the hold — the screen keeps its frame (D-41).
    set(1);
    await tick();
    expect(app.screen()).toEqual({ span: true });
    // m = 1, the committed value: the staged error is replaced, and the
    // readers that derived from it (`latest()` throws it) re-derive.
    act(0);
    flush();
    expect(app.screen()).toEqual({ span: true });
    releases.forEach(r => r());
    await tick();
    await tick();
    expect(app.screen()).toEqual({ span: true });
  } finally {
    app.dispose();
  }
});

it("#4405: a second action recovering the chain after a remounting landing recovers the boundary (D-3, D-39)", async () => {
  const [s0, setS0] = createSignal(2);
  const [s1, setS1] = createSignal(3);
  const [epoch, setEpoch] = createSignal(1);
  const m0 = poisoned("m0", 0, () => s0() + latest(s1) + 1);
  const m1 = poisoned("m1", 1, () => m0() + s1() + 1);
  const app = mount(() => keyed(epoch, () => show(m1)));
  let resolve!: () => void;
  const act = action(function* (v: number) {
    setS1(v);
    yield new Promise<void>(r => (resolve = r));
  });
  try {
    flush();
    expect(app.screen()).toEqual({ span: true }); // m0 = 6, m1 = 10
    act(2);
    // The first action completes in the tick of a write that poisons m1
    // (m0 = 6, m1 = 9) and of a remount of its readers.
    resolve();
    setS0(3);
    setEpoch(e => e + 1);
    await tick();
    expect(app.screen()).toBe("[E m1:9]");
    // s1 = 1: m0 = 5 (latest), m1 = 8 now — m1 reads `latest(s1)` through m0,
    // so its answer is display-ahead (D-25) and shows now, as it does with no
    // remount — and 7 at the landing.
    act(1);
    flush();
    expect(app.screen()).toEqual({ span: true });
    resolve();
    await tick();
    await tick();
    expect(app.screen()).toEqual({ span: true });
  } finally {
    app.dispose();
  }
});
